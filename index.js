require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// Middleware: Enable CORS for Vercel, localhost & custom domains
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowed = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://medizo.life',
      'https://www.medizo.life'
    ];
    
    if (allowed.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.github.io')) {
      return callback(null, true);
    }
    return callback(null, true); // Allow all origins for API accessibility
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

app.use(express.json());
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
