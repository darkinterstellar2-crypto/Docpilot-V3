/**
 * controllers/accessControl.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ACL Engine — Granular per-user, per-project, per-module access control.
 *
 * Storage: src/DataFiles/access-control.json
 *
 * New ACL structure per user:
 * {
 *   "fullAccess": false,            ← true = read+write everything, skip all checks
 *   "dashboard": {
 *     "createProject": false,
 *     "deleteProject": false,
 *     "changeStatus": false,
 *     "reorderProjects": false,
 *     "downloadZip": false
 *   },
 *   "projects": {
 *     "ProjectName": {
 *       "access": true,             ← can they see this project?
 *       "canEdit": false,           ← can they write/edit data?
 *       "modules": {
 *         "aufmass": true,
 *         "files": true,
 *         ...
 *       }
 *     }
 *   }
 * }
 *
 * Permission hierarchy:
 *  1. superadmin role → ALWAYS full access. ACL is NEVER checked for superadmin.
 *  2. fullAccess: true → same as superadmin for ACL purposes (all checks return true)
 *  3. No ACL entry → NO access (zero access by default)
 *  4. dashboard[action] → controls dashboard actions per user
 *  5. projects[name].access → controls project visibility
 *  6. projects[name].canEdit → controls write permission within a project
 *  7. projects[name].modules[mod] → controls module visibility
 *
 * All known module names:
 *   aufmass, files, druckprufung, kalibrieren, einblasen, apl,
 *   knotenpunkt (NVT & Splicing), otdr, chat, planner
 */

const fs   = require('fs').promises;
const path = require('path');

const ACL_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'access-control.json');

// ─── File helpers ─────────────────────────────────────────────────────────────

/**
 * Simple promise-chain mutex so concurrent setUserAccess / removeUserAccess calls
 * don't race each other on the read-modify-write of access-control.json.
 */
let _writeLock = Promise.resolve();

