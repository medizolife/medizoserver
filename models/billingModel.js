const { queryD1 } = require('../config/d1-client');
const crypto = require('crypto');

/**
 * Generate a unique bill invoice number: INV-YYYYMM-XXXX
 */
async function generateBillNumber() {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yearMonth}-`;

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
    const billNumber = billData.billNumber || await generateBillNumber();
    const now = new Date().toISOString();

    // Calculate line totals if items provided
    let calculatedSubtotal = 0;
    const sanitizedItems = items.map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const totalPrice = Number(item.totalPrice) || (quantity * unitPrice);
      calculatedSubtotal += totalPrice;
      return {
        id: crypto.randomBytes(16).toString('hex'),
        billId: id,
        itemType: item.itemType || 'consultation',
        description: item.description || 'Medical Service',
        quantity,
        unitPrice,
        totalPrice,
        notes: item.notes || ''
      };
    });

    const subtotal = billData.subtotal !== undefined ? Number(billData.subtotal) : calculatedSubtotal;
    const tax = Number(billData.tax) || 0;
    const discount = Number(billData.discount) || 0;
    const totalAmount = billData.totalAmount !== undefined ? Number(billData.totalAmount) : (subtotal + tax - discount);

    const sqlBill = `
      INSERT INTO bills (
        id, billNumber, patientId, familyProfileId, patientDisplayId,
        doctorId, prescriptionId, subtotal, tax, discount, totalAmount,
        currency, status, paymentMethod, paymentTransactionRef, paidAt,
        paymentNotes, receiptNumber, dueDate, notes, createdBy, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      tax,
      discount,
      totalAmount,
      billData.currency || 'INR',
      billData.status || 'draft',
      billData.paymentMethod || '',
      billData.paymentTransactionRef || '',
      billData.paidAt || null,
      billData.paymentNotes || '',
      billData.receiptNumber || '',
      billData.dueDate || '',
      billData.notes || '',
      billData.createdBy || billData.doctorId,
      now,
      now
    ];

    const { results: billResults } = await queryD1(sqlBill, billParams);
    const createdBill = billResults && billResults.length > 0 ? billResults[0] : { id, billNumber, ...billData, subtotal, tax, discount, totalAmount };

    // Insert bill items
    for (const item of sanitizedItems) {
      await queryD1(`
        INSERT INTO bill_items (id, billId, itemType, description, quantity, unitPrice, totalPrice, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        item.id,
        id,
        item.itemType,
        item.description,
        item.quantity,
        item.unitPrice,
        item.totalPrice,
        item.notes,
        now,
        now
      ]);
    }

    return {
      ...createdBill,
      items: sanitizedItems
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
 * Find bill by ID with line items
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
    return bill;
  } catch (error) {
    console.error('billingModel.findBillByNumber error:', error);
    return null;
  }
}

/**
 * Find bills for a patient
 * @param {string} patientId
 * @returns {Promise<Array>}
 */
async function findBillsByPatientId(patientId) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM bills WHERE patientId = ? ORDER BY createdAt DESC',
      [patientId]
    );
    const bills = results || [];
    for (const b of bills) {
      b.items = await getBillItems(b.id);
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
    }
    return bills;
  } catch (error) {
    console.error('billingModel.getAllBills error:', error);
    return [];
  }
}

/**
 * Update bill status and payment details
 * Allowed transitions:
 * draft -> issued -> paid | cancelled | refunded
 * @param {string} id
 * @param {string} status
 * @param {Object} paymentData
 * @returns {Promise<Object|null>}
 */
async function updateBillStatus(id, status, paymentData = {}) {
  try {
    const current = await findBillById(id);
    if (!current) throw new Error('Bill not found');

    const validStatuses = ['draft', 'issued', 'paid', 'cancelled', 'refunded'];
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
    if (status === 'paid' && !current.paidAt) {
      const paidAt = paymentData.paidAt || new Date().toISOString();
      setClauses.push('paidAt = ?');
      values.push(paidAt);
      if (!paymentData.receiptNumber && !current.receiptNumber) {
        const rcpt = `RCP-${current.billNumber.replace('INV-', '')}`;
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
 * Update general bill metadata (notes, dueDate, discount, tax)
 * Note: Cannot edit a 'paid' or 'refunded' bill
 * @param {string} id
 * @param {Object} updateData
 * @returns {Promise<Object|null>}
 */
async function updateBill(id, updateData) {
  try {
    const current = await findBillById(id);
    if (!current) throw new Error('Bill not found');

    if (['paid', 'refunded'].includes(current.status)) {
      throw new Error(`Cannot modify bill in '${current.status}' status.`);
    }

    const allowed = ['notes', 'dueDate', 'tax', 'discount', 'subtotal', 'totalAmount', 'familyProfileId', 'patientDisplayId'];
    const setClauses = ["updatedAt = datetime('now')"];
    const values = [];

    for (const key of allowed) {
      if (updateData[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    }

    values.push(id);
    const sql = `UPDATE bills SET ${setClauses.join(', ')} WHERE id = ?`;
    await queryD1(sql, values);

    return await findBillById(id);
  } catch (error) {
    console.error('billingModel.updateBill error:', error);
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
  updateBill,
  getBillItems
};
