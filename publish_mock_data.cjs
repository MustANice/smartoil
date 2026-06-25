const mqtt = require('mqtt');

const brokerUrl = 'mqtt://127.0.0.1:1883';
const topic = 'smartoil/sensor';

const client = mqtt.connect(brokerUrl);

let weight = 5.0;
let latitude = -6.913421;
let longitude = 107.612345;
let step = 0;

client.on('connect', () => {
  console.log('✓ Mock Publisher terhubung ke MQTT Broker.');
  
  setInterval(() => {
    // Simulasi perubahan data sensor
    weight += (Math.random() - 0.5) * 0.4;
    weight = Math.max(1.0, Math.min(10.0, weight)); // Batasi 1 - 10 Kg

    // Simulasi pergerakan kecil GPS
    latitude += (Math.random() - 0.5) * 0.0001;
    longitude += (Math.random() - 0.5) * 0.0001;

    const payload = {
      weight: parseFloat(weight.toFixed(2)),
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6)),
      speed: parseFloat((Math.random() * 5).toFixed(2)),
      satellite: 8 + Math.floor(Math.random() * 4),
      status: 'ONLINE',
      timestamp: new Date().toISOString()
    };

    console.log(`Sending payload:`, JSON.stringify(payload));
    client.publish(topic, JSON.stringify(payload));
    step++;
  }, 2000);
});

client.on('error', (err) => {
  console.error('Mock Publisher Error:', err.message);
});
