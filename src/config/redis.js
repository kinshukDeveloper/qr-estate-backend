/**
 * Redis Configuration
 * Path: src/config/redis.js
 */

const logger = require('./logger');

let client = null;
let isConnected = false;

async function connectRedis() {
  // Skip if already connected
  if (isConnected && client) {
    logger.debug('Redis already connected');
    return client;
  }

  // Skip if no Redis URL configured
  if (!process.env.REDIS_URL) {
    logger.info('ℹ️ Redis: REDIS_URL not set, skipping Redis connection');
    logger.info('   App will work without Redis (no caching/rate-limit persistence)');
    return null;
  }

  return new Promise((resolve, reject) => {
    const Redis = require('ioredis');
    
    // Connection timeout
    const timeout = setTimeout(() => {
      logger.warn('⚠️ Redis connection timeout (5s)');
      resolve(null); // Don't reject, just continue without Redis
    }, 5000);

    try {
      client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Redis: Max retries reached, giving up');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        enableReadyCheck: true,
        connectTimeout: 5000,
        lazyConnect: false,
      });

      client.on('connect', () => {
        clearTimeout(timeout);
        logger.info('✅ Redis connected');
      });

      client.on('ready', () => {
        isConnected = true;
        resolve(client);
      });

      client.on('error', (err) => {
        // Don't log every error, just important ones
        if (!isConnected) {
          clearTimeout(timeout);
          logger.warn('⚠️ Redis connection error:', err.message);
          resolve(null); // Continue without Redis
        }
      });

      client.on('close', () => {
        isConnected = false;
        logger.debug('Redis connection closed');
      });

    } catch (err) {
      clearTimeout(timeout);
      logger.warn('⚠️ Redis init error:', err.message);
      resolve(null); // Continue without Redis
    }
  });
}

async function disconnectRedis() {
  if (client && isConnected) {
    try {
      await client.quit();
      isConnected = false;
      client = null;
      logger.info('Redis disconnected');
    } catch (err) {
      logger.warn('Redis disconnect error:', err.message);
    }
  }
}

// Helper to check if Redis is available
function isRedisAvailable() {
  return isConnected && client && client.status === 'ready';
}

// Safe get/set with fallback
async function safeGet(key) {
  if (!isRedisAvailable()) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

async function safeSet(key, value, ttlSeconds = 3600) {
  if (!isRedisAvailable()) return false;
  try {
    await client.setex(key, ttlSeconds, value);
    return true;
  } catch {
    return false;
  }
}

async function safeDel(key) {
  if (!isRedisAvailable()) return false;
  try {
    await client.del(key);
    return true;
  } catch {
    return false;
  }
}

module.exports = { 
  connectRedis, 
  disconnectRedis,
  client,
  getClient: () => client,
  isConnected: () => isConnected,
  isRedisAvailable,
  safeGet,
  safeSet,
  safeDel,
};