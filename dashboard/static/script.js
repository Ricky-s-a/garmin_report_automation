let map;
let polyline;
let analysisChart;
let trendChart;
let trendPaceHRChart;
let trendCadenceChart;
let globalActivities = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchActivities();
    setupNavigation();
});

function setupNavigation() {
    const btnSingle = document.getElementById('btn-single');
    const btnTrends = document.getElementById('btn-trends');

    const btnTrail = document.getElementById('btn-trail');

    btnSingle.addEventListener('click', () => {
        btnSingle.classList.add('active');
        btnTrends.classList.remove('active');
        btnTrail.classList.remove('active');
        document.getElementById('trends-view').classList.add('hidden');
        document.getElementById('trail-view').classList.add('hidden');
        if (document.querySelectorAll('.activity-item.active').length > 0) {
            document.getElementById('dashboard-view').classList.remove('hidden');
            document.getElementById('welcome-message').classList.add('hidden');
        } else {
            document.getElementById('dashboard-view').classList.add('hidden');
            document.getElementById('welcome-message').classList.remove('hidden');
        }
    });

    btnTrends.addEventListener('click', () => {
        btnTrends.classList.add('active');
        btnSingle.classList.remove('active');
        btnTrail.classList.remove('active');
        document.getElementById('welcome-message').classList.add('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
        document.getElementById('trail-view').classList.add('hidden');
        document.getElementById('trends-view').classList.remove('hidden');
        renderTrends('weekly');
    });

    btnTrail.addEventListener('click', () => {
        btnTrail.classList.add('active');
        btnSingle.classList.remove('active');
        btnTrends.classList.remove('active');
        document.getElementById('welcome-message').classList.add('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
        document.getElementById('trends-view').classList.add('hidden');
        document.getElementById('trail-view').classList.remove('hidden');
        renderTrailCalculator();
    });

    const toggleHeaderBtn = document.getElementById('btn-toggle-header');
    const headerContent = document.getElementById('sidebar-header-content');
    if (toggleHeaderBtn && headerContent) {
        toggleHeaderBtn.addEventListener('click', () => {
            if (headerContent.style.display === 'none') {
                headerContent.style.display = 'block';
                toggleHeaderBtn.textContent = '▲';
            } else {
                headerContent.style.display = 'none';
                toggleHeaderBtn.textContent = '▼';
            }
        });
    }

    // Horizontal Mobile Sidebar Toggle
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    if (btnToggleSidebar && sidebar && sidebarOverlay) {
        btnToggleSidebar.addEventListener('click', () => {
            sidebar.classList.add('open');
            sidebarOverlay.classList.add('active');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = globalActivities.filter(act => {
                const nameMatch = (act.activityName || '').toLowerCase().includes(term);
                const descMatch = (act.description || '').toLowerCase().includes(term);
                return nameMatch || descMatch;
            });
            renderSidebar(filtered);
        });
    }

    const btnSync = document.getElementById('btn-sync');
    const syncStatus = document.getElementById('sync-status');
    let syncInterval;

    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            btnSync.disabled = true;
            syncStatus.style.display = 'block';
            syncStatus.style.color = '#64748b';
            syncStatus.textContent = '';

            // show spinner
            btnSync.innerHTML = `<span class="ai-spinner" style="border-color: rgba(255,255,255,0.3); border-top-color: white;"></span> Syncing... <span id="sync-timer">0.0s</span>`;

            const startTime = Date.now();
            syncInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const timerEl = document.getElementById('sync-timer');
                if (timerEl) {
                    timerEl.textContent = elapsed.toFixed(1) + 's';
                }
            }, 100);

            try {
                const response = await fetch('/api/sync', { method: 'POST' });
                const data = await response.json();

                if (response.ok) {
                    syncStatus.style.color = '#10b981';
                    syncStatus.textContent = `Success! Fetched ${data.fetched} new activities.`;
                    await fetchActivities(); // Reload list
                } else {
                    syncStatus.style.color = '#ef4444';
                    syncStatus.textContent = `Error: ${data.detail || 'Failed to sync'}`;
                }
            } catch (e) {
                syncStatus.style.color = '#ef4444';
                syncStatus.textContent = `Error: ${e.message}`;
            } finally {
                clearInterval(syncInterval);
                btnSync.innerHTML = `🔄 Sync with Garmin`;
                btnSync.disabled = false;
                setTimeout(() => {
                    syncStatus.style.display = 'none';
                }, 5000); // Hide after 5 seconds
            }
        });
    }
}

