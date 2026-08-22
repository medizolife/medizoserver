const { isD1Connected, isD1Configured } = require('./d1-client');

let isConnected = false;

/**
 * Connect to Cloudflare D1
 * @returns {Promise<boolean>} Whether D1 is connected and ready
 */
const connectDB = async () => {
  if (isConnected) {
    return true;
  }

  if (!isD1Configured()) {
    console.log('Cloudflare D1 credentials not configured.');
    return false;
  }

  try {
    // Quick single connectivity check
    const connected = await isD1Connected();
    if (!connected) {
      console.log('Cloudflare D1 connection check failed.');
      return false;
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
