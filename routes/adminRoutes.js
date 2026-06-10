// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// - users: SELECT/INSERT/UPDATE/DELETE on users table
// - logs: SELECT from action_logs
// - sessions: SELECT from session_logs via sessionLogger
// - access control: via accessControl.js (now PostgreSQL-backed)
// - super_logs: SELECT from super_logs via superLogger

const express = require('express');
const router = express.Router();
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('../controllers/db');
const { logAction, getLogs } = require('../controllers/logger');
const { hashPassword } = require('../controllers/passwordHelper');
const { getSyncStatus, triggerSync } = require('../controllers/nasSync');
const {
    logSession, getSessionHistory, getLastLogin, getLastLogout,
    getActiveDevices, terminateUser, getAllSessions
} = require('../controllers/sessionLogger');
const { getSuperLogs, getLogStats } = require('../controllers/superLogger');
const {
    getAllAccessRules, getUserAccess, setUserAccess, removeUserAccess
} = require('../controllers/accessControl');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ── Middleware ────────────────────────────────────────────────────────────────

function superadminOnly(req, res, next) {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only.' });
    }
    next();
}

function getRequesterRole(req) {
    return req.headers['x-user-role'] || '';
}

// ── Access Control: auto-create zero-access ACL entry ────────────────────────

async function ensureZeroAccessACL(email) {
    const existing = await getUserAccess(email);
    if (!existing) {
        await setUserAccess(email, {
            fullAccess: false,
            dashboard: {
                createProject: false,
                deleteProject: false,
                changeStatus: false,
                reorderProjects: false,
                downloadZip: false,
            },
            projects: {}
        });
    }
}

// ── GET all users ─────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
    try {
        const reqRole = (req.headers['x-user-role'] || '').toLowerCase();

        let query = `
            SELECT name, email, username, role, avatar_url AS avatar,
                   is_approved AS "isApproved", is_verified AS "isVerified",
                   created_at AS "createdAt"
            FROM users
        `;
        const params = [];

        if (reqRole !== 'superadmin') {
            query += ` WHERE role != 'superadmin'`;
        }

        const result = await db.query(query, params);
        const users = result.rows.map(u => ({
            name:       u.name,
            email:      u.email,
            username:   u.username,
            role:       u.role,
            avatar:     u.avatar || null,
            status:     u.isApproved ? 'approved' : 'pending',
            isVerified: u.isVerified,
            isApproved: u.isApproved,
            createdAt:  u.createdAt || null
        }));

        res.json({ success: true, users });
    } catch (error) {
        console.error('[adminRoutes] GET /users error:', error.message);
        res.status(500).json({ success: false, message: "Could not fetch users" });
    }
});

// ── POST approve/revoke user ──────────────────────────────────────────────────

router.post('/approve', async (req, res) => {
    const { email, status } = req.body;
    const isApproved = status === 'approved';

    try {
        const r = await db.query(
            `UPDATE users SET is_approved = $1, updated_at = NOW()
             WHERE LOWER(email) = LOWER($2) AND role != 'superadmin'
             RETURNING name, email, role`,
            [isApproved, email]
        );

        if (r.rowCount === 0) {
            // Check if user exists but is superadmin
            const chk = await db.query('SELECT role FROM users WHERE LOWER(email) = LOWER($1)', [email]);
            if (chk.rows[0]?.role === 'superadmin') {
                return res.status(403).json({ success: false, message: "Cannot modify superadmin status." });
            }
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const user = r.rows[0];

        await logAction(req.headers['x-user-email'] || 'Admin', isApproved ? 'User Approved' : 'User Revoked', `Status changed for ${email} to ${status}`);

        if (isApproved) {
            await ensureZeroAccessACL(email).catch(err => console.error('[adminRoutes] ensureZeroAccessACL error:', err.message));

            // Send welcome email
            const mailOptions = {
                from: `"Geggos" <${process.env.SMTP_FROM}>`,
                to: email,
                subject: 'Geggos Account Approved!',
                html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2>Welcome to Geggos, ${user.name || 'User'}!</h2>
                    <p>Your account has been <strong>approved</strong> by an administrator.</p>
                    <p>You can now log in and access the Project Hub.</p>
                </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error("Email error:", err));
        }

        res.json({ success: true, message: "User status updated." });
    } catch (error) {
        console.error('[adminRoutes] approve error:', error.message);
        res.status(500).json({ success: false, message: "Failed to update user status." });
    }
});

// ── GET logs ──────────────────────────────────────────────────────────────────

router.get('/logs/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, message: 'Missing query parameter.' });
    try {
        const q = `%${query.toLowerCase()}%`;
        const result = await db.query(
            `SELECT id, timestamp, user_email AS "user", action, details
             FROM action_logs
             WHERE tenant_id = $1
               AND (LOWER(details) LIKE $2 OR LOWER(action) LIKE $2)
             ORDER BY timestamp DESC
             LIMIT 1000`,
            [TENANT_ID, q]
        );
        res.json({ success: true, logs: result.rows });
    } catch (error) {
        console.error('[adminRoutes] logs/search error:', error.message);
        res.status(500).json({ success: false, message: "Could not search logs" });
    }
});

