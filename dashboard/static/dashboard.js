let map;
let polyline;
let analysisChart;
let trendChart;
let trendElevationChart;
let trendPaceHRChart;
let trendAeChart;
let trendVo2Chart;
let trendTeChart;
let trendCadenceChart;
let trendFormChart;
let hrZoneChart;
// ... other charts ...
let globalActivities = [];
let appSupabase;
let currentUser = null;
let userMaxHr = null;

// Initialize Supabase from API config
async function initSupabase() {
    const res = await fetch('/api/config');
    const config = await res.json();
    appSupabase = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);

    // Check initial session
    const { data: { session } } = await appSupabase.auth.getSession();
    handleAuthStateChange(session);

    // Listen for auth changes
    appSupabase.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth Event:", event, session?.user?.email);
        handleAuthStateChange(session);
    });
}

function handleAuthStateChange(session) {
    currentUser = session?.user || null;
    const loggedOutSection = document.getElementById('auth-logged-out');
    const loggedInSection = document.getElementById('auth-logged-in');

    console.log("Updating UI for user:", currentUser?.email);

    if (currentUser) {
        if (loggedOutSection) loggedOutSection.classList.add('hidden');
        if (loggedInSection) {
            loggedInSection.classList.remove('hidden');
            loggedInSection.style.display = 'block'; // Force display style
        }

        const metadata = currentUser.user_metadata || {};
        const nameEl = document.getElementById('user-display-name');
        const emailEl = document.getElementById('user-display-email');
        const avatarImg = document.getElementById('user-avatar');

        if (nameEl) nameEl.textContent = metadata.full_name || currentUser.email.split('@')[0];
        if (emailEl) emailEl.textContent = currentUser.email;
        if (avatarImg && metadata.avatar_url) {
            avatarImg.src = metadata.avatar_url;
            avatarImg.style.display = 'block';
        }

        fetchUserSettings();
        fetchActivities();
        fetchUserTrailPresets(); // Fetch user-specific presets
    } else {
        if (loggedOutSection) loggedOutSection.classList.remove('hidden');
        if (loggedInSection) loggedInSection.classList.add('hidden');

        const nameEl = document.getElementById('user-display-name');
        const emailEl = document.getElementById('user-display-email');
        const avatarImg = document.getElementById('user-avatar');
        if (nameEl) nameEl.textContent = '';
        if (emailEl) emailEl.textContent = '';
        if (avatarImg) {
            avatarImg.src = '';
            avatarImg.style.display = 'none';
        }

        userTrailPresets = {}; // Clear memory on logout
        updatePresetDropdown();
    }
    globalActivities = [];
    renderSidebar([]);
}


document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
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

    const btnLoginGoogle = document.getElementById('btn-login-google');
    const btnLogout = document.getElementById('btn-logout');
    const btnShowSettings = document.getElementById('btn-show-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveCredentials = document.getElementById('btn-save-credentials');
    const modal = document.getElementById('settings-modal');

    btnLoginGoogle.addEventListener('click', async () => {
        await appSupabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });
    });

    btnLogout.addEventListener('click', async () => {
        await appSupabase.auth.signOut();
    });

    btnShowSettings.addEventListener('click', async () => {
        modal.classList.remove('hidden');
        if (currentUser) {
            try {
                const res = await fetch(`/api/garmin-credentials?user_id=${encodeURIComponent(currentUser.id)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.garmin_email) {
                        document.getElementById('settings-garmin-email').value = data.garmin_email;
                        document.getElementById('settings-garmin-password').value = '********'; // Masked password
                        document.getElementById('settings-runner-profile').value = data.runner_profile || '';
                        document.getElementById('settings-max-hr').value = data.max_hr || '';
                        // Optional clear status msg
                        document.getElementById('settings-status').textContent = '';
                    }
                }
            } catch (e) {
                console.error("Failed to fetch settings", e);
            }
        }
    });
    btnCloseSettings.addEventListener('click', () => modal.classList.add('hidden'));

    btnSaveCredentials.addEventListener('click', async () => {
        const email = document.getElementById('settings-garmin-email').value;
        const password = document.getElementById('settings-garmin-password').value;
        const profile = document.getElementById('settings-runner-profile').value;
        const maxHrStr = document.getElementById('settings-max-hr').value;
        const mhr = maxHrStr ? parseInt(maxHrStr) : null;
        const status = document.getElementById('settings-status');

        if (!email || !password) {
            status.textContent = "Please fill in all fields.";
            status.style.color = "red";
            return;
        }

        btnSaveCredentials.disabled = true;
        status.textContent = "Saving...";
        status.style.color = "#64748b";

        try {
            const res = await fetch('/api/garmin-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    garmin_email: email,
                    garmin_password: password,
                    runner_profile: profile,
                    max_hr: mhr
                })
            });
            if (res.ok) {
                status.textContent = "Settings saved successfully!";
                userMaxHr = mhr; // update locally
                status.style.color = "green";
                setTimeout(() => modal.classList.add('hidden'), 1500);
            } else {
                status.textContent = "Error saving settings.";
                status.style.color = "red";
            }
        } catch (e) {
            status.textContent = "Error: " + e.message;
            status.style.color = "red";
        } finally {
            btnSaveCredentials.disabled = false;
        }
    });

    const btnDeleteAccount = document.getElementById('btn-delete-account');
    if (btnDeleteAccount) {
        btnDeleteAccount.addEventListener('click', async () => {
            const confirmDelete = confirm("⚠️ 警告: アカウントおよびすべてのランニングデータ(GPX等)が削除されます。この操作は取り消せません。\n本当に削除してよろしいですか？");
            if (!confirmDelete) return;

            const confirmType = prompt("削除を実行するには 'DELETE' と入力してください:");
            if (confirmType !== "DELETE") {
                alert("削除をキャンセルしました。");
                return;
            }

            const status = document.getElementById('settings-status');
            status.textContent = "Deleting account and data...";
            status.style.color = "red";
            btnDeleteAccount.disabled = true;

            try {
                const res = await fetch(`/api/account/${currentUser.id}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    alert("データが正常に削除されました。自動的にサインアウトします。");
                    await supabase.auth.signOut();
                    window.location.reload();
                } else {
                    const data = await res.json();
                    status.textContent = "Error: " + (data.detail || "Could not delete account.");
                    btnDeleteAccount.disabled = false;
                }
            } catch (e) {
                status.textContent = "Error: " + e.message;
                btnDeleteAccount.disabled = false;
            }
        });
    }

    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            if (!currentUser) {
                alert("Please login first.");
                return;
            }
            btnSync.disabled = true;
            syncStatus.style.display = 'block';
            syncStatus.style.color = '#64748b';
            syncStatus.textContent = '';

            btnSync.innerHTML = `<span class="ai-spinner" style="border-color: rgba(255,255,255,0.3); border-top-color: white;"></span> Syncing... <span id="sync-timer">0.0s</span>`;

            const startTime = Date.now();
            syncInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const timerEl = document.getElementById('sync-timer');
                if (timerEl) timerEl.textContent = elapsed.toFixed(1) + 's';
            }, 100);

            try {
                const response = await fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: currentUser.id })
                });
                const data = await response.json();
                // ... handle response ...


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

