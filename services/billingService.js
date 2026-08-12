const { findPrescriptionById } = require('../models/prescription');
const { createBill, findBillsByPrescriptionId, findBillById, updateBillStatus } = require('../models/billingModel');
const { findUserById } = require('../models/user');

/**
 * Automatically generate a structured bill from an existing prescription
 * @param {string} prescriptionId
 * @param {string} doctorId - ID of doctor requesting bill generation
 * @param {Object} options - Custom fee overrides, tax, discount, notes
 * @returns {Promise<Object>} The generated bill object with items
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
  const activeBill = existingBills.find(b => ['draft', 'issued', 'paid'].includes(b.status));

  if (activeBill && !options.allowDuplicate) {
    throw new Error(`An active bill (${activeBill.billNumber}) already exists for this prescription with status "${activeBill.status}".`);
  }

  const items = [];

  // 1. Consultation Fee
  const consultationFee = options.consultationFee !== undefined ? Number(options.consultationFee) : 500;
  if (consultationFee > 0) {
    items.push({
      itemType: 'consultation',
      description: `Doctor Consultation - ${prescription.doctorSpecialization || 'General Physician'}`,
      quantity: 1,
      unitPrice: consultationFee,
      totalPrice: consultationFee,
      notes: `Prescription #${prescription.id.substring(0, 8)}`
    });
  }

  // 2. Prescribed Medications
  const medications = prescription.medications || [];
  if (medications.length > 0) {
    for (const med of medications) {
      const medName = med.name || 'Prescribed Medication';
      const dosage = med.dosage || '';
      const duration = med.duration || '';
      const desc = `${medName} ${dosage} (${duration})`.trim();
      const medPrice = options.medicationPrices?.[medName] || 0;

      items.push({
        itemType: 'medication',
        description: desc,
        quantity: 1,
        unitPrice: medPrice,
        totalPrice: medPrice,
        notes: med.frequency || ''
      });
    }
  } else if (prescription.medication) {
    items.push({
      itemType: 'medication',
      description: `${prescription.medication} ${prescription.dosage || ''}`.trim(),
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
      notes: prescription.frequency || ''
    });
  }

  // 3. Tests / Investigations Required
  const tests = prescription.testsRequired || prescription.investigations || [];
  if (Array.isArray(tests) && tests.length > 0) {
    for (const test of tests) {
      const testName = typeof test === 'string' ? test : (test.name || 'Lab Investigation');
      const testPrice = options.testPrices?.[testName] || 0;
      items.push({
        itemType: 'investigation',
        description: `Lab Test: ${testName}`,
        quantity: 1,
        unitPrice: testPrice,
        totalPrice: testPrice,
        notes: 'Advised investigation'
      });
    }
  }

  // 4. Custom additional items
  if (Array.isArray(options.customItems)) {
    for (const cItem of options.customItems) {
      const qty = Number(cItem.quantity) || 1;
      const price = Number(cItem.unitPrice) || 0;
      items.push({
        itemType: cItem.itemType || 'procedure',
        description: cItem.description || 'Procedure/Service',
        quantity: qty,
        unitPrice: price,
        totalPrice: qty * price,
        notes: cItem.notes || ''
      });
    }
  }

  // Compute subtotal
  const subtotal = items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
  const tax = Number(options.tax) || 0;
  const discount = Number(options.discount) || 0;
  const totalAmount = Math.max(0, subtotal + tax - discount);

  const billData = {
    patientId: prescription.patientId,
    familyProfileId: prescription.accountId || '',
    patientDisplayId: prescription.patientDisplayId || '',
    doctorId: prescription.doctorId,
    prescriptionId: prescription.id,
    subtotal,
    tax,
    discount,
    totalAmount,
    currency: options.currency || 'INR',
    status: options.initialStatus || 'issued',
    notes: options.notes || `Generated from Prescription dated ${prescription.createdAt ? new Date(prescription.createdAt).toLocaleDateString() : 'recent'}`,
    dueDate: options.dueDate || '',
    createdBy: doctorId
  };

  return await createBill(billData, items);
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

  return await updateBillStatus(billId, 'paid', {
    paymentMethod: paymentData.paymentMethod || 'online',
    paymentTransactionRef: paymentData.paymentTransactionRef || `TXN-${Date.now()}`,
    receiptNumber: paymentData.receiptNumber || `RCP-${bill.billNumber.replace('INV-', '')}`,
    paymentNotes: paymentData.paymentNotes || `Paid by ${user.firstName || ''} ${user.lastName || ''}`.trim(),
    paidAt: new Date().toISOString()
  });
}

module.exports = {
  generateBillFromPrescription,
  recordBillPayment
};
