const crypto = require('crypto');
const { createUser, authenticateUser, authenticateUserByMobile, findUserByEmail, findUserByMobile, updateUser, findOrCreateGoogleUser } = require('../models/user');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_CLIENT_IDS = [
  GOOGLE_CLIENT_ID,
  '972944325297-fh67828kvguogf9coekjn6q07a2krv8o.apps.googleusercontent.com',
  '972944325297-039g1ck54cfgcip05q94ru34ggepdf7s.apps.googleusercontent.com',
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
  
  const hasEmail = userData.email && userData.email.trim();
  const hasMobile = (userData.phone && userData.phone.trim()) || (userData.mobileNumber && userData.mobileNumber.trim()) || (userData.contactNumber && userData.contactNumber.trim());

  if (!hasEmail && !hasMobile) {
    errors.push('Either Email or Mobile number is required');
  }

  if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email.trim())) {
    errors.push('Invalid email format');
  }
  if (!userData.password || userData.password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  // Disallow admin role in public self-registration (admin accounts must be provisioned internally)
  if (!userData.role || !['doctor', 'patient', 'pharmacist', 'nurse'].includes(userData.role)) {
    errors.push('Valid role is required (doctor, patient, pharmacist, or nurse)');
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Promise<{user: Object, token: string}>}
 */
const registerUser = async (userData) => {
  const cleanData = {
    ...userData,
    firstName: userData.firstName ? userData.firstName.trim() : '',
    lastName: userData.lastName ? userData.lastName.trim() : '',
    email: userData.email ? userData.email.trim().toLowerCase() : ''
  };
  const user = await createUser(cleanData);

  // Generate JWT token
  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '7d' }
  );

  return { user, token };
};

/**
 * Login user with email and password
 * @param {string} email
 * @param {string} password
 * @param {string|null} clientIp
 * @returns {Promise<{user: Object, token: string}>}
 */
const loginUser = async (email, password, clientIp = null) => {
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';
  return await authenticateUser(cleanEmail, password, clientIp);
};

/**
 * Login user with mobile number, date of birth, and password
 * @param {string} mobileNumber
 * @param {string} dateOfBirth
 * @param {string} password
 * @param {string|null} clientIp
 */
const loginUserByMobile = async (mobileNumber, dateOfBirth, password, clientIp = null) => {
  return await authenticateUserByMobile(mobileNumber, dateOfBirth, password, clientIp);
};

/**
 * Send Password Reset OTP email using GoDaddy email
 */
