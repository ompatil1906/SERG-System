# Deployment Guide - SERG System

This guide outlines how to deploy the entire stack to production.

## 1. Firebase Setup (Database & Realtime)
1. Go to Firebase Console -> Add Project.
2. Enable **Firestore**.
3. Go to **Project Settings -> Service Accounts**, generate a new private key JSON file.
4. Set up the environment variables for the backend: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` (ensure newlines are preserved, e.g., using `"` or replacing literal `\n` in code).
5. Deploy `firestore.rules` using Firebase CLI:
   `firebase deploy --only firestore:rules`

## 2. Backend (Node.js) -> Railway / Render
1. Ensure the `Dockerfile` is at the root of the `/backend` directory.
2. Push your code to GitHub.
3. Link the GitHub repository to your Render or Railway dashboard.
4. Set the Root Directory to `/backend`.
5. Add all Environment Variables (`PORT`, `FIREBASE_*`, `TWILIO_*`, `SMTP_*`, `JWT_SECRET`).
6. Deploy the service. Take note of the public URL (e.g., `https://serg-backend.up.railway.app`).

## 3. Frontend (Next.js) -> Vercel
1. Import the GitHub repository into Vercel.
2. Set the Root Directory to `/frontend`.
3. Add Environment Variables from `.env.local.example` to Vercel Settings.
4. Deploy the Next.js app.

## 4. Hardware (ESP32) -> Field
1. Update `serverName` in `firmware.ino` string to point to the new Production Backend URL:
   `const char* serverName = "https://serg-backend.up.railway.app/api/device-data";`
2. Update `ssid` and `password` or use a WiFiManager to allow users to connect to their own hotspot.
3. Flash the code onto the ESP32 using Arduino IDE.
4. Provide power (e.g., to a vehicle battery or 5V Power Bank).

## 5. End-to-End Testing
1. Turn on ESP32 in a vehicle.
2. Monitor real-time logs on the `/frontend` Dashboard.
3. Tilt the ESP32 > 60 degrees.
4. A red blip should appear instantly on the dashboard, combined with an Alert on the left panel, and you should receive an email/SMS.
