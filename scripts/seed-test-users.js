const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// Set DNS servers for Windows SRV resolution
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const MONGO_URI = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/?appName=MedizoLife';

const User = require('../models/UserModel');

// Define Pharmacist Schema inline
const pharmacistSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  pharmacyName: { type: String, required: true },
  licenseNumber: { type: String, required: true },
  phone: { type: String, default: '' },
  role: { type: String, default: 'pharmacist' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

pharmacistSchema.pre('save', async function() {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const Pharmacist = mongoose.models.Pharmacist || mongoose.model('Pharmacist', pharmacistSchema);

async function seedTestUsers() {
  try {
    console.log('Connecting to shared MongoDB cluster...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB Atlas!');

    // 1. Create/Update Doctor Account
    const doctorData = {
      firstName: 'John',
      lastName: 'Smith',
      email: 'doctor@medizo.life',
      password: 'password123',
      role: 'doctor',
      specialization: 'Cardiology & General Medicine',
      licenseNumber: 'DOC-2026-MEDIZO',
      clinicName: 'Medizo Care Center',
      clinicAddress: '100 Health Way, Suite 400',
      experience: '12 years',
      qualifications: 'MBBS, MD (Cardiology)'
    };

    let existingDoc = await User.findOne({ email: doctorData.email });
    if (existingDoc) {
      existingDoc.firstName = doctorData.firstName;
      existingDoc.lastName = doctorData.lastName;
      existingDoc.password = doctorData.password;
      existingDoc.specialization = doctorData.specialization;
      existingDoc.licenseNumber = doctorData.licenseNumber;
      await existingDoc.save();
      console.log('Updated existing Doctor account: doctor@medizo.life');
    } else {
      const newDoc = new User(doctorData);
      await newDoc.save();
      console.log('Created new Doctor account: doctor@medizo.life');
    }

    // 2. Create/Update Patient Account
    const patientData = {
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'patient@medizo.life',
      password: 'password123',
      role: 'patient',
      dateOfBirth: '1992-06-15',
      gender: 'female',
      phone: '+1 555-0199',
      address: '742 Evergreen Terrace',
      bloodType: 'A+'
    };

    let existingPat = await User.findOne({ email: patientData.email });
    if (existingPat) {
      existingPat.firstName = patientData.firstName;
      existingPat.lastName = patientData.lastName;
      existingPat.password = patientData.password;
      existingPat.phone = patientData.phone;
      await existingPat.save();
      console.log('Updated existing Patient account: patient@medizo.life');
    } else {
      const newPat = new User(patientData);
      await newPat.save();
      console.log('Created new Patient account: patient@medizo.life');
    }

    // 3. Create/Update Pharmacist Accounts in UserModel
    const pharmacistEmails = ['pharmacist@test.com', 'pharma@medizo.life', 'pharma@test.com'];

    for (const email of pharmacistEmails) {
      let existingPharma = await User.findOne({ email });
      if (existingPharma) {
        existingPharma.firstName = 'Medizo';
        existingPharma.lastName = 'Pharmacist';
        existingPharma.password = 'password123';
        existingPharma.role = 'pharmacist';
        existingPharma.pharmacyName = 'Medizo Central Pharmacy';
        existingPharma.licenseNumber = 'PHARMA-2026-MEDIZO';
        await existingPharma.save();
        console.log(`Updated Pharmacist account in UserModel: ${email}`);
      } else {
        const newPharma = new User({
          firstName: 'Medizo',
          lastName: 'Pharmacist',
          email,
          password: 'password123',
          role: 'pharmacist',
          pharmacyName: 'Medizo Central Pharmacy',
          licenseNumber: 'PHARMA-2026-MEDIZO'
        });
        await newPharma.save();
        console.log(`Created Pharmacist account in UserModel: ${email}`);
      }
    }

    console.log('\n==========================================');
    console.log('SUCCESS: All test credentials saved to MongoDB Atlas!');
    console.log('==========================================\n');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding test users:', error);
    process.exit(1);
  }
}

seedTestUsers();
