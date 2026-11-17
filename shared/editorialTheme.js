const EDITORIAL_COLORS = Object.freeze({
  background: '#121116', surface: '#1b1820', soft: '#2b2530',
  text: '#f3eadb', muted: '#bdb1bd', gold: '#c6a663', onGold: '#241c15',
  red: '#6f2638', onRed: '#fff8ed', border: '#423845',
  success: '#9dc7a7', danger: '#eda5af',
  correctSurface: '#203128', incorrectSurface: '#3a212a',
});

const EDITORIAL_SPACING = Object.freeze({ horizontal: 24, section: 28, small: 12, maxWidth: 720 });

const tones = Object.freeze({
  Comedy: { color: '#adc8b2', backgroundColor: '#25332b', borderColor: '#48624f' },
  Tragedy: { color: '#d7a1a9', backgroundColor: '#3a242e', borderColor: '#714350' },
  History: { color: '#a9bfcd', backgroundColor: '#23313b', borderColor: '#496071' },
  Romance: { color: '#c8aed3', backgroundColor: '#342939', borderColor: '#65506b' },
});
const neutral = Object.freeze({ color: EDITORIAL_COLORS.gold, backgroundColor: EDITORIAL_COLORS.soft, borderColor: EDITORIAL_COLORS.border });
function getEditorialGenreTone(genre) { return tones[genre] || neutral; }

const EDITORIAL_HIGHLIGHT_THEME = Object.freeze({
  background: EDITORIAL_COLORS.background, panel: EDITORIAL_COLORS.surface,
  text: EDITORIAL_COLORS.text, secondary: EDITORIAL_COLORS.muted, border: EDITORIAL_COLORS.border,
  highlightAction: EDITORIAL_COLORS.text, highlightPrimary: EDITORIAL_COLORS.gold, highlightSecondary: '#b6c6d0',
  highlightActionDisabled: '#a397a6', highlightPressed: EDITORIAL_COLORS.soft, highlightDanger: EDITORIAL_COLORS.danger,
});

module.exports = { EDITORIAL_COLORS, EDITORIAL_SPACING, getEditorialGenreTone, EDITORIAL_HIGHLIGHT_THEME };
