-- Medizo Healthcare System - Cloudflare D1 Schema
-- Migrated from MongoDB/Mongoose schemas

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  -- Core fields
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT,                          -- Optional for Google OAuth users
  googleId TEXT,
  picture TEXT DEFAULT '',
  authProvider TEXT DEFAULT 'local',      -- 'local' or 'google'
  role TEXT NOT NULL,                     -- 'doctor', 'patient', 'pharmacist', 'admin'
  status TEXT DEFAULT 'active',           -- 'active' or 'deactivated'

  -- Pharmacist & Doctor specific fields
  pharmacyName TEXT DEFAULT '',
  pharmacyAddress TEXT DEFAULT '',
  specialization TEXT DEFAULT '',
  licenseNumber TEXT DEFAULT '',
  clinicAddress TEXT DEFAULT '',
  clinicLatitude REAL DEFAULT NULL,
  clinicLongitude REAL DEFAULT NULL,
  clinicLocationAccuracy REAL DEFAULT NULL,
  clinicPlaceName TEXT DEFAULT '',
  experience TEXT DEFAULT '',
  qualifications TEXT DEFAULT '',

  -- Doctor profile and clinic images
  profileImage TEXT DEFAULT '',
  clinicLogo TEXT DEFAULT '',
  signature TEXT DEFAULT '',
  stamp TEXT DEFAULT '',

  -- Extended contact information for doctors
  clinicName TEXT DEFAULT '',
  alternateEmail TEXT DEFAULT '',
  secondaryPhone TEXT DEFAULT '',
  fax TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  website TEXT DEFAULT '',
  linkedin TEXT DEFAULT '',
  twitter TEXT DEFAULT '',
  facebook TEXT DEFAULT '',
  instagram TEXT DEFAULT '',

  -- Doctor's linked patients (JSON array of patient IDs)
  linkedPatients TEXT DEFAULT '[]',

  -- Patient-specific fields
  dateOfBirth TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  contactNumber TEXT DEFAULT '',
  address TEXT DEFAULT '',
  bloodType TEXT DEFAULT '',

  -- Complex nested fields stored as JSON
  allergies TEXT DEFAULT '{"environmental":[],"food":[],"drugs":[],"other":[]}',
  diseaseHistory TEXT DEFAULT '[]',
  chronicConditions TEXT DEFAULT '[]',
  medicalHistory TEXT DEFAULT '',

  -- Emergency contact (JSON object)
  emergencyContact TEXT DEFAULT '{"name":"","relationship":"","phone":""}',

  -- Guardian (for minor patients under 15)
  guardianId TEXT DEFAULT '',             -- references users.id of the legal guardian

  -- DigiLocker verification (doctors only)
  digilockerVerified INTEGER DEFAULT 0,  -- boolean: 0=false, 1=true
  digilockerProfile TEXT DEFAULT '{"verified":false,"name":"","dob":"","gender":"","email":"","mobile":"","maskedAadhaar":"","digilockerid":"","referenceKey":"","eaadhaar":"","panNumber":"","drivingLicence":""}',

  -- OTP verification fields
  loginOtp TEXT DEFAULT '',
  loginOtpExpires INTEGER DEFAULT 0,
  resetOtp TEXT DEFAULT '',
  resetOtpExpires INTEGER DEFAULT 0,

  -- Timestamps
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- Index for Google ID lookups
CREATE INDEX IF NOT EXISTS idx_users_googleId ON users(googleId);
-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);


