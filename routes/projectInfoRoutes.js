// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// project_info table: id, tenant_id, project_id, description
// project_info_fields table: id, tenant_id, project_info_id, label, value, sort_order
// Members derived from access_control_projects JOIN users

const express = require('express');
const router = express.Router();
const db = require('../controllers/db');
const { canAccessProject, canEditProject, getEffectivePermissions, getProjectMembers } = require('../controllers/accessControl');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

async function getProjectId(name) {
    const r = await db.query(
        'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
        [TENANT_ID, name]
    );
    return r.rows[0]?.id || null;
}

// GET /api/project-info/:project
router.get('/:project', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    if (userRole !== 'superadmin') {
        const ok = await canAccessProject(userEmail, project);
        if (!ok) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const projectId = await getProjectId(project);
        if (!projectId) {
            return res.json({ success: true, info: { description: '', fields: [] } });
        }

        const infoR = await db.query(
            `SELECT id, description FROM project_info WHERE tenant_id = $1 AND project_id = $2`,
            [TENANT_ID, projectId]
        );

        if (!infoR.rows[0]) {
            return res.json({ success: true, info: { description: '', fields: [] } });
        }

        const infoId = infoR.rows[0].id;
        const description = infoR.rows[0].description || '';

        const fieldsR = await db.query(
            `SELECT label, value FROM project_info_fields
             WHERE tenant_id = $1 AND project_info_id = $2
             ORDER BY sort_order ASC`,
            [TENANT_ID, infoId]
        );

        const fields = fieldsR.rows.map(f => ({ label: f.label, value: f.value }));

        res.json({ success: true, info: { description, fields } });
    } catch (e) {
        console.error('[projectInfoRoutes] GET error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// PUT /api/project-info/:project
router.put('/:project', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    if (userRole !== 'superadmin') {
        const hasAccess = await canAccessProject(userEmail, project);
        if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied.' });

        const perms = await getEffectivePermissions(userEmail);
        const auth = perms.authority || perms.dashboard || {};
        if (!auth.editProjectInfo) {
            return res.status(403).json({ success: false, message: 'Edit Project Details permission required.' });
        }
    }

    try {
        const { description = '', fields = [] } = req.body;

        const cleanFields = Array.isArray(fields)
            ? fields
                .filter(f => f && typeof f.label === 'string' && typeof f.value === 'string')
                .map(f => ({ label: f.label.trim(), value: f.value.trim() }))
            : [];

        const projectId = await getProjectId(project);
        if (!projectId) {
            return res.status(404).json({ success: false, message: 'Project not found.' });
        }

        await db.transaction(async (client) => {
            // Upsert project_info
            const infoR = await client.query(
                `INSERT INTO project_info (tenant_id, project_id, description)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (project_id) DO UPDATE SET description = EXCLUDED.description, updated_at = NOW()
                 RETURNING id`,
                [TENANT_ID, projectId, String(description).trim()]
            );
            const infoId = infoR.rows[0].id;

            // Replace all fields
            await client.query(
                'DELETE FROM project_info_fields WHERE tenant_id = $1 AND project_info_id = $2',
                [TENANT_ID, infoId]
            );
            for (let i = 0; i < cleanFields.length; i++) {
                await client.query(
                    `INSERT INTO project_info_fields (tenant_id, project_info_id, label, value, sort_order)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [TENANT_ID, infoId, cleanFields[i].label, cleanFields[i].value, i]
                );
            }
        });

        res.json({ success: true, info: { description: String(description).trim(), fields: cleanFields } });
    } catch (e) {
        console.error('[projectInfoRoutes] PUT error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// GET /api/project-info/:project/members
router.get('/:project/members', async (req, res) => {
    const { project } = req.params;
    const userEmail = req.headers['x-user-email'] || '';
    const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

    if (userRole !== 'superadmin') {
        const ok = await canAccessProject(userEmail, project);
        if (!ok) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        // Get member emails from ACL
        const memberEmails = await getProjectMembers(project);

        // Get user details for member emails + superadmins
        const superR = await db.query(
            `SELECT email, name, username, avatar_url AS avatar, role
             FROM users WHERE role = 'superadmin'`
        );

        const members = [];
        const usedEmails = new Set();

        // Superadmins first
        for (const u of superR.rows) {
            members.push({ email: u.email, name: u.name || u.username || u.email, avatar: u.avatar || null, role: 'superadmin' });
            usedEmails.add(u.email.toLowerCase());
        }

        // ACL-based members
        if (memberEmails.length > 0) {
            const userR = await db.query(
                `SELECT email, name, username, avatar_url AS avatar, role
                 FROM users WHERE LOWER(email) = ANY($1)`,
                [memberEmails.map(e => e.toLowerCase())]
            );
            const userMap = {};
            for (const u of userR.rows) {
                userMap[u.email.toLowerCase()] = u;
            }

            for (const email of memberEmails) {
                if (usedEmails.has(email.toLowerCase())) continue;
                const u = userMap[email.toLowerCase()];
                members.push({
                    email,
                    name:   u ? (u.name || u.username || u.email) : email,
                    avatar: u ? (u.avatar || null) : null,
                    role:   u ? (u.role || 'user') : 'user'
                });
                usedEmails.add(email.toLowerCase());
            }
        }

        res.json({ success: true, members });
    } catch (e) {
        console.error('[projectInfoRoutes] members error:', e.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
