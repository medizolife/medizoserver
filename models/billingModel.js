const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

/**
 * Generate a unique bill invoice or bill-of-supply number:
 * - BOS-YYYYMM-XXXX for GST Exempt Healthcare Services (SAC 999312)
 * - INV-YYYYMM-XXXX for Tax Invoices
 */
async function generateBillNumber(isGstExempt = true) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = isGstExempt ? `BOS-${yearMonth}-` : `INV-${yearMonth}-`;

  try {
    const { results } = await queryD1(
      "SELECT billNumber FROM bills WHERE billNumber LIKE ? ORDER BY createdAt DESC LIMIT 1",
      [`${prefix}%`]
    );

    let nextNum = 1;
    if (results && results.length > 0) {
      const lastNumber = results[0].billNumber;
      const lastSeq = parseInt(lastNumber.replace(prefix, ''), 10);
      if (!isNaN(lastSeq)) {
        nextNum = lastSeq + 1;
      }
    }
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  } catch (error) {
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}${randomHex}`;
  }
}

/**
 * Create a new bill with associated line items
 * @param {Object} billData
 * @param {Array} items
 * @returns {Promise<Object>}
 */
async function createBill(billData, items = []) {
  try {
    const id = billData.id || crypto.randomBytes(16).toString('hex');
    const isExempt = billData.gstType !== 'cgst_sgst' && billData.gstType !== 'igst' && (!billData.gstRate || billData.gstRate === 0);
    const billNumber = billData.billNumber || await generateBillNumber(isExempt);
    const now = new Date().toISOString();

    // Calculate line totals if items provided
    let calculatedSubtotal = 0;
    const sanitizedItems = items.map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const discountAmount = Number(item.discountAmount) || 0;
      const totalPrice = Number(item.totalPrice) !== undefined ? Number(item.totalPrice) : Math.max(0, (quantity * unitPrice) - discountAmount);
      calculatedSubtotal += totalPrice;
      return {
        id: item.id || crypto.randomBytes(16).toString('hex'),
        billId: id,
        itemType: item.itemType || 'consultation',
        description: item.description || 'Medical Service',
        quantity,
        unitPrice,
        totalPrice,
        hsnSacCode: item.hsnSacCode || '999312',
        gstRate: Number(item.gstRate) || 0,
        discountAmount,
        notes: item.notes || ''
      };
    });

    const subtotal = billData.subtotal !== undefined ? Number(billData.subtotal) : calculatedSubtotal;
    const discount = Number(billData.discount) || 0;
    const taxableValue = Math.max(0, subtotal - discount);

    // GST calculations
    const gstType = billData.gstType || (isExempt ? 'exempt' : 'cgst_sgst');
    const gstRate = isExempt ? 0 : (Number(billData.gstRate) || 0);
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

    const totalTax = Number(billData.tax) !== undefined ? Number(billData.tax) : (cgstAmount + sgstAmount + igstAmount);
    const totalAmount = billData.totalAmount !== undefined ? Number(billData.totalAmount) : (taxableValue + totalTax);
    const amountPaid = Number(billData.amountPaid) || 0;
    const balanceDue = Math.max(0, totalAmount - amountPaid);
    const status = billData.status || (amountPaid >= totalAmount && totalAmount > 0 ? 'paid' : (amountPaid > 0 ? 'partially_paid' : 'draft'));

    const sqlBill = `
      INSERT INTO bills (
        id, billNumber, patientId, familyProfileId, patientDisplayId,
        doctorId, prescriptionId, subtotal, tax, discount, totalAmount,
        amountPaid, balanceDue, gstType, gstRate, cgstAmount, sgstAmount, igstAmount,
        doctorGstin, patientGstin, hsnSacCode, concessionReason, sendToPatient,
        dispatchChannel, upiVpa, upiQrData, currency, status, paymentMethod,
        paymentTransactionRef, paidAt, paymentNotes, receiptNumber, dueDate, notes,
        createdBy, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `;

    const billParams = [
      id,
      billNumber,
      billData.patientId,
      billData.familyProfileId || '',
      billData.patientDisplayId || '',
      billData.doctorId,
      billData.prescriptionId || '',
      subtotal,
      totalTax,
      discount,
      totalAmount,
      amountPaid,
      balanceDue,
      gstType,
      gstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      billData.doctorGstin || '',
      billData.patientGstin || '',
      billData.hsnSacCode || '999312',
      billData.concessionReason || '',
      billData.sendToPatient !== undefined ? (billData.sendToPatient ? 1 : 0) : 1,
      billData.dispatchChannel || 'whatsapp_sms',
      billData.upiVpa || '',
      billData.upiQrData || '',
      billData.currency || 'INR',
      status,
      billData.paymentMethod || '',
      billData.paymentTransactionRef || '',
      billData.paidAt || (status === 'paid' ? now : null),
      billData.paymentNotes || '',
      billData.receiptNumber || '',
      billData.dueDate || '',
      billData.notes || '',
      billData.createdBy || billData.doctorId,
      now,
      now
    ];

    const { results: billResults } = await queryD1(sqlBill, billParams);
    const createdBill = billResults && billResults.length > 0 ? billResults[0] : { id, billNumber, ...billData, subtotal, tax: totalTax, discount, totalAmount, amountPaid, balanceDue, status };

    // Insert bill items
    for (const item of sanitizedItems) {
      await queryD1(`
        INSERT INTO bill_items (id, billId, itemType, description, quantity, unitPrice, totalPrice, hsnSacCode, gstRate, discountAmount, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        item.id,
        id,
        item.itemType,
        item.description,
        item.quantity,
        item.unitPrice,
        item.totalPrice,
        item.hsnSacCode,
        item.gstRate,
        item.discountAmount,
        item.notes,
        now,
        now
      ]);
    }

    // If initial payment was made, record in bill_payments
    if (amountPaid > 0) {
      await queryD1(`
        INSERT INTO bill_payments (id, billId, amountPaid, paymentMode, upiTransactionRef, receiptNumber, collectedBy, notes, paidAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        crypto.randomBytes(16).toString('hex'),
        id,
        amountPaid,
        billData.paymentMethod || 'cash',
        billData.paymentTransactionRef || '',
        billData.receiptNumber || `RCP-${billNumber.replace(/^(BOS|INV)-/, '')}`,
        billData.createdBy || billData.doctorId,
        billData.paymentNotes || 'Initial payment',
        now,
        now,
        now
      ]);
    }

    return {
      ...createdBill,
      items: sanitizedItems,
      payments: amountPaid > 0 ? [{ amountPaid, paymentMode: billData.paymentMethod || 'cash', paidAt: now }] : []
    };
  } catch (error) {
    console.error('billingModel.createBill error:', error);
    throw error;
  }
}

/**
 * Get line items for a bill
 * @param {string} billId
 * @returns {Promise<Array>}
 */
async function getBillItems(billId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM bill_items WHERE billId = ? ORDER BY createdAt ASC',
      [billId]
    );
    return results || [];
  } catch (error) {
    console.error('billingModel.getBillItems error:', error);
    return [];
  }
}

/**
 * Get payment transactions for a bill
 * @param {string} billId
 * @returns {Promise<Array>}
 */
async function getBillPayments(billId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM bill_payments WHERE billId = ? ORDER BY paidAt ASC',
      [billId]
    );
    return results || [];
  } catch (error) {
    console.error('billingModel.getBillPayments error:', error);
    return [];
  }
}

/**
 * Find bill by ID with line items and payment transactions
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findBillById(id) {
  if (!id) return null;
  try {
    const { results } = await queryD1('SELECT * FROM bills WHERE id = ? LIMIT 1', [id]);
    if (!results || results.length === 0) return null;
    const bill = results[0];
    bill.items = await getBillItems(bill.id);
    bill.payments = await getBillPayments(bill.id);
    return bill;
  } catch (error) {
    console.error('billingModel.findBillById error:', error);
    return null;
  }
}

/**
 * Find bill by billNumber
 * @param {string} billNumber
 * @returns {Promise<Object|null>}
 */
async function findBillByNumber(billNumber) {
  if (!billNumber) return null;
  try {
    const { results } = await queryD1('SELECT * FROM bills WHERE billNumber = ? LIMIT 1', [billNumber]);
    if (!results || results.length === 0) return null;
    const bill = results[0];
    bill.items = await getBillItems(bill.id);
    bill.payments = await getBillPayments(bill.id);
    return bill;
  } catch (error) {
    console.error('billingModel.findBillByNumber error:', error);
    return null;
  }
}

/**
 * Find bills for a patient, family profiles, or linked prescriptions
 * @param {string} patientId
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
async function findBillsByPatientId(patientId, options = {}) {
  try {
    const userEmail = (options.email || '').trim().toLowerCase();

    // Fetch family profile IDs for this account if available
    let profileIds = [];
    try {
      const { results: profiles } = await queryD1('SELECT id FROM family_profiles WHERE accountId = ?', [patientId]);
      if (profiles && profiles.length > 0) {
        profileIds = profiles.map(p => p.id).filter(Boolean);
      }
    } catch (e) {}

    let whereClauses = ['patientId = ?', 'familyProfileId = ?'];
    let queryParams = [patientId, patientId];

    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => '?').join(',');
      whereClauses.push(`patientId IN (${placeholders})`);
      queryParams.push(...profileIds);
    }

    if (userEmail) {
      whereClauses.push(`prescriptionId IN (SELECT id FROM prescriptions WHERE patientId = ? OR lower(patientEmail) = ?)`);
      queryParams.push(patientId, userEmail);
    } else {
      whereClauses.push(`prescriptionId IN (SELECT id FROM prescriptions WHERE patientId = ?)`);
      queryParams.push(patientId);
    }

    const sql = `SELECT DISTINCT * FROM bills WHERE (${whereClauses.join(' OR ')}) ORDER BY createdAt DESC`;
    const { results } = await queryD1(sql, queryParams);
    const bills = results || [];
    for (const b of bills) {
      b.items = await getBillItems(b.id);
      b.payments = await getBillPayments(b.id);
    }
    return bills;
  } catch (error) {
    console.error('billingModel.findBillsByPatientId error:', error);
    return [];
  }
}

/**
 * Find bills issued by a doctor
 * @param {string} doctorId
 * @returns {Promise<Array>}
 */
async function findBillsByDoctorId(doctorId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM bills WHERE doctorId = ? ORDER BY createdAt DESC',
      [doctorId]
    );
    const bills = results || [];
    for (const b of bills) {
      b.items = await getBillItems(b.id);
      b.payments = await getBillPayments(b.id);
    }
    return bills;
  } catch (error) {
    console.error('billingModel.findBillsByDoctorId error:', error);
    return [];
  }
}

/**
 * Find bills linked to a prescription
 * @param {string} prescriptionId
 * @returns {Promise<Array>}
 */
async function findBillsByPrescriptionId(prescriptionId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM bills WHERE prescriptionId = ? ORDER BY createdAt DESC',
      [prescriptionId]
    );
    const bills = results || [];
    for (const b of bills) {
      b.items = await getBillItems(b.id);
      b.payments = await getBillPayments(b.id);
    }
    return bills;
  } catch (error) {
    console.error('billingModel.findBillsByPrescriptionId error:', error);
    return [];
  }
}

/**
 * Get all bills system-wide (for admin overview)
 * @returns {Promise<Array>}
 */
async function getAllBills() {
  try {
    const { results } = await queryD1('SELECT * FROM bills ORDER BY createdAt DESC');
    const bills = results || [];
    for (const b of bills) {
      b.items = await getBillItems(b.id);
      b.payments = await getBillPayments(b.id);
    }
    return bills;
  } catch (error) {
    console.error('billingModel.getAllBills error:', error);
    return [];
  }
}

/**
 * Record a payment against an issued bill in the ledger
 * Supports split payments (Cash + UPI) and updates remaining balance
 * @param {string} billId
 * @param {Object} paymentData
 * @param {Object} user
 * @returns {Promise<Object>}
 */
async function recordPaymentTransaction(billId, paymentData, user) {
  try {
    const bill = await findBillById(billId);
    if (!bill) throw new Error('Bill not found');

    const payingAmount = Number(paymentData.amountPaid || paymentData.amount || 0);
    if (payingAmount <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const currentPaid = Number(bill.amountPaid) || 0;
    const totalAmount = Number(bill.totalAmount) || 0;
    const newAmountPaid = currentPaid + payingAmount;
    const newBalanceDue = Math.max(0, totalAmount - newAmountPaid);
    const newStatus = newBalanceDue <= 0 ? 'paid' : 'partially_paid';
    const now = new Date().toISOString();

    const paymentId = crypto.randomBytes(16).toString('hex');
    const rcptNumber = paymentData.receiptNumber || `RCP-${bill.billNumber.replace(/^(BOS|INV)-/, '')}-${bill.payments ? bill.payments.length + 1 : 1}`;

    // 1. Insert transaction into bill_payments
    await queryD1(`
      INSERT INTO bill_payments (id, billId, amountPaid, paymentMode, upiTransactionRef, receiptNumber, collectedBy, notes, paidAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      paymentId,
      billId,
      payingAmount,
      paymentData.paymentMode || paymentData.paymentMethod || 'cash',
      paymentData.upiTransactionRef || paymentData.paymentTransactionRef || '',
      rcptNumber,
      user?.id || bill.doctorId,
      paymentData.notes || paymentData.paymentNotes || '',
      paymentData.paidAt || now,
      now,
      now
    ]);

    // 2. Update bills summary
    const sql = `
      UPDATE bills SET 
        amountPaid = ?,
        balanceDue = ?,
        status = ?,
        paymentMethod = ?,
        paymentTransactionRef = ?,
        receiptNumber = ?,
        paidAt = CASE WHEN ? = 'paid' THEN ? ELSE paidAt END,
        updatedAt = datetime('now')
      WHERE id = ?
    `;

    await queryD1(sql, [
      newAmountPaid,
      newBalanceDue,
      newStatus,
      paymentData.paymentMode || paymentData.paymentMethod || bill.paymentMethod || 'cash',
      paymentData.upiTransactionRef || paymentData.paymentTransactionRef || bill.paymentTransactionRef || '',
      rcptNumber,
      newStatus,
      now,
      billId
    ]);

    return await findBillById(billId);
  } catch (error) {
    console.error('billingModel.recordPaymentTransaction error:', error);
    throw error;
  }
}

