// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// projects table: id, tenant_id, name, status, sort_order, created_by, created_at
// project_clusters table: id, tenant_id, project_id, name, sort_order
// project_knotenpunkte table: id, tenant_id, project_id, cluster_id, name
// project_info table: id, tenant_id, project_id, description
// project_info_fields table: id, tenant_id, project_info_id, label, value, sort_order

const express = require('express');
const router = express.Router();
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../controllers/db');
const { createProjectStructure } = require('../controllers/projectCreator');
const { logAction } = require('../controllers/logger');
const { syncClusterFolders, syncKnotenpunktFolders, getExistingClusters, getExistingKnotenpunkte, getClustersFromDataFile, getKnotenpunkteFromDataFile } = require('../controllers/folderSync');

const { STORAGE_ROOT, getProjectRoot } = require('../controllers/storageConfig');
const { getAccessibleProjects, canDashboard } = require('../controllers/accessControl');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserId(email) {
    if (!email) return null;
    const r = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return r.rows[0]?.id || null;
}

/** Get all projects for this tenant as array of { id, name, status, sort_order, locations } */
async function getProjectsWithClusters() {
    const r = await db.query(
        `SELECT p.id, p.name, p.status, p.sort_order
         FROM projects p
         WHERE p.tenant_id = $1
         ORDER BY p.sort_order ASC, p.created_at ASC`,
        [TENANT_ID]
    );
    const projects = r.rows;

    if (projects.length === 0) return [];

    // Load clusters for all projects
    const projectIds = projects.map(p => p.id);
    const clusters = await db.query(
        `SELECT project_id, name FROM project_clusters
         WHERE tenant_id = $1 AND project_id = ANY($2)
         ORDER BY sort_order ASC`,
        [TENANT_ID, projectIds]
    );

    const clusterMap = {};
    for (const c of clusters.rows) {
        if (!clusterMap[c.project_id]) clusterMap[c.project_id] = [];
        clusterMap[c.project_id].push(c.name);
    }

    return projects.map(p => ({
        name:      p.name,
        status:    p.status,
        locations: clusterMap[p.id] || []
    }));
}

/** Get project UUID by name. */
async function getProjectId(name) {
    const r = await db.query(
        'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
        [TENANT_ID, name]
    );
    return r.rows[0]?.id || null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {
        const userEmail = req.headers['x-user-email'] || '';
        const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

        const projects = await getProjectsWithClusters();

        if (userRole === 'superadmin') {
            return res.json({ success: true, projects });
        }

        const accessible = await getAccessibleProjects(userEmail, projects);
        res.json({ success: true, projects: accessible });
    } catch (e) {
        console.error('[projectRoutes] GET / error:', e.message);
        res.json({ success: true, projects: [] });
    }
});

