require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs').promises;

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
// ── Block sensitive server-side paths BEFORE static middleware ───────────────────
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const blocked = [
        '/server.js', '/package.json', '/package-lock.json', '/dockerfile',
        '/docker-compose.yml', '/.gitignore', '/.dockerignore', '/caddyfile',
        '/controllers', '/routes', '/storage', '/src/datafiles',
        '/docs', '/.env', '/node_modules',
    ];
    if (blocked.some(b => p === b || p.startsWith(b + '/'))) {
        return res.status(404).end();
    }
    next();
});

// Only serve frontend files (HTML, src/js, src/css, src/img)
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
    },
    dotfiles: 'deny',
}));

// ─── Super Logger (must be required early so ring buffer loads) ───────────────
const { requestLogger: superRequestLogger, superLog, shutdownFlush } = require('./controllers/superLogger');
app.use(superRequestLogger);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'src', 'DataFiles');

// ─── Centralized storage ──────────────────────────────────────────────────────
const { ensureStorageRoot, getDatafileDir } = require('./controllers/storageConfig');

// ─── NAS Sync Engine ──────────────────────────────────────────────────────────
const { startSync } = require('./controllers/nasSync');

// ─── Ensure data directory and required JSON files exist on startup ────────────
async function ensureDataFiles() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    const defaults = {
        'users.json': '[]',
        'projects.json': '[]',
        'logs.json': '[]',
        'schema.json': '[]',
        'super-log.json': '[]',
        'access-control.json': '{}',
        'project-info.json': '{}'
    };
    
    for (const [file, content] of Object.entries(defaults)) {
        const filePath = path.join(DATA_DIR, file);
        try {
            await fs.access(filePath);
        } catch {
            await fs.writeFile(filePath, content, 'utf-8');
            console.log(`Created missing data file: ${file}`);
        }
    }
}

/**
 * One-time migration helper: moves any project .txt files from the legacy
 * src/DataFiles/ location into the new STORAGE_ROOT structure.
 *
 * Only runs if legacy files are found. Safe to run on every startup — skips
 * files that have already been migrated (destination already exists).
 */
