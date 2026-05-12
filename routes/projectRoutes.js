const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs'); // Needed for safe deletion and zip
const path = require('path');
const archiver = require('archiver');
const { createProjectStructure } = require('../controllers/projectCreator');
const { logAction } = require('../controllers/logger');
const { syncClusterFolders, syncKnotenpunktFolders, getExistingClusters, getExistingKnotenpunkte, getClustersFromDataFile, getKnotenpunkteFromDataFile } = require('../controllers/folderSync');

// Centralized path resolution — single source of truth
const { STORAGE_ROOT, getProjectRoot } = require('../controllers/storageConfig');
const { getAccessibleProjects, canDashboard } = require('../controllers/accessControl');

const PROJECTS_DB = path.join(__dirname, '..', 'src', 'DataFiles', 'projects.json');
const PROJECT_INFO_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'project-info.json');

/** Safely read project-info.json */
async function readProjectInfo() {
    try { return JSON.parse(await fs.readFile(PROJECT_INFO_FILE, 'utf-8')); } catch (_) { return {}; }
}
/** Safely write project-info.json */
async function writeProjectInfo(data) {
    await fs.writeFile(PROJECT_INFO_FILE, JSON.stringify(data, null, 2), 'utf-8');
}


router.get('/', async (req, res) => {
    try {
        const projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));

        const userEmail = req.headers['x-user-email'] || '';
        const userRole  = (req.headers['x-user-role']  || '').toLowerCase();

        // Superadmin sees everything — skip ACL check
        if (userRole === 'superadmin') {
            return res.json({ success: true, projects });
        }

        // Filter projects through ACL
        const accessible = await getAccessibleProjects(userEmail, projects);
        res.json({ success: true, projects: accessible });
    } catch (e) { res.json({ success: true, projects: [] }); }
});

router.post('/create', async (req, res) => {
    const { projectName, locations, schema, structure, description, fields } = req.body;
    if (!projectName || !locations || locations.length === 0 || !schema) return res.status(400).json({ success: false, message: "Missing required details." });
    const createRole = (req.headers['x-user-role'] || '').toLowerCase();
    const createEmail = req.headers['x-user-email'] || '';
    if (createRole !== 'superadmin') {
        const allowed = await canDashboard(createEmail, 'createProject');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Create Project permission required' });
    }
    
    try {
        const projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        if (projects.find(p => p.name.toLowerCase() === projectName.toLowerCase())) {
            return res.status(400).json({ success: false, message: `Project "${projectName}" already exists.` });
        }
    } catch (e) {}

    const result = await createProjectStructure(projectName, locations, schema, structure);
    if (result.success) {
        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Project Created', `New project "${projectName}" created with ${locations.length} location(s)`);

        // Save project info (description + custom fields) if provided
        try {
            if (description || (Array.isArray(fields) && fields.length > 0)) {
                const infoStore = await readProjectInfo();
                const cleanFields = Array.isArray(fields)
                    ? fields.filter(f => f && typeof f.label === 'string').map(f => ({ label: f.label.trim(), value: (f.value || '').trim() }))
                    : [];
                infoStore[projectName] = { description: String(description || '').trim(), fields: cleanFields };
                await writeProjectInfo(infoStore);
            }
        } catch (infoErr) {
            console.error('[projectRoutes] Failed to save project info:', infoErr.message);
        }

        res.json({ success: true });
    } else res.status(500).json({ success: false, message: "Failed to create folder structure." });
});

router.post('/status', async (req, res) => {
    const statusRole = (req.headers['x-user-role'] || '').toLowerCase();
    const statusEmail = req.headers['x-user-email'] || '';
    if (statusRole !== 'superadmin') {
        const allowed = await canDashboard(statusEmail, 'changeStatus');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Change Status permission required' });
    }
    try {
        const { projectName, newStatus } = req.body;
        let projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        const index = projects.findIndex(p => p.name === projectName);
        if(index > -1) {
            projects[index].status = newStatus;
            await fs.writeFile(PROJECTS_DB, JSON.stringify(projects, null, 2));
            res.json({ success: true });
        } else res.status(404).json({ success: false });
    } catch(e) { res.status(500).json({ success: false }); }
});

