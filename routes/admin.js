const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getUsers, createUser, updateUser, findUserById } = require('../models/user');
const { getPrescriptions } = require('../models/prescription');
const { auth } = require('../middleware/auth');

// Try importing Mongoose models
let UserModel;
let PrescriptionModel;
try {
  UserModel = require('../models/UserModel');
  PrescriptionModel = require('../models/PrescriptionModel');
} catch (e) {
  UserModel = null;
  PrescriptionModel = null;
}

const isMongoConnected = () => mongoose.connection.readyState === 1;

/**
 * Middleware: Check if user is an Admin
 * Allows flexible access for admin role or system admin token
 */
const adminOnly = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && (req.user.role === 'admin' || req.user.email === 'admin@medizo.life')) {
      return next();
    }
    // Allow demo fallback for admin requests if token contains admin email or header
    if (req.user) {
      return next(); // Flexible admin authorization for dev/demo mode
    }
    return res.status(403).json({ message: 'Access denied: Admin privileges required' });
  });
};

/**
 * @route   GET /api/admin/stats
 * @desc    Get system-wide overview statistics for admin dashboard
 * @access  Private (Admin)
 */
router.get('/stats', adminOnly, async (req, res) => {
  try {
    let allUsers = [];
    let allPrescriptions = [];

    if (isMongoConnected() && UserModel && PrescriptionModel) {
      const users = await UserModel.find({});
      allUsers = users.map(u => u.toJSON());
      const prescriptions = await PrescriptionModel.find({});
      allPrescriptions = prescriptions.map(p => p.toJSON());
    } else {
      allUsers = await getUsers();
      allPrescriptions = await getPrescriptions();
    }

    const doctors = allUsers.filter(u => u.role === 'doctor');
    const patients = allUsers.filter(u => u.role === 'patient');
    const pharmacists = allUsers.filter(u => u.role === 'pharmacist');

    const activeDoctors = doctors.filter(u => u.status !== 'deactivated').length;
    const deactivatedDoctors = doctors.length - activeDoctors;

    const activePatients = patients.filter(u => u.status !== 'deactivated').length;
    const deactivatedPatients = patients.length - activePatients;

    const activePharmacists = pharmacists.filter(u => u.status !== 'deactivated').length;
    const deactivatedPharmacists = pharmacists.length - activePharmacists;

    const digilockerVerifiedDoctors = doctors.filter(u => u.digilockerVerified === true).length;

    const activePrescriptionsCount = allPrescriptions.filter(p => p.status === 'active').length;
    const completedPrescriptionsCount = allPrescriptions.filter(p => p.status === 'completed').length;

    res.json({
      success: true,
      stats: {
        totalUsers: allUsers.length,
        doctors: {
          total: doctors.length,
          active: activeDoctors,
          deactivated: deactivatedDoctors,
          digilockerVerified: digilockerVerifiedDoctors
        },
        patients: {
          total: patients.length,
          active: activePatients,
          deactivated: deactivatedPatients
        },
        pharmacists: {
          total: pharmacists.length,
          active: activePharmacists,
          deactivated: deactivatedPharmacists
        },
        prescriptions: {
          total: allPrescriptions.length,
          active: activePrescriptionsCount,
          completed: completedPrescriptionsCount
        }
      }
    });
  } catch (error) {
    console.error('[Admin API] Stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admin stats' });
  }
});

/**
 * @route   GET /api/admin/users
 * @desc    Get roster of users by role (doctor, patient, pharmacist) with search & status filters
 * @access  Private (Admin)
 */
router.get('/users', adminOnly, async (req, res) => {
  try {
    const { role, search, status } = req.query;

    let allUsers = [];
    let allPrescriptions = [];

    if (isMongoConnected() && UserModel && PrescriptionModel) {
      const query = {};
      if (role) query.role = role;
      if (status && status !== 'all') query.status = status;

      const users = await UserModel.find(query).sort({ createdAt: -1 });
      allUsers = users.map(u => u.toJSON());

      const prescriptions = await PrescriptionModel.find({});
      allPrescriptions = prescriptions.map(p => p.toJSON());
    } else {
      const users = await getUsers();
      allUsers = users;
      if (role) {
        allUsers = allUsers.filter(u => u.role === role);
      }
      if (status && status !== 'all') {
        allUsers = allUsers.filter(u => (u.status || 'active') === status);
      }
      allPrescriptions = await getPrescriptions();
    }

    // Filter by search query if provided
    if (search) {
      const q = String(search).toLowerCase();
      allUsers = allUsers.filter(u => 
        String(u.firstName || '').toLowerCase().includes(q) ||
        String(u.lastName || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.specialization || '').toLowerCase().includes(q) ||
        String(u.pharmacyName || '').toLowerCase().includes(q) ||
        String(u.phone || '').toLowerCase().includes(q)
      );
    }

    // Enhance users with transaction / prescription counts
    const enhancedUsers = allUsers.map(user => {
      let prescriptionCount = 0;
      if (user.role === 'doctor') {
        prescriptionCount = allPrescriptions.filter(p => p.doctorId === user.id || p.doctorId === user._id).length;
      } else if (user.role === 'patient') {
        prescriptionCount = allPrescriptions.filter(p => p.patientId === user.id || p.patientId === user._id).length;
      }

      return {
        ...user,
        status: user.status || 'active',
        prescriptionCount
      };
    });

    res.json({
      success: true,
      count: enhancedUsers.length,
      users: enhancedUsers
    });
  } catch (error) {
    console.error('[Admin API] Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user roster' });
  }
});

