// Run once after deploying Functions and database rules, before distributing
// the updated Android app. Uses Application Default Credentials, never a key in Git.
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { enqueueOdooEvent } = require('../src/odooQueue');
const { flattenVisitEvents } = require('../src/odooVisitSyncService');
const { projectCustomer } = require('../src/sellerCustomers');

async function main() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL || !process.argv.includes('--apply')) {
    throw new Error('Informe FIREBASE_DATABASE_URL e --apply. Execute com credenciais administrativas e a importacao pausada.');
  }
  initializeApp({ databaseURL });
  const database = getDatabase();
  // Explicit one-time history scan; never called by a scheduled function.
  const events = flattenVisitEvents((await database.ref('visitEvents').get()).val());
  let queued = 0;
  for (const { path, event } of events) {
    if (event.eventType !== 'feedback_submitted' || ['synced', 'not_required'].includes(event.odooSyncStatus)) continue;
    await enqueueOdooEvent(database, path);
    queued += 1;
  }
  const customers = (await database.ref('customers').get()).val() || {};
  for (const id of Object.keys(customers)) await projectCustomer(database, id);
  console.log(JSON.stringify({ queued, customersProjected: Object.keys(customers).length }));
  await database.goOffline();
}

main().catch((error) => { console.error(error.message); process.exit(1); });
