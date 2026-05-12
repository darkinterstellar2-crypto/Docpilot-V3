const fs = require('fs').promises;
const path = require('path');
const { setFileMeta, getProjectRoot } = require('./fileMeta');
const { moveToTrash } = require('./trashHelper');

// Centralized path resolution — single source of truth
const { getDatafileDir } = require('./storageConfig');

// ─── Data-file path resolution ────────────────────────────────────────────────

/**
 * Resolve the canonical path for a project's main aufmass data file.
 * Only looks in STORAGE_ROOT/<projectName>/Doku/Aufmass/datafile/.
 * Returns null if the file does not exist.
 */
async function getDataFilePath(projectName) {
    const filePath = path.join(getDatafileDir(projectName), `${projectName}.txt`);
    try {
        await fs.access(filePath);
        return filePath;
    } catch (_) {
        return null;
    }
}

/**
 * Read the actual .txt data file and return unique cluster names found in the "Cluster" column.
 * Returns [] if the file doesn't exist or has no Cluster column.
 */
async function getClustersFromDataFile(projectName) {
    try {
        const filePath = await getDataFilePath(projectName);
        if (!filePath) return [];

        const fileContent = await fs.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(fileContent);
        const E2_0 = rawData[1][0]; // sub-headers array of arrays
        const dataRows = rawData[1].slice(1); // actual data rows

        // Find the "Cluster" column (group index + col index)
        let grpIdx = -1, colIdx = -1;
        E2_0.forEach((cols, i) => {
            cols.forEach((label, j) => {
                if (typeof label === 'string' && label.toLowerCase() === 'cluster') {
                    grpIdx = i;
                    colIdx = j;
                }
            });
        });

        if (grpIdx === -1) return [];

        const clusters = new Set();
        dataRows.forEach(row => {
            const val = row[grpIdx]?.[colIdx];
            if (val && String(val).trim()) clusters.add(String(val).trim());
        });

        return [...clusters];
    } catch (e) {
        return [];
    }
}

/**
 * Read the actual .txt data file and return unique knotenpunkt values
 * for a specific cluster name.
 */
async function getKnotenpunkteFromDataFile(projectName, clusterName) {
    try {
        const filePath = await getDataFilePath(projectName);
        if (!filePath) return [];

        const fileContent = await fs.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(fileContent);
        const E2_0 = rawData[1][0];
        const dataRows = rawData[1].slice(1);

        let clusterGrp = -1, clusterCol = -1;
        let knotenGrp = -1, knotenCol = -1;

        E2_0.forEach((cols, i) => {
            cols.forEach((label, j) => {
                const l = typeof label === 'string' ? label.toLowerCase() : '';
                if (l === 'cluster') { clusterGrp = i; clusterCol = j; }
                if (l === 'knotenpunkt' || l === 'nvt') { knotenGrp = i; knotenCol = j; }
            });
        });

        if (clusterGrp === -1 || knotenGrp === -1) return [];

        const knoten = new Set();
        dataRows.forEach(row => {
            const cluster = row[clusterGrp]?.[clusterCol];
            if (cluster && String(cluster).trim() === clusterName) {
                const knotenVal = row[knotenGrp]?.[knotenCol];
                if (knotenVal && String(knotenVal).trim()) knoten.add(String(knotenVal).trim());
            }
        });

        return [...knoten];
    } catch (e) {
        return [];
    }
}

// ─── Folder sync ──────────────────────────────────────────────────────────────

/**
 * Create the full folder structure for a new cluster under a project.
 * Creates:
 *   STORAGE_ROOT/ProjectName/Doku/ClusterName/{APL,Druckprufung,Einblasen/BB,Einblasen/HA,kalibrieren,Knotenpunkt_Vorbereitung,OTDR,POP_details,SCT_details}
 *   STORAGE_ROOT/ProjectName/Pläne/ClusterName/
 */
async function syncClusterFolders(projectName, clusterName) {
    const projectRoot = getProjectRoot(projectName);
    const dokuClusterPath = path.join(projectRoot, 'Doku', clusterName);
    const plaenePath = path.join(projectRoot, 'Pläne', clusterName);

    const subFolders = [
        'APL',
        'Druckprufung',
        path.join('Einblasen', 'BB'),
        path.join('Einblasen', 'HA'),
        'kalibrieren',
        'Knotenpunkt_Vorbereitung',
        'OTDR',
        'POP_details',
        'SCT_details'
    ];

    for (const folder of subFolders) {
        const fullPath = path.join(dokuClusterPath, folder);
        await fs.mkdir(fullPath, { recursive: true });
        try { await setFileMeta(projectName, `Doku/${clusterName}/${folder.replace(/\\/g, '/')}`, 'Automated-System'); } catch (_) {}
    }

    // Pläne cluster folder
    await fs.mkdir(plaenePath, { recursive: true });
    try { await setFileMeta(projectName, `Pläne/${clusterName}`, 'Automated-System'); } catch (_) {}
}

