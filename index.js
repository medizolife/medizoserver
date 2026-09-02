require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Import database connection
const connectDB = require('./config/db');
const { isD1Connected } = require('./config/d1-client');

// Import routes
const authRoutes = require('./routes/auth');
const doctorRoutes = require('./routes/doctors');
const patientRoutes = require('./routes/patients');
const prescriptionRoutes = require('./routes/prescriptions');

// Import user model for demo users
const { createDemoUsers } = require('./models/user');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;
let d1Connected = false;
let isInitialized = false;

// Connect to D1
const initializeApp = async () => {
  if (isInitialized) return;
  
  try {
    d1Connected = await connectDB();
    
    if (d1Connected) {
      console.log('Using Cloudflare D1 for data storage');
    } else {
      console.log('Cloudflare D1 connection failed. Check credentials in .env');
    }
    
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
const { generalApiLimiter } = require('./middleware/rateLimiter');

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false // Allows dynamic frontend rendering & PDF canvas
}));

// Ensure uploads directory exists
const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {
    console.log('Uploads directory creation notice:', e.message);
  }
}

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
app.use('/api/', generalApiLimiter);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Middleware to ensure DB connection on serverless calls
app.use(async (req, res, next) => {
  if (!isInitialized) {
    await initializeApp();
  }
  next();
});

// Serve static files from uploads directory with path traversal protection & D1 fallback
const Image = require('./models/ImageModel');
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
], async (req, res) => {
  try {
    const rawFilename = req.params.filename || '';
    // Sanitize filename to prevent path traversal
    const safeFilename = path.basename(rawFilename);
    const folder = req.params.folder ? path.basename(req.params.folder) : 'records';
    
    const filePath = path.join(uploadsDir, folder, safeFilename);
    const directPath = path.join(uploadsDir, safeFilename);
    
    // Validate resolved paths remain inside uploadsDir
    if (filePath.startsWith(uploadsDir) && fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    if (directPath.startsWith(uploadsDir) && fs.existsSync(directPath)) {
      return res.sendFile(directPath);
    }
    
    const img = await Image.findOne({ filename: safeFilename });
    if (img && img.data) {
      res.set('Content-Type', img.mimeType || 'application/octet-stream');
      res.set('Content-Disposition', 'inline');
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(img.data);
    }
    return res.status(404).json({ message: 'File not found' });
  } catch (err) {
    console.error('Serve record file error:', err);
    res.status(500).json({ message: 'Server error retrieving file' });
  }
});

app.use('/uploads', express.static(uploadsDir, { dotfiles: 'ignore', index: false }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', require('./routes/users'));
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/digilocker', require('./routes/digilocker'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/family-profiles', require('./routes/familyProfiles'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/network', require('./routes/network'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/home-care', require('./routes/homeCare'));
app.use('/api/nurse-assignments', require('./routes/nurseAssignments'));
app.use('/api/nurse-schedules', require('./routes/nurseSchedules'));
app.use('/api/inventory', require('./routes/inventory'));

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const connected = await isD1Connected();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: connected ? 'd1' : 'disconnected',
    d1Configured: Boolean(process.env.CLOUDFLARE_D1_DATABASE_ID)
  });
});

// Start local server if not running as serverless function on Vercel
if (!process.env.VERCEL) {
  initializeApp().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to initialize app:', err);
  });
}

module.exports = app;
