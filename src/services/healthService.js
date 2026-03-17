/**
 * Health Service - Performs health checks and notifications
 * Path: src/services/healthService.js
 */

const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * Run global health check
 * Called by cron job daily at 9am
 */
async function runGlobalHealthCheck() {
  logger.info('🏥 Running global health check...');
  
  const results = {
    timestamp: new Date().toISOString(),
    database: { status: 'unknown', latency: null },
    redis: { status: 'unknown', latency: null },
    memory: null,
    uptime: process.uptime(),
  };

  // ── Check Database ──────────────────────────────────────────────────────────
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    results.database = {
      status: 'ok',
      latency: Date.now() - start,
    };
  } catch (err) {
    results.database = {
      status: 'error',
      error: err.message,
    };
    logger.error('Health check - DB error:', err.message);
  }

  // ── Check Redis ─────────────────────────────────────────────────────────────
  try {
    const { client: redisClient } = require('../config/redis');
    
    if (redisClient && redisClient.status === 'ready') {
      const start = Date.now();
      await redisClient.ping();
      results.redis = {
        status: 'ok',
        latency: Date.now() - start,
      };
    } else {
      results.redis = {
        status: 'disconnected',
      };
    }
  } catch (err) {
    results.redis = {
      status: 'error',
      error: err.message,
    };
    logger.warn('Health check - Redis error:', err.message);
  }

  // ── Check Memory ────────────────────────────────────────────────────────────
  const memUsage = process.memoryUsage();
  results.memory = {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
    rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
  };

  // ── Log Results ─────────────────────────────────────────────────────────────
  const isHealthy = results.database.status === 'ok';
  
  if (isHealthy) {
    logger.info('✅ Health check passed', results);
  } else {
    logger.error('❌ Health check failed', results);
    
    // Optional: Send alert notification
    await sendHealthAlert(results);
  }

  return results;
}

/**
 * Send health alert (email, Slack, etc.)
 * Customize based on your notification needs
 */
async function sendHealthAlert(results) {
  try {
    // Example: Log to console (replace with actual notification)
    logger.warn('🚨 HEALTH ALERT - System degraded', {
      database: results.database.status,
      redis: results.redis.status,
      timestamp: results.timestamp,
    });

    // TODO: Implement actual notifications
    // - Email via SendGrid/Nodemailer
    // - Slack webhook
    // - Discord webhook
    // - PagerDuty/Opsgenie

    /*
    // Example: Slack webhook
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 QR Estate Health Alert!\nDatabase: ${results.database.status}\nRedis: ${results.redis.status}`,
        }),
      });
    }
    */
    
  } catch (err) {
    logger.error('Failed to send health alert:', err.message);
  }
}

/**
 * Check specific property health
 * Can be used to verify property-specific resources
 */
async function checkPropertyHealth(propertyId) {
  try {
    const result = await pool.query(
      'SELECT id, name, is_active FROM properties WHERE id = $1',
      [propertyId]
    );

    if (result.rows.length === 0) {
      return { status: 'not_found', propertyId };
    }

    return {
      status: 'ok',
      property: result.rows[0],
    };
  } catch (err) {
    logger.error(`Property health check failed for ${propertyId}:`, err.message);
    return {
      status: 'error',
      error: err.message,
    };
  }
}

/**
 * Get system stats
 */
function getSystemStats() {
  const memUsage = process.memoryUsage();
  
  return {
    uptime: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime()),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  };
}

/**
 * Format uptime to human readable
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

module.exports = {
  runGlobalHealthCheck,
  sendHealthAlert,
  checkPropertyHealth,
  getSystemStats,
};