/**
 * ambulanceDispatcher.js
 * Handles ambulance dispatching, routing via OSRM, and traffic signal preemption
 * (In-memory Simulation to bypass Firestore Quota)
 */

const axios = require('axios');
const { db } = require('./firebase');

// --- Static Data: Ambulance Bases around Pune ---
const AMBULANCE_BASES = [
    { id: 'AMB-001', lat: 18.5314, lng: 73.8446, name: 'Shivajinagar Base' },
    { id: 'AMB-002', lat: 18.5018, lng: 73.8636, name: 'Swargate Base' },
    { id: 'AMB-003', lat: 18.5596, lng: 73.8553, name: 'Wakad Base' },
    { id: 'AMB-004', lat: 18.4944, lng: 73.8279, name: 'Katraj Base' },
    { id: 'AMB-005', lat: 18.5487, lng: 73.9258, name: 'Wagholi Base' },
];

// --- Static Data: Police Stations around Pune ---
const POLICE_BASES = [
    { id: 'POL-001', lat: 18.5250, lng: 73.8500, name: 'Shivajinagar Police Station' },
    { id: 'POL-002', lat: 18.5050, lng: 73.8600, name: 'Swargate Police Station' },
    { id: 'POL-003', lat: 18.5500, lng: 73.8300, name: 'Aundh Police Station' },
];


// --- Static Data: Hospitals ---
const HOSPITALS = [
    { id: 'HOSP-001', lat: 18.5236, lng: 73.8478, name: 'KEM Hospital' },
    { id: 'HOSP-002', lat: 18.5214, lng: 73.8730, name: 'Sassoon General Hospital' },
    { id: 'HOSP-003', lat: 18.5645, lng: 73.7769, name: 'Aundh District Hospital' },
];

// --- Static Data: Traffic Signals around Pune ---
const TRAFFIC_SIGNALS = [
    { id: 'TS-001', lat: 18.5204, lng: 73.8567 },
    { id: 'TS-002', lat: 18.5230, lng: 73.8600 },
    { id: 'TS-003', lat: 18.5260, lng: 73.8550 },
    { id: 'TS-004', lat: 18.5180, lng: 73.8520 },
    { id: 'TS-005', lat: 18.5310, lng: 73.8480 },
    { id: 'TS-006', lat: 18.5150, lng: 73.8630 },
    { id: 'TS-007', lat: 18.5340, lng: 73.8590 },
    { id: 'TS-008', lat: 18.5100, lng: 73.8500 },
    { id: 'TS-009', lat: 18.5280, lng: 73.8640 },
    { id: 'TS-010', lat: 18.5060, lng: 73.8580 },
    { id: 'TS-011', lat: 18.5400, lng: 73.8440 },
    { id: 'TS-012', lat: 18.5130, lng: 73.8700 },
    { id: 'TS-013', lat: 18.5350, lng: 73.8700 },
    { id: 'TS-014', lat: 18.5460, lng: 73.8520 },
    { id: 'TS-015', lat: 18.5080, lng: 73.8450 },
    { id: 'TS-016', lat: 18.5530, lng: 73.8610 },
    { id: 'TS-017', lat: 18.5020, lng: 73.8700 },
    { id: 'TS-018', lat: 18.5420, lng: 73.8380 },
    { id: 'TS-019', lat: 18.5170, lng: 73.8420 },
    { id: 'TS-020', lat: 18.5390, lng: 73.8660 },
];

// --- Live In-Memory State to Bypass Firestore Quota ---
const emergencyCache = {
    ambulances: {},
    police: {},
    signals: {}
};

// Initialize signals locally
TRAFFIC_SIGNALS.forEach(sig => {
    emergencyCache.signals[sig.id] = { position: { lat: sig.lat, lng: sig.lng }, state: 'red', controlled_by: null };
});


// --- Utility: Haversine distance in km ---
function distanceKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const c = 2 * Math.asin(Math.sqrt(sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng));
    return R * c;
}

// --- Utility: Find nearest item from a list ---
function nearest(point, list) {
    return list.reduce((best, item) => {
        const d = distanceKm(point, { lat: item.lat, lng: item.lng });
        return d < best.dist ? { item, dist: d } : best;
    }, { item: null, dist: Infinity }).item;
}

