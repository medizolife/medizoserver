const express = require('express');
const router = express.Router();
const { findUserById, updateUser, getUsers } = require('../models/user');
const { patient, auth, doctor } = require('../middleware/auth');
const { findPrescriptionsByDoctorId, findPrescriptionsByPatientId } = require('../models/prescription');

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

    // Get all prescriptions by this doctor
    const doctorPrescriptions = await findPrescriptionsByDoctorId(doctorId);
    console.log('Total prescriptions by doctor:', doctorPrescriptions.length);
    
    // Get unique patient IDs from prescriptions
    const patientIds = [...new Set(doctorPrescriptions.map(p => p.patientId))];
    console.log('Unique patients:', patientIds.length);
    
    // Get all users
    const users = await getUsers();
    
    // Filter patients managed by this doctor
    const managedPatients = users
      .filter(user => user.role === 'patient' && patientIds.includes(user.id))
      .map(patient => {
        // Get prescriptions for this patient by this doctor
        const patientPrescriptions = doctorPrescriptions
          .filter(p => p.patientId === patient.id)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Calculate prescription statistics
        const activePrescriptions = patientPrescriptions.filter(p => p.status === 'active').length;
        const completedPrescriptions = patientPrescriptions.filter(p => p.status === 'completed').length;
        
        // Get prescriptions without QR codes for response
        const prescriptionsData = patientPrescriptions.map(({ qrCode, ...prescriptionData }) => prescriptionData);
        
        // Remove password from patient data
        const { password, ...patientData } = patient;
        
        // Get all unique medications prescribed
        const allMedications = patientPrescriptions.flatMap(p => p.medications || []);
        
        // Get all unique diagnoses
        const diagnoses = [...new Set(patientPrescriptions.map(p => p.diagnosis).filter(Boolean))];
        
        return {
          ...patientData,
          prescriptionHistory: prescriptionsData,
          totalPrescriptions: patientPrescriptions.length,
          activePrescriptions,
          completedPrescriptions,
          latestPrescription: patientPrescriptions[0] || null,
          allMedications,
          diagnoses,
          lastVisit: patientPrescriptions[0]?.createdAt || null
        };
      })
      .sort((a, b) => {
        // Sort by most recent prescription
        const dateA = a.lastVisit ? new Date(a.lastVisit) : new Date(0);
        const dateB = b.lastVisit ? new Date(b.lastVisit) : new Date(0);
        return dateB - dateA;
      });
    
    console.log('Managed patients with stats:', managedPatients.length);
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
    const patientId = req.params.id;
    const doctorId = req.user.id;
    const userRole = req.user.role;

    console.log('Getting medical details for patient:', patientId, 'by doctor:', doctorId);

    if (userRole !== 'doctor') {
      return res.status(403).json({ message: 'Access denied. Doctor role required.' });
    }

    // Find the patient
    const patient = await findUserById(patientId);
    
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Get all prescriptions for this patient by this doctor
    const doctorPrescriptions = await findPrescriptionsByDoctorId(doctorId);
    const patientPrescriptions = doctorPrescriptions
      .filter(p => p.patientId === patientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
        const key = med.name.toLowerCase();
        if (medicationMap.has(key)) {
          medicationMap.set(key, medicationMap.get(key) + 1);
        } else {
          medicationMap.set(key, 1);
        }
      });
    });
    
    // Enhanced medical details
    const medicalDetails = {
      ...patientData,
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