// Utility to format seconds into MM:SS
function formatTime(seconds) {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Utility to calculate Pace (min/km) from speed (m/s)
function speedToPace(speedMs) {
    if (!speedMs || speedMs <= 0) return "--:--";
    const minsPerKm = 1000 / speedMs / 60;
    const m = Math.floor(minsPerKm);
    const s = Math.floor((minsPerKm - m) * 60).toString().padStart(2, '0');
    return `${m}'${s}" /km`;
}

// Fetch Master List
async function fetchActivities() {
    try {
        const response = await fetch('/api/activities');
        globalActivities = await response.json();
        renderSidebar(globalActivities);
    } catch (e) {
        console.error("Failed to load activities", e);
    }
}

// Render Sidebar List
function renderSidebar(activities) {
    const listEl = document.getElementById('activities-list');
    listEl.innerHTML = '';

    if (activities.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; color: #64748b; font-size: 0.9rem;">No matching runs found.</div>';
        return;
    }

    activities.forEach(act => {
        const item = document.createElement('div');
        item.className = 'activity-item';

        const distKm = (act.distance / 1000).toFixed(2);
        const dateStr = act.startTimeLocal.substring(0, 10);

        let descHtml = '';
        if (act.description && act.description.trim() !== '') {
            const truncated = act.description.length > 50 ? act.description.substring(0, 50) + '...' : act.description;
            descHtml = `<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 6px; font-style: italic; white-space: normal; line-height: 1.3;">${truncated}</div>`;
        }

        item.innerHTML = `
            <div class="activity-title">${act.activityName || 'Running'}</div>
            <div class="activity-meta">
                <span>${dateStr}</span>
                <span>${distKm} km</span>
            </div>
            ${descHtml}
        `;

        item.addEventListener('click', () => {
            document.querySelectorAll('.activity-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            loadActivityDetails(act, activities);

            // Close mobile sidebar if open
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            }
        });

        listEl.appendChild(item);
    });
}



// Load Selected View
async function loadActivityDetails(activity, allActivities) {
    document.getElementById('welcome-message').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');

    // Update Header
    document.getElementById('run-title').textContent = activity.activityName || 'Running';
    document.getElementById('run-date').textContent = activity.startTimeLocal;

    // Show Notes if any
    const notesSection = document.getElementById('notes-section');
    const notesContent = document.getElementById('run-notes');
    if (activity.description && activity.description.trim() !== '') {
        notesContent.textContent = activity.description;
        notesSection.classList.remove('hidden');
    } else {
        notesSection.classList.add('hidden');
    }



    // Setup AI Analysis Button
    const aiContent = document.getElementById('ai-analysis-content');
    aiContent.innerHTML = `<button id="btn-generate-ai" class="btn" style="background: #8b5cf6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;">Generate AI Analysis</button>`;

    document.getElementById('btn-generate-ai').addEventListener('click', async () => {
        let seconds = 0;
        const timerId = setInterval(() => {
            seconds++;
            const timerSpan = document.getElementById('ai-timer');
            if (timerSpan) timerSpan.textContent = seconds;
        }, 1000);

        aiContent.innerHTML = `
            <div class="ai-loader-container">
                <div class="ai-spinner"></div>
                <div class="ai-loader-text">
                    Analyzing data using Google Gemini... (<span id="ai-timer">0</span>s elapsed)
                </div>
            </div>
        `;

        try {
            const res = await fetch(`/api/activities/${activity.activityId}/analysis`);
            const data = await res.json();
            clearInterval(timerId);

            if (res.ok && data.analysis) {
                // simple markdown fallback to HTML
                let html = data.analysis;
                html = html.replace(/\n\n/g, '<br><br>');
                html = html.replace(/\n/g, '<br/>');
                html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
                html = html.replace(/#(.*?)(<br\/>|$)/g, '<h4><strong>$1</strong></h4>'); // poor man's heading parsing
                aiContent.innerHTML = `<div style="line-height: 1.6; font-size: 0.95rem; background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; color: #334155;">${html}</div>`;
            } else {
                aiContent.innerHTML = `<p style="color: red;">Error generating analysis: ${data.detail || 'Unknown error'}</p>`;
            }
        } catch (e) {
            clearInterval(timerId);
            aiContent.innerHTML = `<p style="color: red;">Error generating analysis: ${e.message}</p>`;
        }
    });

    // Update Metrics
    document.getElementById('val-distance').textContent = (activity.distance / 1000).toFixed(2) + ' km';
    document.getElementById('val-pace').textContent = speedToPace(activity.averageSpeed);
    document.getElementById('val-time').textContent = formatTime(activity.duration);
    document.getElementById('val-hr').textContent = Math.round(activity.averageHR || 0) + ' bpm';

    try {
        // Fetch GPX Data Points for Map and Chart
        const response = await fetch(`/api/activities/${activity.activityId}/gpx`);
        const points = await response.json();

        updateMap(points);
        updateChart(points);
    } catch (e) {
        console.error("Failed to load GPX data for activity", e);
    }
}

// Update Map (Leaflet)
function updateMap(points) {
    const coords = points.filter(p => p.latitude && p.longitude).map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);

    if (!map) {
        map = L.map('map').setView([0, 0], 2);
        // Bright styling for the map
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
        }).addTo(map);
    }

    if (polyline) {
        polyline.remove();
    }

    if (coords.length > 0) {
        polyline = L.polyline(coords, { color: '#0284c7', weight: 4, opacity: 0.8 }).addTo(map);
        map.fitBounds(polyline.getBounds());
    }
}

