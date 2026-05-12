/**
 * superLogger.js — System Event Capture (Superadmin Only)
 *
 * Ring buffer in memory (last 5000 entries) + persisted to
 * src/DataFiles/super-log.json (rolling, flush every 30 seconds or on 100 new entries).
 *
 * NEVER crashes the app — all errors are swallowed internally.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const LOG_FILE      = path.join(__dirname, '..', 'src', 'DataFiles', 'super-log.json');
const RING_SIZE     = 5000;   // max entries kept in memory
const FLUSH_ENTRIES = 100;    // flush to disk after this many new entries
const FLUSH_INTERVAL = 30000; // flush to disk every 30 s

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Array<object>} In-memory ring buffer */
let ring = [];
let nextId = 1;
let pendingSinceFlush = 0;
let flushTimer = null;

// ─── Boot: load existing log from disk ────────────────────────────────────────

try {
    if (fs.existsSync(LOG_FILE)) {
        const raw = fs.readFileSync(LOG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            // Keep only the last RING_SIZE entries
            ring = parsed.slice(-RING_SIZE);
            // Resume id counter from last known id
            const last = ring[ring.length - 1];
            if (last && typeof last.id === 'number') {
                nextId = last.id + 1;
            }
        }
    }
} catch (_) { /* first run or corrupt file — start fresh */ }

// ─── Disk flush ───────────────────────────────────────────────────────────────

function flushToDisk() {
    try {
        // Ensure directory exists
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(LOG_FILE, JSON.stringify(ring, null, 2), 'utf-8');
        pendingSinceFlush = 0;
    } catch (err) {
        // Logger must never crash the app
        console.error('[superLogger] Disk flush failed:', err.message);
    }
}

// Periodic flush
flushTimer = setInterval(flushToDisk, FLUSH_INTERVAL);
if (flushTimer.unref) flushTimer.unref(); // don't prevent process exit

// ─── Core logging function ────────────────────────────────────────────────────

/**
 * Add a log entry.
 * @param {'request'|'auth'|'file'|'sync'|'chat'|'error'|'system'} type
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [meta]
 */
function superLog(type, level, message, meta) {
    try {
        const entry = {
            id:        nextId++,
            timestamp: new Date().toISOString(),
            type:      type   || 'system',
            level:     level  || 'info',
            message:   String(message || ''),
            meta:      meta   || {}
        };

        ring.push(entry);

        // Trim ring to max size
        if (ring.length > RING_SIZE) {
            ring = ring.slice(ring.length - RING_SIZE);
        }

        pendingSinceFlush++;
        if (pendingSinceFlush >= FLUSH_ENTRIES) {
            flushToDisk();
        }
    } catch (err) {
        // Swallow — logger must never crash the app
        console.error('[superLogger] superLog error:', err.message);
    }
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query logs with filters.
 * @param {object} opts
 * @param {number}   [opts.after_id]   — only entries with id > after_id
 * @param {string[]} [opts.types]      — filter by type (e.g. ['request', 'auth'])
 * @param {string}   [opts.level]      — filter by level
 * @param {number}   [opts.limit]      — max results (default 100, max 500)
 * @param {string}   [opts.search]     — substring search in message
 * @returns {{ logs: object[], total: number }}
 */
function getSuperLogs({ after_id, types, level, limit = 100, search } = {}) {
    try {
        const maxLimit = Math.min(parseInt(limit) || 100, 500);
        const afterId  = parseInt(after_id) || 0;

        let filtered = ring;

        if (afterId > 0) {
            filtered = filtered.filter(e => e.id > afterId);
        }
        if (Array.isArray(types) && types.length > 0) {
            const tSet = new Set(types);
            filtered = filtered.filter(e => tSet.has(e.type));
        }
        if (level && level !== 'all') {
            filtered = filtered.filter(e => e.level === level);
        }
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(e =>
                e.message.toLowerCase().includes(q) ||
                (e.meta && JSON.stringify(e.meta).toLowerCase().includes(q))
            );
        }

        const total = filtered.length;
        // Return the most recent `maxLimit` entries
        const logs = filtered.slice(-maxLimit);

        return { logs, total: ring.length };
    } catch (err) {
        console.error('[superLogger] getSuperLogs error:', err.message);
        return { logs: [], total: 0 };
    }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Return counts by type and level for the last 24h.
 * @returns {object}
 */
function getLogStats() {
    try {
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const recent = ring.filter(e => new Date(e.timestamp).getTime() >= since);

        const byType  = {};
        const byLevel = {};

        for (const e of recent) {
            byType[e.type]   = (byType[e.type]   || 0) + 1;
            byLevel[e.level] = (byLevel[e.level] || 0) + 1;
        }

        return {
            total:   recent.length,
            byType,
            byLevel,
            since:   new Date(since).toISOString()
        };
    } catch (err) {
        console.error('[superLogger] getLogStats error:', err.message);
        return { total: 0, byType: {}, byLevel: {}, since: null };
    }
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * requestLogger — Express middleware that logs every HTTP request.
 * Attaches start time before request, logs after response finishes.
 * Never blocks the request pipeline.
 */
function requestLogger(req, res, next) {
    const startTime = Date.now();

    // Skip super-logs polling requests from logging themselves (noise reduction)
    if (req.path && req.path.includes('/super-logs')) {
        return next();
    }

    res.on('finish', () => {
        try {
            const responseTime = Date.now() - startTime;
            const ip        = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
            const userEmail = req.headers['x-user-email'] || null;

            // Determine level based on status code
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

// ─── Graceful shutdown: final flush ──────────────────────────────────────────

function shutdownFlush() {
    try {
        clearInterval(flushTimer);
        flushToDisk();
    } catch (_) {}
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    superLog,
    getSuperLogs,
    getLogStats,
    requestLogger,
    shutdownFlush
};
