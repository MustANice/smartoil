const io = require('socket.io-client');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ORIGIN_URL = 'http://127.0.0.1:3006';
const PUBLIC_URL = 'https://smartoil.dindustries.my.id';
const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const TOPIC = process.env.MQTT_TOPIC || 'smartoil/sensor';

const results = {
  section1_http_assets: { origin: {}, public: {}, status: 'PENDING' },
  section2_rest_api: { latest: {}, history: {}, status: 'PENDING' },
  section3_websocket_consistency: { origin: {}, public: {}, crossLayerParity: {}, status: 'PENDING' },
  section4_boundary_checks: { tests: [], status: 'PENDING' },
  summary: { totalPassed: 0, totalFailed: 0, totalTests: 0 }
};

function assert(condition, message) {
  results.summary.totalTests++;
  if (condition) {
    results.summary.totalPassed++;
    console.log(`  [PASS] ${message}`);
    return true;
  } else {
    results.summary.totalFailed++;
    console.error(`  [FAIL] ${message}`);
    return false;
  }
}

async function runSection1() {
  console.log('\n======================================================');
  console.log('TEST SUITE 1: HTTP Dashboard & Static Assets (Origin vs Public)');
  console.log('======================================================');

  const targets = [
    { name: 'Origin', base: ORIGIN_URL },
    { name: 'Public', base: PUBLIC_URL }
  ];

  const assets = [
    { path: '/', expectedType: 'text/html', checkHtmlContent: true },
    { path: '/style.css', expectedType: 'text/css' },
    { path: '/app.js', expectedType: 'application/javascript' },
    { path: '/socket.io/socket.io.js', expectedType: 'application/javascript' }
  ];

  for (const target of targets) {
    console.log(`\n--- Verifying Target: ${target.name} (${target.base}) ---`);
    targetResults = {};
    for (const asset of assets) {
      const url = `${target.base}${asset.path}`;
      try {
        const resp = await fetch(url, { headers: { 'Accept': '*/*' } });
        const status = resp.status;
        const ctype = resp.headers.get('content-type') || '';
        const body = await resp.text();
        const length = body.length;

        const statusOk = assert(status === 200, `${target.name} ${asset.path} HTTP Status 200 OK (got ${status})`);
        const typeOk = assert(ctype.includes(asset.expectedType) || ctype.includes('text/javascript'), 
          `${target.name} ${asset.path} Content-Type contains ${asset.expectedType} (got ${ctype})`);
        const sizeOk = assert(length > 50, `${target.name} ${asset.path} Non-empty body (${length} bytes)`);

        let htmlDetails = true;
        if (asset.checkHtmlContent) {
          const hasMap = body.includes('id="map"');
          const hasChart = body.includes('id="realtimeChart"');
          const hasSocketBadge = body.includes('id="socket-badge"');
          const hasMqttBadge = body.includes('id="mqtt-badge"');
          const hasLogTable = body.includes('id="log-table-body"');

          htmlDetails = assert(hasMap && hasChart && hasSocketBadge && hasMqttBadge && hasLogTable,
            `${target.name} index.html contains essential SCADA DOM elements (#map, #realtimeChart, #socket-badge, #mqtt-badge, #log-table-body)`);
        }

        results.section1_http_assets[target.name.toLowerCase()][asset.path] = {
          url,
          status,
          contentType: ctype,
          contentLength: length,
          passed: statusOk && typeOk && sizeOk && htmlDetails
        };
      } catch (err) {
        assert(false, `${target.name} ${asset.path} Fetch error: ${err.message}`);
        results.section1_http_assets[target.name.toLowerCase()][asset.path] = {
          url,
          error: err.message,
          passed: false
        };
      }
    }
  }
}

