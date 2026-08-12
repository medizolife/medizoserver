const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

/**
 * Check if a nurse has a conflicting schedule during the requested time window
 * Formula: (newStart < existingEnd) AND (newEnd > existingStart)
 * Only considers active non-cancelled, non-completed statuses ('scheduled', 'en_route', 'in_progress')
 * @param {string} nurseId
 * @param {string} startDatetime
 * @param {string} endDatetime
 * @param {string} excludeId - Optional schedule ID to ignore during updates
 * @returns {Promise<Array>} List of conflicting schedule records
 */
async function findConflictingSchedules(nurseId, startDatetime, endDatetime, excludeId = null) {
  try {
    let sql = `
      SELECT * FROM nurse_schedules
      WHERE nurseId = ?
      AND status IN ('scheduled', 'en_route', 'in_progress')
      AND startDatetime < ?
      AND endDatetime > ?
    `;
    const params = [nurseId, endDatetime, startDatetime];

    if (excludeId) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }

    const { results } = await queryD1(sql, params);
    return results || [];
  } catch (error) {
    console.error('scheduleModel.findConflictingSchedules error:', error);
    return [];
  }
}

/**
 * Create a new nurse schedule slot with collision check
 * @param {Object} scheduleData
 * @returns {Promise<Object>}
 */
async function createSchedule(scheduleData) {
  const { nurseId, patientId, startDatetime, endDatetime, serviceType, locationAddress } = scheduleData;

  if (!nurseId || !patientId || !startDatetime || !endDatetime || !serviceType || !locationAddress) {
    throw new Error('nurseId, patientId, startDatetime, endDatetime, serviceType, and locationAddress are required');
  }

  // Validate start < end
  const start = new Date(startDatetime).getTime();
  const end = new Date(endDatetime).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) {
    throw new Error('startDatetime must be a valid date occurring strictly before endDatetime');
  }

  // Check for scheduling collision / double-booking
  const conflicts = await findConflictingSchedules(nurseId, startDatetime, endDatetime);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    throw new Error(`Schedule conflict: Nurse already has visit "${conflict.serviceType}" booked from ${conflict.startDatetime} to ${conflict.endDatetime}`);
  }

  const id = scheduleData.id || crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO nurse_schedules (
      id, nurseId, patientId, familyProfileId, patientDisplayId,
      assignmentId, homeCareRequestId, startDatetime, endDatetime,
      serviceType, locationAddress, status, notes, cancellationReason,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `;

  const params = [
    id,
    nurseId,
    patientId,
    scheduleData.familyProfileId || '',
    scheduleData.patientDisplayId || '',
    scheduleData.assignmentId || '',
    scheduleData.homeCareRequestId || '',
    startDatetime,
    endDatetime,
    serviceType,
    locationAddress,
    scheduleData.status || 'scheduled',
    scheduleData.notes || '',
    scheduleData.cancellationReason || '',
    now,
    now
  ];

  try {
    const { results } = await queryD1(sql, params);
    return results && results.length > 0 ? results[0] : { id, ...scheduleData, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('scheduleModel.createSchedule error:', error);
    throw error;
  }
}

/**
 * Find schedule by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findScheduleById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1(
      `SELECT s.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone
       FROM nurse_schedules s
       JOIN users n ON s.nurseId = n.id
       JOIN users p ON s.patientId = p.id
       WHERE s.id = ? LIMIT 1`,
      [id]
    );
    return results && results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('scheduleModel.findScheduleById error:', error);
    return null;
  }
}

/**
 * Get schedules for a nurse within an optional date range
 * @param {string} nurseId
 * @param {string} startDate - Optional ISO string or YYYY-MM-DD
 * @param {string} endDate - Optional ISO string or YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getNurseSchedules(nurseId, startDate = null, endDate = null) {
  try {
    let sql = `
      SELECT s.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone,
              p.gender as patientGender, p.dateOfBirth as patientDob
       FROM nurse_schedules s
       JOIN users p ON s.patientId = p.id
       WHERE s.nurseId = ?
    `;
    const params = [nurseId];

    if (startDate) {
      sql += ' AND s.startDatetime >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND s.startDatetime <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY s.startDatetime ASC';

    const { results } = await queryD1(sql, params);
    return results || [];
  } catch (error) {
    console.error('scheduleModel.getNurseSchedules error:', error);
    return [];
  }
}

/**
 * Get schedules for a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getPatientSchedules(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT s.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone,
              n.nurseSpecialization
       FROM nurse_schedules s
       JOIN users n ON s.nurseId = n.id
       WHERE s.patientId = ?
       ORDER BY s.startDatetime ASC`,
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('scheduleModel.getPatientSchedules error:', error);
    return [];
  }
}

