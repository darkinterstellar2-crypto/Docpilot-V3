/**
 * nasOnDemand.js — On-demand file fetcher from NAS
 *
 * When a route tries to read a file that doesn't exist locally (cleaned after
 * 48h), this helper transparently fetches it from NAS and caches it back.
 *
 * Usage:
 *   const { ensureLocalFile } = require('./controllers/nasOnDemand');
 *   const resolvedPath = await ensureLocalFile(localPath, relativePath);
 */

'use strict';

const fsAsync = require('fs').promises;
const path    = require('path');

const { fetchFromNAS, isEnabled } = require('./nasSync');
const { STORAGE_ROOT } = require('./storageConfig');

/**
 * Ensure a file exists locally, fetching from NAS if needed.
 *
 * @param {string} localPath   — absolute local path where the file should be
 * @param {string} relativePath — relative path from STORAGE_ROOT (used to fetch from NAS)
 * @returns {Promise<string>}  — resolves to localPath when ready
 * @throws {Error}             — if file is missing locally AND can't be fetched from NAS
 */
async function ensureLocalFile(localPath, relativePath) {
    // 1. Check if file exists locally
    try {
        await fsAsync.access(localPath);
        return localPath; // File is here — nothing to do
    } catch (_) {
        // File doesn't exist locally — fall through
    }

    // 2. If NAS sync is disabled, we can't fetch from NAS
    if (!isEnabled()) {
        throw new Error(`File not found: ${localPath}`);
    }

    // 3. Normalize relative path
    if (!relativePath) {
        // Derive relativePath from localPath + STORAGE_ROOT
        relativePath = path.relative(STORAGE_ROOT, localPath).replace(/\\/g, '/');
    }
    relativePath = relativePath.replace(/\\/g, '/').replace(/^\//, '');

    // 4. Attempt to fetch from NAS
    console.log(`[nas-ondemand] File missing locally, fetching from NAS: ${relativePath}`);
    const ok = await fetchFromNAS(relativePath, localPath);

    if (!ok) {
        throw new Error(`File not found locally and could not be fetched from NAS: ${relativePath}`);
    }

    // 5. Verify the file is now present
    try {
        await fsAsync.access(localPath);
        return localPath;
    } catch (_) {
        throw new Error(`File fetch from NAS appeared to succeed but file is still missing: ${localPath}`);
    }
}

module.exports = { ensureLocalFile };
