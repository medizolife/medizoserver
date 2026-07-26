const fs = require('fs');
const path = require('path');

/**
 * Get the MongoDB URI from environment variables or a local config file.
 * Strips surrounding quotes automatically if passed in Vercel environment variables.
 */
function getMongoUri() {
  // Prefer environment variables
  const envUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (envUri) {
    return envUri.trim().replace(/^["']|["']$/g, '');
  }

  // Fallback to local config file
  try {
    const configPath = path.join(__dirname, 'mongo.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);
      const uri = data.MONGO_URI || data.MONGODB_URI || data.uri || data.mongoUri || null;
      if (uri) return uri.trim().replace(/^["']|["']$/g, '');
    }
  } catch (err) {
    console.error('Failed to read local mongo config:', err.message);
  }

  return null;
}

module.exports = { getMongoUri };
