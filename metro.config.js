// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Expo SDK 53 marks development Hermes bundles as bytecode, which skips JS
// minification even though this serving path returns JavaScript. Bard's bundled
// collection then exceeds Expo Go's download-time Android heap. Keep dev/HMR,
// but minify these JS responses. Static exports and other platforms are intact.
const rewriteExpoUrl = config.server.rewriteRequestUrl;
config.server.rewriteRequestUrl = input => {
  const rewritten = rewriteExpoUrl(input);
  const url = new URL(rewritten, 'http://localhost');
  const params = url.searchParams;
  if (/\.(?:bundle|map)$/.test(url.pathname) && params.get('platform') === 'android'
    && params.get('dev') === 'true' && params.get('transform.engine') === 'hermes'
    && params.get('transform.bytecode') === '1') {
    params.set('transform.bytecode', '0');
    params.set('minify', 'true');
    return rewritten.startsWith('/') ? url.pathname + url.search + url.hash : url.toString();
  }
  return rewritten;
};

module.exports = config;
