require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const { checkDatabase } = require('./db');
const { initMqtt } = require('./mqtt');
const oilRouter = require('./routes/oil');

const app = express();
const server = http.createServer(app);

// Trust reverse proxy (misal: Cloudflare Tunnel)
app.set('trust proxy', 1);

// Setup Socket.IO dengan CORS & Heartbeat tuning
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan folder public secara statis untuk Dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Daftarkan route API
app.use('/api', oilRouter);

// Handler koneksi Socket.IO
io.on('connection', (socket) => {
  console.log(`🔌 Browser terhubung via Socket.IO: ${socket.id}`);
  
  // Kirim status koneksi MQTT saat ini ke client yang baru terhubung
  const mqttModule = require('./mqtt');
  const mqttClient = mqttModule.getClient();
  socket.emit('mqtt_status', { connected: mqttClient ? mqttClient.connected : false });

  socket.on('disconnect', () => {
    console.log(`🔌 Browser terputus dari Socket.IO: ${socket.id}`);
  });
});

// Port Server
const PORT = process.env.PORT || 3000;

// Jalankan inisialisasi database dan jalankan server
async function startServer() {
  // Cek dan hubungkan ke database
  await checkDatabase();

  // Jalankan MQTT subscriber
  initMqtt(io);

  // Jalankan HTTP & Socket.IO server
  server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` Smart Oil Tracker Server is running!`);
    console.log(` Port: ${PORT}`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=========================================`);
  });
}

startServer();

// Penanganan graceful shutdown
const gracefulShutdown = () => {
  console.log('\nMenerima sinyal penutupan. Menutup semua koneksi...');
  
  // 1. Tutup Socket.IO
  if (io) {
    try {
      io.close();
      console.log('✓ Socket.IO ditutup.');
    } catch (e) {}
  }

  // 2. Tutup Server HTTP
  server.close(() => {
    console.log('✓ Server HTTP ditutup.');
  });

  // 3. Tutup Koneksi MQTT
  const mqttModule = require('./mqtt');
  const mqttClient = mqttModule.getClient();
  if (mqttClient) {
    mqttClient.end(true, () => {
      console.log('✓ Koneksi MQTT ditutup.');
      closeDbAndExit();
    });
  } else {
    closeDbAndExit();
  }

  // Helper untuk menutup database dan keluar
  function closeDbAndExit() {
    const { pool } = require('./db');
    if (pool) {
      pool.end().then(() => {
        console.log('✓ Koneksi Database MySQL ditutup.');
        process.exit(0);
      }).catch((err) => {
        console.error('Peringatan saat menutup DB:', err.message);
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  // Failsafe: Paksa keluar setelah 1 detik jika ada callback yang hang
  setTimeout(() => {
    console.log('⚠️   shutdown hang, memaksa keluar...');
    process.exit(0);
  }, 1000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
