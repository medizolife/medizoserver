const express = require('express');
const router = express.Router();
const { auth, doctor } = require('../middleware/auth');
const {
  createReferral,
  findReferralById,
  getOutgoingReferrals,
  getIncomingReferrals,
  getPatientReferrals,
  updateReferralStatus
} = require('../models/networkModel');
const { assignDoctorToPatient } = require('../models/assignmentModel');
const { findUserById } = require('../models/user');

/**
 * @route   POST /api/referrals
 * @desc    Refer a patient to another doctor
 * @access  Private (Doctor only)
 */
router.post('/', doctor, async (req, res) => {
  try {
    const referringDoctorId = req.user.id;
    const { referredDoctorId, patientId, familyProfileId, prescriptionId, reason, clinicalSummary, priority } = req.body;

    if (!referredDoctorId || !patientId || !reason) {
      return res.status(400).json({ success: false, message: 'referredDoctorId, patientId, and reason are required' });
    }

    if (referringDoctorId === referredDoctorId) {
      return res.status(400).json({ success: false, message: 'You cannot refer a patient to yourself' });
    }

    // Verify patient exists
    const patient = await findUserById(patientId);
    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    // Verify referred doctor exists
    const referredDoctor = await findUserById(referredDoctorId);
    if (!referredDoctor || referredDoctor.role !== 'doctor') {
      return res.status(404).json({ success: false, message: 'Referred doctor not found' });
    }

    const referral = await createReferral({
      referringDoctorId,
      referredDoctorId,
      patientId,
      familyProfileId: familyProfileId || '',
      prescriptionId: prescriptionId || '',
      reason,
      clinicalSummary: clinicalSummary || '',
      priority: priority || 'routine'
    });

    res.status(201).json({
      success: true,
      message: `Patient ${patient.firstName} ${patient.lastName} referred to Dr. ${referredDoctor.firstName} ${referredDoctor.lastName} successfully`,
      referral
    });
  } catch (error) {
    console.error('Create referral error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create referral' });
  }
});

/**
 * @route   GET /api/referrals/outgoing
 * @desc    Get all referrals sent by logged-in doctor
 * @access  Private (Doctor only)
 */
router.get('/outgoing', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const referrals = await getOutgoingReferrals(doctorId);

    res.json({
      success: true,
      count: referrals.length,
      referrals
    });
  } catch (error) {
    console.error('Get outgoing referrals error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve outgoing referrals' });
  }
});

/**
 * @route   GET /api/referrals/incoming
 * @desc    Get all referrals received by logged-in doctor
 * @access  Private (Doctor only)
 */
router.get('/incoming', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const referrals = await getIncomingReferrals(doctorId);

    res.json({
      success: true,
      count: referrals.length,
      referrals
    });
  } catch (error) {
    console.error('Get incoming referrals error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve incoming referrals' });
  }
});

/**
 * @route   GET /api/referrals/patient/:patientId
 * @desc    Get referral history for a patient
 * @access  Private
 */
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const referrals = await getPatientReferrals(patientId);

    res.json({
      success: true,
      count: referrals.length,
      referrals
    });
  } catch (error) {
    console.error('Get patient referrals error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve patient referrals' });
  }
});

/**
 * @route   GET /api/referrals/:id
 * @desc    Get referral details by ID
 * @access  Private
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const referral = await findReferralById(req.params.id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found' });
    }

    const patient = await findUserById(referral.patientId);
    const referringDoc = await findUserById(referral.referringDoctorId);
    const referredDoc = await findUserById(referral.referredDoctorId);

    res.json({
      success: true,
      referral: {
        ...referral,
        patient: patient ? { id: patient.id, name: `${patient.firstName} ${patient.lastName}`, phone: patient.phone, email: patient.email } : null,
        referringDoctor: referringDoc ? { id: referringDoc.id, name: `Dr. ${referringDoc.firstName} ${referringDoc.lastName}`, specialization: referringDoc.specialization, clinicName: referringDoc.clinicName } : null,
        referredDoctor: referredDoc ? { id: referredDoc.id, name: `Dr. ${referredDoc.firstName} ${referredDoc.lastName}`, specialization: referredDoc.specialization, clinicName: referredDoc.clinicName } : null
      }
    });
  } catch (error) {
    console.error('Get referral error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve referral' });
  }
});

/**
 * @route   PUT /api/referrals/:id/status
 * @desc    Accept, reject, or complete a referral
 * @access  Private (Doctor only)
 */
router.put('/:id/status', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const { status, responseNotes } = req.body;

    const referral = await findReferralById(req.params.id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found' });
    }

    // Check authorization: only referred doctor or referring doctor can update
    if (referral.referredDoctorId !== doctorId && referral.referringDoctorId !== doctorId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to update this referral' });
    }

    const updated = await updateReferralStatus(req.params.id, status, responseNotes);

    // If referral is accepted, auto-link patient to referred doctor in doctor_patient_assignments
    if (status === 'accepted') {
      try {
        await assignDoctorToPatient({
          doctorId: referral.referredDoctorId,
          patientId: referral.patientId,
          familyProfileId: referral.familyProfileId || '',
          assignmentType: 'referred',
          source: 'referral',
          notes: `Accepted referral #${referral.referralNumber}`
        });
      } catch (linkErr) {
        console.error('Auto-link on referral acceptance error:', linkErr);
      }
    }

    res.json({
      success: true,
      message: `Referral status updated to "${status}"`,
      referral: updated
    });
  } catch (error) {
    console.error('Update referral status error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update referral' });
  }
});

module.exports = router;
