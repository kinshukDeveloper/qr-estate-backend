/**
 * Serverless Entry Point for Vercel
 * Path: api/index.js
 */

// Load environment variables first
require('dotenv').config();

const logger = require('../src/config/logger');

// Wrap everything in try-catch to catch import errors
let app;
let initializeConnections;

try {
  const mainModule = require('../src/index');
  app = mainModule;
  initializeConnections = mainModule.initializeConnections;
} catch (err) {
  console.error('❌ Failed to import app:', err);
  
  // Return error handler if import fails
  module.exports = (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Server initialization failed',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  };
  return;
}

// Track initialization state
let isInitialized = false;
let initError = null;

// Initialize once (singleton pattern for warm starts)
async function initialize() {
  if (isInitialized) return true;
  if (initError) throw initError;

  try {
    if (typeof initializeConnections === 'function') {
      await initializeConnections();
    }
    isInitialized = true;
    return true;
  } catch (err) {
    initError = err;
    logger.error('❌ Initialization failed:', err);
    throw err;
  }
}

// Vercel serverless handler
module.exports = async (req, res) => {
  try {
    // Initialize connections on first request
    await initialize();
    
    // Forward request to Express app
    return app(req, res);
    
  } catch (err) {
    console.error('❌ Request handler error:', err);
    
    // Return proper error response
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
      timestamp: new Date().toISOString()
    });
  }
};