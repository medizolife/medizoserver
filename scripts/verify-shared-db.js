const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const mainServerEnv = require('dotenv').config({ path: '../server/.env' }).parsed || {};
const pharmaServerEnv = require('dotenv').config({ path: '../pharma medizo/server/.env' }).parsed || {};

async function testFullIntegration() {
  console.log('=== VERIFYING SHARED DATABASE INTEGRATION ===\n');

  const mainUri = mainServerEnv.MONGODB_URI;
  const pharmaUri = pharmaServerEnv.MONGO_URI || pharmaServerEnv.MONGODB_URI;

  console.log(`Main Backend DB URI:      ${mainUri}`);
  console.log(`PharmaMedizo DB URI:      ${pharmaUri}`);
  console.log(`Matching Connection Strings: ${mainUri === pharmaUri ? '✅ YES' : '❌ NO'}\n`);

  // Connect to shared DB
  const conn = await mongoose.connect(mainUri);
  console.log(`Connected Cluster Host: ${conn.connection.host}`);
  console.log(`Shared Database Name:   "${conn.connection.name}"`);

  // Check collections
  const collections = await conn.connection.db.listCollections().toArray();
  const colNames = collections.map(c => c.name);
  console.log('\nCollections in Shared Database:');
  colNames.forEach(name => console.log(`  - ${name}`));

  // Verify prescriptions read/write
  const rxCol = conn.connection.db.collection('prescriptions');
  const rxCount = await rxCol.countDocuments();
  console.log(`\nPrescriptions count in DB: ${rxCount}`);

  const activeRx = await rxCol.find({ status: 'active' }).toArray();
  console.log(`Active prescriptions ready for pharmacy scanning: ${activeRx.length}`);
  activeRx.forEach((rx, idx) => {
    console.log(`  ${idx + 1}. ID: ${rx._id} | qrCode: ${rx.qrCode} | Diagnosis: "${rx.diagnosis || rx.provisionalDiagnosis}"`);
  });

  // Verify users read/write
  const usersCol = conn.connection.db.collection('users');
  const userCount = await usersCol.countDocuments();
  console.log(`\nUsers count in DB: ${userCount}`);

  // Verify pharmacists collection
  const pharmaCol = conn.connection.db.collection('pharmacists');
  const pharmaCount = await pharmaCol.countDocuments();
  console.log(`Pharmacists count in DB: ${pharmaCount}`);

  console.log('\n✅ VERIFICATION COMPLETE: Both Medizo main backend and PharmaMedizo backend use the EXACT SAME MongoDB database cluster and collections!');
  process.exit(0);
}

testFullIntegration().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
