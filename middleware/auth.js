const jwt = require('jsonwebtoken');
const { findUserById } = require('../models/user');

/**
 * Authenticate JWT token and add user to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const auth = async (req, res, next) => {
  // Disallow query parameter tokens on standard API routes to prevent log & referrer leakage
  const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');
  
  // Check if no token
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET environment variable is not set');
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, jwtSecret);
    
    // Get full user data (async)
    const user = await findUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Remove password from user object
    const { password, ...userWithoutPassword } = user;
    
    // Add user to request
    req.user = userWithoutPassword;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message || error);
    res.status(401).json({ message: 'Token is not valid or has expired' });
  }
};

/**
 * Check if user is a doctor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const doctor = async (req, res, next) => {
  // First authenticate user
  await auth(req, res, () => {
    // Check if user is a doctor
    if (req.user && req.user.role !== 'doctor') {
      return res.status(403).json({ message: 'Access denied: Doctors only' });
    }
    next();
  });
};

/**
 * Check if user is a patient
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const patient = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && req.user.role !== 'patient' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Patients only' });
    }
    next();
  });
};

/**
 * Check if user is a nurse
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const nurse = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && req.user.role !== 'nurse') {
      return res.status(403).json({ message: 'Access denied: Nurses only' });
    }
    next();
  });
};

/**
 * Check if user is a doctor or nurse
 */
const doctorOrNurse = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && !['doctor', 'nurse', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: Clinical staff only (Doctor/Nurse)' });
    }
    next();
  });
};

/**
 * Check if user is a doctor or admin
 */
const doctorOrAdmin = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && (req.user.role === 'doctor' || req.user.role === 'admin' || req.user.email === 'admin@medizo.life')) {
      return next();
    }
    return res.status(403).json({ message: 'Access denied: Doctor or Admin privileges required' });
  });
};

/**
 * Check if user is a nurse, doctor, or admin
 */
const nurseOrDoctorOrAdmin = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && ['nurse', 'doctor', 'admin'].includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ message: 'Access denied: Clinical staff or Admin privileges required' });
  });
};

/**
 * Check if user is a pharmacist
 */
const pharmacist = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && (req.user.role === 'pharmacist' || req.user.role === 'admin' || req.user.email === 'admin@medizo.life')) {
      return next();
    }
    return res.status(403).json({ message: 'Access denied: Pharmacist privileges required' });
  });
};

/**
 * Check if user is a pharmacist or admin
 */
const pharmacistOrAdmin = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && (req.user.role === 'pharmacist' || req.user.role === 'admin' || req.user.email === 'admin@medizo.life')) {
      return next();
    }
    return res.status(403).json({ message: 'Access denied: Pharmacist or Admin privileges required' });
  });
};

module.exports = {
  auth,
  doctor,
  patient,
  nurse,
  pharmacist,
  pharmacistOrAdmin,
  doctorOrNurse,
  doctorOrAdmin,
  nurseOrDoctorOrAdmin
};