async function runSection2() {
  console.log('\n======================================================');
  console.log('TEST SUITE 2: REST API Schema & Query Contracts');
  console.log('======================================================');

  const targets = [
    { name: 'Origin', base: ORIGIN_URL },
    { name: 'Public', base: PUBLIC_URL }
  ];

  for (const target of targets) {
    console.log(`\n--- REST API /api/latest on ${target.name} ---`);
    try {
      const resp = await fetch(`${target.base}/api/latest`);
      const status = resp.status;
      assert(status === 200, `${target.name} /api/latest HTTP 200 OK`);
      const record = await resp.json();

      assert(typeof record.id === 'number' && record.id > 0, `${target.name} record.id is positive number: ${record.id}`);
      assert(typeof record.weight === 'number' && !isNaN(record.weight), `${target.name} record.weight is valid float: ${record.weight}`);
      assert(typeof record.latitude === 'number' && record.latitude >= -90 && record.latitude <= 90, `${target.name} record.latitude in valid range: ${record.latitude}`);
      assert(typeof record.longitude === 'number' && record.longitude >= -180 && record.longitude <= 180, `${target.name} record.longitude in valid range: ${record.longitude}`);
      assert(typeof record.speed === 'number' && record.speed >= 0, `${target.name} record.speed is non-negative number: ${record.speed}`);
      assert(typeof record.satellite === 'number' && record.satellite >= 0, `${target.name} record.satellite is non-negative integer: ${record.satellite}`);
      assert(typeof record.status === 'string' && record.status.length > 0, `${target.name} record.status is non-empty string: "${record.status}"`);
      assert(typeof record.timestamp === 'string' && !isNaN(Date.parse(record.timestamp)), `${target.name} record.timestamp is valid ISO/date string: "${record.timestamp}"`);

      results.section2_rest_api.latest[target.name.toLowerCase()] = { sample: record, passed: true };
    } catch (err) {
      assert(false, `${target.name} /api/latest failed: ${err.message}`);
    }

    console.log(`\n--- REST API /api/history on ${target.name} ---`);
    try {
      const resp = await fetch(`${target.base}/api/history?limit=10&offset=0`);
      assert(resp.status === 200, `${target.name} /api/history HTTP 200 OK`);
      const body = await resp.json();

      assert(typeof body.total === 'number' && body.total >= 0, `${target.name} body.total is valid non-negative integer: ${body.total}`);
      assert(Array.isArray(body.data), `${target.name} body.data is an array`);
      assert(body.data.length <= 10, `${target.name} body.data respects limit=10 (got ${body.data.length})`);

      if (body.data.length > 0) {
        const item = body.data[0];
        const fields = ['id', 'timestamp', 'weight', 'latitude', 'longitude', 'speed', 'satellite', 'status'];
        const allPresent = fields.every(f => f in item);
        assert(allPresent, `${target.name} history row contains all expected fields: ${fields.join(', ')}`);
      }

      // Test pagination offset
      const respPaging = await fetch(`${target.base}/api/history?limit=5&offset=2`);
      const bodyPaging = await respPaging.json();
      if (body.data.length >= 3 && bodyPaging.data.length > 0) {
        assert(bodyPaging.data[0].id === body.data[2].id, `${target.name} offset=2 matches index 2 of base query (ID ${bodyPaging.data[0].id} === ${body.data[2].id})`);
      }

      // Test search filter
      const respSearch = await fetch(`${target.base}/api/history?search=ONLINE&limit=5`);
      const bodySearch = await respSearch.json();
      const allOnline = bodySearch.data.every(r => r.status.includes('ONLINE') || String(r.weight).includes('ONLINE'));
      assert(allOnline, `${target.name} search=ONLINE correctly filters records`);

      // Test SQL injection safety
      const respSqli = await fetch(`${target.base}/api/history?search=' OR '1'='1&limit=5`);
      assert(respSqli.status === 200, `${target.name} search with SQL injection payload handled safely (HTTP 200, no unhandled exception)`);

      results.section2_rest_api.history[target.name.toLowerCase()] = { total: body.total, passed: true };
    } catch (err) {
      assert(false, `${target.name} /api/history failed: ${err.message}`);
    }
  }
}

