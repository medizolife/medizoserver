const { createUser, authenticateUser, findUserByEmail, findOrCreateGoogleUser } = require('../models/user');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '972944325297-fh67828kvguogf9coekjn6q07a2krv8o.apps.googleusercontent.com';
const ALLOWED_CLIENT_IDS = [
  GOOGLE_CLIENT_ID,
  '972944325297-fh67828kvguogf9coekjn6q07a2krv8o.apps.googleusercontent.com',
  '972944325297-pjh1smomfgaqjtg7u1elbgl1pvul7lnr.apps.googleusercontent.com',
  '427324625620-qbg0q3s9cgu8kd80a9upco0m9147jo1u.apps.googleusercontent.com'
].filter(Boolean);
const googleClient = new OAuth2Client();

/**
 * Validate registration data
 * @param {Object} userData - Registration form data
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
const validateRegistrationData = (userData) => {
  const errors = [];

  if (!userData.firstName || !userData.firstName.trim()) {
    errors.push('First name is required');
  }
  if (!userData.lastName || !userData.lastName.trim()) {
    errors.push('Last name is required');
  }
  if (!userData.email || !userData.email.trim()) {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
    errors.push('Invalid email format');
  }
  if (!userData.password || userData.password.length < 6) {
    errors.push('Password must be at least 6 characters');
  }
  if (!userData.role || !['doctor', 'patient', 'pharmacist', 'admin'].includes(userData.role)) {
    errors.push('Valid role is required (doctor, patient, pharmacist, or admin)');
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Promise<{user: Object, token: string}>}
 */
const registerUser = async (userData) => {
  const user = await createUser(userData);

  // Generate JWT token
  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '1d' }
  );

  return { user, token };
};

/**
 * Login user with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object, token: string}>}
 */
const loginUser = async (email, password) => {
  return await authenticateUser(email, password);
};

/**
 * Verify Google ID token and extract user info
 * @param {string} credential Google ID token
 * @returns {Object} Google user info
 */
const verifyGoogleToken = async (credential) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: ALLOWED_CLIENT_IDS
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

module.exports = {
  verifyGoogleToken,
  googleLogin,
  loginUser,
  registerUser,
  validateRegistrationData
};
