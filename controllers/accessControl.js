// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// ACL tables:
//   access_control        — one row per user per tenant (global flags + dashboard perms)
//   access_control_projects — one row per user per project (access, canEdit, modules JSONB)
//
// Public API preserved exactly — same exported function signatures.
// V2 used email as key; V3 uses UUID internally but still accepts email from callers.

const db = require('./db');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Resolve user UUID from email. Returns null if not found. */
async function getUserId(email) {
    if (!email) return null;
    try {
        const r = await db.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
        );
        return r.rows[0]?.id || null;
    } catch (e) {
        console.error('[accessControl] getUserId error:', e.message);
        return null;
    }
}

/** Resolve project UUID from name. Returns null if not found. */
async function getProjectId(projectName) {
    if (!projectName) return null;
    try {
        const r = await db.query(
            'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
            [TENANT_ID, projectName]
        );
        return r.rows[0]?.id || null;
    } catch (e) {
        console.error('[accessControl] getProjectId error:', e.message);
        return null;
    }
}

/** Get the access_control row for a user. Returns null if not found. */
async function getACLRow(userId) {
    if (!userId) return null;
    try {
        const r = await db.query(
            `SELECT * FROM access_control
             WHERE tenant_id = $1 AND user_id = $2`,
            [TENANT_ID, userId]
        );
        return r.rows[0] || null;
    } catch (e) {
        console.error('[accessControl] getACLRow error:', e.message);
        return null;
    }
}

/** Get all access_control_projects rows for an access_control row. */
async function getACLProjects(aclId) {
    if (!aclId) return [];
    try {
        const r = await db.query(
            `SELECT acp.*, p.name AS project_name
             FROM access_control_projects acp
             JOIN projects p ON p.id = acp.project_id
             WHERE acp.access_control_id = $1 AND acp.tenant_id = $2`,
            [aclId, TENANT_ID]
        );
        return r.rows;
    } catch (e) {
        console.error('[accessControl] getACLProjects error:', e.message);
        return [];
    }
}

