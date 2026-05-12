/**
 * planner.js — Appointment Planner page logic
 * DocPilot | v20260414a
 */

(function() {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────────────
    const HOUR_START = 6;   // 06:00
    const HOUR_END   = 22;  // 22:00
    const HOURS      = HOUR_END - HOUR_START; // 16
    const PX_PER_HOUR = 80;  // taller rows = more room for text
    const PX_PER_MIN  = PX_PER_HOUR / 60;
    const BUFFER_MINS = 40;

    const MODULE_COLORS = {
        einblasen:    { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8', dot: '#3B82F6' },
        apl:          { bg: '#ECFDF5', border: '#10B981', text: '#065F46', dot: '#10B981' },
        druckprufung: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E', dot: '#F59E0B' },
        kalibrieren:  { bg: '#F5F3FF', border: '#8B5CF6', text: '#4C1D95', dot: '#8B5CF6' },
        otdr:         { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B', dot: '#EF4444' },
    };
    const DEFAULT_COLOR = { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151', dot: '#9CA3AF' };

    function moduleColor(mod) {
        return MODULE_COLORS[(mod || '').toLowerCase()] || DEFAULT_COLOR;
    }

    function modLabel(mod) {
        const map = {
            einblasen: 'Einblasen',
            apl: 'APL',
            druckprufung: 'Druckprüfung',
            kalibrieren: 'Kalibrieren',
            otdr: 'OTDR',
        };
        const k = (mod || '').toLowerCase();
        return map[k] || (mod ? mod.charAt(0).toUpperCase() + mod.slice(1) : 'Unknown');
    }

    function modulePageUrl(mod, projectName, appt) {
        const map = {
            einblasen: 'einblasen.html',
            apl: 'apl.html',
            druckprufung: 'druckprufung.html',
            kalibrieren: 'kalibrieren.html',
            otdr: 'otdr.html',
        };
        const k = (mod || '').toLowerCase();
        const page = map[k];
        if (!page) return null;
        let url = `${page}?project=${encodeURIComponent(projectName)}`;
        if (appt) {
            if (appt.cluster)      url += `&cluster=${encodeURIComponent(appt.cluster)}`;
            if (appt.knotenpunkt)  url += `&knotenpunkt=${encodeURIComponent(appt.knotenpunkt)}`;
            if (appt.addressStart) url += `&address=${encodeURIComponent(appt.addressStart)}`;
        }
        return url;
    }

    // ── State ──────────────────────────────────────────────────────────────────
    let projectName  = '';
    let allAppts     = [];  // raw from API
    let filterModule = '';  // '' = all
    let currentDate  = todayStr();
    let userEmail    = localStorage.getItem('userEmail') || '';
    let userRole     = localStorage.getItem('userRole')  || '';

    // ── Init ───────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        // Auth check
        if (!userRole) { window.location.href = 'login.html'; return; }

        // Parse project from URL
        const params = new URLSearchParams(window.location.search);
        projectName = params.get('project') || '';
        if (!projectName) {
            showError('No project specified. Please open from the dashboard.');
            return;
        }

        document.getElementById('projectLabel').textContent = projectName;
        document.title = `DocPilot — Planner — ${projectName}`;

        // Set date picker to today
        document.getElementById('datePicker').value = currentDate;
        updateDateLabel();

        // ── ACL check for 'planner' module ────────────────────────────────────
        if (userRole !== 'superadmin') {
            try {
                const res = await fetch(`/api/access/my-permissions?project=${encodeURIComponent(projectName)}`, {
                    headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
                });
                const data = await res.json();
                if (!data.success || data.permissions?.planner !== true) {
                    showError('Access denied: you do not have Planner access for this project.');
                    return;
                }
            } catch (e) {
                console.warn('Permission check failed, proceeding:', e.message);
            }
        }

        // Bind navigation events
        document.getElementById('prevDayBtn').addEventListener('click', () => changeDay(-1));
        document.getElementById('nextDayBtn').addEventListener('click', () => changeDay(+1));
        document.getElementById('todayBtn').addEventListener('click', () => gotoDate(todayStr()));
        document.getElementById('datePicker').addEventListener('change', (e) => gotoDate(e.target.value));
        document.getElementById('moduleFilter').addEventListener('change', (e) => {
            filterModule = e.target.value;
            renderDay();
        });
        document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
        document.getElementById('apptDetailPanel').addEventListener('click', (e) => {
            if (e.target === document.getElementById('apptDetailPanel')) closeDetail();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDetail();
        });

        // Load appointments
        await loadAppointments();
    }

    // ── Data Loading ───────────────────────────────────────────────────────────

    async function loadAppointments() {
        showLoading();
        try {
            const res = await fetch(`/api/modules/appointments?project=${encodeURIComponent(projectName)}`, {
                headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Unknown error');
            allAppts = data.appointments || [];
            populateModuleFilter();
            renderWeekBar();
            renderDay();
        } catch (e) {
            showError('Could not load appointments: ' + e.message);
        }
    }

    // ── Module Filter Dropdown ─────────────────────────────────────────────────

    function populateModuleFilter() {
        const select = document.getElementById('moduleFilter');
        // Clear existing options (keep first "All Modules")
        while (select.options.length > 1) select.remove(1);

        const modules = [...new Set(allAppts.map(a => a.module))].filter(Boolean).sort();
        modules.forEach(mod => {
            const opt = document.createElement('option');
            opt.value = mod;
            opt.textContent = modLabel(mod);
            select.appendChild(opt);
        });
    }

    // ── Week Bar ───────────────────────────────────────────────────────────────

    function renderWeekBar() {
        const bar = document.getElementById('weekBar');
        bar.innerHTML = '';

        // Build week: Mon–Sun containing currentDate
        const days = weekDays(currentDate);
        const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

        days.forEach((dayStr, i) => {
            const count = allAppts.filter(a => a.date === dayStr && (!filterModule || a.module === filterModule)).length;
            const isActive = dayStr === currentDate;
            const color = moduleColor('');

            const btn = document.createElement('button');
            btn.className = `week-day-btn${isActive ? ' active' : ''}${count > 0 ? ' has-appts' : ''}`;
            btn.innerHTML = `
                <div class="text-xs font-semibold ${isActive ? 'text-white' : 'text-gray-500'}">${dayNames[i]}</div>
                <div class="text-sm font-bold ${isActive ? 'text-white' : 'text-gray-800'} leading-tight">${dayStr.split('-')[2]}</div>
                ${count > 0 ? `<div class="appt-badge ${isActive ? 'bg-white text-gray-900' : 'bg-gray-800 text-white'}">${count > 9 ? '9+' : count}</div>` : '<div style="height:20px"></div>'}
            `;
            btn.addEventListener('click', () => gotoDate(dayStr));
            bar.appendChild(btn);
        });
    }

    // ── Day View ───────────────────────────────────────────────────────────────

    function renderDay() {
        const filtered = allAppts.filter(a => {
            if (a.date !== currentDate) return false;
            if (filterModule && a.module !== filterModule) return false;
            return true;
        });

        document.getElementById('plannerLoading').classList.add('hidden');
        document.getElementById('plannerError').classList.add('hidden');

        if (filtered.length === 0) {
            document.getElementById('plannerContent').classList.add('hidden');
            document.getElementById('plannerEmpty').classList.remove('hidden');
            renderWeekBar();
            return;
        }

        document.getElementById('plannerEmpty').classList.add('hidden');
        document.getElementById('plannerContent').classList.remove('hidden');

        const grid = document.getElementById('timelineGrid');
        const totalPx = HOURS * PX_PER_HOUR;
        grid.style.height = `${totalPx}px`;
        grid.innerHTML = '';

        // Draw hour lines + labels
        for (let h = 0; h <= HOURS; h++) {
            const hour = HOUR_START + h;
            const top = h * PX_PER_HOUR;
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.cssText = `top:${top}px; height:${PX_PER_HOUR}px; position:absolute; left:0; right:0;`;
            line.innerHTML = `
                <span class="hour-label">${String(hour).padStart(2,'0')}:00</span>
                <div class="flex-1 border-t border-gray-100 mt-[6px]"></div>
            `;
            grid.appendChild(line);
        }

        // Sort by time, then compute overlap columns for visual staggering
        const sorted = [...filtered].sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

        // Assign overlap columns: appointments within 40 min of each other share a group
        // Each gets a column index and total column count for width/offset calculation
        const overlapInfo = new Map(); // appt index → { col, totalCols }
        const groups = []; // each group = [{ idx, startMin }]
        sorted.forEach((appt, idx) => {
            if (!appt.time) return;
            const [h, m] = appt.time.split(':').map(Number);
            const startMin = (h * 60 + m) - HOUR_START * 60;
            // Find a group whose last member overlaps (within 40 min)
            let placed = false;
            for (const group of groups) {
                const last = group[group.length - 1];
                if (startMin - last.startMin < 40) {
                    group.push({ idx, startMin });
                    placed = true;
                    break;
                }
            }
            if (!placed) groups.push([{ idx, startMin }]);
        });
        groups.forEach(group => {
            group.forEach((item, col) => {
                overlapInfo.set(item.idx, { col, totalCols: group.length });
            });
        });

        // Draw buffer zones first (so they're behind blocks)
        sorted.forEach(appt => {
            if (!appt.time) return;
            const [h, m] = appt.time.split(':').map(Number);
            const startMin = (h * 60 + m) - HOUR_START * 60;
            if (startMin < 0 || startMin > HOURS * 60) return;

            const bufTop = Math.max(0, (startMin - BUFFER_MINS)) * PX_PER_MIN;
            const bufBottom = Math.min(HOURS * 60, startMin + BUFFER_MINS) * PX_PER_MIN;
            const bufH = bufBottom - bufTop;
            const col = moduleColor(appt.module);

            const buf = document.createElement('div');
            buf.className = 'appt-buffer';
            buf.style.cssText = `top:${bufTop}px; height:${bufH}px; left:44px; right:0; background:${col.dot};`;
            grid.appendChild(buf);
        });

        // Draw appointment blocks
        sorted.forEach((appt, idx) => {
            if (!appt.time) return;
            const [h, m] = appt.time.split(':').map(Number);
            const startMin = (h * 60 + m) - HOUR_START * 60;
            if (startMin < 0 || startMin > HOURS * 60) return;

            const topPx  = startMin * PX_PER_MIN;
            const heightPx = 40 * PX_PER_MIN; // 40 min block
            const col = moduleColor(appt.module);
            const addrDisplay = appt.addressStart
                ? (appt.addressEnd && appt.addressEnd !== appt.addressStart
                    ? `${appt.addressStart} → ${appt.addressEnd}`
                    : appt.addressStart)
                : appt.addressEnd || '(no address)';

            const block = document.createElement('div');
            block.className = 'appt-block';
            block.dataset.idx = String(idx);
            // Overlap staggering: split available width among overlapping blocks
            const overlap = overlapInfo.get(idx) || { col: 0, totalCols: 1 };
            const availWidth = 'calc(100% - 52px)'; // 48px label + 4px right pad
            const colWidth = overlap.totalCols > 1 ? `calc((100% - 52px) / ${overlap.totalCols})` : availWidth;
            const colLeft  = overlap.totalCols > 1 ? `calc(48px + (100% - 52px) * ${overlap.col} / ${overlap.totalCols})` : '48px';
            block.style.cssText = [
                `top:${topPx}px`,
                `height:${heightPx}px`,
                `left:${colLeft}`,
                `width:${colWidth}`,
                `background:${col.bg}`,
                `border-left:3px solid ${col.border}`,
                `box-shadow:0 1px 4px rgba(0,0,0,0.06)`,
            ].join(';');

            block.innerHTML = `
                <div class="flex items-center gap-1.5 mb-1">
                    <span class="text-sm font-bold" style="color:${col.text}">${esc(appt.time) || '--:--'}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded font-bold" style="background:${col.border}25; color:${col.text}">${esc(modLabel(appt.module))}</span>
                </div>
                <div class="text-xs font-bold text-gray-900" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(addrDisplay)}</div>
                ${appt.knotenpunkt ? `<div class="text-xs font-medium text-gray-500 mt-0.5" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(appt.knotenpunkt)}${appt.cluster ? ` · ${esc(appt.cluster)}` : ''}</div>` : ''}
            `;

            block.addEventListener('click', () => openDetail(appt));
            grid.appendChild(block);
        });

        renderWeekBar();

        // Scroll to first appointment (or 8:00 default)
        const firstAppt = sorted[0];
        if (firstAppt && firstAppt.time) {
            const [h, m] = firstAppt.time.split(':').map(Number);
            const scrollTo = Math.max(0, (h * 60 + m - HOUR_START * 60 - 30)) * PX_PER_MIN;
            document.getElementById('timelineContainer').scrollTop = scrollTo;
        } else {
            document.getElementById('timelineContainer').scrollTop = 2 * PX_PER_HOUR; // 8:00
        }
    }

    // ── Detail Panel ───────────────────────────────────────────────────────────

    function openDetail(appt) {
        const col = moduleColor(appt.module);
        const addrDisplay = appt.addressStart
            ? (appt.addressEnd && appt.addressEnd !== appt.addressStart
                ? `${appt.addressStart} → ${appt.addressEnd}`
                : appt.addressStart)
            : appt.addressEnd || '(no address)';

        const pageUrl = modulePageUrl(appt.module, projectName, appt);

        document.getElementById('apptDetailContent').innerHTML = `
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${col.dot}"></span>
                    <span class="text-sm font-semibold" style="color:${col.text}">${esc(modLabel(appt.module))}</span>
                </div>
                <div>
                    <p class="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Date &amp; Time</p>
                    <p class="text-lg font-bold text-gray-900">${esc(formatDate(appt.date))}${appt.time ? `, ${esc(appt.time)}` : ''}</p>
                </div>
                <div>
                    <p class="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Address</p>
                    <p class="text-sm font-semibold text-gray-800">${esc(addrDisplay)}</p>
                </div>
                ${appt.knotenpunkt ? `
                <div>
                    <p class="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Knotenpunkt</p>
                    <p class="text-sm text-gray-700">${esc(appt.knotenpunkt)}${appt.cluster ? ` — ${esc(appt.cluster)}` : ''}</p>
                </div>` : ''}
                ${appt.notes ? `
                <div>
                    <p class="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Notes</p>
                    <p class="text-sm text-gray-700">${esc(appt.notes)}</p>
                </div>` : ''}
                ${pageUrl ? `
                <div class="pt-2 border-t border-gray-100">
                    <a href="${pageUrl}" class="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                        Edit in ${esc(modLabel(appt.module))}
                    </a>
                </div>` : ''}
            </div>
        `;

        const panel = document.getElementById('apptDetailPanel');
        panel.classList.remove('hidden');
        requestAnimationFrame(() => {
            document.getElementById('apptDetailBox').style.opacity = '1';
        });
    }

    function closeDetail() {
        document.getElementById('apptDetailPanel').classList.add('hidden');
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Local YYYY-MM-DD (timezone-safe — never uses UTC) */
    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function localDateStr(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function changeDay(delta) {
        const d = new Date(currentDate + 'T12:00:00'); // noon avoids DST edge cases
        d.setDate(d.getDate() + delta);
        gotoDate(localDateStr(d));
    }

    function gotoDate(dateStr) {
        currentDate = dateStr;
        document.getElementById('datePicker').value = dateStr;
        updateDateLabel();
        renderDay();
    }

    function updateDateLabel() {
        const d = new Date(currentDate + 'T00:00:00');
        document.getElementById('currentDateLabel').textContent = d.toLocaleDateString('de-DE', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
        document.getElementById('currentDayOfWeek').textContent = d.toLocaleDateString('en-US', { weekday: 'long' });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const [y, mo, d] = dateStr.split('-');
        return `${d}.${mo}.${y}`;
    }

    /**
     * Returns ISO date strings for the Mon–Sun week containing the given date.
     */
    function weekDays(dateStr) {
        const d = new Date(dateStr + 'T12:00:00'); // noon avoids DST edge cases
        // day of week: 0=Sun, 1=Mon, …
        const dow = d.getDay();
        // shift so Mon=0
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((dow + 6) % 7));

        return Array.from({ length: 7 }, (_, i) => {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            return localDateStr(day);
        });
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showLoading() {
        document.getElementById('plannerLoading').classList.remove('hidden');
        document.getElementById('plannerContent').classList.add('hidden');
        document.getElementById('plannerEmpty').classList.add('hidden');
        document.getElementById('plannerError').classList.add('hidden');
    }

    function showError(msg) {
        document.getElementById('plannerLoading').classList.add('hidden');
        document.getElementById('plannerContent').classList.add('hidden');
        document.getElementById('plannerEmpty').classList.add('hidden');
        const errEl = document.getElementById('plannerError');
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    }

})();
