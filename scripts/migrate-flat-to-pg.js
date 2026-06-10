#!/usr/bin/env node
/**
 * scripts/migrate-flat-to-pg.js
 *
 * Migrates DocPilot V2 flat JSON + SQLite → PostgreSQL V3 (multi-tenant).
 *
 * Run:
 *   node scripts/migrate-flat-to-pg.js            # live migration
 *   node scripts/migrate-flat-to-pg.js --dry-run  # rolls back at the end
 *
 * Migration order (respects FK dependencies):
 *   1.  tenants
 *   2.  users
 *   3.  platform_admins
 *   4.  tenant_memberships
 *   5.  terminated_sessions
 *   6.  projects
 *   7.  project_clusters
 *   8.  project_knotenpunkte
 *   9.  project_info
 *   10. project_info_fields
 *   11. access_control
 *   12. access_control_projects
 *   13. aufmass_schemas
 *   14. aufmass_rows
 *   15. module_files
 *   16. file_shares
 *   17. file_trash
 *   18. chat_messages
 *   19. action_logs
 *   20. session_logs
 *   21. super_logs
 *   22. tenant_settings
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path    = require('path');
const fs      = require('fs');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

// ─── CLI flags ────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE — transaction will be rolled back at the end.\n');
}

// ─── Canonical tenant identity ─────────────────────────────────────────────────
// MUST match migrations/005-seeds.sql and the TENANT_ID in .env used by the app.
// Single source of truth — do not generate a random UUID here.
const CANONICAL_TENANT_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const CANONICAL_TENANT_EMAIL = 'admin@geggos.ai';

// ─── Paths ────────────────────────────────────────────────────────────────────

const APP_ROOT    = path.join(__dirname, '..');
const DATA_DIR    = path.join(APP_ROOT, 'src', 'DataFiles');
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(APP_ROOT, 'storage');

// ─── PostgreSQL pool ──────────────────────────────────────────────────────────

const pool = new Pool(
    process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
        }
        : {
            host:     process.env.PG_HOST     || 'localhost',
            port:     parseInt(process.env.PG_PORT || '5432', 10),
            user:     process.env.PG_USER     || 'docpilot_app',
            password: process.env.PG_PASSWORD || '',
            database: process.env.PG_DATABASE || 'docpilot_db',
        }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely read + parse a JSON file. Returns null if missing or invalid.
 */
function readJson(filePath, defaultValue = null) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) return defaultValue;
        return JSON.parse(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.warn(`  [skip] File not found: ${filePath}`);
        } else {
            console.warn(`  [warn] Could not parse ${filePath}: ${err.message}`);
        }
        return defaultValue;
    }
}

/** Progress counter map */
const counts = {};
function inc(table, n = 1) {
    counts[table] = (counts[table] || 0) + n;
}

/**
 * Find a column position in the E2[0] schema by label (case-insensitive).
 * Returns { grpIdx, colIdx } or null.
 */
function findColByLabel(e2_0, predicate) {
    for (let i = 0; i < e2_0.length; i++) {
        const cols = e2_0[i] || [];
        for (let j = 0; j < cols.length; j++) {
            const lbl = typeof cols[j] === 'string' ? cols[j].toLowerCase().trim() : '';
            if (predicate(lbl)) return { grpIdx: i, colIdx: j };
        }
    }
    return null;
}

/**
 * Safely get a value from a data row given { grpIdx, colIdx }.
 */
function getCell(row, pos) {
    if (!pos) return null;
    const grp = row[pos.grpIdx];
    if (!grp) return null;
    const val = grp[pos.colIdx];
    return (val != null && val !== '') ? String(val).trim() : null;
}

// ─── Main Migration ───────────────────────────────────────────────────────────

