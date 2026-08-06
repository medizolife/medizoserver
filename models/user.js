const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { queryD1, isD1Connected: checkD1 } = require('../config/d1-client');

// JSON fields that need parsing on read and stringifying on write
const USER_JSON_FIELDS = [
  'allergies', 'diseaseHistory', 'chronicConditions',
  'emergencyContact', 'linkedPatients', 'digilockerProfile'
];

/**
 * Parse JSON fields from a raw D1 row into JS objects
 */
function parseUserRow(row) {
  if (!row) return null;
  const user = { ...row };
  // Map boolean
  user.digilockerVerified = Boolean(user.digilockerVerified);
  // Parse JSON fields
  for (const field of USER_JSON_FIELDS) {
    if (typeof user[field] === 'string') {
      try {
        user[field] = JSON.parse(user[field]);
      } catch (e) {
        // Keep as-is if not valid JSON
      }
    }
  }
  return user;
}

/**
 * Prepare user data for D1 INSERT/UPDATE — stringify JSON fields
 */
function serializeUserData(userData) {
  const data = { ...userData };
  for (const field of USER_JSON_FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      data[field] = JSON.stringify(data[field]);
    }
  }
  // Convert boolean to integer for SQLite
  if (data.digilockerVerified !== undefined) {
    data.digilockerVerified = data.digilockerVerified ? 1 : 0;
  }
  return data;
}

/**
 * Strip password and internal fields from a user object for return
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

/**
 * Check if D1 is connected
 */
const isD1ConnectedCheck = () => {
  // Synchronous check - we assume connected after init
  // The actual async check is done at startup
  return true;
};

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all users
 * @returns {Promise<Array>} Array of users
 */
const getUsers = async () => {
  try {
    const { results } = await queryD1('SELECT * FROM users');
    return results.map(row => sanitizeUser(parseUserRow(row)));
  } catch (error) {
    console.error('D1 getUsers error:', error);
    return [];
  }
};

/**
 * Find a user by email
 * @param {string} email - Email to search for
 * @returns {Promise<Object|null>} User object (WITH password) or null
 */
const findUserByEmail = async (email) => {
  if (!email) return null;
  try {
    const { results } = await queryD1(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [String(email).toLowerCase()]
    );
    return results.length > 0 ? parseUserRow(results[0]) : null;
  } catch (error) {
    console.error('D1 findUserByEmail error:', error);
    return null;
  }
};

/**
 * Find a user by mobile/phone number
 * @param {string} mobileNumber
 * @returns {Promise<Object|null>}
 */
const findUserByMobile = async (mobileNumber) => {
  if (!mobileNumber) return null;
  const cleanMobile = String(mobileNumber).trim().replace(/[\s\-\(\)\+]/g, '');
  if (!cleanMobile) return null;
  try {
    const { results } = await queryD1(
      'SELECT * FROM users WHERE phone = ? OR contactNumber = ? OR secondaryPhone = ? LIMIT 1',
      [cleanMobile, cleanMobile, cleanMobile]
    );
    if (results.length > 0) return parseUserRow(results[0]);

    // Fallback: search all users for matching cleaned phone
    const { results: allUsers } = await queryD1('SELECT * FROM users');
    const matched = allUsers.find(u => {
      const p1 = (u.phone || '').replace(/[\s\-\(\)\+]/g, '');
      const p2 = (u.contactNumber || '').replace(/[\s\-\(\)\+]/g, '');
      const p3 = (u.secondaryPhone || '').replace(/[\s\-\(\)\+]/g, '');
      return p1 === cleanMobile || p2 === cleanMobile || p3 === cleanMobile;
    });
    return matched ? parseUserRow(matched) : null;
  } catch (error) {
    console.error('D1 findUserByMobile error:', error);
    return null;
  }
};

/**
 * Find a user by ID
 * @param {string} id - User ID
 * @returns {Promise<Object|null>} User object (without password) or null
 */
