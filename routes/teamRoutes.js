// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// teams are stored in a teams table (if it exists in the schema).
// NOTE: teams table is not in the V3 schema spec — keeping teams in filesystem
// (teams.json) as it's not in scope for the DB migration per the schema design.
// Only users.json dependency replaced: available-users now queries users table.
//
// teams.json stays (it's not a core data file); users lookup migrated to PostgreSQL.

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const db = require('../controllers/db');

const TEAMS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'teams', 'teams.json');
const AVATARS_DIR = path.join(__dirname, '..', 'src', 'DataFiles', 'teams', 'avatars');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATARS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const teamId = req.params.id || `team-${Date.now()}`;
        cb(null, `${teamId}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

async function readTeams() {
    try {
        const raw = await fs.readFile(TEAMS_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function writeTeams(teams) {
    await fs.mkdir(path.dirname(TEAMS_FILE), { recursive: true });
    await fs.writeFile(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

function isSuperAdmin(req) {
    return (req.headers['x-user-role'] || '').toLowerCase() === 'superadmin';
}

// Resolve member details from users (PostgreSQL)
async function resolveMembers(team) {
    if (!team.members || team.members.length === 0) return team;
    const userIds = team.members.map(m => m.userId);
    const r = await db.query(
        `SELECT id, name, email, avatar_url AS avatar FROM users WHERE id = ANY($1) OR email = ANY($1)`,
        [userIds]
    );
    const userMap = {};
    for (const u of r.rows) {
        userMap[u.id] = u;
        userMap[u.email] = u;
    }
    return {
        ...team,
        members: team.members.map(m => {
            const user = userMap[m.userId];
            return {
                ...m,
                name:   user ? (user.name || user.email) : m.userId,
                email:  user ? user.email : '',
                avatar: user ? (user.avatar || null) : null
            };
        })
    };
}

// GET /api/teams/available-users — query from PostgreSQL users table
router.get('/available-users', async (req, res) => {
    try {
        const r = await db.query(`SELECT id, name, email, role FROM users ORDER BY name`);
        res.json({ success: true, users: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/teams
router.get('/', async (req, res) => {
    try {
        const teams = await readTeams();
        const resolved = await Promise.all(teams.map(t => resolveMembers(t)));
        res.json({ success: true, teams: resolved });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/teams/:id
router.get('/:id', async (req, res) => {
    try {
        const teams = await readTeams();
        const team = teams.find(t => t.id === req.params.id);
        if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });
        res.json({ success: true, team: await resolveMembers(team) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/teams
router.post('/', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const { name, description, members } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Team name required.' });
        const teams = await readTeams();
        const id = `team-${Date.now()}`;
        const now = new Date().toISOString();
        const newTeam = {
            id, name, description: description || '', picture: '',
            members: (members || []).map(m => typeof m === 'string' ? { userId: m, role: 'member' } : m),
            createdAt: now, updatedAt: now
        };
        teams.push(newTeam);
        await writeTeams(teams);
        res.json({ success: true, team: newTeam });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// PUT /api/teams/:id
router.put('/:id', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const teams = await readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Team not found.' });
        const { name, description } = req.body;
        if (name !== undefined) teams[idx].name = name;
        if (description !== undefined) teams[idx].description = description;
        teams[idx].updatedAt = new Date().toISOString();
        await writeTeams(teams);
        res.json({ success: true, team: teams[idx] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// DELETE /api/teams/:id
router.delete('/:id', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const teams = await readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Team not found.' });
        teams.splice(idx, 1);
        await writeTeams(teams);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/teams/:id/members
router.post('/:id/members', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const teams = await readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Team not found.' });
        const { userId, role } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'userId required.' });
        if (teams[idx].members.some(m => m.userId === userId)) {
            return res.status(400).json({ success: false, message: 'User already a member.' });
        }
        teams[idx].members.push({ userId, role: role || 'member' });
        teams[idx].updatedAt = new Date().toISOString();
        await writeTeams(teams);
        res.json({ success: true, team: teams[idx] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// DELETE /api/teams/:id/members/:userId
router.delete('/:id/members/:userId', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const teams = await readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Team not found.' });
        teams[idx].members = teams[idx].members.filter(m => m.userId !== req.params.userId);
        teams[idx].updatedAt = new Date().toISOString();
        await writeTeams(teams);
        res.json({ success: true, team: teams[idx] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/teams/:id/picture
router.post('/:id/picture', upload.single('picture'), async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
        const teams = await readTeams();
        const idx = teams.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Team not found.' });
        const picturePath = `/src/DataFiles/teams/avatars/${req.file.filename}`;
        teams[idx].picture = picturePath;
        teams[idx].updatedAt = new Date().toISOString();
        await writeTeams(teams);
        res.json({ success: true, picture: picturePath });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
