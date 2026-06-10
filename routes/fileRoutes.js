// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
// - Trash: .manifest.json → file_trash table
// - Shares: shares.json → file_shares table
// - File metadata: .filemeta.json → module_files table (via controllers/fileMeta.js)
// - File listing/uploads/downloads: KEEP on filesystem (unchanged)
const { logAction } = require('../controllers/logger');
const { superLog } = require('../controllers/superLogger');
const db = require('../controllers/db');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// Helper: resolve project UUID from name
async function getProjectId(projectName) {
    if (!projectName) return null;
    try {
        const r = await db.query(
            'SELECT id FROM projects WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
            [TENANT_ID, projectName]
        );
        return r.rows[0]?.id || null;
    } catch (e) {
        console.error('[fileRoutes] getProjectId error:', e.message);
        return null;
    }
}

// Centralized path resolution — single source of truth
const { STORAGE_ROOT, getProjectRoot } = require('../controllers/storageConfig');

// Import shared file meta helpers
const { getFileMeta, setFileMeta, renameFileMeta } = require('../controllers/fileMeta');

// ACL Engine
const { canAccessProject, canAccessModule, canEditProject } = require('../controllers/accessControl');

// NAS sync — fire-and-forget after uploads; on-demand fetch for downloads/listing
const { syncFile, queueOperation, listNASDirectory, fetchFromNAS, isEnabled: nasIsEnabled } = require('../controllers/nasSync');
const { ensureLocalFile } = require('../controllers/nasOnDemand');

/**
 * Safely resolve a user-supplied subpath within the project root.
 * Prevents path traversal attacks.
 */
function safePath(projectName, subPath) {
    const root = getProjectRoot(projectName);
    const resolved = path.resolve(root, subPath || '');
    const resolvedRoot = path.resolve(root);
    // Ensure resolved path is inside root.
    // Use sep-suffix check to prevent prefix-match attacks where a sibling
    // project shares a name prefix (e.g. root="/storage/Foo" must not match
    // "/storage/FooBar").
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        return null; // traversal attempt
    }
    return resolved;
}

// ─── Trash helpers (PostgreSQL) ──────────────────────────────────────────────

function getTrashDir(projectName) {
    return path.join(getProjectRoot(projectName), '.trash');
}

/**
 * Read trash items for a project from file_trash table.
 * Also physically removes items past their expiry date.
 */
async function readTrashItems(projectName) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return [];
    try {
        // Clean expired first
        const expiredResult = await db.query(
            `SELECT id, trash_name, is_dir FROM file_trash
             WHERE tenant_id = $1 AND project_id = $2 AND expires_at <= NOW()`,
            [TENANT_ID, projectId]
        );
        for (const item of expiredResult.rows) {
            const trashPath = path.join(getTrashDir(projectName), item.trash_name);
            try {
                const stat = await fsAsync.stat(trashPath);
                if (stat.isDirectory()) {
                    await fsAsync.rm(trashPath, { recursive: true, force: true });
                } else {
                    await fsAsync.unlink(trashPath);
                }
            } catch (_) {}
        }
        if (expiredResult.rows.length > 0) {
            await db.query(
                `DELETE FROM file_trash WHERE tenant_id = $1 AND project_id = $2 AND expires_at <= NOW()`,
                [TENANT_ID, projectId]
            );
        }

        // Fetch remaining
        const r = await db.query(
            `SELECT id, original_name AS "originalName", original_path AS "originalPath",
                    trash_name AS "trashName", deleted_by AS "deletedBy",
                    deleted_at AS "deletedAt", is_dir AS "isDir", expires_at AS "expiresAt"
             FROM file_trash
             WHERE tenant_id = $1 AND project_id = $2
             ORDER BY deleted_at DESC`,
            [TENANT_ID, projectId]
        );
        return r.rows;
    } catch (e) {
        console.error('[fileRoutes] readTrashItems error:', e.message);
        return [];
    }
}

async function addTrashItem(projectName, { id, originalName, originalPath, trashName, deletedBy, isDir, expiresAt }) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return;
    try {
        await db.query(
            `INSERT INTO file_trash (id, tenant_id, project_id, original_name, original_path, trash_name, deleted_by, deleted_at, expires_at, is_dir)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
             ON CONFLICT (id) DO NOTHING`,
            [id, TENANT_ID, projectId, originalName, originalPath || '', trashName, deletedBy || 'Unknown', expiresAt, isDir || false]
        );
    } catch (e) {
        console.error('[fileRoutes] addTrashItem error:', e.message);
    }
}

async function removeTrashItem(projectName, itemId) {
    const projectId = await getProjectId(projectName);
    if (!projectId) return;
    await db.query(
        'DELETE FROM file_trash WHERE tenant_id = $1 AND project_id = $2 AND id = $3',
        [TENANT_ID, projectId, itemId]
    );
}

async function cleanExpiredTrash(projectName) {
    // Reads items and cleans expired — covered by readTrashItems
    await readTrashItems(projectName).catch(() => {});
}

// ─── Multer ───────────────────────────────────────────────────────────────────

// Multer: store uploads in a temp folder, then move to destination
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const { project, path: subPath } = req.query;
            const dest = safePath(project, subPath || '');
            if (!dest) return cb(new Error('Invalid path'), null);
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            // Sanitize: strip path components, prevent traversal
            const safe = path.basename(file.originalname).replace(/[/\\]/g, '_');
            cb(null, safe || 'unnamed');
        }
    }),
    limits: { fileSize: 200 * 1024 * 1024 } // 200 MB max
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/files/trash?project=X  — list recycle bin items
router.get('/trash', async (req, res) => {
    const { project } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });
    try {
        const items = await readTrashItems(project);
        res.json({ success: true, items });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not read trash: ' + e.message });
    }
});

// POST /api/files/trash/restore?project=X  — restore item from trash
router.post('/trash/restore', async (req, res) => {
    const { project } = req.query;
    const { id } = req.body;
    if (!project || !id) return res.status(400).json({ success: false, message: 'Missing parameters.' });

    // ACL enforcement
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to restore files.' });

    try {
        const items = await readTrashItems(project);
        const item = items.find(i => i.id === id);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found in trash.' });

        const trashPath = path.join(getTrashDir(project), item.trashName);
        const restorePath = safePath(project, path.join(item.originalPath || '', item.originalName));
        if (!restorePath) return res.status(400).json({ success: false, message: 'Invalid restore path.' });

        // Ensure parent dir exists
        await fsAsync.mkdir(path.dirname(restorePath), { recursive: true });
        await fsAsync.rename(trashPath, restorePath);

        await removeTrashItem(project, id);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Restored from Trash', `Restored "${item.originalName}" to ${project}/${item.originalPath || ''}`);
        res.json({ success: true });

        // NAS sync: re-upload the restored file to NAS.
        // For directories: fullSync() on the next cycle will pick up all files inside.
        if (!item.isDir) {
            const relRestorePath = path.relative(STORAGE_ROOT, restorePath).replace(/\\/g, '/');
            syncFile(relRestorePath);
        }
    } catch (e) {
        console.error('Restore error:', e.message);
        res.status(500).json({ success: false, message: 'Could not restore: ' + e.message });
    }
});

