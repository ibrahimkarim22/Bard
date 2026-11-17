const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

test('the deployable functions package contains only its pinned server dependencies and source files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'functions/package-lock.json'), 'utf8'));
  const expected = { 'firebase-admin': '13.4.0', 'firebase-functions': '6.4.0' };
  assert.deepEqual(manifest.dependencies, expected);
  assert.deepEqual(lock.packages[''].dependencies, expected);
  assert.deepEqual(manifest.files, ['index.js', 'accountDeletion.js', 'deletion-contract.json']);
  for (const [location, entry] of Object.entries(lock.packages)) {
    assert.ok(location === '' || location.startsWith('node_modules/'), 'the lock contains only the isolated server package');
    assert.notEqual(entry.link, true, 'application directory links cannot enter the server package');
    assert.ok(!String(entry.resolved || '').startsWith('file:'), 'server dependencies come from the registry');
  }
  assert.equal(fs.existsSync(path.join(root, 'functions/node_modules/bard')), false);
});