-- ============================================================
-- PRESCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  -- Doctor info
  doctorId TEXT NOT NULL,
  doctorName TEXT DEFAULT '',
  doctorSpecialization TEXT DEFAULT '',
  doctorLicenseNumber TEXT DEFAULT '',

  -- Patient info
  patientId TEXT NOT NULL,
  patientName TEXT DEFAULT '',
  patientEmail TEXT DEFAULT '',
  patientAge TEXT DEFAULT '',
  patientGender TEXT DEFAULT '',

  -- Vital Signs (JSON object)
  vitalSigns TEXT DEFAULT '{}',

  -- Chief Complaints & Clinical Notes (JSON arrays)
  presentingComplaints TEXT DEFAULT '[]',
  clinicalFindings TEXT DEFAULT '[]',
  provisionalDiagnosis TEXT DEFAULT '[]',

  -- Patient History (JSON arrays)
  currentMedications TEXT DEFAULT '[]',
  pastSurgicalHistory TEXT DEFAULT '[]',

  -- Legacy single medication fields
  diagnosis TEXT DEFAULT '',
  medication TEXT DEFAULT '',
  dosage TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  notes TEXT DEFAULT '',

  -- Enhanced medications array (JSON array of objects)
  medications TEXT DEFAULT '[]',
  medicationNotes TEXT DEFAULT '[]',

  -- Investigations (JSON arrays)
  testsRequired TEXT DEFAULT '[]',
  investigations TEXT DEFAULT '[]',
  investigationNotes TEXT DEFAULT '',
  testReports TEXT DEFAULT '[]',

  -- Dietary & Lifestyle (JSON arrays)
  dietModifications TEXT DEFAULT '[]',
  lifestyleChanges TEXT DEFAULT '[]',
  warningSigns TEXT DEFAULT '[]',

  -- Follow-up Information
  followUpDate TEXT DEFAULT '',
  followUpInfo TEXT DEFAULT '{}',
  emergencyHelpline TEXT DEFAULT '',

  -- System fields
  qrCode TEXT DEFAULT '',
  status TEXT DEFAULT 'active',                  -- 'active', 'completed', 'cancelled'
  dispensedStatus TEXT DEFAULT 'pending',         -- 'pending', 'dispensed', 'partially_dispensed'
  dispensedAt TEXT,
  dispensedBy TEXT DEFAULT '{"pharmacistId":"","pharmacistName":"","pharmacyName":"","licenseNumber":""}',
  dispenseNotes TEXT DEFAULT '',
  dispenseHistory TEXT DEFAULT '[]',
  dispenseCount INTEGER DEFAULT 0,

  -- Timestamps
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- Index for doctor/patient lookups
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctorId ON prescriptions(doctorId);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patientId ON prescriptions(patientId);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status);


-- ============================================================
-- IMAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  -- Image metadata
  filename TEXT NOT NULL UNIQUE,
  originalName TEXT NOT NULL,
  mimeType TEXT NOT NULL,

  -- Image binary data stored as base64 text
  data TEXT NOT NULL,

  -- File size in bytes
  size INTEGER NOT NULL,

  -- Type of image
  imageType TEXT DEFAULT 'other',        -- 'profileImage', 'clinicLogo', 'signature', 'other'

  -- Reference to the user who uploaded
  uploadedBy TEXT NOT NULL,

  -- Timestamps
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename);
CREATE INDEX IF NOT EXISTS idx_images_uploadedBy ON images(uploadedBy);
CREATE INDEX IF NOT EXISTS idx_images_uploadedBy_type ON images(uploadedBy, imageType);


-- ============================================================
-- EXTERNAL PRESCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS external_prescriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  patientId TEXT NOT NULL,
  uploadedBy TEXT NOT NULL,
  title TEXT NOT NULL,
  doctorName TEXT DEFAULT '',
  recordDate TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  fileUrl TEXT NOT NULL,
  fileType TEXT DEFAULT 'image',
  fileSize INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ext_rx_patientId ON external_prescriptions(patientId);
CREATE INDEX IF NOT EXISTS idx_ext_rx_uploadedBy ON external_prescriptions(uploadedBy);


