const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

const TEAMS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'teams', 'teams.json');
const USERS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');
const AVATARS_DIR = path.join(__dirname, '..', 'src', 'DataFiles', 'teams', 'avatars');

// Multer for team picture uploads
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
    await fs.writeFile(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

async function readUsers() {
    try {
        const raw = await fs.readFile(USERS_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function isSuperAdmin(req) {
    return (req.headers['x-user-role'] || '').toLowerCase() === 'superadmin';
}

// Resolve member details from users list
function resolveMembers(team, users) {
    return {
        ...team,
        members: (team.members || []).map(m => {
            const user = users.find(u => String(u.id) === String(m.userId) || u.email === m.userId);
            return {
                ...m,
                name: user ? (user.name || user.email) : m.userId,
                email: user ? user.email : '',
                avatar: user ? (user.avatar || user.picture || null) : null
            };
        })
    };
}

// GET /api/teams/available-users — list users for member selection
router.get('/available-users', async (req, res) => {
    try {
        const users = await readUsers();
        const safe = users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
        res.json({ success: true, users: safe });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/teams
router.get('/', async (req, res) => {
    try {
        const teams = await readTeams();
        const users = await readUsers();
        const resolved = teams.map(t => resolveMembers(t, users));
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
        const users = await readUsers();
        res.json({ success: true, team: resolveMembers(team, users) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/teams — create team (superadmin only)
router.post('/', async (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ success: false, message: 'Superadmin only.' });
    try {
        const { name, description, members } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Team name required.' });
        const teams = await readTeams();
        const id = `team-${Date.now()}`;
        const now = new Date().toISOString();
        const newTeam = {
            id,
            name,
            description: description || '',
            picture: '',
            members: (members || []).map(m => typeof m === 'string' ? { userId: m, role: 'member' } : m),
            createdAt: now,
            updatedAt: now
        };
        teams.push(newTeam);
        await writeTeams(teams);
        res.json({ success: true, team: newTeam });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// PUT /api/teams/:id — update team (superadmin only)
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

// DELETE /api/teams/:id — delete team (superadmin only)
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

// POST /api/teams/:id/members — add member (superadmin only)
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

// DELETE /api/teams/:id/members/:userId — remove member (superadmin only)
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

// POST /api/teams/:id/picture — upload team picture (superadmin only)
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
