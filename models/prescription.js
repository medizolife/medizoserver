const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const mongoose = require('mongoose');

// Import MongoDB model
let PrescriptionModel;
try {
  PrescriptionModel = require('./PrescriptionModel');
} catch (e) {
  PrescriptionModel = null;
}

// Path to prescriptions data file
const prescriptionsFilePath = path.join(__dirname, '../data/prescriptions.json');

// Ensure data directory and file exist
const dataDir = path.dirname(prescriptionsFilePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(prescriptionsFilePath)) {
  fs.writeFileSync(prescriptionsFilePath, JSON.stringify([], null, 2));
}

// Check if MongoDB is connected
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

/**
 * Get all prescriptions from the JSON file
 * @returns {Array} Array of prescriptions
 */
const getPrescriptions = async () => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const prescriptions = await PrescriptionModel.find({});
      return prescriptions.map(p => p.toJSON());
    } catch (error) {
      console.error('MongoDB getPrescriptions error:', error);
    }
  }
  
  // Fallback to JSON file
  try {
    if (!fs.existsSync(prescriptionsFilePath)) {
      fs.writeFileSync(prescriptionsFilePath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(prescriptionsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading prescriptions file:', error);
    return [];
  }
};

// Sync version for backward compatibility
const getPrescriptionsSync = () => {
  try {
    if (!fs.existsSync(prescriptionsFilePath)) {
      fs.writeFileSync(prescriptionsFilePath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(prescriptionsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading prescriptions file:', error);
    return [];
  }
};

/**
 * Save prescriptions to the JSON file
 * @param {Array} prescriptions - Array of prescriptions to save
 */
const savePrescriptions = (prescriptions) => {
  try {
    const dataDir = path.dirname(prescriptionsFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(prescriptionsFilePath, JSON.stringify(prescriptions, null, 2));
    console.log('Prescriptions saved successfully, count:', prescriptions.length);
  } catch (error) {
    console.error('Error writing prescriptions file:', error);
  }
};

/**
 * Find prescriptions by doctor ID
 * @param {string} doctorId - Doctor ID
 * @returns {Array} Array of prescriptions
 */
const findPrescriptionsByDoctorId = async (doctorId) => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const prescriptions = await PrescriptionModel.find({ doctorId });
      return prescriptions.map(p => p.toJSON());
    } catch (error) {
      console.error('MongoDB findPrescriptionsByDoctorId error:', error);
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  return prescriptions.filter(prescription => prescription.doctorId === doctorId);
};

/**
 * Find prescriptions by patient ID
 * @param {string} patientId - Patient ID
 * @returns {Array} Array of prescriptions
 */
const findPrescriptionsByPatientId = async (patientId) => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const prescriptions = await PrescriptionModel.find({ patientId });
      return prescriptions.map(p => p.toJSON());
    } catch (error) {
      console.error('MongoDB findPrescriptionsByPatientId error:', error);
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  return prescriptions.filter(prescription => prescription.patientId === patientId);
};

/**
 * Find a prescription by ID
 * @param {string} id - Prescription ID
 * @returns {Object|null} Prescription object or null if not found
 */
const findPrescriptionById = async (id) => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const prescription = await PrescriptionModel.findById(id);
      return prescription ? prescription.toJSON() : null;
    } catch (error) {
      console.error('MongoDB findPrescriptionById error:', error);
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  return prescriptions.find(prescription => prescription.id === id) || null;
};

/**
 * Create a new prescription
 * @param {Object} prescriptionData - Prescription data
 * @returns {Object} Created prescription object
 */
const createPrescription = async (prescriptionData) => {
  // Generate prescription ID
  const prescriptionId = isMongoConnected() ? new mongoose.Types.ObjectId().toString() : Date.now().toString();
  
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const newPrescription = new PrescriptionModel({
        _id: prescriptionId,
        ...prescriptionData,
        qrCode: prescriptionId,  // Store only the ObjectId for QR verification
        status: 'active'
      });
      await newPrescription.save();
      console.log('Prescription saved to MongoDB');
      return newPrescription.toJSON();
    } catch (error) {
      console.error('MongoDB createPrescription error:', error);
      throw error;
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  
  // Create new prescription
  const newPrescription = {
    id: prescriptionId,
    ...prescriptionData,
    qrCode: prescriptionId,  // Store only the ID for QR verification
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  // Save prescription
  prescriptions.push(newPrescription);
  savePrescriptions(prescriptions);
  
  return newPrescription;
};

/**
 * Update a prescription
 * @param {string} id - Prescription ID
 * @param {Object} prescriptionData - Prescription data to update
 * @returns {Object|null} Updated prescription object or null if not found
 */
const updatePrescription = async (id, prescriptionData) => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const prescription = await PrescriptionModel.findByIdAndUpdate(
        id,
        { ...prescriptionData, updatedAt: new Date() },
        { new: true }
      );
      return prescription ? prescription.toJSON() : null;
    } catch (error) {
      console.error('MongoDB updatePrescription error:', error);
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  const index = prescriptions.findIndex(prescription => prescription.id === id);
  
  if (index === -1) {
    return null;
  }
  
  // Update prescription
  prescriptions[index] = {
    ...prescriptions[index],
    ...prescriptionData,
    updatedAt: new Date().toISOString()
  };
  
  savePrescriptions(prescriptions);
  
  return prescriptions[index];
};

/**
 * Delete a prescription
 * @param {string} id - Prescription ID
 * @returns {boolean} Success status
 */
const deletePrescription = async (id) => {
  if (isMongoConnected() && PrescriptionModel) {
    try {
      const result = await PrescriptionModel.findByIdAndDelete(id);
      return !!result;
    } catch (error) {
      console.error('MongoDB deletePrescription error:', error);
    }
  }
  
  // Fallback to JSON file
  const prescriptions = getPrescriptionsSync();
  const filteredPrescriptions = prescriptions.filter(prescription => prescription.id !== id);
  
  if (filteredPrescriptions.length === prescriptions.length) {
    return false;
  }
  
  savePrescriptions(filteredPrescriptions);
  return true;
};

module.exports = {
  getPrescriptions,
  getPrescriptionsSync,
  savePrescriptions,
  findPrescriptionsByDoctorId,
  findPrescriptionsByPatientId,
  findPrescriptionById,
  createPrescription,
  updatePrescription,
  deletePrescription,
  isMongoConnected
};
