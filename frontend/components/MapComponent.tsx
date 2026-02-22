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

// Hospital marker — default (small, used when ambulance is not yet heading there)
const hospitalIcon = new L.DivIcon({
    html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🏥</div>',
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
});

// Hospital marker — active (large + glowing cyan when ambulance is en-route-to-hospital)
const hospitalActiveIcon = new L.DivIcon({
    html: `<div style="
        font-size:42px;
        line-height:1;
        filter:drop-shadow(0 0 12px rgba(34,211,238,0.95)) drop-shadow(0 2px 6px rgba(0,0,0,0.8));
        animation:hospital-pulse 1.2s ease-in-out infinite;
    ">🏥</div>
    <style>
        @keyframes hospital-pulse {
            0%,100%{transform:scale(1);}
            50%{transform:scale(1.18);}
        }
    </style>`,
    className: '',
    iconSize: [52, 52],
    iconAnchor: [26, 26],
});

// Hospital marker — arrived (large green checkmark overlay)
const hospitalArrivedIcon = new L.DivIcon({
    html: `<div style="position:relative;display:inline-block;font-size:40px;line-height:1;filter:drop-shadow(0 0 10px rgba(34,197,94,0.9)) drop-shadow(0 2px 6px rgba(0,0,0,0.8))">
        🏥
        <span style="position:absolute;bottom:-4px;right:-4px;font-size:18px;">✅</span>
    </div>`,
    className: '',
    iconSize: [52, 52],
    iconAnchor: [26, 26],
});

// Police marker
const policeIcon = new L.DivIcon({
    html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚓</div>',
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
});

// --- Types ---
type Location = { lat: number; lng: number; };
interface MapProps {
    center: Location;
    devices: any[];
    ambulances: any[];
    police: any[];
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
export default function MapComponent({ center, devices, ambulances, police, signals }: MapProps) {
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
                    let lat = device.latest_data?.latitude || device.latitude;
                    let lng = device.latest_data?.longitude || device.longitude;

                    // Force Raja Bahadur Mill location if GPS has no fix (overrides stale Deccan cache)
                    if (device.latest_data && !device.latest_data.gps_fix) {
                        lat = 18.5315;
                        lng = 73.8670;
                    }

                    if (!lat || !lng) return null;
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
                                        <p className="text-sm">🛰 GPS: <strong>{d.gps_fix ? 'Fixed' : 'AISSMS'}</strong></p>
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
                            {/* Hospital destination marker — animated when ambulance is heading there */}
                            {amb.hospitalLocation && (() => {
                                const icon = amb.status === 'arrived'
                                    ? hospitalArrivedIcon
                                    : amb.phase === 'to-hospital'
                                        ? hospitalActiveIcon
                                        : hospitalIcon;
                                return (
                                    <Marker position={[amb.hospitalLocation.lat, amb.hospitalLocation.lng]} icon={icon}>
                                        <Popup>
                                            <div className="text-slate-900 min-w-[160px]">
                                                <p className="font-bold text-base">🏥 {amb.hospitalName}</p>
                                                <p className="text-sm mt-1">
                                                    {amb.status === 'arrived'
                                                        ? '✅ Patient Delivered'
                                                        : amb.phase === 'to-hospital'
                                                            ? '🔴 Ambulance En Route Here'
                                                            : 'Destination Hospital'}
                                                </p>
                                                {amb.id && <p className="text-xs text-blue-600 mt-1">{amb.id}</p>}
                                            </div>
                                        </Popup>
                                    </Marker>
                                );
                            })()}
                        </div>
                    );
                })}

                {/* --- Police Markers + Route Polylines --- */}
                {police.map((pol) => {
                    if (!pol.position) return null;
                    const pos: [number, number] = [pol.position.lat, pol.position.lng];
                    const routePoints: [number, number][] = (pol.route || []).map((p: any) => [p.lat, p.lng]);

                    return (
                        <div key={pol.id}>
                            {routePoints.length > 1 && (
                                <Polyline
                                    positions={routePoints}
                                    pathOptions={{
                                        color: '#1e3a8a', // Dark blue
                                        weight: 4,
                                        opacity: 0.8,
                                        dashArray: '4 8',
                                    }}
                                />
                            )}
                            <Marker position={pos} icon={policeIcon}>
                                <Popup>
                                    <div className="text-slate-900 min-w-[180px]">
                                        <p className="font-bold text-blue-900">🚓 {pol.id}</p>
                                        <p className="text-sm">{pol.name}</p>
                                        <p className="text-sm mt-1">Status: <strong>{pol.status?.replace(/-/g, ' ')}</strong></p>
                                    </div>
                                </Popup>
                            </Marker>
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
