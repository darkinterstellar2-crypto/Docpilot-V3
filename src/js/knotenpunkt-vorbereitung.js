/**
 * knotenpunkt-vorbereitung.js — MERGED MODULE
 * NVT Preparation + Splicing
 *
 * Navigation: Cluster → Knotenpunkt → Combined screen
 * Combined screen:
 *   Section 1 — NVT Preparation: multi-image upload (original filenames)
 *   Section 2 — Splicing: address list with status badges → per-address splice upload
 *
 * Target path (both sections): [Cluster]/Knotenpunkt_Vorbereitung/[Knotenpunkt]/
 * Splice filename: [Knotenpunkt]_[AddressClean]_Splices_[YYYYMMDD_HHmmss].[ext]
 * Splice updates aufmass: Knotenpunkt Status → "Done", Knotenpunkt image location → path
 */

(function () {
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole');
    const userEmail   = localStorage.getItem('userEmail') || 'Unknown';

    // Auth guard
    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }

    // Update header
    const displayEl = document.getElementById('projectNameDisplay');
    if (displayEl) displayEl.textContent = projectName;

    // Back button → project dashboard
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    // ─── State ─────────────────────────────────────────────────────────────────

    let selectedNVTFiles = [];      // files staged for NVT upload

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /** Clean an address string for use in filenames.
     *  "Laichingen, Zeilerweg 11" → "Zeilerweg-11" */
    function cleanAddress(address) {
        if (!address) return 'Unknown';
        let clean = address.trim();
        if (clean.includes(',')) clean = clean.split(',').pop().trim();
        clean = clean.replace(/\s+/g, '-').replace(/,/g, '');
        return clean;
    }

    /** Returns current datetime as "YYYYMMDD_HHmmss" */
    function formatDateTime() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    function showNVTStatus(type, msg) {
        const el = document.getElementById('kvUploadStatus');
        if (!el) return;
        el.classList.remove('hidden', 'upload-ok', 'upload-err');
        el.classList.add(type === 'success' ? 'upload-ok' : 'upload-err');
        el.textContent = msg;
    }

    function showSpliceStatus(type, msg) {
        const el = document.getElementById('spliceUploadStatus');
        if (!el) return;
        el.classList.remove('hidden', 'upload-ok', 'upload-err');
        el.classList.add(type === 'success' ? 'upload-ok' : 'upload-err');
        el.textContent = msg;
    }

    // ─── Combined Screen ────────────────────────────────────────────────────────

    function renderKnotenpunktScreen(cluster, knotenpunkt) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const targetPath = `${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}`;
        const docsPath   = `Doku/${targetPath}`;

        // Column IDs for splicing
        const knStatusColId = nav.findColumnId('splicing', 'knotenpunkt status');
        const knImageColId  = nav.findColumnId('splicing', 'knotenpunkt image location');

        // Build address rows
        const addresses = nav.currentKnoten ? (nav.currentKnoten.addresses || []) : [];
        const addrRows  = buildAddressRows(addresses, knStatusColId, knImageColId);

        // Count existing NVT files for the badge
        let nvtFileCount = 0;

        el.innerHTML = `
            <div class="kv-form-wrap">

                <!-- NVT header card -->
                <div class="glass-card">
                    <h3 class="text-base font-bold text-gray-900">${esc(knotenpunkt)}</h3>
                    <p class="text-xs text-gray-400 mt-1">
                        Path: <code class="font-mono text-gray-500">${esc(targetPath)}/</code>
                    </p>
                </div>

                <!-- Upload for NVT button -->
                <button id="nvtUploadBtn" class="glass-card" style="width:100%; cursor:pointer; display:flex; align-items:center; gap:12px; border:1.5px dashed #d1d5db; transition:all 0.2s; text-align:left;">
                    <div style="width:40px;height:40px;border-radius:12px;background:#fef3c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <svg style="width:20px;height:20px;color:#d97706;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div class="text-sm font-semibold text-gray-900">Upload for NVT</div>
                        <div class="text-xs text-gray-400" id="nvtFileCountLabel">Loading files…</div>
                    </div>
                    <svg style="width:16px;height:16px;color:#9ca3af;flex-shrink:0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                    </svg>
                </button>

                <!-- ── Splicing addresses ── -->
                <div class="section-label" style="margin-top:8px;">
                    <svg class="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                    </svg>
                    Splicing — Addresses
                </div>

                ${addresses.length === 0
                    ? `<div class="glass-card"><p class="text-sm text-gray-400">No addresses found for this Knotenpunkt.</p></div>`
                    : `<div class="addr-list">${addrRows}</div>`
                }

            </div>`;

        // NVT upload button → navigate to NVT upload form
        document.getElementById('nvtUploadBtn').addEventListener('click', () => {
            renderNVTUploadForm(cluster, knotenpunkt, targetPath, docsPath);
        });
        // Hover effect
        const nvtBtn = document.getElementById('nvtUploadBtn');
        nvtBtn.addEventListener('mouseenter', () => { nvtBtn.style.borderColor = '#d97706'; nvtBtn.style.background = '#fffbeb'; });
        nvtBtn.addEventListener('mouseleave', () => { nvtBtn.style.borderColor = '#d1d5db'; nvtBtn.style.background = ''; });

        // Wire address clicks
        el.querySelectorAll('.addr-row').forEach(row => {
            row.addEventListener('click', () => {
                const addr = addresses.find(a => a.id === row.dataset.id);
                if (addr) openSpliceForm(cluster, knotenpunkt, addr, knStatusColId, knImageColId);
            });
        });

        // Load NVT file count for the badge
        (async () => {
            try {
                const res = await fetch(`/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(targetPath)}`, {
                    headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
                });
                const data = await res.json();
                const label = document.getElementById('nvtFileCountLabel');
                if (data.success && data.files && data.files.length > 0) {
                    nvtFileCount = data.files.length;
                    if (label) label.textContent = `${data.files.length} file${data.files.length !== 1 ? 's' : ''} uploaded`;
                } else {
                    if (label) label.textContent = 'No files uploaded yet';
                }
            } catch (_) {
                const label = document.getElementById('nvtFileCountLabel');
                if (label) label.textContent = 'Upload NVT preparation images';
            }
        })();
    }

    // ─── NVT Upload Form (separate screen) ─────────────────────────────────

    function renderNVTUploadForm(cluster, knotenpunkt, targetPath, docsPath) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        selectedNVTFiles = [];

        el.innerHTML = `
            <div class="kv-form-wrap">

                <div class="glass-card">
                    <h3 class="text-base font-bold text-gray-900">NVT Preparation — ${esc(knotenpunkt)}</h3>
                    <p class="text-xs text-gray-400 mt-1">
                        Target: <code class="font-mono text-gray-500">${esc(targetPath)}/</code>
                    </p>
                    <p class="text-xs text-gray-400 mt-0.5">Original filenames are preserved.</p>
                </div>

                <!-- Existing NVT files -->
                <div id="nvtExistingFiles" class="glass-card">
                    <div style="display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:13px;">
                        <svg class="w-4 h-4 animate-spin" style="width:16px;height:16px;flex-shrink:0;" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg> Loading existing files…
                    </div>
                </div>

                <!-- NVT Upload card -->
                <div class="glass-card">
                    <h4 class="text-sm font-bold text-gray-700 mb-3">Upload NVT Images</h4>

                    <div class="kv-drop-zone" id="kvDropZone">
                        <input type="file" id="kvFileInput" accept="image/*" multiple class="hidden">
                        <div id="kvDropInner">
                            <svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <p class="text-sm font-semibold text-gray-500 mb-1">
                                Drop images here or
                                <button type="button" id="kvBrowseBtn" class="text-indigo-500 hover:text-indigo-700 transition-colors">browse</button>
                            </p>
                            <p class="text-xs text-gray-400">Any number of images · JPG, PNG · max 200 MB each</p>
                        </div>
                    </div>

                    <div id="kvThumbnails" class="kv-thumbnails hidden"></div>

                    <button id="kvAddMoreBtn" class="add-extra-btn mt-3 hidden" type="button">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                        </svg>
                        Add more images
                    </button>

                    <button id="kvUploadBtn" class="kv-upload-btn mt-4" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        Upload <span id="kvFileCount"></span>
                    </button>

                    <div id="kvUploadStatus" class="hidden upload-status-msg mt-3"></div>
                </div>

                <div class="flex gap-3">
                    <button id="nvtBackBtn" class="btn-secondary flex-1">Back</button>
                </div>

            </div>`;

        // Back button → return to knotenpunkt screen
        document.getElementById('nvtBackBtn').addEventListener('click', () => {
            renderKnotenpunktScreen(cluster, knotenpunkt);
        });

        // Wire NVT upload form
        wireNVTForm(cluster, knotenpunkt, targetPath);

        // Load existing NVT files
        loadNVTExistingFiles(targetPath, docsPath);
    }

    function buildAddressRows(addresses, knStatusColId, knImageColId) {
        return addresses.map(addr => {
            const status    = (knStatusColId && addr.data) ? (addr.data[knStatusColId] || '') : '';
            const isDone    = status.toLowerCase() === 'done';
            const imageInfo = (isDone && knImageColId && addr.data) ? (addr.data[knImageColId] || '') : '';
            const badge     = isDone
                ? `<span class="mod-badge mod-badge-done">Done</span>`
                : `<span class="mod-badge mod-badge-pending">Pending</span>`;
            const imageBlock = (isDone && imageInfo)
                ? `<div class="addr-image-info">📄 ${esc(imageInfo)}</div>`
                : '';
            return `
                <div class="addr-row" data-id="${esc(addr.id)}">
                    <div class="addr-info">
                        <div class="addr-end">${esc(addr.end || addr.id)}</div>
                        <div class="addr-cable">${esc(addr.cableName || '—')}</div>
                        ${imageBlock}
                    </div>
                    <div class="addr-right">
                        ${badge}
                        <svg class="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </div>`;
        }).join('');
    }

    async function loadNVTExistingFiles(targetPath, docsPath) {
        const container = document.getElementById('nvtExistingFiles');
        if (!container) return;
        try {
            const res  = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(targetPath)}`,
                { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
            );
            const data = await res.json();
            const files = data.success ? (data.files || []) : [];

            if (files.length === 0) {
                container.innerHTML = `<p class="text-xs text-gray-400 italic">No NVT files uploaded yet.</p>`;
                return;
            }

            container.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-sm font-bold text-gray-800">NVT Files <span class="text-gray-400 font-normal">(${files.length})</span></h4>
                </div>
                ${nav._renderFileListHTML(files, projectName, docsPath)}`;
        } catch (e) {
            container.innerHTML = `<p class="text-xs text-gray-400">Could not load file list.</p>`;
        }
    }

    // ─── NVT Upload (multi-image) ───────────────────────────────────────────────

    function renderNVTThumbnails() {
        const container  = document.getElementById('kvThumbnails');
        const addMoreBtn = document.getElementById('kvAddMoreBtn');
        const uploadBtn  = document.getElementById('kvUploadBtn');
        const countEl    = document.getElementById('kvFileCount');

        if (!container) return;

        if (selectedNVTFiles.length === 0) {
            container.classList.add('hidden');
            if (addMoreBtn) addMoreBtn.classList.add('hidden');
            if (uploadBtn)  uploadBtn.disabled = true;
            if (countEl)    countEl.textContent = '';
            return;
        }

        container.classList.remove('hidden');
        if (addMoreBtn) addMoreBtn.classList.remove('hidden');
        if (uploadBtn)  uploadBtn.disabled = false;
        if (countEl)    countEl.textContent = `(${selectedNVTFiles.length} image${selectedNVTFiles.length !== 1 ? 's' : ''})`;

        container.innerHTML = selectedNVTFiles.map((f, i) => `
            <div class="kv-thumb" data-index="${i}">
                <img class="kv-thumb-img" id="kvThumb-${i}" alt="${esc(f.name)}">
                <button type="button" class="kv-thumb-remove" data-index="${i}" title="Remove">✕</button>
                <div class="kv-thumb-name">${esc(f.name.length > 16 ? f.name.slice(0, 13) + '…' : f.name)}</div>
            </div>`).join('');

        selectedNVTFiles.forEach((f, i) => {
            const img = document.getElementById(`kvThumb-${i}`);
            if (!img) return;
            const reader = new FileReader();
            reader.onload = (e) => { img.src = e.target.result; };
            reader.readAsDataURL(f);
        });

        container.querySelectorAll('.kv-thumb-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index, 10);
                selectedNVTFiles.splice(idx, 1);
                renderNVTThumbnails();
            });
        });
    }

    function addNVTFiles(newFiles) {
        for (const f of newFiles) {
            if (f.type.startsWith('image/')) selectedNVTFiles.push(f);
        }
        renderNVTThumbnails();
    }

    function wireNVTForm(cluster, knotenpunkt, targetPath) {
        const fileInput  = document.getElementById('kvFileInput');
        const dropZone   = document.getElementById('kvDropZone');
        const browseBtn  = document.getElementById('kvBrowseBtn');
        const addMoreBtn = document.getElementById('kvAddMoreBtn');
        const uploadBtn  = document.getElementById('kvUploadBtn');

        if (!fileInput || !dropZone || !browseBtn || !uploadBtn) return;

        browseBtn.addEventListener('click',   () => fileInput.click());
        addMoreBtn?.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            addNVTFiles(Array.from(e.target.files || []));
            e.target.value = '';
        });

        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dz-over'); });
        dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dz-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dz-over');
            addNVTFiles(Array.from(e.dataTransfer.files));
        });

        uploadBtn.addEventListener('click', () => handleNVTUpload(cluster, knotenpunkt, targetPath));
    }

    async function handleNVTUpload(cluster, knotenpunkt, targetPath) {
        if (selectedNVTFiles.length === 0) return;
        const btn = document.getElementById('kvUploadBtn');

        btn.disabled = true;
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Uploading…`;

        try {
            const fd = new FormData();
            fd.append('project',    projectName);
            fd.append('targetPath', targetPath);
            for (const file of selectedNVTFiles) {
                fd.append('files', file);
            }

            const res  = await fetch('/api/modules/upload', {
                method: 'POST',
                headers: { 'x-user-email': userEmail },
                body: fd
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Upload failed');

            const count = data.files?.length || selectedNVTFiles.length;

            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg> Uploaded`;
            showNVTStatus('success', `✓ ${count} image${count !== 1 ? 's' : ''} uploaded successfully!`);

            // Reload existing files after upload
            setTimeout(() => {
                selectedNVTFiles = [];
                renderNVTThumbnails();
                btn.disabled = true;
                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg> Upload <span id="kvFileCount"></span>`;
                const statusEl = document.getElementById('kvUploadStatus');
                if (statusEl) statusEl.classList.add('hidden');
                // Refresh existing files panel
                const docsPath = `Doku/${targetPath}`;
                loadNVTExistingFiles(targetPath, docsPath);
            }, 2500);

        } catch (e) {
            console.error('NVT upload error:', e);
            showNVTStatus('error', '✗ ' + e.message);
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
            </svg> Upload`;
        }
    }

    // ─── Splice Form ────────────────────────────────────────────────────────────

    function openSpliceForm(cluster, knotenpunkt, address, knStatusColId, knImageColId) {
        // Update breadcrumb to show address level
        nav.updateBreadcrumb([cluster, knotenpunkt, address.end || address.id]);
        renderSpliceForm(cluster, knotenpunkt, address, knStatusColId, knImageColId);
    }

    function renderSpliceForm(cluster, knotenpunkt, address, knStatusColId, knImageColId) {
        const el = document.getElementById('moduleContent');
        if (!el) return;

        const status     = (knStatusColId && address.data) ? (address.data[knStatusColId] || '') : '';
        const isDone     = status.toLowerCase() === 'done';
        const addrClean  = cleanAddress(address.end);
        const targetPath = `${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}`;
        const docsPath   = `Doku/${targetPath}`;

        const existingBlock = isDone ? `<div id="splicingExistingFiles" class="glass-card">
                <div style="display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:13px;">
                    <svg class="w-4 h-4 animate-spin" style="width:16px;height:16px;flex-shrink:0;" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg> Loading uploaded files…
                </div>
            </div>` : '';

        el.innerHTML = `
            <div class="splice-form-wrap">

                <!-- Address info card -->
                <div class="glass-card">
                    <div class="flex items-start justify-between gap-3 mb-2">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">Splicing — ${esc(knotenpunkt)} / ${esc(address.end || address.id)}</h3>
                            <p class="text-xs text-gray-400 mt-1">
                                ${address.cableName ? `Cable: <span class="font-semibold text-gray-600">${esc(address.cableName)}</span>` : ''}
                            </p>
                        </div>
                        <div>
                            ${isDone
                                ? `<span class="mod-badge mod-badge-done">Done</span>`
                                : `<span class="mod-badge mod-badge-pending">Pending</span>`}
                        </div>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">
                        Target: <code class="font-mono text-gray-500">${esc(targetPath)}/</code>
                    </p>
                    <p class="text-xs text-gray-400 mt-0.5">
                        Filename: <code class="font-mono text-gray-500">${esc(knotenpunkt)}_${esc(addrClean)}_Splices_[datetime].[ext]</code>
                    </p>
                </div>

                ${existingBlock}

                <!-- Upload card -->
                <div class="glass-card">
                    <h4 class="text-sm font-bold text-gray-700 mb-3">Splice Image</h4>

                    <div class="drop-zone" id="spliceDropZone">
                        <input type="file" id="spliceFileInput" accept="image/*" class="hidden">
                        <div id="spliceDropInner">
                            <svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <p class="text-sm font-semibold text-gray-500 mb-1">
                                Drop image here or <button type="button" id="spliceBrowseBtn" class="text-indigo-500 hover:text-indigo-700 transition-colors underline-offset-2">browse</button>
                            </p>
                            <p class="text-xs text-gray-400">JPG, PNG · max 200 MB</p>
                        </div>
                        <div id="spliceSelectedInfo" class="hidden sel-file-info">
                            <img id="splicePreview" class="splice-preview" alt="preview">
                            <span id="spliceSelectedName" class="flex-1 text-sm font-semibold text-gray-800 truncate min-w-0"></span>
                            <button type="button" id="spliceRemoveBtn" class="text-gray-400 hover:text-red-500 transition-colors ml-2 shrink-0" title="Remove">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button id="spliceUploadBtn" class="splice-upload-btn mt-4" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        Upload Splice Image
                    </button>

                    <div id="spliceUploadStatus" class="hidden upload-status-msg mt-3"></div>
                </div>
            </div>`;

        wireSpliceForm(cluster, knotenpunkt, address, knStatusColId, knImageColId);

        // If done, load existing files
        if (isDone) {
            (async () => {
                const container = document.getElementById('splicingExistingFiles');
                if (!container) return;
                try {
                    const res  = await fetch(
                        `/api/modules/list-files?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(targetPath)}`,
                        { headers: { 'x-user-email': userEmail, 'x-user-role': userRole } }
                    );
                    const data = await res.json();
                    const files = data.success ? (data.files || []) : [];
                    container.innerHTML = `
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-sm font-bold text-gray-800">Uploaded Files <span class="text-gray-400 font-normal">(${files.length})</span></h4>
                        </div>
                        ${nav._renderFileListHTML(files, projectName, docsPath)}`;
                } catch (e) {
                    container.innerHTML = `<p class="text-xs text-gray-400">Could not load file list.</p>`;
                }
            })();
        }
    }

    function wireSpliceForm(cluster, knotenpunkt, address, knStatusColId, knImageColId) {
        const fileInput  = document.getElementById('spliceFileInput');
        const dropZone   = document.getElementById('spliceDropZone');
        const browseBtn  = document.getElementById('spliceBrowseBtn');
        const removeBtn  = document.getElementById('spliceRemoveBtn');
        const uploadBtn  = document.getElementById('spliceUploadBtn');
        const preview    = document.getElementById('splicePreview');
        let selectedFile = null;

        const setFile = (f) => {
            selectedFile = f;
            document.getElementById('spliceDropInner').classList.add('hidden');
            document.getElementById('spliceSelectedInfo').classList.remove('hidden');
            document.getElementById('spliceSelectedName').textContent = f.name;
            const reader = new FileReader();
            reader.onload = (e) => { preview.src = e.target.result; };
            reader.readAsDataURL(f);
            uploadBtn.disabled = false;
        };

        const clearFile = () => {
            selectedFile = null;
            fileInput.value = '';
            document.getElementById('spliceSelectedInfo').classList.add('hidden');
            document.getElementById('spliceDropInner').classList.remove('hidden');
            preview.src = '';
            uploadBtn.disabled = true;
        };

        browseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => { if (e.target.files[0]) setFile(e.target.files[0]); });
        removeBtn.addEventListener('click', clearFile);

        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dz-over'); });
        dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dz-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dz-over');
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('image/')) {
                setFile(f);
            } else if (f) {
                showSpliceStatus('error', 'Only image files are accepted.');
            }
        });

        uploadBtn.addEventListener('click', () => {
            if (selectedFile) handleSplicingUpload(cluster, knotenpunkt, address, knStatusColId, knImageColId, selectedFile);
        });
    }

    // ─── Splice Upload Handler ──────────────────────────────────────────────────

    async function handleSplicingUpload(cluster, knotenpunkt, address, knStatusColId, knImageColId, file) {
        const btn        = document.getElementById('spliceUploadBtn');
        const addrClean  = cleanAddress(address.end);
        const now        = formatDateTime();
        const ext        = file.name.split('.').pop().toLowerCase();
        const customName = `${knotenpunkt}_${addrClean}_Splices_${now}.${ext}`;
        const targetPath = `${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}`;

        btn.disabled = true;
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Uploading…`;

        try {
            // 1. Upload file
            const fd = new FormData();
            fd.append('project',    projectName);
            fd.append('targetPath', targetPath);
            fd.append('customName', customName);
            fd.append('files',      file);

            const uploadRes  = await fetch('/api/modules/upload', {
                method: 'POST',
                headers: { 'x-user-email': userEmail },
                body: fd
            });
            const uploadData = await uploadRes.json();
            if (!uploadData.success) throw new Error(uploadData.message || 'Upload failed');

            const filePath = uploadData.files?.[0]?.path || `Doku/${targetPath}/${customName}`;

            // 2. Update aufmass
            const updates = {};
            if (knStatusColId) updates[knStatusColId] = 'Done';
            if (knImageColId)  updates[knImageColId]  = filePath;

            if (Object.keys(updates).length > 0) {
                const updateRes  = await fetch('/api/modules/aufmass-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
                    body: JSON.stringify({ project: projectName, rowId: address.id, updates })
                });
                const updateData = await updateRes.json();
                if (!updateData.success) throw new Error(updateData.message || 'Aufmass update failed');
            }

            // 3. Update local address cache so badge refreshes on back-nav
            if (address.data) {
                if (knStatusColId) address.data[knStatusColId] = 'Done';
                if (knImageColId)  address.data[knImageColId]  = filePath;
            }

            // 4. Success — navigate back to knotenpunkt combined screen
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg> Uploaded`;
            showSpliceStatus('success', '✓ Splice image uploaded — returning…');
            setTimeout(() => nav._selectKnoten(nav.currentKnoten), 1800);

        } catch (e) {
            console.error('Splice upload error:', e);
            showSpliceStatus('error', '✗ ' + e.message);
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
            </svg> Upload Splice Image`;
        }
    }

    // ─── Boot Navigator ────────────────────────────────────────────────────────

    const nav = new ModuleNavigator({
        project:               projectName,
        moduleName:            'NVT & Splicing',
        moduleKey:             'knotenpunkt',
        skipAddressStep:       true,
        customUploadForm:      true,
        onKnotenpunktSelected: (cluster, knotenpunkt) => {
            renderKnotenpunktScreen(cluster, knotenpunkt);
        },
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        }
    });

    nav.init().catch(err => console.error('NVT & Splicing init error:', err));
})();
