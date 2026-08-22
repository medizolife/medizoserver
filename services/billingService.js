const { findPrescriptionById } = require('../models/prescription');
const { createBill, findBillsByPrescriptionId, findBillById, updateBillStatus, recordPaymentTransaction } = require('../models/billingModel');
const { findUserById } = require('../models/user');
const { queryD1 } = require('../config/d1-client');

/**
 * Check if a patient is eligible for free / discounted follow-up with the doctor
 * @param {string} patientId
 * @param {string} doctorId
 * @param {number} followUpDays
 * @returns {Promise<Object>}
 */
async function checkFollowupEligibility(patientId, doctorId, followUpDays = 7) {
  try {
    const { results } = await queryD1(`
      SELECT id, createdAt, doctorId, patientId 
      FROM prescriptions 
      WHERE doctorId = ? AND (patientId = ? OR accountId = ?)
      ORDER BY createdAt DESC 
      LIMIT 1
    `, [doctorId, patientId, patientId]);

    if (!results || results.length === 0) {
      return { isEligible: false, reason: 'First consultation with this doctor' };
    }

    const lastRx = results[0];
    const lastDate = new Date(lastRx.createdAt);
    const now = new Date();
    const diffMs = now - lastDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= followUpDays) {
      return {
        isEligible: true,
        lastPrescriptionId: lastRx.id,
        lastVisitDate: lastRx.createdAt,
        daysAgo: diffDays,
        validityWindow: followUpDays,
        message: `Eligible for Free Follow-up (Last visit was ${diffDays} day${diffDays === 1 ? '' : 's'} ago)`
      };
    } else {
      return {
        isEligible: false,
        lastPrescriptionId: lastRx.id,
        lastVisitDate: lastRx.createdAt,
        daysAgo: diffDays,
        validityWindow: followUpDays,
        message: `Follow-up validity expired (${diffDays} days ago, allowed ${followUpDays} days)`
      };
    }
  } catch (error) {
    console.error('billingService.checkFollowupEligibility error:', error);
    return { isEligible: false, error: error.message };
  }
}

/**
 * Generate standard NPCI UPI Intent URI for QR code and mobile app deep links
 * @param {string} upiVpa
 * @param {string} payeeName
 * @param {number} amount
 * @param {string} billNumber
 * @param {string} billId
 * @returns {string}
 */
function generateUpiIntentUri(upiVpa, payeeName, amount, billNumber, billId) {
  if (!upiVpa) return '';
  const cleanVpa = encodeURIComponent(upiVpa.trim());
  const cleanName = encodeURIComponent((payeeName || 'Medizo Healthcare').trim());
  const cleanAmount = Number(amount || 0).toFixed(2);
  const cleanNote = encodeURIComponent(`Bill ${billNumber || billId}`);
  const cleanRef = encodeURIComponent(billId || String(Date.now()));

  return `upi://pay?pa=${cleanVpa}&pn=${cleanName}&am=${cleanAmount}&cu=INR&tn=${cleanNote}&tr=${cleanRef}`;
}

/**
 * Automatically generate a structured Indian clinical bill from a prescription
 * @param {string} prescriptionId
 * @param {string} doctorId - ID of doctor requesting bill generation
 * @param {Object} options - Custom fee overrides, GST rules, payment, discount, notes
 * @returns {Promise<Object>} The generated bill object with items and ledger details
 */
