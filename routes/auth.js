const express = require('express');
const router = express.Router();
const { registerUser, loginUser, validateRegistrationData, googleLogin } = require('../services/authService');

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
