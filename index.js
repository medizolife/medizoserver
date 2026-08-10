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

// Connect to D1 and create demo users
const initializeApp = async () => {
  if (isInitialized) return;
  
  try {
    d1Connected = await connectDB();
    
    if (d1Connected) {
      console.log('Using Cloudflare D1 for data storage');
    } else {
      console.log('Cloudflare D1 connection failed. Check credentials in .env');
    }
    
    await createDemoUsers();
    isInitialized = true;
  } catch (err) {
    console.error('Initialization error:', err);
  }
};

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
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081'
];

// Middleware: Enable CORS for Vercel, localhost & custom domains & handle OPTIONS preflight
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
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
app.use(morgan('dev'));

// Middleware to ensure DB connection on serverless calls
app.use(async (req, res, next) => {
  if (!isInitialized) {
    await initializeApp();
  }
  next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', require('./routes/users'));
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/digilocker', require('./routes/digilocker'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/family-profiles', require('./routes/familyProfiles'));

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
