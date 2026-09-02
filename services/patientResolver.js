const { findUserById, updateUser } = require('../models/user');
const {
  getFamilyProfileById,
  getProfileByDisplayId,
  getFamilyProfilesByAccountId,
  updateFamilyProfile
} = require('../models/familyProfile');
const { syncPrescriptionsPatientData } = require('../models/prescription');

/**
 * Calculate age in years from date of birth
 */
function calculateAge(dob) {
  if (!dob) return '';
  const dobTime = new Date(dob).getTime();
  if (isNaN(dobTime)) return '';
  const years = Math.floor((Date.now() - dobTime) / (365.25 * 86400000));
  return (years >= 0 && years < 150) ? String(years) : '';
}

/**
 * Resolve a patient from any identifier (user ID, family profile ID, or display ID).
 * Merges primary user account and self family profile to guarantee fresh, synchronized data.
 * @param {string} patientId - User ID, family profile ID, or display ID
 * @returns {Promise<Object|null>} Normalized patient object or null
 */
async function resolvePatient(patientId) {
  if (!patientId || typeof patientId !== 'string') return null;
  const cleanId = patientId.trim();
  if (!cleanId) return null;

  let user = null;
  let familyProfile = null;

  // 1. Try finding by user ID in users table
  user = await findUserById(cleanId);

  // 2. If not found in users table, try family_profiles by ID or display ID
  if (!user) {
    familyProfile = await getFamilyProfileById(cleanId);
    if (!familyProfile) {
      familyProfile = await getProfileByDisplayId(cleanId);
    }
  }

  // 3. If found as a family profile, also load parent user account if available
  if (familyProfile && familyProfile.accountId) {
    user = await findUserById(familyProfile.accountId);
  }

  // 4. If found as a user, also load self family profile (profileIndex === 0) if exists
  if (user && !familyProfile) {
    try {
      const profiles = await getFamilyProfilesByAccountId(user.id);
      if (Array.isArray(profiles) && profiles.length > 0) {
        familyProfile = profiles.find(p => p.profileIndex === 0) || profiles[0];
      }
    } catch (e) {
      // Ignore lookup error
    }
  }

  // 5. Neither found
  if (!user && !familyProfile) {
    return null;
  }

  // Determine precedence:
  // If familyProfile is a dependent profile (profileIndex !== 0), family profile details win for patient data.
  // If familyProfile is self (profileIndex === 0) or null, user profile details are primary.
  const isDependent = familyProfile && familyProfile.profileIndex !== 0;

  const firstName = isDependent
    ? (familyProfile.firstName || '')
    : (user?.firstName || familyProfile?.firstName || '');

  const lastName = isDependent
    ? (familyProfile.lastName || '')
    : (user?.lastName || familyProfile?.lastName || '');

  const rawGender = isDependent
    ? (familyProfile.gender || '')
    : (user?.gender || familyProfile?.gender || '');
  const gender = rawGender ? rawGender.trim().toLowerCase() : '';

  const dateOfBirth = isDependent
    ? (familyProfile.dateOfBirth || '')
    : (user?.dateOfBirth || familyProfile?.dateOfBirth || '');

  const age = calculateAge(dateOfBirth) || familyProfile?.age || user?.age || '';

  const phone = isDependent
    ? (familyProfile.phone || user?.phone || user?.contactNumber || '')
    : (user?.phone || user?.contactNumber || familyProfile?.phone || '');

  const address = user?.address || familyProfile?.address || '';
  const bloodType = isDependent
    ? (familyProfile.bloodType || user?.bloodType || '')
    : (user?.bloodType || familyProfile?.bloodType || '');

  const allergies = isDependent
    ? (familyProfile.allergies || [])
    : (user?.allergies || familyProfile?.allergies || []);

  const chronicConditions = isDependent
    ? (familyProfile.chronicConditions || [])
    : (user?.chronicConditions || familyProfile?.chronicConditions || []);

  const diseaseHistory = isDependent
    ? (familyProfile.diseaseHistory || [])
    : (user?.diseaseHistory || familyProfile?.diseaseHistory || []);

  const emergencyContact = isDependent
    ? (familyProfile.emergencyContact || user?.emergencyContact || null)
    : (user?.emergencyContact || familyProfile?.emergencyContact || null);

  const id = familyProfile ? familyProfile.id : user.id;
  const accountId = user ? user.id : (familyProfile?.accountId || id);
  const patientDisplayId = familyProfile?.patientDisplayId || user?.patientDisplayId || (accountId ? `PT-${accountId.substring(0, 6).toUpperCase()}` : 'PT-UNKNOWN');

  return {
    id,
    accountId,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email: user?.email || familyProfile?.email || '',
    gender,
    dateOfBirth,
    age,
    phone,
    contactNumber: phone,
    address,
    bloodType,
    allergies,
    chronicConditions,
    diseaseHistory,
    emergencyContact,
    role: 'patient',
    isFamilyProfile: Boolean(isDependent),
    relationship: familyProfile?.relationship || 'self',
    patientDisplayId
  };
}

