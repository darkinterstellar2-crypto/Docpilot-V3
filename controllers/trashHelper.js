/**
 * Shared trash helper — used by file routes and auto-sync logic.
 * Moves an item to the project's .trash folder and updates the manifest.
 */
const fs = require('fs').promises;
const path = require('path');
const { getProjectRoot } = require('./fileMeta');

/**
 * Move an absolute path into the project's .trash directory.
 * Creates a manifest entry with 30-day expiry (same as fileRoutes.js).
 *
 * @param {string} projectName
 * @param {string} itemAbsPath - absolute path of file/dir to move
 * @param {string} itemName - display name (basename)
 * @param {string} itemParentRelPath - relative path of parent inside project (for restore info)
 * @param {string} deletedBy - actor label (email or 'System')
 */
async function moveToTrash(projectName, itemAbsPath, itemName, itemParentRelPath, deletedBy) {
    const projectRoot = getProjectRoot(projectName);
    const trashDir = path.join(projectRoot, '.trash');
    await fs.mkdir(trashDir, { recursive: true });

    const timestamp = Date.now().toString();
    const trashName = `${itemName}_${timestamp}`;
    const trashItemPath = path.join(trashDir, trashName);

    // Move the item
    await fs.rename(itemAbsPath, trashItemPath);

    // Update manifest
    const manifestPath = path.join(trashDir, '.manifest.json');
    let manifest = { items: [] };
    try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
    } catch (_) {}

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
    manifest.items.push({
        id: timestamp,
        originalName: itemName,
        originalPath: itemParentRelPath || '',
        trashName,
        deletedBy: deletedBy || 'System',
        deletedAt: now.toISOString(),
        isDir: true,
        expiresAt: expiresAt.toISOString()
    });

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

module.exports = { moveToTrash };
