/**
 * rateLimiter.js
 * In-memory login rate limiter.
 * Tracks failed attempts by IP + identifier. Locks out after MAX_ATTEMPTS.
 * Auto-cleans old entries every minute.
 */

const MAX_ATTEMPTS = 5;              // lockout after 5 failed attempts
const LOCKOUT_DURATION = 15 * 60 * 1000;  // 15 minutes lockout
const WINDOW_MS = 15 * 60 * 1000;         // 15 minute sliding window

// Map<key, { attempts: number, firstAttempt: number, lockedUntil: number | null }>
const attempts = new Map();

function getKey(ip, identifier) {
    return `${ip}|${(identifier || '').toLowerCase()}`;
}

/**
 * Check if a login attempt is allowed.
 * @param {string} ip
 * @param {string} identifier - email or username
 * @returns {{ allowed: boolean, remainingAttempts: number, lockedUntil: Date | null, retryAfterSec: number }}
 */
function checkAttempt(ip, identifier) {
    const key = getKey(ip, identifier);
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry) {
        return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedUntil: null, retryAfterSec: 0 };
    }

    // Check if locked out
    if (entry.lockedUntil && now < entry.lockedUntil) {
        const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
        return {
            allowed: false,
            remainingAttempts: 0,
            lockedUntil: new Date(entry.lockedUntil),
            retryAfterSec
        };
    }

    // Lock expired — reset
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        attempts.delete(key);
        return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedUntil: null, retryAfterSec: 0 };
    }

    // Window expired — reset
    if (now - entry.firstAttempt > WINDOW_MS) {
        attempts.delete(key);
        return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedUntil: null, retryAfterSec: 0 };
    }

    const remaining = MAX_ATTEMPTS - entry.attempts;
    return { allowed: remaining > 0, remainingAttempts: Math.max(0, remaining), lockedUntil: null, retryAfterSec: 0 };
}

/**
 * Record a failed login attempt.
 * @param {string} ip
 * @param {string} identifier
 */
function recordFailure(ip, identifier) {
    const key = getKey(ip, identifier);
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || (now - entry.firstAttempt > WINDOW_MS)) {
        attempts.set(key, { attempts: 1, firstAttempt: now, lockedUntil: null });
        return;
    }

    entry.attempts++;
    if (entry.attempts >= MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOCKOUT_DURATION;
    }
}

/**
 * Clear attempts on successful login.
 * @param {string} ip
 * @param {string} identifier
 */
function clearAttempts(ip, identifier) {
    attempts.delete(getKey(ip, identifier));
}

// Cleanup stale entries every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
        if (entry.lockedUntil && now >= entry.lockedUntil) {
            attempts.delete(key);
        } else if (now - entry.firstAttempt > WINDOW_MS) {
            attempts.delete(key);
        }
    }
}, 60 * 1000);

module.exports = { checkAttempt, recordFailure, clearAttempts };
