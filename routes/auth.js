const express = require('express');
const router = express.Router();
const { registerUser, loginUser, loginUserByMobile, sendForgotPasswordEmail, updateUserEmail, updateUserPhone, validateRegistrationData, googleLogin, sendLoginOtp, loginUserByEmailOtp } = require('../services/authService');
const { authLimiter, otpLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter');

const getClientIp = (req) => {
  return req.headers['cf-connecting-ip'] || 
         req.headers['x-real-ip'] || 
         (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
         req.ip || 
         req.socket?.remoteAddress || 
         null;
};

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate with Google OAuth
 * @access  Public
 */
router.post('/google', authLimiter, async (req, res) => {
  try {
    const { credential, role } = req.body;
    const clientIp = getClientIp(req);
    
    if (!credential) {
      return res.status(400).json({ message: 'Google credential is required' });
    }
    
    // Authenticate or register user with Google
    const result = await googleLogin(credential, role, clientIp);
    
    res.json({ 
      message: result.requiresRoleSelection ? 'Role selection required' : (result.isNewUser ? 'Account created successfully' : 'Login successful'),
      user: result.user, 
      token: result.token,
      isNewUser: result.isNewUser,
      requiresRoleSelection: result.requiresRoleSelection,
      googleUserInfo: result.googleUserInfo
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ message: error.message || 'Google authentication failed' });
  }
});

/**
 * @route   POST /api/auth/send-login-otp
 * @desc    Send login OTP code to email
 * @access  Public
 */
router.post('/send-login-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }
    
    const result = await sendLoginOtp(email);
    res.json(result);
  } catch (error) {
    console.error('Send login OTP error:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/login-email-otp
 * @desc    Authenticate user via Email & 6-digit OTP
 * @access  Public
 */
router.post('/login-email-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    const clientIp = getClientIp(req);
    
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP verification code are required' });
    }
    
    const { user, token } = await loginUserByEmailOtp(email, otp, clientIp);
    
    res.json({ 
      message: 'Login successful',
      user, 
      token 
    });
  } catch (error) {
    console.error('Email OTP login error:', error);
    res.status(401).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const userData = req.body;
    const clientIp = getClientIp(req);
    
    // Validate input data
    const validation = validateRegistrationData(userData);
    if (!validation.isValid) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validation.errors 
      });
    }
    
    // Register user
    const { user, token } = await registerUser({ ...userData, lastLoginIp: clientIp, ipAddress: clientIp });
    
    res.status(201).json({ 
      message: 'User registered successfully',
      user, 
      token 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIp = getClientIp(req);
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Authenticate user
    const { user, token } = await loginUser(email, password, clientIp);
    
    res.json({ 
      message: 'Login successful',
      user, 
      token 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/login-mobile
 * @desc    Authenticate user via Mobile Number, DOB & Password
 * @access  Public
 */
router.post('/login-mobile', authLimiter, async (req, res) => {
  try {
    const { mobileNumber, dateOfBirth, password } = req.body;
    const clientIp = getClientIp(req);
    
    if (!mobileNumber || !password) {
      return res.status(400).json({ message: 'Mobile number and password are required' });
    }
    
    const { user, token } = await loginUserByMobile(mobileNumber, dateOfBirth, password, clientIp);
    
    res.json({ 
      message: 'Login successful',
      user, 
      token 
    });
  } catch (error) {
    console.error('Mobile login error:', error);
    res.status(401).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset OTP via GoDaddy email
 * @access  Public
 */
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { emailOrMobile } = req.body;
    
    if (!emailOrMobile) {
      return res.status(400).json({ message: 'Email or Mobile number is required' });
    }
    
    const result = await sendForgotPasswordEmail(emailOrMobile);
    res.json(result);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/update-email
 * @desc    Allow a patient to add/update their email (replace placeholder)
 * @access  Private
 */
router.post('/update-email', require('../middleware/auth').auth, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email address is required' });
    }
    
    const updatedUser = await updateUserEmail(req.user.id, email.trim());
    const jwt = require('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'medizo_jwt_secret_key_2026_health';
    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role },
      jwtSecret,
      { expiresIn: '30d' }
    );
    
    res.json({ 
      message: 'Email address updated successfully',
      user: updatedUser,
      token
    });
  } catch (error) {
    console.error('Update email error:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/update-phone
 * @desc    Allow a patient to add/update their mobile number
 * @access  Private
 */
router.post('/update-phone', require('../middleware/auth').auth, async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }
    
    const updatedUser = await updateUserPhone(req.user.id, phone.trim());
    const jwt = require('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'medizo_jwt_secret_key_2026_health';
    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role },
      jwtSecret,
      { expiresIn: '30d' }
    );
    
    res.json({ 
      message: 'Mobile number updated successfully',
      user: updatedUser,
      token
    });
  } catch (error) {
    console.error('Update phone error:', error);
    res.status(400).json({ message: error.message });
  }
});
/**
 * @route   POST /api/auth/verify-dob
 * @desc    Post-login DOB verification for mobile-login patients
 * @access  Private
 */
router.post('/verify-dob', require('../middleware/auth').auth, async (req, res) => {
  try {
    const { dateOfBirth } = req.body;
    
    if (!dateOfBirth || !dateOfBirth.trim()) {
      return res.status(400).json({ message: 'Date of Birth is required' });
    }

    const { findUserById } = require('../models/user');
    const user = await findUserById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.dateOfBirth || !user.dateOfBirth.trim()) {
      return res.json({ verified: true, message: 'No DOB on record, verification skipped' });
    }

    const userDobStr = String(user.dateOfBirth).split('T')[0].trim();
    const inputDobStr = String(dateOfBirth).split('T')[0].trim();

    if (userDobStr !== inputDobStr) {
      return res.status(400).json({ verified: false, message: 'Date of Birth does not match our records' });
    }

    res.json({ verified: true, message: 'Identity verified successfully' });
  } catch (error) {
    console.error('Verify DOB error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', require('../middleware/auth').auth, (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
