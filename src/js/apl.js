/**
 * apl.js
 * APL module — appointment scheduling + 4-image upload form.
 * Uses AppointmentHelper from appointment-shared.js.
 */

(function () {
    const AH = window.AppointmentHelper;
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole');
    const userEmail   = localStorage.getItem('userEmail') || 'Unknown';

    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }

    const displayEl = document.getElementById('projectNameDisplay');
    if (displayEl) displayEl.textContent = projectName;
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function cleanAddress(address) {
        if (!address) return 'Unknown';
        let clean = address.trim();
        if (clean.includes(',')) clean = clean.split(',').pop().trim();
        return clean.replace(/\s+/g, '-').replace(/,/g, '');
    }

    function formatDateTime() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function isImage(file) { return /^image\/(jpeg|jpg|png)$/i.test(file.type) || /\.(jpe?g|png)$/i.test(file.name); }

    /**
     * Build Eigentümerdaten (customer details) HTML for an address.
     * Splits multiple phones on "o." and multiple emails on ";", "|", " o. "
     * Each phone → clickable tel: link, each email → clickable mailto: link.
     */
    function buildCustomerHTML(address) {
        const nameColId  = nav.findColumnId('eigentümer', 'name');
        const phoneColId = nav.findColumnId('eigentümer', 'phone');
        const emailColId = nav.findColumnId('eigentümer', 'email');
        const rawName  = nameColId  && address.data ? (address.data[nameColId]  || '').trim() : '';
        const rawPhone = phoneColId && address.data ? (address.data[phoneColId] || '').trim() : '';
        const rawEmail = emailColId && address.data ? (address.data[emailColId] || '').trim() : '';
        if (!rawName && !rawPhone && !rawEmail) return '';

        // Split names on " o. ", " und ", "," (multiple Eigentümer/Anwohner)
        const names = rawName ? rawName.split(/\s+o\.\s+|,\s*|\s+und\s+/).map(n => n.trim()).filter(Boolean) : [];
        // Split phones on " o. " (German "oder")
        const phones = rawPhone ? rawPhone.split(/\s+o\.\s+/).map(p => p.trim()).filter(Boolean) : [];
        // Split emails on ";", "|", or " o. "
        const emails = rawEmail ? rawEmail.split(/[;|]|\s+o\.\s+/).map(e => e.trim()).filter(Boolean) : [];

        const namesHTML = names.map(n =>
            `<span class="customer-link customer-owner" title="${esc(n)}">👤 ${esc(n)}</span>`
        ).join('');

        const phonesHTML = phones.map(p => {
            const digits = p.replace(/[^+\d]/g, '');
            return `<a href="tel:${esc(digits)}" class="customer-link customer-phone" title="Call ${esc(p)}">📞 ${esc(p)}</a>`;
        }).join('');

        const emailsHTML = emails.map(e =>
            `<a href="mailto:${esc(e)}" class="customer-link customer-email" title="Email ${esc(e)}">✉️ ${esc(e)}</a>`
        ).join('');

        return `
            <div class="glass-card customer-details-card">
                <h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Eigentümerdaten</h4>
                ${namesHTML ? `<div class="customer-contacts">${namesHTML}</div>` : ''}
                ${phonesHTML ? `<div class="customer-contacts">${phonesHTML}</div>` : ''}
                ${emailsHTML ? `<div class="customer-contacts">${emailsHTML}</div>` : ''}
            </div>`;
    }

    function showStatus(type, msg) {
        const el = document.getElementById('aplUploadStatus');
        if (!el) return;
        el.classList.remove('hidden', 'upload-ok', 'upload-err');
        el.classList.add(type === 'success' ? 'upload-ok' : 'upload-err');
        el.textContent = msg;
    }

    // ─── Shared file-list injection helper ─────────────────────────────────────

    /**
     * Fetch existing files for a path and inject a file-list card into the choice screen.
     * Also updates the btnUpload label to "Re-upload / Edit" so context is clear.
     */
    async function injectFilesSection(containerEl, listPath, docsPath, addrFilter, currentCluster, currentKnoten, currentAddr) {
        const placeholder = document.createElement('div');
        placeholder.id = 'filesViewSection';
        placeholder.className = 'glass-card';
        placeholder.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:13px;">
            <svg class="w-4 h-4 animate-spin" style="width:16px;height:16px;flex-shrink:0;" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg> Loading uploaded files…</div>`;

        const firstCard = containerEl.querySelector('.glass-card');
        if (firstCard && firstCard.parentNode) {
            firstCard.parentNode.insertBefore(placeholder, firstCard.nextSibling);
        }

        const btnUpload = document.getElementById('btnUpload');
        if (btnUpload) {
            const lbl = btnUpload.querySelector('.choice-label');
            const desc = btnUpload.querySelector('.choice-desc');
            if (lbl) lbl.textContent = 'Re-upload / Edit';
            if (desc) desc.textContent = 'Replace existing files';
        }

        try {
            const res = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(listPath)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            let files = data.success ? (data.files || []) : [];

            // Filter files matching this specific address (exact boundary match)
            if (addrFilter) {
                const clean = addrFilter.trim().replace(/\s+/g, '-').replace(/,/g, '');
                files = files.filter(f => {
                    if (!f.name) return false;
                    const idx = f.name.indexOf(clean);
                    if (idx === -1) return false;
                    const afterIdx = idx + clean.length;
                    if (afterIdx >= f.name.length) return true;
                    const next = f.name[afterIdx];
                    return next === '.' || next === '_' || next === '-' || next === ' ';
                });
            }

            const fileRows = files.map(f => {
                const ext = (f.name || '').split('.').pop().toUpperCase();
                const icon = ext === 'PDF' ? 'PDF' : (ext === 'JPG' || ext === 'JPEG' || ext === 'PNG') ? '🖼' : '📄';
                const fpath = docsPath + '/' + f.name;
                const size = f.size ? (f.size < 1024 ? f.size + ' B' : f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB') : '';
                return `<div class="file-row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:6px">
                    <div style="width:36px;height:36px;background:#eef2ff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#6366f1;flex-shrink:0">${icon}</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:13px;font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>
                        ${size ? `<div style="font-size:11px;color:#9ca3af">${size}</div>` : ''}
                    </div>
                    <button type="button" onclick="ModuleNavigator._downloadFile('/api/files/download?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(docsPath)}&file=${encodeURIComponent(f.name)}', '${esc(f.name).replace(/'/g, "\\'")}')" style="color:#6366f1;flex-shrink:0;background:none;border:none;cursor:pointer;font-size:16px;padding:4px" title="Download">⬇</button>
                    <button class="file-del-btn" data-path="${esc(fpath)}" style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:16px;flex-shrink:0;padding:4px" title="Delete">🗑</button>
                </div>`;
            }).join('');

            placeholder.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-sm font-bold text-gray-800">Uploaded Files <span class="text-gray-400 font-normal">(${files.length})</span></h4>
                </div>
                ${files.length ? fileRows : '<p class="text-xs text-gray-400">No files for this address.</p>'}`;

            // Delete handlers (moves to recycle bin)
            placeholder.querySelectorAll('.file-del-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!await showConfirm('Delete File', 'Move this file to the recycle bin?')) return;
                    const fpath = btn.dataset.path;
                    const dir = fpath.substring(0, fpath.lastIndexOf('/'));
                    const fname = fpath.substring(fpath.lastIndexOf('/') + 1);
                    try {
                        const r = await fetch(`/api/files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(dir)}&file=${encodeURIComponent(fname)}`, {
                            method: 'DELETE',
                            headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
                        });
                        const d = await r.json();
                        if (!d.success) { await showAlert(d.message || 'Delete failed'); return; }
                        btn.closest('.file-row').remove();
                        const countEl = placeholder.querySelector('span.text-gray-400');
                        const remaining = placeholder.querySelectorAll('.file-row').length;
                        if (countEl) countEl.textContent = `(${remaining})`;
                        // Auto-reset to Pending when last file deleted
                        if (remaining === 0 && currentAddr) {
                            const sc = nav.findColumnId('splicing', 'apl status');
                            if (sc) {
                                const clearUpdates = { [sc]: '' };
                                const erc = nav.findColumnId('notes', 'error-reporting');
                                if (erc && currentAddr.data?.[erc]) {
                                    const parts = (currentAddr.data[erc]).split(';').filter(Boolean);
                                    const stripped = parts.filter(p => !p.startsWith('APL:'));
                                    clearUpdates[erc] = stripped.length ? stripped.join(';') + ';' : '';
                                }
                                await fetch('/api/modules/aufmass-update', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                                    body: JSON.stringify({ project: projectName, rowId: currentAddr.id, updates: clearUpdates, module: 'apl', note: 'Status reset to Pending — all files deleted' })
                                });
                                if (currentAddr.data) Object.assign(currentAddr.data, clearUpdates);
                                renderChoiceScreen(currentCluster, currentKnoten, currentAddr);
                            }
                        }
                    } catch (e) { await showAlert('Delete failed: ' + e.message); }
                });
            });
        } catch (e) {
            placeholder.innerHTML = `<p class="text-xs text-gray-400">Could not load file list.</p>`;
        }
    }

    // ─── Choice Screen ─────────────────────────────────────────────────────────

    function renderChoiceScreen(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const addrDisplay = address.end || address.start || address.id;
        const terminColId = nav.findColumnId('splicing', 'apl-termin');
        const termin = terminColId && address.data ? AH.parseTermin(address.data[terminColId]) : null;
        const statusColId = nav.findColumnId('splicing', 'apl status');
        const currentStatus = statusColId && address.data ? (address.data[statusColId] || '') : '';
        const isDone = currentStatus.toLowerCase() === 'done';
        const isError = currentStatus.toLowerCase() === 'error';
        const einblasenDateColId = nav.findColumnId('einblasen', 'einblasen-date');
        const einblasenDate = einblasenDateColId && address.data ? (address.data[einblasenDateColId] || '').trim() : '';
        const isWaiting = !isDone && !isError && !!einblasenDate;
        const statusBadge = isDone ? '<span class="mod-badge mod-badge-done">Done</span>'
            : isError ? '<span class="mod-badge mod-badge-error">⚠ Error</span>'
            : isWaiting ? '<span class="mod-badge mod-badge-waiting">⏳ Waiting</span>'
            : '<span class="mod-badge mod-badge-pending">Pending</span>';

        // Date/time for done work display
        const dateColId = nav.findColumnId('timing', 'date');
        const timeColId = nav.findColumnId('timing', 'time');
        const savedDate = dateColId && address.data ? (address.data[dateColId] || '').trim() : '';
        const savedTime = timeColId && address.data ? (address.data[timeColId] || '').trim() : '';
        const dateTimeHTML = (isDone && (savedDate || savedTime)) ? `
            <div class="glass-card done-datetime-card">
                <div class="done-datetime">
                    📅 ${savedDate ? `<span class="font-semibold">${esc(savedDate)}</span>` : ''}
                    ${savedTime ? `<span class="text-gray-400 mx-1">·</span> 🕐 <span class="font-semibold">${esc(savedTime)}</span>` : ''}
                </div>
            </div>` : '';

        el.innerHTML = `
            <div class="apl-form-wrap">
                <div class="glass-card">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">${esc(knotenpunkt)} / ${esc(addrDisplay)}</h3>
                            <p class="text-xs text-gray-400 mt-1">
                                ${address.cableName ? `Cable: <span class="font-semibold text-gray-600">${esc(address.cableName)}</span>` : ''}
                                ${address.fiberType ? ` · Fibers: <span class="font-semibold text-gray-600">${esc(address.fiberType)}</span>` : ''}
                            </p>
                        </div>
                        <div>${statusBadge}</div>
                    </div>
                    ${isError ? (() => {
                        const erc = nav.findColumnId('notes', 'error-reporting');
                        const errLog = erc && address.data ? (address.data[erc] || '') : '';
                        const aplErrors = errLog.split(';').filter(p => p.startsWith('APL:'));
                        const activeErrors = aplErrors.filter(p => !p.endsWith('#')).map(p => p.replace(/^APL:/, ''));
                        const fixedErrors = aplErrors.filter(p => p.endsWith('#')).map(p => p.replace(/^APL:/, '').replace(/#$/, ''));
                        let html = '<div class="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">';
                        html += '<div class="font-semibold mb-1">⚠ Active Errors:</div>';
                        if (activeErrors.length) html += activeErrors.map(e => `<div>• ${esc(e)}</div>`).join('');
                        else html += '<div>No active errors found</div>';
                        if (fixedErrors.length) html += '<div class="mt-1 text-green-700 font-semibold">✓ Fixed:</div>' + fixedErrors.map(e => `<div class="text-green-600">• ${esc(e)}</div>`).join('');
                        html += '</div>';
                        return html;
                    })() : ''}
                </div>
                ${buildCustomerHTML(address)}
                ${dateTimeHTML}
                ${AH.terminInfoHTML(termin, isDone)}
                ${AH.choiceButtonsHTML(isDone, termin)}
                <div class="flex gap-2 mt-2">
                    <button id="btnReportError" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">⚠ Report Error</button>
                    ${isError ? '<button id="btnClearError" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">✓ Clear Error</button>' : ''}
                </div>
            </div>`;

        const appointBtn = document.getElementById('btnAppointment') || document.getElementById('btnEditAppointment');
        if (appointBtn) {
            appointBtn.addEventListener('click', () => {
                AH.renderAppointmentForm({
                    el, existingTermin: termin, knotenpunkt, addrDisplay,
                    nav, projectName, userEmail, address, terminColId, moduleKey: 'apl',
                    onDone: () => renderChoiceScreen(cluster, knotenpunkt, address)
                });
            });
        }

        if (isDone || isError) {
            const addrClean = cleanAddress(address.end);
            const targetPath = `${cluster}/APL/${knotenpunkt}/${addrClean}`;
            const docsPath = `Doku/${targetPath}`;
            injectFilesSection(el, targetPath, docsPath, addrDisplay, cluster, knotenpunkt, address);
        }

        document.getElementById('btnUpload')?.addEventListener('click', () => renderAPLForm(cluster, knotenpunkt, address));

        // Report Error — prompt for description, append to Error-Reporting column
        document.getElementById('btnReportError')?.addEventListener('click', async () => {
            const errorText = await showPrompt('⚠ Report Error', 'Describe the error (e.g. splicing defect, cable issue):');
            if (!errorText || !errorText.trim()) return;
            const sc = nav.findColumnId('splicing', 'apl status');
            const erc = nav.findColumnId('notes', 'error-reporting');
            if (!sc) return;
            try {
                const updates = { [sc]: 'Error' };
                if (erc) {
                    const existing = (address.data?.[erc] || '').trim();
                    const entry = `APL:${errorText.trim()}`;
                    const base = existing ? (existing.endsWith(';') ? existing : existing + ';') : '';
                    updates[erc] = base + entry + ';';
                }
                await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates, module: 'apl', note: `APL Error: ${errorText.trim()}` })
                });
                if (address.data) Object.assign(address.data, updates);
                renderChoiceScreen(cluster, knotenpunkt, address);
            } catch (e) { await showAlert('Failed: ' + e.message); }
        });

        // Clear Error — show selection modal so user can pick WHICH specific APL error to mark fixed
        document.getElementById('btnClearError')?.addEventListener('click', async () => {
            const sc = nav.findColumnId('splicing', 'apl status');
            const erc = nav.findColumnId('notes', 'error-reporting');
            if (!sc) return;
            const log = (address.data?.[erc] || '');
            const parts = log.split(';').filter(Boolean);
            // Build entry list for APL errors only
            const entries = parts.reduce((acc, p, i) => {
                if (p.startsWith('APL:')) {
                    const fixed = p.endsWith('#');
                    const description = p.replace(/^APL:/, '').replace(/#$/, '');
                    acc.push({ description, fixed, partIndex: i });
                }
                return acc;
            }, []);
            if (!entries.length) return;
            // Show modal — user selects which action to perform
            const result = await showErrorSelectModal('APL — Resolve Error', entries);
            if (!result) return;
            try {
                const updates = {};
                let note = '';
                const currentSt = (address.data?.[sc] || '');
                if (erc) {
                    switch (result.action) {
                        case 'fix':
                            if (!parts[result.partIndex].endsWith('#')) {
                                parts[result.partIndex] = parts[result.partIndex] + '#';
                            }
                            note = `APL Error fixed: ${parts[result.partIndex].replace(/^APL:|#$/g, '')}`;
                            break;
                        case 'reopen':
                            parts[result.partIndex] = parts[result.partIndex].replace(/#$/, '');
                            note = `APL Error reopened: ${parts[result.partIndex].replace(/^APL:/, '')}`;
                            break;
                        case 'edit': {
                            const prefixMatch = parts[result.partIndex].match(/^(APL:)/);
                            const prefix = prefixMatch ? prefixMatch[1] : 'APL:';
                            const wasFixed = parts[result.partIndex].endsWith('#');
                            parts[result.partIndex] = prefix + result.newText + (wasFixed ? '#' : '');
                            note = `APL Error edited: ${result.newText}`;
                            break;
                        }
                        case 'delete':
                            note = `APL Error deleted: ${parts[result.partIndex].replace(/^APL:|#$/g, '')}`;
                            parts.splice(result.partIndex, 1);
                            break;
                    }
                    updates[erc] = parts.length ? parts.join(';') + ';' : '';
                    // Keep status Error if any unfixed APL errors remain; otherwise clear it
                    const hasUnfixed = parts.some(p => p.startsWith('APL:') && !p.endsWith('#'));
                    updates[sc] = hasUnfixed ? 'Error' : (currentSt.toLowerCase() === 'error' ? '' : currentSt);
                } else {
                    updates[sc] = '';
                    note = `APL Error action: ${result.action}`;
                }
                await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates, module: 'apl', note })
                });
                if (address.data) Object.assign(address.data, updates);
                renderChoiceScreen(cluster, knotenpunkt, address);
            } catch (e) { await showAlert('Failed: ' + e.message); }
        });
    }

    // ─── APL Upload Form ───────────────────────────────────────────────────────

    const IMAGE_TYPES = [
        { id: 'Metrierung', label: 'Metrierung Image', icon: '📏' },
        { id: 'APL_Box',    label: 'APL Box Image',    icon: '📦' },
        { id: 'Splices',    label: 'Splices Image',    icon: '🔗' },
        { id: 'Inside_APL', label: 'Inside APL Image', icon: '🔍' },
    ];

    let requiredFiles = [null, null, null, null];
    // Parallel array tracking how each required file was sourced.
    // 'camera' = taken with GeoCam (no _U suffix), 'upload' = file picker/drag-drop (adds _U suffix)
    let fileSources = ['camera', 'camera', 'camera', 'camera'];
    let extraFiles = [];

    function renderAPLForm(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;
        requiredFiles = [null, null, null, null];
        fileSources = ['camera', 'camera', 'camera', 'camera'];
        extraFiles = [];

        const addrClean = cleanAddress(address.end);
        const addrDisplay = address.end || address.id;

        // Auto-fetch splice count from aufmass
        const spliceColId = nav.findColumnId('splicing', 'number of splices');
        const existingSplices = spliceColId && address.data ? (address.data[spliceColId] || '').trim() : '';

        // Current date/time defaults
        const now = new Date();
        const defaultDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const defaultTime = now.toTimeString().slice(0, 5);  // HH:MM

        const zonesHtml = IMAGE_TYPES.map((t, i) => `
            <div class="apl-zone" id="zone-${i}" data-index="${i}">
                <div class="zone-required-dot" title="Required"></div>
                <div class="zone-clear" id="zoneClear-${i}" title="Remove">✕</div>
                <div class="zone-icon">${t.icon}</div>
                <div class="zone-label" id="zoneLabel-${i}">${t.label}</div>
                <img class="zone-preview" id="zonePreview-${i}" alt="preview">
                <div class="zone-actions" id="zoneActions-${i}">
                    <button type="button" class="zone-btn zone-btn-camera" id="zoneCameraBtn-${i}" title="Take Photo with GPS stamp">📷 Take Photo</button>
                    <button type="button" class="zone-btn zone-btn-upload" id="zoneUploadBtn-${i}" title="Upload from device">📁 Upload</button>
                </div>
                <input type="file" id="zoneInput-${i}" accept="image/jpeg,image/jpg,image/png" class="hidden">
            </div>`).join('');

        el.innerHTML = `
            <div class="apl-form-wrap">
                <div class="glass-card">
                    <div class="flex items-start justify-between gap-3 mb-1">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">APL Upload — ${esc(knotenpunkt)} / ${esc(addrDisplay)}</h3>
                            <p class="text-xs text-gray-400 mt-1">
                                ${address.cableName ? `Cable: <span class="font-semibold text-gray-600">${esc(address.cableName)}</span>` : ''}
                                ${address.fiberType ? ` · Fibers: <span class="font-semibold text-gray-600">${esc(address.fiberType)}</span>` : ''}
                            </p>
                        </div>
                        <div id="aplStatusBadge"></div>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">Target: <code class="font-mono text-gray-500">${esc(cluster)}/APL/${esc(knotenpunkt)}/${esc(addrClean)}/</code></p>
                </div>
                <div class="glass-card">
                    <div class="form-row-2col">
                        <div>
                            <label class="form-lbl" for="aplDate">Date</label>
                            <input type="date" id="aplDate" class="form-inp" value="${defaultDate}">
                        </div>
                        <div>
                            <label class="form-lbl" for="aplTime">Time</label>
                            <input type="time" id="aplTime" class="form-inp" value="${defaultTime}">
                        </div>
                    </div>
                </div>
                <div class="glass-card" id="spliceCard">
                    <label class="form-lbl">Number of Splices <span class="text-red-400">*</span></label>
                    ${existingSplices ? `
                        <div id="spliceDisplay">
                            <div class="splice-value">${esc(existingSplices)} <span class="splice-source">from Aufmass</span></div>
                            <div class="splice-actions">
                                <button type="button" id="spliceConfirmBtn" class="splice-btn splice-btn-confirm">✓ Confirm</button>
                                <button type="button" id="spliceUpdateBtn" class="splice-btn splice-btn-update">✎ Update</button>
                            </div>
                        </div>
                        <div id="spliceEditSection" class="hidden">
                            <div class="splice-warning">⚠️ Changing splice count will be logged. Only update if the actual count differs from the plan.</div>
                            <div style="display:flex;gap:8px;align-items:flex-end;margin-top:8px;">
                                <div style="flex:1;">
                                    <input type="number" id="spliceCount" class="form-inp" placeholder="New count" min="1" max="9999">
                                </div>
                                <button type="button" id="spliceEditConfirmBtn" class="splice-btn splice-btn-confirm">Save</button>
                                <button type="button" id="spliceEditCancelBtn" class="splice-btn splice-btn-cancel">Cancel</button>
                            </div>
                        </div>
                        <input type="hidden" id="spliceCountFinal" value="">
                        <input type="hidden" id="spliceWasUpdated" value="false">
                        <input type="hidden" id="spliceOriginal" value="${esc(existingSplices)}">
                    ` : `
                        <p class="text-xs text-amber-600 mb-2">⚠️ No splice count in Aufmass — enter manually</p>
                        <input type="number" id="spliceCount" class="form-inp" placeholder="e.g. 72" min="1" max="9999" required>
                        <input type="hidden" id="spliceCountFinal" value="">
                        <input type="hidden" id="spliceWasUpdated" value="false">
                        <input type="hidden" id="spliceOriginal" value="">
                    `}
                </div>
                <div class="glass-card">
                    <h4 class="text-sm font-bold text-gray-700 mb-3">Required Images <span class="text-red-400">*</span></h4>
                    <div class="upload-zones-grid">${zonesHtml}</div>
                </div>
                <div class="glass-card">
                    <h4 class="text-sm font-bold text-gray-700 mb-2">Additional Images <span class="text-gray-400 font-normal">(optional)</span></h4>
                    <div id="extraFileList" class="extra-file-list"></div>
                    <button type="button" class="add-extra-btn" id="addExtraBtn">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        <span>+ Add more images</span>
                    </button>
                    <input type="file" id="extraFileInput" accept="image/jpeg,image/jpg,image/png" multiple class="hidden">
                </div>
                <div class="flex gap-3">
                    <button id="aplBackBtn" class="btn-secondary flex-1">Back</button>
                    <button id="aplUploadBtn" class="apl-upload-btn flex-1" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                        Upload All
                    </button>
                </div>
                <div id="aplUploadStatus" class="hidden upload-status-msg"></div>
            </div>`;

        document.getElementById('aplBackBtn').addEventListener('click', () => renderChoiceScreen(cluster, knotenpunkt, address));

        const statusColId = nav.findColumnId('splicing', 'apl status');
        const currentStatus = statusColId && address.data ? (address.data[statusColId] || '') : '';
        const badge = document.getElementById('aplStatusBadge');
        if (badge) {
            const s = currentStatus.toLowerCase();
            const einblasenDateColIdForm = nav.findColumnId('einblasen', 'einblasen-date');
            const einblasenDateForm = einblasenDateColIdForm && address.data ? (address.data[einblasenDateColIdForm] || '').trim() : '';
            const isWaitingForm = s !== 'done' && s !== 'error' && !!einblasenDateForm;
            badge.innerHTML = s === 'done' ? '<span class="mod-badge mod-badge-done">Done</span>'
                : s === 'error' ? '<span class="mod-badge mod-badge-error">⚠ Error</span>'
                : isWaitingForm ? '<span class="mod-badge mod-badge-waiting">⏳ Waiting</span>'
                : '<span class="mod-badge mod-badge-pending">Pending</span>';
        }

        wireZones();
        document.getElementById('addExtraBtn').addEventListener('click', () => {
            // If GeoCam is not available, fall back to direct file picker
            if (!window.GeoCam) {
                document.getElementById('extraFileInput').click();
                return;
            }
            // Show glassmorphism modal with Take Photo / Upload options
            showExtraImageModal({
                onCamera: async () => {
                    try {
                        const result = await window.GeoCam.capture({ userText: 'Additional Image' });
                        if (result) {
                            const d = result.metadata.timestamp || new Date();
                            const pad = n => String(n).padStart(2, '0');
                            const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                            const file = new File([result.blob], `extra_${ts}.jpg`, { type: 'image/jpeg' });
                            extraFiles.push(file);
                            renderExtraFileList();
                            updateUploadBtn();
                        }
                    } catch (err) {
                        console.error('[APL] GeoCam error (extra):', err);
                    }
                },
                onUpload: () => document.getElementById('extraFileInput').click()
            });
        });
        document.getElementById('extraFileInput').addEventListener('change', (e) => {
            Array.from(e.target.files || []).forEach(f => { if (isImage(f)) extraFiles.push(f); });
            e.target.value = '';
            renderExtraFileList();
            updateUploadBtn();
        });

        // ── Splice Confirm / Update logic ──
        const spliceConfirmBtn = document.getElementById('spliceConfirmBtn');
        const spliceUpdateBtn = document.getElementById('spliceUpdateBtn');
        const spliceEditSection = document.getElementById('spliceEditSection');
        const spliceDisplay = document.getElementById('spliceDisplay');
        const spliceCountFinal = document.getElementById('spliceCountFinal');
        const spliceWasUpdated = document.getElementById('spliceWasUpdated');
        const spliceOriginal = document.getElementById('spliceOriginal');

        if (spliceConfirmBtn) {
            // Has existing splice count — Confirm button
            spliceConfirmBtn.addEventListener('click', () => {
                spliceCountFinal.value = spliceOriginal.value;
                spliceWasUpdated.value = 'false';
                spliceDisplay.innerHTML = `<div class="splice-value splice-confirmed">${esc(spliceOriginal.value)} ✓ <span class="splice-source">Confirmed</span></div>`;
                updateUploadBtn();
            });

            // Update button — show warning + edit field
            spliceUpdateBtn.addEventListener('click', () => {
                spliceDisplay.classList.add('hidden');
                spliceEditSection.classList.remove('hidden');
                document.getElementById('spliceCount')?.focus();
            });

            // Edit confirm
            document.getElementById('spliceEditConfirmBtn')?.addEventListener('click', () => {
                const newVal = document.getElementById('spliceCount')?.value?.trim();
                if (!newVal || parseInt(newVal, 10) <= 0) return;
                spliceCountFinal.value = newVal;
                spliceWasUpdated.value = 'true';
                spliceEditSection.classList.add('hidden');
                spliceDisplay.classList.remove('hidden');
                spliceDisplay.innerHTML = `<div class="splice-value splice-updated">${esc(newVal)} <span class="splice-source">Updated (was ${esc(spliceOriginal.value)})</span></div>`;
                updateUploadBtn();
            });

            // Edit cancel
            document.getElementById('spliceEditCancelBtn')?.addEventListener('click', () => {
                spliceEditSection.classList.add('hidden');
                spliceDisplay.classList.remove('hidden');
                // Reset final value if not yet confirmed
                if (!spliceCountFinal.value) spliceCountFinal.value = '';
                updateUploadBtn();
            });
        } else {
            // No existing splice — manual input, set final on input
            const spliceInput = document.getElementById('spliceCount');
            if (spliceInput) {
                spliceInput.addEventListener('input', () => {
                    spliceCountFinal.value = spliceInput.value.trim();
                    spliceWasUpdated.value = 'true'; // manual entry = always "updated"
                    updateUploadBtn();
                });
            }
        }

        document.getElementById('aplUploadBtn').addEventListener('click', () => handleAPLUpload(cluster, knotenpunkt, address));
    }

    function wireZones() {
        IMAGE_TYPES.forEach((t, i) => {
            const zone      = document.getElementById(`zone-${i}`);
            const input     = document.getElementById(`zoneInput-${i}`);
            const clear     = document.getElementById(`zoneClear-${i}`);
            const cameraBtn = document.getElementById(`zoneCameraBtn-${i}`);
            const uploadBtn = document.getElementById(`zoneUploadBtn-${i}`);

            // 📷 Camera button — GeoCam fullscreen overlay
            cameraBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!window.GeoCam) {
                    console.warn('[APL] GeoCam not loaded — falling back to file picker');
                    input.click();
                    return;
                }
                try {
                    const result = await window.GeoCam.capture({ userText: IMAGE_TYPES[i].label });
                    if (result) {
                        // Build a timestamp string for the synthetic filename
                        const d = result.metadata.timestamp || new Date();
                        const pad = n => String(n).padStart(2, '0');
                        const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                        const file = new File([result.blob], `${IMAGE_TYPES[i].id}_${ts}.jpg`, { type: 'image/jpeg' });
                        setZoneFile(i, file, 'camera');
                    }
                } catch (err) {
                    console.error('[APL] GeoCam error:', err);
                }
            });

            // 📁 Upload button — show Take Photo / Upload popup
            uploadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!window.GeoCam) {
                    // No GeoCam available — fall back to direct file picker
                    input.click();
                    return;
                }
                showExtraImageModal({
                    onCamera: async () => {
                        try {
                            const result = await window.GeoCam.capture({ userText: IMAGE_TYPES[i].label });
                            if (result) {
                                const d = result.metadata.timestamp || new Date();
                                const pad = n => String(n).padStart(2, '0');
                                const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                                const file = new File([result.blob], `${IMAGE_TYPES[i].id}_${ts}.jpg`, { type: 'image/jpeg' });
                                setZoneFile(i, file, 'camera');
                            }
                        } catch (err) {
                            console.error('[APL] GeoCam error (zone upload btn):', err);
                        }
                    },
                    onUpload: () => input.click()
                });
            });

            // File input change handler (upload source)
            input.addEventListener('change', () => {
                if (input.files[0]) setZoneFile(i, input.files[0], 'upload');
            });

            // Drag-and-drop (counts as 'upload' — no geo stamp)
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dz-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('dz-over'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dz-over');
                const f = e.dataTransfer.files[0];
                if (f && isImage(f)) setZoneFile(i, f, 'upload');
            });

            // Clear button
            clear.addEventListener('click', (e) => { e.stopPropagation(); clearZoneFile(i); });
        });
    }

    function setZoneFile(i, file, source) {
        requiredFiles[i] = file;
        fileSources[i] = source || 'upload';
        document.getElementById(`zone-${i}`).classList.add('has-file');
        const srcIcon = fileSources[i] === 'camera' ? '📷 ' : '📁 ';
        const label = file.name.length > 20 ? file.name.slice(0, 17) + '…' : file.name;
        document.getElementById(`zoneLabel-${i}`).textContent = srcIcon + label;
        const reader = new FileReader();
        reader.onload = (e) => { document.getElementById(`zonePreview-${i}`).src = e.target.result; };
        reader.readAsDataURL(file);
        updateUploadBtn();
    }

    function clearZoneFile(i) {
        requiredFiles[i] = null;
        fileSources[i] = 'camera'; // reset default
        document.getElementById(`zone-${i}`).classList.remove('has-file');
        document.getElementById(`zoneLabel-${i}`).textContent = IMAGE_TYPES[i].label;
        document.getElementById(`zonePreview-${i}`).src = '';
        document.getElementById(`zoneInput-${i}`).value = '';
        updateUploadBtn();
    }

    function showExtraImageModal({ onCamera, onUpload }) {
        // Remove any existing modal
        const existing = document.getElementById('extraImageModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'extraImageModal';
        modal.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.45)',
            'backdrop-filter:blur(6px)',
            '-webkit-backdrop-filter:blur(6px)',
            'padding:1rem'
        ].join(';');

        modal.innerHTML = `
            <div style="
                background:rgba(255,255,255,0.18);
                border:1px solid rgba(255,255,255,0.35);
                backdrop-filter:blur(20px);
                -webkit-backdrop-filter:blur(20px);
                border-radius:1.25rem;
                padding:1.5rem 1.25rem;
                max-width:320px;
                width:100%;
                box-shadow:0 8px 32px rgba(0,0,0,0.25);
                text-align:center;
            ">
                <p style="font-size:0.95rem;font-weight:600;color:#1e293b;margin:0 0 1.1rem;">Add Image</p>
                <div style="display:flex;flex-direction:column;gap:0.75rem;">
                    <button id="extraModalCameraBtn" style="
                        display:flex;align-items:center;justify-content:center;gap:0.6rem;
                        background:#3B82F6;color:#fff;border:none;border-radius:0.75rem;
                        padding:0.8rem 1rem;font-size:1rem;font-weight:600;cursor:pointer;
                        min-height:48px;
                    ">📷 Take Photo</button>
                    <button id="extraModalUploadBtn" style="
                        display:flex;align-items:center;justify-content:center;gap:0.6rem;
                        background:rgba(255,255,255,0.55);color:#1e293b;
                        border:1px solid rgba(59,130,246,0.4);border-radius:0.75rem;
                        padding:0.8rem 1rem;font-size:1rem;font-weight:600;cursor:pointer;
                        min-height:48px;
                    ">📁 Upload File</button>
                    <button id="extraModalCancelBtn" style="
                        background:none;border:none;color:#64748b;
                        font-size:0.875rem;cursor:pointer;padding:0.4rem;
                        min-height:36px;
                    ">Cancel</button>
                </div>
            </div>`;

        const close = () => modal.remove();

        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.querySelector('#extraModalCancelBtn').addEventListener('click', close);
        modal.querySelector('#extraModalCameraBtn').addEventListener('click', () => {
            close();
            onCamera();
        });
        modal.querySelector('#extraModalUploadBtn').addEventListener('click', () => {
            close();
            onUpload();
        });

        document.body.appendChild(modal);
    }

    function renderExtraFileList() {
        const el = document.getElementById('extraFileList');
        if (!el) return;
        el.innerHTML = extraFiles.map((f, i) => `
            <div class="extra-file-item"><span>🖼️</span><span class="truncate">${esc(f.name)}</span>
            <span class="remove-extra" data-index="${i}" title="Remove">✕</span></div>`).join('');
        el.querySelectorAll('.remove-extra').forEach(btn => {
            btn.addEventListener('click', () => { extraFiles.splice(parseInt(btn.dataset.index, 10), 1); renderExtraFileList(); updateUploadBtn(); });
        });
    }

    function updateUploadBtn() {
        const btn = document.getElementById('aplUploadBtn');
        if (!btn) return;
        const spliceVal = document.getElementById('spliceCountFinal')?.value?.trim();
        btn.disabled = !(requiredFiles.every(f => f !== null) && spliceVal && parseInt(spliceVal, 10) > 0);
    }

    // ─── Upload Handler ────────────────────────────────────────────────────────

    async function handleAPLUpload(cluster, knotenpunkt, address) {
        const btn = document.getElementById('aplUploadBtn');
        const spliceCount = parseInt(document.getElementById('spliceCountFinal').value.trim(), 10);
        const spliceWasUpdated = document.getElementById('spliceWasUpdated')?.value === 'true';
        const spliceOriginal = document.getElementById('spliceOriginal')?.value || '';
        const aplDate = document.getElementById('aplDate')?.value || '';
        const aplTime = document.getElementById('aplTime')?.value || '';
        const addressClean = cleanAddress(address.end);
        const targetPath = `${cluster}/APL/${knotenpunkt}/${addressClean}`;
        const now = formatDateTime();

        btn.disabled = true;
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Uploading…`;

        try {
            let uploadedCount = 0;
            for (let i = 0; i < IMAGE_TYPES.length; i++) {
                const file = requiredFiles[i];
                if (!file) continue;
                const ext = file.name.split('.').pop().toLowerCase();
                // _U suffix marks files uploaded from device (not geo-stamped by camera)
                const suffix = fileSources[i] === 'upload' ? '_U' : '';
                const customName = `${knotenpunkt}_${addressClean}_${IMAGE_TYPES[i].id}_${now}${suffix}.${ext}`;
                const fd = new FormData();
                fd.append('project', projectName); fd.append('targetPath', targetPath); fd.append('customName', customName); fd.append('files', file);
                const res = await fetch('/api/modules/upload', { method: 'POST', headers: { 'x-user-email': userEmail }, body: fd });
                const data = await res.json();
                if (!data.success) throw new Error(`Upload failed for ${IMAGE_TYPES[i].label}: ${data.message}`);
                uploadedCount++;
            }
            for (const extra of extraFiles) {
                const fd = new FormData();
                fd.append('project', projectName); fd.append('targetPath', targetPath); fd.append('files', extra);
                const res = await fetch('/api/modules/upload', { method: 'POST', headers: { 'x-user-email': userEmail }, body: fd });
                const data = await res.json();
                if (!data.success) throw new Error(`Upload failed for ${extra.name}: ${data.message}`);
                uploadedCount++;
            }

            const aplStatusColId = nav.findColumnId('splicing', 'apl status');
            const spliceCountColId = nav.findColumnId('splicing', 'number of splices');
            const aplFolderColId = nav.findColumnId('splicing', 'apl folder location');
            const dateColId = nav.findColumnId('timing', 'date');
            const timeColId = nav.findColumnId('timing', 'time');
            const updates = {};
            if (aplStatusColId) updates[aplStatusColId] = 'Done';
            if (spliceCountColId) updates[spliceCountColId] = String(spliceCount);
            if (aplFolderColId) updates[aplFolderColId] = `Doku/${targetPath}`;
            if (dateColId && aplDate) updates[dateColId] = aplDate;
            if (timeColId && aplTime) updates[timeColId] = aplTime;

            if (Object.keys(updates).length > 0) {
                // Build log note for splice count changes
                let note = '';
                if (spliceWasUpdated && spliceOriginal) {
                    note = `Splice count UPDATED by user: ${spliceOriginal} → ${spliceCount} (original from Aufmass was ${spliceOriginal})`;
                } else if (spliceWasUpdated && !spliceOriginal) {
                    note = `Splice count MANUALLY ENTERED: ${spliceCount} (no previous value in Aufmass)`;
                } else {
                    note = `Splice count CONFIRMED: ${spliceCount} (matches Aufmass)`;
                }

                const updateRes = await fetch('/api/modules/aufmass-update', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates, module: 'apl', note })
                });
                const updateData = await updateRes.json();
                if (!updateData.success) throw new Error(`Aufmass update failed: ${updateData.message}`);
            }

            if (address.data) {
                if (aplStatusColId) address.data[aplStatusColId] = 'Done';
                if (spliceCountColId) address.data[spliceCountColId] = String(spliceCount);
                if (aplFolderColId) address.data[aplFolderColId] = `Doku/${targetPath}`;
                if (dateColId && aplDate) address.data[dateColId] = aplDate;
                if (timeColId && aplTime) address.data[timeColId] = aplTime;
            }

            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Uploaded`;
            showStatus('success', `✓ ${uploadedCount} file${uploadedCount !== 1 ? 's' : ''} uploaded — redirecting…`);
            setTimeout(() => nav._selectKnoten(nav.currentKnoten), 1800);
        } catch (e) {
            console.error('APL upload error:', e);
            showStatus('error', '✗ ' + e.message);
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Upload All`;
        }
    }

    // ─── Custom Address Renderer ───────────────────────────────────────────────

    function formatDoneDate(dateStr, timeStr) {
        if (!dateStr) return '';
        let d;
        if (dateStr.includes('-') && dateStr.length === 10) {
            const [y, m, dd] = dateStr.split('-');
            d = `${dd}.${m}.${y}`;
        } else {
            d = dateStr;
        }
        return timeStr ? `${d}, ${timeStr}` : d;
    }

    function formatMtime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dd}.${mm}.${yyyy}, ${hh}:${min}`;
    }

    // Fetch files for knotenpunkt to get done dates from file mtimes
    async function fetchFileDates(clusterName, knName) {
        const p = `${clusterName}/APL/${knName}`;
        try {
            const res = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(p)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            return (data.success && data.files) ? data.files : [];
        } catch { return []; }
    }

    function parseDateFromFilename(fname) {
        const m = fname.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
        if (m) return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
        return null;
    }

    function filenameMatchesAddress(fname, clean) {
        const idx = fname.indexOf(clean);
        if (idx === -1) return false;
        const afterIdx = idx + clean.length;
        if (afterIdx >= fname.length) return true;
        const next = fname[afterIdx];
        return next === '.' || next === '_' || next === '-' || next === ' ';
    }

    function getLatestDateForAddress(files, addrDisplay) {
        if (!files.length) return null;
        const clean = addrDisplay.trim().replace(/\s+/g, '-').replace(/,/g, '');
        let latest = null;
        let latestTs = 0;
        for (const f of files) {
            if (f.name && filenameMatchesAddress(f.name, clean)) {
                const fnDate = parseDateFromFilename(f.name);
                if (fnDate) {
                    const m = f.name.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
                    const ts = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).getTime() : 0;
                    if (ts > latestTs) { latestTs = ts; latest = fnDate; }
                } else if (f.mtime) {
                    const ts = new Date(f.mtime).getTime();
                    if (ts > latestTs) { latestTs = ts; latest = formatMtime(f.mtime); }
                }
            }
        }
        return latest;
    }

    function renderAddressesWithTermin(cluster, kn, addresses) {
        const el = nav.containers.content;
        if (!el) return;
        const filtered = nav.addressFilter ? addresses.filter(nav.addressFilter) : addresses;
        if (!filtered.length) { el.innerHTML = '<div class="mod-empty"><p>No addresses found.</p></div>'; return; }

        const terminColId = nav.findColumnId('splicing', 'apl-termin');
        const statusColId = nav.findColumnId('splicing', 'apl status');
        const dateColId = nav.findColumnId('timing', 'date');
        const timeColId = nav.findColumnId('timing', 'time');
        const nameColId = nav.findColumnId('eigentümer', 'name');
        const einblasenDateColId = nav.findColumnId('einblasen', 'einblasen-date');

        el.innerHTML = `
            <div class="addr-toolbar" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:180px;position:relative">
                    <input type="text" id="addrSearch" placeholder="Search addresses..." style="width:100%;padding:9px 12px 9px 34px;border:1px solid #d1d5db;border-radius:10px;font-size:13px;outline:none;background:#fff">
                    <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:#9ca3af" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" stroke-width="2"/><path stroke-width="2" stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
                </div>
                <input type="date" id="addrDateFilter" style="padding:9px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:13px;outline:none;background:#fff" title="Filter by done date">
                <select id="addrStatusFilter" style="padding:9px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:13px;outline:none;background:#fff">
                    <option value="">All Status</option>
                    <option value="done">Done</option>
                    <option value="waiting">Waiting</option>
                    <option value="pending">Pending</option>
                    <option value="error">Error</option>
                </select>
            </div>
            <div id="addrListContainer"><div style="color:#9ca3af;font-size:13px;padding:12px">Loading dates...</div></div>`;

        // Fetch file dates as fallback for addresses without Timing data
        fetchFileDates(cluster.name, kn.name).then(files => {

        const addrDataRaw = filtered.map(addr => {
            const status = statusColId && addr.data ? (addr.data[statusColId] || '') : '';
            const addrDisplay = addr.end || addr.start || addr.id;
            // Primary: Timing columns from Aufmass
            const timingDate = dateColId && addr.data ? (addr.data[dateColId] || '') : '';
            const timingTime = timeColId && addr.data ? (addr.data[timeColId] || '') : '';
            // Fallback: file modification time
            const fileMtime = getLatestDateForAddress(files, addrDisplay);
            const ownerName = nameColId && addr.data ? (addr.data[nameColId] || '').trim() : '';
            // Waiting: Einblasen done (has einblasen-date) but APL not yet done/error
            const s = status.toLowerCase();
            const einblasenDateVal = einblasenDateColId && addr.data ? (addr.data[einblasenDateColId] || '').trim() : '';
            const isWaiting = s !== 'done' && s !== 'error' && !!einblasenDateVal;
            return { addr, status, addrDisplay, timingDate, timingTime, fileMtime, ownerName, isWaiting };
        });

        // Sort by appointment priority: upcoming → overdue → no termin → done
        const addrData = AH.sortAddressDataByPriority(addrDataRaw, terminColId);

        function renderList(filter) {
            let items = addrData;

            if (filter?.search) {
                const q = filter.search.toLowerCase();
                items = items.filter(i => i.addrDisplay.toLowerCase().includes(q) || (i.addr.cableName || '').toLowerCase().includes(q) || i.addr.id.toLowerCase().includes(q) || i.ownerName.toLowerCase().includes(q));
            }

            if (filter?.status) {
                if (filter.status === 'waiting') {
                    items = items.filter(i => i.isWaiting);
                } else if (filter.status === 'pending') {
                    items = items.filter(i => !i.isWaiting && i.status.toLowerCase() !== 'done' && i.status.toLowerCase() !== 'error');
                } else {
                    items = items.filter(i => i.status.toLowerCase() === filter.status);
                }
            }

            if (filter?.date) {
                const [fy, fm, fd] = filter.date.split('-');
                const filterStr = `${fd}.${fm}.${fy}`;
                items = items.filter(i => {
                    const fileDate = getLatestDateForAddress(files, i.addrDisplay);
                    if (fileDate) return fileDate.startsWith(filterStr);
                    if (i.timingDate) {
                        let d = i.timingDate;
                        if (d.includes('-')) { const [y,m,dd] = d.split('-'); d = `${dd}.${m}.${y}`; }
                        return d.startsWith(filterStr);
                    }
                    return false;
                });
            }

            if (!items.length) {
                document.getElementById('addrListContainer').innerHTML = '<div class="mod-empty"><p>No addresses match.</p></div>';
                return;
            }

            const rows = items.map(({ addr, status, addrDisplay, timingDate, timingTime, fileMtime, ownerName, isWaiting }) => {
                const isDone = status.toLowerCase() === 'done';
                const isErr = status.toLowerCase() === 'error';
                const badge = isDone ? '<span class="mod-badge mod-badge-done">Done</span>'
                    : isErr ? '<span class="mod-badge mod-badge-error">⚠ Error</span>'
                    : isWaiting ? '<span class="mod-badge mod-badge-waiting">⏳ Waiting</span>'
                    : '<span class="mod-badge mod-badge-pending">Pending</span>';
                const termin = terminColId ? AH.parseTermin(addr.data?.[terminColId]) : null;
                // Use file date first (from filename), fallback to Timing columns
                const fileDate = getLatestDateForAddress(files, addrDisplay);
                const doneDateStr = fileDate ? fileDate : (timingDate ? formatDoneDate(timingDate, timingTime) : '');
                const doneDateHTML = (isDone && doneDateStr) ? `<div style="font-size:11px;color:#16a34a;margin-top:1px">● ${esc(doneDateStr)}</div>` : '';

                return `
                    <div class="addr-row" data-id="${esc(addr.id)}">
                        <div class="addr-info">
                            <div class="addr-end">${esc(addrDisplay)}</div>
                            ${ownerName ? `<div class="addr-owner">👤 ${esc(ownerName)}</div>` : ''}
                            <div class="addr-cable">${esc(addr.cableName || '—')}${addr.fiberType ? ` · ${esc(addr.fiberType)}` : ''}</div>
                            ${AH.terminBadgeHTMLForCard(termin, isDone)}
                        </div>
                        <div class="addr-right">
                            <div style="text-align:right">${badge}${doneDateHTML}</div>
                            ${nav._chevronIcon()}
                        </div>
                    </div>`;
            }).join('');

            document.getElementById('addrListContainer').innerHTML = `<div class="addr-list">${rows}</div>`;
            document.querySelectorAll('#addrListContainer .addr-row').forEach(row => {
                row.addEventListener('click', () => {
                    const item = addrData.find(i => i.addr.id === row.dataset.id);
                    if (item) { nav.currentAddress = item.addr; nav.updateBreadcrumb([cluster.name, kn.name, item.addrDisplay]); renderChoiceScreen(cluster.name, kn.name, item.addr); }
                });
            });
        }

        renderList({});

        const searchInput = document.getElementById('addrSearch');
        const dateInput = document.getElementById('addrDateFilter');
        const statusSelect = document.getElementById('addrStatusFilter');

        function getFilters() {
            return {
                search: searchInput?.value || '',
                date: dateInput?.value || '',
                status: statusSelect?.value || ''
            };
        }

        searchInput?.addEventListener('input', () => renderList(getFilters()));
        dateInput?.addEventListener('change', () => renderList(getFilters()));
        statusSelect?.addEventListener('change', () => renderList(getFilters()));

        }); // end fetchFileDates.then
    }

    // ─── Boot ──────────────────────────────────────────────────────────────────

    const nav = new ModuleNavigator({
        project: projectName, moduleName: 'APL', moduleKey: 'apl', groupLabel: 'splicing',
        customUploadForm: true,
        onAddressSelected: (cluster, knotenpunkt, address) => renderChoiceScreen(cluster, knotenpunkt, address),
        containers: { content: document.getElementById('moduleContent'), breadcrumb: document.getElementById('moduleBreadcrumb') }
    });

    const origSelectKnoten = nav._selectKnoten.bind(nav);
    nav._selectKnoten = function(kn) {
        this.currentKnoten = kn; this.currentAddress = null;
        if (this.skipAddressStep) { origSelectKnoten(kn); return; }
        renderAddressesWithTermin(this.currentCluster, kn, kn.addresses);
        this.updateBreadcrumb([this.currentCluster.name, kn.name]);
    };

    nav.init().catch(err => console.error('APL init error:', err));
})();
