const contract = require('../functions/deletion-contract.json');
const ownErrors = new WeakSet();
const fail = code => { const error = Object.assign(new Error('Account deletion service is unavailable.'), { code }); ownErrors.add(error); return error; };

function createDeletionTransport({ baseUrl, fetch: send = globalThis.fetch, emulator = false, timeoutMs = 30000 }) {
  if (typeof send !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw fail('ACCOUNT_DELETION_CONFIGURATION');
  // React Native's built-in URL has unimplemented hostname/credential getters.
  // The production target is fixed; a parser/polyfill cannot broaden it.
  const production = `https://${contract.region}-shakespearenativeapp.cloudfunctions.net`;
  const local = typeof baseUrl === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::([1-9][0-9]{0,4}))?\/demo-[a-z0-9-]+\/us-central1\/?$/.exec(baseUrl);
  if (emulator ? !local || (local[1] && Number(local[1]) > 65535)
    : baseUrl !== production && baseUrl !== production + '/') throw fail('ACCOUNT_DELETION_CONFIGURATION');
  const base = baseUrl.replace(/\/$/, '');
  const validTicket = ticket => typeof ticket === 'string' && new RegExp(contract.ticketPattern).test(ticket);
  const parse = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
      || !contract.statuses.includes(value.status) || !contract.phases.includes(value.phase)
      || (value.status === 'complete') !== (value.phase === 'complete')) throw fail('ACCOUNT_DELETION_STATUS_FAILED');
    return { status: value.status, phase: value.phase };
  };
  async function post(name, body, token, callable) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const result = await send(`${base}/${name}`, { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(callable ? { data: body } : body) });
      let value;
      try { value = await result.json(); } catch { throw fail('ACCOUNT_DELETION_UNAVAILABLE'); }
      if (!result.ok) {
        if (result.status === 404 && value?.error === 'not-found') throw fail('ACCOUNT_DELETION_RECEIPT_NOT_FOUND');
        const status = value?.error?.status;
        throw fail(status === 'UNAUTHENTICATED' ? 'ACCOUNT_DELETION_REAUTH_REQUIRED'
          : status === 'ALREADY_EXISTS' ? 'ACCOUNT_DELETION_ALREADY_STARTED'
            : 'ACCOUNT_DELETION_UNAVAILABLE');
      }
      return parse(callable ? value.result : value);
    } catch (error) {
      if (ownErrors.has(error)) throw error;
      throw fail('ACCOUNT_DELETION_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  return {
    request({ ticket, idToken }) {
      if (!validTicket(ticket) || typeof idToken !== 'string' || !idToken || /\s|[\u0000-\u001f\u007f]/.test(idToken)) return Promise.reject(fail('ACCOUNT_DELETION_INVALID_REQUEST'));
      return post(contract.requestFunction, { ticket }, idToken, true);
    },
    status(uid, ticket, acknowledge = false) {
      if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(uid) || !validTicket(ticket)) {
        return Promise.reject(fail('ACCOUNT_DELETION_INVALID_REQUEST'));
      }
      return post(contract.statusFunction, { uid, ticket, ...(acknowledge ? { acknowledge: true } : {}) }, null, false);
    },
    acknowledge(uid, ticket) { return this.status(uid, ticket, true); },
  };
}

module.exports = { createDeletionTransport };
