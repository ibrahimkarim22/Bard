const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function configuration(rewrite = value => value) {
  const original = { server: { rewriteRequestUrl: rewrite }, transformer: { retained: true } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../metro.config.js'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../..'), module, exports: module.exports, URL,
    require(name) { assert.equal(name, 'expo/metro-config'); return { getDefaultConfig: () => original }; },
  });
  return module.exports;
}
const android = '/index.bundle?platform=android&dev=true&transform.engine=hermes&transform.bytecode=1&hot=false';
test('Android Hermes development bundles use actual JS minification instead of the skipped bytecode path', () => {
  const config = configuration();
  const result = new URL(config.server.rewriteRequestUrl(android), 'http://localhost');
  assert.equal(result.searchParams.get('transform.bytecode'), '0');
  assert.equal(result.searchParams.get('minify'), 'true');
  assert.equal(result.searchParams.get('dev'), 'true', 'retain development tools and Fast Refresh');
  assert.equal(result.searchParams.get('hot'), 'false');
  assert.equal(result.searchParams.get('transform.engine'), 'hermes');
  assert.equal(config.transformer.retained, true);
});
test('source maps and repeated HMR entry rewrites use the same stable transformation identity', () => {
  const rewrite = configuration().server.rewriteRequestUrl;
  for (const input of [android, android.replace('.bundle?', '.map?')]) {
    const once = rewrite(input), twice = rewrite(once);
    assert.equal(twice, once);
    assert.equal(new URL(once, 'http://localhost').searchParams.get('minify'), 'true');
    assert.equal(new URL(once, 'http://localhost').searchParams.get('transform.bytecode'), '0');
  }
});

test('absolute HMR entry URLs retain their server origin for source URLs and source maps', () => {
  const input = 'http://127.0.0.1:8083' + android;
  const rewrite = configuration().server.rewriteRequestUrl;
  const output = rewrite(input);
  assert.ok(output.startsWith('http://127.0.0.1:8083/'));
  const parsed = new URL(output);
  assert.equal(parsed.origin, 'http://127.0.0.1:8083');
  assert.equal(parsed.searchParams.get('transform.bytecode'), '0');
  assert.equal(rewrite(output), output);
});
test('production, iOS, web, assets, status and unrelated transform requests keep their original options', () => {
  const rewrite = configuration().server.rewriteRequestUrl;
  for (const input of [android.replace('dev=true', 'dev=false'), android.replace('platform=android', 'platform=ios'),
    android.replace('platform=android', 'platform=web'), android.replace('engine=hermes', 'engine=jsc'),
    android.replace('bytecode=1', 'bytecode=0'), '/assets/icon.png?platform=android', '/status', '/hot']) {
    assert.equal(rewrite(input), input, input);
  }
});
test('the default Expo URL rewrite is preserved before applying the Android-only correction', () => {
  const rewrite = configuration(value => value.replace('/virtual.bundle', '/index.bundle')).server.rewriteRequestUrl;
  const result = new URL(rewrite(android.replace('/index.bundle', '/virtual.bundle')), 'http://localhost');
  assert.equal(result.pathname, '/index.bundle');
  assert.equal(result.searchParams.get('transform.bytecode'), '0');
});

test('the normal start command targets the installed Expo Go workflow and retains an explicit dev-client command', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.scripts.start, 'expo start --go --localhost --port 8083 --minify');
  assert.equal(manifest.scripts['start:dev-client'], 'expo start --dev-client');
});
