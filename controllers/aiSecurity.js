/**
 * controllers/aiSecurity.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Input sanitization + output filtering + abuse detection for the AI assistant.
 *
 * Prevents:
 *  - Prompt injection / jailbreak attempts
 *  - Leaking server internals (paths, env vars, package names, etc.)
 *  - Code block pass-through
 *  - Rapid-fire message bursts (>5 in 10s → 5-minute block)
 *  - Repeated identical messages (3+ in a row → block + log)
 *
 * All blocked/filtered events are logged to: data/ai-security/{YYYY-MM-DD}.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SECURITY_LOG_DIR = path.join(__dirname, '..', 'data', 'ai-security');

// ─── Security event logger ────────────────────────────────────────────────────

/**
 * Append a security event to the daily log file.
 * @param {string} eventType  - e.g. 'injection', 'rapid_fire', 'repeated_message', 'blocked'
 * @param {string} userId
 * @param {Object} details
 */
function logSecurityEvent(eventType, userId, details = {}) {
    try {
        fs.mkdirSync(SECURITY_LOG_DIR, { recursive: true });

        const today   = new Date().toISOString().slice(0, 10);
        const logPath = path.join(SECURITY_LOG_DIR, `${today}.json`);

        let entries = [];
        if (fs.existsSync(logPath)) {
            try { entries = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (_) {}
        }

        entries.push({
            timestamp: new Date().toISOString(),
            eventType,
            userId,
            ...details,
        });

        fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch (err) {
        console.error('[aiSecurity] logSecurityEvent error:', err.message);
    }
}

// ─── Abuse detection state ────────────────────────────────────────────────────

// Rapid-fire detection: userId → timestamp[]
const _rapidFireStore = new Map();
// Rapid-fire blocks: userId → unblockAt (ms timestamp)
const _rapidFireBlocks = new Map();

// Repeated message detection: userId → { lastMsg: string, count: number }
const _repeatStore = new Map();
// Repeat blocks: userId → unblockAt (ms timestamp)
const _repeatBlocks = new Map();

// Cleanup stale entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    const cutoff = now - 10 * 60_000; // 10 minutes

    for (const [key, arr] of _rapidFireStore.entries()) {
        if (!arr.length || arr[arr.length - 1] < cutoff) _rapidFireStore.delete(key);
    }
    for (const [key, unblockAt] of _rapidFireBlocks.entries()) {
        if (unblockAt < now) _rapidFireBlocks.delete(key);
    }
    for (const [key, unblockAt] of _repeatBlocks.entries()) {
        if (unblockAt < now) _repeatBlocks.delete(key);
    }
}, 10 * 60_000).unref();

/**
 * Check and update abuse detection state for a user.
 * Call BEFORE processing the message.
 *
 * @param {string} userId
 * @param {string} message - the raw (or sanitized) message
 * @returns {{ blocked: boolean, reason: string, retryAfterSec: number }}
 */
function checkAbuse(userId, message) {
    const now = Date.now();

    // ── 1. Check rapid-fire block ─────────────────────────────────────────────
    const rfBlock = _rapidFireBlocks.get(userId);
    if (rfBlock && rfBlock > now) {
        return {
            blocked: true,
            reason:  'rapid_fire_block',
            retryAfterSec: Math.ceil((rfBlock - now) / 1000),
        };
    }

    // ── 2. Check repeated message block ───────────────────────────────────────
    const rpBlock = _repeatBlocks.get(userId);
    if (rpBlock && rpBlock > now) {
        return {
            blocked: true,
            reason:  'repeat_block',
            retryAfterSec: Math.ceil((rpBlock - now) / 1000),
        };
    }

    // ── 3. Rapid-fire detection: >5 messages in 10 seconds ────────────────────
    const RAPID_WINDOW_MS = 10_000;   // 10 seconds
    const RAPID_THRESHOLD = 5;
    const RAPID_BLOCK_MS  = 5 * 60_000; // 5 minutes

    const prevTimestamps = (_rapidFireStore.get(userId) || [])
        .filter(t => now - t < RAPID_WINDOW_MS);
    prevTimestamps.push(now);
    _rapidFireStore.set(userId, prevTimestamps);

    if (prevTimestamps.length > RAPID_THRESHOLD) {
        const unblockAt = now + RAPID_BLOCK_MS;
        _rapidFireBlocks.set(userId, unblockAt);
        _rapidFireStore.delete(userId);

        logSecurityEvent('rapid_fire', userId, {
            messageCount: prevTimestamps.length,
            windowMs: RAPID_WINDOW_MS,
            blockedForMs: RAPID_BLOCK_MS,
        });

        return {
            blocked: true,
            reason:  'rapid_fire',
            retryAfterSec: Math.ceil(RAPID_BLOCK_MS / 1000),
        };
    }

    // ── 4. Repeated message detection: same message 3+ times in a row ─────────
    const REPEAT_THRESHOLD = 3;
    const REPEAT_BLOCK_MS  = 5 * 60_000; // 5 minutes

    const msgKey  = (message || '').trim().toLowerCase().slice(0, 200);
    const repData = _repeatStore.get(userId) || { lastMsg: '', count: 0 };

    if (msgKey && msgKey === repData.lastMsg) {
        repData.count++;
    } else {
        repData.lastMsg = msgKey;
        repData.count   = 1;
    }
    _repeatStore.set(userId, repData);

    if (repData.count >= REPEAT_THRESHOLD) {
        const unblockAt = now + REPEAT_BLOCK_MS;
        _repeatBlocks.set(userId, unblockAt);
        _repeatStore.delete(userId);

        logSecurityEvent('repeated_message', userId, {
            repeatCount: repData.count,
            messageSnippet: msgKey.slice(0, 100),
            blockedForMs: REPEAT_BLOCK_MS,
        });

        return {
            blocked: true,
            reason:  'repeated_message',
            retryAfterSec: Math.ceil(REPEAT_BLOCK_MS / 1000),
        };
    }

    return { blocked: false, reason: '', retryAfterSec: 0 };
}

