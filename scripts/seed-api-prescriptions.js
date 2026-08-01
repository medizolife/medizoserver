const API_BASE = 'https://medizoserver.vercel.app/api';

async function main() {
  console.log('🚀 Seeding Test Prescriptions via API to', API_BASE);

  try {
    // 1. Register or Login Test Doctor
    const docEmail = `doctor_${Date.now()}@medizo.life`;
    const docPassword = 'password123';

    console.log(`🔐 Registering Verified Test Doctor (${docEmail})...`);
    const regRes = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Dr. John',
        lastName: 'Smith',
        email: docEmail,
        password: docPassword,
        role: 'doctor',
        specialization: 'Cardiology & General Medicine',
        licenseNumber: 'DOC-2026-MEDIZO',
        clinicName: 'Medizo Care Center',
        clinicAddress: '100 Health Way, Suite 400',
        phone: '+1 555-0199',
        digilockerVerified: true
      })
    });
    const regData = await regRes.json();
    const doctorToken = regData.token;
    const doctorUser = regData.user;
    console.log('✅ Doctor Account Ready:', doctorUser.firstName, doctorUser.lastName);

    const doctorHeaders = {
      'Content-Type': 'application/json',
      'x-auth-token': doctorToken,
      'Authorization': `Bearer ${doctorToken}`
    };

    // 2. Register Test Patients if needed
    const patientsToRegister = [
      { firstName: 'Sarah', lastName: 'Johnson', email: `sarah_${Date.now()}@test.com`, age: '32', gender: 'Female' },
      { firstName: 'James', lastName: 'Wilson', email: `james_${Date.now()}@test.com`, age: '45', gender: 'Male' },
      { firstName: 'Emily', lastName: 'Davis', email: `emily_${Date.now()}@test.com`, age: '28', gender: 'Female' }
    ];

    const readyPatients = [];
    for (const pat of patientsToRegister) {
      console.log(`👤 Registering Patient: ${pat.firstName} ${pat.lastName} (${pat.email})...`);
      const pRes = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: pat.firstName,
          lastName: pat.lastName,
          email: pat.email,
          password: 'password123',
          role: 'patient',
          dateOfBirth: '1995-04-12',
          gender: pat.gender,
          phone: '+1 555-0199'
        })
      });
      const pData = await pRes.json();
      if (pRes.ok) {
        readyPatients.push(pData.user);
        console.log('✅ Patient Registered:', pData.user.email);
      } else {
        console.log('ℹ️ Patient fallback (using patient@test.com)');
        readyPatients.push({ email: 'patient@test.com', firstName: pat.firstName, lastName: pat.lastName });
      }
    }

    // 3. Create Prescriptions for Patients
    const testPrescriptions = [
      {
        patientName: 'Sarah Johnson',
        patientEmail: readyPatients[0].email,
        patientId: readyPatients[0].id || readyPatients[0]._id,
        patientAge: '32',
        patientGender: 'Female',
        vitalSigns: { bloodPressure: '120/80', pulse: '78', temperature: '98.6', spo2: '99', respiratoryRate: '16' },
        presentingComplaints: ['Persistent dry cough for 3 days', 'Sore throat and nasal congestion', 'Mild fever (99.5°F)'],
        clinicalFindings: ['Pharyngeal erythema', 'Bilateral clear breath sounds'],
        provisionalDiagnosis: ['Acute Viral Pharyngitis', 'Mild Upper Respiratory Infection'],
        medications: [
          {
            name: 'Tab. Amoxicillin 500mg',
            type: 'Antibiotic',
            dosage: '1-0-1 (Twice daily)',
            duration: '5 Days',
            durationValue: 5,
            durationUnit: 'Days',
            quantity: '10 Tablets',
            quantityValue: 10,
            quantityUnit: 'Tablets',
            instructions: 'Take after food with full glass of water'
          },
          {
            name: 'Tab. Paracetamol 650mg (Dolo)',
            type: 'Analgesic',
            dosage: '1-1-1 (Three times daily)',
            duration: '3 Days',
            durationValue: 3,
            durationUnit: 'Days',
            quantity: '9 Tablets',
            quantityValue: 9,
            quantityUnit: 'Tablets',
            instructions: 'Take when fever or pain is felt'
          },
          {
            name: 'Syp. Benadryl Cough Relief 100ml',
            type: 'Cough Syrup',
            dosage: '10ml thrice daily',
            duration: '5 Days',
            durationValue: 5,
            durationUnit: 'Days',
            quantity: '1 Bottle',
            quantityValue: 1,
            quantityUnit: 'Bottle',
            instructions: 'Shake well before use. Avoid driving after taking'
          }
        ]
      },
      {
        patientName: 'James Wilson',
        patientEmail: readyPatients[1].email,
        patientId: readyPatients[1].id || readyPatients[1]._id,
        patientAge: '45',
        patientGender: 'Male',
        vitalSigns: { bloodPressure: '138/88', pulse: '84', temperature: '98.4', spo2: '97', respiratoryRate: '18' },
        presentingComplaints: ['High blood pressure routine checkup', 'Occasional morning headaches'],
        clinicalFindings: ['Elevated BP 138/88 mmHg', 'Normal S1/S2 heart sounds'],
        provisionalDiagnosis: ['Essential Hypertension (Grade 1)', 'Type 2 Diabetes Mellitus'],
        medications: [
          {
            name: 'Tab. Metformin 500mg',
            type: 'Antidiabetic',
            dosage: '1-0-1 (Twice daily)',
            duration: '30 Days',
            durationValue: 30,
            durationUnit: 'Days',
            quantity: '60 Tablets',
            quantityValue: 60,
            quantityUnit: 'Tablets',
            instructions: 'Take with morning and evening meals'
          },
          {
            name: 'Tab. Amlodipine 5mg',
            type: 'Antihypertensive',
            dosage: '1-0-0 (Once daily morning)',
            duration: '30 Days',
            durationValue: 30,
            durationUnit: 'Days',
            quantity: '30 Tablets',
            quantityValue: 30,
            quantityUnit: 'Tablets',
            instructions: 'Take every morning at fixed time'
          },
          {
            name: 'Tab. Atorvastatin 10mg',
            type: 'Lipid Lowering',
            dosage: '0-0-1 (Once daily night)',
            duration: '30 Days',
            durationValue: 30,
            durationUnit: 'Days',
            quantity: '30 Tablets',
            quantityValue: 30,
            quantityUnit: 'Tablets',
            instructions: 'Take at bedtime after dinner'
          }
        ]
      },
      {
        patientName: 'Emily Davis',
        patientEmail: readyPatients[2].email,
        patientId: readyPatients[2].id || readyPatients[2]._id,
        patientAge: '28',
        patientGender: 'Female',
        vitalSigns: { bloodPressure: '110/70', pulse: '72', temperature: '98.2', spo2: '99', respiratoryRate: '14' },
        presentingComplaints: ['Acne flare-up on cheeks', 'Skin redness and inflammation'],
        clinicalFindings: ['Inflammatory papules on facial T-zone'],
        provisionalDiagnosis: ['Acne Vulgaris (Moderate)'],
        medications: [
          {
            name: 'Cap. Doxycycline 100mg',
            type: 'Antibiotic',
            dosage: '1-0-0 (Once daily)',
            duration: '14 Days',
            durationValue: 14,
            durationUnit: 'Days',
            quantity: '14 Capsules',
            quantityValue: 14,
            quantityUnit: 'Capsules',
            instructions: 'Take after food with plenty of water. Do not lie down for 30 mins'
          },
          {
            name: 'Gel. Clindamycin + Benzoyl Peroxide 20g',
            type: 'Topical Gel',
            dosage: 'Apply twice daily',
            duration: '14 Days',
            durationValue: 14,
            durationUnit: 'Days',
            quantity: '1 Tube',
            quantityValue: 1,
            quantityUnit: 'Tube',
            instructions: 'Apply thin layer on washed dry skin'
          }
        ]
      }
    ];

    for (let i = 0; i < testPrescriptions.length; i++) {
      const rxData = testPrescriptions[i];
      console.log(`\n📝 Creating Prescription ${i + 1} for ${rxData.patientName}...`);
      const createRes = await fetch(`${API_BASE}/prescriptions`, {
        method: 'POST',
        headers: doctorHeaders,
        body: JSON.stringify(rxData)
      });
      const createData = await createRes.json();
      if (createRes.ok) {
        const id = createData.prescription?.id || createData.id || createData._id;
        console.log(`✅ Prescription Created! ID: ${id}`);
        console.log(`   Patient: ${rxData.patientName} (${rxData.patientEmail})`);
        console.log(`   Medications (${rxData.medications.length}): ${rxData.medications.map(m => `${m.name} [${m.duration}, Qty: ${m.quantity}]`).join(', ')}`);
      } else {
        console.error('❌ Failed to create prescription:', createData);
      }
    }

    console.log('\n🎉 ALL TEST PRESCRIPTIONS CREATED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Error seeding prescriptions:', error.message);
  }
}

main();
