const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false }
    : false,
  max: process.env.IS_SERVERLESS === 'true' ? 1 : 10,
  min: 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  logger.error('Unexpected pool error:', err.message);
});

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    logger.debug('DB already connected');
    return;
  }

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`DB connection attempt ${attempt}/${maxRetries}...`);
      
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      isConnected = true;
      logger.info('✅ PostgreSQL connected');
      return;

    } catch (err) {
      lastError = err;
      logger.warn(`DB attempt ${attempt} failed: ${err.message}`);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`DB connection failed: ${lastError.message}`);
}

async function disconnectDB() {
  if (!isConnected) return;
  
  try {
    await pool.end();
    isConnected = false;
    logger.info('DB pool closed');
  } catch (err) {
    logger.error('Error closing DB pool:', err);
  }
}

module.exports = { pool, connectDB, disconnectDB };