/** Read the entire ACL file. Returns {} if missing or corrupt. */
async function readACL() {
    try {
        const raw = await fs.readFile(ACL_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

/** Write the entire ACL file atomically (within the mutex). */
async function writeACL(data) {
    await fs.mkdir(path.dirname(ACL_FILE), { recursive: true });
    await fs.writeFile(ACL_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getUserAccess(email)
 * Returns the full ACL entry for a user, or null if no entry exists.
 */
async function getUserAccess(email) {
    const acl = await readACL();
    return acl[email] || null;
}

/**
 * setUserAccess(email, accessData)
 * Saves (creates or replaces) the full ACL entry for a user.
 * Serialised through _writeLock to prevent concurrent read-modify-write races.
 */
async function setUserAccess(email, accessData) {
    _writeLock = _writeLock.then(async () => {
        const acl = await readACL();
        acl[email] = accessData;
        await writeACL(acl);
    });
    return _writeLock;
}

/**
 * removeUserAccess(email)
 * Removes all ACL restrictions for a user.
 * Serialised through _writeLock to prevent concurrent read-modify-write races.
 */
async function removeUserAccess(email) {
    _writeLock = _writeLock.then(async () => {
        const acl = await readACL();
        delete acl[email];
        await writeACL(acl);
    });
    return _writeLock;
}

/**
 * getAllAccessRules()
 * Returns the entire ACL object (for admin UI).
 */
async function getAllAccessRules() {
    return readACL();
}

/**
 * getProjectMembers(projectName)
 * Returns an array of emails that have access to the given project.
 * Includes users with fullAccess and users with explicit project access.
 * Does NOT include superadmins (they are separate).
 */
async function getProjectMembers(projectName) {
    const acl = await readACL();
    const members = [];
    for (const [email, entry] of Object.entries(acl)) {
        if (!entry) continue;
        if (entry.fullAccess === true) {
            members.push(email);
            continue;
        }
        const proj = entry.projects && entry.projects[projectName];
        if (proj && proj.access === true) {
            members.push(email);
        }
    }
    return members;
}

// ─── New Granular Permission Checks ───────────────────────────────────────────

/**
 * hasFullAccess(email)
 * Returns true if the user has fullAccess: true in their ACL entry.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 */
async function hasFullAccess(email) {
    const acl = await readACL();
    const entry = acl[email];
    if (!entry) return false;
    return entry.fullAccess === true;
}

/**
 * canDashboard(email, action)
 * Checks whether a user can perform a specific dashboard action.
 * action: 'createProject' | 'deleteProject' | 'changeStatus' | 'reorderProjects' | 'downloadZip'
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 */
async function canDashboard(email, action) {
    const acl = await readACL();
    const entry = acl[email];
    if (!entry) return false;
    // fullAccess grants all dashboard permissions
    if (entry.fullAccess === true) return true;
    // Read from authority first, fall back to dashboard (backward compat)
    const authData = entry.authority || entry.dashboard;
    return !!(authData && authData[action] === true);
}

/**
 * canEditProject(email, projectName)
 * Returns true if the user has write/edit permission for a specific project.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 * NOTE: Also check canAccessProject first.
 */
async function canEditProject(email, projectName) {
    const acl = await readACL();
    const entry = acl[email];
    if (!entry) return false;
    if (entry.fullAccess === true) return true;
    const projectEntry = entry.projects && entry.projects[projectName];
    if (!projectEntry) return false;
    if (projectEntry.access !== true) return false;
    return projectEntry.canEdit === true;
}

// ─── Existing Checks (Updated for new structure) ──────────────────────────────

/**
 * canAccessProject(email, projectName)
 * Returns true/false.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 *
 * Supports both old format (defaultProjectAccess) and new format (fullAccess / projects[].access).
 */
async function canAccessProject(email, projectName) {
    const acl = await readACL();
    const entry = acl[email];

    // No ACL entry → no access
    if (!entry) return false;

    // New format: fullAccess
    if (entry.fullAccess === true) return true;

    // New format: explicit per-project access
    if (entry.projects !== undefined) {
        const projectEntry = entry.projects[projectName];
        if (projectEntry !== undefined && projectEntry !== null) {
            return projectEntry.access === true;
        }
        // No entry for this project AND no fullAccess → no access
        // Check for legacy defaultProjectAccess fallback
        if (entry.defaultProjectAccess !== undefined) {
            return entry.defaultProjectAccess === true;
        }
        return false;
    }

    // Legacy old format: defaultProjectAccess
    if (entry.defaultProjectAccess !== undefined) {
        return entry.defaultProjectAccess === true;
    }

    return false;
}

/**
 * canAccessModule(email, projectName, moduleName)
 * Returns true/false.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 * NOTE: Also check canAccessProject first.
 */
async function canAccessModule(email, projectName, moduleName) {
    const acl = await readACL();
    const entry = acl[email];

    // No ACL entry → no access
    if (!entry) return false;

    // fullAccess → all modules accessible
    if (entry.fullAccess === true) return true;

    const projectEntry = entry.projects && entry.projects[projectName];

    // No project-level entry
    if (!projectEntry) {
        // Legacy: check defaultProjectAccess
        if (entry.defaultProjectAccess === true) return true;
        return false;
    }

    // Project not accessible at all
    if (projectEntry.access !== true) return false;

    // Project entry exists — check module
    if (projectEntry.modules && projectEntry.modules[moduleName] !== undefined) {
        return projectEntry.modules[moduleName] === true;
    }

    // No module-specific entry → allowed by default (within an accessible project)
    return true;
}

/**
 * getAccessibleProjects(email, allProjects)
 * Filters allProjects array to only those the user can access.
 * allProjects is expected to be an array of project objects with a `name` field.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 */
async function getAccessibleProjects(email, allProjects) {
    const acl = await readACL();
    const entry = acl[email];

    // No ACL entry → no access to any project
    if (!entry) return [];

    // fullAccess → all projects
    if (entry.fullAccess === true) return allProjects;

    return allProjects.filter(project => {
        const projectEntry = entry.projects && entry.projects[project.name];

        if (projectEntry !== undefined && projectEntry !== null) {
            return projectEntry.access === true;
        }

        // Legacy fallback
        if (entry.defaultProjectAccess !== undefined) {
            return entry.defaultProjectAccess === true;
        }

        return false;
    });
}

/**
 * getEffectivePermissions(email)
 * Returns the user's effective permissions object for use by the frontend.
 * NOTE: Call this AFTER confirming the user is NOT superadmin.
 *
 * Returns:
 * {
 *   fullAccess: bool,
 *   dashboard: { createProject, deleteProject, changeStatus, reorderProjects, downloadZip },
 *   projects: { ProjectName: { canEdit: bool, modules: { ... } } }
 * }
 */
async function getEffectivePermissions(email) {
    const acl = await readACL();
    const entry = acl[email];

    const defaultDashboard = {
        createProject: false,
        deleteProject: false,
        changeStatus: false,
        reorderProjects: false,
        downloadZip: false,
    };

    if (!entry) {
        return { fullAccess: false, dashboard: { ...defaultDashboard }, projects: {} };
    }

    if (entry.fullAccess === true) {
        return {
            fullAccess: true,
            dashboard: {
                createProject: true,
                deleteProject: true,
                changeStatus: true,
                reorderProjects: true,
                downloadZip: true,
                editProjectInfo: true,
            },
            projects: {}
        };
    }

    // Build dashboard/authority permissions (read from 'authority' first, fall back to 'dashboard')
    const authEntry = entry.authority || entry.dashboard || {};
    const dashboard = {
        createProject:   !!(authEntry.createProject),
        deleteProject:   !!(authEntry.deleteProject),
        changeStatus:    !!(authEntry.changeStatus),
        reorderProjects: !!(authEntry.reorderProjects),
        downloadZip:     !!(authEntry.downloadZip),
        editProjectInfo: !!(authEntry.editProjectInfo),
    };

    // Build project permissions (only access + canEdit + modules — no need for access:false ones)
    const projects = {};
    if (entry.projects) {
        for (const [pName, pData] of Object.entries(entry.projects)) {
            if (pData && pData.access === true) {
                projects[pName] = {
                    canEdit:  pData.canEdit === true,
                    modules:  pData.modules || {}
                };
            }
        }
    }

    return { fullAccess: false, dashboard, projects };
}

module.exports = {
    getUserAccess,
    setUserAccess,
    removeUserAccess,
    getAllAccessRules,
    getProjectMembers,
    // New granular checks
    hasFullAccess,
    canDashboard,
    canEditProject,
    getEffectivePermissions,
    // Existing checks (updated)
    canAccessProject,
    canAccessModule,
    getAccessibleProjects,
};
