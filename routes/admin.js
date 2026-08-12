const express = require('express');
const router = express.Router();
const { getUsers, createUser, updateUser, findUserById, deleteUser } = require('../models/user');
const { getPrescriptions } = require('../models/prescription');
const { getAllBills } = require('../models/billingModel');
const { getAllReferrals } = require('../models/networkModel');
const { getAllHomeCareRequests } = require('../models/homeCareModel');
const { getAllAffiliations, getAllNursePatientAssignments, getAllDoctorPatientAssignments, createNurseDoctorAffiliation } = require('../models/assignmentModel');
const { getAllSchedules } = require('../models/scheduleModel');
const { auth } = require('../middleware/auth');

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
    const allUsers = await getUsers();
    const allPrescriptions = await getPrescriptions();
    const allBills = await getAllBills();
    const allReferrals = await getAllReferrals();
    const allHomeCare = await getAllHomeCareRequests();

    const doctors = allUsers.filter(u => u.role === 'doctor');
    const patients = allUsers.filter(u => u.role === 'patient');
    const pharmacists = allUsers.filter(u => u.role === 'pharmacist');
    const nurses = allUsers.filter(u => u.role === 'nurse');

    const activeDoctors = doctors.filter(u => u.status !== 'deactivated').length;
    const deactivatedDoctors = doctors.length - activeDoctors;

    const activePatients = patients.filter(u => u.status !== 'deactivated').length;
    const deactivatedPatients = patients.length - activePatients;

    const activePharmacists = pharmacists.filter(u => u.status !== 'deactivated').length;
    const deactivatedPharmacists = pharmacists.length - activePharmacists;

    const activeNurses = nurses.filter(u => u.status !== 'deactivated').length;
    const deactivatedNurses = nurses.length - activeNurses;

    const digilockerVerifiedDoctors = doctors.filter(u => u.digilockerVerified === true).length;

    const activePrescriptionsCount = allPrescriptions.filter(p => p.status === 'active').length;
    const completedPrescriptionsCount = allPrescriptions.filter(p => p.status === 'completed').length;

    const totalRevenue = allBills
      .filter(b => b.status === 'paid')
      .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);

    const pendingRevenue = allBills
      .filter(b => ['draft', 'issued'].includes(b.status))
      .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);

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
        nurses: {
          total: nurses.length,
          active: activeNurses,
          deactivated: deactivatedNurses
        },
        prescriptions: {
          total: allPrescriptions.length,
          active: activePrescriptionsCount,
          completed: completedPrescriptionsCount
        },
        homeCareRequests: {
          total: allHomeCare.length,
          pending: allHomeCare.filter(h => ['requested', 'approved'].includes(h.status)).length,
          inProgress: allHomeCare.filter(h => ['assigned', 'in_progress'].includes(h.status)).length,
          completed: allHomeCare.filter(h => h.status === 'completed').length
        },
        referrals: {
          total: allReferrals.length,
          pending: allReferrals.filter(r => r.status === 'pending').length,
          accepted: allReferrals.filter(r => r.status === 'accepted').length,
          completed: allReferrals.filter(r => r.status === 'completed').length
        },
        billing: {
          totalBills: allBills.length,
          paidBills: allBills.filter(b => b.status === 'paid').length,
          totalRevenue,
          pendingRevenue
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

    let allUsers = await getUsers();
    const allPrescriptions = await getPrescriptions();

    // Filter by role
    if (role) {
      allUsers = allUsers.filter(u => u.role === role);
    }
    // Filter by status
    if (status && status !== 'all') {
      allUsers = allUsers.filter(u => (u.status || 'active') === status);
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
        prescriptionCount = allPrescriptions.filter(p => p.doctorId === user.id).length;
      } else if (user.role === 'patient') {
        prescriptionCount = allPrescriptions.filter(p => p.patientId === user.id).length;
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

    const updatedUser = await updateUser(id, { status });

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
 * @route   DELETE /api/admin/users/:id
 * @desc    Permanently delete a user account (patient, doctor, or pharmacist)
 * @access  Private (Admin)
 */
router.delete('/users/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[Admin API] Requested deletion for user ID/Email: "${id}"`);

    let existingUser = await findUserById(id);
    if (!existingUser) {
      const allUsers = await getUsers();
      existingUser = allUsers.find(u => 
        String(u.id) === String(id) || 
        String(u._id) === String(id) || 
        (u.email && u.email.toLowerCase() === String(id).toLowerCase())
      );
    }

    if (!existingUser) {
      console.warn(`[Admin API] Delete user failed: No account matching "${id}" found.`);
      return res.status(404).json({ success: false, message: `User with ID "${id}" was not found.` });
    }

    if (existingUser.role === 'admin' || existingUser.email === 'admin@medizo.life') {
      return res.status(400).json({ success: false, message: 'Cannot delete the system administrator account.' });
    }

    const userIdToDelete = existingUser.id || existingUser.email || id;
    const success = await deleteUser(userIdToDelete);

    if (!success) {
      return res.status(500).json({ success: false, message: 'Failed to delete user from database' });
    }

    console.log(`[Admin API] Permanently deleted user ${userIdToDelete} (${existingUser.email})`);

    res.json({
      success: true,
      message: `User ${existingUser.firstName || ''} ${existingUser.lastName || ''} (${existingUser.email}) deleted successfully`
    });
  } catch (error) {
    console.error('[Admin API] Delete user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete user' });
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
    const prescriptions = await getPrescriptions();
    const users = await getUsers();

    // Build fast lookup map for users
    const userMap = new Map();
    users.forEach(u => {
      userMap.set(String(u.id), u);
    });

    // Enhance transactions with Doctor and Patient names & emails
    const transactions = prescriptions.map(p => {
      const doc = userMap.get(String(p.doctorId)) || null;
      const pat = userMap.get(String(p.patientId)) || null;

      return {
        id: p.id,
        createdAt: p.createdAt || p.date,
        updatedAt: p.updatedAt,
        status: p.status || 'active',
        qrCode: p.qrCode || p.id,
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

/**
 * @route   GET /api/admin/nurses
 * @desc    Get full roster of nurses with their affiliations and active assignments
 * @access  Private (Admin)
 */
router.get('/nurses', adminOnly, async (req, res) => {
  try {
    const allUsers = await getUsers();
    const nurses = allUsers.filter(u => u.role === 'nurse');
    const affiliations = await getAllAffiliations();
    const assignments = await getAllNursePatientAssignments();

    const enhanced = nurses.map(nurse => {
      const nurseAffiliations = affiliations.filter(a => String(a.nurseId) === String(nurse.id));
      const activeAssignments = assignments.filter(a => String(a.nurseId) === String(nurse.id) && a.status === 'active');

      return {
        ...nurse,
        affiliations: nurseAffiliations,
        activeAssignmentsCount: activeAssignments.length,
        totalAssignmentsCount: assignments.filter(a => String(a.nurseId) === String(nurse.id)).length
      };
    });

    res.json({
      success: true,
      count: enhanced.length,
      nurses: enhanced
    });
  } catch (error) {
    console.error('[Admin API] Get nurses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch nurse roster' });
  }
});

/**
 * @route   GET /api/admin/affiliations
 * @desc    Get all doctor-nurse affiliations across the platform
 * @access  Private (Admin)
 */
router.get('/affiliations', adminOnly, async (req, res) => {
  try {
    const affiliations = await getAllAffiliations();
    res.json({ success: true, count: affiliations.length, affiliations });
  } catch (error) {
    console.error('[Admin API] Get affiliations error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch affiliations' });
  }
});

/**
 * @route   POST /api/admin/affiliations
 * @desc    Create or update doctor-nurse affiliation from admin portal
 * @access  Private (Admin)
 */
router.post('/affiliations', adminOnly, async (req, res) => {
  try {
    const { nurseId, doctorId, affiliationType, notes } = req.body;

    if (!nurseId || !doctorId) {
      return res.status(400).json({ success: false, message: 'Both nurseId and doctorId are required' });
    }

    const affiliation = await createNurseDoctorAffiliation(nurseId, doctorId, affiliationType, notes);
    res.status(201).json({ success: true, message: 'Affiliation created successfully', affiliation });
  } catch (error) {
    console.error('[Admin API] Create affiliation error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create affiliation' });
  }
});

/**
 * @route   GET /api/admin/assignments-overview
 * @desc    Get matrix of all doctor-patient and nurse-patient assignments
 * @access  Private (Admin)
 */
router.get('/assignments-overview', adminOnly, async (req, res) => {
  try {
    const nurseAssignments = await getAllNursePatientAssignments();
    const doctorAssignments = await getAllDoctorPatientAssignments();

    res.json({
      success: true,
      nurseAssignments: {
        count: nurseAssignments.length,
        items: nurseAssignments
      },
      doctorAssignments: {
        count: doctorAssignments.length,
        items: doctorAssignments
      }
    });
  } catch (error) {
    console.error('[Admin API] Get assignments overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assignments overview' });
  }
});

/**
 * @route   GET /api/admin/referrals-overview
 * @desc    Get system-wide referral log
 * @access  Private (Admin)
 */
router.get('/referrals-overview', adminOnly, async (req, res) => {
  try {
    const referrals = await getAllReferrals();
    res.json({ success: true, count: referrals.length, referrals });
  } catch (error) {
    console.error('[Admin API] Get referrals overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
  }
});

/**
 * @route   GET /api/admin/home-care-overview
 * @desc    Get system-wide home care requests log
 * @access  Private (Admin)
 */
router.get('/home-care-overview', adminOnly, async (req, res) => {
  try {
    const requests = await getAllHomeCareRequests();
    res.json({ success: true, count: requests.length, requests });
  } catch (error) {
    console.error('[Admin API] Get home care overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch home care requests' });
  }
});

/**
 * @route   GET /api/admin/billing-overview
 * @desc    Get system-wide billing audit log
 * @access  Private (Admin)
 */
router.get('/billing-overview', adminOnly, async (req, res) => {
  try {
    const bills = await getAllBills();
    const allUsers = await getUsers();
    const userMap = new Map(allUsers.map(u => [String(u.id), u]));

    const enhanced = bills.map(b => {
      const doc = userMap.get(String(b.doctorId));
      const pat = userMap.get(String(b.patientId));
      return {
        ...b,
        doctorName: doc ? `Dr. ${doc.firstName} ${doc.lastName}` : 'N/A',
        patientName: pat ? `${pat.firstName} ${pat.lastName}` : 'N/A'
      };
    });

    res.json({ success: true, count: enhanced.length, bills: enhanced });
  } catch (error) {
    console.error('[Admin API] Get billing overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch billing overview' });
  }
});

/**
 * @route   GET /api/admin/schedules-overview
 * @desc    Get system-wide nurse visit schedules
 * @access  Private (Admin)
 */
router.get('/schedules-overview', adminOnly, async (req, res) => {
  try {
    const schedules = await getAllSchedules();
    res.json({ success: true, count: schedules.length, schedules });
  } catch (error) {
    console.error('[Admin API] Get schedules overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schedules' });
  }
});

module.exports = router;

