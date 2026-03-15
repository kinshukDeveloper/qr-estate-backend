const { Pool } = require('pg');
const logger = require('./logger');

// Parse connection string to handle SSL properly
const config = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { 
        rejectUnauthorized: false, // For self-signed certs (Render/Railway/Neon)
        // Use verify-full for production security
        sslmode: 'verify-full'
      } 
    : false,
  
  // Connection pool settings (optimized for serverless)
  max: process.env.IS_SERVERLESS === 'true' ? 1 : 10,
  min: 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Fail fast if DB unreachable
  
  // Keep connections alive (prevents "Connection terminated unexpectedly")
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  
  // Statement timeout (prevent hanging queries)
  statement_timeout: 30000, // 30s max per query
  query_timeout: 30000,
};

// Remove sslmode from connection string to avoid conflicts
if (config.connectionString) {
  config.connectionString = config.connectionString.replace(/[?&]sslmode=[^&]+/, '');
}

const pool = new Pool(config);

// Connection error handling
pool.on('error', (err, client) => {
  logger.error('Unexpected pool error:', {
    message: err.message,
    stack: err.stack,
    client: client ? 'active' : 'idle'
  });
});

pool.on('connect', (client) => {
  logger.debug('New client connected to DB pool');
});

pool.on('remove', () => {
  logger.debug('Client removed from DB pool');
});

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    logger.debug('DB already connected, skipping...');
    return;
  }

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`DB connection attempt ${attempt}/${maxRetries}...`);
      
      const client = await pool.connect();
      
      // Test query with timeout
      const result = await client.query('SELECT NOW() as now, version() as version');
      client.release();

      isConnected = true;
      
      logger.info('✅ PostgreSQL connected', {
        timestamp: result.rows[0].now,
        version: result.rows[0].version.split(' ')[0], // e.g., "PostgreSQL 15.3"
        poolMax: config.max,
        ssl: config.ssl ? 'enabled' : 'disabled'
      });
      
      return;

    } catch (err) {
      lastError = err;
      logger.warn(`DB connection attempt ${attempt} failed:`, {
        message: err.message,
        code: err.code,
        host: maskConnectionString(process.env.DATABASE_URL)
      });

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${lastError.message}`);
}

// Graceful shutdown
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

// Helper to mask sensitive data in logs
function maskConnectionString(connStr) {
  if (!connStr) return 'undefined';
  return connStr.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

module.exports = { 
  pool, 
  connectDB, 
  disconnectDB,
  isConnected: () => isConnected 
};