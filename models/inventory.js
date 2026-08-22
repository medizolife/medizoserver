const { queryD1, execD1 } = require('../config/d1-client');
const crypto = require('crypto');

/**
 * Helper to compute status based on quantity, reorderLevel, and expiryDate
 */
const computeStockStatus = (quantity, reorderLevel = 10, expiryDate = '') => {
  const qty = Number(quantity) || 0;
  const reorder = Number(reorderLevel) || 10;
  
  if (expiryDate) {
    const exp = new Date(expiryDate);
    const today = new Date();
    if (!isNaN(exp.getTime()) && exp < today) {
      return 'expired';
    }
  }

  if (qty <= 0) return 'out_of_stock';
  if (qty <= reorder) return 'low_stock';
  return 'in_stock';
};

/**
 * Get inventory items for a specific pharmacist
 */
const getInventoryByPharmacist = async (pharmacistId, filters = {}) => {
  if (!pharmacistId) return { items: [], total: 0 };

  const {
    search = '',
    status = '',
    dosageForm = '',
    limit = 100,
    offset = 0,
    sortBy = 'updatedAt',
    sortOrder = 'DESC'
  } = filters;

  const validSortCols = ['medicineName', 'quantity', 'unitPrice', 'mrp', 'expiryDate', 'createdAt', 'updatedAt', 'status'];
  const sortCol = validSortCols.includes(sortBy) ? sortBy : 'updatedAt';
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let whereClauses = ['pharmacistId = ?'];
  let params = [pharmacistId];

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    whereClauses.push('(LOWER(medicineName) LIKE ? OR LOWER(genericName) LIKE ? OR LOWER(manufacturer) LIKE ? OR LOWER(batchNumber) LIKE ? OR LOWER(rackLocation) LIKE ?)');
    params.push(term, term, term, term, term);
  }

  if (status && status !== 'all') {
    whereClauses.push('status = ?');
    params.push(status);
  }

  if (dosageForm && dosageForm !== 'all') {
    whereClauses.push('LOWER(dosageForm) = ?');
    params.push(dosageForm.toLowerCase());
  }

  const whereStr = whereClauses.join(' AND ');

  // Count query
  const countSql = `SELECT COUNT(*) as total FROM pharmacy_inventory WHERE ${whereStr}`;
  const { results: countResults } = await queryD1(countSql, params);
  const total = countResults && countResults[0] ? Number(countResults[0].total) : 0;

  // Data query
  const dataSql = `
    SELECT * FROM pharmacy_inventory 
    WHERE ${whereStr}
    ORDER BY ${sortCol} ${order}
    LIMIT ? OFFSET ?
  `;
  const { results } = await queryD1(dataSql, [...params, Number(limit), Number(offset)]);

  return {
    items: (results || []).map(item => ({
      ...item,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      mrp: Number(item.mrp) || 0,
      reorderLevel: Number(item.reorderLevel) || 10,
      isCustom: Boolean(item.isCustom)
    })),
    total
  };
};

/**
 * Get a single inventory item by ID (ensuring pharmacist ownership)
 */
const getInventoryItemById = async (id, pharmacistId) => {
  if (!id || !pharmacistId) return null;
  const { results } = await queryD1(
    'SELECT * FROM pharmacy_inventory WHERE id = ? AND pharmacistId = ? LIMIT 1',
    [id, pharmacistId]
  );
  if (!results || results.length === 0) return null;
  const item = results[0];
  return {
    ...item,
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.unitPrice) || 0,
    mrp: Number(item.mrp) || 0,
    reorderLevel: Number(item.reorderLevel) || 10,
    isCustom: Boolean(item.isCustom)
  };
};

/**
 * Create a new inventory item linked to a pharmacist
 */
