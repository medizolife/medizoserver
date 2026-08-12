const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

/**
 * Generate a unique referral number: REF-YYYYMM-XXXX
 */
async function generateReferralNumber() {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `REF-${yearMonth}-`;

  try {
    const { results } = await queryD1(
      "SELECT referralNumber FROM doctor_referrals WHERE referralNumber LIKE ? ORDER BY createdAt DESC LIMIT 1",
      [`${prefix}%`]
    );

    let nextNum = 1;
    if (results && results.length > 0) {
      const lastNumber = results[0].referralNumber;
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
// DOCTOR NETWORK CONNECTIONS
// ============================================================

/**
 * Add a doctor to network (or re-activate connection)
 * @param {string} doctorId
 * @param {string} connectedDoctorId
 * @param {string} notes
 * @returns {Promise<Object>}
 */
async function addDoctorToNetwork(doctorId, connectedDoctorId, notes = '') {
  if (!doctorId || !connectedDoctorId) {
    throw new Error('Both doctorId and connectedDoctorId are required');
  }
  if (doctorId === connectedDoctorId) {
    throw new Error('A doctor cannot add themselves to their own network');
  }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  try {
    // Check if entry exists
    const { results: existing } = await queryD1(
      'SELECT * FROM doctor_networks WHERE doctorId = ? AND connectedDoctorId = ? LIMIT 1',
      [doctorId, connectedDoctorId]
    );

    if (existing && existing.length > 0) {
      await queryD1(
        "UPDATE doctor_networks SET status = 'accepted', notes = ?, updatedAt = ? WHERE id = ?",
        [notes || existing[0].notes, now, existing[0].id]
      );
      return { ...existing[0], status: 'accepted', notes: notes || existing[0].notes, updatedAt: now };
    }

    const sql = `
      INSERT INTO doctor_networks (id, doctorId, connectedDoctorId, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, 'accepted', ?, ?, ?)
      RETURNING *
    `;
    const { results } = await queryD1(sql, [id, doctorId, connectedDoctorId, notes, now, now]);
    return results && results.length > 0 ? results[0] : { id, doctorId, connectedDoctorId, status: 'accepted', notes, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('networkModel.addDoctorToNetwork error:', error);
    throw error;
  }
}

/**
 * Get all connected doctors for a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getDoctorNetwork(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT n.*, u.firstName, u.lastName, u.email, u.specialization, u.phone, u.contactNumber, u.clinicName, u.clinicAddress, u.profileImage
       FROM doctor_networks n
       JOIN users u ON n.connectedDoctorId = u.id
       WHERE n.doctorId = ? AND n.status = 'accepted'
       ORDER BY u.firstName ASC`,
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('networkModel.getDoctorNetwork error:', error);
    return [];
  }
}

/**
 * Check if a doctor is in another doctor's network
 * @param {string} doctorId
 * @param {string} targetDoctorId
 * @returns {Promise<boolean>}
 */
async function isDoctorInNetwork(doctorId, targetDoctorId) {
  try {
    const { results } = await queryD1(
      "SELECT id FROM doctor_networks WHERE doctorId = ? AND connectedDoctorId = ? AND status = 'accepted' LIMIT 1",
      [doctorId, targetDoctorId]
    );
    return Boolean(results && results.length > 0);
  } catch (error) {
    console.error('networkModel.isDoctorInNetwork error:', error);
    return false;
  }
}

/**
 * Remove a doctor from network (set status = 'removed')
 * @param {string} doctorId
 * @param {string} connectedDoctorId
 * @returns {Promise<boolean>}
 */
async function removeDoctorFromNetwork(doctorId, connectedDoctorId) {
  try {
    const { meta } = await queryD1(
      "UPDATE doctor_networks SET status = 'removed', updatedAt = datetime('now') WHERE doctorId = ? AND connectedDoctorId = ?",
      [doctorId, connectedDoctorId]
    );
    return (meta?.changes || 0) > 0;
  } catch (error) {
    console.error('networkModel.removeDoctorFromNetwork error:', error);
    return false;
  }
}

// ============================================================
// DOCTOR REFERRALS
// ============================================================

/**
 * Create a new doctor referral
 * @param {Object} referralData
 * @returns {Promise<Object>}
 */
async function createReferral(referralData) {
  const { referringDoctorId, referredDoctorId, patientId, reason } = referralData;

  if (!referringDoctorId || !referredDoctorId || !patientId || !reason) {
    throw new Error('referringDoctorId, referredDoctorId, patientId, and reason are required');
  }

  if (referringDoctorId === referredDoctorId) {
    throw new Error('Referring doctor cannot refer a patient to themselves');
  }

  const id = referralData.id || crypto.randomBytes(16).toString('hex');
  const referralNumber = referralData.referralNumber || await generateReferralNumber();
  const now = new Date().toISOString();

  try {
    const sql = `
      INSERT INTO doctor_referrals (
        id, referralNumber, referringDoctorId, referredDoctorId,
        patientId, familyProfileId, patientDisplayId, prescriptionId,
        reason, clinicalSummary, priority, status, responseNotes,
        respondedAt, completedAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `;

    const params = [
      id,
      referralNumber,
      referringDoctorId,
      referredDoctorId,
      patientId,
      referralData.familyProfileId || '',
      referralData.patientDisplayId || '',
      referralData.prescriptionId || '',
      reason,
      referralData.clinicalSummary || '',
      referralData.priority || 'routine',
      referralData.status || 'pending',
      referralData.responseNotes || '',
      null,
      null,
      now,
      now
    ];

    const { results } = await queryD1(sql, params);
    return results && results.length > 0 ? results[0] : { id, referralNumber, ...referralData, createdAt: now, updatedAt: now };
  } catch (error) {
    console.error('networkModel.createReferral error:', error);
    throw error;
  }
}

/**
 * Find referral by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findReferralById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1('SELECT * FROM doctor_referrals WHERE id = ? LIMIT 1', [id]);
    return results && results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('networkModel.findReferralById error:', error);
    return null;
  }
}

/**
 * Get outgoing referrals sent by a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getOutgoingReferrals(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT r.*,
              u.firstName as patientFirstName, u.lastName as patientLastName, u.phone as patientPhone, u.email as patientEmail,
              d.firstName as referredDoctorFirstName, d.lastName as referredDoctorLastName, d.specialization as referredDoctorSpecialization, d.clinicName as referredClinicName
       FROM doctor_referrals r
       JOIN users u ON r.patientId = u.id
       JOIN users d ON r.referredDoctorId = d.id
       WHERE r.referringDoctorId = ?
       ORDER BY r.createdAt DESC`,
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('networkModel.getOutgoingReferrals error:', error);
    return [];
  }
}

/**
 * Get incoming referrals received by a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function getIncomingReferrals(doctorId) {
  try {
    const { results } = await queryD1(
      `SELECT r.*,
              u.firstName as patientFirstName, u.lastName as patientLastName, u.phone as patientPhone, u.email as patientEmail,
              d.firstName as referringDoctorFirstName, d.lastName as referringDoctorLastName, d.specialization as referringDoctorSpecialization, d.clinicName as referringClinicName
       FROM doctor_referrals r
       JOIN users u ON r.patientId = u.id
       JOIN users d ON r.referringDoctorId = d.id
       WHERE r.referredDoctorId = ?
       ORDER BY r.createdAt DESC`,
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('networkModel.getIncomingReferrals error:', error);
    return [];
  }
}

/**
 * Get referrals for a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function getPatientReferrals(patientId) {
  try {
    const { results } = await queryD1(
      `SELECT r.*,
              d1.firstName as referringDoctorFirstName, d1.lastName as referringDoctorLastName, d1.specialization as referringDoctorSpecialization,
              d2.firstName as referredDoctorFirstName, d2.lastName as referredDoctorLastName, d2.specialization as referredDoctorSpecialization
       FROM doctor_referrals r
       JOIN users d1 ON r.referringDoctorId = d1.id
       JOIN users d2 ON r.referredDoctorId = d2.id
       WHERE r.patientId = ?
       ORDER BY r.createdAt DESC`,
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('networkModel.getPatientReferrals error:', error);
    return [];
  }
}

/**
 * Update referral status (e.g. pending -> accepted / rejected / completed)
 * @param {string} id
 * @param {string} status
 * @param {string} responseNotes
 * @returns {Promise<Object|null>}
 */
async function updateReferralStatus(id, status, responseNotes = '') {
  const valid = ['pending', 'accepted', 'rejected', 'cancelled', 'completed'];
  if (!valid.includes(status)) {
    throw new Error(`Invalid referral status. Must be one of: ${valid.join(', ')}`);
  }

  const now = new Date().toISOString();
  const setClauses = ['status = ?', "updatedAt = datetime('now')"];
  const values = [status];

  if (responseNotes) {
    setClauses.push('responseNotes = ?');
    values.push(responseNotes);
  }

  if (['accepted', 'rejected'].includes(status)) {
    setClauses.push('respondedAt = ?');
    values.push(now);
  }

  if (status === 'completed') {
    setClauses.push('completedAt = ?');
    values.push(now);
  }

  values.push(id);

  try {
    const sql = `UPDATE doctor_referrals SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);
    return await findReferralById(id);
  } catch (error) {
    console.error('networkModel.updateReferralStatus error:', error);
    throw error;
  }
}

/**
 * Get all referrals system-wide (for admin overview)
 * @returns {Promise<Array>}
 */
async function getAllReferrals() {
  try {
    const { results } = await queryD1(
      `SELECT r.*,
              u.firstName as patientFirstName, u.lastName as patientLastName, u.phone as patientPhone,
              d1.firstName as referringDoctorFirstName, d1.lastName as referringDoctorLastName,
              d2.firstName as referredDoctorFirstName, d2.lastName as referredDoctorLastName
       FROM doctor_referrals r
       LEFT JOIN users u ON r.patientId = u.id
       LEFT JOIN users d1 ON r.referringDoctorId = d1.id
       LEFT JOIN users d2 ON r.referredDoctorId = d2.id
       ORDER BY r.createdAt DESC`
    );
    return results || [];
  } catch (error) {
    console.error('networkModel.getAllReferrals error:', error);
    return [];
  }
}

module.exports = {
  generateReferralNumber,
  addDoctorToNetwork,
  getDoctorNetwork,
  isDoctorInNetwork,
  removeDoctorFromNetwork,
  createReferral,
  findReferralById,
  getOutgoingReferrals,
  getIncomingReferrals,
  getPatientReferrals,
  updateReferralStatus,
  getAllReferrals
};
