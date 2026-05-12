/**
 * nasSync.js — NAS background sync engine via WebDAV
 *
 * Syncs storage/ to a UGREEN NAS (or any WebDAV server) in the background.
 * Never blocks request handling. Fully no-op when NAS_SYNC_ENABLED=false.
 *
 * Environment variables:
 *   NAS_WEBDAV_URL     — WebDAV endpoint (e.g. http://100.x.x.x:5005)
 *   NAS_USERNAME       — WebDAV username
 *   NAS_PASSWORD       — WebDAV password
 *   NAS_SYNC_INTERVAL  — ms between syncs (default: 300000 = 5 min)
 *   NAS_SYNC_ENABLED   — true/false (default: false)
 *   NAS_REMOTE_BASE    — remote base path on NAS (default: /Supreme)
 */

'use strict';

const fs     = require('fs');
const fsAsync = require('fs').promises;
const path   = require('path');
const { createClient } = require('webdav');

// superLogger is required lazily to avoid circular dependency at startup
let _superLog = null;
function getSuperLog() {
    if (!_superLog) {
        try { _superLog = require('./superLogger').superLog; } catch (_) { _superLog = () => {}; }
    }
    return _superLog;
}

const { STORAGE_ROOT } = require('./storageConfig');

// ─── Config ───────────────────────────────────────────────────────────────────

const ENABLED         = process.env.NAS_SYNC_ENABLED === 'true';
const WEBDAV_URL      = process.env.NAS_WEBDAV_URL  || '';
const NAS_USERNAME    = process.env.NAS_USERNAME    || '';
const NAS_PASSWORD    = process.env.NAS_PASSWORD    || '';
const SYNC_INTERVAL   = parseInt(process.env.NAS_SYNC_INTERVAL || '300000', 10);
const REMOTE_BASE     = (process.env.NAS_REMOTE_BASE || '/Supreme').replace(/\/$/, '');

const MANIFEST_PATH    = path.join(STORAGE_ROOT, '.sync-manifest.json');
const OPERATIONS_PATH  = path.join(STORAGE_ROOT, '.sync-operations.json');
const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const KEEP_HOURS       = 48;

// Files/dirs to always skip during sync
const SKIP_NAMES = new Set(['.sync-manifest.json', 'node_modules', '.git']);
// Skip SQLite DB files entirely — they are active binary files that must never
// be synced to WebDAV (would produce corrupted snapshots) and must never be
// cleaned up locally (would destroy the chat database).
const SKIP_EXTENSIONS = new Set(['.db', '.db-wal', '.db-shm']);

// JSON config files in src/DataFiles that must NEVER be deleted locally
const PROTECTED_JSON_DIR = path.join(__dirname, '..', 'src', 'DataFiles');

// ─── State ────────────────────────────────────────────────────────────────────

let _client      = null;   // WebDAV client instance
let _connected   = false;  // last known connection state
let _lastSync    = null;   // ISO timestamp of last successful full sync
let _lastCleanup = null;   // ISO timestamp of last cleanup run
let _syncInterval   = null;
let _cleanupInterval = null;
const _errors = [];        // rolling error log (max 50)

let _opsLoaded = false;         // whether op queue has been loaded from disk
const _operationQueue = [];     // pending file ops to replicate on NAS (delete/rename/move/copy)

// ─── Error log helper ─────────────────────────────────────────────────────────

