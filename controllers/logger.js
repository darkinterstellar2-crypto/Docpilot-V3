// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js

const db = require('./db');

// Tenant ID — single Geggos tenant for now
const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

/**
 * Log a user action to the action_logs table.
 * Async — awaitable by callers.
 */
async function logAction(userEmail, action, details) {
    try {
        await db.query(
            `INSERT INTO action_logs (tenant_id, user_email, action, details, timestamp)
             VALUES ($1, $2, $3, $4, NOW())`,
            [TENANT_ID, userEmail || 'System', action || '', details || '']
        );
    } catch (error) {
        console.error('[logger] Failed to write action log:', error.message);
    }
}

/**
 * Fetch recent action logs (newest first).
 * @param {number} limit - max entries (default 1000)
 */
async function getLogs(limit = 1000) {
    try {
        const result = await db.query(
            `SELECT id, timestamp, user_email AS "user", action, details
             FROM action_logs
             WHERE tenant_id = $1
             ORDER BY timestamp DESC
             LIMIT $2`,
            [TENANT_ID, limit]
        );
        return result.rows;
    } catch (error) {
        console.error('[logger] Failed to read logs:', error.message);
        return [];
    }
}

module.exports = { getLogs, logAction };
