// PostgreSQL migration: 2026-06-10
// Changed from flat file I/O to PostgreSQL queries via controllers/db.js
//
// - Registration: INSERT INTO users (after OTP verify)
// - Login: SELECT * FROM users WHERE email = $1 OR username = $1
// - Pending registrations: in-memory Map (unchanged — nothing hits DB until OTP verified)
// - Terminated sessions: SELECT FROM terminated_sessions

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const db = require('../controllers/db');
const { logAction } = require('../controllers/logger');
const { logSession, clearTermination } = require('../controllers/sessionLogger');
const { superLog } = require('../controllers/superLogger');
const { hashPassword, verifyPassword } = require('../controllers/passwordHelper');
const { createToken, checkRefreshEligible } = require('../controllers/tokenHelper');
const { checkAttempt, recordFailure, clearAttempts } = require('../controllers/rateLimiter');

const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

// Configure email transporter via environment variables
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// ── Pending 2FA verifications (in-memory, 5 min expiry) ─
const pending2FA = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of pending2FA) {
        if (now - entry.createdAt > 5 * 60 * 1000) pending2FA.delete(email);
    }
}, 30 * 1000);

// ── Pending registrations (in-memory — nothing saved until OTP verified) ─
const pendingRegistrations = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of pendingRegistrations) {
        if (now - new Date(entry.createdAt).getTime() > 15 * 60 * 1000) {
            pendingRegistrations.delete(email);
        }
    }
}, 60 * 1000);

// ── Helper: get user by email or username from DB ─
async function findUser(identifier) {
    const r = await db.query(
        `SELECT id, email, username, name, password_hash AS password, role,
                is_verified AS "isVerified", is_approved AS "isApproved",
                avatar_url AS avatar, created_at AS "createdAt",
                two_fa_enabled AS "twoFAEnabled"
         FROM users
         WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
         LIMIT 1`,
        [identifier]
    );
    return r.rows[0] || null;
}

// ── Helper: check terminated session ─
async function checkTerminated(email) {
    const r = await db.query(
        'SELECT user_email FROM terminated_sessions WHERE LOWER(user_email) = LOWER($1)',
        [email]
    );
    return r.rows.length > 0;
}

