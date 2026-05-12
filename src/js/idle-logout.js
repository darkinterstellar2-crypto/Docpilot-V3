/**
 * idle-logout.js — Inactivity auto-logout
 * 
 * Logs users out after a period of inactivity:
 * - Regular users: 2 hours (120 minutes)
 * - Superadmin: 30 minutes
 * 
 * Any user interaction (click, keypress, scroll, mousemove, touch, fetch)
 * resets the inactivity timer. Uses localStorage timestamp so the timer
 * is shared across all tabs for the same session.
 * 
 * Include this script on every authenticated page AFTER api.js.
 */
(function() {
    'use strict';

    // ── Configuration ──────────────────────────────────────────────────────────
    const IDLE_MS_USER       = 2 * 60 * 60 * 1000;   // 2 hours for regular users
    const IDLE_MS_SUPERADMIN = 30 * 60 * 1000;        // 30 minutes for superadmin
    const CHECK_INTERVAL_MS  = 30 * 1000;             // Check every 30 seconds
    const WARN_BEFORE_MS     = 2 * 60 * 1000;         // Show warning 2 min before logout
    const LS_KEY             = '_docpilot_lastActive'; // localStorage key for last activity

    // ── State ──────────────────────────────────────────────────────────────────
    const role     = (localStorage.getItem('userRole') || '').toLowerCase();
    const email    = localStorage.getItem('userEmail');
    const idleMs   = role === 'superadmin' ? IDLE_MS_SUPERADMIN : IDLE_MS_USER;
    let warned         = false;   // have we shown the warning already?
    let warningEl      = null;    // DOM element for warning banner
    let intervalId     = null;
    let warnIntervalId = null;    // faster interval during warning countdown
    let loggingOut     = false;   // guard against double-fire from dual intervals

    // Don't run on login/register pages
    if (!email || !role) return;

    // ── Touch / reset activity ─────────────────────────────────────────────────
    function touchActivity() {
        localStorage.setItem(LS_KEY, String(Date.now()));
        if (warned) hideWarning();
    }

    function getLastActive() {
        const ts = parseInt(localStorage.getItem(LS_KEY), 10);
        return isNaN(ts) ? Date.now() : ts;
    }

    // Set initial timestamp
    touchActivity();

    // ── Event listeners (passive for performance) ──────────────────────────────
    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart', 'touchmove'];
    // Throttle: only update localStorage at most once per 10 seconds for high-frequency events
    let lastTouch = 0;
    function throttledTouch() {
        const now = Date.now();
        if (now - lastTouch > 10000) {
            lastTouch = now;
            touchActivity();
        }
    }

    events.forEach(evt => {
        document.addEventListener(evt, throttledTouch, { passive: true, capture: true });
    });

    // Also intercept fetch calls as activity signal (piggyback on window.fetch)
    const _prevFetch = window.fetch;
    window.fetch = function(...args) {
        throttledTouch();
        return _prevFetch.apply(this, args);
    };

    // Listen for activity in other tabs via storage event
    window.addEventListener('storage', (e) => {
        if (e.key === LS_KEY && e.newValue) {
            // Another tab was active — reset our warning state
            if (warned) hideWarning();
        }
    });

    // ── Warning banner ─────────────────────────────────────────────────────────
    function showWarning(remainingSec) {
        warned = true;
        if (!warningEl) {
            warningEl = document.createElement('div');
            warningEl.id = 'idle-warning-banner';
            warningEl.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
                'background:linear-gradient(135deg,#dc2626,#b91c1c)', 'color:white',
                'padding:12px 20px', 'text-align:center', 'font-size:14px', 'font-weight:600',
                'font-family:Inter,system-ui,sans-serif',
                'box-shadow:0 4px 20px rgba(220,38,38,0.4)',
                'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
                'animation:slideDown 0.3s ease-out',
            ].join(';');
            // Add animation keyframes
            const style = document.createElement('style');
            style.textContent = '@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}';
            document.head.appendChild(style);
            document.body.appendChild(warningEl);
        }
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        const timeStr = mins > 0 ? `${mins}m ${String(secs).padStart(2,'0')}s` : `${secs}s`;
        warningEl.innerHTML = `
            <span>⚠️ You will be logged out due to inactivity in <strong>${timeStr}</strong></span>
            <button id="idle-stay-btn" style="
                background:white; color:#dc2626; border:none; border-radius:6px;
                padding:6px 16px; font-weight:700; font-size:13px; cursor:pointer;
                transition:transform 0.1s;
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                Stay Logged In
            </button>
        `;
        warningEl.style.display = 'flex';
        // Bind stay button directly (bypass throttle)
        const stayBtn = document.getElementById('idle-stay-btn');
        if (stayBtn) stayBtn.onclick = () => { lastTouch = 0; touchActivity(); };
    }

    function hideWarning() {
        warned = false;
        if (warningEl) warningEl.style.display = 'none';
        // Stop fast countdown interval when warning is dismissed
        if (warnIntervalId) { clearInterval(warnIntervalId); warnIntervalId = null; }
    }

    // ── Logout ─────────────────────────────────────────────────────────────────
    function doIdleLogout() {
        if (loggingOut) return;
        loggingOut = true;
        clearInterval(intervalId);
        if (warnIntervalId) clearInterval(warnIntervalId);
        localStorage.removeItem(LS_KEY);
        // Use the shared doLogout function if available, otherwise manual logout
        if (typeof window.doLogout === 'function') {
            window.doLogout();
        } else {
            localStorage.removeItem('userRole');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userName');
            localStorage.removeItem('authToken');
            alert('You have been logged out due to inactivity.');
            window.location.href = 'login.html';
        }
    }

    // ── Periodic check ─────────────────────────────────────────────────────────
    function checkIdle() {
        const elapsed = Date.now() - getLastActive();
        const remaining = idleMs - elapsed;

        if (remaining <= 0) {
            doIdleLogout();
            return;
        }

        if (remaining <= WARN_BEFORE_MS) {
            showWarning(Math.round(remaining / 1000));
            // Switch to fast updates (every 5s) for smooth countdown
            if (!warnIntervalId) {
                warnIntervalId = setInterval(checkIdle, 5000);
            }
        } else if (warned) {
            // Warning was dismissed (user became active) — stop fast updates
            hideWarning();
            if (warnIntervalId) { clearInterval(warnIntervalId); warnIntervalId = null; }
        }
    }

    intervalId = setInterval(checkIdle, CHECK_INTERVAL_MS);

    // Also check immediately on visibility change (tab becomes visible after being hidden)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkIdle();
    });

})();