// DELETE /api/files/trash/purge?project=X  — permanently delete trash item
router.delete('/trash/purge', async (req, res) => {
    const { project } = req.query;
    const { id } = req.body;
    if (!project || !id) return res.status(400).json({ success: false, message: 'Missing parameters.' });

    // ACL enforcement
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to purge files.' });

    try {
        const items = await readTrashItems(project);
        const item = items.find(i => i.id === id);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found in trash.' });

        const trashPath = path.join(getTrashDir(project), item.trashName);
        try {
            const stat = await fsAsync.stat(trashPath);
            if (stat.isDirectory()) {
                await fsAsync.rm(trashPath, { recursive: true, force: true });
            } else {
                await fsAsync.unlink(trashPath);
            }
        } catch (_) {} // already gone

        await removeTrashItem(project, id);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Purged from Trash', `Permanently deleted "${item.originalName}" from ${project}`);
        res.json({ success: true });
    } catch (e) {
        console.error('Purge error:', e.message);
        res.status(500).json({ success: false, message: 'Could not purge: ' + e.message });
    }
});

// GET /api/files?project=X&path=Y  — list files in directory
router.get('/', async (req, res) => {
    const { project, path: subPath } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    // ACL enforcement (skip for superadmin)
    const fileListEmail = req.headers['x-user-email'] || '';
    const fileListRole  = (req.headers['x-user-role']  || '').toLowerCase();
    if (fileListRole !== 'superadmin') {
        const projectOk = await canAccessProject(fileListEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const moduleOk = await canAccessModule(fileListEmail, project, 'files');
        if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: files module not accessible.' });
    }

    const dirPath = safePath(project, subPath || '');
    if (!dirPath) return res.status(400).json({ success: false, message: 'Invalid path.' });

    try {
        // Hidden items to filter out
        const HIDDEN = new Set(['.trash', '.filemeta.json', 'chat', 'chat-media', 'dobo']);

        // ── Build unified listing: VPS (local) ∪ NAS ────────────────────
        // Local entries keyed by name
        const itemMap = new Map(); // name → { name, isDir, size, mtime }

        let localExists = false;
        try {
            await fsAsync.access(dirPath);
            localExists = true;
            const localEntries = await fsAsync.readdir(dirPath, { withFileTypes: true });
            for (const entry of localEntries) {
                if (HIDDEN.has(entry.name)) continue;
                const fullPath = path.join(dirPath, entry.name);
                let size = null, mtime = null;
                try {
                    const stat = await fsAsync.stat(fullPath);
                    size = stat.size;
                    mtime = stat.mtime;
                } catch (_) {}
                itemMap.set(entry.name, { name: entry.name, isDir: entry.isDirectory(), size, mtime });
            }
        } catch {
            // Directory doesn't exist locally — that's fine, NAS may have it
        }

        // Merge NAS entries (adds items not present locally)
        if (nasIsEnabled()) {
            const relDir = path.relative(STORAGE_ROOT, dirPath).replace(/\\/g, '/');
            const nasItems = await listNASDirectory(relDir);
            if (nasItems) {
                for (const nasItem of nasItems) {
                    if (HIDDEN.has(nasItem.name)) continue;
                    if (!itemMap.has(nasItem.name)) {
                        // Only on NAS — include in listing (will be fetched on-demand when opened)
                        itemMap.set(nasItem.name, {
                            name: nasItem.name,
                            isDir: nasItem.isDir,
                            size: nasItem.size,
                            mtime: nasItem.mtime,
                        });
                        // If it's a directory, create the local stub so navigation works
                        if (nasItem.isDir) {
                            const stubPath = path.join(dirPath, nasItem.name);
                            try { await fsAsync.mkdir(stubPath, { recursive: true }); } catch (_) {}
                        }
                    }
                }
            }
        }

        // If nothing found anywhere → 404
        if (itemMap.size === 0 && !localExists) {
            return res.status(404).json({ success: false, message: 'Directory not found (checked server and NAS).' });
        }

        const fileMeta = await getFileMeta(project);

        const items = Array.from(itemMap.values()).map(entry => {
            const relKey = ((subPath ? subPath + '/' : '') + entry.name).replace(/\\/g, '/');
            const meta = fileMeta[relKey] || null;
            return {
                ...entry,
                modifiedBy: meta ? meta.modifiedBy : null,
                modifiedAt: meta ? meta.modifiedAt : null,
            };
        });

        // Directories first, then files, both alphabetical
        items.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        res.json({ success: true, items });
    } catch (e) {
        console.error('File list error:', e.message);
        res.status(500).json({ success: false, message: 'Could not read directory: ' + e.message });
    }
});

// Middleware: placeholder — ACL controls access now, role check removed
function requireNonUserRole(req, res, next) {
    next();
}

// POST /api/files/upload?project=X&path=Y  — upload file(s) (multi-file)
router.post('/upload', requireNonUserRole, upload.array('files', 50), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files received.' });
    }
    const userEmail = req.headers['x-user-email'] || 'Unknown';

    // ACL enforcement (skip for superadmin)
    const uploadRole2 = (req.headers['x-user-role'] || '').toLowerCase();
    if (uploadRole2 !== 'superadmin' && req.query.project) {
        const projectOk2 = await canAccessProject(userEmail, req.query.project);
        if (!projectOk2) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const moduleOk2 = await canAccessModule(userEmail, req.query.project, 'files');
        if (!moduleOk2) return res.status(403).json({ success: false, message: 'Access denied: files module not accessible.' });
        const editOk2 = await canEditProject(userEmail, req.query.project);
        if (!editOk2) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot upload files).' });
    }
    const names = req.files.map(f => f.originalname).join(', ');
    await logAction(userEmail, 'File Upload', `Uploaded ${req.files.length} file(s) [${names}] to ${req.query.project}/${req.query.path || ''}`);
    superLog('file', 'info', `Upload: ${names} → ${req.query.project}/${req.query.path || ''} by ${userEmail}`, {
        userEmail, project: req.query.project, path: req.query.path, files: req.files.map(f => f.originalname), count: req.files.length
    });
    // Track metadata for each uploaded file
    for (const file of req.files) {
        const relPath = ((req.query.path ? req.query.path + '/' : '') + file.originalname).replace(/\\/g, '/');
        await setFileMeta(req.query.project, relPath, userEmail);
    }
    res.json({ success: true, count: req.files.length, filenames: req.files.map(f => f.originalname) });

    // NAS sync: push each uploaded file (fire-and-forget)
    for (const file of req.files) {
        const absPath = safePath(req.query.project, path.join(req.query.path || '', file.originalname));
        if (absPath) {
            const relPath = require('path').relative(STORAGE_ROOT, absPath).replace(/\\/g, '/');
            syncFile(relPath);
        }
    }
});

