const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { logAction } = require('../controllers/logger');
const { superLog } = require('../controllers/superLogger');
const { verifyPassword, hashPassword } = require('../controllers/passwordHelper');

const USERS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');
const AVATARS_DIR = path.join(__dirname, '..', 'src', 'DataFiles', 'avatars');

// Ensure avatars directory exists
fs.mkdir(AVATARS_DIR, { recursive: true }).catch(() => {});

// Multer config for avatar uploads (max 2MB, images only)
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

async function getUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── GET /api/profile — get current user's profile ────────────────────────────
router.get('/', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    try {
        const users = await getUsers();
        const user = users.find(u => u.email === email);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        res.json({
            success: true,
            profile: {
                name: user.name,
                username: user.username,
                email: user.email,
                role: user.role,
                avatar: user.avatar || null,
                createdAt: user.createdAt
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
        const users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found' });

        const changes = [];

        if (name && name.trim()) {
            const oldName = users[userIndex].name;
            users[userIndex].name = name.trim();
            if (oldName !== name.trim()) changes.push(`name: "${oldName}" → "${name.trim()}"`);
        }

        if (username && username.trim()) {
            // Check username uniqueness (case-insensitive)
            const taken = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.email !== email);
            if (taken) return res.status(400).json({ success: false, message: 'Username already taken' });

            const oldUsername = users[userIndex].username;
            users[userIndex].username = username.trim();
            if (oldUsername !== username.trim()) changes.push(`username: "${oldUsername}" → "${username.trim()}"`);
        }

        if (changes.length === 0) {
            return res.json({ success: true, message: 'No changes made' });
        }

        await saveUsers(users);
        await logAction(email, 'Profile Updated', changes.join(', '));
        superLog('auth', 'info', `Profile updated: ${email}`, { email, changes });

        res.json({
            success: true,
            message: 'Profile updated',
            name: users[userIndex].name,
            username: users[userIndex].username
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── PUT /api/profile/password — change password ──────────────────────────────
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
        const users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found' });

        const passwordValid = await verifyPassword(currentPassword, users[userIndex].password);
        if (!passwordValid) {
            return res.status(403).json({ success: false, message: 'Current password is incorrect' });
        }

        users[userIndex].password = await hashPassword(newPassword);
        await saveUsers(users);
        await logAction(email, 'Password Changed', 'User changed their password');
        superLog('auth', 'info', `Password changed: ${email}`, { email });

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── POST /api/profile/avatar — upload profile picture ────────────────────────
router.post('/avatar', upload.single('avatar'), async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    try {
        const users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found' });

        // Delete old avatar if exists
        if (users[userIndex].avatar) {
            const oldPath = path.join(AVATARS_DIR, path.basename(users[userIndex].avatar));
            await fs.unlink(oldPath).catch(() => {});
        }

        // Save new avatar with user ID as filename
        const ext = path.extname(req.file.originalname).toLowerCase();
        const filename = `${users[userIndex].id}${ext}`;
        const filePath = path.join(AVATARS_DIR, filename);
        await fs.writeFile(filePath, req.file.buffer);

        // Update user record
        users[userIndex].avatar = `/api/profile/avatar/${filename}`;
        await saveUsers(users);

        superLog('auth', 'info', `Avatar updated: ${email}`, { email });

        res.json({ success: true, avatar: users[userIndex].avatar });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── DELETE /api/profile/avatar — remove profile picture ──────────────────────
router.delete('/avatar', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (!email) return res.status(401).json({ success: false, message: 'Not authenticated' });

    try {
        const users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found' });

        if (users[userIndex].avatar) {
            const oldPath = path.join(AVATARS_DIR, path.basename(users[userIndex].avatar));
            await fs.unlink(oldPath).catch(() => {});
            users[userIndex].avatar = null;
            await saveUsers(users);
        }

        res.json({ success: true, message: 'Avatar removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── GET /api/profile/avatar/:filename — serve avatar image ───────────────────
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

// ── GET /api/profile/check-username?username=X — real-time uniqueness check ──
router.get('/check-username', async (req, res) => {
    const email = req.headers['x-user-email'];
    const { username } = req.query;

    if (!username || !username.trim()) {
        return res.json({ success: true, available: false, message: 'Username required' });
    }

    try {
        const users = await getUsers();
        const taken = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.email !== email);
        res.json({ success: true, available: !taken, message: taken ? 'Username already taken' : 'Available' });
    } catch {
        res.json({ success: true, available: true });
    }
});

module.exports = router;