function logError(msg, err) {
    const entry = {
        time: new Date().toISOString(),
        message: msg,
        detail: err ? (err.message || String(err)) : undefined
    };
    console.error(`[nas-sync] ${msg}`, err ? err.message : '');
    _errors.unshift(entry);
    if (_errors.length > 50) _errors.length = 50;
    try { getSuperLog()('sync', 'error', `NAS: ${msg}${err ? ' — ' + err.message : ''}`, { detail: entry.detail }); } catch (_) {}
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────

async function readManifest() {
    try {
        const raw = await fsAsync.readFile(MANIFEST_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return { files: {}, lastFullSync: null, lastCleanup: null };
    }
}

async function writeManifest(manifest) {
    try {
        await fsAsync.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (err) {
        logError('Failed to write sync manifest', err);
    }
}

// ─── File walker ──────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and yield relative file paths.
 * @param {string} dir       — absolute directory to walk
 * @param {string} baseDir   — base to compute relative paths from
 * @returns {Promise<string[]>} list of relative paths (using forward slashes)
 */
async function walkDir(dir, baseDir) {
    const results = [];
    let entries;
    try {
        entries = await fsAsync.readdir(dir, { withFileTypes: true });
    } catch (_) {
        return results;
    }

    for (const entry of entries) {
        if (SKIP_NAMES.has(entry.name)) continue;

        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await walkDir(absPath, baseDir);
            results.push(...sub);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SKIP_EXTENSIONS.has(ext)) continue;
            const relPath = path.relative(baseDir, absPath).replace(/\\/g, '/');
            results.push(relPath);
        }
    }
    return results;
}

// ─── WebDAV directory creation ────────────────────────────────────────────────

/**
 * Ensure all parent directories exist on the NAS for a given remote path.
 * Creates directories one level at a time (MKCOL).
 */
async function ensureRemoteDirs(remotePath) {
    // Build list of ancestor paths
    const parts = remotePath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) { // exclude filename
        current += '/' + part;
        try {
            await _client.createDirectory(current, { recursive: false });
        } catch (err) {
            // 405 = directory already exists — ignore
            if (!err.message?.includes('405') && !err.message?.includes('already exists')) {
                // Silently ignore — will fail on upload too if truly broken
            }
        }
    }
}

// ─── Core: upload a single file ───────────────────────────────────────────────

/**
 * Upload one file to NAS. Returns true on success, false on failure.
 * @param {string} relPath — relative path from STORAGE_ROOT
 */
async function uploadFile(relPath) {
    const localPath  = path.join(STORAGE_ROOT, relPath);
    const remotePath = `${REMOTE_BASE}/${relPath}`;

    try {
        const fileBuffer = await fsAsync.readFile(localPath);
        await ensureRemoteDirs(remotePath);
        await _client.putFileContents(remotePath, fileBuffer, { overwrite: true });
        return true;
    } catch (err) {
        logError(`Upload failed: ${relPath}`, err);
        return false;
    }
}

// ─── Core: check file exists on NAS ──────────────────────────────────────────

/**
 * Check whether a file exists on NAS right now.
 * Returns:
 *   true  — file confirmed present on NAS
 *   false — file definitively NOT on NAS (404)
 *   null  — check failed (network error, 403, etc.) — treat as unknown, do NOT delete
 */
async function existsOnNAS(relPath) {
    const remotePath = `${REMOTE_BASE}/${relPath}`;
    try {
        return await _client.exists(remotePath);
    } catch (err) {
        // Network error, auth failure, etc. — we cannot confirm presence or absence.
        // Return null so callers skip any destructive action.
        logError(`NAS exists check failed for ${relPath} — cannot confirm presence`, err);
        return null;
    }
}

// ─── Operation queue helpers ──────────────────────────────────────────────────

/**
 * Load the persisted operation queue from disk on first access.
 * Survives server restarts — any unprocessed ops from a previous session
 * are automatically picked up on the next fullSync() cycle.
 */
async function loadOperationQueue() {
    if (_opsLoaded) return;
    _opsLoaded = true; // mark early so concurrent calls don't double-load
    try {
        const raw = await fsAsync.readFile(OPERATIONS_PATH, 'utf8');
        const ops = JSON.parse(raw);
        if (Array.isArray(ops) && ops.length > 0) {
            _operationQueue.push(...ops);
            console.log(`[nas-sync] Loaded ${ops.length} pending operation(s) from disk`);
        }
    } catch (_) {
        // File doesn't exist yet — normal on first run
    }
}

/**
 * Persist the current operation queue to disk.
 * Called after every queue mutation so the queue survives restarts.
 */
async function saveOperationQueue() {
    try {
        await fsAsync.writeFile(OPERATIONS_PATH, JSON.stringify(_operationQueue, null, 2), 'utf8');
    } catch (err) {
        logError('Failed to persist operation queue', err);
    }
}

