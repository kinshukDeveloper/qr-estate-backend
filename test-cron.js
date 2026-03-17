// test-cron.js
require('dotenv').config();

async function test() {
  try {
    // Test node-cron
    const cron = require('node-cron');
    console.log('✅ node-cron loaded');
    
    // Test health service
    const { runGlobalHealthCheck } = require('./src/services/healthService');
    console.log('✅ healthService loaded');
    
    // Run health check
    console.log('🔄 Running health check...');
    const result = await runGlobalHealthCheck();
    console.log('✅ Health check result:', JSON.stringify(result, null, 2));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
  
  process.exit(0);
}

test();