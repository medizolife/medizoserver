const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const MONGO_URI = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/?appName=MedizoLife';

async function fixAndSeed() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(MONGO_URI);
    const col = conn.connection.db.collection('prescriptions');

    // 1. Fix existing prescriptions: set qrCode = _id
    console.log('\n--- Fixing existing prescriptions ---');
    const allRx = await col.find({}).toArray();
    for (const rx of allRx) {
      const correctQr = rx._id.toString();
      if (rx.qrCode !== correctQr) {
        await col.updateOne({ _id: rx._id }, { $set: { qrCode: correctQr } });
        console.log(`Fixed: _id=${correctQr} (was qrCode=${rx.qrCode}, now qrCode=${correctQr})`);
      } else {
        console.log(`OK: _id=${correctQr} qrCode already matches`);
      }
    }

    // 2. Create a fresh test prescription
    console.log('\n--- Creating test prescription ---');
    const testRx = {
      doctorId: '000000000000000000000001',
      patientId: '000000000000000000000002',
      patientEmail: 'patient@medizo.life',
      diagnosis: 'Type 2 Diabetes Mellitus - Follow-up',
      provisionalDiagnosis: ['Type 2 Diabetes Mellitus'],
      medications: [
        { name: 'Metformin 500mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', instructions: 'Take with meals' },
        { name: 'Glimepiride 2mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', instructions: 'Take before breakfast' },
        { name: 'Atorvastatin 10mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', instructions: 'Take at bedtime' }
      ],
      instructions: 'Monitor blood sugar levels daily. Follow diabetic diet. Regular exercise recommended.',
      notes: 'Test prescription for PharmaMedizo validation flow',
      followUpDate: '2026-08-28',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await col.insertOne(testRx);
    const insertedId = result.insertedId.toString();
    
    // Set qrCode = actual _id
    await col.updateOne({ _id: result.insertedId }, { $set: { qrCode: insertedId } });
    
    console.log(`Created test prescription:`);
    console.log(`  _id: ${insertedId}`);
    console.log(`  qrCode: ${insertedId}`);
    console.log(`  diagnosis: ${testRx.diagnosis}`);
    console.log(`  medications: ${testRx.medications.length} items`);

    // 3. Summary
    console.log('\n==========================================');
    console.log('All prescription IDs (for QR scanning):');
    const finalRx = await col.find({}).toArray();
    finalRx.forEach((rx, i) => {
      console.log(`  ${i + 1}. ID: ${rx._id}  qrCode: ${rx.qrCode}  status: ${rx.status}  diagnosis: ${rx.diagnosis || (rx.provisionalDiagnosis||[]).join(', ')}`);
    });
    console.log('==========================================');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fixAndSeed();
