const jwt = require('jsonwebtoken');
const { findUserById } = require('../models/user');

/**
 * Authenticate JWT token and add user to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const auth = async (req, res, next) => {
  // Get token from header
  const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');
  
  // Check if no token
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  
  try {
    // Verify token - use env variable or fallback secret
    const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
    const decoded = jwt.verify(token, jwtSecret);
    
    // Get full user data (now async)
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
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
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
  // First authenticate user
  await auth(req, res, () => {
    // Check if user is a patient
    if (req.user && req.user.role !== 'patient') {
      return res.status(403).json({ message: 'Access denied: Patients only' });
    }
    next();
  });
};

module.exports = {
  auth,
  doctor,
  patient
};
