const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { logAction } = require('../controllers/logger');
const { saveVersionedCopy } = require('../controllers/dataVersioning');
const { syncClusterFolders, syncKnotenpunktFolders, getExistingClusters, getExistingKnotenpunkte, performFolderSync } = require('../controllers/folderSync');

// Centralized path resolution — single source of truth
const { getDatafileDir, STORAGE_ROOT, getProjectRoot } = require('../controllers/storageConfig');

// NAS sync — fire-and-forget after writes; on-demand fetch for reads
const { syncFile } = require('../controllers/nasSync');
const { ensureLocalFile } = require('../controllers/nasOnDemand');

// ACL Engine
const { canAccessProject, canAccessModule, canEditProject } = require('../controllers/accessControl');

// Helper: escape special regex characters in a string
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the datafile directory for a project.
 * Only looks in STORAGE_ROOT/<project>/Doku/Aufmass/datafile/ — the single
 * canonical location. If it doesn't exist yet it will be created on first write.
 */
async function findDataDir(projectName) {
    const dir = getDatafileDir(projectName);
    const basePath = path.join(dir, `${projectName}.txt`);
    return { dir, basePath };
}

/**
 * Get the file to READ from — picks the latest versioned file if any exist,
 * otherwise falls back to the base ProjectName.txt.
 * Transparently fetches from NAS if the file has been cleaned from VPS.
 */
async function getFilePathForRead(projectName) {
    if (!projectName) { console.error('No project name provided'); return null; }

    const { dir, basePath } = await findDataDir(projectName);

    // Look for the latest versioned file: ProjectName_YYYYMMDD_HHMMSS.txt
    try {
        const files = await fs.readdir(dir);
        const versionPattern = new RegExp(`^${escapeRegex(projectName)}_(\\d{8}_\\d{6})\\.txt$`);
        const versioned = files
            .map(f => ({ name: f, match: f.match(versionPattern) }))
            .filter(f => f.match)
            .sort((a, b) => b.match[1].localeCompare(a.match[1])); // newest first

        if (versioned.length > 0) {
            const latestPath = path.join(dir, versioned[0].name);
            console.log(`Loading latest versioned file: ${versioned[0].name}`);
            // Ensure file exists locally (fetch from NAS if cleaned)
            const relPath = path.relative(STORAGE_ROOT, latestPath).replace(/\\/g, '/');
            return await ensureLocalFile(latestPath, relPath);
        }
    } catch (e) {
        console.error(`Error scanning dir ${dir}:`, e.message);
    }

    // No versioned files — fall back to base file (also ensure locally available)
    const relPath = path.relative(STORAGE_ROOT, basePath).replace(/\\/g, '/');
    return await ensureLocalFile(basePath, relPath);
}

/**
 * Get the file to WRITE to — returns the base ProjectName.txt in the
 * canonical datafile directory (creates dir if needed).
 * (Versioned copies are created separately by saveVersionedCopy.)
 */
async function getFilePathForWrite(projectName) {
    if (!projectName) { console.error('No project name provided'); return null; }
    const { dir, basePath } = await findDataDir(projectName);
    await fs.mkdir(dir, { recursive: true });
    return basePath;
}

// Backward-compat alias used by parseClusterKnotenFromFile
const getFilePath = getFilePathForRead;

/**
 * Parse the data file for a project and build the clusterKnoten map.
 * Returns { clusterKnoten } where clusterKnoten is { [cluster]: Set<knotenpunkt> }.
 * Returns null if the file can't be parsed or has no cluster column.
 */
async function parseClusterKnotenFromFile(projectName) {
    try {
        const filePath = await getFilePath(projectName);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(fileContent);
        const E2_0 = rawData[1][0];
        const dataRows = rawData[1].slice(1);

        let clusterGrpIdx = -1, clusterColIdx = -1;
        let knotenGrpIdx = -1, knotenColIdx = -1;

        E2_0.forEach((cols, i) => {
            cols.forEach((label, j) => {
                const l = typeof label === 'string' ? label.toLowerCase() : '';
                if (l === 'cluster') { clusterGrpIdx = i; clusterColIdx = j; }
                if (l === 'knotenpunkt' || l === 'nvt') { knotenGrpIdx = i; knotenColIdx = j; }
            });
        });

        if (clusterGrpIdx === -1) return null;

        const clusterKnoten = {};
        dataRows.forEach(row => {
            const cluster = row[clusterGrpIdx]?.[clusterColIdx];
            if (!cluster || !String(cluster).trim()) return;
            const clusterStr = String(cluster).trim();
            if (!clusterKnoten[clusterStr]) clusterKnoten[clusterStr] = new Set();
            if (knotenGrpIdx !== -1) {
                const knoten = row[knotenGrpIdx]?.[knotenColIdx];
                if (knoten && String(knoten).trim()) clusterKnoten[clusterStr].add(String(knoten).trim());
            }
        });

        return clusterKnoten;
    } catch (e) {
        return null;
    }
}