/**
 * Queue a file operation to be replicated on the NAS.
 * Fire-and-forget — never throws, never blocks the caller.
 *
 * Operation shapes:
 *   { type: 'delete', remotePath: 'Project/sub/file.pdf', isDir: false }
 *   { type: 'rename', oldRemotePath: '...', newRemotePath: '...', isDir: false }
 *   { type: 'move',   oldRemotePath: '...', newRemotePath: '...', isDir: false }
 *   { type: 'copy',   sourcePath: '...',   destPath: '...' }
 *
 * All paths are relative to REMOTE_BASE (i.e. relative to STORAGE_ROOT).
 */
function queueOperation(op) {
    if (!ENABLED) return; // No-op when NAS sync is disabled

    const fullOp = {
        ...op,
        timestamp:  op.timestamp  || new Date().toISOString(),
        retryCount: op.retryCount || 0
    };
    _operationQueue.push(fullOp);

    // Persist asynchronously — fire-and-forget
    setImmediate(() => saveOperationQueue().catch(e => logError('saveOperationQueue failed', e)));
}

/**
 * Returns true if a WebDAV error indicates the resource was not found (HTTP 404).
 */
function isNotFoundError(err) {
    return err?.status === 404 ||
           err?.response?.status === 404 ||
           (typeof err?.message === 'string' && (
               err.message.includes('404') ||
               err.message.toLowerCase().includes('not found')
           ));
}

/**
 * Process all pending operations in the queue via WebDAV.
 * Called at the END of every fullSync() cycle, after uploading changed files.
 *
 * - delete:       WebDAV DELETE (skips if 404 — already gone)
 * - rename/move:  WebDAV MOVE (skips source 404 — already gone)
 * - copy:         WebDAV COPY; falls back to local upload if source 404
 *
 * On success: removes op from queue.
 * On failure: increments retryCount and keeps in queue (max 10 retries then discards).
 * Mutates `manifest` to keep it consistent with the new NAS state.
 *
 * @param {object} manifest — the sync manifest object (will be mutated in-place)
 */
async function processOperationQueue(manifest) {
    // Ensure any ops persisted from a previous run are loaded first
    await loadOperationQueue();

    if (_operationQueue.length === 0) return;

    console.log(`[nas-sync] Processing ${_operationQueue.length} queued operation(s)...`);

    const remaining = []; // ops that failed and should be retried next cycle

    for (const op of _operationQueue) {
        let success = false;

        try {
            switch (op.type) {

                // ── Delete ────────────────────────────────────────────────────
                case 'delete': {
                    const remoteFull = `${REMOTE_BASE}/${op.remotePath}`;
                    // WebDAV DELETE on a directory path should end with /
                    const delPath = op.isDir
                        ? remoteFull.replace(/\/?$/, '/')
                        : remoteFull;

                    try {
                        await _client.deleteFile(delPath);
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            // Already gone on NAS — treat as success
                        } else {
                            throw err;
                        }
                    }

                    // Remove deleted entries from the manifest
                    const delPrefix = op.remotePath.replace(/\/?$/, '/');
                    for (const key of Object.keys(manifest.files)) {
                        if (key === op.remotePath || key.startsWith(delPrefix)) {
                            delete manifest.files[key];
                        }
                    }

                    success = true;
                    break;
                }

                // ── Rename / Move ─────────────────────────────────────────────
                case 'rename':
                case 'move': {
                    const fromFull = `${REMOTE_BASE}/${op.oldRemotePath}`;
                    const toFull   = `${REMOTE_BASE}/${op.newRemotePath}`;
                    // Directories: trailing slash on source path for MOVE
                    const fromPath = op.isDir
                        ? fromFull.replace(/\/?$/, '/')
                        : fromFull;

                    // Ensure destination parent directories exist on NAS
                    await ensureRemoteDirs(toFull);

                    try {
                        await _client.moveFile(fromPath, toFull);
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            // Source doesn't exist on NAS — skip gracefully
                            console.log(`[nas-sync] ${op.type}: source not on NAS, skipping: ${op.oldRemotePath}`);
                        } else {
                            throw err;
                        }
                    }

                    // Update manifest: rename all entries under old path → new path
                    const oldPrefix = op.oldRemotePath;
                    const newPrefix = op.newRemotePath;
                    for (const key of Object.keys(manifest.files)) {
                        if (key === oldPrefix || key.startsWith(oldPrefix + '/')) {
                            const newKey = newPrefix + key.slice(oldPrefix.length);
                            manifest.files[newKey] = manifest.files[key];
                            delete manifest.files[key];
                        }
                    }

                    success = true;
                    break;
                }

                // ── Copy ──────────────────────────────────────────────────────
                case 'copy': {
                    const fromFull = `${REMOTE_BASE}/${op.sourcePath}`;
                    const toFull   = `${REMOTE_BASE}/${op.destPath}`;

                    // Ensure destination parent directories exist on NAS
                    await ensureRemoteDirs(toFull);

                    try {
                        await _client.copyFile(fromFull, toFull);
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            // Source not on NAS — fall back to uploading the local copy
                            console.log(`[nas-sync] copy: source not on NAS, uploading local copy: ${op.destPath}`);
                            const ok = await uploadFile(op.destPath);
                            if (!ok) throw new Error(`Upload fallback failed for copy dest: ${op.destPath}`);
                        } else {
                            throw err;
                        }
                    }

                    success = true;
                    break;
                }

                default:
                    // Unknown op type — discard silently
                    console.warn(`[nas-sync] Op queue: unknown type "${op.type}" — discarding`);
                    success = true;
            }
        } catch (err) {
            const retryCount = (op.retryCount || 0) + 1;
            logError(`Op queue: ${op.type} failed (attempt ${retryCount}/10)`, err);
            if (retryCount < 10) {
                remaining.push({ ...op, retryCount });
            } else {
                logError(`Op queue: discarding "${op.type}" op after 10 failed attempts — ${op.remotePath || op.oldRemotePath || op.destPath}`);
            }
        }

        // If no exception but success is still false (shouldn't happen with above structure,
        // but be defensive) — also retry
        if (!success) {
            const retryCount = (op.retryCount || 0) + 1;
            if (retryCount < 10) {
                remaining.push({ ...op, retryCount });
            }
        }
    }

    // Replace queue contents with only the ops that need retrying
    _operationQueue.length = 0;
    _operationQueue.push(...remaining);
    await saveOperationQueue();

    if (remaining.length > 0) {
        console.log(`[nas-sync] Op queue: ${remaining.length} operation(s) will retry next cycle`);
    }
}

