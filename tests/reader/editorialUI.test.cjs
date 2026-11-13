const assert = require('node:assert/strict');
const test = require('node:test');
const { synopsisUIHost, nodes, text } = require('../fixtures/synopsisUIHost.cjs');
const host = (exportName, props) => synopsisUIHost({ screen: 'shared/EditorialUI.js', exportName, props });

test('editorial search clears its query and leaves long text scalable', () => {
  const changed = [];
  const h = host('EditorialSearch', { value: 'Hamlet', onChangeText: value => changed.push(value), onClear: () => changed.push('') });
  const input = nodes(h.render(), 'TextInput')[0];
  assert.equal(input.props.value, 'Hamlet');
  assert.notEqual(input.props.allowFontScaling, false);
  input.props.onChangeText('Lear');
  h.button('Clear search').props.onPress();
  assert.deepEqual(changed, ['Lear', '']);
});

test('genre filters expose current selection and change only on intentional activation', () => {
  const changes = [];
  const h = host('EditorialFilters', { values: ['All', 'Comedy', 'Tragedy'], value: 'Comedy', onChange: value => changes.push(value) });
  const tabs = nodes(h.render(), 'Pressable');
  assert.equal(tabs.find(tab => tab.props.accessibilityLabel === 'Comedy').props.accessibilityState.selected, true);
  assert.equal(tabs.find(tab => tab.props.accessibilityLabel === 'Tragedy').props.accessibilityState.selected, false);
  assert.deepEqual(changes, []);
  tabs.find(tab => tab.props.accessibilityLabel === 'Tragedy').props.onPress();
  assert.deepEqual(changes, ['Tragedy']);
});

test('illustrated rows use the play cover, preserve readable titles and respect disabled navigation', () => {
  let opened = 0;
  const play = { name: 'A Midsummer Night’s Dream', genre: 'Comedy', mainImage: 'cover-image', medalImage: 'hidden-medal' };
  const h = host('EditorialPlayRow', { play, onPress: () => opened++, disabled: true });
  const tree = h.render();
  assert.equal(nodes(tree, 'Image')[0].props.source, 'cover-image');
  assert.match(text(tree), /A Midsummer Night’s Dream/);
  assert.ok(nodes(tree, 'Text').every(node => node.props.numberOfLines === undefined && node.props.allowFontScaling !== false));
  const row = nodes(tree, 'Pressable')[0];
  assert.equal(row.props.disabled, true);
  assert.equal(row.props.onPress, undefined);
  assert.equal(opened, 0);
});

test('light course pages retain bottom safe area while the navigator owns the top', () => {
  const h = synopsisUIHost({ screen: 'course/CourseUI.js', exportName: 'CoursePage' });
  assert.deepEqual(nodes(h.render(), 'SafeAreaView')[0].props.edges, ['left', 'right', 'bottom']);
  assert.equal(nodes(h.render(), 'StatusBar')[0].props.barStyle, 'dark-content');
});
