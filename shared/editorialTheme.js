const EDITORIAL_COLORS = Object.freeze({
  background: '#f5f0e6', surface: '#fffaf1', soft: '#eae2d4',
  text: '#292720', muted: '#696155', gold: '#806326', onGold: '#fffaf1',
  border: '#d5cab8', success: '#315d43', danger: '#8b3f36',
  correctSurface: '#e5eee4', incorrectSurface: '#f5e7e2',
});

const EDITORIAL_SPACING = Object.freeze({ horizontal: 24, section: 28, small: 12, maxWidth: 720 });

const tones = Object.freeze({
  Comedy: { color: '#355943', backgroundColor: '#e7ecdf', borderColor: '#c1cfb9' },
  Tragedy: { color: '#823f43', backgroundColor: '#f0e1de', borderColor: '#d9bcba' },
  History: { color: '#455d70', backgroundColor: '#e2e8ea', borderColor: '#bacbd2' },
  Romance: { color: '#70516b', backgroundColor: '#ece2eb', borderColor: '#cfbfce' },
});
const neutral = Object.freeze({ color: EDITORIAL_COLORS.muted, backgroundColor: EDITORIAL_COLORS.soft, borderColor: EDITORIAL_COLORS.border });
function getEditorialGenreTone(genre) { return tones[genre] || neutral; }

const EDITORIAL_HIGHLIGHT_THEME = Object.freeze({
  background: EDITORIAL_COLORS.background, panel: EDITORIAL_COLORS.surface,
  text: EDITORIAL_COLORS.text, secondary: EDITORIAL_COLORS.muted, border: EDITORIAL_COLORS.border,
  highlightAction: '#72551f', highlightPrimary: '#72551f', highlightSecondary: '#4f6570',
  highlightActionDisabled: '#827866', highlightPressed: EDITORIAL_COLORS.soft, highlightDanger: EDITORIAL_COLORS.danger,
});

module.exports = { EDITORIAL_COLORS, EDITORIAL_SPACING, getEditorialGenreTone, EDITORIAL_HIGHLIGHT_THEME };
