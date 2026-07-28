const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const URI_1 = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/medizolife?appName=MedizoLife';
const URI_2 = 'mongodb+srv://medizolife_db_user:jtdIhHngl39DtFku@medizolife.fdbpoow.mongodb.net/test?appName=MedizoLife';

async function check() {
  console.log('--- Testing explicit database "medizolife" ---');
  const conn1 = await mongoose.connect(URI_1);
  console.log(`DB Name: ${conn1.connection.name}`);
  const cols1 = await conn1.connection.db.listCollections().toArray();
  console.log('Collections:', cols1.map(c => c.name));
  await mongoose.disconnect();

  console.log('\n--- Testing database "test" ---');
  const conn2 = await mongoose.connect(URI_2);
  console.log(`DB Name: ${conn2.connection.name}`);
  const cols2 = await conn2.connection.db.listCollections().toArray();
  console.log('Collections:', cols2.map(c => c.name));
  await mongoose.disconnect();
}

check();