// Update Chart (Chart.js)
function updateChart(points) {
    const validPoints = points.filter(p => parseFloat(p.heartRate) > 0);

    const labels = validPoints.map(p => p.time.substring(11, 16));
    const hrData = validPoints.map(p => parseFloat(p.heartRate));
    const eleData = validPoints.map(p => parseFloat(p.elevation));

    const ctx = document.getElementById('analysisChart').getContext('2d');

    if (analysisChart) {
        analysisChart.destroy();
    }

    analysisChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Heart Rate (bpm)',
                    data: hrData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    yAxisID: 'y',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0
                },
                {
                    label: 'Elevation (m)',
                    data: eleData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            color: '#475569',
            scales: {
                x: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { maxTicksLimit: 10, color: '#64748b' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    title: { display: true, text: 'Heart Rate', color: '#64748b' },
                    ticks: { color: '#64748b' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Elevation', color: '#64748b' },
                    ticks: { color: '#64748b' }
                }
            },
            plugins: {
                legend: { labels: { color: '#475569' } }
            }
        }
    });
}

// ============== Trends Analysis ============== //
function renderTrends(period) {
    // period options: 'weekly', 'monthly', 'yearly'

    // Update pill activation
    document.querySelectorAll('.pill-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`pill-${period}`).classList.add('active');

    if (!globalActivities || globalActivities.length === 0) return;

    // Filter to only consider runs with a valid distance
    const validActivities = globalActivities.filter(a => parseFloat(a.distance) > 0);

    // Reverse because activities are sorted latest first, and we want Oldest -> Newest on the x-axis for trends
    const dataReversed = [...validActivities].reverse();

    // Grouping structure
    const grouped = {};
    let totalDistKm = 0;
    let sumCadence = 0, cadenceCount = 0;
    let sumSpeed = 0, speedCount = 0;
    let sumStride = 0, strideCount = 0;

    dataReversed.forEach(act => {
        // Safe cross-browser date parsing for "YYYY-MM-DD HH:MM:SS"
        let dateStr = act.startTimeLocal || '';
        if (dateStr.includes(' ')) {
            dateStr = dateStr.replace(' ', 'T');
        }
        const d = new Date(dateStr);

        if (isNaN(d.getTime())) return; // Skip invalid dates

        let key = '';

        if (period === 'weekly') {
            const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
            const pastDaysOfYear = (d - firstDayOfYear) / 86400000;
            const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
            key = `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
        } else if (period === 'monthly') {
            key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        } else if (period === 'yearly') {
            key = `${d.getFullYear()}`;
        }

        if (!grouped[key]) {
            grouped[key] = {
                distanceKm: 0,
                count: 0,
                hrSum: 0,
                cadenceSum: 0,
                speedSum: 0,
                strideSum: 0,
                validHrCount: 0,
                validCadenceCount: 0,
                validSpeedCount: 0,
                validStrideCount: 0
            };
        }

        const distKm = parseFloat(act.distance) / 1000;
        grouped[key].distanceKm += distKm;
        grouped[key].count += 1;
        totalDistKm += distKm;

        // HR
        const hr = parseFloat(act.averageHR);
        if (hr > 0) {
            grouped[key].hrSum += hr;
            grouped[key].validHrCount += 1;
        }

        // Cadence (ensure spm representation 160-190 instead of half)
        let cad = parseFloat(act.averageRunningCadenceInStepsPerMinute) || 0;
        if (cad > 0) {
            cad = cad < 100 ? cad * 2 : cad;
            grouped[key].cadenceSum += cad;
            grouped[key].validCadenceCount += 1;

            // Global average
            sumCadence += cad;
            cadenceCount += 1;
        }

        // Stride Length (cm to m translation usually handled by Garmin, check usually it's around 0.8 - 1.5 meters)
        let stride = parseFloat(act.avgStrideLength) || 0;
        // Sometimes Garmin API returns stride length in cm (e.g., 95.0), sometimes in meters (e.g., 0.95). Normalize to meters.
        if (stride > 20) { stride = stride / 100; }

        if (stride > 0) {
            grouped[key].strideSum += stride;
            grouped[key].validStrideCount += 1;
            sumStride += stride;
            strideCount += 1;
        }

        // Speed / Pace
        const spd = parseFloat(act.averageSpeed);
        if (spd > 0) {
            grouped[key].speedSum += spd;
            grouped[key].validSpeedCount += 1;

            // Global average
            sumSpeed += spd;
            speedCount += 1;
        }
    });

    const labels = Object.keys(grouped);
    const distances = labels.map(key => grouped[key].distanceKm);

    // Averages data for charts
    const hrAverages = labels.map(key => grouped[key].validHrCount > 0 ? (grouped[key].hrSum / grouped[key].validHrCount).toFixed(1) : null);
    const cadenceAverages = labels.map(key => grouped[key].validCadenceCount > 0 ? (grouped[key].cadenceSum / grouped[key].validCadenceCount).toFixed(1) : null);
    const strideAverages = labels.map(key => grouped[key].validStrideCount > 0 ? (grouped[key].strideSum / grouped[key].validStrideCount).toFixed(2) : null);
    const paceMinsPerKm = labels.map(key => {
        if (grouped[key].validSpeedCount === 0) return null;
        const avgSpeedMs = grouped[key].speedSum / grouped[key].validSpeedCount;
        return (1000 / avgSpeedMs / 60).toFixed(2); // purely numeric for chart e.g 4.5
    });

    // Update Summary Stats
    document.getElementById('trend-dist').textContent = totalDistKm.toFixed(1) + ' km';
    document.getElementById('trend-count').textContent = dataReversed.length;

    if (cadenceCount > 0) {
        document.getElementById('trend-cadence').textContent = (sumCadence / cadenceCount).toFixed(0) + ' spm';
    }
    if (speedCount > 0) {
        const avgPace = speedToPace(sumSpeed / speedCount);
        const avgStride = strideCount > 0 ? (sumStride / strideCount).toFixed(2) + 'm' : '--';
        document.getElementById('trend-pace').textContent = `${avgStride} / ${avgPace}`;
    }

    // --- Volume Chart ---
    const ctx1 = document.getElementById('trendChart').getContext('2d');
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Volume (km)',
                data: distances,
                backgroundColor: '#0ea5e9',
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, color: '#475569',
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });

    // --- Pace & HR Chart ---
    const ctx2 = document.getElementById('trendPaceHRChart').getContext('2d');
    if (trendPaceHRChart) trendPaceHRChart.destroy();

    trendPaceHRChart = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Avg Heart Rate (bpm)',
                    data: hrAverages,
                    borderColor: '#ef4444',
                    backgroundColor: '#ef4444',
                    yAxisID: 'y',
                    tension: 0.3,
                    spanGaps: true
                },
                {
                    label: 'Avg Pace (min/km)',
                    data: paceMinsPerKm,
                    borderColor: '#10b981',
                    backgroundColor: '#10b981',
                    yAxisID: 'y1',
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, color: '#475569',
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false } },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Heart Rate' } },
                // Reverse the Pace axis because lower is faster
                y1: { type: 'linear', display: true, position: 'right', reverse: true, title: { display: true, text: 'Pace (min/km)' }, grid: { drawOnChartArea: false } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            if (context.datasetIndex === 1) { // Pace
                                const val = context.parsed.y;
                                const m = Math.floor(val);
                                const s = Math.floor((val - m) * 60).toString().padStart(2, '0');
                                return `Avg Pace: ${m}'${s}" /km`;
                            }
                            return `Avg HR: ${context.parsed.y} bpm`;
                        }
                    }
                }
            }
        }
    });

    // --- Cadence & Stride Chart ---
    const ctx3 = document.getElementById('trendCadenceChart').getContext('2d');
    if (trendCadenceChart) trendCadenceChart.destroy();

    trendCadenceChart = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Avg Cadence (spm)',
                    data: cadenceAverages,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    fill: false,
                    tension: 0.3,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Avg Stride Length (m)',
                    data: strideAverages,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    fill: false,
                    tension: 0.3,
                    spanGaps: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, color: '#475569',
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false } },
                y: { min: 140, max: 200, title: { display: true, text: 'Steps Per Minute' }, position: 'left' },
                y1: { min: 0.5, max: 2.0, title: { display: true, text: 'Stride Length (m)' }, position: 'right', grid: { drawOnChartArea: false } }
            },
            plugins: {
                legend: { display: true, labels: { color: '#475569' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            if (context.datasetIndex === 0) return `Avg Cadence: ${context.parsed.y} spm`;
                            if (context.datasetIndex === 1) return `Avg Stride: ${context.parsed.y} m`;
                        }
                    }
                }
            }
        }
    });
}

