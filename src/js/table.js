/**
 * src/js/table.js — Aufmass Grid v2
 *
 * Custom Excel-like data grid.  No third-party grid library.
 * Vanilla JS + DocPilot design system (navy/amber/slate).
 *
 * Design principles (§6, overhaul plan 2026-06-10):
 *  - State lives in `state`, DOM is a projection of state
 *  - Column addressing always by stable col.id (never positional)
 *  - NO zebra stripes; hover-only row highlight
 *  - 1 px light dividers; tabular numerics; status pills
 *  - 120–160 ms ease; hover-revealed row actions
 *  - Sticky header + frozen first col + sticky footer totals
 *  - Density presets 40/48/56 px; state persisted per-project
 */

/* global XLSX */

'use strict';

document.addEventListener('DOMContentLoaded', function () {

    // ── Auth guard ─────────────────────────────────────────────────────
    const userRole = localStorage.getItem('userRole');
    if (!userRole) { window.location.href = 'login.html'; return; }

    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    if (!projectName) { window.location.href = 'index.html'; return; }

    // Sync title elements
    document.getElementById('tableProjectName')?.textContent &&
        (document.getElementById('tableProjectName').textContent = projectName);
    document.getElementById('headerProjectName')?.textContent &&
        (document.getElementById('headerProjectName').textContent = projectName);

    document.getElementById('backToHubBtn')?.addEventListener('click', () => {
        window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;
    });

    // ── DOM refs ───────────────────────────────────────────────────────
    const tableEl     = document.getElementById('data-table');
    const tableHead   = document.getElementById('table-head');
    const tableBody   = document.getElementById('table-body');
    const tableFooter = document.getElementById('table-footer');
    const editPanel   = document.getElementById('editPanel');
    const saveBtn     = document.getElementById('saveBtn');
    const discardBtn  = document.getElementById('discardBtn');
    const addRowBtn   = document.getElementById('addRowBtn');
    const viewFilterContent = document.getElementById('viewFilterContent');

    // ── Grid state ─────────────────────────────────────────────────────
    const state = {
        schema:       [],   // API shape: [{id, title, cols:[{id,label,type,...}]}]
        data:         [],   // [{_id, _version, 'col-xxx': value, ...}]
        originalData: [],   // deep-clone at load/save — used for dirty detection
        rowVersions:  {},

        canEdit: false,

        // View / persisted state
        density:    'regular',         // condensed | regular | relaxed
        hiddenCols: new Set(),
        colWidths:  {},                // {colId: px}
        sortState:  { colId: null, asc: true },
        filterState:{ global: '', perCol: {} },
        showFilterRow: false,

        // Active edit
        activeCell:    null,           // { rowId, colId, td }
        activeCellPrev: null,          // HTML snapshot before edit
        dirtyRows:     new Set(),      // set of rowIds

        // Drag
        rowDragSrcIdx:  null,
        colDragSrcId:   null,

        // Cluster/Knotenpunkt dropdown cache
        clusters:       null,
        knotenCache:    {},

        // Transient
        openPopover: null,
    };

    // ── Constants ──────────────────────────────────────────────────────
    const STATUS_OPTS  = ['Done', 'Pending', 'Waiting', 'Error', 'N/A'];
    const STATUS_CLASS = {
        done:    'ag-pill-done',
        pending: 'ag-pill-pending',
        waiting: 'ag-pill-waiting',
        error:   'ag-pill-error',
        'n/a':   'ag-pill-na',
    };
    const DENSITY_HEIGHT = { condensed: 40, regular: 48, relaxed: 56 };
    const LS_KEY = `ag-state-${projectName}`;

    // ── Persist / restore view state ───────────────────────────────────
    function saveViewState() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                density:      state.density,
                hiddenCols:   [...state.hiddenCols],
                colWidths:    state.colWidths,
                sortState:    state.sortState,
                showFilterRow:state.showFilterRow,
            }));
        } catch (_) { /* storage full — silent */ }
    }

    function loadViewState() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const s = JSON.parse(raw);
            if (s.density)       state.density    = s.density;
            if (s.hiddenCols)    state.hiddenCols = new Set(s.hiddenCols);
            if (s.colWidths)     state.colWidths  = s.colWidths;
            if (s.sortState)     state.sortState  = s.sortState;
            if (s.showFilterRow) state.showFilterRow = s.showFilterRow;
        } catch (_) { /* corrupt — ignore */ }
    }

    function resetViewState() {
        localStorage.removeItem(LS_KEY);
        state.density      = 'regular';
        state.hiddenCols   = new Set();
        state.colWidths    = {};
        state.sortState    = { colId: null, asc: true };
        state.filterState  = { global: '', perCol: {} };
        state.showFilterRow = false;
        applyDensity();
        renderAll();
        updateDensityButtons();
        document.getElementById('tableSearch') && (document.getElementById('tableSearch').value = '');
    }

    // ── Schema helpers ─────────────────────────────────────────────────

    /** Flat list of visible columns (excludes Identification group, hidden cols). */
    function visibleCols() {
        const cols = [];
        state.schema.forEach(g => {
            if (isIdentificationGroup(g)) return;
            g.cols.forEach(c => {
                if (!state.hiddenCols.has(c.id)) cols.push({ ...c, groupId: g.id, groupTitle: g.title });
            });
        });
        return cols;
    }

    function isIdentificationGroup(g) {
        return g.title.toLowerCase().includes('identification');
    }

    function allCols() {
        const cols = [];
        state.schema.forEach(g => g.cols.forEach(c => cols.push({ ...c, groupId: g.id })));
        return cols;
    }

    function findCol(colId) {
        for (const g of state.schema) {
            for (const c of g.cols) { if (c.id === colId) return c; }
        }
        return null;
    }

    function findGroup(groupId) {
        return state.schema.find(g => g.id === groupId) || null;
    }

    /** Infer column type when not explicitly set (legacy data). */
    function colType(col) {
        if (col.type)  return col.type;
        if (col.isBadge) return 'status';
        const lbl = (col.label || '').toLowerCase();
        if (lbl.includes('status'))  return 'status';
        if (lbl === 'date')          return 'date';
        if (lbl === 'cluster')       return 'cluster';
        if (lbl === 'knotenpunkt' || lbl === 'nvt') return 'knotenpunkt';
        if (lbl.includes('fiber count') || lbl.includes('fiber type')) return 'fiberdropdown';
        if (lbl.includes('folder location') || lbl.includes('file location') || lbl.includes('image location')) return 'filelink';
        return 'text';
    }

    /** Check if column should use tabular (right-aligned) font. */
    function isNumericType(col) {
        const t = colType(col);
        return t === 'number' || t === 'currency';
    }

    // ── Status pill HTML ───────────────────────────────────────────────
    function statusPillHtml(val) {
        const s = (val || '').toLowerCase().trim();
        const cls = STATUS_CLASS[s] || 'ag-pill-empty';
        const display = val || '—';
        return `<span class="ag-pill ${cls}">${escHtml(display)}</span>`;
    }

    // ── File link HTML ─────────────────────────────────────────────────
    function fileLinkHtml(val, col) {
        if (!val) return '';
        const lbl = (col.label || '').toLowerCase();
        const isFilePath = lbl.includes('file location');
        const dirPath = isFilePath && val.includes('/') ? val.substring(0, val.lastIndexOf('/')) : val;
        return `<a href="files.html?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(dirPath)}" class="text-blue-600 hover:underline" title="${escHtml(val)}">📂 Open</a>`;
    }

    // ── HTML escape ────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Row data helpers ───────────────────────────────────────────────
    function rowById(rowId) {
        return state.data.find(r => r._id === rowId) || null;
    }

    function rowIndex(rowId) {
        return state.data.findIndex(r => r._id === rowId);
    }

    function makeRowId() {
        return `ROW-${Date.now().toString(36).toUpperCase()}`;
    }

    function makeColId(prefix, label) {
        return `${prefix}${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    }

    // ── Dirty tracking ─────────────────────────────────────────────────
    function markDirty(rowId) {
        state.dirtyRows.add(rowId);
        updateEditBar();
        const tr = tableBody.querySelector(`tr[data-row-id="${CSS.escape(rowId)}"]`);
        if (tr) {
            tr.querySelectorAll('td:not(.ag-td-rownum)').forEach(td => td.classList.add('ag-cell-dirty'));
        }
    }

    function clearDirty() {
        state.dirtyRows.clear();
        tableBody.querySelectorAll('.ag-cell-dirty').forEach(td => td.classList.remove('ag-cell-dirty'));
        updateEditBar();
    }

    function updateEditBar() {
        if (editPanel) {
            editPanel.classList.toggle('hidden', state.dirtyRows.size === 0);
        }
    }

    // ── Density ────────────────────────────────────────────────────────
    function applyDensity() {
        tableEl.classList.remove('ag-density-condensed', 'ag-density-regular', 'ag-density-relaxed');
        tableEl.classList.add(`ag-density-${state.density}`);
    }

    function updateDensityButtons() {
        document.querySelectorAll('.ag-density-btn').forEach(btn => {
            btn.classList.toggle('ag-density-active', btn.dataset.density === state.density);
        });
    }

    // ── Frozen column offset calculations ─────────────────────────────
    /** Returns the left offset (in px) for the Nth frozen column (0-indexed),
     *  taking into account the row-num column (48px) and any preceding frozen cols. */
    function frozenLeft(colIdx) {
        // Row num col = 48px, then each frozen col uses its own width
        const vc = visibleCols();
        let offset = 48; // row num column
        for (let i = 0; i < colIdx; i++) {
            if (i < vc.length) offset += (state.colWidths[vc[i].id] || 120);
        }
        return offset;
    }

    // ── Skeleton loading ───────────────────────────────────────────────
    function renderSkeleton() {
        tableBody.innerHTML = '';
        const FAKE_COLS = 8;
        const FAKE_ROWS = 10;
        for (let r = 0; r < FAKE_ROWS; r++) {
            const tr = document.createElement('tr');
            tr.className = 'ag-skeleton-row';
            // row num
            const td0 = document.createElement('td');
            td0.className = 'ag-td-rownum';
            td0.style.cssText = 'width:48px;min-width:48px';
            tr.appendChild(td0);
            for (let c = 0; c < FAKE_COLS; c++) {
                const td = document.createElement('td');
                const inner = document.createElement('div');
                inner.className = 'ag-skeleton ag-skeleton-cell';
                inner.style.width = (50 + Math.random() * 40).toFixed(0) + '%';
                td.appendChild(inner);
                tr.appendChild(td);
            }
            tableBody.appendChild(tr);
        }
    }

    // ── Empty state ────────────────────────────────────────────────────
    function renderEmptyState() {
        tableBody.innerHTML = '';
        const tr  = document.createElement('tr');
        const td  = document.createElement('td');
        const vc  = visibleCols();
        td.colSpan = vc.length + 1;
        td.className = 'p-0 border-0';
        td.innerHTML = `
            <div class="ag-empty-state">
                <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>
                </svg>
                <h3>No measurement rows yet</h3>
                <p>Add your first measurement row to start tracking this project.</p>
            </div>`;
        tr.appendChild(td);
        tableBody.appendChild(tr);
    }

    // ── Render: apply sort + filter to data copy ────────────────────────
    function computeDisplayRows() {
        let rows = state.data.slice();

        // Per-column filters
        Object.entries(state.filterState.perCol).forEach(([colId, term]) => {
            if (!term) return;
            const t = term.toLowerCase();
            rows = rows.filter(r => String(r[colId] || '').toLowerCase().includes(t));
        });

        // Global search
        if (state.filterState.global) {
            const t = state.filterState.global.toLowerCase();
            rows = rows.filter(r => {
                return Object.values(r).some(v => String(v || '').toLowerCase().includes(t));
            });
        }

        // Sort
        const { colId, asc } = state.sortState;
        if (colId) {
            rows.sort((a, b) => {
                const av = String(a[colId] ?? '');
                const bv = String(b[colId] ?? '');
                const n = Number(av) - Number(bv);
                const cmp = isNaN(n) ? av.localeCompare(bv, 'de') : n;
                return asc ? cmp : -cmp;
            });
        }

        return rows;
    }

    // ── Render: footer totals ──────────────────────────────────────────
    function renderFooter() {
        if (!tableFooter) return;
        tableFooter.innerHTML = '';
        const vc       = visibleCols();
        const dispRows = computeDisplayRows();

        const tr = document.createElement('tr');

        // Row-num cell
        const td0 = document.createElement('td');
        td0.className = 'ag-td-rownum ag-td-rownum-footer text-xs text-slate-400';
        td0.title = 'Totals row';
        td0.textContent = '∑';
        tr.appendChild(td0);

        vc.forEach((col, idx) => {
            const td = document.createElement('td');
            const totals = col.totals || 'none';
            const width  = state.colWidths[col.id] || 120;
            td.style.width   = width + 'px';
            td.style.minWidth= width + 'px';

            // Apply frozen
            if (idx === 0 && !state.hiddenCols.has(col.id)) {
                td.classList.add('ag-frozen');
                td.style.left = '48px';
            }

            if (totals === 'none') {
                td.textContent = '';
            } else {
                const vals = dispRows.map(r => parseFloat(r[col.id])).filter(v => !isNaN(v));
                let label, value;
                if (totals === 'sum') {
                    label = 'SUM';
                    value = vals.reduce((a, b) => a + b, 0);
                } else if (totals === 'avg') {
                    label = 'AVG';
                    value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                } else if (totals === 'count') {
                    label = 'COUNT';
                    value = dispRows.filter(r => r[col.id] != null && r[col.id] !== '').length;
                }
                if (label !== undefined) {
                    td.classList.add('ag-total-number');
                    td.innerHTML = `<span class="ag-total-label">${label}</span>${typeof value === 'number' ? value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : value}`;
                }
            }
            tr.appendChild(td);
        });

        tableFooter.appendChild(tr);
    }

    // ── Render: headers ────────────────────────────────────────────────
    function renderHeaders() {
        tableHead.innerHTML = '';
        const vc = visibleCols();

        // ── Row 1: Group headers ───────────────────────────────────────
        const trGroup = document.createElement('tr');

        // Row-num header (spans both header rows)
        const thNum = document.createElement('th');
        thNum.rowSpan = state.showFilterRow ? 3 : 2;
        thNum.className = 'ag-th-rownum';
        thNum.style.cssText = 'width:48px;min-width:48px;max-width:48px;';
        trGroup.appendChild(thNum);

        // Group spans
        const groupSpans = [];
        state.schema.forEach(g => {
            if (isIdentificationGroup(g)) return;
            const visCols = g.cols.filter(c => !state.hiddenCols.has(c.id));
            if (visCols.length === 0) return;
            groupSpans.push({ g, count: visCols.length });
        });

        groupSpans.forEach(({ g, count }) => {
            const th = document.createElement('th');
            th.colSpan = count;
            th.className = 'ag-th-group';
            th.dataset.groupId = g.id;

            const inner = document.createElement('span');
            inner.className = 'flex items-center justify-center gap-1.5';
            inner.textContent = g.title;

            if (state.canEdit) {
                const addBtn = document.createElement('button');
                addBtn.className = 'ag-add-col-btn ml-1';
                addBtn.title = `Add column to ${g.title}`;
                addBtn.textContent = '+';
                addBtn.addEventListener('click', e => { e.stopPropagation(); promptAddColumn(g.id); });
                inner.appendChild(addBtn);
            }

            th.appendChild(inner);
            trGroup.appendChild(th);
        });

        // "Add group" button at end
        if (state.canEdit) {
            const thAdd = document.createElement('th');
            thAdd.rowSpan = state.showFilterRow ? 3 : 2;
            thAdd.className = 'ag-add-group-th';
            thAdd.style.cssText = 'width:32px;min-width:32px;max-width:32px;';
            const btn = document.createElement('button');
            btn.className = 'ag-add-group-btn';
            btn.title = 'Add group';
            btn.textContent = '+';
            btn.addEventListener('click', promptAddGroup);
            thAdd.appendChild(btn);
            trGroup.appendChild(thAdd);
        }

        tableHead.appendChild(trGroup);

        // ── Row 2: Sub-column headers ──────────────────────────────────
        const trCols = document.createElement('tr');

        vc.forEach((col, idx) => {
            const th = document.createElement('th');
            th.className = 'ag-th-col';
            th.dataset.colId = col.id;
            th.dataset.groupId = col.groupId;

            if (isNumericType(col)) th.classList.add('ag-th-number');
            if (state.sortState.colId === col.id) th.classList.add('ag-sort-active');

            const w = state.colWidths[col.id] || 120;
            th.style.width    = w + 'px';
            th.style.minWidth = w + 'px';

            // First visible data column: frozen
            if (idx === 0) {
                th.classList.add('ag-frozen');
                th.style.left = '48px';
            }

            // Inner layout
            const inner = document.createElement('div');
            inner.className = 'ag-th-inner';

            // Sort button
            const sortBtn = document.createElement('button');
            sortBtn.className = 'ag-sort-btn';
            sortBtn.title = 'Sort';
            const isSortedAsc  = state.sortState.colId === col.id && state.sortState.asc;
            const isSortedDesc = state.sortState.colId === col.id && !state.sortState.asc;
            sortBtn.textContent = isSortedAsc ? '↑' : isSortedDesc ? '↓' : '↕';
            sortBtn.addEventListener('click', e => { e.stopPropagation(); toggleSort(col.id); });

            // Label
            const label = document.createElement('span');
            label.className = 'ag-th-label';
            label.textContent = col.label;
            label.title = col.label;

            // Column menu button (⋯)
            const menuBtn = document.createElement('button');
            menuBtn.className = 'ag-col-menu-btn';
            menuBtn.title = 'Column settings';
            menuBtn.innerHTML = '⋯';
            menuBtn.addEventListener('click', e => { e.stopPropagation(); openColPopover(col.id, menuBtn); });

            // Column drag handle
            if (state.canEdit) {
                th.draggable = true;
                th.addEventListener('dragstart', e => startColDrag(e, col.id));
                th.addEventListener('dragover',  e => onColDragOver(e, col.id));
                th.addEventListener('drop',      e => onColDrop(e, col.id, col.groupId));
                th.addEventListener('dragend',   () => endColDrag());
            }

            inner.appendChild(sortBtn);
            inner.appendChild(label);
            inner.appendChild(menuBtn);

            // Resize handle
            const resizer = document.createElement('div');
            resizer.className = 'ag-col-resize';
            attachResizer(resizer, th, col.id);

            th.appendChild(inner);
            th.appendChild(resizer);
            trCols.appendChild(th);
        });

        tableHead.appendChild(trCols);

        // ── Row 3: Per-column filters (optional) ───────────────────────
        if (state.showFilterRow) {
            const trFilter = document.createElement('tr');
            trFilter.className = 'ag-filter-row';

            // spacer for row-num (already accounted for via rowSpan)
            vc.forEach(col => {
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'ag-filter-input';
                input.placeholder = '⌕ filter…';
                input.value = state.filterState.perCol[col.id] || '';
                input.dataset.colId = col.id;
                input.addEventListener('input', () => {
                    state.filterState.perCol[col.id] = input.value;
                    renderBody();
                    renderFooter();
                });
                td.appendChild(input);
                trFilter.appendChild(td);
            });
            tableHead.appendChild(trFilter);
        }
    }

    // ── Render: body rows ──────────────────────────────────────────────
    function renderBody() {
        tableBody.innerHTML = '';
        const vc       = visibleCols();
        const dispRows = computeDisplayRows();

        if (dispRows.length === 0) { renderEmptyState(); return; }

        dispRows.forEach((row, rowIdx) => {
            const tr = document.createElement('tr');
            tr.dataset.rowId = row._id;
            tr.dataset.rowIdx = rowIdx;

            // ── Row number cell ────────────────────────────────────────
            const tdNum = document.createElement('td');
            tdNum.className = 'ag-td-rownum';
            tdNum.style.cssText = 'position:sticky;left:0;z-index:3;';

            const dragHandle = document.createElement('div');
            dragHandle.className = 'ag-row-drag';
            dragHandle.textContent = '⠿';
            dragHandle.title = 'Drag to reorder';

            const numSpan = document.createElement('span');
            numSpan.textContent = rowIdx + 1;

            // Row actions (hover-revealed)
            const rowActions = document.createElement('div');
            rowActions.className = 'ag-row-actions';

            if (state.canEdit) {
                const dupBtn = makeRowActionBtn('📋', 'Duplicate row', () => duplicateRow(row._id));
                const delBtn = makeRowActionBtn('🗑', 'Delete row', async () => {
                    const ok = await showConfirm('Delete row?', 'This cannot be undone.');
                    if (ok) deleteRow(row._id);
                });
                delBtn.classList.add('danger');
                rowActions.appendChild(dupBtn);
                rowActions.appendChild(delBtn);
            }

            tdNum.appendChild(dragHandle);
            tdNum.appendChild(numSpan);
            tdNum.appendChild(rowActions);

            // Row drag-to-reorder
            if (state.canEdit) {
                tr.draggable = false; // only via handle
                dragHandle.addEventListener('mousedown', () => { tr.draggable = true; });
                tr.addEventListener('dragstart', e => startRowDrag(e, rowIdx));
                tr.addEventListener('dragover',  e => onRowDragOver(e, rowIdx));
                tr.addEventListener('drop',      e => onRowDrop(e, rowIdx));
                tr.addEventListener('dragend',   () => endRowDrag());
            }

            tr.appendChild(tdNum);

            // ── Data cells ────────────────────────────────────────────
            vc.forEach((col, colIdx) => {
                const td = document.createElement('td');
                td.dataset.colId  = col.id;
                td.dataset.rowId  = row._id;
                td.classList.add(col.id);   // keep CSS class for legacy compatibility

                const t   = colType(col);
                const val = row[col.id] ?? '';
                const w   = state.colWidths[col.id] || 120;
                td.style.width    = w + 'px';
                td.style.minWidth = w + 'px';

                // Frozen first col
                if (colIdx === 0) {
                    td.classList.add('ag-frozen');
                    td.style.left = '48px';
                }

                // Type-specific classes
                if (isNumericType(col)) td.classList.add('ag-cell-number');
                if (t === 'date')       td.classList.add('ag-cell-date');
                if (t === 'checkbox')   td.classList.add('ag-cell-checkbox');

                // Dirty highlight if row is dirty
                if (state.dirtyRows.has(row._id)) td.classList.add('ag-cell-dirty');

                // Render display value
                renderCellDisplay(td, col, val, row);

                // Click to edit
                td.addEventListener('click', e => {
                    if (e.target.closest('a')) return; // let links through
                    activateCell(td);
                });

                tr.appendChild(td);
            });

            tableBody.appendChild(tr);
        });

        // Update row numbers (always sequential visual display)
        updateRowNumbers();
    }

    /** Render the display-mode content of a cell. */
    function renderCellDisplay(td, col, val, row) {
        const t = colType(col);
        td.innerHTML = '';

        if (t === 'status') {
            td.innerHTML = statusPillHtml(val);
        } else if (t === 'filelink') {
            td.innerHTML = fileLinkHtml(val, col);
        } else if (t === 'checkbox') {
            const cb = document.createElement('input');
            cb.type    = 'checkbox';
            cb.checked = val === true || val === 'true' || val === '1';
            cb.disabled = !state.canEdit;
            cb.style.cssText = 'width:16px;height:16px;accent-color:#022448;cursor:pointer;';
            cb.addEventListener('change', () => {
                updateCell(row._id, col.id, cb.checked ? 'true' : 'false');
            });
            td.appendChild(cb);
        } else if (t === 'currency') {
            td.textContent = val ? `${Number(val).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '';
        } else if (t === 'number') {
            td.textContent = val;
        } else {
            td.textContent = val;
        }
    }

    /** Full re-render: headers + body + footer */
    function renderAll() {
        renderHeaders();
        renderBody();
        renderFooter();
        renderViewMenu();
        applyDensity();
    }

    function updateRowNumbers() {
        let idx = 0;
        tableBody.querySelectorAll('tr:not(.ag-skeleton-row)').forEach(tr => {
            const span = tr.querySelector('.ag-td-rownum span');
            if (span) span.textContent = ++idx;
        });
    }

    // ── Cell update (state-first, then DOM) ────────────────────────────
    function updateCell(rowId, colId, value) {
        const row = rowById(rowId);
        if (!row) return;
        row[colId] = value;
        markDirty(rowId);

        // Update footer totals
        renderFooter();

        // OTDR auto-trigger check
        checkOTDRAutoTrigger(rowId);
    }

    // ── Inline editing ─────────────────────────────────────────────────

    async function activateCell(td) {
        if (!state.canEdit) return;
        if (state.activeCell && state.activeCell.td === td) return;
        if (state.activeCell) commitCell(false);

        const rowId = td.dataset.rowId;
        const colId = td.dataset.colId;
        if (!rowId || !colId) return;

        const col = findCol(colId);
        if (!col) return;
        const row = rowById(rowId);
        if (!row) return;

        state.activeCell     = { rowId, colId, td };
        state.activeCellPrev = row[colId] ?? '';

        td.classList.add('ag-cell-editing');
        const t   = colType(col);
        const val = row[colId] ?? '';

        // ── Render edit widget by type ─────────────────────────────────
        td.innerHTML = '';

        if (t === 'status') {
            const sel = buildStatusSelect(val, col);
            sel.addEventListener('change', () => {
                updateCell(rowId, colId, sel.value);
                checkOTDRAutoTrigger(rowId);
                commitCell(true);
            });
            sel.addEventListener('blur', () => commitCell(true));
            td.appendChild(sel);
            sel.focus();

        } else if (t === 'dropdown') {
            const opts = col.options || [];
            const sel  = document.createElement('select');
            sel.style.cssText = 'width:100%;height:100%;background:transparent;border:none;outline:none;font-family:inherit;font-size:13px;';
            sel.innerHTML = `<option value=""></option>` +
                opts.map(o => `<option value="${escHtml(o)}" ${val === o ? 'selected' : ''}>${escHtml(o)}</option>`).join('');
            sel.addEventListener('change', () => updateCell(rowId, colId, sel.value));
            sel.addEventListener('blur', () => commitCell(true));
            td.appendChild(sel);
            sel.focus();

        } else if (t === 'cluster') {
            const sel = await buildClusterSelect(val, td, rowId);
            sel.addEventListener('blur', () => commitCell(true));
            td.appendChild(sel);
            sel.focus();

        } else if (t === 'knotenpunkt') {
            const clusterVal = getClusterValueFromRow(rowId);
            const sel = await buildKnotenSelect(clusterVal, val, td, rowId);
            sel.addEventListener('blur', () => commitCell(true));
            td.appendChild(sel);
            sel.focus();

        } else if (t === 'fiberdropdown') {
            const sel = buildFiberDropdown(val);
            sel.addEventListener('change', () => updateCell(rowId, colId, sel.value));
            sel.addEventListener('blur', () => commitCell(true));
            td.appendChild(sel);
            sel.focus();

        } else if (t === 'date') {
            const inp = document.createElement('input');
            inp.type  = 'date';
            inp.value = val;
            inp.style.cssText = 'width:100%;background:transparent;border:none;outline:none;font-family:inherit;font-size:13px;';
            inp.addEventListener('change', () => updateCell(rowId, colId, inp.value));
            inp.addEventListener('blur', () => commitCell(true));
            td.appendChild(inp);
            inp.focus();

        } else if (t === 'number' || t === 'currency') {
            const inp = document.createElement('input');
            inp.type  = 'number';
            inp.value = val;
            inp.style.cssText = 'width:100%;text-align:right;background:transparent;border:none;outline:none;font-family:inherit;font-size:13px;font-variant-numeric:tabular-nums;';
            inp.addEventListener('input', () => updateCell(rowId, colId, inp.value));
            inp.addEventListener('blur', () => commitCell(true));
            td.appendChild(inp);
            inp.focus();
            inp.select();

        } else if (t === 'checkbox') {
            // Checkbox handled inline, no edit mode needed
            state.activeCell = null;
            td.classList.remove('ag-cell-editing');

        } else if (t === 'filelink') {
            // File links are read-only in the grid
            state.activeCell = null;
            td.classList.remove('ag-cell-editing');

        } else {
            // Default: text / contenteditable
            td.setAttribute('contenteditable', 'true');
            td.focus();
            // Cursor to end
            const range = document.createRange();
            const sel2  = window.getSelection();
            range.selectNodeContents(td);
            range.collapse(false);
            sel2.removeAllRanges();
            sel2.addRange(range);

            td.addEventListener('input', () => {
                updateCell(rowId, colId, td.textContent.trim());
            }, { once: false });
        }
    }

    function commitCell(showConfirmFlash) {
        if (!state.activeCell) return;
        const { rowId, colId, td } = state.activeCell;
        state.activeCell = null;

        td.classList.remove('ag-cell-editing');
        td.removeAttribute('contenteditable');

        // Re-render display for non-contenteditable types
        const col = findCol(colId);
        const row = rowById(rowId);
        if (!col || !row) return;

        const val = row[colId] ?? '';
        const wasChanged = val !== state.activeCellPrev;

        renderCellDisplay(td, col, val, row);

        if (wasChanged && showConfirmFlash) {
            flashConfirm(td);
        }
    }

    function cancelCell() {
        if (!state.activeCell) return;
        const { rowId, colId, td } = state.activeCell;
        const row = rowById(rowId);
        if (row) row[colId] = state.activeCellPrev;  // revert state
        state.activeCell = null;
        td.classList.remove('ag-cell-editing');
        td.removeAttribute('contenteditable');
        // Re-render with original value
        const col = findCol(colId);
        if (col && row) renderCellDisplay(td, col, state.activeCellPrev, row);
    }

    function flashConfirm(td) {
        const el = document.createElement('span');
        el.className   = 'ag-cell-confirm';
        el.textContent = '✓';
        td.style.position = 'relative';
        td.appendChild(el);
        setTimeout(() => el.remove(), 750);
    }

    // ── Global click: commit active cell ───────────────────────────────
    document.addEventListener('mousedown', e => {
        if (!state.activeCell) return;
        if (state.activeCell.td.contains(e.target)) return;
        if (e.target.closest('.ag-popover')) return;
        if (e.target.closest('#modal-overlay')) return;
        commitCell(true);
    });

    // ── Keyboard navigation ────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.target.closest('#modal-overlay') || e.target.closest('.ag-popover')) return;

        if (!state.activeCell) {
            // Arrow key navigation without active cell
            return;
        }

        const { rowId, colId, td } = state.activeCell;
        const isContentEditable = td.getAttribute('contenteditable') === 'true';

        if (e.key === 'Escape') {
            e.preventDefault();
            cancelCell();

        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitCell(true);
            // Move to same column, next row
            const vc = visibleCols();
            const dispRows = computeDisplayRows();
            const rIdx = dispRows.findIndex(r => r._id === rowId);
            if (rIdx < dispRows.length - 1) {
                const nextRow = dispRows[rIdx + 1];
                const nextTd = tableBody.querySelector(
                    `tr[data-row-id="${CSS.escape(nextRow._id)}"] td[data-col-id="${CSS.escape(colId)}"]`
                );
                if (nextTd) setTimeout(() => activateCell(nextTd), 0);
            }

        } else if (e.key === 'Tab') {
            e.preventDefault();
            commitCell(true);
            const vc = visibleCols();
            const allTds = Array.from(tableBody.querySelectorAll('td[data-col-id]'));
            const idx = allTds.indexOf(td);
            const next = e.shiftKey ? allTds[idx - 1] : allTds[idx + 1];
            if (next) setTimeout(() => activateCell(next), 0);

        } else if (e.key === 'ArrowDown' && !isContentEditable) {
            e.preventDefault();
            commitCell(true);
            const dispRows = computeDisplayRows();
            const rIdx = dispRows.findIndex(r => r._id === rowId);
            if (rIdx < dispRows.length - 1) {
                const nextRow = dispRows[rIdx + 1];
                const nextTd = tableBody.querySelector(
                    `tr[data-row-id="${CSS.escape(nextRow._id)}"] td[data-col-id="${CSS.escape(colId)}"]`
                );
                if (nextTd) setTimeout(() => activateCell(nextTd), 0);
            }

        } else if (e.key === 'ArrowUp' && !isContentEditable) {
            e.preventDefault();
            commitCell(true);
            const dispRows = computeDisplayRows();
            const rIdx = dispRows.findIndex(r => r._id === rowId);
            if (rIdx > 0) {
                const prevRow = dispRows[rIdx - 1];
                const prevTd = tableBody.querySelector(
                    `tr[data-row-id="${CSS.escape(prevRow._id)}"] td[data-col-id="${CSS.escape(colId)}"]`
                );
                if (prevTd) setTimeout(() => activateCell(prevTd), 0);
            }
        }
    });

    // ── Sort ───────────────────────────────────────────────────────────
    function toggleSort(colId) {
        if (state.sortState.colId === colId) {
            if (state.sortState.asc) {
                state.sortState.asc = false;
            } else {
                state.sortState = { colId: null, asc: true }; // clear
            }
        } else {
            state.sortState = { colId, asc: true };
        }
        saveViewState();
        renderAll();
    }

    // ── Search ─────────────────────────────────────────────────────────
    const searchInput   = document.getElementById('tableSearch');
    const searchClearBtn= document.getElementById('searchClearBtn');

    searchInput?.addEventListener('input', e => {
        state.filterState.global = e.target.value;
        if (searchClearBtn) searchClearBtn.style.display = e.target.value ? '' : 'none';
        renderBody();
        renderFooter();
    });
    searchClearBtn?.addEventListener('click', () => {
        state.filterState.global = '';
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
        renderBody();
        renderFooter();
    });

    // ── Column resize ──────────────────────────────────────────────────
    function attachResizer(handle, th, colId) {
        let startX = 0, startW = 0, isDown = false;

        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            isDown = true;
            startX = e.clientX;
            startW = th.getBoundingClientRect().width;
            handle.classList.add('ag-resizing');

            const onMove = e2 => {
                if (!isDown) return;
                const newW = Math.max(60, startW + (e2.clientX - startX));
                th.style.width    = newW + 'px';
                th.style.minWidth = newW + 'px';
                // Update all cells in this column
                document.querySelectorAll(
                    `td[data-col-id="${CSS.escape(colId)}"], #table-footer td[data-col-id="${CSS.escape(colId)}"]`
                ).forEach(td => {
                    td.style.width    = newW + 'px';
                    td.style.minWidth = newW + 'px';
                });
                state.colWidths[colId] = newW;
            };

            const onUp = () => {
                isDown = false;
                handle.classList.remove('ag-resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                saveViewState();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Row drag-to-reorder ────────────────────────────────────────────
    function startRowDrag(e, fromIdx) {
        state.rowDragSrcIdx = fromIdx;
        e.dataTransfer.effectAllowed = 'move';
    }

    function onRowDragOver(e, overIdx) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tableBody.querySelectorAll('tr').forEach((tr, i) => {
            tr.classList.toggle('ag-row-drag-over', i === overIdx && i !== state.rowDragSrcIdx);
        });
    }

    function onRowDrop(e, toIdx) {
        e.preventDefault();
        if (state.rowDragSrcIdx === null || state.rowDragSrcIdx === toIdx) return;

        const dispRows = computeDisplayRows();
        const srcRow   = dispRows[state.rowDragSrcIdx];
        const tgtRow   = dispRows[toIdx];

        // Find in state.data and reorder
        const srcStateIdx = state.data.findIndex(r => r._id === srcRow._id);
        const tgtStateIdx = state.data.findIndex(r => r._id === tgtRow._id);
        if (srcStateIdx < 0 || tgtStateIdx < 0) return;

        const [moved] = state.data.splice(srcStateIdx, 1);
        state.data.splice(tgtStateIdx, 0, moved);

        markDirty(moved._id);
        renderBody();
        renderFooter();
        endRowDrag();
    }

    function endRowDrag() {
        state.rowDragSrcIdx = null;
        tableBody.querySelectorAll('tr').forEach(tr => tr.classList.remove('ag-row-drag-over'));
        // Reset draggable after drop
        tableBody.querySelectorAll('tr').forEach(tr => { tr.draggable = false; });
    }

    // ── Column drag-to-reorder ─────────────────────────────────────────
    function startColDrag(e, colId) {
        state.colDragSrcId = colId;
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('ag-col-dragging');
    }

    function onColDragOver(e, colId) {
        e.preventDefault();
        if (colId === state.colDragSrcId) return;
        tableHead.querySelectorAll('.ag-th-col').forEach(th => {
            th.classList.toggle('ag-col-drag-over', th.dataset.colId === colId);
        });
    }

    function onColDrop(e, toColId, groupId) {
        e.preventDefault();
        if (!state.colDragSrcId || state.colDragSrcId === toColId) return;

        const grp = findGroup(groupId);
        if (!grp) return;
        const srcIdx = grp.cols.findIndex(c => c.id === state.colDragSrcId);
        const tgtIdx = grp.cols.findIndex(c => c.id === toColId);
        if (srcIdx < 0 || tgtIdx < 0) return;  // cross-group drag: ignore for now

        const [moved] = grp.cols.splice(srcIdx, 1);
        grp.cols.splice(tgtIdx, 0, moved);

        // Mark schema as dirty (will be saved with data)
        state.dirtyRows.add('__schema__');
        updateEditBar();
        renderAll();
        endColDrag();
    }

    function endColDrag() {
        state.colDragSrcId = null;
        tableHead.querySelectorAll('.ag-th-col').forEach(th => {
            th.classList.remove('ag-col-drag-over', 'ag-col-dragging');
        });
    }

    // ── Row operations ─────────────────────────────────────────────────
    function addRow(position, anchorRowId) {
        const newRow = { _id: makeRowId(), _version: 0 };
        allCols().forEach(c => { newRow[c.id] = ''; });

        if (anchorRowId) {
            const idx = rowIndex(anchorRowId);
            if (position === 'above') state.data.splice(idx, 0, newRow);
            else                      state.data.splice(idx + 1, 0, newRow);
        } else {
            state.data.push(newRow);
        }

        renderBody();
        renderFooter();
        markDirty(newRow._id);
        // Scroll to new row
        setTimeout(() => {
            const tr = tableBody.querySelector(`tr[data-row-id="${CSS.escape(newRow._id)}"]`);
            if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
        return newRow._id;
    }

    function deleteRow(rowId) {
        state.data = state.data.filter(r => r._id !== rowId);
        state.dirtyRows.delete(rowId);
        // Mark something dirty so save bar appears
        state.dirtyRows.add('__deleted__');
        updateEditBar();
        renderBody();
        renderFooter();
    }

    function duplicateRow(rowId) {
        const orig = rowById(rowId);
        if (!orig) return;
        const copy = { ...orig, _id: makeRowId(), _version: 0 };
        const idx  = rowIndex(rowId);
        state.data.splice(idx + 1, 0, copy);
        markDirty(copy._id);
        renderBody();
        renderFooter();
    }

    function makeRowActionBtn(icon, title, onClick) {
        const btn = document.createElement('button');
        btn.className = 'ag-row-action-btn';
        btn.title     = title;
        btn.textContent = icon;
        btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return btn;
    }

    addRowBtn?.addEventListener('click', () => addRow());

    // ── Column settings popover ────────────────────────────────────────
    function openColPopover(colId, anchorEl) {
        closePopover();

        const col = findCol(colId);
        if (!col) return;
        const grp = state.schema.find(g => g.cols.some(c => c.id === colId));
        if (!grp) return;

        const pop = document.createElement('div');
        pop.className = 'ag-popover';
        pop.id = 'ag-col-popover';

        pop.innerHTML = `
            <div class="ag-popover-header">
                <span>Column Settings</span>
                <button class="ag-popover-close">✕</button>
            </div>
            <div class="ag-popover-body">
                <div class="ag-popover-field">
                    <label class="ag-popover-label">Column Name</label>
                    <input class="ag-popover-input" id="pop-col-name" type="text" value="${escHtml(col.label)}">
                </div>
                <div class="ag-popover-field">
                    <label class="ag-popover-label">Type</label>
                    <select class="ag-popover-select" id="pop-col-type">
                        <option value="text"      ${colType(col)==='text'      ?'selected':''}>Text</option>
                        <option value="number"    ${colType(col)==='number'    ?'selected':''}>Number</option>
                        <option value="currency"  ${colType(col)==='currency'  ?'selected':''}>Currency (€)</option>
                        <option value="date"      ${colType(col)==='date'      ?'selected':''}>Date</option>
                        <option value="dropdown"  ${colType(col)==='dropdown'  ?'selected':''}>Dropdown</option>
                        <option value="status"    ${colType(col)==='status'    ?'selected':''}>Status (pill)</option>
                        <option value="checkbox"  ${colType(col)==='checkbox'  ?'selected':''}>Checkbox</option>
                    </select>
                </div>
                <div class="ag-popover-field" id="pop-options-field">
                    <label class="ag-popover-label">Options (one per line)</label>
                    <textarea class="ag-popover-textarea" id="pop-col-options">${(col.options || []).join('\n')}</textarea>
                    <span class="text-xs text-slate-400">Used for Dropdown and Status types</span>
                </div>
                <div class="ag-popover-field">
                    <label class="ag-popover-label">Footer roll-up</label>
                    <select class="ag-popover-select" id="pop-col-totals">
                        <option value="none"  ${(col.totals||'none')==='none'  ?'selected':''}>None</option>
                        <option value="sum"   ${col.totals==='sum'   ?'selected':''}>Sum</option>
                        <option value="avg"   ${col.totals==='avg'   ?'selected':''}>Average</option>
                        <option value="count" ${col.totals==='count' ?'selected':''}>Count</option>
                    </select>
                </div>
                <div class="ag-popover-divider"></div>
                <div class="ag-popover-toggle-row">
                    <span>Hidden</span>
                    <label class="ag-toggle">
                        <input type="checkbox" id="pop-col-hidden" ${state.hiddenCols.has(colId) ? 'checked' : ''}>
                        <span class="ag-toggle-track"></span>
                        <span class="ag-toggle-thumb"></span>
                    </label>
                </div>
            </div>
            <div class="ag-popover-footer">
                <button class="ag-popover-delete-btn" id="pop-col-delete" title="Delete this column">Delete</button>
                <button class="ag-popover-save-btn" id="pop-col-save">Apply</button>
            </div>`;

        document.body.appendChild(pop);
        state.openPopover = pop;

        // Show/hide options textarea based on type
        const typeSelect  = pop.querySelector('#pop-col-type');
        const optField    = pop.querySelector('#pop-options-field');
        const updateOpts  = () => {
            const t = typeSelect.value;
            optField.style.display = (t === 'dropdown' || t === 'status') ? '' : 'none';
        };
        updateOpts();
        typeSelect.addEventListener('change', updateOpts);

        // Position
        const rect = anchorEl.getBoundingClientRect();
        pop.style.top  = (rect.bottom + 4) + 'px';
        pop.style.left = Math.min(rect.left, window.innerWidth - 270) + 'px';

        // Close
        pop.querySelector('.ag-popover-close').addEventListener('click', closePopover);

        // Save
        pop.querySelector('#pop-col-save').addEventListener('click', () => {
            const newLabel   = pop.querySelector('#pop-col-name').value.trim();
            const newType    = pop.querySelector('#pop-col-type').value;
            const newOptions = pop.querySelector('#pop-col-options').value
                                    .split('\n').map(s => s.trim()).filter(Boolean);
            const newTotals  = pop.querySelector('#pop-col-totals').value;
            const isHidden   = pop.querySelector('#pop-col-hidden').checked;

            col.label   = newLabel   || col.label;
            col.type    = newType;
            col.options = newOptions;
            col.totals  = newTotals;

            if (isHidden) state.hiddenCols.add(colId);
            else          state.hiddenCols.delete(colId);

            state.dirtyRows.add('__schema__');
            updateEditBar();
            saveViewState();
            closePopover();
            renderAll();
        });

        // Delete column
        pop.querySelector('#pop-col-delete').addEventListener('click', async () => {
            const ok = await showConfirm(`Delete column "${col.label}"?`, 'All data in this column will be lost permanently.');
            if (!ok) return;
            closePopover();
            removeColumn(colId, grp.id);
        });
    }

    function closePopover() {
        if (state.openPopover) {
            state.openPopover.remove();
            state.openPopover = null;
        }
    }

    document.addEventListener('click', e => {
        if (!state.openPopover) return;
        if (!state.openPopover.contains(e.target) &&
            !e.target.closest('.ag-col-menu-btn') &&
            !e.target.closest('.ag-add-group-btn') &&
            !e.target.closest('.ag-schema-menu')) {
            closePopover();
        }
    });

    // ── Schema management ──────────────────────────────────────────────

    async function promptAddGroup() {
        const title = await showPrompt('New Group', 'Enter group name (e.g. "Inspection")');
        if (!title?.trim()) return;
        const firstCol = await showPrompt('First Column', `Name of the first column in "${title.trim()}"`);
        if (!firstCol?.trim()) return;

        const groupId = makeColId('grp-', title);
        const colId   = makeColId('col-', firstCol);

        state.schema.push({
            id:      groupId,
            title:   title.trim(),
            cols: [{ id: colId, label: firstCol.trim(), type: 'text', totals: 'none', display: {} }],
        });

        state.dirtyRows.add('__schema__');
        updateEditBar();
        renderAll();
    }

    async function promptAddColumn(groupId) {
        const grp = findGroup(groupId);
        if (!grp) return;
        const name = await showPrompt('New Column', `Add column to "${grp.title}"`);
        if (!name?.trim()) return;

        const colId = makeColId('col-', name);
        grp.cols.push({ id: colId, label: name.trim(), type: 'text', totals: 'none', display: {} });

        // Add empty value for all rows
        state.data.forEach(r => { r[colId] = ''; });

        state.dirtyRows.add('__schema__');
        updateEditBar();
        renderAll();
    }

    function removeColumn(colId, groupId) {
        const grp = findGroup(groupId);
        if (!grp) return;
        grp.cols = grp.cols.filter(c => c.id !== colId);
        if (grp.cols.length === 0) {
            state.schema = state.schema.filter(g => g.id !== groupId);
        }
        // Remove from all row data
        state.data.forEach(r => { delete r[colId]; });

        state.hiddenCols.delete(colId);
        state.dirtyRows.add('__schema__');
        updateEditBar();
        renderAll();
    }

    // ── Copy schema from another project ──────────────────────────────
    document.getElementById('copySchemaBtn')?.addEventListener('click', async () => {
        const other = await showPrompt('Copy Schema', 'Enter the project name to copy the schema from:');
        if (!other?.trim()) return;
        if (other.trim() === projectName) {
            await showAlert('Cannot copy schema from the same project.');
            return;
        }
        try {
            const res  = await apiFetch(`/api/data?project=${encodeURIComponent(other.trim())}`);
            const data = await res.json();
            if (!data.success || !data.schema) {
                await showAlert(`Could not load schema for "${other.trim()}".`);
                return;
            }
            const ok = await showConfirm(
                'Apply schema?',
                `This will replace the column structure with the one from "${other.trim()}". Existing row data will be preserved where column IDs match.`
            );
            if (!ok) return;
            // Merge schema: keep data columns that exist in new schema; add empty for new ones
            state.schema = data.schema;
            state.data.forEach(row => {
                const allColIds = new Set(allCols().map(c => c.id));
                allColIds.forEach(cid => { if (!(cid in row)) row[cid] = ''; });
            });
            state.dirtyRows.add('__schema__');
            updateEditBar();
            renderAll();
        } catch (e) {
            await showAlert('Failed to fetch schema: ' + e.message);
        }
    });

    // ── View / Column visibility panel ────────────────────────────────
    function renderViewMenu() {
        if (!viewFilterContent) return;
        let html = `
<div class="flex gap-2 mb-3 pb-3 border-b border-slate-200 items-center justify-between flex-wrap gap-y-2">
    <div class="flex gap-2">
        <button id="hideExtrasBtn" class="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">Hide Extras</button>
        <button id="showAllBtn" class="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">Show All</button>
    </div>
    <button class="ag-reset-view" id="resetViewBtn">Reset view</button>
</div>`;

        const toggleFilterLabel = state.showFilterRow ? '✕ Filters' : '⌕ Filters';
        html += `<button id="toggleFilterRowBtn" class="w-full mb-3 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">${toggleFilterLabel}</button>`;

        state.schema.forEach(grp => {
            if (isIdentificationGroup(grp)) return;
            const allVis = grp.cols.every(c => !state.hiddenCols.has(c.id));
            html += `<div class="mb-1">
                <label class="flex justify-between font-semibold text-slate-700 bg-slate-50 px-2 py-1.5 rounded cursor-pointer text-sm">
                    <span class="flex items-center gap-2">
                        <input type="checkbox" class="group-toggle" data-group-id="${escHtml(grp.id)}" ${allVis ? 'checked' : ''}>
                        ${escHtml(grp.title)}
                    </span>
                </label>
                <div class="ml-5 flex flex-col gap-0.5 mt-1">`;
            grp.cols.forEach(col => {
                const vis = !state.hiddenCols.has(col.id);
                html += `<label class="flex gap-2 text-slate-500 cursor-pointer text-xs py-0.5">
                    <input type="checkbox" class="col-toggle" data-col-id="${escHtml(col.id)}" data-group-id="${escHtml(grp.id)}" ${vis ? 'checked' : ''}>
                    ${escHtml(col.label)}
                </label>`;
            });
            html += `</div></div>`;
        });

        viewFilterContent.innerHTML = html;

        document.getElementById('resetViewBtn')?.addEventListener('click', () => resetViewState());
        document.getElementById('toggleFilterRowBtn')?.addEventListener('click', () => {
            state.showFilterRow = !state.showFilterRow;
            saveViewState();
            renderHeaders();
        });
        document.getElementById('hideExtrasBtn')?.addEventListener('click', () => {
            const essential = ['timing', 'location', 'address', 'hardware'];
            state.schema.forEach(grp => {
                if (isIdentificationGroup(grp)) return;
                const isEss = essential.some(e => grp.title.toLowerCase().includes(e));
                grp.cols.forEach(c => {
                    if (isEss) state.hiddenCols.delete(c.id);
                    else       state.hiddenCols.add(c.id);
                });
            });
            saveViewState();
            renderAll();
        });
        document.getElementById('showAllBtn')?.addEventListener('click', () => {
            state.hiddenCols.clear();
            saveViewState();
            renderAll();
        });

        viewFilterContent.querySelectorAll('.col-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const cid = cb.dataset.colId;
                if (cb.checked) state.hiddenCols.delete(cid);
                else            state.hiddenCols.add(cid);
                saveViewState();
                renderAll();
            });
        });
        viewFilterContent.querySelectorAll('.group-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const gid = cb.dataset.groupId;
                const grp = findGroup(gid);
                if (!grp) return;
                grp.cols.forEach(c => {
                    if (cb.checked) state.hiddenCols.delete(c.id);
                    else            state.hiddenCols.add(c.id);
                });
                saveViewState();
                renderAll();
            });
        });
    }

    document.getElementById('viewFilterBtn')?.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('viewFilterMenu')?.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('#viewFilterMenu') && !e.target.closest('#viewFilterBtn')) {
            document.getElementById('viewFilterMenu')?.classList.add('hidden');
        }
    });

    // ── OTDR auto-trigger ──────────────────────────────────────────────
    function checkOTDRAutoTrigger(rowId) {
        const row = rowById(rowId);
        if (!row) return;

        let aplColId = null, knotenColId = null, otdrColId = null;
        state.schema.forEach(g => {
            g.cols.forEach(c => {
                const lbl = c.label.toLowerCase();
                if (lbl === 'apl status')          aplColId   = c.id;
                if (lbl === 'knotenpunkt status')   knotenColId = c.id;
                if (!otdrColId && g.title.toLowerCase().includes('otdr') && lbl.includes('status')) {
                    otdrColId = c.id;
                }
            });
        });

        if (!aplColId || !knotenColId || !otdrColId) return;

        const aplDone    = (row[aplColId] || '').trim() === 'Done';
        const knotenDone = (row[knotenColId] || '').trim() === 'Done';
        const otdrCur    = (row[otdrColId] || '').trim();

        if (aplDone && knotenDone && otdrCur !== 'Done' && otdrCur !== 'Waiting') {
            row[otdrColId] = 'Waiting';
            // Update the DOM cell if visible
            const td = tableBody.querySelector(
                `tr[data-row-id="${CSS.escape(rowId)}"] td[data-col-id="${CSS.escape(otdrColId)}"]`
            );
            if (td) {
                const col = findCol(otdrColId);
                if (col) renderCellDisplay(td, col, 'Waiting', row);
            }
        }
    }

    // ── Cluster / Knotenpunkt dropdowns ───────────────────────────────

    async function fetchClusters(force) {
        if (state.clusters && !force) return state.clusters;
        try {
            const r = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/clusters`);
            const j = await r.json();
            state.clusters = j.success ? j.clusters : [];
        } catch (_) { state.clusters = []; }
        return state.clusters;
    }

    async function fetchKnoten(clusterName, force) {
        if (state.knotenCache[clusterName] && !force) return state.knotenCache[clusterName];
        if (!clusterName) return [];
        try {
            const r = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/knotenpunkte?cluster=${encodeURIComponent(clusterName)}`);
            const j = await r.json();
            state.knotenCache[clusterName] = j.success ? j.knotenpunkte : [];
        } catch (_) { state.knotenCache[clusterName] = []; }
        return state.knotenCache[clusterName];
    }

    function getClusterValueFromRow(rowId) {
        const row = rowById(rowId);
        if (!row) return '';
        for (const g of state.schema) {
            for (const c of g.cols) {
                if (c.label.toLowerCase() === 'cluster') return row[c.id] || '';
            }
        }
        return '';
    }

    async function buildClusterSelect(currentVal, td, rowId) {
        const clusters = await fetchClusters();
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;height:100%;background:transparent;border:none;outline:none;font-size:13px;font-family:inherit;';

        let opts = clusters.slice();
        if (currentVal && !opts.includes(currentVal)) opts.unshift(currentVal);
        opts.forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            if (c === currentVal) o.selected = true;
            sel.appendChild(o);
        });
        const addOpt = document.createElement('option');
        addOpt.value = '__add__'; addOpt.textContent = '➕ Add New…';
        sel.appendChild(addOpt);

        sel.addEventListener('change', async () => {
            if (sel.value === '__add__') {
                const name = await showPrompt('New Cluster', 'Enter cluster name');
                if (name?.trim()) {
                    await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/clusters`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name.trim() })
                    });
                    state.clusters = null;
                    const newSel = await buildClusterSelect(name.trim(), td, rowId);
                    td.innerHTML = '';
                    td.appendChild(newSel);
                    const colId = td.dataset.colId;
                    updateCell(rowId, colId, name.trim());
                } else {
                    sel.value = currentVal;
                }
            } else {
                updateCell(rowId, td.dataset.colId, sel.value);
            }
        });
        return sel;
    }

    async function buildKnotenSelect(clusterName, currentVal, td, rowId) {
        const knoten = await fetchKnoten(clusterName);
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;height:100%;background:transparent;border:none;outline:none;font-size:13px;font-family:inherit;';
        sel.dataset.cluster = clusterName;

        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = '';
        sel.appendChild(empty);

        let opts = knoten.slice();
        if (currentVal && !opts.includes(currentVal)) opts.unshift(currentVal);
        opts.forEach(k => {
            const o = document.createElement('option');
            o.value = k; o.textContent = k;
            if (k === currentVal) o.selected = true;
            sel.appendChild(o);
        });
        const addOpt = document.createElement('option');
        addOpt.value = '__add__'; addOpt.textContent = '➕ Add New…';
        sel.appendChild(addOpt);

        sel.addEventListener('change', async () => {
            if (sel.value === '__add__') {
                const name = await showPrompt('New Knotenpunkt', 'e.g. NVT-005');
                if (name?.trim()) {
                    await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/knotenpunkte`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cluster: clusterName, name: name.trim() })
                    });
                    delete state.knotenCache[clusterName];
                    const newSel = await buildKnotenSelect(clusterName, name.trim(), td, rowId);
                    td.innerHTML = '';
                    td.appendChild(newSel);
                    updateCell(rowId, td.dataset.colId, name.trim());
                } else {
                    sel.value = currentVal;
                }
            } else {
                updateCell(rowId, td.dataset.colId, sel.value);
            }
        });
        return sel;
    }

    function buildFiberDropdown(currentVal) {
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;height:100%;background:transparent;border:none;outline:none;font-size:13px;font-family:inherit;';
        ['', '6', '12', '24', '48', '96', '288'].forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v || '—';
            if (v === currentVal) o.selected = true;
            sel.appendChild(o);
        });
        return sel;
    }

    function buildStatusSelect(currentVal, col) {
        const opts = col.options?.length ? col.options : STATUS_OPTS;
        const sel  = document.createElement('select');
        sel.style.cssText = 'width:100%;height:100%;background:transparent;border:none;outline:none;font-size:13px;font-family:inherit;';
        sel.innerHTML = `<option value=""></option>` +
            opts.map(o => `<option value="${escHtml(o)}" ${currentVal===o?'selected':''}>${escHtml(o)}</option>`).join('');
        return sel;
    }

    // ── Save / Discard ─────────────────────────────────────────────────
    saveBtn?.addEventListener('click', async () => {
        if (state.activeCell) commitCell(true);

        const origTxt = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = 'Saving…';

        // Build schema in API shape (ensure cols array from groups)
        const apiSchema = state.schema.map(g => ({
            id:      g.id,
            title:   g.title,
            cols:    g.cols.map(c => ({ id: c.id, label: c.label, type: c.type, options: c.options, display: c.display || {}, totals: c.totals })),
            columns: g.cols, // also include raw for DB store
        }));

        // Build data — only include col IDs in schema
        const allColIds = new Set(apiSchema.flatMap(g => g.cols.map(c => c.id)));
        const saveData  = state.data.map(row => {
            const r = { _id: row._id, _version: row._version || 0 };
            allColIds.forEach(cid => { r[cid] = row[cid] ?? ''; });
            return r;
        });

        try {
            const res = await apiFetch(
                `/api/data?project=${encodeURIComponent(projectName)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ schema: apiSchema, data: saveData }),
                }
            );
            const result = await res.json();

            if (!result.success) {
                if (result.conflict) {
                    showConflictBanner(result.message || 'Conflict detected. Please refresh.');
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = origTxt;
                    return;
                }
                throw new Error(result.message || 'Save failed');
            }

            // Update row versions from server
            if (result.rowVersions) {
                state.data.forEach(row => {
                    if (result.rowVersions[row._id] !== undefined) {
                        row._version = result.rowVersions[row._id];
                    }
                });
            }

            state.originalData = JSON.parse(JSON.stringify(state.data));
            state.dirtyRows.clear();
            updateEditBar();
            tableBody.querySelectorAll('.ag-cell-dirty').forEach(td => td.classList.remove('ag-cell-dirty'));

            saveBtn.innerHTML = 'Saved ✓';
            setTimeout(() => { saveBtn.innerHTML = origTxt; saveBtn.disabled = false; }, 1200);

        } catch (err) {
            await showAlert('Save failed: ' + (err.message || 'Please try again.'));
            saveBtn.disabled = false;
            saveBtn.innerHTML = origTxt;
        }
    });

    discardBtn?.addEventListener('click', async () => {
        const ok = await showConfirm('Discard changes?', 'All unsaved changes will be lost.');
        if (!ok) return;
        state.data = JSON.parse(JSON.stringify(state.originalData));
        state.dirtyRows.clear();
        updateEditBar();
        renderAll();
    });

    function showConflictBanner(msg) {
        let banner = document.getElementById('ag-conflict-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'ag-conflict-banner';
            banner.className = 'ag-conflict-banner';
            editPanel?.parentNode?.insertBefore(banner, editPanel);
        }
        banner.innerHTML = `<span>⚠</span><span><strong>Conflict:</strong> ${escHtml(msg)} <button class="underline ml-2" onclick="location.reload()">Reload</button></span>`;
        banner.style.display = 'flex';
        setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
    }

    // ── Excel export ───────────────────────────────────────────────────
    document.getElementById('excelBtn')?.addEventListener('click', () => {
        if (!state.schema.length) { showAlert('No data loaded.'); return; }
        if (typeof XLSX === 'undefined') { showAlert('Excel library not loaded.'); return; }

        const vc = visibleCols();
        if (!vc.length) { showAlert('No visible columns to export.'); return; }

        // Build group header row (merge info)
        const row0   = [];
        const row1   = [];
        const merges = [];
        let colOffset = 0;

        state.schema.forEach(g => {
            if (isIdentificationGroup(g)) return;
            const groupVc = g.cols.filter(c => !state.hiddenCols.has(c.id));
            if (!groupVc.length) return;

            const start = colOffset;
            groupVc.forEach(c => { row0.push(g.title); row1.push(c.label); });
            if (groupVc.length > 1) {
                merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + groupVc.length - 1 } });
            }
            colOffset += groupVc.length;
        });

        const wsData = [row0, row1];
        const dispRows = computeDisplayRows();
        dispRows.forEach(row => {
            wsData.push(vc.map(c => {
                const val = row[c.id] ?? '';
                const t = colType(c);
                if (t === 'number' || t === 'currency') return Number(val) || val;
                return val;
            }));
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!merges'] = merges;

        // Basic styling
        const border = { style: 'thin', color: { rgb: 'B0B0B0' } };
        const b4 = { top: border, bottom: border, left: border, right: border };
        const colWidths = vc.map(() => ({ wch: 12 }));

        for (let R = 0; R < wsData.length; R++) {
            for (let C = 0; C < vc.length; C++) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                const cell = ws[addr];
                const len = String(cell.v || '').length + 2;
                if (len > colWidths[C].wch) colWidths[C].wch = Math.min(len, 40);
                const sty = { border: b4, alignment: { vertical: 'center' } };
                if (R === 0) {
                    sty.fill = { fgColor: { rgb: '022448' } };
                    sty.font = { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 };
                    sty.alignment.horizontal = 'center';
                } else if (R === 1) {
                    sty.fill = { fgColor: { rgb: '1E3A5F' } };
                    sty.font = { bold: true, color: { rgb: 'ADC8F5' }, sz: 9 };
                    sty.alignment.horizontal = 'center';
                } else {
                    sty.font = { sz: 9 };
                    const col = vc[C];
                    const v   = String(cell.v || '').toLowerCase().trim();
                    if (colType(col) === 'status') {
                        if (v === 'done')    { sty.fill = { fgColor: { rgb: 'DCFCE7' } }; sty.font = { bold: true, color: { rgb: '15803D' }, sz: 9 }; }
                        else if (v === 'pending') { sty.fill = { fgColor: { rgb: 'FEF9C3' } }; sty.font = { bold: true, color: { rgb: 'A16207' }, sz: 9 }; }
                        else if (v === 'waiting') { sty.fill = { fgColor: { rgb: 'DBEAFE' } }; sty.font = { bold: true, color: { rgb: '1D4ED8' }, sz: 9 }; }
                        else if (v === 'error')   { sty.fill = { fgColor: { rgb: 'FEE2E2' } }; sty.font = { bold: true, color: { rgb: 'B91C1C' }, sz: 9 }; }
                        else if (v === 'n/a' || v === '') { sty.fill = { fgColor: { rgb: 'F1F5F9' } }; sty.font = { bold: true, color: { rgb: '64748B' }, sz: 9 }; }
                    }
                }
                cell.s = sty;
            }
        }
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, projectName.substring(0, 31));
        XLSX.writeFile(wb, `${projectName}_Export.xlsx`);
    });

    // ── Density toggle ─────────────────────────────────────────────────
    document.querySelectorAll('.ag-density-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.density = btn.dataset.density;
            applyDensity();
            updateDensityButtons();
            saveViewState();
        });
    });

    // ── Add column / add group toolbar buttons ─────────────────────────
    document.getElementById('addColBtn')?.addEventListener('click', async () => {
        if (!state.schema.length) return;
        // Add to the last non-identification group
        const groups = state.schema.filter(g => !isIdentificationGroup(g));
        if (!groups.length) { promptAddGroup(); return; }
        promptAddColumn(groups[groups.length - 1].id);
    });

    // ── Permissions ────────────────────────────────────────────────────
    async function fetchPermissions() {
        const role  = (localStorage.getItem('userRole') || '').toLowerCase();
        const email = localStorage.getItem('userEmail') || '';
        if (role === 'superadmin' || role === 'administrator' || role === 'admin') {
            state.canEdit = true;
            return;
        }
        try {
            const r = await apiFetch('/api/access/permissions', {
                headers: { 'x-user-email': email, 'x-user-role': role },
            });
            const d = await r.json();
            if (d.fullAccess || d.superadmin) {
                state.canEdit = true;
            } else if (d.projects?.[projectName]) {
                state.canEdit = !!d.projects[projectName].canEdit;
            }
        } catch (_) { state.canEdit = false; }
    }

    // ── API helper ─────────────────────────────────────────────────────
    /** Wraps fetch with auth headers from localStorage. */
    function apiFetch(url, opts = {}) {
        const hdrs = Object.assign({
            'x-user-email': localStorage.getItem('userEmail') || '',
            'x-user-role':  localStorage.getItem('userRole')  || '',
        }, opts.headers || {});
        return fetch(url, { ...opts, headers: hdrs });
    }

    // ── Init / data load ───────────────────────────────────────────────
    async function init() {
        loadViewState();
        applyDensity();
        updateDensityButtons();
        renderSkeleton();

        await fetchPermissions();
        await fetchClusters();

        if (!state.canEdit) {
            addRowBtn?.classList.add('hidden');
            document.getElementById('addColBtn')?.classList.add('hidden');
        }

        try {
            const res = await apiFetch(`/api/data?project=${encodeURIComponent(projectName)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();

            if (!result.success) throw new Error(result.message || 'Failed to load data');

            state.schema      = result.schema  || [];
            state.rowVersions = result.rowVersions || {};

            // Normalize data: ensure _version on every row
            state.data = (result.data || []).map(row => ({
                _version: state.rowVersions[row._id] || 0,
                ...row,
            }));
            state.originalData = JSON.parse(JSON.stringify(state.data));

            // Pre-fetch knotenpunkte for known clusters (background)
            setTimeout(async () => {
                const clusters = new Set();
                state.schema.forEach(g => {
                    g.cols.forEach(c => {
                        if (c.label.toLowerCase() === 'cluster') {
                            state.data.forEach(r => { if (r[c.id]) clusters.add(r[c.id]); });
                        }
                    });
                });
                await Promise.all([...clusters].map(cl => fetchKnoten(cl)));
            }, 500);

            renderAll();

        } catch (err) {
            tableBody.innerHTML = `<tr><td colspan="100%" class="p-8 text-center text-red-500 font-semibold">${escHtml(err.message)}</td></tr>`;
            console.error('[AufmassGrid] Load error:', err);
        }
    }

    // ── Unit-testable pure helpers (exported to window for verification) ──
    window._aufmassGridHelpers = {
        computeDisplayRows: () => computeDisplayRows(),
        statusPillHtml,
        colType,
        isNumericType,
        escHtml,
    };

    // ── Start ──────────────────────────────────────────────────────────
    init();
});
