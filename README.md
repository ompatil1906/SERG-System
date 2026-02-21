# Smart Emergency Response System (SERG)

A complete real-time accident detection and emergency alert system using ESP32 hardware and a complete modern software stack.

## System Architecture

**Hardware (ESP32)** -> **Cloud API (Node.js)** -> **Firebase** -> **Alerts & Dashboard**

## Folder Structure

- `/firmware`: C++ Arduino code for ESP32 with MPU6050 and GPS.
- `/backend`: Node.js Express server to handle incoming data, run detection logic, and trigger alerts.
- `/frontend`: Next.js web application for the real-time monitoring dashboard.
- `/tests`: API and unit tests.
- `/docs`: Documentation and deployment guides.

## Setup Instructions

Please see the `README.md` within `/backend` and `/frontend` for specific technology setup instructions.
