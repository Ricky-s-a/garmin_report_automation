let map;
let polyline;
let analysisChart;
let paceChart;
let gapChart;
let cadenceChart;
let powerChart;
let strideChart;
let oscillationChart;
let contactTimeChart;
let trendChart;
let trendElevationChart;
let trendPaceHRChart;
let trendAeChart;
let trendVo2Chart;
let trendTeChart;
let trendCadenceChart;
let trendFormChart;
let trendHrByPaceChart;
let trendAeByPaceChart;
let trendCadenceByPaceChart;
let trendStrideByPaceChart;
let trendOscByPaceChart;
let trendGctByPaceChart;
let trendMonthlyDistChart;
let trendAtlCtlChart;
let trendZone2Chart;
let hrZoneChart;
// ... other charts ...
let userMaxHr = null;
let userRestingHr = parseInt(localStorage.getItem('garmin_resting_hr') || '55') || 55;
let globalActivities = [];
let appSupabase;
let currentUser = null;

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
                        document.getElementById('settings-resting-hr').value = localStorage.getItem('garmin_resting_hr') || '';
                        document.getElementById('settings-weekly-target').value = localStorage.getItem('garmin_weekly_target') || 50;
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
                const restingHrVal = document.getElementById('settings-resting-hr').value;
                if (restingHrVal) {
                    userRestingHr = parseInt(restingHrVal);
                    localStorage.setItem('garmin_resting_hr', restingHrVal);
                }
                localStorage.setItem('garmin_weekly_target', document.getElementById('settings-weekly-target').value || 50);

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
                    await appSupabase.auth.signOut();
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

        if (!points || points.length === 0) {
            console.warn("No GPX data points found.");
            return;
        }

        // Calculate GAP (Grade Adjusted Pace)
        let totalEffDist = 0;
        let totalTimeSecs = 0;
        points[0].gapSpeed = 0; // fallback for the first point

        for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1];
            const p2 = points[i];

            const lat1 = parseFloat(p1.latitude);
            const lon1 = parseFloat(p1.longitude);
            const lat2 = parseFloat(p2.latitude);
            const lon2 = parseFloat(p2.longitude);
            const ele1 = parseFloat(p1.elevation);
            const ele2 = parseFloat(p2.elevation);

            let dist = 0;
            // Haversine distance
            if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
                const R = 6371e3;
                const f1 = lat1 * Math.PI / 180;
                const f2 = lat2 * Math.PI / 180;
                const df = (lat2 - lat1) * Math.PI / 180;
                const dl = (lon2 - lon1) * Math.PI / 180;

                const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                dist = R * c;
            }

            const dt = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
            let effDist = dist;

            if (dt > 0 && dt <= 120 && dist > 0) {
                if (!isNaN(ele1) && !isNaN(ele2)) {
                    let elevDiff = ele2 - ele1;
                    let grade = elevDiff / dist;

                    if (grade > 0) {
                        effDist = dist + elevDiff * 10; // Uphill adjustment
                    } else if (grade < -0.15) {
                        effDist = dist + Math.abs(elevDiff) * 2; // Steep downhill penalty
                    } else if (grade < 0) {
                        effDist = dist - Math.abs(elevDiff) * 3; // Gentle downhill bonus
                        if (effDist < 0) effDist = dist;
                    }
                }
                p2.gapSpeed = effDist / dt;
                totalEffDist += effDist;
                totalTimeSecs += dt;
            } else {
                p2.gapSpeed = 0; // Too noisy/stopped
            }
        }

        if (totalTimeSecs > 0) {
            const avgGapSpeed = totalEffDist / totalTimeSecs;
            document.getElementById('val-gap').textContent = speedToPace(avgGapSpeed);
            if (avgGapSpeed > activity.averageSpeed) {
                document.getElementById('val-gap').style.color = "#10b981"; // Faster than flat
            } else {
                document.getElementById('val-gap').style.color = "#ef4444"; // Slower than flat
            }
        } else {
            document.getElementById('val-gap').textContent = "--";
        }

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

    let cumulativeDist = 0;
    const labels = validPoints.map((p, idx, arr) => {
        if (idx > 0) {
            let lat1 = parseFloat(arr[idx - 1].latitude), lon1 = parseFloat(arr[idx - 1].longitude);
            let lat2 = parseFloat(p.latitude), lon2 = parseFloat(p.longitude);
            if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
                const R = 6371e3;
                const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
                const df = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
                const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
                cumulativeDist += R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            }
        }
        return (cumulativeDist / 1000).toFixed(2);
    });
    const hrData = validPoints.map(p => parseFloat(p.heartRate));
    const eleData = validPoints.map(p => parseFloat(p.elevation));
    const cadenceData = validPoints.map(p => parseFloat(p.cadence) * 2); // Steps per min (usually half steps are stored)
    const powerData = validPoints.map(p => parseFloat(p.power || 0)); // Assuming power might be added or exist
    const strideData = validPoints.map(p => parseFloat(p.stride_length || 0) / 10.0); // usually in mm
    const oscillationData = validPoints.map(p => parseFloat(p.vertical_oscillation || 0) / 10.0); // usually in mm
    const contactTimeData = validPoints.map(p => parseFloat(p.ground_contact_time || 0) / 10.0); // usually in 10x ms

    // Calculate moving average of Pace and GAP Pace for smoothness
    const windowSize = 5;
    const gapPaceData = validPoints.map((p, idx, arr) => {
        let sumSpeed = 0, count = 0;
        for (let j = Math.max(0, idx - windowSize); j <= Math.min(arr.length - 1, idx + windowSize); j++) {
            if (arr[j].gapSpeed > 0) { sumSpeed += arr[j].gapSpeed; count++; }
        }
        let avgSpeed = count > 0 ? sumSpeed / count : 0;
        if (avgSpeed < 1 || avgSpeed > 8) return null; // Filter out extreme walking/gps glitch
        return (1000 / avgSpeed / 60); // Convert to min/km
    });

    const paceData = validPoints.map((p, idx, arr) => {
        let sumSpeed = 0, count = 0;
        for (let j = Math.max(0, idx - windowSize); j <= Math.min(arr.length - 1, idx + windowSize); j++) {
            // Recalculate spot speed
            const p1 = arr[Math.max(0, j - 1)];
            const p2 = arr[j];
            const dist = p1 === p2 ? 0 :
                (function () {
                    let lat1 = parseFloat(p1.latitude), lon1 = parseFloat(p1.longitude);
                    let lat2 = parseFloat(p2.latitude), lon2 = parseFloat(p2.longitude);
                    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
                    const R = 6371e3;
                    const f1 = lat1 * Math.PI / 180;
                    const f2 = lat2 * Math.PI / 180;
                    const df = (lat2 - lat1) * Math.PI / 180;
                    const dl = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
                    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
                })();
            const dt = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
            const spotSpd = dt > 0 ? dist / dt : 0;
            if (spotSpd > 0) { sumSpeed += spotSpd; count++; }
        }
        let avgSpeed = count > 0 ? sumSpeed / count : 0;
        if (avgSpeed < 1 || avgSpeed > 8) return null;
        return (1000 / avgSpeed / 60);
    });

    const splits = [];
    let currentKmTarget = 1000;
    let splitStartTime = new Date(validPoints[0].time).getTime();
    let splitStartElev = parseFloat(validPoints[0].elevation) || 0;
    let runDist = 0;
    let splitStartDist = 0;
    let splitStartIdx = 0;

    for (let i = 1; i < validPoints.length; i++) {
        const p1 = validPoints[i - 1];
        const p2 = validPoints[i];
        let lat1 = parseFloat(p1.latitude), lon1 = parseFloat(p1.longitude);
        let lat2 = parseFloat(p2.latitude), lon2 = parseFloat(p2.longitude);
        if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
            const R = 6371e3;
            const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
            const df = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
            runDist += R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
        }

        if (runDist >= currentKmTarget || i === validPoints.length - 1) {
            const isFinal = (i === validPoints.length - 1);
            if (isFinal && runDist < currentKmTarget && runDist - splitStartDist < 50) {
                break; // Skip fractional last split if < 50m
            }
            const splitEndTime = new Date(p2.time).getTime();
            const timeDiffSec = (splitEndTime - splitStartTime) / 1000;
            const distDiffM = runDist - splitStartDist;

            const distInKm = distDiffM / 1000;
            const kmLabelStr = distInKm.toFixed(2) + " km";

            const sMin = Math.floor(timeDiffSec / 60);
            const sSec = Math.floor(timeDiffSec % 60);
            let splitTimeStr;
            if (sMin > 0) {
                splitTimeStr = `${sMin}:${sSec < 10 ? '0' : ''}${sSec}`;
            } else {
                splitTimeStr = `${sSec} 秒`;
            }

            let paceStr = "--:--";
            let gapStr = "--:--";
            if (distDiffM > 0) {
                const paceSecPerKm = timeDiffSec * (1000 / distDiffM);
                const pMin = Math.floor(paceSecPerKm / 60);
                const pSec = Math.floor(paceSecPerKm % 60);
                paceStr = `${pMin}:${pSec < 10 ? '0' : ''}${pSec}`;

                let sumGapSpeed = 0, gapCount = 0;
                for (let k = splitStartIdx; k <= i; k++) {
                    if (validPoints[k].gapSpeed > 0) {
                        sumGapSpeed += validPoints[k].gapSpeed;
                        gapCount++;
                    }
                }
                if (gapCount > 0) {
                    const avgGapSpeed = sumGapSpeed / gapCount;
                    const gapSecPerKm = 1000 / avgGapSpeed;
                    const gMin = Math.floor(gapSecPerKm / 60);
                    const gSec = Math.floor(gapSecPerKm % 60);
                    gapStr = `${gMin}:${gSec < 10 ? '0' : ''}${gSec}`;
                }
            }

            let sumHr = 0, hrCount = 0;
            for (let k = splitStartIdx; k <= i; k++) {
                if (validPoints[k].heartRate > 0) {
                    sumHr += parseFloat(validPoints[k].heartRate);
                    hrCount++;
                }
            }
            const avgHr = hrCount > 0 ? Math.round(sumHr / hrCount) : "--";

            const splitEndElev = parseFloat(p2.elevation) || 0;

            splits.push({ dist: kmLabelStr, time: splitTimeStr, pace: paceStr + ' /km', gap: gapStr + ' /km', hr: `${avgHr} bpm` });

            splitStartTime = splitEndTime;
            splitStartElev = splitEndElev;
            splitStartDist = runDist;
            splitStartIdx = i;
            currentKmTarget += 1000;
        }
    }

    const splitsBody = document.getElementById('splits-table-body');
    if (splitsBody && splits.length > 0) {
        document.getElementById('splits-card').style.display = 'block';
        splitsBody.innerHTML = splits.map(s => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px; font-weight: 500;">${s.dist}</td>
                <td style="padding: 10px; font-weight: 500;">${s.time}</td>
                <td style="padding: 10px;">${s.pace}</td>
                <td style="padding: 10px;">${s.gap}</td>
                <td style="padding: 10px;">${s.hr}</td>
            </tr>
        `).join('');
    } else if (splitsBody) {
        document.getElementById('splits-card').style.display = 'none';
    }

    if (analysisChart) analysisChart.destroy();
    if (paceChart) paceChart.destroy();
    if (gapChart) gapChart.destroy();
    if (cadenceChart) cadenceChart.destroy();
    if (powerChart) powerChart.destroy();
    if (strideChart) strideChart.destroy();
    if (oscillationChart) oscillationChart.destroy();
    if (contactTimeChart) contactTimeChart.destroy();

    // Default shared scale configuration for elevation as background
    const getChartOptions = (y2Title, y2Color, y2Reverse = false, y2Step = null) => {
        let y2Config = {
            type: 'linear', display: true, position: 'left',
            grid: { color: 'rgba(0,0,0,0.05)' },
            title: { display: true, text: y2Title, color: y2Color },
            ticks: { color: y2Color }
        };
        if (y2Reverse) y2Config.reverse = true;
        if (y2Step) y2Config.ticks.stepSize = y2Step;

        return {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            color: '#475569',
            scales: {
                x: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        maxTicksLimit: 10,
                        color: '#64748b',
                        callback: function (value, index, values) {
                            return labels[index] + "km";
                        }
                    }
                },
                y: y2Config,
                y1: {
                    type: 'linear', display: true, position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Elevation (m)', color: '#94a3b8' },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: { legend: { labels: { color: '#475569' } } }
        };
    };

    const datasetsElevation = {
        label: 'Elevation (m)', data: eleData,
        borderColor: '#94a3b8', backgroundColor: 'rgba(148, 163, 184, 0.12)',
        yAxisID: 'y1', tension: 0.4, fill: true, pointRadius: 0
    };

    // 1. HR Chart
    analysisChart = new Chart(document.getElementById('analysisChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Heart Rate (bpm)', data: hrData, borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)', yAxisID: 'y', tension: 0.4, fill: true, pointRadius: 0
                },
                datasetsElevation
            ]
        },
        options: getChartOptions('Heart Rate (bpm)', '#ef4444')
    });

    // 2. Pace Chart
    paceChart = new Chart(document.getElementById('paceChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Pace (min/km)', data: paceData, borderColor: '#3b82f6',
                    backgroundColor: 'transparent', yAxisID: 'y', tension: 0.4, borderWidth: 2, pointRadius: 0
                },
                datasetsElevation
            ]
        },
        options: getChartOptions('Pace (min/km)', '#3b82f6', true, 1)
    });

    // 3. GAP Chart
    gapChart = new Chart(document.getElementById('gapChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'GAP (min/km)', data: gapPaceData, borderColor: '#8b5cf6',
                    backgroundColor: 'transparent', yAxisID: 'y', tension: 0.4, borderWidth: 2, borderDash: [5, 5], pointRadius: 0
                },
                datasetsElevation
            ]
        },
        options: getChartOptions('GAP (min/km)', '#8b5cf6', true, 1)
    });

    // 4. Cadence Chart
    cadenceChart = new Chart(document.getElementById('cadenceChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Cadence (spm)', data: cadenceData, borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)', yAxisID: 'y', tension: 0.4, fill: true, pointRadius: 0
                },
                datasetsElevation
            ]
        },
        options: getChartOptions('Cadence (spm)', '#f59e0b')
    });

    const createOptionalChart = (id, cardId, dataObj, label, color, convert = false) => {
        if (dataObj.some(v => v > 0)) {
            document.getElementById(cardId).style.display = 'block';
            return new Chart(document.getElementById(id).getContext('2d'), {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: label, data: dataObj, borderColor: color,
                            backgroundColor: 'transparent', yAxisID: 'y', tension: 0.4, fill: false, borderWidth: 2, pointRadius: 0
                        },
                        datasetsElevation
                    ]
                },
                options: getChartOptions(label, color)
            });
        } else {
            document.getElementById(cardId).style.display = 'none';
            return null;
        }
    };

    // 5. Power Chart
    powerChart = createOptionalChart('powerChart', 'power-card', powerData, 'Power (W)', '#ec4899');
    // 6. Stride Length
    strideChart = createOptionalChart('strideChart', 'stride-card', strideData, 'Stride Length (cm)', '#06b6d4');
    // 7. Vertical Oscillation
    oscillationChart = createOptionalChart('oscillationChart', 'oscillation-card', oscillationData, 'Vertical Oscillation (cm)', '#eab308');
    // 8. Ground Contact Time
    contactTimeChart = createOptionalChart('contactTimeChart', 'contact-time-card', contactTimeData, 'Ground Contact Time (ms)', '#f97316');
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
let trendDateFrom = null;
let trendDateTo = null;
let currentTrendPeriod = 'weekly';

/** Set default date range to [today - 1 year, today] if inputs are empty. */
function initTrendDefaultDates() {
    const fromEl = document.getElementById('trend-date-from');
    const toEl = document.getElementById('trend-date-to');
    if (!fromEl || !toEl) return;
    if (fromEl.value && toEl.value) return; // already set
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    toEl.value = today.toISOString().substring(0, 10);
    fromEl.value = oneYearAgo.toISOString().substring(0, 10);
    trendDateFrom = fromEl.value;
    trendDateTo = toEl.value;
}

window.applyTrendDateFilter = function () {
    trendDateFrom = document.getElementById('trend-date-from').value || null;
    trendDateTo = document.getElementById('trend-date-to').value || null;
    renderTrends(currentTrendPeriod);
};

window.clearTrendDateFilter = function () {
    trendDateFrom = null;
    trendDateTo = null;
    document.getElementById('trend-date-from').value = '';
    document.getElementById('trend-date-to').value = '';
    renderTrends(currentTrendPeriod);
};

function renderTrends(period) {
    document.querySelectorAll('.pill-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`pill-${period}`).classList.add('active');
    currentTrendPeriod = period;
    initTrendDefaultDates();   // ensure default 1-year range is set

    if (!globalActivities || globalActivities.length === 0) return;

    // Apply date filter
    const fromMs = trendDateFrom ? new Date(trendDateFrom).getTime() : null;
    const toMs = trendDateTo ? new Date(trendDateTo + 'T23:59:59').getTime() : null;

    const validActivities = globalActivities.filter(a => {
        if (parseFloat(a.distance) <= 0) return false;
        if (fromMs || toMs) {
            const dStr = (a.startTimeLocal || '').replace(' ', 'T');
            const t = new Date(dStr).getTime();
            if (fromMs && t < fromMs) return false;
            if (toMs && t > toMs) return false;
        }
        return true;
    });
    const dataReversed = [...validActivities].reverse();

    // === 🏃‍♂️ Current Week Progress (Mon-Sun) ===
    let currentWeekDistKm = 0;
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0=Sun
    const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() - daysToMonday);
    currentMonday.setHours(0, 0, 0, 0);

    validActivities.forEach(act => {
        const d = new Date(act.startTimeLocal || act.time);
        if (d >= currentMonday) {
            currentWeekDistKm += parseFloat(act.distance) / 1000 || 0;
        }
    });

    const weeklyTargetKm = parseFloat(localStorage.getItem('garmin_weekly_target')) || 50;
    const progressPct = weeklyTargetKm > 0 ? Math.min(100, Math.round((currentWeekDistKm / weeklyTargetKm) * 100)) : 0;
    const remainingKm = Math.max(0, weeklyTargetKm - currentWeekDistKm);

    document.getElementById('weekly-progress-text').textContent = `${currentWeekDistKm.toFixed(1)} / ${weeklyTargetKm} km (${progressPct}%)`;
    document.getElementById('weekly-progress-remaining').textContent = `残り ${remainingKm.toFixed(1)} km`;
    document.getElementById('weekly-progress-bar').style.width = `${progressPct}%`;

    // === 📊 Monthly Distance (Past 12 Months) ===
    const monthlyDistGroups = {};
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthLabels = [];
    for (let i = 0; i < 12; i++) {
        const m = new Date(twelveMonthsAgo);
        m.setMonth(m.getMonth() + i);
        const k = `${m.getFullYear()}-${(m.getMonth() + 1).toString().padStart(2, '0')}`;
        monthlyDistGroups[k] = 0;
        monthLabels.push(k);
    }

    validActivities.forEach(act => {
        const d = new Date(act.startTimeLocal || act.time);
        if (d >= twelveMonthsAgo) {
            const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            if (monthlyDistGroups[k] !== undefined) {
                monthlyDistGroups[k] += parseFloat(act.distance) / 1000 || 0;
            }
        }
    });

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
                duration: 0,          // total duration seconds for ATL/CTL
                zone2Secs: 0,         // seconds in HR Zone 2
                totalHrSecs: 0,       // total seconds with valid HR
                paceZones: {
                    '<5:00': { hrSum: 0, hrCount: 0, aeSum: 0, aeCount: 0 },
                    '5:00': { hrSum: 0, hrCount: 0, aeSum: 0, aeCount: 0 },
                    '6:00': { hrSum: 0, hrCount: 0, aeSum: 0, aeCount: 0 },
                    '7:00': { hrSum: 0, hrCount: 0, aeSum: 0, aeCount: 0 },
                    '8:00+': { hrSum: 0, hrCount: 0, aeSum: 0, aeCount: 0 }
                }
            };
        }

        const distKm = parseFloat(act.distance) / 1000;
        grouped[key].distanceKm += distKm;
        grouped[key].count += 1;
        totalDistKm += distKm;

        // Duration for ATL/CTL (TRIMP proxy: duration * avgHR factor)
        const durSec = parseFloat(act.duration) || 0;
        grouped[key].duration += durSec;

        const hr = parseFloat(act.averageHR);
        if (hr > 0) { grouped[key].hrSum += hr; grouped[key].validHrCount++; }

        // Zone 2 time approximation: if avgHR falls in zone 2 band, count full duration
        if (durSec > 0 && hr > 0) {
            const z1_top = userMaxHr ? Math.round(userMaxHr * 0.6) : 114;
            const z2_top = userMaxHr ? Math.round(userMaxHr * 0.7) : 133;
            grouped[key].totalHrSecs += durSec;
            if (hr >= z1_top && hr < z2_top) {
                grouped[key].zone2Secs += durSec;
            }
        }

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

            const paceMin = (1000 / spd) / 60;
            let bucket = '';
            if (paceMin < 5) bucket = '<5:00';
            else if (paceMin < 6) bucket = '5:00';
            else if (paceMin < 7) bucket = '6:00';
            else if (paceMin < 8) bucket = '7:00';
            else bucket = '8:00+';

            if (hr > 0) {
                grouped[key].paceZones[bucket].hrSum += hr;
                grouped[key].paceZones[bucket].hrCount++;
                grouped[key].paceZones[bucket].aeSum += (spd / hr) * 1000;
                grouped[key].paceZones[bucket].aeCount++;
            }
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

    // Summary stats (kept for backwards compat, hidden in UI)
    renderCalendar(validActivities, trendDateFrom, trendDateTo);

    // === ATL / CTL / TSB — Day-by-day TRIMP-based ===
    // TRIMP formula: duration_min × hrReserve × 0.64 × e^(1.92 × hrReserve)
    // hrReserve = (avgHR - restHR) / (maxHR - restHR)
    //
    // We build a daily TRIMP map from ALL globalActivities (not just filtered),
    // then run exponential smoothing day-by-day and sample at each period's end date.

    const restHr = userRestingHr || 55;
    const maxHrForTrimp = userMaxHr || Math.max(...globalActivities.map(a => parseFloat(a.maxHR) || 0).filter(v => v > 100), 185);

    // Build daily TRIMP map
    const dailyTRIMP = {};
    globalActivities.forEach(act => {
        const dateStr = (act.startTimeLocal || '').substring(0, 10);
        if (!dateStr) return;
        const dur = (parseFloat(act.duration) || 0) / 60; // minutes
        const avgHr = parseFloat(act.averageHR) || 0;
        if (dur <= 0 || avgHr <= 0) return;
        const hrRes = Math.min(Math.max((avgHr - restHr) / (maxHrForTrimp - restHr), 0), 1);
        const trimp = dur * hrRes * 0.64 * Math.exp(1.92 * hrRes);
        dailyTRIMP[dateStr] = (dailyTRIMP[dateStr] || 0) + trimp;
    });

    // Run day-by-day exponential smoothing over the full date range of our periods
    const atlDecay = Math.exp(-1 / 7);
    const ctlDecay = Math.exp(-1 / 42);

    // Determine start/end from period labels
    let simStart = null, simEnd = null;
    if (labels.length > 0) {
        // simStart = 90 days before first period to warm up CTL
        simStart = new Date(labels[0] + (period === 'monthly' ? '-01' : ''));
        simStart.setDate(simStart.getDate() - 90);
        simEnd = new Date(); // today
    }

    // Map period label → end date of that period
    const periodEndDateMap = {};
    labels.forEach((k, i) => {
        const nextKey = labels[i + 1];
        let endDate;
        if (period === 'weekly') {
            endDate = new Date(k);
            endDate.setDate(endDate.getDate() + 6);
        } else if (period === 'monthly') {
            const d = new Date(k + '-01');
            d.setMonth(d.getMonth() + 1);
            d.setDate(d.getDate() - 1);
            endDate = d;
        } else {
            endDate = new Date(k + '-12-31');
        }
        periodEndDateMap[k] = endDate.toISOString().substring(0, 10);
    });

    // Simulate day-by-day
    const atlByDate = {};
    const ctlByDate = {};
    let atl = 0, ctl = 0;
    if (simStart && simEnd) {
        const cur = new Date(simStart);
        while (cur <= simEnd) {
            const ds = cur.toISOString().substring(0, 10);
            const load = dailyTRIMP[ds] || 0;
            atl = atl * atlDecay + load * (1 - atlDecay);
            ctl = ctl * ctlDecay + load * (1 - ctlDecay);
            atlByDate[ds] = atl;
            ctlByDate[ds] = ctl;
            cur.setDate(cur.getDate() + 1);
        }
    }

    // Sample at each period's end date
    const atlValues = labels.map(k => {
        const ds = periodEndDateMap[k];
        return ds && atlByDate[ds] != null ? parseFloat(atlByDate[ds].toFixed(1)) : null;
    });
    const ctlValues = labels.map(k => {
        const ds = periodEndDateMap[k];
        return ds && ctlByDate[ds] != null ? parseFloat(ctlByDate[ds].toFixed(1)) : null;
    });
    const tsbValues = ctlValues.map((c, i) =>
        c !== null && atlValues[i] !== null ? parseFloat((c - atlValues[i]).toFixed(1)) : null
    );

    // Latest TSB for warning banner
    const latestTSB = tsbValues.length > 0 ? tsbValues[tsbValues.length - 1] : null;

    // === Zone 2 % ===
    const zone2Pct = labels.map(k => {
        const total = grouped[k].totalHrSecs;
        return total > 0 ? parseFloat(((grouped[k].zone2Secs / total) * 100).toFixed(1)) : null;
    });

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

    // 1b. Monthly Distance (past 1 year)
    const monthlyDistValues = monthLabels.map(k => monthlyDistGroups[k]);
    const monthlyDisplayLabels = monthLabels.map(k => `${k.slice(2, 4)}/${parseInt(k.slice(5))}月`);
    const ctxMo = document.getElementById('trendMonthlyDistChart').getContext('2d');
    if (trendMonthlyDistChart) trendMonthlyDistChart.destroy();
    trendMonthlyDistChart = new Chart(ctxMo, {
        type: 'bar',
        data: { labels: monthlyDisplayLabels, datasets: [{ label: '月間走行距離 (km)', data: monthlyDistValues, backgroundColor: '#3b82f6', borderRadius: 4 }] },
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

    // 2b. ATL / CTL / TSB
    // TSB warning banner
    const bannerEl = document.getElementById('tsb-warning-banner');
    if (bannerEl) {
        if (latestTSB !== null && latestTSB < -20) {
            bannerEl.style.display = 'flex';
            bannerEl.innerHTML = `⚠️ <strong>オーバートレーニング警告</strong>: 現在のTSB（フォーム）は <strong style="color:#fca5a5;">${latestTSB}</strong> です。休養または強度を下げることを推奨します。`;
        } else if (latestTSB !== null && latestTSB >= 10 && latestTSB <= 25) {
            bannerEl.style.display = 'flex';
            bannerEl.innerHTML = `🏁 <strong>レース最適状態</strong>: TSBは <strong style="color:#86efac;">${latestTSB}</strong> です。ピークパフォーマンスに近い状態です！`;
        } else {
            bannerEl.style.display = 'none';
        }
    }

    const ctxAtlCtl = document.getElementById('trendAtlCtlChart').getContext('2d');
    if (trendAtlCtlChart) trendAtlCtlChart.destroy();
    trendAtlCtlChart = new Chart(ctxAtlCtl, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                { label: 'CTL フィットネス (42日)', data: ctlValues, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.4, spanGaps: true, pointRadius: 2, borderWidth: 2.5, yAxisID: 'y' },
                { label: 'ATL 疲労 (7日)', data: atlValues, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.06)', fill: true, tension: 0.4, spanGaps: true, pointRadius: 2, borderWidth: 2.5, yAxisID: 'y' },
                { label: 'TSB フォーム (CTL-ATL)', data: tsbValues, borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.0)', fill: false, tension: 0.4, spanGaps: true, pointRadius: 2, borderWidth: 2, borderDash: [4, 3], yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#475569', usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        afterBody: function (items) {
                            const tsb = tsbValues[items[0].dataIndex];
                            if (tsb === null) return '';
                            let state = '';
                            if (tsb > 25) state = '🟦 Too Fresh';
                            else if (tsb >= 10) state = '🟩 Peaked レース最適';
                            else if (tsb >= 0) state = '🟨 Fresh';
                            else if (tsb >= -10) state = '🟧 Productive';
                            else if (tsb >= -20) state = '🟥 High Load';
                            else state = '🔴 Overtraining Risk!';
                            return `状態: ${state}`;
                        }
                    }
                }
            },
            scales: {
                x: xScale,
                y: { beginAtZero: true, title: { display: true, text: 'TRIMP Load', color: '#64748b' }, ticks: { color: '#64748b' }, position: 'left' },
                y1: {
                    title: { display: true, text: 'TSB (Form)', color: '#a855f7' },
                    ticks: { color: '#a855f7' },
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    afterDataLimits: (axis) => {
                        // Ensure 0 line is visible
                        axis.min = Math.min(axis.min, -30);
                        axis.max = Math.max(axis.max, 30);
                    }
                }
            }
        }
    });

    // 2c. Zone 2 %
    const ctxZ2 = document.getElementById('trendZone2Chart').getContext('2d');
    if (trendZone2Chart) trendZone2Chart.destroy();
    trendZone2Chart = new Chart(ctxZ2, {
        type: 'bar',
        data: { labels: displayLabels, datasets: [{ label: 'Zone2 割合 (%)', data: zone2Pct, backgroundColor: zone2Pct.map(v => v !== null && v >= 70 ? '#10b981' : '#94a3b8'), borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                annotation: { annotations: [{ type: 'line', yMin: 80, yMax: 80, borderColor: '#10b981', borderWidth: 2, borderDash: [6, 4], label: { content: '目標80%', display: true, position: 'end', color: '#10b981', font: { size: 11 } } }] }
            },
            scales: { x: xScale, y: { min: 0, max: 100, title: { display: true, text: 'Zone2 %', color: '#64748b' }, ticks: { color: '#64748b', callback: v => v + '%' } } }
        }
    });

    // 3. Pace + HR — removed (replaced by GPX-based pace-zone analysis)
    if (trendPaceHRChart) { trendPaceHRChart.destroy(); trendPaceHRChart = null; }

    // 4. Aerobic Efficiency — removed (replaced by GPX-based pace-zone AE)
    if (trendAeChart) { trendAeChart.destroy(); trendAeChart = null; }

    // 4b. Activity-summary pace-zone HR/AE — removed (GPX-based section handles this)
    if (trendHrByPaceChart) { trendHrByPaceChart.destroy(); trendHrByPaceChart = null; }
    if (trendAeByPaceChart) { trendAeByPaceChart.destroy(); trendAeByPaceChart = null; }
    if (trendCadenceByPaceChart) { trendCadenceByPaceChart.destroy(); trendCadenceByPaceChart = null; }
    if (trendStrideByPaceChart) { trendStrideByPaceChart.destroy(); trendStrideByPaceChart = null; }
    if (trendOscByPaceChart) { trendOscByPaceChart.destroy(); trendOscByPaceChart = null; }
    if (trendGctByPaceChart) { trendGctByPaceChart.destroy(); trendGctByPaceChart = null; }

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

    // 7. Cadence + Stride (removed — duplicated by pace-zone section)
    if (trendCadenceChart) { trendCadenceChart.destroy(); trendCadenceChart = null; }
    if (trendFormChart) { trendFormChart.destroy(); trendFormChart = null; }
}

// ============== Calendar Heatmap ============== //
/**
 * Renders a GitHub-style activity heatmap.
 * dateFrom / dateTo: ISO date strings (YYYY-MM-DD), optional.
 * The calendar always shows the range [displayStart, displayEnd],
 * aligned to full weeks (Sun→Sat), capped at MAX_WEEKS columns.
 */
function renderCalendar(activities, dateFrom, dateTo) {
    const container = document.getElementById('calendar-heatmap');
    if (!container) return;

    // Build a date → km map from the provided activities
    const dateMap = {};
    activities.forEach(act => {
        const dateStr = (act.startTimeLocal || '').substring(0, 10);
        if (!dateStr) return;
        const distKm = parseFloat(act.distance) / 1000 || 0;
        dateMap[dateStr] = (dateMap[dateStr] || 0) + distKm;
    });

    // Determine display window
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let displayEnd = today;
    if (dateTo) {
        const parsed = new Date(dateTo);
        if (!isNaN(parsed) && parsed < today) displayEnd = parsed;
    }
    displayEnd.setHours(0, 0, 0, 0);

    // Default: 52 weeks back from displayEnd; if dateFrom given, use it
    const MAX_WEEKS = 53;
    let displayStart;
    if (dateFrom) {
        displayStart = new Date(dateFrom);
        if (isNaN(displayStart)) displayStart = null;
    }
    if (!displayStart) {
        displayStart = new Date(displayEnd);
        displayStart.setDate(displayStart.getDate() - 364);
    }

    // Cap to MAX_WEEKS to avoid enormous grids
    const maxStartMs = displayEnd.getTime() - MAX_WEEKS * 7 * 86400_000;
    if (displayStart.getTime() < maxStartMs) {
        displayStart = new Date(maxStartMs);
    }

    // Align displayStart to the nearest Sunday on or before
    displayStart.setDate(displayStart.getDate() - displayStart.getDay());
    displayStart.setHours(0, 0, 0, 0);

    const getColor = (km) => {
        if (!km || km === 0) return '#e2e8f0';
        if (km < 5) return '#bbf7d0';
        if (km < 10) return '#4ade80';
        if (km < 20) return '#16a34a';
        return '#052e16';
    };

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weeks = [];
    let current = new Date(displayStart);
    while (current <= displayEnd) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const ds = current.toISOString().substring(0, 10);
            week.push({
                dateStr: ds,
                distKm: dateMap[ds] || 0,
                isFuture: current > displayEnd,
            });
            current.setDate(current.getDate() + 1);
        }
        weeks.push(week);
    }

    // Build HTML
    let prevMonth = -1;
    let html = `<div style="display:flex;gap:2px;align-items:flex-start;">`;

    // Day-of-week labels
    html += `<div style="display:flex;flex-direction:column;gap:2px;padding-top:20px;margin-right:4px;">`;
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((label, i) => {
        html += `<div style="height:12px;font-size:10px;color:#94a3b8;line-height:12px;">${[1, 3, 5].includes(i) ? label : ''}</div>`;
    });
    html += `</div>`;

    weeks.forEach(week => {
        html += `<div style="display:flex;flex-direction:column;gap:2px;">`;
        const monthDate = new Date(week[0].dateStr);
        const month = monthDate.getMonth();
        const showMonth = month !== prevMonth && monthDate.getDate() <= 7;
        if (showMonth) prevMonth = month;
        html += `<div style="height:18px;font-size:10px;color:#94a3b8;text-align:center;">${showMonth ? monthLabels[month] : ''}</div>`;
        week.forEach(day => {
            const color = day.isFuture ? 'transparent' : getColor(day.distKm);
            const title = day.distKm > 0
                ? `${day.dateStr}: ${day.distKm.toFixed(1)}km`
                : day.dateStr;
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

// Preset change: only fill inputs, do NOT auto-calculate
document.getElementById('trail-presets').addEventListener('change', (e) => {
    const val = e.target.value;
    const merged = getMergedPresets();
    if (val && merged[val]) {
        document.getElementById('trail-target-dist').value = merged[val].dist;
        document.getElementById('trail-target-elev').value = merged[val].elev;
    }
    // No auto-calc: user must click Predict Time
});

// Remove auto-trigger on filter input change (inputs no longer trigger directly)
// document.getElementById('trail-filter-elev')?.addEventListener('input', renderTrailCalculator);
// document.getElementById('trail-filter-pace')?.addEventListener('input', renderTrailCalculator);

// Main trigger: Predict Time button runs model rebuild + prediction
document.getElementById('btn-calc-trail').addEventListener('click', () => {
    renderTrailCalculator(); // rebuild regression from filters + date range
    calculateTrailTime();    // compute prediction
});

function renderTrailCalculator() {
    if (!globalActivities || globalActivities.length === 0) return;

    trailDataPoints = [];

    const minElev = parseFloat(document.getElementById('trail-filter-elev')?.value || 30);
    const maxPaceMinKm = parseFloat(document.getElementById('trail-filter-pace')?.value || 20);
    const dateFromStr = document.getElementById('trail-date-from')?.value || null;
    const dateToStr = document.getElementById('trail-date-to')?.value || null;
    const fromMs = dateFromStr ? new Date(dateFromStr).getTime() : null;
    const toMs = dateToStr ? new Date(dateToStr + 'T23:59:59').getTime() : null;

    // Detect trail runs with all filters applied
    const trailRuns = globalActivities.filter(act => {
        const distKm = (act.distance || 0) / 1000;
        const elevM = act.elevationGain || 0;
        if (distKm < 1 || !act.duration) return false;

        // Date range filter
        if (fromMs || toMs) {
            const dStr = (act.startTimeLocal || '').replace(' ', 'T');
            const t = new Date(dStr).getTime();
            if (fromMs && t < fromMs) return false;
            if (toMs && t > toMs) return false;
        }

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
    // Do NOT call calculateTrailTime here – Predict Time button does both steps.
}

// btn-calc-trail is now set up above (single listener replaces old one).
// Keep this stub so no duplicate listener.

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


// ============================================================
// GPX-based Pace-Zone Analysis
// ============================================================

const ZONE_COLORS = {
    '<5:00': '#ef4444',
    '5:00-6:00': '#f97316',
    '6:00-7:00': '#eab308',
    '7:00-8:00': '#22c55e',
    '>8:00': '#3b82f6',
};

let pzOverallChart = null;
let pzStatsCache = null;

async function fetchAndRenderPaceZoneStats(force = false) {
    if (!currentUser) return;

    const loadingEl = document.getElementById('pace-zone-loading');
    const chartsEl = document.getElementById('pace-zone-charts');
    const btnEl = document.getElementById('btn-analyze-pace-zones');

    loadingEl.style.display = 'flex';
    chartsEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;

    try {
        const dateFrom = trendDateFrom || '';
        const dateTo = trendDateTo || '';
        let url = '/api/pace-zone-stats?user_id=' + encodeURIComponent(currentUser.id) + '&period=' + currentTrendPeriod;
        if (dateFrom) url += '&date_from=' + dateFrom;
        if (dateTo) url += '&date_to=' + dateTo;
        if (force) url += '&force=true';

        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        pzStatsCache = await res.json();

        renderPaceZoneCharts(pzStatsCache);
        loadingEl.style.display = 'none';
        chartsEl.style.display = 'block';

        const meta = document.getElementById('pace-zone-meta');
        if (meta) {
            const cacheLabel = pzStatsCache.from_cache ? '（DBキャッシュ）' : '（新規計算 + DB保存済）';
            meta.textContent = cacheLabel + ' 分析対象: ' + pzStatsCache.activity_count + ' activities / ' + (pzStatsCache.point_count || '―').toLocaleString() + ' GPX points';
        }
    } catch (e) {
        console.error('Pace-zone stats error:', e);
        const lt = document.getElementById('pace-zone-loading-text');
        if (lt) lt.textContent = '⚠️ データの取得に失敗しました。しばらくしてから再試行してください。';
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

function renderPaceZoneCharts(data) {
    const zoneNames = data.zone_names || ['<5:00', '5:00-6:00', '6:00-7:00', '7:00-8:00', '>8:00'];
    const xScale = { grid: { display: false }, ticks: { color: '#64748b' } };

    // 1. Overall bar chart
    {
        const labels = zoneNames.filter(function (z) { return data.overall[z]; });
        const timeMins = labels.map(function (z) { return data.overall[z] ? data.overall[z].time_mins : 0; });
        const avgHrs = labels.map(function (z) { return data.overall[z] ? data.overall[z].avg_hr : null; });
        const colors = labels.map(function (z) { return ZONE_COLORS[z] || '#94a3b8'; });

        const ctx = document.getElementById('paceZoneOverallChart').getContext('2d');
        if (pzOverallChart) pzOverallChart.destroy();
        pzOverallChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: '累計時間(分)', data: timeMins, backgroundColor: colors.map(function (c) { return c + 'cc'; }), borderColor: colors, borderWidth: 1, borderRadius: 6, yAxisID: 'y' },
                    { label: '平均心拍(bpm)', data: avgHrs, type: 'line', borderColor: '#64748b', backgroundColor: 'transparent', pointBackgroundColor: '#64748b', pointRadius: 5, tension: 0.3, yAxisID: 'y1' },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569' } } },
                scales: {
                    x: xScale,
                    y: { beginAtZero: true, title: { display: true, text: 'minutes', color: '#64748b' }, ticks: { color: '#64748b' }, position: 'left' },
                    y1: { title: { display: true, text: 'avg HR (bpm)', color: '#64748b' }, ticks: { color: '#64748b' }, position: 'right', grid: { drawOnChartArea: false } },
                },
            },
        });
    }

    // Period labels
    const periods = data.time_series.map(function (p) { return p.period; });
    const displayPeriods = periods.map(function (pk) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(pk)) {
            var parts = pk.split('-');
            return parts[0].slice(2) + '/' + parseInt(parts[1]) + '/' + parseInt(parts[2]) + '〜';
        } else if (/^\d{4}-\d{2}$/.test(pk)) {
            var parts = pk.split('-');
            return parts[0].slice(2) + '/' + parseInt(parts[1]) + '月';
        }
        return pk;
    });

    function buildDatasets(field) {
        return zoneNames.map(function (zn) {
            return {
                label: zn,
                data: data.time_series.map(function (p) { return p.zones[zn] ? p.zones[zn][field] : null; }),
                borderColor: ZONE_COLORS[zn] || '#94a3b8',
                backgroundColor: (ZONE_COLORS[zn] || '#94a3b8') + '22',
                tension: 0.4, spanGaps: true, pointRadius: 3, borderWidth: 2,
            };
        });
    }

    // 2. HR time-series
    {
        var ctx2 = document.getElementById('trendHrByPaceChart').getContext('2d');
        if (trendHrByPaceChart) trendHrByPaceChart.destroy();
        trendHrByPaceChart = new Chart(ctx2, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_hr') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '平均心拍数 (bpm)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }

    // 3. AE time-series
    {
        var ctx3 = document.getElementById('trendAeByPaceChart').getContext('2d');
        if (trendAeByPaceChart) trendAeByPaceChart.destroy();
        trendAeByPaceChart = new Chart(ctx3, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_ae') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '有酸素効率 (Speed×1000/HR)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }

    // 4. Cadence time-series
    {
        var ctx4 = document.getElementById('trendCadenceByPaceChart').getContext('2d');
        if (trendCadenceByPaceChart) trendCadenceByPaceChart.destroy();
        trendCadenceByPaceChart = new Chart(ctx4, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_cadence') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '平均ピッチ (spm)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }

    // 5. Stride time-series
    {
        var ctx5 = document.getElementById('trendStrideByPaceChart').getContext('2d');
        if (trendStrideByPaceChart) trendStrideByPaceChart.destroy();
        trendStrideByPaceChart = new Chart(ctx5, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_stride') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '平均ストライド (m)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }

    // 6. Oscillation time-series
    {
        var ctx6 = document.getElementById('trendOscByPaceChart').getContext('2d');
        if (trendOscByPaceChart) trendOscByPaceChart.destroy();
        trendOscByPaceChart = new Chart(ctx6, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_vert_osc') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '平均上下動 (cm)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }

    // 7. GCT time-series
    {
        var ctx7 = document.getElementById('trendGctByPaceChart').getContext('2d');
        if (trendGctByPaceChart) trendGctByPaceChart.destroy();
        trendGctByPaceChart = new Chart(ctx7, {
            type: 'line',
            data: { labels: displayPeriods, datasets: buildDatasets('avg_gct') },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#475569', usePointStyle: true } } },
                scales: { x: xScale, y: { title: { display: true, text: '平均接地時間 (ms)', color: '#64748b' }, ticks: { color: '#64748b' } } },
            },
        });
    }
}

// Wire the buttons
document.getElementById('btn-analyze-pace-zones') &&
    document.getElementById('btn-analyze-pace-zones').addEventListener('click', () => fetchAndRenderPaceZoneStats(false));
document.getElementById('btn-force-recompute') &&
    document.getElementById('btn-force-recompute').addEventListener('click', () => fetchAndRenderPaceZoneStats(true));
