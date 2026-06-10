// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// aufmass_schemas: stores the column schema (E1 + E2_0 + schema_json)
// aufmass_rows: one row per cable segment; data as JSONB; version column for optimistic locking
//
// IMPORTANT: Same API response format preserved — frontend must not break.
//
// GET /api/data?project=X  → { schema, data } — same shape as before
// POST /api/data?project=X → { success, otdrTriggered, rowVersions } — same shape as before
//
// Optimistic locking: check row.version === client._version before UPDATE.

const express = require('express');
const router = express.Router();
const db = require('../controllers/db');
const { logAction } = require('../controllers/logger');
const { saveVersionedCopy } = require('../controllers/dataVersioning');
const { syncClusterFolders, syncKnotenpunktFolders, getExistingClusters, getExistingKnotenpunkte, performFolderSync } = require('../controllers/folderSync');
const { getDatafileDir, STORAGE_ROOT, getProjectRoot } = require('../controllers/storageConfig');
const { syncFile } = require('../controllers/nasSync');
const { canAccessProject, canAccessModule, canEditProject } = require('../controllers/accessControl');

// Also needed for versioned file writes (Excel exports etc)
const fs = require('fs').promises;
const path = require('path');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getProjectId(projectName) {
    if (!projectName) return null;
    const r = await db.query(
        'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
        [TENANT_ID, projectName]
    );
    return r.rows[0]?.id || null;
}

async function getUserId(email) {
    if (!email) return null;
    const r = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return r.rows[0]?.id || null;
}

/**
 * Load active schema for a project from DB.
 * Returns { schemaId, schema (array), E1, E2_0 } or null.
 */
async function loadSchema(projectId) {
    const r = await db.query(
        `SELECT id, schema_json, e1_json, e2_0_json
         FROM aufmass_schemas
         WHERE project_id = $1 AND is_active = true
         LIMIT 1`,
        [projectId]
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return {
        schemaId:  row.id,
        schema:    typeof row.schema_json === 'string' ? JSON.parse(row.schema_json) : row.schema_json,
        E1:        typeof row.e1_json    === 'string' ? JSON.parse(row.e1_json)    : row.e1_json,
        E2_0:      typeof row.e2_0_json  === 'string' ? JSON.parse(row.e2_0_json)  : row.e2_0_json,
    };
}

/**
 * Build schema array from E1 + E2_0 (for constructing schema_json when saving).
 */
function buildSchemaArray(E1, E2_0) {
    return E1.map((mainTitle, i) => ({
        id: `grp-${i}`,
        title: mainTitle,
        cols: (E2_0[i] || []).map((subTitle, j) => ({
            id: `col-${i}-${j}`,
            label: subTitle
        }))
    }));
}

/**
 * Extract promoted column values from row data for fast DB filtering.
 */
function extractPromotedCols(data, schema) {
    let cluster = null, knotenpunkt = null, row_date = null;
    let ein_status = null, kal_status = null, dru_status = null;
    let apl_status = null, kp_status = null, otdr_status = null;

    for (const group of schema) {
        const groupLabel = (group.title || '').toLowerCase();
        for (const col of group.cols) {
            const label = (col.label || '').toLowerCase();
            const val = data[col.id] ?? null;
            if (!val || val === '') continue;

            if (label === 'cluster')             cluster = val;
            if (label === 'knotenpunkt' || label === 'nvt') knotenpunkt = val;
            if (label === 'date')                row_date = val;
            if (label === 'apl status')          apl_status = val;
            if (label === 'knotenpunkt status')  kp_status = val;

            if (groupLabel.includes('einblasen') && label.includes('status'))   ein_status = val;
            if (groupLabel.includes('kalibrieren') && label.includes('status')) kal_status = val;
            if (groupLabel.includes('druck') && label.includes('status'))       dru_status = val;
            if (groupLabel.includes('otdr') && label.includes('status'))        otdr_status = val;
        }
    }
    return { cluster, knotenpunkt, row_date, ein_status, kal_status, dru_status, apl_status, kp_status, otdr_status };
}

// ── GET — load data ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {
        const userEmail  = req.headers['x-user-email'] || '';
        const userRole   = (req.headers['x-user-role']  || '').toLowerCase();
        const projectName = req.query.project || '';

        if (userRole !== 'superadmin') {
            if (!await canAccessProject(userEmail, projectName)) {
                return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
            }
            if (!await canAccessModule(userEmail, projectName, 'aufmass')) {
                return res.status(403).json({ success: false, message: 'Access denied: aufmass module not accessible.' });
            }
        }

        const projectId = await getProjectId(projectName);
        if (!projectId) {
            return res.status(404).json({ success: false, message: `Project not found: ${projectName}` });
        }

        const schemaData = await loadSchema(projectId);
        if (!schemaData) {
            return res.status(404).json({ success: false, message: `No schema found for project ${projectName}` });
        }

        const { schema } = schemaData;

        // Load all rows (non-deleted)
        const rowsResult = await db.query(
            `SELECT row_key, version, data
             FROM aufmass_rows
             WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false
             ORDER BY created_at ASC`,
            [projectId, TENANT_ID]
        );

        const flatData = rowsResult.rows.map(row => {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            return {
                _id: row.row_key,
                _version: row.version,
                ...data
            };
        });

        res.json({ success: true, schema, data: flatData });

        // Fire-and-forget background folder sync
        if (projectName) {
            setImmediate(async () => {
                try {
                    const clusterKnoten = {};
                    for (const row of rowsResult.rows) {
                        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                        let cluster = null, knoten = null;
                        for (const g of schema) {
                            for (const c of g.cols) {
                                const l = c.label.toLowerCase();
                                if (l === 'cluster') cluster = data[c.id];
                                if (l === 'knotenpunkt' || l === 'nvt') knoten = data[c.id];
                            }
                        }
                        if (cluster && cluster.trim()) {
                            if (!clusterKnoten[cluster.trim()]) clusterKnoten[cluster.trim()] = new Set();
                            if (knoten && knoten.trim()) clusterKnoten[cluster.trim()].add(knoten.trim());
                        }
                    }
                    await performFolderSync(projectName, clusterKnoten, [], logAction);
                } catch (e) {
                    console.error('[dataRoutes] Background sync error:', e.message);
                }
            });
        }
    } catch (e) {
        console.error('[dataRoutes] GET error:', e.message);
        res.status(500).json({ success: false, message: `Could not load data: ${e.message}` });
    }
});

