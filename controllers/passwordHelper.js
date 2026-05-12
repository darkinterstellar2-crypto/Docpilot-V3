/**
 * passwordHelper.js
 * Handles bcrypt password hashing and verification.
 * Supports migration: auto-detects plain text vs hashed passwords.
 */

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password.
 * @param {string} plainPassword
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Verify a password against a stored value.
 * Handles both bcrypt hashes AND legacy plain text passwords.
 * If a plain text match is found, returns { match: true, needsRehash: true }
 * so the caller can upgrade the stored password to bcrypt.
 *
 * @param {string} inputPassword - password the user typed
 * @param {string} storedPassword - value from users.json
 * @returns {Promise<{ match: boolean, needsRehash: boolean }>}
 */
async function verifyPassword(inputPassword, storedPassword) {
    // bcrypt hashes always start with $2a$ or $2b$
    if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$')) {
        const match = await bcrypt.compare(inputPassword, storedPassword);
        return { match, needsRehash: false };
    }

    // Legacy plain text comparison
    if (inputPassword === storedPassword) {
        return { match: true, needsRehash: true };
    }

    return { match: false, needsRehash: false };
}

module.exports = { hashPassword, verifyPassword };
