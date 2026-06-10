// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// session_logs table stores login/logout events.
// terminated_sessions table stores force-logout state (global, no tenant_id).

'use strict';

const db = require('./db');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// ── Device Parsing ────────────────────────────────────────────────────────────

function parseDevice(userAgent) {
    if (!userAgent) return 'Unknown';

    let os = 'Unknown';
    if (/CrOS/i.test(userAgent))              os = 'ChromeOS';
    else if (/Android/i.test(userAgent))      os = 'Android';
    else if (/iPhone|iPad/i.test(userAgent))  os = 'iOS';
    else if (/Windows/i.test(userAgent))      os = 'Windows';
    else if (/Mac OS X/i.test(userAgent))     os = 'macOS';
    else if (/Linux/i.test(userAgent))        os = 'Linux';

    let browser = 'Unknown';
    if (/Edg\//i.test(userAgent))                               browser = 'Edge';
    else if (/OPR\//i.test(userAgent) || /Opera/i.test(userAgent)) browser = 'Opera';
    else if (/SamsungBrowser/i.test(userAgent))                 browser = 'Samsung Browser';
    else if (/Chrome/i.test(userAgent))                         browser = 'Chrome';
    else if (/Firefox/i.test(userAgent))                        browser = 'Firefox';
    else if (/Safari/i.test(userAgent))                         browser = 'Safari';

    return `${browser} on ${os}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log a session event (login / logout / login_failed / force_terminated).
 * Fire-and-forget — does not throw.
 */
function logSession({ email, name, action, ip, userAgent }) {
    db.query(
        `INSERT INTO session_logs
            (tenant_id, user_email, user_name, action, ip_address, user_agent, device, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
            TENANT_ID,
            email     || 'unknown',
            name      || 'Unknown',
            action    || 'login',
            ip        || 'unknown',
            userAgent || '',
            parseDevice(userAgent)
        ]
    ).catch(err => console.error('[sessionLogger] Failed to write session event:', err.message));
}

/**
 * Get session history for a specific user (newest first).
 */
async function getSessionHistory(email, limit = 50) {
    try {
        const result = await db.query(
            `SELECT user_email AS email, user_name AS name, action, timestamp, ip_address AS ip, user_agent AS "userAgent", device
             FROM session_logs
             WHERE user_email = $1
             ORDER BY timestamp DESC
             LIMIT $2`,
            [email, limit]
        );
        return result.rows;
    } catch (err) {
        console.error('[sessionLogger] getSessionHistory error:', err.message);
        return [];
    }
}

/**
 * Get all sessions (newest first).
 */
async function getAllSessions(limit = 200) {
    try {
        const result = await db.query(
            `SELECT user_email AS email, user_name AS name, action, timestamp, ip_address AS ip, user_agent AS "userAgent", device
             FROM session_logs
             ORDER BY timestamp DESC
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    } catch (err) {
        console.error('[sessionLogger] getAllSessions error:', err.message);
        return [];
    }
}

/**
 * Get the most recent successful login event for a user.
 */
async function getLastLogin(email) {
    try {
        const result = await db.query(
            `SELECT user_email AS email, user_name AS name, action, timestamp, ip_address AS ip, device
             FROM session_logs
             WHERE user_email = $1 AND action = 'login'
             ORDER BY timestamp DESC
             LIMIT 1`,
            [email]
        );
        return result.rows[0] || null;
    } catch (err) {
        console.error('[sessionLogger] getLastLogin error:', err.message);
        return null;
    }
}

/**
 * Get the most recent logout event for a user.
 */
async function getLastLogout(email) {
    try {
        const result = await db.query(
            `SELECT user_email AS email, user_name AS name, action, timestamp, ip_address AS ip, device
             FROM session_logs
             WHERE user_email = $1 AND action = 'logout'
             ORDER BY timestamp DESC
             LIMIT 1`,
            [email]
        );
        return result.rows[0] || null;
    } catch (err) {
        console.error('[sessionLogger] getLastLogout error:', err.message);
        return null;
    }
}

/**
 * Get unique devices a user has logged in from.
 */
async function getActiveDevices(email) {
    try {
        const result = await db.query(
            `SELECT DISTINCT device
             FROM session_logs
             WHERE user_email = $1 AND action = 'login'`,
            [email]
        );
        return result.rows.map(r => r.device);
    } catch (err) {
        console.error('[sessionLogger] getActiveDevices error:', err.message);
        return [];
    }
}

// ── Force Termination ─────────────────────────────────────────────────────────

/**
 * Force-terminate all sessions for a user.
 */
function terminateUser(email, terminatedBy) {
    db.query(
        `INSERT INTO terminated_sessions (user_email, terminated_at, terminated_by)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (user_email) DO UPDATE
           SET terminated_at = NOW(),
               terminated_by = $2`,
        [email.toLowerCase(), terminatedBy]
    ).catch(err => console.error('[sessionLogger] terminateUser error:', err.message));

    // Also log as session event
    logSession({
        email,
        name: terminatedBy,
        action: 'force_terminated',
        ip: 'admin',
        userAgent: `Terminated by ${terminatedBy}`
    });
}

/**
 * Check if a user has been force-terminated.
 * Returns the termination record if active, null otherwise.
 */
async function isTerminated(email) {
    try {
        const result = await db.query(
            `SELECT user_email, terminated_at AS at, terminated_by AS by
             FROM terminated_sessions
             WHERE user_email = $1`,
            [email.toLowerCase()]
        );
        return result.rows[0] || null;
    } catch (err) {
        console.error('[sessionLogger] isTerminated error:', err.message);
        return null;
    }
}

/**
 * Clear termination for a user (called on successful re-login).
 */
function clearTermination(email) {
    db.query(
        `DELETE FROM terminated_sessions WHERE user_email = $1`,
        [email.toLowerCase()]
    ).catch(err => console.error('[sessionLogger] clearTermination error:', err.message));
}

module.exports = {
    logSession,
    getSessionHistory,
    getAllSessions,
    getLastLogin,
    getLastLogout,
    getActiveDevices,
    terminateUser,
    isTerminated,
    clearTermination
};