async function migrateLegacyDataFiles() {
    const legacyDir = path.join(__dirname, 'src', 'DataFiles');
    let entries;
    try {
        entries = await fs.readdir(legacyDir);
    } catch (_) {
        return; // legacy dir doesn't exist — nothing to migrate
    }

    // Only look at <ProjectName>.txt files (not users.json, projects.json, etc.)
    const projectFiles = entries.filter(f => f.endsWith('.txt') && !f.startsWith('.'));

    if (projectFiles.length === 0) return;

    console.log(`[migration] Found ${projectFiles.length} legacy data file(s) in src/DataFiles/`);

    for (const filename of projectFiles) {
        const projectName = filename.replace(/\.txt$/, '');
        const srcPath = path.join(legacyDir, filename);
        const destDir  = getDatafileDir(projectName);
        const destPath = path.join(destDir, filename);

        // Skip if destination already exists
        try {
            await fs.access(destPath);
            console.log(`[migration] Skipped (already migrated): ${filename}`);
        } catch (_) {
            // Create destination directory and copy file
            try {
                await fs.mkdir(destDir, { recursive: true });
                const content = await fs.readFile(srcPath, 'utf-8');
                await fs.writeFile(destPath, content, 'utf-8');
                console.log(`[migration] Migrated: ${filename} → storage/${projectName}/Doku/Aufmass/datafile/`);
            } catch (err) {
                console.error(`[migration] Failed to migrate ${filename}:`, err.message);
                continue;
            }
        }

        // Always ensure cluster/knotenpunkt folder structure exists
        try {
            const { performFolderSync } = require('./controllers/folderSync');
            const { logAction } = require('./controllers/logger');
            const content = await fs.readFile(destPath, 'utf-8');
            const rawData = JSON.parse(content);
            const E2_0 = rawData[1][0];
            const dataRows = rawData[1].slice(1);

            // Find cluster and knotenpunkt columns
            let clusterGrp = -1, clusterCol = -1, knotenGrp = -1, knotenCol = -1;
            E2_0.forEach((cols, i) => {
                cols.forEach((label, j) => {
                    const l = typeof label === 'string' ? label.toLowerCase() : '';
                    if (l === 'cluster') { clusterGrp = i; clusterCol = j; }
                    if (l === 'knotenpunkt' || l === 'nvt') { knotenGrp = i; knotenCol = j; }
                });
            });

            if (clusterGrp >= 0) {
                const clusterKnoten = {};
                dataRows.forEach(row => {
                    const cluster = row[clusterGrp]?.[clusterCol];
                    if (!cluster || !String(cluster).trim()) return;
                    const clusterStr = String(cluster).trim();
                    if (!clusterKnoten[clusterStr]) clusterKnoten[clusterStr] = new Set();
                    if (knotenGrp >= 0) {
                        const knoten = row[knotenGrp]?.[knotenCol];
                        if (knoten && String(knoten).trim()) {
                            clusterKnoten[clusterStr].add(String(knoten).trim());
                        }
                    }
                });

                await performFolderSync(projectName, clusterKnoten, [], logAction);
                console.log(`[migration] Folder structure synced for: ${projectName}`);
            }
        } catch (syncErr) {
            console.error(`[migration] Folder sync failed for ${projectName}:`, syncErr.message);
        }
    }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
(async () => {
    // 1. Ensure the unified storage root exists
    await ensureStorageRoot();

    // 2. Ensure legacy JSON data files exist (users, projects, logs, schema)
    await ensureDataFiles();

    // 3. Migrate any legacy .txt project files from src/DataFiles/ → storage/
    await migrateLegacyDataFiles();

    // 4. Start NAS background sync engine (no-op if NAS_SYNC_ENABLED != 'true')
    const nasEnabled = process.env.NAS_SYNC_ENABLED === 'true';
    if (nasEnabled) {
        console.log('[nas-sync] NAS_SYNC_ENABLED=true — starting sync engine...');
    } else {
        console.log('[nas-sync] NAS_SYNC_ENABLED not set — sync disabled.');
    }
    await startSync();
})();

// --- IMPORT ROUTES ---
const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');
const projectRoutes = require('./routes/projectRoutes');
const adminRoutes = require('./routes/adminRoutes');
const fileRoutes = require('./routes/fileRoutes');
const moduleRoutes = require('./routes/moduleRoutes');
const chatRoutes = require('./routes/chatRoutes');
const accessRoutes = require('./routes/accessRoutes');
const profileRoutes = require('./routes/profileRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const projectInfoRoutes = require('./routes/projectInfoRoutes');
const geocodeRoutes = require('./routes/geocodeRoutes');
const aiRoutes      = require('./routes/aiRoutes');
const teamRoutes    = require('./routes/teamRoutes');

// --- Geocode proxy (public — no auth, just a Nominatim reverse-geocode relay) ---
// Mounted before authMiddleware so the GeoCam overlay can call it without creds.
app.use('/api/geocode', geocodeRoutes);

// --- JWT auth middleware ---
const { authMiddleware } = require('./controllers/tokenHelper');
app.use('/api', authMiddleware);

// --- Force-termination middleware ---
// Rejects API requests from users whose sessions have been terminated by an admin.
// Excluded: /api/auth/* (so they can still log in again).
const { isTerminated } = require('./controllers/sessionLogger');
app.use('/api', (req, res, next) => {
    // Skip auth routes (login/register/verify must work)
    if (req.path.startsWith('/auth')) return next();
    const email = (req.headers['x-user-email'] || '').trim().toLowerCase();
    if (!email) return next();
    const termination = isTerminated(email);
    if (termination) {
        return res.status(401).json({
            success: false,
            forceLogout: true,
            message: 'Your session has been terminated by an administrator. Please log in again.'
        });
    }
    next();
});

// --- PUBLIC ROUTES (no auth required) ---
// Share routes must be mounted before auth middleware (public, no auth required)
const { serveShare, serveShareBrowse, serveShareDownload } = require('./routes/fileRoutes');
app.get('/share/:shareId', serveShare);
app.get('/share/:shareId/browse', serveShareBrowse);
app.get('/share/:shareId/download', serveShareDownload);

// --- USE ROUTES ---
app.use('/api', authRoutes);         
app.use('/api/data', dataRoutes);    
app.use('/api/projects', projectRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/project-info', projectInfoRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/teams', teamRoutes);

// ─── Global error handler (log error events before sending 500) ──────────────
app.use((err, req, res, next) => {
    try {
        superLog('error', 'error', `Unhandled: ${err.message || err}`, {
            stack:     err.stack ? err.stack.split('\n')[1]?.trim() : undefined,
            method:    req.method,
            url:       req.path,
            userEmail: req.headers['x-user-email'] || null
        });
    } catch (_) {}
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// --- START SERVER ---
const server = app.listen(PORT, () => {
    console.log(`\n--- Server running at http://localhost:${PORT} ---\n`);
    superLog('system', 'info', `Server started on port ${PORT}`, { port: PORT });
});

// --- GRACEFUL SHUTDOWN ---
// Close all open per-project chat DB connections on exit.
const { closeAll: closeChatDbs } = require('./controllers/chatDb');
const shutdown = () => {
    superLog('system', 'info', 'Server shutting down', {});
    shutdownFlush();
    closeChatDbs();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
