const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const { logAction, getLogs } = require('../controllers/logger');
const { hashPassword } = require('../controllers/passwordHelper');
const { getSyncStatus, triggerSync } = require('../controllers/nasSync');
const { logSession, getSessionHistory, getLastLogin, getLastLogout, getActiveDevices, terminateUser } = require('../controllers/sessionLogger');
const { getSuperLogs, getLogStats } = require('../controllers/superLogger');
const {
    getAllAccessRules,
    getUserAccess,
    setUserAccess,
    removeUserAccess,
} = require('../controllers/accessControl');

// ── Access Control helpers ────────────────────────────────────────────────────
async function ensureZeroAccessACL(email) {
    // Auto-create an ACL entry with zero access when a user is approved.
    // This ensures the "no entry = no access" invariant.
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

const USERS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');

// Configure email transporter via environment variables
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// ── Helper: read users file ───────────────────────────────────────────────────
async function getUsers() {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
}

// ── Helper: get requesting admin's role from header ──────────────────────────
function getRequesterRole(req) {
    // Frontend sends x-user-role header (stored in localStorage)
    return req.headers['x-user-role'] || '';
}

// GET all users for the dashboard
router.get('/users', async (req, res) => {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        const users = JSON.parse(data);
        
        // Show superadmins only to other superadmins
        const reqRole = (req.headers['x-user-role'] || '').toLowerCase();
        const safeUsers = users
            .filter(u => reqRole === 'superadmin' || u.role !== 'superadmin')
            .map(u => ({
                name: u.name,
                email: u.email,
                username: u.username,
                role: u.role,
                avatar: u.avatar || null,
                status: u.isApproved ? 'approved' : 'pending',
                isVerified: u.isVerified,
                isApproved: u.isApproved,
                createdAt: u.createdAt || null
            }));
        
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not fetch users" });
    }
});