router.get('/logs', async (req, res) => {
    try {
        const logs = await getLogs(1000);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not fetch logs" });
    }
});

// ── NAS sync ──────────────────────────────────────────────────────────────────

router.get('/sync-status', async (req, res) => {
    try {
        const status = await getSyncStatus();
        res.json({ success: true, ...status });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not get sync status: ' + e.message });
    }
});

router.post('/sync-trigger', (req, res) => {
    try {
        triggerSync();
        res.json({ success: true, message: 'Sync triggered' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not trigger sync: ' + e.message });
    }
});

// ── Session history ───────────────────────────────────────────────────────────

router.get('/user-sessions/:email', async (req, res) => {
    const { email } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    try {
        const [sessions, lastLogin, devices] = await Promise.all([
            getSessionHistory(email, limit),
            getLastLogin(email),
            getActiveDevices(email)
        ]);
        res.json({ success: true, sessions, lastLogin, devices });
    } catch (error) {
        console.error('[adminRoutes] user-sessions error:', error);
        res.status(500).json({ success: false, message: "Could not fetch session history." });
    }
});

// ── Update user (username/password) ──────────────────────────────────────────

router.post('/user/update', superadminOnly, async (req, res) => {
    const { email, username, password } = req.body;
    const requesterRole  = getRequesterRole(req);
    const requesterEmail = req.headers['x-user-email'] || 'Admin';

    if (!email) return res.status(400).json({ success: false, message: "Email is required." });
    if (!username && !password) return res.status(400).json({ success: false, message: "At least one field must be provided." });

    if (username && username.trim().length < 3) {
        return res.status(400).json({ success: false, message: "Username must be at least 3 characters." });
    }
    if (password && password.length < 4) {
        return res.status(400).json({ success: false, message: "Password must be at least 4 characters." });
    }

    try {
        const userR = await db.query(
            `SELECT id, username, role FROM users WHERE LOWER(email) = LOWER($1)`,
            [email]
        );
        if (userR.rows.length === 0) return res.status(404).json({ success: false, message: "User not found." });

        const targetUser = userR.rows[0];
        if (targetUser.role === 'superadmin' && requesterRole !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Only superadmin can edit superadmin accounts." });
        }

        const changes = [];

        if (username && username.trim() !== targetUser.username) {
            // Check uniqueness
            const taken = await db.query(
                `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND LOWER(email) != LOWER($2)`,
                [username.trim(), email]
            );
            if (taken.rows.length > 0) return res.status(400).json({ success: false, message: "Username already in use." });

            await db.query('UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2', [username.trim(), targetUser.id]);
            changes.push(`username → ${username.trim()}`);
        }

        if (password) {
            const hash = await hashPassword(password);
            await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, targetUser.id]);
            changes.push('password updated');
        }

        await logAction(requesterEmail, 'User Updated', `Updated account for ${email}: ${changes.join(', ')}`);
        res.json({ success: true, message: "User updated successfully." });
    } catch (error) {
        console.error('[adminRoutes] user/update error:', error);
        res.status(500).json({ success: false, message: "Failed to update user." });
    }
});

// ── User stats ────────────────────────────────────────────────────────────────

router.get('/user-stats/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const [allSessions, userR] = await Promise.all([
            getSessionHistory(email, 10000),
            db.query(`SELECT created_at AS "createdAt" FROM users WHERE LOWER(email) = LOWER($1)`, [email])
        ]);

        const totalLogins  = allSessions.filter(s => s.action === 'login').length;
        const totalLogouts = allSessions.filter(s => s.action === 'logout').length;
        const lastLogin    = allSessions.find(s => s.action === 'login')  || null;
        const lastLogout   = allSessions.find(s => s.action === 'logout') || null;
        const devices      = [...new Set(allSessions.filter(s => s.action === 'login').map(s => s.device))];

        res.json({
            success: true,
            totalLogins,
            totalLogouts,
            lastLogin,
            lastLogout,
            devices,
            accountCreated: userR.rows[0]?.createdAt || null,
            recentSessions: allSessions.slice(0, 20)
        });
    } catch (error) {
        console.error('[adminRoutes] user-stats error:', error);
        res.status(500).json({ success: false, message: "Could not fetch user stats." });
    }
});

// ── All sessions (admin view) ─────────────────────────────────────────────────

router.get('/sessions', async (req, res) => {
    const limit = parseInt(req.query.limit) || 200;
    try {
        const sessions = await getAllSessions(limit);
        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not fetch sessions." });
    }
});

