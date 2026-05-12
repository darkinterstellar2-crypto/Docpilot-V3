const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const { logAction } = require('../controllers/logger');
const { logSession, clearTermination } = require('../controllers/sessionLogger');
const { superLog } = require('../controllers/superLogger');
const { hashPassword, verifyPassword } = require('../controllers/passwordHelper');
const { createToken, checkRefreshEligible } = require('../controllers/tokenHelper');
const { checkAttempt, recordFailure, clearAttempts } = require('../controllers/rateLimiter');

const USERS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'users.json');

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

// Helper function to get/init users db
async function getUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return []; // Return empty array if file doesn't exist yet
    }
}

// ── Pending 2FA verifications (in-memory, 5 min expiry) ─
// Map<email, { otp, createdAt, ip, userAgent }>
const pending2FA = new Map();

// Auto-cleanup: remove pending 2FA entries older than 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of pending2FA) {
        if (now - entry.createdAt > 5 * 60 * 1000) {
            pending2FA.delete(email);
        }
    }
}, 30 * 1000);

// ── Pending registrations (in-memory only — nothing saved until OTP verified) ─
// Map<email, { name, username, email, password, role, otp, createdAt }>
const pendingRegistrations = new Map();

// Auto-cleanup: remove pending entries older than 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of pendingRegistrations) {
        if (now - new Date(entry.createdAt).getTime() > 15 * 60 * 1000) {
            pendingRegistrations.delete(email);
        }
    }
}, 60 * 1000); // check every minute

// --- 1. REGISTRATION ROUTE ---
router.post('/register', async (req, res) => {
    const { name, username, email, password } = req.body;

    if (!name || !username || !email || !password) {
        return res.status(400).json({ success: false, message: "All fields are required." });
    }

    // Everyone registers as 'user' — superadmin is set manually in users.json
    const role = 'user';

    if (!password || password.length < 8) {
        return res.status(400).json({ 
            success: false, 
            message: "Password must be at least 8 characters." 
        });
    }

    try {
        const users = await getUsers();
        
        // Check if user already exists (in saved users OR pending registrations)
        if (users.find(u => u.email === email || u.username === username)) {
            return res.status(400).json({ success: false, message: "Email or Username already in use." });
        }
        // Check pending registrations for duplicate username (different email)
        for (const [pEmail, pEntry] of pendingRegistrations) {
            if (pEmail !== email && pEntry.username === username) {
                return res.status(400).json({ success: false, message: "Username already in use." });
            }
        }

        // Generate a 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Print OTP to terminal for local testing without email
        console.log(`\n=== NEW REGISTRATION ===\nEmail: ${email}\nOTP: ${otp}\n========================\n`);

        // Hash password before storing
        const hashedPassword = await hashPassword(password);

        // Store in memory ONLY — nothing touches users.json until OTP is verified
        pendingRegistrations.set(email, {
            id: Date.now().toString(),
            name,
            username,
            email,
            password: hashedPassword,
            role,
            otp,
            createdAt: new Date().toISOString()
        });
        
        // Don't log to persistent storage yet — only log when OTP is verified
        superLog('auth', 'info', `OTP sent: ${email} (${username})`, { email, username, ip: req.ip });

        // Send OTP via Email
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
        
        // Send email, catch errors silently to allow local testing
        transporter.sendMail(mailOptions).catch(err => console.error("Email failed to send (check credentials or network):", err));

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
        // Check pending registrations first (new flow: data only in memory until verified)
        const pending = pendingRegistrations.get(email);

        if (pending) {
            // Verify OTP against in-memory pending entry
            if (pending.otp !== otp) {
                await logAction(email, 'OTP Failed', `Failed OTP attempt for ${email}`);
                superLog('auth', 'warn', `OTP failed: ${email}`, { email, ip: req.ip });
                return res.status(400).json({ success: false, message: "Invalid verification code." });
            }

            // OTP correct — NOW save to users.json for the first time
            const users = await getUsers();
            users.push({
                id: pending.id,
                name: pending.name,
                username: pending.username,
                email: pending.email,
                password: pending.password,
                role: pending.role,
                isVerified: true,
                isApproved: false, // Still needs admin approval
                createdAt: pending.createdAt
            });
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

            // Remove from pending
            pendingRegistrations.delete(email);

            // Notify all superadmin users about the new registration
            const admins = users.filter(u => u.role === 'superadmin' && u.email);
            if (admins.length > 0) {
                const adminEmails = admins.map(a => a.email);
                const notifyMail = {
                    from: `"Geggos" <${process.env.SMTP_FROM}>`,
                    to: adminEmails,
                    subject: `New User Awaiting Approval: ${pending.username}`,
                    html: `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px;">
                        <h2 style="color: #2563eb;">New Registration</h2>
                        <p>A new user has completed email verification and is waiting for your approval.</p>
                        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                            <tr><td style="padding: 8px; font-weight: bold; color: #555;">Name</td><td style="padding: 8px;">${pending.name}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold; color: #555;">Username</td><td style="padding: 8px;">${pending.username}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold; color: #555;">Email</td><td style="padding: 8px;">${pending.email}</td></tr>
                            <tr><td style="padding: 8px; font-weight: bold; color: #555;">Registered</td><td style="padding: 8px;">${new Date(pending.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td></tr>
                        </table>
                        <p>Log in to the admin panel to approve or reject this user.</p>
                    </div>`
                };
                transporter.sendMail(notifyMail).catch(err => console.error('[authRoutes] Admin notification email failed:', err));
                superLog('auth', 'info', `Admin notification sent for: ${pending.email}`, { email: pending.email, notifiedAdmins: adminEmails });
            }

            await logAction(email, 'Email Verified', `Account verified via OTP. Pending admin approval.`);
            superLog('auth', 'info', `OTP verified: ${email}`, { email, ip: req.ip });

            return res.json({ success: true, message: "Email verified! Waiting for admin approval." });
        }

        // Fallback: check users.json (for legacy entries that were saved before this change)
        const users = await getUsers();
        const userIndex = users.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "No registration found. Please register again." });
        }

        if (users[userIndex].otp !== otp) {
            await logAction(email, 'OTP Failed', `Failed OTP attempt for ${email}`);
            superLog('auth', 'warn', `OTP failed: ${email}`, { email, ip: req.ip });
            return res.status(400).json({ success: false, message: "Invalid verification code." });
        }

        // Mark as verified and clear the OTP
        users[userIndex].isVerified = true;
        users[userIndex].otp = null; 

        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        await logAction(email, 'Email Verified', `Account verified via OTP. Pending admin approval.`);
        superLog('auth', 'info', `OTP verified: ${email}`, { email, ip: req.ip });

        res.json({ success: true, message: "Email verified! Waiting for admin approval." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during verification." });
    }
});

