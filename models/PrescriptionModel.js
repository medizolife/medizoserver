const mongoose = require('mongoose');

// Vital Signs schema
const vitalSignsSchema = new mongoose.Schema({
  bloodPressure: { type: String, default: '' },
  pulse: { type: String, default: '' },
  temperature: { type: String, default: '' },
  spo2: { type: String, default: '' },
  respiratoryRate: { type: String, default: '' },
  bmi: { type: String, default: '' },
  painScale: { type: String, default: '' }
}, { _id: false });

// Medication item schema
const medicationItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: '' },
  dosage: { type: String, default: '' },
  duration: { type: String, default: '' },
  instructions: { type: String, default: '' }
}, { _id: false });

// Investigation schema
const investigationSchema = new mongoose.Schema({
  testName: { type: String, required: true },
  reason: { type: String, default: '' },
  priority: { type: String, default: '' },
  fasting: { type: String, default: '' }
}, { _id: false });

// Follow-up info schema
const followUpInfoSchema = new mongoose.Schema({
  appointmentDate: { type: String, default: '' },
  appointmentTime: { type: String, default: '' },
  purpose: { type: String, default: '' },
  bringItems: { type: [String], default: [] }
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  doctorId: {
    type: String,
    required: true
  },
  patientId: {
    type: String,
    required: true
  },
  patientEmail: {
    type: String,
    default: ''
  },
  
  // Vital Signs
  vitalSigns: {
    type: vitalSignsSchema,
    default: {}
  },
  
  // Chief Complaints & Clinical Notes
  presentingComplaints: {
    type: [String],
    default: []
  },
  clinicalFindings: {
    type: [String],
    default: []
  },
  provisionalDiagnosis: {
    type: [String],
    default: []
  },
  
  // Patient History (can override/add to patient profile)
  currentMedications: {
    type: [String],
    default: []
  },
  pastSurgicalHistory: {
    type: [String],
    default: []
  },
  
  // Legacy single medication field
  diagnosis: {
    type: String,
    default: ''
  },
  medication: {
    type: String,
    default: ''
  },
  dosage: {
    type: String,
    default: ''
  },
  frequency: {
    type: String,
    default: ''
  },
  duration: {
    type: String,
    default: ''
  },
  instructions: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  
  // Enhanced medications array
  medications: {
    type: [medicationItemSchema],
    default: []
  },
  medicationNotes: {
    type: [String],
    default: []
  },
  
  // Investigations Required
  testsRequired: {
    type: [String],
    default: []
  },
  investigations: {
    type: [investigationSchema],
    default: []
  },
  investigationNotes: {
    type: String,
    default: ''
  },
  
  // Dietary & Lifestyle Recommendations
  dietModifications: {
    type: [String],
    default: []
  },
  lifestyleChanges: {
    type: [String],
    default: []
  },
  warningSigns: {
    type: [String],
    default: []
  },
  
  // Follow-up Information
  followUpDate: {
    type: String,
    default: ''
  },
  followUpInfo: {
    type: followUpInfoSchema,
    default: {}
  },
  emergencyHelpline: {
    type: String,
    default: ''
  },
  
  // System fields
  qrCode: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Transform to JSON
prescriptionSchema.methods.toJSON = function() {
  const prescription = this.toObject();
  prescription.id = prescription._id.toString();
  prescription.doctorId = prescription.doctorId.toString();
  prescription.patientId = prescription.patientId.toString();
  delete prescription.__v;
  return prescription;
};

const Prescription = mongoose.model('Prescription', prescriptionSchema);

module.exports = Prescription;
