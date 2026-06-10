// routes/chatRoutes.js
// Chat API routes — per-project DB + per-project media storage.
//
// API endpoints (unchanged):
//   GET    /api/chat/:project              — fetch messages (paginated or poll)
//   POST   /api/chat/:project              — send message (text + optional media)
//   PUT    /api/chat/:project/:id          — edit a message
//   DELETE /api/chat/:project/:id          — delete a message
//   GET    /api/chat/:project/media/:filename — serve a media file

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs').promises;

const chatDb = require('../controllers/chatDb');
const { getChatMediaDir } = require('../controllers/storageConfig');
const { superLog } = require('../controllers/superLogger');

// ACL Engine
const { canAccessProject, canAccessModule } = require('../controllers/accessControl');

// ─── Multer — per-project media upload storage ─────────────────────────────────

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const project = decodeURIComponent(req.params.project);
            // getChatMediaDir returns storage/<project>/chat/media/
            const dir = getChatMediaDir(project);
            fs.mkdir(dir, { recursive: true })
                .then(() => cb(null, dir))
                .catch(err => cb(err));
        },
        filename: (req, file, cb) => {
            const ext  = path.extname(file.originalname) || '';
            const ts   = Date.now();
            const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            cb(null, `${ts}_${safe}`);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
    fileFilter: (req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|pdf|doc|docx|xls|xlsx)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'), false);
        }
    },
});

// ─── Media serving ─────────────────────────────────────────────────────────────

// GET /api/chat/:project/media/:filename — Serve a media file
router.get('/:project/media/:filename', async (req, res) => {
    try {
        const project  = decodeURIComponent(req.params.project);
        const filename = req.params.filename;

        // Prevent path traversal
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).send('Invalid filename');
        }

        const filePath = path.join(getChatMediaDir(project), filename);
        await fs.access(filePath);
        res.sendFile(filePath);
    } catch {
        res.status(404).send('File not found');
    }
});

// ─── Message routes ────────────────────────────────────────────────────────────

// GET /api/chat/:project — Fetch messages (paginated or polling)
// Query params: ?limit=50&offset=0  OR  ?after=<lastMessageId>
router.get('/:project', async (req, res) => {
    try {
        const project = decodeURIComponent(req.params.project);

        // ACL enforcement (skip for superadmin)
        const chatGetEmail = req.headers['x-user-email'] || '';
        const chatGetRole  = (req.headers['x-user-role']  || '').toLowerCase();
        if (chatGetRole !== 'superadmin') {
            const projectOk = await canAccessProject(chatGetEmail, project);
            if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
            const moduleOk = await canAccessModule(chatGetEmail, project, 'chat');
            if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: chat module not accessible.' });
        }
        const afterId = parseInt(req.query.after);

        if (afterId && !isNaN(afterId)) {
            // Polling mode: only new messages since lastId
            const messages = chatDb.getNewMessages({ project, after_id: afterId });
            return res.json({ success: true, messages, mode: 'poll' });
        }

        // Full fetch mode (paginated)
        const limit    = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset   = parseInt(req.query.offset) || 0;
        const messages = chatDb.getMessages({ project, limit, offset });
        const total    = chatDb.getMessageCount({ project });

        res.json({ success: true, messages, total, limit, offset });
    } catch (e) {
        console.error('Chat GET error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/chat/:project — Send a message (text or with media)
router.post('/:project', upload.single('media'), async (req, res) => {
    try {
        const project     = decodeURIComponent(req.params.project);

        // ACL enforcement (skip for superadmin)
        const chatPostEmail = req.headers['x-user-email'] || req.body.user_email || '';
        const chatPostRole  = (req.headers['x-user-role']  || '').toLowerCase();
        if (chatPostRole !== 'superadmin') {
            const projectOk = await canAccessProject(chatPostEmail, project);
            if (!projectOk) return res.status(403).json({ success: false, message: 'Access denied: project not accessible.' });
            const moduleOk = await canAccessModule(chatPostEmail, project, 'chat');
            if (!moduleOk) return res.status(403).json({ success: false, message: 'Access denied: chat module not accessible.' });
        }
        const messageText = (req.body.message || '').trim();
        const userEmail   = req.headers['x-user-email'] || req.body.user_email || 'Unknown';
        const userName    = req.headers['x-user-name']  || req.body.user_name  || userEmail.split('@')[0];

        // Build media metadata if a file was uploaded
        let mediaUrl  = null;
        let mediaType = null;
        if (req.file) {
            // URL path stays the same — frontend doesn't need to change
            mediaUrl = `/api/chat/${encodeURIComponent(project)}/media/${req.file.filename}`;
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) mediaType = 'image';
            else if (['.mp4', '.mov', '.avi', '.webm'].includes(ext))      mediaType = 'video';
            else                                                            mediaType = 'file';
        }

        if (!messageText && !mediaUrl) {
            return res.status(400).json({ success: false, message: 'Message or media required' });
        }

        const msg = chatDb.sendMessage({
            project,
            user_email:        userEmail,
            user_name:         userName,
            message:           messageText,
            media_url:         mediaUrl,
            media_type:        mediaType,
            original_filename: req.file ? req.file.originalname : null,
        });

        if (req.file) {
            superLog('chat', 'info', `Media uploaded: ${req.file.originalname} in ${project} by ${userEmail}`, {
                userEmail, project, filename: req.file.originalname, mediaType
            });
        } else {
            superLog('chat', 'info', `Message sent in ${project} by ${userEmail}`, {
                userEmail, project, messageLength: messageText.length
            });
        }

        res.json({ success: true, message: msg });
    } catch (e) {
        console.error('Chat POST error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// PUT /api/chat/:project/:id — Edit a message
router.put('/:project/:id', (req, res) => {
    try {
        const id        = parseInt(req.params.id);
        const project   = decodeURIComponent(req.params.project);
        const { message } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email || '';

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        }

        const success = chatDb.editMessage({ id, project, user_email: userEmail, message: message.trim() });
        res.json({ success });
    } catch (e) {
        console.error('Chat PUT error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// DELETE /api/chat/:project/:id — Delete a message
router.delete('/:project/:id', (req, res) => {
    try {
        const id        = parseInt(req.params.id);
        const project   = decodeURIComponent(req.params.project);
        const userEmail = req.headers['x-user-email'] || '';
        const userRole  = req.headers['x-user-role']  || '';
        const isAdmin   = userRole === 'superadmin';

        const success = chatDb.deleteMessage({ id, project, user_email: userEmail, isAdmin });
        res.json({ success });
    } catch (e) {
        console.error('Chat DELETE error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
