// PostgreSQL migration: 2026-06-10
// Changed from per-project SQLite (via chatDb.js) to PostgreSQL chat_messages table.
// chatDb.js is now PostgreSQL-backed — no other changes needed in route logic.
// Same API response format preserved.

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { getChatMediaDir } = require('../controllers/storageConfig');
const {
    sendMessage,
    getMessages,
    getNewMessages,
    getMessageCount,
    editMessage,
    deleteMessage,
} = require('../controllers/chatDb');
const { canAccessProject, canAccessModule } = require('../controllers/accessControl');
const { superLog } = require('../controllers/superLogger');

// Multer: chat media uploads stored on filesystem (binary stays on disk)
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const project = req.query.project || req.body.project || '';
            const mediaDir = getChatMediaDir(project);
            fs.mkdirSync(mediaDir, { recursive: true });
            cb(null, mediaDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        }
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ── ACL check helper ──────────────────────────────────────────────────────────

async function checkChatAccess(req, projectName) {
    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role']  || '').toLowerCase();
    if (role === 'superadmin') return true;
    if (!await canAccessProject(email, projectName)) return false;
    if (!await canAccessModule(email, projectName, 'chat')) return false;
    return true;
}

// ── GET /api/chat/messages?project=X&limit=50&offset=0 ────────────────────────

router.get('/messages', async (req, res) => {
    const { project, limit = 50, offset = 0 } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    if (!await checkChatAccess(req, project)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const [messages, total] = await Promise.all([
            getMessages({ project, limit: parseInt(limit), offset: parseInt(offset) }),
            getMessageCount({ project })
        ]);
        res.json({ success: true, messages, total });
    } catch (e) {
        console.error('[chatRoutes] getMessages error:', e.message);
        res.status(500).json({ success: false, message: 'Could not fetch messages.' });
    }
});

// ── GET /api/chat/poll?project=X&after_id=N (long-poll) ──────────────────────

router.get('/poll', async (req, res) => {
    const { project, after_id } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    if (!await checkChatAccess(req, project)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const messages = await getNewMessages({ project, after_id: parseInt(after_id) || 0 });
        res.json({ success: true, messages });
    } catch (e) {
        console.error('[chatRoutes] poll error:', e.message);
        res.status(500).json({ success: false, message: 'Could not poll messages.' });
    }
});

// ── POST /api/chat/send?project=X ─────────────────────────────────────────────

router.post('/send', upload.single('media'), async (req, res) => {
    const project = req.query.project || req.body.project || '';
    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    if (!await checkChatAccess(req, project)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const userEmail = req.headers['x-user-email'] || 'Unknown';
    const userName  = req.headers['x-user-name']  || req.body.user_name || userEmail;
    const message   = req.body.message || '';

    let media_url = null;
    let media_type = null;
    let original_filename = null;

    if (req.file) {
        const mediaDir = getChatMediaDir(project);
        const relPath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
        media_url = `/storage-media/${relPath}`;
        media_type = req.file.mimetype;
        original_filename = req.file.originalname;
    }

    if (!message && !media_url) {
        return res.status(400).json({ success: false, message: 'Message or media required.' });
    }

    try {
        const msg = await sendMessage({
            project,
            user_email: userEmail,
            user_name:  userName,
            message,
            media_url,
            media_type,
            original_filename
        });
        superLog('chat', 'info', `Message sent in ${project} by ${userEmail}`, { project, userEmail });
        res.json({ success: true, message: msg });
    } catch (e) {
        console.error('[chatRoutes] send error:', e.message);
        res.status(500).json({ success: false, message: 'Could not send message.' });
    }
});

// ── PUT /api/chat/edit/:id?project=X ─────────────────────────────────────────

router.put('/edit/:id', async (req, res) => {
    const { id } = req.params;
    const project   = req.query.project || '';
    const userEmail = req.headers['x-user-email'] || '';
    const { message } = req.body;

    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });
    if (!message) return res.status(400).json({ success: false, message: 'Message text required.' });

    if (!await checkChatAccess(req, project)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const updated = await editMessage({ id: parseInt(id), project, user_email: userEmail, message });
        if (!updated) return res.status(403).json({ success: false, message: 'Cannot edit this message.' });
        res.json({ success: true });
    } catch (e) {
        console.error('[chatRoutes] edit error:', e.message);
        res.status(500).json({ success: false, message: 'Could not edit message.' });
    }
});

// ── DELETE /api/chat/delete/:id?project=X ────────────────────────────────────

router.delete('/delete/:id', async (req, res) => {
    const { id } = req.params;
    const project   = req.query.project || '';
    const userEmail = req.headers['x-user-email'] || '';
    const role      = (req.headers['x-user-role']  || '').toLowerCase();

    if (!project) return res.status(400).json({ success: false, message: 'Missing project parameter.' });

    if (!await checkChatAccess(req, project)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    try {
        const isAdmin = role === 'superadmin';
        const deleted = await deleteMessage({ id: parseInt(id), project, user_email: userEmail, isAdmin });
        if (!deleted) return res.status(403).json({ success: false, message: 'Cannot delete this message.' });
        res.json({ success: true });
    } catch (e) {
        console.error('[chatRoutes] delete error:', e.message);
        res.status(500).json({ success: false, message: 'Could not delete message.' });
    }
});

module.exports = router;
