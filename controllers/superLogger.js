// PostgreSQL migration: 2026-06-10
// Changed from in-memory ring buffer + flat file to PostgreSQL via controllers/db.js
//
// super_logs is a BIGSERIAL partitioned table (partitioned by month).
// Ring buffer logic removed — PostgreSQL handles retention.
//
// superLog() is fire-and-forget — it never blocks the caller.

'use strict';

const db = require('./db');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// ── Core logging function ─────────────────────────────────────────────────────

/**
 * Add a super log entry.
 * Fire-and-forget — never throws.
 *
 * @param {'request'|'auth'|'file'|'sync'|'chat'|'error'|'system'|'admin'} type
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [meta]
 */
function superLog(type, level, message, meta) {
    db.query(
        `INSERT INTO super_logs (tenant_id, type, level, message, meta, timestamp)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
            TENANT_ID,
            type    || 'system',
            level   || 'info',
            String(message || ''),
            meta ? JSON.stringify(meta) : '{}'
        ]
    ).catch(err => {
        // Must never crash the app
        console.error('[superLogger] Insert failed:', err.message);
    });
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Query super logs with filters.
 * @param {object} opts
 * @param {number}   [opts.after_id]  — only entries with id > after_id
 * @param {string[]} [opts.types]     — filter by type
 * @param {string}   [opts.level]     — filter by level
 * @param {number}   [opts.limit]     — max results (default 100, max 500)
 * @param {string}   [opts.search]    — substring search in message
 * @returns {Promise<{ logs: object[], total: number }>}
 */
async function getSuperLogs({ after_id, types, level, limit = 100, search } = {}) {
    try {
        const maxLimit = Math.min(parseInt(limit) || 100, 500);
        const conditions = ['tenant_id = $1'];
        const params = [TENANT_ID];
        let pi = 2;

        if (after_id && parseInt(after_id) > 0) {
            conditions.push(`id > $${pi++}`);
            params.push(parseInt(after_id));
        }

        if (Array.isArray(types) && types.length > 0) {
            conditions.push(`type = ANY($${pi++})`);
            params.push(types);
        }

        if (level && level !== 'all') {
            conditions.push(`level = $${pi++}`);
            params.push(level);
        }

        if (search && search.trim()) {
            conditions.push(`(message ILIKE $${pi} OR meta::text ILIKE $${pi})`);
            params.push(`%${search.trim()}%`);
            pi++;
        }

        const where = conditions.join(' AND ');

        const [logsResult, countResult] = await Promise.all([
            db.query(
                `SELECT id, timestamp, type, level, message, meta
                 FROM super_logs
                 WHERE ${where}
                 ORDER BY id ASC
                 LIMIT $${pi}`,
                [...params, maxLimit]
            ),
            db.query(
                `SELECT COUNT(*) AS total FROM super_logs WHERE tenant_id = $1`,
                [TENANT_ID]
            )
        ]);

        return {
            logs: logsResult.rows,
            total: parseInt(countResult.rows[0]?.total || 0)
        };
    } catch (err) {
        console.error('[superLogger] getSuperLogs error:', err.message);
        return { logs: [], total: 0 };
    }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Return counts by type and level for the last 24h.
 */
async function getLogStats() {
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const result = await db.query(
            `SELECT type, level, COUNT(*) AS cnt
             FROM super_logs
             WHERE tenant_id = $1 AND timestamp >= $2
             GROUP BY type, level`,
            [TENANT_ID, since]
        );

        const byType = {};
        const byLevel = {};
        let total = 0;

        for (const row of result.rows) {
            const cnt = parseInt(row.cnt);
            total += cnt;
            byType[row.type]   = (byType[row.type]   || 0) + cnt;
            byLevel[row.level] = (byLevel[row.level] || 0) + cnt;
        }

        return { total, byType, byLevel, since };
    } catch (err) {
        console.error('[superLogger] getLogStats error:', err.message);
        return { total: 0, byType: {}, byLevel: {}, since: null };
    }
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * requestLogger — Express middleware that logs every HTTP request.
 */
function requestLogger(req, res, next) {
    const startTime = Date.now();

    // Skip super-logs polling requests (noise reduction)
    if (req.path && req.path.includes('/super-logs')) {
        return next();
    }

    res.on('finish', () => {
        try {
            const responseTime = Date.now() - startTime;
            const ip        = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
            const userEmail = req.headers['x-user-email'] || null;

            let level = 'info';
            if (res.statusCode >= 500) level = 'error';
            else if (res.statusCode >= 400) level = 'warn';

            const message = `${req.method} ${req.path} ${res.statusCode} ${responseTime}ms${userEmail ? ' ' + userEmail : ''}`;

            superLog('request', level, message, {
                method:       req.method,
                url:          req.path,
                query:        Object.keys(req.query).length > 0 ? req.query : undefined,
                status:       res.statusCode,
                responseTime,
                ip,
                userEmail
            });
        } catch (_) { /* never crash */ }
    });

    next();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdownFlush() {
    // No-op in PostgreSQL version — writes are immediate
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    superLog,
    getSuperLogs,
    getLogStats,
    requestLogger,
    shutdownFlush
};
