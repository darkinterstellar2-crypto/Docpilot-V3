/**
 * routes/aiRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Assistant API endpoints.
 * All routes require JWT authentication (enforced below, not just globally).
 *
 * POST /api/ai/chat                      — Main conversational endpoint
 * POST /api/ai/proactive                 — Proactive suggestion for idle users
 * GET  /api/ai/memory                    — Read user memory
 * GET  /api/ai/memory/status             — Has memory?
 * DELETE /api/ai/memory                  — Clear user memory
 * POST /api/ai/context                   — Save context snapshot
 * POST /api/ai/edit-request              — Forward edit request to admin
 * POST /api/ai/edit-requests/acknowledge — Superadmin: mark pending as read
 */

/**
 * ⚠️ SAFETY: DoBo AI routes are STRICTLY READ-ONLY.
 *
 * DoBo can ONLY:
 *   - Read project context (passed from frontend)
 *   - Chat with users (Gemini API)
 *   - Read/write its own memory files (user preferences, chat history)
 *
 * DoBo CANNOT and MUST NOT:
 *   - Modify, delete, or create project data
 *   - Access datafile read/write functions
 *   - Trigger any server-side data operations
 *   - Call any controller outside of ai* controllers
 *
 * If adding edit capabilities in the future, they MUST:
 *   1. Require explicit user confirmation (double-confirm dialog)
 *   2. Create a backup before any modification
 *   3. Log every AI-initiated change with full audit trail
 *   4. Be gated behind aiEdit permission AND superadmin approval
 */

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const router   = express.Router();
const { handleChat, handleProactive } = require('../controllers/aiController');
const { sanitizeInput }               = require('../controllers/aiSecurity');
const { aiRateLimitMiddleware }       = require('../controllers/aiRateLimiter');
const accessControl  = require('../controllers/accessControl');
const aiMemory       = require('../controllers/aiMemory');
const { sendEditRequest, getPending, markPendingRead } = require('../controllers/aiMailer');
const { getProjectRoot }             = require('../controllers/storageConfig');

// ─── Body size limit for AI routes (50 KB) ────────────────────────────────────
// Applied per-route to keep a tighter cap than the global 10 MB limit.
const express_json_50kb = require('express').json({ limit: '50kb' });

// ─── Fix 7: Require authenticated user for ALL AI routes ─────────────────────
// The global authMiddleware sets req.user if a valid token is present, but
// lets unauthenticated requests through (for backward compat). We explicitly
// block any unauthenticated access here.
router.use((req, res, next) => {
    if (!req.user || !req.user.email) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    next();
});

// ─── Per-user edit-request rate limiter (5 per hour) ─────────────────────────
// Separate from the main AI limiter so it uses a different window/quota.
const _editRateLimitStore = {};

setInterval(() => {
    const cutoff = Date.now() - 60 * 60_000;
    for (const key of Object.keys(_editRateLimitStore)) {
        const arr = _editRateLimitStore[key];
        if (!arr || arr.length === 0 || arr[arr.length - 1] < cutoff) {
            delete _editRateLimitStore[key];
        }
    }
}, 15 * 60_000).unref();

function editRateLimiter(req, res, next) {
    const userId = (req.user && req.user.email) || req.ip;
    const now    = Date.now();
    const window = 60 * 60_000; // 1 hour
    const limit  = 5;

    if (!_editRateLimitStore[userId]) _editRateLimitStore[userId] = [];
    _editRateLimitStore[userId] = _editRateLimitStore[userId].filter(t => now - t < window);

    if (_editRateLimitStore[userId].length >= limit) {
        return res.status(429).json({ error: 'Too many edit requests. Please wait an hour before trying again.' });
    }

    _editRateLimitStore[userId].push(now);
    next();
}

// ─── Per-user file upload daily tracker ──────────────────────────────────────
// Tracks how many files a user has uploaded today (max 5).
// In-memory: { 'YYYY-MM-DD|userId': count }
const _uploadDailyStore = {};

setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    for (const key of Object.keys(_uploadDailyStore)) {
        if (!key.startsWith(today)) delete _uploadDailyStore[key];
    }
}, 60 * 60_000).unref();

function checkDailyUploadLimit(req, res, next) {
    const userId = (req.user && req.user.email) || req.ip || 'unknown';
    const today  = new Date().toISOString().slice(0, 10);
    const key    = `${today}|${userId}`;
    const count  = _uploadDailyStore[key] || 0;
    const limit  = 5;

    if (count >= limit) {
        return res.status(429).json({
            error: 'Daily file upload limit reached (5 files/day). Please try again tomorrow.',
        });
    }

    // Increment after successful upload (done in the route handler via req._uploadKey)
    req._uploadKey = key;
    next();
}

// ─── Multer config for AI file uploads ───────────────────────────────────────

const AI_ALLOWED_EXT = new Set(['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.jpg', '.jpeg', '.png']);

const aiUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const project = req.query.project || '';
            if (!project || !/^[A-Za-z0-9_\- ]{1,100}$/.test(project)) {
                return cb(new Error('Invalid project name'), null);
            }
            const userId = (req.user && req.user.email) || 'unknown';
            // Sanitize user ID to be filesystem-safe
            const safeId = userId.replace(/[^a-zA-Z0-9@._-]/g, '_');
            const dest   = path.join(getProjectRoot(project), 'ai-uploads', safeId);
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const safe = path.basename(file.originalname).replace(/[/\\]/g, '_');
            cb(null, safe || 'unnamed');
        },
    }),
    limits:     { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (AI_ALLOWED_EXT.has(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed. Accepted: ${[...AI_ALLOWED_EXT].join(', ')}`), false);
        }
    },
});

// ─── Project name validation ───────────────────────────────────────────────────
/**
 * Validate that a project name is safe (no path traversal).
 * Returns true if valid, false if not.
 * Mirrors the check in aiMemory.validateProject.
 */
function isValidProject(project) {
    if (!project || typeof project !== 'string') return false;
    return /^[A-Za-z0-9_\- ]{1,100}$/.test(project);
}

// ─── chatHistory validation ────────────────────────────────────────────────────
/**
 * Validate and sanitize a chatHistory array from the client.
 * Drops any entries with invalid role or non-string content.
 * Sanitizes content of each valid entry.
 * @param {any} history
 * @returns {Array<{role: string, content: string}>}
 */
function validateChatHistory(history) {
    if (!Array.isArray(history)) return [];
    const valid = [];
    for (const entry of history) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.role !== 'user' && entry.role !== 'assistant') continue;
        if (typeof entry.content !== 'string') continue;
        const { clean } = sanitizeInput(entry.content);
        valid.push({ role: entry.role, content: clean });
    }
    return valid;
}

// ─── Helper: build userContext from request ────────────────────────────────────
async function buildUserContext(req, context = {}) {
    const project = context.project || req.query.project || '';

    const userContext = {
        userName:       (req.user && (req.user.name || req.user.email)) || 'User',
        userRole:       (req.user && req.user.role) || 'user',
        userId:         (req.user && req.user.email) || '',
        project,
        page:           context.page           || '',
        module:         context.module         || '',
        step:           context.step           || '',
        address:        context.address        || '',
        canEdit:        false,
        aiEdit:         false,
        language:       context.language       || 'en',
        idleSeconds:    context.idleSeconds    || 0,
        projectSummary: context.projectSummary || '',
        attachedFile:   context.attachedFile   || '',
    };

    // Superadmin has full permissions
    if (req.user && req.user.role === 'superadmin') {
        userContext.canEdit = true;
        userContext.aiEdit  = true;
        return userContext;
    }

    // Check ACL for regular users
    if (project && req.user && req.user.email) {
        try {
            const acl = await accessControl.getUserAccess(req.user.email);
            if (acl) {
                if (acl.fullAccess === true) {
                    userContext.canEdit = true;
                    userContext.aiEdit  = true;
                } else {
                    const projectAccess = acl.projects && acl.projects[project];
                    if (projectAccess && projectAccess.access === true) {
                        userContext.canEdit = projectAccess.canEdit === true;
                        userContext.aiEdit  = projectAccess.aiEdit  === true;
                    }
                }
            }
        } catch (e) {
            // Default: no edit permissions on ACL read error
        }
    }

    return userContext;
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', aiRateLimitMiddleware, express_json_50kb, async (req, res) => {
    try {
        if (!process.env.AI_API_KEY || process.env.AI_ENABLED !== 'true') {
            return res.status(503).json({ error: 'AI assistant is not configured.' });
        }

        const { message, chatHistory = [], context = {}, model = 'standard' } = req.body;

        // Reject empty / whitespace-only messages early (also done in controller)
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message is required and cannot be empty.' });
        }

        // Validate project name if provided
        const projectFromContext = context.project || req.query.project || '';
        if (projectFromContext && !isValidProject(projectFromContext)) {
            return res.status(400).json({ error: 'Invalid project name.' });
        }

        // Validate and sanitize chat history
        const validatedHistory = validateChatHistory(chatHistory);

        const userContext = await buildUserContext(req, context);

        // Model selection: 'pro' uses AI_MODEL_PRO, anything else uses AI_MODEL
        userContext.modelType = (model === 'pro') ? 'pro' : 'standard';

        const result = await handleChat(message, validatedHistory, userContext);

        res.json(result);
    } catch (err) {
        console.error('[aiRoutes] /chat error:', err.message);
        res.status(500).json({ error: 'AI is taking a coffee break. Try again in a moment! ☕' });
    }
});

// ─── POST /api/ai/proactive ───────────────────────────────────────────────────
router.post('/proactive', aiRateLimitMiddleware, express_json_50kb, async (req, res) => {
    try {
        if (!process.env.AI_API_KEY || process.env.AI_ENABLED !== 'true') {
            return res.status(503).json({ error: 'AI not configured.' });
        }

        const { context = {} } = req.body;
        const userContext = await buildUserContext(req, context);
        const suggestion  = await handleProactive(userContext);

        res.json({ suggestion });
    } catch (err) {
        console.error('[aiRoutes] /proactive error:', err.message);
        res.status(500).json({ error: 'Could not generate suggestion.' });
    }
});

// ─── GET /api/ai/memory ───────────────────────────────────────────────────────
// Returns raw memory data. Superadmin: any user. Regular user: own memory only.
router.get('/memory', async (req, res) => {
    try {
        const reqUserId    = req.user && req.user.email;
        const isSuperadmin = req.user && req.user.role === 'superadmin';

        const project = req.query.project || '';
        const userId  = req.query.userId  || reqUserId;

        if (!project || !userId) {
            return res.status(400).json({ error: 'project and userId are required.' });
        }

        if (!isValidProject(project)) {
            return res.status(400).json({ error: 'Invalid project name.' });
        }

        // Regular users can only view their own memory
        if (!isSuperadmin && userId !== reqUserId) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        res.json({
            recentContext: aiMemory.loadRecentContext(project, userId),
            preferences:   aiMemory.loadPreferences(project, userId),
            context:       aiMemory.loadContext(project, userId),
            notes:         aiMemory.loadNotes(project, userId),
            hasMemory:     aiMemory.hasMemory(project, userId),
        });
    } catch (err) {
        console.error('[aiRoutes] GET /memory error:', err.message);
        res.status(500).json({ error: 'Could not read memory.' });
    }
});

// ─── GET /api/ai/memory/status ────────────────────────────────────────────────
// Lightweight check: does DoBo have memory for the current user+project?
router.get('/memory/status', (req, res) => {
    try {
        const userId  = req.user && req.user.email;
        const project = req.query.project || '';
        if (!userId || !project) return res.json({ hasMemory: false });
        if (!isValidProject(project)) return res.json({ hasMemory: false });
        res.json({ hasMemory: aiMemory.hasMemory(project, userId) });
    } catch (err) {
        res.json({ hasMemory: false });
    }
});

// ─── DELETE /api/ai/memory ────────────────────────────────────────────────────
// Clears DoBo memory for a user+project.
router.delete('/memory', (req, res) => {
    try {
        const reqUserId    = req.user && req.user.email;
        const isSuperadmin = req.user && req.user.role === 'superadmin';

        const project = req.query.project || '';
        const userId  = req.query.userId  || reqUserId;

        if (!project || !userId) {
            return res.status(400).json({ error: 'project and userId are required.' });
        }

        if (!isValidProject(project)) {
            return res.status(400).json({ error: 'Invalid project name.' });
        }

        if (!isSuperadmin && userId !== reqUserId) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        aiMemory.clearMemory(project, userId);
        res.json({ success: true, message: 'DoBo memory cleared.' });
    } catch (err) {
        console.error('[aiRoutes] DELETE /memory error:', err.message);
        res.status(500).json({ error: 'Could not clear memory.' });
    }
});

// ─── POST /api/ai/context ─────────────────────────────────────────────────────
// Save a context snapshot (called periodically by the frontend, debounced).
router.post('/context', express_json_50kb, (req, res) => {
    try {
        const userId  = req.user && req.user.email;
        const project = req.body.project || req.query.project || '';
        const context = req.body.context || {};

        if (!userId || !project) {
            return res.status(400).json({ error: 'project is required.' });
        }

        if (!isValidProject(project)) {
            return res.status(400).json({ error: 'Invalid project name.' });
        }

        aiMemory.saveContext(project, userId, context);
        res.json({ success: true });
    } catch (err) {
        console.error('[aiRoutes] POST /context error:', err.message);
        res.status(500).json({ error: 'Could not save context.' });
    }
});

// ─── POST /api/ai/upload ─────────────────────────────────────────────────────
// Upload a file to the AI uploads folder (max 5/day per user).
router.post('/upload', checkDailyUploadLimit, aiUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    // Increment daily counter
    const key = req._uploadKey;
    if (key) _uploadDailyStore[key] = (_uploadDailyStore[key] || 0) + 1;
    res.json({ success: true, filename: req.file.filename, message: 'File uploaded successfully.' });
});

// ─── POST /api/ai/edit-request ────────────────────────────────────────────────
// Forward a user's edit request to the admin (via email + file log).
router.post('/edit-request', editRateLimiter, express_json_50kb, async (req, res) => {
    try {
        const { message, context = {}, attachment } = req.body;

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const info = {
            userName:    (req.user.name || req.user.email),
            userEmail:   req.user.email,
            userRole:    req.user.role || 'user',
            projectName: context.project || req.query.project || 'N/A',
            page:        context.page   || '',
            module:      context.module || '',
            message:     message.slice(0, 2000),
            attachment:  attachment     || '',
        };

        await sendEditRequest(info);
        res.json({ success: true, message: 'Your request has been forwarded to the administrator.' });
    } catch (err) {
        console.error('[aiRoutes] POST /edit-request error:', err.message);
        res.status(500).json({ error: 'Could not forward request. Please try again.' });
    }
});

// ─── POST /api/ai/edit-requests/acknowledge ───────────────────────────────────
// Superadmin only: mark all pending edit requests as read.
router.post('/edit-requests/acknowledge', (req, res) => {
    try {
        if (req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Superadmin only.' });
        }
        markPendingRead();
        res.json({ success: true });
    } catch (err) {
        console.error('[aiRoutes] POST /edit-requests/acknowledge error:', err.message);
        res.status(500).json({ error: 'Could not acknowledge requests.' });
    }
});

module.exports = router;
