// controllers/chatDb.js
// Per-project SQLite chat database with lazy connection pool/cache.
//
// Each project gets its own DB at:
//   storage/<ProjectName>/chat/chat.db
//
// Media files live at:
//   storage/<ProjectName>/chat/media/
//
// Up to MAX_OPEN_DBS connections are kept open simultaneously.
// When the limit is exceeded, the least-recently-used DB is closed.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { getChatDir, getChatMediaDir } = require('./storageConfig');

// ─── Connection Pool ───────────────────────────────────────────────────────────

const MAX_OPEN_DBS = 20;

/**
 * Pool entry: { db: Database, lastUsed: number, stmts: object }
 * Key: projectName (string)
 */
const pool = new Map();

/**
 * Old single-DB path for one-time migration.
 */
const LEGACY_DB_PATH = path.join(__dirname, '..', 'src', 'DataFiles', 'chat.db');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Prepare all reusable statements for a given Database instance.
 * Returns an object of better-sqlite3 prepared statements.
 */
function prepareStatements(db) {
    return {
        insert: db.prepare(`
            INSERT INTO messages
                (user_email, user_name, message, media_url, media_type, original_filename)
            VALUES
                (@user_email, @user_name, @message, @media_url, @media_type, @original_filename)
        `),

        getMessages: db.prepare(`
            SELECT id, user_email, user_name, message, media_url, media_type,
                   original_filename, created_at, edited_at
            FROM messages
            WHERE deleted = 0
            ORDER BY id ASC
            LIMIT @limit OFFSET @offset
        `),

        getNewMessages: db.prepare(`
            SELECT id, user_email, user_name, message, media_url, media_type,
                   original_filename, created_at, edited_at
            FROM messages
            WHERE deleted = 0 AND id > @after_id
            ORDER BY id ASC
        `),

        countMessages: db.prepare(`
            SELECT COUNT(*) AS count FROM messages WHERE deleted = 0
        `),

        editMessage: db.prepare(`
            UPDATE messages
            SET message = @message, edited_at = datetime('now')
            WHERE id = @id AND user_email = @user_email AND deleted = 0
        `),

        deleteMessage: db.prepare(`
            UPDATE messages SET deleted = 1
            WHERE id = @id AND user_email = @user_email
        `),

        adminDeleteMessage: db.prepare(`
            UPDATE messages SET deleted = 1 WHERE id = @id
        `),
    };
}

/**
 * Open (or create) the SQLite DB for a project.
 * Creates the chat dir + media dir if they don't exist.
 * Runs schema migration from the legacy single-DB if needed.
 * Returns { db, stmts }.
 */
