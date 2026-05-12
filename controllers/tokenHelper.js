/**
 * tokenHelper.js
 * JWT session token management.
 * 
 * Tokens contain: { email, role, name, iat, exp }
 * Secret is loaded from JWT_SECRET env var, or auto-generated on first boot.
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_FILE = path.join(__dirname, '..', 'src', 'DataFiles', '.jwt-secret');

// Default session durations (in seconds)
const DEFAULT_SESSION_DURATION = 8 * 60 * 60;       // 8 hours for regular users
const SUPERADMIN_SESSION_DURATION = 2 * 60 * 60;    // 2 hours for superadmin (stricter)

/**
 * Get or generate the JWT secret.
 * Priority: JWT_SECRET env var > persisted file > auto-generate.
 */
function getSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

    try {
        const secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
        if (secret.length >= 32) return secret;
    } catch (_) {}

    // Auto-generate a strong secret and persist it
    const secret = crypto.randomBytes(64).toString('hex');
    try {
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
        console.log('[tokenHelper] Auto-generated JWT secret');
    } catch (err) {
        console.error('[tokenHelper] Could not persist JWT secret:', err.message);
    }
    return secret;
}

const JWT_SECRET = getSecret();

/**
 * Create a signed JWT token for a user.
 * @param {{ email: string, role: string, name: string }} user
 * @returns {string} signed JWT
 */
function createToken(user) {
    const duration = user.role === 'superadmin' ? SUPERADMIN_SESSION_DURATION : DEFAULT_SESSION_DURATION;
    return jwt.sign(
        { email: user.email, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: duration }
    );
}

/**
 * Verify and decode a JWT token.
 * @param {string} token
 * @returns {{ email: string, role: string, name: string, iat: number, exp: number } | null}
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

/**
 * Refresh window: issue a new token if current one expires within this many seconds.
 * Client checks this before each request and hits /api/auth/refresh if needed.
 */
const REFRESH_WINDOW = 30 * 60; // 30 minutes

/**
 * Check if a token is within the refresh window (close to expiry but still valid).
 * @param {string} token
 * @returns {{ eligible: boolean, decoded: object | null }}
 */
function checkRefreshEligible(token) {
    const decoded = verifyToken(token);
    if (!decoded) return { eligible: false, decoded: null };
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = decoded.exp - now;
    return { eligible: timeLeft > 0 && timeLeft <= REFRESH_WINDOW, decoded };
}

/**
 * Express middleware: extracts and verifies JWT from Authorization header.
 * Sets req.user = { email, role, name } on success.
 * Falls through if no token (for backward compat during migration).
 * 
 * Auth header format: "Bearer <token>"
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
            // Also set legacy headers for backward compat with existing route checks
            req.headers['x-user-email'] = decoded.email;
            req.headers['x-user-role'] = decoded.role;
            req.headers['x-user-name'] = decoded.name;
        } else {
            // Token exists but is invalid/expired
            return res.status(401).json({
                success: false,
                tokenExpired: true,
                message: 'Session expired. Please log in again.'
            });
        }
    }
    // No token: block superadmin claims and require at least an email header
    if (!token) {
        const claimedRole = (req.headers['x-user-role'] || '').toLowerCase();
        if (claimedRole === 'superadmin' || claimedRole === 'admin') {
            return res.status(401).json({ success: false, message: 'Authentication required for elevated roles.' });
        }
        // Clear any spoofed role header for non-token requests
        if (req.headers['x-user-role']) {
            req.headers['x-user-role'] = 'user';
        }
    }

    next();
}

module.exports = { createToken, verifyToken, checkRefreshEligible, authMiddleware };
