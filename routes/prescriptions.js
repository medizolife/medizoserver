const express = require('express');
const router = express.Router();
const { queryD1 } = require('../config/d1-client');
const { 
  createPrescription, 
  findPrescriptionById, 
  findPrescriptionsByDoctorId,
  findPrescriptionsByPatientId,
  updatePrescription,
  deletePrescription,
  getPrescriptions
} = require('../models/prescription');
const { findUserById } = require('../models/user');
const { auth, doctor } = require('../middleware/auth');
const { sendPrescriptionNotification } = require('../services/email');

/**
 * Check if a doctor is DigiLocker verified
 * @param {string} doctorId - Doctor's user ID
 * @returns {boolean} Whether the doctor is verified
 */
const isDoctorVerified = async (doctorId) => {
  const user = await findUserById(doctorId);
  return user?.digilockerVerified === true;
};

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
      
      // Enhance with patient information safely
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let patient = null;
          if (prescription.patientId) {
            patient = await findUserById(prescription.patientId);
          }
          return {
            ...prescription,
            patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown Patient' : 'Unknown Patient',
            patientEmail: patient ? patient.email || 'N/A' : 'N/A'
          };
        } catch (err) {
          console.error('Error enhancing prescription with patient info:', err);
          return {
            ...prescription,
            patientName: 'Unknown Patient',
            patientEmail: 'N/A'
          };
        }
      }));
    } else if (role === 'patient') {
      prescriptions = await findPrescriptionsByPatientId(userId);
      console.log('Found', prescriptions.length, 'prescriptions for patient');
      
      // Enhance with doctor information safely
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let doc = null;
          if (prescription.doctorId) {
            doc = await findUserById(prescription.doctorId);
          }
          return {
            ...prescription,
            doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : 'Unknown Doctor',
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : 'General Physician'
          };
        } catch (err) {
          console.error('Error enhancing prescription with doctor info:', err);
          return {
            ...prescription,
            doctorName: 'Unknown Doctor',
            doctorSpecialization: 'General Physician'
          };
        }
      }));
    } else if (role === 'pharmacist') {
      // Pharmacist sees prescriptions dispensed by them
      try {
        const { results } = await queryD1(
          `SELECT * FROM prescriptions WHERE 
            json_extract(dispensedBy, '$.pharmacistId') = ? 
            OR dispensedStatus = 'dispensed' 
           ORDER BY updatedAt DESC`,
          [userId]
        );
        // Parse JSON fields
        const { getPrescriptions: getAll } = require('../models/prescription');
        // Use raw results and parse them
        prescriptions = results.map(row => {
          const rx = { ...row };
          const jsonFields = ['vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
            'currentMedications', 'pastSurgicalHistory', 'medications', 'medicationNotes',
            'testsRequired', 'investigations', 'dietModifications', 'lifestyleChanges',
            'warningSigns', 'followUpInfo', 'dispensedBy'];
          for (const field of jsonFields) {
            if (typeof rx[field] === 'string') {
              try { rx[field] = JSON.parse(rx[field]); } catch (e) {}
            }
          }
          return rx;
        });
      } catch (err) {
        console.log('[Prescriptions] D1 pharmacist fetch error:', err.message);
        prescriptions = [];
      }
      console.log('Found', prescriptions.length, 'dispensed prescriptions for pharmacist:', userId);

      // Enhance with patient & doctor info
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let patient = null;
          let doc = null;
          if (prescription.patientId) patient = await findUserById(prescription.patientId);
          if (prescription.doctorId) doc = await findUserById(prescription.doctorId);
          return {
            ...prescription,
            patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown Patient' : 'Unknown Patient',
            patientEmail: patient ? patient.email || 'N/A' : 'N/A',
            doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : 'Unknown Doctor',
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : 'General Physician'
          };
        } catch (err) {
          return { ...prescription, patientName: 'Unknown Patient', doctorName: 'Unknown Doctor' };
        }
      }));
    } else if (role === 'admin') {
      // Admins can see ALL prescriptions
      prescriptions = await getPrescriptions();
      // Enhance with patient & doctor info
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let patient = null;
          let doc = null;
          if (prescription.patientId) patient = await findUserById(prescription.patientId);
          if (prescription.doctorId) doc = await findUserById(prescription.doctorId);
          return {
            ...prescription,
            patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown Patient' : 'Unknown Patient',
            patientEmail: patient ? patient.email || 'N/A' : 'N/A',
            doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : 'Unknown Doctor',
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : 'General Physician'
          };
        } catch (err) {
          return { ...prescription, patientName: 'Unknown Patient', doctorName: 'Unknown Doctor' };
        }
      }));
    }
    
    // Sort by creation date (newest first)
    prescriptions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
    res.json(Array.isArray(prescriptions) ? prescriptions : []);
  } catch (error) {
    console.error('Get prescriptions error:', error);
    res.json([]);
  }
});