// Utility to fetch settings early
async function fetchUserSettings() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/garmin-credentials?user_id=${encodeURIComponent(currentUser.id)}`);
        if (res.ok) {
            const data = await res.json();
            userMaxHr = data.max_hr || null;
        }
    } catch (e) { console.error(e); }
}

// Fetch Master List
async function fetchActivities() {
    if (!currentUser) return;
    try {
        const url = `/api/activities?user_id=${encodeURIComponent(currentUser.id)}`;
        const response = await fetch(url);
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



    // Setup AI Analysis Section
    const aiContent = document.getElementById('ai-analysis-content');

    function renderAnalysisHtml(text) {
        let html = text;
        html = html.replace(/\n\n/g, '<br><br>');
        html = html.replace(/\n/g, '<br/>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/#(.*?)(<br\/>|$)/g, '<h4><strong>$1</strong></h4>');
        return html;
    }

    async function runAnalysis(regenerate = false, reportType = "short") {
        const selectedModel = document.getElementById('model-select')?.value || 'gemini-2.5-flash';
        const modelLabel = document.getElementById('model-select')?.options[document.getElementById('model-select').selectedIndex]?.text || selectedModel;

        let seconds = 0;
        const timerId = setInterval(() => {
            seconds++;
            const timerSpan = document.getElementById('ai-timer');
            if (timerSpan) timerSpan.textContent = seconds;
        }, 1000);

        const typeLabel = reportType === "short" ? "短文レポート" : "詳細レポート";
        aiContent.innerHTML = `
            <div class="ai-loader-container">
                <div class="ai-spinner"></div>
                <div class="ai-loader-text">
                    ${typeLabel}を生成中 (${modelLabel}) ... <span id="ai-timer">0</span>s
                </div>
            </div>
        `;

        try {
            let url = `/api/activities/${activity.activityId}/analysis?model=${encodeURIComponent(selectedModel)}&report_type=${reportType}`;
            if (regenerate) url += '&regenerate=true';
            const res = await fetch(url);
            const data = await res.json();
            clearInterval(timerId);

            if (res.ok && data.analysis) {
                if (reportType === 'short') { activity.aiAnalysisShort = data.analysis; activity.usedModelShort = data.model || selectedModel; }
                else { activity.aiAnalysis = data.analysis; activity.usedModelLong = data.model || selectedModel; }
                renderAiSection();
            } else {
                aiContent.innerHTML = `<p style="color: red;">Error generating analysis: ${data.detail || 'Unknown error'}</p>`;
                // Re-render after 3 seconds
                setTimeout(renderAiSection, 3000);
            }
        } catch (e) {
            clearInterval(timerId);
            aiContent.innerHTML = `<p style="color: red;">Error: ${e.message}</p>`;
            setTimeout(renderAiSection, 3000);
        }
    }

    function renderAiSection() {
        let htmlContent = '';

        // Short form UI
        if (activity.aiAnalysisShort) {
            const usedModel = activity.usedModelShort || 'gemini-2.5-flash';
            const html = renderAnalysisHtml(activity.aiAnalysisShort);
            htmlContent += `
                <div style="margin-bottom: 20px;">
                    <div style="display:flex; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
                        <span style="font-weight:700; font-size:0.95rem; color:#1e293b;">📌 短文レポート (Strava風)</span>
                        <span style="font-size:0.75rem; background:#f3e8ff; color:#7c3aed; padding:2px 8px; border-radius:10px;">🤖 ${usedModel}</span>
                        <button id="btn-regen-short" style="margin-left:auto; background:#10b981; color:white; border:none; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">🔄 再生成</button>
                    </div>
                     <details open style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                        <summary style="cursor: pointer; font-weight: 600; padding: 10px 15px; background: #f8fafc; color: #475569; user-select: none; border-bottom: 1px solid #e2e8f0; list-style-position: inside;">短文レポート (展開/折りたたみ)</summary>
                        <div style="line-height:1.6; font-size:0.95rem; padding:15px; color:#334155;">${html}</div>
                    </details>
                </div>
            `;
        } else {
            htmlContent += `
                <div style="margin-bottom: 20px;">
                    <button id="btn-gen-short" style="background:#10b981; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.85rem;">✨ 生成 (短文レポート)</button>
                </div>
            `;
        }

        // Long form UI
        if (activity.aiAnalysis) {
            const usedModel = activity.usedModelLong || 'gemini-2.5-flash';
            const html = renderAnalysisHtml(activity.aiAnalysis);
            htmlContent += `
                <div style="margin-bottom: 10px;">
                    <div style="display:flex; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
                        <span style="font-weight:700; font-size:0.95rem; color:#1e293b;">📑 詳細レポート</span>
                        <span style="font-size:0.75rem; background:#f3e8ff; color:#7c3aed; padding:2px 8px; border-radius:10px;">🤖 ${usedModel}</span>
                        <button id="btn-regen-long" style="margin-left:auto; background:#8b5cf6; color:white; border:none; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">🔄 再生成</button>
                    </div>
                     <details style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                        <summary style="cursor: pointer; font-weight: 600; padding: 10px 15px; background: #f8fafc; color: #475569; user-select: none; border-bottom: 1px solid #e2e8f0; list-style-position: inside;">詳細レポート (展開/折りたたみ)</summary>
                        <div style="line-height:1.6; font-size:0.95rem; padding:15px; color:#334155;">${html}</div>
                    </details>
                </div>
            `;
        } else {
            htmlContent += `
                <div style="margin-bottom: 10px;">
                    <button id="btn-gen-long" style="background:#8b5cf6; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.85rem;">🧠 生成 (詳細レポート)</button>
                </div>
            `;
        }

        aiContent.innerHTML = htmlContent;

        if (document.getElementById('btn-regen-short')) document.getElementById('btn-regen-short').addEventListener('click', () => runAnalysis(true, 'short'));
        if (document.getElementById('btn-gen-short')) document.getElementById('btn-gen-short').addEventListener('click', () => runAnalysis(false, 'short'));

        if (document.getElementById('btn-regen-long')) document.getElementById('btn-regen-long').addEventListener('click', () => runAnalysis(true, 'long'));
        if (document.getElementById('btn-gen-long')) document.getElementById('btn-gen-long').addEventListener('click', () => runAnalysis(false, 'long'));
    }

    // Initial render
    renderAiSection();

    // Update Metrics
    document.getElementById('val-distance').textContent = (activity.distance / 1000).toFixed(2) + ' km';
    document.getElementById('val-pace').textContent = speedToPace(activity.averageSpeed);
    document.getElementById('val-time').textContent = formatTime(activity.duration);
    document.getElementById('val-hr').textContent = Math.round(activity.averageHR || 0) + ' bpm';

    try {
        // Fetch GPX Data Points for Chart
        const response = await fetch(`/api/activities/${activity.activityId}/gpx`);
        const points = await response.json();

        updateChart(points);
        updateHrZoneChart(points);
    } catch (e) {
        console.error("Failed to load GPX data for activity", e);
    }
}

// Map removed from UI

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

// Update HR Zone Chart (Time in Zone)
function updateHrZoneChart(points) {
    const validPoints = points.filter(p => parseFloat(p.heartRate) > 0);
    if (validPoints.length < 2) return;

    let timesInZone = [0, 0, 0, 0, 0]; // Z1..Z5 in seconds

    let baseMaxHr = 185; // Default fallback
    if (userMaxHr && userMaxHr > 0) {
        baseMaxHr = userMaxHr;
    } else {
        // Auto-detect from historical data
        let detected = 0;
        globalActivities.forEach(act => {
            const m = parseFloat(act.maxHR) || 0;
            if (m > detected) detected = m;
        });
        if (detected >= 150) {
            baseMaxHr = detected;
        }
    }

    const z1_top = Math.round(baseMaxHr * 0.60);
    const z2_top = Math.round(baseMaxHr * 0.70);
    const z3_top = Math.round(baseMaxHr * 0.80);
    const z4_top = Math.round(baseMaxHr * 0.90);

    for (let i = 1; i < validPoints.length; i++) {
        const prev = validPoints[i - 1];
        const curr = validPoints[i];

        const t1 = new Date(prev.time).getTime();
        const t2 = new Date(curr.time).getTime();
        let dt = (t2 - t1) / 1000;

        // Ignore large gaps > 5 mins
        if (dt > 300 || dt < 0) dt = 0;

        const hr = parseFloat(curr.heartRate);

        if (hr < z1_top) timesInZone[0] += dt;
        else if (hr < z2_top) timesInZone[1] += dt;
        else if (hr < z3_top) timesInZone[2] += dt;
        else if (hr < z4_top) timesInZone[3] += dt;
        else timesInZone[4] += dt;
    }

    const z1m = timesInZone[0] / 60;
    const z2m = timesInZone[1] / 60;
    const z3m = timesInZone[2] / 60;
    const z4m = timesInZone[3] / 60;
    const z5m = timesInZone[4] / 60;

    const ctx = document.getElementById('hrZoneChart').getContext('2d');
    if (hrZoneChart) {
        hrZoneChart.destroy();
    }

    hrZoneChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [
                `Z1 回復 (<${z1_top})`,
                `Z2 有酸素 (${z1_top}-${z2_top - 1})`,
                `Z3 テンポ (${z2_top}-${z3_top - 1})`,
                `Z4 閾値 (${z3_top}-${z4_top - 1})`,
                `Z5 無酸素 (>=${z4_top})`
            ],
            datasets: [{
                label: '滞在時間 (分)',
                data: [z1m, z2m, z3m, z4m, z5m],
                backgroundColor: [
                    '#94a3b8', // Gray
                    '#3b82f6', // Blue
                    '#10b981', // Green
                    '#f59e0b', // Orange
                    '#ef4444'  // Red
                ],
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bars
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (c) {
                            const min = Math.floor(c.raw);
                            const sec = Math.floor((c.raw - min) * 60);
                            return `滞在時間: ${min}分${sec.toString().padStart(2, '0')}秒`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '時間 (分)', color: '#64748b' },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#64748b' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { weight: '500' } }
                }
            }
        }
    });
}

// ============== Trends Analysis ============== //
function renderTrends(period) {
    document.querySelectorAll('.pill-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`pill-${period}`).classList.add('active');

    if (!globalActivities || globalActivities.length === 0) return;

    const validActivities = globalActivities.filter(a => parseFloat(a.distance) > 0);
    const dataReversed = [...validActivities].reverse();

    const grouped = {};
    let totalDistKm = 0;
    let sumCadence = 0, cadenceCount = 0;
    let sumSpeed = 0, speedCount = 0;
    let sumStride = 0, strideCount = 0;

    dataReversed.forEach(act => {
        let dateStr = act.startTimeLocal || '';
        if (dateStr.includes(' ')) dateStr = dateStr.replace(' ', 'T');
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return;

        let key = '';
        if (period === 'weekly') {
            // Use Monday of the week as key (YYYY-MM-DD)
            const dayOfWeek = d.getDay(); // 0=Sun
            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const monday = new Date(d);
            monday.setDate(d.getDate() - daysToMonday);
            key = `${monday.getFullYear()}-${(monday.getMonth() + 1).toString().padStart(2, '0')}-${monday.getDate().toString().padStart(2, '0')}`;
        } else if (period === 'monthly') {
            key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        } else {
            key = `${d.getFullYear()}`;
        }

        if (!grouped[key]) {
            grouped[key] = {
                distanceKm: 0, count: 0,
                hrSum: 0, validHrCount: 0,
                cadenceSum: 0, validCadenceCount: 0,
                speedSum: 0, validSpeedCount: 0,
                strideSum: 0, validStrideCount: 0,
                elevationSum: 0,
                aeSum: 0, validAeCount: 0,
                vo2Sum: 0, validVo2Count: 0,
                aerobicTeSum: 0, validAeTeCount: 0,
                anaerobicTeSum: 0, validAnTeCount: 0,
                vertOscSum: 0, validVertOscCount: 0,
                gctSum: 0, validGctCount: 0,
            };
        }

        const distKm = parseFloat(act.distance) / 1000;
        grouped[key].distanceKm += distKm;
        grouped[key].count += 1;
        totalDistKm += distKm;

        const hr = parseFloat(act.averageHR);
        if (hr > 0) { grouped[key].hrSum += hr; grouped[key].validHrCount++; }

        let cad = parseFloat(act.averageRunningCadenceInStepsPerMinute) || 0;
        if (cad > 0) {
            cad = cad < 100 ? cad * 2 : cad;
            grouped[key].cadenceSum += cad; grouped[key].validCadenceCount++;
            sumCadence += cad; cadenceCount++;
        }

        let stride = parseFloat(act.avgStrideLength) || 0;
        if (stride > 20) stride = stride / 100;
        if (stride > 0) {
            grouped[key].strideSum += stride; grouped[key].validStrideCount++;
            sumStride += stride; strideCount++;
        }

        const spd = parseFloat(act.averageSpeed);
        if (spd > 0) {
            grouped[key].speedSum += spd; grouped[key].validSpeedCount++;
            sumSpeed += spd; speedCount++;
        }

        const elev = parseFloat(act.elevationGain) || 0;
        grouped[key].elevationSum += elev;

        if (spd > 0 && hr > 0) {
            grouped[key].aeSum += (spd / hr) * 1000;
            grouped[key].validAeCount++;
        }

        const vo2 = parseFloat(act.vO2MaxValue);
        if (vo2 > 0) { grouped[key].vo2Sum += vo2; grouped[key].validVo2Count++; }

        const aerTe = parseFloat(act.aerobicTrainingEffect);
        if (aerTe > 0) { grouped[key].aerobicTeSum += aerTe; grouped[key].validAeTeCount++; }
        const anTe = parseFloat(act.anaerobicTrainingEffect);
        if (anTe > 0) { grouped[key].anaerobicTeSum += anTe; grouped[key].validAnTeCount++; }

        const vertOsc = parseFloat(act.avgVerticalOscillation);
        if (vertOsc > 0) { grouped[key].vertOscSum += vertOsc; grouped[key].validVertOscCount++; }
        const gct = parseFloat(act.avgGroundContactTime);
        if (gct > 0) { grouped[key].gctSum += gct; grouped[key].validGctCount++; }
    });

    const labels = Object.keys(grouped);

    // Human-readable display labels
    // weekly: "2025-04-07" → "25/4/7〜"  monthly: "2025-04" → "25/4月"  yearly: as-is
    const displayLabels = labels.map(k => {
        if (period === 'weekly') {
            const parts = k.split('-');
            const yy = parts[0].slice(2); // 2-digit year
            return `${yy}/${parseInt(parts[1])}/${parseInt(parts[2])}〜`;
        } else if (period === 'monthly') {
            const parts = k.split('-');
            return `${parts[0].slice(2)}/${parseInt(parts[1])}月`;
        }
        return k;
    });

    const distances = labels.map(k => grouped[k].distanceKm);
    const elevations = labels.map(k => grouped[k].elevationSum);
    const hrAverages = labels.map(k => grouped[k].validHrCount > 0 ? (grouped[k].hrSum / grouped[k].validHrCount).toFixed(1) : null);
    const cadenceAverages = labels.map(k => grouped[k].validCadenceCount > 0 ? (grouped[k].cadenceSum / grouped[k].validCadenceCount).toFixed(1) : null);
    const strideAverages = labels.map(k => grouped[k].validStrideCount > 0 ? (grouped[k].strideSum / grouped[k].validStrideCount).toFixed(2) : null);
    const paceMinsPerKm = labels.map(k => {
        if (grouped[k].validSpeedCount === 0) return null;
        return (1000 / (grouped[k].speedSum / grouped[k].validSpeedCount) / 60).toFixed(2);
    });
    const aeAverages = labels.map(k => grouped[k].validAeCount > 0 ? (grouped[k].aeSum / grouped[k].validAeCount).toFixed(4) : null);
    const vo2Averages = labels.map(k => grouped[k].validVo2Count > 0 ? (grouped[k].vo2Sum / grouped[k].validVo2Count).toFixed(1) : null);
    const aerobicTeAvg = labels.map(k => grouped[k].validAeTeCount > 0 ? (grouped[k].aerobicTeSum / grouped[k].validAeTeCount).toFixed(2) : null);
    const anaerobicTeAvg = labels.map(k => grouped[k].validAnTeCount > 0 ? (grouped[k].anaerobicTeSum / grouped[k].validAnTeCount).toFixed(2) : null);
    const vertOscAvg = labels.map(k => grouped[k].validVertOscCount > 0 ? (grouped[k].vertOscSum / grouped[k].validVertOscCount).toFixed(1) : null);
    const gctAvg = labels.map(k => grouped[k].validGctCount > 0 ? (grouped[k].gctSum / grouped[k].validGctCount).toFixed(0) : null);

    // Summary stats
    document.getElementById('trend-dist').textContent = totalDistKm.toFixed(1) + ' km';
    document.getElementById('trend-count').textContent = dataReversed.length;
    if (cadenceCount > 0) document.getElementById('trend-cadence').textContent = (sumCadence / cadenceCount).toFixed(0) + ' spm';
    if (speedCount > 0) {
        const avgPace = speedToPace(sumSpeed / speedCount);
        const avgStride = strideCount > 0 ? (sumStride / strideCount).toFixed(2) + 'm' : '--';
        document.getElementById('trend-pace').textContent = `${avgStride} / ${avgPace}`;
    }

    renderPRPanel(validActivities);
    renderCalendar(validActivities);

    const xScale = { grid: { display: false }, ticks: { color: '#64748b' } };
    const yScale = { ticks: { color: '#64748b' } };

    // 1. Volume
    const ctx1 = document.getElementById('trendChart').getContext('2d');
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx1, {
        type: 'bar',
        data: { labels: displayLabels, datasets: [{ label: 'Volume (km)', data: distances, backgroundColor: '#0ea5e9', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: xScale, y: { ...yScale, beginAtZero: true } } }
    });

    // 2. Elevation
    const ctx2 = document.getElementById('trendElevationChart').getContext('2d');
    if (trendElevationChart) trendElevationChart.destroy();
    trendElevationChart = new Chart(ctx2, {
        type: 'bar',
        data: { labels: displayLabels, datasets: [{ label: '獲得標高 (m)', data: elevations, backgroundColor: '#10b981', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: xScale, y: { ...yScale, beginAtZero: true } } }
    });

    // 3. Pace + HR
    const ctx3 = document.getElementById('trendPaceHRChart').getContext('2d');
    if (trendPaceHRChart) trendPaceHRChart.destroy();
    trendPaceHRChart = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                { label: 'Avg Heart Rate (bpm)', data: hrAverages, borderColor: '#ef4444', backgroundColor: '#ef4444', yAxisID: 'y', tension: 0.3, spanGaps: true },
                { label: 'Avg Pace (min/km)', data: paceMinsPerKm, borderColor: '#10b981', backgroundColor: '#10b981', yAxisID: 'y1', tension: 0.3, spanGaps: true }
            ]
        },

        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: xScale,
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Heart Rate', color: '#64748b' }, ticks: { color: '#64748b' } },
                y1: { type: 'linear', display: true, position: 'right', reverse: true, title: { display: true, text: 'Pace (min/km)', color: '#64748b' }, grid: { drawOnChartArea: false }, ticks: { color: '#64748b' } }
            },
            plugins: {
                legend: { labels: { color: '#475569' } },
                tooltip: {
                    callbacks: {
                        label: function (c) {
                            if (c.datasetIndex === 1) { const v = c.parsed.y; const m = Math.floor(v); const s = Math.floor((v - m) * 60).toString().padStart(2, '0'); return `Avg Pace: ${m}'${s}" /km`; }
                            return `Avg HR: ${c.parsed.y} bpm`;
                        }
                    }
                }
            }
        }
    });

    // 4. Aerobic Efficiency
    const ctx4 = document.getElementById('trendAeChart').getContext('2d');
    if (trendAeChart) trendAeChart.destroy();
    trendAeChart = new Chart(ctx4, {
        type: 'line',
        data: { labels: displayLabels, datasets: [{ label: 'Speed/Heartbeat (m×10⁻³)', data: aeAverages, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', fill: true, tension: 0.3, spanGaps: true, pointRadius: 3 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#475569' } } },
            scales: { x: xScale, y: { title: { display: true, text: 'm / heartbeat (×10⁻³)', color: '#64748b' }, ticks: { color: '#64748b' } } }
        }
    });

    // 5. VO2max
    const ctx5 = document.getElementById('trendVo2Chart').getContext('2d');
    if (trendVo2Chart) trendVo2Chart.destroy();
    trendVo2Chart = new Chart(ctx5, {
        type: 'line',
        data: { labels: displayLabels, datasets: [{ label: 'VO2max', data: vo2Averages, borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.1)', fill: true, tension: 0.3, spanGaps: true, pointRadius: 3 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#475569' } } },
            scales: { x: xScale, y: { title: { display: true, text: 'ml/kg/min', color: '#64748b' }, ticks: { color: '#64748b' } } }
        }
    });

    // 6. Training Effect (stacked bar)
    const ctx6 = document.getElementById('trendTeChart').getContext('2d');
    if (trendTeChart) trendTeChart.destroy();
    trendTeChart = new Chart(ctx6, {
        type: 'bar',
        data: {
            labels: displayLabels,
            datasets: [
                { label: '有酸素 TE', data: aerobicTeAvg, backgroundColor: '#3b82f6', borderRadius: 4 },
                { label: '無酸素 TE', data: anaerobicTeAvg, backgroundColor: '#f97316', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#475569' } } },
            scales: { x: { stacked: true, ...xScale }, y: { stacked: true, min: 0, max: 8, ticks: { color: '#64748b' } } }
        }
    });

    // 7. Cadence + Stride
    const ctx7 = document.getElementById('trendCadenceChart').getContext('2d');
    if (trendCadenceChart) trendCadenceChart.destroy();
    trendCadenceChart = new Chart(ctx7, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                { label: 'Avg Cadence (spm)', data: cadenceAverages, borderColor: '#6366f1', fill: false, tension: 0.3, spanGaps: true, yAxisID: 'y' },
                { label: 'Avg Stride Length (m)', data: strideAverages, borderColor: '#f59e0b', fill: false, tension: 0.3, spanGaps: true, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: xScale,
                y: { min: 140, max: 200, title: { display: true, text: 'Steps Per Minute', color: '#64748b' }, position: 'left', ticks: { color: '#64748b' } },
                y1: { min: 0.5, max: 2.0, title: { display: true, text: 'Stride Length (m)', color: '#64748b' }, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#64748b' } }
            },
            plugins: {
                legend: { display: true, labels: { color: '#475569' } },
                tooltip: {
                    callbacks: {
                        label: function (c) {
                            if (c.datasetIndex === 0) return `Avg Cadence: ${c.parsed.y} spm`;
                            return `Avg Stride: ${c.parsed.y} m`;
                        }
                    }
                }
            }
        }
    });

    // 8. Running Dynamics (VertOsc + GCT)
    const ctx8 = document.getElementById('trendFormChart').getContext('2d');
    if (trendFormChart) trendFormChart.destroy();
    trendFormChart = new Chart(ctx8, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                { label: '上下動 (cm)', data: vertOscAvg, borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.1)', fill: true, tension: 0.3, spanGaps: true, yAxisID: 'y', pointRadius: 3 },
                { label: '接地時間 (ms)', data: gctAvg, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3, spanGaps: true, yAxisID: 'y1', pointRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: xScale,
                y: { title: { display: true, text: '上下動 (cm)', color: '#14b8a6' }, position: 'left', ticks: { color: '#64748b' } },
                y1: { title: { display: true, text: '接地時間 (ms)', color: '#f59e0b' }, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#64748b' } }
            },
            plugins: { legend: { labels: { color: '#475569' } } }
        }
    });
}

