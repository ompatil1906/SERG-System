/**
 * ambulanceDispatcher.js
 * Handles ambulance dispatching, routing via OSRM, and traffic signal preemption
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

// --- Static Data: Hospitals ---
const HOSPITALS = [
    { id: 'HOSP-001', lat: 18.5236, lng: 73.8478, name: 'KEM Hospital' },
    { id: 'HOSP-002', lat: 18.5339, lng: 73.8673, name: 'Sassoon General Hospital' },
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

// --- Get real road route from OSRM (free, no key) ---
async function getRoute(from, to) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    try {
        const res = await axios.get(url, { timeout: 8000 });
        const coords = res.data.routes[0].geometry.coordinates;
        // OSRM returns [lng, lat], convert to {lat, lng}
        return coords.map(c => ({ lat: c[1], lng: c[0] }));
    } catch (err) {
        console.error('OSRM routing failed, using straight line:', err.message);
        // Fallback: straight line with 10 interpolated points
        const steps = 10;
        return Array.from({ length: steps + 1 }, (_, i) => ({
            lat: from.lat + (to.lat - from.lat) * (i / steps),
            lng: from.lng + (to.lng - from.lng) * (i / steps),
        }));
    }
}

// --- Seed traffic signals into Firestore (first call only) ---
async function seedSignals() {
    const batch = db.batch();
    for (const signal of TRAFFIC_SIGNALS) {
        const ref = db.collection('traffic_signals').doc(signal.id);
        batch.set(ref, {
            position: { lat: signal.lat, lng: signal.lng },
            state: 'red',
            controlled_by: null,
        }, { merge: true });
    }
    await batch.commit();
}

// --- Move ambulance step by step along the route ---
async function runAmbulanceLoop(ambulanceId, route, phase, accidentLocation, hospitalLocation) {
    const ambRef = db.collection('ambulances').doc(ambulanceId);
    let lastGreenSignalId = null;

    for (let i = 0; i < route.length; i++) {
        const pos = route[i];

        // Find nearest signal and turn it green (revert last one)
        const nearestSignal = nearest(pos, TRAFFIC_SIGNALS);
        if (nearestSignal && nearestSignal.id !== lastGreenSignalId) {
            const batch = db.batch();
            if (lastGreenSignalId) {
                batch.update(db.collection('traffic_signals').doc(lastGreenSignalId), {
                    state: 'red', controlled_by: null
                });
            }
            batch.update(db.collection('traffic_signals').doc(nearestSignal.id), {
                state: 'green', controlled_by: ambulanceId
            });
            await batch.commit();
            lastGreenSignalId = nearestSignal.id;
        }

        // Update ambulance position
        await ambRef.update({
            position: pos,
            routeIndex: i,
            status: phase === 'to-accident' ? 'en-route-to-accident' : 'en-route-to-hospital',
        });

        // Wait 1.5s before next step
        await new Promise(r => setTimeout(r, 50));
    }

    // Destination reached
    if (lastGreenSignalId) {
        await db.collection('traffic_signals').doc(lastGreenSignalId).update({
            state: 'red', controlled_by: null
        });
    }

    if (phase === 'to-accident') {
        console.log(`[AMBULANCE ${ambulanceId}] Reached accident. Picking up patient...`);
        await ambRef.update({ status: 'at-accident' });
        await new Promise(r => setTimeout(r, 3000)); // 3s dwell time

        // Now route to hospital
        const hospital = nearest(accidentLocation, HOSPITALS);
        console.log(`[AMBULANCE ${ambulanceId}] Routing to ${hospital.name}...`);
        const hospitalRoute = await getRoute(accidentLocation, hospital);

        await ambRef.update({
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
        await ambRef.update({ status: 'arrived', phase: 'complete' });
    }
}

// --- Main entry: dispatch 2 nearest ambulances to accident ---
async function dispatchAmbulance(accidentData) {
    const accidentLocation = { lat: parseFloat(accidentData.latitude), lng: parseFloat(accidentData.longitude) };

    // Pick 2 nearest bases
    const selectedBases = nearestN(accidentLocation, AMBULANCE_BASES, 2);
    console.log(`[DISPATCH] Sending ${selectedBases.map(b => b.id).join(' + ')} to accident at`, accidentLocation);

    // Seed traffic signals if not already done
    await seedSignals();

    // Dispatch all selected ambulances in parallel
    await Promise.all(selectedBases.map(async (base) => {
        const route = await getRoute({ lat: base.lat, lng: base.lng }, accidentLocation);

        const ambRef = db.collection('ambulances').doc(base.id);
        await ambRef.set({
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
        });

        // Run movement loop non-blocking
        runAmbulanceLoop(base.id, route, 'to-accident', accidentLocation, null)
            .catch(err => console.error(`[AMBULANCE LOOP ERROR ${base.id}]`, err));
    }));
}

module.exports = { dispatchAmbulance };
