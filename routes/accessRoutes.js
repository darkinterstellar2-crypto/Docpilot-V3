/**
 * routes/accessRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * User-facing access permission endpoints.
 * NOT admin-only — every authenticated user can query their own permissions.
 *
 * GET /api/access/my-permissions?project=X
 *   Returns which modules the current user can access for a given project.
 *   Response: { aufmass: true, files: true, druckprufung: false, ... }
 *
 * GET /api/access/permissions
 *   Returns the full effective permissions for the calling user:
 *   dashboard actions + per-project access/canEdit/modules.
 *   Superadmin returns { fullAccess: true, superadmin: true }.
 *
 * Superadmin always gets all true.
 * No ACL entry → all false (zero access by default).
 */

const express = require('express');
const router  = express.Router();

const {
    canAccessModule,
    canAccessProject,
    getEffectivePermissions,
} = require('../controllers/accessControl');

// All known module names
const ALL_MODULES = [
    'aufmass', 'files', 'druckprufung', 'kalibrieren',
    'einblasen', 'apl', 'knotenpunkt', 'otdr', 'chat', 'planner'
];

/**
 * GET /api/access/my-permissions?project=X
 * Returns module-level permissions for a specific project.
 */
router.get('/my-permissions', async (req, res) => {
    const { project } = req.query;
    if (!project) {
        return res.status(400).json({ success: false, message: 'Missing project query param.' });
    }

    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role']  || '').toLowerCase();

    // Superadmin → all true, always
    if (role === 'superadmin') {
        const perms = {};
        ALL_MODULES.forEach(m => { perms[m] = true; });
        return res.json({ success: true, permissions: perms });
    }

    try {
        // Check project access first
        const projectAllowed = await canAccessProject(email, project);

        if (!projectAllowed) {
            // No access to this project at all → all false
            const perms = {};
            ALL_MODULES.forEach(m => { perms[m] = false; });
            return res.json({ success: true, permissions: perms });
        }

        // Build per-module map
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

/**
 * GET /api/access/permissions
 * Returns the full effective permissions for the calling user.
 * Used by dashboard.js and module pages to conditionally render UI.
 *
 * Superadmin returns: { success: true, fullAccess: true, superadmin: true }
 * Regular user returns:
 * {
 *   success: true,
 *   fullAccess: false,
 *   dashboard: { createProject, deleteProject, changeStatus, reorderProjects, downloadZip },
 *   projects: { ProjectName: { canEdit: bool, modules: { ... } } }
 * }
 */
router.get('/permissions', async (req, res) => {
    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role']  || '').toLowerCase();

    // Superadmin → full access always
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
            authority: superPerms,   // new key
            dashboard: superPerms,   // backward compat alias
            projects: {}
        });
    }

    try {
        const perms = await getEffectivePermissions(email);
        // perms has { fullAccess, dashboard, projects }
        // Add authority as the canonical key; keep dashboard for backward compat
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