async function generateBillFromPrescription(prescriptionId, doctorId, options = {}) {
  const prescription = await findPrescriptionById(prescriptionId);
  if (!prescription) {
    throw new Error('Prescription not found');
  }

  // Verify doctor matches prescription (unless admin override)
  if (doctorId && prescription.doctorId !== doctorId && options.userRole !== 'admin') {
    throw new Error('You can only generate bills for your own prescriptions');
  }

  // Duplicate prevention: check if an active bill already exists
  const existingBills = await findBillsByPrescriptionId(prescriptionId);
  const activeBill = existingBills.find(b => ['draft', 'issued', 'partially_paid', 'paid'].includes(b.status));

  if (activeBill && !options.allowDuplicate) {
    throw new Error(`An active bill (${activeBill.billNumber}) already exists for this prescription with status "${activeBill.status}".`);
  }

  // Fetch doctor rate card for default fees and UPI settings
  const doc = await findUserById(prescription.doctorId);
  const docConsultFee = doc?.consultationFee !== undefined ? Number(doc.consultationFee) : 500;
  const docFollowUpFee = doc?.followUpFee !== undefined ? Number(doc.followUpFee) : 0;
  const docFollowUpDays = doc?.followUpDays !== undefined ? Number(doc.followUpDays) : 7;
  const clinicUpiVpa = options.upiVpa || doc?.clinicUpiVpa || '';
  const doctorGstin = options.doctorGstin || doc?.clinicGstin || '';

  // Check follow-up eligibility if visitType is not specified
  let consultationFee = docConsultFee;
  let visitType = options.visitType || 'standard';

  if (options.consultationFee !== undefined) {
    consultationFee = Number(options.consultationFee);
  } else if (visitType === 'follow_up') {
    consultationFee = docFollowUpFee;
  } else {
    // Auto-check follow-up eligibility
    const followUpCheck = await checkFollowupEligibility(prescription.patientId, prescription.doctorId, docFollowUpDays);
    if (followUpCheck.isEligible && options.autoFollowUp !== false) {
      consultationFee = docFollowUpFee;
      visitType = 'follow_up';
    }
  }

  const items = [];

  // 1. Consultation Fee
  const consultDesc = visitType === 'follow_up' 
    ? `Follow-up Consultation - ${prescription.doctorSpecialization || 'General Physician'}`
    : `Doctor Consultation - ${prescription.doctorSpecialization || 'General Physician'}`;

  items.push({
    itemType: 'consultation',
    description: consultDesc,
    quantity: 1,
    unitPrice: consultationFee,
    totalPrice: consultationFee,
    hsnSacCode: '999312',
    gstRate: 0,
    discountAmount: 0,
    notes: `Prescription #${prescription.id.substring(0, 8)} (${visitType === 'follow_up' ? 'Follow-up' : 'Consultation'})`
  });

  // 2. Prescribed Medications (if dispensed or priced in clinic)
  const medications = prescription.medications || [];
  if (medications.length > 0 && options.includeMedications) {
    for (const med of medications) {
      const medName = med.name || 'Prescribed Medication';
      const dosage = med.dosage || '';
      const duration = med.duration || '';
      const desc = `${medName} ${dosage} (${duration})`.trim();
      const medPrice = options.medicationPrices?.[medName] || 0;

      if (medPrice > 0) {
        items.push({
          itemType: 'medication',
          description: desc,
          quantity: 1,
          unitPrice: medPrice,
          totalPrice: medPrice,
          hsnSacCode: '3004', // Pharmaceutical preparations
          gstRate: Number(options.medicineGstRate) || 12,
          notes: med.frequency || ''
        });
      }
    }
  }

  // 3. Tests / Investigations Required (in-house lab items)
  const tests = prescription.testsRequired || prescription.investigations || [];
  if (Array.isArray(tests) && tests.length > 0 && options.includeTests) {
    for (const test of tests) {
      const testName = typeof test === 'string' ? test : (test.name || 'Lab Investigation');
      const testPrice = options.testPrices?.[testName] || 0;
      if (testPrice > 0) {
        items.push({
          itemType: 'investigation',
          description: `Lab Test: ${testName}`,
          quantity: 1,
          unitPrice: testPrice,
          totalPrice: testPrice,
          hsnSacCode: '999312',
          gstRate: 0,
          notes: 'In-house diagnostic investigation'
        });
      }
    }
  }

  // 4. Custom additional procedures (Dressing, ECG, Nebulization, etc.)
  if (Array.isArray(options.customItems)) {
    for (const cItem of options.customItems) {
      const qty = Number(cItem.quantity) || 1;
      const price = Number(cItem.unitPrice) || 0;
      const itemDisc = Number(cItem.discountAmount) || 0;
      const tot = Math.max(0, (qty * price) - itemDisc);
      items.push({
        itemType: cItem.itemType || 'procedure',
        description: cItem.description || 'Clinic Procedure',
        quantity: qty,
        unitPrice: price,
        totalPrice: tot,
        hsnSacCode: cItem.hsnSacCode || '999312',
        gstRate: Number(cItem.gstRate) || 0,
        discountAmount: itemDisc,
        notes: cItem.notes || ''
      });
    }
  }

  // Compute Subtotal & GST
  const subtotal = items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
  const discount = Number(options.discount) || 0;
  const taxableValue = Math.max(0, subtotal - discount);

  const gstType = options.gstType || (options.applyGst ? 'cgst_sgst' : 'exempt');
  const gstRate = gstType === 'exempt' ? 0 : (Number(options.gstRate) || (gstType === 'cgst_sgst' || gstType === 'igst' ? 18 : 0));
  
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (gstType === 'cgst_sgst' && gstRate > 0) {
    const halfRate = gstRate / 2;
    cgstAmount = (taxableValue * halfRate) / 100;
    sgstAmount = (taxableValue * halfRate) / 100;
  } else if (gstType === 'igst' && gstRate > 0) {
    igstAmount = (taxableValue * gstRate) / 100;
  }

  const totalTax = cgstAmount + sgstAmount + igstAmount;
  const totalAmount = taxableValue + totalTax;

  // Initial Payment & Balance
  const isPaidInitial = options.isPaid || options.markAsPaid;
  const amountPaid = isPaidInitial ? totalAmount : (Number(options.amountPaid) || 0);
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const initialStatus = options.initialStatus || (amountPaid >= totalAmount && totalAmount > 0 ? 'paid' : (amountPaid > 0 ? 'partially_paid' : 'issued'));

  // Generate UPI Intent URI
  const docName = doc ? `Dr. ${doc.firstName} ${doc.lastName}` : 'Attending Physician';
  const upiQrData = clinicUpiVpa ? generateUpiIntentUri(clinicUpiVpa, docName, balanceDue > 0 ? balanceDue : totalAmount, `RX-${prescription.id.substring(0, 8)}`, prescription.id) : '';

  const billData = {
    patientId: prescription.patientId,
    familyProfileId: prescription.accountId || '',
    patientDisplayId: prescription.patientDisplayId || '',
    doctorId: prescription.doctorId,
    prescriptionId: prescription.id,
    subtotal,
    tax: totalTax,
    discount,
    totalAmount,
    amountPaid,
    balanceDue,
    gstType,
    gstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    doctorGstin,
    patientGstin: options.patientGstin || '',
    hsnSacCode: '999312',
    concessionReason: options.concessionReason || (visitType === 'follow_up' ? 'follow_up' : ''),
    sendToPatient: options.sendToPatient !== undefined ? (options.sendToPatient ? 1 : 0) : 1,
    dispatchChannel: options.dispatchChannel || 'whatsapp_sms',
    upiVpa: clinicUpiVpa,
    upiQrData,
    currency: options.currency || 'INR',
    status: initialStatus,
    paymentMethod: options.paymentMethod || (isPaidInitial ? 'cash' : ''),
    paymentTransactionRef: options.paymentTransactionRef || '',
    notes: options.notes || `Generated from Prescription dated ${prescription.createdAt ? new Date(prescription.createdAt).toLocaleDateString() : 'recent'}`,
    dueDate: options.dueDate || '',
    createdBy: doctorId
  };

  const createdBill = await createBill(billData, items);

  // If sendToPatient is active, dispatch notifications (WhatsApp/SMS simulation)
  if (billData.sendToPatient && initialStatus !== 'draft') {
    await dispatchBillToPatient(createdBill.id, billData.dispatchChannel);
  }

  return createdBill;
}