/**
 * Synchronize patient updates across users table, family_profiles table (for self-profiles),
 * and all past/present prescriptions in the prescriptions table.
 * @param {string} targetId - Patient user ID or family profile ID
 * @param {Object} updateData - Updated fields
 * @returns {Promise<{ user: Object|null, familyProfile: Object|null, linkedIds: string[] }>}
 */
async function syncPatientProfileUpdates(targetId, updateData = {}) {
  if (!targetId) return { user: null, familyProfile: null, linkedIds: [] };

  let user = await findUserById(targetId);
  let familyProfile = null;

  if (!user) {
    familyProfile = await getFamilyProfileById(targetId);
    if (familyProfile && familyProfile.accountId) {
      user = await findUserById(familyProfile.accountId);
    }
  } else {
    try {
      const profiles = await getFamilyProfilesByAccountId(user.id);
      if (Array.isArray(profiles)) {
        familyProfile = profiles.find(p => p.profileIndex === 0) || null;
      }
    } catch (e) {
      // Ignore
    }
  }

  const linkedIds = new Set();
  if (user?.id) linkedIds.add(String(user.id));
  if (familyProfile?.id) linkedIds.add(String(familyProfile.id));
  linkedIds.add(String(targetId));

  const isSelfProfile = !familyProfile || familyProfile.profileIndex === 0;

  // 1. Update user if it's the primary account
  let updatedUser = null;
  if (user && isSelfProfile) {
    const userPayload = { ...updateData };
    delete userPayload.role;
    delete userPayload.id;
    delete userPayload.accountId;
    updatedUser = await updateUser(user.id, userPayload);
  }

  // 2. Update family profile if exists
  let updatedProfile = null;
  if (familyProfile) {
    const profilePayload = {};
    if (updateData.firstName !== undefined) profilePayload.firstName = updateData.firstName.trim();
    if (updateData.lastName !== undefined) profilePayload.lastName = updateData.lastName.trim();
    if (updateData.gender !== undefined) profilePayload.gender = String(updateData.gender).trim().toLowerCase();
    if (updateData.dateOfBirth !== undefined) profilePayload.dateOfBirth = updateData.dateOfBirth;
    if (updateData.phone !== undefined || updateData.contactNumber !== undefined) {
      profilePayload.phone = (updateData.phone || updateData.contactNumber).trim();
    }
    if (updateData.address !== undefined) profilePayload.address = updateData.address;
    if (updateData.bloodType !== undefined) profilePayload.bloodType = updateData.bloodType;
    if (updateData.allergies !== undefined) profilePayload.allergies = updateData.allergies;
    if (updateData.chronicConditions !== undefined) profilePayload.chronicConditions = updateData.chronicConditions;
    if (updateData.diseaseHistory !== undefined) profilePayload.diseaseHistory = updateData.diseaseHistory;
    if (updateData.emergencyContact !== undefined) profilePayload.emergencyContact = updateData.emergencyContact;

    if (Object.keys(profilePayload).length > 0) {
      updatedProfile = await updateFamilyProfile(familyProfile.id, profilePayload);
    }
  }

  // 3. Sync all prescriptions linked to this patient or account
  const allIds = Array.from(linkedIds);
  await syncPrescriptionsPatientData(allIds, updateData);

  return {
    user: updatedUser || user,
    familyProfile: updatedProfile || familyProfile,
    linkedIds: allIds
  };
}

module.exports = {
  calculateAge,
  resolvePatient,
  syncPatientProfileUpdates
};
