/*
  Smart Oil Tracker Demo - UAS Version
  Arduino Uno R4 WiFi + HX711 + GPS NEO-6M + MQTT
*/

#include <HX711.h>
#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

// ===== TAMBAHAN UNTUK MQTT =====
#include <WiFiS3.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
// ================================

#define HX711_DT_PIN   3
#define HX711_SCK_PIN  2

#define GPS_RX_PIN     11
#define GPS_TX_PIN     10
#define GPS_BAUD       9600

HX711 scale;
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;

float calibration_factor = 100.0;

// ===== Moving Average Config =====
const int FILTER_SAMPLES = 10;
float buffer[FILTER_SAMPLES];
int idx = 0;
bool filled = false;

float movingAverage(float v) {
  buffer[idx++] = v;
  if (idx >= FILTER_SAMPLES) { idx = 0; filled = true; }
  int n = filled ? FILTER_SAMPLES : idx;
  float s = 0;
  for (int i = 0; i < n; i++) s += buffer[i];
  if (n == 0) return v;
  return s / n;
}

// ===== Timers & Weight Tracking =====
unsigned long displayTimer = 0;
float lastWeight = 0;

// ===== Anti-Theft Logic =====
float baselineWeight = 0;
bool baselineLocked = false;
unsigned long stableWindowTimer = 0;
unsigned long thiefTimer = 0;
bool isAlertTriggered = false;
const float THIEF_THRESHOLD = 0.15;

// ===== Simulation Overriding =====
float speedSimulasi = 0.0;
bool useGPSFisik = false;

// ================================================================
// KONFIGURASI WIFI & MQTT — Sesuaikan dengan kondisi Anda
// ================================================================
const char* WIFI_SSID     = "iPhone 100 pro max";       // Ganti ini
const char* WIFI_PASSWORD = "87654321";   // Ganti ini

// Jalankan di Terminal Mac: ifconfig | grep "inet " | grep -v 127.0.0.1
const char* MQTT_SERVER   = "172.20.10.10";       // Ganti dengan IP Mac Anda
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "smartoil/sensor";
const char* DEVICE_ID     = "UNO001";             // Harus ada di tabel devices

// Interval kirim data MQTT (ms) — terpisah dari timer display 1 detik
const long MQTT_INTERVAL = 5000;
unsigned long mqttSendTimer = 0;
// ================================================================

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// -----------------------------------------------
void connectWiFi() {
  Serial.print("\n[WiFi] Menghubungkan ke: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    Serial.print(".");
    attempt++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] ✓ Terhubung!");
    Serial.print("[WiFi] IP Arduino : ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] ✗ Gagal terhubung. Lanjut tanpa WiFi.");
  }
}

// -----------------------------------------------
void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return; // Skip jika WiFi tidak ada

  int attempt = 0;
  while (!mqttClient.connected() && attempt < 3) {
    Serial.print("[MQTT] Menghubungkan ke broker...");
    if (mqttClient.connect(DEVICE_ID)) {
      Serial.println(" ✓ Terhubung!");
    } else {
      Serial.print(" ✗ Gagal (rc=");
      Serial.print(mqttClient.state());
      Serial.println("), coba lagi...");
      delay(2000);
      attempt++;
    }
  }
}

// -----------------------------------------------
void publishData(float berat, float speed, double lat, double lng) {
  if (!mqttClient.connected()) return; // Skip jika MQTT tidak aktif

  StaticJsonDocument<200> doc;
  doc["device_id"] = DEVICE_ID;
  doc["weight"]    = berat;
  doc["latitude"]  = lat;
  doc["longitude"] = lng;

  // Field tambahan untuk informasi dashboard
  doc["speed"]     = speed;
  doc["alert"]     = isAlertTriggered;

  char payload[200];
  serializeJson(doc, payload);

  bool ok = mqttClient.publish(MQTT_TOPIC, payload);
  Serial.print(ok ? "[MQTT] ✓ Terkirim: " : "[MQTT] ✗ Gagal kirim: ");
  Serial.println(payload);
}

// ================================================================
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPS_BAUD);

  delay(1500);

  Serial.println();
  Serial.println("======================================");
  Serial.println(" SMART OIL TRACKER - UAS EDITION");
  Serial.println("======================================");
  Serial.println("[KONTROL DEMO SERIAL MONITOR]:");
  Serial.println("  Ketik 'S' -> Mode Simulasi TRUK DIAM  (Isi Oli)");
  Serial.println("  Ketik 'J' -> Mode Simulasi TRUK JALAN (Monitoring)");
  Serial.println("  Ketik 'G' -> Kembali ke Pembacaan GPS Fisik Nyata");
  Serial.println("======================================");

  // Inisialisasi HX711
  scale.begin(HX711_DT_PIN, HX711_SCK_PIN);
  if (!scale.wait_ready_timeout(2000)) {
    Serial.println("HX711 ERROR");
    while (1);
  }
  Serial.println("HX711 OK");
  scale.set_scale(calibration_factor);
  scale.tare();
  Serial.println("Tare Selesai.");

  // Koneksi WiFi & MQTT
  connectWiFi();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);
  connectMQTT();

  Serial.println("\nSiap Demo!");
}

