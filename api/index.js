require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// Import database connection
const connectDB = require('../config/db');
const { isD1Connected } = require('../config/d1-client');

// Import routes
const authRoutes = require('../routes/auth');
const doctorRoutes = require('../routes/doctors');
const patientRoutes = require('../routes/patients');
const prescriptionRoutes = require('../routes/prescriptions');
const userRoutes = require('../routes/users');
const digilockerRoutes = require('../routes/digilocker');
const adminRoutes = require('../routes/admin');

// Import user model for demo users
const { createDemoUsers } = require('../models/user');

// Initialize express app for Vercel Serverless
const app = express();
let isInitialized = false;

const initializeApp = async () => {
  if (isInitialized) return;
  try {
    await connectDB();
    await createDemoUsers();
    isInitialized = true;
  } catch (err) {
    console.error('Initialization error:', err);
  }
};

// Allowed origins for CORS
const allowedOrigins = [
  'https://www.medizo.life',
  'https://m.medizo.life',
  'https://medizo.life',
  'https://medizo-life.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081'
];

// Enable CORS for all frontend requests & handle preflight OPTIONS immediately
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // Allow any origin in development, but log unknown origins
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Initialize DB on cold start (non-blocking for errors)
app.use(async (req, res, next) => {
  if (!isInitialized) {
    try {
      await initializeApp();
    } catch (e) {
      console.error('Cold start init error:', e);
    }
  }
  next();
});

// Routes with /api prefix
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/digilocker', digilockerRoutes);
app.use('/api/admin', adminRoutes);

// Routes without /api prefix (for Vercel rewrites)
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/doctors', doctorRoutes);
app.use('/patients', patientRoutes);
app.use('/prescriptions', prescriptionRoutes);
app.use('/digilocker', digilockerRoutes);
app.use('/admin', adminRoutes);

// Root & Health check
app.get('/api/health', async (req, res) => {
  const connected = await isD1Connected();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: connected ? 'd1' : 'disconnected',
    dbName: 'medizolifecloud'
  });
});

app.get('/health', async (req, res) => {
  const connected = await isD1Connected();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: connected ? 'd1' : 'disconnected'
  });
});

app.get('/api', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

module.exports = app;
