const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

const VISIT_JSON_FIELDS = ['vitals', 'symptomsObserved', 'proceduresPerformed', 'medicationsAdministered', 'attachments'];

function parseVisitRow(row) {
  if (!row) return null;
  const record = { ...row };
  for (const field of VISIT_JSON_FIELDS) {
    if (typeof record[field] === 'string') {
      try {
        record[field] = JSON.parse(record[field]);
      } catch (e) {
        // fallback
      }
    }
  }
  return record;
}

function serializeVisitData(data) {
  const out = { ...data };
  for (const field of VISIT_JSON_FIELDS) {
    if (out[field] !== undefined && typeof out[field] !== 'string') {
      out[field] = JSON.stringify(out[field]);
    }
  }
  return out;
}

/**
 * Generate unique request number: HCR-YYYYMM-XXXX
 */
async function generateRequestNumber() {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `HCR-${yearMonth}-`;

  try {
    const { results } = await queryD1(
      "SELECT requestNumber FROM home_care_requests WHERE requestNumber LIKE ? ORDER BY createdAt DESC LIMIT 1",
      [`${prefix}%`]
    );

    let nextNum = 1;
    if (results && results.length > 0) {
      const lastNumber = results[0].requestNumber;
      const lastSeq = parseInt(lastNumber.replace(prefix, ''), 10);
      if (!isNaN(lastSeq)) {
        nextNum = lastSeq + 1;
      }
    }
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  } catch (error) {
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}${randomHex}`;
  }
}

// ============================================================
// HOME CARE REQUESTS
// ============================================================

/**
 * Create a new home care request
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function createHomeCareRequest(data) {
  const { patientId, requestedById, address, contactPhone } = data;

  if (!patientId || !requestedById || !address || !contactPhone) {
    throw new Error('patientId, requestedById, address, and contactPhone are required');
  }

  const id = data.id || crypto.randomBytes(16).toString('hex');
  const requestNumber = data.requestNumber || await generateRequestNumber();
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO home_care_requests (
      id, requestNumber, patientId, familyProfileId, patientDisplayId,
      requestedByRole, requestedById, advisedByDoctorId, serviceType,
      urgency, preferredDate, preferredTimeSlot, address, contactPhone,
      clinicalInstructions, status, assignedNurseId, completedAt,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `;

  const params = [
    id,
    requestNumber,
    patientId,
    data.familyProfileId || '',
    data.patientDisplayId || '',
    data.requestedByRole || 'patient',
    requestedById,
    data.advisedByDoctorId || '',
    data.serviceType || 'general_checkup',
    data.urgency || 'routine',
    data.preferredDate || '',
    data.preferredTimeSlot || '',
    address,
    contactPhone,
    data.clinicalInstructions || '',
    data.status || 'requested',
    data.assignedNurseId || '',
    null,
    now,
    now
  ];

  try {
    const { results } = await queryD1(sql, params);
    return results && results.length > 0 ? results[0] : { id, requestNumber, ...data, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('homeCareModel.createHomeCareRequest error:', error);
    throw error;
  }
}

/**
 * Find home care request by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findHomeCareRequestById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1(
      `SELECT h.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.email as patientEmail,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone,
              d.firstName as doctorFirstName, d.lastName as doctorLastName
       FROM home_care_requests h
       LEFT JOIN users p ON h.patientId = p.id
       LEFT JOIN users n ON h.assignedNurseId = n.id
       LEFT JOIN users d ON h.advisedByDoctorId = d.id
       WHERE h.id = ? LIMIT 1`,
      [id]
    );
    return results && results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('homeCareModel.findHomeCareRequestById error:', error);
    return null;
  }
}

/**
 * Get home care requests for a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getHomeCareRequestsByPatient(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT h.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone
       FROM home_care_requests h
       LEFT JOIN users n ON h.assignedNurseId = n.id
       WHERE h.patientId = ?
       ORDER BY h.createdAt DESC`,
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('homeCareModel.getHomeCareRequestsByPatient error:', error);
    return [];
  }
}

/**
 * Get home care requests advised by or linked to a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getHomeCareRequestsByDoctor(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT h.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone,
              n.firstName as nurseFirstName, n.lastName as nurseLastName
       FROM home_care_requests h
       LEFT JOIN users p ON h.patientId = p.id
       LEFT JOIN users n ON h.assignedNurseId = n.id
       WHERE h.advisedByDoctorId = ? OR h.requestedById = ?
       ORDER BY h.createdAt DESC`,
      [doctorId, doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('homeCareModel.getHomeCareRequestsByDoctor error:', error);
    return [];
  }
}

/**
 * Get home care requests assigned to a nurse
 * @param {string} nurseId
 * @returns {Promise<Array>}
 */
async function getHomeCareRequestsByNurse(nurseId) {
  try {
    const { results } = await queryD1(
      `SELECT h.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone, p.gender as patientGender, p.dateOfBirth as patientDob,
              d.firstName as doctorFirstName, d.lastName as doctorLastName
       FROM home_care_requests h
       LEFT JOIN users p ON h.patientId = p.id
       LEFT JOIN users d ON h.advisedByDoctorId = d.id
       WHERE h.assignedNurseId = ?
       ORDER BY h.createdAt DESC`,
      [nurseId]
    );
    return results || [];
  } catch (error) {
    console.error('homeCareModel.getHomeCareRequestsByNurse error:', error);
    return [];
  }
}

/**
 * Get all home care requests (for admin)
 * @returns {Promise<Array>}
 */
async function getAllHomeCareRequests() {
  try {
    const { results } = await queryD1(
      `SELECT h.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone,
              n.firstName as nurseFirstName, n.lastName as nurseLastName,
              d.firstName as doctorFirstName, d.lastName as doctorLastName
       FROM home_care_requests h
       LEFT JOIN users p ON h.patientId = p.id
       LEFT JOIN users n ON h.assignedNurseId = n.id
       LEFT JOIN users d ON h.advisedByDoctorId = d.id
       ORDER BY h.createdAt DESC`
    );
    return results || [];
  } catch (error) {
    console.error('homeCareModel.getAllHomeCareRequests error:', error);
    return [];
  }
}

/**
 * Assign nurse to request
 * @param {string} requestId
 * @param {string} nurseId
 * @returns {Promise<Object|null>}
 */
async function assignNurseToRequest(requestId, nurseId) {
  try {
    const now = new Date().toISOString();
    const sql = `
      UPDATE home_care_requests
      SET assignedNurseId = ?, status = 'assigned', updatedAt = ?
      WHERE id = ?
    `;
    await queryD1(sql, [nurseId, now, requestId]);
    return await findHomeCareRequestById(requestId);
  } catch (error) {
    console.error('homeCareModel.assignNurseToRequest error:', error);
    throw error;
  }
}

/**
 * Update home care request status
 * @param {string} id
 * @param {string} status
 * @returns {Promise<Object|null>}
 */
async function updateHomeCareRequestStatus(id, status) {
  const valid = ['requested', 'approved', 'assigned', 'in_progress', 'completed', 'cancelled'];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${valid.join(', ')}`);
  }

  const setClauses = ['status = ?', "updatedAt = datetime('now')"];
  const values = [status];

  if (status === 'completed') {
    setClauses.push("completedAt = datetime('now')");
  }

  values.push(id);

  try {
    const sql = `UPDATE home_care_requests SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);
    return await findHomeCareRequestById(id);
  } catch (error) {
    console.error('homeCareModel.updateHomeCareRequestStatus error:', error);
    throw error;
  }
}

