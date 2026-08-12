const express = require('express');
const router = express.Router();
const { auth, nurse, nurseOrDoctorOrAdmin, doctorOrAdmin } = require('../middleware/auth');
const { scheduleVisit, transitionVisitStatus } = require('../services/schedulingService');
const {
  findScheduleById,
  getNurseSchedules,
  getPatientSchedules,
  updateSchedule
} = require('../models/scheduleModel');

/**
 * @route   POST /api/nurse-schedules
 * @desc    Schedule a nurse care visit with conflict collision validation
 * @access  Private (Nurse, Doctor, Admin)
 */
router.post('/', nurseOrDoctorOrAdmin, async (req, res) => {
  try {
    const {
      nurseId,
      patientId,
      familyProfileId,
      assignmentId,
      homeCareRequestId,
      startDatetime,
      endDatetime,
      serviceType,
      locationAddress,
      notes
    } = req.body;

    const targetNurseId = nurseId || req.user.id;

    const schedule = await scheduleVisit({
      nurseId: targetNurseId,
      patientId,
      familyProfileId: familyProfileId || '',
      assignmentId: assignmentId || '',
      homeCareRequestId: homeCareRequestId || '',
      startDatetime,
      endDatetime,
      serviceType: serviceType || 'Care Visit',
      locationAddress: locationAddress || '',
      notes: notes || ''
    }, req.user);

    res.status(201).json({
      success: true,
      message: 'Visit scheduled successfully',
      schedule
    });
  } catch (error) {
    console.error('Schedule visit error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to schedule visit' });
  }
});

/**
 * @route   GET /api/nurse-schedules/my-schedule
 * @desc    Get schedules for logged-in nurse
 * @access  Private (Nurse only)
 */
router.get('/my-schedule', nurse, async (req, res) => {
  try {
    const nurseId = req.user.id;
    const { startDate, endDate } = req.query;

    const schedules = await getNurseSchedules(nurseId, startDate, endDate);

    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    console.error('Get my schedules error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve schedules' });
  }
});

/**
 * @route   GET /api/nurse-schedules/nurse/:nurseId
 * @desc    Get schedules for a specific nurse
 * @access  Private (Doctor or Admin)
 */
router.get('/nurse/:nurseId', doctorOrAdmin, async (req, res) => {
  try {
    const { nurseId } = req.params;
    const { startDate, endDate } = req.query;

    const schedules = await getNurseSchedules(nurseId, startDate, endDate);

    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    console.error('Get nurse schedules error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve schedules' });
  }
});

/**
 * @route   GET /api/nurse-schedules/patient/:patientId
 * @desc    Get schedules for a patient
 * @access  Private
 */
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const schedules = await getPatientSchedules(patientId);

    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    console.error('Get patient schedules error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve schedules' });
  }
});

/**
 * @route   GET /api/nurse-schedules/:id
 * @desc    Get schedule by ID
 * @access  Private
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const schedule = await findScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }

    res.json({ success: true, schedule });
  } catch (error) {
    console.error('Get schedule error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve schedule' });
  }
});

/**
 * @route   PUT /api/nurse-schedules/:id/status
 * @desc    Update visit progress status (e.g. en_route, in_progress, completed, missed, cancelled, rescheduled)
 * @access  Private (Nurse, Doctor, Admin)
 */
router.put('/:id/status', nurseOrDoctorOrAdmin, async (req, res) => {
  try {
    const { status, cancellationReason } = req.body;
    const updated = await transitionVisitStatus(req.params.id, status, cancellationReason, req.user);

    res.json({
      success: true,
      message: `Schedule status updated to "${status}"`,
      schedule: updated
    });
  } catch (error) {
    console.error('Update schedule status error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update schedule status' });
  }
});

/**
 * @route   PUT /api/nurse-schedules/:id
 * @desc    Update schedule details (reschedule slot or change address/notes) with conflict check
 * @access  Private (Nurse, Doctor, Admin)
 */
router.put('/:id', nurseOrDoctorOrAdmin, async (req, res) => {
  try {
    const updated = await updateSchedule(req.params.id, req.body);

    res.json({
      success: true,
      message: 'Schedule updated successfully',
      schedule: updated
    });
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update schedule' });
  }
});

module.exports = router;
