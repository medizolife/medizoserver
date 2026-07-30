require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Import database connection
const connectDB = require('./config/db');

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
let mongoConnected = false;
let isInitialized = false;

// Connect to MongoDB and create demo users
const initializeApp = async () => {
  if (isInitialized) return;
  
  try {
    mongoConnected = await connectDB();
    
    if (mongoConnected) {
      console.log('Using MongoDB for data storage');
    } else {
      console.log('Using JSON file storage (fallback)');
      // In serverless environments, write to /tmp directory if needed
      const dataDir = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
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

// Middleware: Enable CORS for Vercel, localhost & custom domains & handle OPTIONS preflight
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
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

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'Accept']
}));

app.use(express.json());
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

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Medizo Healthcare System API is running on Vercel' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    storage: mongoConnected && mongoose.connection.readyState === 1 ? 'mongodb' : 'json',
    mongoUriConfigured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI)
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