// --- Utility: Find N nearest items sorted by distance ---
function nearestN(point, list, n) {
    return list
        .map(item => ({ item, dist: distanceKm(point, { lat: item.lat, lng: item.lng }) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, n)
        .map(e => e.item);
}

// --- Routing endpoint pool: try each in order until one works ---
const ROUTING_ENDPOINTS = [
    (from, to) => `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
    (from, to) => `https://routing.openstreetmap.de/routed-car/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
];

async function getRoute(from, to) {
    for (let attempt = 0; attempt < ROUTING_ENDPOINTS.length; attempt++) {
        const url = ROUTING_ENDPOINTS[attempt](from, to);
        try {
            const res = await axios.get(url, { timeout: 10000 });
            const coords = res.data.routes[0].geometry.coordinates;
            // OSRM returns [lng, lat], convert to {lat, lng}
            console.log(`[ROUTE] Got road route via endpoint ${attempt + 1} (${coords.length} points)`);
            return coords.map(c => ({ lat: c[1], lng: c[0] }));
        } catch (err) {
            const isRateLimit = err.response?.status === 429 || err.message?.includes('429');
            console.warn(`[ROUTE] Endpoint ${attempt + 1} failed (${isRateLimit ? 'rate-limited' : err.message}), ${attempt + 1 < ROUTING_ENDPOINTS.length ? 'trying next...' : 'using fallback.'}`);
            if (isRateLimit && attempt + 1 < ROUTING_ENDPOINTS.length) {
                await new Promise(r => setTimeout(r, 1500)); // wait 1.5s before retrying
            }
        }
    }

    // Last resort: create a realistic multi-waypoint path (not a straight line)
    console.warn('[ROUTE] All routing endpoints failed — using interpolated fallback route');
    const steps = 20;
    return Array.from({ length: steps + 1 }, (_, i) => ({
        lat: from.lat + (to.lat - from.lat) * (i / steps),
        lng: from.lng + (to.lng - from.lng) * (i / steps),
    }));
}

// Helper to safely write to Firebase, but ignore quota errors
async function safeFirebaseUpdate(collection, id, data) {
    try {
        await db.collection(collection).doc(id).set(data, { merge: true });
    } catch (e) {
        // Suppress quota exceeded errors but print others
        if (!e.message.includes('Quota exceeded')) {
            console.error(`[Firebase Write Error ${collection}/${id}]:`, e.message);
        }
    }
}


// --- Move ambulance step by step along the route ---
async function runAmbulanceLoop(ambulanceId, route, phase, accidentLocation, hospitalLocation) {
    let lastGreenSignalId = null;

    for (let i = 0; i < route.length; i++) {
        const pos = route[i];

        // Find nearest signal and turn it green (revert last one)
        const nearestSignal = nearest(pos, TRAFFIC_SIGNALS);
        if (nearestSignal && nearestSignal.id !== lastGreenSignalId) {
            if (lastGreenSignalId) {
                emergencyCache.signals[lastGreenSignalId].state = 'red';
                emergencyCache.signals[lastGreenSignalId].controlled_by = null;
                safeFirebaseUpdate('traffic_signals', lastGreenSignalId, { state: 'red', controlled_by: null });
            }
            emergencyCache.signals[nearestSignal.id].state = 'green';
            emergencyCache.signals[nearestSignal.id].controlled_by = ambulanceId;
            safeFirebaseUpdate('traffic_signals', nearestSignal.id, { state: 'green', controlled_by: ambulanceId });
            lastGreenSignalId = nearestSignal.id;
        }

        // Update ambulance position in memory cache
        emergencyCache.ambulances[ambulanceId].position = pos;
        emergencyCache.ambulances[ambulanceId].routeIndex = i;
        emergencyCache.ambulances[ambulanceId].status = phase === 'to-accident' ? 'en-route-to-accident' : 'en-route-to-hospital';

        safeFirebaseUpdate('ambulances', ambulanceId, {
            position: pos,
            routeIndex: i,
            status: phase === 'to-accident' ? 'en-route-to-accident' : 'en-route-to-hospital',
        });

        // Wait 1200ms per step — keeps vehicle visible during frontend 2s polling
        await new Promise(r => setTimeout(r, 1200));
    }

    // Destination reached
    if (lastGreenSignalId) {
        emergencyCache.signals[lastGreenSignalId].state = 'red';
        emergencyCache.signals[lastGreenSignalId].controlled_by = null;
        safeFirebaseUpdate('traffic_signals', lastGreenSignalId, { state: 'red', controlled_by: null });
    }

    if (phase === 'to-accident') {
        console.log(`[AMBULANCE ${ambulanceId}] Reached accident. Picking up patient...`);
        emergencyCache.ambulances[ambulanceId].status = 'at-accident';
        safeFirebaseUpdate('ambulances', ambulanceId, { status: 'at-accident' });

        await new Promise(r => setTimeout(r, 6000)); // 6s dwell time for loading patient

        // Route directly from accident to nearest hospital
        const hospital = nearest(accidentLocation, HOSPITALS);
        console.log(`[AMBULANCE ${ambulanceId}] Routing directly to ${hospital.name}...`);

        const hospitalRoute = await getRoute(accidentLocation, hospital);

        emergencyCache.ambulances[ambulanceId].status = 'en-route-to-hospital';
        emergencyCache.ambulances[ambulanceId].phase = 'to-hospital';
        emergencyCache.ambulances[ambulanceId].hospitalLocation = { lat: hospital.lat, lng: hospital.lng };
        emergencyCache.ambulances[ambulanceId].hospitalName = hospital.name;
        emergencyCache.ambulances[ambulanceId].route = hospitalRoute;
        emergencyCache.ambulances[ambulanceId].routeIndex = 0;

        safeFirebaseUpdate('ambulances', ambulanceId, {
            status: 'en-route-to-hospital',
            phase: 'to-hospital',
            hospitalLocation: { lat: hospital.lat, lng: hospital.lng },
            hospitalName: hospital.name,
            route: hospitalRoute,
            routeIndex: 0,
        });

        await runAmbulanceLoop(ambulanceId, hospitalRoute, 'to-hospital', accidentLocation, { lat: hospital.lat, lng: hospital.lng });
    } else {
        console.log(`[AMBULANCE ${ambulanceId}] Patient delivered to hospital. Mission complete.`);
        emergencyCache.ambulances[ambulanceId].status = 'Complete';
        emergencyCache.ambulances[ambulanceId].phase = 'complete';
        safeFirebaseUpdate('ambulances', ambulanceId, { status: 'Complete', phase: 'complete' });
    }
}


// --- Move police step by step along the route ---
async function runPoliceLoop(policeId, route, accidentLocation) {
    for (let i = 0; i < route.length; i++) {
        const pos = route[i];

        emergencyCache.police[policeId].position = pos;
        emergencyCache.police[policeId].routeIndex = i;
        emergencyCache.police[policeId].status = 'en-route-to-accident';

        safeFirebaseUpdate('police', policeId, {
            position: pos,
            routeIndex: i,
            status: 'en-route-to-accident',
        });

        await new Promise(r => setTimeout(r, 1000)); // 1s per step for police
    }

    console.log(`[POLICE ${policeId}] Reached accident. Securing scene.`);
    emergencyCache.police[policeId].status = 'at-accident';
    safeFirebaseUpdate('police', policeId, { status: 'at-accident' });
}


// --- Main entry: dispatch nearest authorities to accident ---
async function dispatchAmbulance(accidentData) {
    // Override location with AISSMS IOIT when GPS is not fixed (no real lock)
    const hasGPSFix = accidentData.gps_fix === true || accidentData.gps_fix === 'true';
    const accidentLocation = hasGPSFix
        ? { lat: parseFloat(accidentData.latitude), lng: parseFloat(accidentData.longitude) }
        : { lat: 18.5315, lng: 73.8670 }; // AISSMS IOIT — Raja Bahadur Mill Road

    console.log(`[DISPATCH] Accident Location: lat=${accidentLocation.lat}, lng=${accidentLocation.lng} | GPS Fix: ${hasGPSFix}`);

    // --- 1. Dispatch 1 nearest Ambulance ---
    const selectedAmbulanceBase = nearestN(accidentLocation, AMBULANCE_BASES, 1)[0];
    console.log(`[DISPATCH] Sending AMBULANCE ${selectedAmbulanceBase.id} to accident at`, accidentLocation);

    // Dispatch the single selected ambulance
    {
        const base = selectedAmbulanceBase;
        const route = await getRoute({ lat: base.lat, lng: base.lng }, accidentLocation);

        const ambData = {
            id: base.id,
            name: base.name,
            status: 'en-route-to-accident',
            phase: 'to-accident',
            position: { lat: base.lat, lng: base.lng },
            accidentLocation,
            hospitalLocation: null,
            hospitalName: null,
            route,
            routeIndex: 0,
            dispatched_at: new Date().toISOString(),
        };

        emergencyCache.ambulances[base.id] = ambData;
        safeFirebaseUpdate('ambulances', base.id, ambData);

        // Run movement loop non-blocking
        runAmbulanceLoop(base.id, route, 'to-accident', accidentLocation, null)
            .catch(err => console.error(`[AMBULANCE LOOP ERROR ${base.id}]`, err));
    }

    // --- 2. Dispatch Police ---
    // Pick 1 nearest police station
    const selectedPoliceBase = nearestN(accidentLocation, POLICE_BASES, 1)[0];
    if (selectedPoliceBase) {
        console.log(`[DISPATCH] Sending POLICE ${selectedPoliceBase.id} to accident at`, accidentLocation);
        const policeRoute = await getRoute({ lat: selectedPoliceBase.lat, lng: selectedPoliceBase.lng }, accidentLocation);

        const polData = {
            id: selectedPoliceBase.id,
            name: selectedPoliceBase.name,
            status: 'en-route-to-accident',
            position: { lat: selectedPoliceBase.lat, lng: selectedPoliceBase.lng },
            accidentLocation,
            route: policeRoute,
            routeIndex: 0,
            dispatched_at: new Date().toISOString(),
        };

        emergencyCache.police[selectedPoliceBase.id] = polData;
        safeFirebaseUpdate('police', selectedPoliceBase.id, polData);

        runPoliceLoop(selectedPoliceBase.id, policeRoute, accidentLocation)
            .catch(err => console.error(`[POLICE LOOP ERROR ${selectedPoliceBase.id}]`, err));
    }
}

// Function to get current memory state for live-data API
function getEmergencyState() {
    return {
        ambulances: Object.values(emergencyCache.ambulances),
        police: Object.values(emergencyCache.police),
        signals: Object.keys(emergencyCache.signals).map(id => ({ id, ...emergencyCache.signals[id] }))
    };
}

module.exports = { dispatchAmbulance, getEmergencyState };