-- ============================================================
-- FAMILY PROFILES TABLE
-- ============================================================
-- Each patient account can have multiple profiles (self + dependents).
-- The account holder's own data is profile index 0 ('self').
-- Each profile gets a unique patientDisplayId: PT-{accountId-last6}[NN]
CREATE TABLE IF NOT EXISTS family_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

  -- Link to account holder (references users.id)
  accountId TEXT NOT NULL,
  profileIndex INTEGER NOT NULL,           -- 0=self, 1..N=dependents

  -- Relationship to account holder
  relationship TEXT NOT NULL DEFAULT 'self', -- 'self','spouse','parent','child','sibling','other'

  -- Profile-specific patient data
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  dateOfBirth TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  bloodType TEXT DEFAULT '',

  -- Medical data (JSON, same structure as users table)
  allergies TEXT DEFAULT '{"environmental":[],"food":[],"drugs":[],"other":[]}',
  diseaseHistory TEXT DEFAULT '[]',
  chronicConditions TEXT DEFAULT '[]',
  medicalHistory TEXT DEFAULT '',
  emergencyContact TEXT DEFAULT '{"name":"","relationship":"","phone":""}',

  -- Generated patient display ID: e.g. "PT-A1B2C3[00]"
  patientDisplayId TEXT DEFAULT '',

  -- Status (soft-delete)
  isActive INTEGER DEFAULT 1,

  -- Timestamps
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),

  UNIQUE(accountId, profileIndex)
);

CREATE INDEX IF NOT EXISTS idx_family_profiles_accountId ON family_profiles(accountId);
CREATE INDEX IF NOT EXISTS idx_family_profiles_displayId ON family_profiles(patientDisplayId);
CREATE INDEX IF NOT EXISTS idx_family_profiles_active ON family_profiles(accountId, isActive);


-- ============================================================
-- BILLING & BILL ITEMS TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  billNumber TEXT NOT NULL UNIQUE,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  doctorId TEXT NOT NULL,
  prescriptionId TEXT DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0.0,
  tax REAL NOT NULL DEFAULT 0.0,
  discount REAL NOT NULL DEFAULT 0.0,
  totalAmount REAL NOT NULL DEFAULT 0.0,
  amountPaid REAL NOT NULL DEFAULT 0.0,
  balanceDue REAL NOT NULL DEFAULT 0.0,
  gstType TEXT DEFAULT 'exempt',               -- 'exempt', 'cgst_sgst', 'igst', 'none'
  gstRate REAL DEFAULT 0.0,                    -- 0, 5, 12, 18
  cgstAmount REAL DEFAULT 0.0,
  sgstAmount REAL DEFAULT 0.0,
  igstAmount REAL DEFAULT 0.0,
  doctorGstin TEXT DEFAULT '',
  patientGstin TEXT DEFAULT '',
  hsnSacCode TEXT DEFAULT '999312',            -- SAC 999312 for Outpatient Healthcare
  concessionReason TEXT DEFAULT '',            -- 'senior_citizen', 'follow_up', 'staff', 'bpl', 'courtesy', 'none'
  sendToPatient INTEGER DEFAULT 1,             -- 1=send WhatsApp/SMS, 0=internal only
  dispatchChannel TEXT DEFAULT 'whatsapp_sms', -- 'whatsapp', 'sms', 'email', 'whatsapp_sms', 'none'
  upiVpa TEXT DEFAULT '',                      -- e.g. 'doctor@okhdfcbank'
  upiQrData TEXT DEFAULT '',                   -- NPCI intent URI string
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'refunded'
  paymentMethod TEXT DEFAULT '',               -- 'cash', 'upi', 'card', 'insurance', 'bank_transfer', 'online', 'split'
  paymentTransactionRef TEXT DEFAULT '',
  paidAt TEXT DEFAULT NULL,
  paymentNotes TEXT DEFAULT '',
  receiptNumber TEXT DEFAULT '',
  dueDate TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  createdBy TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bills_patientId ON bills(patientId);
CREATE INDEX IF NOT EXISTS idx_bills_doctorId ON bills(doctorId);
CREATE INDEX IF NOT EXISTS idx_bills_prescriptionId ON bills(prescriptionId);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_billNumber ON bills(billNumber);

CREATE TABLE IF NOT EXISTS bill_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  billId TEXT NOT NULL,
  itemType TEXT NOT NULL DEFAULT 'consultation', -- 'consultation', 'medication', 'investigation', 'procedure', 'home_care_visit', 'other'
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unitPrice REAL NOT NULL DEFAULT 0.0,
  totalPrice REAL NOT NULL DEFAULT 0.0,
  hsnSacCode TEXT DEFAULT '999312',
  gstRate REAL DEFAULT 0.0,
  discountAmount REAL DEFAULT 0.0,
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bill_items_billId ON bill_items(billId);

