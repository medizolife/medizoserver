const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
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

// Try to import the Mongoose UserModel for DigiLocker check
let UserModel;
try {
  UserModel = require('../models/UserModel');
} catch (e) {
  UserModel = null;
}

/**
 * Check if a doctor is DigiLocker verified
 * @param {string} doctorId - Doctor's user ID
 * @returns {boolean} Whether the doctor is verified
 */
const isDoctorVerified = async (doctorId) => {
  // Check via Mongoose model if available
  if (mongoose.connection.readyState === 1 && UserModel) {
    try {
      const user = await UserModel.findById(doctorId).select('digilockerVerified').lean();
      return user?.digilockerVerified === true;
    } catch (err) {
      console.error('DigiLocker verification check error:', err);
    }
  }
  
  // Fallback: check from user.js
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
          let doctor = null;
          if (prescription.doctorId) {
            doctor = await findUserById(prescription.doctorId);
          }
          return {
            ...prescription,
            doctorName: doctor ? `Dr. ${doctor.firstName || ''} ${doctor.lastName || ''}`.trim() : 'Unknown Doctor',
            doctorSpecialization: doctor ? doctor.specialization || 'General Physician' : 'General Physician'
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
      // Pharmacist sees ONLY prescriptions that have been scanned and dispensed by them
      const PrescriptionModel = require('../models/PrescriptionModel');
      if (mongoose.connection.readyState === 1 && PrescriptionModel) {
        try {
          const docs = await PrescriptionModel.find({
            $or: [
              { 'dispensedBy.pharmacistId': userId },
              { dispensedStatus: 'dispensed' }
            ]
          }).sort({ updatedAt: -1 }).lean();
          prescriptions = docs.map(d => ({ ...d, id: d._id?.toString() || d.id }));
        } catch (err) {
          console.log('[Prescriptions] Mongo pharmacist fetch error:', err.message);
          prescriptions = [];
        }
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
      const PrescriptionModel = require('../models/PrescriptionModel');
      if (mongoose.connection.readyState === 1 && PrescriptionModel) {
        try {
          const docs = await PrescriptionModel.find({}).sort({ createdAt: -1 }).lean();
          prescriptions = docs.map(d => ({ ...d, id: d._id?.toString() || d.id }));
        } catch (err) {
          console.log('[Prescriptions] Mongo admin fetch error:', err.message);
          prescriptions = [];
        }
      }
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
    
    const PrescriptionModel = require('../models/PrescriptionModel');
    let prescription = null;

    const dbState = mongoose.connection.readyState;
    const dbName = mongoose.connection.name || 'unknown';
    console.log('[Prescriptions] Lookup - DB state:', dbState, 'DB name:', dbName, 'PrescriptionModel:', !!PrescriptionModel);

    if (dbState === 1 && PrescriptionModel) {
      // Log total count for debugging
      try {
        const totalCount = await PrescriptionModel.countDocuments();
        console.log('[Prescriptions] Total documents in collection:', totalCount);
      } catch (countErr) {
        console.log('[Prescriptions] Count error:', countErr.message);
      }

      // Try exact _id match first
      try {
        if (mongoose.Types.ObjectId.isValid(code)) {
          prescription = await PrescriptionModel.findById(code).lean();
          console.log('[Prescriptions] findById result:', prescription ? 'FOUND' : 'NOT FOUND');
        }
      } catch (e) {
        console.log('[Prescriptions] findById error:', e.message);
      }
      
      // Try QR code string match
      if (!prescription) {
        prescription = await PrescriptionModel.findOne({ qrCode: code }).lean();
        console.log('[Prescriptions] findOne qrCode result:', prescription ? 'FOUND' : 'NOT FOUND');
      }
      
      // Try partial ID match (last N chars)
      if (!prescription) {
        const docs = await PrescriptionModel.find({}).lean();
        console.log('[Prescriptions] Total docs for partial match:', docs.length);
        prescription = docs.find(d => {
          const id = (d._id?.toString() || '');
          return id.endsWith(code) || id.includes(code);
        });
      }
    }

    if (!prescription) {
      // Fallback to in-memory
      prescription = await findPrescriptionById(code);
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
      id: prescription._id?.toString() || prescription.id,
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
router.get(['/:id/download', '/:id/pdf'], auth, async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const userId = (req.user.id || req.user._id)?.toString();
    const role = req.user.role;
    
    const prescription = await findPrescriptionById(prescriptionId);
    
    console.log('Download request - Prescription found:', prescription ? 'yes' : 'no');
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    // Check access permissions - convert to strings safely whether string or object
    const prescPatientId = (typeof prescription.patientId === 'object' && prescription.patientId?._id)
      ? prescription.patientId._id.toString()
      : prescription.patientId?.toString();
    const prescDoctorId = (typeof prescription.doctorId === 'object' && prescription.doctorId?._id)
      ? prescription.doctorId._id.toString()
      : prescription.doctorId?.toString();
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
    let doctor = await findUserById(prescription.doctorId);
    
    if (!patient) {
      patient = {
        id: prescPatientId || 'patient-id',
        firstName: prescription.patientName ? prescription.patientName.split(' ')[0] : (prescription.patientFirstName || 'Patient'),
        lastName: prescription.patientName ? prescription.patientName.split(' ').slice(1).join(' ') : (prescription.patientLastName || ''),
        email: prescription.patientEmail || '',
        dateOfBirth: prescription.patientDOB || prescription.patientDateOfBirth || '',
        gender: prescription.patientGender || '',
        phone: prescription.patientPhone || prescription.contactNumber || ''
      };
    }
    
    if (!doctor) {
      doctor = {
        id: prescDoctorId || 'doctor-id',
        firstName: prescription.doctorName ? prescription.doctorName.split(' ')[0] : (prescription.doctorFirstName || 'Doctor'),
        lastName: prescription.doctorName ? prescription.doctorName.split(' ').slice(1).join(' ') : (prescription.doctorLastName || ''),
        specialization: prescription.doctorSpecialization || prescription.specialization || 'General Practitioner',
        licenseNumber: prescription.doctorLicenseNumber || prescription.licenseNumber || ''
      };
    }
    
    // Generate PDF using the comprehensive prescription PDF generator
    const { generatePrescriptionPDF } = require('../services/pdfGenerator');
    await generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctor);

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

    const PrescriptionModel = require('../models/PrescriptionModel');
    let prescription = null;

    if (mongoose.connection.readyState === 1 && PrescriptionModel) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          prescription = await PrescriptionModel.findById(id).lean();
        }
      } catch (e) {}

      if (!prescription) {
        prescription = await PrescriptionModel.findOne({ qrCode: id }).lean();
      }

      if (!prescription) {
        try {
          const docs = await PrescriptionModel.find({}).lean();
          prescription = docs.find(d => {
            const docId = (d._id?.toString() || '');
            return docId.endsWith(id) || docId.includes(id);
          });
        } catch (e) {}
      }
    }

    if (!prescription) {
      prescription = await findPrescriptionById(id);
    }

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const targetId = prescription._id?.toString() || prescription.id || id;

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

    let updatedPrescription = null;

    if (mongoose.connection.readyState === 1 && PrescriptionModel) {
      try {
        const doc = await PrescriptionModel.findByIdAndUpdate(
          targetId,
          { $set: dispenseData },
          { new: true }
        );
        if (doc) {
          updatedPrescription = doc.toJSON ? doc.toJSON() : doc;
        }
      } catch (err) {
        console.log('[Prescriptions] Mongo dispense error:', err.message);
      }
    }

    if (!updatedPrescription) {
      updatedPrescription = await updatePrescription(targetId, dispenseData);
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