/**
 * @route   GET /api/prescriptions/lookup/:code
 * @desc    Lookup prescription by QR code string or partial ID
 * @access  Private (Pharmacist / Admin)
 */
router.get('/lookup/:code', auth, async (req, res) => {
  try {
    const code = req.params.code;
    console.log('[Prescriptions] Lookup by code/id:', code);
    
    let prescription = null;

    // Try exact ID match first
    prescription = await findPrescriptionById(code);
    
    // Try QR code match
    if (!prescription) {
      try {
        const { results } = await queryD1(
          'SELECT * FROM prescriptions WHERE qrCode = ? LIMIT 1',
          [code]
        );
        if (results.length > 0) {
          // Parse JSON fields
          const row = results[0];
          const jsonFields = ['vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
            'currentMedications', 'pastSurgicalHistory', 'medications', 'medicationNotes',
            'testsRequired', 'investigations', 'dietModifications', 'lifestyleChanges',
            'warningSigns', 'followUpInfo', 'dispensedBy'];
          for (const field of jsonFields) {
            if (typeof row[field] === 'string') {
              try { row[field] = JSON.parse(row[field]); } catch (e) {}
            }
          }
          prescription = row;
        }
      } catch (e) {
        console.log('[Prescriptions] QR code lookup error:', e.message);
      }
    }
    
    // Try partial ID match (last N chars)
    if (!prescription) {
      try {
        const { results } = await queryD1('SELECT * FROM prescriptions');
        const jsonFields = ['vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
          'currentMedications', 'pastSurgicalHistory', 'medications', 'medicationNotes',
          'testsRequired', 'investigations', 'dietModifications', 'lifestyleChanges',
          'warningSigns', 'followUpInfo', 'dispensedBy'];
        prescription = results.find(d => {
          const id = d.id || '';
          return id.endsWith(code) || id.includes(code);
        });
        if (prescription) {
          for (const field of jsonFields) {
            if (typeof prescription[field] === 'string') {
              try { prescription[field] = JSON.parse(prescription[field]); } catch (e) {}
            }
          }
        }
      } catch (e) {
        console.log('[Prescriptions] Partial match error:', e.message);
      }
    }

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found for this QR code or ID' });
    }
    
    // Enhance with patient & doctor info
    let patient = null;
    let doc = null;
    try {
      if (prescription.patientId) patient = await findUserById(prescription.patientId);
      if (prescription.doctorId) doc = await findUserById(prescription.doctorId);
    } catch (e) { /* ignore enhancement errors */ }

    const enhanced = {
      ...prescription,
      id: prescription.id,
      patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : 'Unknown Patient',
      patientEmail: patient ? patient.email || 'N/A' : 'N/A',
      doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : 'Unknown Doctor',
      doctorSpecialization: doc ? doc.specialization || 'General Physician' : 'General Physician',
      doctorVerified: doc?.digilockerVerified || false
    };

    res.json({ success: true, prescription: enhanced });
  } catch (error) {
    console.error('Prescription lookup error:', error);
    res.status(500).json({ success: false, message: 'Server error during lookup' });
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
    // DigiLocker verification guard
    const verified = await isDoctorVerified(req.user.id);
    if (!verified) {
      return res.status(403).json({
        message: 'You must verify your identity via DigiLocker before creating prescriptions',
        requiresVerification: true
      });
    }

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
    // DigiLocker verification guard
    const verified = await isDoctorVerified(req.user.id);
    if (!verified) {
      return res.status(403).json({
        message: 'You must verify your identity via DigiLocker before updating prescriptions',
        requiresVerification: true
      });
    }

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
    const prescription = await findPrescriptionById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check if doctor is the owner of the prescription
    if (prescription.doctorId !== doctorId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Delete prescription
    const success = await deletePrescription(prescriptionId);
    
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
router.get(['/:id/download', '/:id/pdf'], auth, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const userId = req.user.id?.toString();
    const role = req.user.role;
    
    const prescription = await findPrescriptionById(prescriptionId);
    
    console.log('Download request - Prescription found:', prescription ? 'yes' : 'no');
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check access permissions
    const prescPatientId = prescription.patientId?.toString();
    const prescDoctorId = prescription.doctorId?.toString();
    const currentUserId = userId?.toString();

    console.log('Download access check:', { currentUserId, role, prescPatientId, prescDoctorId });
    
    if (role === 'patient') {
      if (prescPatientId && currentUserId && prescPatientId !== currentUserId) {
        const patientUser = await findUserById(prescription.patientId);
        if (!patientUser || patientUser.email?.toLowerCase() !== req.user.email?.toLowerCase()) {
          return res.status(403).json({ message: 'Access denied: You can only download your own prescriptions' });
        }
      }
    }
    
    // Get patient and doctor details (with robust fallbacks if user lookup fails)
    let patient = await findUserById(prescription.patientId);
    let doctorUser = await findUserById(prescription.doctorId);
    
    if (!patient) {
      patient = {
        id: prescPatientId || 'patient-id',
        firstName: prescription.patientName ? prescription.patientName.split(' ')[0] : 'Patient',
        lastName: prescription.patientName ? prescription.patientName.split(' ').slice(1).join(' ') : '',
        email: prescription.patientEmail || '',
        dateOfBirth: prescription.patientDOB || '',
        gender: prescription.patientGender || '',
        phone: prescription.patientPhone || prescription.contactNumber || ''
      };
    }
    
    if (!doctorUser) {
      doctorUser = {
        id: prescDoctorId || 'doctor-id',
        firstName: prescription.doctorName ? prescription.doctorName.split(' ')[0] : 'Doctor',
        lastName: prescription.doctorName ? prescription.doctorName.split(' ').slice(1).join(' ') : '',
        specialization: prescription.doctorSpecialization || 'General Practitioner',
        licenseNumber: prescription.doctorLicenseNumber || ''
      };
    }
    
    // Generate PDF using the comprehensive prescription PDF generator
    const { generatePrescriptionPDF } = require('../services/pdfGenerator');
    await generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctorUser);

  } catch (error) {
    console.error('Download prescription error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Server error generating PDF' });
    }
  }
});

