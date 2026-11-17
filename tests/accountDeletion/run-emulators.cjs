const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const projectId = 'demo-bard-account-deletion';
const mode = process.argv[2] || 'test';
if (!['start', 'test'].includes(mode) || process.argv.length > 3) {
  throw new Error('Use only start or test with the fixed account-deletion emulator fixture');
}

const fixturePath = path.join(__dirname, 'firebase.demo.json');
const config = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expectedEmulators = {
  auth: { host: '127.0.0.1', port: 9199 },
  firestore: { host: '127.0.0.1', port: 8180 },
  functions: { host: '127.0.0.1', port: 5001 },
  ui: { enabled: false },
  hub: { host: '127.0.0.1', port: 4401 },
  logging: { host: '127.0.0.1', port: 4501 },
  singleProjectMode: true,
};
if (JSON.stringify(config.emulators) !== JSON.stringify(expectedEmulators)) {
  throw new Error('Unexpected account-deletion emulator configuration');
}
if (config.functions.source !== '../../functions'
    || config.functions.codebase !== 'account-deletion'
    || config.functions.runtime !== 'nodejs22'
    || JSON.stringify(config.functions.ignore) !== JSON.stringify([
      'node_modules', '**/node_modules/**', '.git', 'firebase-debug.log', 'firebase-debug.*.log', '.env*',
    ])) {
  throw new Error('Unexpected account-deletion functions source or runtime');
}
const approvedRules = fs.realpathSync(path.join(root, 'firebase/account-deletion/firestore.rules'));
if (fs.realpathSync(path.resolve(__dirname, config.firestore.rules)) !== approvedRules) {
  throw new Error('The account-deletion emulator must use its reviewed rules candidate');
}
const functionsSource = fs.realpathSync(path.join(root, 'functions'));
if (fs.realpathSync(path.resolve(__dirname, config.functions.source)) !== functionsSource) {
  throw new Error('The account-deletion emulator must use the repository functions source');
}

const temporaryRoot = fs.realpathSync(os.tmpdir());
const cwd = fs.mkdtempSync(path.join(temporaryRoot, 'bard-account-deletion-'));
const configPath = path.join(cwd, 'firebase.demo.json');
fs.writeFileSync(path.join(cwd, 'firestore.rules'), fs.readFileSync(approvedRules));
fs.writeFileSync(configPath, JSON.stringify({
  ...config,
  firestore: { rules: 'firestore.rules' },
  functions: { ...config.functions, source: path.relative(cwd, functionsSource) },
}, null, 2));

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  const resolved = fs.realpathSync(cwd);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('bard-account-deletion-')) {
    throw new Error('Temporary account-deletion directory escaped its owned location');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  cleaned = true;
}

const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const args = [cli, mode === 'test' ? 'emulators:exec' : 'emulators:start',
  '--project', projectId, '--config', configPath,
  '--only', 'auth,firestore,functions', '--non-interactive'];
if (mode === 'test') {
  const testFile = path.join(__dirname, 'server.integration.test.cjs');
  args.push('"' + process.execPath + '" --test --test-concurrency=1 "' + testFile + '"');
}

const env = {};
const runtimeEnvironmentKeys = [
  'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'SystemDrive', 'SYSTEMDRIVE',
  'ComSpec', 'COMSPEC', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'ProgramData', 'PROGRAMDATA', 'ProgramFiles', 'PROGRAMFILES', 'ProgramFiles(x86)',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'JAVA_HOME',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR',
];
for (const key of runtimeEnvironmentKeys) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
Object.assign(env, {
  XDG_CONFIG_HOME: path.join(cwd, 'config'),
  CLOUDSDK_CONFIG: path.join(cwd, 'gcloud'),
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1',
  npm_config_offline: 'true',
  npm_config_update_notifier: 'false',
  CI: '1',
});
const bundledJava = 'C:/Program Files/Android/Android Studio1/jbr';
if (!env.JAVA_HOME && fs.existsSync(path.join(bundledJava, 'bin/java.exe'))) env.JAVA_HOME = bundledJava;
if (env.JAVA_HOME && fs.existsSync(path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
  env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || '');
}

const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
  try { cleanup(); } catch (cleanupError) { console.error(cleanupError.message); }
});
child.on('close', code => {
  process.exitCode = code === null ? 1 : code;
  try { cleanup(); } catch (error) { console.error(error.message); process.exitCode = 1; }
});
