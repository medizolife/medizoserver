const { queryD1 } = require('../config/d1-client');

// JSON fields that need parsing on read and stringifying on write
const PRESCRIPTION_JSON_FIELDS = [
  'vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
  'currentMedications', 'pastSurgicalHistory', 'medications', 'medicationNotes',
  'testsRequired', 'investigations', 'dietModifications', 'lifestyleChanges',
  'warningSigns', 'followUpInfo', 'dispensedBy', 'testReports', 'dispenseHistory'
];

/**
 * Parse JSON fields from a raw D1 row into JS objects
 */
function parsePrescriptionRow(row) {
  if (!row) return null;
  const rx = { ...row };
  for (const field of PRESCRIPTION_JSON_FIELDS) {
    if (typeof rx[field] === 'string') {
      try {
        rx[field] = JSON.parse(rx[field]);
      } catch (e) {
        // Keep as-is if not valid JSON
      }
    }
  }
  return rx;
}

/**
 * Serialize prescription data for D1 INSERT/UPDATE
 */
function serializePrescriptionData(data) {
  const out = { ...data };
  for (const field of PRESCRIPTION_JSON_FIELDS) {
    if (out[field] !== undefined && typeof out[field] !== 'string') {
      out[field] = JSON.stringify(out[field]);
    }
  }
  return out;
}

/**
 * Check if D1 is connected (backward-compatible export)
 */
const isMongoConnected = () => true;

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all prescriptions
 * @returns {Promise<Array>}
 */
const getPrescriptions = async () => {
  try {
    const { results } = await queryD1('SELECT * FROM prescriptions ORDER BY createdAt DESC');
    return results.map(parsePrescriptionRow);
  } catch (error) {
    console.error('D1 getPrescriptions error:', error);
    return [];
  }
};

/**
 * Sync version alias (now async, kept for backward compat)
 */
const getPrescriptionsSync = getPrescriptions;

/**
 * Find prescriptions by doctor ID
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
const findPrescriptionsByDoctorId = async (doctorId) => {
  try {
    const { results } = await queryD1(
      'SELECT * FROM prescriptions WHERE doctorId = ? ORDER BY createdAt DESC',
      [doctorId]
    );
    return results.map(parsePrescriptionRow);
  } catch (error) {
    console.error('D1 findPrescriptionsByDoctorId error:', error);
    return [];
  }
};

/**
 * Find prescriptions by patient ID, family profile IDs, or email
 * @param {string} patientId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
const findPrescriptionsByPatientId = async (patientId, options = {}) => {
  try {
    const userEmail = (options.email || '').trim().toLowerCase();

    // Fetch family profile IDs for this account if available
    let profileIds = [];
    try {
      const { results: profiles } = await queryD1('SELECT id FROM family_profiles WHERE accountId = ?', [patientId]);
      if (profiles && profiles.length > 0) {
        profileIds = profiles.map(p => p.id).filter(Boolean);
      }
    } catch (e) {}

    let whereClauses = ['patientId = ?'];
    let queryParams = [patientId];

    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => '?').join(',');
      whereClauses.push(`patientId IN (${placeholders})`);
      queryParams.push(...profileIds);
    }

    if (userEmail) {
      whereClauses.push(`(patientEmail IS NOT NULL AND patientEmail != '' AND lower(patientEmail) = ?)`);
      queryParams.push(userEmail);
    }

    const sql = `SELECT DISTINCT * FROM prescriptions WHERE (${whereClauses.join(' OR ')}) ORDER BY createdAt DESC`;
    const { results } = await queryD1(sql, queryParams);
    return results.map(parsePrescriptionRow);
  } catch (error) {
    console.error('D1 findPrescriptionsByPatientId error:', error);
    return [];
  }
};

/**
 * Find a prescription by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
const findPrescriptionById = async (id) => {
  if (!id) return null;
  let cleanId = String(id).trim();

  // Try extracting from URL query parameters if a URL or parameter string was provided
  try {
    const paramMatch = cleanId.match(/[?&](?:rxId|id|code|rx|scan|verify)=([^&#]+)/i);
    if (paramMatch && paramMatch[1]) {
      cleanId = decodeURIComponent(paramMatch[1]).trim();
    } else if (cleanId.includes('/')) {
      const urlWithoutQuery = cleanId.split('?')[0].split('#')[0];
      const segments = urlWithoutQuery.split('/').filter(Boolean);
      const last = segments.pop() || '';
      if (last && !['dashboard', 'verify-prescription', 'verify', 'view', 'prescriptions', 'public'].includes(last.toLowerCase())) {
        cleanId = decodeURIComponent(last).trim();
      }
    }
  } catch (e) {}

  cleanId = cleanId.split('?')[0].split('#')[0].trim();
  if (!cleanId) return null;

  try {
    // 1. Direct ID match
    let { results } = await queryD1(
      'SELECT * FROM prescriptions WHERE id = ? LIMIT 1',
      [cleanId]
    );
    if (results && results.length > 0) {
      return parsePrescriptionRow(results[0]);
    }

    // 2. Direct qrCode match
    ({ results } = await queryD1(
      'SELECT * FROM prescriptions WHERE qrCode = ? LIMIT 1',
      [cleanId]
    ));
    if (results && results.length > 0) {
      return parsePrescriptionRow(results[0]);
    }

    // 3. Formatted RX ID match (e.g. RX-2026-08-15-1068f)
    if (cleanId.toUpperCase().startsWith('RX-')) {
      const parts = cleanId.split('-');
      const suffix = parts[parts.length - 1]; // e.g. 1068f
      if (suffix && suffix.length >= 4) {
        ({ results } = await queryD1(
          'SELECT * FROM prescriptions WHERE id LIKE ? LIMIT 1',
          [`%${suffix}`]
        ));
        if (results && results.length > 0) {
          return parsePrescriptionRow(results[0]);
        }
      }
    }

    // 4. Suffix match (last 5-8 chars)
    if (cleanId.length >= 5 && cleanId.length <= 12) {
      ({ results } = await queryD1(
        'SELECT * FROM prescriptions WHERE id LIKE ? LIMIT 1',
        [`%${cleanId}`]
      ));
      if (results && results.length > 0) {
        return parsePrescriptionRow(results[0]);
      }
    }

    return null;
  } catch (error) {
    console.error('D1 findPrescriptionById error:', error);
    return null;
  }
};

/**
 * Create a new prescription
 * @param {Object} prescriptionData
 * @returns {Promise<Object>}
 */
