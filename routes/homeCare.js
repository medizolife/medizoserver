const express = require('express');
const router = express.Router();
const { auth, doctorOrAdmin, nurseOrDoctorOrAdmin, nurse } = require('../middleware/auth');
const {
  createHomeCareRequest,
  findHomeCareRequestById,
  getHomeCareRequestsByPatient,
  getHomeCareRequestsByDoctor,
  getHomeCareRequestsByNurse,
  getAllHomeCareRequests,
  assignNurseToRequest,
  updateHomeCareRequestStatus,
  createVisitRecord,
  getVisitRecordsByPatient,
  getVisitRecordsByNurse
} = require('../models/homeCareModel');
const { canAccessHomeCareRequest, canAccessPatientData } = require('../services/authzService');
const { findUserById } = require('../models/user');

/**
 * @route   POST /api/home-care/request
 * @desc    Request a home care visit (by patient for self, or by doctor for patient)
 * @access  Private (Patient, Doctor, Admin)
 */
router.post('/request', auth, async (req, res) => {
  try {
    const user = req.user;
    const { patientId, familyProfileId, advisedByDoctorId, serviceType, urgency, preferredDate, preferredTimeSlot, address, contactPhone, clinicalInstructions } = req.body;

    const targetPatientId = (user.role === 'patient') ? user.id : (patientId || user.id);

    if (!address || !contactPhone) {
      return res.status(400).json({ success: false, message: 'address and contactPhone are required' });
    }

    const request = await createHomeCareRequest({
      patientId: targetPatientId,
      familyProfileId: familyProfileId || '',
      requestedByRole: user.role === 'doctor' ? 'doctor' : 'patient',
      requestedById: user.id,
      advisedByDoctorId: user.role === 'doctor' ? user.id : (advisedByDoctorId || ''),
      serviceType: serviceType || 'general_checkup',
      urgency: urgency || 'routine',
      preferredDate: preferredDate || '',
      preferredTimeSlot: preferredTimeSlot || 'morning',
      address,
      contactPhone,
      clinicalInstructions: clinicalInstructions || '',
      status: 'requested'
    });

    res.status(201).json({
      success: true,
      message: `Home care request ${request.requestNumber} submitted successfully`,
      request
    });
  } catch (error) {
    console.error('Create home care request error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to submit home care request' });
  }
});

/**
 * @route   GET /api/home-care/requests
 * @desc    Get home care requests scoped by role
 * @access  Private
 */
router.get('/requests', auth, async (req, res) => {
  try {
    const user = req.user;
    let requests = [];

    if (user.role === 'admin' || user.email === 'admin@medizo.life') {
      requests = await getAllHomeCareRequests();
    } else if (user.role === 'doctor') {
      requests = await getHomeCareRequestsByDoctor(user.id);
    } else if (user.role === 'nurse') {
      requests = await getHomeCareRequestsByNurse(user.id);
    } else if (user.role === 'patient') {
      requests = await getHomeCareRequestsByPatient(user.id);
    }

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get home care requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve home care requests' });
  }
});

/**
 * @route   GET /api/home-care/requests/:id
 * @desc    Get home care request details by ID
 * @access  Private
 */
router.get('/requests/:id', auth, async (req, res) => {
  try {
    const request = await findHomeCareRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Home care request not found' });
    }

    if (!canAccessHomeCareRequest(req.user, request)) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to view this request' });
    }

    res.json({ success: true, request });
  } catch (error) {
    console.error('Get request details error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve request' });
  }
});

/**
 * @route   PUT /api/home-care/requests/:id/assign
 * @desc    Assign a nurse to home care request
 * @access  Private (Doctor or Admin)
 */
router.put('/requests/:id/assign', doctorOrAdmin, async (req, res) => {
  try {
    const { nurseId } = req.body;
    if (!nurseId) {
      return res.status(400).json({ success: false, message: 'nurseId is required' });
    }

    const nurseUser = await findUserById(nurseId);
    if (!nurseUser || nurseUser.role !== 'nurse') {
      return res.status(404).json({ success: false, message: 'Nurse not found' });
    }

    const updated = await assignNurseToRequest(req.params.id, nurseId);

    res.json({
      success: true,
      message: `Nurse ${nurseUser.firstName} ${nurseUser.lastName} assigned to request`,
      request: updated
    });
  } catch (error) {
    console.error('Assign nurse error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to assign nurse' });
  }
});

/**
 * @route   PUT /api/home-care/requests/:id/status
 * @desc    Update home care request status (e.g. approved, in_progress, completed, cancelled)
 * @access  Private (Nurse, Doctor, Admin)
 */
router.put('/requests/:id/status', nurseOrDoctorOrAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await updateHomeCareRequestStatus(req.params.id, status);

    res.json({
      success: true,
      message: `Home care request status updated to "${status}"`,
      request: updated
    });
  } catch (error) {
    console.error('Update request status error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update request status' });
  }
});

/**
 * @route   POST /api/home-care/visit-records
 * @desc    Record clinical observations, vital signs & care notes from a visit
 * @access  Private (Nurse only)
 */
router.post('/visit-records', nurse, async (req, res) => {
  try {
    const nurseId = req.user.id;
    const {
      homeCareRequestId,
      scheduleId,
      assignmentId,
      patientId,
      familyProfileId,
      visitDate,
      vitals,
      symptomsObserved,
      proceduresPerformed,
      medicationsAdministered,
      careNotes,
      patientCondition,
      doctorFeedbackRequired,
      doctorFeedbackNotes,
      attachments
    } = req.body;

    if (!patientId || !careNotes) {
      return res.status(400).json({ success: false, message: 'patientId and careNotes are required' });
    }

    const record = await createVisitRecord({
      homeCareRequestId: homeCareRequestId || '',
      scheduleId: scheduleId || '',
      assignmentId: assignmentId || '',
      nurseId,
      patientId,
      familyProfileId: familyProfileId || '',
      visitDate: visitDate || new Date().toISOString(),
      vitals: vitals || {},
      symptomsObserved: symptomsObserved || [],
      proceduresPerformed: proceduresPerformed || [],
      medicationsAdministered: medicationsAdministered || [],
      careNotes,
      patientCondition: patientCondition || 'stable',
      doctorFeedbackRequired: Boolean(doctorFeedbackRequired),
      doctorFeedbackNotes: doctorFeedbackNotes || '',
      attachments: attachments || []
    });

    res.status(201).json({
      success: true,
      message: 'Visit record and patient care notes recorded successfully',
      record
    });
  } catch (error) {
    console.error('Record visit error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to record visit data' });
  }
});

/**
 * @route   GET /api/home-care/visit-records/patient/:patientId
 * @desc    Get clinical care visit notes and vitals history for a patient
 * @access  Private
 */
router.get('/visit-records/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;

    const authorized = await canAccessPatientData(req.user, patientId);
    if (!authorized) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to view this patient’s visit records' });
    }

    const records = await getVisitRecordsByPatient(patientId);

    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error('Get visit records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve visit records' });
  }
});

/**
 * @route   GET /api/home-care/visit-records/my-visits
 * @desc    Get all visit notes recorded by the logged-in nurse
 * @access  Private (Nurse only)
 */
router.get('/visit-records/my-visits', nurse, async (req, res) => {
  try {
    const nurseId = req.user.id;
    const records = await getVisitRecordsByNurse(nurseId);

    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error('Get my visit records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve visit records' });
  }
});

module.exports = router;
