const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { logAction } = require('../controllers/logger');
const { saveVersionedCopy } = require('../controllers/dataVersioning');
const { getProjectRoot } = require('../controllers/fileMeta');

// Centralized path resolution — single source of truth
const { getDatafileDir, STORAGE_ROOT } = require('../controllers/storageConfig');

// NAS sync — fire-and-forget after file writes
const { syncFile } = require('../controllers/nasSync');

// ACL Engine
const { canAccessProject, canAccessModule, canEditProject } = require('../controllers/accessControl');

// ─── Data file path resolution ─────────────────────────────────────────────────

/** Escape special regex characters in a project name. */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the canonical path for a project's main aufmass data file.
 * Logic (mirrors dataRoutes.js getFilePathForRead):
 *   1. Return base ProjectName.txt if it exists.
 *   2. Otherwise scan for the latest versioned ProjectName_YYYYMMDD_HHMMSS.txt.
 *   3. If nothing found, return base path so callers get a meaningful error.
 */
async function getFilePath(projectName) {
    if (!projectName) return null;
    const dir      = getDatafileDir(projectName);
    const basePath = path.join(dir, `${projectName}.txt`);

    // 1. Check if the canonical base file exists
    try {
        await fs.access(basePath);
        return basePath;
    } catch (_) {
        // Not found — fall through to versioned scan
    }

    // 2. Scan for versioned files: ProjectName_YYYYMMDD_HHMMSS.txt
    try {
        const files          = await fs.readdir(dir);
        const versionPattern = new RegExp(`^${escapeRegex(projectName)}_(\\d{8}_\\d{6})\\.txt$`);
        const versioned      = files
            .map(f => ({ name: f, match: f.match(versionPattern) }))
            .filter(f => f.match)
            .sort((a, b) => b.match[1].localeCompare(a.match[1])); // newest first

        // 3. Return latest versioned file
        if (versioned.length > 0) {
            console.log(`[moduleRoutes] getFilePath: versioned fallback → ${versioned[0].name}`);
            return path.join(dir, versioned[0].name);
        }
    } catch (e) {
        console.error(`[moduleRoutes] getFilePath: error scanning dir ${dir}:`, e.message);
    }

    // 4. Nothing found — return base path so caller produces a meaningful error
    return basePath;
}

// ─── Helper: parse raw data file into { E1, E2_0, dataRows } ─────────────────

async function parseDataFile(projectName) {
    const filePath = await getFilePath(projectName);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(fileContent);
    const E1 = rawData[0];
    const E2 = rawData[1];
    const E2_0 = E2[0];
    const dataRows = E2.slice(1);
    return { filePath, E1, E2, E2_0, dataRows };
}

// ─── Helper: find column positions by label ────────────────────────────────────

function findColByLabel(E2_0, labelFn) {
    for (let i = 0; i < E2_0.length; i++) {
        const cols = E2_0[i] || [];
        for (let j = 0; j < cols.length; j++) {
            const l = typeof cols[j] === 'string' ? cols[j].toLowerCase() : '';
            if (labelFn(l)) return { grpIdx: i, colIdx: j };
        }
    }
    return null;
}

// ─── Multer — memory storage for reliable custom filename support ───────────────
// Using memoryStorage ensures req.body fields are fully parsed before we write
// files, so customName is always available when renaming uploaded files.

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

// ─── GET /api/modules/navigation?project=X&module=druckprufung ────────────────
// Returns clusters → knotenpunkte → addresses tree from the aufmass data file.
// The optional `module` param (default: 'aufmass') is used for ACL module check.