/**
 * Update schedule status with transition validation
 * Allowed statuses: scheduled, en_route, in_progress, completed, missed, cancelled, rescheduled
 * @param {string} id
 * @param {string} status
 * @param {string} cancellationReason
 * @returns {Promise<Object|null>}
 */
async function updateScheduleStatus(id, status, cancellationReason = '') {
  const valid = ['scheduled', 'en_route', 'in_progress', 'completed', 'missed', 'cancelled', 'rescheduled'];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${valid.join(', ')}`);
  }

  const setClauses = ['status = ?', "updatedAt = datetime('now')"];
  const values = [status];

  if (cancellationReason) {
    setClauses.push('cancellationReason = ?');
    values.push(cancellationReason);
  }

  values.push(id);

  try {
    const sql = `UPDATE nurse_schedules SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);
    return await findScheduleById(id);
  } catch (error) {
    console.error('scheduleModel.updateScheduleStatus error:', error);
    throw error;
  }
}

/**
 * Update schedule details (timeslot, notes, address) with collision check
 * @param {string} id
 * @param {Object} updateData
 * @returns {Promise<Object|null>}
 */
async function updateSchedule(id, updateData) {
  try {
    const current = await findScheduleById(id);
    if (!current) throw new Error('Schedule not found');

    const newStart = updateData.startDatetime || current.startDatetime;
    const newEnd = updateData.endDatetime || current.endDatetime;
    const nurseId = updateData.nurseId || current.nurseId;

    if (updateData.startDatetime || updateData.endDatetime || updateData.nurseId) {
      const conflicts = await findConflictingSchedules(nurseId, newStart, newEnd, id);
      if (conflicts.length > 0) {
        const conflict = conflicts[0];
        throw new Error(`Schedule conflict: Nurse already has visit "${conflict.serviceType}" booked from ${conflict.startDatetime} to ${conflict.endDatetime}`);
      }
    }

    const allowed = ['startDatetime', 'endDatetime', 'serviceType', 'locationAddress', 'notes', 'status', 'cancellationReason', 'nurseId'];
    const setClauses = ["updatedAt = datetime('now')"];
    const values = [];

    for (const key of allowed) {
      if (updateData[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    }

    values.push(id);
    const sql = `UPDATE nurse_schedules SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);

    return await findScheduleById(id);
  } catch (error) {
    console.error('scheduleModel.updateSchedule error:', error);
    throw error;
  }
}

/**
 * Get all schedules (for admin overview)
 * @returns {Promise<Array>}
 */
async function getAllSchedules() {
  try {
    const { results } = await queryD1(
      `SELECT s.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone
       FROM nurse_schedules s
       JOIN users n ON s.nurseId = n.id
       JOIN users p ON s.patientId = p.id
       ORDER BY s.startDatetime DESC`
    );
    return results || [];
  } catch (error) {
    console.error('scheduleModel.getAllSchedules error:', error);
    return [];
  }
}

module.exports = {
  createSchedule,
  findScheduleById,
  findConflictingSchedules,
  getNurseSchedules,
  getPatientSchedules,
  updateScheduleStatus,
  updateSchedule,
  getAllSchedules
};
