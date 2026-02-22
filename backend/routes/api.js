const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { db } = require('../services/firebase');
const { analyzeTelemetry } = require('../services/accidentDetection');
const { triggerEmergencyNotifications } = require('../services/notifier');
const { dispatchAmbulance, getEmergencyState } = require('../services/ambulanceDispatcher');

// Mock user contacts for demonstration
const EMERGENCY_CONTACTS = [
    { name: 'Admin', phone: '+1234567890', email: 'admin@example.com' }
];

// --- In-memory device cache (bypasses Firestore quota limits) ---
// Gets updated every time an ESP32 payload arrives
const deviceCache = {};

// --- Accident Latch: keeps is_accident=true for 5 min after first detection ---
// Prevents subsequent calm payloads from clearing the alert during simulation
const accidentLatch = {}; // { device_id: { until: timestamp, dispatched: bool } }
const LATCH_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// --- Public live-data endpoint — frontend polls this every 2s ---
router.get('/live-data', (req, res) => {
    const devices = Object.values(deviceCache);
    const emergencyState = getEmergencyState();
    res.json({
        devices,
        ambulances: emergencyState.ambulances,
        police: emergencyState.police,
        signals: emergencyState.signals,
        updatedAt: new Date().toISOString()
    });
});

// --- Authentication Route ---
router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    // Basic hardcoded check for demo purposes
    if (username === 'admin' && password === 'admin123') {
        const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '2h' });
        return res.json({ token });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
});

// --- Middleware to verify JWT ---
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Unauthorized' });
        req.user = decoded;
        next();
    });
}

// --- Data Ingestion Endpoint (from ESP32) ---
router.post('/device-data', async (req, res) => {
    console.log(`[${new Date().toISOString()}] ✅ Request received from ${req.ip}`);
    try {
        const data = req.body;

        // Basic Validation
        if (!data.device_id || !data.latitude || !data.longitude) {
            return res.status(400).json({ error: 'Missing critical fields' });
        }

        // --- Accident Latch Logic ---
        // 1. Run current sensor analysis
        const analysis = analyzeTelemetry(data);

        const now = Date.now();
        const latch = accidentLatch[data.device_id];
        const isLatched = !!(latch && latch.until > now);

        // Lock in accident if newly detected
        if (analysis.isAccident && !isLatched) {
            accidentLatch[data.device_id] = { until: now + LATCH_DURATION_MS, dispatched: false };
            console.log(`[LATCH] Accident latched for ${data.device_id} until ${new Date(now + LATCH_DURATION_MS).toISOString()}`);
        }

        // Determine effective accident state (honour latch even if sensor is now calm)
        const effectiveIsAccident = analysis.isAccident || isLatched;
        const effectiveSeverity = effectiveIsAccident
            ? (analysis.severity !== 'None' ? analysis.severity : (latch?.severity || 'HIGH'))
            : 'None';

        // 2. Update in-memory cache immediately (works even if Firestore quota is exhausted)
        deviceCache[data.device_id] = {
            id: data.device_id,
            status: 'Online',
            last_seen: new Date().toISOString(),
            latest_data: {
                ...data,
                server_timestamp: new Date().toISOString(),
                is_accident: effectiveIsAccident,
                severity: effectiveSeverity
            }
        };

        // ACK the ESP32 IMMEDIATELY — don't wait for Firebase
        res.status(201).json({ success: true, is_accident: effectiveIsAccident });

        // All Firebase writes + notifications happen in background AFTER response
        setImmediate(async () => {
            try {
                const deviceRef = db.collection('devices').doc(data.device_id);
                const historyRef = deviceRef.collection('history').doc();
                const batch = db.batch();

                batch.set(historyRef, {
                    ...data,
                    server_timestamp: new Date().toISOString(),
                    is_accident: effectiveIsAccident,
                    severity: effectiveSeverity
                });

                batch.set(deviceRef, {
                    latest_data: {
                        ...data,
                        server_timestamp: new Date().toISOString(),
                        is_accident: effectiveIsAccident,
                        severity: effectiveSeverity
                    },
                    status: 'Online',
                    last_seen: new Date().toISOString()
                }, { merge: true });

                // Only dispatch once per latch window
                if (analysis.isAccident && accidentLatch[data.device_id] && !accidentLatch[data.device_id].dispatched) {
                    accidentLatch[data.device_id].dispatched = true;
                    accidentLatch[data.device_id].severity = analysis.severity;

                    const alertRef = db.collection('alerts').doc();
                    batch.set(alertRef, {
                        device_id: data.device_id,
                        location: { lat: data.latitude, lng: data.longitude },
                        severity: analysis.severity,
                        triggers: analysis.triggers,
                        status: 'Unresolved',
                        timestamp: analysis.timestamp
                    });

                    triggerEmergencyNotifications(data, analysis, EMERGENCY_CONTACTS)
                        .catch(err => console.error('Notification Error:', err));
                    dispatchAmbulance(data)
                        .catch(err => console.error('Ambulance Dispatch Error:', err));
                }

                try {
                    await batch.commit();
                    console.log(`[DB] Data saved for ${data.device_id} | accident=${analysis.isAccident}`);
                } catch (dbErr) {
                    console.error('[DB] Firebase write error (ignoring for simulation):', dbErr.message);
                }
            } catch (bgErr) {
                console.error('[BG] Background processing error:', bgErr.message);
            }
        });

    } catch (error) {
        console.error('Data ingestion error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Dashboard Endpoints ---
// Get live devices
router.get('/live-devices', verifyToken, async (req, res) => {
    try {
        const snapshot = await db.collection('devices').get();
        const devices = [];
        snapshot.forEach(doc => {
            devices.push({ id: doc.id, ...doc.data() });
        });
        return res.json({ devices });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

// Get recent alerts
router.get('/alerts', verifyToken, async (req, res) => {
    try {
        const snapshot = await db.collection('alerts').orderBy('timestamp', 'desc').limit(50).get();
        const alerts = [];
        snapshot.forEach(doc => {
            alerts.push({ id: doc.id, ...doc.data() });
        });
        return res.json({ alerts });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

module.exports = router;
