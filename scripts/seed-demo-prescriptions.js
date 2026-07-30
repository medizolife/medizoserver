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

    // Demo Prescription 4: Migraine & Seasonal Allergies
    const rx4Data = {
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
        bloodPressure: '118/76',
        pulse: '74',
        temperature: '98.6',
        spo2: '99',
        respiratoryRate: '15',
        bmi: '22.5'
      },
      presentingComplaints: ['Throbbing unilateral headache', 'Photophobia & nausea', 'Nasal congestion'],
      clinicalFindings: ['Bilateral nasal mucosa congestion', 'Neurological exam intact'],
      provisionalDiagnosis: ['Acute Migraine without Aura', 'Seasonal Allergic Rhinitis'],
      medications: [
        {
          name: 'Tab. Naproxen 500 mg + Domperidone 10 mg (Naxdom 500)',
          type: 'Analgesic / Anti-emetic',
          dosage: '1 tablet SOS at onset of headache',
          duration: '5 days',
          instructions: 'Take immediately with warm water after light snack'
        },
        {
          name: 'Nasal Spray Fluticasone Furoate (Avamys)',
          type: 'Corticosteroid Nasal Spray',
          dosage: '2 sprays per nostril once daily',
          duration: '14 days',
          instructions: 'Gently blow nose before spraying'
        },
        {
          name: 'Tab. Bilastine 20 mg (Bilaxten)',
          type: 'Second-generation Antihistamine',
          dosage: '1 tablet once daily morning',
          duration: '10 days',
          instructions: 'Take on empty stomach 1 hour before breakfast'
        }
      ],
      dietModifications: ['Avoid chocolate, aged cheese, and artificial sweeteners', 'Stay hydrated (2.5L water daily)'],
      followUpDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    // Demo Prescription 5: Lumbar Muscle Strain & Back Pain
    const rx5Data = {
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
        bloodPressure: '122/80',
        pulse: '76',
        temperature: '98.4',
        spo2: '98',
        respiratoryRate: '16',
        bmi: '22.5'
      },
      presentingComplaints: ['Lower back stiffness and ache after prolonged sitting', 'Radiation to right hip'],
      clinicalFindings: ['Tenderness over L4-L5 lumbar region', 'Straight leg raise (SLR) test positive at 70 degrees'],
      provisionalDiagnosis: ['Acute Lumbar Muscle Strain', 'Mild Mechanical Low Back Pain'],
      medications: [
        {
          name: 'Tab. Aceclofenac 100 mg + Thiocolchicoside 4 mg (Zerodol-TH4)',
          type: 'NSAID / Muscle Relaxant',
          dosage: '1 tablet twice daily',
          duration: '7 days',
          instructions: 'Take after meals with milk'
        },
        {
          name: 'Tab. Pregabalin 75 mg (Maxgalin 75)',
          type: 'Neuropathic Pain Modifier',
          dosage: '1 capsule at bedtime',
          duration: '10 days',
          instructions: 'Take at night before sleep'
        },
        {
          name: 'Ointment Volini Gel (Diclofenac 1.16% w/w)',
          type: 'Topical Analgesic',
          dosage: 'Apply gently over lower back 3 times daily',
          duration: '7 days',
          instructions: 'Do not massage vigorously; apply heat compress after 30 mins'
        }
      ],
      dietModifications: ['Use ergonomic lumbar support pillow while sitting', 'Avoid lifting heavy objects (>5kg)'],
      testsRequired: ['X-Ray Lumbar Spine LS (AP & Lateral views)'],
      followUpDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    // Demo Prescription 6: Iron Deficiency Anemia & Vitamin D Deficiency
    const rx6Data = {
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
        bloodPressure: '116/74',
        pulse: '82',
        temperature: '98.6',
        spo2: '99',
        respiratoryRate: '16',
        bmi: '22.5'
      },
      presentingComplaints: ['General tiredness and weakness', 'Brittle nails & mild hair thinning', 'Dizziness on sudden standing'],
      clinicalFindings: ['Pallor present in lower conjunctiva', 'Koilonychia (mild)', 'Serum Hb: 9.8 g/dL', '25-OH Vitamin D: 14 ng/mL'],
      provisionalDiagnosis: ['Moderate Iron Deficiency Anaemia', 'Vitamin D3 Insufficiency'],
      medications: [
        {
          name: 'Tab. Ferrous Ascorbate 100 mg + Folic Acid 1.5 mg (Orofer XT)',
          type: 'Iron Supplement',
          dosage: '1 tablet once daily after lunch',
          duration: '30 days',
          instructions: 'Take with Vitamin C rich drink (orange juice/lemon water); avoid tea/coffee 2 hrs before/after'
        },
        {
          name: 'Sachet Cholecalciferol 60,000 IU (Uprise-D3 60k)',
          type: 'Vitamin D3 Supplement',
          dosage: '1 sachet in warm milk once a week',
          duration: '8 weeks',
          instructions: 'Take every Sunday after evening meal'
        },
        {
          name: 'Cap. Methylcobalamin 1500 mcg + Alpha Lipoic Acid (Reconeuron)',
          type: 'Multivitamin / Nerve Tonic',
          dosage: '1 capsule once daily after breakfast',
          duration: '30 days',
          instructions: 'Take with water after food'
        }
      ],
      dietModifications: ['Rich iron diet: Spinach, Pomegranate, Dates, Beetroot, Jaggery', '15-20 mins early morning sunlight exposure'],
      testsRequired: ['Repeat Complete Blood Count (CBC) after 30 days'],
      followUpDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    };

    const rxs = [rx1Data, rx2Data, rx3Data, rx4Data, rx5Data, rx6Data];
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
