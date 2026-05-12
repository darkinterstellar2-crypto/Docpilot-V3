const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { superLog } = require('../controllers/superLogger');

const SETTINGS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'settings.json');

async function getSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { generatorCode: '', generatorUrl: '', generatorApiUrl: '', generatorAllowedUsers: [] };
    }
}

async function saveSettings(settings) {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// GET /api/settings — get all settings (superadmin only)
router.get('/', async (req, res) => {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }
    const settings = await getSettings();
    res.json({ success: true, settings });
});

// PUT /api/settings — update settings (superadmin only)
router.put('/', async (req, res) => {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }
    try {
        const current = await getSettings();
        const updated = { ...current, ...req.body };
        // Ensure generatorAllowedUsers is always an array
        if (!Array.isArray(updated.generatorAllowedUsers)) {
            updated.generatorAllowedUsers = current.generatorAllowedUsers || [];
        }
        await saveSettings(updated);
        superLog('admin', 'info', `Settings updated by ${req.headers['x-user-email']}`, { changes: Object.keys(req.body) });
        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// GET /api/settings/generator-access — check if current user has generator access (any authenticated user)
router.get('/generator-access', async (req, res) => {
    const email = (req.headers['x-user-email'] || '').toLowerCase().trim();
    const role = (req.headers['x-user-role'] || '').toLowerCase();

    if (!email) {
        return res.status(400).json({ success: false, message: 'User email required' });
    }

    const settings = await getSettings();
    const allowedUsers = Array.isArray(settings.generatorAllowedUsers) ? settings.generatorAllowedUsers : [];

    // Superadmin always has access
    const hasAccess = role === 'superadmin' || allowedUsers.map(e => e.toLowerCase().trim()).includes(email);

    res.json({
        success: true,
        hasAccess,
        generatorUrl: settings.generatorUrl || '',
        generatorApiUrl: settings.generatorApiUrl || ''
    });
});

// POST /api/settings/verify-code — verify generator code (any authenticated user) — kept for backward compat
router.post('/verify-code', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Code required' });
    
    const settings = await getSettings();
    const valid = code === settings.generatorCode;
    
    if (valid) {
        res.json({ success: true, generatorUrl: settings.generatorUrl, generatorApiUrl: settings.generatorApiUrl || '' });
    } else {
        res.status(403).json({ success: false, message: 'Invalid code' });
    }
});

module.exports = router;