router.post('/reorder', async (req, res) => {
    const reorderRole = (req.headers['x-user-role'] || '').toLowerCase();
    const reorderEmail = req.headers['x-user-email'] || '';
    if (reorderRole !== 'superadmin') {
        const allowed = await canDashboard(reorderEmail, 'reorderProjects');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Reorder Projects permission required' });
    }
    try {
        const { projectName, direction } = req.body;
        let projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        const index = projects.findIndex(p => p.name === projectName);

        if (index > -1) {
            if (direction === 'left' && index > 0) {
                [projects[index - 1], projects[index]] = [projects[index], projects[index - 1]];
            } else if (direction === 'right' && index < projects.length - 1) {
                [projects[index + 1], projects[index]] = [projects[index], projects[index + 1]];
            }
            await fs.writeFile(PROJECTS_DB, JSON.stringify(projects, null, 2));
            return res.json({ success: true });
        }
        res.status(400).json({ success: false });
    } catch(e) { res.status(500).json({ success: false }); }
});

// 🌟 SPONGEBOB ROUTE (Safe Removal)
router.post('/remove', async (req, res) => {
    const removeRole = (req.headers['x-user-role'] || '').toLowerCase();
    const removeEmail = req.headers['x-user-email'] || '';
    if (removeRole !== 'superadmin') {
        const allowed = await canDashboard(removeEmail, 'deleteProject');
        if (!allowed) return res.status(403).json({ success: false, message: 'Permission denied: Delete Project permission required' });
    }
    try {
        const { projectName } = req.body;
        let projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        
        // 1. Remove from database instantly
        projects = projects.filter(p => p.name !== projectName);
        await fs.writeFile(PROJECTS_DB, JSON.stringify(projects, null, 2));

        // 2. Safe Physical Removal (Bypasses the Server Error crash)
        const projectPath = getProjectRoot(projectName);
        try {
            if (fsSync.existsSync(projectPath)) {
                fsSync.rmSync(projectPath, { recursive: true, force: true });
            }
        } catch(err) {
            console.log("Could not physically wipe folder due to Windows lock, but removed from DB.", err.message);
        }

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Project Deleted', `Deleted project "${projectName}"`);
        res.json({ success: true });
    } catch(e) { 
        console.error(e);
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

    // ── NAS pre-sync: pull any cleaned/missing files back before zipping ──
    const { syncProjectFromNAS, isEnabled: nasEnabled } = require('../controllers/nasSync');
    if (nasEnabled()) {
        console.log(`[zip] NAS enabled — syncing "${projectName}" from NAS before zip...`);
        try {
            // Timeout after 60 seconds — zip whatever we have locally if NAS is slow
            const syncResult = await Promise.race([
                syncProjectFromNAS(projectName),
                new Promise(resolve =>
                    setTimeout(() => resolve({ synced: false, reason: 'timeout', fetched: 0, total: 0 }), 60000)
                )
            ]);
            if (syncResult.synced) {
                console.log(`[zip] NAS sync complete: fetched ${syncResult.fetched}/${syncResult.total} files for "${projectName}"`);
            } else {
                console.warn(`[zip] NAS sync skipped or failed: ${syncResult.reason} — zipping local files only`);
            }
        } catch (err) {
            console.error(`[zip] NAS sync error for "${projectName}":`, err.message, '— continuing with local files');
        }
    }

    if (!fsSync.existsSync(projectPath)) return res.status(404).send("Directory not found.");

    res.attachment(`${projectName}_Backup.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => res.status(500).send({error: err.message}));
    archive.pipe(res);
    archive.directory(projectPath, false);
    archive.finalize();
});

// --- CLUSTER ENDPOINTS ---

// GET /api/projects/:projectName/clusters — list clusters from data file + projects.json + filesystem
router.get('/:projectName/clusters', async (req, res) => {
    try {
        const { projectName } = req.params;

        // Source 1: clusters from actual data file (most authoritative)
        const dataFileClusters = await getClustersFromDataFile(projectName);

        // Source 2: clusters from projects.json locations (for new projects with no data yet)
        let jsonClusters = [];
        try {
            const projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
            const project = projects.find(p => p.name === projectName);
            if (project) jsonClusters = project.locations || [];
        } catch (_) {}

        // Source 3: clusters from filesystem Doku/ subdirs
        const fsClusters = await getExistingClusters(projectName);

        // Merge and deduplicate (data file first so its order is preserved)
        const seen = new Set();
        const allClusters = [];
        for (const c of [...dataFileClusters, ...jsonClusters, ...fsClusters]) {
            if (c && !seen.has(c)) { seen.add(c); allClusters.push(c); }
        }

        res.json({ success: true, clusters: allClusters });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/projects/:projectName/clusters — add a new cluster
router.post('/:projectName/clusters', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Cluster name required.' });

        const clusterName = name.trim();

        // Update projects.json
        let projects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        const idx = projects.findIndex(p => p.name === projectName);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Project not found.' });

        if (!projects[idx].locations) projects[idx].locations = [];
        if (!projects[idx].locations.includes(clusterName)) {
            projects[idx].locations.push(clusterName);
            await fs.writeFile(PROJECTS_DB, JSON.stringify(projects, null, 2));
        }

        // Create folder structure
        await syncClusterFolders(projectName, clusterName);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Cluster Created', `Added cluster "${clusterName}" to project "${projectName}"`);

        // Return updated cluster list (data file + projects.json + filesystem) so frontend cache refreshes correctly
        const dataFileClusters = await getClustersFromDataFile(projectName);
        const updatedProjects = JSON.parse(await fs.readFile(PROJECTS_DB, 'utf-8'));
        const updatedProject = updatedProjects.find(p => p.name === projectName);
        const jsonClusters = updatedProject ? (updatedProject.locations || []) : [];
        const fsClusters = await getExistingClusters(projectName);
        const seen = new Set();
        const allClusters = [];
        for (const c of [...dataFileClusters, ...jsonClusters, ...fsClusters]) {
            if (c && !seen.has(c)) { seen.add(c); allClusters.push(c); }
        }

        res.json({ success: true, cluster: clusterName, clusters: allClusters });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/projects/:projectName/knotenpunkte?cluster=X — list Knotenpunkte for a cluster (data file + filesystem)
router.get('/:projectName/knotenpunkte', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { cluster } = req.query;
        if (!cluster) return res.status(400).json({ success: false, message: 'cluster query param required.' });

        // Source 1: knotenpunkte from actual data file
        const dataFileKnoten = await getKnotenpunkteFromDataFile(projectName, cluster);

        // Source 2: knotenpunkte from filesystem APL/ subdirs
        const fsKnoten = await getExistingKnotenpunkte(projectName, cluster);

        // Merge and deduplicate (data file first)
        const seen = new Set();
        const allKnoten = [];
        for (const k of [...dataFileKnoten, ...fsKnoten]) {
            if (k && !seen.has(k)) { seen.add(k); allKnoten.push(k); }
        }

        res.json({ success: true, knotenpunkte: allKnoten });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/projects/:projectName/knotenpunkte — add a new Knotenpunkt
router.post('/:projectName/knotenpunkte', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { cluster, name } = req.body;
        if (!cluster || !name) return res.status(400).json({ success: false, message: 'cluster and name required.' });

        await syncKnotenpunktFolders(projectName, cluster.trim(), name.trim());

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Knotenpunkt Created', `Added Knotenpunkt "${name.trim()}" to cluster "${cluster.trim()}" in project "${projectName}"`);

        res.json({ success: true, knotenpunkt: name.trim() });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;