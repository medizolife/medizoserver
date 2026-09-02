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
const familyProfileRoutes = require('../routes/familyProfiles');
const billingRoutes = require('../routes/billing');
const networkRoutes = require('../routes/network');
const referralRoutes = require('../routes/referrals');
const homeCareRoutes = require('../routes/homeCare');
const nurseAssignmentRoutes = require('../routes/nurseAssignments');
const nurseScheduleRoutes = require('../routes/nurseSchedules');
const inventoryRoutes = require('../routes/inventory');

// Import user model for demo users
const { createDemoUsers } = require('../models/user');

// Initialize express app for Vercel Serverless
const app = express();
let isInitialized = false;

const initializeApp = async () => {
  if (isInitialized) return;
  try {
    await connectDB();
    // Only seed demo users in development/staging (set SEED_DEMO_USERS=true in env)
    if (process.env.SEED_DEMO_USERS === 'true') {
      await createDemoUsers();
    }
    isInitialized = true;
  } catch (err) {
    console.error('Initialization error:', err);
  }
};

const helmet = require('helmet');
const { generalApiLimiter } = require('../middleware/rateLimiter');

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false // Allows dynamic frontend rendering & PDF canvas
}));

// Allowed origins for CORS
const allowedOrigins = [
  'https://www.medizo.life',
  'https://m.medizo.life',
  'https://medizo.life',
  'https://medizo-life.vercel.app',
  'https://medizoserver.medizolife.workers.dev',
  'https://medizoserver.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:8081'
];

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Server-to-server or non-browser client
  if (allowedOrigins.includes(origin)) return true;
  // Allow official Medizo subdomains & Vercel deployment previews
  if (/^https:\/\/([a-z0-9-]+\.)?medizo\.life$/i.test(origin)) return true;
  if (/^https:\/\/medizo-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
};

// Middleware: Strict CORS configuration & preflight handling
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Accept');
  }

  if (req.method === 'OPTIONS') {
    return isOriginAllowed(origin) ? res.status(200).end() : res.status(403).end();
  }
  next();
});

// Global Rate Limiting for API routes
app.use(['/api/', '/'], generalApiLimiter);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
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

const Image = require('../models/ImageModel');
const uploadsDir = (process.env.VERCEL || typeof __dirname === 'undefined') 
  ? '/tmp/uploads' 
  : path.join(__dirname, '../uploads');

// Universal file server (Disk + Cloudflare D1 fallback) with path traversal protection
const serveUploadedFile = async (req, res) => {
  try {
    const rawFilename = req.params.filename;
    if (!rawFilename) {
      return res.status(400).json({ message: 'Filename required' });
    }
    const safeFilename = path.basename(rawFilename);
    const folder = req.params.folder ? path.basename(req.params.folder) : 'records';

    // 1. Try local filesystem if available (Node.js environment)
    if (typeof fs !== 'undefined' && fs.existsSync && typeof path !== 'undefined') {
      const possiblePaths = [
        path.join(uploadsDir, folder, safeFilename),
        path.join(uploadsDir, safeFilename)
      ].filter(Boolean);

      for (const p of possiblePaths) {
        try {
          if (p.startsWith(uploadsDir) && fs.existsSync(p)) {
            return res.sendFile(p);
          }
        } catch (e) {}
      }
    }

    // 2. Query Cloudflare D1 images table
    const image = await Image.findOne({ filename: safeFilename });
    if (image && image.data) {
      res.set('Content-Type', image.mimeType || 'application/octet-stream');
      res.set('Content-Disposition', 'inline');
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(image.data);
    }

    return res.status(404).json({ message: 'File not found' });
  } catch (err) {
    console.error('Serve uploaded file error:', err);
    return res.status(500).json({ message: 'Server error retrieving file' });
  }
};

// Mount upload endpoints with and without /api prefix
app.get([
  '/api/uploads/records/:filename',
  '/uploads/records/:filename',
  '/api/uploads/:folder/:filename',
  '/uploads/:folder/:filename',
  '/api/uploads/:filename',
  '/uploads/:filename',
  '/api/prescriptions/records/:filename',
  '/prescriptions/records/:filename',
  '/api/prescriptions/images/:filename',
  '/prescriptions/images/:filename'
], serveUploadedFile);

// Routes with /api prefix
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/digilocker', digilockerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/family-profiles', familyProfileRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/home-care', homeCareRoutes);
app.use('/api/nurse-assignments', nurseAssignmentRoutes);
app.use('/api/nurse-schedules', nurseScheduleRoutes);
app.use('/api/inventory', inventoryRoutes);

// Routes without /api prefix (for Vercel rewrites)
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/doctors', doctorRoutes);
app.use('/patients', patientRoutes);
app.use('/prescriptions', prescriptionRoutes);
app.use('/digilocker', digilockerRoutes);
app.use('/admin', adminRoutes);
app.use('/family-profiles', familyProfileRoutes);
app.use('/billing', billingRoutes);
app.use('/network', networkRoutes);
app.use('/referrals', referralRoutes);
app.use('/home-care', homeCareRoutes);
app.use('/nurse-assignments', nurseAssignmentRoutes);
app.use('/nurse-schedules', nurseScheduleRoutes);
app.use('/inventory', inventoryRoutes);

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
