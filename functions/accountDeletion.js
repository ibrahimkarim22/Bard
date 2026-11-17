const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const contract = require('./deletion-contract.json');

const JOBS = 'accountDeletionJobs';
const LEASE_MS = 10 * 60 * 1000;
const RETENTION_MS = contract.acknowledgedReceiptRetentionDays * 24 * 60 * 60 * 1000;
const ticketPattern = new RegExp(contract.ticketPattern);

class DeletionError extends Error {
  constructor(code) {
    super('Account deletion could not be confirmed.');
    this.code = code;
  }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128
    && !/[/\\\u0000-\u001f]/.test(uid);
}

function validTicket(ticket) {
  return typeof ticket === 'string' && ticketPattern.test(ticket);
}

function hashTicket(ticket) {
  return createHash('sha256').update(ticket, 'utf8').digest('hex');
}

function ticketMatches(hash, ticket) {
  if (typeof hash !== 'string' || !ticketPattern.test(hash) || !validTicket(ticket)) return false;
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashTicket(ticket), 'hex'));
}

function publicStatus(job) {
  if (!job || !contract.statuses.includes(job.status) || !contract.phases.includes(job.phase)
    || (job.status === 'complete') !== (job.phase === 'complete')) {
    throw new DeletionError('unavailable');
  }
  return { status: job.status, phase: job.phase };
}

async function subtreeHasDocuments(reference) {
  if ((await reference.get()).exists) return true;
  for (const collection of await reference.listCollections()) {
    // listDocuments includes missing parent documents with surviving children.
    for (const document of await collection.listDocuments()) {
      if (await subtreeHasDocuments(document)) return true;
    }
  }
  return false;
}