// ── POST — save data ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
    try {
        const userEmail   = req.headers['x-user-email'] || '';
        const userRole    = (req.headers['x-user-role']  || '').toLowerCase();
        const projectName = req.query.project || '';

        if (userRole !== 'superadmin') {
            if (!await canAccessProject(userEmail, projectName)) {
                return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
            }
            if (!await canAccessModule(userEmail, projectName, 'aufmass')) {
                return res.status(403).json({ success: false, message: 'Access denied: aufmass module not accessible.' });
            }
            if (!await canEditProject(userEmail, projectName)) {
                return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot edit data).' });
            }
        }

        const { schema, data } = req.body;
        if (!schema || !data) return res.status(400).json({ success: false, message: 'Missing schema or data.' });

        const projectId = await getProjectId(projectName);
        if (!projectId) {
            return res.status(404).json({ success: false, message: `Project not found: ${projectName}` });
        }

        const userId = await getUserId(userEmail);

        // Build E1 + E2_0 for versioned file export
        const E1   = schema.map(g => g.title);
        const E2_0 = schema.map(g => g.cols.map(c => c.label));

        // ── OTDR auto-trigger ─────────────────────────────────────────────
        let aplStatusColId = null, knotenStatusColId = null, otdrStatusColId = null;
        schema.forEach(g => {
            g.cols.forEach(c => {
                const l = c.label.toLowerCase();
                if (l === 'apl status') aplStatusColId = c.id;
                if (l === 'knotenpunkt status') knotenStatusColId = c.id;
                if (!otdrStatusColId && g.title && g.title.toLowerCase().includes('otdr') && l.includes('status')) {
                    otdrStatusColId = c.id;
                }
            });
        });

        let otdrTriggeredCount = 0;
        if (aplStatusColId && knotenStatusColId && otdrStatusColId) {
            data.forEach(rowObj => {
                const aplDone    = (rowObj[aplStatusColId]     || '').trim() === 'Done';
                const knotenDone = (rowObj[knotenStatusColId]  || '').trim() === 'Done';
                const otdrCurrent= (rowObj[otdrStatusColId]    || '').trim();
                if (aplDone && knotenDone && otdrCurrent !== 'Done' && otdrCurrent !== 'Waiting' && otdrCurrent !== 'Incomplete') {
                    rowObj[otdrStatusColId] = 'Waiting';
                    otdrTriggeredCount++;
                }
            });
        }

        // ── Load existing rows for diff ───────────────────────────────────
        const existingRows = await db.query(
            `SELECT row_key, version, data FROM aufmass_rows
             WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false`,
            [projectId, TENANT_ID]
        );
        const existingMap = {};
        for (const row of existingRows.rows) {
            existingMap[row.row_key] = {
                version: row.version,
                data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
            };
        }

        // ── Optimistic locking check ──────────────────────────────────────
        const conflicts = [];
        for (const rowObj of data) {
            const rowId = rowObj._id;
            if (!rowId) continue;
            const existing = existingMap[rowId];
            if (!existing) continue; // new row — no conflict possible

            const clientVer = parseInt(rowObj._version, 10);
            const serverVer = existing.version;

            // Only check rows that have actual changes
            let hasChanges = false;
            for (const colId of Object.keys(rowObj)) {
                if (colId.startsWith('_')) continue;
                if ((rowObj[colId] || '') !== (existing.data[colId] || '')) {
                    hasChanges = true;
                    break;
                }
            }

            if (hasChanges && !isNaN(clientVer) && clientVer !== serverVer) {
                conflicts.push({ rowId, serverVersion: serverVer, clientVersion: clientVer });
            }
        }

        if (conflicts.length > 0) {
            return res.status(409).json({
                success: false,
                conflict: true,
                message: `${conflicts.length} row(s) were modified by another user. Please refresh the page.`,
                conflicts
            });
        }

        // ── Identify changed rows for logging ─────────────────────────────
        let clusterColId = null, knotenColId = null;
        schema.forEach(g => {
            g.cols.forEach(c => {
                const l = c.label.toLowerCase();
                if (l === 'cluster') clusterColId = c.id;
                if (l === 'knotenpunkt' || l === 'nvt') knotenColId = c.id;
            });
        });

        const changedRows = [];
        for (const rowObj of data) {
            const rowId = rowObj._id;
            if (!rowId) continue;
            const existing = existingMap[rowId];
            const oldData  = existing ? existing.data : null;
            const changes  = [];

            for (const group of schema) {
                for (const col of group.cols) {
                    const newVal = (rowObj[col.id] != null) ? String(rowObj[col.id]) : '';
                    const oldVal = oldData ? (oldData[col.id] != null ? String(oldData[col.id]) : '') : null;
                    if (oldVal === null) continue;
                    if (oldVal !== newVal) {
                        const isOtdrTrigger = col.id === otdrStatusColId && newVal === 'Waiting';
                        changes.push({ label: col.label, oldVal, newVal, isOtdrTrigger });
                    }
                }
            }
            if (changes.length > 0) {
                changedRows.push({
                    rowId,
                    cluster: clusterColId ? (rowObj[clusterColId] || '') : '',
                    knoten:  knotenColId  ? (rowObj[knotenColId]  || '') : '',
                    changes
                });
            }
        }

        // Build log details
        let logDetails;
        if (changedRows.length === 0) {
            logDetails = `Saved ${data.length} rows for project "${projectName}" (no cell changes)${otdrTriggeredCount > 0 ? ` [OTDR auto-triggered for ${otdrTriggeredCount} row(s)]` : ''}`;
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

        // ── Get or create schema ──────────────────────────────────────────
        let schemaRecord = await loadSchema(projectId);
        if (!schemaRecord) {
            // First save — create schema
            const schemaJson = buildSchemaArray(E1, E2_0);
            const schemaInsert = await db.query(
                `INSERT INTO aufmass_schemas (tenant_id, project_id, schema_json, e1_json, e2_0_json, is_active, created_by)
                 VALUES ($1, $2, $3, $4, $5, true, $6)
                 RETURNING id`,
                [TENANT_ID, projectId, JSON.stringify(schemaJson), JSON.stringify(E1), JSON.stringify(E2_0), userId]
            );
            schemaRecord = {
                schemaId: schemaInsert.rows[0].id,
                schema:   schemaJson,
                E1, E2_0
            };
        }

        // ── Upsert all rows ────────────────────────────────────────────────
        const updatedVersions = {};

        await db.transaction(async (client) => {
            for (const rowObj of data) {
                const rowId = rowObj._id;
                if (!rowId) continue;

                // Build clean data object (strip _id, _version)
                const rowData = {};
                for (const [k, v] of Object.entries(rowObj)) {
                    if (!k.startsWith('_')) rowData[k] = v;
                }

                const promoted = extractPromotedCols(rowData, schema);
                const existing = existingMap[rowId];

                if (existing) {
                    // UPDATE — increment version
                    const result = await client.query(
                        `UPDATE aufmass_rows
                         SET data         = $1,
                             version      = version + 1,
                             cluster      = $2,
                             knotenpunkt  = $3,
                             ein_status   = $4,
                             kal_status   = $5,
                             dru_status   = $6,
                             apl_status   = $7,
                             kp_status    = $8,
                             otdr_status  = $9,
                             updated_at   = NOW(),
                             updated_by   = $10
                         WHERE row_key = $11 AND project_id = $12 AND tenant_id = $13
                         RETURNING version`,
                        [
                            JSON.stringify(rowData),
                            promoted.cluster, promoted.knotenpunkt,
                            promoted.ein_status, promoted.kal_status, promoted.dru_status,
                            promoted.apl_status, promoted.kp_status, promoted.otdr_status,
                            userId,
                            rowId, projectId, TENANT_ID
                        ]
                    );
                    updatedVersions[rowId] = result.rows[0]?.version || existing.version + 1;
                } else {
                    // INSERT — new row
                    await client.query(
                        `INSERT INTO aufmass_rows
                            (tenant_id, project_id, schema_id, row_key, version, data,
                             cluster, knotenpunkt, ein_status, kal_status, dru_status,
                             apl_status, kp_status, otdr_status, updated_by)
                         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            TENANT_ID, projectId, schemaRecord.schemaId, rowId,
                            JSON.stringify(rowData),
                            promoted.cluster, promoted.knotenpunkt,
                            promoted.ein_status, promoted.kal_status, promoted.dru_status,
                            promoted.apl_status, promoted.kp_status, promoted.otdr_status,
                            userId
                        ]
                    );
                    updatedVersions[rowId] = 0;
                }
            }
        });

        await logAction(userEmail, 'Data Saved', logDetails);

        res.json({ success: true, otdrTriggered: otdrTriggeredCount, rowVersions: updatedVersions });

        // ── Post-save: versioned .txt copy + NAS sync (fire-and-forget) ─
        setImmediate(async () => {
            try {
                // Rebuild E2 for versioned copy
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

                const dir = getDatafileDir(projectName);
                await fs.mkdir(dir, { recursive: true });
                const basePath = path.join(dir, `${projectName}.txt`);
                await fs.writeFile(basePath, JSON.stringify([E1, finalE2], null, 2), 'utf-8');

                await saveVersionedCopy(basePath, E1, finalE2);

                const relFilePath = require('path').relative(STORAGE_ROOT, basePath).replace(/\\/g, '/');
                syncFile(relFilePath);
            } catch (e) {
                console.error('[dataRoutes] Post-save versioning error:', e.message);
            }

            // Auto-sync cluster/knotenpunkt folders
            try {
                let clusterColId2 = null, knotenpunktColId2 = null;
                schema.forEach(g => {
                    g.cols.forEach(c => {
                        if (c.label.toLowerCase() === 'cluster') clusterColId2 = c.id;
                        if (c.label.toLowerCase() === 'knotenpunkt' || c.label.toLowerCase() === 'nvt') knotenpunktColId2 = c.id;
                    });
                });
                if (!clusterColId2) return;
                const clusterKnoten2 = {};
                data.forEach(row => {
                    const cluster = row[clusterColId2]?.trim();
                    const knoten  = knotenpunktColId2 ? row[knotenpunktColId2]?.trim() : null;
                    if (cluster) {
                        if (!clusterKnoten2[cluster]) clusterKnoten2[cluster] = new Set();
                        if (knoten) clusterKnoten2[cluster].add(knoten);
                    }
                });
                await performFolderSync(projectName, clusterKnoten2, [], logAction);
            } catch (syncErr) {
                console.error('[dataRoutes] Post-save sync error:', syncErr.message);
            }
        });

    } catch (error) {
        console.error('[dataRoutes] POST error:', error.message);
        res.status(500).json({ success: false });
    }
});

module.exports = router;
