const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createAccountDeletionService, DeletionError } = require('./accountDeletion');
const contract = require('./deletion-contract.json');

if (process.env.FUNCTIONS_EMULATOR === 'true') {
  if (process.env.GCLOUD_PROJECT !== 'demo-bard-account-deletion'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199') {
    throw new Error('Account deletion requires the fixed demo emulators.');
  }
}

const app = getApps().length ? getApps()[0] : initializeApp();
const service = createAccountDeletionService({ db: getFirestore(app), auth: getAuth(app) });
const options = { region: contract.region, timeoutSeconds: 540, memory: '512MiB' };

exports.requestAccountDeletion = onCall(options, async request => {
  try { return await service.request(request); }
  catch (error) {
    const code = error instanceof DeletionError && ['unauthenticated', 'failed-precondition', 'invalid-argument', 'already-exists'].includes(error.code)
      ? error.code : 'unavailable';
    throw new HttpsError(code, 'Account deletion could not be confirmed.');
  }
});

exports.accountDeletionStatus = onRequest({ ...options, timeoutSeconds: 30, cors: true }, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.set('Allow', 'POST');
    response.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  try {
    const result = await service.status(request.body);
    if (!result) { response.status(404).json({ error: 'not-found' }); return; }
    response.status(200).json(result);
  } catch {
    response.status(503).json({ error: 'unavailable' });
  }
});

exports.resumeAccountDeletions = onSchedule({ ...options, schedule: 'every 1 minutes' }, async () => {
  await service.resume();
});
