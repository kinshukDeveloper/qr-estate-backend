/**
 * Serverless Entry Point for Vercel/Netlify
 */

const app = require('../src/index');
const { initializeConnections } = require('../src/index');

// Vercel handler
module.exports = async (req, res) => {
  await initializeConnections();
  return app(req, res);
};

// AWS Lambda handler (if needed)
module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await initializeConnections();
  
  const serverless = require('serverless-http');
  return serverless(app)(event, context);
};