/**
 * controllers/aiMailer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight mailer for DoBo AI edit-request forwarding.
 *
 * Strategy:
 *   1. ALWAYS log the request to data/ai-edit-requests/YYYY-MM-DD.json
 *      (append mode — creates dir as needed).
 *   2. Update data/ai-edit-requests/pending.json with unread count.
 *   3. If SMTP_HOST + SMTP_USER + SMTP_PASS are all set, also send an email
 *      to the admin. Failure is non-fatal (request is already on disk).
 *   4. Admin email is resolved dynamically from the user database
 *      (finds the superadmin user). Falls back to ADMIN_EMAIL env var.
 *
 * Environment variables used:
 *   ADMIN_EMAIL  — fallback recipient if no superadmin found in DB
 *   SMTP_HOST    — e.g. smtp.example.com
 *   SMTP_PORT    — default 465 (SSL); 587 uses STARTTLS
 *   SMTP_USER    — auth username
 *   SMTP_PASS    — auth password
 *   SMTP_FROM    — From address (falls back to SMTP_USER)
 */

'use strict';

const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');

const LOG_DIR     = path.join(__dirname, '..', 'data', 'ai-edit-requests');
const PENDING_FILE = path.join(LOG_DIR, 'pending.json');
const USERS_FILE  = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');

// ─── Admin email resolution ───────────────────────────────────────────────────

// Cache: { email: string|null, fetchedAt: number }
let _adminEmailCache = { email: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60_000; // 1 hour

/**
 * Resolve the superadmin's email from the user database.
 * Caches the result for 1 hour to avoid repeated disk reads.
 * Falls back to ADMIN_EMAIL env var if no superadmin is found.
 *
 * @returns {string|null}
 */
function getAdminEmail() {
    const now = Date.now();
    if (_adminEmailCache.email && (now - _adminEmailCache.fetchedAt) < CACHE_TTL_MS) {
        return _adminEmailCache.email;
    }

    try {
        const raw   = fs.readFileSync(USERS_FILE, 'utf8');
        const users = JSON.parse(raw);

        if (Array.isArray(users)) {
            const superadmin = users.find(u => u.role === 'superadmin' && u.email);
            if (superadmin) {
                _adminEmailCache = { email: superadmin.email, fetchedAt: now };
                return superadmin.email;
            }
        }
    } catch (err) {
        console.warn('[aiMailer] Could not read users.json for admin email:', err.message);
    }

    // Fallback to env var
    const fallback = process.env.ADMIN_EMAIL || null;
    _adminEmailCache = { email: fallback, fetchedAt: now };
    return fallback;
}

/**
 * Invalidate the admin email cache (call if user roles change at runtime).
 */
function invalidateAdminEmailCache() {
    _adminEmailCache = { email: null, fetchedAt: 0 };
}

// ─── Pending.json management ──────────────────────────────────────────────────

/**
 * Add an entry to pending.json (unread edit requests for the admin).
 * @param {string} requestFile - filename of the saved request (for audit trail)
 * @param {Object} info        - request info (userName, userEmail, message, etc.)
 */
function addToPending(requestFile, info) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });

        let pending = { unreadCount: 0, requests: [] };
        if (fs.existsSync(PENDING_FILE)) {
            try { pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch (_) {}
        }

        pending.unreadCount = (pending.unreadCount || 0) + 1;
        if (!Array.isArray(pending.requests)) pending.requests = [];

        pending.requests.push({
            file:       requestFile,
            timestamp:  new Date().toISOString(),
            userName:   info.userName,
            userEmail:  info.userEmail,
            projectName: info.projectName || 'N/A',
            messageSnippet: (info.message || '').slice(0, 120),
            read:       false,
        });

        fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf8');
    } catch (err) {
        console.error('[aiMailer] addToPending error:', err.message);
    }
}

/**
 * Read the current pending.json.
 * @returns {{ unreadCount: number, requests: Array }}
 */
function getPending() {
    if (!fs.existsSync(PENDING_FILE)) return { unreadCount: 0, requests: [] };
    try {
        return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    } catch (_) {
        return { unreadCount: 0, requests: [] };
    }
}

/**
 * Mark all pending requests as read (called when superadmin acknowledges).
 * Does NOT delete records — keeps them for the audit trail.
 */
function markPendingRead() {
    try {
        const pending = getPending();
        pending.unreadCount = 0;
        if (Array.isArray(pending.requests)) {
            pending.requests = pending.requests.map(r => ({ ...r, read: true }));
        }
        fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf8');
    } catch (err) {
        console.error('[aiMailer] markPendingRead error:', err.message);
    }
}

