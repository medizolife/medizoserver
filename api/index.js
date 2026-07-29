require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Import database connection
const connectDB = require('../config/db');

// Import routes
const authRoutes = require('../routes/auth');
const doctorRoutes = require('../routes/doctors');
const patientRoutes = require('../routes/patients');
const prescriptionRoutes = require('../routes/prescriptions');
const userRoutes = require('../routes/users');
const digilockerRoutes = require('../routes/digilocker');

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

// Enable CORS for all frontend requests
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

app.use(express.json());
app.use(cookieParser());

// Initialize DB on cold start
app.use(async (req, res, next) => {
  if (!isInitialized) {
    await initializeApp();
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

// Routes without /api prefix (for Vercel rewrites)
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/doctors', doctorRoutes);
app.use('/patients', patientRoutes);
app.use('/prescriptions', prescriptionRoutes);
app.use('/digilocker', digilockerRoutes);

// Root & Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: mongoose.connection.readyState === 1 ? 'mongodb' : 'json'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: mongoose.connection.readyState === 1 ? 'mongodb' : 'json'
  });
});

app.get('/api', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

module.exports = app;