/**
 * Get safe cluster names — the aufmass data file is the single source of truth.
 * If a cluster folder exists but isn't referenced in any aufmass row, it gets trashed.
 */
async function getSafeClusterNames(projectName) {
    return [];
}

// --- READ DYNAMIC DATA ---
router.get('/', async (req, res) => {
    try {
        const userEmail  = req.headers['x-user-email'] || '';
        const userRole   = (req.headers['x-user-role']  || '').toLowerCase();
        const aclProject = req.query.project || '';

        // ACL enforcement (skip for superadmin)
        if (userRole !== 'superadmin') {
            const projectOk = await canAccessProject(userEmail, aclProject);
            if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });

            const moduleOk = await canAccessModule(userEmail, aclProject, 'aufmass');
            if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: aufmass module not accessible.' });
        }

        const filePath = await getFilePath(req.query.project);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(fileContent);
        
        const E1 = rawData[0];
        const E2 = rawData[1];
        const E2_0 = E2[0]; 
        const dataRows = E2.slice(1); 

        const schema = E1.map((mainTitle, i) => ({
            id: `grp-${i}`,
            title: mainTitle,
            cols: (E2_0[i] || []).map((subTitle, j) => ({
                id: `col-${i}-${j}`,
                label: subTitle
            }))
        }));

        const flatData = dataRows.map((row, rIdx) => {
            let rowObj = { _id: row[0][0] || `ROW-${rIdx}` }; 
            schema.forEach((group, i) => {
                group.cols.forEach((col, j) => {
                    rowObj[col.id] = (row[i] && row[i][j] != null) ? String(row[i][j]) : '';
                });
            });
            return rowObj;
        });

        // Load row versions for optimistic locking
        let rowVersions = {};
        try {
            const rvPath = path.join(getProjectRoot(req.query.project), 'row-versions.json');
            const rvData = await fs.readFile(rvPath, 'utf-8');
            rowVersions = JSON.parse(rvData);
        } catch { /* no versions yet — all default to 0 */ }

        // Attach row version to each row
        flatData.forEach(row => {
            row._version = rowVersions[row._id] || 0;
        });

        res.json({ success: true, schema, data: flatData });

        // Fire-and-forget background sync after returning data (non-blocking)
        const projectName = req.query.project;
        if (projectName) {
            setImmediate(async () => {
                try {
                    const clusterKnoten = await parseClusterKnotenFromFile(projectName);
                    if (!clusterKnoten) return; // no cluster column — skip

                    const safeNames = await getSafeClusterNames(projectName);
                    await performFolderSync(projectName, clusterKnoten, safeNames, logAction);
                } catch (e) {
                    console.error('Background sync error:', e.message);
                }
            });
        }
    } catch (e) { 
        console.error("Fetch Data Error:", e.message);
        res.status(500).json({ success: false, message: `Could not load data: ${e.message}` }); 
    }
});