// ── Access Control ────────────────────────────────────────────────────────────

router.get('/access-control', superadminOnly, async (req, res) => {
    try {
        const rules = await getAllAccessRules();
        res.json({ success: true, rules });
    } catch (e) {
        console.error('[adminRoutes] GET access-control error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch access rules.' });
    }
});

router.get('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        const rules = await getUserAccess(email);
        if (!rules) {
            return res.json({ success: true, email, rules: null, message: 'No ACL entry for this user.' });
        }
        res.json({ success: true, email, rules });
    } catch (e) {
        console.error('[adminRoutes] GET access-control/:email error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch access rules.' });
    }
});

router.post('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        const { fullAccess, dashboard, authority, projects, defaultProjectAccess } = req.body;

        let accessData;
        if (fullAccess !== undefined || dashboard !== undefined || authority !== undefined || projects !== undefined) {
            accessData = {
                fullAccess: fullAccess === true,
                dashboard:  authority || dashboard || {},
                authority:  authority || dashboard || {},
                projects:   projects  || {},
            };
        } else if (defaultProjectAccess !== undefined) {
            accessData = { projects: projects || {}, defaultProjectAccess };
        } else {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        await setUserAccess(email, accessData);

        const requesterEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(requesterEmail, 'ACL Updated', `Set access control rules for ${email}`);

        res.json({ success: true, message: `Access rules saved for ${email}.` });
    } catch (e) {
        console.error('[adminRoutes] POST access-control/:email error:', e.message);
        res.status(500).json({ success: false, message: 'Could not save access rules.' });
    }
});

router.delete('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        await removeUserAccess(email);

        const requesterEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(requesterEmail, 'ACL Removed', `Removed all access restrictions for ${email}`);

        res.json({ success: true, message: `Access rules removed for ${email}.` });
    } catch (e) {
        console.error('[adminRoutes] DELETE access-control/:email error:', e.message);
        res.status(500).json({ success: false, message: 'Could not remove access rules.' });
    }
});

// ── Super logs ────────────────────────────────────────────────────────────────

router.get('/super-logs/stats', superadminOnly, async (req, res) => {
    try {
        const stats = await getLogStats();
        res.json({ success: true, ...stats });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not fetch log stats.' });
    }
});

router.get('/super-logs', superadminOnly, async (req, res) => {
    try {
        const { after_id, types, level, limit, search } = req.query;
        const typesArr = types ? types.split(',').map(t => t.trim()).filter(Boolean) : null;

        const result = await getSuperLogs({
            after_id: after_id ? parseInt(after_id) : undefined,
            types:    typesArr && typesArr.length > 0 ? typesArr : undefined,
            level:    level || undefined,
            limit:    limit ? parseInt(limit) : 100,
            search:   search || undefined
        });

        res.json({ success: true, logs: result.logs, total: result.total });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not fetch super logs.' });
    }
});

// ── Reject user ───────────────────────────────────────────────────────────────

router.post('/reject', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

    try {
        const r = await db.query(
            `DELETE FROM users WHERE LOWER(email) = LOWER($1) AND role != 'superadmin' RETURNING name, email`,
            [email]
        );
        if (r.rowCount === 0) {
            const chk = await db.query('SELECT role FROM users WHERE LOWER(email) = LOWER($1)', [email]);
            if (chk.rows[0]?.role === 'superadmin') {
                return res.status(403).json({ success: false, message: 'Cannot reject a superadmin.' });
            }
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const user = r.rows[0];
        await logAction(req.headers['x-user-email'] || 'Admin', 'User Rejected', `Registration rejected and deleted for ${email} (${user.name})`);

        const mailOptions = {
            from: `"Geggos" <${process.env.SMTP_FROM}>`,
            to: email,
            subject: 'Registration Not Approved',
            html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2>Hi ${user.name || 'there'},</h2>
                <p>Unfortunately, your registration request has not been approved at this time.</p>
                <p>If you believe this was a mistake, please contact your administrator.</p>
            </div>`
        };
        transporter.sendMail(mailOptions).catch(err => console.error('[adminRoutes] Rejection email failed:', err));

        res.json({ success: true, message: 'User rejected and removed.' });
    } catch (error) {
        console.error('[adminRoutes] Reject error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to reject user.' });
    }
});

// ── Terminate Session ─────────────────────────────────────────────────────────

router.post('/terminate-session', superadminOnly, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

        const adminEmail = req.headers['x-user-email'] || 'unknown';
        terminateUser(email, adminEmail);
        await logAction(adminEmail, 'Session Terminated', `Force-terminated all sessions for ${email}`);

        res.json({ success: true, message: `All sessions for ${email} have been terminated.` });
    } catch (error) {
        console.error('[adminRoutes] Terminate session error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to terminate session.' });
    }
});

module.exports = router;