router.post('/create', async (req, res) => {
    const { projectName, locations, schema, structure, description, fields } = req.body;
    if (!projectName || !locations || locations.length === 0 || !schema) {
        return res.status(400).json({ success: false, message: "Missing required details." });
    }

    const createRole  = (req.headers['x-user-role']  || '').toLowerCase();
    const createEmail = req.headers['x-user-email'] || '';

    if (createRole !== 'superadmin') {
        const allowed = await canDashboard(createEmail, 'createProject');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Create Project permission required' });
    }

    try {
        // Check for duplicate project name
        const existing = await db.query(
            `SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)`,
            [TENANT_ID, projectName]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: `Project "${projectName}" already exists.` });
        }

        // Create filesystem folder structure (unchanged)
        const result = await createProjectStructure(projectName, locations, schema, structure);
        if (!result.success) {
            return res.status(500).json({ success: false, message: "Failed to create folder structure." });
        }

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        const userId    = await getUserId(userEmail);

        // Get current max sort_order
        const sortR = await db.query(
            'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM projects WHERE tenant_id = $1',
            [TENANT_ID]
        );
        const newSortOrder = (sortR.rows[0]?.max_sort || -1) + 1;

        // Insert project
        const projR = await db.query(
            `INSERT INTO projects (tenant_id, name, status, sort_order, created_by, created_at)
             VALUES ($1, $2, 'active', $3, $4, NOW())
             RETURNING id`,
            [TENANT_ID, projectName, newSortOrder, userId]
        );
        const projectId = projR.rows[0].id;

        // Insert clusters (locations)
        for (let i = 0; i < locations.length; i++) {
            await db.query(
                `INSERT INTO project_clusters (tenant_id, project_id, name, sort_order)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [TENANT_ID, projectId, locations[i], i]
            );
        }

        // Insert project info if provided
        if (description || (Array.isArray(fields) && fields.length > 0)) {
            const cleanFields = Array.isArray(fields)
                ? fields.filter(f => f && typeof f.label === 'string').map(f => ({ label: f.label.trim(), value: (f.value || '').trim() }))
                : [];

            const infoR = await db.query(
                `INSERT INTO project_info (tenant_id, project_id, description)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [TENANT_ID, projectId, String(description || '').trim()]
            );
            const infoId = infoR.rows[0].id;

            for (let i = 0; i < cleanFields.length; i++) {
                await db.query(
                    `INSERT INTO project_info_fields (tenant_id, project_info_id, label, value, sort_order)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [TENANT_ID, infoId, cleanFields[i].label, cleanFields[i].value, i]
                );
            }
        }

        await logAction(userEmail, 'Project Created', `New project "${projectName}" created with ${locations.length} location(s)`);
        res.json({ success: true });
    } catch (e) {
        console.error('[projectRoutes] create error:', e.message);
        res.status(500).json({ success: false, message: "Failed to create project." });
    }
});

router.post('/status', async (req, res) => {
    const statusRole  = (req.headers['x-user-role']  || '').toLowerCase();
    const statusEmail = req.headers['x-user-email'] || '';

    if (statusRole !== 'superadmin') {
        const allowed = await canDashboard(statusEmail, 'changeStatus');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Change Status permission required' });
    }

    try {
        const { projectName, newStatus } = req.body;
        const result = await db.query(
            `UPDATE projects SET status = $1, updated_at = NOW()
             WHERE tenant_id = $2 AND LOWER(name) = LOWER($3)
             RETURNING id`,
            [newStatus, TENANT_ID, projectName]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false });
        res.json({ success: true });
    } catch (e) {
        console.error('[projectRoutes] status error:', e.message);
        res.status(500).json({ success: false });
    }
});

router.post('/reorder', async (req, res) => {
    const reorderRole  = (req.headers['x-user-role']  || '').toLowerCase();
    const reorderEmail = req.headers['x-user-email'] || '';

    if (reorderRole !== 'superadmin') {
        const allowed = await canDashboard(reorderEmail, 'reorderProjects');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Reorder Projects permission required' });
    }

    try {
        const { projectName, direction } = req.body;

        // Get all projects ordered
        const r = await db.query(
            `SELECT id, name, sort_order FROM projects WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC`,
            [TENANT_ID]
        );
        const projects = r.rows;
        const index = projects.findIndex(p => p.name === projectName);

        if (index === -1) return res.status(400).json({ success: false });

        let swapIndex = -1;
        if (direction === 'left' && index > 0) swapIndex = index - 1;
        else if (direction === 'right' && index < projects.length - 1) swapIndex = index + 1;

        if (swapIndex === -1) return res.json({ success: true });

        // Swap sort_orders
        const aId = projects[index].id;
        const bId = projects[swapIndex].id;
        const aSort = projects[index].sort_order;
        const bSort = projects[swapIndex].sort_order;

        await db.query('UPDATE projects SET sort_order = $1 WHERE id = $2', [bSort, aId]);
        await db.query('UPDATE projects SET sort_order = $1 WHERE id = $2', [aSort, bId]);

        res.json({ success: true });
    } catch (e) {
        console.error('[projectRoutes] reorder error:', e.message);
        res.status(500).json({ success: false });
    }
});

router.post('/remove', async (req, res) => {
    const removeRole  = (req.headers['x-user-role']  || '').toLowerCase();
    const removeEmail = req.headers['x-user-email'] || '';

    if (removeRole !== 'superadmin') {
        const allowed = await canDashboard(removeEmail, 'deleteProject');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Delete Project permission required' });
    }

    try {
        const { projectName } = req.body;

        // Delete from DB (cascades to clusters, knotenpunkte, info, aufmass_rows, etc.)
        await db.query(
            'DELETE FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
            [TENANT_ID, projectName]
        );

        // Physical removal
        const projectPath = getProjectRoot(projectName);
        try {
            if (fsSync.existsSync(projectPath)) {
                fsSync.rmSync(projectPath, { recursive: true, force: true });
            }
        } catch (err) {
            console.log("Could not physically wipe folder, but removed from DB:", err.message);
        }

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Project Deleted', `Deleted project "${projectName}"`);
        res.json({ success: true });
    } catch (e) {
        console.error('[projectRoutes] remove error:', e.message);
        res.status(500).json({ success: false, message: "Database error." });
    }
});

router.get('/zip/:projectName', async (req, res) => {
    const projectName = req.params.projectName;
    const zipRole  = (req.headers['x-user-role']  || '').toLowerCase();
    const zipEmail = req.headers['x-user-email'] || '';

    if (zipRole !== 'superadmin') {
        const { canAccessProject, canDashboard: _canDash } = require('../controllers/accessControl');
        const [zipOk, accessOk] = await Promise.all([
            _canDash(zipEmail, 'downloadZip'),
            canAccessProject(zipEmail, projectName)
        ]);
        if (!zipOk) return res.status(403).json({ success: false, message: 'Permission denied: cannot download ZIP' });
        if (!accessOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible' });
    }

    const projectPath = getProjectRoot(projectName);

    const { syncProjectFromNAS, isEnabled: nasEnabled } = require('../controllers/nasSync');
    if (nasEnabled()) {
        try {
            const syncResult = await Promise.race([
                syncProjectFromNAS(projectName),
                new Promise(resolve => setTimeout(() => resolve({ synced: false, reason: 'timeout' }), 60000))
            ]);
            if (syncResult.synced) {
                console.log(`[zip] NAS sync complete for "${projectName}"`);
            } else {
                console.warn(`[zip] NAS sync skipped: ${syncResult.reason} — zipping local files only`);
            }
        } catch (err) {
            console.error(`[zip] NAS sync error for "${projectName}":`, err.message);
        }
    }

    if (!fsSync.existsSync(projectPath)) return res.status(404).send("Directory not found.");

    res.attachment(`${projectName}_Backup.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.directory(projectPath, false);
    archive.finalize();
});

// --- CLUSTER ENDPOINTS ---

router.get('/:projectName/clusters', async (req, res) => {
    try {
        const { projectName } = req.params;

        // Source 1: clusters from actual data file
        const dataFileClusters = await getClustersFromDataFile(projectName);

        // Source 2: clusters from project_clusters table
        const projectId = await getProjectId(projectName);
        let dbClusters = [];
        if (projectId) {
            const r = await db.query(
                `SELECT name FROM project_clusters WHERE tenant_id = $1 AND project_id = $2 ORDER BY sort_order`,
                [TENANT_ID, projectId]
            );
            dbClusters = r.rows.map(r => r.name);
        }

        // Source 3: clusters from filesystem
        const fsClusters = await getExistingClusters(projectName);

        const seen = new Set();
        const allClusters = [];
        for (const c of [...dataFileClusters, ...dbClusters, ...fsClusters]) {
            if (c && !seen.has(c)) { seen.add(c); allClusters.push(c); }
        }

        res.json({ success: true, clusters: allClusters });
    } catch (e) {
        console.error('[projectRoutes] clusters GET error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/:projectName/clusters', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Cluster name required.' });

        const clusterName = name.trim();
        const projectId = await getProjectId(projectName);
        if (!projectId) return res.status(404).json({ success: false, message: 'Project not found.' });

        // Get current max sort_order for clusters in this project
        const sortR = await db.query(
            'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM project_clusters WHERE tenant_id = $1 AND project_id = $2',
            [TENANT_ID, projectId]
        );
        const newSort = (sortR.rows[0]?.max_sort || -1) + 1;

        await db.query(
            `INSERT INTO project_clusters (tenant_id, project_id, name, sort_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, project_id, LOWER(name)) DO NOTHING`,
            [TENANT_ID, projectId, clusterName, newSort]
        );

        // Create folder structure
        await syncClusterFolders(projectName, clusterName);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Cluster Created', `Added cluster "${clusterName}" to project "${projectName}"`);

        // Return updated cluster list
        const dataFileClusters = await getClustersFromDataFile(projectName);
        const r = await db.query(
            `SELECT name FROM project_clusters WHERE tenant_id = $1 AND project_id = $2 ORDER BY sort_order`,
            [TENANT_ID, projectId]
        );
        const dbClusters = r.rows.map(r => r.name);
        const fsClusters = await getExistingClusters(projectName);

        const seen = new Set();
        const allClusters = [];
        for (const c of [...dataFileClusters, ...dbClusters, ...fsClusters]) {
            if (c && !seen.has(c)) { seen.add(c); allClusters.push(c); }
        }

        res.json({ success: true, cluster: clusterName, clusters: allClusters });
    } catch (e) {
        console.error('[projectRoutes] clusters POST error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/:projectName/knotenpunkte', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { cluster } = req.query;
        if (!cluster) return res.status(400).json({ success: false, message: 'cluster query param required.' });

        // Source 1: from data file
        const dataFileKnoten = await getKnotenpunkteFromDataFile(projectName, cluster);

        // Source 2: from DB
        const projectId = await getProjectId(projectName);
        let dbKnoten = [];
        if (projectId) {
            const r = await db.query(
                `SELECT pk.name
                 FROM project_knotenpunkte pk
                 JOIN project_clusters pc ON pc.id = pk.cluster_id
                 WHERE pk.tenant_id = $1 AND pk.project_id = $2 AND LOWER(pc.name) = LOWER($3)`,
                [TENANT_ID, projectId, cluster]
            );
            dbKnoten = r.rows.map(r => r.name);
        }

        // Source 3: from filesystem
        const fsKnoten = await getExistingKnotenpunkte(projectName, cluster);

        const seen = new Set();
        const allKnoten = [];
        for (const k of [...dataFileKnoten, ...dbKnoten, ...fsKnoten]) {
            if (k && !seen.has(k)) { seen.add(k); allKnoten.push(k); }
        }

        res.json({ success: true, knotenpunkte: allKnoten });
    } catch (e) {
        console.error('[projectRoutes] knotenpunkte GET error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/:projectName/knotenpunkte', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { cluster, name } = req.body;
        if (!cluster || !name) return res.status(400).json({ success: false, message: 'cluster and name required.' });

        const clusterTrimmed = cluster.trim();
        const nameTrimmed = name.trim();

        // Persist to DB
        const projectId = await getProjectId(projectName);
        if (projectId) {
            const clusterR = await db.query(
                `SELECT id FROM project_clusters WHERE tenant_id = $1 AND project_id = $2 AND LOWER(name) = LOWER($3)`,
                [TENANT_ID, projectId, clusterTrimmed]
            );
            const clusterId = clusterR.rows[0]?.id;
            if (clusterId) {
                await db.query(
                    `INSERT INTO project_knotenpunkte (tenant_id, project_id, cluster_id, name)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tenant_id, project_id, cluster_id, LOWER(name)) DO NOTHING`,
                    [TENANT_ID, projectId, clusterId, nameTrimmed]
                );
            }
        }

        await syncKnotenpunktFolders(projectName, clusterTrimmed, nameTrimmed);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Knotenpunkt Created', `Added Knotenpunkt "${nameTrimmed}" to cluster "${clusterTrimmed}" in project "${projectName}"`);

        res.json({ success: true, knotenpunkt: nameTrimmed });
    } catch (e) {
        console.error('[projectRoutes] knotenpunkte POST error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
