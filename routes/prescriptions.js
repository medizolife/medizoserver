const express = require('express');
const router = express.Router();
const { 
  createPrescription, 
  findPrescriptionById, 
  findPrescriptionsByDoctorId,
  findPrescriptionsByPatientId,
  updatePrescription,
  deletePrescription
} = require('../models/prescription');
const { findUserById } = require('../models/user');
const { auth, doctor } = require('../middleware/auth');
const { sendPrescriptionNotification } = require('../services/email');

/**
 * @route   GET /api/prescriptions
 * @desc    Get prescriptions based on user role
 * @access  Private
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    
    console.log('Getting prescriptions for user:', userId, 'role:', role);
    
    let prescriptions = [];
    
    // Get prescriptions based on role
    if (role === 'doctor') {
      prescriptions = await findPrescriptionsByDoctorId(userId);
      console.log('Found', prescriptions.length, 'prescriptions for doctor');
      
      // Enhance with patient information
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        const patient = await findUserById(prescription.patientId);
        return {
          ...prescription,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown Patient',
          patientEmail: patient ? patient.email : 'N/A'
        };
      }));
    } else if (role === 'patient') {
      prescriptions = await findPrescriptionsByPatientId(userId);
      console.log('Found', prescriptions.length, 'prescriptions for patient');
      
      // Enhance with doctor information
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        const doctor = await findUserById(prescription.doctorId);
        return {
          ...prescription,
          doctorName: doctor ? `Dr. ${doctor.firstName} ${doctor.lastName}` : 'Unknown Doctor',
          doctorSpecialization: doctor ? doctor.specialization : 'N/A'
        };
      }));
    }
    
    // Sort by creation date (newest first)
    prescriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(prescriptions);
  } catch (error) {
    console.error('Get prescriptions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/prescriptions/stats
 * @desc    Get prescription statistics for doctor
 * @access  Private (Doctor only)
 */