/**
 * Dispatch bill details and payment link to patient via SMS / WhatsApp / Email
 * @param {string} billId
 * @param {string} channels
 * @returns {Promise<Object>}
 */
async function dispatchBillToPatient(billId, channels = 'whatsapp_sms') {
  try {
    const bill = await findBillById(billId);
    if (!bill) throw new Error('Bill not found');

    const patient = await findUserById(bill.patientId);
    const doctor = await findUserById(bill.doctorId);

    const patPhone = patient?.phone || patient?.contactNumber || '';
    const patName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : 'Patient';
    const docName = doctor ? `Dr. ${doctor.firstName} ${doctor.lastName}`.trim() : 'Doctor';

    // Format DLT compliant message payload
    const msg = `Dear ${patName}, your medical bill ${bill.billNumber} of Rs ${bill.totalAmount} from ${docName} is ready. Status: ${bill.status.toUpperCase()}. View/Pay: https://medizo.life/bills/${bill.id} - MEDIZO`;

    console.log(`[DISPATCH: ${channels.toUpperCase()}] To: ${patPhone || patient?.email} | Message: ${msg}`);

    return {
      success: true,
      dispatched: true,
      channels,
      recipient: patPhone || patient?.email,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('billingService.dispatchBillToPatient error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Record a payment against an issued bill
 * @param {string} billId
 * @param {Object} paymentData - method, transactionRef, amount, notes
 * @param {Object} user - User making or recording payment
 * @returns {Promise<Object>}
 */
async function recordBillPayment(billId, paymentData, user) {
  const bill = await findBillById(billId);
  if (!bill) {
    throw new Error('Bill not found');
  }

  if (bill.status === 'paid') {
    throw new Error('Bill is already paid in full');
  }
  if (bill.status === 'cancelled') {
    throw new Error('Cannot record payment for a cancelled bill');
  }

  return await recordPaymentTransaction(billId, {
    amountPaid: paymentData.amount || paymentData.amountPaid || bill.balanceDue || bill.totalAmount,
    paymentMode: paymentData.paymentMode || paymentData.paymentMethod || 'cash',
    upiTransactionRef: paymentData.upiTransactionRef || paymentData.paymentTransactionRef || `TXN-${Date.now()}`,
    receiptNumber: paymentData.receiptNumber || `RCP-${bill.billNumber.replace(/^(BOS|INV)-/, '')}`,
    notes: paymentData.paymentNotes || paymentData.notes || `Paid by ${user.firstName || ''} ${user.lastName || ''}`.trim()
  }, user);
}

module.exports = {
  checkFollowupEligibility,
  generateUpiIntentUri,
  generateBillFromPrescription,
  dispatchBillToPatient,
  recordBillPayment
};