const createInventoryItem = async (itemData) => {
  const {
    pharmacistId,
    pharmacyName = '',
    medicineName,
    genericName = '',
    dosageForm = 'Tablet',
    strength = '',
    manufacturer = '',
    batchNumber = '',
    expiryDate = '',
    quantity = 0,
    unitPrice = 0.0,
    mrp = 0.0,
    reorderLevel = 10,
    rackLocation = '',
    isCustom = 0,
    notes = ''
  } = itemData;

  if (!pharmacistId || !medicineName) {
    throw new Error('Pharmacist ID and Medicine Name are required');
  }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const reorder = Math.max(1, parseInt(reorderLevel, 10) || 10);
  const status = computeStockStatus(qty, reorder, expiryDate);

  const insertSql = `
    INSERT INTO pharmacy_inventory (
      id, pharmacistId, pharmacyName, medicineName, genericName, dosageForm,
      strength, manufacturer, batchNumber, expiryDate, quantity, unitPrice,
      mrp, reorderLevel, rackLocation, status, isCustom, notes, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await execD1(insertSql, [
    id,
    pharmacistId,
    pharmacyName,
    medicineName.trim(),
    genericName.trim(),
    dosageForm,
    strength.trim(),
    manufacturer.trim(),
    batchNumber.trim(),
    expiryDate,
    qty,
    parseFloat(unitPrice) || 0.0,
    parseFloat(mrp) || 0.0,
    reorder,
    rackLocation.trim(),
    status,
    isCustom ? 1 : 0,
    notes.trim(),
    now,
    now
  ]);

  return getInventoryItemById(id, pharmacistId);
};

/**
 * Update an existing inventory item
 */
const updateInventoryItem = async (id, pharmacistId, updateData) => {
  const existing = await getInventoryItemById(id, pharmacistId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const allowedFields = [
    'pharmacyName', 'medicineName', 'genericName', 'dosageForm', 'strength',
    'manufacturer', 'batchNumber', 'expiryDate', 'quantity', 'unitPrice',
    'mrp', 'reorderLevel', 'rackLocation', 'notes'
  ];

  const merged = { ...existing, ...updateData };
  const qty = Math.max(0, parseInt(merged.quantity, 10) || 0);
  const reorder = Math.max(1, parseInt(merged.reorderLevel, 10) || 10);
  const status = computeStockStatus(qty, reorder, merged.expiryDate);

  let setClauses = ['status = ?', 'updatedAt = ?'];
  let params = [status, now];

  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      if (['quantity', 'reorderLevel'].includes(field)) {
        params.push(parseInt(updateData[field], 10) || 0);
      } else if (['unitPrice', 'mrp'].includes(field)) {
        params.push(parseFloat(updateData[field]) || 0.0);
      } else {
        params.push(String(updateData[field]).trim());
      }
    }
  }

  params.push(id, pharmacistId);

  const updateSql = `
    UPDATE pharmacy_inventory 
    SET ${setClauses.join(', ')} 
    WHERE id = ? AND pharmacistId = ?
  `;

  await execD1(updateSql, params);
  return getInventoryItemById(id, pharmacistId);
};

/**
 * Quick +/- stock adjustment
 */
const adjustStockQuantity = async (id, pharmacistId, delta) => {
  const existing = await getInventoryItemById(id, pharmacistId);
  if (!existing) return null;

  const newQty = Math.max(0, existing.quantity + (parseInt(delta, 10) || 0));
  const newStatus = computeStockStatus(newQty, existing.reorderLevel, existing.expiryDate);
  const now = new Date().toISOString();

  await execD1(
    'UPDATE pharmacy_inventory SET quantity = ?, status = ?, updatedAt = ? WHERE id = ? AND pharmacistId = ?',
    [newQty, newStatus, now, id, pharmacistId]
  );

  return getInventoryItemById(id, pharmacistId);
};

/**
 * Delete an inventory item
 */
const deleteInventoryItem = async (id, pharmacistId) => {
  const existing = await getInventoryItemById(id, pharmacistId);
  if (!existing) return false;

  await execD1(
    'DELETE FROM pharmacy_inventory WHERE id = ? AND pharmacistId = ?',
    [id, pharmacistId]
  );
  return true;
};

/**
 * Compute real-time inventory statistics for a pharmacist
 */
const getInventoryStats = async (pharmacistId) => {
  if (!pharmacistId) {
    return {
      totalItems: 0,
      totalUnits: 0,
      inStockCount: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      expiredCount: 0,
      expiringSoonCount: 0,
      totalValuation: 0.0
    };
  }

  const { results } = await queryD1(
    'SELECT * FROM pharmacy_inventory WHERE pharmacistId = ?',
    [pharmacistId]
  );

  const items = results || [];
  const today = new Date();
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(today.getDate() + 30);

  let totalUnits = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;
  let totalValuation = 0.0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || Number(item.mrp) || 0.0;
    const reorder = Number(item.reorderLevel) || 10;

    totalUnits += qty;
    totalValuation += qty * price;

    if (item.expiryDate) {
      const exp = new Date(item.expiryDate);
      if (!isNaN(exp.getTime())) {
        if (exp < today) {
          expiredCount++;
        } else if (exp <= thirtyDaysLater) {
          expiringSoonCount++;
        }
      }
    }

    if (qty <= 0) {
      outOfStockCount++;
    } else if (qty <= reorder) {
      lowStockCount++;
    } else {
      inStockCount++;
    }
  }

  return {
    totalItems: items.length,
    totalUnits,
    inStockCount,
    lowStockCount,
    outOfStockCount,
    expiredCount,
    expiringSoonCount,
    totalValuation: parseFloat(totalValuation.toFixed(2))
  };
};

/**
 * Bulk deduct stock when dispensing a prescription
 */
const batchDeductStock = async (pharmacistId, dispensedMeds = []) => {
  if (!pharmacistId || !Array.isArray(dispensedMeds) || dispensedMeds.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  let updatedCount = 0;
  for (const med of dispensedMeds) {
    const medName = String(med.name || med.medicineName || '').trim();
    const qtyToDeduct = parseInt(med.quantity || med.qty || 1, 10);
    if (!medName || qtyToDeduct <= 0) continue;

    // Search for match in pharmacist stock
    const { results } = await queryD1(
      'SELECT id, quantity, reorderLevel, expiryDate FROM pharmacy_inventory WHERE pharmacistId = ? AND (LOWER(medicineName) = ? OR LOWER(medicineName) LIKE ?) LIMIT 1',
      [pharmacistId, medName.toLowerCase(), `%${medName.toLowerCase()}%`]
    );

    if (results && results.length > 0) {
      const target = results[0];
      const newQty = Math.max(0, (Number(target.quantity) || 0) - qtyToDeduct);
      const newStatus = computeStockStatus(newQty, target.reorderLevel, target.expiryDate);
      const now = new Date().toISOString();

      await execD1(
        'UPDATE pharmacy_inventory SET quantity = ?, status = ?, updatedAt = ? WHERE id = ? AND pharmacistId = ?',
        [newQty, newStatus, now, target.id, pharmacistId]
      );
      updatedCount++;
    }
  }

  return { success: true, updatedCount };
};

module.exports = {
  computeStockStatus,
  getInventoryByPharmacist,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStockQuantity,
  deleteInventoryItem,
  getInventoryStats,
  batchDeductStock
};
