"use client";

import dynamic from 'next/dynamic';

type Location = { lat: number; lng: number; };

interface MapProps {
    center: Location;
    devices: any[];
    ambulances: any[];
    signals: any[];
}

const MapComponent = dynamic(() => import('./MapComponent'), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-slate-900 rounded-lg animate-pulse flex items-center justify-center text-slate-500">Loading Map...</div>
});

export default function Map({ center, devices, ambulances, signals }: MapProps) {
    return <MapComponent center={center} devices={devices} ambulances={ambulances} signals={signals} />;
}