const sendForgotPasswordEmail = async (emailOrMobile) => {
  let user = null;
  if (emailOrMobile.includes('@')) {
    user = await findUserByEmail(emailOrMobile.trim().toLowerCase());
  } else {
    user = await findUserByMobile(emailOrMobile.trim());
  }

  if (!user) {
    throw new Error('No user found with the provided Email or Mobile number');
  }

  // Generate cryptographically secure 6-digit OTP
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

  // Persist to user record in D1
  try {
    await updateUser(user.id, { resetOtp: otpCode, resetOtpExpires: expiresAt });
  } catch (e) {
    console.warn('D1 resetOtp update notice:', e.message);
  }

  // Determine destination email
  let destinationEmail = user.email;
  if (destinationEmail.endsWith('@patient.medizo.life')) {
    throw new Error('This account does not have a real email address configured. Please contact support.');
  }

  // Send Email with OTP
  const { sendEmail } = require('./email');
  await sendEmail({
    to: destinationEmail,
    subject: 'Medizo Life - Password Reset Code',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; max-width: 600px; margin: auto;">
        <h2 style="color: #1A312C; font-weight: 800;">Password Reset Request</h2>
        <p>Hello ${user.firstName},</p>
        <p>Your 6-digit password reset verification code is:</p>
        <div style="background: #e6f4f0; padding: 16px; border-radius: 10px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1A312C;">${otpCode}</span>
        </div>
        <p>This code is valid for 5 minutes. If you did not request a password reset, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #666;">Sent automatically by Medizo Life Healthcare Systems</p>
      </div>
    `
  });

  return { 
    message: 'Password reset code has been sent to your email',
    emailMasked: destinationEmail.replace(/(.{2})(.*)(?=@)/, '$1***') 
  };
};

/**
 * Verify Google ID token and extract user info
 * @param {string} credential Google ID token
 * @returns {Object} Google user info
 */
const verifyGoogleToken = async (credential) => {
  if (!credential) {
    throw new Error('Google token is required');
  }

  // Cryptographically verify ID token signature against Google certificates
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: ALLOWED_CLIENT_IDS
    });
    const payload = ticket.getPayload();
    if (payload && payload.email) {
      return {
        googleId: payload.sub,
        email: payload.email.toLowerCase(),
        firstName: payload.given_name || payload.name?.split(' ')[0] || 'User',
        lastName: payload.family_name || payload.name?.split(' ').slice(1).join(' ') || '',
        picture: payload.picture
      };
    }
  } catch (verifyError) {
    console.error('Google token cryptographic verification failed:', verifyError.message);
    throw new Error('Invalid or expired Google authentication token');
  }

  throw new Error('Invalid Google token');
};

/**
 * Update a patient's email address (replace @patient.medizo.life placeholder)
 * @param {string} userId
 * @param {string} newEmail
 */
const updateUserEmail = async (userId, newEmail) => {
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new Error('Invalid email format');
  }

  // Check if email is already taken by another user
  const existing = await findUserByEmail(newEmail.toLowerCase());
  if (existing && existing.id !== userId) {
    throw new Error('This email address is already registered to another account');
  }

  const updated = await updateUser(userId, { email: newEmail.toLowerCase() });
  if (!updated) {
    throw new Error('Failed to update email address');
  }
  return updated;
};

/**
 * Update a patient's phone number
 */
const updateUserPhone = async (userId, phone) => {
  const cleanPhone = (phone || '').replace(/[\s\-\(\)\+]/g, '');
  if (!cleanPhone) {
    throw new Error('A valid mobile number is required');
  }

  // Check if phone is already taken
  const existing = await findUserByMobile(cleanPhone);
  if (existing && existing.id !== userId) {
    throw new Error('This mobile number is already registered to another account');
  }

  const updated = await updateUser(userId, { phone: cleanPhone });
  if (!updated) {
    throw new Error('Failed to update mobile number');
  }
  return updated;
};

/**
 * Login or register user via Google OAuth
 * @param {string} credential Google ID token
 * @param {string} role User role (doctor/patient) - only used for new users
 * @param {string|null} clientIp Client IP Address
 */
const googleLogin = async (credential, role = null, clientIp = null) => {
  try {
    // Verify Google token
    const googleUserInfo = await verifyGoogleToken(credential);
    
    // Find or create user
    const result = await findOrCreateGoogleUser(googleUserInfo, role, clientIp);
    
    return result;
  } catch (error) {
    throw error;
  }
};

// In-memory OTP storage with attempt tracking (key: email, value: { code, expires, attempts })
const loginOtpStore = new Map();

/**
 * Send Login OTP to user's registered email
 * @param {string} email 
 */
const sendLoginOtp = async (email) => {
  if (!email || !email.trim()) {
    throw new Error('Email address is required');
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.endsWith('@patient.medizo.life')) {
    throw new Error('This account does not have a real email address registered. Please log in using your Mobile Number & Date of Birth.');
  }

  const user = await findUserByEmail(cleanEmail);
  if (!user) {
    throw new Error('No Medizo account found with this email address. Please create an account first to select your role (Doctor or Patient).');
  }

  // Cryptographically secure 6-digit OTP
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // Valid for 5 minutes

  // 1. Store in-memory for instant verification with attempt tracking
  loginOtpStore.set(cleanEmail, {
    code: otpCode,
    expires: expiresAt,
    attempts: 0
  });

  // 2. Persist to D1 user record
  try {
    await updateUser(user.id, { loginOtp: otpCode, loginOtpExpires: expiresAt });
  } catch (e) {
    console.warn('D1 OTP column update notice:', e.message);
  }

  try {
    const { sendEmail } = require('./email');
    await sendEmail({
      to: cleanEmail,
      subject: 'Your Login Verification Code - Medizo Life',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; max-width: 600px; margin: auto;">
          <h2 style="color: #1A312C; font-weight: 800;">Medizo Life Login Verification</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your 6-digit login verification OTP code is:</p>
          <div style="background: #e6f4f0; padding: 16px; border-radius: 10px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1A312C;">${otpCode}</span>
          </div>
          <p>This code is valid for 5 minutes. If you did not request this login code, please ignore this message.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">Sent automatically by Medizo Life Healthcare Systems</p>
        </div>
      `
    });
  } catch (emailErr) {
    console.error('Failed to send login OTP email:', emailErr);
    throw new Error(`Email delivery failed: ${emailErr.message || 'SMTP service error'}`);
  }

  return {
    message: 'OTP verification code sent to your email',
    emailMasked: cleanEmail.replace(/(.{2})(.*)(?=@)/, '$1***')
  };
};

