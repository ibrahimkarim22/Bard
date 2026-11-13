const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const file = path.resolve(__dirname, '../../shared/contactSupport.js');
const support = () => { assert.ok(fs.existsSync(file), 'shared contact configuration exists'); return require(file); };
const expected = [
  ['problem', 'Report a problem', 'Bard — Problem report', ['What happened?', 'What were you doing when it happened?', 'What did you expect?']],
  ['improvement', 'Suggest an improvement', 'Bard — Improvement suggestion', ['What would you like to improve?']],
  ['correction', 'Report a content correction', 'Bard — Content correction', ['Which play and section?', 'What wording or answer needs attention?', 'What correction do you suggest?']],
];

test('all three contact actions use the approved recipient and exact editable templates', () => {
  const { CONTACT_EMAIL, CONTACT_ACTIONS, buildContactMailto } = support();
  assert.equal(CONTACT_EMAIL, '22ibrahimkarim@gmail.com');
  assert.equal(CONTACT_ACTIONS.length, expected.length);
  for (const [id, label, subject, prompts] of expected) {
    const action = CONTACT_ACTIONS.find(value => value.id === id);
    assert.equal(action.label, label);
    const url = new URL(buildContactMailto(id));
    assert.equal(url.protocol, 'mailto:');
    assert.equal(url.pathname, CONTACT_EMAIL);
    assert.equal(url.searchParams.get('subject'), subject);
    assert.equal(url.searchParams.get('body'), prompts.join('\r\n\r\n') + '\r\n\r\n');
    assert.deepEqual([...url.searchParams.keys()], ['subject', 'body'], 'no attachments, hidden recipients, or private diagnostics');
  }
});

test('Unicode subjects, punctuation, and CRLF body breaks use safe URI parameter encoding', () => {
  const { CONTACT_ACTIONS, buildContactMailto } = support();
  for (const action of CONTACT_ACTIONS) {
    const uri = buildContactMailto(action.id);
    assert.equal(uri, 'mailto:22ibrahimkarim@gmail.com?subject=' + encodeURIComponent(action.subject) + '&body=' + encodeURIComponent(action.body));
    assert.match(uri, /%E2%80%94/);
    assert.match(uri, /%0D%0A/);
    assert.doesNotMatch(uri, /[\r\n ]/);
  }
});

test('unknown contact actions cannot supply arbitrary recipients, parameters, or private payloads', () => {
  const { buildContactMailto } = support();
  for (const id of ['', 'other@example.com', 'problem&bcc=other@example.com', null, undefined]) {
    assert.throws(() => buildContactMailto(id), /Unknown contact action/);
  }
});
