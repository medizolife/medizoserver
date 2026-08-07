const { queryD1 } = require('../config/d1-client');

// JSON fields that need parsing on read and stringifying on write
const PROFILE_JSON_FIELDS = [
  'allergies', 'diseaseHistory', 'chronicConditions', 'emergencyContact'
];

const MAX_PROFILES_PER_ACCOUNT = 10;

/**
 * Parse JSON fields from a raw D1 row into JS objects
 */
function parseProfileRow(row) {
  if (!row) return null;
  const profile = { ...row };
  profile.isActive = Boolean(profile.isActive);
  for (const field of PROFILE_JSON_FIELDS) {
    if (typeof profile[field] === 'string') {
      try {
        profile[field] = JSON.parse(profile[field]);
      } catch (e) {
        // Keep as-is if not valid JSON
      }
    }
  }
  return profile;
}

/**
 * Serialize profile data for D1 INSERT/UPDATE — stringify JSON fields
 */
function serializeProfileData(data) {
  const out = { ...data };
  for (const field of PROFILE_JSON_FIELDS) {
    if (out[field] !== undefined && typeof out[field] !== 'string') {
      out[field] = JSON.stringify(out[field]);
    }
  }
  if (out.isActive !== undefined) {
    out.isActive = out.isActive ? 1 : 0;
  }
  return out;
}

/**
 * Generate the patient display ID from accountId and profileIndex.
 * Format: PT-{last6 of accountId uppercase}[NN]
 * e.g. PT-A1B2C3[00], PT-A1B2C3[01]
 */
