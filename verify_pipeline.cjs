const io = require('socket.io-client');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runVerification() {
  console.log('=== SMART OIL TRACKER END-TO-END VERIFICATION ===');
  
  // 1. Connect Socket.IO
  console.log('[1/5] Connecting to Socket.IO at http://127.0.0.1:3006 ...');
  const socket = io('http://127.0.0.1:3006', {
    transports: ['websocket', 'polling']
  });

  let receivedSocketData = null;
  let receivedMqttStatus = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket.IO connection timeout')), 5000);
    socket.on('connect', () => {
      console.log('   ✓ Socket.IO connected with id:', socket.id);
    });
    socket.on('mqtt_status', (status) => {
      console.log('   ✓ Received mqtt_status:', JSON.stringify(status));
      receivedMqttStatus = status;
      clearTimeout(timer);
      resolve();
    });
  });

  // 2. Setup Socket listener for incoming sensor_data
  const sensorDataPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for sensor_data via Socket.IO')), 8000);
    socket.on('sensor_data', (data) => {
      console.log('   ✓ Received sensor_data via Socket.IO broadcast:');
      console.log('     ', JSON.stringify(data));
      receivedSocketData = data;
      clearTimeout(timer);
      resolve(data);
    });
  });

  // 3. Publish test MQTT message
  console.log('[2/5] Publishing test MQTT message to smartoil/sensor ...');
  const testPayload = {
    weight: 7.45,
    latitude: -6.914744,
    longitude: 107.609810,
    speed: 3.2,
    satellite: 11,
    status: 'ONLINE',
    timestamp: new Date().toISOString()
  };

  const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883');
  await new Promise((resolve, reject) => {
    mqttClient.on('connect', () => {
      console.log('   ✓ Test MQTT publisher connected.');
      mqttClient.publish('smartoil/sensor', JSON.stringify(testPayload), { qos: 0 }, (err) => {
        if (err) reject(err);
        else {
          console.log('   ✓ Payload published successfully:', JSON.stringify(testPayload));
          resolve();
        }
      });
    });
    mqttClient.on('error', reject);
  });

  // 4. Await Socket.IO broadcast
  console.log('[3/5] Awaiting Socket.IO broadcast event ...');
  await sensorDataPromise;

  // 5. Verify Database Record
  console.log('[4/5] Verifying database record in MariaDB ...');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'smartoil',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'smart_oil_tracker'
  });

  const [rows] = await db.query('SELECT * FROM oil_data ORDER BY id DESC LIMIT 1');
  console.log('   ✓ Latest MariaDB record:', JSON.stringify(rows[0]));
  if (!rows || rows.length === 0 || rows[0].weight !== 7.45) {
    throw new Error('Database record verification failed!');
  }

  // 6. Verify REST API /api/latest
  console.log('[5/5] Verifying REST API /api/latest ...');
  const response = await fetch('http://127.0.0.1:3006/api/latest');
  const apiJson = await response.json();
  console.log('   ✓ API Response:', JSON.stringify(apiJson));
  if (apiJson.weight !== 7.45) {
    throw new Error('API verification failed!');
  }

  // Cleanup
  mqttClient.end();
  socket.disconnect();
  await db.end();

  console.log('=== VERIFICATION RESULT: ALL PASS ===');
}

runVerification().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