// POST /api/files/folder?project=X&path=Y  — create a new folder
router.post('/folder', async (req, res) => {
    const { project, path: subPath } = req.query;
    const { name } = req.body;
    if (!project || !name) return res.status(400).json({ success: false, message: 'Missing project or folder name.' });
    const folderRole = (req.headers['x-user-role'] || '').toLowerCase();
    const folderEmailAcl = req.headers['x-user-email'] || '';

    // ACL enforcement (skip for superadmin)
    if (folderRole !== 'superadmin') {
        const projectOkFld = await canAccessProject(folderEmailAcl, project);
        if (!projectOkFld) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const editOkFld = await canEditProject(folderEmailAcl, project);
        if (!editOkFld) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot create folders).' });
    }

    const folderPath = safePath(project, path.join(subPath || '', name));
    if (!folderPath) return res.status(400).json({ success: false, message: 'Invalid path.' });

    try {
        await fsAsync.mkdir(folderPath, { recursive: true });
        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Folder Created', `Created folder "${name}" in ${project}/${subPath || ''}`);
        const relPath = ((subPath ? subPath + '/' : '') + name).replace(/\\/g, '/');
        await setFileMeta(project, relPath, userEmail);
        res.json({ success: true });
    } catch (e) {
        console.error('Folder create error:', e.message);
        res.status(500).json({ success: false, message: 'Could not create folder: ' + e.message });
    }
});

// POST /api/files/rename?project=X&path=Y  — rename a file or folder
router.post('/rename', async (req, res) => {
    const { project, path: subPath } = req.query;
    const { oldName, newName } = req.body;
    if (!project || !oldName || !newName) return res.status(400).json({ success: false, message: 'Missing parameters.' });
    const renameRole = (req.headers['x-user-role'] || '').toLowerCase();
    const renameEmailAcl = req.headers['x-user-email'] || '';

    // ACL enforcement (skip for superadmin)
    if (renameRole !== 'superadmin') {
        const projectOkRen = await canAccessProject(renameEmailAcl, project);
        if (!projectOkRen) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const editOkRen = await canEditProject(renameEmailAcl, project);
        if (!editOkRen) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot rename files).' });
    }

    const oldPath = safePath(project, path.join(subPath || '', oldName));
    const newPath = safePath(project, path.join(subPath || '', newName));
    if (!oldPath || !newPath) return res.status(400).json({ success: false, message: 'Invalid path.' });

    try {
        await fsAsync.rename(oldPath, newPath);
        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Renamed', `Renamed "${oldName}" → "${newName}" in ${project}/${subPath || ''}`);
        superLog('file', 'info', `Rename: "${oldName}" → "${newName}" in ${project}/${subPath || ''} by ${userEmail}`, {
            userEmail, project, path: subPath, oldName, newName
        });
        const oldRel = ((subPath ? subPath + '/' : '') + oldName).replace(/\\/g, '/');
        const newRel = ((subPath ? subPath + '/' : '') + newName).replace(/\\/g, '/');
        await renameFileMeta(project, oldRel, newRel);
        res.json({ success: true });

        // NAS sync: queue rename on NAS (handles both files and directories)
        const renameOldRemote = `${project}/${oldRel}`;
        const renameNewRemote = `${project}/${newRel}`;
        let renameIsDir = false;
        try { renameIsDir = (await fsAsync.stat(newPath)).isDirectory(); } catch (_) {}
        queueOperation({ type: 'rename', oldRemotePath: renameOldRemote, newRemotePath: renameNewRemote, isDir: renameIsDir });
    } catch (e) {
        console.error('Rename error:', e.message);
        res.status(500).json({ success: false, message: 'Could not rename: ' + e.message });
    }
});

// DELETE /api/files?project=X&path=Y&file=Z  — soft-delete (move to .trash)
router.delete('/', async (req, res) => {
    const { project, path: subPath, file } = req.query;
    if (!project || !file) return res.status(400).json({ success: false, message: 'Missing parameters.' });

    // Protect system files from deletion
    if (file === '.filemeta.json' || file === '.trash') {
        return res.status(403).json({ success: false, message: 'System files cannot be deleted.' });
    }

    const deleteRole = (req.headers['x-user-role'] || '').toLowerCase();
    const deleteEmail = req.headers['x-user-email'] || '';

    // ACL enforcement (skip for superadmin)
    if (deleteRole !== 'superadmin') {
        const projectOkDel = await canAccessProject(deleteEmail, project);
        if (!projectOkDel) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const editOkDel = await canEditProject(deleteEmail, project);
        if (!editOkDel) return res.status(403).json({ success: false, message: 'Access denied: read-only access (cannot delete files).' });
    }

    const targetPath = safePath(project, path.join(subPath || '', file));
    if (!targetPath) return res.status(400).json({ success: false, message: 'Invalid path.' });

    try {
        let fileStat;
        let isDir = false;

        // Check if file exists locally
        try {
            fileStat = await fsAsync.stat(targetPath);
            isDir = fileStat.isDirectory();
        } catch (localErr) {
            // File not local — try fetching from NAS if enabled
            if (nasIsEnabled()) {
                const relPath = `${project}/${subPath ? subPath + '/' : ''}${file}`;
                const fetched = await fetchFromNAS(relPath, targetPath);
                if (!fetched) {
                    return res.status(404).json({ success: false, message: 'File not found (local or NAS).' });
                }
                fileStat = await fsAsync.stat(targetPath);
                isDir = fileStat.isDirectory();
            } else {
                return res.status(404).json({ success: false, message: 'File not found.' });
            }
        }

        // Build a unique trash name: flatten path + timestamp
        const timestamp = Date.now().toString();
        const flatPath = (subPath ? subPath.replace(/[/\\]/g, '_') + '_' : '') + file + '_' + timestamp;
        const trashDir = getTrashDir(project);
        await fsAsync.mkdir(trashDir, { recursive: true });
        const trashItemPath = path.join(trashDir, flatPath);

        // Move to trash
        await fsAsync.rename(targetPath, trashItemPath);

        // Record in DB
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await addTrashItem(project, {
            id: timestamp,
            originalName: file,
            originalPath: subPath || '',
            trashName: flatPath,
            deletedBy: userEmail,
            isDir,
            expiresAt: expiresAt.toISOString()
        });

        await logAction(userEmail, 'Moved to Trash', `Moved "${file}" from ${project}/${subPath || ''} to recycle bin`);
        superLog('file', 'info', `Delete: ${file} from ${project}/${subPath || ''} by ${userEmail}`, {
            userEmail, project, path: subPath, file, isDir
        });
        res.json({ success: true });

        // NAS sync: delete from NAS immediately — NAS is cold storage, not a recycle bin.
        // The VPS keeps the file in trash for 30 days, but NAS doesn't need the copy.
        const nasDeletePath = `${project}/${subPath ? subPath + '/' : ''}${file}`;
        queueOperation({ type: 'delete', remotePath: nasDeletePath, isDir });

    } catch (e) {
        console.error('Delete error:', e.message);
        res.status(500).json({ success: false, message: 'Could not delete: ' + e.message });
    }
});

// ─── Copy / Move helpers ──────────────────────────────────────────────────────

/**
 * Given a destination directory and a base filename, return a non-conflicting
 * filename.  e.g. "report.pdf" → "report (1).pdf" → "report (2).pdf" …
 */
