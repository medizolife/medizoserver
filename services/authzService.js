const { findPrescriptionsByPatientId } = require('../models/prescription');
const { getPatientAssignedDoctors, getPatientAssignedNurses } = require('../models/assignmentModel');
const { getPatientReferrals } = require('../models/networkModel');
const { getFamilyProfilesByAccountId } = require('../models/familyProfile');
const { findUserById } = require('../models/user');

/**
 * Check if the given authenticated user has authorization to access patient data
 * @param {Object} user - The authenticated req.user object
 * @param {string} patientId - The target patient user ID
 * @returns {Promise<boolean>}
 */
async function canAccessPatientData(user, patientId) {
  if (!user || !patientId) return false;

  // 1. Admin has global authorization
  if (user.role === 'admin' || user.email === 'admin@medizo.life') {
    return true;
  }

  // 2. Patient can access their own account
  if (user.role === 'patient' && String(user.id) === String(patientId)) {
    return true;
  }

  // 3. Patient can access dependent family profiles in their account
  if (user.role === 'patient') {
    const familyProfiles = await getFamilyProfilesByAccountId(user.id);
    const hasProfile = familyProfiles.some(p => String(p.id) === String(patientId));
    if (hasProfile) return true;
  }

  // 4. Doctor authorization checks
  if (user.role === 'doctor') {
    const doctorId = user.id;

    // Check doctor-patient assignment
    const assignedDoctors = await getPatientAssignedDoctors(patientId);
    if (assignedDoctors.some(d => String(d.doctorId) === String(doctorId))) {
      return true;
    }

    // Check doctor's linkedPatients array
    const docUser = await findUserById(doctorId);
    const linked = docUser?.linkedPatients || [];
    if (linked.map(String).includes(String(patientId))) {
      return true;
    }

    // Check if doctor has ever written a prescription for this patient
    const prescriptions = await findPrescriptionsByPatientId(patientId);
    if (prescriptions.some(p => String(p.doctorId) === String(doctorId))) {
      return true;
    }

    // Check if patient was referred to this doctor
    const referrals = await getPatientReferrals(patientId);
    if (referrals.some(r => String(r.referredDoctorId) === String(doctorId) && r.status === 'accepted')) {
      return true;
    }
  }

  // 5. Nurse authorization checks
  if (user.role === 'nurse') {
    const nurseId = user.id;

    // Check if nurse is assigned to patient
    const assignedNurses = await getPatientAssignedNurses(patientId);
    if (assignedNurses.some(n => String(n.nurseId) === String(nurseId))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if the user is authorized to view or manage a bill
 * @param {Object} user
 * @param {Object} bill
 * @returns {boolean}
 */
function canAccessBill(user, bill) {
  if (!user || !bill) return false;
  if (user.role === 'admin' || user.email === 'admin@medizo.life') return true;
  if (String(bill.patientId) === String(user.id)) return true;
  if (String(bill.doctorId) === String(user.id)) return true;
  return false;
}

/**
 * Check if the user is authorized to access a home care request
 * @param {Object} user
 * @param {Object} request
 * @returns {boolean}
 */
function canAccessHomeCareRequest(user, request) {
  if (!user || !request) return false;
  if (user.role === 'admin' || user.email === 'admin@medizo.life') return true;
  if (String(request.patientId) === String(user.id)) return true;
  if (String(request.requestedById) === String(user.id)) return true;
  if (request.advisedByDoctorId && String(request.advisedByDoctorId) === String(user.id)) return true;
  if (request.assignedNurseId && String(request.assignedNurseId) === String(user.id)) return true;
  return false;
}

module.exports = {
  canAccessPatientData,
  canAccessBill,
  canAccessHomeCareRequest
};
