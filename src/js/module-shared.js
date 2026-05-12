/**
 * module-shared.js — Shared ModuleNavigator class
 *
 * Used by druckprufung.js, einblasen.js, kalibrieren.js and future module pages.
 * Handles: cluster → knotenpunkt → address navigation, status display,
 *          PDF upload, and aufmass row updates.
 *
 * Supports optional `extraFields` config for modules that need additional
 * form inputs (e.g. Einblasen's "Metrierung total"), including cross-group
 * column updates via `alsoCopyTo`.
 */

// Inject shared file-list styles once (used by _renderFilesViewAsync and custom module file views)
(function injectModuleSharedStyles() {
    if (document.getElementById('module-shared-styles')) return;
    const style = document.createElement('style');
    style.id = 'module-shared-styles';
    style.textContent = `
        .existing-files-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .existing-file-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            min-width: 0;
        }
        .file-thumb-wrap {
            flex-shrink: 0;
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            overflow: hidden;
            background: #f3f4f6;
        }
        .file-thumb-sm {
            width: 44px;
            height: 44px;
            object-fit: cover;
            border-radius: 8px;
        }
        .file-icon-badge {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.02em;
            padding: 4px 5px;
            border-radius: 6px;
            background: #e5e7eb;
            color: #4b5563;
        }
        .file-name-wrap {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .file-name-text {
            font-size: 12px;
            font-weight: 600;
            color: #111827;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-size-text {
            font-size: 11px;
            color: #9ca3af;
        }
        .file-dl-btn {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            color: #6366f1;
            background: #eef2ff;
            text-decoration: none;
            border: none;
            cursor: pointer;
            padding: 0;
            transition: background 0.15s, color 0.15s;
        }
        .file-dl-btn:hover {
            background: #6366f1;
            color: #fff;
        }
        .glass-card {
            background: rgba(255,255,255,0.97);
            border: 1px solid #e5e7eb;
            border-radius: 16px;
            padding: 18px 20px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        }
    `;
    document.head.appendChild(style);
})();

