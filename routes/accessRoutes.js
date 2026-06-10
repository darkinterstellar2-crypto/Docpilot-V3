// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// accessControl.js is now PostgreSQL-backed — no other changes needed here.
// Same API response format preserved.

/**
 * routes/accessRoutes.js
 * User-facing access permission endpoints.
 *
 * GET /api/access/my-permissions?project=X  — module permissions for a project
 * GET /api/access/permissions               — full effective permissions
 */

const express = require('express');
const router  = express.Router();

const {
    canAccessModule,
    canAccessProject,
    getEffectivePermissions,
} = require('../controllers/accessControl');

const ALL_MODULES = [
    'aufmass', 'files', 'druckprufung', 'kalibrieren',
    'einblasen', 'apl', 'knotenpunkt', 'otdr', 'chat', 'planner'
];

router.get('/my-permissions', async (req, res) => {
    const { project } = req.query;
    if (!project) {
        return res.status(400).json({ success: false, message: 'Missing project query param.' });
    }

    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role']  || '').toLowerCase();

    if (role === 'superadmin') {
        const perms = {};
        ALL_MODULES.forEach(m => { perms[m] = true; });
        return res.json({ success: true, permissions: perms });
    }

    try {
        const projectAllowed = await canAccessProject(email, project);

        if (!projectAllowed) {
            const perms = {};
            ALL_MODULES.forEach(m => { perms[m] = false; });
            return res.json({ success: true, permissions: perms });
        }

        const perms = {};
        await Promise.all(
            ALL_MODULES.map(async (mod) => {
                perms[mod] = await canAccessModule(email, project, mod);
            })
        );

        res.json({ success: true, permissions: perms });
    } catch (e) {
        console.error('[accessRoutes] my-permissions error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch permissions.' });
    }
});

router.get('/permissions', async (req, res) => {
    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role']  || '').toLowerCase();

    if (role === 'superadmin') {
        const superPerms = {
            createProject: true,
            deleteProject: true,
            changeStatus: true,
            reorderProjects: true,
            downloadZip: true,
            editProjectInfo: true,
        };
        return res.json({
            success: true,
            fullAccess: true,
            superadmin: true,
            authority: superPerms,
            dashboard: superPerms,
            projects: {}
        });
    }

    try {
        const perms = await getEffectivePermissions(email);
        const response = { success: true, ...perms };
        if (perms.dashboard && !perms.authority) {
            response.authority = perms.dashboard;
        }
        res.json(response);
    } catch (e) {
        console.error('[accessRoutes] permissions error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch permissions.' });
    }
});

module.exports = router;