function openProjectDb(projectName) {
    const chatDir    = getChatDir(projectName);
    const mediaDir   = getChatMediaDir(projectName);
    const dbPath     = path.join(chatDir, 'chat.db');
    const flagPath   = path.join(chatDir, '.migrated');

    // Ensure directories exist (sync — called lazily once per project)
    fs.mkdirSync(chatDir,  { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });

    const db = new Database(dbPath);

    // WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');

    // Create schema (no project column — each DB is already project-scoped)
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email        TEXT NOT NULL,
            user_name         TEXT NOT NULL,
            message           TEXT NOT NULL DEFAULT '',
            media_url         TEXT DEFAULT NULL,
            media_type        TEXT DEFAULT NULL,
            original_filename TEXT DEFAULT NULL,
            created_at        DATETIME DEFAULT (datetime('now')),
            edited_at         DATETIME DEFAULT NULL,
            deleted           INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    `);

    // One-time migration from legacy single-DB
    if (!fs.existsSync(flagPath) && fs.existsSync(LEGACY_DB_PATH)) {
        try {
            migrateLegacyProject(db, projectName);
            fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
            console.log(`[chatDb] Migration complete for project: ${projectName}`);
        } catch (err) {
            console.error(`[chatDb] Migration failed for ${projectName}:`, err.message);
        }
    } else if (!fs.existsSync(flagPath)) {
        // No legacy DB — mark as already migrated so we don't check again
        fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
    }

    const stmts = prepareStatements(db);
    return { db, stmts };
}

/**
 * Copy rows for a specific project from the legacy single-DB into a new per-project DB.
 * Uses an attach to read in the same transaction, avoiding an extra open connection.
 */
function migrateLegacyProject(targetDb, projectName) {
    console.log(`[chatDb] Migrating legacy data for project: ${projectName}`);

    // Open the legacy DB read-only
    const legacyDb = new Database(LEGACY_DB_PATH, { readonly: true });

    let rows;
    try {
        rows = legacyDb.prepare(`
            SELECT user_email, user_name, message, media_url, media_type,
                   original_filename, created_at, edited_at, deleted
            FROM messages
            WHERE project = ?
            ORDER BY id ASC
        `).all(projectName);
    } finally {
        legacyDb.close();
    }

    if (!rows || rows.length === 0) return;

    const insertLegacy = targetDb.prepare(`
        INSERT INTO messages
            (user_email, user_name, message, media_url, media_type,
             original_filename, created_at, edited_at, deleted)
        VALUES
            (@user_email, @user_name, @message, @media_url, @media_type,
             @original_filename, @created_at, @edited_at, @deleted)
    `);

    const insertMany = targetDb.transaction((rows) => {
        for (const row of rows) insertLegacy.run(row);
    });

    insertMany(rows);
    console.log(`[chatDb] Migrated ${rows.length} message(s) for project: ${projectName}`);
}

/**
 * Evict the least-recently-used DB if the pool is at capacity.
 */
function evictLRUIfNeeded() {
    if (pool.size < MAX_OPEN_DBS) return;

    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of pool) {
        if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestKey  = key;
        }
    }

    if (oldestKey !== null) {
        const entry = pool.get(oldestKey);
        try { entry.db.close(); } catch (_) { /* ignore */ }
        pool.delete(oldestKey);
        console.log(`[chatDb] Evicted LRU connection for project: ${oldestKey}`);
    }
}

/**
 * Get (or lazily open) the pool entry for a project.
 * Updates the lastUsed timestamp for LRU tracking.
 */
function getEntry(projectName) {
    if (!projectName || typeof projectName !== 'string') {
        throw new Error('[chatDb] projectName must be a non-empty string');
    }

    if (pool.has(projectName)) {
        const entry = pool.get(projectName);
        entry.lastUsed = Date.now();
        return entry;
    }

    // Need to open a new connection
    evictLRUIfNeeded();

    const { db, stmts } = openProjectDb(projectName);
    const entry = { db, stmts, lastUsed: Date.now() };
    pool.set(projectName, entry);
    return entry;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Insert a new message into the project's DB.
 * Returns the inserted message object.
 */
function sendMessage({ project, user_email, user_name, message, media_url = null, media_type = null, original_filename = null }) {
    const { stmts } = getEntry(project);
    const result = stmts.insert.run({
        user_email,
        user_name,
        message:           message || '',
        media_url,
        media_type,
        original_filename,
    });
    return {
        id:                result.lastInsertRowid,
        user_email,
        user_name,
        message:           message || '',
        media_url,
        media_type,
        original_filename,
        created_at:        new Date().toISOString(),
        edited_at:         null,
    };
}

/**
 * Fetch paginated messages for a project (oldest-first).
 */
function getMessages({ project, limit = 50, offset = 0 }) {
    const { stmts } = getEntry(project);
    return stmts.getMessages.all({ limit, offset });
}

/**
 * Fetch all messages with id > after_id (used for long-polling).
 */
function getNewMessages({ project, after_id }) {
    const { stmts } = getEntry(project);
    return stmts.getNewMessages.all({ after_id: after_id || 0 });
}

/**
 * Return the total non-deleted message count for a project.
 */
function getMessageCount({ project }) {
    const { stmts } = getEntry(project);
    return stmts.countMessages.get().count;
}

/**
 * Edit a message. Only succeeds if the requesting user owns the message.
 * Returns true if a row was updated.
 */
function editMessage({ id, project, user_email, message }) {
    const { stmts } = getEntry(project);
    const result = stmts.editMessage.run({ id, user_email, message });
    return result.changes > 0;
}

/**
 * Soft-delete a message. Admins can delete any message; regular users only their own.
 * Returns true if a row was updated.
 */
function deleteMessage({ id, project, user_email, isAdmin = false }) {
    const { stmts } = getEntry(project);
    const result = isAdmin
        ? stmts.adminDeleteMessage.run({ id })
        : stmts.deleteMessage.run({ id, user_email });
    return result.changes > 0;
}

/**
 * Close all open DB connections gracefully.
 * Call this on process exit / SIGTERM.
 */
function closeAll() {
    for (const [key, entry] of pool) {
        try { entry.db.close(); } catch (_) { /* ignore */ }
        pool.delete(key);
    }
    console.log('[chatDb] All connections closed.');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    sendMessage,
    getMessages,
    getNewMessages,
    getMessageCount,
    editMessage,
    deleteMessage,
    closeAll,
};
