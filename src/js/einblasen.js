/**
 * einblasen.js
 * Einblasen module — appointment scheduling + PDF upload with Metrierung.
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

    function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // ─── Choice Screen ─────────────────────────────────────────────────────────

    // ─── Shared file-list injection helper ─────────────────────────────────────

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
                    // Char after match must be a non-alphanumeric boundary (., _, -, end of string)
                    const afterIdx = idx + clean.length;
                    if (afterIdx >= f.name.length) return true;
                    const next = f.name[afterIdx];
                    return next === '.' || next === '_' || next === '-' || next === ' ';
                });
            }

            // Render with delete buttons
            const fileRows = files.map(f => {
                const ext = (f.name || '').split('.').pop().toUpperCase();
                const icon = ext === 'PDF' ? 'PDF' : ext === 'JPG' || ext === 'JPEG' || ext === 'PNG' ? '🖼' : '📄';
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
                        // If no files left, reset status and clean EB error entries
                        if (remaining === 0) {
                            const sc = nav.findColumnId('einblasen', 'status einblasen');
                            if (sc) {
                                const clearUpdates = { [sc]: '' };
                                const erc = nav.findColumnId('notes', 'error-reporting');
                                if (erc && currentAddr.data?.[erc]) {
                                    const parts = (currentAddr.data[erc]).split(';').filter(Boolean);
                                    const stripped = parts.filter(p => !p.startsWith('EB:'));
                                    clearUpdates[erc] = stripped.length ? stripped.join(';') + ';' : '';
                                }
                                await fetch('/api/modules/aufmass-update', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                                    body: JSON.stringify({ project: projectName, rowId: currentAddr.id, updates: clearUpdates, module: 'einblasen', note: 'Status reset to Pending — all files deleted' })
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

    function renderChoiceScreen(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const addrDisplay = address.end || address.start || address.id;
        const terminColId = nav.findColumnId('einblasen', 'einblasen-termin');
        const termin = terminColId && address.data ? AH.parseTermin(address.data[terminColId]) : null;
        const statusColId = nav.findColumnId('einblasen', 'status einblasen');
        const currentStatus = statusColId && address.data ? (address.data[statusColId] || '') : '';
        const isDone = currentStatus.toLowerCase() === 'done';
        // Also treat as error when Error-Reporting has active (unfixed) EB entries
        const ercColId = nav.findColumnId('notes', 'error-reporting');
        const errLogCS = ercColId && address.data ? (address.data[ercColId] || '') : '';
        const hasActiveEB = errLogCS.split(';').some(p => p.startsWith('EB:') && !p.endsWith('#'));
        const isError = currentStatus.toLowerCase() === 'error' || hasActiveEB;
        const statusBadge = isDone ? '<span class="mod-badge mod-badge-done">Done</span>'
            : isError ? '<span class="mod-badge mod-badge-error">⚠ Error</span>'
            : '<span class="mod-badge mod-badge-pending">Pending</span>';

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
                        const ebErrors = errLog.split(';').filter(p => p.startsWith('EB:'));
                        const activeErrors = ebErrors.filter(p => !p.endsWith('#')).map(p => p.replace(/^EB:/, ''));
                        const fixedErrors = ebErrors.filter(p => p.endsWith('#')).map(p => p.replace(/^EB:/, '').replace(/#$/, ''));
                        let html = '<div class="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">';
                        html += '<div class="font-semibold mb-1">⚠ Active Errors:</div>';
                        if (activeErrors.length) html += activeErrors.map(e => `<div>• ${esc(e)}</div>`).join('');
                        else html += '<div>No active errors found</div>';
                        if (fixedErrors.length) html += '<div class="mt-1 text-green-700 font-semibold">✓ Fixed:</div>' + fixedErrors.map(e => `<div class="text-green-600">• ${esc(e)}</div>`).join('');
                        html += '</div>';
                        return html;
                    })() : ''}
                </div>
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
                    nav, projectName, userEmail, address, terminColId, moduleKey: 'einblasen',
                    onDone: () => renderChoiceScreen(cluster, knotenpunkt, address)
                });
            });
        }

        if (isDone || isError) {
            const targetPath = `${cluster}/Einblasen/${knotenpunkt}`;
            const docsPath = `Doku/${targetPath}`;
            injectFilesSection(el, targetPath, docsPath, addrDisplay, cluster, knotenpunkt, address);
        }

        document.getElementById('btnUpload')?.addEventListener('click', () => {
            nav.currentAddress = address;
            nav.updateBreadcrumb([nav.currentCluster.name, nav.currentKnoten.name, addrDisplay]);
            renderUploadWithGenerator(cluster, knotenpunkt, address);
        });

        // Report Error — prompt for description, append to Error-Reporting column
        document.getElementById('btnReportError')?.addEventListener('click', async () => {
            const errorText = await showPrompt('⚠ Report Error', 'Describe the error (e.g. cable stuck, machine failed):');
            if (!errorText || !errorText.trim()) return;
            const sc = nav.findColumnId('einblasen', 'status einblasen');
            const erc = nav.findColumnId('notes', 'error-reporting');
            if (!sc) return;
            try {
                const updates = { [sc]: 'Error' };
                if (erc) {
                    const existing = (address.data?.[erc] || '').trim();
                    const entry = `EB:${errorText.trim()}`;
                    const base = existing ? (existing.endsWith(';') ? existing : existing + ';') : '';
                    updates[erc] = base + entry + ';';
                }
                await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates, module: 'einblasen', note: `EB Error: ${errorText.trim()}` })
                });
                if (address.data) Object.assign(address.data, updates);
                renderChoiceScreen(cluster, knotenpunkt, address);
            } catch (e) { await showAlert('Failed: ' + e.message); }
        });

        // Clear Error — show selection modal so user can pick WHICH specific EB error to mark fixed
        document.getElementById('btnClearError')?.addEventListener('click', async () => {
            const sc = nav.findColumnId('einblasen', 'status einblasen');
            const erc = nav.findColumnId('notes', 'error-reporting');
            if (!sc) return;
            const log = (address.data?.[erc] || '');
            const parts = log.split(';').filter(Boolean);
            // Build entry list for EB errors only
            const entries = parts.reduce((acc, p, i) => {
                if (p.startsWith('EB:')) {
                    const fixed = p.endsWith('#');
                    const description = p.replace(/^EB:/, '').replace(/#$/, '');
                    acc.push({ description, fixed, partIndex: i });
                }
                return acc;
            }, []);
            if (!entries.length) return;
            // Show modal — user selects which action to perform
            const result = await showErrorSelectModal('Einblasen — Resolve Error', entries);
            if (!result) return;
            try {
                const updates = {};
                let note = '';
                if (erc) {
                    switch (result.action) {
                        case 'fix':
                            if (!parts[result.partIndex].endsWith('#')) {
                                parts[result.partIndex] = parts[result.partIndex] + '#';
                            }
                            note = `EB Error fixed: ${parts[result.partIndex].replace(/^EB:|#$/g, '')}`;
                            break;
                        case 'reopen':
                            parts[result.partIndex] = parts[result.partIndex].replace(/#$/, '');
                            note = `EB Error reopened: ${parts[result.partIndex].replace(/^EB:/, '')}`;
                            break;
                        case 'edit': {
                            const prefixMatch = parts[result.partIndex].match(/^(EB:)/);
                            const prefix = prefixMatch ? prefixMatch[1] : 'EB:';
                            const wasFixed = parts[result.partIndex].endsWith('#');
                            parts[result.partIndex] = prefix + result.newText + (wasFixed ? '#' : '');
                            note = `EB Error edited: ${result.newText}`;
                            break;
                        }
                        case 'delete':
                            note = `EB Error deleted: ${parts[result.partIndex].replace(/^EB:|#$/g, '')}`;
                            parts.splice(result.partIndex, 1);
                            break;
                    }
                    updates[erc] = parts.length ? parts.join(';') + ';' : '';
                    // Keep status Error if any unfixed EB errors remain; otherwise clear it
                    const hasUnfixed = parts.some(p => p.startsWith('EB:') && !p.endsWith('#'));
                    updates[sc] = hasUnfixed ? 'Error' : (currentStatus.toLowerCase() === 'error' ? '' : currentStatus);
                } else {
                    updates[sc] = '';
                    note = `EB Error action: ${result.action}`;
                }
                await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates, module: 'einblasen', note })
                });
                if (address.data) Object.assign(address.data, updates);
                renderChoiceScreen(cluster, knotenpunkt, address);
            } catch (e) { await showAlert('Failed: ' + e.message); }
        });
    }

    // ─── Custom Address Renderer ───────────────────────────────────────────────

    // ─── Format mtime for display ──────────────────────────────────────────────
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

    // ─── Fetch files for knotenpunkt and extract latest date per address ────────
    async function fetchFileDates(clusterName, knName) {
        // Einblasen files are in: Cluster/Einblasen/Knotenpunkt/
        const p = `${clusterName}/Einblasen/${knName}`;
        try {
            const res = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(p)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            return (data.success && data.files) ? data.files : [];
        } catch { return []; }
    }

    // Extract date from filename: Cluster_YYYYMMDD_HHMMSS_Knotenpunkt_bis_Address.pdf
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

        const terminColId = nav.findColumnId('einblasen', 'einblasen-termin');
        const statusColId = nav.findColumnId('einblasen', 'status einblasen');
        const dateColId = nav.findColumnId('einblasen', 'einblasen-date');
        const ercColIdList = nav.findColumnId('notes', 'error-reporting');
        const addrDataRaw = filtered.map(addr => {
            const status = statusColId && addr.data ? (addr.data[statusColId] || '') : '';
            const addrDisplay = addr.end || addr.start || addr.id;
            const doneDate = dateColId && addr.data ? (addr.data[dateColId] || '') : '';
            // Treat as Error if Error-Reporting has active (unfixed) EB entries
            const errLogList = ercColIdList && addr.data ? (addr.data[ercColIdList] || '') : '';
            const hasActiveEBList = errLogList.split(';').some(p => p.startsWith('EB:') && !p.endsWith('#'));
            const effectiveStatus = (status.toLowerCase() !== 'done' && hasActiveEBList) ? 'Error' : status;
            return { addr, status: effectiveStatus, addrDisplay, doneDate };
        });

        // Sort by appointment priority: upcoming → overdue → no termin → done
        const addrData = AH.sortAddressDataByPriority(addrDataRaw, terminColId);

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
                    <option value="pending">Pending</option>
                    <option value="error">Error</option>
                </select>
            </div>
            <div id="addrListContainer"></div>`;

        function renderList(filter) {
            let items = addrData;

            if (filter?.search) {
                const q = filter.search.toLowerCase();
                items = items.filter(i => i.addrDisplay.toLowerCase().includes(q) || (i.addr.cableName || '').toLowerCase().includes(q) || i.addr.id.toLowerCase().includes(q));
            }
            if (filter?.status) {
                items = items.filter(i => i.status.toLowerCase() === filter.status);
            }
            if (filter?.date) {
                // filter.date is YYYY-MM-DD, doneDate is "YYYY-MM-DD, HH:MM" or "DD.MM.YYYY, HH:MM"
                items = items.filter(i => {
                    if (!i.doneDate) return false;
                    // Normalize: if doneDate starts with YYYY, compare directly
                    if (i.doneDate.startsWith(filter.date)) return true;
                    // If DD.MM.YYYY format
                    const [fy, fm, fd] = filter.date.split('-');
                    return i.doneDate.startsWith(`${fd}.${fm}.${fy}`);
                });
            }

            if (!items.length) {
                document.getElementById('addrListContainer').innerHTML = '<div class="mod-empty"><p>No addresses match.</p></div>';
                return;
            }

            const rows = items.map(({ addr, status, addrDisplay, doneDate }) => {
                const isDone = status.toLowerCase() === 'done';
                const isErr = status.toLowerCase() === 'error';
                const badge = isDone ? '<span class="mod-badge mod-badge-done">Done</span>'
                    : isErr ? '<span class="mod-badge mod-badge-error">⚠ Error</span>'
                    : '<span class="mod-badge mod-badge-pending">Pending</span>';
                const termin = terminColId ? AH.parseTermin(addr.data?.[terminColId]) : null;
                const doneDateHTML = (isDone && doneDate) ? `<div style="font-size:11px;color:#16a34a;margin-top:1px">● ${esc(doneDate)}</div>` : '';

                return `
                    <div class="addr-row" data-id="${esc(addr.id)}">
                        <div class="addr-info">
                            <div class="addr-end">${esc(addrDisplay)}</div>
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
        function getFilters() { return { search: searchInput?.value || '', date: dateInput?.value || '', status: statusSelect?.value || '' }; }
        searchInput?.addEventListener('input', () => renderList(getFilters()));
        dateInput?.addEventListener('change', () => renderList(getFilters()));
        statusSelect?.addEventListener('change', () => renderList(getFilters()));
    }

    // ─── Upload Page with Generator ─────────────────────────────────────────────

    // =====================================================================
    //  UPLOAD + GENERATOR PAGE — rewritten from scratch 2026-04-12
    // =====================================================================

    function renderUploadWithGenerator(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;
        const addrDisplay = address.end || address.start || address.id;
        const now = new Date();
        const defaultDate = now.toISOString().slice(0, 10);
        const defaultTime = now.toTimeString().slice(0, 5);

        // ── HTML ────────────────────────────────────────────────────────────────
        el.innerHTML = `
        <div class="apl-form-wrap">
            <div class="glass-card">
                <h3 class="text-base font-bold text-gray-900 mb-1">Einblasen — ${esc(knotenpunkt)} / ${esc(addrDisplay)}</h3>
                <p class="text-xs text-gray-400">Upload work or generate Einblasprotokoll</p>
            </div>

            <!-- Manual upload -->
            <div class="glass-card">
                <h4 class="text-sm font-bold text-gray-700 mb-3">📷 Upload Einblasen Files</h4>
                <div id="standardUploadArea"></div>
            </div>

            <!-- Generator — hidden until user has permission -->
            <div id="generatorSection" style="display:none">
                <div class="glass-card">
                    <h4 class="text-sm font-bold text-gray-700 mb-2">📄 Einblasprotokoll Generator</h4>

                    <!-- Step 1: Code input -->
                    <div id="codeBlock">
                        <p class="text-xs text-gray-400 mb-3">Enter the generator code to create a protocol PDF.</p>
                        <div style="display:flex;gap:8px;align-items:center">
                            <input type="text" id="codeInput" style="flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:monospace;outline:none" placeholder="Enter code..." autocomplete="off">
                            <button id="codeBtn" style="padding:10px 20px;background:#1f2937;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Verify</button>
                        </div>
                        <div id="codeError" class="text-xs text-red-500 mt-1 hidden"></div>
                    </div>

                    <!-- Step 2: Details form + buttons (hidden until code OK) -->
                    <div id="detailsBlock" style="display:none" class="mt-4">
                        <h4 class="text-sm font-bold text-gray-700 mb-3">📋 Einblasen Details</h4>
                        <div class="form-row-2col mb-3">
                            <div><label class="form-lbl">Date</label><input type="date" id="fDate" class="form-inp" value="${defaultDate}"></div>
                            <div><label class="form-lbl">Time</label><input type="time" id="fTime" class="form-inp" value="${defaultTime}"></div>
                        </div>
                        <div class="form-row-2col mb-3">
                            <div><label class="form-lbl">Start Meter <span class="text-red-400">*</span></label><input type="number" id="fStart" class="form-inp" placeholder="e.g. 0" min="0" step="0.1"></div>
                            <div><label class="form-lbl">End Meter <span class="text-red-400">*</span></label><input type="number" id="fEnd" class="form-inp" placeholder="e.g. 3970" min="0" step="0.1"></div>
                        </div>
                        <div class="form-row-2col mb-3">
                            <div><label class="form-lbl">Metrierung Total</label><div id="metTotal" class="form-inp-readonly">—</div></div>
                            <div><label class="form-lbl">Fiber Colour</label><input type="text" id="fColour" class="form-inp" placeholder="e.g. Blue, Red"></div>
                        </div>
                        <!-- Advanced Configuration (collapsed) -->
                        <details class="mt-4 mb-3" id="advancedConfig">
                            <summary class="text-xs font-bold text-gray-500 cursor-pointer select-none py-2">⚙️ Advanced Configuration</summary>
                            <div class="mt-3 space-y-3">
                                <div class="form-row-2col">
                                    <div><label class="form-lbl">Einbläser (Operator)</label><input type="text" id="fOperator" class="form-inp" placeholder="Name"></div>
                                    <div><label class="form-lbl">Ort (GPS)</label><input type="text" id="fGps" class="form-inp" value="49.8667, 10.5667" placeholder="lat, lon"></div>
                                </div>
                                <div><label class="form-lbl">Bemerkungen (Remarks)</label><input type="text" id="fRemarks" class="form-inp" placeholder="Optional remarks"></div>
                                <div class="form-row-2col">
                                    <div><label class="form-lbl">Rohr-Hersteller (Pipe Mfr)</label><input type="text" id="fPipeMan" class="form-inp" value="Hexatronic"></div>
                                    <div><label class="form-lbl">Rohrverband (Pipe Type)</label><input type="text" id="fPipeType" class="form-inp" value="SNRVe 12x10x2.0"></div>
                                </div>
                                <div class="form-row-2col">
                                    <div><label class="form-lbl">Rohr (Pipe Dim)</label><input type="text" id="fPipeDim" class="form-inp" value="SNR 10x2.0"></div>
                                    <div><label class="form-lbl">Kabel-Hersteller (Cable Mfr)</label><input type="text" id="fCableMan" class="form-inp" value="Emtelle"></div>
                                </div>
                                <div class="form-row-2col">
                                    <div><label class="form-lbl">Einblasgerät (Device)</label><input type="text" id="fDevice" class="form-inp" value="Fremco MicroFlow LOG"></div>
                                    <div><label class="form-lbl">Controller S/N</label><input type="text" id="fDeviceSn" class="form-inp" value="9328.4720"></div>
                                </div>
                                <div class="form-row-2col">
                                    <div><label class="form-lbl">Kompressor</label><input type="text" id="fCompressor" class="form-inp" value="M17"></div>
                                    <div><label class="form-lbl">Gleitmittel (Lube)</label><input type="text" id="fLube" class="form-inp" value="Micro Jetting Lube MJL"></div>
                                </div>
                            </div>
                        </details>

                        <div class="flex gap-2 mt-4 flex-wrap">
                            <button id="btnGen" class="gen-action-btn gen-btn-generate flex-1">⚡ Generate</button>
                            <button id="btnPdf" class="gen-action-btn gen-btn-export flex-1" disabled>📄 Export PDF</button>
                            <button id="btnSend" class="gen-action-btn gen-btn-approve flex-1" disabled>✓ Approve &amp; Send</button>
                        </div>
                        <div id="genMsg" class="hidden mt-3 text-xs font-semibold text-center py-2 px-3 rounded-lg"></div>
                    </div>

                    <!-- Iframe (hidden until code OK) -->
                    <div id="iframeWrap" class="hidden mt-4" style="border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
                        <iframe id="genIframe" style="width:100%;height:85vh;border:none"></iframe>
                    </div>
                </div>
            </div>

            <div class="flex gap-3">
                <button id="backBtn2" class="btn-secondary flex-1">Back</button>
            </div>
        </div>`;

        // ── Back ────────────────────────────────────────────────────────────────
        document.getElementById('backBtn2').onclick = () => renderChoiceScreen(cluster, knotenpunkt, address);

        // ── Standard upload (force upload form, never the files-view) ──────────
        nav.currentAddress = address;
        const realStatus = nav.statusColId && address.data ? address.data[nav.statusColId] : null;
        try {
            if (nav.statusColId && address.data) address.data[nav.statusColId] = '';  // trick: hide Done so it shows upload form
            nav.renderUploadFormInto(document.getElementById('standardUploadArea'), address);
        } finally {
            if (nav.statusColId && address.data && realStatus != null) address.data[nav.statusColId] = realStatus;
        }

        // ── Metrierung auto-calc ────────────────────────────────────────────────
        function calcMet() {
            const s = parseFloat(document.getElementById('fStart')?.value);
            const e = parseFloat(document.getElementById('fEnd')?.value);
            const t = document.getElementById('metTotal');
            if (!t) return;
            if (!isNaN(s) && !isNaN(e) && e >= s) { t.textContent = (e - s).toFixed(1) + ' m'; t.classList.add('met-calculated'); }
            else { t.textContent = '—'; t.classList.remove('met-calculated'); }
        }
        document.getElementById('fStart')?.addEventListener('input', calcMet);
        document.getElementById('fEnd')?.addEventListener('input', calcMet);

        // ── Send details to iframe on every keystroke ───────────────────────────
        function pushToIframe() {
            const iframe = document.getElementById('genIframe');
            if (!iframe?.contentWindow) return;
            iframe.contentWindow.postMessage({
                type: 'einblas-details-update',
                startMeter: document.getElementById('fStart')?.value || '',
                endMeter:   document.getElementById('fEnd')?.value || '',
                date:       document.getElementById('fDate')?.value || '',
                time:       document.getElementById('fTime')?.value || '',
                color:      document.getElementById('fColour')?.value || '',
                operator:   document.getElementById('fOperator')?.value || '',
                gps:        document.getElementById('fGps')?.value || '',
                remarks:    document.getElementById('fRemarks')?.value || '',
                pipeMan:    document.getElementById('fPipeMan')?.value || '',
                pipeType:   document.getElementById('fPipeType')?.value || '',
                pipeDim:    document.getElementById('fPipeDim')?.value || '',
                cableMan:   document.getElementById('fCableMan')?.value || '',
                device:     document.getElementById('fDevice')?.value || '',
                deviceSn:   document.getElementById('fDeviceSn')?.value || '',
                compressor: document.getElementById('fCompressor')?.value || '',
                lube:       document.getElementById('fLube')?.value || '',
            }, '*');
        }
        ['fStart', 'fEnd', 'fDate', 'fTime', 'fColour', 'fOperator', 'fGps', 'fRemarks',
         'fPipeMan', 'fPipeType', 'fPipeDim', 'fCableMan', 'fDevice', 'fDeviceSn', 'fCompressor', 'fLube'].forEach(id => {
            const inp = document.getElementById(id);
            if (inp) { inp.addEventListener('input', pushToIframe); inp.addEventListener('change', pushToIframe); }
        });

        // ── Send command to iframe ──────────────────────────────────────────────
        function cmd(action) {
            const iframe = document.getElementById('genIframe');
            if (!iframe?.contentWindow) return;
            iframe.contentWindow.postMessage({ type: 'einblas-command', action }, '*');
        }

        // ── Status helper ───────────────────────────────────────────────────────
        function msg(text, type) {
            const el = document.getElementById('genMsg');
            if (!el) return;
            el.textContent = text;
            el.className = 'mt-3 text-xs font-semibold text-center py-2 px-3 rounded-lg ' +
                (type === 'ok' ? 'bg-green-50 text-green-700' : type === 'err' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600');
            el.classList.remove('hidden');
        }

        // ── Button handlers ─────────────────────────────────────────────────────
        document.getElementById('btnGen').onclick = () => {
            msg('Generating…', 'info');
            document.getElementById('btnPdf').disabled = true;
            document.getElementById('btnSend').disabled = true;
            pushToIframe();
            setTimeout(() => cmd('generate'), 150);
        };
        document.getElementById('btnPdf').onclick  = () => cmd('export');
        document.getElementById('btnSend').onclick = () => {
            document.getElementById('btnSend').disabled = true;
            document.getElementById('btnSend').textContent = 'Processing…';
            cmd('approve');
        };

        // ── Generator access check + code verify ────────────────────────────────
        let _genUrl = '', _apiUrl = '';

        (async () => {
            try {
                const r = await fetch('/api/settings/generator-access', { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } });
                const d = await r.json();
                if (d.success && d.hasAccess) {
                    _genUrl = d.generatorUrl || '';
                    _apiUrl = d.generatorApiUrl || '';
                    document.getElementById('generatorSection').style.display = '';
                }
            } catch (_) {}
        })();

        function openIframe() {
            if (!_genUrl) return;
            const p = new URLSearchParams();
            p.set('embed', 'true');
            if (_apiUrl) p.set('api_url', _apiUrl);
            p.set('project_id', projectName);
            p.set('section', knotenpunkt + ' bis ' + addrDisplay);
            p.set('company', 'Geggos FTTX');
            if (address.fiberType) p.set('fibers', address.fiberType.replace(/[^0-9]/g, '') || '12');
            p.set('cluster', cluster);
            p.set('knotenpunkt', knotenpunkt);
            p.set('address', addrDisplay);
            // Pass GPS — from form field, aufmass data, or fetch from project-info
            const gpsVal = document.getElementById('fGps')?.value || '';
            if (gpsVal) p.set('gps', gpsVal);
            // Pass current form values so iframe starts with them
            const sv = document.getElementById('fStart')?.value; if (sv) p.set('start_meter', sv);
            const ev = document.getElementById('fEnd')?.value;   if (ev) p.set('end_meter', ev);
            const dv = document.getElementById('fDate')?.value;  if (dv) p.set('date', dv);
            const tv = document.getElementById('fTime')?.value;  if (tv) p.set('time', tv);
            document.getElementById('genIframe').src = _genUrl + '?' + p.toString();
            document.getElementById('iframeWrap').classList.remove('hidden');
        }

        document.getElementById('codeBtn').onclick = async () => {
            const code = document.getElementById('codeInput').value.trim();
            const err = document.getElementById('codeError');
            err.classList.add('hidden');
            if (!code) { err.textContent = 'Enter a code'; err.classList.remove('hidden'); return; }
            try {
                const r = await fetch('/api/settings/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail }, body: JSON.stringify({ code }) });
                const d = await r.json();
                if (d.success) {
                    document.getElementById('codeBlock').style.display = 'none';
                    document.getElementById('detailsBlock').style.display = '';
                    openIframe();
                } else { err.textContent = d.message || 'Invalid code'; err.classList.remove('hidden'); }
            } catch (_) { err.textContent = 'Verification failed'; err.classList.remove('hidden'); }
        };
        document.getElementById('codeInput').onkeydown = e => { if (e.key === 'Enter') document.getElementById('codeBtn').click(); };

        // Auto-populate GPS from project-info if available
        (async () => {
            try {
                const r = await fetch(`/api/project-info?project=${encodeURIComponent(projectName)}`, { headers: { 'x-user-email': userEmail } });
                const d = await r.json();
                if (d.success && d.info?.gps) {
                    const gpsEl = document.getElementById('fGps');
                    if (gpsEl && !gpsEl.value) gpsEl.value = d.info.gps;
                }
            } catch (_) {}
        })();
    }

    // =====================================================================
    //  LISTEN FOR MESSAGES FROM GENERATOR IFRAME
    // =====================================================================
    window.addEventListener('message', async (event) => {
        if (!event.data?.type) return;

        // ── Generation complete → enable buttons ────────────────────────────────
        if (event.data.type === 'einblas-generated') {
            msg_global('✓ Generated — ' + event.data.logCount + ' points, Einblaszeit: ' + event.data.einblaszeit, 'ok');
            const bp = document.getElementById('btnPdf');  if (bp) bp.disabled = false;
            const bs = document.getElementById('btnSend'); if (bs) bs.disabled = false;
            return;
        }

        // ── Generation error ────────────────────────────────────────────────────
        if (event.data.type === 'einblas-generate-error') {
            msg_global('✗ Failed: ' + (event.data.error || 'Unknown'), 'err');
            return;
        }

        // ── Approved PDF received → upload + update aufmass ─────────────────────
        if (event.data.type !== 'einblas-approved') return;
        const { pdfBlob, startMeter, endMeter } = event.data;
        if (!pdfBlob || !nav.currentAddress) return;

        const addr = nav.currentAddress;
        const cName = nav.currentCluster?.name || event.data.cluster || '';
        const kName = nav.currentKnoten?.name || event.data.knotenpunkt || '';
        const pad = n => String(n).padStart(2, '0');
        const n = new Date();
        const ds = `${n.getFullYear()}${pad(n.getMonth()+1)}${pad(n.getDate())}`;
        const ts = `${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
        const a1 = (addr.start || '').trim().replace(/[\s,]+/g, '-') || 'Start';
        const a2 = (addr.end || '').trim().replace(/[\s,]+/g, '-') || 'End';
        const fname = `${cName}_${ds}_${ts}_${a1}_bis_${a2}.pdf`;
        const tpath = `${cName}/Einblasen/${kName}`;

        try {
            const bytes = Uint8Array.from(atob(pdfBlob), c => c.charCodeAt(0));
            const file = new File([bytes], fname, { type: 'application/pdf' });
            const fd = new FormData();
            fd.append('files', file); fd.append('project', projectName);
            fd.append('targetPath', tpath); fd.append('customName', fname);

            const ur = await fetch('/api/modules/upload', { method: 'POST', headers: { 'x-user-email': userEmail }, body: fd });
            const udText = await ur.text();
            let ud;
            try { ud = JSON.parse(udText); } catch (_) { throw new Error(udText.slice(0, 200)); }
            if (!ud.success) throw new Error(ud.message);

            const updates = {};
            const col = (g, c) => nav.findColumnId(g, c);
            const sc = col('einblasen', 'status einblasen');     if (sc) updates[sc] = 'Done';
            const mc = col('einblasen', 'metrierung total');     if (mc && startMeter != null && endMeter != null) updates[mc] = String(Math.abs(endMeter - startMeter));
            const fc = col('einblasen', 'file location');        if (fc) updates[fc] = `Doku/${tpath}/${fname}`;
            // Save date from filename to Einblasen-Date column
            const edc = col('einblasen', 'einblasen-date');
            const fD = document.getElementById('fDate')?.value;
            const fT = document.getElementById('fTime')?.value;
            if (edc && fD) updates[edc] = fD + (fT ? ', ' + fT : '');

            if (Object.keys(updates).length) {
                await fetch('/api/modules/aufmass-update', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail }, body: JSON.stringify({ project: projectName, rowId: addr.id, updates, module: 'einblasen' }) });
                if (addr.data) Object.assign(addr.data, updates);
            }

            const sb = document.getElementById('btnSend');
            if (sb) { sb.textContent = '✓ Sent'; sb.classList.add('gen-btn-approved'); }
            msg_global('✓ Uploaded and aufmass updated!', 'ok');
            setTimeout(() => nav._selectKnoten(nav.currentKnoten), 1500);
        } catch (e) {
            console.error('Upload error:', e);
            const sb = document.getElementById('btnSend');
            if (sb) { sb.disabled = false; sb.textContent = '✓ Approve & Send'; }
            msg_global('✗ Upload failed: ' + e.message, 'err');
        }
    });

    // Global msg helper for the postMessage listener
    function msg_global(text, type) {
        const el = document.getElementById('genMsg');
        if (!el) return;
        el.textContent = text;
        el.className = 'mt-3 text-xs font-semibold text-center py-2 px-3 rounded-lg ' +
            (type === 'ok' ? 'bg-green-50 text-green-700' : type === 'err' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600');
        el.classList.remove('hidden');
    }

    // ─── Boot ──────────────────────────────────────────────────────────────────

    const nav = new ModuleNavigator({
        project:      projectName,
        moduleName:   'Einblasen',
        moduleKey:    'einblasen',
        targetFolder: 'Einblasen',
        groupLabel:   'einblasen',
        typeOptions:  ['12x10', '4x20', 'custom'],
        useOriginalFilename: true,
        customUploadForm: true,
        onAddressSelected: (cluster, knotenpunkt, address) => renderChoiceScreen(cluster, knotenpunkt, address),
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        },
        extraFields: []
    });

    // Wrap handleUpload to also save date/time + metrierung from form fields
    const origHandleUpload = nav.handleUpload.bind(nav);
    nav.handleUpload = async function(file, addr, type, extraValues = {}) {
        await origHandleUpload(file, addr, type, extraValues);

        // After successful upload, save date/time + metrierung from form fields
        const edcColId  = this.findColumnId('einblasen', 'einblasen-date');
        const metColId  = this.findColumnId('einblasen', 'metrierung total');
        const lwlColId  = this.findColumnId('lwl specs', 'total');
        const formDate  = document.getElementById('fDate')?.value || '';
        const formTime  = document.getElementById('fTime')?.value || '';
        const startVal  = parseFloat(document.getElementById('fStart')?.value);
        const endVal    = parseFloat(document.getElementById('fEnd')?.value);

        const extraUpdates = {};
        if (edcColId && formDate) extraUpdates[edcColId] = formDate + (formTime ? ', ' + formTime : '');
        if (!isNaN(startVal) && !isNaN(endVal) && endVal >= startVal) {
            const met = String(Math.round((endVal - startVal) * 10) / 10);
            if (metColId) extraUpdates[metColId] = met;
            if (lwlColId) extraUpdates[lwlColId] = met;
        }

        if (Object.keys(extraUpdates).length > 0) {
            await fetch('/api/modules/aufmass-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-email': this._userEmail || localStorage.getItem('userEmail') || '' },
                body: JSON.stringify({ project: this.project, rowId: addr.id, updates: extraUpdates, module: 'einblasen' })
            });
            if (addr.data) Object.assign(addr.data, extraUpdates);
        }
    };

    const origSelectKnoten = nav._selectKnoten.bind(nav);
    nav._selectKnoten = function(kn) {
        this.currentKnoten = kn; this.currentAddress = null;
        if (this.skipAddressStep) { origSelectKnoten(kn); return; }
        renderAddressesWithTermin(this.currentCluster, kn, kn.addresses);
        this.updateBreadcrumb([this.currentCluster.name, kn.name]);
    };

    nav.init().catch(err => console.error('Einblasen init error:', err));
})();