// ─── a) startSync ─────────────────────────────────────────────────────────────

/**
 * Initialize the sync engine. Called from server.js on startup.
 * Returns a sync controller object.
 * No-op (and safe) if NAS_SYNC_ENABLED=false.
 */
async function startSync() {
    if (!ENABLED) {
        console.log('[nas-sync] Disabled (NAS_SYNC_ENABLED not set to true). Skipping.');
        return {
            fullSync, syncFile, fetchFromNAS, cleanup48h,
            getSyncStatus, triggerSync
        };
    }

    if (!WEBDAV_URL) {
        console.warn('[nas-sync] NAS_SYNC_ENABLED=true but NAS_WEBDAV_URL is not set. Sync will not run.');
        return { fullSync, syncFile, fetchFromNAS, cleanup48h, getSyncStatus, triggerSync };
    }

    // Create WebDAV client
    try {
        _client = createClient(WEBDAV_URL, {
            username: NAS_USERNAME,
            password: NAS_PASSWORD,
        });
        // Quick connectivity check
        await _client.exists(REMOTE_BASE);
        _connected = true;
        console.log(`[nas-sync] Connected to NAS at ${WEBDAV_URL} (remote base: ${REMOTE_BASE})`);
    } catch (err) {
        _connected = false;
        logError('Could not connect to NAS on startup — will retry on next sync cycle', err);
        // Don't prevent app from starting
    }

    // Ensure REMOTE_BASE directory exists on NAS
    if (_connected) {
        try {
            await _client.createDirectory(REMOTE_BASE, { recursive: false });
        } catch (_) { /* already exists — fine */ }
    }

    // Initial full sync (non-blocking)
    getSuperLog()('sync', 'info', `NAS sync engine started (interval: ${SYNC_INTERVAL/1000}s)`, { url: WEBDAV_URL, connected: _connected });
    setImmediate(() => fullSync().catch(e => logError('Initial full sync failed', e)));

    // Periodic sync
    _syncInterval = setInterval(() => {
        fullSync().catch(e => logError('Periodic sync failed', e));
    }, SYNC_INTERVAL);

    // Periodic cleanup (every 6 hours)
    _cleanupInterval = setInterval(() => {
        cleanup48h().catch(e => logError('Cleanup failed', e));
    }, CLEANUP_INTERVAL);

    console.log(`[nas-sync] Sync engine started. Interval: ${SYNC_INTERVAL / 1000}s`);

    return { fullSync, syncFile, fetchFromNAS, cleanup48h, getSyncStatus, triggerSync };
}

