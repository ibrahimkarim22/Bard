const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const projectId = 'demo-bard-spark-deletion';
const modes = {
  rules: ['spark.rules.test.cjs'],
  discovery: ['spark.discovery.test.cjs'],
  integration: ['spark.integration.test.cjs'],
  test: ['spark.rules.test.cjs', 'spark.integration.test.cjs', 'spark.discovery.test.cjs'],
};
const mode = process.argv[2] || 'test';
if (!Object.hasOwn(modes, mode) || process.argv.length > 3) throw Error('Use only test, rules, discovery or integration with the fixed Spark deletion fixture.');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'spark.demo.json'), 'utf8'));
const expected = {
  auth: { host: '127.0.0.1', port: 9198 }, firestore: { host: '127.0.0.1', port: 8181 },
  ui: { enabled: false }, hub: { host: '127.0.0.1', port: 4402 }, logging: { host: '127.0.0.1', port: 4502 }, singleProjectMode: true,
};
if (Object.keys(config).sort().join(',') !== 'emulators,firestore'
    || JSON.stringify(config.emulators) !== JSON.stringify(expected)) throw Error('Unexpected Spark emulator configuration.');
const rules = fs.realpathSync(path.join(root, 'firebase/account-deletion/spark.rules'));
if (fs.realpathSync(path.resolve(__dirname, config.firestore.rules)) !== rules) throw Error('Unexpected Spark rules source.');
for (const file of modes[mode]) if (!fs.existsSync(path.join(__dirname, file))) throw Error('Missing isolated Spark test.');

const tempRoot = fs.realpathSync(os.tmpdir());
const cwd = fs.mkdtempSync(path.join(tempRoot, 'bard-spark-deletion-'));
fs.writeFileSync(path.join(cwd, 'firestore.rules'), fs.readFileSync(rules));
const configPath = path.join(cwd, 'firebase.demo.json');
fs.writeFileSync(configPath, JSON.stringify({ ...config, firestore: { rules: 'firestore.rules' } }));
const env = {};
const runtimeKeys = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'OS', 'JAVA_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR']);
for (const [key, value] of Object.entries(process.env)) if (runtimeKeys.has(key.toUpperCase())) env[key] = value;
Object.assign(env, {
  XDG_CONFIG_HOME: path.join(cwd, 'config'), CLOUDSDK_CONFIG: path.join(cwd, 'gcloud'),
  GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9198', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181',
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1', npm_config_offline: 'true', npm_config_update_notifier: 'false', CI: '1',
});
const bundledJava = 'C:/Program Files/Android/Android Studio1/jbr';
if (!env.JAVA_HOME && fs.existsSync(path.join(bundledJava, 'bin/java.exe'))) env.JAVA_HOME = bundledJava;
if (env.JAVA_HOME) env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || env.Path || '');
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  const target = fs.realpathSync(cwd);
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('bard-spark-deletion-')) throw Error('Unexpected temporary test path.');
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); cleaned = true;
}
const command = '"' + process.execPath + '" --test --test-concurrency=1 '
  + modes[mode].map(file => '"' + path.join(__dirname, file) + '"').join(' ');
const child = spawn(process.execPath, [path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:exec',
  '--project', projectId, '--config', configPath, '--only', 'auth,firestore', '--non-interactive', command],
{ cwd, env, stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.exitCode = 1; cleanup(); });
child.on('close', code => { process.exitCode = code === null ? 1 : code; cleanup(); });