// ============== PR Panel ============== //
function renderPRPanel(activities) {
    if (!activities || activities.length === 0) return;

    let maxDist = 0, maxDistAct = null;
    let minPaceSec = Infinity, minPaceAct = null;
    let maxElev = 0, maxElevAct = null;
    let maxVo2 = 0, maxVo2Act = null;

    activities.forEach(act => {
        const dist = parseFloat(act.distance) || 0;
        if (dist > maxDist) { maxDist = dist; maxDistAct = act; }

        const spd = parseFloat(act.averageSpeed) || 0;
        if (spd > 0) {
            const paceSec = 1000 / spd;
            if (paceSec < minPaceSec && paceSec > 180) { minPaceSec = paceSec; minPaceAct = act; }
        }

        const elev = parseFloat(act.elevationGain) || 0;
        if (elev > maxElev) { maxElev = elev; maxElevAct = act; }

        const vo2 = parseFloat(act.vO2MaxValue) || 0;
        if (vo2 > maxVo2) { maxVo2 = vo2; maxVo2Act = act; }
    });

    if (maxDistAct) {
        document.getElementById('pr-distance').textContent = (maxDist / 1000).toFixed(2) + ' km';
        document.getElementById('pr-distance-date').textContent = (maxDistAct.startTimeLocal || '').substring(0, 10);
    }
    if (minPaceAct) {
        const m = Math.floor(minPaceSec / 60);
        const s = Math.floor(minPaceSec % 60).toString().padStart(2, '0');
        document.getElementById('pr-pace').textContent = `${m}'${s}" /km`;
        document.getElementById('pr-pace-date').textContent = (minPaceAct.startTimeLocal || '').substring(0, 10);
    }
    if (maxElevAct) {
        document.getElementById('pr-elevation').textContent = maxElev.toFixed(0) + ' m';
        document.getElementById('pr-elevation-date').textContent = (maxElevAct.startTimeLocal || '').substring(0, 10);
    }
    if (maxVo2Act) {
        document.getElementById('pr-vo2').textContent = maxVo2.toFixed(1);
        document.getElementById('pr-vo2-date').textContent = (maxVo2Act.startTimeLocal || '').substring(0, 10);
    }
}

