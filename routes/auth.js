const express = require('express');
const router = express.Router();
const { registerUser, loginUser, loginUserByMobile, sendForgotPasswordEmail, updateUserEmail, updateUserPhone, validateRegistrationData, googleLogin, sendLoginOtp, loginUserByEmailOtp } = require('../services/authService');

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate with Google OAuth
 * @access  Public
 */
router.post('/google', async (req, res) => {
  try {
    const { credential, role } = req.body;
    
    if (!credential) {
      return res.status(400).json({ message: 'Google credential is required' });
    }
    
    // Authenticate or register user with Google
    const { user, token, isNewUser } = await googleLogin(credential, role);
    
    res.json({ 
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      user, 
      token,
      isNewUser
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ message: error.message });
  }
});

/**
 * @route   POST /api/auth/send-login-otp
 * @desc    Send login OTP code to email
 * @access  Public
 */
router.post('/send-login-otp', async (req, res) => {
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
router.post('/login-email-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP verification code are required' });
    }
    
    const { user, token } = await loginUserByEmailOtp(email, otp);
    
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
router.post('/register', async (req, res) => {
  try {
    const userData = req.body;
    
    // Validate input data
    const validation = validateRegistrationData(userData);
    if (!validation.isValid) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validation.errors 
      });
    }
    
    // Register user
    const { user, token } = await registerUser(userData);
    
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
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Authenticate user
    const { user, token } = await loginUser(email, password);
    
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
router.post('/login-mobile', async (req, res) => {
  try {
    const { mobileNumber, dateOfBirth, password } = req.body;
    
    if (!mobileNumber || !password) {
      return res.status(400).json({ message: 'Mobile number and password are required' });
    }
    
    const { user, token } = await loginUserByMobile(mobileNumber, dateOfBirth, password);
    
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
router.post('/forgot-password', async (req, res) => {
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
    
    res.json({ 
      message: 'Email address updated successfully',
      user: updatedUser
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
    
    res.json({ 
      message: 'Mobile number updated successfully',
      user: updatedUser
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