async function getAutoRenamedName(destDir, baseName) {
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    let candidate = baseName;
    let counter = 1;
    while (true) {
        try {
            await fsAsync.access(path.join(destDir, candidate));
            // Name already taken — bump counter
            candidate = `${stem} (${counter})${ext}`;
            counter++;
        } catch (_) {
            // Name is free
            return candidate;
        }
    }
}

/**
 * Recursively copy src → dest (dest is the exact target path, not a container
 * directory).  Updates fileMeta for every copied file.
 */
async function copyRecursive(src, dest, projectRoot, projectName, userEmail) {
    const stat = await fsAsync.stat(src);
    if (stat.isDirectory()) {
        await fsAsync.mkdir(dest, { recursive: true });
        const entries = await fsAsync.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            await copyRecursive(
                path.join(src, entry.name),
                path.join(dest, entry.name),
                projectRoot, projectName, userEmail
            );
        }
    } else {
        await fsAsync.copyFile(src, dest);
        const relPath = path.relative(projectRoot, dest).replace(/\\/g, '/');
        await setFileMeta(projectName, relPath, userEmail);
    }
}

/**
 * Recursively build a directory-only tree (no files) up to maxDepth levels.
 * Excludes hidden items (dot-prefix), `.trash` and `chat` directories.
 * NAS-only dirs are picked up as stubs (created during file listing) — no NAS calls here for speed.
 * Only the root level merges NAS dirs (depth 0) to ensure top-level folders appear.
 */
async function buildDirTree(dirPath, projectRoot, depth, maxDepth) {
    if (depth > maxDepth) return [];
    const EXCLUDED = new Set(['.trash', 'chat', 'dobo']);

    let entries = [];
    try {
        entries = await fsAsync.readdir(dirPath, { withFileTypes: true });
    } catch (_) {
        return [];
    }

    // At root level only: merge NAS top-level dirs (fast — single PROPFIND)
    const dirNames = new Set();
    for (const entry of entries) {
        if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
        if (!entry.isDirectory()) continue;
        dirNames.add(entry.name);
    }

    if (depth === 0 && nasIsEnabled()) {
        const relDir = path.relative(STORAGE_ROOT, dirPath).replace(/\\/g, '/');
        const nasItems = await listNASDirectory(relDir);
        if (nasItems) {
            for (const nasItem of nasItems) {
                if (!nasItem.isDir) continue;
                if (nasItem.name.startsWith('.') || EXCLUDED.has(nasItem.name)) continue;
                if (!dirNames.has(nasItem.name)) {
                    const stubPath = path.join(dirPath, nasItem.name);
                    try { await fsAsync.mkdir(stubPath, { recursive: true }); } catch (_) {}
                    dirNames.add(nasItem.name);
                }
            }
        }
    }

    const children = [];
    for (const name of dirNames) {
        const childAbs = path.join(dirPath, name);
        const relPath = path.relative(projectRoot, childAbs).replace(/\\/g, '/');
        const grandchildren = await buildDirTree(childAbs, projectRoot, depth + 1, maxDepth);
        children.push({ name, path: relPath, children: grandchildren });
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    return children;
}

/**
 * Check whether the requester can edit files in the given project.
 * Returns true if:
 *   - x-user-role is 'superadmin' (always allowed), OR
 *   - the user has canEdit permission for the project via ACL
 */
async function canEditFiles(req, project) {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'superadmin') return true;
    const email = req.headers['x-user-email'] || '';
    if (!email || !project) return false;
    return canEditProject(email, project);
}

// ─── POST /api/files/copy?project=X  — copy a file or folder ─────────────────
router.post('/copy', async (req, res) => {
    const { project } = req.query;
    const { source, destination } = req.body;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });
    if (!source || !destination) return res.status(400).json({ success: false, message: 'Missing source or destination.' });
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to copy files.' });

    const userEmail = req.headers['x-user-email'] || 'Unknown';
    const projectRoot = getProjectRoot(project);

    // Validate both paths against traversal
    const srcAbs = safePath(project, source);
    const destDirAbs = safePath(project, destination);
    if (!srcAbs) return res.status(400).json({ success: false, message: 'Invalid source path (traversal detected).' });
    if (!destDirAbs) return res.status(400).json({ success: false, message: 'Invalid destination path (traversal detected).' });

    // Source must exist
    try {
        await fsAsync.access(srcAbs);
    } catch (_) {
        return res.status(404).json({ success: false, message: 'Source not found.' });
    }

    const baseName = path.basename(srcAbs);

    // Same-location check (before auto-rename)
    const potentialDest = path.join(destDirAbs, baseName);
    if (srcAbs === potentialDest) {
        return res.status(400).json({ success: false, message: 'Source and destination are the same.' });
    }

    try {
        // Create destination directory if it doesn't exist
        await fsAsync.mkdir(destDirAbs, { recursive: true });

        // Resolve final name (handle conflicts)
        const finalName = await getAutoRenamedName(destDirAbs, baseName);
        const destAbs = path.join(destDirAbs, finalName);

        // Deep copy
        await copyRecursive(srcAbs, destAbs, projectRoot, project, userEmail);

        const relDest = path.relative(projectRoot, destAbs).replace(/\\/g, '/');
        await logAction(userEmail, 'File Copy', `Copied "${source}" → "${relDest}" in ${project}`);
        superLog('file', 'info', `Copy: "${source}" → "${relDest}" in ${project} by ${userEmail}`, {
            userEmail, project, source, destination: relDest
        });
        res.json({ success: true, destination: relDest });

        // NAS sync: upload the copied item to NAS (simpler than WebDAV COPY since we have the local file).
        // For directory copies: fullSync() on the next cycle will pick up all files inside.
        try {
            const copyDestStat = await fsAsync.stat(destAbs);
            if (!copyDestStat.isDirectory()) {
                syncFile(path.relative(STORAGE_ROOT, destAbs).replace(/\\/g, '/'));
            }
        } catch (_) {}
    } catch (e) {
        console.error('Copy error:', e.message);
        res.status(500).json({ success: false, message: 'Could not copy: ' + e.message });
    }
});