// ─── b) fullSync ─────────────────────────────────────────────────────────────

/**
 * Walk all of storage/, compare mtimes to manifest, upload changed/new files.
 */
async function fullSync() {
    if (!ENABLED || !_client) return;

    // Re-check connectivity if previously lost
    if (!_connected) {
        try {
            await _client.exists(REMOTE_BASE);
            _connected = true;
        } catch (_) {
            logError('NAS still unreachable — skipping sync cycle');
            return;
        }
    }

    const manifest = await readManifest();
    const allFiles = await walkDir(STORAGE_ROOT, STORAGE_ROOT);

    const toSync = [];
    for (const relPath of allFiles) {
        if (SKIP_NAMES.has(path.basename(relPath))) continue;

        const localPath = path.join(STORAGE_ROOT, relPath);
        let stat;
        try {
            stat = await fsAsync.stat(localPath);
        } catch (_) {
            continue; // file disappeared
        }

        const localMtime = stat.mtime.toISOString();
        const entry = manifest.files[relPath];

        const needsSync = !entry ||
            !entry.confirmed ||
            entry.localMtime !== localMtime;

        if (needsSync) toSync.push({ relPath, localMtime, size: stat.size });
    }

    if (toSync.length === 0) {
        // No files to upload — still process any queued operations and update timestamp
        manifest.lastFullSync = new Date().toISOString();
        _lastSync = manifest.lastFullSync;
        await processOperationQueue(manifest);
        await writeManifest(manifest);
        return;
    }

    console.log(`[nas-sync] Syncing ${toSync.length} changed file(s)...`);

    let synced = 0;
    for (const { relPath, localMtime, size } of toSync) {
        const ok = await uploadFile(relPath);
        if (ok) {
            manifest.files[relPath] = {
                localMtime,
                syncedAt: new Date().toISOString(),
                confirmed: true,
                size
            };
            synced++;
        } else {
            // Mark as unconfirmed so next cycle retries
            if (manifest.files[relPath]) {
                manifest.files[relPath].confirmed = false;
            } else {
                manifest.files[relPath] = {
                    localMtime,
                    syncedAt: null,
                    confirmed: false,
                    size
                };
            }
        }
    }

    manifest.lastFullSync = new Date().toISOString();
    _lastSync = manifest.lastFullSync;

    // Process any queued operations (rename, delete, move, copy) — runs after uploads
    await processOperationQueue(manifest);

    await writeManifest(manifest);

    console.log(`[nas-sync] Complete: ${synced}/${toSync.length} file(s) synced`);
    getSuperLog()('sync', 'info', `NAS sync complete: ${synced}/${toSync.length} files synced`, { synced, total: toSync.length });
}

// ─── c) syncFile ─────────────────────────────────────────────────────────────

/**
 * Immediately sync a single file to NAS. Fire-and-forget — never throws.
 * @param {string} relPath — relative path from STORAGE_ROOT
 */