/**
 * Update bill status
 * @param {string} id
 * @param {string} status
 * @param {Object} paymentData
 * @returns {Promise<Object|null>}
 */
async function updateBillStatus(id, status, paymentData = {}) {
  try {
    const current = await findBillById(id);
    if (!current) throw new Error('Bill not found');

    const validStatuses = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid bill status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const setClauses = ['status = ?', "updatedAt = datetime('now')"];
    const values = [status];

    if (paymentData.paymentMethod !== undefined) {
      setClauses.push('paymentMethod = ?');
      values.push(paymentData.paymentMethod);
    }
    if (paymentData.paymentTransactionRef !== undefined) {
      setClauses.push('paymentTransactionRef = ?');
      values.push(paymentData.paymentTransactionRef);
    }
    if (paymentData.receiptNumber !== undefined) {
      setClauses.push('receiptNumber = ?');
      values.push(paymentData.receiptNumber);
    }
    if (paymentData.paymentNotes !== undefined) {
      setClauses.push('paymentNotes = ?');
      values.push(paymentData.paymentNotes);
    }
    if (status === 'paid') {
      setClauses.push('amountPaid = totalAmount');
      setClauses.push('balanceDue = 0.0');
      const paidAt = paymentData.paidAt || new Date().toISOString();
      setClauses.push('paidAt = ?');
      values.push(paidAt);
      if (!paymentData.receiptNumber && !current.receiptNumber) {
        const rcpt = `RCP-${current.billNumber.replace(/^(BOS|INV)-/, '')}`;
        setClauses.push('receiptNumber = ?');
        values.push(rcpt);
      }
    }

    values.push(id);
    const sql = `UPDATE bills SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);

    return await findBillById(id);
  } catch (error) {
    console.error('billingModel.updateBillStatus error:', error);
    throw error;
  }
}

/**
 * Cancel or void a bill with reason
 * @param {string} id
 * @param {string} reason
 * @param {string} voidedBy
 * @returns {Promise<Object>}
 */
async function cancelBill(id, reason = '', voidedBy = '') {
  try {
    const current = await findBillById(id);
    if (!current) throw new Error('Bill not found');

    const updatedNotes = `${current.notes || ''}\n[VOIDED on ${new Date().toLocaleDateString()}: ${reason || 'Cancelled by doctor'}]`.trim();
    await queryD1(`
      UPDATE bills SET 
        status = 'cancelled',
        notes = ?,
        updatedAt = datetime('now')
      WHERE id = ?
    `, [updatedNotes, id]);

    return await findBillById(id);
  } catch (error) {
    console.error('billingModel.cancelBill error:', error);
    throw error;
  }
}

/**
 * Get daily OPD collection summary for a doctor (Day-Close report)
 * @param {string} doctorId
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Object>}
 */
async function getDoctorDayCloseSummary(doctorId, dateStr) {
  try {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    
    // Bills created on that day
    const { results: dayBills } = await queryD1(`
      SELECT * FROM bills 
      WHERE doctorId = ? 
      AND date(createdAt) = date(?)
    `, [doctorId, targetDate]);

    // Payments collected on that day
    const { results: dayPayments } = await queryD1(`
      SELECT p.*, b.billNumber, b.doctorId 
      FROM bill_payments p
      JOIN bills b ON p.billId = b.id
      WHERE b.doctorId = ?
      AND date(p.paidAt) = date(?)
    `, [doctorId, targetDate]);

    let totalBilled = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let pendingBalance = 0;

    (dayBills || []).forEach(b => {
      totalBilled += Number(b.totalAmount) || 0;
      totalDiscount += Number(b.discount) || 0;
      totalTax += Number(b.tax) || 0;
      pendingBalance += Number(b.balanceDue) || 0;
    });

    let totalCollected = 0;
    let cashTotal = 0;
    let upiTotal = 0;
    let cardTotal = 0;
    let otherTotal = 0;

    (dayPayments || []).forEach(p => {
      const amt = Number(p.amountPaid) || 0;
      totalCollected += amt;
      const mode = (p.paymentMode || '').toLowerCase();
      if (mode === 'cash') cashTotal += amt;
      else if (mode === 'upi') upiTotal += amt;
      else if (mode === 'card') cardTotal += amt;
      else otherTotal += amt;
    });

    return {
      date: targetDate,
      doctorId,
      billCount: (dayBills || []).length,
      paymentCount: (dayPayments || []).length,
      totalBilled,
      totalCollected,
      cashTotal,
      upiTotal,
      cardTotal,
      otherTotal,
      pendingBalance,
      totalDiscount,
      totalTax,
      bills: dayBills || [],
      payments: dayPayments || []
    };
  } catch (error) {
    console.error('billingModel.getDoctorDayCloseSummary error:', error);
    throw error;
  }
}

/**
 * Clinic Services Price Master CRUD
 */
async function getClinicServices(doctorId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM clinic_services WHERE doctorId = ? AND isActive = 1 ORDER BY serviceName ASC',
      [doctorId]
    );
    return results || [];
  } catch (error) {
    console.error('billingModel.getClinicServices error:', error);
    return [];
  }
}

async function createClinicService(doctorId, data) {
  try {
    const id = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    await queryD1(`
      INSERT INTO clinic_services (id, doctorId, serviceName, itemType, defaultPrice, hsnSacCode, isGstExempt, gstRate, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id,
      doctorId,
      data.serviceName,
      data.itemType || 'procedure',
      Number(data.defaultPrice) || 0,
      data.hsnSacCode || '999312',
      data.isGstExempt !== undefined ? (data.isGstExempt ? 1 : 0) : 1,
      Number(data.gstRate) || 0,
      now,
      now
    ]);
    const { results } = await queryD1('SELECT * FROM clinic_services WHERE id = ?', [id]);
    return results ? results[0] : null;
  } catch (error) {
    console.error('billingModel.createClinicService error:', error);
    throw error;
  }
}

module.exports = {
  generateBillNumber,
  createBill,
  findBillById,
  findBillByNumber,
  findBillsByPatientId,
  findBillsByDoctorId,
  findBillsByPrescriptionId,
  getAllBills,
  updateBillStatus,
  recordPaymentTransaction,
  cancelBill,
  getDoctorDayCloseSummary,
  getClinicServices,
  createClinicService,
  getBillItems,
  getBillPayments
};
