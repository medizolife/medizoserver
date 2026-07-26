/**
 * Create a comprehensive demo prescription to test PDF generation.
 * Usage: cd server && node scripts/create-demo-prescription.js
 */
const { createPrescription } = require('../models/prescription');

async function main() {
  // Use existing doctor (Sam Cruise) and patient (Ace Player)
  const doctorId = '1769810977372';
  const patientId = '1769377243514';
  const patientEmail = 'aceplayer547@gmail.com';

  const demoPrescription = {
    doctorId,
    patientId,
    patientEmail,

    // ── Vital Signs ──────────────────────────────────
    vitalSigns: {
      bloodPressure: '138/88',
      pulse: '84',
      temperature: '99.2',
      spo2: '96',
      respiratoryRate: '18',
      bmi: '27.4',
      painScale: '7'
    },

    // ── Chief Complaints ─────────────────────────────
    presentingComplaints: [
      'Persistent dry cough for 2 weeks',
      'Low-grade fever (99–100 °F) since 5 days',
      'Generalized body ache and fatigue',
      'Loss of appetite and mild nausea',
      'Mild shortness of breath on exertion'
    ],

    // ── Clinical Findings ────────────────────────────
    clinicalFindings: [
      'Bilateral rhonchi on auscultation',
      'Mild pharyngeal congestion',
      'Cervical lymphadenopathy (non-tender)',
      'No hepatosplenomegaly',
      'Mild tenderness in epigastric region'
    ],

    // ── Provisional Diagnosis ───────────────────────
    provisionalDiagnosis: [
      'Acute Bronchitis',
      'Viral Upper Respiratory Tract Infection',
      'Mild Gastritis',
      'Iron Deficiency Anaemia (suspected)'
    ],

    // ── Patient History ──────────────────────────────
    currentMedications: [
      'Metformin 500 mg BD (for Type 2 DM)',
      'Amlodipine 5 mg OD (for Hypertension)',
      'Atorvastatin 10 mg HS'
    ],
    pastSurgicalHistory: [
      'Appendectomy (2018)',
      'Right inguinal hernia repair (2021)'
    ],

    // ── Prescribed Medications (7) ──────────────────
    medications: [
      {
        name: 'Tab. Azithromycin 500 mg',
        type: 'Antibiotic',
        dosage: '1 tablet once daily',
        duration: '5 days',
        instructions: 'Take 1 hour before meals on an empty stomach'
      },
      {
        name: 'Tab. Montelukast 10 mg + Levocetirizine 5 mg (Montair-LC)',
        type: 'Anti-allergic / Bronchodilator',
        dosage: '1 tablet at bedtime',
        duration: '14 days',
        instructions: 'Take at night before sleep; avoid driving if drowsy'
      },
      {
        name: 'Syp. Ambroxol 30 mg/5 ml (Mucolite)',
        type: 'Mucolytic / Expectorant',
        dosage: '10 ml three times a day',
        duration: '7 days',
        instructions: 'Take after meals; drink plenty of warm fluids'
      },
      {
        name: 'Tab. Pantoprazole 40 mg',
        type: 'Proton Pump Inhibitor',
        dosage: '1 tablet once daily before breakfast',
        duration: '14 days',
        instructions: 'Take 30 minutes before first meal of the day'
      },
      {
        name: 'Tab. Paracetamol 650 mg (Dolo 650)',
        type: 'Antipyretic / Analgesic',
        dosage: '1 tablet SOS (max 3 per day)',
        duration: '5 days',
        instructions: 'Take only when fever > 100°F or severe body ache; gap of 6 hrs between doses'
      },
      {
        name: 'Cap. Ferrous Ascorbate + Folic Acid (Orofer-XT)',
        type: 'Iron Supplement',
        dosage: '1 capsule once daily after lunch',
        duration: '30 days',
        instructions: 'Avoid taking with tea/coffee/milk; take with orange juice for better absorption'
      },
      {
        name: 'Tab. Vitamin D3 60,000 IU (Calcirol)',
        type: 'Vitamin Supplement',
        dosage: '1 sachet once a week',
        duration: '8 weeks',
        instructions: 'Dissolve in a glass of milk or water; take after a fatty meal'
      }
    ],

    medicationNotes: [
      'Continue existing Metformin, Amlodipine & Atorvastatin as prescribed',
      'Monitor blood sugar closely; antibiotics may alter glucose levels',
      'Report immediately if rash, breathing difficulty or severe diarrhoea occurs'
    ],

    // ── Investigations ──────────────────────────────
    investigations: [
      {
        testName: 'Complete Blood Count (CBC) with ESR',
        reason: 'Rule out infection and check for anaemia',
        priority: 'Urgent',
        fasting: 'Not required'
      },
      {
        testName: 'Chest X-Ray (PA View)',
        reason: 'Evaluate persistent cough and rule out pneumonia',
        priority: 'Urgent',
        fasting: 'Not required'
      },
      {
        testName: 'Liver Function Test (LFT)',
        reason: 'Baseline before antibiotic course; check for hepatic involvement',
        priority: 'Routine',
        fasting: '10-12 hours'
      },
      {
        testName: 'Serum Iron, TIBC & Ferritin',
        reason: 'Confirm iron deficiency anaemia',
        priority: 'Routine',
        fasting: '10-12 hours'
      },
      {
        testName: 'HbA1c (Glycated Haemoglobin)',
        reason: 'Review diabetes control (3-month average)',
        priority: 'Routine',
        fasting: 'Not required'
      },
      {
        testName: 'Thyroid Profile (TSH, T3, T4)',
        reason: 'Fatigue and weight gain evaluation',
        priority: 'Routine',
        fasting: 'Early morning preferred'
      }
    ],
    investigationNotes: 'Get all fasting blood tests done early morning. Bring previous reports for comparison. Chest X-Ray to be done at a certified radiology centre.',

    // ── Tests Required (legacy field) ───────────────
    testsRequired: [
      'CBC with ESR',
      'Chest X-Ray PA',
      'LFT',
      'Serum Iron / TIBC / Ferritin',
      'HbA1c',
      'Thyroid Profile'
    ],

    // ── Diet Modifications ──────────────────────────
    dietModifications: [
      'Increase intake of green leafy vegetables (spinach, kale) for iron',
      'Include citrus fruits (orange, lemon) to aid iron absorption',
      'Avoid spicy, oily and fried food to reduce gastric irritation',
      'Drink at least 8-10 glasses of warm water daily',
      'Include protein-rich foods: eggs, lentils, chicken, paneer',
      'Limit caffeine and carbonated beverages'
    ],

    // ── Lifestyle Changes ───────────────────────────
    lifestyleChanges: [
      'Complete bed rest for 3 days; avoid strenuous physical activity',
      'Steam inhalation twice daily (morning and night) for congestion relief',
      'Gargle with warm salt water 3 times a day',
      'Maintain regular sleep schedule (7-8 hours); avoid late nights',
      'Brisk walking for 20 minutes after recovery (from Day 5 onwards)',
      'Avoid exposure to dust, smoke and cold air'
    ],

    // ── Warning Signs ───────────────────────────────
    warningSigns: [
      'Fever above 102°F not responding to Paracetamol for more than 24 hours',
      'Difficulty breathing at rest or bluish discolouration of lips/nails',
      'Blood in sputum or persistent vomiting',
      'Severe chest pain or palpitations',
      'Sudden swelling of face, lips or throat (allergic reaction)'
    ],

    // ── Follow-Up Information ───────────────────────
    followUpInfo: {
      appointmentDate: '2026-03-02',
      appointmentTime: '10:30',
      purpose: 'Review investigation reports, assess treatment response, adjust medications if needed',
      bringItems: [
        'All blood test reports',
        'Chest X-Ray film and report',
        'Blood sugar log for past 2 weeks',
        'List of any new symptoms'
      ]
    },
    followUpDate: '2026-03-02',

    emergencyHelpline: '108 / 112',

    // ── Legacy fields ───────────────────────────────
    diagnosis: 'Acute Bronchitis, Viral URTI, Mild Gastritis, Suspected Iron Deficiency Anaemia',
    instructions: 'Complete the full course of antibiotics. Do not self-medicate. Monitor temperature twice daily. Return immediately if warning signs appear.',
    notes: 'Patient is a known case of Type 2 DM and Hypertension on regular medication. Family history of asthma (mother). Non-smoker. Advised to get Influenza and Pneumococcal vaccination.'
  };

  try {
    const result = await createPrescription(demoPrescription);
    console.log('✅ Demo prescription created successfully!');
    console.log('   ID:', result.id);
    console.log('   Doctor:', doctorId, '(Sam Cruise)');
    console.log('   Patient:', patientId, '(Ace Player)');
    console.log('   Medications:', demoPrescription.medications.length);
    console.log('   Investigations:', demoPrescription.investigations.length);
    console.log('   Complaints:', demoPrescription.presentingComplaints.length);
    console.log('   Diagnoses:', demoPrescription.provisionalDiagnosis.length);
    console.log('\n   Open in browser: http://localhost:3000/prescriptions/' + result.id);
    console.log('   Download PDF:    http://localhost:5000/api/prescriptions/' + result.id + '/download');
  } catch (err) {
    console.error('❌ Failed to create demo prescription:', err.message);
    process.exit(1);
  }
}

main();
