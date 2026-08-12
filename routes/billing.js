const express = require('express');
const router = express.Router();
const { auth, doctor, doctorOrAdmin } = require('../middleware/auth');
const { generateBillFromPrescription, recordBillPayment } = require('../services/billingService');
const { createBill, findBillById, findBillsByPatientId, findBillsByDoctorId, updateBillStatus, updateBill } = require('../models/billingModel');
const { canAccessBill } = require('../services/authzService');
const { findUserById } = require('../models/user');

/**
 * @route   POST /api/billing/generate-from-prescription/:prescriptionId
 * @desc    Generate an itemized bill from a prescription
 * @access  Private (Doctor or Admin)
 */
router.post('/generate-from-prescription/:prescriptionId', doctorOrAdmin, async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const doctorId = req.user.id;
    const { consultationFee, customItems, tax, discount, notes, dueDate, allowDuplicate } = req.body;

    const bill = await generateBillFromPrescription(prescriptionId, doctorId, {
      consultationFee,
      customItems,
      tax,
      discount,
      notes,
      dueDate,
      allowDuplicate,
      userRole: req.user.role
    });

    res.status(201).json({
      success: true,
      message: `Bill ${bill.billNumber} generated successfully`,
      bill
    });
  } catch (error) {
    console.error('Generate bill error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to generate bill' });
  }
});

/**
 * @route   POST /api/billing
 * @desc    Create a custom medical bill
 * @access  Private (Doctor or Admin)
 */
router.post('/', doctorOrAdmin, async (req, res) => {
  try {
    const { patientId, familyProfileId, items, subtotal, tax, discount, totalAmount, currency, notes, dueDate } = req.body;

    if (!patientId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'patientId and an array of items are required' });
    }

    const billData = {
      patientId,
      familyProfileId: familyProfileId || '',
      doctorId: req.user.id,
      subtotal,
      tax,
      discount,
      totalAmount,
      currency: currency || 'INR',
      status: 'issued',
      notes: notes || '',
      dueDate: dueDate || '',
      createdBy: req.user.id
    };

    const bill = await createBill(billData, items);

    res.status(201).json({
      success: true,
      message: `Bill ${bill.billNumber} created successfully`,
      bill
    });
  } catch (error) {
    console.error('Create bill error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create bill' });
  }
});

/**
 * @route   GET /api/billing/my-bills
 * @desc    Get all bills for logged-in patient
 * @access  Private (Patient)
 */
router.get('/my-bills', auth, async (req, res) => {
  try {
    const patientId = req.user.id;
    const bills = await findBillsByPatientId(patientId);

    // Enhance bills with doctor details
    const enhanced = await Promise.all(bills.map(async (b) => {
      const doc = await findUserById(b.doctorId);
      return {
        ...b,
        doctorName: doc ? `Dr. ${doc.firstName} ${doc.lastName}` : 'Attending Physician',
        doctorSpecialization: doc ? doc.specialization || 'General Practitioner' : 'General Practitioner',
        clinicName: doc ? doc.clinicName || 'Medizo Clinic' : 'Medizo Clinic'
      };
    }));

    res.json({ success: true, count: enhanced.length, bills: enhanced });
  } catch (error) {
    console.error('Get my bills error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve bills' });
  }
});

/**
 * @route   GET /api/billing/doctor
 * @desc    Get all bills issued by logged-in doctor
 * @access  Private (Doctor)
 */
router.get('/doctor', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const bills = await findBillsByDoctorId(doctorId);

    // Enhance with patient details
    const enhanced = await Promise.all(bills.map(async (b) => {
      const pat = await findUserById(b.patientId);
      return {
        ...b,
        patientName: pat ? `${pat.firstName} ${pat.lastName}` : 'Patient',
        patientEmail: pat ? pat.email : '',
        patientPhone: pat ? pat.phone : ''
      };
    }));

    res.json({ success: true, count: enhanced.length, bills: enhanced });
  } catch (error) {
    console.error('Get doctor bills error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve doctor bills' });
  }
});

/**
 * @route   GET /api/billing/:id
 * @desc    Get bill details by ID
 * @access  Private
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const bill = await findBillById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to view this bill' });
    }

    const doc = await findUserById(bill.doctorId);
    const pat = await findUserById(bill.patientId);

    res.json({
      success: true,
      bill: {
        ...bill,
        doctor: doc ? { id: doc.id, name: `Dr. ${doc.firstName} ${doc.lastName}`, specialization: doc.specialization, clinicName: doc.clinicName, clinicAddress: doc.clinicAddress, phone: doc.phone } : null,
        patient: pat ? { id: pat.id, name: `${pat.firstName} ${pat.lastName}`, email: pat.email, phone: pat.phone, address: pat.address } : null
      }
    });
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve bill' });
  }
});

/**
 * @route   PUT /api/billing/:id/status
 * @desc    Update bill status (e.g. issued, paid, cancelled, refunded)
 * @access  Private (Doctor or Admin)
 */
router.put('/:id/status', doctorOrAdmin, async (req, res) => {
  try {
    const { status, paymentMethod, paymentTransactionRef, paymentNotes, receiptNumber } = req.body;

    const updated = await updateBillStatus(req.params.id, status, {
      paymentMethod,
      paymentTransactionRef,
      paymentNotes,
      receiptNumber
    });

    res.json({
      success: true,
      message: `Bill status updated to "${status}"`,
      bill: updated
    });
  } catch (error) {
    console.error('Update bill status error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update bill status' });
  }
});

/**
 * @route   POST /api/billing/:id/payment
 * @desc    Record a payment against a bill
 * @access  Private
 */
router.post('/:id/payment', auth, async (req, res) => {
  try {
    const { paymentMethod, paymentTransactionRef, paymentNotes, receiptNumber } = req.body;

    const bill = await findBillById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to make payments on this bill' });
    }

    const updated = await recordBillPayment(req.params.id, {
      paymentMethod,
      paymentTransactionRef,
      paymentNotes,
      receiptNumber
    }, req.user);

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      bill: updated
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to record payment' });
  }
});

module.exports = router;
