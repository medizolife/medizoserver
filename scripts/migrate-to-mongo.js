/*
 Migration script: reads server/data/users.json and server/data/prescriptions.json
 and imports them into MongoDB Atlas using the application's Mongoose models.

 Usage:
 1. Ensure MONGO_URI (or server/config/mongo.json) is configured.
 2. From the repo root: cd server
 3. Run: npm run migrate

 The script will:
 - Upsert users by email (preserving existing users) and map old ids -> new ObjectIds
 - Insert prescriptions, resolving doctor/patient IDs via the mapping
 - Skip prescriptions where doctor or patient cannot be resolved
*/

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { getMongoUri } = require('../config/mongo.config');

const User = require('../models/UserModel');
const Prescription = require('../models/PrescriptionModel');

const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const prescriptionsFile = path.join(__dirname, '..', 'data', 'prescriptions.json');

async function loadJson(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse', file, err.message);
    return [];
  }
}

async function main() {
  const mongoUri = getMongoUri();
  if (!mongoUri) {
    console.error('MONGO_URI not configured. Set environment variable or create server/config/mongo.json');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  const users = await loadJson(usersFile);
  const prescriptions = await loadJson(prescriptionsFile);

  const idMap = {}; // oldId -> newId
  const emailMap = {}; // email -> newId

  console.log(`Found ${users.length} users and ${prescriptions.length} prescriptions in JSON files`);

  // Import users
  for (const u of users) {
    try {
      const email = String(u.email).toLowerCase();
      // Check existing by email
      let existing = await User.findOne({ email });
      if (existing) {
        console.log('User exists, skipping:', email);
        idMap[u.id] = existing._id.toString();
        emailMap[email] = existing._id.toString();
        continue;
      }

      // Prepare user data
      const userData = {
        firstName: u.firstName || u.first_name || '',
        lastName: u.lastName || u.last_name || '',
        email,
        role: u.role || 'patient',
        specialization: u.specialization || '',
        licenseNumber: u.licenseNumber || '',
        dateOfBirth: u.dateOfBirth || '',
        gender: u.gender || '',
        phone: u.phone || u.contactNumber || '',
        contactNumber: u.contactNumber || u.phone || '',
        address: u.address || '',
        bloodType: u.bloodType || '',
        allergies: u.allergies || [],
        chronicConditions: u.chronicConditions || [],
        medicalHistory: u.medicalHistory || '',
        emergencyContact: u.emergencyContact || { name: '', relationship: '', phone: '' }
      };

      // Handle password: if it looks like bcrypt hash, keep it; otherwise hash it
      let password = u.password || 'password123';
      if (!/^\$2[aby]\$/.test(password)) {
        const salt = await bcrypt.genSalt(10);
        password = await bcrypt.hash(password, salt);
      }
      userData.password = password;

      // Use create() and improved error logging
      try {
        const newUser = await User.create(userData);
        console.log('Imported user:', email);
        idMap[u.id] = newUser._id.toString();
        emailMap[email] = newUser._id.toString();
      } catch (createErr) {
        // Log stack for debugging
        console.error('Failed to import user', u.email, createErr.stack || createErr.message || createErr);
      }
    } catch (err) {
      console.error('Unexpected error while importing user', u.email, err.stack || err.message || err);
    }
  }

  // Import prescriptions
  let importedCount = 0;
  for (const p of prescriptions) {
    try {
      // Resolve patient and doctor
      let patientId = null;
      let doctorId = null;

      if (p.patientId && idMap[p.patientId]) patientId = idMap[p.patientId];
      if (!patientId && p.patientEmail) {
        const email = String(p.patientEmail).toLowerCase();
        if (emailMap[email]) patientId = emailMap[email];
      }

      if (p.doctorId && idMap[p.doctorId]) doctorId = idMap[p.doctorId];

      if (!patientId || !doctorId) {
        console.warn('Skipping prescription due to unresolved doctor/patient:', p.id, p.patientEmail);
        continue;
      }

      const doc = new Prescription({
        doctorId,
        patientId,
        patientEmail: p.patientEmail || '',
        diagnosis: p.diagnosis || p.reason || '',
        medication: p.medication || '',
        medications: p.medications || [],
        dosage: p.dosage || '',
        frequency: p.frequency || '',
        duration: p.duration || '',
        instructions: p.instructions || '',
        notes: p.notes || '',
        followUpDate: p.followUpDate || p.follow_up_date || '',
        qrCode: p.qrCode || '',
        status: p.status || 'active'
      });

      await doc.save();
      importedCount++;
    } catch (err) {
      console.error('Failed to import prescription', p.id, err.message);
    }
  }

  console.log(`Imported ${importedCount} prescriptions`);

  // Done
  await mongoose.disconnect();
  console.log('Migration complete. Disconnected from MongoDB.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
