const express = require('express');
const router = express.Router();
const { auth, doctor, doctorOrAdmin } = require('../middleware/auth');
const { generateBillFromPrescription, recordBillPayment, checkFollowupEligibility, dispatchBillToPatient } = require('../services/billingService');
const { 
  createBill, 
  findBillById, 
  findBillsByPatientId, 
  findBillsByDoctorId, 
  updateBillStatus, 
  updateBill, 
  recordPaymentTransaction,
  cancelBill,
  getDoctorDayCloseSummary,
  getClinicServices,
  createClinicService
} = require('../models/billingModel');
const { canAccessBill } = require('../services/authzService');
const { findUserById } = require('../models/user');
const { generateBillPDF } = require('../services/pdfGenerator');

/**
 * @route   GET /api/billing/check-followup/:patientId
 * @desc    Check if a patient is eligible for free / discounted follow-up
 * @access  Private (Doctor or Admin)
 */
router.get('/check-followup/:patientId', doctorOrAdmin, async (req, res) => {
  try {
    const { patientId } = req.params;
    const doc = await findUserById(req.user.id);
    const followUpDays = doc?.followUpDays !== undefined ? Number(doc.followUpDays) : 7;
    const result = await checkFollowupEligibility(patientId, req.user.id, followUpDays);
    res.json({ success: true, ...result, followUpFee: doc?.followUpFee !== undefined ? Number(doc.followUpFee) : 0 });
  } catch (error) {
    console.error('Check followup error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to check follow-up eligibility' });
  }
});

/**
 * @route   POST /api/billing/generate-from-prescription/:prescriptionId
 * @desc    Generate an itemized Indian medical bill from a prescription
 * @access  Private (Doctor or Admin)
 */
router.post('/generate-from-prescription/:prescriptionId', doctorOrAdmin, async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const doctorId = req.user.id;
    const { 
      consultationFee, 
      visitType,
      customItems, 
      tax, 
      discount, 
      concessionReason,
      gstType,
      gstRate,
      applyGst,
      markAsPaid,
      amountPaid,
      paymentMethod,
      sendToPatient,
      dispatchChannel,
      notes, 
      dueDate, 
      allowDuplicate 
    } = req.body;

    const bill = await generateBillFromPrescription(prescriptionId, doctorId, {
      consultationFee,
      visitType,
      customItems,
      tax,
      discount,
      concessionReason,
      gstType,
      gstRate,
      applyGst,
      markAsPaid,
      amountPaid,
      paymentMethod,
      sendToPatient,
      dispatchChannel,
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
    const { 
      patientId, 
      familyProfileId, 
      items, 
      subtotal, 
      tax, 
      discount, 
      totalAmount, 
      amountPaid,
      gstType,
      gstRate,
      doctorGstin,
      patientGstin,
      concessionReason,
      sendToPatient,
      dispatchChannel,
      currency, 
      notes, 
      dueDate 
    } = req.body;

    if (!patientId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'patientId and an array of items are required' });
    }

    const doc = await findUserById(req.user.id);

    const billData = {
      patientId,
      familyProfileId: familyProfileId || '',
      doctorId: req.user.id,
      subtotal,
      tax,
      discount,
      totalAmount,
      amountPaid: Number(amountPaid) || 0,
      gstType: gstType || 'exempt',
      gstRate: Number(gstRate) || 0,
      doctorGstin: doctorGstin || doc?.clinicGstin || '',
      patientGstin: patientGstin || '',
      concessionReason: concessionReason || '',
      sendToPatient: sendToPatient !== undefined ? (sendToPatient ? 1 : 0) : 1,
      dispatchChannel: dispatchChannel || 'whatsapp_sms',
      upiVpa: doc?.clinicUpiVpa || '',
      currency: currency || 'INR',
      status: Number(amountPaid) >= Number(totalAmount) && Number(totalAmount) > 0 ? 'paid' : (Number(amountPaid) > 0 ? 'partially_paid' : 'issued'),
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
    const userEmail = req.user.email || '';
    const bills = await findBillsByPatientId(patientId, { email: userEmail });

    // Enhance bills with doctor details
    const enhanced = await Promise.all(bills.map(async (b) => {
      const doc = await findUserById(b.doctorId);
      return {
        ...b,
        doctorName: doc ? `Dr. ${doc.firstName} ${doc.lastName}` : 'Attending Physician',
        doctorSpecialization: doc ? doc.specialization || 'General Practitioner' : 'General Practitioner',
        clinicName: doc ? doc.clinicName || 'Medizo Clinic' : 'Medizo Clinic',
        clinicUpiVpa: doc ? doc.clinicUpiVpa || '' : ''
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
 * @route   GET /api/billing/doctor/day-close
 * @desc    Get daily OPD collection and cash/UPI reconciliation report
 * @access  Private (Doctor)
 */
router.get('/doctor/day-close', doctor, async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await getDoctorDayCloseSummary(req.user.id, date);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Get day-close report error:', error);
    // Return an empty summary instead of 500 so the BillingPortal can still load
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];
    res.json({
      success: true,
      summary: {
        date: targetDate,
        doctorId: req.user.id,
        billCount: 0,
        paymentCount: 0,
        totalBilled: 0,
        totalCollected: 0,
        cashTotal: 0,
        upiTotal: 0,
        cardTotal: 0,
        otherTotal: 0,
        pendingBalance: 0,
        totalDiscount: 0,
        totalTax: 0,
        bills: [],
        payments: []
      }
    });
  }
});

/**
 * @route   GET /api/billing/services
 * @desc    Get doctor's clinic service price catalog
 * @access  Private (Doctor)
 */
router.get('/services', doctor, async (req, res) => {
  try {
    const services = await getClinicServices(req.user.id);
    res.json({ success: true, services });
  } catch (error) {
    console.error('Get clinic services error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve clinic services' });
  }
});

/**
 * @route   POST /api/billing/services
 * @desc    Add a service to clinic price catalog
 * @access  Private (Doctor)
 */
router.post('/services', doctor, async (req, res) => {
  try {
    const { serviceName, itemType, defaultPrice, hsnSacCode, isGstExempt, gstRate } = req.body;
    if (!serviceName) {
      return res.status(400).json({ success: false, message: 'serviceName is required' });
    }
    const service = await createClinicService(req.user.id, {
      serviceName,
      itemType,
      defaultPrice,
      hsnSacCode,
      isGstExempt,
      gstRate
    });
    res.status(201).json({ success: true, service });
  } catch (error) {
    console.error('Create clinic service error:', error);
    res.status(500).json({ success: false, message: 'Failed to create service' });
  }
});

/**
 * @route   GET /api/billing/:id/pdf
 * @desc    Download server-generated Indian Bill of Supply / Tax Invoice PDF
 * @access  Private
 */
router.get('/:id/pdf', auth, async (req, res) => {
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

    let pdfBuffer;
    try {
      pdfBuffer = await generateBillPDF(bill, doc || {}, pat || {});
    } catch (pdfError) {
      console.error('PDF generation engine error:', pdfError?.stack || pdfError);
      return res.status(500).json({
        success: false,
        message: `PDF generation failed: ${pdfError?.message || 'Unknown rendering error'}. Please try downloading the bill details as text instead.`
      });
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'PDF generation returned empty output. Bill data may be incomplete.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${bill.billNumber || 'Bill'}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Generate bill PDF error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate PDF' });
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
        doctor: doc ? { id: doc.id, name: `Dr. ${doc.firstName} ${doc.lastName}`, specialization: doc.specialization, clinicName: doc.clinicName, clinicAddress: doc.clinicAddress, phone: doc.phone, clinicUpiVpa: doc.clinicUpiVpa } : null,
        patient: pat ? { id: pat.id, name: `${pat.firstName} ${pat.lastName}`, email: pat.email, phone: pat.phone, address: pat.address } : null
      }
    });
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve bill' });
  }
});

