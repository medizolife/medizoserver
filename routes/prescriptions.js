const express = require('express');
const router = express.Router();
const { queryD1 } = require('../config/d1-client');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { 
  createPrescription, 
  findPrescriptionById, 
  findPrescriptionsByDoctorId,
  findPrescriptionsByPatientId,
  updatePrescription,
  deletePrescription,
  getPrescriptions,
  createExternalPrescription,
  findExternalPrescriptionsByPatientId,
  findExternalPrescriptionById,
  deleteExternalPrescription
} = require('../models/prescription');
const { findUserById, updateUser } = require('../models/user');
const { auth, doctor } = require('../middleware/auth');
const { publicLookupLimiter } = require('../middleware/rateLimiter');
const { sendPrescriptionNotification } = require('../services/email');
const { getFamilyProfileById } = require('../models/familyProfile');
const { resolvePatient } = require('../services/patientResolver');

/**
 * Mask Patient Name for unauthenticated public preview
 */
function maskPatientName(name) {
  if (!name || name.toLowerCase() === 'unknown patient') return 'Patient';
  const parts = String(name).trim().split(/\s+/);
  return parts.map(p => {
    if (p.length <= 2) return p[0] + '*';
    return p[0] + '*'.repeat(Math.max(1, p.length - 2)) + p[p.length - 1];
  }).join(' ');
}

/**
 * Mask Email for unauthenticated public preview
 */
function maskEmail(email) {
  if (!email || email === 'N/A' || email.endsWith('@patient.medizo.life')) return 'N/A';
  return String(email).replace(/(.{2})(.*)(?=@)/, '$1***');
}

// Configure Multer for external record uploads
const recordsDir = (process.env.VERCEL || typeof __dirname === 'undefined')
  ? '/tmp/uploads/records' 
  : path.join(__dirname, '../uploads/records');
if (!fs.existsSync(recordsDir)) {
  try {
    fs.mkdirSync(recordsDir, { recursive: true });
  } catch (e) {}
}

const recordsStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recordsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `record-${uniqueSuffix}${ext}`);
  }
});

// Hard limit 3MB (3 * 1024 * 1024 = 3,145,728 bytes)
const uploadExternal = multer({
  storage: recordsStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPEG, PNG, GIF, WEBP and PDF files are allowed.'));
    }
  }
});

// Configure Multer for prescription test / lab report uploads (10MB limit)
const testReportStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recordsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `test-report-${uniqueSuffix}${ext}`);
  }
});

