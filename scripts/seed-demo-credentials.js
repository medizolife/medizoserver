/**
 * Seed Script to create predictable demo credentials and populated enterprise data in Cloudflare D1
 * Run with: node scripts/seed-demo-credentials.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const connectDB = require('../config/db');
const { createUser, findUserByEmail, updateUser } = require('../models/user');
const { createPrescription } = require('../models/prescription');
const { generateBillFromPrescription } = require('../services/billingService');
const { addDoctorToNetwork, createReferral } = require('../models/networkModel');
const { createHomeCareRequest, assignNurseToRequest, createVisitRecord } = require('../models/homeCareModel');
const { createNurseDoctorAffiliation, assignNurseToPatient } = require('../models/assignmentModel');
const { scheduleVisit } = require('../services/schedulingService');

async function seedData() {
  console.log('====================================================');
  console.log('🌱 Seeding Medizo Demo Credentials & Enterprise Data...');
  console.log('====================================================');

  const connected = await connectDB();
  if (!connected) {
    console.error('❌ Failed to connect to DB');
    process.exit(1);
  }

  const demoPassword = 'Medizo@2026';

  // 1. Admin Accounts
  const adminAccounts = [
    { email: 'admin@medizo.life', firstName: 'System', lastName: 'Administrator', role: 'admin', password: demoPassword, status: 'active' },
    { email: 'admin2@medizo.life', firstName: 'Operations', lastName: 'Admin', role: 'admin', password: demoPassword, status: 'active' },
    { email: 'admin.test@medizo.life', firstName: 'Test', lastName: 'Admin', role: 'admin', password: demoPassword, status: 'active' }
  ];

  for (const acc of adminAccounts) {
    let adm = await findUserByEmail(acc.email);
    if (!adm) {
      await createUser(acc);
    } else {
      await updateUser(adm.id, { password: demoPassword, status: 'active', role: 'admin' });
    }
  }

  // 2. Doctor 1
  let doctor1 = await findUserByEmail('doctor@test.com');
  if (!doctor1) {
    doctor1 = await createUser({
      firstName: 'Sarah',
      lastName: 'Jenkins',
      email: 'doctor@test.com',
      password: demoPassword,
      role: 'doctor',
      specialization: 'Cardiology',
      licenseNumber: 'DOC-88910',
      clinicName: 'Medizo Cardiac Care',
      clinicAddress: '742 Evergreen Terrace, Suite 100',
      phone: '9876543210',
      digilockerVerified: true,
      status: 'active'
    });
  } else {
    await updateUser(doctor1.id, { digilockerVerified: true, status: 'active' });
  }

  // 3. Doctor 2
  let doctor2 = await findUserByEmail('doctor2@test.com');
  if (!doctor2) {
    doctor2 = await createUser({
      firstName: 'Robert',
      lastName: 'Chen',
      email: 'doctor2@test.com',
      password: demoPassword,
      role: 'doctor',
      specialization: 'General Surgery',
      licenseNumber: 'SURG-44120',
      clinicName: 'Medizo Surgical Center',
      clinicAddress: '108 Healthcare Blvd, Floor 3',
      phone: '9876543211',
      digilockerVerified: true,
      status: 'active'
    });
  } else {
    await updateUser(doctor2.id, { digilockerVerified: true, status: 'active' });
  }

  // 4. Nurse 1
  let nurse1 = await findUserByEmail('nurse@test.com');
  if (!nurse1) {
    nurse1 = await createUser({
      firstName: 'Emily',
      lastName: 'Florence',
      email: 'nurse@test.com',
      password: demoPassword,
      role: 'nurse',
      nurseLicenseNumber: 'RN-90412',
      nurseSpecialization: 'Wound Care & Post-Op Recovery',
      nurseQualifications: 'B.Sc. Nursing, Certified Wound Specialist',
      phone: '9876543220',
      status: 'active'
    });
  }

  // 5. Nurse 2
  let nurse2 = await findUserByEmail('nurse2@test.com');
  if (!nurse2) {
    nurse2 = await createUser({
      firstName: 'Clara',
      lastName: 'Nightingale',
      email: 'nurse2@test.com',
      password: demoPassword,
      role: 'nurse',
      nurseLicenseNumber: 'RN-90413',
      nurseSpecialization: 'Elderly & Palliative Care',
      nurseQualifications: 'M.Sc. Nursing',
      phone: '9876543221',
      status: 'active'
    });
  }

  // 6. Patient 1
  let patient1 = await findUserByEmail('patient@test.com');
  if (!patient1) {
    patient1 = await createUser({
      firstName: 'John',
      lastName: 'Doe',
      email: 'patient@test.com',
      password: demoPassword,
      role: 'patient',
      dateOfBirth: '1988-06-15',
      gender: 'male',
      phone: '9876543230',
      address: '123 Healthway Ave, Apt 4B',
      status: 'active'
    });
  }

  // 7. Patient 2
  let patient2 = await findUserByEmail('patient2@test.com');
  if (!patient2) {
    patient2 = await createUser({
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'patient2@test.com',
      password: demoPassword,
      role: 'patient',
      dateOfBirth: '1992-09-20',
      gender: 'female',
      phone: '9876543231',
      address: '456 Care Lane',
      status: 'active'
    });
  }

  console.log('✅ Base user credentials ensured.');

  // 8. Create Doctor Network Connection
  try {
    await addDoctorToNetwork(doctor1.id, doctor2.id, 'Preferred Surgical Colleague');
    console.log('✅ Doctor network connection established.');
  } catch (e) {}

  // 9. Doctor-Nurse Affiliation
  try {
    await createNurseDoctorAffiliation(nurse1.id, doctor1.id, 'employed', 'Primary Clinic Nurse');
    await createNurseDoctorAffiliation(nurse2.id, doctor1.id, 'clinic_staff', 'Palliative Associate');
    console.log('✅ Doctor-Nurse affiliations linked.');
  } catch (e) {}

  // 10. Prescription & Billing Seed
  try {
    const rx1 = await createPrescription({
      doctorId: doctor1.id,
      doctorName: `Dr. ${doctor1.firstName} ${doctor1.lastName}`,
      doctorSpecialization: doctor1.specialization,
      patientId: patient1.id,
      patientName: `${patient1.firstName} ${patient1.lastName}`,
      patientEmail: patient1.email,
      medications: [
        { name: 'Atorvastatin', dosage: '20mg', frequency: '1-0-0', duration: '30 days' },
        { name: 'Aspirin', dosage: '75mg', frequency: '0-1-0', duration: '30 days' }
      ],
      testsRequired: ['Lipid Profile', 'ECG'],
      diagnosis: 'Hypertension & Lipid Control'
    });

    await generateBillFromPrescription(rx1.id, doctor1.id, {
      consultationFee: 750,
      tax: 50,
      discount: 25,
      allowDuplicate: true
    });
    console.log('✅ Seed prescription & invoice created.');
  } catch (e) {
    console.log('Prescription/Bill seed note:', e.message);
  }

  // 11. Home Care Request & Nurse Assignment
  try {
    const hcr = await createHomeCareRequest({
      patientId: patient1.id,
      requestedByRole: 'doctor',
      requestedById: doctor1.id,
      advisedByDoctorId: doctor1.id,
      serviceType: 'wound_care',
      urgency: 'routine',
      preferredDate: '2026-08-16',
      preferredTimeSlot: 'morning',
      address: patient1.address || '123 Healthway Ave',
      contactPhone: patient1.phone || '9876543230',
      clinicalInstructions: 'Daily sterile dressing & BP check'
    });

    await assignNurseToRequest(hcr.id, nurse1.id);

    await assignNurseToPatient({
      nurseId: nurse1.id,
      patientId: patient1.id,
      assignedByDoctorId: doctor1.id,
      assignmentType: 'wound_care',
      diseaseCondition: 'Post-Op Surgical Site',
      startDate: '2026-08-15',
      frequency: 'daily'
    });

    console.log('✅ Home care request & nurse assignment created.');
  } catch (e) {
    console.log('Home care seed note:', e.message);
  }

  // 12. Referral Seed
  try {
    await createReferral({
      referringDoctorId: doctor1.id,
      referredDoctorId: doctor2.id,
      patientId: patient1.id,
      reason: 'Surgical evaluation for cardiac stent procedure',
      clinicalSummary: 'Patient has high LDL and recurrent chest pain',
      priority: 'urgent'
    });
    console.log('✅ Referral seed created.');
  } catch (e) {
    console.log('Referral seed note:', e.message);
  }

  console.log('\n====================================================');
  console.log('🎉 DEMO CREDENTIALS SEEDED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('📋 Account Credentials Summary (All passwords: Medizo@2026):');
  console.log('  1. ADMIN 1: email: admin@medizo.life      | pass: Medizo@2026');
  console.log('  2. ADMIN 2: email: admin2@medizo.life     | pass: Medizo@2026');
  console.log('  3. ADMIN 3: email: admin.test@medizo.life | pass: Medizo@2026');
  console.log('  4. DOCTOR:  email: doctor@test.com        | pass: Medizo@2026');
  console.log('  5. DOCTOR2: email: doctor2@test.com       | pass: Medizo@2026');
  console.log('  6. NURSE:   email: nurse@test.com         | pass: Medizo@2026');
  console.log('  7. NURSE2:  email: nurse2@test.com        | pass: Medizo@2026');
  console.log('  8. PATIENT: email: patient@test.com       | pass: Medizo@2026');
  console.log('  9. PATIENT2:email: patient2@test.com      | pass: Medizo@2026');
  console.log('====================================================');

  process.exit(0);
}

seedData();
