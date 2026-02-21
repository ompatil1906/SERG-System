#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <I2Cdev.h>
#include <MPU6050.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <Wire.h>

// =============================================================
// SERG System — ESP32 Firmware
// Flash this to your ESP32 using Arduino IDE
// Board: "ESP32 Dev Module"
// Required Libraries: MPU6050 (by Electronic Cats / jrowberg),
//                     TinyGPS++, WiFi, HTTPClient
// =============================================================
// !! Library change: uses jrowberg MPU6050 (clone-compatible)
// !! Install via Library Manager: "MPU6050" by Electronic Cats

// --- !! CONFIGURE THESE BEFORE FLASHING !! ---
const char *ssid = "Atharvs24";    // Your Wi-Fi name
const char *password = "12344321"; // Your Wi-Fi password

// Backend IP = your laptop's local IP on the same Wi-Fi network
// Run: `ipconfig getifaddr en0` on Mac  OR  `hostname -I` on Linux
// !! UPDATE THIS IP if you get Error -11 (Connection Refused) !!
const char *serverName = "http://10.125.252.77:5000/api/device-data";

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
MPU6050 mpu; // jrowberg library — works with clone chips
TinyGPSPlus gps;
HardwareSerial SerialGPS(1); // Using UART1 for GPS: RX=16, TX=17

// --- Timing ---
unsigned long lastTime = 0;
unsigned long timerDelay = 1000; // Send payload every 1 second

// --- Variables ---
bool emergencyButtonPressed = false;
bool mpuReady = false; // Set true only if MPU6050 initializes successfully

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
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi '");
  Serial.print(ssid);
  Serial.print("'...");
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 40) {
    delay(500);
    Serial.print(".");
    retryCount++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[ERROR] WiFi connection FAILED.");
    Serial.println("Check: 1) SSID/password correct? 2) Hotspot is 2.4GHz "
                   "(ESP32 doesn't support 5GHz).");
  }

  Serial.print("ESP IP: ");
  Serial.println(WiFi.localIP());
  // Initialize MPU6050 — I²C on SDA=GPIO21, SCL=GPIO22 (ESP32 default)
  Wire.begin(21, 22);
  Wire.setClock(100000);
  delay(2000); // Give MPU time to fully power up

  // --- I²C Bus Scanner ---
  Serial.println("Scanning I2C bus...");
  int devCount = 0;
  for (byte addr = 0x03; addr < 0x78; addr++) {
    Wire.beginTransmission(addr);
    byte err = Wire.endTransmission();
    if (err == 0) {
      Serial.print("  I2C device found at 0x");
      if (addr < 16)
        Serial.print("0");
      Serial.println(addr, HEX);
      devCount++;
    }
  }
  if (devCount == 0)
    Serial.println("  [!!] No I2C devices found! Check SDA/SCL/VCC wiring.");
  else
    Serial.println("  I2C scan done.");

  // jrowberg MPU6050 library — initialize and test connection
  Serial.println("Initializing MPU6050...");
  mpu.initialize();
  if (mpu.testConnection()) {
    mpuReady = true;
    Serial.println("MPU6050 Initialized Successfully!");
    // Set ±8g range: sensitivity = 4096 LSB/g
    mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_8);
  } else {
    Serial.println(
        "MPU6050 testConnection() FAILED. Clone chip — forcing init anyway.");
    // Force-initialize anyway (clone chips often fail testConnection but work)
    mpuReady = true;
    mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_8);
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
    // Check WiFi Connection — full reconnect if dropped
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Disconnected. Reconnecting to '" + String(ssid) +
                     "'...");
      WiFi.disconnect();
      delay(1000);
      WiFi.begin(ssid, password);
      int wait = 0;
      while (WiFi.status() != WL_CONNECTED && wait < 20) {
        delay(500);
        Serial.print(".");
        wait++;
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] Reconnected! IP: " +
                       WiFi.localIP().toString());
      } else {
        Serial.println("\n[WiFi] Still disconnected. Will retry next cycle.");
        lastTime = millis(); // don't spam retries
        return;
      }
    }

    // Read MPU6050 (only if sensor initialized successfully)
    float magnitude = 0.0;
    float tilt_angle = 0.0;
    if (mpuReady) {
      int16_t ax, ay, az;
      mpu.getAcceleration(&ax, &ay, &az);

      // Convert raw int16_t to g-units
      // At ±8g range: sensitivity = 4096 LSB/g
      float accelX = ax / 4096.0;
      float accelY = ay / 4096.0;
      float accelZ = az / 4096.0;
      magnitude = sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);

      // Tilt angle from Z axis (flat = ~1g on Z = 0°, sideways = 90°)
      float z_g_clamped = constrain(accelZ, -1.0, 1.0);
      tilt_angle = acos(z_g_clamped) * 180.0 / PI;

      Serial.print("Accel (g): X=");
      Serial.print(accelX, 2);
      Serial.print(" Y=");
      Serial.print(accelY, 2);
      Serial.print(" Z=");
      Serial.print(accelZ, 2);
      Serial.print(" | Magnitude=");
      Serial.println(magnitude, 3);
    } else {
      Serial.println("[WARN] MPU6050 not ready — skipping sensor read.");
    }

    // Get GPS Data — fallback to AISSMS IOIT if no satellite fix
    float lat = gps.location.isValid() ? gps.location.lat() : DEFAULT_LAT;
    float lng = gps.location.isValid() ? gps.location.lng() : DEFAULT_LNG;
    bool hasGPS = gps.location.isValid();

    if (!hasGPS) {
      Serial.println("[GPS] AISSMS IOIT location.");
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
    http.setTimeout(
        10000); // 10s timeout (default 5s was too short for Firebase)

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