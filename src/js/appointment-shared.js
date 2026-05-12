/**
 * appointment-shared.js
 * Reusable appointment (Termin) helpers for any module that supports scheduling.
 * 
 * Usage: Include this script before the module's own JS.
 * Each module specifies its own terminColumnLabel (e.g. 'apl-termin', 'einblasen-termin').
 */

window.AppointmentHelper = {

    parseTermin(val) {
        if (!val) return null;
        try { return JSON.parse(val); } catch { return null; }
    },

    formatTermin(termin) {
        if (!termin || !termin.date) return '';
        const parts = termin.date.split('-');
        const dateStr = `${parts[2]}.${parts[1]}.${parts[0]}`;
        return termin.time ? `${dateStr}, ${termin.time}` : dateStr;
    },

    isTerminPassed(termin) {
        if (!termin || !termin.date) return false;
        const dtStr = termin.time ? `${termin.date}T${termin.time}` : `${termin.date}T23:59`;
        return new Date(dtStr) < new Date();
    },

    /**
     * Check if the termin DATE (ignoring time) is strictly before today.
     * Today's appointments are NOT considered past — they stay green.
     */
    isTerminDatePast(termin) {
        if (!termin || !termin.date) return false;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return termin.date < todayStr;
    },

    /**
     * Render the appointment badge HTML for an address row.
     * @deprecated Use terminBadgeHTMLForCard(termin, isDone) for status-aware rendering.
     */
    terminBadgeHTML(termin) {
        if (!termin) return '';
        const passed = this.isTerminPassed(termin);
        return `
            <div class="flex items-center gap-1.5 mt-1">
                <div class="w-2 h-2 rounded-full ${passed ? 'bg-red-500' : 'bg-green-500'}"></div>
                <span class="text-xs ${passed ? 'text-red-500' : 'text-green-600'}">${this.formatTermin(termin)}</span>
            </div>`;
    },

    /**
     * Status-aware appointment badge for address list cards.
     * - Done: always hide (completion date is shown separately).
     * - Pending + no termin: hide.
     * - Pending + termin date in PAST: red 🔴 with date (overdue/missed).
     * - Pending + termin date TODAY or FUTURE: green 🟢 with date (upcoming).
     */
    terminBadgeHTMLForCard(termin, isDone) {
        if (isDone || !termin) return '';
        const datePast = this.isTerminDatePast(termin);
        return `
            <div class="flex items-center gap-1 mt-1">
                <span class="text-sm font-semibold ${datePast ? 'text-red-600' : 'text-green-600'}">${this.formatTermin(termin)}</span>
            </div>`;
    },

    /**
     * Render the appointment info card (for choice/detail screen).
     * When isDone=true and a termin exists, shows a subtle "Appointment completed" line.
     */
    terminInfoHTML(termin, isDone) {
        if (!termin) return '';
        if (isDone) {
            // Subtle history note — muted, non-prominent
            return `
            <div class="mt-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-400">
                📅 Appointment completed: ${this.formatTermin(termin)}
            </div>`;
        }
        const passed = this.isTerminPassed(termin);
        const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return `
            <div class="glass-card mt-4">
                <div class="flex items-center gap-2 mb-1">
                    <div class="w-2.5 h-2.5 rounded-full ${passed ? 'bg-red-500' : 'bg-green-500'}"></div>
                    <span class="text-sm font-semibold ${passed ? 'text-red-600' : 'text-green-600'}">
                        ${passed ? 'Overdue' : 'Upcoming'} Appointment
                    </span>
                </div>
                <p class="text-base font-bold text-gray-900">${this.formatTermin(termin)}</p>
                ${termin.notes ? `<p class="text-sm text-gray-500 mt-1">${esc(termin.notes)}</p>` : ''}
            </div>`;
    },

    /**
     * Render the choice screen buttons based on status & existing termin.
     * Returns HTML for the two-column grid.
     */
    choiceButtonsHTML(isDone, termin) {
        const t = (typeof I18N !== 'undefined') ? (k) => I18N.t(k) : (k) => k;
        const appointBtn = isDone
            ? `<button class="choice-card opacity-50 cursor-not-allowed" disabled>
                <div class="choice-icon">📅</div>
                <div class="choice-label">${t('mod.appointment')}</div>
                <div class="choice-desc">${t('mod.workDone')}</div>
               </button>`
            : termin
                ? `<button id="btnEditAppointment" class="choice-card">
                    <div class="choice-icon">✏️</div>
                    <div class="choice-label">${t('mod.editAppointment')}</div>
                    <div class="choice-desc">${t('mod.scheduleDesc')}</div>
                   </button>`
                : `<button id="btnAppointment" class="choice-card">
                    <div class="choice-icon">📅</div>
                    <div class="choice-label">${t('mod.markAppointment')}</div>
                    <div class="choice-desc">${t('mod.scheduleDesc')}</div>
                   </button>`;

        const uploadBtn = `<button id="btnUpload" class="choice-card">
            <div class="choice-icon">📷</div>
            <div class="choice-label">${t('mod.uploadWork')}</div>
            <div class="choice-desc">${t('mod.uploadDesc')}</div>
        </button>`;

        return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">${appointBtn}${uploadBtn}</div>`;
    },

    /**
     * Render the appointment form.
     * @param {Object} opts - { el, existingTermin, knotenpunkt, addrDisplay, nav, projectName, userEmail, address, terminColId, moduleKey, onDone }
     */
    renderAppointmentForm(opts) {
        const { el, existingTermin, knotenpunkt, addrDisplay, nav, projectName, userEmail, address, terminColId, moduleKey, onDone } = opts;
        const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const defaultDate = existingTermin?.date || tomorrow.toISOString().split('T')[0];
        const defaultTime = existingTermin?.time || '09:00';
        const defaultNotes = existingTermin?.notes || '';

        el.innerHTML = `
            <div class="apl-form-wrap">
                <div class="glass-card">
                    <h3 class="text-base font-bold text-gray-900 mb-1">📅 ${existingTermin ? 'Edit' : 'Mark'} Appointment</h3>
                    <p class="text-sm text-gray-500">${esc(knotenpunkt)} / ${esc(addrDisplay)}</p>
                </div>
                <div class="glass-card">
                    <label class="form-lbl" for="terminDate">Date <span class="text-red-400">*</span></label>
                    <input type="date" id="terminDate" class="form-inp" value="${esc(defaultDate)}" required>
                </div>
                <div class="glass-card">
                    <label class="form-lbl" for="terminTime">Time <span class="text-red-400">*</span></label>
                    <input type="time" id="terminTime" class="form-inp" value="${esc(defaultTime)}" required>
                </div>
                <div class="glass-card">
                    <label class="form-lbl" for="terminNotes">Notes <span class="text-gray-400 font-normal">(optional)</span></label>
                    <textarea id="terminNotes" class="form-inp" rows="3" placeholder="Any additional notes...">${esc(defaultNotes)}</textarea>
                </div>
                <div class="flex gap-3">
                    <button id="terminBackBtn" class="btn-secondary flex-1">Back</button>
                    <button id="terminSaveBtn" class="apl-upload-btn flex-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        Save Appointment
                    </button>
                </div>
                ${existingTermin ? '<button id="terminRemoveBtn" class="btn-remove-termin mt-2">Remove Appointment</button>' : ''}
                <div id="aplUploadStatus" class="hidden upload-status-msg"></div>
            </div>`;

        const showStatus = (type, msg) => {
            const s = document.getElementById('aplUploadStatus');
            if (!s) return;
            s.classList.remove('hidden', 'upload-ok', 'upload-err');
            s.classList.add(type === 'success' ? 'upload-ok' : 'upload-err');
            s.textContent = msg;
        };

        document.getElementById('terminBackBtn').addEventListener('click', onDone);

        document.getElementById('terminSaveBtn').addEventListener('click', async () => {
            const date = document.getElementById('terminDate').value;
            const time = document.getElementById('terminTime').value;
            const notes = document.getElementById('terminNotes').value.trim();
            if (!date || !time) { showStatus('error', 'Please select both date and time'); return; }
            if (!terminColId) { showStatus('error', 'Termin column not found. Please add it to the Aufmass schema.'); return; }

            // ── Conflict check ─────────────────────────────────────────────────
            const { hasConflict, conflicts } = await AppointmentHelper.checkConflicts(projectName, moduleKey, date, time, address.id);
            if (hasConflict) {
                const force = await AppointmentHelper._showConflictModal(conflicts);
                if (!force) return; // User cancelled — stay on form
            }

            const terminData = JSON.stringify({ date, time, notes });
            const btn = document.getElementById('terminSaveBtn');
            btn.disabled = true; btn.textContent = 'Saving...';

            try {
                const res = await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates: { [terminColId]: terminData }, module: moduleKey })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.message);
                if (address.data) address.data[terminColId] = terminData;
                showStatus('success', '✓ Appointment saved');
                setTimeout(() => nav._selectKnoten(nav.currentKnoten), 1200);
            } catch (e) {
                showStatus('error', '✗ ' + e.message);
                btn.disabled = false; btn.textContent = 'Save Appointment';
            }
        });

        const removeBtn = document.getElementById('terminRemoveBtn');
        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                if (!terminColId) return;
                removeBtn.disabled = true; removeBtn.textContent = 'Removing...';
                try {
                    const res = await fetch('/api/modules/aufmass-update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                        body: JSON.stringify({ project: projectName, rowId: address.id, updates: { [terminColId]: '' }, module: moduleKey })
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.message);
                    if (address.data) address.data[terminColId] = '';
                    showStatus('success', '✓ Appointment removed');
                    setTimeout(() => nav._selectKnoten(nav.currentKnoten), 1200);
                } catch (e) {
                    showStatus('error', '✗ ' + e.message);
                    removeBtn.disabled = false; removeBtn.textContent = 'Remove Appointment';
                }
            });
        }
    },

    /**
     * Check for scheduling conflicts within ±40 minutes for the same module on the same date.
     * @param {string} projectName
     * @param {string} module - module key (e.g. "einblasen", "apl")
     * @param {string} date   - "YYYY-MM-DD"
     * @param {string} time   - "HH:MM"
     * @param {string} excludeRowId - row ID to exclude (the one being edited)
     * @returns {Promise<{ hasConflict: boolean, conflicts: Array }>}
     */
    async checkConflicts(projectName, module, date, time, excludeRowId) {
        try {
            const userEmail = localStorage.getItem('userEmail') || '';
            const userRole  = localStorage.getItem('userRole') || '';
            const res = await fetch(`/api/modules/appointments?project=${encodeURIComponent(projectName)}`, {
                headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
            });
            const data = await res.json();
            if (!data.success) return { hasConflict: false, conflicts: [] };

            const proposed = this._toMinutes(time);
            const conflicts = (data.appointments || []).filter(appt => {
                if (appt.rowId === excludeRowId) return false;
                if (appt.module !== module) return false;
                if (appt.date !== date) return false;
                if (!appt.time) return false;
                const diff = Math.abs(this._toMinutes(appt.time) - proposed);
                return diff < 40;
            });

            return { hasConflict: conflicts.length > 0, conflicts };
        } catch (e) {
            console.warn('[AppointmentHelper] checkConflicts failed:', e.message);
            return { hasConflict: false, conflicts: [] };
        }
    },

    /** Convert "HH:MM" to total minutes since midnight */
    _toMinutes(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    },

    /**
     * Show a conflict warning modal and resolve with true (force) or false (cancel).
     * @param {Array} conflicts - array of conflicting appointment objects
     * @returns {Promise<boolean>} true = force schedule, false = cancel
     */
    _showConflictModal(conflicts) {
        return new Promise(resolve => {
            // Build conflict list HTML
            const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const listItems = conflicts.map(c => {
                const addr = _esc(c.addressStart || c.addressEnd || '(unknown address)');
                const knoten = _esc(c.knotenpunkt || '');
                const cluster = _esc(c.cluster || '');
                const ctx = [knoten, cluster].filter(Boolean).join(', ');
                return `<li class="text-sm text-gray-700 py-1 border-b border-gray-100 last:border-0">
                    <span class="font-semibold">${_esc(c.time) || '?'}</span> — ${addr}${ctx ? ` <span class="text-gray-400">(${ctx})</span>` : ''}
                </li>`;
            }).join('');

            const html = `
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-2xl">⚠️</span>
                    <h3 class="text-base font-bold text-red-600">Scheduling Conflict</h3>
                </div>
                <p class="text-sm text-red-500 font-semibold mb-3">
                    ⚠ This appointment conflicts with ${conflicts.length} other appointment${conflicts.length > 1 ? 's' : ''} within the 40-minute buffer zone
                </p>
                <ul class="bg-red-50 rounded-lg px-3 py-2 mb-5 border border-red-100">
                    ${listItems}
                </ul>
                <div class="flex justify-end gap-2">
                    <button id="conflictCancel" class="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300">Cancel</button>
                    <button id="conflictForce" class="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300">Force Schedule ⚠</button>
                </div>`;

            // Use the existing modal system
            const overlay = document.getElementById('modal-overlay');
            const box = document.getElementById('modal-box');
            if (!overlay || !box) {
                // Fallback: no modal.js loaded — just allow force
                resolve(confirm(`Scheduling conflict detected! ${conflicts.length} appointment(s) within 40 min. Force anyway?`));
                return;
            }

            box.innerHTML = html;
            overlay.style.display = 'flex';
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                box.style.transform = 'scale(1)';
                box.style.opacity = '1';
            });

            const hide = () => {
                box.style.transform = 'scale(0.95)';
                box.style.opacity = '0';
                overlay.style.opacity = '0';
                setTimeout(() => { overlay.style.display = 'none'; }, 200);
            };

            box.querySelector('#conflictCancel').addEventListener('click', () => { hide(); resolve(false); });
            box.querySelector('#conflictForce').addEventListener('click', () => { hide(); resolve(true); });
        });
    },

    /**
     * Sort addresses by appointment (upcoming first, then overdue, then no appointment).
     */
    sortByTermin(addresses, terminColId) {
        return [...addresses].sort((a, b) => {
            const tA = terminColId ? this.parseTermin(a.data?.[terminColId]) : null;
            const tB = terminColId ? this.parseTermin(b.data?.[terminColId]) : null;
            if (tA && !tB) return -1;
            if (!tA && tB) return 1;
            if (tA && tB) {
                const dtA = new Date(tA.time ? `${tA.date}T${tA.time}` : tA.date);
                const dtB = new Date(tB.time ? `${tB.date}T${tB.time}` : tB.date);
                return dtA - dtB;
            }
            return 0;
        });
    },

    /**
     * Sort an already-built addrData array (items with { addr, status, ... }) by priority:
     *   Group 0 — Upcoming appointments (pending, date >= today) → ASC by date (nearest first)
     *   Group 1 — Overdue appointments (pending, date < today)  → DESC by date (most recent first)
     *   Group 2 — Waiting (einblasen done, no APL yet, no termin) — item.isWaiting === true
     *   Group 3 — No appointment (pending, no termin, not waiting)
     *   Group 4 — Done
     *
     * @param {Array} addrDataItems  Array of { addr, status, isWaiting?, ... } objects
     * @param {string|null} terminColId  Column id for the termin JSON field
     * @returns {Array} New sorted array
     */
    sortAddressDataByPriority(addrDataItems, terminColId) {
        const self = this;

        function getTermin(item) {
            return terminColId ? self.parseTermin(item.addr.data?.[terminColId]) : null;
        }

        function getGroup(item) {
            const isDone = item.status.toLowerCase() === 'done';
            if (isDone) return 4;
            const termin = getTermin(item);
            if (!termin) {
                // Waiting (Einblasen complete) sorts above regular Pending
                return item.isWaiting ? 2 : 3;
            }
            return self.isTerminDatePast(termin) ? 1 : 0;
        }

        function getDateTime(item) {
            const termin = getTermin(item);
            if (!termin) return null;
            return new Date(termin.time ? `${termin.date}T${termin.time}` : `${termin.date}T00:00`);
        }

        return [...addrDataItems].sort((a, b) => {
            const gA = getGroup(a);
            const gB = getGroup(b);
            if (gA !== gB) return gA - gB;
            // Same group — sort by date
            const dtA = getDateTime(a);
            const dtB = getDateTime(b);
            if (!dtA && !dtB) return 0;
            if (!dtA) return 1;
            if (!dtB) return -1;
            if (gA === 0) return dtA - dtB; // upcoming: nearest first (ASC)
            if (gA === 1) return dtB - dtA; // overdue: most recent first (DESC)
            // Groups 2–4 have no termin → stable order
            return 0;
        });
    }
};