// ============== Calendar Heatmap ============== //
function renderCalendar(activities) {
    const container = document.getElementById('calendar-heatmap');
    if (!container) return;

    const dateMap = {};
    activities.forEach(act => {
        const dateStr = (act.startTimeLocal || '').substring(0, 10);
        if (!dateStr) return;
        const distKm = parseFloat(act.distance) / 1000 || 0;
        dateMap[dateStr] = (dateMap[dateStr] || 0) + distKm;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // align to Sunday

    const getColor = (km) => {
        if (!km || km === 0) return '#e2e8f0';
        if (km < 5) return '#bbf7d0';
        if (km < 10) return '#4ade80';
        if (km < 20) return '#16a34a';
        return '#052e16';
    };

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weeks = [];
    let current = new Date(startDate);
    while (current <= today) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const dateStr = current.toISOString().substring(0, 10);
            week.push({ dateStr, distKm: dateMap[dateStr] || 0, isFuture: current > today });
            current.setDate(current.getDate() + 1);
        }
        weeks.push(week);
    }

    let prevMonth = -1;
    let html = `<div style="display:flex;gap:2px;align-items:flex-start;">`;
    html += `<div style="display:flex;flex-direction:column;gap:2px;padding-top:20px;margin-right:4px;">`;
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((label, i) => {
        html += `<div style="height:12px;font-size:10px;color:#94a3b8;line-height:12px;">${[1, 3, 5].includes(i) ? label : ''}</div>`;
    });
    html += `</div>`;

    weeks.forEach(week => {
        html += `<div style="display:flex;flex-direction:column;gap:2px;">`;
        const monthDate = new Date(week[0].dateStr);
        const month = monthDate.getMonth();
        const monthStr = (month !== prevMonth && monthDate.getDate() <= 7) ? monthLabels[month] : '';
        if (month !== prevMonth && monthDate.getDate() <= 7) prevMonth = month;
        html += `<div style="height:18px;font-size:10px;color:#94a3b8;text-align:center;">${monthStr}</div>`;
        week.forEach(day => {
            const color = day.isFuture ? 'transparent' : getColor(day.distKm);
            const title = day.distKm > 0 ? `${day.dateStr}: ${day.distKm.toFixed(1)}km` : day.dateStr;
            html += `<div title="${title}" style="width:12px;height:12px;background:${color};border-radius:2px;"></div>`;
        });
        html += `</div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}




// ============== Trail Pace Calculator ============== //
let trailRegressionModel = { a: 0, b: 0 }; // Pace = a * Elev/km + b
let trailDataPoints = [];
let trailChartInstance = null;

const defaultTrailPresets = {
    "kumotori": { name: "雲取山", dist: 20, elev: 1400 },
    "hirubiston": { name: "ヒルビストン", dist: 25, elev: 2469 },
    "tanzawa": { name: "丹沢ケルベロス", dist: 30, elev: 2500 },
    "takao": { name: "高尾マンモス", dist: 35, elev: 2000 },
    "tarasaru": { name: "トラサル", dist: 40, elev: 2800 },
    "gaireen": { name: "ガイリーン", dist: 50, elev: 3000 },
    "mtfuji": { name: "Mt.Fuji Kai", dist: 70, elev: 3400 }
};

let userTrailPresets = {}; // Loaded from DB

async function fetchUserTrailPresets() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/trail-presets?user_id=${encodeURIComponent(currentUser.id)}`);
        if (res.ok) {
            userTrailPresets = await res.json() || {};
            updatePresetDropdown();
        }
    } catch (e) {
        console.error("Failed to load trail presets", e);
    }
}

