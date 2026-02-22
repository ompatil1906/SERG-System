"use client";

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, limit, writeBatch, getDocs, doc } from 'firebase/firestore';
import Map from '@/components/Map';
import { AlertTriangle, Activity, MapPin, Clock, Zap, Gauge } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
    const [devices, setDevices] = useState<any[]>([]);
    const [liveDevices, setLiveDevices] = useState<any[]>([]); // Polled from backend (no Firestore quota)
    const [alerts, setAlerts] = useState<any[]>([]);
    const [ambulances, setAmbulances] = useState<any[]>([]);
    const [liveAmbulances, setLiveAmbulances] = useState<any[]>([]);
    const [livePolice, setLivePolice] = useState<any[]>([]);
    const [signals, setSignals] = useState<any[]>([]);
    const [liveSignals, setLiveSignals] = useState<any[]>([]);
    const [center] = useState({ lat: 18.5315, lng: 73.8670 });

    // Poll backend /api/live-data every 2s (bypasses Firestore quota limits)
    useEffect(() => {
        const fetchLive = async () => {
            try {
                const res = await fetch('http://10.125.252.77:5000/api/live-data');
                const json = await res.json();
                if (json.devices) setLiveDevices(json.devices);
                if (json.ambulances) setLiveAmbulances(json.ambulances);
                if (json.police) setLivePolice(json.police);
                if (json.signals) setLiveSignals(json.signals);
            } catch (_) { /* backend not reachable, keep showing last known state */ }
        };
        fetchLive();
        const interval = setInterval(fetchLive, 2000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const unsubDevices = onSnapshot(collection(db, 'devices'), (snapshot) => {
            setDevices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const qAlerts = query(collection(db, 'alerts'), orderBy('timestamp', 'desc'), limit(15));
        const unsubAlerts = onSnapshot(qAlerts, (snapshot) => {
            setAlerts(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubAmbulances = onSnapshot(collection(db, 'ambulances'), (snapshot) => {
            setAmbulances(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubSignals = onSnapshot(collection(db, 'traffic_signals'), (snapshot) => {
            setSignals(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => { unsubDevices(); unsubAlerts(); unsubAmbulances(); unsubSignals(); };
    }, []);

    const clearAlerts = async () => {
        const snapshot = await getDocs(collection(db, 'alerts'));
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(doc(db, 'alerts', d.id)));
        await batch.commit();
    };

    const resetSystem = async () => {
        if (!confirm('Reset the entire system? This clears all alerts, ambulances, traffic signals and device locations.')) return;
        const [alertSnap, ambSnap, signalSnap, deviceSnap] = await Promise.all([
            getDocs(collection(db, 'alerts')),
            getDocs(collection(db, 'ambulances')),
            getDocs(collection(db, 'traffic_signals')),
            getDocs(collection(db, 'devices')),
        ]);
        const batch = writeBatch(db);
        alertSnap.docs.forEach(d => batch.delete(doc(db, 'alerts', d.id)));
        ambSnap.docs.forEach(d => batch.delete(doc(db, 'ambulances', d.id)));
        signalSnap.docs.forEach(d => batch.update(doc(db, 'traffic_signals', d.id), { state: 'red', controlled_by: null }));
        deviceSnap.docs.forEach(d => batch.update(doc(db, 'devices', d.id), {
            status: 'Online',
            latest_data: null,   // clears location marker from map
        }));
        await batch.commit();
    };

    // --- Merging logic (Bypasses Firestore quota issues) ---
    const mergedDevices = [...devices];
    liveDevices.forEach(ld => {
        const index = mergedDevices.findIndex(d => d.id === ld.id);
        if (index > -1) {
            mergedDevices[index] = { ...mergedDevices[index], ...ld };
        } else {
            mergedDevices.push(ld);
        }
    });

    const mergedAmbulances = [...ambulances];
    liveAmbulances.forEach(la => {
        const index = mergedAmbulances.findIndex(a => a.id === la.id);
        if (index > -1) {
            mergedAmbulances[index] = { ...mergedAmbulances[index], ...la };
        } else {
            mergedAmbulances.push(la);
        }
    });

    const mergedSignals = [...signals];
    liveSignals.forEach(ls => {
        const index = mergedSignals.findIndex(s => s.id === ls.id);
        if (index > -1) {
            mergedSignals[index] = { ...mergedSignals[index], ...ls };
        } else {
            mergedSignals.push(ls);
        }
    });

    const activeLiveAlerts = liveDevices
        .filter(d => d.latest_data?.is_accident)
        .map(d => ({
            id: `live-${d.id}`,
            device_id: d.id,
            timestamp: d.latest_data.server_timestamp || Date.now(),
            location: { lat: d.latest_data.latitude || 18.5315, lng: d.latest_data.longitude || 73.8670 },
            severity: d.latest_data.severity || 'CRITICAL',
            triggers: ['Live Telemetry (ESP32)']
        }));

    // Simple deduplication - prioritize live alerts
    const mergedAlerts = [...activeLiveAlerts, ...alerts.filter(a => !activeLiveAlerts.find(la => la.device_id === a.device_id))];

    return (
        <div className="flex h-screen bg-slate-950 p-4 gap-4 overflow-hidden">
            {/* Side Panel */}
            <div className="w-1/3 flex flex-col gap-4">
                {/* Alerts */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 overflow-auto">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2 text-red-500">
                            <AlertTriangle className="w-5 h-5" /> Active Alerts
                        </h2>
                        {mergedAlerts.length > 0 && (
                            <button onClick={clearAlerts} className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-red-900/50 text-slate-300 hover:text-red-300 border border-slate-600 hover:border-red-700 rounded-lg transition-colors">
                                Clear All
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">
                        {mergedAlerts.length === 0 ? (
                            <p className="text-slate-500 italic text-sm">No recent alerts</p>
                        ) : mergedAlerts.map(alert => (
                            <div key={alert.id} className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-red-400">{alert.device_id}</span>
                                    <span className="text-xs text-red-300 font-mono px-2 py-1 bg-red-900/40 rounded">{alert.severity}</span>
                                </div>
                                <div className="text-sm text-slate-300">
                                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {parseFloat(alert.location.lat).toFixed(4)}, {parseFloat(alert.location.lng).toFixed(4)}</span>
                                    <span className="flex items-center gap-1 mt-1"><Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}</span>
                                    {alert.triggers && <span className="block mt-1 text-red-300 text-xs">Triggers: {alert.triggers.join(', ')}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Live Telemetry — ESP32 Sensor Data */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-auto">
                    <h2 className="text-lg font-bold mb-3 flex items-center gap-2 text-cyan-400">
                        <Zap className="w-4 h-4 animate-pulse" /> Live Telemetry
                    </h2>
                    {liveDevices.length === 0 ? (
                        <p className="text-slate-500 italic text-sm">Waiting for ESP32 data… (is backend running?)</p>
                    ) : liveDevices.map(device => {
                        const d = device.latest_data;
                        if (!d) return (
                            <div key={device.id} className="text-slate-500 text-sm italic">
                                {device.id} — awaiting first payload…
                            </div>
                        );
                        const accel = parseFloat(d.acceleration || 0);
                        const tilt = parseFloat(d.tilt_angle || 0);
                        const accelPct = Math.min((accel / 6) * 100, 100);
                        const accelColor = accel > 3 ? 'bg-red-500' : accel > 1.5 ? 'bg-yellow-400' : 'bg-emerald-400';
                        const accelText = accel > 3 ? 'text-red-400' : accel > 1.5 ? 'text-yellow-400' : 'text-emerald-400';
                        return (
                            <div key={device.id} className="mb-3 last:mb-0">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-mono text-sm text-slate-200">{device.id}</span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${d.is_accident ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                        {d.is_accident ? '🚨 ACCIDENT' : '✅ NORMAL'}
                                    </span>
                                </div>
                                {/* Acceleration Bar */}
                                <div className="mb-2">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-slate-400 flex items-center gap-1"><Gauge className="w-3 h-3" /> Acceleration</span>
                                        <span className={`font-mono font-bold ${accelText}`}>{accel.toFixed(2)}g</span>
                                    </div>
                                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full transition-all duration-500 ${accelColor}`}
                                            style={{ width: `${accelPct}%` }} />
                                    </div>
                                </div>
                                {/* Stats Row */}
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div className="bg-slate-800 rounded p-2 text-center">
                                        <div className="text-slate-400">Tilt</div>
                                        <div className="text-slate-200 font-mono font-bold">{tilt.toFixed(1)}°</div>
                                    </div>
                                    {d.gps_fix && (
                                        <div className="bg-slate-800 rounded p-2 text-center">
                                            <div className="text-slate-400">GPS</div>
                                            <div className="font-bold text-emerald-400">🛰 Fixed</div>
                                        </div>
                                    )}
                                    <div className="bg-slate-800 rounded p-2 text-center">
                                        <div className="text-slate-400">Seen</div>
                                        <div className="text-slate-200 font-mono" style={{ fontSize: '10px' }}>
                                            {formatDistanceToNow(new Date(d.server_timestamp || Date.now()), { addSuffix: true })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Hospital Destination Banner — shown when ambulance is going to / arrived at hospital */}
                {mergedAmbulances.some(a => a.phase === 'to-hospital' || a.status === 'arrived') && (() => {
                    const amb = mergedAmbulances.find(a => a.phase === 'to-hospital' || a.status === 'arrived');
                    const isArrived = amb?.status === 'arrived';
                    return (
                        <div className={`rounded-xl p-4 border-2 relative overflow-hidden ${isArrived
                                ? 'bg-emerald-950/60 border-emerald-500/70'
                                : 'bg-cyan-950/60 border-cyan-500/70'
                            }`}>
                            {/* Pulse ring */}
                            {!isArrived && (
                                <span className="absolute top-3 right-3 flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                                </span>
                            )}
                            <div className="flex items-center gap-3">
                                <div className="text-5xl leading-none drop-shadow-lg">🏥</div>
                                <div>
                                    <div className={`text-xs font-bold uppercase tracking-widest mb-0.5 ${isArrived ? 'text-emerald-400' : 'text-cyan-400'
                                        }`}>
                                        {isArrived ? '✅ Patient Delivered' : '🔴 Ambulance En Route'}
                                    </div>
                                    <div className="text-white font-black text-lg leading-tight">
                                        {amb?.hospitalName || 'Hospital'}
                                    </div>
                                    <div className="text-xs text-slate-300 mt-0.5">
                                        {isArrived ? 'Mission complete — patient at hospital' : `${amb?.id} heading to hospital`}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Ambulance Status */}
                {mergedAmbulances.length > 0 && (
                    <div className="bg-slate-900 border border-blue-900/50 rounded-xl p-4 overflow-auto">
                        <h2 className="text-lg font-bold mb-3 text-blue-400">🚑 Ambulance Fleet</h2>
                        <div className="space-y-2">
                            {mergedAmbulances.map(amb => (
                                <div key={amb.id} className="flex justify-between items-center p-2 rounded bg-blue-950/30 border border-blue-900/30">
                                    <div>
                                        <div className="font-mono text-sm text-blue-200">{amb.id}</div>
                                        <div className="text-xs text-slate-400">{amb.name}</div>
                                    </div>
                                    <div className={`px-2 py-1 rounded text-xs font-semibold ${amb.status === 'arrived' ? 'bg-emerald-500/20 text-emerald-400' :
                                        amb.status === 'at-accident' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-blue-500/20 text-blue-400'
                                        }`}>
                                        {amb.status?.replace(/-/g, ' ').toUpperCase()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Device Fleet */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 h-1/3 overflow-auto">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-emerald-400">
                        <Activity className="w-5 h-5" /> Device Fleet
                    </h2>
                    <div className="space-y-2">
                        {mergedDevices.map(device => {
                            const isAccident = device.latest_data?.is_accident;
                            return (
                                <div key={device.id} className="flex justify-between items-center p-2 rounded hover:bg-slate-800/50 transition-colors">
                                    <div className="font-mono text-sm">{device.id}</div>
                                    <div className={`px-2 py-1 rounded text-xs font-semibold ${isAccident ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                                        {isAccident ? 'CRITICAL' : 'ONLINE'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Main Panel */}
            <div className="flex-1 flex flex-col gap-4">
                <header className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 tracking-tight">SERG Control Center</h1>
                        <p className="text-slate-400 mt-1">Smart Emergency Response System</p>
                    </div>
                    <div className="flex gap-6 text-center">
                        <div>
                            <div className="text-3xl font-light text-slate-200">{mergedDevices.length}</div>
                            <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Active Devices</div>
                        </div>
                        <div>
                            <div className="text-3xl font-light text-blue-400">{mergedAmbulances.filter(a => a.status !== 'arrived').length}</div>
                            <div className="text-xs text-blue-500/70 uppercase font-bold tracking-wider">Ambulances Active</div>
                        </div>
                        <div>
                            <div className="text-3xl font-light text-red-400">{mergedAlerts.length}</div>
                            <div className="text-xs text-red-500/70 uppercase font-bold tracking-wider">Total Alerts</div>
                        </div>
                        <div className="flex items-center">
                            <button
                                onClick={resetSystem}
                                className="px-4 py-2 bg-slate-700 hover:bg-red-900/60 text-slate-300 hover:text-red-300 border border-slate-600 hover:border-red-700 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2"
                            >
                                🔄 Reset System
                            </button>
                        </div>
                    </div>
                </header>

                <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 relative overflow-hidden shadow-2xl">
                    <Map center={center} devices={mergedDevices} ambulances={mergedAmbulances} police={livePolice} signals={mergedSignals} />
                </div>
            </div>
        </div>
    );
}
