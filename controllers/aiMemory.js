/**
 * controllers/aiMemory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * DoBo Chat-Memory system — per-user persistent memory folders.
 *
 * Storage layout under STORAGE_ROOT:
 *   <ProjectName>/dobo/<userId>/
 *     Chat-Memory/
 *       context.json       ← current context snapshot
 *       preferences.json   ← learned user preferences
 *       sessions/
 *         YYYY-MM-DD.json  ← daily conversation log
 *     notes.json           ← DoBo's notes about this user+project
 */

const fs   = require('fs');
const path = require('path');
const { STORAGE_ROOT } = require('./storageConfig');

// ─── Storage cap ──────────────────────────────────────────────────────────────

const MEMORY_SIZE_CAP_BYTES = 1024 * 1024; // 1 MB per user per project

/**
 * Calculate the total size (in bytes) of all files under a directory tree.
 * Returns 0 if the directory doesn't exist.
 * @param {string} dirPath
 * @returns {number}
 */
function getDirSize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    try {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                total += getDirSize(fullPath);
            } else {
                try { total += fs.statSync(fullPath).size; } catch (_) {}
            }
        }
    } catch (_) {}
    return total;
}

/**
 * Check if a user's memory is at the cap.
 * Returns true if writing should be blocked (cap exceeded).
 * @param {string} project
 * @param {string} userId
 * @returns {boolean}
 */
function isMemoryCapped(project, userId) {
    try {
        const memPath = getMemoryPath(project, userId);
        return getDirSize(memPath) >= MEMORY_SIZE_CAP_BYTES;
    } catch (_) {
        return false;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate that a project name is safe for use in file paths.
 * Rejects anything that could enable path traversal.
 * @param {string} project
 * @throws {Error} if project name is invalid
 */
function validateProject(project) {
    if (!project || typeof project !== 'string') {
        throw new Error('Invalid project: must be a non-empty string.');
    }
    if (!/^[A-Za-z0-9_\- ]{1,100}$/.test(project)) {
        throw new Error(`Invalid project name: "${project}". Only alphanumeric characters, spaces, hyphens, and underscores are allowed (max 100 chars).`);
    }
}

function getMemoryPath(project, userId) {
    validateProject(project);
    return path.join(STORAGE_ROOT, project, 'dobo', userId);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function safeReadJSON(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

// ─── Conversation Log ─────────────────────────────────────────────────────────

/**
 * Append messages to the daily session log for a user.
 * Each message gets a timestamp added. Caps at 200 entries/day.
 */
function saveConversation(project, userId, messages) {
    if (!project || !userId || !Array.isArray(messages) || messages.length === 0) return;
    if (isMemoryCapped(project, userId)) {
        console.warn(`[aiMemory] Memory cap reached for user ${userId} in project ${project}. Skipping conversation save.`);
        return;
    }

    const sessionsDir = path.join(getMemoryPath(project, userId), 'Chat-Memory', 'sessions');
    ensureDir(sessionsDir);

    const today    = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filePath = path.join(sessionsDir, `${today}.json`);

    let existing = safeReadJSON(filePath, []);

    const now        = new Date().toISOString();
    const newEntries = messages.map(m => ({ ...m, timestamp: now }));

    existing.push(...newEntries);

    // Keep last 200 messages to prevent disk bloat
    if (existing.length > 200) {
        existing = existing.slice(-200);
    }

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

/**
 * Load recent conversation (today + yesterday), capped at last 30 messages.
 */
function loadRecentContext(project, userId) {
    if (!project || !userId) return [];

    const sessionsDir = path.join(getMemoryPath(project, userId), 'Chat-Memory', 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const files = [
        path.join(sessionsDir, `${yesterday.toISOString().split('T')[0]}.json`),
        path.join(sessionsDir, `${today.toISOString().split('T')[0]}.json`),
    ];

    let context = [];
    for (const file of files) {
        const data = safeReadJSON(file, []);
        if (Array.isArray(data)) context.push(...data);
    }

    // Return last 30 messages as context window
    return context.slice(-30);
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * Merge new preferences into the stored preferences object.
 */
function savePreferences(project, userId, prefs) {
    if (!project || !userId || !prefs) return;

    const chatMemDir = path.join(getMemoryPath(project, userId), 'Chat-Memory');
    ensureDir(chatMemDir);

    const filePath = path.join(chatMemDir, 'preferences.json');
    const existing = safeReadJSON(filePath, {});

    Object.assign(existing, prefs);
    existing._lastUpdated = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function loadPreferences(project, userId) {
    if (!project || !userId) return {};
    const filePath = path.join(getMemoryPath(project, userId), 'Chat-Memory', 'preferences.json');
    return safeReadJSON(filePath, {});
}

// ─── Context Snapshot ─────────────────────────────────────────────────────────

/**
 * Save a snapshot of what DoBo knows about the user's current state.
 */
function saveContext(project, userId, context) {
    if (!project || !userId || !context) return;

    const chatMemDir = path.join(getMemoryPath(project, userId), 'Chat-Memory');
    ensureDir(chatMemDir);

    const filePath = path.join(chatMemDir, 'context.json');
    const data     = { ...context, _savedAt: new Date().toISOString() };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadContext(project, userId) {
    if (!project || !userId) return {};
    const filePath = path.join(getMemoryPath(project, userId), 'Chat-Memory', 'context.json');
    return safeReadJSON(filePath, {});
}

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * Save DoBo's freeform notes about a user (replaces previous notes).
 */
function saveNotes(project, userId, notes) {
    if (!project || !userId) return;
    if (isMemoryCapped(project, userId)) {
        console.warn(`[aiMemory] Memory cap reached for user ${userId}. Skipping notes save.`);
        return;
    }

    const memPath = getMemoryPath(project, userId);
    ensureDir(memPath);

    const filePath = path.join(memPath, 'notes.json');
    const data     = { notes, _lastUpdated: new Date().toISOString() };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadNotes(project, userId) {
    if (!project || !userId) return '';
    const filePath = path.join(getMemoryPath(project, userId), 'notes.json');
    const data     = safeReadJSON(filePath, {});
    return data.notes || '';
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove session files older than 30 days. Safe to call periodically.
 */
function cleanupOldSessions(project, userId) {
    if (!project || !userId) return;

    const sessionsDir = path.join(getMemoryPath(project, userId), 'Chat-Memory', 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    let files;
    try { files = fs.readdirSync(sessionsDir); } catch (e) { return; }

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const dateStr  = file.replace('.json', '');
        const fileDate = new Date(dateStr);
        if (!isNaN(fileDate) && fileDate < cutoff) {
            try { fs.unlinkSync(path.join(sessionsDir, file)); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Remove all DoBo memory for a user+project.
 */
function clearMemory(project, userId) {
    if (!project || !userId) return;
    const memPath = getMemoryPath(project, userId);
    if (!fs.existsSync(memPath)) return;
    fs.rmSync(memPath, { recursive: true, force: true });
}

/**
 * Check whether any memory exists for a user+project.
 * Used by the frontend to show/hide the 🧠 indicator.
 */
function hasMemory(project, userId) {
    if (!project || !userId) return false;
    return fs.existsSync(getMemoryPath(project, userId));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    validateProject,
    saveConversation,
    loadRecentContext,
    savePreferences,
    loadPreferences,
    saveContext,
    loadContext,
    saveNotes,
    loadNotes,
    cleanupOldSessions,
    clearMemory,
    hasMemory,
    getMemoryPath,
    isMemoryCapped,
    getDirSize,
};
