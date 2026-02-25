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

    btnSingle.addEventListener('click', () => {
        btnSingle.classList.add('active');
        btnTrends.classList.remove('active');
        document.getElementById('trends-view').classList.add('hidden');
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
        document.getElementById('welcome-message').classList.add('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
        document.getElementById('trends-view').classList.remove('hidden');
        renderTrends('weekly');
    });

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
        });

        listEl.appendChild(item);
    });
}

// Sub-3 and Coach Insights Logic
function calculateInsights(activity, allActivities) {
    // 1. Sub-3 Marathon Analysis
    // Sub 3 pace is ~4:15 min/km (approx 3.92 m/s)
    const targetSpeedMs = 3.92;
    const currentSpeed = activity.averageSpeed || 0;
    const currentPaceStr = speedToPace(currentSpeed);

    const sub3MsgEl = document.getElementById('intel-sub3-msg');
    const sub3StatEl = document.getElementById('intel-sub3-stat');

    if (currentSpeed >= targetSpeedMs) {
        sub3MsgEl.textContent = "Excellent! You are running faster than Sub-3 target pace. Make sure your HR stays below Lactate Threshold (LT ~161bpm) at this pace to build fatigue resistance.";
        sub3StatEl.textContent = `Pace: ${currentPaceStr} (Target: < 4'15"/km) - On Track 🔥`;
        sub3StatEl.style.color = 'var(--color-success)';
    } else {
        const diff = (targetSpeedMs - currentSpeed).toFixed(2);
        sub3MsgEl.textContent = "To reach Sub-3, focus on improving your Lactate Threshold. Introduce 1-2 interval/tempo sessions (e.g. 1km repeats at 4'00\"/km) per week while keeping easy runs deeply aerobic.";
        sub3StatEl.textContent = `Pace: ${currentPaceStr} (Target: ~4'15"/km)`;
        sub3StatEl.style.color = 'var(--color-text)';
    }

    // 2. Injury Prevention (Cadence / Stride)
    const avgCadence = activity.averageRunningCadenceInStepsPerMinute || (activity.averageRunningCadenceInStepsPerMinute * 2) || 0; // sometimes half
    let actualCadence = avgCadence > 100 ? avgCadence : avgCadence * 2;
    const injuryMsgEl = document.getElementById('intel-injury-msg');

    if (actualCadence > 0 && actualCadence < 165) {
        injuryMsgEl.innerHTML = `Your cadence is <strong>${actualCadence} spm</strong>. Overstriding detected! Low cadence increases impact forces on your knees and hips. Try taking shorter, quicker steps to reach 170-180 spm.`;
    } else if (actualCadence >= 165) {
        injuryMsgEl.innerHTML = `Optimal cadence detected (<strong>${actualCadence} spm</strong>). This reduces ground contact time and lower leg stress. Keep it up to prevent injuries!`;
    } else {
        injuryMsgEl.innerHTML = "Not enough cadence data to analyze impact risk. Ensure your watch is snug on your wrist or use a chest strap.";
    }

    // 3. Fatigue & Recovery (Training Effect / HR)
    const teAerobic = parseFloat(activity.aerobicTrainingEffect) || 0;
    const teAnaerobic = parseFloat(activity.anaerobicTrainingEffect) || 0;
    const recoveryMsgEl = document.getElementById('intel-recovery-msg');

    if (teAerobic > 4.0 || teAnaerobic > 3.0) {
        recoveryMsgEl.innerHTML = `⚠️ <strong>High Load Alert:</strong> Aerobic TE ${teAerobic}, Anaerobic ${teAnaerobic}. This was a highly demanding session. Ensure 48 hours to recover or do very light cross-training. Check HRV morning readiness.`;
    } else if (teAerobic >= 2.0 && teAerobic <= 3.9) {
        recoveryMsgEl.innerHTML = `✅ <strong>Base Maintenance:</strong> Good aerobic stimulus (TE ${teAerobic}). You are actively building your "Antifragile Engine" without causing excessive metabolic fatigue.`;
    } else {
        recoveryMsgEl.innerHTML = `🔋 <strong>Active Recovery:</strong> Minimal strain. Good for flushing legs or tapering. Keep sleep quality high to absorb recent training.`;
    }
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

    // Provide Coach Insights
    calculateInsights(activity, allActivities);

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