router.get('/navigation', async (req, res) => {
    const { project } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    // The specific ACL module to check (passed by module-shared.js via moduleKey).
    const aclModule = (req.query.module || 'aufmass').toLowerCase();

    // ACL enforcement (skip for superadmin)
    const navEmail = req.headers['x-user-email'] || '';
    const navRole  = (req.headers['x-user-role']  || '').toLowerCase();
    if (navRole !== 'superadmin') {
        const projectOk = await canAccessProject(navEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        // Check the specific module the caller is requesting
        const moduleOk = await canAccessModule(navEmail, project, aclModule);
        if (!moduleOk) return res.status(403).json({ success: false, message: `Access denied: ${aclModule} module not accessible.` });
    }

    try {
        const { E1, E2_0, dataRows } = await parseDataFile(project);

        // Build schema (group labels from E1, col labels from E2_0)
        const schema = (E1 || []).map((groupLabel, i) => ({
            id: `grp-${i}`,
            label: typeof groupLabel === 'string' ? groupLabel : String(groupLabel || ''),
            cols: (E2_0[i] || []).map((subTitle, j) => ({
                id: `col-${i}-${j}`,
                label: typeof subTitle === 'string' ? subTitle : String(subTitle || '')
            }))
        }));

        // Locate relevant columns
        const clusterPos  = findColByLabel(E2_0, l => l === 'cluster');
        const knotenPos   = findColByLabel(E2_0, l => l === 'knotenpunkt' || l === 'nvt');
        const addrStartPos = findColByLabel(E2_0, l => l === 'address start');
        const addrEndPos  = findColByLabel(E2_0, l => l === 'address end');
        const cablePos    = findColByLabel(E2_0, l => l === 'cable name');
        const fiberPos    = findColByLabel(E2_0, l => l === 'fiber type' || l === 'fiber count');
        const splicePos   = findColByLabel(E2_0, l => l === 'splices' || l === 'splice count');

        if (!clusterPos) {
            return res.json({ success: true, clusters: [] });
        }

        // Build tree: { clusterName: { knotenName: [ address, ... ] } }
        const tree = {};

        dataRows.forEach((row, rIdx) => {
            const cluster = row[clusterPos.grpIdx]?.[clusterPos.colIdx];
            if (!cluster || !String(cluster).trim()) return;
            const clusterStr = String(cluster).trim();

            const rowId = row[0]?.[0] || `ROW-${rIdx}`;

            const knoten = knotenPos
                ? (row[knotenPos.grpIdx]?.[knotenPos.colIdx] || '')
                : '';
            const knotenStr = String(knoten).trim() || '(no knotenpunkt)';

            const address = {
                id: rowId,
                start:       addrStartPos ? String(row[addrStartPos.grpIdx]?.[addrStartPos.colIdx] || '').trim() : '',
                end:         addrEndPos   ? String(row[addrEndPos.grpIdx]?.[addrEndPos.colIdx]     || '').trim() : '',
                cableName:   cablePos     ? String(row[cablePos.grpIdx]?.[cablePos.colIdx]         || '').trim() : '',
                fiberType:   fiberPos     ? String(row[fiberPos.grpIdx]?.[fiberPos.colIdx]         || '').trim() : '',
                spliceCount: splicePos    ? String(row[splicePos.grpIdx]?.[splicePos.colIdx]       || '').trim() : '',
                data: {}
            };

            // Include all column data so frontend can display status/type/file info
            row.forEach((grp, gIdx) => {
                (grp || []).forEach((val, cIdx) => {
                    address.data[`col-${gIdx}-${cIdx}`] = val != null ? String(val) : '';
                });
            });

            if (!tree[clusterStr]) tree[clusterStr] = {};
            if (!tree[clusterStr][knotenStr]) tree[clusterStr][knotenStr] = [];
            tree[clusterStr][knotenStr].push(address);
        });

        // Convert to array shape
        const clusters = Object.entries(tree).map(([clusterName, knotenMap]) => ({
            name: clusterName,
            knotenpunkte: Object.entries(knotenMap).map(([knotenName, addresses]) => ({
                name: knotenName,
                addresses
            }))
        }));

        res.json({ success: true, schema, clusters });
    } catch (e) {
        console.error('Navigation error:', e.message);
        res.status(500).json({ success: false, message: `Could not build navigation: ${e.message}` });
    }
});

// ─── POST /api/modules/upload ──────────────────────────────────────────────────
// Upload file(s) to STORAGE_ROOT/project/Doku/targetPath/
// Supports optional customName body field to rename the uploaded file.

router.post('/upload', (req, res, next) => {
    upload.array('files', 50)(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        next();
    });
}, async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files received.' });
    }

    const reqRole = (req.headers['x-user-role'] || '').toLowerCase();
    const { project, targetPath, customName } = req.body;

    // ACL enforcement (skip for superadmin)
    const uploadEmail = req.headers['x-user-email'] || '';
    if (reqRole !== 'superadmin' && project) {
        const projectOk = await canAccessProject(uploadEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        // Check the calling module's ACL, fallback to 'files' as general gate
        const callingModule = (req.body.module || 'files').toLowerCase();
        const moduleOk = await canAccessModule(uploadEmail, project, callingModule) ||
                         await canAccessModule(uploadEmail, project, 'files');
        if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: module not accessible.' });
        // Write operation requires canEdit
        const editOk = await canEditProject(uploadEmail, project);
        if (!editOk) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot upload files).' });
    }
    const userEmail = req.headers['x-user-email'] || 'Unknown';

    const projectRoot = getProjectRoot(project);
    const target = path.join(projectRoot, 'Doku', targetPath || '');

    // Prevent path traversal via targetPath
    if (!path.resolve(target).startsWith(path.resolve(projectRoot) + path.sep) &&
        path.resolve(target) !== path.resolve(projectRoot)) {
        return res.status(400).json({ success: false, message: 'Invalid target path.' });
    }

    await fs.mkdir(target, { recursive: true });

    const saved = [];
    for (const file of req.files) {
        // Use customName only when uploading a single file — ignored for batch uploads
        const filename = (customName && req.files.length === 1)
            ? customName
            : (customName || file.originalname);
        const filePath = path.join(target, filename);

        // Prevent filename traversal
        if (!path.resolve(filePath).startsWith(path.resolve(target) + path.sep)) {
            return res.status(400).json({ success: false, message: 'Invalid filename.' });
        }

        await fs.writeFile(filePath, file.buffer);
        saved.push({
            name: filename,
            path: path.join('Doku', targetPath || '', filename).replace(/\\/g, '/'),
            size: file.size
        });
    }

    await logAction(
        userEmail,
        'Module File Upload',
        `Uploaded ${req.files.length} file(s) to ${project}/Doku/${targetPath || ''}`
    );

    res.json({ success: true, files: saved });

    // NAS sync: push each saved file (fire-and-forget)
    for (const file of saved) {
        const absPath = path.join(target, file.name);
        const relPath = require('path').relative(STORAGE_ROOT, absPath).replace(/\\/g, '/');
        syncFile(relPath);
    }
});