const findUserById = async (id) => {
  if (!id) return null;
  try {
    const { results } = await queryD1(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return results.length > 0 ? sanitizeUser(parseUserRow(results[0])) : null;
  } catch (error) {
    console.error('D1 findUserById error:', error);
    return null;
  }
};

/**
 * Create a new user
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user object (without password)
 */
const createUser = async (userData) => {
  try {
    const mobile = userData.phone || userData.contactNumber || userData.mobileNumber;
    
    // Check email uniqueness if email provided
    if (userData.email && userData.email.trim()) {
      const existing = await findUserByEmail(userData.email);
      if (existing) {
        throw new Error('User with this email already exists');
      }
    } else if (mobile) {
      const existingMobile = await findUserByMobile(mobile);
      if (existingMobile) {
        throw new Error('User with this mobile number already exists');
      }
    }

    // Generate fallback email if email omitted (due to D1 NOT NULL schema constraint)
    const userEmail = (userData.email && userData.email.trim()) 
      ? userData.email.toLowerCase() 
      : `patient_${(mobile || Date.now()).toString().replace(/[\s\-\(\)\+]/g, '')}@patient.medizo.life`;

    // Hash password if provided
    let hashedPassword = null;
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(userData.password, salt);
    }

    // Prepare data
    const data = serializeUserData({
      ...userData,
      email: userEmail,
      phone: mobile || userData.phone || '',
      password: hashedPassword
    });

    // Build dynamic INSERT
    const allowedFields = [
      'firstName', 'lastName', 'email', 'password', 'googleId', 'picture',
      'authProvider', 'role', 'status', 'pharmacyName', 'pharmacyAddress',
      'specialization', 'licenseNumber', 'clinicAddress', 'experience',
      'clinicLatitude', 'clinicLongitude', 'clinicLocationAccuracy', 'clinicPlaceName',
      'qualifications', 'profileImage', 'clinicLogo', 'signature', 'stamp',
      'clinicName', 'alternateEmail', 'secondaryPhone', 'fax', 'whatsapp',
      'website', 'linkedin', 'twitter', 'facebook', 'instagram',
      'linkedPatients', 'dateOfBirth', 'gender', 'phone', 'contactNumber',
      'address', 'bloodType', 'allergies', 'diseaseHistory', 'chronicConditions',
      'medicalHistory', 'emergencyContact', 'digilockerVerified', 'digilockerProfile',
      'loginOtp', 'loginOtpExpires', 'resetOtp', 'resetOtpExpires'
    ];

    const fields = [];
    const placeholders = [];
    const values = [];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(field);
        placeholders.push('?');
        values.push(data[field]);
      }
    }

    const sql = `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const { results } = await queryD1(sql, values);

    if (results.length === 0) {
      throw new Error('Failed to create user');
    }

    return sanitizeUser(parseUserRow(results[0]));
  } catch (error) {
    console.error('D1 createUser error:', error);
    throw error;
  }
};

const ALLOWED_USER_COLUMNS = new Set([
  'firstName', 'lastName', 'email', 'password', 'googleId', 'picture',
  'authProvider', 'role', 'status', 'pharmacyName', 'pharmacyAddress',
  'specialization', 'licenseNumber', 'clinicAddress', 'experience',
  'clinicLatitude', 'clinicLongitude', 'clinicLocationAccuracy', 'clinicPlaceName',
  'qualifications', 'profileImage', 'clinicLogo', 'signature', 'stamp',
  'clinicName', 'alternateEmail', 'secondaryPhone', 'fax', 'whatsapp',
  'website', 'linkedin', 'twitter', 'facebook', 'instagram',
  'linkedPatients', 'dateOfBirth', 'gender', 'phone', 'contactNumber',
  'address', 'bloodType', 'allergies', 'diseaseHistory', 'chronicConditions',
  'medicalHistory', 'emergencyContact', 'digilockerVerified', 'digilockerProfile',
  'loginOtp', 'loginOtpExpires', 'resetOtp', 'resetOtpExpires', 'updatedAt'
]);

/**
 * Update a user
 * @param {string} id - User ID
 * @param {Object} userData - User data to update
 * @returns {Promise<Object|null>} Updated user (without password) or null
 */
const updateUser = async (id, userData) => {
  try {
    // Handle password update
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    const data = serializeUserData(userData);

    // Build dynamic UPDATE
    const setClauses = [];
    const values = [];

    const skipFields = ['id', 'createdAt'];
    for (const [key, value] of Object.entries(data)) {
      if (skipFields.includes(key) || value === undefined) continue;
      if (!ALLOWED_USER_COLUMNS.has(key)) continue;
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    if (setClauses.length === 0) return await findUserById(id);

    // Add updatedAt
    setClauses.push("updatedAt = datetime('now')");
    values.push(id); // WHERE clause

    const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
    const { results } = await queryD1(sql, values);

    return results.length > 0 ? sanitizeUser(parseUserRow(results[0])) : null;
  } catch (error) {
    console.error('D1 updateUser error:', error);
    return null;
  }
};

/**
 * Delete a user
 * @param {string} id - User ID
 * @returns {Promise<boolean>}
 */
const deleteUser = async (id) => {
  try {
    const { meta } = await queryD1('DELETE FROM users WHERE id = ?', [id]);
    return (meta?.changes || 0) > 0;
  } catch (error) {
    console.error('D1 deleteUser error:', error);
    return false;
  }
};

/**
 * Authenticate a user
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object, token: string}>}
 */
const authenticateUser = async (email, password) => {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error('Invalid credentials');
  }

  if (!user.password) {
    throw new Error('Invalid credentials');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '1d' }
  );

  return {
    user: sanitizeUser(user),
    token
  };
};

/**
 * Find or create a user via Google OAuth
 * @param {Object} googleUserInfo - User info from Google
 * @param {string} role - User role (for new users)
 * @returns {Promise<{user: Object, token: string, isNewUser: boolean}>}
 */
async function findOrCreateGoogleUser(googleUserInfo, role = null) {
  const { googleId, email, firstName, lastName, picture } = googleUserInfo;

  try {
    // Check by googleId first, then email
    let { results } = await queryD1(
      'SELECT * FROM users WHERE googleId = ? OR email = ? LIMIT 1',
      [googleId, email.toLowerCase()]
    );

    let user = results.length > 0 ? parseUserRow(results[0]) : null;
    let isNewUser = false;

    if (!user) {
      // If user is new and no role was selected yet, request role selection before creating user
      if (!role) {
        return {
          user: null,
          token: null,
          isNewUser: true,
          requiresRoleSelection: true,
          googleUserInfo: { googleId, email: email.toLowerCase(), firstName, lastName, picture }
        };
      }

      // Create new user with selected role (doctor or patient)
      user = await createUser({
        googleId,
        email: email.toLowerCase(),
        firstName,
        lastName,
        picture,
        role: role === 'doctor' ? 'doctor' : 'patient',
        authProvider: 'google'
      });
      isNewUser = true;
      console.log(`Created new Google user with role [${user.role}]:`, email);
    } else if (!user.googleId) {
      // Link existing email account to Google
      user = await updateUser(user.id, {
        googleId,
        picture: picture || user.picture,
        authProvider: 'google'
      });
      console.log('Linked existing account to Google:', email);
    }

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
    const token = jwt.sign(
      { id: user.id, role: user.role },
      jwtSecret,
      { expiresIn: '1d' }
    );

    return { user: sanitizeUser(user), token, isNewUser, requiresRoleSelection: false };
  } catch (error) {
    console.error('D1 findOrCreateGoogleUser error:', error);
    throw error;
  }
}

/**
 * Create demo users if they don't exist
 */
const createDemoUsers = async () => {
  try {
    // Check and create admin user
    const adminUser = await findUserByEmail('admin@medizo.life');
    if (!adminUser) {
      console.log('Seeding admin demo user (admin@medizo.life)...');
      await createUser({
        firstName: 'System',
        lastName: 'Admin',
        email: 'admin@medizo.life',
        password: 'password123',
        role: 'admin',
        status: 'active'
      });
    }

    // Check and create pharmacist demo user
    const pharmUser = await findUserByEmail('pharmacist@test.com');
    if (!pharmUser) {
      console.log('Seeding pharmacist demo user (pharmacist@test.com)...');
      await createUser({
        firstName: 'Robert',
        lastName: 'Pharm',
        email: 'pharmacist@test.com',
        password: 'password123',
        role: 'pharmacist',
        pharmacyName: 'Medizo Care Pharmacy',
        licenseNumber: 'PHARM-88219',
        pharmacyAddress: '456 Healthcare Blvd, Suite 100',
        phone: '+1 555-987-6543',
        status: 'active'
      });
    }

    // Check and create doctor demo user
    const docUser = await findUserByEmail('doctor@test.com');
    if (!docUser) {
      console.log('Seeding doctor demo user (doctor@test.com)...');
      await createUser({
        firstName: 'Dr. John',
        lastName: 'Smith',
        email: 'doctor@test.com',
        password: 'password123',
        role: 'doctor',
        specialization: 'General Physician',
        licenseNumber: 'DOC123456',
        status: 'active'
      });
    }

    // Check and create patient demo user
    const patUser = await findUserByEmail('patient@test.com');
    if (!patUser) {
      console.log('Seeding patient demo user (patient@test.com)...');
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
        allergies: { environmental: [], food: [], drugs: ['Penicillin'], other: [] },
        chronicConditions: [],
        status: 'active'
      });
    }
  } catch (error) {
    console.error('Error creating demo users:', error);
  }
};

/**
 * Authenticate user by Mobile Number and Password.
 * DOB verification happens post-login inside the app, not here.
 */
const authenticateUserByMobile = async (mobileNumber, dateOfBirth, password) => {
  const user = await findUserByMobile(mobileNumber);

  if (!user) {
    throw new Error('No user account found with this mobile number');
  }

  if (!user.password) {
    throw new Error('Invalid credentials');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  const token = jwt.sign(
    { id: user.id, role: user.role },
    jwtSecret,
    { expiresIn: '1d' }
  );

  return {
    user: sanitizeUser(user),
    token,
    // Flag if DOB verification is still needed post-login
    requiresDobVerification: !!(user.dateOfBirth && user.dateOfBirth.trim())
  };
};

module.exports = {
  getUsers,
  getUsersSync: getUsers,  // Alias for backward compatibility (now always async)
  findUserByEmail,
  findUserByMobile,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  authenticateUser,
  authenticateUserByMobile,
  createDemoUsers,
  isMongoConnected: isD1ConnectedCheck,  // Backward-compatible export name
  findOrCreateGoogleUser
};
