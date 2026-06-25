const mqtt = require('mqtt');
const { pool } = require('./db');

let ioInstance = null;
let client = null;

function initMqtt(io) {
  ioInstance = io;

  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
  const topic = process.env.MQTT_TOPIC || 'smartoil/sensor';

  const options = {
    clientId: process.env.MQTT_CLIENT_ID || 'smart_oil_backend_' + Math.random().toString(16).substr(2, 8),
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
  };

  if (process.env.MQTT_USERNAME) {
    options.username = process.env.MQTT_USERNAME;
  }
  if (process.env.MQTT_PASSWORD) {
    options.password = process.env.MQTT_PASSWORD;
  }

  // HiveMQ Cloud specific options for SSL/TLS
  if (brokerUrl.startsWith('mqtts://')) {
    options.rejectUnauthorized = false; // set to false to ease SSL config, or make configurable
  }

  console.log(`🔌 Menghubungkan ke MQTT Broker di: ${brokerUrl}...`);
  client = mqtt.connect(brokerUrl, options);

  client.on('connect', () => {
    console.log('✓ Terhubung ke MQTT Broker.');
    if (ioInstance) ioInstance.emit('mqtt_status', { connected: true });
    
    client.subscribe(topic, (err) => {
      if (!err) {
        console.log(`✓ Berhasil subscribe ke topik: "${topic}"`);
      } else {
        console.error(`✗ Gagal subscribe ke topik "${topic}":`, err.message);
      }
    });
  });

  client.on('error', (err) => {
    console.error('✗ Kesalahan koneksi MQTT:', err.message);
    if (ioInstance) ioInstance.emit('mqtt_status', { connected: false, error: err.message });
  });

  client.on('offline', () => {
    console.log('🔌 Koneksi MQTT terputus dari broker.');
    if (ioInstance) ioInstance.emit('mqtt_status', { connected: false });
  });

  client.on('message', async (topic, message) => {
    try {
      const payloadString = message.toString();
      const data = JSON.parse(payloadString);

      // --- Parse field: support payload lama (Arduino lama) & baru ---
      const weight    = parseFloat(data.weight);
      const latitude  = parseFloat(data.latitude);
      const longitude = parseFloat(data.longitude);

      // Tolak jika koordinat/berat invalid atau 0,0 (GPS belum lock)
      if (isNaN(weight) || isNaN(latitude) || isNaN(longitude)) {
        throw new Error('Field weight/latitude/longitude bukan angka — payload diabaikan.');
      }
      if (latitude === 0 && longitude === 0) {
        console.warn('⚠️  GPS belum lock (0,0) — data tidak disimpan.');
        return;
      }

      // speed: bisa float, default 0
      const speedRaw = parseFloat(data.speed);
      const speed    = isNaN(speedRaw) ? 0.0 : speedRaw;

      // satellite: bisa ada atau tidak (payload lama tidak punya)
      const satRaw   = parseInt(data.satellite);
      const satellite = isNaN(satRaw) ? 0 : satRaw;

      // status: payload baru pakai "status", lama pakai "alert" boolean
      let status = 'ONLINE';
      if (data.status === 'THEFT_DETECTED') {
        status = 'THEFT_DETECTED';
      } else if (data.alert === true) {
        status = 'THEFT_DETECTED';
      }

      console.log(`📨 MQTT Diterima: ${payloadString}`);
      console.log(`   └─ Parsed -> Berat: ${weight}Kg | Lat: ${latitude} | Lng: ${longitude} | Speed: ${speed} km/h | Sat: ${satellite} | Status: ${status}`);

      // Simpan ke database MySQL
      const [result] = await pool.query(
        `INSERT INTO oil_data (weight, latitude, longitude, speed, satellite, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [weight, latitude, longitude, speed, satellite, status]
      );

      // Ambil baris ter-insert untuk mendapatkan format timestamp MySQL yang tepat
      const [insertedRows] = await pool.query('SELECT * FROM oil_data WHERE id = ?', [result.insertId]);
      const savedData = insertedRows[0];

      // Broadcast real-time data ke semua client browser via Socket.IO
      if (ioInstance) {
        ioInstance.emit('sensor_data', savedData);
      }

    } catch (error) {
      console.error('✗ Error MQTT:', error.message);
      if (ioInstance) {
        ioInstance.emit('mqtt_error', { message: error.message });
      }
    }
  });
}

module.exports = {
  initMqtt,
  getClient: () => client
};
