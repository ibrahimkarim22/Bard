const assert = require('node:assert/strict');
const test = require('node:test');
const { synopsisUIHost, nodes, text } = require('../fixtures/synopsisUIHost.cjs');
const host = (options = {}) => {
  const timers = new Map();
  let nextTimer = 0;
  const h = synopsisUIHost({ screen: 'screens/Contact.js',
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id), ...options });
  h.settleLaunch = () => [...timers.values()].forEach(fn => fn());
  return h;
};
const labels = ['Report a problem', 'Suggest an improvement', 'Report a content correction'];
const action = (h, label) => { const control = h.button(label); assert.ok(control, label + ' exists'); return control; };

test('Contact has one heading, a selectable fallback address, scalable text, and accessible action rows', () => {
  const h = host();
  const tree = h.render();
  assert.equal(nodes(tree, 'Text').filter(node => text(node) === 'Contact & Feedback' && node.props.accessibilityRole === 'header').length, 1);
  assert.match(text(tree), /Have a question, an idea, or a correction\? Get in touch\./);
  const email = nodes(tree, 'Text').find(node => text(node) === '22ibrahimkarim@gmail.com');
  assert.equal(email?.props.selectable, true);
  assert.ok(nodes(tree, 'Text').every(node => node.props.allowFontScaling !== false && node.props.numberOfLines === undefined));
  assert.equal(nodes(tree, 'ScrollView').length, 1);
  for (const label of labels) {
    const control = action(h, label);
    assert.equal(control.props.accessibilityRole, 'button');
    const style = typeof control.props.style === 'function' ? control.props.style({ pressed: false }) : control.props.style;
    assert.ok([style].flat(Infinity).some(value => value?.minHeight >= 48));
  }
  assert.match(text(tree), /editable email draft/);
  assert.doesNotMatch(text(tree), /sign in|test@yahoo|support team|response time|sent successfully/i);
});

test('each action launches only its own editable mailto draft without a capability pre-check', async () => {
  const opened = [];
  const h = host({ linking: { openURL: async uri => opened.push(uri), canOpenURL: () => { throw Error('Do not block an otherwise working mailto'); } } });
  for (let index = 0; index < labels.length; index++) {
    await action(h, labels[index]).props.onPress();
    h.settleLaunch();
    assert.equal(opened.length, index + 1);
    assert.equal(new URL(opened[index]).pathname, '22ibrahimkarim@gmail.com');
  }
  assert.deepEqual(opened.map(uri => new URL(uri).searchParams.get('subject')), ['Bard — Problem report', 'Bard — Improvement suggestion', 'Bard — Content correction']);
  assert.doesNotMatch(text(h.render()), /email (?:was )?sent|message sent/i);
});

test('unavailable email handler preserves the address, reports failure, and allows retry', async () => {
  let fail = true;
  const h = host({ linking: { openURL: async () => { if (fail) throw Error('No email handler'); } } });
  await action(h, labels[0]).props.onPress();
  assert.match(text(h.render()), /Your email app could not be opened/);
  assert.equal(nodes(h.render(), 'Text').find(node => text(node) === '22ibrahimkarim@gmail.com').props.selectable, true);
  assert.equal(action(h, labels[0]).props.accessibilityState.disabled, false);
  fail = false;
  await action(h, labels[0]).props.onPress();
  h.settleLaunch();
  assert.equal(nodes(h.render(), 'Text').some(node => node.props.accessibilityRole === 'alert'), false);
});

test('rapid taps cannot launch duplicate composers before a rerender or while opening', async () => {
  let resolve;
  const opened = [];
  const h = host({ linking: { openURL: uri => { opened.push(uri); return new Promise(done => { resolve = done; }); } } });
  const first = action(h, labels[0]);
  const opening = first.props.onPress();
  await first.props.onPress();
  assert.equal(opened.length, 1);
  assert.ok(labels.every(label => action(h, label).props.accessibilityState.disabled));
  resolve();
  await opening;
  h.settleLaunch();
  assert.ok(labels.every(label => !action(h, label).props.accessibilityState.disabled));
});

test('rapid taps stay suppressed when the native launch acknowledges immediately', async () => {
  const opened = [];
  const h = host({ linking: { openURL: async uri => opened.push(uri) } });
  const control = action(h, labels[0]);
  await control.props.onPress();
  await control.props.onPress();
  assert.equal(opened.length, 1, 'an immediate acknowledgement must not reopen the composer');
  h.settleLaunch();
  await action(h, labels[1]).props.onPress();
  assert.equal(opened.length, 2);
  h.settleLaunch();
});

