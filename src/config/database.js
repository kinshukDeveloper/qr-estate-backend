const { Pool } = require('pg');
const logger = require('./logger');

// Detect serverless environment
const IS_SERVERLESS = !!(
  process.env.VERCEL || 
  process.env.NETLIFY || 
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.IS_SERVERLESS === 'true'
);

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
  
  // Pool settings (optimized for serverless)
  max: IS_SERVERLESS ? 1 : 10,
  min: 0,
  idleTimeoutMillis: IS_SERVERLESS ? 10000 : 30000,
  connectionTimeoutMillis: 10000,
  
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Create pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected DB pool error:', err.message);
});

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    logger.debug('DB already connected');
    return;
  }

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`DB connection attempt ${attempt}/${maxRetries}...`);
      
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as connected_at');
      client.release();

      isConnected = true;
      logger.info(`✅ PostgreSQL connected at ${result.rows[0].connected_at}`);
      return;

    } catch (err) {
      lastError = err;
      logger.warn(`DB attempt ${attempt} failed: ${err.message}`);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Database connection failed after ${maxRetries} attempts: ${lastError.message}`);
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

module.exports = { 
  pool, 
  connectDB, 
  disconnectDB,
  isConnected: () => isConnected 
};