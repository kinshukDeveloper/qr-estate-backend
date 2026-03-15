
const logger = require('./config/logger');
const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');

// Prevent re-running DB/Redis connects on every request in serverless
let isInitialized = false;

async function initialize() {
  if (isInitialized) return;
  await connectDB();
  await connectRedis();
  isInitialized = true;
}

// Call before exporting
if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  initialize().catch(err => logger.error('Init failed:', err));
}