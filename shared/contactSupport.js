const CONTACT_EMAIL = '22ibrahimkarim@gmail.com';

const CONTACT_ACTIONS = Object.freeze([
  Object.freeze({ id: 'problem', label: 'Report a problem', subject: 'Bard — Problem report',
    body: ['What happened?', 'What were you doing when it happened?', 'What did you expect?', ''].join('\r\n\r\n') }),
  Object.freeze({ id: 'improvement', label: 'Suggest an improvement', subject: 'Bard — Improvement suggestion',
    body: ['What would you like to improve?', ''].join('\r\n\r\n') }),
  Object.freeze({ id: 'correction', label: 'Report a content correction', subject: 'Bard — Content correction',
    body: ['Which play and section?', 'What wording or answer needs attention?', 'What correction do you suggest?', ''].join('\r\n\r\n') }),
]);

function buildContactMailto(id) {
  const action = CONTACT_ACTIONS.find(value => value.id === id);
  if (!action) throw new Error('Unknown contact action');
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(action.subject)}&body=${encodeURIComponent(action.body)}`;
}

module.exports = { CONTACT_EMAIL, CONTACT_ACTIONS, buildContactMailto };
