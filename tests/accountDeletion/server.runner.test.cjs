const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const runnerPath = path.join(__dirname, 'run-emulators.cjs');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(runnerPath, 'utf8');
const expectedIgnore = ['node_modules', '**/node_modules/**', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '.env*'];

function inspectRunner(inherited) {
  const staged = new Map();
  const removed = [];
  let spawned;
  const child = new EventEmitter();
  const fakeProcess = {
    argv: [process.execPath, runnerPath, 'test'],
    execPath: process.execPath,
    platform: process.platform,
    env: inherited,
  };
  const filesystem = {
    readFileSync: fs.readFileSync,
    realpathSync: value => path.resolve(value),
    mkdtempSync: prefix => prefix + 'runner-test',
    writeFileSync: (file, content) => staged.set(file, content),
    existsSync: () => false,
    rmSync: (file, options) => removed.push({ file, options }),
  };
  const modules = {
    'node:fs': filesystem,
    'node:path': path,
    'node:os': os,
    'node:child_process': {
      spawn(executable, args, options) {
        spawned = { executable, args, options };
        return child;
      },
    },
  };
  vm.runInNewContext(source, {
    __dirname,
    process: fakeProcess,
    console,
    require(name) {
      if (!Object.hasOwn(modules, name)) throw new Error('Unexpected runner module');
      return modules[name];
    },
  }, { filename: runnerPath });
  child.emit('close', 0);
  return { spawned, staged, removed, exitCode: fakeProcess.exitCode };
}

test('runner excludes inherited debug settings, credentials and arbitrary environment values', () => {
  const excluded = [
    'DEBUG', 'NODE_OPTIONS', 'OPENAI_API_KEY', 'FIREBASE_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'IGCCSVC_DB', 'CUSTOM_PROVIDER_SECRET',
  ];
  const inherited = { PATH: 'synthetic-runtime-path', SystemRoot: 'synthetic-system-root' };
  for (const name of excluded) inherited[name] = 'synthetic-excluded-value';
  inherited.GCLOUD_PROJECT = 'synthetic-external-project';
  inherited.FIRESTORE_EMULATOR_HOST = 'synthetic-external-host';
  const { spawned, exitCode } = inspectRunner(inherited);
  const environment = spawned.options.env;
  for (const name of excluded) assert.equal(Object.hasOwn(environment, name), false, name + ' must be excluded');
  assert.equal(environment.PATH, inherited.PATH);
  assert.equal(environment.SystemRoot, inherited.SystemRoot);
  assert.equal(environment.GCLOUD_PROJECT, 'demo-bard-account-deletion');
  assert.equal(environment.GOOGLE_CLOUD_PROJECT, 'demo-bard-account-deletion');
  assert.equal(environment.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(environment.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  assert.equal(environment.FUNCTIONS_EMULATOR_HOST, '127.0.0.1:5001');
  assert.equal(exitCode, 0);
});

test('runner stages the reviewed source and ignore entries and executes only the explicit integration file', () => {
  const { spawned, staged, removed } = inspectRunner({});
  assert.equal(spawned.executable, process.execPath);
  assert.equal(spawned.args[1], 'emulators:exec');
  assert.equal(spawned.args[3], 'demo-bard-account-deletion');
  assert.equal(spawned.args[7], 'auth,firestore,functions');
  assert.equal(spawned.args.at(-1), '"' + process.execPath + '" --test --test-concurrency=1 "' + path.join(__dirname, 'server.integration.test.cjs') + '"');
  const configPath = path.join(spawned.options.cwd, 'firebase.demo.json');
  const config = JSON.parse(staged.get(configPath));
  assert.equal(path.resolve(spawned.options.cwd, config.functions.source), path.join(root, 'functions'));
  assert.equal(config.functions.runtime, 'nodejs22');
  assert.deepEqual(config.functions.ignore, expectedIgnore);
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'firebase/account-deletion/firebase.json'), 'utf8'));
  assert.deepEqual(deployment.functions.ignore, expectedIgnore);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].file, spawned.options.cwd);
  assert.equal(removed[0].options.recursive, true);
});