/** Build the V2-compatible access object shape from DB rows. */
function buildAccessData(aclRow, aclProjects) {
    if (!aclRow) return null;

    const projects = {};
    for (const p of aclProjects) {
        projects[p.project_name] = {
            access:  p.can_access === true,
            canEdit: p.can_edit   === true,
            modules: typeof p.modules === 'object' ? p.modules : {}
        };
    }

    return {
        fullAccess: aclRow.full_access === true,
        authority: {
            createProject:   aclRow.can_create_project   === true,
            deleteProject:   aclRow.can_delete_project   === true,
            changeStatus:    aclRow.can_change_status     === true,
            reorderProjects: aclRow.can_reorder_projects  === true,
            downloadZip:     aclRow.can_download_zip      === true,
            editProjectInfo: aclRow.can_edit_project_info === true,
        },
        // backward-compat alias
        dashboard: {
            createProject:   aclRow.can_create_project   === true,
            deleteProject:   aclRow.can_delete_project   === true,
            changeStatus:    aclRow.can_change_status     === true,
            reorderProjects: aclRow.can_reorder_projects  === true,
            downloadZip:     aclRow.can_download_zip      === true,
            editProjectInfo: aclRow.can_edit_project_info === true,
        },
        projects
    };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * getUserAccess(email)
 * Returns the full V2-compatible ACL object for a user, or null if no entry.
 */
async function getUserAccess(email) {
    const userId = await getUserId(email);
    if (!userId) return null;

    const aclRow = await getACLRow(userId);
    if (!aclRow) return null;

    const aclProjects = await getACLProjects(aclRow.id);
    return buildAccessData(aclRow, aclProjects);
}

/**
 * setUserAccess(email, accessData)
 * Creates or replaces the full ACL entry for a user.
 * accessData shape (V2 format):
 * {
 *   fullAccess: bool,
 *   dashboard: { createProject, deleteProject, changeStatus, reorderProjects, downloadZip, editProjectInfo },
 *   projects: { ProjectName: { access, canEdit, modules: {...} } }
 * }
 */
async function setUserAccess(email, accessData) {
    const userId = await getUserId(email);
    if (!userId) {
        console.error(`[accessControl] setUserAccess: user not found for email ${email}`);
        return;
    }

    const auth = accessData.authority || accessData.dashboard || {};

    await db.transaction(async (client) => {
        // Upsert access_control row
        const upsertResult = await client.query(
            `INSERT INTO access_control
                (tenant_id, user_id, full_access,
                 can_create_project, can_delete_project, can_change_status,
                 can_reorder_projects, can_download_zip, can_edit_project_info)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                full_access           = EXCLUDED.full_access,
                can_create_project    = EXCLUDED.can_create_project,
                can_delete_project    = EXCLUDED.can_delete_project,
                can_change_status     = EXCLUDED.can_change_status,
                can_reorder_projects  = EXCLUDED.can_reorder_projects,
                can_download_zip      = EXCLUDED.can_download_zip,
                can_edit_project_info = EXCLUDED.can_edit_project_info,
                updated_at            = NOW()
             RETURNING id`,
            [
                TENANT_ID, userId,
                accessData.fullAccess === true,
                !!(auth.createProject),
                !!(auth.deleteProject),
                !!(auth.changeStatus),
                !!(auth.reorderProjects),
                !!(auth.downloadZip),
                !!(auth.editProjectInfo)
            ]
        );

        const aclId = upsertResult.rows[0].id;

        // Delete old project entries for this ACL
        await client.query(
            'DELETE FROM access_control_projects WHERE access_control_id = $1',
            [aclId]
        );

        // Insert new project entries
        const projects = accessData.projects || {};
        for (const [projectName, pData] of Object.entries(projects)) {
            const projectId = await getProjectId(projectName);
            if (!projectId) {
                console.warn(`[accessControl] setUserAccess: project not found: ${projectName}`);
                continue;
            }
            await client.query(
                `INSERT INTO access_control_projects
                    (tenant_id, access_control_id, project_id, can_access, can_edit, modules)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    TENANT_ID, aclId, projectId,
                    pData.access  === true,
                    pData.canEdit === true,
                    JSON.stringify(pData.modules || {})
                ]
            );
        }
    });
}

/**
 * removeUserAccess(email)
 * Removes all ACL entries for a user (returns them to zero access).
 */
async function removeUserAccess(email) {
    const userId = await getUserId(email);
    if (!userId) return;

    // Cascading delete: access_control_projects deleted via FK cascade
    await db.query(
        'DELETE FROM access_control WHERE tenant_id = $1 AND user_id = $2',
        [TENANT_ID, userId]
    );
}

/**
 * getAllAccessRules()
 * Returns all ACL rules as a V2-compatible { email: accessData } map.
 */
async function getAllAccessRules() {
    try {
        // Get all access_control rows with user emails
        const aclRows = await db.query(
            `SELECT ac.*, u.email
             FROM access_control ac
             JOIN users u ON u.id = ac.user_id
             WHERE ac.tenant_id = $1`,
            [TENANT_ID]
        );

        const result = {};

        for (const aclRow of aclRows.rows) {
            const aclProjects = await getACLProjects(aclRow.id);
            result[aclRow.email] = buildAccessData(aclRow, aclProjects);
        }

        return result;
    } catch (e) {
        console.error('[accessControl] getAllAccessRules error:', e.message);
        return {};
    }
}

/**
 * getProjectMembers(projectName)
 * Returns emails of users who have access to a project.
 */
async function getProjectMembers(projectName) {
    try {
        const projectId = await getProjectId(projectName);
        if (!projectId) return [];

        const r = await db.query(
            `SELECT u.email
             FROM access_control_projects acp
             JOIN access_control ac ON ac.id = acp.access_control_id
             JOIN users u ON u.id = ac.user_id
             WHERE acp.project_id = $1
               AND acp.tenant_id = $2
               AND (acp.can_access = true OR ac.full_access = true)`,
            [projectId, TENANT_ID]
        );
        return r.rows.map(r => r.email);
    } catch (e) {
        console.error('[accessControl] getProjectMembers error:', e.message);
        return [];
    }
}

// ─── Granular Permission Checks ────────────────────────────────────────────────

async function hasFullAccess(email) {
    const userId = await getUserId(email);
    if (!userId) return false;
    const aclRow = await getACLRow(userId);
    if (!aclRow) return false;
    return aclRow.full_access === true;
}

async function canDashboard(email, action) {
    const userId = await getUserId(email);
    if (!userId) return false;
    const aclRow = await getACLRow(userId);
    if (!aclRow) return false;
    if (aclRow.full_access === true) return true;

    const colMap = {
        createProject:   'can_create_project',
        deleteProject:   'can_delete_project',
        changeStatus:    'can_change_status',
        reorderProjects: 'can_reorder_projects',
        downloadZip:     'can_download_zip',
        editProjectInfo: 'can_edit_project_info',
    };
    const col = colMap[action];
    return col ? aclRow[col] === true : false;
}

async function canEditProject(email, projectName) {
    const userId    = await getUserId(email);
    if (!userId) return false;
    const aclRow    = await getACLRow(userId);
    if (!aclRow) return false;
    if (aclRow.full_access === true) return true;

    const projectId = await getProjectId(projectName);
    if (!projectId) return false;

    const r = await db.query(
        `SELECT can_access, can_edit
         FROM access_control_projects
         WHERE access_control_id = $1 AND project_id = $2`,
        [aclRow.id, projectId]
    );
    const p = r.rows[0];
    if (!p || !p.can_access) return false;
    return p.can_edit === true;
}

async function canAccessProject(email, projectName) {
    const userId = await getUserId(email);
    if (!userId) return false;
    const aclRow = await getACLRow(userId);
    if (!aclRow) return false;
    if (aclRow.full_access === true) return true;

    const projectId = await getProjectId(projectName);
    if (!projectId) return false;

    const r = await db.query(
        `SELECT can_access
         FROM access_control_projects
         WHERE access_control_id = $1 AND project_id = $2`,
        [aclRow.id, projectId]
    );
    return r.rows[0]?.can_access === true;
}

async function canAccessModule(email, projectName, moduleName) {
    const userId = await getUserId(email);
    if (!userId) return false;
    const aclRow = await getACLRow(userId);
    if (!aclRow) return false;
    if (aclRow.full_access === true) return true;

    const projectId = await getProjectId(projectName);
    if (!projectId) return false;

    const r = await db.query(
        `SELECT can_access, modules
         FROM access_control_projects
         WHERE access_control_id = $1 AND project_id = $2`,
        [aclRow.id, projectId]
    );
    const p = r.rows[0];
    if (!p || !p.can_access) return false;

    const modules = typeof p.modules === 'object' ? p.modules : {};
    if (modules[moduleName] !== undefined) {
        return modules[moduleName] === true;
    }
    // No module-specific entry → allowed by default within accessible project
    return true;
}

/**
 * getAccessibleProjects(email, allProjects)
 * Filters allProjects[] to only those the user can access.
 */
async function getAccessibleProjects(email, allProjects) {
    if (!allProjects || allProjects.length === 0) return [];

    const userId = await getUserId(email);
    if (!userId) return [];
    const aclRow = await getACLRow(userId);
    if (!aclRow) return [];
    if (aclRow.full_access === true) return allProjects;

    // Get list of accessible project names
    const r = await db.query(
        `SELECT p.name
         FROM access_control_projects acp
         JOIN projects p ON p.id = acp.project_id
         WHERE acp.access_control_id = $1
           AND acp.can_access = true
           AND acp.tenant_id = $2`,
        [aclRow.id, TENANT_ID]
    );
    const accessibleNames = new Set(r.rows.map(row => row.name.toLowerCase()));

    return allProjects.filter(p => accessibleNames.has((p.name || '').toLowerCase()));
}

/**
 * getEffectivePermissions(email)
 * Returns V2-compatible permissions object for the frontend.
 */
async function getEffectivePermissions(email) {
    const defaultDashboard = {
        createProject:   false,
        deleteProject:   false,
        changeStatus:    false,
        reorderProjects: false,
        downloadZip:     false,
        editProjectInfo: false,
    };

    const userId = await getUserId(email);
    if (!userId) {
        return { fullAccess: false, dashboard: { ...defaultDashboard }, projects: {} };
    }

    const aclRow = await getACLRow(userId);
    if (!aclRow) {
        return { fullAccess: false, dashboard: { ...defaultDashboard }, projects: {} };
    }

    if (aclRow.full_access === true) {
        const fullDash = Object.fromEntries(Object.keys(defaultDashboard).map(k => [k, true]));
        return { fullAccess: true, dashboard: fullDash, authority: fullDash, projects: {} };
    }

    const dashboard = {
        createProject:   aclRow.can_create_project   === true,
        deleteProject:   aclRow.can_delete_project   === true,
        changeStatus:    aclRow.can_change_status     === true,
        reorderProjects: aclRow.can_reorder_projects  === true,
        downloadZip:     aclRow.can_download_zip      === true,
        editProjectInfo: aclRow.can_edit_project_info === true,
    };

    const aclProjectRows = await getACLProjects(aclRow.id);
    const projects = {};
    for (const p of aclProjectRows) {
        if (p.can_access === true) {
            projects[p.project_name] = {
                canEdit:  p.can_edit === true,
                modules:  typeof p.modules === 'object' ? p.modules : {}
            };
        }
    }

    return { fullAccess: false, dashboard, authority: dashboard, projects };
}

module.exports = {
    getUserAccess,
    setUserAccess,
    removeUserAccess,
    getAllAccessRules,
    getProjectMembers,
    hasFullAccess,
    canDashboard,
    canEditProject,
    getEffectivePermissions,
    canAccessProject,
    canAccessModule,
    getAccessibleProjects,
};