/**
 * Create sub-folders for a new Knotenpunkt inside an existing cluster.
 * Creates under STORAGE_ROOT/ProjectName/Doku/ClusterName/:
 *   APL/KnotenpunktName/
 *   Druckprufung/KnotenpunktName/
 *   Einblasen/KnotenpunktName/
 *   kalibrieren/KnotenpunktName/
 *   Knotenpunkt_Vorbereitung/KnotenpunktName/
 *   OTDR/KnotenpunktName/
 */
async function syncKnotenpunktFolders(projectName, clusterName, knotenpunktName) {
    const projectRoot = getProjectRoot(projectName);
    const clusterDokuPath = path.join(projectRoot, 'Doku', clusterName);

    const subFolders = [
        'APL',
        'Druckprufung',
        'Einblasen',
        'kalibrieren',
        'Knotenpunkt_Vorbereitung',
        'OTDR'
    ];

    for (const folder of subFolders) {
        const fullPath = path.join(clusterDokuPath, folder, knotenpunktName);
        await fs.mkdir(fullPath, { recursive: true });
        try { await setFileMeta(projectName, `Doku/${clusterName}/${folder}/${knotenpunktName}`, 'Automated-System'); } catch (_) {}
    }
}

/**
 * Get list of existing cluster folder names for a project.
 * Reads subdirectories of STORAGE_ROOT/ProjectName/Doku/ (excluding system dirs).
 */
async function getExistingClusters(projectName) {
    const projectRoot = getProjectRoot(projectName);
    const dokuPath = path.join(projectRoot, 'Doku');
    const systemDirs = new Set(['aufmass', '.trash']);

    try {
        const entries = await fs.readdir(dokuPath, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !systemDirs.has(e.name.toLowerCase()))
            .map(e => e.name);
    } catch (e) {
        return [];
    }
}

/**
 * Get list of existing Knotenpunkt folder names for a cluster.
 * Reads subdirectories of STORAGE_ROOT/ProjectName/Doku/ClusterName/APL/
 */
async function getExistingKnotenpunkte(projectName, clusterName) {
    const projectRoot = getProjectRoot(projectName);
    const aplPath = path.join(projectRoot, 'Doku', clusterName, 'APL');
    const legacyExclude = new Set(['sct', 'nvt']);

    try {
        const entries = await fs.readdir(aplPath, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !legacyExclude.has(e.name.toLowerCase()))
            .map(e => e.name);
    } catch (e) {
        return [];
    }
}

/**
 * Shared folder sync logic: create new cluster/knotenpunkt folders and
 * move stale clusters (in Doku/ but not in data) to trash.
 *
 * @param {string} projectName
 * @param {{ [cluster: string]: Set<string> }} clusterKnoten - clusters + knotenpunkte from data
 * @param {string[]} safeClusterNames - additional clusters that should NOT be trashed (e.g. from projects.json)
 * @param {Function} logAction - logging function (projectName, action, msg)
 */
async function performFolderSync(projectName, clusterKnoten, safeClusterNames, logAction) {
    const dataClusters = new Set(Object.keys(clusterKnoten));
    const safeClusters = new Set([...dataClusters, ...(safeClusterNames || [])]);

    const existingClusters = new Set(await getExistingClusters(projectName));

    // 1. Sync new clusters / knotenpunkte into filesystem
    for (const [cluster, knotenSet] of Object.entries(clusterKnoten)) {
        if (!existingClusters.has(cluster)) {
            await syncClusterFolders(projectName, cluster);
            await logAction('System', 'Cluster Auto-Created', `Auto-created cluster "${cluster}" for project "${projectName}"`);
        }

        if (knotenSet.size > 0) {
            const existingKnoten = new Set(await getExistingKnotenpunkte(projectName, cluster));
            for (const knoten of knotenSet) {
                if (knoten && !existingKnoten.has(knoten)) {
                    await syncKnotenpunktFolders(projectName, cluster, knoten);
                    await logAction('System', 'Knotenpunkt Auto-Created', `Auto-created Knotenpunkt "${knoten}" in cluster "${cluster}" for project "${projectName}"`);
                }
            }
        }
    }

    // 2. Stale cluster cleanup: move Doku/ subdirs that aren't in data (or safe list) to .trash
    // Only run cleanup if data actually has a cluster column (dataClusters.size > 0 or data file was parseable)
    if (dataClusters.size > 0) {
        const projectRoot = getProjectRoot(projectName);
        for (const fsCluster of existingClusters) {
            if (!safeClusters.has(fsCluster)) {
                const clusterDokuPath = path.join(projectRoot, 'Doku', fsCluster);
                try {
                    await moveToTrash(projectName, clusterDokuPath, fsCluster, 'Doku', 'System');
                    await logAction('System', 'Cluster Auto-Trashed',
                        `Cluster auto-trashed: ${fsCluster} (not found in aufmass data)`);
                    console.log(`Cluster auto-trashed: ${fsCluster} (not found in aufmass data)`);
                } catch (trashErr) {
                    console.error(`Failed to trash stale cluster "${fsCluster}":`, trashErr.message);
                }
            }
        }
    }
}

module.exports = {
    syncClusterFolders,
    syncKnotenpunktFolders,
    getExistingClusters,
    getExistingKnotenpunkte,
    getClustersFromDataFile,
    getKnotenpunkteFromDataFile,
    performFolderSync,
};
