const Redis = require('ioredis');
const logger = require('./logger');

let redis;

function connectRedis() {
  return new Promise((resolve, reject) => {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      retryStrategy(times) {
        if (times > 5) {
          logger.warn("Redis: Max reconnect attempts reached. Running without cache.");
          return null;
        }
        return Math.min(times * 100, 2000);
      },
      lazyConnect: true,
    });

    redis.on('connect', () => {
      logger.info('✅ Redis connected');
      resolve(redis);
    });

    redis.on('error', (err) => {
      logger.warn('Redis connection error (non-fatal):', err.message);
      resolve(null); // app still works without Redis
    });

    redis.connect().catch(() => resolve(null));
  });
}

function getRedis() {
  return redis;
}

/**
 * Helper: Set key with expiry (seconds)
 */
async function setEx(key, value, ttlSeconds = 3600) {
  if (!redis) return null;
  try {
    await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', ttlSeconds);
  } catch (e) {
    logger.warn('Redis setEx error:', e.message);
  }
}

/**
 * Helper: Get parsed value
 */
async function get(key) {
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
  } catch (e) {
    logger.warn('Redis get error:', e.message);
    return null;
  }
}

/**
 * Helper: Delete key(s)
 */
async function del(...keys) {
  if (!redis) return;
  try { await redis.del(...keys); } catch (e) {
    logger.warn('Redis del error:', e.message);
  }
}

module.exports = { connectRedis, getRedis, setEx, get, del };