function createAccountDeletionService({ db, auth, now = Date.now, makeLeaseToken = randomUUID }) {
  const jobReference = uid => db.doc(`${JOBS}/${uid}`);

  async function readJob(uid) {
    const snapshot = await jobReference(uid).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async function authUserExists(uid) {
    try { await auth.getUser(uid); return true; }
    catch (error) {
      if (error?.code === 'auth/user-not-found') return false;
      throw error;
    }
  }

  async function updateClaim(uid, leaseToken, patch) {
    return db.runTransaction(async transaction => {
      const reference = jobReference(uid);
      const snapshot = await transaction.get(reference);
      const job = snapshot.data();
      if (!snapshot.exists || job.status !== 'deleting' || job.leaseToken !== leaseToken) return false;
      transaction.set(reference, { ...job, ...patch, updatedAt: now() });
      return true;
    });
  }

  async function process(uid) {
    const leaseToken = makeLeaseToken();
    const claimed = await db.runTransaction(async transaction => {
      const reference = jobReference(uid);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null;
      const job = snapshot.data();
      publicStatus(job);
      if (job.status === 'complete' || job.nextAttemptAt > now() || job.leaseUntil > now()) return null;
      const start = now();
      const next = { ...job, status: 'deleting', phase: 'revoking-sessions', attempts: (job.attempts || 0) + 1,
        leaseToken, leaseUntil: start + LEASE_MS, nextAttemptAt: start + LEASE_MS, updatedAt: start };
      transaction.set(reference, next);
      return next;
    });
    if (!claimed) return publicStatus(await readJob(uid));

    let phase = 'revoking-sessions';
    const advance = async nextPhase => {
      phase = nextPhase;
      if (!await updateClaim(uid, leaseToken, { phase })) throw new DeletionError('lease-lost');
    };
    try {
      try { await auth.revokeRefreshTokens(uid); }
      catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
      const userReference = db.doc(`users/${uid}`);
      await advance('deleting-data');
      await db.recursiveDelete(userReference);
      await advance('verifying-data');
      if (await subtreeHasDocuments(userReference)) throw new DeletionError('data-remains');
      await advance('deleting-auth');
      try { await auth.deleteUser(uid); }
      catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
      await advance('verifying-auth');
      if (await authUserExists(uid)) throw new DeletionError('auth-remains');
      if (await subtreeHasDocuments(userReference)) throw new DeletionError('data-remains');
      const completedAt = now();
      await updateClaim(uid, leaseToken, { status: 'complete', phase: 'complete', completedAt,
        nextAttemptAt: Number.MAX_SAFE_INTEGER, leaseToken: null, leaseUntil: 0, errorCode: null });
    } catch (error) {
      if (error?.code !== 'lease-lost') {
        const delay = Math.min(60 * 60 * 1000, 60000 * 2 ** Math.min(6, claimed.attempts - 1));
        await updateClaim(uid, leaseToken, { status: 'retry-needed', phase, errorCode: 'DELETE_STEP_FAILED',
          nextAttemptAt: now() + delay, leaseToken: null, leaseUntil: 0 });
      }
    }
    return publicStatus(await readJob(uid));
  }

  async function request(request) {
    const uid = request?.auth?.uid;
    if (!validUid(uid)) throw new DeletionError('unauthenticated');
    const authenticatedAt = request.auth.token?.auth_time;
    const seconds = now() / 1000;
    if (!Number.isFinite(authenticatedAt) || authenticatedAt < seconds - contract.recentAuthenticationSeconds
      || authenticatedAt > seconds + 60) throw new DeletionError('failed-precondition');
    const data = request.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).length !== 1 || !validTicket(data.ticket)) throw new DeletionError('invalid-argument');
    const userExists = await authUserExists(uid);
    await db.runTransaction(async transaction => {
      const reference = jobReference(uid);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        if (!ticketMatches(snapshot.data().ticketHash, data.ticket)) throw new DeletionError('already-exists');
        return;
      }
      if (!userExists) throw new DeletionError('unauthenticated');
      const timestamp = now();
      transaction.set(reference, { status: 'pending', phase: 'queued', ticketHash: hashTicket(data.ticket),
        createdAt: timestamp, updatedAt: timestamp, nextAttemptAt: timestamp, attempts: 0 });
    });
    return process(uid);
  }

  async function status(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const acknowledge = Object.prototype.hasOwnProperty.call(data, 'acknowledge');
    if (Object.keys(data).length !== (acknowledge ? 3 : 2) || acknowledge && data.acknowledge !== true
      || !validUid(data.uid) || !validTicket(data.ticket)) return null;
    const job = await readJob(data.uid);
    const matches = ticketMatches(job?.ticketHash || '0'.repeat(64), data.ticket);
    if (!job || !matches) return null;
    const result = publicStatus(job);
    if (!acknowledge) return result;
    if (result.status !== 'complete') return null;
    return db.runTransaction(async transaction => {
      const reference = jobReference(data.uid);
      const snapshot = await transaction.get(reference);
      const current = snapshot.data();
      if (!snapshot.exists || !ticketMatches(current.ticketHash, data.ticket)) return null;
      const confirmed = publicStatus(current);
      if (confirmed.status !== 'complete') return null;
      if (!Number.isFinite(current.acknowledgedAt)) {
        const acknowledgedAt = now();
        transaction.set(reference, { ...current, acknowledgedAt, updatedAt: acknowledgedAt,
          expiresAt: new Date(acknowledgedAt + RETENTION_MS) });
      }
      return confirmed;
    });
  }

  async function resume() {
    const due = await db.collection(JOBS).where('nextAttemptAt', '<=', now()).orderBy('nextAttemptAt').limit(10).get();
    for (const document of due.docs) await process(document.id);
    const expired = await db.collection(JOBS).where('expiresAt', '<=', new Date(now())).orderBy('expiresAt').limit(10).get();
    for (const document of expired.docs) {
      const job = document.data();
      if (job.status !== 'complete' || job.phase !== 'complete' || !Number.isFinite(job.completedAt)
        || !Number.isFinite(job.acknowledgedAt) || job.acknowledgedAt < job.completedAt
        || job.acknowledgedAt > now() - RETENTION_MS || !validUid(document.id)) continue;
      if (await authUserExists(document.id) || await subtreeHasDocuments(db.doc(`users/${document.id}`))) continue;
      await db.runTransaction(async transaction => {
        const reference = jobReference(document.id);
        const fresh = await transaction.get(reference);
        const data = fresh.data();
        const expiresAt = data?.expiresAt instanceof Date ? data.expiresAt.getTime() : data?.expiresAt?.toMillis?.();
        if (fresh.exists && data.status === 'complete' && data.phase === 'complete'
          && data.completedAt === job.completedAt && data.acknowledgedAt === job.acknowledgedAt
          && Number.isFinite(expiresAt) && expiresAt <= now()) {
          transaction.delete(reference);
        }
      });
    }
  }

  return { request, status, resume };
}

module.exports = { createAccountDeletionService, DeletionError, subtreeHasDocuments };
