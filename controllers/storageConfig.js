/**
 * storageConfig.js — Single source of truth for all file storage paths.
 *
 * STORAGE_ROOT defaults to <project-root>/storage/ but can be overridden
 * with the STORAGE_ROOT environment variable for external / mounted drives.
 *
 * Directory structure under STORAGE_ROOT:
 *   <projectName>/
 *     Doku/
 *       Aufmass/
 *         datafile/   ← .txt data files + versioned copies
 *         xlsx/       ← exported Excel files
 *       <ClusterName>/
 *         APL/ OTDR/ ... (auto-created by folderSync)
 *     Pläne/
 *     chat/
 *       media/
 *     .trash/
 *     .filemeta.json
 */

const fs = require('fs').promises;
const path = require('path');

// ─── Root ─────────────────────────────────────────────────────────────────────

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '..', 'storage');

// ─── Path helpers ─────────────────────────────────────────────────────────────

/** Root directory for a project: STORAGE_ROOT/<projectName>/ */
function getProjectRoot(projectName) {
    return path.join(STORAGE_ROOT, projectName);
}

/** Datafile directory: STORAGE_ROOT/<projectName>/Doku/Aufmass/datafile/ */
function getDatafileDir(projectName) {
    return path.join(STORAGE_ROOT, projectName, 'Doku', 'Aufmass', 'datafile');
}

/** XLSX export directory: STORAGE_ROOT/<projectName>/Doku/Aufmass/xlsx/ */
function getXlsxDir(projectName) {
    return path.join(STORAGE_ROOT, projectName, 'Doku', 'Aufmass', 'xlsx');
}

/** Chat directory: STORAGE_ROOT/<projectName>/chat/ */
function getChatDir(projectName) {
    return path.join(STORAGE_ROOT, projectName, 'chat');
}

/** Chat media directory: STORAGE_ROOT/<projectName>/chat/media/ */
function getChatMediaDir(projectName) {
    return path.join(STORAGE_ROOT, projectName, 'chat', 'media');
}

// ─── Ensure helpers (create on first access) ──────────────────────────────────

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Returns the path so callers can chain: const dir = await ensureDir(getDatafileDir(p));
 */
async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
}

/**
 * Ensure the STORAGE_ROOT itself exists. Called once on server startup.
 */
async function ensureStorageRoot() {
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    console.log(`[storage] STORAGE_ROOT: ${STORAGE_ROOT}`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    STORAGE_ROOT,
    getProjectRoot,
    getDatafileDir,
    getXlsxDir,
    getChatDir,
    getChatMediaDir,
    ensureDir,
    ensureStorageRoot,
};
