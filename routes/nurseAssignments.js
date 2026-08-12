const express = require('express');
const router = express.Router();
const { auth, doctor, nurse, doctorOrAdmin, nurseOrDoctorOrAdmin } = require('../middleware/auth');
const {
  assignNurseToPatient,
  findNursePatientAssignmentById,
  getPatientAssignedNurses,
  getNurseAssignedPatients,
  updateNursePatientAssignmentStatus,
  createNurseDoctorAffiliation,
  getDoctorAffiliatedNurses,
  getNurseDoctorAffiliations
} = require('../models/assignmentModel');
const { findUserById } = require('../models/user');

/**
 * @route   POST /api/nurse-assignments
 * @desc    Assign a nurse to a patient for a specific task / condition
 * @access  Private (Doctor or Admin)
 */
router.post('/', doctorOrAdmin, async (req, res) => {
  try {
    const { nurseId, patientId, familyProfileId, assignmentType, diseaseCondition, startDate, endDate, frequency, specialInstructions } = req.body;

    if (!nurseId || !patientId || !startDate) {
      return res.status(400).json({ success: false, message: 'nurseId, patientId, and startDate are required' });
    }

    const nurseUser = await findUserById(nurseId);
    if (!nurseUser || nurseUser.role !== 'nurse') {
      return res.status(404).json({ success: false, message: 'Nurse not found' });
    }

    const patientUser = await findUserById(patientId);
    if (!patientUser || patientUser.role !== 'patient') {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    const assignment = await assignNurseToPatient({
      nurseId,
      patientId,
      familyProfileId: familyProfileId || '',
      assignedByDoctorId: req.user.id,
      assignmentType: assignmentType || 'general_care',
      diseaseCondition: diseaseCondition || '',
      startDate,
      endDate: endDate || null,
      frequency: frequency || 'daily',
      specialInstructions: specialInstructions || '',
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: `Nurse ${nurseUser.firstName} ${nurseUser.lastName} assigned to patient ${patientUser.firstName} ${patientUser.lastName}`,
      assignment
    });
  } catch (error) {
    console.error('Create nurse assignment error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to assign nurse' });
  }
});

/**
 * @route   GET /api/nurse-assignments/patient/:patientId
 * @desc    Get all nurses assigned to a patient
 * @access  Private
 */
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const assignments = await getPatientAssignedNurses(patientId);

    res.json({
      success: true,
      count: assignments.length,
      assignments
    });
  } catch (error) {
    console.error('Get patient assigned nurses error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve patient assignments' });
  }
});

/**
 * @route   GET /api/nurse-assignments/my-patients
 * @desc    Get all patients assigned to the logged-in nurse
 * @access  Private (Nurse only)
 */
router.get('/my-patients', nurse, async (req, res) => {
  try {
    const nurseId = req.user.id;
    const assignments = await getNurseAssignedPatients(nurseId);

    res.json({
      success: true,
      count: assignments.length,
      assignments
    });
  } catch (error) {
    console.error('Get nurse assigned patients error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve assigned patients' });
  }
});

/**
 * @route   GET /api/nurse-assignments/nurse/:nurseId
 * @desc    Get assignments for a specific nurse
 * @access  Private (Doctor or Admin)
 */
router.get('/nurse/:nurseId', doctorOrAdmin, async (req, res) => {
  try {
    const { nurseId } = req.params;
    const assignments = await getNurseAssignedPatients(nurseId);

    res.json({
      success: true,
      count: assignments.length,
      assignments
    });
  } catch (error) {
    console.error('Get nurse assignments error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve nurse assignments' });
  }
});

/**
 * @route   PUT /api/nurse-assignments/:id/status
 * @desc    Update assignment status (active, paused, completed, terminated)
 * @access  Private (Doctor or Admin)
 */
router.put('/:id/status', doctorOrAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await updateNursePatientAssignmentStatus(req.params.id, status);

    res.json({
      success: true,
      message: `Assignment status updated to "${status}"`,
      assignment: updated
    });
  } catch (error) {
    console.error('Update assignment status error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update assignment' });
  }
});

/**
 * @route   GET /api/nurse-assignments/affiliations/my-nurses
 * @desc    Get nurses affiliated with the logged-in doctor
 * @access  Private (Doctor only)
 */
router.get('/affiliations/my-nurses', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const nurses = await getDoctorAffiliatedNurses(doctorId);

    res.json({
      success: true,
      count: nurses.length,
      nurses
    });
  } catch (error) {
    console.error('Get affiliated nurses error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve affiliated nurses' });
  }
});

/**
 * @route   POST /api/nurse-assignments/affiliations
 * @desc    Affiliate a nurse with a doctor / clinic
 * @access  Private (Doctor or Admin)
 */
router.post('/affiliations', doctorOrAdmin, async (req, res) => {
  try {
    const { nurseId, doctorId, affiliationType, notes } = req.body;
    const targetDoctorId = doctorId || req.user.id;

    if (!nurseId) {
      return res.status(400).json({ success: false, message: 'nurseId is required' });
    }

    const affiliation = await createNurseDoctorAffiliation(nurseId, targetDoctorId, affiliationType, notes);

    res.status(201).json({
      success: true,
      message: 'Nurse affiliated successfully',
      affiliation
    });
  } catch (error) {
    console.error('Create affiliation error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create affiliation' });
  }
});

module.exports = router;
