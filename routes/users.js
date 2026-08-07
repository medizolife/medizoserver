const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getUsers, findUserById, updateUser, createUser } = require('../models/user');
const { findPrescriptionsByDoctorId } = require('../models/prescription');
const { auth, doctor, patient } = require('../middleware/auth');

// Configure multer for profile picture uploads
const storage = multer.memoryStorage(); // Use memory storage for serverless compatibility

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

/**
 * @route   POST /api/users/profile/picture
 * @desc    Upload profile picture
 * @access  Private
 */
router.post('/profile/picture', auth, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Delete old profile picture if exists
    const user = await findUserById(req.user.id);
    if (user && user.profilePicture) {
      const oldPicturePath = path.join(__dirname, '..', user.profilePicture);
      if (fs.existsSync(oldPicturePath)) {
        fs.unlinkSync(oldPicturePath);
      }
    }

    // Update user with new profile picture path
    const profilePicturePath = '/uploads/' + req.file.filename;
    const updatedUser = await updateUser(req.user.id, { profilePicture: profilePicturePath });

    res.json({
      message: 'Profile picture uploaded successfully',
      profilePicture: profilePicturePath,
      user: updatedUser
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/users/profile/picture
 * @desc    Delete profile picture
 * @access  Private
 */
router.delete('/profile/picture', auth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (user && user.profilePicture) {
      const picturePath = path.join(__dirname, '..', user.profilePicture);
      if (fs.existsSync(picturePath)) {
        fs.unlinkSync(picturePath);
      }
    }

    const updatedUser = await updateUser(req.user.id, { profilePicture: null });

    res.json({
      message: 'Profile picture deleted successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/users/patients/create
 * @desc    Create a new patient account (doctors only)
 * @access  Private (Doctor)
 */
router.post('/patients/create', doctor, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, gender, address, noEmail } = req.body;

    // Validate required fields based on noEmail flag
    if (!firstName || !lastName) {
      return res.status(400).json({ message: 'First name and last name are required' });
    }

    if (noEmail) {
      // No-email mode: require mobile number and DOB
      if (!phone || !phone.trim()) {
        return res.status(400).json({ message: 'Mobile number is required when patient has no email' });
      }
      if (!dateOfBirth || !dateOfBirth.trim()) {
        return res.status(400).json({ message: 'Date of Birth is required when patient has no email' });
      }
    } else {
      // Email mode: require email
      if (!email || !email.trim()) {
        return res.status(400).json({ message: 'Email address is required' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
    }

    // Generate temp password: [FirstName]@[DOBYear] or [FirstName]@medizo
    let tempPassword = 'password123';
    if (dateOfBirth && dateOfBirth.trim()) {
      const dobYear = String(dateOfBirth).split('-')[0] || String(dateOfBirth).split('/')[2] || '';
      tempPassword = dobYear ? `${firstName}@${dobYear}` : `${firstName}@medizo`;
    } else {
      tempPassword = `${firstName}@medizo`;
    }

    // Resolve the email to use (placeholder if noEmail)
    const cleanPhone = (phone || '').replace(/[\s\-\(\)\+]/g, '');
    const userEmail = noEmail
      ? `patient_${cleanPhone || Date.now()}@patient.medizo.life`
      : email.toLowerCase();

    // Create new patient
    const newPatient = await createUser({
      firstName,
      lastName,
      email: userEmail,
      password: tempPassword,
      role: 'patient',
      phone: phone || '',
      dateOfBirth: dateOfBirth || '',
      gender: gender || '',
      address: address || '',
      allergies: [],
      chronicConditions: [],
      createdByDoctor: req.user.id
    });

    console.log('New patient created by doctor:', newPatient.id, noEmail ? '(no-email mode)' : '(email mode)');

    // Auto-link the new patient to this doctor so they appear in getMyPatients
    try {
      const doctorData = await findUserById(req.user.id);
      const linkedPatients = doctorData?.linkedPatients || [];
      if (!linkedPatients.includes(newPatient.id)) {
        linkedPatients.push(newPatient.id);
        await updateUser(req.user.id, { linkedPatients });
        console.log('Auto-linked new patient to doctor:', newPatient.id, '->', req.user.id);
      }
    } catch (linkError) {
      console.error('Failed to auto-link patient to doctor:', linkError);
      // Don't fail the whole request, patient was still created
    }

    res.status(201).json({
      message: `Patient account created successfully. Temporary password: ${tempPassword}`,
      patient: newPatient,
      tempPassword
    });
  } catch (error) {
    console.error('Create patient error:', error);
    if (error.message === 'User with this email already exists') {
      return res.status(400).json({ message: 'A patient with this email already exists' });
    }
    if (error.message === 'User with this mobile number already exists') {
      return res.status(400).json({ message: 'A patient with this mobile number already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/patients
 * @desc    Get all patients (doctors only)
 * @access  Private (Doctor)
 */
router.get('/patients', doctor, async (req, res) => {
  console.log('GET /patients endpoint hit');
  console.log('User:', req.user);
  try {
    const users = await getUsers();
    console.log('Total users:', users.length);
    const patients = users
      .filter(user => user.role === 'patient')
      .map(patient => {
        // Remove sensitive data
        const { password, ...patientData } = patient;
        return patientData;
      });

    console.log('Filtered patients:', patients.length);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
      message: 'Patients retrieved successfully',
      patients
    });
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/patients/my-patients
 * @desc    Get only patients that this doctor has prescribed to OR linked (security improvement)
 * @access  Private (Doctor)
 */
router.get('/patients/my-patients', doctor, async (req, res) => {
  console.log('GET /patients/my-patients endpoint hit');
  console.log('User:', req.user);
  try {
    const doctorId = req.user.id;
    
    // Get all prescriptions for this doctor
    const prescriptions = await findPrescriptionsByDoctorId(doctorId);
    
    // Get unique patient IDs from prescriptions with their latest prescription date
    const patientLastActivity = new Map();
    for (const p of prescriptions) {
      const pid = p.patientId?.toString() || p.patientId;
      const pDate = new Date(p.updatedAt || p.createdAt || 0);
      if (!patientLastActivity.has(pid) || pDate > patientLastActivity.get(pid)) {
        patientLastActivity.set(pid, pDate);
      }
    }
    
    // Get doctor's linked patients
    const doctorData = await findUserById(doctorId);
    const linkedPatientIds = doctorData?.linkedPatients || [];
    
    // Combine and deduplicate patient IDs
    const allPatientIds = [...new Set([...patientLastActivity.keys(), ...linkedPatientIds])];
    
    // Get patient details for each unique patient ID
    const patients = [];
    for (const patientId of allPatientIds) {
      const patient = await findUserById(patientId);
      if (patient && patient.role === 'patient') {
        const { password, ...patientData } = patient;
        // Use latest prescription date, or updatedAt, or createdAt as lastActivity
        const lastPrescriptionDate = patientLastActivity.get(patientId);
        const lastActivity = lastPrescriptionDate || new Date(patient.updatedAt || patient.createdAt || 0);
        patients.push({ ...patientData, lastActivity: lastActivity.toISOString() });
      }
    }

    // Sort by latest activity first
    patients.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    console.log('Doctor\'s patients (sorted by activity):', patients.length);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      message: 'My patients retrieved successfully',
      patients
    });
  } catch (error) {
    console.error('Get my patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/patients/lookup/:patientId
 * @desc    Look up a patient by their ID (for adding existing patients)
 * @access  Private (Doctor)
 */
router.get('/patients/lookup/:patientId', doctor, async (req, res) => {
  console.log('GET /patients/lookup/:patientId endpoint hit');
  try {
    const { patientId } = req.params;
    
    const patient = await findUserById(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found. Please check the Patient ID.' });
    }
    
    if (patient.role !== 'patient') {
      return res.status(400).json({ message: 'The provided ID does not belong to a patient.' });
    }
    
    // Return patient data without password
    const { password, ...patientData } = patient;
    
    res.json({
      message: 'Patient found',
      patient: patientData
    });
  } catch (error) {
    console.error('Lookup patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/users/patients/link/:patientId
 * @desc    Link an existing patient to this doctor
 * @access  Private (Doctor)
 */
router.post('/patients/link/:patientId', doctor, async (req, res) => {
  console.log('POST /patients/link/:patientId endpoint hit');
  try {
    const { patientId } = req.params;
    const doctorId = req.user.id;
    
    // Verify patient exists
    const patient = await findUserById(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    if (patient.role !== 'patient') {
      return res.status(400).json({ message: 'The provided ID does not belong to a patient.' });
    }
    
    // Get current doctor and add patient to linkedPatients
    const doctor = await findUserById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    // Initialize linkedPatients if not exists
    const linkedPatients = doctor.linkedPatients || [];
    
    // Check if already linked
    if (linkedPatients.includes(patientId)) {
      return res.json({ message: 'Patient already linked', patient: patient });
    }
    
    // Add patient to linked list
    linkedPatients.push(patientId);
    await updateUser(doctorId, { linkedPatients });
    
    console.log('Patient linked to doctor:', patientId, '->', doctorId);
    
    // Return patient data
    const { password, ...patientData } = patient;
    res.json({
      message: 'Patient linked successfully',
      patient: patientData
    });
  } catch (error) {
    console.error('Link patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/patients/lookup
 * @desc    Get patients lookup data for prescription creation
 * @access  Private (Doctor)
 */
router.get('/patients/lookup', doctor, async (req, res) => {
  try {
    const users = await getUsers();
    const patientsLookup = users
      .filter(user => user.role === 'patient')
      .map(patient => ({
        id: patient.id,
        email: patient.email,
        name: `${patient.firstName} ${patient.lastName}`,
        firstName: patient.firstName,
        lastName: patient.lastName,
        contactNumber: patient.contactNumber,
        dateOfBirth: patient.dateOfBirth
      }));

    console.log('Patients lookup data:', patientsLookup);
    res.json({
      message: 'Patients lookup data retrieved successfully',
      patients: patientsLookup
    });
  } catch (error) {
    console.error('Get patients lookup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/doctors
 * @desc    Get all doctors
 * @access  Private
 */
router.get('/doctors', auth, async (req, res) => {
  try {
    const users = await getUsers();
    const doctors = users
      .filter(user => user.role === 'doctor')
      .map(doctor => {
        // Remove sensitive data
        const { password, ...doctorData } = doctor;
        return doctorData;
      });

    res.json({
      message: 'Doctors retrieved successfully',
      doctors
    });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove password from response
    const { password, ...userProfile } = user;
    
    res.json({
      message: 'Profile retrieved successfully',
      user: userProfile
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', auth, async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      contactNumber, 
      specialization, 
      licenseNumber,
      clinicAddress,
      clinicLatitude,
      clinicLongitude,
      clinicLocationAccuracy,
      clinicPlaceName,
      experience,
      qualifications,
      // New doctor profile fields
      profileImage,
      clinicLogo,
      clinicName,
      alternateEmail,
      secondaryPhone,
      fax,
      whatsapp,
      website,
      linkedin,
      twitter,
      facebook,
      instagram,
      // Patient fields
      dateOfBirth, 
      address, 
      phone, 
      bloodType, 
      allergies, 
      chronicConditions, 
      emergencyContact, 
      gender,
      diseaseHistory
    } = req.body;
    
    const updateData = {
      firstName,
      lastName,
      contactNumber,
      ...(req.user.role === 'doctor' && { 
        specialization, 
        licenseNumber,
        clinicAddress,
        clinicLatitude,
        clinicLongitude,
        clinicLocationAccuracy,
        clinicPlaceName,
        experience,
        qualifications,
        profileImage,
        clinicLogo,
        clinicName,
        alternateEmail,
        secondaryPhone,
        fax,
        whatsapp,
        website,
        linkedin,
        twitter,
        facebook,
        instagram
      }),
      ...(req.user.role === 'patient' && { dateOfBirth, address, phone, bloodType, allergies, chronicConditions, emergencyContact, gender, diseaseHistory })
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const updatedUser = await updateUser(req.user.id, updateData);
    
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/users/password
 * @desc    Change user password
 * @access  Private
 */
router.put('/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    // Verify current password
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const bcrypt = require('bcryptjs');
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    const updatedUser = await updateUser(req.user.id, { password: newPassword });
    
    res.json({
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/users/patients/:id
 * @desc    Get specific patient by ID (doctors only)
 * @access  Private (Doctor)
 */
router.get('/patients/:id', doctor, async (req, res) => {
  try {
    const patient = await findUserById(req.params.id);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const { password, ...patientData } = patient;
    res.json(patientData);
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/users/patients/:id
 * @desc    Update patient (doctors only)
 * @access  Private (Doctor)
 */
router.put('/patients/:id', doctor, async (req, res) => {
  try {
    const patient = await findUserById(req.params.id);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const updateData = req.body;
    // Don't allow role changes through this endpoint
    delete updateData.role;
    delete updateData.id;

    const updatedPatient = await updateUser(req.params.id, updateData);
    const { password, ...patientData } = updatedPatient;
    
    res.json({
      message: 'Patient updated successfully',
      patient: patientData
    });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/users/patients/:id
 * @desc    Delete patient (doctors only)
 * @access  Private (Doctor)
 */
router.delete('/patients/:id', doctor, async (req, res) => {
  try {
    const { deleteUser } = require('../models/user');
    const patient = await findUserById(req.params.id);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    deleteUser(req.params.id);
    
    res.json({
      message: 'Patient deleted successfully'
    });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/users/account
 * @desc    Delete current user account and associated data
 * @access  Private
 */
router.delete(['/account', '/me', '/profile'], auth, async (req, res) => {
  try {
    const { deleteUser } = require('../models/user');
    const userId = req.user.id;
    const user = await findUserById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Clean up images uploaded by user if Image model is available
    try {
      const Image = require('../models/ImageModel');
      if (Image && Image.findByUser) {
        const userImages = await Image.findByUser(userId);
        for (const img of userImages) {
          if (img.filename) {
            await Image.deleteByFilename(img.filename);
          }
        }
      }
    } catch (imgErr) {
      console.error('Notice: User image cleanup on delete:', imgErr.message);
    }

    await deleteUser(userId);
    
    res.json({
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/users/change-role
 * @desc    Change user account role (Doctor, Patient, Pharmacist)
 * @access  Private
 */
router.put('/change-role', auth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['doctor', 'patient', 'pharmacist'].includes(role)) {
      return res.status(400).json({ message: 'Valid role is required (doctor, patient, or pharmacist)' });
    }

    const updatedUser = await updateUser(req.user.id, { role });
    
    // Generate new JWT token with updated role
    const jwt = require('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role },
      jwtSecret,
      { expiresIn: '1d' }
    );

    res.json({
      message: `Account role updated to ${role} successfully`,
      user: updatedUser,
      token
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({ message: 'Server error changing role' });
  }
});

module.exports = router;
