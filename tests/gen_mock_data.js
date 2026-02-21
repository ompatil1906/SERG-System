/**
 * gen_mock_data.js
 * Script to generate simulated ESP32 device data directly bypassing hardware
 */

const axios = require('axios');

const API_URL = 'http://localhost:5000/api/device-data';

// Default location: AISSMS Institute of Information Technology, Pune
const BASE_LAT = 18.5158;
const BASE_LNG = 73.8463;

const simulateAccident = async () => {
    const payload = {
        device_id: "vehicle_002",
        timestamp: Date.now().toString(),
        acceleration: 4.2, // > 3g will trigger accident
        tilt_angle: 80.0,  // > 60 deg will trigger accident
        latitude: BASE_LAT + (Math.random() - 0.5) * 0.002,
        longitude: BASE_LNG + (Math.random() - 0.5) * 0.002,
        emergency_button: false
    };

    try {
        const res = await axios.post(API_URL, payload);
        console.log('Successfully posted mock accident:', res.data);
    } catch (error) {
        console.error('API Error:', error.message);
    }
};

const simulateNormal = async () => {
    const payload = {
        device_id: "vehicle_001",
        timestamp: Date.now().toString(),
        acceleration: 1.0,
        tilt_angle: 10.0,
        latitude: BASE_LAT + (Math.random() - 0.5) * 0.002,
        longitude: BASE_LNG + (Math.random() - 0.5) * 0.002,
        emergency_button: false
    };

    try {
        const res = await axios.post(API_URL, payload);
        console.log('Successfully posted normal telemetry:', res.data);
    } catch (error) {
        console.error('API Error:', error.message);
    }
};

console.log("Mock data simulator started. Press Ctrl+C to exit.");

// Simulate normal data just once instead of continuously
simulateNormal();

// Simulate one accident after 5 seconds
setTimeout(() => {
    console.log("TRIGGERING ACCIDENT SIMULATION...");
    simulateAccident();
}, 5000);
