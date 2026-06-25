# Smart Oil Tracker - IoT Industrial SCADA Dashboard

Smart Oil Tracker adalah sistem monitoring volume oli secara real-time berbasis IoT dengan dashboard bergaya industri (SCADA). Sistem ini menerima kiriman telemetri dari Arduino Uno R4 WiFi melalui protokol MQTT, menyimpannya di database MySQL, dan menampilkannya secara langsung di antarmuka web yang responsif tanpa perlu memuat ulang halaman.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, MQTT.js, Socket.IO, MySQL2, Dotenv, CORS.
- **Frontend:** HTML5, CSS3 (Vanilla + Industrial Design System), Bootstrap 5, JavaScript (ES6), Chart.js, Leaflet.js, Socket.IO Client.
- **Database:** MySQL (XAMPP / MariaDB / Native).
- **MQTT Broker:** Local Mosquitto atau HiveMQ Cloud.

---

## 📁 Struktur Proyek

```text
SmartOilServer/
│
├── server.js               # Entry point server Express & Socket.IO
├── mqtt.js                 # Handler MQTT subscriber (menghubungkan ke broker, simpan ke DB, & broadcast)
├── db.js                   # Konfigurasi & inisialisasi database pool MySQL
├── package.json            # Daftar dependensi npm & script jalankan server
├── .env                    # Konfigurasi aktif (database, MQTT broker, port)
├── .env.example            # Contoh template file konfigurasi .env
│
├── routes/
│      └── oil.js           # Express router untuk REST API endpoints (/api/latest, /api/history)
│
├── public/
│      ├── index.html       # Tampilan antarmuka Dashboard SCADA
│      ├── style.css        # Desain visual dashboard (mendukung Dark & Light Mode)
│      └── app.js           # Client-side JS untuk Socket.IO, grafik Chart.js, & peta Leaflet.js
│
├── database.sql            # Skema SQL awal database
└── publish_mock_data.cjs   # Script simulasi data (mock publisher) untuk pengujian dashboard
```

---

## ⚙️ Panduan Instalasi & Cara Menjalankan

### 1. Prasyarat (Prerequisites)
Pastikan komputer Anda sudah terinstal:
- [Node.js](https://nodejs.org/) (Versi 16 atau lebih baru)
- MySQL (Direkomendasikan menggunakan **XAMPP** karena sudah terkonfigurasi otomatis)
- MQTT Broker (Mosquitto sudah berjalan otomatis di Mac Anda)

### 2. Konfigurasi Database
1. Buka XAMPP Control Panel dan pastikan service **MySQL** dalam status **Running**.
2. Masuk ke phpMyAdmin (`http://localhost/phpmyadmin`) atau gunakan command line MySQL client.
3. Import file `database.sql` yang ada di root proyek ini untuk membuat database `smart_oil_tracker` dan tabel `oil_data`.
   > **Catatan:** Server Node.js ini dilengkapi fitur **auto-migration**. Jika database atau tabel belum ada saat server dijalankan, backend akan otomatis membuatkannya untuk Anda.

### 3. Konfigurasi File Lingkungan (`.env`)
Salin file `.env.example` menjadi `.env` lalu sesuaikan isinya:
```bash
cp .env.example .env
```
Isi file `.env` untuk broker lokal (Mosquitto Mac):
```ini
PORT=3000

# Database MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smart_oil_tracker

# MQTT (Mosquitto)
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
MQTT_TOPIC=smartoil/sensor
MQTT_CLIENT_ID=smart_oil_server_backend
MQTT_USERNAME=
MQTT_PASSWORD=
```

### 4. Instalasi Dependensi NPM
Jalankan perintah berikut di Terminal di dalam folder `SmartOilServer`:
```bash
npm install
```

### 5. Jalankan Server Utama
Mulai server Node.js dalam mode development (menggunakan `nodemon` agar otomatis restart saat file berubah):
```bash
npm run dev
```
Server akan berjalan di: **`http://localhost:3000`**

---

## 🧪 Cara Melakukan Pengujian Dashboard

Jika Anda ingin menguji seluruh visualisasi dashboard tanpa Arduino fisik:
1. Pastikan server utama Node.js (`npm run dev`) sedang aktif.
2. Buka terminal baru dan jalankan script mock simulator pengirim data di folder proyek:
   ```bash
   node publish_mock_data.cjs
   ```
3. Simulator akan mulai mengirimkan data sensor tiruan (berat oli, lokasi koordinat, kecepatan, status satelit) ke topik MQTT setiap 2 detik.
4. Buka **`http://localhost:3000`** di browser Anda. Anda akan melihat:
   - Indikator koneksi Socket & MQTT berubah menjadi **Connected** (Hijau).
   - Nilai berat oli di kartu statistik & gauge meter bergerak naik turun.
   - Grafik Chart.js menggambar garis real-time (menyimpan hingga 50 data terakhir).
   - Marker di peta Leaflet.js bergeser secara live.
   - Log tabel riwayat secara otomatis bertambah tanpa me-refresh halaman.

---

## 🎨 Fitur Dashboard SCADA

1. **Top Header:** Dilengkapi jam real-time dan indikator status koneksi server.
2. **Dynamic Dark Mode:** Klik ikon bulan/matahari di pojok kanan atas untuk berpindah dari tema terang (industrial light) ke tema gelap (high-contrast dark mode).
3. **Analogi Gauge Meter:** Jarum gauge yang bergerak dinamis merepresentasikan kapasitas oli 0 - 10 Kg secara langsung.
4. **Live Map Tracking:** Memetakan letak tracker secara live dengan auto-panning dan popup info detail.
5. **Log Telemetri Filterable:** Cari data berdasarkan status/nilai, filter rentang tanggal, dan urutkan telemetri terbaru di baris atas.
6. **Ekspor Data:**
   - Unduh log tabel yang sedang difilter menjadi berkas **Excel (CSV)**.
   - Cetak atau simpan laporan log dalam bentuk **PDF** resmi.