// ─── POST /api/files/move?project=X  — move a file or folder ─────────────────
router.post('/move', async (req, res) => {
    const { project } = req.query;
    const { source, destination } = req.body;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });
    if (!source || !destination) return res.status(400).json({ success: false, message: 'Missing source or destination.' });
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to move files.' });

    const userEmail = req.headers['x-user-email'] || 'Unknown';
    const projectRoot = getProjectRoot(project);

    const srcAbs = safePath(project, source);
    const destDirAbs = safePath(project, destination);
    if (!srcAbs) return res.status(400).json({ success: false, message: 'Invalid source path (traversal detected).' });
    if (!destDirAbs) return res.status(400).json({ success: false, message: 'Invalid destination path (traversal detected).' });

    // Source must exist
    try {
        await fsAsync.access(srcAbs);
    } catch (_) {
        return res.status(404).json({ success: false, message: 'Source not found.' });
    }

    const baseName = path.basename(srcAbs);

    // Prevent moving a folder into itself
    if (destDirAbs === srcAbs || destDirAbs.startsWith(srcAbs + path.sep)) {
        return res.status(400).json({ success: false, message: 'Cannot move a folder into itself.' });
    }

    // Same-location check (before auto-rename)
    const potentialDest = path.join(destDirAbs, baseName);
    if (srcAbs === potentialDest) {
        return res.status(400).json({ success: false, message: 'Source and destination are the same.' });
    }

    try {
        // Create destination directory if it doesn't exist
        await fsAsync.mkdir(destDirAbs, { recursive: true });

        // Resolve final name (handle conflicts)
        const finalName = await getAutoRenamedName(destDirAbs, baseName);
        const destAbs = path.join(destDirAbs, finalName);

        // Move
        await fsAsync.rename(srcAbs, destAbs);

        // Update fileMeta: rename old relative path → new relative path
        const relSrc = path.relative(projectRoot, srcAbs).replace(/\\/g, '/');
        const relDest = path.relative(projectRoot, destAbs).replace(/\\/g, '/');
        await renameFileMeta(project, relSrc, relDest);
        // Also mark the moved item with current user
        await setFileMeta(project, relDest, userEmail);

        await logAction(userEmail, 'File Move', `Moved "${source}" → "${relDest}" in ${project}`);
        superLog('file', 'info', `Move: "${source}" → "${relDest}" in ${project} by ${userEmail}`, {
            userEmail, project, source, destination: relDest
        });
        res.json({ success: true, destination: relDest });

        // NAS sync: queue move on NAS (handles both files and directories)
        const moveOldRemote = `${project}/${relSrc}`;
        const moveNewRemote = `${project}/${relDest}`;
        let moveIsDir = false;
        try { moveIsDir = (await fsAsync.stat(destAbs)).isDirectory(); } catch (_) {}
        queueOperation({ type: 'move', oldRemotePath: moveOldRemote, newRemotePath: moveNewRemote, isDir: moveIsDir });
    } catch (e) {
        console.error('Move error:', e.message);
        res.status(500).json({ success: false, message: 'Could not move: ' + e.message });
    }
});

