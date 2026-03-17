require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require("path");
const logger = require('./config/logger');
const { connectDB, disconnectDB, pool } = require('./config/database');
const { connectRedis } = require('./config/redis');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

app.use(express.json())
app.use(express.static(path.join(__dirname, "../public")));

// ── SERVERLESS DETECTION ──────────────────────────────────────────────────────
const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.IS_SERVERLESS === 'true'
);

// ── TRUST PROXY ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── REQUEST ID ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "QR Estate API is running 🚀"
  })
})

// ── SECURITY HEADERS ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

app.disable('x-powered-by');

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
}));

// ── COMPRESSION ───────────────────────────────────────────────────────────────
app.use(compression({ level: 6 }));

// ── BODY PARSING ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── LOGGING ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health',
  }));
}

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests.' },
});

const brochureLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 20,
  message: { success: false, message: 'Brochure generation is rate limited. Try again in a minute.' },
});

app.use('/api', globalLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/auth/login`, authLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/auth/register`, authLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/p/`, publicLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/brochure/`, brochureLimiter);

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const checks = { api: 'ok', db: 'unknown', redis: 'unknown' };

  try {
    await pool.query('SELECT 1');
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'error';
    logger.error('Health check DB error:', err.message);
  }

  try {
    const { client: redisClient } = require('./config/redis');
    if (redisClient?.status === 'ready') {
      checks.redis = 'ok';
    } else {
      checks.redis = 'degraded';
    }
  } catch {
    checks.redis = 'degraded';
  }

  const isHealthy = checks.db === 'ok';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    app: process.env.APP_NAME || 'QR Estate API',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV,
    serverless: IS_SERVERLESS,
    checks,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use(`/api/${process.env.API_VERSION || 'v1'}`, routes);

// ── QR SHORT CODE REDIRECT ────────────────────────────────────────────────────
try {
  const { redirectQR } = require('./controllers/qrController');
  app.get('/q/:shortCode', redirectQR);
} catch (err) {
  logger.warn('QR redirect route not loaded:', err.message);
}

// ── 404 & ERROR ───────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ══════════════════════════════════════════════════════════════════════════════
// ── CONNECTION INITIALIZATION ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let isInitialized = false;

async function initializeConnections() {
  if (isInitialized) {
    logger.debug('Already initialized, skipping...');
    return;
  }

  logger.info('🔄 Initializing connections...');

  try {
    // Connect to database (required)
    await connectDB();
    logger.info('✅ Database connected');
  } catch (err) {
    logger.error('❌ Database connection failed:', err.message);
    throw err; // DB is required, fail if can't connect
  }

  try {
    // Connect to Redis (optional)
    await connectRedis();
    logger.info('✅ Redis connected');
  } catch (err) {
    logger.warn('⚠️ Redis connection failed (continuing without Redis):', err.message);
    // Don't throw - Redis is optional
  }

  isInitialized = true;
  logger.info('✅ All connections initialized');
}

// ══════════════════════════════════════════════════════════════════════════════
// ── TRADITIONAL SERVER MODE ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.PORT) || 5000;

async function startServer() {
  try {
    logger.info('🚀 Starting QR Estate API...');
    logger.info(`   Environment : ${process.env.NODE_ENV}`);
    logger.info(`   Serverless  : ${IS_SERVERLESS}`);

    await initializeConnections();

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`✅ Server listening on port ${PORT}`);
      logger.info(`   API Base    : http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
      logger.info(`   Health      : http://localhost:${PORT}/health`);
    });

    // ── CRON JOBS ──────────────────────────────────────────────────────────────
    if (process.env.NODE_ENV !== 'test' && !IS_SERVERLESS) {
      try {
        const cron = require('node-cron');
        const { runGlobalHealthCheck } = require('./services/healthService');

        // Daily health check at 9am
        cron.schedule('0 9 * * *', async () => {
          try {
            await runGlobalHealthCheck();
          } catch (err) {
            logger.error('Cron job error:', err);
          }
        });

        logger.info('   Cron        : Health check @ 9am daily');

      } catch (err) {
        // More descriptive warning
        if (err.code === 'MODULE_NOT_FOUND') {
          if (err.message.includes('node-cron')) {
            logger.warn('⚠️ Cron: node-cron not installed. Run: npm install node-cron');
          } else if (err.message.includes('healthService')) {
            logger.warn('⚠️ Cron: healthService not found. Create: src/services/healthService.js');
          } else {
            logger.warn('⚠️ Cron: Missing module -', err.message);
          }
        } else {
          logger.warn('⚠️ Cron jobs not loaded:', err.message);
        }
      }
    }
    // ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully...`);

      server.close(async () => {
        try {
          await disconnectDB();
        } catch (err) {
          logger.error('Error closing DB pool:', err);
        }
        logger.info('Server closed');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.error('❌ Uncaught exception:', err);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('❌ Unhandled rejection:', reason);
    });

  } catch (err) {
    logger.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── EXPORTS & STARTUP ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Only start server in non-serverless mode
if (!IS_SERVERLESS) {
  startServer();
} else {
  logger.info('📦 Running in serverless mode');
}

// Export app and initialization function
module.exports = app;
module.exports.initializeConnections = initializeConnections;