// ─── Row Version Helpers (Optimistic Locking) ────────────────────────────────
// Stores per-row version numbers in {projectRoot}/row-versions.json
// Client sends `rowVersion` with updates; server rejects if stale.

async function getRowVersionsPath(project) {
    const root = getProjectRoot(project);
    return path.join(root, 'row-versions.json');
}

async function loadRowVersions(project) {
    try {
        const p = await getRowVersionsPath(project);
        const data = await fs.readFile(p, 'utf-8');
        return JSON.parse(data);
    } catch { return {}; }
}

async function saveRowVersions(project, versions) {
    const p = await getRowVersionsPath(project);
    await fs.writeFile(p, JSON.stringify(versions), 'utf-8');
}

// ─── POST /api/modules/aufmass-update ─────────────────────────────────────────
// Update specific cells in the aufmass data file without reloading the whole table.
//
// Body: { project, rowId, updates: { "col-8-0": "value", ... }, rowVersion?, note? }
// If rowVersion is provided and doesn't match stored version → 409 Conflict.

router.post('/aufmass-update', async (req, res) => {
    const { project, rowId, updates, note, rowVersion } = req.body;
    if (!project || !rowId || !updates) {
        return res.status(400).json({ success: false, message: 'Missing project, rowId, or updates.' });
    }

    // The specific ACL module being updated (passed by module-shared.js via moduleKey).
    const aclModule2 = ((req.body.module) || 'aufmass').toLowerCase();

    const reqRole = (req.headers['x-user-role'] || '').toLowerCase();

    // ACL enforcement (skip for superadmin)
    const aufEmail = req.headers['x-user-email'] || '';
    if (reqRole !== 'superadmin') {
        const projectOk = await canAccessProject(aufEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        // Check the specific module being updated
        const moduleOk = await canAccessModule(aufEmail, project, aclModule2);
        if (!moduleOk) return res.status(403).json({ success: false, message: `Access denied: ${aclModule2} module not accessible.` });
        // Write operation requires canEdit
        const editOk = await canEditProject(aufEmail, project);
        if (!editOk) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot edit data).' });
    }

    try {
        // ── Optimistic locking: check row version ──────────────────────────────
        const versions = await loadRowVersions(project);
        const storedVersion = versions[rowId] || 0;
        if (rowVersion !== undefined && rowVersion !== null) {
            const clientVersion = parseInt(rowVersion, 10);
            if (clientVersion !== storedVersion) {
                return res.status(409).json({
                    success: false,
                    conflict: true,
                    message: 'This row was modified by another user. Please refresh the page to get the latest data.',
                    serverVersion: storedVersion,
                    clientVersion
                });
            }
        }

        const { filePath, E1, E2, E2_0, dataRows } = await parseDataFile(project);

        // Find the row index by _id (same logic as GET in dataRoutes.js)
        const rowIndex = dataRows.findIndex((row, rIdx) => {
            const id = row[0]?.[0] || `ROW-${rIdx}`;
            return id === rowId;
        });

        if (rowIndex === -1) {
            return res.status(404).json({ success: false, message: `Row "${rowId}" not found.` });
        }

        const targetRow = dataRows[rowIndex];

        // ── Capture old values before applying updates ─────────────────────────
        const cellChanges = []; // { label, oldVal, newVal, isOtdrTrigger }
        for (const [colId, value] of Object.entries(updates)) {
            const match = colId.match(/^col-(\d+)-(\d+)$/);
            if (!match) {
                console.warn(`aufmass-update: skipping invalid col id "${colId}"`);
                continue;
            }
            const grpIdx = parseInt(match[1], 10);
            const colIdx = parseInt(match[2], 10);

            const oldVal = targetRow[grpIdx]?.[colIdx] != null ? String(targetRow[grpIdx][colIdx]) : '';
            const newVal = String(value);
            const label = E2_0[grpIdx]?.[colIdx] || colId;

            // Ensure the group array exists
            if (!targetRow[grpIdx]) targetRow[grpIdx] = [];
            targetRow[grpIdx][colIdx] = value;

            if (oldVal !== newVal) {
                cellChanges.push({ label, oldVal, newVal, isOtdrTrigger: false });
            }
        }

        // ── OTDR auto-trigger ──────────────────────────────────────────────────
        // After applying updates, check: if APL status AND Knotenpunkt Status are
        // both "Done", auto-set OTDR status → "Waiting" (unless already "Done").
        let otdrAutoTriggered = false;
        const aplStatusPos    = findColByLabel(E2_0, l => l === 'apl status');
        const knotenStatusPos = findColByLabel(E2_0, l => l === 'knotenpunkt status');
        const otdrStatusPos   = findColByLabel(E2_0, l => l === 'otdr status');

        if (aplStatusPos && knotenStatusPos && otdrStatusPos) {
            const aplStatus    = String(targetRow[aplStatusPos.grpIdx]?.[aplStatusPos.colIdx]   || '');
            const knotenStatus = String(targetRow[knotenStatusPos.grpIdx]?.[knotenStatusPos.colIdx] || '');
            const otdrStatus   = String(targetRow[otdrStatusPos.grpIdx]?.[otdrStatusPos.colIdx]  || '');

            if (aplStatus === 'Done' && knotenStatus === 'Done' && otdrStatus !== 'Done') {
                const oldOtdr = otdrStatus;
                if (!targetRow[otdrStatusPos.grpIdx]) targetRow[otdrStatusPos.grpIdx] = [];
                targetRow[otdrStatusPos.grpIdx][otdrStatusPos.colIdx] = 'Waiting';
                otdrAutoTriggered = true;
                cellChanges.push({ label: 'OTDR Status', oldVal: oldOtdr, newVal: 'Waiting', isOtdrTrigger: true });
            }
        }

        // Reconstruct E2 with updated row in place
        const newE2 = [E2_0, ...dataRows];

        await fs.writeFile(filePath, JSON.stringify([E1, newE2], null, 2), 'utf-8');

        // ── Increment row version ──────────────────────────────────────────────
        versions[rowId] = storedVersion + 1;
        await saveRowVersions(project, versions);
        const newRowVersion = versions[rowId];

        // ── Build granular log details ─────────────────────────────────────────
        const userEmail = req.headers['x-user-email'] || 'Unknown';

        // Context: cluster + knotenpunkt for this row
        const clusterPos = findColByLabel(E2_0, l => l === 'cluster');
        const knotenPos  = findColByLabel(E2_0, l => l === 'knotenpunkt' || l === 'nvt');
        const clusterVal = clusterPos ? String(targetRow[clusterPos.grpIdx]?.[clusterPos.colIdx] || '').trim() : '';
        const knotenVal  = knotenPos  ? String(targetRow[knotenPos.grpIdx]?.[knotenPos.colIdx]   || '').trim() : '';
        const ctx = [clusterVal && `Cluster: ${clusterVal}`, knotenVal && `Knotenpunkt: ${knotenVal}`].filter(Boolean).join(' | ');

        let logDetails;
        if (cellChanges.length === 0) {
            logDetails = `Row "${rowId}" in "${project}" — no value changes (cols: ${Object.keys(updates).join(', ')})`;
        } else {
            logDetails = `Row "${rowId}"${ctx ? ` | ${ctx}` : ''}\n` +
                cellChanges.map(c => c.isOtdrTrigger
                    ? `  - [OTDR auto-triggered → "${c.newVal}"]`
                    : `  - "${c.label}": "${c.oldVal}" → "${c.newVal}"`
                ).join('\n');
        }

        if (note) logDetails += `\n  📝 Note: ${note}`;
        await logAction(userEmail, 'Aufmass Row Updated', logDetails);

        res.json({ success: true, rowId, updated: Object.keys(updates), otdrAutoTriggered, rowVersion: newRowVersion });

        // --- NAS sync: push updated datafile to NAS (fire-and-forget) ---
        const relFilePath = require('path').relative(STORAGE_ROOT, filePath).replace(/\\/g, '/');
        syncFile(relFilePath);

        // --- Versioned copy + Excel export (fire-and-forget) ---
        setImmediate(async () => {
            try { await saveVersionedCopy(filePath, E1, newE2); }
            catch (e) { console.error('Versioning error (moduleRoutes):', e.message); }
        });
    } catch (e) {
        console.error('aufmass-update error:', e.message);
        res.status(500).json({ success: false, message: `Update failed: ${e.message}` });
    }
});

