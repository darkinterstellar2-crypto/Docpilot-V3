/**
 * controllers/aiRateLimiter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Layered rate limiter for the AI assistant.
 *
 * Per-user limits (sliding windows):
 *   AI_RATE_LIMIT_PER_MIN  (default 20)  — per minute
 *   AI_RATE_LIMIT_PER_HOUR (default 100) — per hour
 *   AI_RATE_LIMIT_PER_DAY  (default 500) — per day
 *
 * Global limits across all users (cost protection):
 *   AI_RATE_GLOBAL_PER_HOUR (default 1000) — total req/hour
 *   AI_RATE_GLOBAL_PER_DAY  (default 5000) — total req/day
 *
 * Uses in-memory timestamp arrays with periodic cleanup.
 * No external dependencies.
 */

'use strict';

const WIN_MIN  = 60_000;           // 1 minute
const WIN_HOUR = 60 * 60_000;      // 1 hour
const WIN_DAY  = 24 * 60 * 60_000; // 24 hours

// Per-user store: userId → timestamp[]
const _userStore = new Map();
// Global store: timestamp[]
let _globalStore = [];

// ─── Limits (read env at call time so they can change via restart) ────────────
function limits() {
    return {
        perMin:     parseInt(process.env.AI_RATE_LIMIT_PER_MIN,   10) || 20,
        perHour:    parseInt(process.env.AI_RATE_LIMIT_PER_HOUR,  10) || 100,
        perDay:     parseInt(process.env.AI_RATE_LIMIT_PER_DAY,   10) || 500,
        globalHour: parseInt(process.env.AI_RATE_GLOBAL_PER_HOUR, 10) || 1000,
        globalDay:  parseInt(process.env.AI_RATE_GLOBAL_PER_DAY,  10) || 5000,
    };
}

// ─── Periodic cleanup — evict idle entries to prevent memory bloat ────────────
setInterval(() => {
    const cutoff = Date.now() - WIN_DAY;
    for (const [key, arr] of _userStore.entries()) {
        if (!arr.length || arr[arr.length - 1] < cutoff) {
            _userStore.delete(key);
        }
    }
    _globalStore = _globalStore.filter(t => Date.now() - t < WIN_DAY);
}, 15 * 60_000).unref();

// ─── Core check ───────────────────────────────────────────────────────────────

/**
 * Check rate limits for a given user. Records the request if allowed.
 * @param {string} userId - email or IP fallback
 * @returns {{ allowed: boolean, retryAfter: number, reason: string }}
 */
function checkRateLimit(userId) {
    const now  = Date.now();
    const lim  = limits();

    // ── 1. Global limits (check BEFORE recording, so we don't count blocked reqs) ──
    const globalNow = _globalStore.filter(t => now - t < WIN_DAY);

    const gHour = globalNow.filter(t => now - t < WIN_HOUR).length;
    const gDay  = globalNow.length;

    if (gHour >= lim.globalHour) {
        return { allowed: false, retryAfter: 60,   reason: 'global_hour' };
    }
    if (gDay >= lim.globalDay) {
        return { allowed: false, retryAfter: 3600, reason: 'global_day' };
    }

    // ── 2. Per-user limits ────────────────────────────────────────────────────
    const prev    = (_userStore.get(userId) || []).filter(t => now - t < WIN_DAY);
    const uMin    = prev.filter(t => now - t < WIN_MIN ).length;
    const uHour   = prev.filter(t => now - t < WIN_HOUR).length;
    const uDay    = prev.length;

    if (uMin  >= lim.perMin)  return { allowed: false, retryAfter: 60,    reason: 'per_min'  };
    if (uHour >= lim.perHour) return { allowed: false, retryAfter: 3600,  reason: 'per_hour' };
    if (uDay  >= lim.perDay)  return { allowed: false, retryAfter: 86400, reason: 'per_day'  };

    // ── 3. Request is allowed — record it ─────────────────────────────────────
    prev.push(now);
    _userStore.set(userId, prev);
    _globalStore = globalNow;
    _globalStore.push(now);

    return { allowed: true, retryAfter: 0, reason: '' };
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Express middleware that enforces AI rate limits.
 * Drop-in replacement for the old inline aiRateLimiter in aiRoutes.js.
 */
function aiRateLimitMiddleware(req, res, next) {
    const userId = (req.user && req.user.email) || req.ip || 'unknown';
    const { allowed, retryAfter, reason } = checkRateLimit(userId);

    if (!allowed) {
        res.setHeader('Retry-After', String(retryAfter));

        if (reason === 'global_hour' || reason === 'global_day') {
            return res.status(429).json({
                error: 'AI assistant is temporarily at capacity. Please try again later.',
            });
        }

        const messages = {
            per_min:  'Too many AI requests. Please wait a moment.',
            per_hour: 'Hourly AI request limit reached. Please try again in an hour.',
            per_day:  'Daily AI request limit reached. Please try again tomorrow.',
        };
        return res.status(429).json({ error: messages[reason] || 'Too many requests.' });
    }

    next();
}

module.exports = { checkRateLimit, aiRateLimitMiddleware };