CREATE TABLE IF NOT EXISTS bill_payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  billId TEXT NOT NULL,
  amountPaid REAL NOT NULL DEFAULT 0.0,
  paymentMode TEXT NOT NULL DEFAULT 'cash',    -- 'cash', 'upi', 'card', 'insurance', 'bank_transfer', 'cheque', 'other'
  upiTransactionRef TEXT DEFAULT '',
  receiptNumber TEXT DEFAULT '',
  collectedBy TEXT DEFAULT '',                 -- User ID of doctor/receptionist
  notes TEXT DEFAULT '',
  paidAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_billId ON bill_payments(billId);
CREATE INDEX IF NOT EXISTS idx_bill_payments_paidAt ON bill_payments(paidAt);

CREATE TABLE IF NOT EXISTS clinic_services (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  doctorId TEXT NOT NULL,
  serviceName TEXT NOT NULL,
  itemType TEXT NOT NULL DEFAULT 'procedure',  -- 'consultation', 'procedure', 'investigation', 'nursing', 'other'
  defaultPrice REAL NOT NULL DEFAULT 0.0,
  hsnSacCode TEXT DEFAULT '999312',
  isGstExempt INTEGER DEFAULT 1,
  gstRate REAL DEFAULT 0.0,
  isActive INTEGER DEFAULT 1,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clinic_services_doctorId ON clinic_services(doctorId);


-- ============================================================
-- DOCTOR NETWORK & REFERRALS TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_networks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  doctorId TEXT NOT NULL,
  connectedDoctorId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',      -- 'pending', 'accepted', 'rejected', 'removed'
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(doctorId, connectedDoctorId)
);

CREATE INDEX IF NOT EXISTS idx_doc_net_doctorId ON doctor_networks(doctorId);
CREATE INDEX IF NOT EXISTS idx_doc_net_connectedDocId ON doctor_networks(connectedDoctorId);
CREATE INDEX IF NOT EXISTS idx_doc_net_status ON doctor_networks(status);

CREATE TABLE IF NOT EXISTS doctor_referrals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  referralNumber TEXT NOT NULL UNIQUE,
  referringDoctorId TEXT NOT NULL,
  referredDoctorId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  prescriptionId TEXT DEFAULT '',
  reason TEXT NOT NULL,
  clinicalSummary TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'routine',     -- 'routine', 'urgent', 'emergency'
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending', 'accepted', 'rejected', 'cancelled', 'completed'
  responseNotes TEXT DEFAULT '',
  respondedAt TEXT DEFAULT NULL,
  completedAt TEXT DEFAULT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_ref_referringDoc ON doctor_referrals(referringDoctorId);
CREATE INDEX IF NOT EXISTS idx_doc_ref_referredDoc ON doctor_referrals(referredDoctorId);
CREATE INDEX IF NOT EXISTS idx_doc_ref_patient ON doctor_referrals(patientId);
CREATE INDEX IF NOT EXISTS idx_doc_ref_status ON doctor_referrals(status);
CREATE INDEX IF NOT EXISTS idx_doc_ref_number ON doctor_referrals(referralNumber);


-- ============================================================
-- HOME CARE REQUESTS & CLINICAL VISIT RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS home_care_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  requestNumber TEXT NOT NULL UNIQUE,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  requestedByRole TEXT NOT NULL DEFAULT 'patient', -- 'patient', 'doctor'
  requestedById TEXT NOT NULL,
  advisedByDoctorId TEXT DEFAULT '',
  serviceType TEXT NOT NULL DEFAULT 'general_checkup', -- 'general_checkup', 'wound_care', 'post_op_care', 'vitals_monitoring', 'medication_administration', 'elderly_care', 'physiotherapy', 'palliative_care', 'other'
  urgency TEXT NOT NULL DEFAULT 'routine',        -- 'routine', 'standard', 'urgent'
  preferredDate TEXT DEFAULT '',
  preferredTimeSlot TEXT DEFAULT '',             -- 'morning', 'afternoon', 'evening', 'anytime'
  address TEXT NOT NULL,
  contactPhone TEXT NOT NULL,
  clinicalInstructions TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',      -- 'requested', 'approved', 'assigned', 'in_progress', 'completed', 'cancelled'
  assignedNurseId TEXT DEFAULT '',
  completedAt TEXT DEFAULT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hcr_patientId ON home_care_requests(patientId);
