const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { nodes, text } = require('./synopsisUIHost.cjs');

function host({ appState = 'active', queryThrows = false, screen = 'screens/WelcomeTitle.js', platform = 'android', api = 35, fabric = true, width = 412, height = 852, fontScale = 1, safeTop = 24 } = {}) {
  const slots = [], loops = [], timings = [], values = [], queries = [], listeners = new Map(), cache = new Map();
  let cursor = 0, effects = [], focused = true, currentProps = {};
  const React = {
    createElement(type, props, ...children) { return typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } }; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; });
      }
    },
  };
  const subscribe = name => (event, callback) => {
    const key = name + ':' + event;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(callback);
    return { remove: () => listeners.get(key).delete(callback) };
  };
  const native = {
    Text: 'Text', View: 'View', Image: 'Image', Platform: { OS: platform, Version: api },
    useWindowDimensions: () => ({ width, height, fontScale }),
    StyleSheet: { absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      create: value => value, flatten: value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)) },
    Animated: {
      View: 'AnimatedView',
      Value: class { constructor(value) { this.value = value; values.push(this); } setValue(value) { this.value = value; } stopAnimation() {} interpolate(config) { return { value: this, config }; } },
      timing(value, options) {
        const timing = { value, options, active: false,
          start(callback) { this.active = true; this.callback = callback; },
          stop() { this.active = false; },
          finish() { if (!this.active) throw Error('Timing is not running'); this.active = false; value.setValue(options.toValue); this.callback?.({ finished: true }); },
        };
        timings.push(timing); return timing;
      }, sequence: steps => ({ steps }),
      loop(animation) {
        const loop = { animation, active: false, starts: 0, stops: 0,
          start() { this.active = true; this.starts++; }, stop() { this.active = false; this.stops++; } };
        loops.push(loop); return loop;
      },
    },
    Easing: { sin: 'sin', inOut: value => value },
    AccessibilityInfo: { addEventListener: subscribe('motion'), isReduceMotionEnabled() {
      if (queryThrows) throw Error('Unavailable preference API');
      return new Promise((resolve, reject) => queries.push({ resolve, reject }));
    } },
    AppState: { currentState: appState, addEventListener: subscribe('app') },
  };
  const root = path.resolve(__dirname, '../..');
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith('.ttf')) return file;
    const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React, nativeFabricUIManager: fabric ? {} : undefined })(name => {
      if (name === 'react') return React;
      if (name === 'react-native') return native;
      if (name === 'expo-font') return { useFonts: () => [true] };
      if (name === '@react-navigation/native') return { useIsFocused: () => focused };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: safeTop, bottom: 24, left: 0, right: 0 }) };
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + (path.extname(name) ? '' : '.js'))));
      throw Error('Unexpected title dependency: ' + name);
    }, module, module.exports);
    cache.set(file, module.exports); return module.exports;
  }
  const Title = load(screen).default;
  const h = {
    loops, timings, values, queries, listeners,
    render(props) { if (props) currentProps = props; cursor = 0; effects = []; const tree = Title({ style: { fontSize: 68 }, ...currentProps }); effects.forEach(run => run()); return tree; },
    focus(value) { focused = value; return h.render(); },
    resize(value) { width = value; return h.render(); },
    event(key, value) { if (key === 'app:change') native.AppState.currentState = value; for (const fn of listeners.get(key) || []) fn(value); },
    active() { return loops.filter(loop => loop.active); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return h;
}

module.exports = { welcomeMotionHost: host, nodes, text };