const createPrescription = async (prescriptionData) => {
  try {
    const data = serializePrescriptionData({
      ...prescriptionData,
      status: 'active'
    });

    const allowedFields = [
      'doctorId', 'doctorName', 'doctorSpecialization', 'doctorLicenseNumber',
      'patientId', 'patientName', 'patientEmail', 'patientAge', 'patientGender',
      'accountId', 'patientDisplayId',
      'vitalSigns', 'presentingComplaints', 'clinicalFindings', 'provisionalDiagnosis',
      'currentMedications', 'pastSurgicalHistory',
      'diagnosis', 'medication', 'dosage', 'frequency', 'duration', 'instructions', 'notes',
      'medications', 'medicationNotes',
      'testsRequired', 'investigations', 'investigationNotes', 'testReports',
      'dietModifications', 'lifestyleChanges', 'warningSigns',
      'followUpDate', 'followUpInfo', 'emergencyHelpline',
      'qrCode', 'status', 'dispensedStatus', 'dispensedAt', 'dispensedBy', 'dispenseNotes',
      'dispenseHistory', 'dispenseCount'
    ];

    const fields = [];
    const placeholders = [];
    const values = [];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(field);
        placeholders.push('?');
        values.push(data[field]);
      }
    }

    const sql = `INSERT INTO prescriptions (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const { results } = await queryD1(sql, values);

    if (results.length === 0) {
      throw new Error('Failed to create prescription');
    }

    const newPrescription = parsePrescriptionRow(results[0]);

    // Set qrCode to the generated ID so QR scan always matches
    if (!newPrescription.qrCode || newPrescription.qrCode === '') {
      await queryD1(
        'UPDATE prescriptions SET qrCode = ? WHERE id = ?',
        [newPrescription.id, newPrescription.id]
      );
      newPrescription.qrCode = newPrescription.id;
    }

    console.log('Prescription saved to D1, id:', newPrescription.id, 'qrCode:', newPrescription.qrCode);
    return newPrescription;
  } catch (error) {
    console.error('D1 createPrescription error:', error);
    throw error;
  }
};

/**
 * Update a prescription
 * @param {string} id
 * @param {Object} prescriptionData
 * @returns {Promise<Object|null>}
 */
const updatePrescription = async (id, prescriptionData) => {
  try {
    const data = serializePrescriptionData(prescriptionData);

    const setClauses = [];
    const values = [];

    const skipFields = ['id', 'createdAt'];
    for (const [key, value] of Object.entries(data)) {
      if (skipFields.includes(key) || value === undefined) continue;
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    if (setClauses.length === 0) return await findPrescriptionById(id);

    // Add updatedAt
    setClauses.push("updatedAt = datetime('now')");
    values.push(id); // WHERE clause

    const sql = `UPDATE prescriptions SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
    const { results } = await queryD1(sql, values);

    return results.length > 0 ? parsePrescriptionRow(results[0]) : null;
  } catch (error) {
    console.error('D1 updatePrescription error:', error);
    return null;
  }
};