// ─── Input sanitization ───────────────────────────────────────────────────────

/**
 * Sanitize user input: detect and filter injection patterns.
 * @param {string} message
 * @returns {{ clean: string, injectionDetected: boolean }}
 */
function sanitizeInput(message) {
    if (!message || typeof message !== 'string') {
        return { clean: '', injectionDetected: false };
    }

    const patterns = [
        /ignore\s+(all\s+|previous\s+|above\s+|prior\s+)?instructions/gi,
        /forget\s+(your\s+|all\s+|the\s+)?rules/gi,
        /you\s+are\s+now/gi,
        /pretend\s+(to\s+be|you're|you\s+are)/gi,
        /act\s+as\s+(a|an|if)/gi,
        /new\s+(instructions|prompt|role|persona)/gi,
        /system\s*prompt/gi,
        /\[INST\]/gi,
        /\[SYSTEM\]/gi,
        /<\|.*?\|>/g,
        /```(system|prompt|instruction)/gi,
        /reveal\s+(your|the)\s+(instructions|prompt|rules|system)/gi,
        /what\s+(are|is)\s+your\s+(instructions|prompt|rules|system)/gi,
        /show\s+me\s+(your|the)\s+(code|source|backend|api|routes)/gi,
        /how\s+(are|were)\s+you\s+(built|coded|programmed|made)/gi,
        // Additional jailbreak patterns
        /disregard\s+(all\s+|previous\s+|your\s+)?instructions/gi,
        /override\s+(your\s+|all\s+)?(instructions|rules|prompt)/gi,
        /roleplay\s+as/gi,
        /\bDAN\b/g,
        /do\s+anything\s+now/gi,
    ];

    let clean = message;
    let injectionDetected = false;

    for (const pattern of patterns) {
        if (pattern.test(clean)) {
            injectionDetected = true;
            // Reset lastIndex for global patterns (stateful after .test())
            pattern.lastIndex = 0;
            clean = clean.replace(pattern, '[filtered]');
        }
    }

    // Hard length limit
    if (clean.length > 2000) {
        clean = clean.substring(0, 2000);
    }

    return { clean, injectionDetected };
}

// ─── Output filtering ─────────────────────────────────────────────────────────

/**
 * Filter AI output to remove any accidental leakage of internal details.
 * @param {string} response
 * @returns {string}
 */
function filterOutput(response) {
    if (!response) return response;

    const forbidden = [
        // File system paths
        /\/src\//g,
        /\/api\//g,
        /\/routes\//g,
        /\/controllers\//g,
        /\/opt\/docpilot/g,
        /\/data\/storage/g,
        /\/app\/src/g,
        // Code patterns
        /require\s*\(/g,
        /module\.exports/g,
        /express\s*\./g,
        /app\.(get|post|put|delete)\s*\(/g,
        /router\.(get|post|put|delete)/g,
        // Environment / secrets
        /process\.env\.\w+/g,
        /\.env\b/g,
        // Internal addresses
        /localhost:\d+/g,
        /127\.0\.0\.1/g,
        /187\.124\.164\.\d+/g,
        // Internal project names / data files
        /geggos-(storage|appdata)/g,
        // Package names (security through obscurity)
        /bcryptjs?/gi,
        /jsonwebtoken/gi,
        /better-sqlite3/gi,
        /webdav/gi,
        /multer/gi,
        // Internal terms
        /middleware/gi,
        /authMiddleware/g,
        /accessControl/g,
        /\.jwt-secret/g,
        /terminated-sessions/g,
        /row-versions\.json/g,
        /settings\.json/g,
        /project-info\.json/g,
    ];

    let filtered = response;
    for (const pattern of forbidden) {
        filtered = filtered.replace(pattern, '***');
    }

    // Strip code blocks entirely (no source should leak via code)
    filtered = filtered.replace(/```[\s\S]*?```/g, '[Code removed]');

    return filtered;
}

module.exports = { sanitizeInput, filterOutput, checkAbuse, logSecurityEvent };