// ============== Trail Pace Calculator ============== //
let trailRegressionModel = { a: 0, b: 0 }; // Pace = a * Elev/km + b
let trailDataPoints = [];
let trailChartInstance = null;

const trailPresets = {
    "kumotori": { name: "雲取山", dist: 20, elev: 1400 },
    "hirubiston": { name: "ヒルビストン", dist: 25, elev: 2469 },
    "tanzawa": { name: "丹沢ケルベロス", dist: 30, elev: 2500 },
    "takao": { name: "高尾マンモス", dist: 35, elev: 2000 },
    "tarasaru": { name: "トラサル", dist: 40, elev: 2800 },
    "gaireen": { name: "ガイリーン", dist: 50, elev: 3000 },
    "mtfuji": { name: "Mt.Fuji Kai", dist: 70, elev: 3400 }
};

document.getElementById('trail-presets').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val && trailPresets[val]) {
        document.getElementById('trail-target-dist').value = trailPresets[val].dist;
        document.getElementById('trail-target-elev').value = trailPresets[val].elev;
    }
    calculateTrailTime();
});

document.getElementById('trail-target-dist')?.addEventListener('input', calculateTrailTime);
document.getElementById('trail-target-elev')?.addEventListener('input', calculateTrailTime);

document.getElementById('trail-filter-elev')?.addEventListener('change', renderTrailCalculator);
document.getElementById('trail-filter-pace')?.addEventListener('change', renderTrailCalculator);

