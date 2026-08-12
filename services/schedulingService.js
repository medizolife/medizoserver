const { findConflictingSchedules, createSchedule, updateScheduleStatus, findScheduleById } = require('../models/scheduleModel');
const { findUserById } = require('../models/user');

/**
 * Validate scheduling rules and create a nurse schedule slot
 * @param {Object} scheduleData
 * @param {Object} currentUser
 * @returns {Promise<Object>}
 */
async function scheduleVisit(scheduleData, currentUser) {
  const { nurseId, patientId, startDatetime, endDatetime } = scheduleData;

  if (!nurseId || !patientId || !startDatetime || !endDatetime) {
    throw new Error('nurseId, patientId, startDatetime, and endDatetime are required');
  }

  // 1. Verify nurse exists and is active
  const nurse = await findUserById(nurseId);
  if (!nurse || nurse.role !== 'nurse') {
    throw new Error('Selected user is not a valid registered nurse');
  }
  if (nurse.status === 'deactivated') {
    throw new Error('Cannot assign schedules to a deactivated nurse');
  }

  // 2. Verify patient exists and is active
  const patient = await findUserById(patientId);
  if (!patient || patient.role !== 'patient') {
    throw new Error('Selected user is not a valid patient');
  }

  // 3. Time validation
  const startTime = new Date(startDatetime).getTime();
  const endTime = new Date(endDatetime).getTime();
  if (isNaN(startTime) || isNaN(endTime)) {
    throw new Error('Invalid startDatetime or endDatetime format. Expected valid ISO-8601 string.');
  }
  if (startTime >= endTime) {
    throw new Error('startDatetime must occur strictly before endDatetime');
  }

  const durationMinutes = (endTime - startTime) / (1000 * 60);
  if (durationMinutes < 15) {
    throw new Error('Minimum visit duration is 15 minutes');
  }
  if (durationMinutes > 480) {
    throw new Error('Single visit cannot exceed 8 hours');
  }

  // 4. Collision check
  const conflicts = await findConflictingSchedules(nurseId, startDatetime, endDatetime);
  if (conflicts.length > 0) {
    const c = conflicts[0];
    throw new Error(`Schedule conflict: Nurse ${nurse.firstName} ${nurse.lastName} already has a "${c.serviceType}" visit booked from ${new Date(c.startDatetime).toLocaleTimeString()} to ${new Date(c.endDatetime).toLocaleTimeString()}`);
  }

  // 5. Create schedule record
  return await createSchedule({
    ...scheduleData,
    locationAddress: scheduleData.locationAddress || patient.address || 'Patient Home Address',
    serviceType: scheduleData.serviceType || 'General Care Visit',
    status: 'scheduled'
  });
}

/**
 * Perform allowed status transitions for a visit
 * @param {string} scheduleId
 * @param {string} newStatus
 * @param {string} cancellationReason
 * @param {Object} currentUser
 * @returns {Promise<Object>}
 */
async function transitionVisitStatus(scheduleId, newStatus, cancellationReason = '', currentUser) {
  const schedule = await findScheduleById(scheduleId);
  if (!schedule) {
    throw new Error('Schedule not found');
  }

  // Allowed transitions map
  const allowedTransitions = {
    scheduled: ['en_route', 'in_progress', 'cancelled', 'rescheduled', 'missed'],
    en_route: ['in_progress', 'cancelled', 'missed'],
    in_progress: ['completed', 'cancelled'],
    completed: [], // Terminal
    cancelled: [], // Terminal
    missed: ['rescheduled', 'scheduled'],
    rescheduled: ['scheduled']
  };

  const allowedNext = allowedTransitions[schedule.status] || [];
  if (!allowedNext.includes(newStatus) && currentUser.role !== 'admin') {
    throw new Error(`Invalid status transition from "${schedule.status}" to "${newStatus}".`);
  }

  return await updateScheduleStatus(scheduleId, newStatus, cancellationReason);
}

module.exports = {
  scheduleVisit,
  transitionVisitStatus
};
