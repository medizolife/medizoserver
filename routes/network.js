const express = require('express');
const router = express.Router();
const { doctor } = require('../middleware/auth');
const { addDoctorToNetwork, getDoctorNetwork, removeDoctorFromNetwork, isDoctorInNetwork } = require('../models/networkModel');
const { getUsers, findUserById, findUserByEmail } = require('../models/user');
const { queryD1 } = require('../config/d1-client');


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
 * @route   GET /api/network/my-card
 * @desc    Get current doctor's shareable identity card & QR payload
 * @access  Private (Doctor only)
 */
router.get('/my-card', doctor, async (req, res) => {
  try {
    const user = req.user;
    const card = {
      doctorId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `Dr. ${user.firstName} ${user.lastName}`,
      email: user.email,
      specialization: user.specialization || 'General Physician',
      licenseNumber: user.licenseNumber || '',
      clinicName: user.clinicName || '',
      clinicAddress: user.clinicAddress || '',
      profileImage: user.profileImage || '',
      qrPayload: JSON.stringify({
        type: 'medizo_doctor_network',
        doctorId: user.id,
        email: user.email,
        name: `Dr. ${user.firstName} ${user.lastName}`,
        specialization: user.specialization || 'General Physician'
      })
    };

    res.json({
      success: true,
      card
    });
  } catch (error) {
    console.error('Get doctor card error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve doctor card' });
  }
});

/**
 * @route   POST /api/network/verify-doctor
 * @desc    Verify/lookup a specific doctor by email, doctor ID, or QR payload
 * @access  Private (Doctor only)
 */
router.post('/verify-doctor', doctor, async (req, res) => {
  try {
    const currentDoctorId = req.user.id;
    let { query, type } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email ID, Doctor ID, or QR code to verify'
      });
    }

    query = query.trim();
    let targetEmail = null;
    let targetDoctorId = null;

    // Check if query is JSON (e.g. from Medizo QR code payload)
    if (query.startsWith('{') && query.endsWith('}')) {
      try {
        const parsed = JSON.parse(query);
        if (parsed.doctorId) targetDoctorId = String(parsed.doctorId).trim();
        if (parsed.email) targetEmail = String(parsed.email).trim().toLowerCase();
      } catch (e) {
        // Fallback if not valid JSON
      }
    }

    let targetDoctor = null;

    // 1. If targetDoctorId was resolved from QR or query is a potential ID
    if (targetDoctorId) {
      targetDoctor = await findUserById(targetDoctorId);
    }

    // 2. If targetEmail was resolved from QR
    if (!targetDoctor && targetEmail) {
      targetDoctor = await findUserByEmail(targetEmail);
    }

    // 3. If query contains '@', treat as email
    if (!targetDoctor && query.includes('@')) {
      targetDoctor = await findUserByEmail(query);
    }

    // 4. Try lookup by direct ID
    if (!targetDoctor) {
      targetDoctor = await findUserById(query);
    }

    // 5. Fallback search across active doctors by exact email, id, or license number
    if (!targetDoctor) {
      const allUsers = await getUsers();
      const cleanQ = query.toLowerCase();
      targetDoctor = allUsers.find(u => 
        u.role === 'doctor' && (
          String(u.id).toLowerCase() === cleanQ ||
          (u.email && u.email.toLowerCase() === cleanQ) ||
          (u.licenseNumber && u.licenseNumber.toLowerCase() === cleanQ)
        )
      );
    }

    if (!targetDoctor || targetDoctor.role !== 'doctor') {
      return res.status(404).json({
        success: false,
        message: 'No registered doctor found matching the provided details. Please check the email or Doctor ID.'
      });
    }

    if ((targetDoctor.status || 'active') !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'This doctor account is currently inactive.'
      });
    }

    // Check if user is verifying themselves
    if (String(targetDoctor.id) === String(currentDoctorId)) {
      return res.status(400).json({
        success: false,
        isSelf: true,
        message: 'This is your own doctor profile. You cannot add yourself to your network.'
      });
    }

    // Check if already in network
    const isConnected = await isDoctorInNetwork(currentDoctorId, targetDoctor.id);

    const verifiedDoctor = {
      id: targetDoctor.id,
      firstName: targetDoctor.firstName,
      lastName: targetDoctor.lastName,
      name: `Dr. ${targetDoctor.firstName} ${targetDoctor.lastName}`,
      email: targetDoctor.email,
      specialization: targetDoctor.specialization || 'General Physician',
      licenseNumber: targetDoctor.licenseNumber || '',
      clinicName: targetDoctor.clinicName || '',
      clinicAddress: targetDoctor.clinicAddress || '',
      experience: targetDoctor.experience || '',
      qualifications: targetDoctor.qualifications || '',
      profileImage: targetDoctor.profileImage || '',
      isConnected
    };

    res.json({
      success: true,
      message: 'Doctor verified successfully',
      doctor: verifiedDoctor
    });
  } catch (error) {
    console.error('Verify doctor error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify doctor details' });
  }
});

/**
 * @route   GET /api/network/directory
 * @desc    Privacy-filtered doctor lookup (requires search query or returns empty)
 * @access  Private (Doctor only)
 */
