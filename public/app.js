/* ==========================================================================
   Smart Oil Tracker - Dashboard Core JS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const clockElement = document.getElementById('current-time');
  const themeToggleBtn = document.getElementById('theme-toggle');
  const socketBadge = document.getElementById('socket-badge');
  const mqttBadge = document.getElementById('mqtt-badge');
  
  // Stats Elements
  const statDeviceStatus = document.getElementById('stat-device-status');
  const statOilWeight = document.getElementById('stat-oil-weight');
  const statGpsStatus = document.getElementById('stat-gps-status');
  const statSpeed = document.getElementById('stat-speed');
  
  // Gauge & Progress Elements
  const gaugeNeedle = document.getElementById('gauge-needle');
  const gaugeDisplayVal = document.getElementById('gauge-display-val');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  
  // Map Coordinates display
  const mapLatText = document.getElementById('map-lat');
  const mapLngText = document.getElementById('map-lng');
  
  // History Elements
  const filterForm = document.getElementById('filter-form');
  const filterStart = document.getElementById('filter-start');
  const filterEnd = document.getElementById('filter-end');
  const filterSearch = document.getElementById('filter-search');
  const logTableBody = document.getElementById('log-table-body');
  const btnExportExcel = document.getElementById('btn-export-excel');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const toastContainer = document.querySelector('.toast-container');
  
  // State Variables
  let isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  let socket = null;
  let chart = null;
  let map = null;
  let marker = null;
  let lastWeightValue = null;
  let activeDataList = []; // Stores the current query results for CSV export
  let offlineTimeout = null;

  // 1. Initialize Realtime Clock
  function updateClock() {
    const now = new Date();
    const options = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false
    };
    clockElement.textContent = now.toLocaleDateString('id-ID', options).replace(/\./g, ':');
  }
  updateClock();
  setInterval(updateClock, 1000);

  // 2. Initialize Chart.js
  function initChart() {
    const ctx = document.getElementById('realtimeChart').getContext('2d');
    
    // Grid and Label colors based on theme
    const gridColor = isDarkMode ? '#334155' : '#E2E8F0';
    const textColor = isDarkMode ? '#94A3B8' : '#64748B';

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Berat Oli (Kg)',
          data: [],
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            mode: 'index',
            intersect: false,
          }
        },
        scales: {
          x: {
            grid: {
              color: gridColor
            },
            ticks: {
              color: textColor,
              font: { family: 'Poppins', size: 10 }
            }
          },
          y: {
            min: 0,
            max: 10,
            grid: {
              color: gridColor
            },
            ticks: {
              color: textColor,
              font: { family: 'Poppins', size: 10 }
            }
          }
        }
      }
    });
  }

  // 3. Initialize Leaflet Map
  function initMap() {
    // Default location (Bandung, Indonesia)
    const defaultLat = -6.913421;
    const defaultLng = 107.612345;
    
    map = L.map('map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([defaultLat, defaultLng], 15);

    // Map tiles - adapting to dark mode
    const tileUrl = isDarkMode 
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      
    L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Custom Icon for tracker
    const iotIcon = L.divIcon({
      className: 'custom-map-icon',
      html: `<div class="marker-pulse"><i class="fa-solid fa-truck-moving" style="color: #2563EB; font-size: 1.25rem;"></i></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    marker = L.marker([defaultLat, defaultLng], { icon: iotIcon }).addTo(map);
    marker.bindPopup("<b>Smart Oil Tracker</b><br>Menunggu koordinat GPS...").openPopup();
  }

  // 4. Update Gauge Needle (0-10 Kg maps to -90deg to +90deg)
  function updateGauge(weight) {
    const boundedWeight = Math.max(0, Math.min(10, weight));
    const degrees = (boundedWeight / 10) * 180 - 90;
    
    gaugeNeedle.style.transform = `rotate(${degrees}deg)`;
    gaugeDisplayVal.textContent = `${weight.toFixed(2)} Kg`;
  }

  // 5. Update Progress Bar Capacity (0-100%)
  function updateProgressBar(weight) {
    const percentage = Math.round((Math.max(0, Math.min(10, weight)) / 10) * 100);
    progressBarFill.style.width = `${percentage}%`;
    progressPercentage.textContent = `${percentage}%`;

    // Visual indicators based on fill percentage
    if (percentage > 85) {
      progressBarFill.style.background = 'linear-gradient(to right, #EF4444, #EF4444)'; // Dangerously full
    } else if (percentage > 60) {
      progressBarFill.style.background = 'linear-gradient(to right, #F59E0B, #F59E0B)'; // Warning warning
    } else {
      progressBarFill.style.background = 'linear-gradient(to right, #2563EB, #22C55E)'; // Good capacity
    }
  }

  // 6. Handle Notifications (Toasts)
  function showNotification(title, message, iconClass, bgClass = 'bg-primary') {
    const toastId = 'toast-' + Date.now();
    const html = `
      <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">
            <i class="${iconClass} me-2"></i><strong>${title}</strong>: ${message}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;
    toastContainer.insertAdjacentHTML('beforeend', html);
    
    const toastEl = document.getElementById(toastId);
    // Auto-remove toast from DOM after hidden
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    
    // Trigger bootstrap toast show
    const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
    bsToast.show();
  }

  // 7. Update Real-time Values & Widgets
  function updateWidgets(data, isRealtime = true) {
    const weight = parseFloat(data.weight);
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);
    const speed = parseFloat(data.speed);
    const sat = parseInt(data.satellite);
    const status = data.status || 'ONLINE';
    const timestampStr = new Date(data.timestamp).toLocaleString('id-ID');

    // Update Stats Card Values
    statOilWeight.innerHTML = `${weight.toFixed(2)} <span class="fs-6 text-muted">Kg</span>`;
    statGpsStatus.innerHTML = `${sat} <span class="fs-6 text-muted">Satelit</span>`;
    statSpeed.innerHTML = `${speed.toFixed(2)} <span class="fs-6 text-muted">km/h</span>`;
    
    // Update Device Status Badge
    if (status === 'THEFT_DETECTED') {
      statDeviceStatus.innerHTML = `🚨 PENCURIAN!`;
      statDeviceStatus.className = 'card-value text-danger fw-bold';
    } else if (status === 'ONLINE') {
      statDeviceStatus.innerHTML = `🟢 ONLINE`;
      statDeviceStatus.className = 'card-value text-success';
    } else {
      statDeviceStatus.innerHTML = `🔴 OFFLINE`;
      statDeviceStatus.className = 'card-value text-muted';
    }

    // Reset Offline Timer on realtime updates
    if (isRealtime) {
      clearTimeout(offlineTimeout);
      offlineTimeout = setTimeout(() => {
        statDeviceStatus.innerHTML = `🔴 OFFLINE`;
        statDeviceStatus.className = 'card-value text-muted';
        showNotification('Perangkat Offline', 'Tidak ada data diterima dari Arduino dalam 10 detik terakhir.', 'fa-solid fa-microchip', 'bg-danger');
      }, 10000);
    }

    // Update Gauge and Progress Bar
    updateGauge(weight);
    updateProgressBar(weight);

    // Update GPS Map and marker
    if (lat !== 0 && lng !== 0) {
      mapLatText.textContent = lat.toFixed(6);
      mapLngText.textContent = lng.toFixed(6);
      
      const newPos = [lat, lng];
      marker.setLatLng(newPos);
      marker.getPopup().setContent(`
        <div style="font-family: Poppins, sans-serif; font-size: 0.8rem;">
          <h6 style="font-weight: 600; margin: 0 0 5px; color:#2563EB;"><i class="fa-solid fa-oil-can me-1"></i>Detail Sensor</h6>
          <b>Berat:</b> ${weight.toFixed(2)} Kg<br>
          <b>Kecepatan:</b> ${speed.toFixed(2)} km/h<br>
          <b>Waktu:</b> ${timestampStr}<br>
          <b>Lat/Lng:</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}
        </div>
      `);
      if (isRealtime) {
        map.panTo(newPos);
      }
    } else {
      mapLatText.textContent = '-';
      mapLngText.textContent = '-';
    }

    // Anomaly Warning Checks
    if (isRealtime && lastWeightValue !== null) {
      const diff = Math.abs(weight - lastWeightValue);
      if (diff >= 1.0) {
        showNotification('Perubahan Berat Drastis', `Perubahan volume minyak terdeteksi sebesar ${diff.toFixed(2)} Kg!`, 'fa-solid fa-triangle-exclamation', 'bg-warning');
      }
    }
    lastWeightValue = weight;

    // Check GPS Disconnect
    if (isRealtime && sat === 0) {
      showNotification('Sinyal GPS Lemah', 'Jumlah satelit 0. Lokasi GPS mungkin tidak akurat.', 'fa-solid fa-circle-exclamation', 'bg-warning');
    }

    // Append to Chart Dataset
    if (isRealtime) {
      const timeLabel = new Date(data.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      chart.data.labels.push(timeLabel);
      chart.data.datasets[0].data.push(weight);

      // Keep only 50 data points
      if (chart.data.labels.length > 50) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
      }
      chart.update('none'); // Update without transition lag
    }
  }

  // 8. Fetch History Data from REST API
  async function fetchHistory(filters = {}) {
    try {
      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.search) queryParams.append('search', filters.search);
      queryParams.append('limit', '50'); // limit logs on screen to 50

      const response = await fetch(`/api/history?${queryParams.toString()}`);
      const result = await response.json();
      
      const data = result.data || [];
      activeDataList = data; // Cache values for Excel export
      
      // Populate Table
      logTableBody.innerHTML = '';
      if (data.length === 0) {
        logTableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Tidak ada data ditemukan.</td></tr>';
        return;
      }

      data.forEach((row, idx) => {
        const timeStr = new Date(row.timestamp).toLocaleString('id-ID');
        let badgeClass = 'bg-secondary';
        if (row.status === 'ONLINE') {
          badgeClass = 'bg-success';
        } else if (row.status === 'THEFT_DETECTED') {
          badgeClass = 'bg-danger';
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td>${timeStr}</td>
          <td><span class="badge bg-light text-dark fw-bold border">${row.weight.toFixed(2)} Kg</span></td>
          <td><span class="fs-8 text-muted">${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}</span></td>
          <td>${row.speed.toFixed(1)} km/h</td>
          <td><span class="text-warning"><i class="fa-solid fa-satellite me-1"></i>${row.satellite}</span></td>
          <td><span class="badge ${badgeClass}">${row.status}</span></td>
        `;
        logTableBody.appendChild(tr);
      });

      // Update charts/gauge with the most recent item if it exists
      if (data.length > 0 && !filters.startDate && !filters.endDate && !filters.search) {
        const latestRow = data[0];
        updateWidgets(latestRow, false);
        
        // Also pre-fill the chart with the fetched historical records (up to 50, in chronological order)
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        const reversedHistory = [...data].reverse().slice(-50);
        reversedHistory.forEach(row => {
          const timeLabel = new Date(row.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          chart.data.labels.push(timeLabel);
          chart.data.datasets[0].data.push(row.weight);
        });
        chart.update();
      }

    } catch (error) {
      console.error('Gagal mengambil data riwayat:', error);
    } finally {
      // Dismiss Loading Overlay on first query completion
      if (!loadingOverlay.classList.contains('fade-out')) {
        loadingOverlay.classList.add('fade-out');
      }
    }
  }

  // 9. Socket.IO Connection and Broadcast listeners
  function initSocketIO() {
    socket = io({
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      socketBadge.innerHTML = '<span class="pulse-dot"></span> Socket: Connected';
      socketBadge.className = 'badge-status online';
    });

    socket.on('disconnect', () => {
      socketBadge.innerHTML = '<span class="pulse-dot"></span> Socket: Disconnected';
      socketBadge.className = 'badge-status offline';
    });

    socket.on('mqtt_status', (status) => {
      if (status.connected) {
        mqttBadge.innerHTML = '<span class="pulse-dot"></span> MQTT: Connected';
        mqttBadge.className = 'badge-status online';
      } else {
        mqttBadge.innerHTML = '<span class="pulse-dot"></span> MQTT: Disconnected';
        mqttBadge.className = 'badge-status offline';
      }
    });

    // Realtime Incoming Telemetry
    socket.on('sensor_data', (data) => {
      // Update widgets in real-time
      updateWidgets(data, true);
      
      // Refresh current table log
      const filters = {
        startDate: filterStart.value,
        endDate: filterEnd.value,
        search: filterSearch.value
      };
      fetchHistory(filters);
    });

    socket.on('mqtt_error', (error) => {
      showNotification('Kesalahan MQTT', error.message, 'fa-solid fa-triangle-exclamation', 'bg-danger');
    });
  }

  // 10. Filter Form Submission
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const filters = {
      startDate: filterStart.value,
      endDate: filterEnd.value,
      search: filterSearch.value
    };
    fetchHistory(filters);
  });

  // 11. Theme Toggling (Light / Dark)
  themeToggleBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    const themeStr = isDarkMode ? 'dark' : 'light';
    
    // Set theme parameters
    document.documentElement.setAttribute('data-theme', themeStr);
    document.querySelector('meta[name="color-scheme"]').content = isDarkMode ? 'dark' : 'light dark';
    localStorage.setItem('color-scheme', themeStr);

    // Update Toggle Icon
    themeToggleBtn.innerHTML = isDarkMode ? '<i class="fa-solid fa-sun text-warning"></i>' : '<i class="fa-solid fa-moon"></i>';
    
    // Update Map tiles theme
    if (map) {
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          map.removeLayer(layer);
        }
      });
      const tileUrl = isDarkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      L.tileLayer(tileUrl, { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    }

    // Update Chart theme grids
    if (chart) {
      const gridColor = isDarkMode ? '#334155' : '#E2E8F0';
      const textColor = isDarkMode ? '#94A3B8' : '#64748B';
      chart.options.scales.x.grid.color = gridColor;
      chart.options.scales.y.grid.color = gridColor;
      chart.options.scales.x.ticks.color = textColor;
      chart.options.scales.y.ticks.color = textColor;
      chart.update();
    }
  });

  // Apply visual button icon based on initial theme on load
  if (isDarkMode) {
    themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun text-warning"></i>';
  }

  // 12. Export to Excel (CSV format)
  btnExportExcel.addEventListener('click', () => {
    if (activeDataList.length === 0) {
      showNotification('Ekspor Gagal', 'Tidak ada data untuk diekspor.', 'fa-solid fa-circle-info', 'bg-warning');
      return;
    }

    // CSV Header
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'No,Timestamp,Weight (Kg),Latitude,Longitude,Speed (km/h),Satellite,Status\n';

    // CSV Body rows
    activeDataList.forEach((row, index) => {
      const time = new Date(row.timestamp).toLocaleString('id-ID');
      const weight = row.weight.toFixed(2);
      const lat = row.latitude;
      const lng = row.longitude;
      const speed = row.speed.toFixed(1);
      const sat = row.satellite;
      const status = row.status;

      csvContent += `${index + 1},"${time}",${weight},${lat},${lng},${speed},${sat},${status}\n`;
    });

    // Create dynamic download link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `smart_oil_tracker_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('Ekspor Sukses', 'Berkas CSV untuk Excel berhasil diunduh.', 'fa-solid fa-file-excel', 'bg-success');
  });

  // 13. Export to PDF (Triggers Print layout)
  btnExportPdf.addEventListener('click', () => {
    window.print();
  });

  // Initialization Sequence
  initChart();
  initMap();
  initSocketIO();
  fetchHistory(); // Triggers loadingoverlay hide
});
