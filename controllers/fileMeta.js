const fsAsync = require('fs').promises;
const path = require('path');

// Centralized path resolution — single source of truth
const { getProjectRoot } = require('./storageConfig');

/**
 * Read .filemeta.json from the project root. Returns {} if not found.
 */
async function getFileMeta(projectName) {
    const root = getProjectRoot(projectName);
    const metaPath = path.join(root, '.filemeta.json');
    try {
        const raw = await fsAsync.readFile(metaPath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

/**
 * Update .filemeta.json for a specific relative path.
 */
async function setFileMeta(projectName, relativePath, userEmail) {
    const root = getProjectRoot(projectName);
    const metaPath = path.join(root, '.filemeta.json');
    const meta = await getFileMeta(projectName);
    const key = relativePath.replace(/\\/g, '/');
    meta[key] = {
        modifiedBy: userEmail,
        modifiedAt: new Date().toISOString()
    };
    try {
        await fsAsync.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to write filemeta:', e.message);
    }
}

/**
 * Rename a key in .filemeta.json (old relative path → new relative path).
 */
async function renameFileMeta(projectName, oldRelative, newRelative) {
    const root = getProjectRoot(projectName);
    const metaPath = path.join(root, '.filemeta.json');
    const meta = await getFileMeta(projectName);
    const oldKey = oldRelative.replace(/\\/g, '/');
    const newKey = newRelative.replace(/\\/g, '/');
    if (meta[oldKey]) {
        meta[newKey] = meta[oldKey];
        delete meta[oldKey];
        // Also rename any child entries (for folder renames)
        const prefix = oldKey + '/';
        for (const k of Object.keys(meta)) {
            if (k.startsWith(prefix)) {
                const childKey = newKey + '/' + k.slice(prefix.length);
                meta[childKey] = meta[k];
                delete meta[k];
            }
        }
        try {
            await fsAsync.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to write filemeta:', e.message);
        }
    }
}

module.exports = { getProjectRoot, getFileMeta, setFileMeta, renameFileMeta };
