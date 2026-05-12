document.addEventListener('DOMContentLoaded', function () {
    
    const userRole = localStorage.getItem('userRole');
    if (!userRole) { window.location.href = 'login.html'; return; }

    const urlParams = new URLSearchParams(window.location.search);
    let projectName = urlParams.get('project');
    if (!projectName) { window.location.href = 'index.html'; return; }
    
    const titleEl = document.getElementById('tableProjectName');
    if(titleEl) titleEl.innerText = projectName;

    const backBtn = document.getElementById('backToHubBtn');
    if(backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const viewFilterContent = document.getElementById('viewFilterContent');
    const statusOptions = ['Done', 'Pending', 'Error', 'Waiting', 'N/A'];

    const editPanel = document.getElementById('editPanel');
    const saveBtn = document.getElementById('saveBtn');
    const discardBtn = document.getElementById('discardBtn');
    const addRowBtn = document.getElementById('addRowBtn');
    let currentSchema = [];

    // Dirty cell tracking
    const dirtyCells = new Set(); // Set of td elements that have been modified
    let originalData = []; // snapshot of data at load time

    // Selection state
    let selectedColId = null;
    let selectedRowIdx = null;

    // Permission: can this user edit?
    let canEdit = false;

    // Active editing cell
    let activeCell = null;
    let activeCellOriginalHTML = '';

    // Cache for cluster/knotenpunkt dropdowns
    let cachedClusters = null;
    let cachedKnoten = {};

    // ==========================================
    // HELPER: Column letter (A, B, C... Z, AA, AB...)
    // ==========================================
    function colLetter(idx) {
        let s = '';
        idx++;
        while (idx > 0) {
            idx--;
            s = String.fromCharCode(65 + (idx % 26)) + s;
            idx = Math.floor(idx / 26);
        }
        return s;
    }

    // ==========================================
    // HELPER: Get visible column list (flat)
    // ==========================================
    function getVisibleColumns() {
        const cols = [];
        currentSchema.forEach(group => {
            if (group.title.toLowerCase().includes("identification")) return;
            group.cols.forEach(col => {
                cols.push({ ...col, groupTitle: group.title, groupId: group.id });
            });
        });
        return cols;
    }

    // ==========================================
    // FETCH: Clusters & Knotenpunkte (cached)
    // ==========================================
    async function fetchClusters(forceRefresh) {
        if (cachedClusters && !forceRefresh) return cachedClusters;
        try {
            const r = await fetch(`/api/projects/${encodeURIComponent(projectName)}/clusters`);
            const j = await r.json();
            cachedClusters = j.success ? j.clusters : [];
        } catch (_) { cachedClusters = []; }
        return cachedClusters;
    }

    async function fetchKnotenpunkte(clusterName, forceRefresh) {
        if (cachedKnoten[clusterName] && !forceRefresh) return cachedKnoten[clusterName];
        if (!clusterName) return [];
        try {
            const r = await fetch(`/api/projects/${encodeURIComponent(projectName)}/knotenpunkte?cluster=${encodeURIComponent(clusterName)}`);
            const j = await r.json();
            cachedKnoten[clusterName] = j.success ? j.knotenpunkte : [];
        } catch (_) { cachedKnoten[clusterName] = []; }
        return cachedKnoten[clusterName];
    }

    // ==========================================
    // BUILD: Dropdown selects for inline editing
    // ==========================================
    async function buildClusterSelect(currentVal, td) {
        const clusters = await fetchClusters();
        const sel = document.createElement('select');
        sel.className = 'w-full bg-blue-50 border border-blue-200 rounded p-1 text-xs font-bold text-slate-700 outline-none cluster-select';

        let options = clusters.slice();
        if (currentVal && !options.includes(currentVal)) options.unshift(currentVal);
        options.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            if (c === currentVal) opt.selected = true;
            sel.appendChild(opt);
        });
        const addOpt = document.createElement('option');
        addOpt.value = '__add_new__'; addOpt.textContent = '➕ Add New...';
        sel.appendChild(addOpt);

        sel.addEventListener('change', async function() {
            if (sel.value === '__add_new__') {
                const newCluster = await showPrompt('New Cluster', 'Enter cluster name');
                if (newCluster && newCluster.trim()) {
                    const name = newCluster.trim();
                    await fetch(`/api/projects/${encodeURIComponent(projectName)}/clusters`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown' },
                        body: JSON.stringify({ name })
                    });
                    cachedClusters = null;
                    await fetchClusters(true);
                    // Rebuild this select
                    const newSel = await buildClusterSelect(name, td);
                    sel.parentNode.replaceChild(newSel, sel);
                    markDirty(td);
                    // Update knotenpunkt in same row
                    const row = td.closest('tr');
                    const knotenTd = findKnotenTdInRow(row);
                    if (knotenTd && knotenTd.querySelector('select')) {
                        const newKSel = await buildKnotenSelect(name, '', knotenTd);
                        knotenTd.innerHTML = '';
                        knotenTd.appendChild(newKSel);
                    }
                } else {
                    sel.value = currentVal || (clusters[0] || '');
                }
            } else {
                markDirty(td);
                // Update knotenpunkt in same row
                const row = td.closest('tr');
                const knotenTd = findKnotenTdInRow(row);
                if (knotenTd && knotenTd.querySelector('select')) {
                    const newKSel = await buildKnotenSelect(sel.value, '', knotenTd);
                    knotenTd.innerHTML = '';
                    knotenTd.appendChild(newKSel);
                }
            }
        });

        sel.addEventListener('blur', () => { commitCell(td); });
        return sel;
    }

    async function buildKnotenSelect(clusterName, currentVal, td) {
        const knoten = await fetchKnotenpunkte(clusterName);
        const sel = document.createElement('select');
        sel.className = 'w-full bg-blue-50 border border-blue-200 rounded p-1 text-xs font-bold text-slate-700 outline-none knoten-select';
        sel.dataset.cluster = clusterName;

        let options = knoten.slice();
        if (currentVal && !options.includes(currentVal)) options.unshift(currentVal);

        const emptyOpt = document.createElement('option');
        emptyOpt.value = ''; emptyOpt.textContent = '';
        sel.appendChild(emptyOpt);

        options.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k; opt.textContent = k;
            if (k === currentVal) opt.selected = true;
            sel.appendChild(opt);
        });
        const addOpt = document.createElement('option');
        addOpt.value = '__add_new__'; addOpt.textContent = '➕ Add New...';
        sel.appendChild(addOpt);

        sel.addEventListener('change', async function() {
            if (sel.value === '__add_new__') {
                const cluster = sel.dataset.cluster;
                const newKnoten = await showPrompt('New Knotenpunkt', 'e.g. NVT-005');
                if (newKnoten && newKnoten.trim()) {
                    const name = newKnoten.trim();
                    await fetch(`/api/projects/${encodeURIComponent(projectName)}/knotenpunkte`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown' },
                        body: JSON.stringify({ cluster, name })
                    });
                    delete cachedKnoten[cluster];
                    const newSel = await buildKnotenSelect(cluster, name, td);
                    sel.parentNode.replaceChild(newSel, sel);
                    markDirty(td);
                } else {
                    sel.value = currentVal || '';
                }
            } else {
                markDirty(td);
            }
        });

        sel.addEventListener('blur', () => { commitCell(td); });
        return sel;
    }

    function buildFiberTypeSelect(currentVal, td) {
        const sel = document.createElement('select');
        sel.className = 'w-full bg-blue-50 border border-blue-200 rounded p-1 text-xs font-bold text-slate-700 outline-none';
        ['', '6', '12', '24', '48', '96', '288'].forEach(v => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v || '—';
            if (v === currentVal) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => { markDirty(td); });
        sel.addEventListener('blur', () => { commitCell(td); });
        return sel;
    }

    function buildStatusSelect(currentVal, td, label) {
        const val = currentVal === 'Pending' ? '' : currentVal;
        const sel = document.createElement('select');
        sel.className = 'w-full bg-blue-50 border border-blue-200 rounded p-1 text-xs font-bold text-slate-700 outline-none status-select';
        sel.innerHTML = `<option value=""></option>` + statusOptions.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('');
        sel.addEventListener('change', () => {
            markDirty(td);
            if (label === 'apl status' || label === 'knotenpunkt status') {
                checkOTDRAutoTrigger(td.closest('tr'));
            }
        });
        sel.addEventListener('blur', () => { commitCell(td); });
        return sel;
    }

    // ==========================================
    // HELPERS
    // ==========================================
    function getColumnInfo(colId) {
        for (const g of currentSchema) {
            for (const c of g.cols) {
                if (c.id === colId) return { label: c.label, groupTitle: g.title, groupId: g.id };
            }
        }
        return null;
    }

    function getClusterValueFromRow(row) {
        for (const g of currentSchema) {
            for (const c of g.cols) {
                if (c.label.toLowerCase() === 'cluster') {
                    const td = row.querySelector('.' + c.id);
                    if (!td) return '';
                    const sel = td.querySelector('select');
                    return sel ? sel.value : td.innerText.trim();
                }
            }
        }
        return '';
    }

    function findKnotenTdInRow(row) {
        for (const g of currentSchema) {
            for (const c of g.cols) {
                const lbl = c.label.toLowerCase();
                if (lbl === 'knotenpunkt' || lbl === 'nvt') {
                    return row.querySelector('.' + c.id) || null;
                }
            }
        }
        return null;
    }

    function checkOTDRAutoTrigger(row) {
        if (!currentSchema) return;
        let aplStatusTd = null, knotenStatusTd = null, otdrStatusTd = null;
        for (const g of currentSchema) {
            for (const c of g.cols) {
                const lbl = c.label.toLowerCase();
                if (lbl === 'apl status') aplStatusTd = row.querySelector('.' + c.id);
                if (lbl === 'knotenpunkt status') knotenStatusTd = row.querySelector('.' + c.id);
                if (!otdrStatusTd && g.title && g.title.toLowerCase().includes('otdr') && lbl.includes('status')) {
                    otdrStatusTd = row.querySelector('.' + c.id);
                }
            }
        }
        if (!aplStatusTd || !knotenStatusTd || !otdrStatusTd) return;

        const aplVal = aplStatusTd.querySelector('select')?.value || aplStatusTd.innerText.trim();
        const knotenVal = knotenStatusTd.querySelector('select')?.value || knotenStatusTd.innerText.trim();
        const otdrSel = otdrStatusTd.querySelector('select');
        const otdrVal = otdrSel ? otdrSel.value : otdrStatusTd.innerText.trim();

        if (aplVal === 'Done' && knotenVal === 'Done' && otdrVal !== 'Done') {
            if (otdrSel) {
                otdrSel.value = 'Waiting';
                markDirty(otdrStatusTd);
                otdrStatusTd.style.transition = 'background-color 0.3s';
                otdrStatusTd.style.backgroundColor = '#fef3c7';
                setTimeout(() => { otdrStatusTd.style.backgroundColor = ''; }, 1500);
            }
        }
    }

    function collectCurrentData(schema) {
        return Array.from(document.querySelectorAll('#table-body tr')).map(row => {
            let rowObj = { _id: row.dataset.rowId };
            schema.forEach(g => {
                g.cols.forEach(c => {
                    const cell = row.querySelector('.' + c.id);
                    const select = cell?.querySelector('select');
                    rowObj[c.id] = select ? (select.value === '__add_new__' ? '' : select.value.trim()) : cell?.innerText.trim() || '';
                });
            });
            return rowObj;
        });
    }

    function makeId(prefix, label) {
        return prefix + label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    }

    // ==========================================
    // DIRTY TRACKING & EDIT BAR
    // ==========================================
    function markDirty(td) {
        if (!td) return;
        dirtyCells.add(td);
        td.classList.add('cell-dirty');
        updateEditBar();
    }

    function clearDirty() {
        dirtyCells.forEach(td => td.classList.remove('cell-dirty'));
        dirtyCells.clear();
        updateEditBar();
    }

    function updateEditBar() {
        if (dirtyCells.size > 0) {
            editPanel?.classList.remove('hidden');
        } else {
            editPanel?.classList.add('hidden');
        }
    }

    // ==========================================
    // INLINE CELL EDITING
    // ==========================================
    async function activateCell(td) {
        if (!canEdit) return; // No edit permission
        if (td === activeCell) return;
        if (activeCell) commitCell(activeCell);

        // Don't activate row number cells
        if (td.classList.contains('row-num-cell')) return;

        const colClass = Array.from(td.classList).find(c => c.startsWith('col-'));
        if (!colClass) return;

        const colInfo = getColumnInfo(colClass);
        if (!colInfo) return;
        const label = colInfo.label.toLowerCase();
        const currentVal = td.innerText.trim();

        activeCell = td;
        activeCellOriginalHTML = td.innerHTML;
        td.classList.add('cell-editing');

        // Status column → select
        if (label.includes('status')) {
            td.innerHTML = '';
            td.appendChild(buildStatusSelect(currentVal, td, label));
            td.querySelector('select').focus();
            return;
        }

        // Cluster column → select
        if (label === 'cluster') {
            td.innerHTML = '';
            const sel = await buildClusterSelect(currentVal, td);
            td.appendChild(sel);
            sel.focus();
            return;
        }

        // Knotenpunkt column → select
        if (label === 'knotenpunkt' || label === 'nvt') {
            td.innerHTML = '';
            const row = td.closest('tr');
            const clusterVal = getClusterValueFromRow(row);
            const sel = await buildKnotenSelect(clusterVal, currentVal, td);
            td.appendChild(sel);
            sel.focus();
            return;
        }

        // Fiber Type column → select
        if (label.includes('fiber type') || label === 'fiber type' || label.includes('fiber count') || label === 'fiber count') {
            td.innerHTML = '';
            td.appendChild(buildFiberTypeSelect(currentVal, td));
            td.querySelector('select').focus();
            return;
        }

        // Default → contenteditable
        td.setAttribute('contenteditable', 'true');
        td.focus();
        // Place cursor at end
        const range = document.createRange();
        const sel = window.getSelection();
        if (td.childNodes.length > 0) {
            range.selectNodeContents(td);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    function commitCell(td) {
        if (!td) return;
        if (td !== activeCell) return;

        const colClass = Array.from(td.classList).find(c => c.startsWith('col-'));
        const colInfo = colClass ? getColumnInfo(colClass) : null;
        const label = colInfo ? colInfo.label.toLowerCase() : '';

        const select = td.querySelector('select');
        if (select) {
            const val = select.value === '__add_new__' ? '' : select.value;
            // Check if value changed
            const oldText = activeCellOriginalHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = oldText;
            const oldVal = tempDiv.innerText.trim();
            if (val !== oldVal) markDirty(td);

            if (label.includes('status')) {
                td.innerHTML = formatStatusBadge(val);
            } else {
                td.textContent = val;
            }
        } else {
            td.removeAttribute('contenteditable');
            const newVal = td.innerText.trim();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = activeCellOriginalHTML;
            const oldVal = tempDiv.innerText.trim();
            if (newVal !== oldVal) markDirty(td);
        }

        td.classList.remove('cell-editing');
        activeCell = null;
        activeCellOriginalHTML = '';
    }

    // Global click handler — commit active cell when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
        if (!activeCell) return;
        if (activeCell.contains(e.target)) return;
        // Don't commit if clicking modal
        if (e.target.closest('#modal-overlay')) return;
        commitCell(activeCell);
    });

    // Keyboard: Enter commits, Tab moves to next cell, Escape reverts
    document.addEventListener('keydown', (e) => {
        if (!activeCell) return;
        if (e.target.closest('#modal-overlay')) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitCell(activeCell);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const currentTd = activeCell;
            commitCell(activeCell);
            // Find next/prev editable cell
            const allTds = Array.from(tableBody.querySelectorAll('td:not(.row-num-cell)'));
            const idx = allTds.indexOf(currentTd);
            if (idx >= 0) {
                const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                if (nextIdx >= 0 && nextIdx < allTds.length) {
                    activateCell(allTds[nextIdx]);
                }
            }
        } else if (e.key === 'Escape') {
            // Revert cell
            activeCell.innerHTML = activeCellOriginalHTML;
            activeCell.removeAttribute('contenteditable');
            activeCell.classList.remove('cell-editing');
            activeCell = null;
            activeCellOriginalHTML = '';
        }
    });

    // ==========================================
    // COLUMN MANAGEMENT (via action bar)
    // ==========================================
    async function addMainColumn() {
        const groupName = await showPrompt('New Column Group', 'Enter group name');
        if (!groupName?.trim()) return;
        const subColName = await showPrompt('First Sub-Column', `Enter first sub-column for "${groupName.trim()}"`);
        if (!subColName?.trim()) return;

        const data = collectCurrentData(currentSchema);
        currentSchema.push({
            id: makeId('grp-', groupName),
            title: groupName.trim(),
            cols: [{ id: makeId('col-', subColName), label: subColName.trim() }]
        });

        renderHeaders(currentSchema);
        renderViewMenu(currentSchema);
        renderTableRows(data, currentSchema);
        markDirty(tableBody.querySelector('td')); // mark as having changes
    }

    async function addSubColumn(groupIdx) {
        const group = currentSchema[groupIdx];
        if (!group) return;
        const colName = await showPrompt('Add Sub-Column', `New column in "${group.title}"`);
        if (!colName?.trim()) return;

        const data = collectCurrentData(currentSchema);
        group.cols.push({ id: makeId('col-', colName), label: colName.trim() });

        renderHeaders(currentSchema);
        renderViewMenu(currentSchema);
        renderTableRows(data, currentSchema);
        markDirty(tableBody.querySelector('td'));
    }

    async function removeSubColumn(groupIdx, colIdx) {
        const group = currentSchema[groupIdx];
        if (!group) return;
        const colName = group.cols[colIdx]?.label || 'this column';
        const lastInGroup = group.cols.length === 1;
        const msg = lastInGroup
            ? `This will also remove the entire "${group.title}" group.`
            : `This cannot be undone.`;
        const ok = await showConfirm(`Remove "${colName}"?`, msg);
        if (!ok) return;

        const data = collectCurrentData(currentSchema);
        if (lastInGroup) {
            currentSchema.splice(groupIdx, 1);
        } else {
            group.cols.splice(colIdx, 1);
        }

        renderHeaders(currentSchema);
        renderViewMenu(currentSchema);
        renderTableRows(data, currentSchema);
        markDirty(tableBody.querySelector('td'));
    }

    async function renameColumn(colId) {
        const info = getColumnInfo(colId);
        if (!info) return;
        const newName = await showPrompt('Rename Column', 'New name', info.label);
        if (!newName?.trim() || newName.trim() === info.label) return;

        for (const g of currentSchema) {
            for (const c of g.cols) {
                if (c.id === colId) { c.label = newName.trim(); break; }
            }
        }

        const data = collectCurrentData(currentSchema);
        renderHeaders(currentSchema);
        renderViewMenu(currentSchema);
        renderTableRows(data, currentSchema);
        markDirty(tableBody.querySelector('td'));
    }

    function sortByColumn(colId, ascending) {
        const data = collectCurrentData(currentSchema);
        data.sort((a, b) => {
            const va = (a[colId] || '').toLowerCase();
            const vb = (b[colId] || '').toLowerCase();
            return ascending ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        renderTableRows(data, currentSchema);
        markDirty(tableBody.querySelector('td'));
    }

    // ==========================================
    // SELECTION: Column & Row
    // ==========================================
    function clearSelection() {
        document.querySelectorAll('.col-selected').forEach(el => el.classList.remove('col-selected'));
        document.querySelectorAll('.row-selected').forEach(el => el.classList.remove('row-selected'));
        selectedColId = null;
        selectedRowIdx = null;
        hideActionBar();
    }

    function selectColumn(colId) {
        clearSelection();
        selectedColId = colId;
        document.querySelectorAll('.' + colId).forEach(el => el.classList.add('col-selected'));
        // Also highlight the letter cell
        const letterCell = document.querySelector(`[data-col-letter-id="${colId}"]`);
        if (letterCell) letterCell.classList.add('col-selected');
        showColumnActionBar(colId);
    }

    function selectRow(rowIdx) {
        clearSelection();
        selectedRowIdx = rowIdx;
        const rows = tableBody.querySelectorAll('tr');
        if (rows[rowIdx]) {
            rows[rowIdx].querySelectorAll('td').forEach(td => td.classList.add('row-selected'));
        }
        showRowActionBar(rowIdx);
    }

    // ==========================================
    // ACTION BAR (floating)
    // ==========================================
    let actionBar = null;

    function createActionBar() {
        if (actionBar) return actionBar;
        actionBar = document.createElement('div');
        actionBar.id = 'selection-action-bar';
        actionBar.style.cssText = 'position:fixed; z-index:100; background:rgba(255,255,255,0.96); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border:1px solid #e5e7eb; border-radius:12px; padding:6px 10px; box-shadow:0 8px 24px rgba(0,0,0,0.12); display:none; gap:4px; align-items:center;';
        document.body.appendChild(actionBar);
        return actionBar;
    }

    function hideActionBar() {
        if (actionBar) actionBar.style.display = 'none';
    }

    function positionActionBar(targetEl) {
        const bar = createActionBar();
        const rect = targetEl.getBoundingClientRect();
        bar.style.display = 'flex';
        bar.style.top = (rect.bottom + 6) + 'px';
        bar.style.left = Math.max(8, rect.left) + 'px';
        // Ensure bar doesn't overflow right
        requestAnimationFrame(() => {
            const barRect = bar.getBoundingClientRect();
            if (barRect.right > window.innerWidth - 8) {
                bar.style.left = (window.innerWidth - barRect.width - 8) + 'px';
            }
        });
    }

    const abtn = (text, icon, onClick) => {
        const b = document.createElement('button');
        b.className = 'px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors text-gray-700 whitespace-nowrap flex items-center gap-1';
        b.innerHTML = (icon ? icon + ' ' : '') + text;
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    };

    function showColumnActionBar(colId) {
        if (!canEdit) return;
        const bar = createActionBar();
        bar.innerHTML = '';

        // Find group/col indices
        let gIdx = -1, cIdx = -1;
        currentSchema.forEach((g, gi) => {
            g.cols.forEach((c, ci) => { if (c.id === colId) { gIdx = gi; cIdx = ci; } });
        });

        bar.appendChild(abtn('Rename', '✏️', () => { hideActionBar(); renameColumn(colId); }));
        bar.appendChild(abtn('Add Column', '➕', () => { hideActionBar(); if (gIdx >= 0) addSubColumn(gIdx); }));
        bar.appendChild(abtn('Delete', '🗑️', () => { hideActionBar(); if (gIdx >= 0 && cIdx >= 0) removeSubColumn(gIdx, cIdx); }));
        bar.appendChild(abtn('Sort A→Z', '↑', () => { hideActionBar(); sortByColumn(colId, true); }));
        bar.appendChild(abtn('Sort Z→A', '↓', () => { hideActionBar(); sortByColumn(colId, false); }));

        const th = document.querySelector(`th.${colId}`) || document.querySelector(`[data-col-letter-id="${colId}"]`);
        if (th) positionActionBar(th);
    }

    function showRowActionBar(rowIdx) {
        if (!canEdit) return;
        const bar = createActionBar();
        bar.innerHTML = '';
        const rows = tableBody.querySelectorAll('tr');
        const row = rows[rowIdx];
        if (!row) return;

        bar.appendChild(abtn('Insert Above', '⬆️', () => { hideActionBar(); insertRow(rowIdx, 'above'); }));
        bar.appendChild(abtn('Insert Below', '⬇️', () => { hideActionBar(); insertRow(rowIdx, 'below'); }));
        bar.appendChild(abtn('Duplicate', '📋', () => { hideActionBar(); duplicateRow(rowIdx); }));
        bar.appendChild(abtn('Delete', '🗑️', async () => {
            hideActionBar();
            const ok = await showConfirm('Delete Row', 'Are you sure you want to delete this row?');
            if (ok) { row.remove(); updateRowNumbers(); markDirty(tableBody.querySelector('td')); }
        }));

        const numCell = row.querySelector('.row-num-cell');
        if (numCell) positionActionBar(numCell);
    }

    // ==========================================
    // ROW OPERATIONS
    // ==========================================
    function createEmptyRow() {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors group border-b border-slate-200';
        tr.dataset.rowId = `ROW-${Date.now()}`;

        // Row number cell
        let html = `<td class="row-num-cell px-2 py-3 text-xs text-gray-400 text-center bg-gray-50 border-r border-gray-200 cursor-pointer select-none" style="width:40px;min-width:40px;max-width:40px;">0</td>`;

        currentSchema.forEach(g => {
            if (g.title.toLowerCase().includes('identification')) return;
            g.cols.forEach(c => {
                html += `<td class="${c.id} px-4 py-3 text-sm text-slate-600 border-r border-slate-200 whitespace-nowrap cursor-pointer" style="min-width: 80px;"></td>`;
            });
        });
        tr.innerHTML = html;
        return tr;
    }

    function insertRow(atIdx, position) {
        const rows = tableBody.querySelectorAll('tr');
        const tr = createEmptyRow();
        if (position === 'above' && rows[atIdx]) {
            rows[atIdx].before(tr);
        } else if (position === 'below' && rows[atIdx]) {
            rows[atIdx].after(tr);
        } else {
            tableBody.appendChild(tr);
        }
        updateRowNumbers();
        markDirty(tr.querySelector('td:not(.row-num-cell)'));
        // Apply view filters
        viewFilterContent?.querySelectorAll('.col-toggle').forEach(cb => {
            if (!cb.checked) setColumnVisibility(cb.getAttribute('data-col-class'), false);
        });
    }

    function duplicateRow(rowIdx) {
        const rows = tableBody.querySelectorAll('tr');
        const srcRow = rows[rowIdx];
        if (!srcRow) return;

        const tr = createEmptyRow();
        // Copy cell values
        currentSchema.forEach(g => {
            g.cols.forEach(c => {
                const srcTd = srcRow.querySelector('.' + c.id);
                const dstTd = tr.querySelector('.' + c.id);
                if (srcTd && dstTd) {
                    const sel = srcTd.querySelector('select');
                    dstTd.innerHTML = sel ? srcTd.innerText.trim() : srcTd.innerHTML;
                }
            });
        });

        srcRow.after(tr);
        updateRowNumbers();
        markDirty(tr.querySelector('td:not(.row-num-cell)'));
    }

    function updateRowNumbers() {
        tableBody.querySelectorAll('tr').forEach((row, idx) => {
            const numCell = row.querySelector('.row-num-cell');
            if (numCell) numCell.textContent = idx + 1;
        });
    }

    // ==========================================
    // RENDER: Headers (3 rows: letters, groups, columns)
    // ==========================================
    function renderHeaders(schema) {
        tableHead.innerHTML = '';
        const visibleCols = getVisibleColumns();

        // Row 0: Column letters (A, B, C...)
        const trLetters = document.createElement('tr');
        trLetters.className = 'bg-gray-100';
        // Empty cell for row numbers
        const emptyLetterTh = document.createElement('th');
        emptyLetterTh.rowSpan = 3;
        emptyLetterTh.className = 'bg-gray-200 border-r border-gray-300';
        emptyLetterTh.style.cssText = 'width:40px;min-width:40px;max-width:40px;';
        trLetters.appendChild(emptyLetterTh);

        visibleCols.forEach((col, idx) => {
            const th = document.createElement('th');
            th.className = 'px-2 py-1 text-[10px] font-bold text-gray-400 text-center border-r border-gray-200 bg-gray-100 cursor-pointer hover:bg-blue-50 transition-colors select-none';
            th.textContent = colLetter(idx);
            th.dataset.colLetterId = col.id;
            th.setAttribute('data-col-letter-id', col.id);
            th.addEventListener('click', (e) => { e.stopPropagation(); selectColumn(col.id); });
            trLetters.appendChild(th);
        });
        tableHead.appendChild(trLetters);

        // Row 1: Group headers
        const tr1 = document.createElement('tr');
        schema.forEach((group, gIdx) => {
            if (group.title.toLowerCase().includes("identification")) return;

            const th1 = document.createElement('th');
            th1.id = group.id;
            th1.colSpan = group.cols.length;
            th1.className = 'p-3 text-xs font-black tracking-widest uppercase border-r border-gray-700 bg-gray-900 text-center text-white';
            th1.innerText = group.title;
            tr1.appendChild(th1);
        });

        // Add Main Column button (only if user can edit)
        if (canEdit) {
            const addMainTh = document.createElement('th');
            addMainTh.rowSpan = 2;
            addMainTh.className = 'p-2 border-l border-gray-700 bg-gray-900 text-center';
            addMainTh.style.cssText = 'width: 36px; min-width: 36px; max-width: 36px;';
            addMainTh.innerHTML = `<button id="addMainColBtn" style="color:#93c5fd;font-weight:bold;font-size:18px;width:28px;height:28px;border-radius:6px;line-height:1;transition:background 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.2)'" onmouseout="this.style.background=''" title="Add main column group">+</button>`;
            tr1.appendChild(addMainTh);
        }

        tableHead.appendChild(tr1);

        // Row 2: Sub-column headers
        const tr2 = document.createElement('tr');
        schema.forEach((group, gIdx) => {
            if (group.title.toLowerCase().includes("identification")) return;
            group.cols.forEach((col, cIdx) => {
                const th2 = document.createElement('th');
                th2.className = `${col.id} px-4 py-3 text-xs font-bold text-gray-200 uppercase tracking-wider border-r border-gray-600 whitespace-nowrap bg-gray-700`;
                th2.style.cssText = 'min-width: 80px; position: relative;';
                th2.innerText = col.label;
                tr2.appendChild(th2);
            });
        });
        tableHead.appendChild(tr2);

        // Wire up add main column button
        document.getElementById('addMainColBtn')?.addEventListener('click', addMainColumn);

        initializeResizers();
    }

    // ==========================================
    // RENDER: View Menu
    // ==========================================
    function renderViewMenu(schema) {
        if (!viewFilterContent) return;
        let vHtml = `
<div class="flex gap-2 mb-3 pb-3 border-b border-slate-200">
    <button id="hideExtrasBtn" class="flex-1 px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">Hide Extras</button>
    <button id="showAllBtn" class="flex-1 px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">Show All</button>
</div>
`;
        schema.forEach(group => {
            if (group.title.toLowerCase().includes("identification")) return;
            vHtml += `<div class="mb-1"><label class="flex justify-between font-bold text-slate-800 bg-slate-100 p-1.5 rounded cursor-pointer"><span class="flex gap-2"><input type="checkbox" class="group-toggle text-blue-600" data-target-group="${group.id}" checked> ${group.title}</span></label><div class="ml-6 flex flex-col gap-1 mt-1">`;
            group.cols.forEach(col => {
                vHtml += `<label class="flex gap-2 text-slate-600 cursor-pointer"><input type="checkbox" class="col-toggle text-blue-500" data-col-class="${col.id}" data-parent-group="${group.id}" checked> ${col.label}</label>`;
            });
            vHtml += `</div></div>`;
        });
        viewFilterContent.innerHTML = vHtml;

        document.getElementById('hideExtrasBtn')?.addEventListener('click', () => {
            const essentialGroups = ['timing', 'location', 'address', 'hardware'];
            viewFilterContent.querySelectorAll('.group-toggle').forEach(groupCb => {
                const groupId = groupCb.getAttribute('data-target-group');
                const group = currentSchema.find(g => g.id === groupId);
                const isEssential = group && essentialGroups.includes(group.title.toLowerCase());
                groupCb.checked = isEssential;
                viewFilterContent.querySelectorAll(`.col-toggle[data-parent-group="${groupId}"]`).forEach(colCb => {
                    colCb.checked = isEssential;
                    setColumnVisibility(colCb.getAttribute('data-col-class'), isEssential);
                });
                updateGroupColspan(groupId);
            });
        });

        document.getElementById('showAllBtn')?.addEventListener('click', () => {
            viewFilterContent.querySelectorAll('.group-toggle').forEach(groupCb => {
                groupCb.checked = true;
                const groupId = groupCb.getAttribute('data-target-group');
                viewFilterContent.querySelectorAll(`.col-toggle[data-parent-group="${groupId}"]`).forEach(colCb => {
                    colCb.checked = true;
                    setColumnVisibility(colCb.getAttribute('data-col-class'), true);
                });
                updateGroupColspan(groupId);
            });
        });
    }

    // ==========================================
    // RENDER: Status Badge
    // ==========================================
    function formatStatusBadge(statusText) {
        const s = statusText ? statusText.toLowerCase().trim() : '';
        if (s === '' || s.includes('pending') || s.includes('progress')) return `<span class="px-2.5 py-1 bg-yellow-100 text-yellow-700 rounded-md text-xs font-bold border border-yellow-300 shadow-sm">${s === '' ? 'Pending' : statusText}</span>`;
        if (s.includes('done') || s.includes('complete') || s === 'ok') return `<span class="px-2.5 py-1 bg-green-100 text-green-700 rounded-md text-xs font-bold border border-green-200 shadow-sm">${statusText}</span>`;
        if (s.includes('error')) return `<span class="px-2.5 py-1 bg-red-100 text-red-700 rounded-md text-xs font-bold border border-red-300 shadow-sm">⚠ ${statusText}</span>`;
        if (s.includes('wait') || s.includes('n/a') || s === '-') return `<span class="px-2.5 py-1 bg-slate-200 text-slate-600 rounded-md text-xs font-bold border border-slate-300 shadow-sm">${statusText}</span>`;
        return `<span class="text-slate-600 font-medium">${statusText}</span>`;
    }

    // ==========================================
    // RENDER: Table Rows
    // ==========================================
    function renderTableRows(dataArray, schema) {
        tableBody.innerHTML = '';
        dataArray.forEach((item, rowIdx) => {
            const tr = document.createElement('tr');
            tr.className = 'transition-colors group border-b border-slate-200';
            tr.dataset.rowId = item._id;

            // Row number cell
            let html = `<td class="row-num-cell px-2 py-3 text-xs text-gray-400 text-center bg-gray-50 border-r border-gray-200 cursor-pointer select-none font-mono" style="width:40px;min-width:40px;max-width:40px;">${rowIdx + 1}</td>`;

            schema.forEach(group => {
                if (group.title.toLowerCase().includes("identification")) return;
                group.cols.forEach(col => {
                    let val = item[col.id] || '';
                    let displayHtml;
                    const labelLower = col.label.toLowerCase();
                    if (labelLower.includes('status')) {
                        displayHtml = formatStatusBadge(val);
                    } else if (labelLower.includes('folder location') || labelLower.includes('file location') || labelLower.includes('image location')) {
                        // "folder location" / "image location" = value IS the folder → use as-is
                        // "file location" = value is a file path → strip filename to get parent folder
                        const isFilePath = labelLower.includes('file location');
                        const dirPath = isFilePath && val && val.includes('/') ? val.substring(0, val.lastIndexOf('/')) : val;
                        displayHtml = val ? `<a href="files.html?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(dirPath)}" class="text-blue-600 hover:text-blue-800 hover:underline" title="${val.replace(/"/g, '&quot;')}">📂 Open</a>` : '';
                    } else {
                        displayHtml = val;
                    }
                    let fontClass = (labelLower === 'date' || labelLower === 'total') ? 'font-bold text-slate-900' : 'text-slate-600';
                    html += `<td class="${col.id} px-4 py-3 text-sm ${fontClass} border-r border-slate-200 whitespace-nowrap cursor-pointer" style="min-width: 80px;">${displayHtml}</td>`;
                });
            });
            tr.innerHTML = html;
            tableBody.appendChild(tr);
        });
    }

    // ==========================================
    // FETCH: Permissions
    // ==========================================
    async function fetchPermissions() {
        const role = (localStorage.getItem('userRole') || '').toLowerCase();
        const email = localStorage.getItem('userEmail') || '';

        // Superadmin and admin roles can always edit
        if (role === 'superadmin' || role === 'administrator' || role === 'admin') {
            canEdit = true;
            return;
        }

        try {
            const r = await fetch('/api/access/permissions', {
                headers: { 'x-user-email': email, 'x-user-role': role }
            });
            const data = await r.json();
            if (data.fullAccess || data.superadmin) {
                canEdit = true;
            } else if (data.projects && data.projects[projectName]) {
                canEdit = !!data.projects[projectName].canEdit;
            } else {
                canEdit = false;
            }
        } catch (_) {
            canEdit = false;
        }
    }

    // ==========================================
    // FETCH: Project Data
    // ==========================================
    async function fetchProjectData() {
        if (!tableBody) return;
        try {
            // Fetch permissions first
            await fetchPermissions();

            // Pre-fetch dropdown data
            await fetchClusters(true);
            
            const response = await fetch(`/api/data?project=${encodeURIComponent(projectName)}`);
            const result = await response.json();
            if (result.success) {
                currentSchema = result.schema;
                originalData = JSON.parse(JSON.stringify(result.data));
                renderHeaders(currentSchema);
                renderViewMenu(currentSchema);
                renderTableRows(result.data, currentSchema);
                clearDirty();

                // Hide edit controls if user can't edit
                if (!canEdit) {
                    document.getElementById('addRowBtn')?.classList.add('hidden');
                    document.getElementById('addColBtn')?.classList.add('hidden');
                }

                // Pre-fetch knotenpunkte for all clusters
                const uniqueClusters = new Set();
                result.data.forEach(row => {
                    Object.values(row).forEach(val => {
                        if (typeof val === 'string' && cachedClusters?.includes(val)) uniqueClusters.add(val);
                    });
                });
                await Promise.all([...uniqueClusters].map(c => fetchKnotenpunkte(c, true)));
            } else {
                tableBody.innerHTML = `<tr><td colspan="100%" class="p-6 text-center text-red-500 font-bold">Failed to load data.</td></tr>`;
            }
        } catch (error) { console.error(error); }
    }

    // ==========================================
    // UI: Column/View visibility
    // ==========================================
    function setColumnVisibility(colClass, isVisible) {
        document.querySelectorAll('.' + colClass).forEach(cell => {
            isVisible ? cell.classList.remove('hidden') : cell.classList.add('hidden');
        });
        // Also toggle the letter header
        const letterTh = document.querySelector(`[data-col-letter-id="${colClass}"]`);
        if (letterTh) isVisible ? letterTh.classList.remove('hidden') : letterTh.classList.add('hidden');
    }

    function updateGroupColspan(groupId) {
        const groupTh = document.getElementById(groupId);
        if (groupTh && viewFilterContent) {
            const visibleCount = viewFilterContent.querySelectorAll(`.col-toggle[data-parent-group="${groupId}"]:checked`).length;
            if (visibleCount === 0) groupTh.classList.add('hidden');
            else { groupTh.classList.remove('hidden'); groupTh.setAttribute('colspan', visibleCount); }
        }
    }

    document.getElementById('viewFilterBtn')?.addEventListener('click', (e) => {
        e.stopPropagation(); document.getElementById('viewFilterMenu').classList.toggle('hidden');
    });

    viewFilterContent?.addEventListener('change', (e) => {
        if (e.target.classList.contains('col-toggle')) {
            setColumnVisibility(e.target.getAttribute('data-col-class'), e.target.checked);
            updateGroupColspan(e.target.getAttribute('data-parent-group'));
        } else if (e.target.classList.contains('group-toggle')) {
            const groupId = e.target.getAttribute('data-target-group');
            const isChecked = e.target.checked;
            viewFilterContent.querySelectorAll(`.col-toggle[data-parent-group="${groupId}"]`).forEach(child => {
                child.checked = isChecked; setColumnVisibility(child.getAttribute('data-col-class'), isChecked);
            });
            updateGroupColspan(groupId);
        }
    });

    // ==========================================
    // UI: Search
    // ==========================================
    const searchInput = document.getElementById('tableSearch') || document.querySelector('input[placeholder="Search records..."]');
    const searchClearBtn = document.getElementById('searchClearBtn');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('#table-body tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(searchTerm) ? '' : 'none';
            });
            if (searchClearBtn) {
                searchClearBtn.style.display = e.target.value ? '' : 'none';
            }
        });
    }
    if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener('click', function() {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            document.querySelectorAll('#table-body tr').forEach(row => { row.style.display = ''; });
            searchInput.focus();
        });
    }

    // ==========================================
    // COLUMN RESIZER
    // ==========================================
    function initializeResizers() {
        document.querySelectorAll('thead tr:last-child th').forEach(col => {
            if (col.classList.contains('col-actions')) return;
            if (col.style.maxWidth === '40px') return; // skip row num

            const resizer = document.createElement('div');
            resizer.style.cssText = 'width: 10px; height: 100%; position: absolute; right: 0; top: 0; cursor: col-resize; user-select: none; z-index: 10; background-color: transparent; transition: background-color 0.2s;';
            let isResizing = false;

            resizer.addEventListener('mouseenter', () => resizer.style.backgroundColor = 'rgba(59, 130, 246, 0.5)');
            resizer.addEventListener('mouseleave', () => { if (!isResizing) resizer.style.backgroundColor = 'transparent'; });
            col.appendChild(resizer);

            let x = 0; let w = 0;
            const mouseMoveHandler = function(e) {
                const newWidth = Math.max(40, w + (e.clientX - x));
                col.style.width = `${newWidth}px`;
                col.style.minWidth = `${newWidth}px`;
                col.style.maxWidth = `${newWidth}px`;
                const colClass = Array.from(col.classList).find(c => c.startsWith('col-'));
                if (colClass) {
                    document.querySelectorAll('.' + colClass).forEach(td => {
                        td.style.width = `${newWidth}px`;
                        td.style.minWidth = `${newWidth}px`;
                        td.style.maxWidth = `${newWidth}px`;
                    });
                }
            };
            const mouseUpHandler = function() {
                isResizing = false; resizer.style.backgroundColor = 'transparent';
                document.removeEventListener('mousemove', mouseMoveHandler); document.removeEventListener('mouseup', mouseUpHandler);
            };
            resizer.addEventListener('mousedown', function(e) {
                isResizing = true; x = e.clientX; w = col.getBoundingClientRect().width;
                document.addEventListener('mousemove', mouseMoveHandler); document.addEventListener('mouseup', mouseUpHandler);
                resizer.style.backgroundColor = 'rgba(37, 99, 235, 1)'; e.stopPropagation(); e.preventDefault();
            });
        });
    }

    // ==========================================
    // CLICK HANDLERS: Cell click → inline edit, row num → select
    // ==========================================
    tableBody?.addEventListener('click', (e) => {
        // Let link clicks pass through (folder location links etc.)
        if (e.target.closest('a')) return;

        const td = e.target.closest('td');
        if (!td) return;

        // Row number click → select row
        if (td.classList.contains('row-num-cell')) {
            const row = td.closest('tr');
            const rows = Array.from(tableBody.querySelectorAll('tr'));
            const idx = rows.indexOf(row);
            if (idx >= 0) selectRow(idx);
            return;
        }

        // Regular cell click → activate for editing
        activateCell(td);
    });

    // Double-click on cell also activates (for users who expect double-click)
    tableBody?.addEventListener('dblclick', (e) => {
        const td = e.target.closest('td');
        if (td && !td.classList.contains('row-num-cell')) activateCell(td);
    });

    // Click elsewhere to deselect
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#data-table') && !e.target.closest('#selection-action-bar') && !e.target.closest('#modal-overlay')) {
            clearSelection();
        }
    });

    // ==========================================
    // SAVE / DISCARD / ADD ROW
    // ==========================================
    addRowBtn?.addEventListener('click', () => {
        insertRow(tableBody.querySelectorAll('tr').length - 1, 'below');
        const lastRow = tableBody.querySelector('tr:last-child');
        if (lastRow) lastRow.scrollIntoView({ behavior: 'smooth' });
    });

    discardBtn?.addEventListener('click', async () => {
        const ok = await showConfirm('Discard Changes', 'All unsaved changes will be lost.');
        if (ok) {
            clearDirty();
            fetchProjectData();
        }
    });

    saveBtn?.addEventListener('click', async () => {
        // Commit any active cell first
        if (activeCell) commitCell(activeCell);

        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = 'Saving...';
        const rows = document.querySelectorAll('#table-body tr');
        const updatedData = [];

        rows.forEach((row) => {
            let rowObj = { _id: row.dataset.rowId };
            currentSchema.forEach(g => {
                g.cols.forEach(c => {
                    const cell = row.querySelector('.' + c.id);
                    const select = cell?.querySelector('select');
                    rowObj[c.id] = select ? (select.value === '__add_new__' ? '' : select.value.trim()) : cell?.innerText.trim() || '';
                });
            });
            updatedData.push(rowObj);
        });

        try {
            const saveRes = await fetch(`/api/data?project=${encodeURIComponent(projectName)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown' },
                body: JSON.stringify({ schema: currentSchema, data: updatedData })
            });
            const saveResult = await saveRes.json();
            if (!saveResult.success) {
                if (saveResult.conflict) {
                    await showAlert('⚠ Conflict: ' + saveResult.message);
                    saveBtn.innerHTML = originalText;
                    return;
                }
                throw new Error(saveResult.message);
            }
            // Update local row versions from server response
            if (saveResult.rowVersions) {
                updatedData.forEach(row => {
                    if (saveResult.rowVersions[row._id] !== undefined) {
                        row._version = saveResult.rowVersions[row._id];
                    }
                });
            }
            saveBtn.innerHTML = 'Saved!';
            clearDirty();
            originalData = JSON.parse(JSON.stringify(updatedData));
            setTimeout(() => { saveBtn.innerHTML = originalText; }, 1000);
        } catch (error) {
            await showAlert('Save failed: ' + (error.message || 'Please try again.'));
            saveBtn.innerHTML = originalText;
        }
    });

    // ==========================================
    // EXCEL EXPORT (unchanged logic)
    // ==========================================
    document.getElementById('excelBtn')?.addEventListener('click', () => {
        if (!currentSchema.length) return showAlert('No data loaded.');

        const visibleCols = [];
        const merges = [];
        currentSchema.forEach(group => {
            if (group.title.toLowerCase().includes('identification')) return;
            const groupCheckbox = viewFilterContent?.querySelector(`.group-toggle[data-target-group="${group.id}"]`);
            if (groupCheckbox && !groupCheckbox.checked) return;

            const visCols = group.cols.filter(col => {
                const colCb = viewFilterContent?.querySelector(`.col-toggle[data-col-class="${col.id}"]`);
                return !colCb || colCb.checked;
            });
            if (visCols.length === 0) return;

            const startCol = visibleCols.length;
            visCols.forEach(col => visibleCols.push({ groupTitle: group.title, colLabel: col.label, colId: col.id }));
            if (visCols.length > 1) {
                merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + visCols.length - 1 } });
            }
        });

        if (!visibleCols.length) return showAlert('No columns visible to export.');

        const row0 = visibleCols.map(c => c.groupTitle);
        const row1 = visibleCols.map(c => c.colLabel);
        const wsData = [row0, row1];

        document.querySelectorAll('#table-body tr').forEach(tr => {
            if (tr.style.display === 'none') return;
            const rowData = visibleCols.map(vc => {
                const td = tr.querySelector('.' + vc.colId);
                return td ? td.innerText.trim() : '';
            });
            wsData.push(rowData);
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!merges'] = merges;

        const borderStyle = { style: 'thin', color: { rgb: 'B0B0B0' } };
        const border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        const colWidths = visibleCols.map(() => ({ wch: 12 }));

        for (let R = 0; R < wsData.length; R++) {
            for (let C = 0; C < visibleCols.length; C++) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                const cell = ws[addr];

                const len = String(cell.v || '').length + 2;
                if (len > colWidths[C].wch) colWidths[C].wch = len;

                const cellStyle = { border, alignment: { vertical: 'center' } };

                if (R === 0) {
                    cellStyle.fill = { fgColor: { rgb: '1E293B' } };
                    cellStyle.font = { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 };
                    cellStyle.alignment = { horizontal: 'center', vertical: 'center' };
                } else if (R === 1) {
                    cellStyle.fill = { fgColor: { rgb: '475569' } };
                    cellStyle.font = { bold: true, color: { rgb: 'E2E8F0' }, sz: 9 };
                    cellStyle.alignment = { horizontal: 'center', vertical: 'center' };
                } else {
                    cellStyle.font = { sz: 9 };
                    const colInfo = getColumnInfo(visibleCols[C].colId);
                    const label = colInfo ? colInfo.label.toLowerCase() : '';
                    const val = String(cell.v || '').toLowerCase().trim();

                    if (label.includes('status') || label === 'druckprufung') {
                        if (val === 'done' || val === 'complete' || val === 'ok') {
                            cellStyle.fill = { fgColor: { rgb: 'DCFCE7' } };
                            cellStyle.font = { bold: true, color: { rgb: '15803D' }, sz: 9 };
                        } else if (val === 'pending' || val === '' || val === 'progress') {
                            cellStyle.fill = { fgColor: { rgb: 'FEF9C3' } };
                            cellStyle.font = { bold: true, color: { rgb: 'A16207' }, sz: 9 };
                        } else if (val === 'n/a' || val === '-' || val === 'waiting') {
                            cellStyle.fill = { fgColor: { rgb: 'F1F5F9' } };
                            cellStyle.font = { bold: true, color: { rgb: '64748B' }, sz: 9 };
                        }
                    }
                }

                cell.s = cellStyle;
            }
        }
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, projectName.substring(0, 31));
        XLSX.writeFile(wb, `${projectName}_Export.xlsx`);
    });

    // ==========================================
    // TOOLBAR: + Column button
    // ==========================================
    document.getElementById('addColBtn')?.addEventListener('click', () => addMainColumn());

    // ==========================================
    // INIT
    // ==========================================
    fetchProjectData();
});