/**
 * @route   PUT /api/prescriptions/:id/dispense
 * @desc    Mark prescription as dispensed by pharmacist
 * @access  Private (Pharmacist or Admin)
 */
router.put('/:id/dispense', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { dispenseNotes } = req.body;

    console.log('[Prescriptions] Dispense request for ID/Code:', id, 'User:', req.user?.id);

    let prescription = null;

    // Try exact ID match
    prescription = await findPrescriptionById(id);

    // Try QR code match
    if (!prescription) {
      try {
        const { results } = await queryD1(
          'SELECT * FROM prescriptions WHERE qrCode = ? LIMIT 1',
          [id]
        );
        if (results.length > 0) {
          prescription = results[0];
        }
      } catch (e) {}
    }

    // Try partial ID match
    if (!prescription) {
      try {
        const { results } = await queryD1('SELECT * FROM prescriptions');
        prescription = results.find(d => {
          const docId = d.id || '';
          return docId.endsWith(id) || docId.includes(id);
        });
      } catch (e) {}
    }

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const targetId = prescription.id || id;

    let pharmacist = null;
    try {
      if (req.user?.id) {
        pharmacist = await findUserById(req.user.id);
      }
    } catch (e) {}

    const dispenseData = {
      dispensedStatus: 'dispensed',
      dispensedAt: new Date().toISOString(),
      dispensedBy: {
        pharmacistId: req.user?.id || 'staff-pharm',
        pharmacistName: pharmacist ? `${pharmacist.firstName || ''} ${pharmacist.lastName || ''}`.trim() : (req.user?.name || 'Staff Pharmacist'),
        pharmacyName: pharmacist?.pharmacyName || 'Medizo Care Pharmacy',
        licenseNumber: pharmacist?.licenseNumber || 'PHARM-88219'
      },
      dispenseNotes: dispenseNotes || 'All prescribed items verified and dispensed.'
    };

    const updatedPrescription = await updatePrescription(targetId, dispenseData);

    if (!updatedPrescription) {
      return res.status(500).json({ success: false, message: 'Failed to update prescription' });
    }

    console.log('✅ Prescription successfully dispensed:', targetId);

    res.json({
      success: true,
      message: 'Prescription successfully fulfilled and marked as dispensed!',
      prescription: updatedPrescription
    });
  } catch (error) {
    console.error('Dispense prescription error:', error);
    res.status(500).json({ success: false, message: 'Failed to dispense prescription: ' + (error.message || 'Server error') });
  }
});

module.exports = router;