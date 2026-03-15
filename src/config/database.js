const { Pool } = require('pg');
const logger = require('./logger');

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   host: process.env.DB_HOST || 'localhost',
//   port: parseInt(process.env.DB_PORT) || 5432,
//   database: process.env.DB_NAME || 'qr_estate',
//   user: process.env.DB_USER || 'postgres',
//   password: process.env.DB_PASSWORD,
//   ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
//   max: 20,                // max connections in pool
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 2000,
// });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 10000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 2000,
});

// Log pool events in development
pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('New database client connected');
    logger.info("DB URL exists:", !!process.env.DATABASE_URL);
  }
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
});

/**
 * Connect and verify database is reachable
 */
async function connectDB() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as time, current_database() as db');
    logger.info(`✅ PostgreSQL connected — DB: ${result.rows[0].db}`);
  } finally {
    client.release();
  }
}

/**
 * Execute a query with optional parameters
 * Usage: await query('SELECT * FROM users WHERE id = $1', [userId])
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      logger.warn(`Slow query (${duration}ms): ${text.substring(0, 80)}...`);
    }
    return result;
  } catch (err) {
    logger.error('Database query error:', { query: text, error: err.message });
    throw err;
  }
}

/**
 * Get a client for transactions
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
async function getClient() {
  return pool.connect();
}

module.exports = { connectDB, query, getClient, pool };
