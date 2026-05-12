/**
 * otdr.js
 * OTDR module — multi-file upload with expected count validation.
 *
 * Navigation: Cluster → Knotenpunkt → Address (via ModuleNavigator)
 * Shows only addresses where OTDR status is Waiting / Incomplete / Done.
 * Upload: multiple .pdf and .sor files per address, keep original filenames.
 * Expected count: spliceCount × 4 (1 PDF + 3 SOR per splice).
 * Status: Done (count matches), Incomplete (count < expected).
 * Supports "Replace All" (admin) or "Add More" when files already exist.
 *
 * Auto-trigger (server side): When APL status AND Knotenpunkt Status → Done,
 *   server automatically sets OTDR status → "Waiting".
 */

(function () {
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole')  || '';
    const userEmail   = localStorage.getItem('userEmail') || 'Unknown';

    // Auth guard
    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }
    // Access is controlled by backend ACL — no client-side role redirect

    const displayEl = document.getElementById('projectNameDisplay');
    if (displayEl) displayEl.textContent = projectName;

    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Clean an address string for use in folder names.
     * "Laichingen, Zeilerweg 11" → "Zeilerweg-11"
     */
    function cleanAddress(address) {
        if (!address) return 'Unknown';
        let clean = address.trim();
        if (clean.includes(',')) clean = clean.split(',').pop().trim();
        clean = clean.replace(/\s+/g, '-').replace(/,/g, '');
        return clean;
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function getFileExtBadge(name) {
        const ext = (name.split('.').pop() || '').toLowerCase();
        if (ext === 'pdf') return `<span class="file-ext file-ext-pdf">PDF</span>`;
        if (ext === 'sor') return `<span class="file-ext file-ext-sor">SOR</span>`;
        return `<span class="file-ext file-ext-other">${esc(ext.toUpperCase() || '?')}</span>`;
    }

    function getOTDRBadge(status) {
        const s = (status || '').toLowerCase();
        if (s === 'done')       return `<span class="mod-badge mod-badge-done">Done</span>`;
        if (s === 'incomplete') return `<span class="mod-badge mod-badge-incomplete">Incomplete</span>`;
        if (s === 'waiting')    return `<span class="mod-badge mod-badge-waiting">Waiting</span>`;
        return `<span class="mod-badge mod-badge-pending">Pending</span>`;
    }

    function showStatus(type, msg) {
        const el = document.getElementById('otdrUploadStatus');
        if (!el) return;
        el.classList.remove('hidden', 'upload-ok', 'upload-err', 'upload-warn');
        el.classList.add(
            type === 'success' ? 'upload-ok' :
            type === 'warning' ? 'upload-warn' : 'upload-err'
        );
        el.textContent = msg;
    }

    // ─── Custom Address List for OTDR ──────────────────────────────────────────
    // Shows Waiting / Incomplete / Done addresses with OTDR badges + expected file count.

    function renderOTDRAddressList(clusterObj, kn, addresses) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const otdrStatusColId  = nav.statusColId;
        const spliceCountColId = nav.findColumnId('splicing', 'number of splices');

        // Only show addresses where OTDR status is Waiting / Incomplete / Done
        // OTDR is not possible until APL and Knotenpunkt splicing are done
        const filtered = (addresses || []).filter(addr => {
            const status = otdrStatusColId && addr.data ? (addr.data[otdrStatusColId] || '') : '';
            return ['Waiting', 'Incomplete', 'Done'].includes(status);
        });

        if (filtered.length === 0) {
            el.innerHTML = `
                <div class="mod-empty">
                    <svg class="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                    </svg>
                    <p>No OTDR-ready addresses in this Knotenpunkt.</p>
                    <p class="text-xs text-gray-400 mt-2">Addresses appear here after both APL status and Knotenpunkt splicing status are set to "Done" in the Aufmass.</p>
                </div>`;
            return;
        }

        const rows = filtered.map(addr => {
            const status      = otdrStatusColId && addr.data ? (addr.data[otdrStatusColId] || '') : '';
            const spliceCount = spliceCountColId && addr.data ? (parseInt(addr.data[spliceCountColId]) || 0) : 0;
            const expectedFiles = spliceCount * 4;
            const badge       = getOTDRBadge(status);
            const countLabel  = spliceCount > 0
                ? `<span class="addr-file-count">${expectedFiles} exp.</span>`
                : '';

            return `
                <div class="addr-row" data-id="${esc(addr.id)}">
                    <div class="addr-info">
                        <div class="addr-end">${esc(addr.end || addr.id)}</div>
                        <div class="addr-cable">${esc(addr.cableName || '—')}</div>
                    </div>
                    <div class="addr-right">
                        ${badge}
                        ${countLabel}
                        <svg class="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </div>`;
        }).join('');

        el.innerHTML = `<div class="addr-list">${rows}</div>`;

        el.querySelectorAll('.addr-row').forEach(row => {
            row.addEventListener('click', () => {
                const addr = filtered.find(a => a.id === row.dataset.id);
                if (addr) nav._selectAddress(addr);
            });
        });
    }

    // ─── OTDR Form ─────────────────────────────────────────────────────────────

    async function renderOTDRForm(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        // Show loading spinner
        el.innerHTML = `<div class="py-16 flex justify-center text-gray-300">
            <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        </div>`;

        // Resolve columns
        const otdrStatusColId  = nav.statusColId;
        const otdrTypeColId    = nav.typeColId;
        const otdrFileColId    = nav.fileColId;
        const spliceCountColId = nav.findColumnId('splicing', 'number of splices');

        const currentStatus = otdrStatusColId && address.data ? (address.data[otdrStatusColId] || '') : '';
        const spliceCount   = spliceCountColId && address.data ? (parseInt(address.data[spliceCountColId]) || 0) : 0;
        const expectedFiles = spliceCount * 4;
        const addressClean  = cleanAddress(address.end);
        const targetPath    = `${cluster}/OTDR/${knotenpunkt}/${addressClean}`;

        // Fetch existing files from server
        let existingFiles = [];
        try {
            const res  = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(targetPath)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            if (data.success) existingFiles = data.files || [];
        } catch (e) {
            console.warn('Could not fetch existing files:', e);
        }

        renderOTDRFormHTML(el, {
            cluster, knotenpunkt, address, addressClean, targetPath,
            existingFiles, expectedFiles, spliceCount, currentStatus,
            otdrStatusColId, otdrTypeColId, otdrFileColId
        });
    }

    function renderOTDRFormHTML(el, ctx) {
        const {
            cluster, knotenpunkt, address, addressClean, targetPath,
            existingFiles, expectedFiles, spliceCount, currentStatus
        } = ctx;

        const hasExisting = existingFiles.length > 0;

        // Existing files block
        const existingHTML = hasExisting ? `
            <div class="glass-card">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="section-h4 mb-0">Existing Files <span class="text-gray-400 font-normal">(${existingFiles.length})</span></h4>
                    <span class="text-xs text-gray-400">${existingFiles.length}/${expectedFiles > 0 ? expectedFiles : '?'} expected</span>
                </div>
                <div class="file-list-scroll">
                    ${existingFiles.map(f => `
                        <div class="file-list-item">
                            ${getFileExtBadge(f.name)}
                            <span class="truncate flex-1">${esc(f.name)}</span>
                            <span class="text-xs text-gray-400 shrink-0">${formatSize(f.size)}</span>
                        </div>`).join('')}
                </div>
                ${(userRole === 'superadmin') ? `
                <div class="mode-btn-group mt-3">
                    <button type="button" class="mode-btn" id="modeReplaceBtn">🗑 Replace All</button>
                    <button type="button" class="mode-btn active-add" id="modeAddBtn">➕ Add More</button>
                </div>
                <p id="modeLabelTxt" class="text-xs text-gray-400 mt-2">Mode: <strong>Add More</strong> — existing files will be kept</p>
                ` : `
                <p class="text-xs text-gray-500 mt-3 font-semibold">📎 Files already uploaded. Adding new files will append to existing.</p>
                `}
            </div>` : '';

        el.innerHTML = `
            <div class="otdr-form-wrap">

                <!-- Address info card -->
                <div class="glass-card">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">OTDR Upload — ${esc(knotenpunkt)} / ${esc(address.end || address.id)}</h3>
                            <p class="text-xs text-gray-400 mt-1">
                                ${address.cableName ? `Cable: <span class="font-semibold text-gray-600">${esc(address.cableName)}</span>` : ''}
                                ${address.fiberType ? ` &nbsp;|&nbsp; Fibers: <span class="font-semibold text-gray-600">${esc(address.fiberType)}</span>` : ''}
                            </p>
                        </div>
                        ${getOTDRBadge(currentStatus)}
                    </div>
                    <div class="space-y-1">
                        <div class="detail-row">
                            <span class="detail-lbl">Expected files</span>
                            <span class="detail-val">${expectedFiles > 0 ? `${expectedFiles} (${spliceCount} splice${spliceCount !== 1 ? 's' : ''} × 4)` : '—'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-lbl">Target path</span>
                            <span class="detail-val text-gray-400 font-mono text-xs">${esc(targetPath)}/</span>
                        </div>
                    </div>
                </div>

                ${existingHTML}

                <!-- Upload card -->
                <div class="glass-card">
                    <h4 class="section-h4">Upload OTDR Files</h4>
                    <p class="text-xs text-gray-400 mb-3">Accepts <strong>.pdf</strong> and <strong>.sor</strong> files · original filenames kept · multiple files at once</p>

                    <!-- Drop zone -->
                    <div class="drop-zone" id="otdrDropZone">
                        <input type="file" id="otdrFileInput" accept=".pdf,.sor" multiple>
                        <div id="otdrDropInner">
                            <svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            <p class="text-sm font-semibold text-gray-500 mb-1">
                                Drop files here or <button type="button" id="otdrBrowseBtn" class="text-cyan-500 hover:text-cyan-700 transition-colors">browse</button>
                            </p>
                            <p class="text-xs text-gray-400">.pdf and .sor files · max 200 MB each</p>
                        </div>
                    </div>

                    <!-- Selected count + warning -->
                    <div id="otdrCountDisplay" class="hidden count-display count-neutral mt-3"></div>
                    <div id="otdrWarnBanner" class="hidden warn-banner mt-3"></div>

                    <!-- Selected file list -->
                    <div id="otdrSelFileList" class="sel-file-list hidden"></div>

                    <!-- Upload button -->
                    <button id="otdrUploadBtn" class="otdr-upload-btn mt-4" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        Upload Files
                    </button>

                    <div id="otdrUploadStatus" class="hidden upload-status-msg mt-3"></div>
                </div>

            </div>`;

        wireOTDRForm(ctx);
    }

    function wireOTDRForm(ctx) {
        const {
            cluster, knotenpunkt, address, addressClean, targetPath,
            existingFiles, expectedFiles, spliceCount,
            otdrStatusColId, otdrTypeColId, otdrFileColId
        } = ctx;

        const fileInput    = document.getElementById('otdrFileInput');
        const dropZone     = document.getElementById('otdrDropZone');
        const browseBtn    = document.getElementById('otdrBrowseBtn');
        const uploadBtn    = document.getElementById('otdrUploadBtn');
        const countDisplay = document.getElementById('otdrCountDisplay');
        const warnBanner   = document.getElementById('otdrWarnBanner');
        const selFileList  = document.getElementById('otdrSelFileList');

        let selectedFiles = [];
        let uploadMode    = 'add'; // 'add' | 'replace'

        // Mode buttons (admin only)
        const modeReplaceBtn = document.getElementById('modeReplaceBtn');
        const modeAddBtn     = document.getElementById('modeAddBtn');
        const modeLabelTxt   = document.getElementById('modeLabelTxt');

        if (modeReplaceBtn) {
            modeReplaceBtn.addEventListener('click', () => {
                uploadMode = 'replace';
                modeReplaceBtn.classList.add('active-replace');
                modeReplaceBtn.classList.remove('active-add');
                if (modeAddBtn) { modeAddBtn.classList.remove('active-replace', 'active-add'); }
                if (modeLabelTxt) modeLabelTxt.innerHTML = 'Mode: <strong>Replace All</strong> — existing files will be deleted first';
                updateCountDisplay();
            });
        }
        if (modeAddBtn) {
            modeAddBtn.addEventListener('click', () => {
                uploadMode = 'add';
                modeAddBtn.classList.add('active-add');
                modeAddBtn.classList.remove('active-replace');
                if (modeReplaceBtn) { modeReplaceBtn.classList.remove('active-replace', 'active-add'); }
                if (modeLabelTxt) modeLabelTxt.innerHTML = 'Mode: <strong>Add More</strong> — existing files will be kept';
                updateCountDisplay();
            });
        }

        // File selection
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        fileInput.addEventListener('change', () => {
            addFiles(Array.from(fileInput.files || []));
            fileInput.value = '';
        });

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dz-over'); });
        dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dz-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dz-over');
            const files = Array.from(e.dataTransfer.files || []).filter(isOTDRFile);
            if (files.length > 0) addFiles(files);
        });

        function isOTDRFile(f) {
            const name = (f.name || '').toLowerCase();
            return name.endsWith('.pdf') || name.endsWith('.sor');
        }

        function addFiles(files) {
            const valid = files.filter(isOTDRFile);
            // Avoid duplicates by name
            valid.forEach(f => {
                if (!selectedFiles.find(s => s.name === f.name)) selectedFiles.push(f);
            });
            renderSelFileList();
            updateCountDisplay();
        }

        function removeFile(name) {
            selectedFiles = selectedFiles.filter(f => f.name !== name);
            renderSelFileList();
            updateCountDisplay();
        }

        function renderSelFileList() {
            if (!selFileList) return;
            if (selectedFiles.length === 0) {
                selFileList.classList.add('hidden');
                selFileList.innerHTML = '';
                return;
            }
            selFileList.classList.remove('hidden');
            selFileList.innerHTML = selectedFiles.map(f => `
                <div class="sel-file-item">
                    ${getFileExtBadge(f.name)}
                    <span class="truncate flex-1">${esc(f.name)}</span>
                    <span class="text-xs text-gray-400 shrink-0">${formatSize(f.size)}</span>
                    <button type="button" class="remove-sel" data-name="${esc(f.name)}" title="Remove">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>`).join('');
            selFileList.querySelectorAll('.remove-sel').forEach(btn => {
                btn.addEventListener('click', () => removeFile(btn.dataset.name));
            });
        }

        function updateCountDisplay() {
            if (!countDisplay || !warnBanner) return;

            const newCount    = selectedFiles.length;
            // totalAfter depends on mode
            const totalAfter  = uploadMode === 'replace'
                ? newCount
                : existingFiles.length + newCount;

            if (newCount === 0) {
                countDisplay.classList.add('hidden');
                warnBanner.classList.add('hidden');
                uploadBtn.disabled = true;
                return;
            }

            countDisplay.classList.remove('hidden');
            countDisplay.className = 'count-display mt-3 ';

            if (expectedFiles === 0) {
                // No splice count — show neutral
                countDisplay.className += 'count-neutral';
                countDisplay.textContent = `Selected: ${newCount} file${newCount !== 1 ? 's' : ''}`;
                warnBanner.classList.add('hidden');
            } else if (totalAfter === expectedFiles) {
                countDisplay.className += 'count-ok';
                countDisplay.textContent = `✓ Selected: ${newCount} files — total will be ${totalAfter}/${expectedFiles}`;
                warnBanner.classList.add('hidden');
            } else if (totalAfter < expectedFiles) {
                countDisplay.className += 'count-warn';
                countDisplay.textContent = `Selected: ${newCount} files — total will be ${totalAfter}/${expectedFiles}`;
                warnBanner.classList.remove('hidden');
                warnBanner.innerHTML = `
                    <span class="shrink-0">⚠️</span>
                    <span>Expected ${expectedFiles} files but total after upload will be ${totalAfter}. Status will be set to <strong>Incomplete</strong>. Upload anyway?</span>`;
            } else {
                // totalAfter > expectedFiles
                countDisplay.className += 'count-warn';
                countDisplay.textContent = `Selected: ${newCount} files — total will be ${totalAfter} (${totalAfter - expectedFiles} extra)`;
                warnBanner.classList.remove('hidden');
                warnBanner.innerHTML = `
                    <span class="shrink-0">⚠️</span>
                    <span>Total will be ${totalAfter} files, expected ${expectedFiles}. Upload anyway?</span>`;
            }

            uploadBtn.disabled = false;
        }

        uploadBtn.addEventListener('click', () => {
            handleOTDRUpload(ctx, selectedFiles, uploadMode, () => {
                const newCount   = selectedFiles.length;
                const totalAfter = uploadMode === 'replace'
                    ? newCount
                    : existingFiles.length + newCount;
                return totalAfter;
            });
        });
    }

    // ─── Upload Handler ────────────────────────────────────────────────────────

    async function handleOTDRUpload(ctx, selectedFiles, uploadMode, getTotalFn) {
        const {
            cluster, knotenpunkt, address, addressClean, targetPath,
            existingFiles, expectedFiles, spliceCount,
            otdrStatusColId, otdrTypeColId, otdrFileColId
        } = ctx;

        const btn = document.getElementById('otdrUploadBtn');
        if (!btn || selectedFiles.length === 0) return;

        btn.disabled = true;
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Uploading…`;

        try {
            // 1. If replace mode — clear existing files first (admin only)
            if (uploadMode === 'replace' && existingFiles.length > 0) {
                const clearRes  = await fetch(
                    `/api/modules/clear-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(targetPath)}`,
                    {
                        method: 'DELETE',
                        headers: {
                            'x-user-email': userEmail,
                            'x-user-role':  userRole
                        }
                    }
                );
                const clearData = await clearRes.json();
                if (!clearData.success) throw new Error(`Could not clear files: ${clearData.message}`);
            }

            // 2. Upload all selected files (keep original names — no customName)
            const fd = new FormData();
            fd.append('project',    projectName);
            fd.append('targetPath', targetPath);
            for (const file of selectedFiles) {
                fd.append('files', file);
            }

            const uploadRes  = await fetch('/api/modules/upload', {
                method: 'POST',
                headers: { 'x-user-email': userEmail },
                body: fd
            });
            const uploadData = await uploadRes.json();
            if (!uploadData.success) throw new Error(uploadData.message || 'Upload failed');

            const uploadedCount = uploadData.files?.length || selectedFiles.length;

            // 3. Determine total file count and new status
            const totalAfter = uploadMode === 'replace'
                ? uploadedCount
                : existingFiles.length + uploadedCount;

            const newStatus = (expectedFiles > 0 && totalAfter >= expectedFiles) ? 'Done' : 'Incomplete';
            const typeVal   = spliceCount > 0 ? `${spliceCount} splices` : `${totalAfter} files`;
            const fileLocVal = `Doku/${targetPath}`;

            // 4. Update aufmass row
            const updates = {};
            if (otdrStatusColId) updates[otdrStatusColId] = newStatus;
            if (otdrTypeColId)   updates[otdrTypeColId]   = typeVal;
            if (otdrFileColId)   updates[otdrFileColId]   = fileLocVal;

            if (Object.keys(updates).length > 0) {
                const updateRes  = await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates })
                });
                const updateData = await updateRes.json();
                if (!updateData.success) throw new Error(updateData.message || 'Aufmass update failed');
            }

            // 5. Update local cache
            if (address.data) {
                if (otdrStatusColId) address.data[otdrStatusColId] = newStatus;
                if (otdrTypeColId)   address.data[otdrTypeColId]   = typeVal;
                if (otdrFileColId)   address.data[otdrFileColId]   = fileLocVal;
            }

            // 6. Success feedback
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg> Uploaded`;

            const statusMsg = newStatus === 'Done'
                ? `✓ ${uploadedCount} file${uploadedCount !== 1 ? 's' : ''} uploaded — total ${totalAfter}/${expectedFiles}. Status: Done`
                : `✓ ${uploadedCount} file${uploadedCount !== 1 ? 's' : ''} uploaded — total ${totalAfter}${expectedFiles > 0 ? `/${expectedFiles}` : ''}. Status: Incomplete`;

            showStatus(newStatus === 'Done' ? 'success' : 'warning', statusMsg);
            setTimeout(() => nav._selectKnoten(nav.currentKnoten), 2000);

        } catch (e) {
            console.error('OTDR upload error:', e);
            showStatus('error', '✗ ' + e.message);
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
            </svg> Upload Files`;
        }
    }

    // ─── Choice Screen ─────────────────────────────────────────────────────────

    const AH = window.AppointmentHelper;

    // ─── Shared file-list injection helper ─────────────────────────────────────

    async function injectFilesSection(containerEl, listPath, docsPath) {
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
            if (lbl) lbl.textContent = 'View / Re-upload';
            if (desc) desc.textContent = 'View or add more files';
        }

        try {
            const res = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(listPath)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            const files = data.success ? (data.files || []) : [];
            placeholder.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-sm font-bold text-gray-800">Uploaded Files <span class="text-gray-400 font-normal">(${files.length})</span></h4>
                </div>
                ${nav._renderFileListHTML(files, projectName, docsPath)}`;
        } catch (e) {
            placeholder.innerHTML = `<p class="text-xs text-gray-400">Could not load file list.</p>`;
        }
    }

    function renderChoiceScreen(cluster, knotenpunkt, address) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const addrDisplay = address.end || address.start || address.id;
        const terminColId = nav.findColumnId('otdr', 'otdr-termin');
        const termin = terminColId && address.data ? AH.parseTermin(address.data[terminColId]) : null;
        const otdrStatusColId = nav.statusColId;
        const currentStatus = otdrStatusColId && address.data ? (address.data[otdrStatusColId] || '') : '';
        const isDone = currentStatus.toLowerCase() === 'done';

        el.innerHTML = `
            <div class="otdr-form-wrap">
                <div class="glass-card">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">${esc(knotenpunkt)} / ${esc(addrDisplay)}</h3>
                            <p class="text-xs text-gray-400 mt-1">
                                ${address.cableName ? `Cable: <span class="font-semibold text-gray-600">${esc(address.cableName)}</span>` : ''}
                                ${address.fiberType ? ` · Fibers: <span class="font-semibold text-gray-600">${esc(address.fiberType)}</span>` : ''}
                            </p>
                        </div>
                        ${getOTDRBadge(currentStatus)}
                    </div>
                </div>
                ${AH.terminInfoHTML(termin)}
                ${AH.choiceButtonsHTML(isDone, termin)}
            </div>`;

        const appointBtn = document.getElementById('btnAppointment') || document.getElementById('btnEditAppointment');
        if (appointBtn) {
            appointBtn.addEventListener('click', () => {
                AH.renderAppointmentForm({
                    el, existingTermin: termin, knotenpunkt, addrDisplay,
                    nav, projectName, userEmail, address, terminColId, moduleKey: 'otdr',
                    onDone: () => renderChoiceScreen(cluster, knotenpunkt, address)
                });
            });
        }

        if (isDone) {
            const addressClean = cleanAddress(address.end);
            const targetPath = `${cluster}/OTDR/${knotenpunkt}/${addressClean}`;
            const docsPath = `Doku/${targetPath}`;
            injectFilesSection(el, targetPath, docsPath);
        }

        document.getElementById('btnUpload')?.addEventListener('click', () => {
            renderOTDRForm(cluster, knotenpunkt, address);
        });
    }

    // ─── Custom Address List with Termin ────────────────────────────────────────

    function renderOTDRAddressListWithTermin(clusterObj, kn, addresses) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const otdrStatusColId  = nav.statusColId;
        const spliceCountColId = nav.findColumnId('splicing', 'number of splices');
        const terminColId      = nav.findColumnId('otdr', 'otdr-termin');

        const filtered = (addresses || []).filter(addr => {
            const status = otdrStatusColId && addr.data ? (addr.data[otdrStatusColId] || '') : '';
            return ['Waiting', 'Incomplete', 'Done'].includes(status);
        });

        if (filtered.length === 0) {
            el.innerHTML = `
                <div class="mod-empty">
                    <svg class="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                    </svg>
                    <p>No OTDR-ready addresses in this Knotenpunkt.</p>
                    <p class="text-xs text-gray-400 mt-2">Addresses appear here after both APL status and Knotenpunkt splicing status are set to "Done" in the Aufmass.</p>
                </div>`;
            return;
        }

        const sorted = AH.sortByTermin(filtered, terminColId);

        const rows = sorted.map(addr => {
            const status = otdrStatusColId && addr.data ? (addr.data[otdrStatusColId] || '') : '';
            const spliceCount = spliceCountColId && addr.data ? (parseInt(addr.data[spliceCountColId]) || 0) : 0;
            const expectedFiles = spliceCount * 4;
            const badge = getOTDRBadge(status);
            const countLabel = spliceCount > 0 ? `<span class="addr-file-count">${expectedFiles} exp.</span>` : '';
            const termin = terminColId ? AH.parseTermin(addr.data?.[terminColId]) : null;

            return `
                <div class="addr-row" data-id="${esc(addr.id)}">
                    <div class="addr-info">
                        <div class="addr-end">${esc(addr.end || addr.id)}</div>
                        <div class="addr-cable">${esc(addr.cableName || '—')}</div>
                        ${AH.terminBadgeHTML(termin)}
                    </div>
                    <div class="addr-right">
                        ${badge}
                        ${countLabel}
                        <svg class="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </div>`;
        }).join('');

        el.innerHTML = `<div class="addr-list">${rows}</div>`;

        el.querySelectorAll('.addr-row').forEach(row => {
            row.addEventListener('click', () => {
                const addr = sorted.find(a => a.id === row.dataset.id);
                if (addr) {
                    nav.currentAddress = addr;
                    nav.updateBreadcrumb([clusterObj.name, kn.name, addr.end || addr.id]);
                    renderChoiceScreen(clusterObj.name, kn.name, addr);
                }
            });
        });
    }

    // ─── Boot Navigator ────────────────────────────────────────────────────────

    const nav = new ModuleNavigator({
        project:          projectName,
        moduleName:       'OTDR',
        moduleKey:        'otdr',
        groupLabel:       'otdr',
        customUploadForm: true,
        onAddressSelected: (cluster, knotenpunkt, address) => {
            renderChoiceScreen(cluster, knotenpunkt, address);
        },
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        }
    });

    // Override renderAddresses to show OTDR-specific badges + filtering + termin
    nav.renderAddresses = function (clusterObj, kn, addresses) {
        renderOTDRAddressListWithTermin(clusterObj, kn, addresses);
    };

    nav.init().catch(err => console.error('OTDR init error:', err));
})();
