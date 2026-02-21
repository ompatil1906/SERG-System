const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { db } = require('../services/firebase');
const { analyzeTelemetry } = require('../services/accidentDetection');
const { triggerEmergencyNotifications } = require('../services/notifier');
const { dispatchAmbulance } = require('../services/ambulanceDispatcher');

// Mock user contacts for demonstration
const EMERGENCY_CONTACTS = [
    { name: 'Admin', phone: '+1234567890', email: 'admin@example.com' }
];

// --- In-memory device cache (bypasses Firestore quota limits) ---
// Gets updated every time an ESP32 payload arrives
const deviceCache = {};

// --- Public live-data endpoint — frontend polls this every 2s ---
router.get('/live-data', (req, res) => {
    const devices = Object.values(deviceCache);
    res.json({ devices, updatedAt: new Date().toISOString() });
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

        // 1. Run Accident Detection Logic (fast, sync)
        const analysis = analyzeTelemetry(data);

        // 2. Update in-memory cache immediately (works even if Firestore quota is exhausted)
        deviceCache[data.device_id] = {
            id: data.device_id,
            status: 'Online',
            last_seen: new Date().toISOString(),
            latest_data: {
                ...data,
                server_timestamp: new Date().toISOString(),
                is_accident: analysis.isAccident,
                severity: analysis.severity
            }
        };

        // 3. ACK the ESP32 IMMEDIATELY — don't wait for Firebase
        res.status(201).json({ success: true, is_accident: analysis.isAccident });

        // 3. All Firebase writes + notifications happen in background AFTER response
        setImmediate(async () => {
            try {
                const deviceRef = db.collection('devices').doc(data.device_id);
                const historyRef = deviceRef.collection('history').doc();
                const batch = db.batch();

                batch.set(historyRef, {
                    ...data,
                    server_timestamp: new Date().toISOString(),
                    is_accident: analysis.isAccident,
                    severity: analysis.severity
                });

                batch.set(deviceRef, {
                    latest_data: {
                        ...data,
                        server_timestamp: new Date().toISOString(),
                        is_accident: analysis.isAccident,
                        severity: analysis.severity
                    },
                    status: 'Online',
                    last_seen: new Date().toISOString()
                }, { merge: true });

                if (analysis.isAccident) {
                    const alertRef = db.collection('alerts').doc();
                    batch.set(alertRef, {
                        device_id: data.device_id,
                        location: { lat: data.latitude, lng: data.longitude },
                        severity: analysis.severity,
                        triggers: analysis.triggers,
                        status: 'Unresolved',
                        timestamp: analysis.timestamp
                    });
                }

                await batch.commit();
                console.log(`[DB] Data saved for ${data.device_id} | accident=${analysis.isAccident}`);

                if (analysis.isAccident) {
                    triggerEmergencyNotifications(data, analysis, EMERGENCY_CONTACTS)
                        .catch(err => console.error('Notification Error:', err));
                    dispatchAmbulance(data)
                        .catch(err => console.error('Ambulance Dispatch Error:', err));
                }
            } catch (bgErr) {
                console.error('[BG] Firebase write error:', bgErr.message);
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
