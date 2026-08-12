const express = require('express');
const router = express.Router();
const { doctor } = require('../middleware/auth');
const { addDoctorToNetwork, getDoctorNetwork, removeDoctorFromNetwork } = require('../models/networkModel');
const { getUsers, findUserById } = require('../models/user');

/**
 * @route   GET /api/network
 * @desc    Get all doctors in current doctor's network
 * @access  Private (Doctor only)
 */
router.get('/', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const network = await getDoctorNetwork(doctorId);

    res.json({
      success: true,
      count: network.length,
      network
    });
  } catch (error) {
    console.error('Get doctor network error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve doctor network' });
  }
});

/**
 * @route   GET /api/network/directory
 * @desc    Get directory of active doctors available to connect with
 * @access  Private (Doctor only)
 */
router.get('/directory', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const allUsers = await getUsers();

    // Get current network connections
    const currentNetwork = await getDoctorNetwork(doctorId);
    const connectedIds = new Set(currentNetwork.map(n => String(n.connectedDoctorId)));

    const directory = allUsers
      .filter(u => u.role === 'doctor' && u.id !== doctorId && (u.status || 'active') === 'active')
      .map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        name: `Dr. ${u.firstName} ${u.lastName}`,
        email: u.email,
        phone: u.phone || u.contactNumber,
        specialization: u.specialization || 'General Physician',
        licenseNumber: u.licenseNumber,
        clinicName: u.clinicName,
        clinicAddress: u.clinicAddress,
        experience: u.experience,
        qualifications: u.qualifications,
        profileImage: u.profileImage,
        isConnected: connectedIds.has(String(u.id))
      }));

    res.json({
      success: true,
      count: directory.length,
      doctors: directory
    });
  } catch (error) {
    console.error('Get doctor directory error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve doctors directory' });
  }
});

/**
 * @route   POST /api/network/connect
 * @desc    Add a doctor to network
 * @access  Private (Doctor only)
 */
router.post('/connect', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const { connectedDoctorId, notes } = req.body;

    if (!connectedDoctorId) {
      return res.status(400).json({ success: false, message: 'connectedDoctorId is required' });
    }

    const targetDoctor = await findUserById(connectedDoctorId);
    if (!targetDoctor || targetDoctor.role !== 'doctor') {
      return res.status(404).json({ success: false, message: 'Target doctor not found' });
    }

    const connection = await addDoctorToNetwork(doctorId, connectedDoctorId, notes);

    res.status(201).json({
      success: true,
      message: `Dr. ${targetDoctor.firstName} ${targetDoctor.lastName} added to your network`,
      connection
    });
  } catch (error) {
    console.error('Connect doctor error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to add doctor to network' });
  }
});

/**
 * @route   DELETE /api/network/:connectedDoctorId
 * @desc    Remove a doctor from network
 * @access  Private (Doctor only)
 */
router.delete('/:connectedDoctorId', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const { connectedDoctorId } = req.params;

    const success = await removeDoctorFromNetwork(doctorId, connectedDoctorId);

    res.json({
      success: true,
      message: success ? 'Doctor removed from network' : 'Doctor was not in your network'
    });
  } catch (error) {
    console.error('Remove doctor from network error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove doctor from network' });
  }
});

module.exports = router;