function generatePatientDisplayId(accountId, profileIndex) {
  const suffix = String(accountId).slice(-6).toUpperCase();
  const idx = String(profileIndex).padStart(2, '0');
  return `PT-${suffix}[${idx}]`;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get the next available profile index for an account
 * @param {string} accountId
 * @returns {Promise<number>}
 */
const getNextProfileIndex = async (accountId) => {
  try {
    const { results } = await queryD1(
      'SELECT MAX(profileIndex) as maxIdx FROM family_profiles WHERE accountId = ?',
      [accountId]
    );
    const maxIdx = results[0]?.maxIdx;
    return (maxIdx !== null && maxIdx !== undefined) ? maxIdx + 1 : 0;
  } catch (error) {
    console.error('getNextProfileIndex error:', error);
    return 0;
  }
};

/**
 * Create a new family profile
 * @param {Object} data - Profile data including accountId
 * @returns {Promise<Object>} Created profile
 */
const createFamilyProfile = async (data) => {
  try {
    // Check profile limit
    const { results: existing } = await queryD1(
      'SELECT COUNT(*) as cnt FROM family_profiles WHERE accountId = ? AND isActive = 1',
      [data.accountId]
    );
    if (existing[0]?.cnt >= MAX_PROFILES_PER_ACCOUNT) {
      throw new Error(`Maximum of ${MAX_PROFILES_PER_ACCOUNT} profiles per account reached`);
    }

    // Determine profile index
    let profileIndex = data.profileIndex;
    if (profileIndex === undefined || profileIndex === null) {
      profileIndex = await getNextProfileIndex(data.accountId);
    }

    // Generate display ID
    const patientDisplayId = generatePatientDisplayId(data.accountId, profileIndex);

    // Check for duplicate index
    const { results: dupCheck } = await queryD1(
      'SELECT id FROM family_profiles WHERE accountId = ? AND profileIndex = ?',
      [data.accountId, profileIndex]
    );
    if (dupCheck.length > 0) {
      throw new Error(`Profile index ${profileIndex} already exists for this account`);
    }

    const serialized = serializeProfileData({
      ...data,
      profileIndex,
      patientDisplayId,
      isActive: 1
    });

    const allowedFields = [
      'accountId', 'profileIndex', 'relationship',
      'firstName', 'lastName', 'dateOfBirth', 'gender', 'phone', 'address', 'bloodType',
      'allergies', 'diseaseHistory', 'chronicConditions', 'medicalHistory', 'emergencyContact',
      'patientDisplayId', 'isActive'
    ];

    const fields = [];
    const placeholders = [];
    const values = [];

    for (const field of allowedFields) {
      if (serialized[field] !== undefined) {
        fields.push(field);
        placeholders.push('?');
        values.push(serialized[field]);
      }
    }

    const sql = `INSERT INTO family_profiles (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const { results } = await queryD1(sql, values);

    if (results.length === 0) {
      throw new Error('Failed to create family profile');
    }

    return parseProfileRow(results[0]);
  } catch (error) {
    console.error('createFamilyProfile error:', error);
    throw error;
  }
};

/**
 * Get all active family profiles for an account
 * @param {string} accountId
 * @returns {Promise<Array>}
 */
const getFamilyProfilesByAccountId = async (accountId) => {
  try {
    const { results } = await queryD1(
      'SELECT * FROM family_profiles WHERE accountId = ? AND isActive = 1 ORDER BY profileIndex ASC',
      [accountId]
    );
    return results.map(parseProfileRow);
  } catch (error) {
    console.error('getFamilyProfilesByAccountId error:', error);
    return [];
  }
};

/**
 * Get a single profile by its ID
 * @param {string} profileId
 * @returns {Promise<Object|null>}
 */
const getFamilyProfileById = async (profileId) => {
  if (!profileId) return null;
  try {
    const { results } = await queryD1(
      'SELECT * FROM family_profiles WHERE id = ? LIMIT 1',
      [profileId]
    );
    return results.length > 0 ? parseProfileRow(results[0]) : null;
  } catch (error) {
    console.error('getFamilyProfileById error:', error);
    return null;
  }
};

/**
 * Get a profile by its patient display ID (e.g. PT-A1B2C3[01])
 * @param {string} displayId
 * @returns {Promise<Object|null>}
 */
const getProfileByDisplayId = async (displayId) => {
  if (!displayId) return null;
  try {
    const { results } = await queryD1(
      'SELECT * FROM family_profiles WHERE patientDisplayId = ? AND isActive = 1 LIMIT 1',
      [displayId]
    );
    return results.length > 0 ? parseProfileRow(results[0]) : null;
  } catch (error) {
    console.error('getProfileByDisplayId error:', error);
    return null;
  }
};

/**
 * Update a family profile
 * @param {string} profileId
 * @param {Object} data
 * @returns {Promise<Object|null>}
 */
const updateFamilyProfile = async (profileId, data) => {
  try {
    const serialized = serializeProfileData(data);

    const allowedFields = [
      'relationship', 'firstName', 'lastName', 'dateOfBirth', 'gender',
      'phone', 'address', 'bloodType',
      'allergies', 'diseaseHistory', 'chronicConditions', 'medicalHistory', 'emergencyContact',
      'isActive'
    ];

    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(serialized)) {
      if (!allowedFields.includes(key) || value === undefined) continue;
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    if (setClauses.length === 0) return await getFamilyProfileById(profileId);

    setClauses.push("updatedAt = datetime('now')");
    values.push(profileId); // WHERE clause

    const sql = `UPDATE family_profiles SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
    const { results } = await queryD1(sql, values);

    if (results && results.length > 0) {
      return parseProfileRow(results[0]);
    }

    return await getFamilyProfileById(profileId);
  } catch (error) {
    console.error('updateFamilyProfile error:', error);
    return null;
  }
};

/**
 * Soft-delete a family profile (set isActive = 0)
 * Cannot delete the self-profile (profileIndex = 0)
 * @param {string} profileId
 * @returns {Promise<boolean>}
 */
const deleteFamilyProfile = async (profileId) => {
  try {
    // Prevent deleting self-profile
    const profile = await getFamilyProfileById(profileId);
    if (!profile) return false;
    if (profile.profileIndex === 0) {
      throw new Error('Cannot delete the self-profile (account holder)');
    }

    const { meta } = await queryD1(
      "UPDATE family_profiles SET isActive = 0, updatedAt = datetime('now') WHERE id = ?",
      [profileId]
    );
    return true;
  } catch (error) {
    console.error('deleteFamilyProfile error:', error);
    throw error;
  }
};

/**
 * Ensure the 'self' profile (index 0) exists for a patient account.
 * If not, creates it by copying from the user record.
 * @param {string} accountId - The patient's user ID
 * @param {Object} userData - The patient's user record (to copy name, DOB, etc.)
 * @returns {Promise<Object>} The self-profile
 */
const ensureSelfProfile = async (accountId, userData) => {
  try {
    // Check if self-profile exists
    const { results } = await queryD1(
      'SELECT * FROM family_profiles WHERE accountId = ? AND profileIndex = 0 LIMIT 1',
      [accountId]
    );

    if (results.length > 0) {
      return parseProfileRow(results[0]);
    }

    // Create self-profile from user data
    const selfProfile = await createFamilyProfile({
      accountId,
      profileIndex: 0,
      relationship: 'self',
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      dateOfBirth: userData.dateOfBirth || '',
      gender: userData.gender || '',
      phone: userData.phone || userData.contactNumber || '',
      address: userData.address || '',
      bloodType: userData.bloodType || '',
      allergies: userData.allergies || { environmental: [], food: [], drugs: [], other: [] },
      diseaseHistory: userData.diseaseHistory || [],
      chronicConditions: userData.chronicConditions || [],
      medicalHistory: userData.medicalHistory || '',
      emergencyContact: userData.emergencyContact || { name: '', relationship: '', phone: '' }
    });

    console.log('Created self-profile for account:', accountId, '→', selfProfile.patientDisplayId);
    return selfProfile;
  } catch (error) {
    // If duplicate key error, profile was already created (race condition)
    if (error.message?.includes('UNIQUE constraint') || error.message?.includes('already exists')) {
      const { results } = await queryD1(
        'SELECT * FROM family_profiles WHERE accountId = ? AND profileIndex = 0 LIMIT 1',
        [accountId]
      );
      return results.length > 0 ? parseProfileRow(results[0]) : null;
    }
    console.error('ensureSelfProfile error:', error);
    throw error;
  }
};

module.exports = {
  createFamilyProfile,
  getFamilyProfilesByAccountId,
  getFamilyProfileById,
  getProfileByDisplayId,
  updateFamilyProfile,
  deleteFamilyProfile,
  ensureSelfProfile,
  getNextProfileIndex,
  generatePatientDisplayId,
  MAX_PROFILES_PER_ACCOUNT
};