// ================================================================
void loop() {
  // 1. Baca data GPS di latar belakang
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  // 2. Jaga koneksi MQTT tetap aktif
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
  }

  // 3. Input Keyboard Serial Monitor (Saklar Mode)
  if (Serial.available() > 0) {
    char perintah = Serial.read();
    if (perintah == 's' || perintah == 'S') {
      useGPSFisik = false;
      speedSimulasi = 0.0;
      baselineLocked = false;
      stableWindowTimer = 0;
      thiefTimer = 0;
      isAlertTriggered = false;
      Serial.println("\n[SIMULASI] >>> MODE DIAM AKTIF (Speed = 0 km/h) <<<");
    }
    else if (perintah == 'j' || perintah == 'J') {
      useGPSFisik = false;
      speedSimulasi = 25.0;
      thiefTimer = 0;
      Serial.println("\n[SIMULASI] >>> MODE JALAN AKTIF (Speed = 25 km/h) <<<");
    }
    else if (perintah == 'g' || perintah == 'G') {
      useGPSFisik = true;
      Serial.println("\n[HARDWARE] >>> MENGGUNAKAN GPS FISIK ASLI <<<");
    }
  }

  // 4. Logika Utama — Setiap 1 Detik
  if (millis() - displayTimer >= 1000) {
    displayTimer = millis();

    long raw = scale.read();
    float berat = scale.get_units(5);
    if (berat < 0) berat = 0;
    berat = movingAverage(berat);

    bool isStable     = (abs(berat - lastWeight) < 0.03);
    bool isStableDiam = (abs(berat - lastWeight) < 0.50);

    float currentSpeed = useGPSFisik
      ? (gps.speed.isValid() ? gps.speed.kmph() : 0.0)
      : speedSimulasi;

    // Koordinat GPS (gunakan last valid jika tidak ada fix)
    double lat = (gps.location.isValid()) ? gps.location.lat() : 0.0;
    double lng = (gps.location.isValid()) ? gps.location.lng() : 0.0;

    // -- Skenario A: DIAM --
    if (currentSpeed < 4.0) {
      thiefTimer = 0;
      isAlertTriggered = false;

      if (isStableDiam && berat > 0.10) {
        if (!baselineLocked) {
          if (stableWindowTimer == 0) {
            stableWindowTimer = millis();
          } else if (millis() - stableWindowTimer >= 2000) {
            baselineWeight = berat;
            baselineLocked = true;
            Serial.println("\n=================================================");
            Serial.print("[SYSTEM] >>> BASELINE DIKUNCI: ");
            Serial.print(baselineWeight, 2); Serial.println(" Kg <<<");
            Serial.println("=================================================\n");
          }
        }
      } else {
        stableWindowTimer = 0;
      }
    }
    // -- Skenario B: JALAN --
    else {
      stableWindowTimer = 0;

      if (baselineLocked) {
        float selisih = baselineWeight - berat;
        if (selisih >= THIEF_THRESHOLD) {
          if (thiefTimer == 0) thiefTimer = millis();
          else if (millis() - thiefTimer >= 3000) isAlertTriggered = true;
        } else {
          thiefTimer = 0;
          isAlertTriggered = false;
        }
      }
    }

    lastWeight = berat;

    // -- Cetak ke Serial Monitor --
    Serial.println("--------------------------------");
    Serial.print("RAW HX711      : "); Serial.println(raw);
    Serial.print("Berat Realtime : "); Serial.print(berat, 2); Serial.println(" Kg");
    Serial.print("Status Guncang : "); Serial.println(isStable ? "STABIL" : "BERUBAH/GUNCANG");
    Serial.print("Baseline Acuan : ");
    if (baselineLocked) { Serial.print(baselineWeight, 2); Serial.println(" Kg (Locked)"); }
    else Serial.println("Mencari Stabilitas...");
    Serial.print("Kecepatan Alat : "); Serial.print(currentSpeed); Serial.println(" km/h");
    Serial.print("Status Kendara : ");
    if (currentSpeed < 4.0) Serial.println("STOPPED / FILLING MODE");
    else Serial.println("DRIVING / MONITORING MODE");
    Serial.print("Koordinat GPS  : ");
    if (gps.location.isValid()) {
      Serial.print(lat, 6); Serial.print(", "); Serial.println(lng, 6);
    } else {
      Serial.println("Belum Fix");
    }
    Serial.print("WiFi           : ");
    Serial.println(WiFi.status() == WL_CONNECTED ? "Terhubung" : "Tidak Terhubung");
    Serial.print("MQTT           : ");
    Serial.println(mqttClient.connected() ? "Terhubung" : "Tidak Terhubung");

    if (isAlertTriggered) {
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      Serial.print("[ALERT] DETEKSI PENCURIAN OLI! Hilang: ");
      Serial.print(baselineWeight - berat, 2); Serial.println(" Kg");
      Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    }
    Serial.println("--------------------------------");

    // 5. Kirim Data via MQTT setiap MQTT_INTERVAL (5 detik)
    if (millis() - mqttSendTimer >= MQTT_INTERVAL) {
      mqttSendTimer = millis();
      publishData(berat, currentSpeed, lat, lng);
    }
  }
}