function syncFile(relPath) {
    if (!ENABLED || !_client) return;

    // Normalize to forward slashes, strip leading slash
    relPath = relPath.replace(/\\/g, '/').replace(/^\//, '');

    setImmediate(async () => {
        try {
            const localPath = path.join(STORAGE_ROOT, relPath);
            let stat;
            try {
                stat = await fsAsync.stat(localPath);
            } catch (_) {
                return; // file doesn't exist
            }

            const ok = await uploadFile(relPath);
            if (ok) {
                const manifest = await readManifest();
                manifest.files[relPath] = {
                    localMtime: stat.mtime.toISOString(),
                    syncedAt: new Date().toISOString(),
                    confirmed: true,
                    size: stat.size
                };
                await writeManifest(manifest);
            }
        } catch (err) {
            logError(`syncFile failed: ${relPath}`, err);
        }
    });
}

// ─── d) fetchFromNAS ─────────────────────────────────────────────────────────

/**
 * Download a file from NAS and save it locally.
 * @param {string} relPath   — relative path from STORAGE_ROOT
 * @param {string} localPath — absolute local path to write to
 * @returns {Promise<boolean>}
 */
async function fetchFromNAS(relPath, localPath) {
    if (!ENABLED || !_client) return false;

    const remotePath = `${REMOTE_BASE}/${relPath}`;
    try {
        console.log(`[nas-sync] Fetching from NAS: ${relPath}`);
        const buffer = await _client.getFileContents(remotePath);
        await fsAsync.mkdir(path.dirname(localPath), { recursive: true });
        await fsAsync.writeFile(localPath, buffer);

        // Update manifest: file is now back locally and confirmed
        const manifest = await readManifest();
        const existing = manifest.files[relPath] || {};
        const stat = await fsAsync.stat(localPath);
        manifest.files[relPath] = {
            ...existing,
            localMtime: stat.mtime.toISOString(),
            syncedAt: existing.syncedAt || new Date().toISOString(),
            confirmed: true,
            size: stat.size,
            cleanedAt: undefined // clear the cleaned marker
        };
        delete manifest.files[relPath].cleanedAt;
        await writeManifest(manifest);

        console.log(`[nas-sync] Fetched and cached: ${relPath}`);
        return true;
    } catch (err) {
        logError(`fetchFromNAS failed: ${relPath}`, err);
        return false;
    }
}

// ─── e) cleanup48h ───────────────────────────────────────────────────────────

/**
 * Remove local copies of files that have been synced to NAS for >48 hours.
 * Runs safely — never deletes unsynced or protected files.
 */
async function cleanup48h() {
    if (!ENABLED || !_client) return;

    console.log('[nas-cleanup] Running 48h cleanup...');

    const manifest = await readManifest();
    const cutoff = new Date(Date.now() - KEEP_HOURS * 60 * 60 * 1000);
    let removed = 0;

    // Find the latest versioned .txt file per project (to keep it locally)
    // Pattern: <ProjectName>_YYYYMMDD_HHMMSS.txt
    const latestVersioned = {}; // { projectName: relPath }
    const versionPattern = /^([^/]+)\/Doku\/Aufmass\/datafile\/(.+)_(\d{8}_\d{6})\.txt$/;
    for (const relPath of Object.keys(manifest.files)) {
        const m = relPath.match(versionPattern);
        if (m) {
            const project = m[1];
            const existing = latestVersioned[project];
            if (!existing || m[3] > existing.ts) {
                latestVersioned[project] = { relPath, ts: m[3] };
            }
        }
    }
    const protectedVersionedPaths = new Set(
        Object.values(latestVersioned).map(v => v.relPath)
    );

    for (const [relPath, entry] of Object.entries(manifest.files)) {
        // Skip files not yet confirmed synced
        if (!entry.confirmed || !entry.syncedAt) continue;

        // Skip files already cleaned
        if (entry.cleanedAt) continue;

        // Skip if synced less than 48h ago
        if (new Date(entry.syncedAt) > cutoff) continue;

        // Skip protected JSON files in src/DataFiles/
        const localPath = path.join(STORAGE_ROOT, relPath);
        if (isProtectedJsonFile(relPath)) continue;

        // Skip the latest versioned .txt per project
        if (protectedVersionedPaths.has(relPath)) continue;

        // Skip .sync-manifest.json itself
        if (path.basename(relPath) === '.sync-manifest.json') continue;

        // NEVER delete the base ProjectName.txt (no timestamp suffix).
        // These are the canonical data files — always keep them locally.
        const baseDatafileMatch = relPath.match(/^([^/]+)\/Doku\/Aufmass\/datafile\/([^/]+)\.txt$/);
        if (baseDatafileMatch && baseDatafileMatch[2] === baseDatafileMatch[1]) continue;

        // CRITICAL: Never delete a local file unless we have VERIFIED it exists on NAS right now.
        // Do NOT rely solely on the manifest's `confirmed` flag — network state may have changed.
        const onNAS = await existsOnNAS(relPath);
        if (onNAS === null) {
            // NAS check itself failed (network error, 403, etc.) — skip deletion entirely
            console.warn(`[nas-cleanup] WARNING: NAS reachability check failed for ${relPath} — skipping deletion to be safe`);
            continue;
        }
        if (!onNAS) {
            logError(`Skipping cleanup for ${relPath} — not found on NAS`);
            manifest.files[relPath].confirmed = false;
            continue;
        }

        // Delete local copy
        try {
            await fsAsync.unlink(localPath);
            manifest.files[relPath].cleanedAt = new Date().toISOString();
            removed++;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logError(`Failed to delete local file: ${relPath}`, err);
            }
        }
    }

    manifest.lastCleanup = new Date().toISOString();
    _lastCleanup = manifest.lastCleanup;
    await writeManifest(manifest);

    console.log(`[nas-cleanup] Removed ${removed} file(s) (synced >${KEEP_HOURS}h ago)`);
    getSuperLog()('sync', 'info', `NAS cleanup complete: removed ${removed} local file(s)`, { removed, keepHours: KEEP_HOURS });
}