const uploadTestReport = multer({
  storage: testReportStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPEG, PNG, GIF, WEBP and PDF files are allowed.'));
    }
  }
});

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
      
      // Helper to safely resolve patient name without wiping stored prescription data
      const resolvePatientData = async (prescription) => {
        let patient = null;
        let profile = null;
        try {
          if (prescription.patientId) {
            patient = await findUserById(prescription.patientId);
            if (!patient) {
              try {
                profile = await getFamilyProfileById(prescription.patientId);
              } catch (e) {}
            }
          }
          if (!patient && prescription.accountId) {
            patient = await findUserById(prescription.accountId);
          }
        } catch (e) {}

        let resolvedName = '';
        if (patient && (patient.firstName || patient.lastName)) {
          resolvedName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
        } else if (profile && (profile.firstName || profile.lastName)) {
          resolvedName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
        }
        if (!resolvedName || resolvedName.toLowerCase() === 'unknown patient') {
          resolvedName = (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient')
            ? prescription.patientName.trim()
            : 'Patient';
        }

        const phone = patient?.phone || patient?.contactNumber || patient?.mobile || profile?.phone || prescription.patientPhone || prescription.contactNumber || 'N/A';
        const email = patient?.email || prescription.patientEmail || 'N/A';

        return {
          ...prescription,
          patientName: resolvedName,
          patientEmail: email,
          patientMobile: phone,
          patientPhone: phone,
          contactNumber: phone
        };
      };

      // Enhance with patient information safely
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          return await resolvePatientData(prescription);
        } catch (err) {
          console.error('Error enhancing prescription with patient info:', err);
          return {
            ...prescription,
            patientName: (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient') ? prescription.patientName : 'Patient',
            patientEmail: prescription.patientEmail || 'N/A',
            patientMobile: prescription.patientPhone || 'N/A',
            patientPhone: prescription.patientPhone || 'N/A',
            contactNumber: prescription.contactNumber || 'N/A'
          };
        }
      }));
    } else if (role === 'patient') {
      const userObj = await findUserById(userId);
      const userEmail = userObj?.email || req.user?.email || '';
      const userPhone = userObj?.phone || userObj?.contactNumber || req.user?.phone || '';
      prescriptions = await findPrescriptionsByPatientId(userId, { email: userEmail, phone: userPhone });
      console.log('Found', prescriptions.length, 'prescriptions for patient:', userId, userEmail);
      
      // Enhance with doctor information safely
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let doc = null;
          if (prescription.doctorId) {
            doc = await findUserById(prescription.doctorId);
          }
          let dName = (prescription.doctorName && prescription.doctorName.trim()) 
            || (doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : 'Dr. Medical Practitioner');
          if (!dName || dName === 'Dr.' || dName.toLowerCase() === 'doctor') dName = 'Dr. Medical Practitioner';

          return {
            ...prescription,
            doctorName: dName,
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : (prescription.doctorSpecialization || 'General Physician')
          };
        } catch (err) {
          console.error('Error enhancing prescription with doctor info:', err);
          return {
            ...prescription,
            doctorName: (prescription.doctorName && prescription.doctorName.trim()) || 'Dr. Medical Practitioner',
            doctorSpecialization: prescription.doctorSpecialization || 'General Physician'
          };
        }
      }));
    } else if (role === 'pharmacist') {
      // Pharmacist sees prescriptions dispensed by them or active
      try {
        const { results } = await queryD1(
          `SELECT * FROM prescriptions WHERE 
            json_extract(dispensedBy, '$.pharmacistId') = ? 
            OR dispensedStatus = 'dispensed' 
           ORDER BY updatedAt DESC`,
          [userId]
        );
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
          let profile = null;
          let doc = null;
          if (prescription.patientId) {
            patient = await findUserById(prescription.patientId);
            if (!patient) {
              try { profile = await getFamilyProfileById(prescription.patientId); } catch (e) {}
            }
          }
          if (!patient && prescription.accountId) {
            patient = await findUserById(prescription.accountId);
          }
          if (prescription.doctorId) doc = await findUserById(prescription.doctorId);

          let resolvedName = '';
          if (patient && (patient.firstName || patient.lastName)) {
            resolvedName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
          } else if (profile && (profile.firstName || profile.lastName)) {
            resolvedName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          }
          if (!resolvedName || resolvedName.toLowerCase() === 'unknown patient') {
            resolvedName = (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient')
              ? prescription.patientName.trim()
              : 'Patient';
          }

          const phone = patient?.phone || patient?.contactNumber || patient?.mobile || profile?.phone || prescription.patientPhone || prescription.contactNumber || 'N/A';
          const email = patient?.email || prescription.patientEmail || 'N/A';

          return {
            ...prescription,
            patientName: resolvedName,
            patientEmail: email,
            patientMobile: phone,
            patientPhone: phone,
            contactNumber: phone,
            doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : (prescription.doctorSpecialization || 'General Physician')
          };
        } catch (err) {
          return { 
            ...prescription, 
            patientName: (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient') ? prescription.patientName : 'Patient', 
            doctorName: prescription.doctorName || 'Doctor' 
          };
        }
      }));
    } else if (role === 'admin') {
      // Admins can see ALL prescriptions
      prescriptions = await getPrescriptions();
      // Enhance with patient & doctor info
      prescriptions = await Promise.all(prescriptions.map(async (prescription) => {
        try {
          let patient = null;
          let profile = null;
          let doc = null;
          if (prescription.patientId) {
            patient = await findUserById(prescription.patientId);
            if (!patient) {
              try { profile = await getFamilyProfileById(prescription.patientId); } catch (e) {}
            }
          }
          if (!patient && prescription.accountId) {
            patient = await findUserById(prescription.accountId);
          }
          if (prescription.doctorId) doc = await findUserById(prescription.doctorId);

          let resolvedName = '';
          if (patient && (patient.firstName || patient.lastName)) {
            resolvedName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
          } else if (profile && (profile.firstName || profile.lastName)) {
            resolvedName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          }
          if (!resolvedName || resolvedName.toLowerCase() === 'unknown patient') {
            resolvedName = (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient')
              ? prescription.patientName.trim()
              : 'Patient';
          }

          return {
            ...prescription,
            patientName: resolvedName,
            patientEmail: patient?.email || prescription.patientEmail || 'N/A',
            doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
            doctorSpecialization: doc ? doc.specialization || 'General Physician' : (prescription.doctorSpecialization || 'General Physician')
          };
        } catch (err) {
          return { 
            ...prescription, 
            patientName: (prescription.patientName && prescription.patientName.toLowerCase() !== 'unknown patient') ? prescription.patientName : 'Patient', 
            doctorName: prescription.doctorName || 'Doctor' 
          };
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
 * @desc    Lookup prescription by QR code string, URL, or partial ID
 * @access  Public / Authenticated
 */
router.get(['/lookup/:code', '/public/lookup/:code', '/verify/:code'], publicLookupLimiter, async (req, res) => {
  try {
    let code = req.params.code || '';
    if (typeof code === 'string') {
      try { code = decodeURIComponent(code); } catch (e) {}
      if (code.includes('id=')) {
        const match = code.match(/[?&]id=([^&#]+)/);
        if (match) code = match[1];
      } else if (code.includes('/')) {
        code = code.split('/').filter(Boolean).pop() || code;
      }
      code = code.split('?')[0].trim();
    }
    
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
            'warningSigns', 'followUpInfo', 'dispensedBy', 'dispenseHistory'];
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
        const { results } = await queryD1('SELECT * FROM prescriptions WHERE id LIKE ? LIMIT 1', [`%${code}%`]);
        if (results && results.length > 0) {
          prescription = results[0];
          const jsonFields = ['vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
            'currentMedications', 'pastSurgicalHistory', 'medications', 'medicationNotes',
            'testsRequired', 'investigations', 'dietModifications', 'lifestyleChanges',
            'warningSigns', 'followUpInfo', 'dispensedBy', 'dispenseHistory'];
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

    // Extract list of medication names for privacy-safe preview
    const medNames = Array.isArray(prescription.medications) && prescription.medications.length > 0
      ? prescription.medications.map(m => typeof m === 'object' && m ? (m.name || m.medicationName || '') : String(m)).filter(Boolean)
      : (prescription.medication ? [prescription.medication] : []);

    const rawPatientName = patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : (prescription.patientName || 'Patient');
    const rawPatientEmail = patient ? (patient.email || 'N/A') : (prescription.patientEmail || 'N/A');

    const enhanced = {
      ...prescription,
      id: prescription.id,
      patientName: maskPatientName(rawPatientName),
      patientEmail: maskEmail(rawPatientEmail),
      doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
      doctorSpecialization: doc ? doc.specialization || 'General Physician' : (prescription.doctorSpecialization || 'General Physician'),
      doctorVerified: doc?.digilockerVerified || false,
      medicationNames: medNames,
      requiresBirthYearVerification: true
    };

    res.json({ success: true, prescription: enhanced });
  } catch (error) {
    console.error('Prescription lookup error:', error);
    res.status(500).json({ success: false, message: 'Server error during lookup' });
  }
});

/**
 * @route   POST /api/prescriptions/:id/verify-birth-year
 * @desc    Verify patient birth year to unlock full clinical prescription and link patient to doctor
 * @access  Private / Authenticated
 */
router.post(['/:id/verify-birth-year', '/verify-birth-year/:id'], auth, async (req, res) => {
  try {
    const { birthYear } = req.body;
    const inputYear = parseInt(String(birthYear).trim(), 10);
    if (!inputYear || isNaN(inputYear) || inputYear < 1900 || inputYear > new Date().getFullYear()) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 4-digit birth year (e.g. 1995).' });
    }

    const prescription = await findPrescriptionById(req.params.id);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found.' });
    }

    // Resolve patient
    let patient = null;
    let familyProfile = null;
    if (prescription.patientId) {
      patient = await findUserById(prescription.patientId);
      if (!patient) {
        try { familyProfile = await getFamilyProfileById(prescription.patientId); } catch (e) {}
      }
    }
    if (!patient && prescription.accountId) {
      patient = await findUserById(prescription.accountId);
    }

    // Extract actual patient birth year
    let actualYear = null;
    const dobString = patient?.dateOfBirth || familyProfile?.dateOfBirth || prescription.patientDob || '';
    if (dobString) {
      const match = String(dobString).match(/\b(19\d\d|20\d\d)\b/);
      if (match) {
        actualYear = parseInt(match[1], 10);
      } else {
        const parsed = new Date(dobString);
        if (!isNaN(parsed.getFullYear()) && parsed.getFullYear() > 1900) {
          actualYear = parsed.getFullYear();
        }
      }
    }

    // Fallback: calculate from patientAge if DOB not present in profile
    let matches = false;
    if (actualYear) {
      matches = (actualYear === inputYear);
    } else if (prescription.patientAge) {
      const age = parseInt(String(prescription.patientAge).replace(/[^\d]/g, ''), 10);
      if (age > 0) {
        const createdYear = prescription.createdAt ? new Date(prescription.createdAt).getFullYear() : new Date().getFullYear();
        const estimatedYear = createdYear - age;
        matches = Math.abs(estimatedYear - inputYear) <= 1;
      }
    }

    if (!matches) {
      return res.status(403).json({
        success: false,
        verified: false,
        message: 'Birth year verification failed. The entered birth year does not match patient records.'
      });
    }

    // Auto-link patient to doctor if requesting user is a doctor
    let linked = false;
    if (req.user && req.user.role === 'doctor' && prescription.patientId) {
      try {
        const doctorUser = await findUserById(req.user.id);
        if (doctorUser) {
          const linkedPatients = Array.isArray(doctorUser.linkedPatients) ? [...doctorUser.linkedPatients] : [];
          if (!linkedPatients.includes(prescription.patientId)) {
            linkedPatients.push(prescription.patientId);
            await updateUser(req.user.id, { linkedPatients });
            linked = true;
            console.log(`[Prescriptions] Auto-linked patient ${prescription.patientId} to doctor ${req.user.id} after birth year verification`);
          }
        }
      } catch (linkErr) {
        console.error('Error auto-linking patient to doctor:', linkErr);
      }
    }

    // Return full unlocked prescription
    let doc = null;
    if (prescription.doctorId) {
      try { doc = await findUserById(prescription.doctorId); } catch (e) {}
    }

    const enhanced = {
      ...prescription,
      patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : (prescription.patientName || 'Patient'),
      patientEmail: patient ? patient.email || 'N/A' : (prescription.patientEmail || 'N/A'),
      doctorName: doc ? `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
      doctorSpecialization: doc ? doc.specialization || 'General Physician' : (prescription.doctorSpecialization || 'General Physician'),
      doctorVerified: doc?.digilockerVerified || false,
      isUnlocked: true
    };

    res.json({
      success: true,
      verified: true,
      linked,
      message: 'Birth year verified successfully! Prescription unlocked.',
      prescription: enhanced
    });
  } catch (error) {
    console.error('Verify birth year error:', error);
    res.status(500).json({ success: false, message: 'Server error during birth year verification' });
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
 * @route   POST /api/prescriptions/upload-external
 * @desc    Upload external / past prescription document (3MB hard limit)
 * @access  Private (Patient or Doctor)
 */
router.post('/upload-external', auth, async (req, res) => {
  uploadExternal.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size exceeds the 3 MB hard limit.' });
      }
      return res.status(400).json({ message: err.message || 'Error uploading record file' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No record file uploaded' });
    }

    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      if (userRole === 'doctor') {
        const verified = await isDoctorVerified(userId);
        if (!verified) {
          return res.status(403).json({
            message: 'You must verify your identity via DigiLocker before uploading external prescriptions.',
            requiresVerification: true
          });
        }
      }

      let patientId = userId;
      if (userRole === 'doctor' && req.body.patientId) {
        patientId = req.body.patientId;
      }

      const filename = req.file.filename;
      const fileUrl = `/uploads/records/${filename}`;
      const isPdf = req.file.mimetype === 'application/pdf';

      // Save to D1 images table if available
      try {
        const { createImage } = require('../models/ImageModel');
        const fileData = fs.readFileSync(req.file.path);
        await createImage({
          filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          data: fileData,
          size: req.file.size,
          imageType: 'external_prescription',
          uploadedBy: userId
        });
      } catch (imgErr) {
        console.log('[Prescriptions] D1 Image sync notice:', imgErr.message);
      }

      const newRecord = await createExternalPrescription({
        patientId,
        uploadedBy: userId,
        title: req.body.title || req.file.originalname || 'Past Medical Record',
        doctorName: req.body.doctorName || '',
        recordDate: req.body.recordDate || new Date().toISOString().split('T')[0],
        notes: req.body.notes || '',
        fileUrl,
        fileType: isPdf ? 'pdf' : 'image',
        fileSize: req.file.size
      });

      res.status(201).json({
        success: true,
        message: 'Past prescription record uploaded successfully',
        record: newRecord
      });
    } catch (error) {
      console.error('Upload external record error:', error);
      res.status(500).json({ message: 'Server error uploading record: ' + (error.message || '') });
    }
  });
});

/**
 * @route   GET /api/prescriptions/external
 * @desc    Get external prescriptions for patient or doctor
 * @access  Private
 */
router.get('/external', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    let targetPatientId = userId;

    if (role === 'doctor' && req.query.patientId) {
      targetPatientId = req.query.patientId;
    }

    const records = await findExternalPrescriptionsByPatientId(targetPatientId);
    res.json(records);
  } catch (error) {
    console.error('Get external prescriptions error:', error);
    res.status(500).json({ message: 'Server error fetching external records' });
  }
});

/**
 * @route   GET /api/prescriptions/external/patient/:patientId
 * @desc    Get external records for specific patient (for doctor viewing patient history)
 * @access  Private (Doctor or Patient)
 */
router.get('/external/patient/:patientId', auth, async (req, res) => {
  try {
    const records = await findExternalPrescriptionsByPatientId(req.params.patientId);
    res.json(records);
  } catch (error) {
    console.error('Get patient external records error:', error);
    res.status(500).json({ message: 'Server error fetching records' });
  }
});

/**
 * @route   DELETE /api/prescriptions/external/:id
 * @desc    Delete external prescription record
 * @access  Private
 */
router.delete('/external/:id', auth, async (req, res) => {
  try {
    const record = await findExternalPrescriptionById(req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Record not found' });
    }

    if (record.uploadedBy !== req.user.id && record.patientId !== req.user.id && req.user.role !== 'doctor') {
      return res.status(403).json({ message: 'Not authorized to delete this record' });
    }

    await deleteExternalPrescription(req.params.id);
    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    console.error('Delete external record error:', error);
    res.status(500).json({ message: 'Server error deleting record' });
  }
});

/**
 * @route   POST /api/prescriptions/:id/test-reports
 * @desc    Upload diagnostic / lab test report for a prescription (Patient or Doctor)
 * @access  Private
 */
router.post('/:id/test-reports', auth, async (req, res) => {
  uploadTestReport.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size exceeds the 10 MB limit.' });
      }
      return res.status(400).json({ message: err.message || 'Error uploading test report' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No test report file selected' });
    }

    try {
      const prescriptionId = req.params.id;
      const userId = req.user.id;
      const role = req.user.role;

      const prescription = await findPrescriptionById(prescriptionId);
      if (!prescription) {
        return res.status(404).json({ message: 'Prescription not found' });
      }

      // Check access permission (patient of prescription, doctor of prescription, or admin)
      if (
        role === 'patient' && prescription.patientId !== userId &&
        prescription.patientEmail?.toLowerCase() !== req.user.email?.toLowerCase()
      ) {
        return res.status(403).json({ message: 'Access denied: You can only upload test reports for your own prescriptions' });
      }

      const filename = req.file.filename;
      const fileUrl = `/uploads/records/${filename}`;
      const isPdf = req.file.mimetype === 'application/pdf';

      // Sync to D1 images table if available
      try {
        const { createImage } = require('../models/ImageModel');
        const fileData = fs.readFileSync(req.file.path);
        await createImage({
          filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          data: fileData,
          size: req.file.size,
          imageType: 'prescription_test_report',
          uploadedBy: userId
        });
      } catch (imgErr) {
        console.log('[Prescriptions] D1 Test Report Image sync notice:', imgErr.message);
      }

      const rawPatientName = (
        prescription.patientName || 
        req.user.firstName || 
        req.user.name || 
        'PATIENT'
      ).replace(/[^a-zA-Z0-9]/g, '');
      const patient4 = (rawPatientName.substring(0, 4) || 'PATI').toUpperCase();
      const uploadDateStr = new Date().toISOString().split('T')[0]; // e.g. 2026-08-15
      const ext = path.extname(req.file.originalname) || (isPdf ? '.pdf' : '.png');
      const cleanTest = (req.body.testName || 'REPORT').replace(/[^a-zA-Z0-9]/g, '');
      const standardizedName = `${patient4}_${uploadDateStr}_${cleanTest}${ext}`;

      const newReport = {
        id: reportId,
        testName: req.body.testName || 'Diagnostic Test Report',
        filename,
        originalName: standardizedName,
        userOriginalName: req.file.originalname,
        fileUrl,
        fileType: isPdf ? 'pdf' : 'image',
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: userId,
        uploadedByName: uploaderName,
        uploaderRole: role,
        uploadedAt: new Date().toISOString(),
        notes: req.body.notes || ''
      };

      const existingReports = Array.isArray(prescription.testReports) 
        ? [...prescription.testReports] 
        : [];
      
      existingReports.push(newReport);

      const updatedPrescription = await updatePrescription(prescriptionId, {
        testReports: existingReports
      });

      console.log('✅ Test report successfully attached to prescription:', prescriptionId, 'Report ID:', reportId);

      res.status(201).json({
        success: true,
        message: 'Test report uploaded successfully',
        report: newReport,
        testReports: existingReports,
        prescription: updatedPrescription
      });
    } catch (error) {
      console.error('Upload test report error:', error);
      res.status(500).json({ message: 'Server error uploading test report: ' + (error.message || '') });
    }
  });
});

/**
 * @route   DELETE /api/prescriptions/:id/test-reports/:reportId
 * @desc    Delete an uploaded test report from a prescription
 * @access  Private (Patient or Doctor)
 */
router.delete('/:id/test-reports/:reportId', auth, async (req, res) => {
  try {
    const { id: prescriptionId, reportId } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const prescription = await findPrescriptionById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    // Access check
    if (
      role === 'patient' && prescription.patientId !== userId &&
      prescription.patientEmail?.toLowerCase() !== req.user.email?.toLowerCase()
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const existingReports = Array.isArray(prescription.testReports) ? prescription.testReports : [];
    const reportToDelete = existingReports.find(r => r.id === reportId);
    
    if (!reportToDelete) {
      return res.status(404).json({ message: 'Test report not found' });
    }

    // Remove from file system if exists
    if (reportToDelete.filename) {
      const filePath = path.join(recordsDir, reportToDelete.filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      try {
        const { deleteByFilename } = require('../models/ImageModel');
        await deleteByFilename(reportToDelete.filename);
      } catch (e) {}
    }

    const updatedReports = existingReports.filter(r => r.id !== reportId);
    const updatedPrescription = await updatePrescription(prescriptionId, {
      testReports: updatedReports
    });

    console.log('✅ Test report removed from prescription:', prescriptionId, 'Report ID:', reportId);

    res.json({
      success: true,
      message: 'Test report deleted successfully',
      testReports: updatedReports,
      prescription: updatedPrescription
    });
  } catch (error) {
    console.error('Delete test report error:', error);
    res.status(500).json({ message: 'Server error deleting test report' });
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
    
    if (role === 'doctor' && prescription.doctorId !== userId) {
      const doctorUser = await findUserById(userId);
      const isLinked = Array.isArray(doctorUser?.linkedPatients) && doctorUser.linkedPatients.includes(prescription.patientId);
      if (!isLinked) {
        return res.status(403).json({ message: 'Access denied. Patient birth year verification required.', requiresBirthYearVerification: true });
      }
    } else if (role === 'patient') {
      const prescPatientId = prescription.patientId?.toString();
      const currentUserId = userId?.toString();
      if (prescPatientId && currentUserId && prescPatientId !== currentUserId) {
        const resolvedPatient = await resolvePatient(prescription.patientId);
        if (!resolvedPatient || (resolvedPatient.accountId !== currentUserId && resolvedPatient.email?.toLowerCase() !== req.user.email?.toLowerCase())) {
          return res.status(403).json({ message: 'Access denied' });
        }
      }
    }

    let patient = null;
    if (prescription.patientId) {
      patient = await resolvePatient(prescription.patientId);
    }

    const enhanced = {
      ...prescription,
      patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || prescription.patientName : prescription.patientName,
      patientDOB: patient?.dateOfBirth || prescription.patientDOB,
      patientGender: patient?.gender || prescription.patientGender,
    };
    
    res.json(enhanced);
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/prescriptions/lookup/:code
 * @desc    Lookup prescription by QR code, URL, or prescription ID
 * @access  Public
 */
router.get('/lookup/:code', async (req, res) => {
  try {
    const rawCode = req.params.code || '';
    const prescription = await findPrescriptionById(rawCode);

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    let patient = null;
    let doctorUser = null;
    if (prescription.patientId) {
      patient = await resolvePatient(prescription.patientId);
    }
    if (prescription.doctorId) {
      doctorUser = await findUserById(prescription.doctorId);
    }

    const enhanced = {
      ...prescription,
      patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : (prescription.patientName || 'Patient'),
      patientDOB: patient ? patient.dateOfBirth : prescription.patientDOB,
      patientGender: patient ? patient.gender : prescription.patientGender,
      doctorName: doctorUser ? `Dr. ${doctorUser.firstName || ''} ${doctorUser.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
      doctorSpecialization: doctorUser ? doctorUser.specialization : (prescription.doctorSpecialization || 'General Physician'),
      doctorLicenseNumber: doctorUser ? doctorUser.licenseNumber : prescription.doctorLicenseNumber,
      doctorClinicName: doctorUser ? doctorUser.clinicName : prescription.doctorClinicName,
      doctorStamp: doctorUser ? doctorUser.stamp : prescription.doctorStamp,
      doctorSignature: doctorUser ? doctorUser.signature : prescription.doctorSignature,
    };

    res.json({ success: true, prescription: enhanced });
  } catch (error) {
    console.error('Lookup prescription error:', error);
    res.status(500).json({ success: false, message: 'Server error looking up prescription' });
  }
});

/**
 * @route   GET /api/prescriptions/public/:id
 * @desc    Get prescription by ID (Public shared view - no authentication required)
 * @access  Public
 */
router.get(['/public/:id', '/verify-rx/:id'], publicLookupLimiter, async (req, res) => {
  try {
    let prescriptionId = req.params.id || '';
    let prescription = await findPrescriptionById(prescriptionId);

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    let patient = null;
    let doctorUser = null;
    if (prescription.patientId) {
      patient = await resolvePatient(prescription.patientId);
    }
    if (prescription.doctorId) {
      doctorUser = await findUserById(prescription.doctorId);
    }

    const rawPatientName = patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : (prescription.patientName || 'Patient');
    const rawPatientEmail = patient ? (patient.email || 'N/A') : (prescription.patientEmail || 'N/A');

    const enhanced = {
      ...prescription,
      patientName: maskPatientName(rawPatientName),
      patientEmail: maskEmail(rawPatientEmail),
      patientDOB: prescription.patientDOB ? '****-**-**' : '',
      patientGender: patient ? patient.gender : prescription.patientGender,
      doctorName: doctorUser ? `Dr. ${doctorUser.firstName || ''} ${doctorUser.lastName || ''}`.trim() : (prescription.doctorName || 'Doctor'),
      doctorSpecialization: doctorUser ? doctorUser.specialization : (prescription.doctorSpecialization || 'General Physician'),
      doctorLicenseNumber: doctorUser ? doctorUser.licenseNumber : prescription.doctorLicenseNumber,
      doctorClinicName: doctorUser ? doctorUser.clinicName : prescription.doctorClinicName,
      doctorStamp: doctorUser ? doctorUser.stamp : prescription.doctorStamp,
      doctorSignature: doctorUser ? doctorUser.signature : prescription.doctorSignature,
      requiresBirthYearVerification: true
    };
    
    res.json(enhanced);
  } catch (error) {
    console.error('Get public prescription error:', error);
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
      familyProfileId,
      accountId: reqAccountId,
      patientDisplayId: reqDisplayId,
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

    // Resolve family profile if provided — use profile data for patient info on the prescription
    let profilePatientName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
    let profileAge = '';
    let profileDOB = patient.dateOfBirth || patient.dob || req.body.patientDOB || '';
    let profileGender = patient.gender || req.body.patientGender || '';
    let profileDisplayId = reqDisplayId || '';
    let resolvedAccountId = reqAccountId || patient.id;
    let resolvedPatientId = patient.id;

    if (familyProfileId) {
      try {
        const profile = await getFamilyProfileById(familyProfileId);
        if (profile && profile.accountId === patient.id) {
          profilePatientName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          profileGender = profile.gender || profileGender;
          profileDisplayId = profile.patientDisplayId || '';
          profileDOB = profile.dateOfBirth || profileDOB;
          resolvedAccountId = profile.accountId;
          // Use profile id as the patientId for unique identification
          resolvedPatientId = profile.id;
          console.log('Using family profile for prescription:', profile.patientDisplayId, profilePatientName);
        }
      } catch (profileErr) {
        console.error('Failed to resolve family profile, using account data:', profileErr.message);
      }
    }

    // Calculate age from DOB if available
    if (profileDOB) {
      const dobTime = new Date(profileDOB).getTime();
      if (!isNaN(dobTime)) {
        const years = Math.floor((Date.now() - dobTime) / (365.25 * 86400000));
        if (years >= 0 && years < 150) {
          profileAge = String(years);
        }
      }
    }
    if (!profileAge && req.body.patientAge) {
      profileAge = String(req.body.patientAge);
    }
    if (!profileAge && patient.age) {
      profileAge = String(patient.age);
    }
    
    // Parse custom issued date if provided by doctor
    const customDate = req.body.createdAt || req.body.issuedDate || req.body.prescriptionDate;
    let customCreatedAt = undefined;
    if (customDate && !isNaN(new Date(customDate).getTime())) {
      customCreatedAt = new Date(customDate).toISOString();
    }
    
    // Create prescription with comprehensive data
    const prescriptionPayload = {
      doctorId,
      patientId: resolvedPatientId,
      patientName: profilePatientName,
      patientEmail: patient.email,
      patientAge: profileAge,
      patientDOB: profileDOB,
      patientGender: profileGender,
      accountId: resolvedAccountId,
      patientDisplayId: profileDisplayId,
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
    };
    
    if (customCreatedAt) {
      prescriptionPayload.createdAt = customCreatedAt;
    }

    const prescription = await createPrescription(prescriptionPayload);
    
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
      testReports,
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
    if (testReports !== undefined) updateData.testReports = testReports;
    if (status !== undefined) updateData.status = status;
    
    // Allow updating prescription issued date (createdAt)
    const dateToUpdate = req.body.createdAt || req.body.issuedDate || req.body.prescriptionDate;
    if (dateToUpdate !== undefined) {
      if (dateToUpdate && !isNaN(new Date(dateToUpdate).getTime())) {
        updateData.createdAt = new Date(dateToUpdate).toISOString();
      }
    }
    
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
 * @route   GET /api/prescriptions/public/:id/download
 * @desc    Download prescription PDF (Public shared view - no authentication required)
 * @access  Public
 */
router.get(['/public/:id/download', '/public/:id/pdf'], async (req, res) => {
  try {
    const prescriptionId = req.params.id;
    const prescription = await findPrescriptionById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    let patient = await resolvePatient(prescription.patientId);
    let doctorUser = await findUserById(prescription.doctorId);
    
    if (patient) {
      if (!patient.dateOfBirth && prescription.patientDOB) patient.dateOfBirth = prescription.patientDOB;
      if (!patient.age && prescription.patientAge) patient.age = prescription.patientAge;
      if (patient.gender) {
        prescription.patientGender = patient.gender;
      } else if (prescription.patientGender) {
        patient.gender = prescription.patientGender;
      }
      if (prescription.patientName && !patient.firstName) {
        patient.firstName = prescription.patientName.split(' ')[0] || 'Patient';
        patient.lastName = prescription.patientName.split(' ').slice(1).join(' ') || '';
      }
    } else {
      patient = {
        id: prescription.patientId || 'patient-id',
        firstName: prescription.patientName ? prescription.patientName.split(' ')[0] : 'Patient',
        lastName: prescription.patientName ? prescription.patientName.split(' ').slice(1).join(' ') : '',
        email: prescription.patientEmail || '',
        dateOfBirth: prescription.patientDOB || '',
        age: prescription.patientAge || '',
        gender: prescription.patientGender || '',
        phone: prescription.patientPhone || prescription.contactNumber || ''
      };
    }
    
    if (!doctorUser) {
      doctorUser = {
        id: prescription.doctorId || 'doctor-id',
        firstName: prescription.doctorName ? prescription.doctorName.split(' ')[0] : 'Doctor',
        lastName: prescription.doctorName ? prescription.doctorName.split(' ').slice(1).join(' ') : '',
        specialization: prescription.doctorSpecialization || 'General Practitioner',
        licenseNumber: prescription.doctorLicenseNumber || '',
        stamp: prescription.doctorStamp || '',
        signature: prescription.doctorSignature || ''
      };
    }
    
    const { generatePrescriptionPDF } = require('../services/pdfGenerator');
    await generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctorUser);

  } catch (error) {
    console.error('Public PDF download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Server error generating PDF', error: error.message, stack: error.stack });
    }
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
    let patient = await resolvePatient(prescription.patientId);
    let doctorUser = await findUserById(prescription.doctorId);
    
    if (patient) {
      if (!patient.dateOfBirth && prescription.patientDOB) patient.dateOfBirth = prescription.patientDOB;
      if (!patient.age && prescription.patientAge) patient.age = prescription.patientAge;
      if (patient.gender) {
        prescription.patientGender = patient.gender;
      } else if (prescription.patientGender) {
        patient.gender = prescription.patientGender;
      }
      if (prescription.patientName && !patient.firstName) {
        patient.firstName = prescription.patientName.split(' ')[0] || 'Patient';
        patient.lastName = prescription.patientName.split(' ').slice(1).join(' ') || '';
      }
    } else {
      patient = {
        id: prescPatientId || 'patient-id',
        firstName: prescription.patientName ? prescription.patientName.split(' ')[0] : 'Patient',
        lastName: prescription.patientName ? prescription.patientName.split(' ').slice(1).join(' ') : '',
        email: prescription.patientEmail || '',
        dateOfBirth: prescription.patientDOB || '',
        age: prescription.patientAge || '',
        gender: prescription.patientGender || '',
        phone: prescription.patientPhone || prescription.contactNumber || '',
        address: prescription.patientAddress || '',
        city: prescription.patientCity || '',
        state: prescription.patientState || ''
      };
    }
    
    if (!doctorUser) {
      doctorUser = {
        id: prescDoctorId || 'doctor-id',
        firstName: prescription.doctorName ? prescription.doctorName.split(' ')[0] : 'Doctor',
        lastName: prescription.doctorName ? prescription.doctorName.split(' ').slice(1).join(' ') : '',
        specialization: prescription.doctorSpecialization || 'General Physician',
        licenseNumber: prescription.doctorLicenseNumber || '',
        address: prescription.doctorAddress || prescription.clinicAddress || '',
        phone: prescription.doctorPhone || prescription.contactNumber || '',
        clinicName: prescription.clinicName || '',
        clinicLogo: prescription.clinicLogo || '',
        signature: prescription.doctorSignature || '',
        stamp: prescription.doctorStamp || ''
      };
    } else {
      if (!doctorUser.address && prescription.doctorAddress) doctorUser.address = prescription.doctorAddress;
      if (!doctorUser.signature && prescription.doctorSignature) doctorUser.signature = prescription.doctorSignature;
      if (!doctorUser.stamp && prescription.doctorStamp) doctorUser.stamp = prescription.doctorStamp;
      if (!doctorUser.clinicLogo && prescription.clinicLogo) doctorUser.clinicLogo = prescription.clinicLogo;
      if (!doctorUser.clinicName && prescription.clinicName) doctorUser.clinicName = prescription.clinicName;
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
    const { dispenseNotes, itemsDispensed, medStatuses } = req.body;

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

    let history = [];
    if (Array.isArray(prescription.dispenseHistory)) {
      history = [...prescription.dispenseHistory];
    } else if (typeof prescription.dispenseHistory === 'string') {
      try {
        history = JSON.parse(prescription.dispenseHistory);
      } catch (e) {}
    }

    // Migrate any legacy single dispense record if history was empty
    if (history.length === 0 && prescription.dispensedAt) {
      history.push({
        dispenseIndex: 1,
        dispensedAt: prescription.dispensedAt,
        dispenseNotes: prescription.dispenseNotes || 'Prescription items dispensed',
        itemsDispensed: Array.isArray(prescription.medications) ? prescription.medications.map(m => ({ name: m.name, status: 'given' })) : [],
        dispensedStatus: prescription.dispensedStatus || 'dispensed'
      });
    }

    const now = new Date().toISOString();
    const items = Array.isArray(itemsDispensed) 
      ? itemsDispensed 
      : (Array.isArray(medStatuses) 
          ? medStatuses.map(ms => ({ 
              name: ms.medicineName || ms.name, 
              status: ms.status,
              quantity: ms.quantity || (ms.dispensedQuantity !== undefined ? `${ms.dispensedQuantity} ${ms.unit || 'Tablets'}` : undefined),
              dispensedQuantity: ms.dispensedQuantity !== undefined ? Number(ms.dispensedQuantity) : undefined,
              prescribedQuantity: ms.prescribedQuantity !== undefined ? Number(ms.prescribedQuantity) : undefined,
              unit: ms.unit || 'Tablets',
              isFull: ms.isFull !== undefined ? ms.isFull : (ms.status === 'given')
            })) 
          : (prescription.medications ? prescription.medications.map(m => ({ name: m.name, status: 'given', quantity: m.quantity })) : []));

    const newHistoryEvent = {
      dispenseIndex: history.length + 1,
      dispensedAt: now,
      dispenseNotes: dispenseNotes || 'All prescribed items verified and dispensed.',
      itemsDispensed: items,
      dispensedStatus: 'dispensed'
    };

    history.unshift(newHistoryEvent); // newest first

    const dispenseData = {
      dispensedStatus: 'dispensed',
      dispensedAt: now,
      dispensedBy: {
        pharmacistId: req.user?.id || 'staff-pharm',
        pharmacistName: pharmacist ? `${pharmacist.firstName || ''} ${pharmacist.lastName || ''}`.trim() : (req.user?.name || 'Staff Pharmacist'),
        pharmacyName: pharmacist?.pharmacyName || 'Medizo Care Pharmacy',
        licenseNumber: pharmacist?.licenseNumber || 'PHARM-88219',
        itemsDispensed: items
      },
      dispenseNotes: dispenseNotes || 'All prescribed items verified and dispensed.',
      dispenseHistory: history,
      dispenseCount: history.length
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

/* External prescription routes moved above /:id route to prevent Express param-matching conflicts */

module.exports = router;