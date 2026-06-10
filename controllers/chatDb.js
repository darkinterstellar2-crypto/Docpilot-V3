// PostgreSQL migration: 2026-06-10
// Complete rewrite from per-project SQLite to PostgreSQL chat_messages table.
// Public API preserved exactly — same exported function signatures and return shapes.

'use strict';

const db = require('./db');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

/** Resolve project UUID from name. Throws if not found (caller should handle). */
async function getProjectId(projectName) {
    if (!projectName) throw new Error('[chatDb] projectName required');
    const r = await db.query(
        'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
        [TENANT_ID, projectName]
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error(`[chatDb] Project not found: ${projectName}`);
    return id;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Insert a new message.
 * Returns the inserted message object (same shape as before).
 */
async function sendMessage({ project, user_email, user_name, message, media_url = null, media_type = null, original_filename = null }) {
    const projectId = await getProjectId(project);
    const result = await db.query(
        `INSERT INTO chat_messages
            (tenant_id, project_id, user_email, user_name, message, media_url, media_type, original_filename, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id, user_email, user_name, message, media_url, media_type, original_filename, created_at, edited_at`,
        [TENANT_ID, projectId, user_email, user_name, message || '', media_url, media_type, original_filename]
    );
    const row = result.rows[0];
    return {
        id:                row.id,
        user_email:        row.user_email,
        user_name:         row.user_name,
        message:           row.message,
        media_url:         row.media_url,
        media_type:        row.media_type,
        original_filename: row.original_filename,
        created_at:        row.created_at,
        edited_at:         row.edited_at,
    };
}

/**
 * Fetch paginated messages for a project (oldest-first, non-deleted).
 */
async function getMessages({ project, limit = 50, offset = 0 }) {
    const projectId = await getProjectId(project);
    const result = await db.query(
        `SELECT id, user_email, user_name, message, media_url, media_type, original_filename, created_at, edited_at
         FROM chat_messages
         WHERE project_id = $1 AND deleted = false
         ORDER BY id ASC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset]
    );
    return result.rows;
}

/**
 * Fetch all messages with id > after_id (for long-polling).
 */
async function getNewMessages({ project, after_id }) {
    const projectId = await getProjectId(project);
    const result = await db.query(
        `SELECT id, user_email, user_name, message, media_url, media_type, original_filename, created_at, edited_at
         FROM chat_messages
         WHERE project_id = $1 AND deleted = false AND id > $2
         ORDER BY id ASC`,
        [projectId, after_id || 0]
    );
    return result.rows;
}

/**
 * Return the total non-deleted message count for a project.
 */
async function getMessageCount({ project }) {
    const projectId = await getProjectId(project);
    const result = await db.query(
        'SELECT COUNT(*) AS count FROM chat_messages WHERE project_id = $1 AND deleted = false',
        [projectId]
    );
    return parseInt(result.rows[0].count || 0);
}

/**
 * Edit a message. Only succeeds if the requesting user owns the message.
 * Returns true if a row was updated.
 */
async function editMessage({ id, project, user_email, message }) {
    const projectId = await getProjectId(project);
    const result = await db.query(
        `UPDATE chat_messages
         SET message = $1, edited_at = NOW()
         WHERE id = $2 AND project_id = $3 AND user_email = $4 AND deleted = false`,
        [message, id, projectId, user_email]
    );
    return result.rowCount > 0;
}

/**
 * Soft-delete a message. Admins can delete any; users only their own.
 * Returns true if a row was updated.
 */
async function deleteMessage({ id, project, user_email, isAdmin = false }) {
    const projectId = await getProjectId(project);
    let result;
    if (isAdmin) {
        result = await db.query(
            `UPDATE chat_messages SET deleted = true WHERE id = $1 AND project_id = $2`,
            [id, projectId]
        );
    } else {
        result = await db.query(
            `UPDATE chat_messages SET deleted = true
             WHERE id = $1 AND project_id = $2 AND user_email = $3`,
            [id, projectId, user_email]
        );
    }
    return result.rowCount > 0;
}

/**
 * closeAll — no-op in PostgreSQL version (pool managed by db.js).
 */
function closeAll() {
    // No-op — PostgreSQL pool managed externally via controllers/db.js
}

module.exports = {
    sendMessage,
    getMessages,
    getNewMessages,
    getMessageCount,
    editMessage,
    deleteMessage,
    closeAll,
};
