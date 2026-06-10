/**
 * controllers/db.js
 * PostgreSQL connection pool — Aufmass-only DB layer.
 *
 * Connects via DATABASE_URL (preferred) or PG_* env fallback.
 * Safe to require() even when the DB is unreachable — pool errors
 * are caught and logged without crashing the process.
 */

'use strict';

const { Pool } = require('pg');

// ─── Build connection config ──────────────────────────────────────────────────

const SLOW_QUERY_MS = parseInt(process.env.PG_SLOW_QUERY_MS || '1000', 10);

function buildConfig() {
    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        };
    }
    return {
        host:     process.env.PG_HOST     || 'docpilot-postgres',
        port:     parseInt(process.env.PG_PORT || '5432', 10),
        database: process.env.PG_DATABASE || 'docpilot',
        user:     process.env.PG_USER     || 'docpilot',
        password: process.env.PG_PASSWORD || '',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };
}

const pool = new Pool(buildConfig());

// ─── Pool-level error handler (prevents unhandled rejection crash) ─────────────
pool.on('error', (err) => {
    console.error('[db] Unexpected pool error (idle client):', err.message);
    // Do NOT re-throw — this would crash the process
});

pool.on('connect', () => {
    console.log('[db] New client connected to PostgreSQL');
});

// ─── query() — the standard wrapper ──────────────────────────────────────────

/**
 * Execute a parameterized SQL query.
 * Logs queries that exceed SLOW_QUERY_MS.
 *
 * @param {string} text    SQL string with $1 placeholders
 * @param {Array}  [params] Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > SLOW_QUERY_MS) {
            console.warn(`[db] SLOW QUERY (${duration}ms): ${text.slice(0, 120)}`);
        }
        return result;
    } catch (err) {
        console.error('[db] Query error:', err.message, '\nSQL:', text.slice(0, 200));
        throw err;
    }
}

// ─── getClient() — for multi-statement transactions ───────────────────────────

/**
 * Acquire a raw client from the pool.
 * Caller MUST call client.release() in a finally block.
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
    return pool.connect();
}

// ─── transaction() — convenience wrapper ─────────────────────────────────────

/**
 * Run `fn(client)` inside a BEGIN/COMMIT/ROLLBACK transaction.
 * Automatically rolls back on error and re-throws.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─── healthCheck() ────────────────────────────────────────────────────────────

/**
 * Verify DB connectivity. Returns true if reachable, false if not.
 * Never throws — safe to call from startup routines.
 */
async function healthCheck() {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

module.exports = { pool, query, getClient, transaction, healthCheck };