CREATE INDEX IF NOT EXISTS idx_hcr_assignedNurse ON home_care_requests(assignedNurseId);
CREATE INDEX IF NOT EXISTS idx_hcr_advisedDoc ON home_care_requests(advisedByDoctorId);
CREATE INDEX IF NOT EXISTS idx_hcr_status ON home_care_requests(status);
CREATE INDEX IF NOT EXISTS idx_hcr_requestNumber ON home_care_requests(requestNumber);

CREATE TABLE IF NOT EXISTS care_visit_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  homeCareRequestId TEXT DEFAULT '',
  scheduleId TEXT DEFAULT '',
  assignmentId TEXT DEFAULT '',
  nurseId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  visitDate TEXT NOT NULL,
  vitals TEXT DEFAULT '{}',                      -- JSON: { bpSystolic, bpDiastolic, pulseRate, temperature, spo2, bloodSugar, respiratoryRate }
  symptomsObserved TEXT DEFAULT '[]',            -- JSON array
  proceduresPerformed TEXT DEFAULT '[]',         -- JSON array
  medicationsAdministered TEXT DEFAULT '[]',     -- JSON array
  careNotes TEXT NOT NULL,
  patientCondition TEXT DEFAULT 'stable',        -- 'stable', 'improving', 'deteriorating', 'critical'
  doctorFeedbackRequired INTEGER DEFAULT 0,
  doctorFeedbackNotes TEXT DEFAULT '',
  attachments TEXT DEFAULT '[]',                 -- JSON array of file URLs
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cvr_nurseId ON care_visit_records(nurseId);
CREATE INDEX IF NOT EXISTS idx_cvr_patientId ON care_visit_records(patientId);
CREATE INDEX IF NOT EXISTS idx_cvr_requestId ON care_visit_records(homeCareRequestId);
CREATE INDEX IF NOT EXISTS idx_cvr_visitDate ON care_visit_records(visitDate);


-- ============================================================
-- NURSE-DOCTOR AFFILIATIONS & ASSIGNMENTS TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS nurse_doctor_affiliations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  nurseId TEXT NOT NULL,
  doctorId TEXT NOT NULL,
  affiliationType TEXT DEFAULT 'employed',       -- 'employed', 'network_associate', 'clinic_staff', 'independent_partner'
  status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'inactive'
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(nurseId, doctorId)
);

CREATE INDEX IF NOT EXISTS idx_nda_nurseId ON nurse_doctor_affiliations(nurseId);
CREATE INDEX IF NOT EXISTS idx_nda_doctorId ON nurse_doctor_affiliations(doctorId);
CREATE INDEX IF NOT EXISTS idx_nda_status ON nurse_doctor_affiliations(status);

CREATE TABLE IF NOT EXISTS nurse_patient_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  nurseId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  assignedByDoctorId TEXT DEFAULT '',
  assignmentType TEXT NOT NULL DEFAULT 'general_care', -- 'general_care', 'wound_care', 'post_op', 'physiotherapy', 'medication_administration', 'chronic_disease_monitoring', 'elderly_care'
  diseaseCondition TEXT DEFAULT '',
  startDate TEXT NOT NULL,
  endDate TEXT DEFAULT NULL,
  frequency TEXT DEFAULT 'daily',                -- 'daily', 'weekly', 'biweekly', 'as_needed', 'custom'
  specialInstructions TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'paused', 'completed', 'terminated'
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_npa_nurseId ON nurse_patient_assignments(nurseId);
CREATE INDEX IF NOT EXISTS idx_npa_patientId ON nurse_patient_assignments(patientId);
CREATE INDEX IF NOT EXISTS idx_npa_docId ON nurse_patient_assignments(assignedByDoctorId);
CREATE INDEX IF NOT EXISTS idx_npa_status ON nurse_patient_assignments(status);

