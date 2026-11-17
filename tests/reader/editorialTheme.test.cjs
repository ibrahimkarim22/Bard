const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EDITORIAL_COLORS: colors,
  EDITORIAL_HIGHLIGHT_THEME: highlights,
  getEditorialGenreTone,
} = require('../../shared/editorialTheme');

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function assertReadable(foreground, background, label) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  const ratio = (values[0] + 0.05) / (values[1] + 0.05);
  assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1`);
}

test('ordinary pages and quiz feedback remain dark with readable text and actions', () => {
  for (const token of ['background', 'surface', 'soft', 'correctSurface', 'incorrectSurface']) {
    assert.ok(luminance(colors[token]) < 0.05, `${token} stays dark`);
    for (const foreground of ['text', 'muted', 'gold', 'success', 'danger']) {
      assertReadable(colors[foreground], colors[token], `${foreground} on ${token}`);
    }
  }
  assertReadable(colors.onGold, colors.gold, 'gold button label');
  assertReadable(colors.onRed, colors.red, 'red button label');
});

test('genre labels remain distinct and readable on their dark chip surfaces', () => {
  const genres = ['Comedy', 'Tragedy', 'History', 'Romance', 'All'];
  const tones = genres.map(getEditorialGenreTone);
  assert.equal(new Set(tones.map(tone => tone.color)).size, genres.length);
  tones.forEach((tone, index) => {
    assert.ok(luminance(tone.backgroundColor) < 0.05, `${genres[index]} stays dark`);
    assertReadable(tone.color, tone.backgroundColor, genres[index]);
  });
  assert.equal(getEditorialGenreTone('Unknown'), getEditorialGenreTone('All'));
});

test('saved-highlight actions stay readable on normal and pressed dark app surfaces', () => {
  assert.notEqual(highlights.highlightPrimary, highlights.highlightSecondary);
  for (const background of ['background', 'panel', 'highlightPressed']) {
    assert.ok(luminance(highlights[background]) < 0.05, `${background} stays dark`);
    for (const foreground of ['text', 'secondary', 'highlightAction', 'highlightPrimary', 'highlightSecondary', 'highlightActionDisabled', 'highlightDanger']) {
      assertReadable(highlights[foreground], highlights[background], `${foreground} on ${background}`);
    }
  }
});
