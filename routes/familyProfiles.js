const express = require('express');
const router = express.Router();
const { auth, patient, doctor } = require('../middleware/auth');
const { findUserById } = require('../models/user');
const {
  createFamilyProfile,
  getFamilyProfilesByAccountId,
  getFamilyProfileById,
  updateFamilyProfile,
  deleteFamilyProfile,
  ensureSelfProfile,
  MAX_PROFILES_PER_ACCOUNT
} = require('../models/familyProfile');

/**
 * @route   GET /api/family-profiles
 * @desc    Get all family profiles for the logged-in patient
 * @access  Private (Patient only)
 */
router.get('/', patient, async (req, res) => {
  try {
    const accountId = req.user.id;

    // Ensure self-profile exists
    const userData = await findUserById(accountId);
    if (!userData) {
      return res.status(404).json({ message: 'User account not found' });
    }
    await ensureSelfProfile(accountId, userData);

    const profiles = await getFamilyProfilesByAccountId(accountId);
    res.json({ profiles, maxProfiles: MAX_PROFILES_PER_ACCOUNT });
  } catch (error) {
    console.error('Get family profiles error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/family-profiles/ensure-self
 * @desc    Create self-profile if it doesn't exist
 * @access  Private (Patient only)
 */
router.post('/ensure-self', patient, async (req, res) => {
  try {
    const accountId = req.user.id;
    const userData = await findUserById(accountId);
    if (!userData) {
      return res.status(404).json({ message: 'User account not found' });
    }

    const selfProfile = await ensureSelfProfile(accountId, userData);
    res.json({ profile: selfProfile });
  } catch (error) {
    console.error('Ensure self-profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/family-profiles/:profileId
 * @desc    Get a specific family profile
 * @access  Private (Patient owner or Doctor)
 */
router.get('/:profileId', auth, async (req, res) => {
  try {
    const profile = await getFamilyProfileById(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Patients can only view their own profiles; doctors can view any
    if (req.user.role === 'patient' && profile.accountId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(profile);
  } catch (error) {
    console.error('Get family profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/family-profiles
 * @desc    Add a new family member profile
 * @access  Private (Patient only)
 */
router.post('/', patient, async (req, res) => {
  try {
    const accountId = req.user.id;
    const {
      relationship, firstName, lastName,
      dateOfBirth, gender, phone, address, bloodType,
      allergies, diseaseHistory, chronicConditions, medicalHistory, emergencyContact
    } = req.body;

    // Validate required fields
    if (!firstName || !firstName.trim()) {
      return res.status(400).json({ message: 'First name is required' });
    }
    if (!lastName || !lastName.trim()) {
      return res.status(400).json({ message: 'Last name is required' });
    }
    if (!relationship || !relationship.trim()) {
      return res.status(400).json({ message: 'Relationship is required' });
    }

    const validRelationships = ['spouse', 'parent', 'child', 'sibling', 'other'];
    if (!validRelationships.includes(relationship)) {
      return res.status(400).json({ message: `Invalid relationship. Must be one of: ${validRelationships.join(', ')}` });
    }

    // Ensure self-profile exists first
    const userData = await findUserById(accountId);
    if (!userData) {
      return res.status(404).json({ message: 'User account not found' });
    }
    await ensureSelfProfile(accountId, userData);

    const newProfile = await createFamilyProfile({
      accountId,
      relationship,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dateOfBirth || '',
      gender: gender || '',
      phone: phone || '',
      address: address || '',
      bloodType: bloodType || '',
      allergies: allergies || { environmental: [], food: [], drugs: [], other: [] },
      diseaseHistory: diseaseHistory || [],
      chronicConditions: chronicConditions || [],
      medicalHistory: medicalHistory || '',
      emergencyContact: emergencyContact || { name: '', relationship: '', phone: '' }
    });

    console.log('Family profile created:', newProfile.id, '→', newProfile.patientDisplayId);
    res.status(201).json({ profile: newProfile });
  } catch (error) {
    console.error('Create family profile error:', error);
    if (error.message?.includes('Maximum')) {
      return res.status(400).json({ message: error.message });
    }
    if (error.message?.includes('already exists')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/family-profiles/:profileId
 * @desc    Update a family profile
 * @access  Private (Patient owner only)
 */
router.put('/:profileId', patient, async (req, res) => {
  try {
    const profile = await getFamilyProfileById(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Only owner can update
    if (profile.accountId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      relationship, firstName, lastName,
      dateOfBirth, gender, phone, address, bloodType,
      allergies, diseaseHistory, chronicConditions, medicalHistory, emergencyContact
    } = req.body;

    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
    if (gender !== undefined) updateData.gender = gender;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (bloodType !== undefined) updateData.bloodType = bloodType;
    if (allergies !== undefined) updateData.allergies = allergies;
    if (diseaseHistory !== undefined) updateData.diseaseHistory = diseaseHistory;
    if (chronicConditions !== undefined) updateData.chronicConditions = chronicConditions;
    if (medicalHistory !== undefined) updateData.medicalHistory = medicalHistory;
    if (emergencyContact !== undefined) updateData.emergencyContact = emergencyContact;

    // Only allow relationship change for non-self profiles
    if (relationship !== undefined && profile.profileIndex !== 0) {
      updateData.relationship = relationship;
    }

    const updated = await updateFamilyProfile(req.params.profileId, updateData);
    res.json({ profile: updated });
  } catch (error) {
    console.error('Update family profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/family-profiles/:profileId
 * @desc    Soft-delete a family profile (cannot delete self)
 * @access  Private (Patient owner only)
 */
router.delete('/:profileId', patient, async (req, res) => {
  try {
    const profile = await getFamilyProfileById(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Only owner can delete
    if (profile.accountId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await deleteFamilyProfile(req.params.profileId);
    console.log('Family profile soft-deleted:', req.params.profileId);
    res.json({ message: 'Family member profile removed successfully' });
  } catch (error) {
    console.error('Delete family profile error:', error);
    if (error.message?.includes('Cannot delete')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/family-profiles/account/:accountId
 * @desc    Get all family profiles for a patient account (doctor access)
 * @access  Private (Doctor only)
 */
router.get('/account/:accountId', doctor, async (req, res) => {
  try {
    const accountId = req.params.accountId;

    // Verify the account is a patient
    const userData = await findUserById(accountId);
    if (!userData || userData.role !== 'patient') {
      return res.status(404).json({ message: 'Patient account not found' });
    }

    // Ensure self-profile exists
    await ensureSelfProfile(accountId, userData);

    const profiles = await getFamilyProfilesByAccountId(accountId);
    res.json({ profiles });
  } catch (error) {
    console.error('Get account family profiles error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