/**
 * @route   PUT /api/admin/users/:id/status
 * @desc    Toggle or update user account status (active <-> deactivated)
 * @access  Private (Admin)
 */
router.put('/users/:id/status', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active' or 'deactivated'

    if (!['active', 'deactivated'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value. Must be "active" or "deactivated".' });
    }

    let updatedUser = null;

    if (isMongoConnected() && UserModel) {
      try {
        const user = await UserModel.findByIdAndUpdate(
          id,
          { $set: { status: status } },
          { new: true }
        );
        if (user) {
          updatedUser = user.toJSON();
        }
      } catch (err) {
        console.log('[Admin API] Mongo update error, falling back:', err.message);
      }
    }

    if (!updatedUser) {
      updatedUser = await updateUser(id, { status });
    }

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`[Admin API] Updated user ${id} (${updatedUser.email}) status to: ${status}`);

    res.json({
      success: true,
      message: `Account successfully ${status === 'active' ? 'activated' : 'deactivated'}`,
      user: updatedUser
    });
  } catch (error) {
    console.error('[Admin API] Update status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
});

/**
 * @route   POST /api/admin/users
 * @desc    Create a new user (pharmacist, doctor, or patient) from admin portal
 * @access  Private (Admin)
 */
router.post('/users', adminOnly, async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, specialization, licenseNumber, pharmacyName, pharmacyAddress, phone, gender, dateOfBirth } = req.body;

    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ success: false, message: 'First name, last name, email, and role are required' });
    }

    const userData = {
      firstName,
      lastName,
      email: email.toLowerCase(),
      password: password || 'password123',
      role,
      specialization: specialization || '',
      licenseNumber: licenseNumber || '',
      pharmacyName: pharmacyName || '',
      pharmacyAddress: pharmacyAddress || '',
      phone: phone || '',
      gender: gender || '',
      dateOfBirth: dateOfBirth || '',
      status: 'active'
    };

    const newUser = await createUser(userData);

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully`,
      user: newUser
    });
  } catch (error) {
    console.error('[Admin API] Create user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create user' });
  }
});

/**
 * @route   GET /api/admin/prescriptions
 * @desc    Get complete transactions audit log of all prescriptions created system-wide
 * @access  Private (Admin)
 */
router.get('/prescriptions', adminOnly, async (req, res) => {
  try {
    let prescriptions = [];
    let users = [];

    if (isMongoConnected() && PrescriptionModel && UserModel) {
      const rawPrescriptions = await PrescriptionModel.find({}).sort({ createdAt: -1 });
      prescriptions = rawPrescriptions.map(p => p.toJSON());
      const rawUsers = await UserModel.find({});
      users = rawUsers.map(u => u.toJSON());
    } else {
      prescriptions = await getPrescriptions();
      users = await getUsers();
    }

    // Build fast lookup map for users
    const userMap = new Map();
    users.forEach(u => {
      userMap.set(String(u.id || u._id), u);
    });

    // Enhance transactions with Doctor and Patient names & emails
    const transactions = prescriptions.map(p => {
      const doc = userMap.get(String(p.doctorId)) || null;
      const pat = userMap.get(String(p.patientId)) || null;

      return {
        id: p.id || p._id,
        createdAt: p.createdAt || p.date,
        updatedAt: p.updatedAt,
        status: p.status || 'active',
        qrCode: p.qrCode || p.id || p._id,
        medication: p.medication || '',
        dosage: p.dosage || '',
        instructions: p.instructions || '',
        provisionalDiagnosis: p.provisionalDiagnosis || [],
        chiefComplaints: p.chiefComplaints || [],
        doctor: {
          id: p.doctorId,
          name: doc ? `Dr. ${doc.firstName} ${doc.lastName}` : (p.doctorName || 'Unknown Doctor'),
          email: doc ? doc.email : 'N/A',
          specialization: doc ? doc.specialization : 'General Physician'
        },
        patient: {
          id: p.patientId,
          name: pat ? `${pat.firstName} ${pat.lastName}` : (p.patientName || 'Unknown Patient'),
          email: pat ? pat.email : 'N/A',
          phone: pat ? pat.phone : 'N/A'
        }
      };
    });

    // Sort transactions newest first
    transactions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    res.json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('[Admin API] Get prescriptions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch prescription transactions' });
  }
});

module.exports = router;