// --- 3. LOGIN ROUTE ---
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body; // identifier can be email OR username

    // Rate limit check
    const rateCheck = checkAttempt(req.ip, identifier);
    if (!rateCheck.allowed) {
        superLog('auth', 'warn', `Login rate-limited: ${identifier} from ${req.ip} (locked for ${rateCheck.retryAfterSec}s)`, { identifier, ip: req.ip });
        return res.status(429).json({
            success: false,
            message: `Too many failed attempts. Try again in ${Math.ceil(rateCheck.retryAfterSec / 60)} minutes.`,
            retryAfterSec: rateCheck.retryAfterSec
        });
    }

    try {
        const users = await getUsers();
        
        // Find user by email or username first
        const user = users.find(u => u.email === identifier || u.username === identifier);

        if (!user) {
            recordFailure(req.ip, identifier);
            const remaining = checkAttempt(req.ip, identifier).remainingAttempts;
            logSession({ email: identifier, name: 'Unknown', action: 'login_failed', ip: req.ip, userAgent: req.headers['user-agent'] });
            await logAction(identifier, 'Login Failed', `Invalid credentials for ${identifier} (${remaining} attempts left)`);
            superLog('auth', 'warn', `Login failed: ${identifier} from ${req.ip} (${remaining} left)`, { identifier, ip: req.ip, userAgent: req.headers['user-agent'] });
            return res.status(401).json({ success: false, message: "Invalid username/email or password." });
        }

        // Verify password (supports both bcrypt hashes and legacy plain text)
        const { match, needsRehash } = await verifyPassword(password, user.password);

        if (!match) {
            recordFailure(req.ip, identifier);
            const remaining = checkAttempt(req.ip, identifier).remainingAttempts;
            logSession({ email: identifier, name: user.name || 'Unknown', action: 'login_failed', ip: req.ip, userAgent: req.headers['user-agent'] });
            await logAction(identifier, 'Login Failed', `Invalid credentials for ${identifier} (${remaining} attempts left)`);
            superLog('auth', 'warn', `Login failed: ${identifier} from ${req.ip} (${remaining} left)`, { identifier, ip: req.ip, userAgent: req.headers['user-agent'] });
            return res.status(401).json({ success: false, message: "Invalid username/email or password." });
        }

        // Auto-migrate plain text password to bcrypt
        if (needsRehash) {
            user.password = await hashPassword(password);
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
            superLog('auth', 'info', `Password auto-migrated to bcrypt: ${user.email}`, { email: user.email });
        }

        // Security Check 1: Did they verify their email?
        if (!user.isVerified) {
            return res.status(403).json({ success: false, message: "Please verify your email with the verification code first." });
        }

        // Security Check 2: Has an admin approved them?
        if (!user.isApproved && user.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Account pending admin approval. Please wait." });
        }

        // Log successful login
        logSession({
            email: user.email,
            name: user.name,
            action: 'login',
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        await logAction(user.email, 'Login Success', `User logged in to the system`);
        superLog('auth', 'info', `Login: ${user.email} from ${req.ip}`, {
            email: user.email, role: user.role, ip: req.ip, userAgent: req.headers['user-agent']
        });

        // Clear rate limiter on successful password
        clearAttempts(req.ip, identifier);

        // 2FA for superadmin — require OTP on every login
        if (user.role === 'superadmin') {
            const otp2fa = Math.floor(100000 + Math.random() * 900000).toString();
            pending2FA.set(user.email, {
                otp: otp2fa,
                createdAt: Date.now(),
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            console.log(`\n=== 2FA OTP ===\nEmail: ${user.email}\nOTP: ${otp2fa}\n===============\n`);

            // Send OTP email
            const mailOptions = {
                from: `"Geggos Security" <${process.env.SMTP_FROM}>`,
                to: user.email,
                subject: '🔐 DocPilot 2FA Verification Code',
                html: `<div style="font-family: Arial; padding: 20px;">
                    <h2 style="color: #dc2626;">Superadmin Login Verification</h2>
                    <p>A login attempt was made for your superadmin account.</p>
                    <p style="font-size: 14px; color: #555;">IP: ${req.ip}<br>Device: ${req.headers['user-agent'] || 'Unknown'}</p>
                    <p>Your verification code: <b style="font-size: 28px; color: #2563eb; letter-spacing: 4px;">${otp2fa}</b></p>
                    <p style="color: #888; font-size: 12px;">This code expires in 5 minutes. If you did not attempt to log in, change your password immediately.</p>
                </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error('[2FA] Email failed:', err));
            superLog('auth', 'info', `2FA OTP sent to ${user.email}`, { email: user.email, ip: req.ip });

            return res.json({
                success: true,
                requires2FA: true,
                email: user.email,
                message: 'Verification code sent to your email.'
            });
        }

        // Regular user — no 2FA, direct login
        clearTermination(user.email);

        // Generate JWT session token
        const token = createToken(user);

        // Success! Send back the required frontend data + token
        res.json({ 
            success: true, 
            role: user.role, 
            name: user.name, 
            email: user.email,
            token
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// --- 3b. 2FA VERIFY ROUTE (superadmin only) ---
router.post('/verify-2fa', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const entry = pending2FA.get(email);
    if (!entry) {
        return res.status(400).json({ success: false, message: 'No pending verification. Please log in again.' });
    }

    // Check expiry (5 minutes)
    if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
        pending2FA.delete(email);
        return res.status(400).json({ success: false, message: 'Verification code expired. Please log in again.' });
    }

    if (entry.otp !== otp) {
        superLog('auth', 'warn', `2FA failed for ${email}`, { email, ip: req.ip });
        return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    // 2FA passed — complete login
    pending2FA.delete(email);

    try {
        const users = await getUsers();
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found.' });
        }

        clearTermination(user.email);

        logSession({ email: user.email, name: user.name, action: 'login', ip: req.ip, userAgent: req.headers['user-agent'] });
        await logAction(user.email, 'Login Success', `Superadmin login with 2FA verification`);
        superLog('auth', 'info', `2FA verified + Login: ${user.email} from ${req.ip}`, { email: user.email, role: user.role, ip: req.ip });

        const token = createToken(user);

        res.json({
            success: true,
            role: user.role,
            name: user.name,
            email: user.email,
            token
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error during 2FA verification.' });
    }
});

// --- 4. TOKEN REFRESH ROUTE ---
// POST /api/auth/refresh — silently extends session for active users
router.post('/refresh', async (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const { eligible, decoded } = checkRefreshEligible(token);

    if (!decoded) {
        // Token already expired — can't refresh, must re-login
        return res.status(401).json({ success: false, tokenExpired: true, message: 'Session expired. Please log in again.' });
    }

    if (!eligible) {
        // Token still has plenty of time — no refresh needed
        return res.json({ success: true, refreshed: false, message: 'Token still valid, no refresh needed.' });
    }

    // Issue a fresh token with the same user data
    const newToken = createToken({ email: decoded.email, role: decoded.role, name: decoded.name });

    superLog('auth', 'info', `Token refreshed: ${decoded.email}`, { email: decoded.email, ip: req.ip });

    return res.json({ success: true, refreshed: true, token: newToken });
});

// --- 5. LOGOUT ROUTE ---
// POST /api/auth/logout — callable by any logged-in user
router.post('/logout', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required." });
    }

    try {
        // Fetch the user's name for the log entry
        const users = await getUsers();
        const user = users.find(u => u.email === email);
        const name = user ? user.name : 'Unknown';

        logSession({
            email,
            name,
            action: 'logout',
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        superLog('auth', 'info', `Logout: ${email}`, { email, ip: req.ip });

        res.json({ success: true });
    } catch (error) {
        // Even if logging fails, return success — client should still clear session
        console.error('[authRoutes] Logout log error:', error.message);
        res.json({ success: true });
    }
});

module.exports = router;
