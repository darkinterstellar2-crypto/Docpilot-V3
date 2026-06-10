#!/usr/bin/env node
/**
 * scripts/migrate-aufmass-to-pg.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Migrate Aufmass flat-file data (.txt) to PostgreSQL.
 * AUFMASS-ONLY — does NOT touch users/projects.json/chat/settings/logs.
 *
 * Usage:
 *   node scripts/migrate-aufmass-to-pg.js             # run migration
 *   node scripts/migrate-aufmass-to-pg.js --dry-run   # print counts, ROLLBACK
 *   npm run migrate:aufmass
 *   npm run migrate:aufmass:dry
 *
 * ─── Flat-file format ────────────────────────────────────────────────────────
 *   rawData = [E1, E2]
 *   E1 = ["Identification","Timing","Location",...]   // group titles
 *   E2 = [E2_0, row1, row2, ...]
 *   E2_0 = [["Unique Project ID","Metadata"],["Date"],...]  // sub-cols per group
 *   rowN = [["ROW-001",""],["2026-01-15"],...]              // values per group
 *   row[0][0] = unique row id
 *
 * ─── Column type inference rules ─────────────────────────────────────────────
 *   "status"   : label contains "status" OR is one of known status labels
 *                options = ["Done","Pending","Waiting","Error","N/A","Incomplete"]
 *   "date"     : label contains "date" OR is exactly "date"
 *   "number"   : label contains: total|metrierung|splice|splices|lwl start|lwl end|count
 *   "dropdown" : label contains: fiber type|fiber count|type|cluster|knotenpunkt|nvt
 *   "text"     : everything else (default)
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 *   aufmass_schema → ON CONFLICT (project_name) DO UPDATE
 *   aufmass_row    → DELETE all rows for project, then INSERT (clean re-import)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs      = require('fs').promises;
const path    = require('path');
const { transaction } = require('../controllers/db');

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN      = process.argv.includes('--dry-run');
const STORAGE_ROOT = process.env.STORAGE_ROOT
    ? path.resolve(process.env.STORAGE_ROOT)
    : path.join(__dirname, '..', 'storage');

// ─── Column type inference ────────────────────────────────────────────────────

const STATUS_LABELS = new Set(['status', 'status einblasen', 'apl status', 'knotenpunkt status',
    'status kalibrieren', 'status druckprüfung', 'status otdr']);

const NUMBER_PATTERNS = ['total', 'metrierung', 'splices', 'splice', 'lwl start', 'lwl end',
    'lwl', 'count', 'number of'];

const DROPDOWN_PATTERNS = ['fiber type', 'fiber count', 'type', 'cluster', 'knotenpunkt', 'nvt'];

const DATE_PATTERNS = ['date', 'datum'];

/**
 * Infer column type from label string.
 * Returns { type, options? }
 */
function inferType(label) {
    const l = label.toLowerCase().trim();

    // Status first — often label is just "Status" within a specific group
    if (STATUS_LABELS.has(l) || l.includes('status')) {
        return { type: 'status', options: ['Done', 'Pending', 'Waiting', 'Error', 'N/A', 'Incomplete'] };
    }

    if (DATE_PATTERNS.some(p => l === p || l.startsWith(p))) {
        return { type: 'date' };
    }

    if (NUMBER_PATTERNS.some(p => l.includes(p))) {
        return { type: 'number' };
    }

    // File location columns → text (path strings)
    if (l.includes('file') || l.includes('folder') || l.includes('location')) {
        return { type: 'text' };
    }

    if (DROPDOWN_PATTERNS.some(p => l.includes(p))) {
        return { type: 'dropdown', options: [] };
    }

    return { type: 'text' };
}

// ─── Slug / stable ID generation ─────────────────────────────────────────────

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/**
 * Build stable column id: "col-<group-slug>-<label-slug>"
 * If two columns in the same group would collide, append an index suffix.
 */