async function saveUserTrailPresets() {
    if (!currentUser) return;
    try {
        await fetch('/api/trail-presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                trail_presets: userTrailPresets
            })
        });
    } catch (e) {
        console.error("Failed to save trail presets", e);
    }
}

function getMergedPresets() {
    return { ...defaultTrailPresets, ...userTrailPresets };
}

function updatePresetDropdown() {
    const select = document.getElementById('trail-presets');
    if (!select) return;
    select.innerHTML = '<option value="">-- 手動で入力 --</option>';
    const merged = getMergedPresets();
    for (const key in merged) {
        let opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${merged[key].name} (${merged[key].dist}km, ${merged[key].elev}m)`;
        select.appendChild(opt);
    }
}

// init dropdown
updatePresetDropdown();

// Modal logic
const presetModal = document.getElementById('presets-modal');
document.getElementById('btn-edit-presets')?.addEventListener('click', () => {
    presetModal.classList.remove('hidden');
    renderPresetList();
});

document.getElementById('btn-close-preset-modal')?.addEventListener('click', () => {
    presetModal.classList.add('hidden');
    updatePresetDropdown();
});

function renderPresetList() {
    const list = document.getElementById('preset-list');
    list.innerHTML = '';
    const merged = getMergedPresets();
    for (const key in merged) {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px;";

        const isCustom = userTrailPresets.hasOwnProperty(key);

        div.innerHTML = `
            <span style="font-size: 0.9rem;">${merged[key].name} <span style="font-size: 0.8rem; color: #64748b;">(${merged[key].dist}km, ${merged[key].elev}m)</span></span>
            ${isCustom ? `<button onclick="deletePreset('${key}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.1rem; padding: 2px;">❌</button>` : `<span style="font-size:0.75rem; color:#94a3b8; padding: 2px;">デフォルト</span>`}
        `;
        list.appendChild(div);
    }
}

window.deletePreset = async function (key) {
    if (confirm('本当に削除しますか？')) {
        delete userTrailPresets[key];
        renderPresetList();
        updatePresetDropdown();
        await saveUserTrailPresets();
    }
};

document.getElementById('btn-add-preset')?.addEventListener('click', () => {
    const name = document.getElementById('new-preset-name').value.trim();
    const dist = parseFloat(document.getElementById('new-preset-dist').value);
    const elev = parseFloat(document.getElementById('new-preset-elev').value);

    if (!name || isNaN(dist) || isNaN(elev)) {
        alert('レース名、距離(km)、上昇高度(m)を正しく入力してください。');
        return;
    }

    const id = 'custom_' + Date.now();
    userTrailPresets[id] = { name, dist, elev };

    document.getElementById('new-preset-name').value = '';
    document.getElementById('new-preset-dist').value = '';
    document.getElementById('new-preset-elev').value = '';
    renderPresetList();
    updatePresetDropdown();
    saveUserTrailPresets();
});

document.getElementById('trail-presets').addEventListener('change', (e) => {
    const val = e.target.value;
    const merged = getMergedPresets();
    if (val && merged[val]) {
        document.getElementById('trail-target-dist').value = merged[val].dist;
        document.getElementById('trail-target-elev').value = merged[val].elev;
    }
    calculateTrailTime();
});

document.getElementById('trail-filter-elev')?.addEventListener('input', renderTrailCalculator);
document.getElementById('trail-filter-pace')?.addEventListener('input', renderTrailCalculator);

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
        const isHilly = (elevM / distKm) >= minElev;

        const paceSecKm = act.duration / distKm;
        const paceMinKm = paceSecKm / 60;

        // フィルター条件を厳密に適用（指定された上昇高度とペースを満たしているか）
        if (paceMinKm <= maxPaceMinKm && isHilly) {
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