async function migrate() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log('Transaction started.\n');

        // ── 0. Create default tenant ──────────────────────────────────────────
        console.log('── Step 1: Creating tenant (Geggos) ──');
        // Use the canonical fixed UUID (matches seeds + app .env). Idempotent upsert.
        const tenantRes = await client.query(`
            INSERT INTO tenants (id, slug, name, email, plan, status, max_users, max_projects)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        `, [CANONICAL_TENANT_ID, 'geggos', 'Geggos', CANONICAL_TENANT_EMAIL, 'enterprise', 'active', 100, 999]);

        const TENANT_ID = tenantRes.rows[0].id;
        inc('tenants');
        console.log(`  Tenant ready: ${TENANT_ID}\n`);

        // ── 1. Users ──────────────────────────────────────────────────────────
        console.log('── Step 2: Migrating users ──');
        const usersRaw = readJson(path.join(DATA_DIR, 'users.json'), []);
        const emailToUUID = {};    // email → new UUID
        const emailToUser = {};    // email → user object with new UUID

        for (const u of usersRaw) {
            const res = await client.query(`
                INSERT INTO users (email, username, name, password_hash, role, is_verified, is_approved, avatar_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (LOWER(email)) DO NOTHING
                RETURNING id
            `, [
                u.email.toLowerCase().trim(),
                u.username || u.email.split('@')[0],
                u.name || u.username || u.email,
                u.password,
                (u.role === 'superadmin') ? 'superadmin' : 'user',
                u.isVerified === true,
                u.isApproved === true,
                u.avatar || null,
                u.createdAt ? new Date(u.createdAt) : new Date(),
            ]);

            let userId;
            if (res.rows.length > 0) {
                userId = res.rows[0].id;
            } else {
                // Already existed — fetch existing id
                const existing = await client.query(
                    'SELECT id FROM users WHERE LOWER(email) = $1',
                    [u.email.toLowerCase().trim()]
                );
                userId = existing.rows[0].id;
            }

            emailToUUID[u.email.toLowerCase().trim()] = userId;
            emailToUser[u.email.toLowerCase().trim()] = { ...u, newId: userId };
            inc('users');
        }
        console.log(`  Inserted ${counts.users || 0} users\n`);

        // ── 2. Platform admins (superadmins from users.json) ──────────────────
        console.log('── Step 3: Migrating platform_admins ──');
        for (const u of usersRaw) {
            if (u.role === 'superadmin') {
                const userId = emailToUUID[u.email.toLowerCase().trim()];
                if (userId) {
                    await client.query(`
                        INSERT INTO platform_admins (user_id)
                        VALUES ($1)
                        ON CONFLICT DO NOTHING
                    `, [userId]);
                    inc('platform_admins');
                }
            }
        }
        console.log(`  Inserted ${counts.platform_admins || 0} platform_admins\n`);

        // ── 3. Tenant memberships ─────────────────────────────────────────────
        console.log('── Step 4: Migrating tenant_memberships ──');
        for (const u of usersRaw) {
            const userId = emailToUUID[u.email.toLowerCase().trim()];
            if (!userId) continue;
            await client.query(`
                INSERT INTO tenant_memberships (tenant_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (tenant_id, user_id) DO NOTHING
            `, [TENANT_ID, userId, (u.role === 'superadmin') ? 'superadmin' : 'user']);
            inc('tenant_memberships');
        }
        console.log(`  Inserted ${counts.tenant_memberships || 0} tenant_memberships\n`);

        // ── 4. Terminated sessions ────────────────────────────────────────────
        console.log('── Step 5: Migrating terminated_sessions ──');
        const terminatedRaw = readJson(path.join(DATA_DIR, 'terminated-sessions.json'), {});
        for (const [email, record] of Object.entries(terminatedRaw)) {
            await client.query(`
                INSERT INTO terminated_sessions (user_email, terminated_at, terminated_by)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_email) DO NOTHING
            `, [email.toLowerCase(), new Date(record.at), record.by || 'unknown']);
            inc('terminated_sessions');
        }
        console.log(`  Inserted ${counts.terminated_sessions || 0} terminated_sessions\n`);

        // ── 5. Projects ───────────────────────────────────────────────────────
        console.log('── Step 6: Migrating projects ──');
        const projectsRaw = readJson(path.join(DATA_DIR, 'projects.json'), []);
        const nameToProjectId = {};   // project name → UUID
        const nameToClusterIds = {};  // project name → { clusterName → UUID }

        for (let idx = 0; idx < projectsRaw.length; idx++) {
            const p = projectsRaw[idx];
            const res = await client.query(`
                INSERT INTO projects (tenant_id, name, status, sort_order, storage_path)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [
                TENANT_ID,
                p.name,
                p.status || 'active',
                idx,
                path.join(STORAGE_ROOT, p.name),
            ]);

            const projectId = res.rows[0].id;
            nameToProjectId[p.name] = projectId;
            nameToClusterIds[p.name] = {};
            inc('projects');

            // project_clusters from locations[]
            const locations = Array.isArray(p.locations) ? p.locations : [];
            for (let locIdx = 0; locIdx < locations.length; locIdx++) {
                const loc = locations[locIdx];
                const clRes = await client.query(`
                    INSERT INTO project_clusters (tenant_id, project_id, name, sort_order)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id
                `, [TENANT_ID, projectId, loc, locIdx]);
                nameToClusterIds[p.name][loc] = clRes.rows[0].id;
                inc('project_clusters');
            }
        }
        console.log(`  Inserted ${counts.projects || 0} projects, ${counts.project_clusters || 0} clusters\n`);

        // ── 6. Project info ───────────────────────────────────────────────────
        console.log('── Step 7: Migrating project_info ──');
        const projectInfoRaw = readJson(path.join(DATA_DIR, 'project-info.json'), {});
        const projectInfoIds = {};  // project name → project_info.id

        for (const [projectName, info] of Object.entries(projectInfoRaw)) {
            const projectId = nameToProjectId[projectName];
            if (!projectId) {
                console.warn(`  [warn] project_info references unknown project: ${projectName}`);
                continue;
            }

            const piRes = await client.query(`
                INSERT INTO project_info (tenant_id, project_id, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (project_id) DO NOTHING
                RETURNING id
            `, [TENANT_ID, projectId, info.description || '']);
            inc('project_info');

            if (piRes.rows.length > 0) {
                projectInfoIds[projectName] = piRes.rows[0].id;
                const fields = Array.isArray(info.fields) ? info.fields : [];
                for (let i = 0; i < fields.length; i++) {
                    const f = fields[i];
                    await client.query(`
                        INSERT INTO project_info_fields (tenant_id, project_info_id, label, value, sort_order)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [TENANT_ID, piRes.rows[0].id, f.label || '', f.value || '', i]);
                    inc('project_info_fields');
                }
            }
        }

        // Ensure every project has a project_info row
        for (const [projectName, projectId] of Object.entries(nameToProjectId)) {
            if (!projectInfoIds[projectName]) {
                const piRes = await client.query(`
                    INSERT INTO project_info (tenant_id, project_id, description)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (project_id) DO NOTHING
                    RETURNING id
                `, [TENANT_ID, projectId, '']);
                if (piRes.rows.length > 0) {
                    projectInfoIds[projectName] = piRes.rows[0].id;
                    inc('project_info');
                }
            }
        }
        console.log(`  Inserted ${counts.project_info || 0} project_info, ${counts.project_info_fields || 0} fields\n`);

        // ── 7. Access control ─────────────────────────────────────────────────
        console.log('── Step 8: Migrating access_control ──');
        const accessRaw = readJson(path.join(DATA_DIR, 'access-control.json'), {});
        const aclIds = {};  // email → access_control.id

        for (const [email, entry] of Object.entries(accessRaw)) {
            const normEmail = email.toLowerCase().trim();
            const userId = emailToUUID[normEmail];
            if (!userId) {
                console.warn(`  [warn] access-control has unknown user: ${email}`);
                continue;
            }

            // V2 calls it 'authority' or 'dashboard' — handle both
            const auth = entry.authority || entry.dashboard || {};

            const aclRes = await client.query(`
                INSERT INTO access_control (
                    tenant_id, user_id, full_access,
                    can_create_project, can_delete_project, can_change_status,
                    can_reorder_projects, can_download_zip, can_edit_project_info
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (tenant_id, user_id) DO NOTHING
                RETURNING id
            `, [
                TENANT_ID,
                userId,
                entry.fullAccess === true,
                auth.createProject === true,
                auth.deleteProject === true,
                auth.changeStatus === true,
                auth.reorderProjects === true,
                auth.downloadZip === true,
                auth.editProjectInfo === true,
            ]);
            inc('access_control');

            if (aclRes.rows.length === 0) continue;
            const aclId = aclRes.rows[0].id;
            aclIds[normEmail] = aclId;

            // Per-project permissions
            const projects = entry.projects || {};
            for (const [projectName, pEntry] of Object.entries(projects)) {
                const projectId = nameToProjectId[projectName];
                if (!projectId) {
                    console.warn(`  [warn] access-control project not found: ${projectName}`);
                    continue;
                }
                await client.query(`
                    INSERT INTO access_control_projects (
                        tenant_id, access_control_id, project_id, can_access, can_edit, modules
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (tenant_id, access_control_id, project_id) DO NOTHING
                `, [
                    TENANT_ID,
                    aclId,
                    projectId,
                    pEntry.access === true,
                    pEntry.canEdit === true,
                    JSON.stringify(pEntry.modules || {}),
                ]);
                inc('access_control_projects');
            }
        }

        // Ensure every user has an ACL row (zero-access default)
        for (const [email, userId] of Object.entries(emailToUUID)) {
            if (!aclIds[email]) {
                const aclRes = await client.query(`
                    INSERT INTO access_control (tenant_id, user_id)
                    VALUES ($1, $2)
                    ON CONFLICT (tenant_id, user_id) DO NOTHING
                    RETURNING id
                `, [TENANT_ID, userId]);
                if (aclRes.rows.length > 0) inc('access_control');
            }
        }
        console.log(`  Inserted ${counts.access_control || 0} ACL rows, ${counts.access_control_projects || 0} project-permissions\n`);

        // ── 8. Aufmass schemas + rows ─────────────────────────────────────────
        console.log('── Step 9-10: Migrating aufmass_schemas + aufmass_rows ──');

        for (const [projectName, projectId] of Object.entries(nameToProjectId)) {
            const datafileDir = path.join(STORAGE_ROOT, projectName, 'Doku', 'Aufmass', 'datafile');
            const txtPath     = path.join(datafileDir, `${projectName}.txt`);
            const versPath    = path.join(STORAGE_ROOT, projectName, 'row-versions.json');

            let rawData;
            try {
                const content = fs.readFileSync(txtPath, 'utf-8').trim();
                if (!content) {
                    console.log(`  [skip] ${projectName}.txt is empty`);
                    continue;
                }
                rawData = JSON.parse(content);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.log(`  [skip] No data file for project: ${projectName}`);
                } else {
                    console.warn(`  [warn] Could not parse data file for ${projectName}: ${err.message}`);
                }
                continue;
            }

            const E1   = rawData[0] || [];     // ["GroupName0", ...]
            const E2   = rawData[1] || [];     // [[schemaRow], dataRow1, dataRow2, ...]
            const E2_0 = E2[0] || [];          // [["SubCol0a"], ["SubCol1a", "SubCol1b"], ...]

            // Build schema_json
            const schema_json = E1.map((title, i) => ({
                id:    `grp-${i}`,
                title,
                cols: (E2_0[i] || []).map((label, j) => ({ id: `col-${i}-${j}`, label })),
            }));

            const schemaRes = await client.query(`
                INSERT INTO aufmass_schemas (tenant_id, project_id, e1_json, e2_0_json, schema_json, version, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [
                TENANT_ID,
                projectId,
                JSON.stringify(E1),
                JSON.stringify(E2_0),
                JSON.stringify(schema_json),
                1,
                true,
            ]);
            const schemaId = schemaRes.rows[0].id;
            inc('aufmass_schemas');

            // Load row versions
            const rowVersions = readJson(versPath, {});

            // Find promoted column positions
            const clusterPos    = findColByLabel(E2_0, l => l === 'cluster');
            const knotenPos     = findColByLabel(E2_0, l => l === 'knotenpunkt' || l === 'nvt');
            const datePos       = findColByLabel(E2_0, l => l === 'date');
            const einStatusPos  = findColByLabel(E2_0, l => l === 'status' && /* Einblasen group */ true);
            const aplStatusPos  = findColByLabel(E2_0, l => l === 'apl status' || l === 'apl_status');
            const kpStatusPos   = findColByLabel(E2_0, l => l === 'knotenpunkt status' || l === 'kp status');
            const otdrStatusPos = findColByLabel(E2_0, l => l === 'otdr status' || l === 'otdr_status');

            // Find status cols more carefully by group name
            function findStatusInGroup(groupLabel) {
                const grpIdx = E1.findIndex(t => typeof t === 'string' && t.toLowerCase().includes(groupLabel));
                if (grpIdx < 0) return null;
                const cols = E2_0[grpIdx] || [];
                const colIdx = cols.findIndex(c => typeof c === 'string' && c.toLowerCase() === 'status');
                return colIdx >= 0 ? { grpIdx, colIdx } : null;
            }

            const einPos  = findStatusInGroup('einblasen');
            const kalPos  = findStatusInGroup('kalibrieren');
            const druPos  = findStatusInGroup('druckprüfung') || findStatusInGroup('druckprufung');
            const aplPos  = aplStatusPos || findStatusInGroup('apl');
            const otdrPos = otdrStatusPos || findStatusInGroup('otdr');

            const dataRows = E2.slice(1);

            // Track knotenpunkte for insertion
            const knotenSeen = new Set(); // "cluster::knoten"

            for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
                const row    = dataRows[rIdx];
                const rowKey = (row[0] && row[0][0] != null) ? String(row[0][0]) : `ROW-${rIdx}`;

                // Build flat data object
                const data = {};
                E1.forEach((_, i) => {
                    (E2_0[i] || []).forEach((_, j) => {
                        const grp = row[i];
                        const val = grp && grp[j] != null ? String(grp[j]) : '';
                        data[`col-${i}-${j}`] = val;
                    });
                });

                const cluster    = getCell(row, clusterPos);
                const knotenpunkt = getCell(row, knotenPos);
                const rowDate    = getCell(row, datePos);
                const einStatus  = getCell(row, einPos);
                const kalStatus  = getCell(row, kalPos);
                const druStatus  = getCell(row, druPos);
                const aplStatus  = getCell(row, aplPos);
                const kpStatus   = getCell(row, kpStatusPos);
                const otdrStatus = getCell(row, otdrPos);

                await client.query(`
                    INSERT INTO aufmass_rows (
                        tenant_id, project_id, schema_id, row_key, version,
                        cluster, knotenpunkt, row_date,
                        ein_status, kal_status, dru_status, apl_status, kp_status, otdr_status,
                        data
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ON CONFLICT (tenant_id, project_id, row_key) DO NOTHING
                `, [
                    TENANT_ID, projectId, schemaId, rowKey,
                    rowVersions[rowKey] != null ? rowVersions[rowKey] : 0,
                    cluster, knotenpunkt, rowDate,
                    einStatus, kalStatus, druStatus, aplStatus, kpStatus, otdrStatus,
                    JSON.stringify(data),
                ]);
                inc('aufmass_rows');

                // Collect knotenpunkte for later insertion
                if (cluster && knotenpunkt) {
                    knotenSeen.add(`${cluster}::${knotenpunkt}`);
                }
            }

            // project_knotenpunkte — from aufmass data
            const clusterIds = nameToClusterIds[projectName] || {};
            for (const combo of knotenSeen) {
                const [clusterName, knotenName] = combo.split('::');
                const clusterId = clusterIds[clusterName];

                if (!clusterId) {
                    // Cluster found in data but not in projects.json — create it
                    const clRes = await client.query(`
                        INSERT INTO project_clusters (tenant_id, project_id, name, sort_order)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (tenant_id, project_id, LOWER(name)) DO NOTHING
                        RETURNING id
                    `, [TENANT_ID, projectId, clusterName, 9999]);
                    if (clRes.rows.length > 0) {
                        clusterIds[clusterName] = clRes.rows[0].id;
                        nameToClusterIds[projectName][clusterName] = clRes.rows[0].id;
                        inc('project_clusters');
                    }
                }

                const resolvedClusterId = nameToClusterIds[projectName][clusterName];
                if (resolvedClusterId) {
                    await client.query(`
                        INSERT INTO project_knotenpunkte (tenant_id, project_id, cluster_id, name)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (tenant_id, project_id, cluster_id, LOWER(name)) DO NOTHING
                    `, [TENANT_ID, projectId, resolvedClusterId, knotenName]);
                    inc('project_knotenpunkte');
                }
            }

            console.log(`  [${projectName}] schema + ${dataRows.length} rows + ${knotenSeen.size} knotenpunkte`);
        }
        console.log(`  Total: ${counts.aufmass_schemas || 0} schemas, ${counts.aufmass_rows || 0} rows, ${counts.project_knotenpunkte || 0} knotenpunkte\n`);

        // ── 9. Module files (from .filemeta.json) ─────────────────────────────
        console.log('── Step 11: Migrating module_files ──');
        for (const [projectName, projectId] of Object.entries(nameToProjectId)) {
            const metaPath = path.join(STORAGE_ROOT, projectName, '.filemeta.json');
            const filemeta = readJson(metaPath, {});

            for (const [relPath, meta] of Object.entries(filemeta)) {
                const normPath = relPath.replace(/\\/g, '/').replace(/^\//, '');
                await client.query(`
                    INSERT INTO module_files (tenant_id, project_id, relative_path, modified_by, modified_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (tenant_id, project_id, relative_path) DO NOTHING
                `, [
                    TENANT_ID,
                    projectId,
                    normPath,
                    meta.modifiedBy || 'unknown',
                    meta.modifiedAt ? new Date(meta.modifiedAt) : new Date(),
                ]);
                inc('module_files');
            }
        }
        console.log(`  Inserted ${counts.module_files || 0} module_files\n`);

        // ── 10. File shares ───────────────────────────────────────────────────
        console.log('── Step 12: Migrating file_shares ──');
        const sharesRaw = readJson(path.join(DATA_DIR, 'shares.json'), { shares: {} });
        const sharesMap = sharesRaw.shares || sharesRaw || {};
        const now = new Date();

        for (const [shareId, share] of Object.entries(sharesMap)) {
            const expiresAt = share.expiresAt ? new Date(share.expiresAt) : null;
            if (expiresAt && expiresAt <= now) continue; // skip expired

            const projectId = nameToProjectId[share.project];
            if (!projectId) {
                console.warn(`  [warn] file_shares references unknown project: ${share.project}`);
                continue;
            }

            await client.query(`
                INSERT INTO file_shares (id, tenant_id, project_id, file_path, file_name, type,
                    created_by, created_at, expires_at, access_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO NOTHING
            `, [
                shareId, TENANT_ID, projectId,
                share.filePath || '',
                share.fileName || path.basename(share.filePath || ''),
                share.type || 'file',
                share.createdBy || 'unknown',
                share.createdAt ? new Date(share.createdAt) : now,
                expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                share.accessCount || 0,
            ]);
            inc('file_shares');
        }
        console.log(`  Inserted ${counts.file_shares || 0} file_shares\n`);

        // ── 11. File trash ────────────────────────────────────────────────────
        console.log('── Step 13: Migrating file_trash ──');
        for (const [projectName, projectId] of Object.entries(nameToProjectId)) {
            const manifestPath = path.join(STORAGE_ROOT, projectName, '.trash', '.manifest.json');
            const manifest     = readJson(manifestPath, { items: [] });
            const items        = Array.isArray(manifest.items) ? manifest.items : [];

            for (const item of items) {
                await client.query(`
                    INSERT INTO file_trash (id, tenant_id, project_id, original_name, original_path,
                        trash_name, deleted_by, deleted_at, expires_at, is_dir)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    String(item.id),
                    TENANT_ID,
                    projectId,
                    item.originalName || '',
                    item.originalPath || '',
                    item.trashName || item.originalName || '',
                    item.deletedBy || 'System',
                    item.deletedAt ? new Date(item.deletedAt) : now,
                    item.expiresAt ? new Date(item.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    item.isDir === true,
                ]);
                inc('file_trash');
            }
        }
        console.log(`  Inserted ${counts.file_trash || 0} file_trash entries\n`);

        // ── 12. Chat messages ─────────────────────────────────────────────────
        console.log('── Step 14: Migrating chat_messages ──');
        for (const [projectName, projectId] of Object.entries(nameToProjectId)) {
            const chatDir = path.join(STORAGE_ROOT, projectName, 'chat');
            const dbPath  = path.join(chatDir, 'chat.db');

            if (!fs.existsSync(dbPath)) {
                console.log(`  [skip] No chat.db for project: ${projectName}`);
                continue;
            }

            let db;
            try {
                db = new Database(dbPath, { readonly: true });
            } catch (err) {
                console.warn(`  [warn] Cannot open chat.db for ${projectName}: ${err.message}`);
                continue;
            }

            try {
                const rows = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
                for (const row of rows) {
                    await client.query(`
                        INSERT INTO chat_messages (
                            tenant_id, project_id, user_email, user_name, message,
                            media_url, media_type, original_filename,
                            created_at, edited_at, deleted
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    `, [
                        TENANT_ID,
                        projectId,
                        row.user_email,
                        row.user_name,
                        row.message || '',
                        row.media_url || null,
                        row.media_type || null,
                        row.original_filename || null,
                        row.created_at ? new Date(row.created_at) : now,
                        row.edited_at  ? new Date(row.edited_at)  : null,
                        row.deleted === 1,
                    ]);
                    inc('chat_messages');
                }
                console.log(`  [${projectName}] ${rows.length} chat messages`);
            } finally {
                db.close();
            }
        }

        // Reset BIGSERIAL sequence
        await client.query(`
            SELECT setval('chat_messages_id_seq',
                (SELECT COALESCE(MAX(id), 1) FROM chat_messages))
        `);
        console.log(`  Total: ${counts.chat_messages || 0} chat_messages\n`);

        // ── 13. Action logs ───────────────────────────────────────────────────
        console.log('── Step 15: Migrating action_logs ──');
        const logsRaw = readJson(path.join(DATA_DIR, 'logs.json'), []);
        // logs.json is unshifted (newest first) — insert in reverse for chronological order
        const logsChronological = [...logsRaw].reverse();
        for (const log of logsChronological) {
            await client.query(`
                INSERT INTO action_logs (tenant_id, user_email, action, details, timestamp)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                TENANT_ID,
                log.user || 'unknown',
                log.action || '',
                log.details || '',
                log.timestamp ? new Date(log.timestamp) : now,
            ]);
            inc('action_logs');
        }
        console.log(`  Inserted ${counts.action_logs || 0} action_logs\n`);

        // ── 14. Session logs ──────────────────────────────────────────────────
        console.log('── Step 16: Migrating session_logs ──');
        const sessionsRaw = readJson(path.join(DATA_DIR, 'sessions-log.json'), []);
        for (const s of sessionsRaw) {
            await client.query(`
                INSERT INTO session_logs (
                    tenant_id, user_email, user_name, action,
                    ip_address, user_agent, device, timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                TENANT_ID,
                s.email || 'unknown',
                s.name || 'Unknown',
                ['login','logout','login_failed','force_terminated'].includes(s.action) ? s.action : 'login',
                s.ip || 'unknown',
                s.userAgent || '',
                s.device || 'Unknown',
                s.timestamp ? new Date(s.timestamp) : now,
            ]);
            inc('session_logs');
        }
        console.log(`  Inserted ${counts.session_logs || 0} session_logs\n`);

        // ── 15. Super logs ────────────────────────────────────────────────────
        console.log('── Step 17: Migrating super_logs ──');
        const superLogsRaw = readJson(path.join(DATA_DIR, 'super-log.json'), []);

        // super_logs is partitioned — ensure the needed partition(s) exist before inserting
        const partitionsNeeded = new Set();
        for (const log of superLogsRaw) {
            const d = log.timestamp ? new Date(log.timestamp) : now;
            const year  = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const nextMonth = d.getMonth() === 11
                ? `${year + 1}-01`
                : `${year}-${String(d.getMonth() + 2).padStart(2, '0')}`;
            partitionsNeeded.add({ name: `super_logs_${year}_${month}`, from: `${year}-${month}-01`, to: `${nextMonth}-01` });
        }
        // Also add current month
        {
            const d = now;
            const year  = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const nextMonth = d.getMonth() === 11
                ? `${year + 1}-01`
                : `${year}-${String(d.getMonth() + 2).padStart(2, '0')}`;
            partitionsNeeded.add({ name: `super_logs_${year}_${month}`, from: `${year}-${month}-01`, to: `${nextMonth}-01` });
        }

        for (const p of partitionsNeeded) {
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${p.name} PARTITION OF super_logs
                    FOR VALUES FROM ('${p.from}') TO ('${p.to}')
            `);
        }

        for (const log of superLogsRaw) {
            const validTypes  = ['request','auth','file','sync','chat','error','system','admin'];
            const validLevels = ['debug','info','warn','error'];
            await client.query(`
                INSERT INTO super_logs (tenant_id, type, level, message, meta, timestamp)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                TENANT_ID,
                validTypes.includes(log.type)   ? log.type  : 'system',
                validLevels.includes(log.level) ? log.level : 'info',
                log.message || '',
                JSON.stringify(log.meta || {}),
                log.timestamp ? new Date(log.timestamp) : now,
            ]);
            inc('super_logs');
        }

        await client.query(`
            SELECT setval('super_logs_id_seq',
                (SELECT COALESCE(MAX(id), 1) FROM super_logs))
        `);
        console.log(`  Inserted ${counts.super_logs || 0} super_logs\n`);

        // ── 16. Tenant settings ───────────────────────────────────────────────
        console.log('── Step 18: Migrating tenant_settings ──');
        const settingsRaw = readJson(path.join(DATA_DIR, 'settings.json'), {});
        await client.query(`
            INSERT INTO tenant_settings (
                tenant_id, generator_code, generator_url,
                generator_api_url, generator_allowed_users
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id) DO NOTHING
        `, [
            TENANT_ID,
            settingsRaw.generatorCode || '',
            settingsRaw.generatorUrl  || '',
            settingsRaw.generatorApiUrl || '',
            settingsRaw.generatorAllowedUsers || [],
        ]);
        inc('tenant_settings');
        console.log(`  Inserted tenant_settings\n`);

        // ── Post-migration validation ─────────────────────────────────────────
        console.log('── Post-migration validation ──');

        const superadminCheck = await client.query(
            'SELECT COUNT(*) AS c FROM users WHERE role = $1', ['superadmin']
        );
        console.log(`  Superadmins: ${superadminCheck.rows[0].c}`);
        if (parseInt(superadminCheck.rows[0].c) < 1) {
            console.warn('  ⚠️  WARNING: No superadmin user found after migration!');
        }

        const aufmassRowCount = await client.query('SELECT COUNT(*) AS c FROM aufmass_rows');
        console.log(`  aufmass_rows total: ${aufmassRowCount.rows[0].c}`);

        const chatCount = await client.query('SELECT COUNT(*) AS c FROM chat_messages');
        console.log(`  chat_messages total: ${chatCount.rows[0].c}`);

        // ── Commit or rollback ────────────────────────────────────────────────
        if (DRY_RUN) {
            await client.query('ROLLBACK');
            console.log('\n🔄 DRY RUN — rolled back. No changes were committed.\n');
        } else {
            await client.query('COMMIT');
            console.log('\n✅ Migration committed successfully!\n');
        }

        // ── Print summary ─────────────────────────────────────────────────────
        console.log('─── Row counts ─────────────────────────────────────────────');
        for (const [table, count] of Object.entries(counts).sort()) {
            console.log(`  ${table.padEnd(30)} ${count}`);
        }
        console.log('────────────────────────────────────────────────────────────\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed — rolled back.\n', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
