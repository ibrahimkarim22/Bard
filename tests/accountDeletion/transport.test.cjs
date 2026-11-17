const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeletionTransport } = require('../../account/deletionTransport');
const contract = require('../../functions/deletion-contract.json');
const production = 'https://' + contract.region + '-shakespearenativeapp.cloudfunctions.net';
const emulator = 'http://127.0.0.1:5001/demo-bard-account-deletion/' + contract.region;
const ticket = 'a'.repeat(64), complete = { status: 'complete', phase: 'complete' };
const response = (value, ok = true) => ({ ok, async json() { return value; } });
function host({ baseUrl = production, emulator: useEmulator = false, reply = () => response({ result: complete }), ...options } = {}) {
  const calls = [];
  return { calls, transport: createDeletionTransport({ baseUrl, emulator: useEmulator, fetch: async (...args) => { calls.push(args); return reply(...args); }, ...options }) };
}
function sanitized(error, code) {
  assert.equal(error.code, code);
  assert.equal(error.message, 'Account deletion service is unavailable.');
  assert.doesNotMatch(JSON.stringify(error), /fixture-secret|password|idToken|Bearer/);
  return true;
}

test('requests send only the supplied bound Bearer token and the callable ticket envelope', async () => {
  const h = host();
  assert.deepEqual(await h.transport.request({ ticket, idToken: 'fixture-owner-one-token' }), complete);
  assert.deepEqual(await h.transport.request({ ticket, idToken: 'fixture-owner-two-token' }), complete);
  for (const [index, [url, options]] of h.calls.entries()) {
    assert.equal(url, production + '/' + contract.requestFunction);
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-owner-' + (index ? 'two' : 'one') + '-token' });
    assert.deepEqual(JSON.parse(options.body), { data: { ticket } });
    assert.equal(options.signal instanceof AbortSignal, true);
  }
});

test('status checks use the retained UID/ticket with no Authorization header or callable wrapper', async () => {
  const h = host({ reply: () => response({ status: 'deleting', phase: 'deleting-data' }) });
  assert.deepEqual(await h.transport.status('owner-one', ticket), { status: 'deleting', phase: 'deleting-data' });
  const [url, options] = h.calls[0];
  assert.equal(url, production + '/' + contract.statusFunction);
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(options.body), { uid: 'owner-one', ticket });
});

test('cleanup acknowledgment is a ticket-scoped status request with no sign-in token', async () => {
  const h = host({ reply: () => response(complete) });
  assert.deepEqual(await h.transport.acknowledge('owner-one', ticket), complete);
  const [url, options] = h.calls[0];
  assert.equal(url, production + '/' + contract.statusFunction);
  assert.deepEqual(JSON.parse(options.body), { uid: 'owner-one', ticket, acknowledge: true });
  assert.equal(options.headers.Authorization, undefined);
});

test('only the scoped endpoint not-found response identifies a missing receipt', async () => {
  const h = host({ reply: () => ({ ...response({ error: 'not-found' }, false), status: 404 }) });
  await assert.rejects(h.transport.acknowledge('owner-one', ticket), error => sanitized(error, 'ACCOUNT_DELETION_RECEIPT_NOT_FOUND'));
  const other = host({ reply: () => ({ ...response({ error: 'unavailable' }, false), status: 404 }) });
  await assert.rejects(other.transport.acknowledge('owner-one', ticket), error => sanitized(error, 'ACCOUNT_DELETION_UNAVAILABLE'));
});

test('explicit demo emulator endpoints stay on loopback and preserve their project/function prefix', async () => {
  const h = host({ baseUrl: emulator + '/', emulator: true });
  await h.transport.request({ ticket, idToken: 'fixture-token' });
  assert.equal(h.calls[0][0], emulator + '/' + contract.requestFunction);
});

test('normal startup and requests work without unimplemented React Native URL getters', async () => {
  const original = globalThis.URL;
  globalThis.URL = class NativeURL {
    get username() { throw Error('URL.username is not implemented'); }
    get hostname() { throw Error('URL.hostname is not implemented'); }
  };
  try {
    const h = host();
    assert.deepEqual(await h.transport.request({ ticket, idToken: 'fixture-token' }), complete);
  } finally { globalThis.URL = original; }
});