router.get('/stats', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const prescriptions = await findPrescriptionsByDoctorId(doctorId);
    
    const recentPrescriptions = await Promise.all(
      prescriptions
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(async (p) => {
          const patient = await findUserById(p.patientId);
          return {
            id: p.id,
            diagnosis: p.diagnosis,
            patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
            createdAt: p.createdAt,
            status: p.status
          };
        })
    );
    
    const stats = {
      total: prescriptions.length,
      active: prescriptions.filter(p => p.status === 'active').length,
      completed: prescriptions.filter(p => p.status === 'completed').length,
      thisMonth: prescriptions.filter(p => {
        const prescriptionDate = new Date(p.createdAt);
        const now = new Date();
        return prescriptionDate.getMonth() === now.getMonth() && 
               prescriptionDate.getFullYear() === now.getFullYear();
      }).length,
      uniquePatients: [...new Set(prescriptions.map(p => p.patientId))].length,
      recentPrescriptions
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get prescription stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/prescriptions/:id
 * @desc    Get prescription by ID
 * @access  Private
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const prescription = await findPrescriptionById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check if user has access to prescription
    const userId = req.user.id;
    const role = req.user.role;
    
    if (
      (role === 'doctor' && prescription.doctorId !== userId) && 
      (role === 'patient' && prescription.patientId !== userId)
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(prescription);
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/prescriptions
 * @desc    Create a new prescription
 * @access  Private (Doctor only)
 */
router.post('/', doctor, async (req, res) => {
  try {
    const { 
      patientId,
      patientEmail,
      // New comprehensive fields
      vitalSigns,
      presentingComplaints,
      clinicalFindings,
      provisionalDiagnosis,
      currentMedications,
      pastSurgicalHistory,
      medications,
      medicationNotes,
      investigations,
      investigationNotes,
      dietModifications,
      lifestyleChanges,
      warningSigns,
      followUpInfo,
      emergencyHelpline,
      notes,
      // Legacy fields for backward compatibility
      diagnosis,
      testsRequired,
      instructions,
      followUpDate
    } = req.body;
    
    const doctorId = req.user.id;
    
    // Resolve patient by id first, then by email (case-insensitive)
    const { getUsers } = require('../models/user');
    const users = await getUsers();
    let patient = null;

    if (patientId) {
      patient = users.find(u => u.id === String(patientId) && u.role === 'patient') || null;
    }
    if (!patient && patientEmail) {
      const target = String(patientEmail).toLowerCase();
      patient = users.find(u => String(u.email).toLowerCase() === target && u.role === 'patient') || null;
    }
    
    if (!patient) {
      // Log available patients for debugging
      const availablePatients = users.filter(user => user.role === 'patient');
      console.log('Patient not found. Available patients:', availablePatients.map(p => ({ 
        id: p.id, 
        email: p.email, 
        name: `${p.firstName} ${p.lastName}` 
      })));
      console.log('Searched for patientId:', patientId);
      
      return res.status(404).json({ 
        message: 'Patient not found',
        searched: { patientId, patientEmail },
        availablePatients: availablePatients.map(p => ({ 
          id: p.id, 
          email: p.email, 
          name: `${p.firstName} ${p.lastName}` 
        }))
      });
    }
    
    // Create prescription with comprehensive data
    const prescription = await createPrescription({
      doctorId,
      patientId: patient.id,
      patientEmail: patient.email,
      // Vital signs
      vitalSigns: vitalSigns || {},
      // Clinical information
      presentingComplaints: presentingComplaints || [],
      clinicalFindings: clinicalFindings || [],
      provisionalDiagnosis: provisionalDiagnosis || [],
      // Medical history
      currentMedications: currentMedications || [],
      pastSurgicalHistory: pastSurgicalHistory || [],
      // Prescribed medications
      medications: medications || [],
      medicationNotes: medicationNotes || [],
      // Investigations
      investigations: investigations || [],
      investigationNotes: investigationNotes || '',
      // Lifestyle recommendations
      dietModifications: dietModifications || [],
      lifestyleChanges: lifestyleChanges || [],
      warningSigns: warningSigns || [],
      // Follow-up
      followUpInfo: followUpInfo || {},
      emergencyHelpline: emergencyHelpline || '',
      notes: notes || '',
      // Legacy fields (for backward compatibility)
      diagnosis: diagnosis || (provisionalDiagnosis && provisionalDiagnosis.length > 0 ? provisionalDiagnosis.join(', ') : ''),
      testsRequired: testsRequired || [],
      instructions: instructions || '',
      followUpDate: followUpDate || (followUpInfo && followUpInfo.appointmentDate ? followUpInfo.appointmentDate : null)
    });
    
    // Get doctor data for email notification
    const doctorUser = await findUserById(doctorId);
    
    // Send email notification to patient (optional - don't fail if email fails)
    try {
      await sendPrescriptionNotification(patient, prescription, doctorUser);
      console.log('Email notification sent successfully to:', patient.email);
    } catch (emailError) {
      console.log('Email notification failed (continuing anyway):', emailError.message);
    }
    
    res.status(201).json(prescription);
  } catch (error) {
    console.error('Create prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/prescriptions/:id
 * @desc    Update a prescription
 * @access  Private (Doctor only)
 */
router.put('/:id', doctor, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const doctorId = req.user.id;
    const prescription = await findPrescriptionById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check if doctor is the owner of the prescription
    if (prescription.doctorId !== doctorId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const { 
      // New comprehensive fields
      vitalSigns,
      presentingComplaints,
      clinicalFindings,
      provisionalDiagnosis,
      currentMedications,
      pastSurgicalHistory,
      medications,
      medicationNotes,
      investigations,
      investigationNotes,
      dietModifications,
      lifestyleChanges,
      warningSigns,
      followUpInfo,
      emergencyHelpline,
      notes,
      status,
      // Legacy fields
      medication, 
      dosage, 
      frequency, 
      duration, 
      instructions
    } = req.body;
    
    // Update prescription with all fields (undefined values won't overwrite)
    const updateData = {};
    
    // Add new comprehensive fields if provided
    if (vitalSigns !== undefined) updateData.vitalSigns = vitalSigns;
    if (presentingComplaints !== undefined) updateData.presentingComplaints = presentingComplaints;
    if (clinicalFindings !== undefined) updateData.clinicalFindings = clinicalFindings;
    if (provisionalDiagnosis !== undefined) updateData.provisionalDiagnosis = provisionalDiagnosis;
    if (currentMedications !== undefined) updateData.currentMedications = currentMedications;
    if (pastSurgicalHistory !== undefined) updateData.pastSurgicalHistory = pastSurgicalHistory;
    if (medications !== undefined) updateData.medications = medications;
    if (medicationNotes !== undefined) updateData.medicationNotes = medicationNotes;
    if (investigations !== undefined) updateData.investigations = investigations;
    if (investigationNotes !== undefined) updateData.investigationNotes = investigationNotes;
    if (dietModifications !== undefined) updateData.dietModifications = dietModifications;
    if (lifestyleChanges !== undefined) updateData.lifestyleChanges = lifestyleChanges;
    if (warningSigns !== undefined) updateData.warningSigns = warningSigns;
    if (followUpInfo !== undefined) updateData.followUpInfo = followUpInfo;
    if (emergencyHelpline !== undefined) updateData.emergencyHelpline = emergencyHelpline;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;
    
    // Legacy fields
    if (medication !== undefined) updateData.medication = medication;
    if (dosage !== undefined) updateData.dosage = dosage;
    if (frequency !== undefined) updateData.frequency = frequency;
    if (duration !== undefined) updateData.duration = duration;
    if (instructions !== undefined) updateData.instructions = instructions;
    
    const updatedPrescription = await updatePrescription(prescriptionId, updateData);
    
    res.json(updatedPrescription);
  } catch (error) {
    console.error('Update prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/prescriptions/:id
 * @desc    Delete a prescription
 * @access  Private (Doctor only)
 */
router.delete('/:id', doctor, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const doctorId = req.user.id;
    const prescription = findPrescriptionById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check if doctor is the owner of the prescription
    if (prescription.doctorId !== doctorId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Delete prescription
    const success = deletePrescription(prescriptionId);
    
    if (!success) {
      return res.status(500).json({ message: 'Failed to delete prescription' });
    }
    
    res.json({ message: 'Prescription deleted successfully' });
  } catch (error) {
    console.error('Delete prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/prescriptions/:id/download
 * @desc    Download prescription as PDF
 * @access  Private
 */
router.get('/:id/download', auth, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const userId = req.user.id;
    const role = req.user.role;
    
    const prescription = await findPrescriptionById(prescriptionId);
    
    console.log('Download request - Prescription found:', prescription ? 'yes' : 'no');
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check access permissions - convert to strings for comparison
    const prescPatientId = prescription.patientId?.toString() || prescription.patientId;
    const prescDoctorId = prescription.doctorId?.toString() || prescription.doctorId;
    
    console.log('Download access check:', { userId, role, prescPatientId, prescDoctorId });
    
    if (role === 'patient' && prescPatientId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    } else if (role === 'doctor' && prescDoctorId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get patient and doctor details
    const patient = await findUserById(prescription.patientId);
    const doctor = await findUserById(prescription.doctorId);
    
    if (!patient || !doctor) {
      return res.status(500).json({ message: 'Failed to retrieve user information' });
    }
    

    // Generate PDF using the comprehensive prescription PDF generator
    const { generatePrescriptionPDF } = require('../services/pdfGenerator');
    await generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctor);

  } catch (error) {
    console.error('Download prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;