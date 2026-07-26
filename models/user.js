const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Import MongoDB model
let UserModel;
try {
  UserModel = require('./UserModel');
} catch (e) {
  UserModel = null;
}

// Path to users data file (fallback)
const usersFilePath = path.join(__dirname, '../data/users.json');

// Ensure data directory exists
const dataDir = path.dirname(usersFilePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize users file if it doesn't exist
if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2));
}

// Check if MongoDB is connected
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

/**
 * Get all users
 * @returns {Array} Array of users
 */
const getUsers = async () => {
  if (isMongoConnected() && UserModel) {
    try {
      const users = await UserModel.find({});
      return users.map(u => u.toJSON());
    } catch (error) {
      console.error('MongoDB getUsers error:', error);
    }
  }
  
  // Fallback to JSON file
  try {
    if (!fs.existsSync(usersFilePath)) {
      fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users file:', error);
    return [];
  }
};

// Sync version for backward compatibility
const getUsersSync = () => {
  try {
    if (!fs.existsSync(usersFilePath)) {
      fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users file:', error);
    return [];
  }
};

/**
 * Save users to the JSON file (fallback only)
 * @param {Array} users - Array of users to save
 */
const saveUsers = (users) => {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    console.log('Users saved successfully, count:', users.length);
  } catch (error) {
    console.error('Error writing users file:', error);
  }
};

/**
 * Find a user by email
 * @param {string} email - Email to search for
 * @returns {Object|null} User object or null if not found
 */
const findUserByEmail = async (email) => {
  if (!email) return null;
  
  if (isMongoConnected() && UserModel) {
    try {
      const user = await UserModel.findOne({ email: email.toLowerCase() });
      return user ? { ...user.toJSON(), password: user.password } : null;
    } catch (error) {
      console.error('MongoDB findUserByEmail error:', error);
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  const target = String(email).toLowerCase();
  return users.find(user => String(user.email).toLowerCase() === target) || null;
};

/**
 * Find a user by ID
 * @param {string} id - User ID to search for
 * @returns {Object|null} User object or null if not found
 */
const findUserById = async (id) => {
  if (!id) return null;
  
  if (isMongoConnected() && UserModel) {
    try {
      const user = await UserModel.findById(id);
      return user ? user.toJSON() : null;
    } catch (error) {
      console.error('MongoDB findUserById error:', error);
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  return users.find(user => user.id === id) || null;
};

/**
 * Create a new user
 * @param {Object} userData - User data
 * @returns {Object} Created user object
 */
const createUser = async (userData) => {
  if (isMongoConnected() && UserModel) {
    try {
      // Check if user already exists
      const existingUser = await UserModel.findOne({ email: userData.email.toLowerCase() });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }
      
      const newUser = new UserModel(userData);
      await newUser.save();
      return newUser.toJSON();
    } catch (error) {
      console.error('MongoDB createUser error:', error);
      throw error;
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  
  // Check if user already exists
  if (users.some(user => user.email.toLowerCase() === userData.email.toLowerCase())) {
    throw new Error('User with this email already exists');
  }
  
  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(userData.password, salt);
  
  // Create new user
  const newUser = {
    id: Date.now().toString(),
    ...userData,
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };
  
  // Save user
  users.push(newUser);
  saveUsers(users);
  
  // Remove password from returned object
  const { password, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
};

/**
 * Update a user
 * @param {string} id - User ID
 * @param {Object} userData - User data to update
 * @returns {Object|null} Updated user object or null if not found
 */
const updateUser = async (id, userData) => {
  if (isMongoConnected() && UserModel) {
    try {
      // Handle password update
      if (userData.password) {
        const salt = await bcrypt.genSalt(10);
        userData.password = await bcrypt.hash(userData.password, salt);
      }
      
      const user = await UserModel.findByIdAndUpdate(
        id,
        { ...userData, updatedAt: new Date() },
        { new: true }
      );
      return user ? user.toJSON() : null;
    } catch (error) {
      console.error('MongoDB updateUser error:', error);
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    return null;
  }
  
  // Handle password update
  if (userData.password) {
    const salt = await bcrypt.genSalt(10);
    userData.password = await bcrypt.hash(userData.password, salt);
  }
  
  // Update user
  users[index] = {
    ...users[index],
    ...userData,
    updatedAt: new Date().toISOString()
  };
  
  saveUsers(users);
  
  // Remove password from returned object
  const { password, ...userWithoutPassword } = users[index];
  return userWithoutPassword;
};

/**
 * Delete a user
 * @param {string} id - User ID
 * @returns {boolean} Success status
 */
const deleteUser = async (id) => {
  if (isMongoConnected() && UserModel) {
    try {
      const result = await UserModel.findByIdAndDelete(id);
      return !!result;
    } catch (error) {
      console.error('MongoDB deleteUser error:', error);
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  const filteredUsers = users.filter(user => user.id !== id);
  
  if (filteredUsers.length === users.length) {
    return false;
  }
  
  saveUsers(filteredUsers);
  return true;
};

/**
 * Authenticate a user
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Object} User object and JWT token
 */
const authenticateUser = async (email, password) => {
  const user = await findUserByEmail(email);
  
  if (!user) {
    throw new Error('Invalid credentials');
  }
  
  let isPasswordValid;
  
  if (isMongoConnected() && UserModel) {
    try {
      const mongoUser = await UserModel.findOne({ email: email.toLowerCase() });
      if (mongoUser) {
        isPasswordValid = await mongoUser.comparePassword(password);
      } else {
        isPasswordValid = await bcrypt.compare(password, user.password);
      }
    } catch (error) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    }
  } else {
    isPasswordValid = await bcrypt.compare(password, user.password);
  }
  
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }
  
  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  const token = jwt.sign(
    { id: user.id || user._id, role: user.role },
    jwtSecret,
    { expiresIn: '1d' }
  );
  
  // Remove password from returned object
  const { password: userPassword, ...userWithoutPassword } = user;
  
  return {
    user: userWithoutPassword,
    token
  };
};

/**
 * Create demo users if none exist
 */
const createDemoUsers = async () => {
  try {
    const users = await getUsers();
    
    if (users.length === 0) {
      console.log('Creating demo users...');
      
      // Create doctor
      await createUser({
        firstName: 'Dr. John',
        lastName: 'Smith',
        email: 'doctor@test.com',
        password: 'password123',
        role: 'doctor',
        specialization: 'General Physician',
        licenseNumber: 'DOC123456'
      });
      
      // Create patient
      await createUser({
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'patient@test.com',
        password: 'password123',
        role: 'patient',
        dateOfBirth: '1990-05-15',
        gender: 'female',
        phone: '555-0123',
        address: '123 Main St, City',
        bloodType: 'O+',
        allergies: ['Penicillin'],
        chronicConditions: [],
        emergencyContact: {
          name: 'Mike Johnson',
          relationship: 'Husband',
          phone: '555-0124'
        }
      });
      
      console.log('Demo users created: doctor@test.com / patient@test.com (password: password123)');
    }
  } catch (error) {
    console.error('Error creating demo users:', error);
  }
};

module.exports = {
  getUsers,
  getUsersSync,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  authenticateUser,
  createDemoUsers,
  isMongoConnected,
  findOrCreateGoogleUser
};

/**
 * Find or create a user via Google OAuth
 * @param {Object} googleUserInfo - User info from Google
 * @param {string} role - User role (for new users)
 * @returns {Object} User object, JWT token, and isNewUser flag
 */
async function findOrCreateGoogleUser(googleUserInfo, role = 'patient') {
  const { googleId, email, firstName, lastName, picture } = googleUserInfo;
  
  if (isMongoConnected() && UserModel) {
    try {
      // First check if user exists by googleId or email
      let user = await UserModel.findOne({ 
        $or: [{ googleId }, { email: email.toLowerCase() }] 
      });
      
      let isNewUser = false;
      
      if (!user) {
        // Create new user
        user = new UserModel({
          googleId,
          email: email.toLowerCase(),
          firstName,
          lastName,
          picture,
          role,
          authProvider: 'google'
        });
        await user.save();
        isNewUser = true;
        console.log('Created new Google user:', email);
      } else if (!user.googleId) {
        // Link existing email account to Google
        user.googleId = googleId;
        user.picture = picture || user.picture;
        user.authProvider = 'google';
        await user.save();
        console.log('Linked existing account to Google:', email);
      }
      
      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
      const token = jwt.sign(
        { id: user._id, role: user.role },
        jwtSecret,
        { expiresIn: '1d' }
      );
      
      return { user: user.toJSON(), token, isNewUser };
    } catch (error) {
      console.error('MongoDB findOrCreateGoogleUser error:', error);
      throw error;
    }
  }
  
  // Fallback to JSON file
  const users = getUsersSync();
  let user = users.find(u => 
    u.googleId === googleId || u.email.toLowerCase() === email.toLowerCase()
  );
  
  let isNewUser = false;
  
  if (!user) {
    // Create new user
    user = {
      id: Date.now().toString(),
      googleId,
      email: email.toLowerCase(),
      firstName,
      lastName,
      picture,
      role,
      authProvider: 'google',
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);
    isNewUser = true;
    console.log('Created new Google user (JSON):', email);
  } else if (!user.googleId) {
    // Link existing account
    user.googleId = googleId;
    user.picture = picture || user.picture;
    user.authProvider = 'google';
    const index = users.findIndex(u => u.id === user.id);
    users[index] = user;
    saveUsers(users);
    console.log('Linked existing account to Google (JSON):', email);
  }
  
  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '1d' }
  );
  
  // Remove password from returned object
  const { password, ...userWithoutPassword } = user;
  
  return { user: userWithoutPassword, token, isNewUser };
}