test('an unacknowledged launch times out and stale completion cannot unlock a newer launch', async () => {
  const pending = [], timers = new Map();
  let timerId = 0;
  const h = host({ linking: { openURL: () => new Promise(resolve => pending.push(resolve)) },
    setTimeout: (fn, delay) => { assert.ok(delay > 0); timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id) });
  const old = action(h, labels[0]).props.onPress();
  timers.values().next().value();
  assert.match(text(h.render()), /Could not confirm the email app opened/);
  const newer = action(h, labels[1]).props.onPress();
  pending[0]();
  await old;
  assert.equal(action(h, labels[1]).props.accessibilityState.disabled, true);
  pending[1]();
  await newer;
  [...timers.values()].forEach(fn => fn());
  assert.equal(action(h, labels[1]).props.accessibilityState.disabled, false);
  assert.equal(timers.size, 0);
});

test('public Contact Back returns to welcome while ordinary visits and an open drawer keep normal Back', () => {
  let handler, backs = 0, removed = 0;
  let drawerStatus = 'closed';
  const options = { drawerStatus: () => drawerStatus, navigation: { getState: () => ({}), getParent: () => ({ canGoBack: () => true, goBack: () => { backs++; } }) },
    backHandler: { addEventListener: (event, fn) => { assert.equal(event, 'hardwareBackPress'); handler = fn; return { remove: () => { removed++; } }; } } };
  const h = host(options);
  h.route.params = { fromPublicRoot: true };
  h.render();
  assert.equal(typeof handler, 'function');
  drawerStatus = 'open';
  assert.equal(handler(), false, 'Back first lets the drawer close');
  assert.equal(backs, 0);
  drawerStatus = 'closed';
  assert.equal(handler(), true);
  assert.equal(backs, 1);
  h.unmount();
  assert.equal(removed, 1);
  assert.equal(handler(), false, 'late callbacks cannot navigate after leaving');
  let normalRegistered = false;
  host({ backHandler: { addEventListener: () => { normalRegistered = true; } } }).render();
  assert.equal(normalRegistered, false, 'ordinary drawer visits preserve existing navigation behavior');
});

test('leaving Contact cancels its launch timer without sending or scheduling another draft', async () => {
  let resolve, timeout, cleared = 0, opens = 0;
  const h = host({ linking: { openURL: () => { opens++; return new Promise(done => { resolve = done; }); } },
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => { cleared++; } });
  const opening = action(h, labels[0]).props.onPress();
  h.unmount();
  timeout();
  resolve();
  await opening;
  assert.equal(opens, 1);
  assert.equal(cleared, 1);
});

test('Android copy writes only the public address, then verifies it without reading a previous clipboard', async () => {
  const calls = [];
  const h = host({ clipboard: { setString: value => calls.push(['write', value]), getString: async () => { calls.push(['read']); return '22ibrahimkarim@gmail.com'; } } });
  await action(h, 'Copy email').props.onPress();
  assert.deepEqual(calls, [['write', '22ibrahimkarim@gmail.com'], ['read']]);
  assert.match(text(h.render()), /Email address copied\./);
  assert.equal(host({ platform: 'web' }).button('Copy email'), undefined, 'the unreliable web clipboard implementation is not used');
});

test('clipboard mismatch or rejection never claims success or reveals clipboard contents', async () => {
  for (const getString of [async () => 'dummy private clipboard value', async () => { throw Error('not available'); }]) {
    const h = host({ clipboard: { setString() {}, getString } });
    await action(h, 'Copy email').props.onPress();
    assert.match(text(h.render()), /Could not confirm the address was copied\./);
    assert.doesNotMatch(text(h.render()), /Email address copied|dummy private clipboard value|not available/);
  }
});

test('a delayed clipboard read cannot override a newer copy or update an unmounted screen', async () => {
  const reads = [];
  const h = host({ clipboard: { setString() {}, getString: () => new Promise(resolve => reads.push(resolve)) } });
  const older = action(h, 'Copy email').props.onPress();
  const newer = action(h, 'Copy email').props.onPress();
  reads[1]('22ibrahimkarim@gmail.com');
  await newer;
  reads[0]('dummy private clipboard value');
  await older;
  assert.match(text(h.render()), /Email address copied\./);
  assert.doesNotMatch(text(h.render()), /Could not confirm/);
  const after = action(h, 'Copy email').props.onPress();
  h.unmount();
  reads[2]('22ibrahimkarim@gmail.com');
  await after;
});