/**
 * @route   POST /api/billing/:id/payments
 * @desc    Record a payment transaction in the ledger (Cash / UPI / Card / Split)
 * @access  Private
 */
router.post('/:id/payments', auth, async (req, res) => {
  try {
    const { amount, amountPaid, paymentMode, paymentMethod, upiTransactionRef, paymentTransactionRef, notes, receiptNumber } = req.body;

    const bill = await findBillById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to record payments for this bill' });
    }

    const updated = await recordPaymentTransaction(req.params.id, {
      amountPaid: amount || amountPaid,
      paymentMode: paymentMode || paymentMethod,
      upiTransactionRef: upiTransactionRef || paymentTransactionRef,
      receiptNumber,
      notes
    }, req.user);

    res.json({
      success: true,
      message: 'Payment recorded successfully in ledger',
      bill: updated
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to record payment' });
  }
});

/**
 * @route   POST /api/billing/:id/dispatch
 * @desc    Dispatch bill via WhatsApp / SMS / Email
 * @access  Private (Doctor or Admin)
 */
router.post('/:id/dispatch', doctorOrAdmin, async (req, res) => {
  try {
    const { channels } = req.body;
    const result = await dispatchBillToPatient(req.params.id, channels || 'whatsapp_sms');
    res.json(result);
  } catch (error) {
    console.error('Dispatch bill error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to dispatch bill' });
  }
});

/**
 * @route   POST /api/billing/:id/cancel
 * @desc    Cancel or void a bill with audit reason
 * @access  Private (Doctor or Admin)
 */
router.post('/:id/cancel', doctorOrAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const updated = await cancelBill(req.params.id, reason, req.user.id);
    res.json({
      success: true,
      message: 'Bill has been cancelled',
      bill: updated
    });
  } catch (error) {
    console.error('Cancel bill error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to cancel bill' });
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
 * @desc    Record payment (legacy alias for /payments)
 * @access  Private
 */
router.post('/:id/payment', auth, async (req, res) => {
  try {
    const bill = await findBillById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to make payments on this bill' });
    }

    const updated = await recordBillPayment(req.params.id, req.body, req.user);

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
