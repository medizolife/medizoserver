const fs = require('fs');
const path = require('path');

/**
 * Get the MongoDB URI from environment variables or a local config file.
 * Strips surrounding quotes automatically if passed in Vercel environment variables.
 */
function getMongoUri() {
  // Prefer environment variables
  const envUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  let uri = envUri || null;

  if (!uri) {
    // Fallback to local config file
    try {
      const configPath = path.join(__dirname, 'mongo.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const data = JSON.parse(raw);
        uri = data.MONGO_URI || data.MONGODB_URI || data.uri || data.mongoUri || null;
      }
    } catch (err) {
      console.error('Failed to read local mongo config:', err.message);
    }
  }

  if (uri) {
    uri = uri.trim().replace(/^["']|["']$/g, '');
    // Ensure default dbName 'medizolife' is specified if missing before query parameters
    if (uri.includes('.mongodb.net/?')) {
      uri = uri.replace('.mongodb.net/?', '.mongodb.net/medizolife?');
    } else if (uri.endsWith('.mongodb.net/')) {
      uri = uri + 'medizolife';
    }
  }

  return uri;
}

module.exports = { getMongoUri };
