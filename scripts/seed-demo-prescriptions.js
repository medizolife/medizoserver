const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// Set DNS servers for Windows SRV resolution
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/test?appName=MedizoLife';

const User = require('../models/UserModel');
const PrescriptionModel = require('../models/PrescriptionModel');
const { createPrescription } = require('../models/prescription');

async function seedDemoPrescriptions() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas!');

    // 1. Ensure Test Doctor accounts exist
    const doctorEmails = ['doctor@test.com', 'doctor@medizo.life'];
    const createdDoctors = [];

    for (const email of doctorEmails) {
      let doc = await User.findOne({ email });
      if (!doc) {
        doc = new User({
          firstName: 'Dr. John',
          lastName: 'Smith',
          email: email,
          password: 'password123',
          role: 'doctor',
          specialization: 'Cardiology & General Medicine',
          licenseNumber: 'DOC-2026-MEDIZO',
          clinicName: 'Medizo Care Center',
          clinicAddress: '100 Health Way, Suite 400',
          experience: '12 years',
          qualifications: 'MBBS, MD (Cardiology)'
        });
        await doc.save();
        console.log(`✅ Created Doctor: ${email}`);
      } else {
        console.log(`ℹ️ Existing Doctor found: ${email}`);
      }
      createdDoctors.push(doc);
    }

    // 2. Ensure Test Patient accounts exist
    const patientEmails = ['patient@test.com', 'patient@medizo.life'];
    const createdPatients = [];

    for (const email of patientEmails) {
      let pat = await User.findOne({ email });
      if (!pat) {
        pat = new User({
          firstName: 'Sarah',
          lastName: 'Johnson',
          email: email,
          password: 'password123',
          role: 'patient',
          dateOfBirth: '1992-06-15',
          gender: 'female',
          phone: '+1 555-0199',
          address: '742 Evergreen Terrace',
          bloodType: 'A+'
        });
        await pat.save();
        console.log(`✅ Created Patient: ${email}`);
      } else {
        console.log(`ℹ️ Existing Patient found: ${email}`);
      }
      createdPatients.push(pat);
    }

    // Main Doctor & Patient for prescribing
    const mainDoctor = createdDoctors[0];
    const mainPatient = createdPatients[0];
    const docName = `Dr. ${mainDoctor.firstName || 'John'} ${mainDoctor.lastName || 'Smith'}`.trim();
    const patName = `${mainPatient.firstName || 'Sarah'} ${mainPatient.lastName || 'Johnson'}`.trim();

    // Demo Prescription 1: Respiratory Infection
    const rx1Data = {
      doctorId: mainDoctor._id.toString(),
      doctorName: docName,
      doctorSpecialization: mainDoctor.specialization || 'Cardiology & General Medicine',
      doctorLicenseNumber: mainDoctor.licenseNumber || 'DOC-2026-MEDIZO',
      patientId: mainPatient._id.toString(),
      patientName: patName,
      patientEmail: mainPatient.email,
      patientAge: '32',
      patientGender: 'Female',

      vitalSigns: {
        bloodPressure: '120/80',
        pulse: '78',
        temperature: '99.1',
        spo2: '98',
        respiratoryRate: '16',
        bmi: '22.5'
      },
      presentingComplaints: ['Fever for 3 days', 'Dry cough', 'Throat pain'],
      clinicalFindings: ['Pharyngeal erythema', 'Chest clear on auscultation'],
      provisionalDiagnosis: ['Acute Upper Respiratory Tract Infection (URTI)'],
      medications: [
        {
          name: 'Tab. Azithromycin 500 mg',
          type: 'Antibiotic',
          dosage: '1 tablet once daily',
          duration: '5 days',
          instructions: 'Take 1 hour before meals'
        },
        {
          name: 'Tab. Montair-LC (Montelukast 10mg + Levocetirizine 5mg)',
          type: 'Anti-allergic',
          dosage: '1 tablet at bedtime',
          duration: '7 days',
          instructions: 'Take at night'
        },
        {
          name: 'Tab. Dolo 650 mg (Paracetamol)',
          type: 'Antipyretic',
          dosage: '1 tablet SOS for fever',
          duration: '5 days',
          instructions: 'Take after food if fever > 99.5°F'
        }
      ],
      dietModifications: ['Warm saline gargles 3 times daily', 'Increase fluid intake'],
      followUpDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    // Demo Prescription 2: Diabetes & Hypertension
    const rx2Data = {
      doctorId: mainDoctor._id.toString(),
      doctorName: docName,
      doctorSpecialization: mainDoctor.specialization || 'Cardiology & General Medicine',
      doctorLicenseNumber: mainDoctor.licenseNumber || 'DOC-2026-MEDIZO',
      patientId: mainPatient._id.toString(),
      patientName: patName,
      patientEmail: mainPatient.email,
      patientAge: '32',
      patientGender: 'Female',

      vitalSigns: {
        bloodPressure: '135/85',
        pulse: '72',
        temperature: '98.6',
        spo2: '99',
        respiratoryRate: '14',
        bmi: '24.1'
      },
      presentingComplaints: ['Routine follow-up for Diabetes & Blood Pressure'],
      clinicalFindings: ['BP 135/85 mmHg', 'Fasting Blood Sugar: 118 mg/dL', 'HbA1c: 6.4%'],
      provisionalDiagnosis: ['Type 2 Diabetes Mellitus - Controlled', 'Essential Hypertension - Mild'],
      medications: [
        {
          name: 'Tab. Metformin 500 mg',
          type: 'Anti-diabetic',
          dosage: '1 tablet twice daily',
          duration: '30 days',
          instructions: 'Take with breakfast and dinner'
        },
        {
          name: 'Tab. Telmisartan 40 mg',
          type: 'Anti-hypertensive',
          dosage: '1 tablet once daily in morning',
          duration: '30 days',
          instructions: 'Take after breakfast'
        },
        {
          name: 'Tab. Atorvastatin 10 mg',
          type: 'Lipid Lowering',
          dosage: '1 tablet at night',
          duration: '30 days',
          instructions: 'Take after dinner'
        }
      ],
      dietModifications: ['Low salt & low sugar diet', '30 minutes daily morning brisk walk'],
      testsRequired: ['HbA1c after 3 months', 'Lipid Profile', 'KFT'],
      followUpDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    // Demo Prescription 3: Acute Gastroenteritis
    const rx3Data = {
      doctorId: mainDoctor._id.toString(),
      doctorName: docName,
      doctorSpecialization: mainDoctor.specialization || 'Cardiology & General Medicine',
      doctorLicenseNumber: mainDoctor.licenseNumber || 'DOC-2026-MEDIZO',
      patientId: mainPatient._id.toString(),
      patientName: patName,
      patientEmail: mainPatient.email,
      patientAge: '32',
      patientGender: 'Female',

      vitalSigns: {
        bloodPressure: '110/70',
        pulse: '84',
        temperature: '98.4',
        spo2: '98',
        respiratoryRate: '16',
        bmi: '22.5'
      },
      presentingComplaints: ['Loose stools 4-5 times', 'Abdominal cramps', 'Mild nausea'],
      clinicalFindings: ['Mild abdominal tenderness in epigastrium', 'Normal bowel sounds'],
      provisionalDiagnosis: ['Acute Gastroenteritis'],
      medications: [
        {
          name: 'Tab. Ofloxacin 200 mg + Ornidazole 500 mg (O2)',
          type: 'Anti-diarrhoeal / Antibiotic',
          dosage: '1 tablet twice daily',
          duration: '5 days',
          instructions: 'Take after food'
        },
        {
          name: 'Sachet ORS (Electral)',
          type: 'Rehydration',
          dosage: '1 sachet dissolved in 1L water',
          duration: '3 days',
          instructions: 'Sip throughout the day'
        },
        {
          name: 'Tab. Pantoprazole 40 mg',
          type: 'Antacid / PPI',
          dosage: '1 tablet once daily before breakfast',
          duration: '5 days',
          instructions: 'Take 30 mins before food'
        }
      ],
      dietModifications: ['Light BLAND diet (Kichadi, Curd rice, Banana)', 'Avoid spicy, oily & outside food'],
      followUpDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    const rxs = [rx1Data, rx2Data, rx3Data];
    for (let i = 0; i < rxs.length; i++) {
      const created = await createPrescription(rxs[i]);
      console.log(`\n✅ Created Prescription ${i + 1}:`);
      console.log(`   ID:        ${created._id || created.id}`);
      console.log(`   Doctor:    ${created.doctorName} (${mainDoctor.email})`);
      console.log(`   Patient:   ${created.patientName} (${mainPatient.email})`);
      console.log(`   Diagnosis: ${created.provisionalDiagnosis.join(', ')}`);
      console.log(`   QR Code:   ${created.qrCode}`);
    }

    console.log('\n==========================================');
    console.log('SUCCESS: All 3 demo prescriptions created!');
    console.log('Test Accounts to Login:');
    console.log('  Doctor:  doctor@test.com / doctor@medizo.life (password: password123)');
    console.log('  Patient: patient@test.com / patient@medizo.life (password: password123)');
    console.log('==========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error creating demo prescriptions:', error);
    process.exit(1);
  }
}

seedDemoPrescriptions();
