/**
 * controllers/aiCostTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks token usage and estimated cost for every Gemini API call.
 *
 * Daily logs: data/ai-costs/{YYYY-MM-DD}.json
 *   Each entry: { timestamp, userId, model, modelType, inputTokens, outputTokens, estimatedCost }
 *
 * Cost rates per 1M tokens (configurable via env):
 *   AI_COST_FLASH_INPUT  (default $0.10)
 *   AI_COST_FLASH_OUTPUT (default $0.40)
 *   AI_COST_PRO_INPUT    (default $1.25)
 *   AI_COST_PRO_OUTPUT   (default $5.00)
 *
 * Daily cost cap: AI_DAILY_COST_CAP (USD, default $5.00)
 *   - When cap is reached, non-superadmin users get a 503 block.
 *   - Superadmin is always exempt from the cap but still tracked.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const COST_DIR = path.join(__dirname, '..', 'data', 'ai-costs');

// ─── Rate helpers ─────────────────────────────────────────────────────────────

function getRates(modelType) {
    if (modelType === 'pro') {
        return {
            input:  parseFloat(process.env.AI_COST_PRO_INPUT)  || 1.25,
            output: parseFloat(process.env.AI_COST_PRO_OUTPUT) || 5.00,
        };
    }
    // Standard / flash
    return {
        input:  parseFloat(process.env.AI_COST_FLASH_INPUT)  || 0.10,
        output: parseFloat(process.env.AI_COST_FLASH_OUTPUT) || 0.40,
    };
}

function getDailyCap() {
    const cap = parseFloat(process.env.AI_DAILY_COST_CAP);
    return isNaN(cap) ? 5.00 : cap;
}

function getDateStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDailyLogPath(dateStr) {
    return path.join(COST_DIR, `${dateStr}.json`);
}

// ─── In-memory daily total cache ──────────────────────────────────────────────
// { date: string, total: number }
let _cache = { date: '', total: 0 };

function loadDailyTotal(dateStr) {
    const logPath = getDailyLogPath(dateStr);
    if (!fs.existsSync(logPath)) return 0;
    try {
        const entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        if (!Array.isArray(entries)) return 0;
        return entries.reduce((sum, e) => sum + (e.estimatedCost || 0), 0);
    } catch (_) {
        return 0;
    }
}

function getDailyTotal() {
    const today = getDateStr();
    if (_cache.date === today) return _cache.total;
    // New day or cold start — reload from disk
    const total = loadDailyTotal(today);
    _cache = { date: today, total };
    return total;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the daily cost cap has been hit.
 * Superadmin is always exempt (but still tracked separately).
 *
 * @param {string} userRole
 * @returns {{ capped: boolean, currentCost: number, cap: number }}
 */
function isDailyCostCapped(userRole) {
    const cap = getDailyCap();
    const currentCost = getDailyTotal();

    if (userRole === 'superadmin') {
        return { capped: false, currentCost, cap };
    }
    if (cap <= 0) {
        // Cap disabled (set to 0 or negative in env)
        return { capped: false, currentCost, cap };
    }
    return { capped: currentCost >= cap, currentCost, cap };
}

/**
 * Record token usage from a completed Gemini API call.
 * Updates the daily log file and the in-memory cache.
 *
 * @param {Object} opts
 * @param {string} opts.userId        - user email
 * @param {string} opts.modelType     - 'standard' | 'pro'
 * @param {string} opts.model         - actual model name (e.g. 'gemini-2.0-flash')
 * @param {number} opts.inputTokens   - prompt token count
 * @param {number} opts.outputTokens  - completion token count
 */
function recordUsage({ userId, modelType, model, inputTokens, outputTokens }) {
    try {
        if (!inputTokens && !outputTokens) return; // nothing to record

        const rates = getRates(modelType || 'standard');
        const estimatedCost =
            ((inputTokens  || 0) * rates.input  +
             (outputTokens || 0) * rates.output) / 1_000_000;

        const today   = getDateStr();
        const logPath = getDailyLogPath(today);

        fs.mkdirSync(COST_DIR, { recursive: true });

        let entries = [];
        if (fs.existsSync(logPath)) {
            try { entries = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (_) {}
        }

        entries.push({
            timestamp: new Date().toISOString(),
            userId:    userId || 'unknown',
            model:     model  || 'unknown',
            modelType: modelType || 'standard',
            inputTokens:  inputTokens  || 0,
            outputTokens: outputTokens || 0,
            estimatedCost,
        });

        fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf8');

        // Update in-memory cache
        if (_cache.date === today) {
            _cache.total += estimatedCost;
        } else {
            _cache = { date: today, total: estimatedCost };
        }
    } catch (err) {
        console.error('[aiCostTracker] recordUsage error:', err.message);
    }
}

/**
 * Get today's running cost total (for admin dashboards / logging).
 * @returns {number}
 */
function getTodayCost() {
    return getDailyTotal();
}

module.exports = { isDailyCostCapped, recordUsage, getTodayCost };