/**
 * Delete a prescription
 * @param {string} id
 * @returns {Promise<boolean>}
 */
const deletePrescription = async (id) => {
  try {
    const { meta } = await queryD1('DELETE FROM prescriptions WHERE id = ?', [id]);
    return (meta?.changes || 0) > 0;
  } catch (error) {
    console.error('D1 deletePrescription error:', error);
    return false;
  }
};

/**
 * Create an external / past prescription record
 * @param {Object} data
 * @returns {Promise<Object>}
 */
const createExternalPrescription = async (data) => {
  try {
    const crypto = require('crypto');
    const id = data.id || crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const sql = `INSERT INTO external_prescriptions 
      (id, patientId, uploadedBy, title, doctorName, recordDate, notes, fileUrl, fileType, fileSize, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await queryD1(sql, [
      id,
      data.patientId,
      data.uploadedBy,
      data.title || 'Past Medical Record',
      data.doctorName || '',
      data.recordDate || '',
      data.notes || '',
      data.fileUrl,
      data.fileType || 'image',
      data.fileSize || 0,
      now,
      now
    ]);
    return {
      id,
      patientId: data.patientId,
      uploadedBy: data.uploadedBy,
      title: data.title || 'Past Medical Record',
      doctorName: data.doctorName || '',
      recordDate: data.recordDate || '',
      notes: data.notes || '',
      fileUrl: data.fileUrl,
      fileType: data.fileType || 'image',
      fileSize: data.fileSize || 0,
      createdAt: now,
      updatedAt: now
    };
  } catch (error) {
    console.error('D1 createExternalPrescription error:', error);
    throw error;
  }
};

/**
 * Find external prescriptions by patient ID
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
const findExternalPrescriptionsByPatientId = async (patientId) => {
  try {
    const { results } = await queryD1(
      'SELECT * FROM external_prescriptions WHERE patientId = ? ORDER BY createdAt DESC',
      [patientId]
    );
    return results || [];
  } catch (error) {
    console.error('D1 findExternalPrescriptionsByPatientId error:', error);
    return [];
  }
};

/**
 * Find external prescription by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
const findExternalPrescriptionById = async (id) => {
  try {
    const { results } = await queryD1(
      'SELECT * FROM external_prescriptions WHERE id = ? LIMIT 1',
      [id]
    );
    return results[0] || null;
  } catch (error) {
    console.error('D1 findExternalPrescriptionById error:', error);
    return null;
  }
};

/**
 * Delete external prescription
 * @param {string} id
 * @returns {Promise<boolean>}
 */
const deleteExternalPrescription = async (id) => {
  try {
    await queryD1('DELETE FROM external_prescriptions WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('D1 deleteExternalPrescription error:', error);
    return false;
  }
};

module.exports = {
  getPrescriptions,
  getPrescriptionsSync,
  savePrescriptions: () => {}, // No-op, kept for backward compatibility
  findPrescriptionsByDoctorId,
  findPrescriptionsByPatientId,
  findPrescriptionById,
  createPrescription,
  updatePrescription,
  deletePrescription,
  createExternalPrescription,
  findExternalPrescriptionsByPatientId,
  findExternalPrescriptionById,
  deleteExternalPrescription,
  isMongoConnected
};
