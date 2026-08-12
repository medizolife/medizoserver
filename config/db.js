const fs = require('fs');
const path = require('path');
const { isD1Connected, isD1Configured, execRawSQL } = require('./d1-client');

let isConnected = false;

/**
 * Connect to Cloudflare D1 and run schema migrations.
 * Replaces the old MongoDB connectDB() function.
 * @returns {Promise<boolean>} Whether D1 is connected and ready
 */
const connectDB = async () => {
  if (isConnected) {
    return true;
  }

  if (!isD1Configured()) {
    console.log('Cloudflare D1 credentials not configured. Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_D1_DATABASE_ID in .env');
    return false;
  }

  try {
    console.log('Attempting to connect to Cloudflare D1...');
    
    // Test connectivity
    const connected = await isD1Connected();
    if (!connected) {
      console.log('Cloudflare D1 connection failed.');
      return false;
    }

    // Run schema migrations if schema file is accessible
    try {
      const schemaPath = typeof __dirname !== 'undefined' ? path.join(__dirname, 'schema.sql') : null;
      if (schemaPath && fs.existsSync && fs.existsSync(schemaPath)) {
        console.log('Running D1 schema migrations...');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await execRawSQL(schemaSql);
      }
    } catch (e) {
      console.log('Schema migration notice:', e.message);
    }
      
      // Ensure OTP and Nurse columns exist on existing D1 databases
      const alterCols = [
        'ALTER TABLE users ADD COLUMN loginOtp TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN loginOtpExpires INTEGER DEFAULT 0;',
        'ALTER TABLE users ADD COLUMN resetOtp TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN resetOtpExpires INTEGER DEFAULT 0;',
        'ALTER TABLE users ADD COLUMN clinicLatitude REAL DEFAULT NULL;',
        'ALTER TABLE users ADD COLUMN clinicLongitude REAL DEFAULT NULL;',
        'ALTER TABLE users ADD COLUMN clinicLocationAccuracy REAL DEFAULT NULL;',
        'ALTER TABLE users ADD COLUMN clinicPlaceName TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN stamp TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN nurseLicenseNumber TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN nurseQualifications TEXT DEFAULT "";',
        'ALTER TABLE users ADD COLUMN nurseSpecialization TEXT DEFAULT "";'
      ];
      for (const colSql of alterCols) {
        try {
          await execRawSQL(colSql);
        } catch (e) {
          // Column already exists, safe to ignore
        }
      }

      // Ensure external_prescriptions table exists
      try {
        await execRawSQL(`CREATE TABLE IF NOT EXISTS external_prescriptions (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          patientId TEXT NOT NULL,
          uploadedBy TEXT NOT NULL,
          title TEXT NOT NULL,
          doctorName TEXT DEFAULT "",
          recordDate TEXT DEFAULT "",
          notes TEXT DEFAULT "",
          fileUrl TEXT NOT NULL,
          fileType TEXT DEFAULT "image",
          fileSize INTEGER DEFAULT 0,
          createdAt TEXT DEFAULT (datetime('now')),
          updatedAt TEXT DEFAULT (datetime('now'))
        );`);
      } catch (e) {
        // Table exists, safe to ignore
      }

      console.log('D1 schema migrations completed.');

    // Ensure family_profiles table and prescription columns exist
    const familyMigrations = [
      // Add accountId and patientDisplayId to prescriptions
      'ALTER TABLE prescriptions ADD COLUMN accountId TEXT DEFAULT "";',
      'ALTER TABLE prescriptions ADD COLUMN patientDisplayId TEXT DEFAULT "";',
    ];
    for (const migSql of familyMigrations) {
      try {
        await execRawSQL(migSql);
      } catch (e) {
        // Column already exists, safe to ignore
      }
    }

    // Auto-create self-profiles for existing patients who don't have one
    try {
      await execRawSQL(`
        INSERT OR IGNORE INTO family_profiles (id, accountId, profileIndex, relationship, firstName, lastName, dateOfBirth, gender, phone, address, bloodType, allergies, diseaseHistory, chronicConditions, medicalHistory, emergencyContact, patientDisplayId, isActive)
        SELECT 
          lower(hex(randomblob(16))),
          u.id,
          0,
          'self',
          u.firstName,
          u.lastName,
          COALESCE(u.dateOfBirth, ''),
          COALESCE(u.gender, ''),
          COALESCE(u.phone, u.contactNumber, ''),
          COALESCE(u.address, ''),
          COALESCE(u.bloodType, ''),
          COALESCE(u.allergies, '{"environmental":[],"food":[],"drugs":[],"other":[]}'),
          COALESCE(u.diseaseHistory, '[]'),
          COALESCE(u.chronicConditions, '[]'),
          COALESCE(u.medicalHistory, ''),
          COALESCE(u.emergencyContact, '{"name":"","relationship":"","phone":""}'),
          'PT-' || UPPER(SUBSTR(u.id, -6)) || '[00]',
          1
        FROM users u
        WHERE u.role = 'patient'
        AND u.id NOT IN (SELECT accountId FROM family_profiles WHERE profileIndex = 0)
      `);
      console.log('Family self-profiles migration completed.');
    } catch (e) {
      // Table may not exist yet on first run — it will be created by schema.sql
      if (!e.message?.includes('no such table')) {
        console.error('Family self-profiles migration notice:', e.message);
      }
    }

    // Backfill doctor_patient_assignments from historical prescriptions
    try {
      await execRawSQL(`
        INSERT OR IGNORE INTO doctor_patient_assignments (id, doctorId, patientId, familyProfileId, patientDisplayId, assignmentType, source, status, notes, createdAt, updatedAt)
        SELECT 
          lower(hex(randomblob(16))),
          p.doctorId,
          p.patientId,
          COALESCE(p.accountId, ''),
          COALESCE(p.patientDisplayId, ''),
          'primary_care',
          'prescription',
          'active',
          'Auto-backfilled from historical prescription',
          p.createdAt,
          datetime('now')
        FROM prescriptions p
        WHERE p.doctorId IS NOT NULL AND p.doctorId != ''
        AND p.patientId IS NOT NULL AND p.patientId != ''
        GROUP BY p.doctorId, p.patientId
      `);
      console.log('Doctor-patient assignments backfill completed.');
    } catch (e) {
      if (!e.message?.includes('no such table')) {
        console.error('Doctor-patient assignments backfill notice:', e.message);
      }
    }

    isConnected = true;
    console.log('Cloudflare D1 connected successfully.');
    return true;
  } catch (error) {
    console.error(`D1 connection error: ${error.message}`);
    return false;
  }
};

module.exports = connectDB;
