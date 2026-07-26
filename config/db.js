const mongoose = require('mongoose');
const { getMongoUri } = require('../config/mongo.config');

let isConnected = false;

/**
 * Connect to MongoDB using the configured URI.
 * Reuses existing connection in Serverless environments.
 */
const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState === 1) {
    return true;
  }

  const mongoUri = getMongoUri();

  if (!mongoUri) {
    console.log('MongoDB URI not configured. Using fallback storage');
    return false;
  }

  try {
    console.log('Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 5000,
    });

    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    console.log('Falling back to storage');
    return false;
  }
};

module.exports = connectDB;