CREATE TABLE IF NOT EXISTS doctor_patient_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  doctorId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  assignmentType TEXT DEFAULT 'primary_care',    -- 'primary_care', 'consultant', 'referred', 'specialist'
  source TEXT DEFAULT 'prescription',            -- 'prescription', 'referral', 'manual_link', 'direct_registration'
  status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'discharged', 'transferred', 'inactive'
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(doctorId, patientId, familyProfileId)
);

CREATE INDEX IF NOT EXISTS idx_dpa_doctorId ON doctor_patient_assignments(doctorId);
CREATE INDEX IF NOT EXISTS idx_dpa_patientId ON doctor_patient_assignments(patientId);
CREATE INDEX IF NOT EXISTS idx_dpa_status ON doctor_patient_assignments(status);


-- ============================================================
-- NURSE SCHEDULING TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS nurse_schedules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  nurseId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  familyProfileId TEXT DEFAULT '',
  patientDisplayId TEXT DEFAULT '',
  assignmentId TEXT DEFAULT '',
  homeCareRequestId TEXT DEFAULT '',
  startDatetime TEXT NOT NULL,                   -- ISO 8601 string: 2026-08-15T09:00:00.000Z
  endDatetime TEXT NOT NULL,                     -- ISO 8601 string: 2026-08-15T10:30:00.000Z
  serviceType TEXT NOT NULL,
  locationAddress TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',      -- 'scheduled', 'en_route', 'in_progress', 'completed', 'missed', 'cancelled', 'rescheduled'
  notes TEXT DEFAULT '',
  cancellationReason TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ns_nurseId ON nurse_schedules(nurseId);
CREATE INDEX IF NOT EXISTS idx_ns_patientId ON nurse_schedules(patientId);
CREATE INDEX IF NOT EXISTS idx_ns_startDatetime ON nurse_schedules(startDatetime);
CREATE INDEX IF NOT EXISTS idx_ns_endDatetime ON nurse_schedules(endDatetime);
CREATE INDEX IF NOT EXISTS idx_ns_status ON nurse_schedules(status);


-- ============================================================
-- PHARMACY INVENTORY & STOCK MANAGEMENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS pharmacy_inventory (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pharmacistId TEXT NOT NULL,
  pharmacyName TEXT DEFAULT '',
  medicineName TEXT NOT NULL,
  genericName TEXT DEFAULT '',
  dosageForm TEXT DEFAULT 'Tablet',             -- 'Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Other'
  strength TEXT DEFAULT '',                     -- e.g. '500mg', '100mg', '10ml'
  manufacturer TEXT DEFAULT '',
  batchNumber TEXT DEFAULT '',
  expiryDate TEXT DEFAULT '',                   -- e.g. '2027-12-31'
  quantity INTEGER DEFAULT 0,
  unitPrice REAL DEFAULT 0.0,
  mrp REAL DEFAULT 0.0,
  reorderLevel INTEGER DEFAULT 10,
  rackLocation TEXT DEFAULT '',                 -- e.g. 'Rack A-3', 'Shelf 2'
  status TEXT DEFAULT 'in_stock',               -- 'in_stock', 'low_stock', 'out_of_stock', 'expired'
  isCustom INTEGER DEFAULT 0,                   -- 0 = master catalog item, 1 = custom added by pharmacist
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pi_pharmacistId ON pharmacy_inventory(pharmacistId);
CREATE INDEX IF NOT EXISTS idx_pi_medicineName ON pharmacy_inventory(medicineName);
CREATE INDEX IF NOT EXISTS idx_pi_status ON pharmacy_inventory(status);
CREATE INDEX IF NOT EXISTS idx_pi_expiryDate ON pharmacy_inventory(expiryDate);



