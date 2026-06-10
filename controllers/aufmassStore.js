/**
 * controllers/aufmassStore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Aufmass data-access layer — all reads/writes go through here.
 *
 * Single-tenant: TENANT_ID from env used as application-level annotation
 * (stored in updated_by prefix); the actual filter is project_name.
 *
 * Every write also triggers a fire-and-forget legacy .txt + .xlsx snapshot
 * via dataVersioning.js for backup / rollback safety.
 *
 * ─── API response shape note ─────────────────────────────────────────────────
 * getRows() returns data in the SAME flat-object shape that dataRoutes.js
 * currently returns to table.js:
 *   [ { _id, _version, "col-<id>": value, ... }, ... ]
 *
 * getSchema() returns the schema array in the SAME shape table.js expects:
 *   [ { id, title, cols: [ { id, label }, ... ] }, ... ]
 * PLUS additional per-column metadata (type, options, display, etc.)
 * which table.js ignores today but will use in the enhanced grid.
 *
 * ─── Fallback ─────────────────────────────────────────────────────────────────
 * If the DB has no schema for a project yet (not migrated), callers should
 * fall back to the legacy .txt path. This is handled in dataRoutes.js.
 */

'use strict';

const path = require('path');
const fs   = require('fs').promises;

const { query, transaction } = require('./db');
const { saveVersionedCopy }  = require('./dataVersioning');
const { getDatafileDir }     = require('./storageConfig');

const TENANT_ID = process.env.TENANT_ID || 'default';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function userTag(user) {
    return `${TENANT_ID}:${user || 'system'}`;
}

/**
 * Convert DB schema_json (array of groups with rich column metadata) to the
 * legacy response shape that table.js currently consumes:
 *   [ { id, title, cols: [ { id, label, ...extras } ] } ]
 *
 * The extras (type, options, display, etc.) are additive — old frontend ignores
 * unknown keys; new frontend uses them.
 */
function schemaToApiShape(schemaJson) {
    return (schemaJson || []).map(group => ({
        id:    group.id,
        title: group.title,
        // "cols" is what table.js / dataRoutes expects
        cols: (group.columns || []).map(col => ({
            id:         col.id,
            label:      col.label,
            // extras (forward-compat)
            type:       col.type,
            options:    col.options,
            format:     col.format,
            validation: col.validation,
            display:    col.display,
            totals:     col.totals,
        })),
        // also expose columns for new grid code
        columns: group.columns,
    }));
}

/**
 * Convert flat DB rows back to the legacy API flat-object shape:
 *   { _id, _version, "col-grp-slug-col-slug": value, ... }
 */
function rowsToApiShape(dbRows) {
    return dbRows.map(r => ({
        _id:      r.row_id,
        _version: r.version,
        ...(r.cells || {}),
    }));
}

// ─── Schema ops ───────────────────────────────────────────────────────────────

/**
 * Get the schema for a project.
 * Returns the API-shaped schema array, or null if not in DB yet.
 */
async function getSchema(projectName) {
    const res = await query(
        'SELECT schema_json, version FROM aufmass_schema WHERE project_name = $1',
        [projectName]
    );
    if (res.rowCount === 0) return null;
    return {
        schema:        schemaToApiShape(res.rows[0].schema_json),
        schemaVersion: res.rows[0].version,
        _raw:          res.rows[0].schema_json, // raw form for internal use
    };
}

/**
 * Save (upsert) a schema for a project.
 * schemaJson must be the full raw array (as stored in DB — with 'columns' not 'cols').
 */
async function saveSchema(projectName, schemaJson, user) {
    await query(`
        INSERT INTO aufmass_schema (project_name, schema_json, version, updated_by)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (project_name)
        DO UPDATE SET
            schema_json = EXCLUDED.schema_json,
            version     = aufmass_schema.version + 1,
            updated_at  = now(),
            updated_by  = EXCLUDED.updated_by
    `, [projectName, JSON.stringify(schemaJson), userTag(user)]);
}

// ─── Row ops ──────────────────────────────────────────────────────────────────

/**
 * Get all rows for a project, ordered by sort_order.
 * Returns { data, rowVersions } where:
 *   data = flat objects as table.js expects
 *   rowVersions = { rowId: version }
 */
async function getRows(projectName) {
    const res = await query(
        'SELECT row_id, cells, sort_order, version FROM aufmass_row WHERE project_name = $1 ORDER BY sort_order ASC, created_at ASC',
        [projectName]
    );
    const data        = rowsToApiShape(res.rows);
    const rowVersions = {};
    res.rows.forEach(r => { rowVersions[r.row_id] = r.version; });
    return { data, rowVersions };
}

/**
 * Save (replace) all rows for a project.
 * rows: flat objects [ { _id, _version, "col-...": value, ... } ]
 * schema: API-shape schema (to determine which col ids are valid)
 *
 * Uses optimistic locking: if a row's _version doesn't match DB, returns
 * { conflict: true, conflicts: [...] } instead of writing.
 *
 * Returns { success, rowVersions } on success.
 */
