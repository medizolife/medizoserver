const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/test?appName=MedizoLife';

const PrescriptionModel = require('../models/PrescriptionModel');
const UserModel = require('../models/UserModel');

async function checkMongo() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas!');
    console.log('Using database name:', mongoose.connection.name);

    // List all collections in DB
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections in DB:', collections.map(c => c.name));

    // Count prescriptions
    const count = await PrescriptionModel.countDocuments({});
    console.log(`\nTotal prescriptions in PrescriptionModel: ${count}`);

    const docs = await PrescriptionModel.find({}).sort({ createdAt: -1 }).lean();
    console.log('\n--- PRESCRIPTION DOCUMENTS ---');
    docs.forEach((doc, index) => {
      console.log(`\n[${index + 1}] ID: ${doc._id} | qrCode: ${doc.qrCode}`);
      console.log(`    Doctor:  ${doc.doctorName} (ID: ${doc.doctorId})`);
      console.log(`    Patient: ${doc.patientName} (${doc.patientEmail}) (ID: ${doc.patientId})`);
      console.log(`    Diagnosis: ${Array.isArray(doc.provisionalDiagnosis) ? doc.provisionalDiagnosis.join(', ') : doc.provisionalDiagnosis}`);
      console.log(`    Created: ${doc.createdAt}`);
    });

    console.log('\n==========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('Check Mongo Error:', err);
    process.exit(1);
  }
}

checkMongo();
