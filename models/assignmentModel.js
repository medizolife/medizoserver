const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

// ============================================================
// NURSE-DOCTOR AFFILIATIONS
// ============================================================

/**
 * Link a nurse to a doctor or clinic organization
 * @param {string} nurseId
 * @param {string} doctorId
 * @param {string} affiliationType
 * @param {string} notes
 * @returns {Promise<Object>}
 */
async function createNurseDoctorAffiliation(nurseId, doctorId, affiliationType = 'employed', notes = '') {
  if (!nurseId || !doctorId) {
    throw new Error('Both nurseId and doctorId are required');
  }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  try {
    const { results: existing } = await queryD1(
      'SELECT * FROM nurse_doctor_affiliations WHERE nurseId = ? AND doctorId = ? LIMIT 1',
      [nurseId, doctorId]
    );

    if (existing && existing.length > 0) {
      await queryD1(
        "UPDATE nurse_doctor_affiliations SET status = 'active', affiliationType = ?, notes = ?, updatedAt = ? WHERE id = ?",
        [affiliationType || existing[0].affiliationType, notes || existing[0].notes, now, existing[0].id]
      );
      return { ...existing[0], status: 'active', affiliationType, notes, updatedAt: now };
    }

    const sql = `
      INSERT INTO nurse_doctor_affiliations (id, nurseId, doctorId, affiliationType, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      RETURNING *
    `;

    const { results } = await queryD1(sql, [id, nurseId, doctorId, affiliationType, notes, now, now]);
    return results && results.length > 0 ? results[0] : { id, nurseId, doctorId, affiliationType, status: 'active', notes, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('assignmentModel.createNurseDoctorAffiliation error:', error);
    throw error;
  }
}

/**
 * Get doctors affiliated with a nurse
 * @param {string} nurseId
 * @returns {Promise<Array>}
 */
async function getNurseDoctorAffiliations(nurseId) {
  try {
    const { results } = await queryD1(
      `SELECT a.*,
              d.firstName as doctorFirstName, d.lastName as doctorLastName, d.email as doctorEmail,
              d.specialization as doctorSpecialization, d.clinicName as doctorClinicName, d.phone as doctorPhone
       FROM nurse_doctor_affiliations a
       JOIN users d ON a.doctorId = d.id
       WHERE a.nurseId = ? AND a.status = 'active'
       ORDER BY d.firstName ASC`,
      [nurseId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getNurseDoctorAffiliations error:', error);
    return [];
  }
}

/**
 * Get nurses affiliated with a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getDoctorAffiliatedNurses(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT a.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.email as nurseEmail,
              n.phone as nursePhone, n.nurseLicenseNumber, n.nurseSpecialization, n.nurseQualifications
       FROM nurse_doctor_affiliations a
       JOIN users n ON a.nurseId = n.id
       WHERE a.doctorId = ? AND a.status = 'active'
       ORDER BY n.firstName ASC`,
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getDoctorAffiliatedNurses error:', error);
    return [];
  }
}

/**
 * Get all nurse-doctor affiliations (admin overview)
 * @returns {Promise<Array>}
 */
async function getAllAffiliations() {
  try {
    const { results } = await queryD1(
      `SELECT a.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.nurseSpecialization,
              d.firstName as doctorFirstName, d.lastName as doctorLastName, d.clinicName as doctorClinicName
       FROM nurse_doctor_affiliations a
       JOIN users n ON a.nurseId = n.id
       JOIN users d ON a.doctorId = d.id
       ORDER BY a.createdAt DESC`
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getAllAffiliations error:', error);
    return [];
  }
}

// ============================================================
// NURSE-PATIENT ASSIGNMENTS (TASK/DISEASE SPECIFIC)
// ============================================================

/**
 * Assign a nurse to a patient for specific care task/condition
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function assignNurseToPatient(data) {
  const { nurseId, patientId, startDate } = data;

  if (!nurseId || !patientId || !startDate) {
    throw new Error('nurseId, patientId, and startDate are required');
  }

  const id = data.id || crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO nurse_patient_assignments (
      id, nurseId, patientId, familyProfileId, patientDisplayId,
      assignedByDoctorId, assignmentType, diseaseCondition, startDate,
      endDate, frequency, specialInstructions, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `;

  const params = [
    id,
    nurseId,
    patientId,
    data.familyProfileId || '',
    data.patientDisplayId || '',
    data.assignedByDoctorId || '',
    data.assignmentType || 'general_care',
    data.diseaseCondition || '',
    startDate,
    data.endDate || null,
    data.frequency || 'daily',
    data.specialInstructions || '',
    data.status || 'active',
    now,
    now
  ];

  try {
    const { results } = await queryD1(sql, params);
    return results && results.length > 0 ? results[0] : { id, ...data, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('assignmentModel.assignNurseToPatient error:', error);
    throw error;
  }
}

/**
 * Find nurse-patient assignment by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findNursePatientAssignmentById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1(
      `SELECT npa.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone, p.address as patientAddress
       FROM nurse_patient_assignments npa
       JOIN users n ON npa.nurseId = n.id
       JOIN users p ON npa.patientId = p.id
       WHERE npa.id = ? LIMIT 1`,
      [id]
    );
    return results && results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('assignmentModel.findNursePatientAssignmentById error:', error);
    return null;
  }
}

/**
 * Get all nurses assigned to a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getPatientAssignedNurses(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT npa.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName, n.phone as nursePhone,
              n.nurseSpecialization, n.nurseQualifications,
              d.firstName as assigningDoctorFirstName, d.lastName as assigningDoctorLastName
       FROM nurse_patient_assignments npa
       JOIN users n ON npa.nurseId = n.id
       LEFT JOIN users d ON npa.assignedByDoctorId = d.id
       WHERE npa.patientId = ? AND npa.status = 'active'
       ORDER BY npa.startDate DESC`,
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getPatientAssignedNurses error:', error);
    return [];
  }
}

/**
 * Get all patients assigned to a nurse
 * @param {string} nurseId
 * @returns {Promise<Array>}
 */
async function getNurseAssignedPatients(nurseId) {
  try {
    const { results } = await queryD1(
      `SELECT npa.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone,
              p.gender as patientGender, p.dateOfBirth as patientDob, p.address as patientAddress,
              d.firstName as assigningDoctorFirstName, d.lastName as assigningDoctorLastName
       FROM nurse_patient_assignments npa
       JOIN users p ON npa.patientId = p.id
       LEFT JOIN users d ON npa.assignedByDoctorId = d.id
       WHERE npa.nurseId = ? AND npa.status = 'active'
       ORDER BY npa.startDate DESC`,
      [nurseId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getNurseAssignedPatients error:', error);
    return [];
  }
}

/**
 * Update nurse-patient assignment status (active, paused, completed, terminated)
 * @param {string} id
 * @param {string} status
 * @returns {Promise<Object|null>}
 */
async function updateNursePatientAssignmentStatus(id, status) {
  const valid = ['active', 'paused', 'completed', 'terminated'];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${valid.join(', ')}`);
  }

  try {
    const sql = `UPDATE nurse_patient_assignments SET status = ?, updatedAt = datetime('now') WHERE id = ?`;
    await queryD1(sql, [status, id]);
    return await findNursePatientAssignmentById(id);
  } catch (error) {
    console.error('assignmentModel.updateNursePatientAssignmentStatus error:', error);
    throw error;
  }
}

/**
 * Get all nurse-patient assignments (admin matrix overview)
 * @returns {Promise<Array>}
 */
async function getAllNursePatientAssignments() {
  try {
    const { results } = await queryD1(
      `SELECT npa.*,
              n.firstName as nurseFirstName, n.lastName as nurseLastName,
              p.firstName as patientFirstName, p.lastName as patientLastName,
              d.firstName as doctorFirstName, d.lastName as doctorLastName
       FROM nurse_patient_assignments npa
       JOIN users n ON npa.nurseId = n.id
       JOIN users p ON npa.patientId = p.id
       LEFT JOIN users d ON npa.assignedByDoctorId = d.id
       ORDER BY npa.createdAt DESC`
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getAllNursePatientAssignments error:', error);
    return [];
  }
}

// ============================================================
// DOCTOR-PATIENT FORMAL ASSIGNMENTS
// ============================================================

/**
 * Formalize or update a doctor-patient assignment
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function assignDoctorToPatient(data) {
  const { doctorId, patientId } = data;
  if (!doctorId || !patientId) {
    throw new Error('Both doctorId and patientId are required');
  }

  const id = data.id || crypto.randomBytes(16).toString('hex');
  const familyProfileId = data.familyProfileId || '';
  const now = new Date().toISOString();

  try {
    const { results: existing } = await queryD1(
      'SELECT * FROM doctor_patient_assignments WHERE doctorId = ? AND patientId = ? AND familyProfileId = ? LIMIT 1',
      [doctorId, patientId, familyProfileId]
    );

    if (existing && existing.length > 0) {
      await queryD1(
        "UPDATE doctor_patient_assignments SET status = 'active', assignmentType = ?, source = ?, notes = ?, updatedAt = ? WHERE id = ?",
        [data.assignmentType || existing[0].assignmentType, data.source || existing[0].source, data.notes || existing[0].notes, now, existing[0].id]
      );
      return { ...existing[0], status: 'active', updatedAt: now };
    }

    const sql = `
      INSERT INTO doctor_patient_assignments (
        id, doctorId, patientId, familyProfileId, patientDisplayId,
        assignmentType, source, status, notes, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      RETURNING *
    `;

    const params = [
      id,
      doctorId,
      patientId,
      familyProfileId,
      data.patientDisplayId || '',
      data.assignmentType || 'primary_care',
      data.source || 'manual_link',
      data.notes || '',
      now,
      now
    ];

    const { results } = await queryD1(sql, params);
    return results && results.length > 0 ? results[0] : { id, ...data, status: 'active', createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('assignmentModel.assignDoctorToPatient error:', error);
    throw error;
  }
}

/**
 * Get all doctors assigned to a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getPatientAssignedDoctors(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT dpa.*,
              d.firstName as doctorFirstName, d.lastName as doctorLastName, d.specialization as doctorSpecialization,
              d.clinicName as doctorClinicName, d.phone as doctorPhone, d.email as doctorEmail
       FROM doctor_patient_assignments dpa
       JOIN users d ON dpa.doctorId = d.id
       WHERE dpa.patientId = ? AND dpa.status = 'active'
       ORDER BY dpa.createdAt DESC`,
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getPatientAssignedDoctors error:', error);
    return [];
  }
}

/**
 * Get all patients assigned to a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getDoctorAssignedPatients(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT dpa.*,
              p.firstName as patientFirstName, p.lastName as patientLastName, p.phone as patientPhone,
              p.email as patientEmail, p.gender as patientGender, p.dateOfBirth as patientDob
       FROM doctor_patient_assignments dpa
       JOIN users p ON dpa.patientId = p.id
       WHERE dpa.doctorId = ? AND dpa.status = 'active'
       ORDER BY dpa.createdAt DESC`,
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getDoctorAssignedPatients error:', error);
    return [];
  }
}

/**
 * Get all doctor-patient assignments (admin matrix overview)
 * @returns {Promise<Array>}
 */
async function getAllDoctorPatientAssignments() {
  try {
    const { results } = await queryD1(
      `SELECT dpa.*,
              d.firstName as doctorFirstName, d.lastName as doctorLastName, d.specialization as doctorSpecialization,
              p.firstName as patientFirstName, p.lastName as patientLastName
       FROM doctor_patient_assignments dpa
       JOIN users d ON dpa.doctorId = d.id
       JOIN users p ON dpa.patientId = p.id
       ORDER BY dpa.createdAt DESC`
    );
    return results || [];
  } catch (error) {
    console.error('assignmentModel.getAllDoctorPatientAssignments error:', error);
    return [];
  }
}

module.exports = {
  createNurseDoctorAffiliation,
  getNurseDoctorAffiliations,
  getDoctorAffiliatedNurses,
  getAllAffiliations,
  assignNurseToPatient,
  findNursePatientAssignmentById,
  getPatientAssignedNurses,
  getNurseAssignedPatients,
  updateNursePatientAssignmentStatus,
  getAllNursePatientAssignments,
  assignDoctorToPatient,
  getPatientAssignedDoctors,
  getDoctorAssignedPatients,
  getAllDoctorPatientAssignments
};
