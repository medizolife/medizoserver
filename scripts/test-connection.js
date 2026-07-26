const mongoose = require('mongoose');
const { getMongoUri } = require('../config/mongo.config');

(async () => {
  const uri = getMongoUri();
  console.log('Using URI:', uri ? uri.replace(/(mongodb\+srv:\/\/[^:]+:)[^@]+@/, '$1<hidden>@') : 'NONE');
  if (!uri) return console.error('No URI');
  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB:', conn.connection.host);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Connection error:', err && err.message ? err.message : err);
  }
})();