class ModuleNavigator {
    constructor(config) {
        this.project         = config.project;
        this.moduleName      = config.moduleName;      // "Druckprüfung"
        this.targetFolder    = config.targetFolder;    // "Druckprufung" or "kalibrieren"
        // groupLabel is used to locate the right schema group.
        // Falls back to statusColLabel for backwards-compat with the spec example.
        this.groupLabel      = config.groupLabel || config.statusColLabel || '';
        this.typeOptions     = config.typeOptions || ['12x10', '4x20', 'custom'];
        this.useOriginalFilename = config.useOriginalFilename || false;
        this.filenamePattern = config.filenamePattern
            || ((addr, type) => `${addr.cableName}_${this.moduleName}_${type}.pdf`);
        this.containers      = config.containers || {};       // { content, breadcrumb }
        this.onUploadComplete = config.onUploadComplete || null;

        // Custom upload form support (e.g. APL, Splicing, OTDR)
        // When true, renderUploadForm is skipped and onAddressSelected is called instead.
        this.customUploadForm  = config.customUploadForm  || false;
        this.onAddressSelected = config.onAddressSelected || null;

        // Optional filter function for the address list.
        // If provided, only addresses where addressFilter(addr) returns true are shown.
        this.addressFilter = config.addressFilter || null;

        // skipAddressStep: when true, clicking a knotenpunkt skips the address list
        // and goes directly to the upload form / onKnotenpunktSelected callback.
        // Used by modules that operate at the knotenpunkt level (e.g. Knotenpunkt Vorbereitung).
        this.skipAddressStep      = config.skipAddressStep      || false;
        this.onKnotenpunktSelected = config.onKnotenpunktSelected || null;

        // Extra form fields (e.g. Metrierung total for Einblasen)
        this.extraFields = config.extraFields || [];

        /**
         * ACL module key — must match the key used in access-control.json
         * (e.g. 'druckprufung', 'einblasen', 'kalibrieren', 'apl', 'splicing',
         *  'knotenpunkt', 'otdr').  Defaults to 'aufmass' if not provided.
         */
        this.moduleKey = (config.moduleKey || 'aufmass').toLowerCase();

        // Resolved from schema after init()
        this.schema      = null;
        this.clusters    = null;
        this.statusColId = null;
        this.typeColId   = null;
        this.fileColId   = null;

        // Navigation state
        this.currentCluster = null;
        this.currentKnoten  = null;
        this.currentAddress = null;

        this._userEmail = localStorage.getItem('userEmail') || 'Unknown';
        this._userRole  = localStorage.getItem('userRole')  || '';
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    async init() {
        const el = this.containers.content;
        if (el) el.innerHTML = this._loadingHTML();
        try {
            const res  = await fetch(
                `/api/modules/navigation?project=${encodeURIComponent(this.project)}&module=${encodeURIComponent(this.moduleKey)}`,
                {
                    headers: {
                        'x-user-email': this._userEmail,
                        'x-user-role':  this._userRole,
                    }
                }
            );
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Failed to load navigation');
            this.clusters = data.clusters;
            this.schema   = data.schema;
            this._resolveColumnIds();
            this.renderClusters(this.clusters);
            this.updateBreadcrumb([]);

            // ── Deep-link: auto-navigate when URL contains cluster/knotenpunkt/address params ──
            const _dlParams  = new URLSearchParams(window.location.search);
            const _dlCluster = _dlParams.get('cluster');
            const _dlKnoten  = _dlParams.get('knotenpunkt');
            const _dlAddress = _dlParams.get('address');

            if (_dlCluster) {
                const matchCluster = this.clusters.find(c =>
                    c.name.toLowerCase() === _dlCluster.toLowerCase()
                );
                if (matchCluster) {
                    this._selectCluster(matchCluster);

                    if (_dlKnoten) {
                        const matchKnoten = matchCluster.knotenpunkte.find(k =>
                            k.name.toLowerCase() === _dlKnoten.toLowerCase()
                        );
                        if (matchKnoten) {
                            this._selectKnoten(matchKnoten);

                            if (_dlAddress && !this.skipAddressStep) {
                                const normalize = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
                                const needle    = normalize(_dlAddress);
                                const matchAddr = matchKnoten.addresses.find(a =>
                                    normalize(a.start) === needle
                                );
                                if (matchAddr) {
                                    this._selectAddress(matchAddr);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            if (el) el.innerHTML = `<div class="mod-error">⚠ ${this._esc(e.message)}</div>`;
        }
    }

    renderClusters(clusters) {
        const el = this.containers.content;
        if (!el) return;
        if (!clusters || clusters.length === 0) {
            el.innerHTML = `<div class="mod-empty">${this._emptyIcon()}<p>No clusters found</p></div>`;
            return;
        }
        el.innerHTML = `<div class="mod-grid">
            ${clusters.map(c => `
                <div class="mod-card" data-cluster="${this._esc(c.name)}">
                    <div class="mod-card-icon">${this._folderIcon()}</div>
                    <span class="mod-card-name">${this._esc(c.name)}</span>
                    <span class="mod-card-meta">${c.knotenpunkte.length} Knotenpunkt${c.knotenpunkte.length !== 1 ? 'e' : ''}</span>
                </div>`).join('')}
        </div>`;
        el.querySelectorAll('.mod-card[data-cluster]').forEach(card => {
            card.addEventListener('click', () => {
                const cluster = this.clusters.find(c => c.name === card.dataset.cluster);
                if (cluster) this._selectCluster(cluster);
            });
        });
    }

    renderKnotenpunkte(cluster) {
        const el = this.containers.content;
        if (!el) return;
        if (!cluster.knotenpunkte || cluster.knotenpunkte.length === 0) {
            el.innerHTML = `<div class="mod-empty">${this._emptyIcon()}<p>No Knotenpunkte in this cluster.</p></div>`;
            return;
        }
        el.innerHTML = `<div class="mod-grid">
            ${cluster.knotenpunkte.map(kn => `
                <div class="mod-card" data-knoten="${this._esc(kn.name)}">
                    <div class="mod-card-icon">${this._folderIcon()}</div>
                    <span class="mod-card-name">${this._esc(kn.name)}</span>
                    <span class="mod-card-meta">${kn.addresses.length} Adresse${kn.addresses.length !== 1 ? 'n' : ''}</span>
                </div>`).join('')}
        </div>`;
        el.querySelectorAll('.mod-card[data-knoten]').forEach(card => {
            card.addEventListener('click', () => {
                const kn = cluster.knotenpunkte.find(k => k.name === card.dataset.knoten);
                if (kn) this._selectKnoten(kn);
            });
        });
    }

    renderAddresses(cluster, kn, addresses) {
        const el = this.containers.content;
        if (!el) return;

        // Apply addressFilter if provided
        const filtered = this.addressFilter
            ? (addresses || []).filter(this.addressFilter)
            : (addresses || []);

        if (!filtered || filtered.length === 0) {
            el.innerHTML = `<div class="mod-empty">${this._emptyIcon()}<p>No addresses found.</p></div>`;
            return;
        }

        const rows = filtered.map(addr => {
            const status  = (this.statusColId && addr.data) ? (addr.data[this.statusColId] || '') : '';
            const isDone  = status.toLowerCase() === 'done';
            const badge   = isDone
                ? `<span class="mod-badge mod-badge-done">Done</span>`
                : `<span class="mod-badge mod-badge-pending">Pending</span>`;
            return `
                <div class="addr-row" data-id="${this._esc(addr.id)}">
                    <div class="addr-info">
                        <div class="addr-end">${this._esc(addr.end || addr.start || addr.id)}</div>
                        <div class="addr-cable">${this._esc(addr.cableName || '—')}${addr.fiberType ? ` · ${this._esc(addr.fiberType)}` : ''}</div>
                    </div>
                    <div class="addr-right">${badge}${this._chevronIcon()}</div>
                </div>`;
        }).join('');

        el.innerHTML = `<div class="addr-list">${rows}</div>`;

        el.querySelectorAll('.addr-row').forEach(row => {
            row.addEventListener('click', () => {
                const addr = filtered.find(a => a.id === row.dataset.id);
                if (addr) this._selectAddress(addr);
            });
        });
    }

    renderUploadFormInto(targetEl, addr) {
        const origContent = this.containers.content;
        this.containers.content = targetEl;
        this.renderUploadForm(addr);
        this.containers.content = origContent;
    }

    renderUploadForm(addr) {
        const el = this.containers.content;
        if (!el) return;

        const status      = (this.statusColId && addr.data) ? (addr.data[this.statusColId] || '') : '';
        const currentType = (this.typeColId   && addr.data) ? (addr.data[this.typeColId]   || '') : '';
        const currentFile = (this.fileColId   && addr.data) ? (addr.data[this.fileColId]   || '') : '';
        const isDone      = status.toLowerCase() === 'done';

        // When done, show existing files view first (with Edit / Re-upload option)
        if (isDone) {
            this._renderFilesViewAsync(addr);
            return;
        }

        const typeOpts = this.typeOptions.map(t =>
            `<option value="${this._esc(t)}" ${currentType === t ? 'selected' : ''}>${this._esc(t)}</option>`
        ).join('');

        const existingBlock = (isDone && currentFile) ? `
            <div class="existing-info">
                <svg class="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div>
                    <div class="text-xs font-semibold text-green-700">Already uploaded</div>
                    <div class="text-xs text-gray-400 mt-0.5 break-all">${this._esc(currentFile)}</div>
                </div>
            </div>` : '';

        el.innerHTML = `
            <div class="upload-wrap">
                <!-- Address details -->
                <div class="addr-detail-card">
                    <div class="detail-row"><span class="detail-lbl">End</span><span class="detail-val">${this._esc(addr.end || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Start</span><span class="detail-val">${this._esc(addr.start || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Cable</span><span class="detail-val">${this._esc(addr.cableName || '—')}</span></div>
                    ${addr.fiberType ? `<div class="detail-row"><span class="detail-lbl">Fiber Count</span><span class="detail-val">${this._esc(addr.fiberType)}</span></div>` : ''}
                    <div class="detail-row">
                        <span class="detail-lbl">Status</span>
                        <span class="detail-val">
                            ${isDone
                                ? `<span class="mod-badge mod-badge-done">Done</span>`
                                : `<span class="mod-badge mod-badge-pending">Pending</span>`}
                        </span>
                    </div>
                </div>

                ${existingBlock}

                <!-- Upload card -->
                <div class="upload-card">
                    <h3 class="upload-card-title">Upload ${this._esc(this.moduleName)} PDF</h3>

                    <div class="form-grp">
                        <label class="form-lbl">Type</label>
                        <select id="typeSelect" class="form-sel">${typeOpts}</select>
                    </div>

                    <div class="form-grp" id="customTypeGrp" style="display:none">
                        <label class="form-lbl">Custom Type</label>
                        <input type="text" id="customTypeInput" class="form-inp" placeholder="e.g. 8x10">
                    </div>

                    ${this._renderExtraFields()}

                    <!-- Drop zone -->
                    <div class="drop-zone" id="dropZone">
                        <input type="file" id="fileInput" accept=".pdf" class="hidden">
                        <div id="dropInner">
                            <svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            <p class="text-sm font-semibold text-gray-500 mb-1">
                                Drop PDF here or <button type="button" id="browseBtn" class="text-indigo-500 hover:text-indigo-700 transition-colors underline-offset-2">browse</button>
                            </p>
                            <p class="text-xs text-gray-400">PDF files only · max 200 MB</p>
                        </div>
                        <div id="selectedInfo" class="hidden sel-file-info">
                            <svg class="w-6 h-6 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            <span id="selectedName" class="flex-1 text-sm font-semibold text-gray-800 truncate min-w-0"></span>
                            <button type="button" id="removeFileBtn" class="text-gray-400 hover:text-red-500 transition-colors ml-2 shrink-0" title="Remove">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                    </div>

                    <button id="uploadBtn" class="upload-btn" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        Upload PDF
                    </button>

                    <div id="uploadStatus" class="hidden upload-status-msg"></div>
                </div>
            </div>`;

        this._wireUploadForm(addr);
    }

    /**
     * Show a "files already uploaded" view with download links and an Edit/Re-upload button.
     * Called by renderUploadForm when isDone = true.
     */
    async _renderFilesViewAsync(addr) {
        const el = this.containers.content;
        if (!el) return;

        el.innerHTML = this._loadingHTML();

        const knotenName = this.currentKnoten ? this.currentKnoten.name : '';
        const targetPath = knotenName
            ? `${this.currentCluster.name}/${this.targetFolder}/${knotenName}`
            : `${this.currentCluster.name}/${this.targetFolder}`;
        const docsPath = `Doku/${targetPath}`;

        let files = [];
        try {
            const res = await fetch(
                `/api/modules/list-files?project=${encodeURIComponent(this.project)}&path=${encodeURIComponent(targetPath)}`,
                { headers: { 'x-user-email': this._userEmail, 'x-user-role': this._userRole } }
            );
            const data = await res.json();
            if (data.success) files = data.files || [];
        } catch (e) { console.warn('Could not fetch existing files:', e); }

        el.innerHTML = `
            <div class="upload-wrap">
                <div class="addr-detail-card">
                    <div class="detail-row"><span class="detail-lbl">End</span><span class="detail-val">${this._esc(addr.end || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Start</span><span class="detail-val">${this._esc(addr.start || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Cable</span><span class="detail-val">${this._esc(addr.cableName || '—')}</span></div>
                    <div class="detail-row">
                        <span class="detail-lbl">Status</span>
                        <span class="detail-val"><span class="mod-badge mod-badge-done">Done</span></span>
                    </div>
                </div>
                <div class="glass-card">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-sm font-bold text-gray-800">Uploaded Files <span class="text-gray-400 font-normal">(${files.length})</span></h3>
                        <span class="text-xs text-gray-400">${this._esc(targetPath)}</span>
                    </div>
                    ${this._renderFileListHTML(files, this.project, docsPath)}
                </div>
                <button id="reuploadBtn" class="upload-btn" style="background:linear-gradient(135deg,#6366f1,#4f46e5);">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                    </svg>
                    Edit / Re-upload
                </button>
            </div>`;

        document.getElementById('reuploadBtn')?.addEventListener('click', () => {
            this._renderUploadFormDirect(addr);
        });

        // Load thumbnail images with auth (data-auth-src → blob URL)
        ModuleNavigator._loadAuthImages();
    }

    /**
     * Render the actual upload form unconditionally (bypasses isDone check).
     * Used by the "Edit / Re-upload" button.
     */
    _renderUploadFormDirect(addr) {
        const el = this.containers.content;
        if (!el) return;

        const currentType = (this.typeColId && addr.data) ? (addr.data[this.typeColId] || '') : '';
        const typeOpts = this.typeOptions.map(t =>
            `<option value="${this._esc(t)}" ${currentType === t ? 'selected' : ''}>${this._esc(t)}</option>`
        ).join('');

        el.innerHTML = `
            <div class="upload-wrap">
                <div class="addr-detail-card">
                    <div class="detail-row"><span class="detail-lbl">End</span><span class="detail-val">${this._esc(addr.end || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Start</span><span class="detail-val">${this._esc(addr.start || '—')}</span></div>
                    <div class="detail-row"><span class="detail-lbl">Cable</span><span class="detail-val">${this._esc(addr.cableName || '—')}</span></div>
                    ${addr.fiberType ? `<div class="detail-row"><span class="detail-lbl">Fiber Count</span><span class="detail-val">${this._esc(addr.fiberType)}</span></div>` : ''}
                    <div class="detail-row">
                        <span class="detail-lbl">Status</span>
                        <span class="detail-val"><span class="mod-badge mod-badge-done">Done</span></span>
                    </div>
                </div>
                <div class="upload-card">
                    <h3 class="upload-card-title">Re-upload ${this._esc(this.moduleName)} PDF</h3>
                    <div class="form-grp">
                        <label class="form-lbl">Type</label>
                        <select id="typeSelect" class="form-sel">${typeOpts}</select>
                    </div>
                    <div class="form-grp" id="customTypeGrp" style="display:none">
                        <label class="form-lbl">Custom Type</label>
                        <input type="text" id="customTypeInput" class="form-inp" placeholder="e.g. 8x10">
                    </div>
                    ${this._renderExtraFields()}
                    <div class="drop-zone" id="dropZone">
                        <input type="file" id="fileInput" accept=".pdf" class="hidden">
                        <div id="dropInner">
                            <svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            <p class="text-sm font-semibold text-gray-500 mb-1">
                                Drop PDF here or <button type="button" id="browseBtn" class="text-indigo-500 hover:text-indigo-700 transition-colors underline-offset-2">browse</button>
                            </p>
                            <p class="text-xs text-gray-400">PDF files only · max 200 MB</p>
                        </div>
                        <div id="selectedInfo" class="hidden sel-file-info">
                            <svg class="w-6 h-6 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            <span id="selectedName" class="flex-1 text-sm font-semibold text-gray-800 truncate min-w-0"></span>
                            <button type="button" id="removeFileBtn" class="text-gray-400 hover:text-red-500 transition-colors ml-2 shrink-0" title="Remove">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                    </div>
                    <button id="uploadBtn" class="upload-btn" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        Upload PDF
                    </button>
                    <div id="uploadStatus" class="hidden upload-status-msg"></div>
                </div>
            </div>`;

        this._wireUploadForm(addr);
    }

    /**
     * Render a list of files with thumbnails for images, file type badges, sizes, and download links.
     */
    _renderFileListHTML(files, project, docsPath) {
        if (!files || files.length === 0) {
            return '<p class="text-sm text-gray-400 text-center py-4">No files found in this folder.</p>';
        }
        return `<div class="existing-files-list">${files.map(f => {
            const isImg = /\.(jpe?g|png|gif|webp)$/i.test(f.name);
            const dlUrl = `/api/files/download?project=${encodeURIComponent(project)}&path=${encodeURIComponent(docsPath)}&file=${encodeURIComponent(f.name)}`;
            const thumbId = `thumb-${Math.random().toString(36).slice(2,8)}`;
            const thumb = isImg
                ? `<img id="${thumbId}" data-auth-src="${dlUrl}" alt="${this._esc(f.name)}" class="file-thumb-sm" loading="lazy">`
                : `<div class="file-icon-badge">${this._esc((f.name.split('.').pop() || '?').toUpperCase())}</div>`;
            const size = f.size ? this._formatSize(f.size) : '';
            return `
                <div class="existing-file-row">
                    <div class="file-thumb-wrap">${thumb}</div>
                    <div class="file-name-wrap">
                        <span class="file-name-text" title="${this._esc(f.name)}">${this._esc(f.name)}</span>
                        ${size ? `<span class="file-size-text">${size}</span>` : ''}
                    </div>
                    <button type="button" class="file-dl-btn" title="Download ${this._esc(f.name)}" onclick="ModuleNavigator._downloadFile('${this._esc(dlUrl).replace(/'/g, "\\'")}', '${this._esc(f.name).replace(/'/g, "\\'")}')">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                        </svg>
                    </button>
                </div>`;
        }).join('')}</div>`;
    }

    _formatSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    updateBreadcrumb(parts) {
        const el = this.containers.breadcrumb;
        if (!el) return;

        let html = `<button class="bc-btn" data-step="0">Cluster</button>`;
        if (parts[0]) {
            html += this._bcSep();
            html += `<button class="bc-btn ${parts.length === 1 ? 'bc-active' : ''}" data-step="1">${this._esc(parts[0])}</button>`;
        }
        if (parts[1]) {
            html += this._bcSep();
            html += `<button class="bc-btn ${parts.length === 2 ? 'bc-active' : ''}" data-step="2">${this._esc(parts[1])}</button>`;
        }
        if (parts[2]) {
            html += this._bcSep();
            html += `<span class="bc-btn bc-active bc-current">${this._esc(parts[2])}</span>`;
        }

        el.innerHTML = html;

        el.querySelectorAll('[data-step]').forEach(btn => {
            btn.addEventListener('click', () => {
                const step = parseInt(btn.dataset.step);
                if (step === 0) {
                    this.renderClusters(this.clusters);
                    this.updateBreadcrumb([]);
                } else if (step === 1 && this.currentCluster) {
                    this._selectCluster(this.currentCluster);
                } else if (step === 2 && this.currentKnoten) {
                    this._selectKnoten(this.currentKnoten);
                }
            });
        });
    }

    /**
     * Find a column ID from the schema by group label and column label.
     * Both matches are case-insensitive substring checks.
     * @param {string} groupLabel - Label fragment to match the group
     * @param {string} colLabel   - Label fragment to match the column
     * @returns {string|null} The column id, or null if not found
     */
    findColumnId(groupLabel, colLabel) {
        if (!this.schema) return null;
        const grp = this.schema.find(g =>
            g.label && g.label.toLowerCase().includes(groupLabel.toLowerCase())
        );
        if (!grp || !grp.cols) return null;
        const col = grp.cols.find(c =>
            c.label && c.label.toLowerCase().includes(colLabel.toLowerCase())
        );
        return col ? col.id : null;
    }

    async handleUpload(file, addr, type, extraValues = {}) {
        const filename   = this.useOriginalFilename ? file.name : this.filenamePattern(addr, type);
        // Include knotenpunkt in target path: Cluster/Module/Knotenpunkt/
        const knotenName = this.currentKnoten ? this.currentKnoten.name : '';
        const targetPath = knotenName
            ? `${this.currentCluster.name}/${this.targetFolder}/${knotenName}`
            : `${this.currentCluster.name}/${this.targetFolder}`;

        // 1. Upload file
        const fd = new FormData();
        fd.append('files', file);
        fd.append('project', this.project);
        fd.append('targetPath', targetPath);
        if (!this.useOriginalFilename) fd.append('customName', filename);

        const uploadRes  = await fetch('/api/modules/upload', {
            method: 'POST',
            headers: { 'x-user-email': this._userEmail, 'x-user-role': this._userRole },
            body: fd
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) throw new Error(uploadData.message || 'Upload failed');

        const filePath = uploadData.files?.[0]?.path || `Doku/${targetPath}/${filename}`;

        // 2. Build aufmass updates object
        const updates = {};
        if (this.statusColId) updates[this.statusColId] = 'Done';
        if (this.typeColId)   updates[this.typeColId]   = type;
        if (this.fileColId)   updates[this.fileColId]   = filePath;

        // 3. Process extraFields — map each to its column + handle alsoCopyTo
        if (this.extraFields && this.extraFields.length > 0) {
            for (const field of this.extraFields) {
                const value = extraValues[field.name];
                if (value === undefined || value === '') continue;

                // Update the column within this module's own group
                if (field.colLabel) {
                    const colId = this.findColumnId(this.groupLabel, field.colLabel);
                    if (colId) updates[colId] = value;
                }

                // Cross-group copy (e.g. Metrierung total → LWL Specs > total)
                if (field.alsoCopyTo) {
                    const copyColId = this.findColumnId(
                        field.alsoCopyTo.groupLabel,
                        field.alsoCopyTo.colLabel
                    );
                    if (copyColId) updates[copyColId] = value;
                }
            }
        }

        // 4. Push aufmass update
        if (Object.keys(updates).length > 0) {
            const updateRes  = await fetch('/api/modules/aufmass-update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-email': this._userEmail,
                    'x-user-role':  this._userRole,
                },
                body: JSON.stringify({ project: this.project, rowId: addr.id, updates, module: this.moduleKey })
            });
            const updateData = await updateRes.json();
            if (!updateData.success) throw new Error(updateData.message || 'Aufmass update failed');
        }

        // 5. Update local cache so status badge refreshes on back-navigation
        if (addr.data) {
            if (this.statusColId) addr.data[this.statusColId] = 'Done';
            if (this.typeColId)   addr.data[this.typeColId]   = type;
            if (this.fileColId)   addr.data[this.fileColId]   = filePath;
            // Cache extra field values too
            if (this.extraFields && this.extraFields.length > 0) {
                for (const field of this.extraFields) {
                    const value = extraValues[field.name];
                    if (value === undefined || value === '') continue;
                    if (field.colLabel) {
                        const colId = this.findColumnId(this.groupLabel, field.colLabel);
                        if (colId) addr.data[colId] = value;
                    }
                }
            }
        }

        if (this.onUploadComplete) this.onUploadComplete({ file, addr, type, filePath, extraValues });
        return filePath;
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    _resolveColumnIds() {
        if (!this.schema || !this.groupLabel) return;
        const needle = this.groupLabel.toLowerCase();
        const grp    = this.schema.find(g => g.label && g.label.toLowerCase().includes(needle));
        if (!grp) { console.warn(`ModuleNavigator: group matching "${this.groupLabel}" not found in schema`); return; }
        if (grp.cols[0]) this.statusColId = grp.cols[0].id;

        if (this.extraFields && this.extraFields.length > 0) {
            // When extraFields are defined, col[1] belongs to extra fields —
            // skip typeColId so handleUpload doesn't overwrite it with the type string.
            // File column is still the last standard slot (col[2]).
            if (grp.cols[2]) this.fileColId = grp.cols[2].id;
        } else {
            // Standard layout: col[1] = type, col[2] = file
            if (grp.cols[1]) this.typeColId = grp.cols[1].id;
            if (grp.cols[2]) this.fileColId = grp.cols[2].id;
        }
    }

    _renderExtraFields() {
        if (!this.extraFields || this.extraFields.length === 0) return '';
        return this.extraFields.map(f => `
            <div class="form-grp">
                <label class="form-lbl" for="extraField_${this._esc(f.name)}">${this._esc(f.label)}</label>
                <input
                    type="${this._esc(f.type || 'text')}"
                    id="extraField_${this._esc(f.name)}"
                    class="form-inp"
                    placeholder="${this._esc(f.placeholder || '')}"
                    ${f.required ? 'required' : ''}
                >
            </div>`).join('');
    }

    _selectCluster(cluster) {
        this.currentCluster = cluster;
        this.currentKnoten  = null;
        this.currentAddress = null;
        this.renderKnotenpunkte(cluster);
        this.updateBreadcrumb([cluster.name]);
    }

    _selectKnoten(kn) {
        this.currentKnoten  = kn;
        this.currentAddress = null;

        // skipAddressStep: bypass address list and go directly to upload/callback
        if (this.skipAddressStep) {
            this.updateBreadcrumb([this.currentCluster.name, kn.name]);
            if (this.customUploadForm && this.onKnotenpunktSelected) {
                this.onKnotenpunktSelected(this.currentCluster.name, kn.name);
            } else if (!this.customUploadForm) {
                // No standard knotenpunkt-level form — show empty state as fallback
                const el = this.containers.content;
                if (el) el.innerHTML = `<div class="mod-empty">${this._emptyIcon()}<p>No upload form configured for knotenpunkt level.</p></div>`;
            }
            return;
        }

        this.renderAddresses(this.currentCluster, kn, kn.addresses);
        this.updateBreadcrumb([this.currentCluster.name, kn.name]);
    }

    _selectAddress(addr) {
        this.currentAddress = addr;
        this.updateBreadcrumb([this.currentCluster.name, this.currentKnoten.name, addr.end || addr.id]);
        if (this.customUploadForm && this.onAddressSelected) {
            this.onAddressSelected(this.currentCluster.name, this.currentKnoten.name, addr);
        } else {
            this.renderUploadForm(addr);
        }
    }

    _wireUploadForm(addr) {
        const fileInput      = document.getElementById('fileInput');
        const dropZone       = document.getElementById('dropZone');
        const browseBtn      = document.getElementById('browseBtn');
        const removeFileBtn  = document.getElementById('removeFileBtn');
        const typeSelect     = document.getElementById('typeSelect');
        const customTypeGrp  = document.getElementById('customTypeGrp');
        const customTypeInp  = document.getElementById('customTypeInput');
        const uploadBtn      = document.getElementById('uploadBtn');
        let selectedFile     = null;

        const setFile = (f) => {
            selectedFile = f;
            document.getElementById('dropInner').classList.add('hidden');
            document.getElementById('selectedInfo').classList.remove('hidden');
            document.getElementById('selectedName').textContent = f.name;
            _updateBtn();
        };
        const clearFile = () => {
            selectedFile = null;
            fileInput.value = '';
            document.getElementById('selectedInfo').classList.add('hidden');
            document.getElementById('dropInner').classList.remove('hidden');
            _updateBtn();
        };
        const _updateBtn = () => {
            const isCustom = typeSelect.value === 'custom';
            const hasType  = !isCustom || customTypeInp.value.trim().length > 0;

            // Validate required extra fields
            let extraValid = true;
            for (const field of this.extraFields) {
                if (field.required) {
                    const inp = document.getElementById(`extraField_${field.name}`);
                    if (inp && !inp.value.trim()) { extraValid = false; break; }
                }
            }

            uploadBtn.disabled = !selectedFile || !hasType || !extraValid;
        };
        const showStatus = (type, msg) => {
            const el = document.getElementById('uploadStatus');
            el.classList.remove('hidden', 'upload-ok', 'upload-err');
            el.classList.add(type === 'success' ? 'upload-ok' : 'upload-err');
            el.textContent = msg;
        };

        browseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => { if (e.target.files[0]) setFile(e.target.files[0]); });
        removeFileBtn.addEventListener('click', clearFile);

        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dz-over'); });
        dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dz-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dz-over');
            const f = e.dataTransfer.files[0];
            if (f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) {
                setFile(f);
            } else {
                showStatus('error', 'Only PDF files are accepted.');
            }
        });

        typeSelect.addEventListener('change', () => {
            customTypeGrp.style.display = typeSelect.value === 'custom' ? 'block' : 'none';
            _updateBtn();
        });
        customTypeInp.addEventListener('input', _updateBtn);

        // Wire up extra field change listeners
        for (const field of this.extraFields) {
            const inp = document.getElementById(`extraField_${field.name}`);
            if (inp) inp.addEventListener('input', _updateBtn);
        }

        uploadBtn.addEventListener('click', async () => {
            if (!selectedFile) return;
            const type = typeSelect.value === 'custom' ? customTypeInp.value.trim() : typeSelect.value;
            if (!type) { showStatus('error', 'Please specify a type.'); return; }

            // Collect extra field values
            const extraValues = {};
            for (const field of this.extraFields) {
                const inp = document.getElementById(`extraField_${field.name}`);
                if (inp) extraValues[field.name] = inp.value.trim();
            }

            uploadBtn.disabled = true;
            uploadBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg> Uploading…`;

            try {
                await this.handleUpload(selectedFile, addr, type, extraValues);
                uploadBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg> Uploaded`;
                showStatus('success', '✓ Upload successful — redirecting…');
                setTimeout(() => this._selectKnoten(this.currentKnoten), 1600);
            } catch (e) {
                showStatus('error', '✗ ' + e.message);
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg> Upload PDF`;
            }
        });
    }

    _bcSep() {
        return `<svg class="bc-sep" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>`;
    }

    _folderIcon() {
        return `<svg class="w-10 h-10 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
        </svg>`;
    }

    _chevronIcon() {
        return `<svg class="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>`;
    }

    _emptyIcon() {
        return `<svg class="w-12 h-12 mx-auto mb-3 text-gray-200" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
        </svg>`;
    }

    _loadingHTML() {
        return `<div class="py-16 flex justify-center text-gray-300">
            <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        </div>`;
    }

    _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /**
     * Load all images with data-auth-src attribute via fetch (with JWT auth).
     * Converts the response blob to an object URL and sets it as the img src.
     */
    static _loadAuthImages() {
        const authHeaders = {
            'x-user-email': localStorage.getItem('userEmail') || '',
            'x-user-role':  localStorage.getItem('userRole')  || '',
        };
        document.querySelectorAll('img[data-auth-src]').forEach(img => {
            const url = img.getAttribute('data-auth-src');
            if (!url || img.src) return;
            img.removeAttribute('data-auth-src'); // prevent re-fetch
            fetch(url, { headers: authHeaders }).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.blob();
            }).then(blob => {
                img.src = URL.createObjectURL(blob);
            }).catch(() => {
                img.alt = '⚠';
                img.style.opacity = '0.3';
            });
        });
    }

    /**
     * Download a file via fetch (with JWT auth), then trigger browser download.
     * Static method so it can be called from inline onclick handlers.
     */
    static async _downloadFile(url, filename) {
        try {
            const res = await fetch(url, {
                headers: {
                    'x-user-email': localStorage.getItem('userEmail') || '',
                    'x-user-role':  localStorage.getItem('userRole')  || '',
                },
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                alert('Download failed: ' + (errData.message || `HTTP ${res.status}`));
                return;
            }
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error('[Download]', e);
            alert('Download failed: ' + e.message);
        }
    }
}