// --- SAVE DYNAMIC DATA ---
router.post('/', async (req, res) => {
    try {
        const aclEmail2   = req.headers['x-user-email'] || '';
        const aclRole2    = (req.headers['x-user-role']  || '').toLowerCase();
        const aclProject2 = req.query.project || '';

        // ACL enforcement (skip for superadmin)
        if (aclRole2 !== 'superadmin') {
            const projectOk = await canAccessProject(aclEmail2, aclProject2);
            if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });

            const moduleOk = await canAccessModule(aclEmail2, aclProject2, 'aufmass');
            if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: aufmass module not accessible.' });

            const editOk = await canEditProject(aclEmail2, aclProject2);
            if (!editOk) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot edit data).' });
        }

        const { schema, data } = req.body; 
        const readPath = await getFilePathForRead(req.query.project);
        const filePath = await getFilePathForWrite(req.query.project);
        
        const E1 = schema.map(g => g.title);
        const E2_0 = schema.map(g => g.cols.map(c => c.label));

        // ── Read OLD data for cell-level diff ─────────────────────────────
        const oldFlatData = {}; // { rowId: { 'col-i-j': value } }
        try {
            const oldContent = await fs.readFile(readPath, 'utf-8');
            const oldRaw = JSON.parse(oldContent);
            const oldDataRows = oldRaw[1].slice(1);
            oldDataRows.forEach((row, rIdx) => {
                const rowId = row[0]?.[0] || `ROW-${rIdx}`;
                const rowObj = {};
                schema.forEach((group, i) => {
                    group.cols.forEach((col, j) => {
                        rowObj[col.id] = (row[i] && row[i][j] != null) ? String(row[i][j]) : '';
                    });
                });
                oldFlatData[rowId] = rowObj;
            });
        } catch (_) { /* new file or parse error — diff will show everything as new */ }

        // ── OTDR auto-trigger ─────────────────────────────────────────────
        // Before writing, scan every row: if APL status AND Knotenpunkt Status
        // are both "Done" and OTDR status is not "Done", set OTDR → "Waiting".
        let aplStatusColId = null, knotenStatusColId = null, otdrStatusColId = null;
        schema.forEach(g => {
            g.cols.forEach(c => {
                const l = c.label.toLowerCase();
                if (l === 'apl status') aplStatusColId = c.id;
                if (l === 'knotenpunkt status') knotenStatusColId = c.id;
                // OTDR group has multiple cols; first one with "status" in OTDR group
                if (!otdrStatusColId && g.title && g.title.toLowerCase().includes('otdr') && l.includes('status')) otdrStatusColId = c.id;
            });
        });

        let otdrTriggeredCount = 0;
        if (aplStatusColId && knotenStatusColId && otdrStatusColId) {
            data.forEach(rowObj => {
                const aplDone = (rowObj[aplStatusColId] || '').trim() === 'Done';
                const knotenDone = (rowObj[knotenStatusColId] || '').trim() === 'Done';
                const otdrCurrent = (rowObj[otdrStatusColId] || '').trim();
                if (aplDone && knotenDone && otdrCurrent !== 'Done' && otdrCurrent !== 'Waiting') {
                    rowObj[otdrStatusColId] = 'Waiting';
                    otdrTriggeredCount++;
                }
            });
        }

        // Rebuild E2 with potentially updated OTDR statuses
        const finalE2 = [E2_0];
        data.forEach(rowObj => {
            let rowArr = [];
            schema.forEach(g => {
                let groupArr = [];
                g.cols.forEach(c => { groupArr.push(rowObj[c.id] || ""); });
                rowArr.push(groupArr);
            });
            finalE2.push(rowArr);
        });

        // ── Cell-level diff ───────────────────────────────────────────────
        // Find cluster / knotenpunkt col IDs for context in log messages
        let clusterColId = null, knotenColId = null;
        schema.forEach(g => {
            g.cols.forEach(c => {
                const l = c.label.toLowerCase();
                if (l === 'cluster') clusterColId = c.id;
                if (l === 'knotenpunkt' || l === 'nvt') knotenColId = c.id;
            });
        });

        const changedRows = [];
        finalE2.slice(1).forEach((row, rIdx) => {
            const rowId = row[0]?.[0] || `ROW-${rIdx}`;
            const clusterVal = clusterColId ? (row[schema.findIndex(g => g.cols.some(c => c.id === clusterColId))]?.[schema.find(g => g.cols.some(c => c.id === clusterColId))?.cols.findIndex(c => c.id === clusterColId)] || '') : '';
            const knotenVal  = knotenColId  ? (row[schema.findIndex(g => g.cols.some(c => c.id === knotenColId))]?.[schema.find(g => g.cols.some(c => c.id === knotenColId))?.cols.findIndex(c => c.id === knotenColId)]  || '') : '';
            const changes = [];
            schema.forEach((group, i) => {
                group.cols.forEach((col, j) => {
                    const newVal = (row[i] && row[i][j] != null) ? String(row[i][j]) : '';
                    const oldVal = oldFlatData[rowId] ? (oldFlatData[rowId][col.id] ?? '') : null;
                    if (oldVal === null) return; // new file — skip diff noise
                    if (oldVal !== newVal) {
                        const isOtdrTrigger = col.id === otdrStatusColId && newVal === 'Waiting';
                        changes.push({ label: col.label, oldVal, newVal, isOtdrTrigger });
                    }
                });
            });
            if (changes.length > 0) {
                changedRows.push({ rowId, cluster: String(clusterVal).trim(), knoten: String(knotenVal).trim(), changes });
            }
        });

        // Build human-readable log details
        let logDetails;
        if (changedRows.length === 0) {
            logDetails = `Saved ${data.length} rows for project "${req.query.project || ''}" (no cell changes)${otdrTriggeredCount > 0 ? ` [OTDR auto-triggered for ${otdrTriggeredCount} row(s)]` : ''}`;
        } else if (changedRows.length === 1) {
            const r = changedRows[0];
            const ctx = [r.cluster && `Cluster: ${r.cluster}`, r.knoten && `Knotenpunkt: ${r.knoten}`].filter(Boolean).join(' | ');
            logDetails = `Row "${r.rowId}"${ctx ? ` | ${ctx}` : ''}\n` +
                r.changes.map(c => c.isOtdrTrigger
                    ? `  - [OTDR auto-triggered → "${c.newVal}"]`
                    : `  - "${c.label}": "${c.oldVal}" → "${c.newVal}"`
                ).join('\n');
        } else {
            logDetails = `Aufmass changes (${changedRows.length} rows modified):\n` +
                changedRows.map(r => {
                    const changesStr = r.changes.map(c => c.isOtdrTrigger
                        ? `[OTDR auto→Waiting]`
                        : `${c.label}: "${c.oldVal}"→"${c.newVal}"`
                    ).join(', ');
                    return `Row "${r.rowId}": ${changesStr}`;
                }).join('\n');
        }

        // ── Optimistic locking: check versions for changed rows ──────────
        let rowVersions = {};
        const rvPath = path.join(getProjectRoot(req.query.project), 'row-versions.json');
        try { rowVersions = JSON.parse(await fs.readFile(rvPath, 'utf-8')); } catch { }

        // Check client versions against server versions for changed rows
        const clientVersions = {};
        data.forEach(row => { if (row._version !== undefined) clientVersions[row._id] = parseInt(row._version, 10); });

        const conflicts = [];
        changedRows.forEach(r => {
            const serverVer = rowVersions[r.rowId] || 0;
            const clientVer = clientVersions[r.rowId];
            if (clientVer !== undefined && clientVer !== serverVer) {
                conflicts.push({ rowId: r.rowId, serverVersion: serverVer, clientVersion: clientVer });
            }
        });

        if (conflicts.length > 0) {
            return res.status(409).json({
                success: false,
                conflict: true,
                message: `${conflicts.length} row(s) were modified by another user. Please refresh the page.`,
                conflicts
            });
        }

        await fs.writeFile(filePath, JSON.stringify([E1, finalE2], null, 2), 'utf-8');

        // Increment versions for changed rows
        changedRows.forEach(r => { rowVersions[r.rowId] = (rowVersions[r.rowId] || 0) + 1; });
        try { await fs.writeFile(rvPath, JSON.stringify(rowVersions), 'utf-8'); } catch (rvErr) {
            console.error('[dataRoutes] Failed to write row-versions.json:', rvErr.message);
        }

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        const projectName = req.query.project || '';
        await logAction(userEmail, 'Data Saved', logDetails);

        // Return updated versions to client
        const updatedVersions = {};
        data.forEach(row => { updatedVersions[row._id] = rowVersions[row._id] || 0; });
        res.json({ success: true, otdrTriggered: otdrTriggeredCount, rowVersions: updatedVersions });

        // --- NAS sync: push updated datafile to NAS (fire-and-forget) ---
        const relFilePath = path.relative(STORAGE_ROOT, filePath).replace(/\\/g, '/');
        syncFile(relFilePath);

        // --- Versioned copy + Excel export (fire-and-forget) ---
        setImmediate(async () => {
            try { await saveVersionedCopy(filePath, E1, finalE2); }
            catch (e) { console.error('Versioning error:', e.message); }
        });

        // --- Auto-sync cluster/knotenpunkt folders (fire-and-forget after response) ---
        if (projectName && schema && data) {
            setImmediate(async () => {
                try {
                    // Find cluster and knotenpunkt column IDs by label
                    let clusterColId = null, knotenpunktColId = null;
                    schema.forEach(g => {
                        g.cols.forEach(c => {
                            if (c.label.toLowerCase() === 'cluster') clusterColId = c.id;
                            if (c.label.toLowerCase() === 'knotenpunkt' || c.label.toLowerCase() === 'nvt') knotenpunktColId = c.id;
                        });
                    });

                    if (!clusterColId) return;

                    // Build cluster → knotenpunkte map from saved data
                    const clusterKnoten = {};
                    data.forEach(row => {
                        const cluster = row[clusterColId]?.trim();
                        const knoten = knotenpunktColId ? row[knotenpunktColId]?.trim() : null;
                        if (cluster) {
                            if (!clusterKnoten[cluster]) clusterKnoten[cluster] = new Set();
                            if (knoten) clusterKnoten[cluster].add(knoten);
                        }
                    });

                    const safeNames = await getSafeClusterNames(projectName);
                    await performFolderSync(projectName, clusterKnoten, safeNames, logAction);
                } catch (syncErr) {
                    console.error('Post-save sync error:', syncErr.message);
                }
            });
        }
    } catch (error) { 
        console.error("Save Data Error:", error.message);
        res.status(500).json({ success: false }); 
    }
});

module.exports = router;
