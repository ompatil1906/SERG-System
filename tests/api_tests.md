# SERG API Testing Guide & Postman Requests

## 1. Post Device Data (Simulate ESP32)
**POST** `http://localhost:3000/api/device-data`
**Headers:** `Content-Type: application/json`

**Body (Normal - No Accident):**
```json
{
  "device_id": "vehicle_001",
  "timestamp": "1678886400000",
  "acceleration": 1.2,
  "tilt_angle": 15.0,
  "latitude": 37.7749,
  "longitude": -122.4194,
  "emergency_button": false
}
```

**Body (Accident - High Impact):**
```json
{
  "device_id": "vehicle_001",
  "timestamp": "1678886405000",
  "acceleration": 4.5,
  "tilt_angle": 15.0,
  "latitude": 37.7749,
  "longitude": -122.4194,
  "emergency_button": false
}
```

## 2. Get Live Devices
**GET** `http://localhost:3000/api/live-devices`
**Headers:** `Authorization: Bearer <JWT_TOKEN>`

## 3. Get Recent Alerts
**GET** `http://localhost:3000/api/alerts`
**Headers:** `Authorization: Bearer <JWT_TOKEN>`

## 4. Admin Login
**POST** `http://localhost:3000/api/auth/login`
**Headers:** `Content-Type: application/json`
**Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```
