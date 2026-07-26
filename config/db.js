const mongoose = require('mongoose');
const { getMongoUri } = require('../config/mongo.config');

/**
 * Connect to MongoDB using the configured URI.
 * Priority order:
 * 1. Environment variables (MONGO_URI or MONGODB_URI)
 * 2. Local config file (server/config/mongo.json) - development only
 * Returns a boolean indicating whether the connection succeeded.
 */
const connectDB = async () => {
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    console.log('MongoDB URI not configured (env or server/config/mongo.json). Using JSON fallback storage');
    return false;
  }

  try {
    console.log('Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000
    });

    console.log(`MongoDB connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    console.log('Falling back to JSON file storage');
    return false;
  }
};

module.exports = connectDB;