router.get('/directory', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';

    if (!search || search.length < 2) {
      return res.json({
        success: true,
        count: 0,
        doctors: [],
        message: 'Please provide a search term (email, name, or doctor ID) to find colleagues'
      });
    }

    const allUsers = await getUsers();
    const currentNetwork = await getDoctorNetwork(doctorId);
    const connectedIds = new Set(currentNetwork.map(n => String(n.connectedDoctorId)));

    const matchingDoctors = allUsers
      .filter(u => 
        u.role === 'doctor' &&
        u.id !== doctorId &&
        (u.status || 'active') === 'active' &&
        (
          (u.email && u.email.toLowerCase().includes(search)) ||
          (`${u.firstName} ${u.lastName}`.toLowerCase().includes(search)) ||
          (u.id && String(u.id).toLowerCase() === search) ||
          (u.specialization && u.specialization.toLowerCase().includes(search))
        )
      )
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
      count: matchingDoctors.length,
      doctors: matchingDoctors
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

/**
 * Haversine formula — returns distance in km between two lat/lng points
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Classify a user into a professional category for the nearby tab
 */
function classifyProfessional(user) {
  const role = (user.role || '').toLowerCase();
  const spec = (user.specialization || '').toLowerCase();

  if (role === 'pharmacist') return 'pharmacist';
  if (role === 'nurse') return 'nurse';
  if (role === 'doctor') {
    if (spec.includes('physiother') || spec.includes('physio')) return 'physiotherapist';
    if (spec.includes('dent') || spec.includes('orthodont')) return 'dentist';
    if (spec.includes('lab') || spec.includes('patholog') || spec.includes('diagnostic')) return 'lab';
    if (spec.includes('diet') || spec.includes('nutrition')) return 'dietitian';
    if (spec.includes('ayurved') || spec.includes('homeopath') || spec.includes('unani')) return 'alternative';
    return 'doctor';
  }
  return 'other';
}

/**
 * @route   GET /api/network/nearby
 * @desc    Discover healthcare professionals within a radius (default 15km)
 * @access  Private (Doctor only)
 * @query   lat (required), lng (required), radius (optional, default 15), type (optional, default 'all')
 */
router.get('/nearby', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 15;
    const typeFilter = (req.query.type || 'all').toLowerCase();

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'lat and lng query parameters are required (numeric values)'
      });
    }

    // Calculate approximate bounding box for high efficiency (1 deg lat ~ 111 km)
    const latDelta = (radius / 111) + 0.02;
    const lngDelta = (radius / (111 * Math.cos(lat * Math.PI / 180) || 111)) + 0.02;

    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLng = lng - lngDelta;
    const maxLng = lng + lngDelta;

    // Fetch active healthcare practitioners within the spatial bounding box
    const { results: allUsers } = await queryD1(
      `SELECT id, firstName, lastName, email, role, specialization,
              clinicName, clinicAddress, clinicPlaceName, clinicLatitude, clinicLongitude,
              profileImage, experience, qualifications, phone, contactNumber,
              pharmacyName, pharmacyAddress, whatsapp
       FROM users
       WHERE status = 'active'
         AND role IN ('doctor', 'nurse', 'pharmacist')
         AND id != ?
         AND clinicLatitude IS NOT NULL
         AND clinicLongitude IS NOT NULL
         AND CAST(clinicLatitude AS REAL) BETWEEN ? AND ?
         AND CAST(clinicLongitude AS REAL) BETWEEN ? AND ?`,
      [doctorId, minLat, maxLat, minLng, maxLng]
    );

    if (!allUsers || allUsers.length === 0) {
      return res.json({ success: true, count: 0, radius, nearby: [] });
    }

    // Get current doctor's network for isConnected flag
    const currentNetwork = await getDoctorNetwork(doctorId);
    const connectedIds = new Set(currentNetwork.map(n => String(n.connectedDoctorId)));

    // Calculate exact Haversine distance and filter by exact radius
    const nearby = allUsers
      .map(u => {
        const uLat = parseFloat(u.clinicLatitude);
        const uLng = parseFloat(u.clinicLongitude);
        if (isNaN(uLat) || isNaN(uLng)) return null;

        const dist = haversineDistance(lat, lng, uLat, uLng);
        const category = classifyProfessional(u);
        const displayName = u.role === 'doctor'
          ? `Dr. ${u.firstName} ${u.lastName}`
          : `${u.firstName} ${u.lastName}`;
        return {
          id: u.id,
          name: displayName,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          role: u.role,
          category,
          specialization: u.specialization || '',
          clinicName: u.clinicName || u.pharmacyName || '',
          clinicAddress: u.clinicAddress || u.pharmacyAddress || '',
          clinicPlaceName: u.clinicPlaceName || '',
          profileImage: u.profileImage || '',
          experience: u.experience || '',
          qualifications: u.qualifications || '',
          phone: u.phone || u.contactNumber || '',
          whatsapp: u.whatsapp || '',
          distance: Math.round(dist * 10) / 10,
          isConnected: connectedIds.has(String(u.id))
        };
      })
      .filter(u => u !== null && u.distance <= radius)
      .filter(u => typeFilter === 'all' || u.category === typeFilter || u.role === typeFilter)
      .sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      count: nearby.length,
      radius,
      nearby
    });
  } catch (error) {
    console.error('Get nearby professionals error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve nearby professionals' });
  }
});

module.exports = router;

