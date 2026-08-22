const express = require('express');
const router = express.Router();
const { auth, pharmacistOrAdmin } = require('../middleware/auth');
const {
  getInventoryByPharmacist,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStockQuantity,
  deleteInventoryItem,
  getInventoryStats,
  batchDeductStock
} = require('../models/inventory');

/**
 * @route   GET /api/inventory/stats
 * @desc    Get real-time stock KPI metrics for logged-in pharmacist
 * @access  Private (Pharmacist / Admin)
 */
router.get('/stats', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const stats = await getInventoryStats(pharmacistId);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving inventory statistics' });
  }
});

/**
 * @route   GET /api/inventory
 * @desc    Get list of inventory medicines with search & filtering
 * @access  Private (Pharmacist / Admin)
 */
router.get('/', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const {
      search = '',
      status = '',
      dosageForm = '',
      limit = 100,
      offset = 0,
      sortBy = 'updatedAt',
      sortOrder = 'DESC'
    } = req.query;

    const data = await getInventoryByPharmacist(pharmacistId, {
      search,
      status,
      dosageForm,
      limit,
      offset,
      sortBy,
      sortOrder
    });

    res.json({
      success: true,
      items: data.items,
      total: data.total,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error) {
    console.error('Get inventory items error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving inventory list' });
  }
});

/**
 * @route   GET /api/inventory/:id
 * @desc    Get single inventory item by ID
 * @access  Private (Pharmacist / Admin)
 */
router.get('/:id', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const item = await getInventoryItemById(req.params.id, pharmacistId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Medicine stock item not found' });
    }
    res.json({ success: true, item });
  } catch (error) {
    console.error('Get single inventory item error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving inventory item' });
  }
});

/**
 * @route   POST /api/inventory
 * @desc    Add a new medicine to pharmacist stock (Custom or from Master Catalog)
 * @access  Private (Pharmacist / Admin)
 */
router.post('/', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const {
      medicineName,
      genericName,
      dosageForm,
      strength,
      manufacturer,
      batchNumber,
      expiryDate,
      quantity,
      unitPrice,
      mrp,
      reorderLevel,
      rackLocation,
      isCustom,
      notes,
      pharmacyName
    } = req.body;

    if (!medicineName || !medicineName.trim()) {
      return res.status(400).json({ success: false, message: 'Medicine name is required' });
    }

    const createdItem = await createInventoryItem({
      pharmacistId,
      pharmacyName: pharmacyName || req.user.clinicName || req.user.organization || 'My Pharmacy',
      medicineName: medicineName.trim(),
      genericName: genericName || '',
      dosageForm: dosageForm || 'Tablet',
      strength: strength || '',
      manufacturer: manufacturer || '',
      batchNumber: batchNumber || '',
      expiryDate: expiryDate || '',
      quantity: quantity !== undefined ? Number(quantity) : 0,
      unitPrice: unitPrice !== undefined ? Number(unitPrice) : 0.0,
      mrp: mrp !== undefined ? Number(mrp) : 0.0,
      reorderLevel: reorderLevel !== undefined ? Number(reorderLevel) : 10,
      rackLocation: rackLocation || '',
      isCustom: Boolean(isCustom),
      notes: notes || ''
    });

    res.status(201).json({
      success: true,
      message: 'Medicine added to stock successfully',
      item: createdItem
    });
  } catch (error) {
    console.error('Create inventory item error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error adding medicine to inventory' });
  }
});

/**
 * @route   POST /api/inventory/bulk-import
 * @desc    Bulk add multiple medicines from master catalog or batch file
 * @access  Private (Pharmacist / Admin)
 */
router.post('/bulk-import', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const { medicines } = req.body;

    if (!Array.isArray(medicines) || medicines.length === 0) {
      return res.status(400).json({ success: false, message: 'Medicines array is required' });
    }

    const added = [];
    for (const med of medicines) {
      if (!med.medicineName) continue;
      try {
        const item = await createInventoryItem({
          pharmacistId,
          pharmacyName: req.user.clinicName || 'My Pharmacy',
          medicineName: med.medicineName,
          genericName: med.genericName || '',
          dosageForm: med.dosageForm || 'Tablet',
          strength: med.strength || '',
          manufacturer: med.manufacturer || '',
          batchNumber: med.batchNumber || '',
          expiryDate: med.expiryDate || '',
          quantity: Number(med.quantity) || 0,
          unitPrice: Number(med.unitPrice) || 0.0,
          mrp: Number(med.mrp) || 0.0,
          reorderLevel: Number(med.reorderLevel) || 10,
          rackLocation: med.rackLocation || '',
          isCustom: Boolean(med.isCustom),
          notes: med.notes || ''
        });
        if (item) added.push(item);
      } catch (err) {
        console.error('Error importing item:', med.medicineName, err);
      }
    }

    res.json({
      success: true,
      message: `Successfully imported ${added.length} medicines into your inventory`,
      count: added.length
    });
  } catch (error) {
    console.error('Bulk import inventory error:', error);
    res.status(500).json({ success: false, message: 'Server error during bulk import' });
  }
});

/**
 * @route   PUT /api/inventory/:id
 * @desc    Update medicine stock metadata, batch, expiry, or pricing
 * @access  Private (Pharmacist / Admin)
 */
router.put('/:id', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const updated = await updateInventoryItem(req.params.id, pharmacistId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Medicine stock item not found' });
    }
    res.json({
      success: true,
      message: 'Inventory updated successfully',
      item: updated
    });
  } catch (error) {
    console.error('Update inventory item error:', error);
    res.status(500).json({ success: false, message: 'Server error updating inventory item' });
  }
});

/**
 * @route   PATCH /api/inventory/:id/stock
 * @desc    Quick +/- adjustment of medicine quantity
 * @access  Private (Pharmacist / Admin)
 */
router.patch('/:id/stock', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const { delta } = req.body;
    if (delta === undefined || isNaN(delta)) {
      return res.status(400).json({ success: false, message: 'Stock delta (number) is required' });
    }

    const updated = await adjustStockQuantity(req.params.id, pharmacistId, delta);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Medicine stock item not found' });
    }

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      item: updated
    });
  } catch (error) {
    console.error('Adjust stock error:', error);
    res.status(500).json({ success: false, message: 'Server error adjusting stock quantity' });
  }
});

/**
 * @route   DELETE /api/inventory/:id
 * @desc    Delete a medicine from pharmacist stock
 * @access  Private (Pharmacist / Admin)
 */
router.delete('/:id', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const deleted = await deleteInventoryItem(req.params.id, pharmacistId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Medicine stock item not found' });
    }
    res.json({ success: true, message: 'Medicine removed from stock' });
  } catch (error) {
    console.error('Delete inventory item error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting inventory item' });
  }
});

/**
 * @route   POST /api/inventory/batch-dispense
 * @desc    Bulk deduct stock when dispensing a prescription
 * @access  Private (Pharmacist / Admin)
 */
router.post('/batch-dispense', pharmacistOrAdmin, async (req, res) => {
  try {
    const pharmacistId = req.user.id;
    const { medications } = req.body;

    if (!Array.isArray(medications)) {
      return res.status(400).json({ success: false, message: 'Medications array is required' });
    }

    const result = await batchDeductStock(pharmacistId, medications);
    res.json({
      success: true,
      message: `Deducted stock for ${result.updatedCount} matched medications`,
      updatedCount: result.updatedCount
    });
  } catch (error) {
    console.error('Batch dispense stock deduction error:', error);
    res.status(500).json({ success: false, message: 'Server error updating stock on dispense' });
  }
});

module.exports = router;
