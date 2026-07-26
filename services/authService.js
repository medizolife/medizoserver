const { createUser, authenticateUser, findUserByEmail, findOrCreateGoogleUser } = require('../models/user');
const { OAuth2Client } = require('google-auth-library');

// Google OAuth Client ID - this should be set in environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Verify Google ID token and extract user info
 * @param {string} credential Google ID token
 * @returns {Object} Google user info
 */
const verifyGoogleToken = async (credential) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    return {
      googleId: payload.sub,
      email: payload.email,
      firstName: payload.given_name || payload.name?.split(' ')[0] || 'User',
      lastName: payload.family_name || payload.name?.split(' ').slice(1).join(' ') || '',
      picture: payload.picture
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    throw new Error('Invalid Google token');
  }
};

/**
 * Login or register user via Google OAuth
 * @param {string} credential Google ID token
 * @param {string} role User role (doctor/patient) - only used for new users
 * @returns {Object} User data and token
 */
const googleLogin = async (credential, role = 'patient') => {
  try {
    // Verify Google token
    const googleUserInfo = await verifyGoogleToken(credential);
    
    // Find or create user
    const { user, token, isNewUser } = await findOrCreateGoogleUser(googleUserInfo, role);
    
    return { user, token, isNewUser };
  } catch (error) {
    throw error;
  }
};

/**
 * Register a new user
 * @param {Object} userData User registration data
 * @returns {Object} Created user and token
 */
const registerUser = async (userData) => {
  try {
    // Validate required fields
    const { firstName, lastName, email, password, role } = userData;
    
    if (!firstName || !lastName || !email || !password || !role) {
      throw new Error('All fields are required');
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    
    // Validate password strength
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }
    
    // Validate role
    if (role !== 'doctor' && role !== 'patient') {
      throw new Error('Role must be either doctor or patient');
    }
    
    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }
    
    // Create user
    const newUser = await createUser(userData);
    
    // Authenticate the newly created user to get token
    const { user, token } = await authenticateUser(email, password);
    
    return { user, token };
  } catch (error) {
    throw error;
  }
};

/**
 * Login user
 * @param {string} email User email
 * @param {string} password User password
 * @returns {Object} User data and token
 */
const loginUser = async (email, password) => {
  try {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    
    return await authenticateUser(email, password);
  } catch (error) {
    throw error;
  }
};

/**
 * Validate user input for registration
 * @param {Object} userData User data to validate
 * @returns {Object} Validation result
 */
const validateRegistrationData = (userData) => {
  const errors = [];
  
  if (!userData.firstName) errors.push('First name is required');
  if (!userData.lastName) errors.push('Last name is required');
  if (!userData.email) errors.push('Email is required');
  if (!userData.password) errors.push('Password is required');
  if (!userData.role) errors.push('Role is required');
  
  if (userData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
    errors.push('Invalid email format');
  }
  
  if (userData.password && userData.password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }
  
  if (userData.role && !['doctor', 'patient'].includes(userData.role)) {
    errors.push('Role must be either doctor or patient');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  registerUser,
  loginUser,
  validateRegistrationData,
  googleLogin
};