// ─── GET /api/modules/aufmass-row?project=X&rowId=ROW-7 ──────────────────────
// Returns a single row's full data. Used to check current status before upload.

router.get('/aufmass-row', async (req, res) => {
    const { project, rowId } = req.query;
    if (!project || !rowId) {
        return res.status(400).json({ success: false, message: 'Missing project or rowId.' });
    }

    // The specific ACL module to check (optional, defaults to 'aufmass')
    const aclModuleRow = (req.query.module || 'aufmass').toLowerCase();

    // ACL enforcement (skip for superadmin)
    const rowEmail = req.headers['x-user-email'] || '';
    const rowRole  = (req.headers['x-user-role']  || '').toLowerCase();
    if (rowRole !== 'superadmin') {
        const projectOk = await canAccessProject(rowEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const moduleOk = await canAccessModule(rowEmail, project, aclModuleRow);
        if (!moduleOk) return res.status(403).json({ success: false, message: `Access denied: ${aclModuleRow} module not accessible.` });
    }

    try {
        const { E2_0, dataRows } = await parseDataFile(project);

        // Build schema (same as GET in dataRoutes.js)
        const schema = E2_0.map((cols, i) => ({
            id: `grp-${i}`,
            cols: (cols || []).map((subTitle, j) => ({
                id: `col-${i}-${j}`,
                label: subTitle
            }))
        }));

        // Find the row
        let found = null;
        dataRows.forEach((row, rIdx) => {
            const id = row[0]?.[0] || `ROW-${rIdx}`;
            if (id === rowId) {
                let rowObj = { _id: id };
                schema.forEach((group, i) => {
                    group.cols.forEach((col, j) => {
                        rowObj[col.id] = (row[i] && row[i][j] != null) ? String(row[i][j]) : '';
                    });
                });
                found = rowObj;
            }
        });

        if (!found) {
            return res.status(404).json({ success: false, message: `Row "${rowId}" not found.` });
        }

        res.json({ success: true, row: found, schema });
    } catch (e) {
        console.error('aufmass-row error:', e.message);
        res.status(500).json({ success: false, message: `Could not fetch row: ${e.message}` });
    }
});

// ─── GET /api/modules/list-files?project=X&path=SUPPN/OTDR/NVT-001/Zeilerweg-11 ─
// Lists files in a specific directory under the project's Doku folder.

router.get('/list-files', async (req, res) => {
    const { project, path: relPath } = req.query;
    if (!project || !relPath) {
        return res.status(400).json({ success: false, message: 'Missing project or path.' });
    }

    // ACL enforcement (skip for superadmin)
    const lfEmail = req.headers['x-user-email'] || '';
    const lfRole  = (req.headers['x-user-role']  || '').toLowerCase();
    if (lfRole !== 'superadmin') {
        const projectOk = await canAccessProject(lfEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        // Check calling module's ACL or fallback to 'files'
        const lfModule = (req.query.module || 'files').toLowerCase();
        const moduleOk = await canAccessModule(lfEmail, project, lfModule) ||
                         await canAccessModule(lfEmail, project, 'files');
        if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: module not accessible.' });
    }

    try {
        const projectRoot = getProjectRoot(project);
        const targetDir   = path.join(projectRoot, 'Doku', relPath);

        // Prevent path traversal: resolved path must stay inside projectRoot
        if (!path.resolve(targetDir).startsWith(path.resolve(projectRoot))) {
            return res.status(400).json({ success: false, message: 'Invalid path.' });
        }

        let files = [];
        try {
            const entries = await fs.readdir(targetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    const stat = await fs.stat(path.join(targetDir, entry.name));
                    files.push({ name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() });
                }
            }
        } catch (_) {
            // Directory doesn't exist — return empty list
        }

        res.json({ success: true, files, count: files.length });
    } catch (e) {
        console.error('list-files error:', e.message);
        res.status(500).json({ success: false, message: `Could not list files: ${e.message}` });
    }
});

// ─── POST /api/modules/backfill-einblasen-dates?project=X ────────────────────
// Scans Einblasen folders, extracts dates from filenames, and populates
// Einblasen-Date + file location columns for Done addresses that are empty.
router.post('/backfill-einblasen-dates', async (req, res) => {
    const { project } = req.body;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project' });

    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }

    try {
        // Load aufmass data
        const dataDir = getDatafileDir(project);
        const dataFile = path.join(dataDir, `${project}.txt`);
        const raw = JSON.parse(await fs.readFile(dataFile, 'utf-8'));
        const E1 = raw[0], E2 = raw[1];
        const subHeaders = E2[0];
        const dataRows = E2.slice(1);

        // Find column indices
        let statusColId = null, fileLocColId = null, dateColId = null;
        let addrEndGrp = -1, addrEndCol = -1;
        let clusterGrp = -1, clusterCol = -1;
        let knGrp = -1, knCol = -1;

        for (let gi = 0; gi < E1.length; gi++) {
            const grpName = typeof E1[gi] === 'string' ? E1[gi].toLowerCase() : '';
            for (let ci = 0; ci < (subHeaders[gi] || []).length; ci++) {
                const colName = typeof subHeaders[gi][ci] === 'string' ? subHeaders[gi][ci].toLowerCase() : '';
                if (grpName.includes('einblasen') && colName.includes('status')) statusColId = { g: gi, c: ci };
                if (grpName.includes('einblasen') && colName === 'file location') fileLocColId = { g: gi, c: ci };
                if (grpName.includes('einblasen') && colName.includes('einblasen-date')) dateColId = { g: gi, c: ci };
                if (colName === 'address end' || colName === 'address start') { addrEndGrp = gi; addrEndCol = ci; }
                if (colName === 'cluster') { clusterGrp = gi; clusterCol = ci; }
                if (colName === 'knotenpunkt' || colName === 'nvt') { knGrp = gi; knCol = ci; }
            }
        }

        if (!statusColId || !dateColId) {
            return res.json({ success: false, message: 'Missing required columns' });
        }

        let updated = 0;
        const projectRoot = getProjectRoot(project);

        for (const row of dataRows) {
            const status = (row[statusColId.g]?.[statusColId.c] || '').toLowerCase();
            if (status !== 'done') continue;

            const currentDate = dateColId ? (row[dateColId.g]?.[dateColId.c] || '') : '';
            if (currentDate) continue; // Already has date

            const cluster = clusterGrp >= 0 ? (row[clusterGrp]?.[clusterCol] || '') : '';
            const kn = knGrp >= 0 ? (row[knGrp]?.[knCol] || '') : '';
            const addrEnd = addrEndGrp >= 0 ? (row[addrEndGrp]?.[addrEndCol] || '') : '';
            if (!cluster || !kn || !addrEnd) continue;

            // Look for files in Cluster/Einblasen/Knotenpunkt/
            const einDir = path.join(projectRoot, 'Doku', cluster, 'Einblasen', kn);
            const addrClean = addrEnd.trim().replace(/\s+/g, '-').replace(/,/g, '');

            try {
                const entries = await fs.readdir(einDir);
                let latestFile = null, latestTs = 0;

                for (const fname of entries) {
                    const idx = fname.indexOf(addrClean);
                    if (idx === -1) continue;
                    const afterIdx = idx + addrClean.length;
                    if (afterIdx < fname.length && !/[.\-_ ]/.test(fname[afterIdx])) continue;
                    const m = fname.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
                    if (m) {
                        const ts = parseInt(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`);
                        if (ts > latestTs) {
                            latestTs = ts;
                            latestFile = fname;
                        }
                    }
                }

                if (latestFile) {
                    const m = latestFile.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
                    const dateStr = `${m[1]}-${m[2]}-${m[3]}, ${m[4]}:${m[5]}`;

                    if (dateColId) {
                        if (!row[dateColId.g]) row[dateColId.g] = [];
                        row[dateColId.g][dateColId.c] = dateStr;
                    }
                    if (fileLocColId) {
                        if (!row[fileLocColId.g]) row[fileLocColId.g] = [];
                        row[fileLocColId.g][fileLocColId.c] = `Doku/${cluster}/Einblasen/${kn}/${latestFile}`;
                    }
                    updated++;
                }
            } catch (_) { /* dir doesn't exist */ }
        }

        if (updated > 0) {
            await fs.writeFile(dataFile, JSON.stringify(raw, null, 2));
            await saveVersionedCopy(dataFile, raw[0], raw[1]);
        }

        res.json({ success: true, updated, message: `Backfilled ${updated} addresses` });
    } catch (e) {
        console.error('backfill error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── GET /api/modules/appointments?project=X ─────────────────────────────────
// Returns a flat array of all appointments across all termin columns in the project.
// ACL: requires project access only (reads across modules).

router.get('/appointments', async (req, res) => {
    const { project } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    const apptEmail = req.headers['x-user-email'] || '';
    const apptRole  = (req.headers['x-user-role']  || '').toLowerCase();

    if (apptRole !== 'superadmin') {
        const projectOk = await canAccessProject(apptEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
    }

    // Map group name → module key (case-insensitive partial match)
    function groupToModule(groupName) {
        const n = (groupName || '').toLowerCase();
        if (n.includes('einblasen')) return 'einblasen';
        if (n.includes('splicing') || n.includes('apl')) return 'apl';
        if (n.includes('druckpr')) return 'druckprufung';
        if (n.includes('kalibrieren')) return 'kalibrieren';
        if (n.includes('otdr')) return 'otdr';
        // Generic fallback: strip spaces and lowercase
        return n.replace(/\s+/g, '-');
    }

    try {
        const { E1, E2_0, dataRows } = await parseDataFile(project);

        // Find context columns
        const clusterPos   = findColByLabel(E2_0, l => l === 'cluster');
        const knotenPos    = findColByLabel(E2_0, l => l === 'knotenpunkt' || l === 'nvt');
        const addrStartPos = findColByLabel(E2_0, l => l === 'address start');
        const addrEndPos   = findColByLabel(E2_0, l => l === 'address end');

        // Find all termin columns across all groups
        const terminCols = []; // { grpIdx, colIdx, colId, groupName, module }
        (E1 || []).forEach((groupLabel, gi) => {
            const groupName = typeof groupLabel === 'string' ? groupLabel : String(groupLabel || '');
            const cols = E2_0[gi] || [];
            cols.forEach((colLabel, ci) => {
                const label = typeof colLabel === 'string' ? colLabel.toLowerCase() : '';
                if (label.includes('termin')) {
                    terminCols.push({
                        grpIdx: gi,
                        colIdx: ci,
                        colId: `col-${gi}-${ci}`,
                        groupName,
                        module: groupToModule(groupName)
                    });
                }
            });
        });

        const appointments = [];

        dataRows.forEach((row, rIdx) => {
            const rowId = row[0]?.[0] || `ROW-${rIdx}`;
            const cluster      = clusterPos   ? String(row[clusterPos.grpIdx]?.[clusterPos.colIdx]     || '').trim() : '';
            const knotenpunkt  = knotenPos    ? String(row[knotenPos.grpIdx]?.[knotenPos.colIdx]       || '').trim() : '';
            const addressStart = addrStartPos ? String(row[addrStartPos.grpIdx]?.[addrStartPos.colIdx] || '').trim() : '';
            const addressEnd   = addrEndPos   ? String(row[addrEndPos.grpIdx]?.[addrEndPos.colIdx]     || '').trim() : '';

            terminCols.forEach(tc => {
                const rawVal = row[tc.grpIdx]?.[tc.colIdx];
                if (!rawVal) return;
                let parsed;
                try { parsed = JSON.parse(rawVal); } catch { return; }
                if (!parsed || !parsed.date) return;

                appointments.push({
                    rowId,
                    module: tc.module,
                    date: parsed.date,
                    time: parsed.time || '',
                    notes: parsed.notes || '',
                    cluster,
                    knotenpunkt,
                    addressStart,
                    addressEnd,
                    terminColId: tc.colId
                });
            });
        });

        res.json({ success: true, appointments });
    } catch (e) {
        console.error('appointments error:', e.message);
        res.status(500).json({ success: false, message: `Could not fetch appointments: ${e.message}` });
    }
});

// ─── GET /api/modules/done-dates?project=X&path=SUPPN/Einblasen/BB/NVt-30 ───────
// Returns the latest file modification date per address subfolder (or per-address files).
// Used by address list to show "done date" next to Done badge.

router.get('/done-dates', async (req, res) => {
    const { project, path: relPath } = req.query;
    if (!project || !relPath) {
        return res.status(400).json({ success: false, message: 'Missing project or path.' });
    }

    const ddEmail = req.headers['x-user-email'] || '';
    const ddRole  = (req.headers['x-user-role']  || '').toLowerCase();
    if (ddRole !== 'superadmin') {
        const projectOk = await canAccessProject(ddEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const projectRoot = getProjectRoot(project);
        const targetDir   = path.join(projectRoot, 'Doku', relPath);

        if (!path.resolve(targetDir).startsWith(path.resolve(projectRoot))) {
            return res.status(400).json({ success: false, message: 'Invalid path.' });
        }

        const dates = {}; // { addressName: { date: ISO string, count: number } }

        try {
            const entries = await fs.readdir(targetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    // Files directly in the knotenpunkt folder: extract address from filename
                    const stat = await fs.stat(path.join(targetDir, entry.name));
                    const name = entry.name;
                    // Try to match address name patterns in filename
                    // Common pattern: "AddressName_something.ext" or files containing address name
                    if (!dates['_root']) dates['_root'] = { date: stat.mtime.toISOString(), count: 0 };
                    dates['_root'].count++;
                    if (stat.mtime > new Date(dates['_root'].date)) dates['_root'].date = stat.mtime.toISOString();
                }
            }

            // Also scan all files and group by address name match
            const allFiles = await fs.readdir(targetDir, { withFileTypes: true });
            for (const entry of allFiles) {
                if (entry.isFile()) {
                    const stat = await fs.stat(path.join(targetDir, entry.name));
                    const mtime = stat.mtime.toISOString();
                    const fname = entry.name;
                    // The address name is embedded in the filename (e.g., "Am-Mühlbach-2_photo.jpg")
                    // We'll return all files with their mtimes and let the client group by address
                    if (!dates._files) dates._files = [];
                    dates._files.push({ name: fname, mtime });
                }
            }
        } catch (_) {
            // Directory doesn't exist
        }

        res.json({ success: true, dates });
    } catch (e) {
        console.error('done-dates error:', e.message);
        res.status(500).json({ success: false, message: `Error: ${e.message}` });
    }
});

// ─── DELETE /api/modules/clear-files?project=X&path=SUPPN/OTDR/NVT-001/Zeilerweg-11 ─
// Deletes all files in a directory (for OTDR "Replace All" option). Admin only.

router.delete('/clear-files', async (req, res) => {
    const { project, path: relPath } = req.query;
    if (!project || !relPath) {
        return res.status(400).json({ success: false, message: 'Missing project or path.' });
    }

    const userRole  = req.headers['x-user-role']  || '';
    const userEmail = req.headers['x-user-email'] || 'Unknown';

    if (userRole !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin access required' });
    }

    try {
        const projectRoot = getProjectRoot(project);
        const targetDir   = path.join(projectRoot, 'Doku', relPath);

        // Prevent path traversal: resolved path must stay inside projectRoot
        if (!path.resolve(targetDir).startsWith(path.resolve(projectRoot))) {
            return res.status(400).json({ success: false, message: 'Invalid path.' });
        }

        let deletedCount = 0;
        try {
            const entries = await fs.readdir(targetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    await fs.unlink(path.join(targetDir, entry.name));
                    deletedCount++;
                }
            }
        } catch (_) {
            // Directory doesn't exist — nothing to clear
        }

        await logAction(userEmail, 'OTDR Clear Files', `Cleared ${deletedCount} files in ${project}/Doku/${relPath}`);
        res.json({ success: true, deleted: deletedCount });
    } catch (e) {
        console.error('clear-files error:', e.message);
        res.status(500).json({ success: false, message: `Could not clear files: ${e.message}` });
    }
});

module.exports = router;