// ============================================================
// CARE VISIT RECORDS (CLINICAL VISIT CAPTURE)
// ============================================================

/**
 * Create a clinical care visit record
 * @param {Object} visitData
 * @returns {Promise<Object>}
 */
async function createVisitRecord(visitData) {
  const { nurseId, patientId, careNotes } = visitData;

  if (!nurseId || !patientId || !careNotes) {
    throw new Error('nurseId, patientId, and careNotes are required');
  }

  const id = visitData.id || crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const serialized = serializeVisitData({
    ...visitData,
    id,
    visitDate: visitData.visitDate || now,
    patientCondition: visitData.patientCondition || 'stable',
    doctorFeedbackRequired: visitData.doctorFeedbackRequired ? 1 : 0
  });

  const sql = `
    INSERT INTO care_visit_records (
      id, homeCareRequestId, scheduleId, assignmentId, nurseId,
      patientId, familyProfileId, patientDisplayId, visitDate, vitals,
      symptomsObserved, proceduresPerformed, medicationsAdministered,
      careNotes, patientCondition, doctorFeedbackRequired, doctorFeedbackNotes,
      attachments, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `;

  const params = [
    id,
    serialized.homeCareRequestId || '',
    serialized.scheduleId || '',
    serialized.assignmentId || '',
    nurseId,
    patientId,
    serialized.familyProfileId || '',
    serialized.patientDisplayId || '',
    serialized.visitDate,
    serialized.vitals || '{}',
    serialized.symptomsObserved || '[]',
    serialized.proceduresPerformed || '[]',
    serialized.medicationsAdministered || '[]',
    careNotes,
    serialized.patientCondition,
    serialized.doctorFeedbackRequired,
    serialized.doctorFeedbackNotes || '',
    serialized.attachments || '[]',
    now,
    now
  ];

  try {
    const { results } = await queryD1(sql, params);
    const row = results && results.length > 0 ? results[0] : { id, ...visitData, createdAt: now, updatedAt: now };

    // If linked to homeCareRequestId, update request status to completed
    if (visitData.homeCareRequestId) {
      await updateHomeCareRequestStatus(visitData.homeCareRequestId, 'completed');
    }

    return parseVisitRow(row);
  } catch (error) {
    console.error('homeCareModel.createVisitRecord error:', error);
    throw error;
  }
}