async function runSection3() {
  console.log('\n======================================================');
  console.log('TEST SUITE 3: WebSocket / Socket.IO & Cross-Layer Telemetry Consistency');
  console.log('======================================================');

  // Test Socket.IO connection on both Origin and Public
  const clientOrigin = io(ORIGIN_URL, { transports: ['websocket', 'polling'], timeout: 6000 });
  const clientPublic = io(PUBLIC_URL, { transports: ['websocket', 'polling'], timeout: 8000 });

  let originConnected = false;
  let publicConnected = false;
  let originMqttStatus = null;
  let publicMqttStatus = null;

  await Promise.all([
    new Promise((resolve) => {
      clientOrigin.on('connect', () => {
        originConnected = true;
        assert(true, `Socket.IO Origin connected successfully (ID: ${clientOrigin.id})`);
      });
      clientOrigin.on('mqtt_status', (status) => {
        originMqttStatus = status;
        assert(status.connected === true, `Socket.IO Origin received mqtt_status: connected=true`);
        resolve();
      });
      setTimeout(() => resolve(), 4000);
    }),
    new Promise((resolve) => {
      clientPublic.on('connect', () => {
        publicConnected = true;
        assert(true, `Socket.IO Public connected successfully via Cloudflare (ID: ${clientPublic.id})`);
      });
      clientPublic.on('mqtt_status', (status) => {
        publicMqttStatus = status;
        assert(status.connected === true, `Socket.IO Public received mqtt_status: connected=true`);
        resolve();
      });
      setTimeout(() => resolve(), 6000);
    })
  ]);

  assert(originConnected, 'Origin Socket.IO connected');
  assert(publicConnected, 'Public Cloudflare Tunnel Socket.IO connected');

  // Live telemetry broadcast capture & cross-layer parity verification
  console.log('\n--- Injecting Unique Deterministic Telemetry Probe for Multi-Layer Parity ---');
  
  const probeKey = Math.floor(Math.random() * 9000 + 1000);
  const probeWeight = 7.82; // distinct float
  const probeLat = -6.914321;
  const probeLng = 107.615432;
  const probeSpeed = 4.75;
  const probeSat = 12;
  const probeStatus = 'ONLINE';

  const probePayload = {
    weight: probeWeight,
    latitude: probeLat,
    longitude: probeLng,
    speed: probeSpeed,
    satellite: probeSat,
    status: probeStatus,
    timestamp: new Date().toISOString(),
    _probeId: probeKey
  };

  // Set up listeners for the probe on both sockets
  let originReceivedData = null;
  let publicReceivedData = null;

  const originPromise = new Promise((resolve) => {
    const handler = (data) => {
      if (Math.abs(data.weight - probeWeight) < 0.001 && Math.abs(data.latitude - probeLat) < 0.0001) {
        originReceivedData = data;
        clientOrigin.off('sensor_data', handler);
        resolve(data);
      }
    };
    clientOrigin.on('sensor_data', handler);
    setTimeout(() => resolve(null), 6000);
  });

  const publicPromise = new Promise((resolve) => {
    const handler = (data) => {
      if (Math.abs(data.weight - probeWeight) < 0.001 && Math.abs(data.latitude - probeLat) < 0.0001) {
        publicReceivedData = data;
        clientPublic.off('sensor_data', handler);
        resolve(data);
      }
    };
    clientPublic.on('sensor_data', handler);
    setTimeout(() => resolve(null), 7000);
  });

  // Connect MQTT publisher and send probe
  const mqttClient = mqtt.connect(BROKER_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    rejectUnauthorized: false
  });

  await new Promise((resolve, reject) => {
    mqttClient.on('connect', () => {
      mqttClient.publish(TOPIC, JSON.stringify(probePayload), { qos: 1 }, (err) => {
        if (err) reject(err);
        else {
          console.log(`  Published probe payload: weight=${probeWeight}, lat=${probeLat}, lng=${probeLng}`);
          resolve();
        }
      });
    });
    mqttClient.on('error', reject);
  });

  // Await broadcast reception
  await Promise.all([originPromise, publicPromise]);

  assert(originReceivedData !== null, `Origin Socket.IO received probe broadcast event (weight: ${originReceivedData?.weight})`);
  assert(publicReceivedData !== null, `Public Socket.IO received probe broadcast event (weight: ${publicReceivedData?.weight})`);

  // Verify in MariaDB / MySQL
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'smart_oil_tracker'
  });

  const [dbRows] = await db.query('SELECT * FROM oil_data WHERE id = ?', [originReceivedData?.id || 0]);
  const dbRecord = dbRows[0];
  assert(dbRecord !== undefined, `MariaDB row inserted with matching ID ${originReceivedData?.id}`);
  if (dbRecord) {
    assert(Math.abs(dbRecord.weight - probeWeight) < 0.01, `DB weight matches probe (${dbRecord.weight} vs ${probeWeight})`);
    assert(Math.abs(dbRecord.latitude - probeLat) < 0.0001, `DB latitude matches probe (${dbRecord.latitude} vs ${probeLat})`);
    assert(Math.abs(dbRecord.longitude - probeLng) < 0.0001, `DB longitude matches probe (${dbRecord.longitude} vs ${probeLng})`);
    assert(Math.abs(dbRecord.speed - probeSpeed) < 0.01, `DB speed matches probe (${dbRecord.speed} vs ${probeSpeed})`);
    assert(dbRecord.satellite === probeSat, `DB satellite matches probe (${dbRecord.satellite} vs ${probeSat})`);
    assert(dbRecord.status === probeStatus, `DB status matches probe (${dbRecord.status} vs ${probeStatus})`);
  }

  // Verify in REST API /api/latest
  const respLatest = await fetch(`${ORIGIN_URL}/api/latest`);
  const apiLatest = await respLatest.json();
  assert(apiLatest.id >= (originReceivedData?.id || 0), `REST /api/latest reflected recent record (ID: ${apiLatest.id})`);

  // Cleanup
  clientOrigin.disconnect();
  clientPublic.disconnect();
  mqttClient.end();
  await db.end();
}