test('invalid production and emulator configuration fails before any request with a sanitized error', () => {
  const urls = [undefined, '', 'not a URL', 'http://' + new URL(production).hostname, production + ':8443', production + '/other', production + '?ticket=fixture-secret', production + '#fragment', production.replace('https://', 'https://user:fixture-secret@'), 'https://example.test'];
  for (const baseUrl of urls) assert.throws(() => createDeletionTransport({ baseUrl, fetch: async () => { throw Error('must not send'); } }), error => sanitized(error, 'ACCOUNT_DELETION_CONFIGURATION'), String(baseUrl));
  for (const baseUrl of ['https://127.0.0.1:5001/demo-bard-account-deletion/us-central1', 'http://192.0.2.1:5001/demo-bard-account-deletion/us-central1', 'http://localhost:5001/shakespearenativeapp/us-central1', 'http://localhost:5001/demo-bard-account-deletion/europe-west1']) {
    assert.throws(() => createDeletionTransport({ baseUrl, emulator: true }), error => sanitized(error, 'ACCOUNT_DELETION_CONFIGURATION'));
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, '1000']) assert.throws(() => createDeletionTransport({ baseUrl: production, timeoutMs }), error => sanitized(error, 'ACCOUNT_DELETION_CONFIGURATION'));
  assert.throws(() => createDeletionTransport({ baseUrl: production, fetch: null }), error => sanitized(error, 'ACCOUNT_DELETION_CONFIGURATION'));
});

test('malformed requests are rejected locally without leaking credentials or issuing network IO', async () => {
  const h = host();
  for (const value of [{ ticket: 'short', idToken: 'fixture-secret' }, { ticket: 'A'.repeat(64), idToken: 'fixture-secret' }, { ticket, idToken: '' }, { ticket }, { ticket, idToken: 'fixture-secret\r\nother-header: injected' }, { ticket, idToken: 'two tokens' }]) {
    await assert.rejects(h.transport.request(value), error => sanitized(error, 'ACCOUNT_DELETION_INVALID_REQUEST'));
  }
  for (const uid of ['', null, 'x'.repeat(129), 'owner/other', 'owner\\other', 'owner\u0000other']) await assert.rejects(h.transport.status(uid, ticket), error => sanitized(error, 'ACCOUNT_DELETION_INVALID_REQUEST'));
  await assert.rejects(h.transport.status('owner-one', 'short'), error => sanitized(error, 'ACCOUNT_DELETION_INVALID_REQUEST'));
  assert.equal(h.calls.length, 0);
});

test('strict response validation rejects unexpected fields, states, phases, and inconsistent completion', async () => {
  const invalid = [null, [], {}, { status: 'complete' }, { ...complete, secret: 'fixture-secret' }, { status: 'unknown', phase: 'queued' }, { status: 'pending', phase: 'unknown' }, { status: 'complete', phase: 'queued' }, { status: 'deleting', phase: 'complete' }];
  for (const value of invalid) {
    const h = host({ reply: () => response({ result: value }) });
    await assert.rejects(h.transport.request({ ticket, idToken: 'fixture-token' }), error => sanitized(error, 'ACCOUNT_DELETION_STATUS_FAILED'));
    const status = host({ reply: () => response(value) });
    await assert.rejects(status.transport.status('owner-one', ticket), error => sanitized(error, 'ACCOUNT_DELETION_STATUS_FAILED'));
  }
  const unwrapped = host({ reply: () => response(complete) });
  await assert.rejects(unwrapped.transport.request({ ticket, idToken: 'fixture-token' }), error => sanitized(error, 'ACCOUNT_DELETION_STATUS_FAILED'));
});

test('HTTP failures map only known statuses and never expose service payload details', async () => {
  for (const [status, expected] of [['UNAUTHENTICATED', 'ACCOUNT_DELETION_REAUTH_REQUIRED'], ['ALREADY_EXISTS', 'ACCOUNT_DELETION_ALREADY_STARTED'], ['INTERNAL', 'ACCOUNT_DELETION_UNAVAILABLE']]) {
    const h = host({ reply: () => response({ error: { status, message: 'fixture-secret', details: { password: 'fixture-secret' } } }, false) });
    await assert.rejects(h.transport.request({ ticket, idToken: 'fixture-token' }), error => sanitized(error, expected));
  }
});

test('network and JSON errors are sanitized even if an external error spoofs an account deletion code', async () => {
  for (const code of [undefined, 'ACCOUNT_DELETION_STATUS_FAILED', 'ACCOUNT_DELETION_fixture-secret']) {
    const h = host({ reply: () => { throw Object.assign(new Error('fixture-secret password idToken'), { code }); } });
    await assert.rejects(h.transport.request({ ticket, idToken: 'fixture-token' }), error => sanitized(error, 'ACCOUNT_DELETION_UNAVAILABLE'));
  }
  const broken = host({ reply: () => ({ ok: true, async json() { throw Error('fixture-secret'); } }) });
  await assert.rejects(broken.transport.status('owner-one', ticket), error => sanitized(error, 'ACCOUNT_DELETION_UNAVAILABLE'));
});

test('timeouts abort the in-flight request and return a sanitized retryable failure', async () => {
  let aborted = false;
  const h = host({ timeoutMs: 5, reply: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(Error('fixture-secret timeout')); }, { once: true });
  }) });
  await assert.rejects(h.transport.request({ ticket, idToken: 'fixture-token' }), error => sanitized(error, 'ACCOUNT_DELETION_UNAVAILABLE'));
  assert.equal(aborted, true);
});
