/**
 * controllers/db.js — PostgreSQL connection module using node-postgres (pg).
 *
 * Connection is configured from environment variables:
 *   DATABASE_URL                — full connection string (takes priority)
 *   PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE — individual params
 *
 * Exports: pool, query, getClient, transaction
 */

require('dotenv').config();
const { Pool } = require('pg');

// ─── Pool Configuration ───────────────────────────────────────────────────────

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }
    : {
        host:     process.env.PG_HOST     || 'localhost',
        port:     parseInt(process.env.PG_PORT || '5432', 10),
        user:     process.env.PG_USER     || 'docpilot_app',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'docpilot_db',
        ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
    ...poolConfig,
    max:                    20,
    idleTimeoutMillis:      30_000,
    connectionTimeoutMillis: 5_000,
});

// ─── Pool Error Handling ──────────────────────────────────────────────────────

pool.on('error', (err, client) => {
    console.error('[db] Unexpected error on idle PostgreSQL client:', err.message);
    // Do NOT crash the process — pool will remove the bad client automatically.
});

pool.on('connect', () => {
    // Uncomment for debugging connection events:
    // console.log('[db] New client connected to PostgreSQL pool');
});

// ─── query() helper ───────────────────────────────────────────────────────────

const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Execute a parameterized query.
 * Logs queries that take longer than SLOW_QUERY_THRESHOLD_MS.
 *
 * @param {string} text    - SQL query string with $1, $2, ... placeholders
 * @param {Array}  params  - Query parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;

        if (duration > SLOW_QUERY_THRESHOLD_MS) {
            console.warn(
                `[db] SLOW QUERY (${duration}ms): ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
                params ? `params: ${JSON.stringify(params).slice(0, 80)}` : ''
            );
        }

        return result;
    } catch (err) {
        const duration = Date.now() - start;
        console.error(
            `[db] Query error (${duration}ms): ${err.message}\n  SQL: ${text.replace(/\s+/g, ' ').slice(0, 200)}`
        );
        throw err;
    }
}

// ─── getClient() — for manual transaction control ─────────────────────────────

/**
 * Get a client from the pool. Caller is responsible for calling client.release().
 * Use transaction() for automatic BEGIN/COMMIT/ROLLBACK handling.
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
    return pool.connect();
}

// ─── transaction() helper ─────────────────────────────────────────────────────

/**
 * Run a callback inside a transaction.
 * Automatically issues BEGIN, COMMIT on success, and ROLLBACK on error.
 *
 * @param {Function} callback - async (client) => { ... }; return value is passed through
 * @returns {Promise<any>}    - whatever callback returns
 *
 * @example
 * const result = await transaction(async (client) => {
 *     await client.query('INSERT INTO ...', [...]);
 *     await client.query('UPDATE ...', [...]);
 *     return { ok: true };
 * });
 */
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    pool,
    query,
    getClient,
    transaction,
};
