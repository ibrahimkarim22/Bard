const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
function navigator({ signedIn = false, fontScale = 1, top = 24 } = {}) {
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useEffect() {}, useState: initial => [initial === null && signedIn ? { uid: 'test-account' } : initial, () => {}] };
  const native = { StyleSheet: { create: styles => styles }, Platform: { OS: 'android' }, Pressable: 'Pressable', Text: 'Text', View: 'View', useWindowDimensions: () => ({fontScale}) };
  const calls = [];
  const imports = [];
  const load = name => {
    imports.push(name);
    if (name.startsWith('.')) assert.ok(fs.existsSync(path.resolve(__dirname, '../../Componenets', name + '.js')), `navigation import resolves: ${name}`);
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'Stack', Screen: 'StackScreen' }) };
    if (name === '@react-navigation/drawer') return { createDrawerNavigator: () => ({ Navigator: 'Drawer', Screen: 'DrawerScreen' }), DrawerContentScrollView: 'DrawerScroll' };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({top}) };
    if (name === 'expo-constants') return {};
    if (name === 'firebase/auth') return { onAuthStateChanged() {} };
    if (name === '../firebaseConfig') return {};
    if (name === '../shared/editorialTheme') return require('../../shared/editorialTheme');
    if (name === '../shared/EditorialUI') return { EditorialText: props => ({ type: 'Text', props }) };
    if (name.includes('fontawesome')) return {};
    return { __esModule: true, default: name, RootScreen: name };
  };
  const file = path.resolve(__dirname, '../../Componenets/Navigation.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(load, module, module.exports);
  const stack = module.exports.default();
  const main = nodes(stack, 'StackScreen').find(node => node.props.name === 'Main').props.component();
  const drawer = nodes(main, 'Drawer')[0];
  const routeNames = nodes(main, 'DrawerScreen').map(node => node.props.name);
  const content = drawer.props.drawerContent({ state: { routes: routeNames.map(name => ({ name })), routeNames, index: 0 }, navigation: { navigate: (...args) => calls.push(args) } });
  const renderFunctions = tree => typeof tree?.type === 'function' ? renderFunctions(tree.type(tree.props)) : !tree || typeof tree !== 'object' ? tree : { ...tree, props: { ...tree.props, children: (tree.props.children || []).flat(Infinity).map(renderFunctions) } };
  return { stack, main, content: renderFunctions(content), calls, imports };
}
test('normal drawer opens My Highlights and detail uses the stack alongside the unchanged free-reading route', () => {
  const h = navigator();
  const overview = nodes(h.main, 'DrawerScreen').find(node => node.props.name === 'MyHighlights');
  assert.equal(overview?.props.component, '../screens/MyHighlightsScreen');
  assert.equal(overview.props.options.title, 'My Highlights', 'the drawer navigation retains the only page title');
  const detail = nodes(h.stack, 'StackScreen').find(node => node.props.name === 'PlayHighlights');
  assert.equal(detail?.props.component, '../screens/PlayHighlightsScreen');
  assert.equal(nodes(h.stack, 'StackScreen').find(node => node.props.name === 'ReadFolger').props.component, '../screens/Read');
  const item = nodes(h.content, 'Pressable').find(button => nodes(button, 'Text').some(text => text.props.children.includes('My Highlights')));
  assert.ok(item, 'custom drawer includes the registered entry');
  item.props.onPress(); assert.deepEqual(h.calls, [['MyHighlights']]);
  assert.ok(!nodes(h.content, 'Text').some(text => /sync.*test|harness/i.test(text.props.children.join(''))));
});

test('normal drawer retains every non-video destination and each item navigates to its registered route', () => {
  const retained = ['Home', 'Course', 'SynopsisList', 'FreeFolger', 'MyHighlights', 'About', 'Contact'];
  for (const signedIn of [false, true]) {
    const h = navigator({ signedIn });
    assert.equal(nodes(h.main, 'DrawerScreen').find(node => node.props.name === 'About').props.component, '../screens/AboutScreen');
    assert.equal(nodes(h.main, 'DrawerScreen').find(node => node.props.name === 'Contact').props.component, '../screens/Contact');
    const contact = nodes(h.main, 'DrawerScreen').find(node => node.props.name === 'Contact');
    assert.equal(contact.props.options.title, 'Contact & Feedback');
    assert.equal(contact.props.options.headerTitle(), null, 'the body supplies the single visible page heading');
    const expected = [...retained, ...(signedIn ? [] : ['SignUp', 'Login'])];
    assert.deepEqual(nodes(h.main, 'DrawerScreen').map(node => node.props.name), expected);
    const buttons = nodes(h.content, 'Pressable');
    assert.equal(buttons.length, expected.length);
    buttons.forEach(button => button.props.onPress());
    assert.deepEqual(h.calls, expected.map(name => [name]));
    const copy = nodes(h.content, 'Text').map(node => node.props.children.join(' ')).join('\n');
    assert.doesNotMatch(copy, /Performances|How To|\bGuide\b|Stage and screen|performance notes/i);
    assert.ok(!h.imports.some(name => /screens\/(?:Performances|HowTo)$/.test(name)));
  }
});

