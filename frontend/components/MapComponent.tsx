"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from 'react-leaflet';
import { useEffect, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// --- Custom Icons ---

// Green device marker (normal)
const normalIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Red accident marker
const accidentIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Blue ambulance marker
const ambulanceIcon = new L.DivIcon({
    html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚑</div>',
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
});

// Hospital marker
const hospitalIcon = new L.DivIcon({
    html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🏥</div>',
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
});

// --- Types ---
type Location = { lat: number; lng: number; };
interface MapProps {
    center: Location;
    devices: any[];
    ambulances: any[];
    signals: any[];
}

// --- ChangeView: updates map center on prop change ---
function ChangeView({ center, zoom }: { center: Location; zoom: number }) {
    const map = useMap();

    useEffect(() => {
        map.setView([center.lat, center.lng], zoom);
    }, [center.lat, center.lng, map, zoom]);

    // Invalidate size ONCE on mount
    useEffect(() => {
        const t = setTimeout(() => { map.invalidateSize(); }, 200);
        return () => clearTimeout(t);
    }, [map]);

    return null;
}

// --- Main Component ---
export default function MapComponent({ center, devices, ambulances, signals }: MapProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;

    return (
        <div className="absolute inset-0 rounded-lg overflow-hidden border border-slate-700 z-10">
            <MapContainer
                center={[center.lat, center.lng]}
                zoom={14}
                scrollWheelZoom={true}
                style={{ height: '100%', width: '100%' }}
            >
                <ChangeView center={center} zoom={14} />

                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* --- Device Markers --- */}
                {devices.filter(d => d.id !== 'vehicle_001').map((device) => {
                    const lat = device.latest_data?.latitude || device.latitude;
                    const lng = device.latest_data?.longitude || device.longitude;
                    if (!lat || !lng) return null;
                    // Only show on map if GPS fix is real (hide default/fallback location)
                    if (!device.latest_data?.gps_fix) return null;
                    const isAccident = device.latest_data?.is_accident || device.is_accident;
                    const d = device.latest_data;
                    return (
                        <Marker key={device.id} position={[parseFloat(lat), parseFloat(lng)]} icon={isAccident ? accidentIcon : normalIcon}>
                            <Popup>
                                <div className="text-slate-900 min-w-[180px]">
                                    <p className="font-bold text-base">{device.id}</p>
                                    <p className="mt-1">{isAccident ? '🚨 Accident Detected' : '✅ Normal'}</p>
                                    {d && <>
                                        <p className="text-sm mt-1">⚡ Accel: <strong>{parseFloat(d.acceleration || 0).toFixed(2)}g</strong></p>
                                        <p className="text-sm">📐 Tilt: <strong>{parseFloat(d.tilt_angle || 0).toFixed(1)}°</strong></p>
                                        <p className="text-sm">🛰 GPS: <strong>{d.gps_fix ? 'Fixed' : 'Default location'}</strong></p>
                                    </>}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* --- Ambulance Markers + Route Polylines --- */}
                {ambulances.map((amb) => {
                    if (!amb.position) return null;
                    const pos: [number, number] = [amb.position.lat, amb.position.lng];

                    // Build route polyline from Firestore route array
                    const routePoints: [number, number][] = (amb.route || []).map((p: any) => [p.lat, p.lng]);

                    return (
                        <div key={amb.id}>
                            {/* Route line */}
                            {routePoints.length > 1 && (
                                <Polyline
                                    positions={routePoints}
                                    pathOptions={{
                                        color: amb.phase === 'to-hospital' ? '#22d3ee' : '#3b82f6',
                                        weight: 4,
                                        opacity: 0.8,
                                        dashArray: '8 4',
                                    }}
                                />
                            )}
                            {/* Ambulance emoji marker */}
                            <Marker position={pos} icon={ambulanceIcon}>
                                <Popup>
                                    <div className="text-slate-900 min-w-[180px]">
                                        <p className="font-bold text-blue-700">🚑 {amb.id}</p>
                                        <p className="text-sm">{amb.name}</p>
                                        <p className="text-sm mt-1">Status: <strong>{amb.status?.replace(/-/g, ' ')}</strong></p>
                                        {amb.hospitalName && <p className="text-sm">→ {amb.hospitalName}</p>}
                                    </div>
                                </Popup>
                            </Marker>
                            {/* Hospital destination marker */}
                            {amb.hospitalLocation && (
                                <Marker position={[amb.hospitalLocation.lat, amb.hospitalLocation.lng]} icon={hospitalIcon}>
                                    <Popup><div className="text-slate-900"><p className="font-bold">🏥 {amb.hospitalName}</p><p className="text-sm">Destination Hospital</p></div></Popup>
                                </Marker>
                            )}
                        </div>
                    );
                })}

                {/* --- Traffic Signal Markers --- */}
                {signals.map((signal) => {
                    if (!signal.position) return null;
                    const isGreen = signal.state === 'green';
                    return (
                        <Circle
                            key={signal.id}
                            center={[signal.position.lat, signal.position.lng]}
                            radius={isGreen ? 35 : 20}
                            pathOptions={{
                                color: isGreen ? '#22c55e' : '#ef4444',
                                fillColor: isGreen ? '#86efac' : '#fca5a5',
                                fillOpacity: isGreen ? 0.85 : 0.5,
                                weight: isGreen ? 3 : 1,
                            }}
                        >
                            <Popup>
                                <div className="text-slate-900">
                                    <p className="font-bold">{signal.id}</p>
                                    <p>Signal: {isGreen ? '🟢 GREEN (Emergency)' : '🔴 Red'}</p>
                                    {signal.controlled_by && <p className="text-xs text-blue-600">Controlled by: {signal.controlled_by}</p>}
                                </div>
                            </Popup>
                        </Circle>
                    );
                })}

            </MapContainer>
        </div>
    );
}
