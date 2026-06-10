// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// Settings stored in tenant_settings table (one row per tenant).
// Schema: id, tenant_id, generator_code, generator_url, generator_api_url, generator_allowed_users (TEXT[])

const express = require('express');
const router = express.Router();
const db = require('../controllers/db');
const { superLog } = require('../controllers/superLogger');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

const DEFAULT_SETTINGS = {
    generatorCode:         '',
    generatorUrl:          '',
    generatorApiUrl:       '',
    generatorAllowedUsers: []
};

async function getSettings() {
    try {
        const r = await db.query(
            `SELECT generator_code, generator_url, generator_api_url, generator_allowed_users
             FROM tenant_settings
             WHERE tenant_id = $1`,
            [TENANT_ID]
        );
        if (!r.rows[0]) return { ...DEFAULT_SETTINGS };
        const row = r.rows[0];
        return {
            generatorCode:         row.generator_code         || '',
            generatorUrl:          row.generator_url          || '',
            generatorApiUrl:       row.generator_api_url      || '',
            generatorAllowedUsers: Array.isArray(row.generator_allowed_users) ? row.generator_allowed_users : []
        };
    } catch (e) {
        console.error('[settingsRoutes] getSettings error:', e.message);
        return { ...DEFAULT_SETTINGS };
    }
}

async function saveSettings(settings) {
    await db.query(
        `INSERT INTO tenant_settings (tenant_id, generator_code, generator_url, generator_api_url, generator_allowed_users)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET
           generator_code         = EXCLUDED.generator_code,
           generator_url          = EXCLUDED.generator_url,
           generator_api_url      = EXCLUDED.generator_api_url,
           generator_allowed_users = EXCLUDED.generator_allowed_users,
           updated_at             = NOW()`,
        [
            TENANT_ID,
            settings.generatorCode         || '',
            settings.generatorUrl          || '',
            settings.generatorApiUrl       || '',
            Array.isArray(settings.generatorAllowedUsers) ? settings.generatorAllowedUsers : []
        ]
    );
}

// GET /api/settings
router.get('/', async (req, res) => {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }
    const settings = await getSettings();
    res.json({ success: true, settings });
});

// PUT /api/settings
router.put('/', async (req, res) => {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }
    try {
        const current = await getSettings();
        const updated = { ...current, ...req.body };
        if (!Array.isArray(updated.generatorAllowedUsers)) {
            updated.generatorAllowedUsers = current.generatorAllowedUsers || [];
        }
        await saveSettings(updated);
        superLog('admin', 'info', `Settings updated by ${req.headers['x-user-email']}`, { changes: Object.keys(req.body) });
        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        console.error('[settingsRoutes] PUT error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// GET /api/settings/generator-access
router.get('/generator-access', async (req, res) => {
    const email = (req.headers['x-user-email'] || '').toLowerCase().trim();
    const role  = (req.headers['x-user-role']  || '').toLowerCase();

    if (!email) return res.status(400).json({ success: false, message: 'User email required' });

    const settings = await getSettings();
    const allowedUsers = Array.isArray(settings.generatorAllowedUsers) ? settings.generatorAllowedUsers : [];
    const hasAccess = role === 'superadmin' || allowedUsers.map(e => e.toLowerCase().trim()).includes(email);

    res.json({
        success: true,
        hasAccess,
        generatorUrl:    settings.generatorUrl    || '',
        generatorApiUrl: settings.generatorApiUrl || ''
    });
});

// POST /api/settings/verify-code (backward compat)
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
