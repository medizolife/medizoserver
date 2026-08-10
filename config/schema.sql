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