function buildColumnId(groupSlug, labelSlug, usedIds) {
    let base = `col-${groupSlug}-${labelSlug}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
        id = `${base}-${n++}`;
    }
    usedIds.add(id);
    return id;
}

// ─── Schema builder ───────────────────────────────────────────────────────────

/**
 * Build schema_json from E1 / E2_0.
 * Returns an array of group objects.
 */
function buildSchemaJson(E1, E2_0) {
    const usedGroupIds = new Set();
    const usedColIds   = new Set();

    return E1.map((groupTitle, i) => {
        const gSlug = slugify(groupTitle || `group-${i}`);
        let gId = `grp-${gSlug}`;
        let n = 2;
        while (usedGroupIds.has(gId)) gId = `grp-${gSlug}-${n++}`;
        usedGroupIds.add(gId);

        const isIdentification = groupTitle.toLowerCase() === 'identification';

        const subCols = E2_0[i] || [];
        const columns = subCols.map((label, j) => {
            const lSlug = slugify(label || `col-${j}`);
            const colId = buildColumnId(gSlug, lSlug, usedColIds);
            const { type, options } = inferType(label || '');

            const col = {
                id:    colId,
                label: label || '',
                type,
                format:     {},
                validation: { required: false },
                display: {
                    width:  type === 'status' ? 130 : type === 'date' ? 110 : 160,
                    align:  type === 'number' ? 'right' : 'left',
                    frozen: false,
                    hidden: isIdentification, // Identification group hidden by default
                    color:  null,
                    bold:   false,
                },
                totals: type === 'number' ? 'sum' : 'none',
            };

            if (options !== undefined) col.options = options;
            if (type === 'date') col.format = { dateFormat: 'DD.MM.YYYY' };
            if (type === 'number') col.format = { decimals: 0 };

            return col;
        });

        return {
            id:      gId,
            title:   groupTitle,
            columns,
        };
    });
}

// ─── Row converter ────────────────────────────────────────────────────────────

/**
 * Convert a nested data row to a flat cells object.
 * cells = { "col-<id>": "value", ... }
 */
function buildCells(row, schemaJson) {
    const cells = {};
    schemaJson.forEach((group, i) => {
        group.columns.forEach((col, j) => {
            const val = row[i] && row[i][j] != null ? String(row[i][j]) : '';
            cells[col.id] = val;
        });
    });
    return cells;
}

// ─── .txt parser ─────────────────────────────────────────────────────────────

/**
 * Parse a DocPilot Aufmass .txt file.
 * Returns { E1, E2_0, dataRows }.
 */
async function parseAufmassFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(content);
    const E1      = rawData[0];
    const E2      = rawData[1];
    const E2_0    = E2[0];
    const dataRows = E2.slice(1);
    return { E1, E2_0, dataRows };
}

// ─── Project discovery ────────────────────────────────────────────────────────

/**
 * Discover projects to migrate.
 * Priority:
 *   1. Names from projects.json (flat file — read but not migrated)
 *   2. + any project folders in STORAGE_ROOT that have a non-empty aufmass .txt
 */
async function discoverProjects() {
    const projects = new Set();

    // 1. projects.json
    const projJsonPath = path.join(__dirname, '..', 'src', 'DataFiles', 'projects.json');
    try {
        const data = JSON.parse(await fs.readFile(projJsonPath, 'utf-8'));
        const names = Array.isArray(data) ? data.map(p => p.name || p).filter(Boolean) : [];
        names.forEach(n => projects.add(n));
        console.log(`[discover] ${names.length} project(s) from projects.json`);
    } catch (e) {
        console.warn(`[discover] Could not read projects.json: ${e.message}`);
    }

    // 2. Storage folders
    try {
        const entries = await fs.readdir(STORAGE_ROOT, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name    = entry.name;
            const txtPath = path.join(STORAGE_ROOT, name, 'Doku', 'Aufmass', 'datafile', `${name}.txt`);
            try {
                const stat = await fs.stat(txtPath);
                if (stat.size > 0) projects.add(name);
            } catch { /* no aufmass file for this project */ }
        }
    } catch (e) {
        console.warn(`[discover] Could not scan STORAGE_ROOT (${STORAGE_ROOT}): ${e.message}`);
    }

    return Array.from(projects);
}

// ─── Single project migration ─────────────────────────────────────────────────

async function migrateProject(client, projectName, dryRun) {
    const txtPath = path.join(STORAGE_ROOT, projectName, 'Doku', 'Aufmass', 'datafile', `${projectName}.txt`);

    // Check file exists + is non-empty
    let stat;
    try { stat = await fs.stat(txtPath); } catch {
        console.warn(`  [${projectName}] No .txt file found — skipping`);
        return null;
    }
    if (stat.size === 0) {
        console.warn(`  [${projectName}] .txt is empty — skipping`);
        return null;
    }

    // Parse
    const { E1, E2_0, dataRows } = await parseAufmassFile(txtPath);

    // Build schema
    const schemaJson = buildSchemaJson(E1, E2_0);
    const groupCount = schemaJson.length;
    const colCount   = schemaJson.reduce((s, g) => s + g.columns.length, 0);

    // Convert rows
    const cellsArray = dataRows.map((row, idx) => ({
        rowId:     String(row[0]?.[0] || `ROW-${idx}`),
        cells:     buildCells(row, schemaJson),
        sortOrder: idx,
    }));

    console.log(`  [${projectName}] groups=${groupCount} cols=${colCount} rows=${cellsArray.length}`);

    if (dryRun) {
        // Print sample
        if (cellsArray.length > 0) {
            console.log(`  [${projectName}] Sample row 0:`, JSON.stringify(cellsArray[0].cells).slice(0, 200));
        }
        if (cellsArray.length > 1) {
            console.log(`  [${projectName}] Sample row 1:`, JSON.stringify(cellsArray[1].cells).slice(0, 200));
        }
    }

    // ── Upsert schema ────────────────────────────────────────────────────────
    await client.query(`
        INSERT INTO aufmass_schema (project_name, schema_json, version, updated_by)
        VALUES ($1, $2, 1, 'migration')
        ON CONFLICT (project_name)
        DO UPDATE SET
            schema_json = EXCLUDED.schema_json,
            version     = aufmass_schema.version + 1,
            updated_at  = now(),
            updated_by  = 'migration'
    `, [projectName, JSON.stringify(schemaJson)]);

    // ── Clear + reinsert rows ─────────────────────────────────────────────────
    await client.query('DELETE FROM aufmass_row WHERE project_name = $1', [projectName]);

    if (cellsArray.length > 0) {
        // Batch insert: build multi-row VALUES
        const values  = [];
        const params  = [];
        let   pIdx    = 1;

        for (const { rowId, cells, sortOrder } of cellsArray) {
            values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, 1, 'migration')`);
            params.push(projectName, rowId, JSON.stringify(cells), sortOrder);
        }

        await client.query(`
            INSERT INTO aufmass_row (project_name, row_id, cells, sort_order, version, updated_by)
            VALUES ${values.join(', ')}
        `, params);
    }

    return { projectName, groupCount, colCount, rowCount: cellsArray.length, schemaJson };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🚀 Aufmass → PostgreSQL migration  [${DRY_RUN ? 'DRY-RUN — will ROLLBACK' : 'LIVE'}]`);
    console.log(`   STORAGE_ROOT: ${STORAGE_ROOT}\n`);

    const projectNames = await discoverProjects();
    if (projectNames.length === 0) {
        console.warn('No projects found. Nothing to migrate.');
        process.exit(0);
    }
    console.log(`Found ${projectNames.length} project(s): ${projectNames.join(', ')}\n`);

    try {
        await transaction(async (client) => {
            const results = [];

            for (const name of projectNames) {
                const result = await migrateProject(client, name, DRY_RUN);
                if (result) results.push(result);
            }

            if (DRY_RUN) {
                // Print full schema for the first migrated project (for verification)
                if (results.length > 0) {
                    console.log('\n── Schema JSON (first project) ────────────────────────────────');
                    console.log(JSON.stringify(results[0].schemaJson, null, 2));
                }
                console.log('\n── Summary ────────────────────────────────────────────────────');
                results.forEach(r => {
                    console.log(`  ${r.projectName}: ${r.groupCount} groups, ${r.colCount} cols, ${r.rowCount} rows`);
                });
                console.log('\n[DRY-RUN] Rolling back transaction. No data was changed.\n');
                throw new DryRunDone(); // triggers ROLLBACK
            }

            console.log('\n── Migration complete ─────────────────────────────────────────');
            results.forEach(r => {
                console.log(`  ✓ ${r.projectName}: ${r.rowCount} rows migrated`);
            });
        });
    } catch (err) {
        if (err instanceof DryRunDone) {
            console.log('[DRY-RUN] ✅  Dry-run finished. DB unchanged.');
            process.exit(0);
        }
        console.error('\n❌ Migration failed:', err.message);
        process.exit(1);
    }

    console.log('\n✅  Migration complete.\n');
    process.exit(0);
}

class DryRunDone extends Error { constructor() { super('DryRunDone'); } }

main().catch(err => { console.error(err); process.exit(1); });