/**
 * Login user via Email and OTP
 * @param {string} email 
 * @param {string} otp 
 * @param {string|null} clientIp
 */
const loginUserByEmailOtp = async (email, otp, clientIp = null) => {
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';
  const cleanOtp = String(otp).trim();

  const user = await findUserByEmail(cleanEmail);
  if (!user) {
    throw new Error('No account found with this email address');
  }

  const now = Date.now();
  const stored = loginOtpStore.get(cleanEmail);

  // Check attempt limit
  if (stored && stored.attempts >= 5) {
    loginOtpStore.delete(cleanEmail);
    try {
      await updateUser(user.id, { loginOtp: '', loginOtpExpires: 0 });
    } catch (e) {}
    throw new Error('Too many failed OTP attempts. Please request a new verification code.');
  }

  const isValidInStore = stored && stored.code === cleanOtp && stored.expires > now;
  const isValidOnUser = user.loginOtp && String(user.loginOtp).trim() === cleanOtp && Number(user.loginOtpExpires) > now;

  if (!isValidInStore && !isValidOnUser) {
    if (stored) {
      stored.attempts = (stored.attempts || 0) + 1;
      loginOtpStore.set(cleanEmail, stored);
    }
    throw new Error('Invalid or expired OTP code. Please request a new verification code.');
  }

  // Clear used OTP and update lastLogin & lastLoginIp
  loginOtpStore.delete(cleanEmail);
  const nowIso = new Date().toISOString();
  try {
    const updatePayload = { loginOtp: '', loginOtpExpires: 0, lastLogin: nowIso, updatedAt: nowIso };
    if (clientIp) {
      updatePayload.lastLoginIp = String(clientIp);
      updatePayload.ipAddress = String(clientIp);
    }
    await updateUser(user.id, updatePayload);
    user.lastLogin = nowIso;
    if (clientIp) {
      user.lastLoginIp = String(clientIp);
      user.ipAddress = String(clientIp);
    }
    user.updatedAt = nowIso;
  } catch (e) {}

  // Generate JWT token
  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '7d' }
  );

  const sanitizeUser = (u) => {
    if (!u) return null;
    const { password, loginOtp, loginOtpExpires, resetOtp, resetOtpExpires, ...rest } = u;
    return rest;
  };

  return { user: sanitizeUser(user), token };
};

module.exports = {
  verifyGoogleToken,
  googleLogin,
  loginUser,
  loginUserByMobile,
  sendForgotPasswordEmail,
  updateUserEmail,
  updateUserPhone,
  registerUser,
  validateRegistrationData,
  sendLoginOtp,
  loginUserByEmailOtp
};