// ─── Email body builder ───────────────────────────────────────────────────────

/**
 * @param {Object} info
 * @returns {string}
 */
function buildEmailBody(info) {
    return [
        `User: ${info.userName} (${info.userEmail})`,
        `Role: ${info.userRole}`,
        `Project: ${info.projectName || 'N/A'}`,
        `Page: ${info.page || 'N/A'}`,
        `Module: ${info.module || 'N/A'}`,
        '',
        'Request:',
        info.message,
        '',
        `Attachment: ${info.attachment || 'None'}`,
        '',
        '---',
        'Submitted via DoBo AI Assistant',
    ].join('\n');
}

// ─── File logger ──────────────────────────────────────────────────────────────

/**
 * Append this request to a per-request JSON file and the daily log.
 * Returns the filename of the individual request file.
 */
function logToFile(info) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });

        const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const timestamp = Date.now();
        const userId    = (info.userEmail || 'unknown').replace(/[^a-zA-Z0-9@._-]/g, '_');

        // Individual request file (immutable — one per request for audit trail)
        const reqFilename = `${today}_${timestamp}_${userId}.json`;
        const reqFilePath = path.join(LOG_DIR, reqFilename);

        const entry = {
            timestamp: new Date().toISOString(),
            ...info,
        };

        fs.writeFileSync(reqFilePath, JSON.stringify(entry, null, 2), 'utf8');

        // Also append to the daily summary log
        const dailyLogPath = path.join(LOG_DIR, `${today}.json`);
        let entries = [];
        if (fs.existsSync(dailyLogPath)) {
            try { entries = JSON.parse(fs.readFileSync(dailyLogPath, 'utf8')); } catch (_) {}
        }
        entries.push(entry);
        fs.writeFileSync(dailyLogPath, JSON.stringify(entries, null, 2), 'utf8');

        return reqFilename;
    } catch (err) {
        console.error('[aiMailer] logToFile error:', err.message);
        return null;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Forward an edit request to the administrator.
 * Always logs to file first; updates pending.json; sends email if SMTP configured.
 *
 * @param {Object} info
 * @param {string} info.userName      — display name of the requesting user
 * @param {string} info.userEmail     — email address of the requesting user
 * @param {string} info.userRole      — role (user / admin / superadmin)
 * @param {string} info.projectName   — project context
 * @param {string} [info.page]        — current DocPilot page
 * @param {string} [info.module]      — current module
 * @param {string} info.message       — the user's edit-request text
 * @param {string} [info.attachment]  — filename of any attached file
 */
async function sendEditRequest(info) {
    // ── 1. File backup (always) ──────────────────────────────────────────────
    const requestFile = logToFile(info);

    // ── 2. Email (optional — silently skipped if SMTP not configured) ────────
    const adminEmail = getAdminEmail();
    const smtpHost   = process.env.SMTP_HOST;
    const smtpPort   = parseInt(process.env.SMTP_PORT, 10) || 465;
    const smtpUser   = process.env.SMTP_USER;
    const smtpPass   = process.env.SMTP_PASS;
    const smtpFrom   = process.env.SMTP_FROM || smtpUser;

    let emailSent = false;

    if (adminEmail && smtpHost && smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
            host:   smtpHost,
            port:   smtpPort,
            secure: smtpPort === 465,  // SSL on 465, STARTTLS on others
            auth:   { user: smtpUser, pass: smtpPass },
        });

        try {
            await transporter.sendMail({
                from:    smtpFrom,
                to:      adminEmail,
                subject: `[DocPilot] Edit Request from ${info.userName}`,
                text:    buildEmailBody(info),
            });
            console.log(`[aiMailer] Edit request emailed to ${adminEmail} (submitted by ${info.userEmail})`);
            emailSent = true;
        } catch (err) {
            // File backup is already written — don't re-throw, just warn
            console.error('[aiMailer] sendMail error (request is still logged to file):', err.message);
        }
    } else {
        console.warn('[aiMailer] SMTP not fully configured — edit request logged to file only.');
    }

    // ── 3. Add to pending.json if email was not sent ─────────────────────────
    // Even if email was sent we track it in pending so admin can see history,
    // but only mark it as requiring attention if the email failed/skipped.
    if (!emailSent && requestFile) {
        addToPending(requestFile, info);
    }
}

module.exports = {
    sendEditRequest,
    getAdminEmail,
    invalidateAdminEmailCache,
    getPending,
    markPendingRead,
};