// POST update user status (Approve/Revoke)
router.post('/approve', async (req, res) => {
    const { email, status } = req.body;
    const isApproved = status === 'approved';

    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        let users = JSON.parse(data);
        
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Prevent modifying superadmins
        if (users[userIndex].role === 'superadmin') {
            return res.status(403).json({ success: false, message: "Cannot modify superadmin status." });
        }

        // Admin clicked Approve or Revoke
        users[userIndex].isApproved = isApproved;
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        
        await logAction(req.headers['x-user-email'] || 'Admin', isApproved ? 'User Approved' : 'User Revoked', `Status changed for ${email} to ${status}`);

        // If newly approved, auto-create a zero-access ACL entry
        if (isApproved) {
            await ensureZeroAccessACL(email).catch(err => console.error('[adminRoutes] ensureZeroAccessACL error:', err.message));
        }

        // If newly approved, send a welcome email!
        if (isApproved) {
            const mailOptions = {
                from: `"Geggos" <${process.env.SMTP_FROM}>`,
                to: email,
                subject: 'Geggos Account Approved!',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2>Welcome to Geggos, ${users[userIndex].name || 'User'}!</h2>
                        <p>Your account has been reviewed and <strong>approved</strong> by an administrator.</p>
                        <p>You can now log in and access the Project Hub.</p>
                        <br>
                        <p>Best regards,<br>The Admin Team</p>
                    </div>
                `
            };
            transporter.sendMail(mailOptions).catch(err => console.error("Email error:", err));
        }

        res.json({ success: true, message: "User status updated." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update user status." });
    }
});

// GET /api/admin/logs/search?query=FILENAME — search logs by details (must be before /logs)
router.get('/logs/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, message: 'Missing query parameter.' });
    try {
        const logs = await getLogs();
        const q = query.toLowerCase();
        const filtered = logs.filter(l =>
            (l.details && l.details.toLowerCase().includes(q)) ||
            (l.action && l.action.toLowerCase().includes(q))
        );
        res.json({ success: true, logs: filtered });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not search logs" });
    }
});

// GET all logs for audit trail
router.get('/logs', async (req, res) => {
    try {
        const logs = await getLogs();
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not fetch logs" });
    }
});

// GET /api/admin/sync-status — NAS sync state for admin dashboard
router.get('/sync-status', async (req, res) => {
    try {
        const status = await getSyncStatus();
        res.json({ success: true, ...status });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not get sync status: ' + e.message });
    }
});

// POST /api/admin/sync-trigger — manually trigger a full NAS sync
router.post('/sync-trigger', (req, res) => {
    try {
        triggerSync();
        res.json({ success: true, message: 'Sync triggered' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not trigger sync: ' + e.message });
    }
});

// ── NEW: Session & User Management Endpoints ──────────────────────────────────

/**
 * GET /api/admin/user-sessions/:email
 * Returns login/logout history for a specific user.
 * Admin only.
 */
router.get('/user-sessions/:email', async (req, res) => {
    const { email } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const sessions = getSessionHistory(email, limit);
        const lastLogin = getLastLogin(email);
        const devices = getActiveDevices(email);

        res.json({ success: true, sessions, lastLogin, devices });
    } catch (error) {
        console.error('[adminRoutes] user-sessions error:', error);
        res.status(500).json({ success: false, message: "Could not fetch session history." });
    }
});

/**
 * POST /api/admin/user/update
 * Update a user's username and/or password.
 * Body: { email, username?, password? }
 * SUPERADMIN ONLY.
 */
router.post('/user/update', superadminOnly, async (req, res) => {
    const { email, username, password } = req.body;
    const requesterRole = getRequesterRole(req);
    const requesterEmail = req.headers['x-user-email'] || 'Admin';

    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!username && !password) {
        return res.status(400).json({ success: false, message: "At least one field (username or password) must be provided." });
    }

    // Validation
    if (username && username.trim().length < 3) {
        return res.status(400).json({ success: false, message: "Username must be at least 3 characters." });
    }
    if (password && password.length < 4) {
        return res.status(400).json({ success: false, message: "Password must be at least 4 characters." });
    }

    try {
        let users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const targetUser = users[userIndex];

        // Superadmin protection: only a superadmin can edit another superadmin
        if (targetUser.role === 'superadmin' && requesterRole !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Only superadmin can edit superadmin accounts." });
        }

        // Check username uniqueness if changing it
        if (username && username.trim() !== targetUser.username) {
            const taken = users.find(u => u.username === username.trim() && u.email !== email);
            if (taken) {
                return res.status(400).json({ success: false, message: "Username already in use." });
            }
            users[userIndex].username = username.trim();
        }

        if (password) {
            users[userIndex].password = await hashPassword(password);
        }

        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

        const changes = [];
        if (username) changes.push(`username → ${username.trim()}`);
        if (password) changes.push('password updated');
        await logAction(requesterEmail, 'User Updated', `Updated account for ${email}: ${changes.join(', ')}`);

        res.json({ success: true, message: "User updated successfully." });
    } catch (error) {
        console.error('[adminRoutes] user/update error:', error);
        res.status(500).json({ success: false, message: "Failed to update user." });
    }
});

// NOTE: Role change endpoint removed — roles are no longer user-changeable.
// There are only two types: 'superadmin' (set manually) and 'user' (everyone else).
// Access is controlled entirely via ACL, not roles.

/**
 * GET /api/admin/user-stats/:email
 * Returns statistics for a user: login count, last login, last logout, devices, account created.
 * Admin only.
 */
router.get('/user-stats/:email', async (req, res) => {
    const { email } = req.params;

    try {
        // Get session data
        const allSessions = getSessionHistory(email, 10000); // fetch all for stats
        const totalLogins = allSessions.filter(s => s.action === 'login').length;
        const totalLogouts = allSessions.filter(s => s.action === 'logout').length;
        const lastLogin = getLastLogin(email);
        const lastLogout = getLastLogout(email);
        const devices = getActiveDevices(email);

        // Get account creation date from users.json
        let createdAt = null;
        try {
            const users = await getUsers();
            const user = users.find(u => u.email === email);
            createdAt = user ? (user.createdAt || null) : null;
        } catch (e) { /* non-fatal */ }

        res.json({
            success: true,
            stats: {
                totalLogins,
                totalLogouts,
                lastLogin:  lastLogin  ? lastLogin.timestamp  : null,
                lastLogout: lastLogout ? lastLogout.timestamp : null,
                lastDevice: lastLogin  ? lastLogin.device     : null,
                devices,
                createdAt
            }
        });
    } catch (error) {
        console.error('[adminRoutes] user-stats error:', error);
        res.status(500).json({ success: false, message: "Could not fetch user stats." });
    }
});

// ── Super Logs (SUPERADMIN ONLY) ──────────────────────────────────────────────

/**
 * Middleware: allow ONLY superadmin. Not admin. Not administrator. Only superadmin.
 */
function superadminOnly(req, res, next) {
    const role = req.headers['x-user-role'] || '';
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin access required.' });
    }
    next();
}

// ── Access Control CRUD (SUPERADMIN ONLY) ─────────────────────────────────────

/**
 * GET /api/admin/access-control
 * Returns the entire ACL object.
 * SUPERADMIN ONLY
 */
router.get('/access-control', superadminOnly, async (req, res) => {
    try {
        const rules = await getAllAccessRules();
        res.json({ success: true, rules });
    } catch (e) {
        console.error('[adminRoutes] access-control GET error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch access rules.' });
    }
});

/**
 * GET /api/admin/access-control/:email
 * Returns the ACL entry for a specific user (or null = full access).
 * SUPERADMIN ONLY
 */
router.get('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        const access = await getUserAccess(email);
        res.json({ success: true, access });
    } catch (e) {
        console.error('[adminRoutes] access-control/:email GET error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch user access.' });
    }
});

/**
 * POST /api/admin/access-control/:email
 * Set / overwrite the ACL entry for a user.
 * Body (new format): { fullAccess, dashboard, projects }
 * Body (legacy): { projects, defaultProjectAccess } — still accepted
 * SUPERADMIN ONLY
 */
router.post('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        const { projects, fullAccess, dashboard, authority, defaultProjectAccess } = req.body;

        let accessData;

        if (fullAccess !== undefined || dashboard !== undefined || authority !== undefined) {
            // New format — accept both 'authority' and 'dashboard' keys
            const authSource = authority || dashboard || {};
            accessData = {
                fullAccess: fullAccess === true,
                authority: {
                    createProject:   !!(authSource.createProject),
                    deleteProject:   !!(authSource.deleteProject),
                    changeStatus:    !!(authSource.changeStatus),
                    reorderProjects: !!(authSource.reorderProjects),
                    downloadZip:     !!(authSource.downloadZip),
                    editProjectInfo: !!(authSource.editProjectInfo),
                },
                dashboard: {
                    createProject:   !!(authSource.createProject),
                    deleteProject:   !!(authSource.deleteProject),
                    changeStatus:    !!(authSource.changeStatus),
                    reorderProjects: !!(authSource.reorderProjects),
                    downloadZip:     !!(authSource.downloadZip),
                    editProjectInfo: !!(authSource.editProjectInfo),
                },
                projects: projects || {},
            };
        } else if (defaultProjectAccess !== undefined) {
            // Legacy format — keep as-is for backward compatibility
            if (typeof defaultProjectAccess !== 'boolean') {
                return res.status(400).json({ success: false, message: 'defaultProjectAccess must be a boolean.' });
            }
            accessData = { projects: projects || {}, defaultProjectAccess };
        } else {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        await setUserAccess(email, accessData);

        // Sync project-info.json member lists based on new ACL
        try {
            const PROJECT_INFO_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'project-info.json');
            let projectInfo = {};
            try { projectInfo = JSON.parse(await fs.readFile(PROJECT_INFO_FILE, 'utf-8')); } catch (_) {}

            if (accessData.fullAccess === true) {
                // Add user to ALL projects
                for (const proj of Object.keys(projectInfo)) {
                    if (!Array.isArray(projectInfo[proj].members)) projectInfo[proj].members = [];
                    if (!projectInfo[proj].members.includes(email)) projectInfo[proj].members.push(email);
                }
            } else {
                const projAccess = accessData.projects || {};
                for (const proj of Object.keys(projectInfo)) {
                    if (!Array.isArray(projectInfo[proj].members)) projectInfo[proj].members = [];
                    const hasAccess = projAccess[proj] && projAccess[proj].access === true;
                    if (hasAccess) {
                        if (!projectInfo[proj].members.includes(email)) projectInfo[proj].members.push(email);
                    } else {
                        projectInfo[proj].members = projectInfo[proj].members.filter(m => m !== email);
                    }
                }
            }

            await fs.writeFile(PROJECT_INFO_FILE, JSON.stringify(projectInfo, null, 2), 'utf-8');
        } catch (syncErr) {
            console.warn('[adminRoutes] member sync warning:', syncErr.message);
        }

        const requesterEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(requesterEmail, 'ACL Updated', `Set access control rules for ${email}`);

        res.json({ success: true, message: `Access rules saved for ${email}.` });
    } catch (e) {
        console.error('[adminRoutes] access-control/:email POST error:', e.message);
        res.status(500).json({ success: false, message: 'Could not save access rules.' });
    }
});

/**
 * DELETE /api/admin/access-control/:email
 * Remove all ACL restrictions for a user (restores full access).
 * SUPERADMIN ONLY
 */
router.delete('/access-control/:email', superadminOnly, async (req, res) => {
    try {
        const { email } = req.params;
        await removeUserAccess(email);

        // Remove user from all project member lists (full access = no ACL restriction)
        try {
            const PROJECT_INFO_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'project-info.json');
            let projectInfo = {};
            try { projectInfo = JSON.parse(await fs.readFile(PROJECT_INFO_FILE, 'utf-8')); } catch (_) {}
            for (const proj of Object.keys(projectInfo)) {
                if (Array.isArray(projectInfo[proj].members)) {
                    projectInfo[proj].members = projectInfo[proj].members.filter(m => m !== email);
                }
            }
            await fs.writeFile(PROJECT_INFO_FILE, JSON.stringify(projectInfo, null, 2), 'utf-8');
        } catch (syncErr) {
            console.warn('[adminRoutes] member sync (delete) warning:', syncErr.message);
        }

        const requesterEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(requesterEmail, 'ACL Removed', `Removed all access restrictions for ${email}`);

        res.json({ success: true, message: `Access rules removed for ${email}. User now has full access.` });
    } catch (e) {
        console.error('[adminRoutes] access-control/:email DELETE error:', e.message);
        res.status(500).json({ success: false, message: 'Could not remove access rules.' });
    }
});

// ── /Access Control ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/super-logs/stats — log statistics for last 24h
 * SUPERADMIN ONLY
 */
router.get('/super-logs/stats', superadminOnly, (req, res) => {
    try {
        const stats = getLogStats();
        res.json({ success: true, ...stats });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not fetch log stats.' });
    }
});

/**
 * GET /api/admin/super-logs — query super logs
 * Query: after_id, types (comma-separated), level, limit (default 100, max 500), search
 * SUPERADMIN ONLY
 */
router.get('/super-logs', superadminOnly, (req, res) => {
    try {
        const { after_id, types, level, limit, search } = req.query;

        const typesArr = types ? types.split(',').map(t => t.trim()).filter(Boolean) : null;

        const result = getSuperLogs({
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

// POST /api/admin/reject — reject & delete a pending user + send rejection email
router.post('/reject', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        let users = JSON.parse(data);

        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found.' });

        // Prevent rejecting superadmins
        if (users[userIndex].role === 'superadmin') {
            return res.status(403).json({ success: false, message: 'Cannot reject a superadmin.' });
        }

        const user = users[userIndex];

        // Remove user from users.json
        users.splice(userIndex, 1);
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

        await logAction(req.headers['x-user-email'] || 'Admin', 'User Rejected', `Registration rejected and deleted for ${email} (${user.name})`);
        superLog('admin', 'info', `User rejected: ${email}`, { email, name: user.name });

        // Send rejection email
        const mailOptions = {
            from: `"Geggos" <${process.env.SMTP_FROM}>`,
            to: email,
            subject: 'Registration Not Approved',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2>Hi ${user.name || 'there'},</h2>
                    <p>Unfortunately, your registration request for DocPilot has not been approved at this time.</p>
                    <p>If you believe this was a mistake, please contact your administrator.</p>
                    <br>
                    <p>Best regards,<br>The Admin Team</p>
                </div>
            `
        };
        transporter.sendMail(mailOptions).catch(err => console.error('[adminRoutes] Rejection email failed:', err));

        res.json({ success: true, message: 'User rejected and removed.' });
    } catch (error) {
        console.error('[adminRoutes] Reject error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to reject user.' });
    }
});

// ── Terminate Session ─────────────────────────────────────────────────────────
// POST /api/admin/terminate-session — force-logout a user from all devices
// Only superadmin can use this. Works on ANY user including other superadmins.
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
