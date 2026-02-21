#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <Wire.h>

// =============================================================
// SERG System — ESP32 Firmware
// Flash this to your ESP32 using Arduino IDE
// Board: "ESP32 Dev Module"
// Required Libraries: Adafruit MPU6050, Adafruit Unified Sensor,
//                     TinyGPS++, WiFi, HTTPClient
// =============================================================

// --- !! CONFIGURE THESE BEFORE FLASHING !! ---
const char *ssid = "Atharv24";     // Your Wi-Fi name
const char *password = "12344321"; // Your Wi-Fi password

// Backend IP = your laptop's local IP on the same Wi-Fi network
// Run: `ipconfig getifaddr en0` on Mac  OR  `hostname -I` on Linux
const char *serverName = "http://172.24.65.162:5000/api/device-data";

// Default GPS location — AISSMS Institute of Information Technology, Pune
const float DEFAULT_LAT = 18.5158;
const float DEFAULT_LNG = 73.8463;

// Device ID — must be unique per vehicle
const String deviceID = "vehicle_esp32_001";

// --- Hardware Pins ---
const int BUTTON_PIN = 18;
const int BUZZER_PIN = 19;
const int LED_PIN = 5;

// --- Modules ---
Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial SerialGPS(1); // Using UART1 for GPS: RX=16, TX=17

// --- Timing ---
unsigned long lastTime = 0;
unsigned long timerDelay = 1000; // Send payload every 1 second

// --- Variables ---
bool emergencyButtonPressed = false;

void setup() {
  Serial.begin(115200);

  // Initialize Pins
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  // Turn off buzzer/LED initially
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  // Initialize WiFi
  WiFi.begin(ssid, password);
  Serial.println("Connecting to WiFi...");
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 20) {
    delay(500);
    Serial.print(".");
    retryCount++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected.");
  } else {
    Serial.println("\nWiFi connection failed. Will retry later.");
  }

  // Initialize MPU6050
  if (!mpu.begin()) {
    Serial.println("Failed to find MPU6050 chip");
    // Don't halt, we might still send GPS or Button data
  } else {
    Serial.println("MPU6050 Found!");
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  // Initialize GPS (Serial1 on ESP32 default pins: RX=9, TX=10. We use custom
  // 16, 17)
  SerialGPS.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("GPS Serial Initialized.");
}

void loop() {
  // 1. Read GPS data from Serial asynchronously
  while (SerialGPS.available() > 0) {
    gps.encode(SerialGPS.read());
  }

  // 2. Read Button State (Active Low due to INPUT_PULLUP)
  if (digitalRead(BUTTON_PIN) == LOW) {
    emergencyButtonPressed = true;
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
  }

  // 3. Main 1-second Loop Execution
  if ((millis() - lastTime) > timerDelay) {
    // Check WiFi Connection
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi Disconnected. Reconnecting...");
      WiFi.reconnect();
      return; // Skip this iteration until connected
    }

    // Read MPU6050
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    // Calculate total acceleration magnitude (g)
    // a.acceleration is in m/s^2. 1g = 9.81 m/s^2.
    float accelX = a.acceleration.x / 9.81;
    float accelY = a.acceleration.y / 9.81;
    float accelZ = a.acceleration.z / 9.81;
    float magnitude = sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);

    // Calculate Tilt Angle Approximation from Z axis (0 to 90 degrees)
    // When perfectly flat, accelZ holds ~1g.
    float z_g_clamped = constrain(accelZ, -1.0, 1.0);
    float tilt_angle = acos(z_g_clamped) * 180.0 / PI;

    // Get GPS Data — fallback to AISSMS IOIT if no satellite fix
    float lat = gps.location.isValid() ? gps.location.lat() : DEFAULT_LAT;
    float lng = gps.location.isValid() ? gps.location.lng() : DEFAULT_LNG;
    bool hasGPS = gps.location.isValid();

    if (!hasGPS) {
      Serial.println("[GPS] No fix — using AISSMS IOIT location as default.");
    }

    // Construct JSON Payload
    String payload = "{";
    payload += "\"device_id\":\"" + deviceID + "\",";
    payload += "\"timestamp\":\"" + String(millis()) + "\",";
    payload += "\"acceleration\":" + String(magnitude, 3) + ",";
    payload += "\"tilt_angle\":" + String(tilt_angle, 2) + ",";
    payload += "\"latitude\":" + String(lat, 6) + ",";
    payload += "\"longitude\":" + String(lng, 6) + ",";
    payload += "\"emergency_button\":" +
               String(emergencyButtonPressed ? "true" : "false") + ",";
    payload += "\"gps_fix\":" + String(hasGPS ? "true" : "false");
    payload += "}";

    // Print to Serial for debugging
    Serial.println("Payload: " + payload);

    // Send HTTP POST
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);

      if (httpResponseCode == 200 || httpResponseCode == 201) {
        // Successfully sent, reset emergency button if needed
        // We might wait for an explicit OK to turn off buzzer, but for now we
        // reset here.
        emergencyButtonPressed = false;
        digitalWrite(LED_PIN, LOW);
        digitalWrite(BUZZER_PIN, LOW);
      }
    } else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }

    http.end(); // Free resources
    lastTime = millis();
  }
}