test('retained lesson, quiz, synopsis, reader, account, and highlight stack routes still resolve', () => {
  const h = navigator();
  const routes = nodes(h.stack, 'StackScreen').map(node => [node.props.name, node.props.component]);
  assert.deepEqual(routes, [
    ['Main', nodes(h.stack, 'StackScreen').find(node => node.props.name === 'Main').props.component],
    ['Lesson', '../screens/LessonScreen'], ['Quiz', '../screens/QuizScreen'],
    ['Folger', '../screens/FolgerAPITest'], ['MIT', '../screens/MITFullPlayScreen'],
    ['Courses', '../screens/CourseScreen'], ['Root', '../screens/RootScreen'],
    ['Login', '../screens/AuthLoginScreen'], ['SignUp', '../screens/SignUpScreen'],
    ['ReadFolger', '../screens/Read'], ['PlayHighlights', '../screens/PlayHighlightsScreen'],
    ['Synopsis', '../screens/JustSynopsis'],
  ]);
});

test('account scenes use the supported no-slide stack option for curtain handoffs', () => {
  const h = navigator();
  for (const name of ['Root', 'Login', 'SignUp']) {
    const route = nodes(h.stack, 'StackScreen').find(node => node.props.name === name);
    assert.equal(route.props.options.animation, 'none');
    assert.equal(route.props.options.animationEnabled, undefined);
    assert.equal(route.props.options.headerShown, false);
  }
});

test('visible navigators own the top inset without a padded outer safe area or per-route override', () => {
  const h = navigator();
  assert.equal(h.main.type, 'View', 'the drawer shell must not consume the top inset before its header');
  assert.equal(h.main.props.style.paddingTop, undefined);
  assert.equal(h.stack.props.style.paddingTop, undefined);
  for (const screen of nodes(h.main, 'DrawerScreen')) {
    assert.equal(screen.props.options?.headerStatusBarHeight, undefined, screen.props.name);
  }
});

test('Home owns its profile header and top inset while Course keeps its native header', () => {
  const h = navigator();
  const home = nodes(h.main, 'DrawerScreen').find(screen => screen.props.name === 'Home');
  const course = nodes(h.main, 'DrawerScreen').find(screen => screen.props.name === 'Course');
  assert.equal(home.props.options.headerShown, false);
  assert.notEqual(course.props.options?.headerShown, false);
  assert.notEqual(nodes(h.main, 'Drawer')[0].props.screenOptions.headerShown, false,
    'the Home override does not hide headers on other drawer screens');
});

test('one shared header geometry reserves scaled two-line titles without adding a second top inset', () => {
  for (const [fontScale, want] of [[1, 88], [1.5, 114]]) {
    const h = navigator({ fontScale, top: 24 });
    const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
    assert.equal(flatten(nodes(h.main, 'Drawer')[0].props.screenOptions.headerStyle).height, want);
    assert.equal(flatten(nodes(h.stack, 'Stack')[0].props.screenOptions.headerStyle).height, want);
  }
});

test('unused video implementations, data, and YouTube package are removed while the reader WebView remains', () => {
  const root = path.resolve(__dirname, '../..');
  for (const file of ['screens/Performances.js', 'screens/HowTo.js', 'shared/PerformancesRoot.js', 'shared/HowToRoot.js']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `removed video feature: ${file}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.dependencies['react-native-youtube-iframe'], undefined);
  assert.equal(lock.packages[''].dependencies['react-native-youtube-iframe'], undefined);
  assert.equal(lock.packages['node_modules/react-native-youtube-iframe'], undefined);
  assert.equal(manifest.dependencies['react-native-webview'], '13.13.5');
  assert.equal(lock.packages[''].dependencies['react-native-webview'], '13.13.5');
  assert.equal(lock.packages['node_modules/react-native-webview'].version, '13.13.5');
});