function renderTrailCalculator() {
    if (!globalActivities || globalActivities.length === 0) return;

    trailDataPoints = [];

    const minElev = parseFloat(document.getElementById('trail-filter-elev')?.value || 30);
    const maxPaceMinKm = parseFloat(document.getElementById('trail-filter-pace')?.value || 20);

    // Detect trail runs: Elevation >= minElev per 1km AND distance > 1km
    const trailRuns = globalActivities.filter(act => {
        const distKm = (act.distance || 0) / 1000;
        const elevM = act.elevationGain || 0;
        if (distKm < 1 || !act.duration) return false;

        const nameLower = (act.activityName || '').toLowerCase();
        const isTrailName = nameLower.includes('トレラン') || nameLower.includes('trail') || nameLower.includes('トレイル');
        const isHilly = (elevM / distKm) >= minElev;

        const paceSecKm = act.duration / distKm;
        const paceMinKm = paceSecKm / 60;

        if (paceMinKm <= maxPaceMinKm && (isTrailName || isHilly)) {
            // Plot x = Elev/Km, y = pace in sec/km
            const x = elevM / distKm;
            const paceSecKm = act.duration / distKm;
            trailDataPoints.push({
                x: x,
                y: paceSecKm,
                name: act.activityName || `Run (${distKm.toFixed(1)}k)`,
                dist: distKm,
                duration: act.duration
            });
            return true;
        }
        return false;
    });

    document.getElementById('trail-base-count').textContent = trailRuns.length;

    // Calculate Linear Regression: y = ax + b
    if (trailDataPoints.length > 1) {
        let n = trailDataPoints.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        trailDataPoints.forEach(p => {
            sumX += p.x;
            sumY += p.y;
            sumXY += (p.x * p.y);
            sumXX += (p.x * p.x);
        });

        const meanX = sumX / n;
        const meanY = sumY / n;

        const numerator = sumXY - n * meanX * meanY;
        const denominator = sumXX - n * meanX * meanX;

        if (denominator !== 0) {
            const a = numerator / denominator;
            const b = meanY - a * meanX;
            trailRegressionModel.a = a;
            trailRegressionModel.b = b;
        } else {
            // fallback
            trailRegressionModel.a = 0;
            trailRegressionModel.b = meanY;
        }
        document.getElementById('trail-regression-formula').textContent = `Pace (s/km) = ${trailRegressionModel.a.toFixed(2)} * 上昇高度(m/km) + ${trailRegressionModel.b.toFixed(2)}`;
    } else {
        document.getElementById('trail-regression-formula').textContent = 'Not enough data points';
    }

    calculateTrailTime();
}

