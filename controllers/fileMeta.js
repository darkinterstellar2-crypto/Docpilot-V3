// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O (.filemeta.json) to PostgreSQL via controllers/db.js
//
// Table: module_files (tenant_id, project_id, relative_path, modified_by, modified_at)

const db = require('./db');
const { getProjectRoot } = require('./storageConfig');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

/** Resolve project UUID from name. Returns null if not found. */
async function getProjectId(projectName) {
    if (!projectName) return null;
    try {
        const r = await db.query(
            'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
            [TENANT_ID, projectName]
        );
        return r.rows[0]?.id || null;
    } catch (e) {
        console.error('[fileMeta] getProjectId error:', e.message);
        return null;
    }
}

/**
 * Get all file metadata for a project.
 * Returns a map: { relativePath: { modifiedBy, modifiedAt } }
 */
async function getFileMeta(projectName) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return {};
    try {
        const r = await db.query(
            `SELECT relative_path, modified_by, modified_at
             FROM module_files
             WHERE tenant_id = $1 AND project_id = $2`,
            [TENANT_ID, projectId]
        );
        const meta = {};
        for (const row of r.rows) {
            meta[row.relative_path] = {
                modifiedBy: row.modified_by,
                modifiedAt: row.modified_at
            };
        }
        return meta;
    } catch (e) {
        console.error('[fileMeta] getFileMeta error:', e.message);
        return {};
    }
}

/**
 * Set metadata for a specific file path.
 */
async function setFileMeta(projectName, relativePath, userEmail) {
    const projectId = await getProjectId(projectName);
    if (!projectId) {
        console.warn(`[fileMeta] setFileMeta: project not found: ${projectName}`);
        return;
    }
    const key = relativePath.replace(/\\/g, '/');
    try {
        await db.query(
            `INSERT INTO module_files (tenant_id, project_id, relative_path, modified_by, modified_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (tenant_id, project_id, relative_path) DO UPDATE
               SET modified_by = EXCLUDED.modified_by,
                   modified_at = NOW()`,
            [TENANT_ID, projectId, key, userEmail || 'Unknown']
        );
    } catch (e) {
        console.error('[fileMeta] setFileMeta error:', e.message);
    }
}

/**
 * Rename a file metadata entry (old relative path → new relative path).
 * Also renames child paths for folder renames.
 */
async function renameFileMeta(projectName, oldRelative, newRelative) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return;

    const oldKey = oldRelative.replace(/\\/g, '/');
    const newKey = newRelative.replace(/\\/g, '/');

    try {
        await db.transaction(async (client) => {
            // Rename exact path
            await client.query(
                `UPDATE module_files
                 SET relative_path = $1
                 WHERE tenant_id = $2 AND project_id = $3 AND relative_path = $4`,
                [newKey, TENANT_ID, projectId, oldKey]
            );

            // Rename child paths (folder rename)
            const prefix = oldKey + '/';
            const children = await client.query(
                `SELECT id, relative_path FROM module_files
                 WHERE tenant_id = $1 AND project_id = $2
                   AND relative_path LIKE $3`,
                [TENANT_ID, projectId, prefix + '%']
            );

            for (const child of children.rows) {
                const newChildKey = newKey + '/' + child.relative_path.slice(prefix.length);
                await client.query(
                    `UPDATE module_files SET relative_path = $1 WHERE id = $2`,
                    [newChildKey, child.id]
                );
            }
        });
    } catch (e) {
        console.error('[fileMeta] renameFileMeta error:', e.message);
    }
}

// Re-export getProjectRoot so callers that import it via fileMeta still work
module.exports = { getProjectRoot, getFileMeta, setFileMeta, renameFileMeta };