// ─── GET /api/files/tree?project=X  — return folder tree for picker UI ────────
router.get('/tree', async (req, res) => {
    const { project } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    // ACL enforcement
    const treeEmail = req.headers['x-user-email'] || '';
    const treeRole  = (req.headers['x-user-role'] || '').toLowerCase();
    if (treeRole !== 'superadmin') {
        const projectOk = await canAccessProject(treeEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const projectRoot = getProjectRoot(project);

    // Project root must exist
    try {
        await fsAsync.access(projectRoot);
    } catch (_) {
        return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    try {
        const children = await buildDirTree(projectRoot, projectRoot, 0, 10);
        res.json({
            success: true,
            tree: {
                name: 'Root',
                path: '',
                children
            }
        });
    } catch (e) {
        console.error('Tree error:', e.message);
        res.status(500).json({ success: false, message: 'Could not build tree: ' + e.message });
    }
});

// GET /api/files/download?project=X&path=Y&file=Z  — download a file
// Also accepts ?_email=&_role= query params for browser-native drag-out downloads
// where custom headers cannot be set.
router.get('/download', async (req, res) => {
    const { project, path: subPath, file } = req.query;
    if (!project || !file) return res.status(400).json({ success: false, message: 'Missing parameters.' });

    // ACL enforcement — fall back to query-string creds for native browser requests (drag-out)
    const dlEmail = req.headers['x-user-email'] || req.query._email || '';
    const dlRole  = ((req.headers['x-user-role'] || req.query._role || '')).toLowerCase();
    // Prevent privilege escalation via query params (superadmin must use headers/JWT)
    const effectiveRole = (req.query._email && !req.headers['x-user-email'])
        ? (dlRole === 'superadmin' ? 'user' : dlRole)
        : dlRole;
    if (effectiveRole !== 'superadmin') {
        const projectOk = await canAccessProject(dlEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
        const moduleOk = await canAccessModule(dlEmail, project, 'files');
        if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: files module not accessible.' });
    }

    const filePath = safePath(project, path.join(subPath || '', file));
    if (!filePath) return res.status(400).json({ success: false, message: 'Invalid path.' });

    try {
        // On-demand NAS fetch if file has been cleaned from VPS
        const relPath = path.relative(STORAGE_ROOT, filePath).replace(/\\/g, '/');
        await ensureLocalFile(filePath, relPath);
        const dlUser = req.headers['x-user-email'] || 'Unknown';
        superLog('file', 'info', `Download: ${file} from ${project}/${subPath || ''} by ${dlUser}`, {
            userEmail: dlUser, project, path: subPath, file
        });
        res.download(filePath, file);
    } catch (e) {
        res.status(404).json({ success: false, message: 'File not found.' });
    }
});

// ─── Folder ZIP Download ──────────────────────────────────────────────────────

const archiver = require('archiver');

// GET /api/files/download-folder?project=X&path=some/folder
router.get('/download-folder', async (req, res) => {
    const { project, path: folderPath } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project.' });

    const userEmail = req.headers['x-user-email'] || 'Unknown';
    const userRole  = (req.headers['x-user-role'] || '').toLowerCase();

    // ACL: need project access at minimum
    if (userRole !== 'superadmin') {
        const projectOk = await canAccessProject(userEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const projectRoot = getProjectRoot(project);
    const targetDir = folderPath
        ? path.join(projectRoot, folderPath)
        : projectRoot;

    // Path traversal check
    if (path.resolve(targetDir) !== path.resolve(projectRoot) &&
        !path.resolve(targetDir).startsWith(path.resolve(projectRoot) + path.sep)) {
        return res.status(400).json({ success: false, message: 'Invalid path.' });
    }

    try {
        const stat = await fsAsync.stat(targetDir);
        if (!stat.isDirectory()) {
            return res.status(400).json({ success: false, message: 'Not a directory.' });
        }
    } catch (_) {
        return res.status(404).json({ success: false, message: 'Folder not found.' });
    }

    const folderName = folderPath ? path.basename(folderPath) : project;
    const zipName = `${folderName}.zip`;

    res.attachment(zipName);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
        if (!res.headersSent) res.status(500).send({ error: err.message });
    });
    archive.pipe(res);
    archive.directory(targetDir, false);
    archive.finalize();

    superLog('file', 'info', `Folder ZIP download: "${folderPath || '/'}" in ${project} by ${userEmail}`, {
        userEmail, project, folderPath: folderPath || '/'
    });
});

// ─── Share Link System (PostgreSQL) ─────────────────────────────────────────

/** Get one share record from DB by shareId. Returns null if not found. */
async function getShareById(shareId) {
    try {
        const r = await db.query(
            `SELECT fs.id AS "shareId", p.name AS project, fs.file_path AS "filePath",
                    fs.file_name AS "fileName", fs.type,
                    fs.created_by AS "createdBy", fs.created_at AS "createdAt",
                    fs.expires_at AS "expiresAt", fs.access_count AS "accessCount"
             FROM file_shares fs
             JOIN projects p ON p.id = fs.project_id
             WHERE fs.id = $1`,
            [shareId]
        );
        if (!r.rows[0]) return null;
        const row = r.rows[0];
        // neverExpires is inferred: expires_at set to year 9999 means never
        row.neverExpires = new Date(row.expiresAt) > new Date('9998-01-01');
        return row;
    } catch (e) {
        console.error('[fileRoutes] getShareById error:', e.message);
        return null;
    }
}

// POST /api/files/share?project=X  — create a share link (canEdit or superadmin)
router.post('/share', async (req, res) => {
    const { project } = req.query;
    const { filePath, expiresIn } = req.body;
    if (!project || !filePath) return res.status(400).json({ success: false, message: 'Missing project or filePath.' });
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to create share links.' });

    const expiresInRaw = parseInt(expiresIn);
    const neverExpires = expiresInRaw === 0;
    const expiresInHours = neverExpires ? 0 : Math.min(Math.max(expiresInRaw || 168, 1), 8760);

    const absPath = safePath(project, filePath);
    if (!absPath) return res.status(400).json({ success: false, message: 'Invalid file path.' });
    let shareType = 'file';
    try {
        const stat = await fsAsync.stat(absPath);
        shareType = stat.isDirectory() ? 'folder' : 'file';
    } catch (_) {
        return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const shareId = crypto.randomBytes(9).toString('base64url');
    const now = new Date();
    const expiresAt = neverExpires
        ? new Date('9999-12-31T23:59:59.999Z')
        : new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
    const userEmail = req.headers['x-user-email'] || 'Unknown';
    const fileName = path.basename(filePath);

    try {
        const projectId = await getProjectId(project);
        if (!projectId) return res.status(404).json({ success: false, message: 'Project not found.' });

        await db.query(
            `INSERT INTO file_shares (id, tenant_id, project_id, file_path, file_name, type,
                                      created_by, expires_at, access_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
            [shareId, TENANT_ID, projectId, filePath, fileName, shareType, userEmail, expiresAt.toISOString()]
        );

        await logAction(userEmail, 'Share Created', `Shared ${shareType} "${filePath}" in ${project} — token: ${shareId}`);
        superLog('file', 'info', `Share: "${filePath}" (${shareType}) in ${project} by ${userEmail}`, {
            userEmail, project, filePath, shareType, shareId, expiresAt: expiresAt.toISOString(), neverExpires
        });

        res.json({ success: true, shareId, shareUrl: `/share/${shareId}`, shareType, expiresAt: expiresAt.toISOString() });
    } catch (e) {
        console.error('[fileRoutes] share create error:', e.message);
        res.status(500).json({ success: false, message: 'Could not create share link.' });
    }
});

// GET /api/files/shares?project=X&filePath=Y  — list active shares for a file
router.get('/shares', async (req, res) => {
    const { project, filePath } = req.query;
    if (!project || !filePath) return res.status(400).json({ success: false, message: 'Missing project or filePath.' });

    const shareEmail = req.headers['x-user-email'] || '';
    const shareRole  = (req.headers['x-user-role'] || '').toLowerCase();
    if (shareRole !== 'superadmin') {
        const projectOk = await canAccessProject(shareEmail, project);
        if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied.' });
        const editOk = await canEditProject(shareEmail, project);
        if (!editOk) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const projectId = await getProjectId(project);
        if (!projectId) return res.json({ success: true, shares: [] });

        const r = await db.query(
            `SELECT id AS "shareId", created_by AS "createdBy", created_at AS "createdAt",
                    expires_at AS "expiresAt", access_count AS "accessCount"
             FROM file_shares
             WHERE tenant_id = $1 AND project_id = $2 AND file_path = $3
               AND expires_at > NOW()`,
            [TENANT_ID, projectId, filePath]
        );
        res.json({ success: true, shares: r.rows });
    } catch (e) {
        console.error('[fileRoutes] shares list error:', e.message);
        res.status(500).json({ success: false, message: 'Could not list shares.' });
    }
});

// DELETE /api/files/share?project=X  — revoke a share link (canEdit or superadmin)
router.delete('/share', async (req, res) => {
    const { project } = req.query;
    const { shareId } = req.body;
    if (!project || !shareId) return res.status(400).json({ success: false, message: 'Missing project or shareId.' });
    if (!await canEditFiles(req, project)) return res.status(403).json({ success: false, message: 'Access denied: edit permission required to revoke share links.' });

    try {
        const share = await getShareById(shareId);
        if (!share) return res.status(404).json({ success: false, message: 'Share not found.' });

        await db.query('DELETE FROM file_shares WHERE id = $1', [shareId]);

        const userEmail = req.headers['x-user-email'] || 'Unknown';
        await logAction(userEmail, 'Share Revoked', `Revoked share ${shareId} for "${share.filePath}" in ${project}`);
        res.json({ success: true });
    } catch (e) {
        console.error('[fileRoutes] share delete error:', e.message);
        res.status(500).json({ success: false, message: 'Could not revoke share.' });
    }
});

/**
 * serveShare — public handler for GET /share/:shareId
 * Mounted directly in server.js (no auth middleware).
 */
async function serveShare(req, res) {
    const { shareId } = req.params;

    const share = await getShareById(shareId);

    if (!share) {
        return res.status(404).send(`<!DOCTYPE html><html><head><title>Not Found</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;width:90%;}
h1{font-size:2rem;color:#1e293b;margin-bottom:.5rem;}p{color:#64748b;margin:0;}</style></head>
<body><div class="box"><h1>🔗 404</h1><p>This share link doesn't exist or has already been removed.</p></div></body></html>`);
    }

    if (!share.neverExpires && new Date(share.expiresAt) <= new Date()) {
        // Expired share — cleanup handled automatically by DB queries
        return res.status(410).send(`<!DOCTYPE html><html><head><title>Link Expired</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;width:90%;}
h1{font-size:2rem;color:#1e293b;margin-bottom:.5rem;}p{color:#64748b;margin:0;}</style></head>
<body><div class="box"><h1>⏰ Link Expired</h1><p>This share link has expired and is no longer available.</p></div></body></html>`);
    }

    // Resolve the file path
    const absPath = safePath(share.project, share.filePath);
    if (!absPath) {
        return res.status(400).send('Invalid file path.');
    }

    // Verify file still exists
    try {
        await fsAsync.access(absPath);
    } catch (_) {
        return res.status(404).send(`<!DOCTYPE html><html><head><title>File Not Found</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;width:90%;}
h1{font-size:2rem;color:#1e293b;margin-bottom:.5rem;}p{color:#64748b;margin:0;}</style></head>
<body><div class="box"><h1>📄 File Unavailable</h1><p>The shared file could not be found. It may have been moved or deleted.</p></div></body></html>`);
    }

    // Determine share type (backward compat: no type field = file)
    const shareType = share.type || 'file';

    if (shareType === 'folder') {
        // Serve a self-contained HTML folder browser (no access count increment here)
        return serveFolderSharePage(res, shareId, share);
    }

    // File share: ensure file is local (fetch from NAS if cleaned)
    try {
        const relPath = path.relative(STORAGE_ROOT, absPath).replace(/\\/g, '/');
        await ensureLocalFile(absPath, relPath);
    } catch (_) {
        return res.status(404).send('File not found (may have been moved or deleted).');
    }

    // Increment access count (fire-and-forget) and serve download
    db.query('UPDATE file_shares SET access_count = access_count + 1 WHERE id = $1', [shareId])
        .catch(e => console.error('[fileRoutes] share access count error:', e.message));

    res.download(absPath, share.fileName, (err) => {
        if (err && !res.headersSent) {
            console.error('Share download error:', err.message);
        }
    });
}

/**
 * Serve the self-contained HTML page for browsing a shared folder.
 */
function serveFolderSharePage(res, shareId, share) {
    const expiresDate = share.neverExpires
        ? 'Never'
        : new Date(share.expiresAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric'
          });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📁 ${escapeHtml(share.fileName)} — DocPilot</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:1rem}
  .container{max-width:860px;margin:0 auto}
  .card{background:rgba(255,255,255,.95);backdrop-filter:blur(20px);border-radius:1.25rem;box-shadow:0 20px 60px rgba(0,0,0,.15);overflow:hidden}
  .header{padding:1.5rem 1.75rem 1rem;border-bottom:1px solid rgba(0,0,0,.06)}
  .header-top{display:flex;align-items:center;gap:.75rem;margin-bottom:.4rem}
  .folder-icon{font-size:1.75rem;line-height:1}
  .folder-title{font-size:1.2rem;font-weight:700;color:#1e293b;word-break:break-all}
  .header-meta{display:flex;flex-wrap:wrap;gap:.5rem;font-size:.8rem;color:#64748b}
  .meta-badge{background:#f1f5f9;border-radius:.5rem;padding:.2rem .6rem}
  .breadcrumb{padding:.75rem 1.75rem;background:#f8fafc;border-bottom:1px solid rgba(0,0,0,.05);display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;font-size:.85rem}
  .bc-item{color:#6366f1;cursor:pointer;font-weight:500;text-decoration:none}
  .bc-item:hover{text-decoration:underline}
  .bc-sep{color:#cbd5e1}
  .bc-current{color:#475569;font-weight:500}
  .file-list{padding:.5rem 0}
  .file-item{display:flex;align-items:center;gap:.75rem;padding:.65rem 1.75rem;cursor:pointer;transition:background .12s;border-bottom:1px solid rgba(0,0,0,.04)}
  .file-item:last-child{border-bottom:none}
  .file-item:hover{background:#f1f5f9}
  .file-item-icon{font-size:1.3rem;width:2rem;text-align:center;flex-shrink:0}
  .file-item-info{flex:1;min-width:0}
  .file-item-name{font-size:.9rem;font-weight:500;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .file-item-size{font-size:.75rem;color:#94a3b8;margin-top:.1rem}
  .file-item-dl{flex-shrink:0;padding:.35rem .75rem;background:#6366f1;color:#fff;border:none;border-radius:.6rem;font-size:.78rem;font-weight:600;cursor:pointer;transition:background .12s;text-decoration:none}
  .file-item-dl:hover{background:#4f46e5}
  .empty-state{padding:3rem 1.75rem;text-align:center;color:#94a3b8}
  .empty-state .icon{font-size:2.5rem;margin-bottom:.75rem}
  .empty-state p{font-size:.95rem}
  .loading{padding:2rem 1.75rem;text-align:center;color:#94a3b8;font-size:.9rem}
  .error-msg{padding:1.5rem 1.75rem;background:#fef2f2;color:#991b1b;border-radius:.75rem;margin:1rem 1.75rem;font-size:.85rem}
  .footer{padding:1rem 1.75rem;background:#f8fafc;border-top:1px solid rgba(0,0,0,.06);text-align:center;font-size:.78rem;color:#94a3b8}
  .footer a{color:#6366f1;text-decoration:none}
  .footer a:hover{text-decoration:underline}
  @media(max-width:600px){
    .header,.breadcrumb,.file-item,.footer{padding-left:1rem;padding-right:1rem}
    .folder-title{font-size:1rem}
  }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="header">
      <div class="header-top">
        <span class="folder-icon">📁</span>
        <div class="folder-title">${escapeHtml(share.fileName)}</div>
      </div>
      <div class="header-meta">
        <span class="meta-badge">📂 ${escapeHtml(share.project)}</span>
        <span class="meta-badge">${share.neverExpires ? '♾️ Never expires' : '⏰ Expires ' + escapeHtml(expiresDate)}</span>
      </div>
    </div>
    <div class="breadcrumb" id="breadcrumb">
      <span class="bc-item" onclick="navigate('')">📁 ${escapeHtml(share.fileName)}</span>
    </div>
    <div id="file-list-wrap">
      <div class="loading">Loading…</div>
    </div>
    <div class="footer">
      Shared via <a href="/" target="_blank">DocPilot</a>${share.neverExpires ? '' : ' &nbsp;·&nbsp; Expires ' + escapeHtml(expiresDate)}
    </div>
  </div>
</div>
<script>
(function() {
  const SHARE_ID = ${JSON.stringify(shareId)};
  const ROOT_NAME = ${JSON.stringify(share.fileName)};
  let currentPath = '';

  function fmt(bytes) {
    if (!bytes || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
    return (bytes/1024/1024/1024).toFixed(2) + ' GB';
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderBreadcrumb(p) {
    const bc = document.getElementById('breadcrumb');
    const parts = p ? p.split('/') : [];
    let html = '<span class="bc-item" onclick="navigate(\\'\\')">📁 ' + esc(ROOT_NAME) + '</span>';
    let built = '';
    for (let i = 0; i < parts.length; i++) {
      built = built ? built + '/' + parts[i] : parts[i];
      const isLast = i === parts.length - 1;
      const cap = built;
      html += '<span class="bc-sep">/</span>';
      if (isLast) {
        html += '<span class="bc-current">' + esc(parts[i]) + '</span>';
      } else {
        html += '<span class="bc-item" onclick="navigate(' + JSON.stringify(cap) + ')">' + esc(parts[i]) + '</span>';
      }
    }
    bc.innerHTML = html;
  }

  window.navigate = async function(p) {
    currentPath = p;
    renderBreadcrumb(p);
    const wrap = document.getElementById('file-list-wrap');
    wrap.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const qs = p ? '?path=' + encodeURIComponent(p) : '';
      const r = await fetch('/share/' + SHARE_ID + '/browse' + qs);
      const data = await r.json();
      if (!data.success) throw new Error(data.message || 'Failed to load');
      renderList(data.items, p);
    } catch(e) {
      wrap.innerHTML = '<div class="error-msg">⚠️ ' + esc(e.message) + '</div>';
    }
  };

  function renderList(items, p) {
    const wrap = document.getElementById('file-list-wrap');
    if (!items || items.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>This folder is empty.</p></div>';
      return;
    }
    // Folders first, then files, both alpha
    items.sort((a,b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    let html = '<div class="file-list">';
    for (const item of items) {
      const isDir = item.type === 'folder';
      const icon = isDir ? '📁' : fileIcon(item.name);
      const subPath = p ? p + '/' + item.name : item.name;
      if (isDir) {
        html += '<div class="file-item" onclick="navigate(' + JSON.stringify(subPath) + ')" title="Open ' + esc(item.name) + '">' +
          '<span class="file-item-icon">' + icon + '</span>' +
          '<div class="file-item-info"><div class="file-item-name">' + esc(item.name) + '</div><div class="file-item-size">Folder</div></div>' +
          '</div>';
      } else {
        const dlUrl = '/share/' + SHARE_ID + '/download?file=' + encodeURIComponent(subPath);
        html += '<div class="file-item" title="' + esc(item.name) + '">' +
          '<span class="file-item-icon">' + icon + '</span>' +
          '<div class="file-item-info"><div class="file-item-name">' + esc(item.name) + '</div><div class="file-item-size">' + fmt(item.size) + '</div></div>' +
          '<a href="' + dlUrl + '" class="file-item-dl" download="' + esc(item.name) + '">↓ Download</a>' +
          '</div>';
      }
    }
    html += '</div>';
    wrap.innerHTML = html;
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📊',pptx:'📊',
      zip:'🗜️',rar:'🗜️','7z':'🗜️',tar:'🗜️',gz:'🗜️',
      jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',svg:'🖼️',webp:'🖼️',
      mp4:'🎬',mov:'🎬',avi:'🎬',mkv:'🎬',
      mp3:'🎵',wav:'🎵',flac:'🎵',
      txt:'📋',csv:'📋',json:'📋',xml:'📋',
      html:'🌐',htm:'🌐',css:'🎨',js:'⚙️',ts:'⚙️',py:'🐍'
    };
    return map[ext] || '📄';
  }

  // Initial load
  navigate('');
})();
</script>
</body>
</html>`;
    res.send(html);
}

/**
 * Escape HTML special characters for use in HTML attributes/text.
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Public folder share browse/download routes ────────────────────────────
// These are mounted directly in server.js as /share/:shareId/browse etc.

/**
 * Validate a share is active. Returns { share, absRoot } or sends error response.
 */
async function resolveShareFolder(req, res) {
    const { shareId } = req.params;
    const share = await getShareById(shareId);
    if (!share) {
        res.status(404).json({ success: false, message: 'Share not found.' });
        return null;
    }
    if (!share.neverExpires && new Date(share.expiresAt) <= new Date()) {
        res.status(410).json({ success: false, message: 'Share link has expired.' });
        return null;
    }
    const shareType = share.type || 'file';
    if (shareType !== 'folder') {
        res.status(400).json({ success: false, message: 'This share is not a folder.' });
        return null;
    }
    const absRoot = safePath(share.project, share.filePath);
    if (!absRoot) {
        res.status(400).json({ success: false, message: 'Invalid share path.' });
        return null;
    }
    return { share, absRoot };
}

/**
 * Resolve a user-supplied sub-path within a shared folder root.
 * Returns absolute path or null if traversal detected.
 */
function safeSubPath(absRoot, subPath) {
    if (!subPath) return absRoot;
    const resolved = path.resolve(absRoot, subPath);
    if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
        return null; // traversal attempt
    }
    return resolved;
}

/**
 * GET /share/:shareId/browse?path=subfolder/name
 * Returns JSON directory listing within a shared folder.
 * No auth required — share token is the auth.
 */
async function serveShareBrowse(req, res) {
    const ctx = await resolveShareFolder(req, res);
    if (!ctx) return;
    const { absRoot } = ctx;

    const subPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const targetDir = safeSubPath(absRoot, subPath);
    if (!targetDir) {
        return res.status(400).json({ success: false, message: 'Invalid path (traversal detected).' });
    }

    try {
        // Build unified listing: local ∪ NAS
        const itemMap = new Map();

        // Local entries
        try {
            const localEntries = await fsAsync.readdir(targetDir, { withFileTypes: true });
            for (const e of localEntries) {
                if (e.name.startsWith('.')) continue;
                const fullPath = path.join(targetDir, e.name);
                let size = null;
                if (!e.isDirectory()) {
                    try { size = (await fsAsync.stat(fullPath)).size; } catch (_) {}
                }
                itemMap.set(e.name, { name: e.name, type: e.isDirectory() ? 'folder' : 'file', size });
            }
        } catch (_) {
            // Local dir may not exist — NAS may have it
        }

        // NAS entries (merge)
        if (nasIsEnabled()) {
            const relDir = path.relative(STORAGE_ROOT, targetDir).replace(/\\/g, '/');
            const nasItems = await listNASDirectory(relDir);
            if (nasItems) {
                for (const ni of nasItems) {
                    if (ni.name.startsWith('.')) continue;
                    if (!itemMap.has(ni.name)) {
                        itemMap.set(ni.name, { name: ni.name, type: ni.isDir ? 'folder' : 'file', size: ni.size });
                        if (ni.isDir) {
                            const stubPath = path.join(targetDir, ni.name);
                            try { await fsAsync.mkdir(stubPath, { recursive: true }); } catch (_) {}
                        }
                    }
                }
            }
        }

        res.json({ success: true, items: Array.from(itemMap.values()) });
    } catch (e) {
        res.status(404).json({ success: false, message: 'Directory not found.' });
    }
}

/**
 * GET /share/:shareId/download?file=subfolder/filename.pdf
 * Serves a file download within the shared folder. Increments access count.
 */
async function serveShareDownload(req, res) {
    const ctx = await resolveShareFolder(req, res);
    if (!ctx) return;
    const { share, absRoot } = ctx;

    const filePath = (req.query.file || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!filePath) {
        return res.status(400).json({ success: false, message: 'Missing file parameter.' });
    }

    const absFile = safeSubPath(absRoot, filePath);
    if (!absFile) {
        return res.status(400).json({ success: false, message: 'Invalid file path (traversal detected).' });
    }

    // Ensure file is local (fetch from NAS if cleaned)
    try {
        const relFilePath = path.relative(STORAGE_ROOT, absFile).replace(/\\/g, '/');
        await ensureLocalFile(absFile, relFilePath);
    } catch (_) {
        return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Must be a file, not a directory
    try {
        const stat = await fsAsync.stat(absFile);
        if (stat.isDirectory()) {
            return res.status(400).json({ success: false, message: 'Path is a directory, not a file.' });
        }
    } catch (_) {
        return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Increment access count (fire-and-forget)
    const shareId = req.params.shareId;
    db.query('UPDATE file_shares SET access_count = access_count + 1 WHERE id = $1', [shareId])
        .catch(e => console.error('[fileRoutes] share folder access count error:', e.message));

    const fileName = path.basename(absFile);
    res.download(absFile, fileName, (err) => {
        if (err && !res.headersSent) {
            console.error('Share folder download error:', err.message);
        }
    });
}

module.exports = router;
module.exports.serveShare = serveShare;
module.exports.serveShareBrowse = serveShareBrowse;
module.exports.serveShareDownload = serveShareDownload;
