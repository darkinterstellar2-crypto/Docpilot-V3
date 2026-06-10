const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

const { canAccessProject, canEditProject, getEffectivePermissions, getProjectMembers } = require('../controllers/accessControl');

const PROJECT_INFO_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'project-info.json');

/** Read the whole project-info store. Returns {} on error. */
async function readInfo() {
    try {
        return JSON.parse(await fs.readFile(PROJECT_INFO_FILE, 'utf-8'));
    } catch (_) {
        return {};
    }
}

/** Write the whole project-info store. */
async function writeInfo(data) {
    await fs.writeFile(PROJECT_INFO_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/project-info/:project — get project info
router.get('/:project', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    // Superadmin bypasses all ACL checks
    if (userRole !== 'superadmin') {
        const ok = await canAccessProject(userEmail, project);
        if (!ok) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const all = await readInfo();
        const info = all[project] || { description: '', fields: [] };
        res.json({ success: true, info });
    } catch (e) {
        console.error('[projectInfoRoutes] GET error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/project-info/:project — update project info
router.put('/:project', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    // Superadmin bypasses all ACL checks
    if (userRole !== 'superadmin') {
        const hasAccess = await canAccessProject(userEmail, project);
        if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied.' });

        // Check editProjectInfo authority permission
        const perms = await getEffectivePermissions(userEmail);
        const auth = perms.authority || perms.dashboard || {};
        if (!auth.editProjectInfo) {
            return res.status(403).json({ success: false, message: 'Edit Project Details permission required.' });
        }
    }

    try {
        const { description = '', fields = [] } = req.body;

        // Validate fields array
        const cleanFields = Array.isArray(fields)
            ? fields
                .filter(f => f && typeof f.label === 'string' && typeof f.value === 'string')
                .map(f => ({ label: f.label.trim(), value: f.value.trim() }))
            : [];

        const all = await readInfo();
        const existing = all[project] || {};
        // Preserve members array (managed by ACL sync in adminRoutes)
        all[project] = { description: String(description).trim(), fields: cleanFields };
        if (Array.isArray(existing.members)) {
            all[project].members = existing.members;
        }
        await writeInfo(all);

        res.json({ success: true, info: all[project] });
    } catch (e) {
        console.error('[projectInfoRoutes] PUT error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/project-info/:project/members — list users with access to this project
router.get('/:project/members', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    // Must have access to the project to see members
    if (userRole !== 'superadmin') {
        const ok = await canAccessProject(userEmail, project);
        if (!ok) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        // Determine member emails: prefer stored members array in project-info.json,
        // fall back to ACL-based lookup for backward compatibility.
        const all = await readInfo();
        const projectData = all[project] || {};
        let memberEmails;
        if (Array.isArray(projectData.members)) {
            memberEmails = projectData.members;
        } else {
            // Backward compat: compute from ACL
            memberEmails = await getProjectMembers(project);
        }

        // Load users.json to get names and avatars
        const usersFile = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');
        let users = [];
        try { users = JSON.parse(await fs.readFile(usersFile, 'utf-8')); } catch (_) {}

        // Build member list: superadmins (always) + stored/ACL members
        const members = [];
        const usedEmails = new Set();

        // Add superadmins first (they're never in the ACL/members array)
        users.filter(u => (u.role || '').toLowerCase() === 'superadmin' && u.status === 'approved').forEach(u => {
            members.push({ email: u.email, name: u.name || u.username || u.email, avatar: u.avatar || null, role: 'superadmin' });
            usedEmails.add(u.email.toLowerCase());
        });

        // Add stored/ACL members
        for (const email of memberEmails) {
            if (usedEmails.has(email.toLowerCase())) continue;
            const user = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
            members.push({
                email,
                name: user ? (user.name || user.username || user.email) : email,
                avatar: user ? (user.avatar || null) : null,
                role: user ? (user.role || 'user') : 'user',
            });
            usedEmails.add(email.toLowerCase());
        }

        res.json({ success: true, members });
    } catch (e) {
        console.error('[projectInfoRoutes] members error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
