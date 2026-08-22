const express = require('express');
const router = express.Router();
const { findUserById, updateUser, getUsers } = require('../models/user');
const { patient, auth, doctor } = require('../middleware/auth');
const { findPrescriptionsByDoctorId, findPrescriptionsByPatientId } = require('../models/prescription');
const { getFamilyProfileById, getFamilyProfilesByAccountId } = require('../models/familyProfile');

/**
 * @route   GET /api/patients
 * @desc    Get all patients
 * @access  Private (Authenticated)
 */
router.get('/', auth, async (req, res) => {
  try {
    // Get all users (now async)
    const users = await getUsers();
    
    // Filter patients only
    const patients = users
      .filter(user => user.role === 'patient')
      .map(({ password, ...patient }) => patient);
    
    res.json(patients);
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/patients/:id
 * @desc    Get patient by ID
 * @access  Private (Authenticated)
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const patientId = req.params.id;
    const patient = await findUserById(patientId);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Remove password from response
    const { password, ...patientData } = patient;
    
    res.json(patientData);
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/patients/profile
 * @desc    Get current patient profile
 * @access  Private (Patient only)
 */
router.get('/profile', patient, async (req, res) => {
  try {
    const patientId = req.user.id;
    const patient = await findUserById(patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Remove password from response
    const { password, ...patientData } = patient;
    
    res.json(patientData);
  } catch (error) {
    console.error('Get patient profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/patients/profile
 * @desc    Update patient profile
 * @access  Private (Patient only)
 */
router.put('/profile', patient, async (req, res) => {
  try {
    const patientId = req.user.id;
    const { firstName, lastName, dateOfBirth, contactNumber, address } = req.body;
    
    // Update user
    const updatedPatient = await updateUser(patientId, {
      firstName,
      lastName,
      dateOfBirth,
      contactNumber,
      address
    });
    
    if (!updatedPatient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    res.json(updatedPatient);
  } catch (error) {
    console.error('Update patient profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/patients/doctor/managed
 * @desc    Get all patients managed by the logged-in doctor with their prescription history
 * @access  Private (Doctor only)
 */
router.get('/doctor/managed', auth, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const userRole = req.user.role;

    console.log('Getting managed patients for doctor:', doctorId);

    if (userRole !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }

    const doctorData = await findUserById(doctorId);
    const doctorPrescriptions = await findPrescriptionsByDoctorId(doctorId);
    console.log('Total prescriptions by doctor:', doctorPrescriptions.length);

    // 1. Collect all linked patient IDs from doctor's linkedPatients
    const linkedPatientIds = new Set(doctorData?.linkedPatients || []);

    // 2. Collect patient IDs / account IDs / emails from doctor's prescriptions
    const emailToPrescriptionsMap = new Map();
    for (const p of doctorPrescriptions) {
      let resolvedAccId = p.accountId || null;
      let directPid = p.patientId?.toString() || p.patientId;

      // If directPid is a family profile, look up parent accountId
      if (directPid && !resolvedAccId) {
        try {
          const fp = await getFamilyProfileById(directPid);
          if (fp && fp.accountId) {
            resolvedAccId = fp.accountId;
          }
        } catch (e) {}
      }

      const targetId = resolvedAccId || directPid;
      if (targetId) {
        linkedPatientIds.add(targetId);
      }

      if (p.patientEmail) {
        const cleanEmail = p.patientEmail.trim().toLowerCase();
        if (cleanEmail && cleanEmail !== 'n/a') {
          if (!emailToPrescriptionsMap.has(cleanEmail)) emailToPrescriptionsMap.set(cleanEmail, []);
          emailToPrescriptionsMap.get(cleanEmail).push(p);
        }
      }
    }

    // 3. Find users and check primaryDoctor/assignedDoctor or email matches
    const allUsers = await getUsers();
    const usersById = new Map(allUsers.map(u => [u.id, u]));

    for (const u of allUsers) {
      if (u.role === 'patient') {
        if (u.primaryDoctor === doctorId || u.assignedDoctor === doctorId || u.doctorId === doctorId) {
          linkedPatientIds.add(u.id);
        }
        if (u.email && emailToPrescriptionsMap.has(u.email.trim().toLowerCase())) {
          linkedPatientIds.add(u.id);
        }
      }
    }

    console.log('Total unique linked patient IDs for doctor:', linkedPatientIds.size);

    const managedPatients = [];
    for (const pid of linkedPatientIds) {
      const user = usersById.get(pid);
      if (!user || user.role !== 'patient') continue;

      // Get family profiles for this patient
      let familyProfiles = [];
      try {
        familyProfiles = await getFamilyProfilesByAccountId(user.id);
      } catch (e) {
        familyProfiles = [];
      }
      const profileIds = new Set(familyProfiles.map(f => f.id));

      // Get prescriptions for this patient by this doctor
      const patientPrescriptions = doctorPrescriptions
        .filter(p => {
          if (p.patientId === user.id) return true;
          if (p.accountId === user.id) return true;
          if (p.patientId && profileIds.has(p.patientId)) return true;
          if (p.patientEmail && user.email && p.patientEmail.trim().toLowerCase() === user.email.trim().toLowerCase()) return true;
          return false;
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      const activePrescriptions = patientPrescriptions.filter(p => p.status === 'active').length;
      const completedPrescriptions = patientPrescriptions.filter(p => p.status === 'completed').length;
      const prescriptionsData = patientPrescriptions.map(({ qrCode, ...prescriptionData }) => prescriptionData);
      const { password, ...patientData } = user;

      // Get all unique medications prescribed
      const allMedications = patientPrescriptions.flatMap(p => p.medications || []);

      // Get all unique diagnoses
      const diagnoses = [...new Set(patientPrescriptions.map(p => p.diagnosis).filter(Boolean))];

      const lastVisit = patientPrescriptions[0]?.createdAt || null;
      const lastActivity = lastVisit || user.updatedAt || user.createdAt || null;

      managedPatients.push({
        ...patientData,
        prescriptionHistory: prescriptionsData,
        totalPrescriptions: patientPrescriptions.length,
        activePrescriptions,
        completedPrescriptions,
        latestPrescription: patientPrescriptions[0] || null,
        allMedications,
        diagnoses,
        lastVisit,
        lastActivity,
        familyProfiles
      });
    }

    // Sort by most recent activity / last visit (newest first)
    managedPatients.sort((a, b) => {
      const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return dateB - dateA;
    });

    console.log('Managed patients with stats:', managedPatients.length);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(managedPatients);
  } catch (error) {
    console.error('Get managed patients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/patients/:id/medical-details
 * @desc    Get patient medical details including prescription history
 * @access  Private (Doctor only)
 */
router.get('/:id/medical-details', auth, async (req, res) => {
  try {
    const targetParamId = req.params.id;
    const doctorId = req.user.id;
    const userRole = req.user.role;

    console.log('Getting medical details for patient:', targetParamId, 'by doctor:', doctorId);

    if (userRole !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }

    // Find the patient (could be direct user ID or family profile ID)
    let patient = await findUserById(targetParamId);
    let targetProfile = null;

    if (!patient) {
      try {
        targetProfile = await getFamilyProfileById(targetParamId);
        if (targetProfile && targetProfile.accountId) {
          patient = await findUserById(targetProfile.accountId);
        }
      } catch (e) {}
    }

    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Get family profiles
    let familyProfiles = [];
    try {
      familyProfiles = await getFamilyProfilesByAccountId(patient.id);
    } catch (e) {
      familyProfiles = [];
    }
    const profileIds = new Set(familyProfiles.map(f => f.id));

    // Get all prescriptions for this patient by this doctor
    const doctorPrescriptions = await findPrescriptionsByDoctorId(doctorId);
    const patientPrescriptions = doctorPrescriptions
      .filter(p => {
        if (p.patientId === patient.id) return true;
        if (p.accountId === patient.id) return true;
        if (p.patientId && profileIds.has(p.patientId)) return true;
        if (p.patientEmail && patient.email && p.patientEmail.trim().toLowerCase() === patient.email.trim().toLowerCase()) return true;
        return false;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    console.log('Found', patientPrescriptions.length, 'prescriptions for patient');

    // Remove password from patient data
    const { password, ...patientData } = patient;
    
    // Calculate statistics
    const activePrescriptions = patientPrescriptions.filter(p => p.status === 'active');
    const completedPrescriptions = patientPrescriptions.filter(p => p.status === 'completed');
    
    // Get all medications with frequency count
    const medicationMap = new Map();
    patientPrescriptions.forEach(p => {
      (p.medications || []).forEach(med => {
        const medName = typeof med === 'string' ? med : (med.name || med.medication || '');
        if (medName) {
          const key = medName.toLowerCase();
          medicationMap.set(key, (medicationMap.get(key) || 0) + 1);
        }
      });
    });
    
    // Enhanced medical details
    const medicalDetails = {
      ...patientData,
      familyProfiles,
      targetProfile: targetProfile || null,
      prescriptionHistory: patientPrescriptions.map(({ qrCode, ...prescriptionData }) => ({
        ...prescriptionData,
        canView: true,
        canEdit: prescriptionData.status === 'active',
        canDownload: true
      })),
      totalPrescriptions: patientPrescriptions.length,
      activePrescriptions: activePrescriptions.length,
      completedPrescriptions: completedPrescriptions.length,
      activePrescriptionsList: activePrescriptions.map(({ qrCode, ...p }) => p),
      // Extract all medications from prescriptions
      allMedications: patientPrescriptions.flatMap(p => p.medications || []),
      // Medication frequency
      medicationFrequency: Array.from(medicationMap.entries()).map(([name, count]) => ({ name, count })),
      // Extract unique diagnoses
      diagnoses: [...new Set(patientPrescriptions.map(p => p.diagnosis).filter(Boolean))],
      // Patient medical information (if available)
      allergies: patient.allergies || [],
      medicalHistory: patient.medicalHistory || [],
      chronicConditions: patient.chronicConditions || [],
      emergencyContact: patient.emergencyContact || null,
      bloodType: patient.bloodType || null,
      insurance: patient.insurance || null,
      // Additional stats
      firstVisit: patientPrescriptions[patientPrescriptions.length - 1]?.createdAt || null,
      lastVisit: patientPrescriptions[0]?.createdAt || null,
      totalMedications: Array.from(medicationMap.keys()).length
    };
    
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(medicalDetails);
  } catch (error) {
    console.error('Get patient medical details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/patients/:id/medical-info
 * @desc    Update patient medical information (allergies, medical history, etc.)
 * @access  Private (Doctor only)
 */
router.put('/:id/medical-info', auth, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userRole = req.user.role;

    if (userRole !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }

    const { allergies, medicalHistory, emergencyContact, bloodType, insurance } = req.body;

    // Find the patient
    const patient = await findUserById(patientId);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Update patient medical information
    const updatedPatient = await updateUser(patientId, {
      allergies: allergies || patient.allergies || [],
      medicalHistory: medicalHistory || patient.medicalHistory || [],
      emergencyContact: emergencyContact || patient.emergencyContact || null,
      bloodType: bloodType || patient.bloodType || null,
      insurance: insurance || patient.insurance || null
    });

    if (!updatedPatient) {
      return res.status(404).json({ message: 'Failed to update patient' });
    }

    res.json(updatedPatient);
  } catch (error) {
    console.error('Update patient medical info error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
