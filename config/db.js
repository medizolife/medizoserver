const fs = require('fs');
const path = require('path');
const { isD1Connected, isD1Configured, execRawSQL } = require('./d1-client');

let isConnected = false;

/**
 * Connect to Cloudflare D1 and run schema migrations.
 * Replaces the old MongoDB connectDB() function.
 * @returns {Promise<boolean>} Whether D1 is connected and ready
 */
const connectDB = async () => {
  if (isConnected) {
    return true;
  }

  if (!isD1Configured()) {
    console.log('Cloudflare D1 credentials not configured. Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_D1_DATABASE_ID in .env');
    return false;
  }

  try {
    console.log('Attempting to connect to Cloudflare D1...');
    
    // Test connectivity
    const connected = await isD1Connected();
    if (!connected) {
      console.log('Cloudflare D1 connection failed.');
      return false;
    }

    // Run schema migrations
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Running D1 schema migrations...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await execRawSQL(schemaSql);
      console.log('D1 schema migrations completed.');
    }

    isConnected = true;
    console.log('Cloudflare D1 connected successfully.');
    return true;
  } catch (error) {
    console.error(`D1 connection error: ${error.message}`);
    return false;
  }
};

module.exports = connectDB;