/**
 * Find visit record by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findVisitRecordById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1(
      `SELECT v.*,
              p.firstName as patientFirstName, p.lastName as patientLastName,
              n.firstName as nurseFirstName, n.lastName as nurseLastName
       FROM care_visit_records v
       LEFT JOIN users p ON v.patientId = p.id
       LEFT JOIN users n ON v.nurseId = n.id
       WHERE v.id = ? LIMIT 1`,
      [id]
    );
    return results && results.length > 0 ? parseVisitRow(results[0]) : null;
  } catch (error) {
    console.error('homeCareModel.findVisitRecordById error:', error);
    return null;
  }
}

/**
 * Get visit records for a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getVisitRecordsByPatient(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT v.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.nurseSpecialization
       FROM care_visit_records v
       LEFT JOIN users n ON v.nurseId = n.id
       WHERE v.patientId = ?
       ORDER BY v.visitDate DESC`,
      [patientId]
    );
    return (results || []).map(parseVisitRow);
  } catch (error) {
    console.error('homeCareModel.getVisitRecordsByPatient error:', error);
    return [];
  }
}

/**
 * Get visit records submitted by a nurse
 * @param {string} nurseId
 * @returns {Promise<Array>}
 */
async function getVisitRecordsByNurse(nurseId) {
  try {
    const { results } = await queryD1(
      `SELECT v.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone
       FROM care_visit_records v
       LEFT JOIN users p ON v.patientId = p.id
       WHERE v.nurseId = ?
       ORDER BY v.visitDate DESC`,
      [nurseId]
    );
    return (results || []).map(parseVisitRow);
  } catch (error) {
    console.error('homeCareModel.getVisitRecordsByNurse error:', error);
    return [];
  }
}

module.exports = {
  generateRequestNumber,
  createHomeCareRequest,
  findHomeCareRequestById,
  getHomeCareRequestsByPatient,
  getHomeCareRequestsByDoctor,
  getHomeCareRequestsByNurse,
  getAllHomeCareRequests,
  assignNurseToRequest,
  updateHomeCareRequestStatus,
  createVisitRecord,
  findVisitRecordById,
  getVisitRecordsByPatient,
  getVisitRecordsByNurse
};