// --- 1. REGISTRATION ROUTE ---
router.post('/register', async (req, res) => {
    const { name, username, email, password } = req.body;

    if (!name || !username || !email || !password) {
        return res.status(400).json({ success: false, message: "All fields are required." });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    try {
        // Check if email/username already exist in users table
        const existing = await db.query(
            `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
            [email, username]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Email or Username already in use." });
        }

        // Check pending registrations for duplicate username
        for (const [pEmail, pEntry] of pendingRegistrations) {
            if (pEmail !== email && pEntry.username.toLowerCase() === username.toLowerCase()) {
                return res.status(400).json({ success: false, message: "Username already in use." });
            }
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`\n=== NEW REGISTRATION ===\nEmail: ${email}\nOTP: ${otp}\n========================\n`);

        const hashedPassword = await hashPassword(password);

        pendingRegistrations.set(email, {
            name,
            username,
            email,
            password: hashedPassword,
            otp,
            createdAt: new Date().toISOString()
        });

        superLog('auth', 'info', `OTP sent: ${email} (${username})`, { email, username, ip: req.ip });

        const mailOptions = {
            from: `"Geggos" <${process.env.SMTP_FROM}>`,
            to: email,
            subject: 'Your Geggos Verification Code',
            html: `<div style="font-family: Arial; padding: 20px;">
                <h2>Welcome to Geggos!</h2>
                <p>Your 6-digit verification code is: <b style="font-size: 24px; color: #2563eb;">${otp}</b></p>
                <p>Enter this code in the app to verify your email address.</p>
            </div>`
        };
        transporter.sendMail(mailOptions).catch(err => console.error("Email failed:", err));

        res.json({ success: true, message: "Verification code sent to email." });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ success: false, message: "Server error during registration." });
    }
});

// --- 2. VERIFY OTP ROUTE ---
router.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;

    try {
        const pending = pendingRegistrations.get(email);

        if (pending) {
            if (pending.otp !== otp) {
                await logAction(email, 'OTP Failed', `Failed OTP attempt for ${email}`);
                superLog('auth', 'warn', `OTP failed: ${email}`, { email, ip: req.ip });
                return res.status(400).json({ success: false, message: "Invalid verification code." });
            }

            // OTP correct — save user to PostgreSQL
            await db.query(
                `INSERT INTO users (email, username, name, password_hash, role, is_verified, is_approved, created_at)
                 VALUES ($1, $2, $3, $4, 'user', true, false, NOW())`,
                [pending.email, pending.username, pending.name, pending.password]
            );

            // Add tenant membership
            await db.query(
                `INSERT INTO tenant_memberships (tenant_id, user_id, role, joined_at)
                 SELECT $1, id, 'user', NOW() FROM users WHERE email = $2
                 ON CONFLICT (tenant_id, user_id) DO NOTHING`,
                [TENANT_ID, pending.email]
            );

            pendingRegistrations.delete(email);

            // Notify superadmins
            const admins = await db.query(
                `SELECT email, name FROM users WHERE role = 'superadmin' AND is_approved = true`
            );
            if (admins.rows.length > 0) {
                const adminEmails = admins.rows.map(a => a.email);
                const notifyMail = {
                    from: `"Geggos" <${process.env.SMTP_FROM}>`,
                    to: adminEmails,
                    subject: `New User Awaiting Approval: ${pending.username}`,
                    html: `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px;">
                        <h2 style="color: #2563eb;">New Registration</h2>
                        <p>A new user has completed email verification and is waiting for your approval.</p>
                        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                            <tr><td style="padding: 8px; font-weight: bold;">Name</td><td>${pending.name}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold;">Username</td><td>${pending.username}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold;">Email</td><td>${pending.email}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold;">Registered</td><td>${new Date(pending.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td></tr>
                        </table>
                    </div>`
                };
                transporter.sendMail(notifyMail).catch(err => console.error('[authRoutes] Admin notification failed:', err));
            }

            await logAction(email, 'Email Verified', `Account verified via OTP. Pending admin approval.`);
            superLog('auth', 'info', `OTP verified: ${email}`, { email, ip: req.ip });

            return res.json({ success: true, message: "Email verified! Waiting for admin approval." });
        }

        // Fallback: check users table for legacy OTP field (not applicable in V3, but keep the path)
        return res.status(404).json({ success: false, message: "No registration found. Please register again." });

    } catch (error) {
        console.error("OTP verify error:", error);
        res.status(500).json({ success: false, message: "Server error during verification." });
    }
});

// --- 3. LOGIN ROUTE ---
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body;

    const rateCheck = checkAttempt(req.ip, identifier);
    if (!rateCheck.allowed) {
        superLog('auth', 'warn', `Login rate-limited: ${identifier} from ${req.ip}`, { identifier, ip: req.ip });
        return res.status(429).json({
            success: false,
            message: `Too many failed attempts. Try again in ${Math.ceil(rateCheck.retryAfterSec / 60)} minutes.`,
            retryAfterSec: rateCheck.retryAfterSec
        });
    }

    try {
        const user = await findUser(identifier);

        if (!user) {
            recordFailure(req.ip, identifier);
            const remaining = checkAttempt(req.ip, identifier).remainingAttempts;
            logSession({ email: identifier, name: 'Unknown', action: 'login_failed', ip: req.ip, userAgent: req.headers['user-agent'] });
            await logAction(identifier, 'Login Failed', `Invalid credentials for ${identifier} (${remaining} attempts left)`);
            superLog('auth', 'warn', `Login failed: ${identifier} from ${req.ip} (${remaining} left)`, { identifier, ip: req.ip });
            return res.status(401).json({ success: false, message: "Invalid username/email or password." });
        }

        const { match, needsRehash } = await verifyPassword(password, user.password);

        if (!match) {
            recordFailure(req.ip, identifier);
            const remaining = checkAttempt(req.ip, identifier).remainingAttempts;
            logSession({ email: identifier, name: user.name || 'Unknown', action: 'login_failed', ip: req.ip, userAgent: req.headers['user-agent'] });
            await logAction(identifier, 'Login Failed', `Invalid credentials for ${identifier} (${remaining} attempts left)`);
            superLog('auth', 'warn', `Login failed: ${identifier} from ${req.ip} (${remaining} left)`, { identifier, ip: req.ip });
            return res.status(401).json({ success: false, message: "Invalid username/email or password." });
        }

        // Auto-migrate plain text password to bcrypt
        if (needsRehash) {
            const newHash = await hashPassword(password);
            await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
            superLog('auth', 'info', `Password auto-migrated to bcrypt: ${user.email}`, { email: user.email });
        }

        if (!user.isVerified) {
            return res.status(403).json({ success: false, message: "Please verify your email with the verification code first." });
        }

        if (!user.isApproved && user.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Account pending admin approval. Please wait." });
        }

        logSession({ email: user.email, name: user.name, action: 'login', ip: req.ip, userAgent: req.headers['user-agent'] });
        await logAction(user.email, 'Login Success', `User logged in to the system`);
        superLog('auth', 'info', `Login: ${user.email} from ${req.ip}`, { email: user.email, role: user.role, ip: req.ip });

        clearAttempts(req.ip, identifier);

        // 2FA check
        const requires2FA = user.twoFAEnabled === true || (user.role === 'superadmin' && user.twoFAEnabled !== false);
        if (requires2FA) {
            const otp2fa = Math.floor(100000 + Math.random() * 900000).toString();
            pending2FA.set(user.email, { otp: otp2fa, createdAt: Date.now(), ip: req.ip, userAgent: req.headers['user-agent'] });

            console.log(`\n=== 2FA OTP ===\nEmail: ${user.email}\nOTP: ${otp2fa}\n===============\n`);

            const mailOptions = {
                from: `"Geggos Security" <${process.env.SMTP_FROM}>`,
                to: user.email,
                subject: '🔐 DocPilot 2FA Verification Code',
                html: `<div style="font-family: Arial; padding: 20px;">
                    <h2 style="color: #dc2626;">Superadmin Login Verification</h2>
                    <p>Your verification code: <b style="font-size: 28px; color: #2563eb; letter-spacing: 4px;">${otp2fa}</b></p>
                    <p style="color: #888; font-size: 12px;">Expires in 5 minutes.</p>
                </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error('[2FA] Email failed:', err));
            superLog('auth', 'info', `2FA OTP sent to ${user.email}`, { email: user.email, ip: req.ip });

            return res.json({ success: true, requires2FA: true, email: user.email, message: 'Verification code sent to your email.' });
        }

        clearTermination(user.email);
        const token = createToken(user);

        res.json({ success: true, role: user.role, name: user.name, email: user.email, token });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// --- 3b. 2FA VERIFY ROUTE ---
router.post('/verify-2fa', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const entry = pending2FA.get(email);
    if (!entry) {
        return res.status(400).json({ success: false, message: 'No pending verification. Please log in again.' });
    }

    if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
        pending2FA.delete(email);
        return res.status(400).json({ success: false, message: 'Verification code expired. Please log in again.' });
    }

    if (entry.otp !== otp) {
        superLog('auth', 'warn', `2FA failed for ${email}`, { email, ip: req.ip });
        return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    pending2FA.delete(email);

    try {
        const user = await findUser(email);
        if (!user) return res.status(400).json({ success: false, message: 'User not found.' });

        clearTermination(user.email);
        logSession({ email: user.email, name: user.name, action: 'login', ip: req.ip, userAgent: req.headers['user-agent'] });
        await logAction(user.email, 'Login Success', `Superadmin login with 2FA verification`);
        superLog('auth', 'info', `2FA verified + Login: ${user.email} from ${req.ip}`, { email: user.email, role: user.role, ip: req.ip });

        const token = createToken(user);
        res.json({ success: true, role: user.role, name: user.name, email: user.email, token });
    } catch (error) {
        console.error("2FA verify error:", error);
        res.status(500).json({ success: false, message: 'Server error during 2FA verification.' });
    }
});

// --- 4. TOKEN REFRESH ROUTE ---
router.post('/refresh', async (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return res.status(401).json({ success: false, message: 'No token provided.' });

    const { eligible, decoded } = checkRefreshEligible(token);

    if (!decoded) {
        return res.status(401).json({ success: false, tokenExpired: true, message: 'Session expired. Please log in again.' });
    }

    if (!eligible) {
        return res.json({ success: true, refreshed: false, message: 'Token still valid, no refresh needed.' });
    }

    const newToken = createToken({ email: decoded.email, role: decoded.role, name: decoded.name });
    superLog('auth', 'info', `Token refreshed: ${decoded.email}`, { email: decoded.email, ip: req.ip });

    return res.json({ success: true, refreshed: true, token: newToken });
});

// --- 5. LOGOUT ROUTE ---
router.post('/logout', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required." });

    try {
        const user = await findUser(email);
        const name = user ? user.name : 'Unknown';

        logSession({ email, name, action: 'logout', ip: req.ip, userAgent: req.headers['user-agent'] });
        superLog('auth', 'info', `Logout: ${email}`, { email, ip: req.ip });

        res.json({ success: true });
    } catch (error) {
        console.error('[authRoutes] Logout error:', error.message);
        res.json({ success: true });
    }
});

module.exports = router;
