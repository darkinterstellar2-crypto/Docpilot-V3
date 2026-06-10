// PostgreSQL migration: 2026-06-10
// Changed from .manifest.json flat file to PostgreSQL file_trash table.
// Physical file operations (fs.rename to .trash dir) are preserved.
// DB stores the manifest record alongside the physical file.

const fs = require('fs').promises;
const path = require('path');
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
        console.error('[trashHelper] getProjectId error:', e.message);
        return null;
    }
}

/**
 * Move an absolute path into the project's .trash directory
 * and record it in the file_trash table (30-day expiry).
 *
 * @param {string} projectName
 * @param {string} itemAbsPath    - absolute path of file/dir to move
 * @param {string} itemName       - display name (basename)
 * @param {string} itemParentRelPath - relative path of parent inside project (for restore)
 * @param {string} deletedBy      - actor label (email or 'System')
 */
async function moveToTrash(projectName, itemAbsPath, itemName, itemParentRelPath, deletedBy) {
    const projectRoot = getProjectRoot(projectName);
    const trashDir = path.join(projectRoot, '.trash');
    await fs.mkdir(trashDir, { recursive: true });

    const timestamp = Date.now().toString();
    const trashName = `${itemName}_${timestamp}`;
    const trashItemPath = path.join(trashDir, trashName);

    // Move the physical item
    await fs.rename(itemAbsPath, trashItemPath);

    // Insert manifest record into DB
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const projectId = await getProjectId(projectName);
    if (projectId) {
        try {
            await db.query(
                `INSERT INTO file_trash
                    (id, tenant_id, project_id, original_name, original_path,
                     trash_name, deleted_by, deleted_at, expires_at, is_dir)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    timestamp, TENANT_ID, projectId,
                    itemName,
                    itemParentRelPath || '',
                    trashName,
                    deletedBy || 'System',
                    expiresAt.toISOString(),
                    true
                ]
            );
        } catch (e) {
            console.error('[trashHelper] DB insert error:', e.message);
        }
    }
}

module.exports = { moveToTrash };
