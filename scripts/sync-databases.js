const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const URI_TEST = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/test?appName=MedizoLife';
const URI_MEDIZOLIFE = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/medizolife?appName=MedizoLife';

async function syncDatabases() {
  try {
    console.log('--- Connecting to source DB "test" ---');
    const connTest = await mongoose.createConnection(URI_TEST).asPromise();
    console.log('Connected to source DB:', connTest.name);

    console.log('--- Connecting to target DB "medizolife" ---');
    const connMedizo = await mongoose.createConnection(URI_MEDIZOLIFE).asPromise();
    console.log('Connected to target DB:', connMedizo.name);

    const collections = await connTest.db.listCollections().toArray();
    console.log('Collections to sync:', collections.map(c => c.name));

    for (const colInfo of collections) {
      const colName = colInfo.name;
      console.log(`\nSyncing collection "${colName}"...`);
      
      const sourceCol = connTest.db.collection(colName);
      const targetCol = connMedizo.db.collection(colName);

      const docs = await sourceCol.find({}).toArray();
      console.log(`Found ${docs.length} documents in source "${colName}"`);

      if (docs.length > 0) {
        // Clear target collection first to prevent duplicate key errors
        await targetCol.deleteMany({});
        await targetCol.insertMany(docs);
        console.log(`✅ Synced ${docs.length} documents into target "${colName}" in database "medizolife"`);
      }
    }

    console.log('\n==========================================');
    console.log('SUCCESS: All collections copied to "medizolife" DB!');
    console.log('==========================================\n');

    await connTest.close();
    await connMedizo.close();
    process.exit(0);

  } catch (err) {
    console.error('Database Sync Error:', err);
    process.exit(1);
  }
}

syncDatabases();