document.getElementById('btn-calc-trail').addEventListener('click', calculateTrailTime);

function calculateTrailTime() {
    const targetDistKm = parseFloat(document.getElementById('trail-target-dist').value || 0);
    const targetElevM = parseFloat(document.getElementById('trail-target-elev').value || 0);

    const effortDistKm = targetDistKm + (targetElevM / 100);
    document.getElementById('trail-effort-dist').textContent = effortDistKm.toFixed(1) + ' km';

    if (trailRegressionModel.a === 0 && trailRegressionModel.b === 0) return;
    if (targetDistKm <= 0) return;

    // x = predicted Elev/km
    const targetX = targetElevM / targetDistKm;

    // y = predicted pace (sec/km)
    const predPaceSec = trailRegressionModel.a * targetX + trailRegressionModel.b;

    // total pred time in sec
    const predDurationS = predPaceSec * targetDistKm;

    // HH:MM:SS
    const h = Math.floor(predDurationS / 3600);
    const m = Math.floor((predDurationS % 3600) / 60);
    const s = Math.floor(predDurationS % 60);
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    document.getElementById('trail-pred-time').textContent = `${hStr}:${mStr}:${sStr}`;

    // predicted actual avg pace
    const actualPaceMs = (targetDistKm * 1000) / predDurationS;
    document.getElementById('trail-pred-pace').textContent = speedToPace(actualPaceMs);

    drawTrailChart(targetX, predPaceSec, document.getElementById('trail-target-dist').value, document.getElementById('trail-presets').options[document.getElementById('trail-presets').selectedIndex].text);
}

function drawTrailChart(targetX, predPaceSec, targetDist, raceName) {
    const ctx = document.getElementById('trailPredictionChart').getContext('2d');
    if (trailChartInstance) trailChartInstance.destroy();

    // Line data
    let minX = Math.min(...trailDataPoints.map(p => p.x));
    let maxX = Math.max(...trailDataPoints.map(p => p.x), targetX);
    // Add some padding
    minX = Math.max(0, minX - 10);
    maxX = maxX + 10;

    const linePoints = [
        { x: minX, y: trailRegressionModel.a * minX + trailRegressionModel.b },
        { x: maxX, y: trailRegressionModel.a * maxX + trailRegressionModel.b }
    ];

    const scatterData = trailDataPoints.map(p => ({ x: p.x, y: p.y, name: p.name, dist: p.dist }));

    // Format Y axis (sec to HH:MM:SS for tooltip and labels)
    const formatY = (val) => {
        const h = Math.floor(val / 3600);
        const m = Math.floor((val % 3600) / 60);
        const s = Math.floor(val % 60);
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
    };

    let predictedLabel = "Prediction";
    if (raceName && raceName !== "-- 手動で入力 --") {
        predictedLabel = raceName;
    }

    trailChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: '過去のトレラン実測値',
                    data: scatterData,
                    backgroundColor: '#0284c7',
                    pointRadius: 6,
                    pointHoverRadius: 8
                },
                {
                    label: predictedLabel,
                    data: [{ x: targetX, y: predPaceSec, name: predictedLabel, dist: targetDist }],
                    backgroundColor: '#ef4444',
                    pointStyle: 'rectRot',
                    pointRadius: 10,
                    pointHoverRadius: 12
                },
                {
                    label: '予測モデル (回帰直線)',
                    data: linePoints,
                    type: 'line',
                    borderColor: '#94a3b8',
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            color: '#475569',
            scales: {
                x: {
                    title: { display: true, text: '上昇高度 (m/km)' },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    title: { display: true, text: 'ペース (hh:mm:ss / km)' },
                    ticks: {
                        callback: function (value) { return formatY(value); }
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            if (context.datasetIndex === 2) return null; // no tooltip for line
                            const p = context.raw;
                            return `${p.name} | D+: ${p.x.toFixed(1)}m/km | Pace: ${formatY(p.y)}/km`;
                        }
                    }
                }
            }
        }
    });
}