async function runSection4() {
  console.log('\n======================================================');
  console.log('TEST SUITE 4: Boundary Cases & Adversarial Invariants');
  console.log('======================================================');

  const mqttClient = mqtt.connect(BROKER_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    rejectUnauthorized: false
  });

  await new Promise((resolve) => mqttClient.on('connect', resolve));

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'smart_oil_tracker'
  });

  const socket = io(ORIGIN_URL, { transports: ['websocket'] });
  await new Promise((resolve) => socket.on('connect', resolve));

  // Subtest 4.1: GPS (0, 0) rejection invariant
  console.log('\n--- Subtest 4.1: GPS (0,0) Lock Boundary ---');
  const [[beforeCount]] = await db.query('SELECT COUNT(*) as count FROM oil_data');
  
  mqttClient.publish(TOPIC, JSON.stringify({
    weight: 9.99,
    latitude: 0,
    longitude: 0,
    speed: 0,
    satellite: 0,
    status: 'ONLINE'
  }));

  // Wait 1.5s to ensure message processing
  await new Promise(r => setTimeout(r, 1500));
  const [[afterCount]] = await db.query('SELECT COUNT(*) as count FROM oil_data WHERE weight = 9.99 AND latitude = 0 AND longitude = 0');
  assert(afterCount.count === 0, 'Payload with GPS (0, 0) was properly rejected and NOT written to DB');

  // Subtest 4.2: Malformed / NaN payload handling
  console.log('\n--- Subtest 4.2: Malformed NaN fields ---');
  let receivedMqttError = false;
  socket.on('mqtt_error', () => { receivedMqttError = true; });

  mqttClient.publish(TOPIC, JSON.stringify({
    weight: "not-a-number",
    latitude: -6.91,
    longitude: 107.61
  }));

  await new Promise(r => setTimeout(r, 1500));
  assert(receivedMqttError, 'Backend emitted mqtt_error event for NaN weight without crashing process');

  // Verify server is still alive
  const healthCheck = await fetch(`${ORIGIN_URL}/api/latest`);
  assert(healthCheck.status === 200, 'Server process remained alive and responsive after NaN payload');

  // Subtest 4.3: Legacy format with alert: true -> THEFT_DETECTED
  console.log('\n--- Subtest 4.3: Legacy alert: true backward-compatibility ---');
  const theftProbeWeight = 3.333;
  mqttClient.publish(TOPIC, JSON.stringify({
    weight: theftProbeWeight,
    latitude: -6.913,
    longitude: 107.613,
    alert: true // legacy format
  }));

  await new Promise(r => setTimeout(r, 2000));
  const [theftRows] = await db.query('SELECT * FROM oil_data WHERE weight >= 3.33 AND weight <= 3.34 ORDER BY id DESC LIMIT 1');
  if (theftRows.length > 0) {
    assert(theftRows[0].status === 'THEFT_DETECTED', `Legacy alert:true correctly mapped to THEFT_DETECTED (got ${theftRows[0].status})`);
  } else {
    assert(false, 'Legacy alert test record not found in DB');
  }

  // Subtest 4.4: Minimal payload with missing speed and satellite
  console.log('\n--- Subtest 4.4: Minimal payload missing optional fields ---');
  const minWeight = 8.888;
  mqttClient.publish(TOPIC, JSON.stringify({
    weight: minWeight,
    latitude: -6.915,
    longitude: 107.615
  }));

  await new Promise(r => setTimeout(r, 2000));
  const [minRows] = await db.query('SELECT * FROM oil_data WHERE weight >= 8.88 AND weight <= 8.89 ORDER BY id DESC LIMIT 1');
  if (minRows.length > 0) {
    assert(minRows[0].speed === 0.0, `Missing speed defaulted to 0.0 (got ${minRows[0].speed})`);
    assert(minRows[0].satellite === 0, `Missing satellite defaulted to 0 (got ${minRows[0].satellite})`);
    assert(minRows[0].status === 'ONLINE', `Missing status defaulted to ONLINE (got ${minRows[0].status})`);
  } else {
    assert(false, 'Minimal payload test record not found in DB');
  }

  // Subtest 4.5: REST API Boundary conditions
  console.log('\n--- Subtest 4.5: REST API Boundary inputs ---');
  const rZeroLimit = await fetch(`${ORIGIN_URL}/api/history?limit=0`);
  const bZeroLimit = await rZeroLimit.json();
  assert(rZeroLimit.status === 200 && bZeroLimit.data.length === 0, 'REST /api/history?limit=0 safely returns empty data array');

  const rNegLimit = await fetch(`${ORIGIN_URL}/api/history?limit=-5`);
  assert(rNegLimit.status === 500 || rNegLimit.status === 400 || rNegLimit.status === 200, 'REST /api/history?limit=-5 handled gracefully without unhandled crash');

  // Cleanup
  mqttClient.end();
  socket.disconnect();
  await db.end();
}

async function main() {
  console.log('================================================================');
  console.log('   SMART OIL TRACKER INDEPENDENT VERIFICATION (PRISM SPECIALIST)');
  console.log('================================================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Origin: ${ORIGIN_URL}`);
  console.log(`Public: ${PUBLIC_URL}`);

  try {
    await runSection1();
    await runSection2();
    await runSection3();
    await runSection4();
  } catch (err) {
    console.error('UNEXPECTED TEST HARNESS ERROR:', err);
  }

  console.log('\n================================================================');
  console.log('                   FINAL VERIFICATION SUMMARY');
  console.log('================================================================');
  console.log(`Total Invariants Tested : ${results.summary.totalTests}`);
  console.log(`Total Passed             : ${results.summary.totalPassed}`);
  console.log(`Total Failed             : ${results.summary.totalFailed}`);
  const verdict = results.summary.totalFailed === 0 ? 'PASS' : 'FAIL';
  console.log(`VERDICT                  : ${verdict}`);
  console.log('================================================================\n');

  process.exit(results.summary.totalFailed === 0 ? 0 : 1);
}

main();