/**
 * Check if a relative path is a protected JSON config file in src/DataFiles.
 * These must never be deleted locally.
 */
function isProtectedJsonFile(relPath) {
    // We protect *.json files that, when resolved absolutely, live inside src/DataFiles/
    // Storage paths don't normally include src/DataFiles, but be defensive.
    const lower = relPath.toLowerCase();
    if (!lower.endsWith('.json')) return false;
    // If somehow a json from DataFiles ended up tracked, protect it
    if (lower.includes('src/datafiles/')) return true;
    return false;
}

// ─── e2) syncProjectFromNAS ──────────────────────────────────────────────────

/**
 * Sync all files for a given project from NAS to local storage.
 * Used before generating a ZIP download to ensure all files are present locally.
 *
 * @param {string} projectName — project folder name (e.g. "MyProject")
 * @returns {Promise<{ synced: boolean, fetched: number, total: number, reason?: string }>}
 */
async function syncProjectFromNAS(projectName) {
    if (!ENABLED || !_client) {
        return { synced: false, fetched: 0, total: 0, reason: 'NAS not enabled' };
    }

    // Re-check connectivity if previously lost
    if (!_connected) {
        try {
            await _client.exists(REMOTE_BASE);
            _connected = true;
        } catch (_) {
            return { synced: false, fetched: 0, total: 0, reason: 'NAS unreachable' };
        }
    }

    const remoteProjDir = `${REMOTE_BASE}/${projectName}`;
    console.log(`[nas-sync] syncProjectFromNAS: listing ${remoteProjDir}`);

    let contents;
    try {
        contents = await _client.getDirectoryContents(remoteProjDir, { deep: true });
    } catch (err) {
        logError(`syncProjectFromNAS: failed to list ${remoteProjDir}`, err);
        return { synced: false, fetched: 0, total: 0, reason: err.message };
    }

    // Filter to files only (not directories)
    const remoteFiles = (Array.isArray(contents) ? contents : []).filter(
        item => item.type === 'file'
    );

    console.log(`[nas-sync] syncProjectFromNAS: found ${remoteFiles.length} file(s) on NAS for "${projectName}"`);

    let fetched = 0;
    let skipped = 0;

    for (const item of remoteFiles) {
        // item.filename is the full remote path, e.g. /Supreme/MyProject/Doku/...
        // We need the path relative to REMOTE_BASE
        const remoteFullPath = item.filename; // e.g. /Supreme/MyProject/sub/file.pdf
        const remoteBasePath = REMOTE_BASE.startsWith('/')
            ? REMOTE_BASE
            : '/' + REMOTE_BASE;

        // Strip REMOTE_BASE prefix to get relPath from storage root
        let relPath = remoteFullPath;
        if (relPath.startsWith(remoteBasePath + '/')) {
            relPath = relPath.slice(remoteBasePath.length + 1);
        } else if (relPath.startsWith(remoteBasePath)) {
            relPath = relPath.slice(remoteBasePath.length);
        }
        relPath = relPath.replace(/^\//, ''); // strip leading slash

        // Skip known non-syncable extensions
        const ext = path.extname(relPath).toLowerCase();
        if (SKIP_EXTENSIONS.has(ext)) continue;
        if (SKIP_NAMES.has(path.basename(relPath))) continue;

        const localAbsPath = path.join(STORAGE_ROOT, relPath);

        // Check if file already exists locally
        const localExists = await fsAsync.access(localAbsPath).then(() => true).catch(() => false);
        if (localExists) {
            skipped++;
            continue;
        }

        // File missing locally — fetch from NAS
        const ok = await fetchFromNAS(relPath, localAbsPath);
        if (ok) fetched++;
    }

    console.log(`[nas-sync] syncProjectFromNAS: done — fetched ${fetched}, skipped ${skipped}, total ${remoteFiles.length} for "${projectName}"`);
    getSuperLog()('sync', 'info', `syncProjectFromNAS: ${fetched} fetched, ${skipped} already local`, { projectName, fetched, skipped, total: remoteFiles.length });

    return { synced: true, fetched, total: remoteFiles.length };
}

// ─── f) getSyncStatus ────────────────────────────────────────────────────────

/**
 * Return current sync state for the admin dashboard.
 */
async function getSyncStatus() {
    let pendingFiles = 0;
    let totalTracked = 0;

    try {
        const manifest = await readManifest();
        totalTracked = Object.keys(manifest.files).length;
        pendingFiles = Object.values(manifest.files).filter(e => !e.confirmed).length;
    } catch (_) {}

    return {
        enabled:      ENABLED,
        connected:    _connected,
        lastSync:     _lastSync,
        lastCleanup:  _lastCleanup,
        pendingFiles,
        totalTracked,
        errors:       _errors.slice(0, 50)
    };
}

// ─── g) triggerSync ──────────────────────────────────────────────────────────

/**
 * Manually trigger a full sync. Fire-and-forget — returns immediately.
 */
function triggerSync() {
    if (!ENABLED || !_client) return;
    setImmediate(() => fullSync().catch(e => logError('Manual sync failed', e)));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * List directory contents from NAS.
 * @param {string} relDir — relative path from STORAGE_ROOT (e.g. "ProjectName/Doku/Cluster")
 * @returns {Promise<Array<{name, isDir, size, mtime}>>} — directory entries, or null if unavailable
 */
async function listNASDirectory(relDir) {
    if (!ENABLED || !_client) return null;
    const remotePath = `${REMOTE_BASE}/${relDir}`.replace(/\/+$/, '');
    try {
        const contents = await _client.getDirectoryContents(remotePath, { deep: false });
        return contents.map(item => ({
            name: path.basename(item.filename),
            isDir: item.type === 'directory',
            size: item.size || null,
            mtime: item.lastmod ? new Date(item.lastmod) : null,
        }));
    } catch (err) {
        // Directory doesn't exist on NAS either — that's fine
        if (err.status === 404 || (err.response && err.response.status === 404)) return null;
        logError(`listNASDirectory failed: ${relDir}`, err);
        return null;
    }
}

/**
 * Fetch a directory recursively from NAS to local.
 * Creates the local directory structure and downloads all files.
 * @param {string} relDir — relative path from STORAGE_ROOT
 * @returns {Promise<number>} — number of files fetched
 */
async function fetchNASDirectory(relDir) {
    if (!ENABLED || !_client) return 0;
    const remotePath = `${REMOTE_BASE}/${relDir}`.replace(/\/+$/, '');
    let fetched = 0;
    try {
        const contents = await _client.getDirectoryContents(remotePath, { deep: false });
        for (const item of contents) {
            const itemName = path.basename(item.filename);
            const relPath = `${relDir}/${itemName}`;
            const localPath = path.join(STORAGE_ROOT, relPath);
            if (item.type === 'directory') {
                await fsAsync.mkdir(localPath, { recursive: true });
                fetched += await fetchNASDirectory(relPath);
            } else {
                try {
                    await fsAsync.access(localPath);
                    // Already exists locally — skip
                } catch (_) {
                    const ok = await fetchFromNAS(relPath, localPath);
                    if (ok) fetched++;
                }
            }
        }
    } catch (err) {
        logError(`fetchNASDirectory failed: ${relDir}`, err);
    }
    return fetched;
}

module.exports = {
    startSync,
    fullSync,
    syncFile,
    queueOperation,
    fetchFromNAS,
    listNASDirectory,
    fetchNASDirectory,
    syncProjectFromNAS,
    cleanup48h,
    getSyncStatus,
    triggerSync,
    isEnabled: () => ENABLED,
};
