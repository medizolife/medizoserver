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
  googleLogin
};
