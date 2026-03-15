require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const logger = require('./config/logger');
const { connectDB, pool } = require('./config/database');
const { connectRedis } = require('./config/redis');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// ── TRUST PROXY (required for Railway/Render/Vercel) ─────────────────────────
// Ensures req.ip is real IP, not load balancer IP
app.set('trust proxy', 1);

// ── REQUEST ID ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── SECURITY HEADERS (Helmet) ────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

// Remove fingerprinting headers
app.disable('x-powered-by');

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {return callback(null, true)} // Postman, mobile apps
    if (allowedOrigins.includes(origin)) {return callback(null, true)}
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
    skip: (req) => req.url === '/health', // don't log health pings
  }));
}

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
// Global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

// Auth — strict (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// Public QR scans — generous
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests.' },
});

// Brochure — expensive (Puppeteer), limit hard
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
  // Deep health — check DB + Redis
  const checks = { api: 'ok', db: 'unknown', redis: 'unknown' };

  try {
    await pool.query('SELECT 1');
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
  }

  try {
    const { client: redisClient } = require('./config/redis');
    if (redisClient?.status === 'ready') {checks.redis = 'ok'}
    else {checks.redis = 'degraded'}
  } catch {
    checks.redis = 'degraded';
  }

  const isHealthy = checks.db === 'ok';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    app: process.env.APP_NAME || 'QR Estate API',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV,
    checks,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use(`/api/${process.env.API_VERSION || 'v1'}`, routes);

// ── QR SHORT CODE REDIRECT ────────────────────────────────────────────────────
const { redirectQR } = require('./controllers/qrController');
app.get('/q/:shortCode', redirectQR);

// ── 404 & ERROR ───────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── START SERVER ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;

async function startServer() {
  try {
    await connectDB();
    await connectRedis();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 QR Estate API`);
      logger.info(`   Port        : ${PORT}`);
      logger.info(`   Environment : ${process.env.NODE_ENV}`);
      logger.info(`   API Base    : http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
      logger.info(`   Health      : http://localhost:${PORT}/health`);
    });

    // ── CRON JOBS ──────────────────────────────────────────────────────────
    if (process.env.NODE_ENV !== 'test') {
      const cron = require('node-cron');
      const { runGlobalHealthCheck } = require('./services/healthService');
      cron.schedule('0 9 * * *', () => {
        runGlobalHealthCheck().catch(err => logger.error('Cron error:', err));
      });
      logger.info('   Cron        : Health check @ 9am IST daily');
    }

    // ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully...`);
      server.close(async () => {
        try {
          await pool.end();
          logger.info('DB pool closed');
        } catch(err) {
          console.log(err);
          
        }
        logger.info('Server closed');
        process.exit(0);
      });
      // Force kill after 10s
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
    });

  } catch (err) {
    logger.error('Failed to start:', err);
    process.exit(1);
  }
}

startServer();
module.exports = app;

