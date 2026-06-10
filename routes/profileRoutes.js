// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// All profile data (name, username, password, avatar, 2FA) uses the users table.
// Avatar files remain on the filesystem (binary blobs stay on disk).

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const db = require('../controllers/db');
const { logAction } = require('../controllers/logger');
const { superLog } = require('../controllers/superLogger');
const { verifyPassword, hashPassword } = require('../controllers/passwordHelper');

const AVATARS_DIR = path.join(__dirname, '..', 'src', 'DataFiles', 'avatars');
fs.mkdir(AVATARS_DIR, { recursive: true }).catch(() => {});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
});

async function findUser(email) {
    const r = await db.query(
        `SELECT id, email, username, name, password_hash AS password, role,
                avatar_url AS avatar, created_at AS "createdAt",
                two_fa_enabled AS "twoFAEnabled"
         FROM users
         WHERE LOWER(email) = LOWER($1)`,
        [email]
    );
    return r.rows[0] || null;
}

// ── GET /api/profile ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        res.json({
            success: true,
            profile: {
                name:          user.name,
                username:      user.username,
                email:         user.email,
                role:          user.role,
                avatar:        user.avatar || null,
                createdAt:     user.createdAt,
                twoFAEnabled:  user.twoFAEnabled === true || (user.role === 'superadmin' && user.twoFAEnabled !== false)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── PUT /api/profile — update name and/or username ───────────────────────────

router.put('/', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const { name, username } = req.body;

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const changes = [];

        if (name && name.trim() && name.trim() !== user.name) {
            await db.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [name.trim(), user.id]);
            changes.push(`name: "${user.name}" → "${name.trim()}"`);
            user.name = name.trim();
        }

        if (username && username.trim() && username.trim() !== user.username) {
            const taken = await db.query(
                `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2`,
                [username.trim(), user.id]
            );
            if (taken.rows.length > 0) return res.status(400).json({ success: false, message: 'Username already taken' });

            await db.query('UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2', [username.trim(), user.id]);
            changes.push(`username: "${user.username}" → "${username.trim()}"`);
            user.username = username.trim();
        }

        if (changes.length === 0) {
            return res.json({ success: true, message: 'No changes made' });
        }

        await logAction(email, 'Profile Updated', changes.join(', '));
        superLog('auth', 'info', `Profile updated: ${email}`, { email, changes });

        res.json({ success: true, message: 'Profile updated', name: user.name, username: user.username });
    } catch (error) {
        console.error('[profileRoutes] PUT error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── PUT /api/profile/password ─────────────────────────────────────────────────

router.put('/password', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const { match } = await verifyPassword(currentPassword, user.password);
        if (!match) return res.status(403).json({ success: false, message: 'Current password is incorrect' });

        const newHash = await hashPassword(newPassword);
        await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, user.id]);

        await logAction(email, 'Password Changed', 'User changed their password');
        superLog('auth', 'info', `Password changed: ${email}`, { email });

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── POST /api/profile/avatar ──────────────────────────────────────────────────

router.post('/avatar', upload.single('avatar'), async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Delete old avatar
        if (user.avatar) {
            const oldPath = path.join(AVATARS_DIR, path.basename(user.avatar));
            await fs.unlink(oldPath).catch(() => {});
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const filename = `${user.id}${ext}`;
        const filePath = path.join(AVATARS_DIR, filename);
        await fs.writeFile(filePath, req.file.buffer);

        const avatarUrl = `/api/profile/avatar/${filename}`;
        await db.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, user.id]);

        superLog('auth', 'info', `Avatar updated: ${email}`, { email });
        res.json({ success: true, avatar: avatarUrl });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── DELETE /api/profile/avatar ────────────────────────────────────────────────

router.delete('/avatar', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.avatar) {
            const oldPath = path.join(AVATARS_DIR, path.basename(user.avatar));
            await fs.unlink(oldPath).catch(() => {});
            await db.query('UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1', [user.id]);
        }

        res.json({ success: true, message: 'Avatar removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── GET /api/profile/avatar/:filename ────────────────────────────────────────

router.get('/avatar/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ success: false, message: 'Invalid filename' });
    }
    const filePath = path.join(AVATARS_DIR, filename);
    try {
        await fs.access(filePath);
        res.sendFile(filePath);
    } catch {
        res.status(404).json({ success: false, message: 'Avatar not found' });
    }
});

// ── PUT /api/profile/2fa ──────────────────────────────────────────────────────

router.put('/2fa', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: '`enabled` must be a boolean' });
    }

    try {
        const user = await findUser(email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        await db.query('UPDATE users SET two_fa_enabled = $1, updated_at = NOW() WHERE id = $2', [enabled, user.id]);
        await logAction(email, '2FA Updated', `2FA ${enabled ? 'enabled' : 'disabled'} by user`);
        superLog('auth', 'info', `2FA ${enabled ? 'enabled' : 'disabled'}: ${email}`, { email });

        res.json({ success: true, twoFAEnabled: enabled });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── GET /api/profile/check-username ──────────────────────────────────────────

router.get('/check-username', async (req, res) => {
    const email = req.headers['x-user-email'];
    const { username } = req.query;

    if (!username || !username.trim()) {
        return res.json({ success: true, available: false, message: 'Username required' });
    }

    try {
        const taken = await db.query(
            `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND (email IS NULL OR LOWER(email) != LOWER($2))`,
            [username.trim(), email || '']
        );
        res.json({ success: true, available: taken.rows.length === 0, message: taken.rows.length > 0 ? 'Username already taken' : 'Available' });
    } catch {
        res.json({ success: true, available: true });
    }
});

module.exports = router;