async function saveRows(projectName, rows, schema, user) {
    return transaction(async (client) => {
        // ── Optimistic locking check ──────────────────────────────────────
        const rowIds = rows.map(r => r._id).filter(Boolean);
        if (rowIds.length > 0) {
            const existing = await client.query(
                'SELECT row_id, version FROM aufmass_row WHERE project_name = $1 AND row_id = ANY($2)',
                [projectName, rowIds]
            );
            const serverVersions = {};
            existing.rows.forEach(r => { serverVersions[r.row_id] = r.version; });

            const conflicts = [];
            rows.forEach(r => {
                const sv = serverVersions[r._id];
                const cv = r._version !== undefined ? parseInt(r._version, 10) : undefined;
                if (sv !== undefined && cv !== undefined && cv !== sv) {
                    conflicts.push({ rowId: r._id, serverVersion: sv, clientVersion: cv });
                }
            });

            if (conflicts.length > 0) {
                return { conflict: true, conflicts };
            }
        }

        // ── Clear + reinsert ──────────────────────────────────────────────
        await client.query('DELETE FROM aufmass_row WHERE project_name = $1', [projectName]);

        const newRowVersions = {};
        if (rows.length > 0) {
            const values = [];
            const params = [];
            let   pIdx   = 1;

            rows.forEach((row, idx) => {
                const rowId = row._id || `ROW-${idx}`;
                const cells = {};
                Object.keys(row).forEach(k => {
                    if (!k.startsWith('_')) cells[k] = row[k];
                });

                values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, 1, $${pIdx++})`);
                params.push(projectName, rowId, JSON.stringify(cells), idx, userTag(user));
                newRowVersions[rowId] = 1;
            });

            await client.query(`
                INSERT INTO aufmass_row (project_name, row_id, cells, sort_order, version, updated_by)
                VALUES ${values.join(', ')}
            `, params);
        }

        return { success: true, rowVersions: newRowVersions };
    });
}

/**
 * Update a single cell value in a row.
 * Returns { success, newVersion } or { conflict: true }.
 */
async function updateCell(projectName, rowId, colId, value, clientVersion, user) {
    return transaction(async (client) => {
        const res = await client.query(
            'SELECT version, cells FROM aufmass_row WHERE project_name = $1 AND row_id = $2 FOR UPDATE',
            [projectName, rowId]
        );
        if (res.rowCount === 0) throw new Error(`Row "${rowId}" not found in project "${projectName}"`);

        const row = res.rows[0];
        if (clientVersion !== undefined && parseInt(clientVersion, 10) !== row.version) {
            return { conflict: true, serverVersion: row.version };
        }

        const cells = { ...(row.cells || {}), [colId]: value };
        const newVersion = row.version + 1;

        await client.query(
            'UPDATE aufmass_row SET cells = $1, version = $2, updated_by = $3 WHERE project_name = $4 AND row_id = $5',
            [JSON.stringify(cells), newVersion, userTag(user), projectName, rowId]
        );

        return { success: true, newVersion };
    });
}

/**
 * Add a new row to a project.
 */
async function addRow(projectName, rowId, cells, user) {
    const res = await query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM aufmass_row WHERE project_name = $1',
        [projectName]
    );
    const sortOrder = res.rows[0].next_order;

    await query(`
        INSERT INTO aufmass_row (project_name, row_id, cells, sort_order, version, updated_by)
        VALUES ($1, $2, $3, $4, 1, $5)
    `, [projectName, rowId, JSON.stringify(cells || {}), sortOrder, userTag(user)]);
}

/**
 * Delete a row from a project.
 */
async function deleteRow(projectName, rowId, user) {
    await query(
        'DELETE FROM aufmass_row WHERE project_name = $1 AND row_id = $2',
        [projectName, rowId]
    );
}

/**
 * Reorder rows: rowIds = ordered array of row_id strings.
 * Updates sort_order for each row.
 */
async function reorderRows(projectName, rowIds, user) {
    return transaction(async (client) => {
        for (let i = 0; i < rowIds.length; i++) {
            await client.query(
                'UPDATE aufmass_row SET sort_order = $1, updated_by = $2 WHERE project_name = $3 AND row_id = $4',
                [i, userTag(user), projectName, rowIds[i]]
            );
        }
    });
}

// ─── Column / Group schema mutations ─────────────────────────────────────────

/**
 * Add a column to a group in the schema.
 * colDef: { id, label, type, options?, format?, validation?, display?, totals? }
 */
async function addColumn(projectName, groupId, colDef, user) {
    const rec = await query('SELECT schema_json FROM aufmass_schema WHERE project_name = $1', [projectName]);
    if (rec.rowCount === 0) throw new Error(`No schema for project "${projectName}"`);

    const schemaJson = rec.rows[0].schema_json;
    const group = schemaJson.find(g => g.id === groupId);
    if (!group) throw new Error(`Group "${groupId}" not found`);

    group.columns = group.columns || [];
    group.columns.push(colDef);

    await saveSchema(projectName, schemaJson, user);
}

/**
 * Remove a column from the schema (by colId).
 * Also cleans up that col from all rows' cells JSONB.
 */
async function removeColumn(projectName, colId, user) {
    return transaction(async (client) => {
        const rec = await client.query('SELECT schema_json FROM aufmass_schema WHERE project_name = $1 FOR UPDATE', [projectName]);
        if (rec.rowCount === 0) throw new Error(`No schema for project "${projectName}"`);

        const schemaJson = rec.rows[0].schema_json;
        schemaJson.forEach(g => {
            g.columns = (g.columns || []).filter(c => c.id !== colId);
        });

        await client.query(`
            UPDATE aufmass_schema SET schema_json = $1, version = version + 1, updated_by = $2 WHERE project_name = $3
        `, [JSON.stringify(schemaJson), userTag(user), projectName]);

        // Remove key from all row cells
        await client.query(
            `UPDATE aufmass_row SET cells = cells - $1, updated_by = $2 WHERE project_name = $3`,
            [colId, userTag(user), projectName]
        );
    });
}

/**
 * Reorder columns within a group.
 * colIds: ordered array of column id strings.
 */
async function reorderColumns(projectName, groupId, colIds, user) {
    const rec = await query('SELECT schema_json FROM aufmass_schema WHERE project_name = $1', [projectName]);
    if (rec.rowCount === 0) throw new Error(`No schema for project "${projectName}"`);

    const schemaJson = rec.rows[0].schema_json;
    const group = schemaJson.find(g => g.id === groupId);
    if (!group) throw new Error(`Group "${groupId}" not found`);

    const colMap = {};
    (group.columns || []).forEach(c => { colMap[c.id] = c; });
    group.columns = colIds.map(id => colMap[id]).filter(Boolean);

    await saveSchema(projectName, schemaJson, user);
}

/**
 * Add a new group to the schema.
 */
async function addGroup(projectName, groupDef, user) {
    const rec = await query('SELECT schema_json FROM aufmass_schema WHERE project_name = $1', [projectName]);
    if (rec.rowCount === 0) throw new Error(`No schema for project "${projectName}"`);

    const schemaJson = rec.rows[0].schema_json;
    schemaJson.push({ ...groupDef, columns: groupDef.columns || [] });
    await saveSchema(projectName, schemaJson, user);
}

/**
 * Remove a group (and all its columns) from the schema.
 */
async function removeGroup(projectName, groupId, user) {
    return transaction(async (client) => {
        const rec = await client.query('SELECT schema_json FROM aufmass_schema WHERE project_name = $1 FOR UPDATE', [projectName]);
        if (rec.rowCount === 0) throw new Error(`No schema for project "${projectName}"`);

        const schemaJson = rec.rows[0].schema_json;
        const group = schemaJson.find(g => g.id === groupId);
        const colIds = (group?.columns || []).map(c => c.id);

        const newSchema = schemaJson.filter(g => g.id !== groupId);
        await client.query(
            'UPDATE aufmass_schema SET schema_json = $1, version = version + 1, updated_by = $2 WHERE project_name = $3',
            [JSON.stringify(newSchema), userTag(user), projectName]
        );

        // Remove all column keys from row cells
        if (colIds.length > 0) {
            for (const colId of colIds) {
                await client.query(
                    `UPDATE aufmass_row SET cells = cells - $1 WHERE project_name = $2`,
                    [colId, projectName]
                );
            }
        }
    });
}

// ─── Legacy snapshot trigger ──────────────────────────────────────────────────

/**
 * Fire-and-forget: rebuild the legacy [E1, E2] nested format from DB rows
 * and write a timestamped .txt + .xlsx copy via dataVersioning.js.
 *
 * Never throws — errors are logged, not propagated.
 *
 * @param {string} projectName
 * @param {Array}  schemaJson  - raw schema_json from DB
 * @param {Array}  dbRows      - rows from aufmass_row (with .row_id, .cells)
 */
function triggerLegacySnapshot(projectName, schemaJson, dbRows) {
    setImmediate(async () => {
        try {
            // Rebuild E1 + E2_0
            const E1   = schemaJson.map(g => g.title);
            const E2_0 = schemaJson.map(g => (g.columns || []).map(c => c.label));

            // Rebuild data rows in nested format
            const dataRows = dbRows.map(r => {
                return schemaJson.map(group => {
                    return (group.columns || []).map(col => r.cells?.[col.id] ?? '');
                });
            });

            const E2      = [E2_0, ...dataRows];
            const dir     = getDatafileDir(projectName);
            const filePath = path.join(dir, `${projectName}.txt`);

            await fs.mkdir(dir, { recursive: true });
            await saveVersionedCopy(filePath, E1, E2);
        } catch (e) {
            console.error(`[aufmassStore] Legacy snapshot error for "${projectName}":`, e.message);
        }
    });
}

module.exports = {
    // Schema
    getSchema,
    saveSchema,
    // Rows
    getRows,
    saveRows,
    updateCell,
    addRow,
    deleteRow,
    reorderRows,
    // Columns
    addColumn,
    removeColumn,
    reorderColumns,
    // Groups
    addGroup,
    removeGroup,
    // Internal helpers (exported for use in routes)
    schemaToApiShape,
    rowsToApiShape,
    triggerLegacySnapshot,
    userTag,
};
