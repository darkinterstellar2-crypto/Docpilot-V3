/**
 * sessionLogger.js
 * Tracks user login/logout events with device info.
 * Storage: src/DataFiles/sessions-log.json
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'sessions-log.json');
const TERMINATED_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'terminated-sessions.json');
const MAX_ENTRIES = 10000;

// ── Device Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a User-Agent string into a friendly "Browser on OS" label.
 * Uses simple regex matching — no external library required.
 */
function parseDevice(userAgent) {
    if (!userAgent) return 'Unknown';

    // Detect OS (order matters: Android before Linux, iOS before macOS)
    let os = 'Unknown';
    if (/CrOS/i.test(userAgent))           os = 'ChromeOS';
    else if (/Android/i.test(userAgent))   os = 'Android';
    else if (/iPhone|iPad/i.test(userAgent)) os = 'iOS';
    else if (/Windows/i.test(userAgent))   os = 'Windows';
    else if (/Mac OS X/i.test(userAgent))  os = 'macOS';
    else if (/Linux/i.test(userAgent))     os = 'Linux';

    // Detect Browser (order matters: Edge/Opera before Chrome, Chrome before Safari)
    let browser = 'Unknown';
    if (/Edg\//i.test(userAgent))                          browser = 'Edge';
    else if (/OPR\//i.test(userAgent) || /Opera/i.test(userAgent)) browser = 'Opera';
    else if (/SamsungBrowser/i.test(userAgent))            browser = 'Samsung Browser';
    else if (/Chrome/i.test(userAgent))                    browser = 'Chrome';
    else if (/Firefox/i.test(userAgent))                   browser = 'Firefox';
    else if (/Safari/i.test(userAgent))                    browser = 'Safari';

    return `${browser} on ${os}`;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

/** Read sessions array from disk. Returns [] on any error. */
function readSessions() {
    try {
        const data = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

/** Write sessions array to disk, trimming to MAX_ENTRIES (keeps newest). */
function writeSessions(sessions) {
    if (sessions.length > MAX_ENTRIES) {
        sessions = sessions.slice(sessions.length - MAX_ENTRIES);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log a session event (login / logout / login_failed).
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.name
 * @param {string} opts.action  - 'login' | 'logout' | 'login_failed'
 * @param {string} opts.ip
 * @param {string} opts.userAgent
 */
function logSession({ email, name, action, ip, userAgent }) {
    try {
        const sessions = readSessions();
        sessions.push({
            email:     email     || 'unknown',
            name:      name      || 'Unknown',
            action,
            timestamp: new Date().toISOString(),
            ip:        ip        || 'unknown',
            userAgent: userAgent || '',
            device:    parseDevice(userAgent)
        });
        writeSessions(sessions);
    } catch (err) {
        console.error('[sessionLogger] Failed to write session event:', err.message);
    }
}

/**
 * Get session history for a specific user (newest first).
 * @param {string} email
 * @param {number} limit
 */
function getSessionHistory(email, limit = 50) {
    return readSessions()
        .filter(s => s.email === email)
        .reverse()
        .slice(0, limit);
}

/**
 * Get all sessions (newest first).
 * @param {number} limit
 */
function getAllSessions(limit = 200) {
    return readSessions().reverse().slice(0, limit);
}

/**
 * Get the most recent successful login event for a user.
 * @param {string} email
 */
function getLastLogin(email) {
    const sessions = readSessions();
    const logins = sessions.filter(s => s.email === email && s.action === 'login');
    return logins.length > 0 ? logins[logins.length - 1] : null;
}

/**
 * Get the most recent logout event for a user.
 * @param {string} email
 */
function getLastLogout(email) {
    const sessions = readSessions();
    const logouts = sessions.filter(s => s.email === email && s.action === 'logout');
    return logouts.length > 0 ? logouts[logouts.length - 1] : null;
}

/**
 * Get unique devices a user has logged in from.
 * @param {string} email
 */
function getActiveDevices(email) {
    const devices = readSessions()
        .filter(s => s.email === email && s.action === 'login')
        .map(s => s.device);
    return [...new Set(devices)];
}

// ── Force Termination ─────────────────────────────────────────────────────────

/** Read terminated sessions map from disk. Returns {} on any error. */
function readTerminated() {
    try {
        const data = fs.readFileSync(TERMINATED_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

/** Write terminated sessions map to disk. */
function writeTerminated(map) {
    fs.writeFileSync(TERMINATED_FILE, JSON.stringify(map, null, 2));
}

/**
 * Force-terminate all sessions for a user.
 * Any request from this user will be rejected until they log in again.
 * @param {string} email - user to terminate
 * @param {string} terminatedBy - email of the admin who terminated
 */
function terminateUser(email, terminatedBy) {
    const map = readTerminated();
    map[email.toLowerCase()] = {
        at: new Date().toISOString(),
        by: terminatedBy
    };
    writeTerminated(map);

    // Also log it as a session event
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
 * @param {string} email
 */
function isTerminated(email) {
    const map = readTerminated();
    return map[email.toLowerCase()] || null;
}

/**
 * Clear termination for a user (called on successful login).
 * @param {string} email
 */
function clearTermination(email) {
    const map = readTerminated();
    delete map[email.toLowerCase()];
    writeTerminated(map);
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
