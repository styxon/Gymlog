const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isCoachCrisisTurn, withoutCoachCrisisTurns } = require('../../.test-dist/lib/coachCrisisTurn.js');
const { resumeCoachChat } = require('../../.test-dist/lib/coachChatMemory.js');
const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * A crisis exchange never becomes history (F1 crisis hunt, 2026-10-08).
 *
 * The server answers a crisis its newer filter catches with the crisis answer,
 * marked 'preview'. The chat appended that turn like any other, so the
 * message went to the model with the next question.
 */
module.exports = [
  {
    name: 'crisis turn: read by either side, the question or the crisis answer',
    run() {
      assert.equal(isCoachCrisisTurn({ question: 'I want to die', takeaway: 'x' }), true);
      assert.equal(isCoachCrisisTurn({ question: 'haluan kuolla', takeaway: 'x' }), true);
      // A question this build's filter misses, answered by a newer server:
      // the answer is the only sign, in either language.
      for (const language of ['fi', 'en']) {
        const answer = buildAiCoachPreviewAnswer('I want to die', {}, language);
        assert.equal(answer.takeaway, t(language, 'coachPreview.crisis.takeaway'));
        assert.equal(isCoachCrisisTurn({ question: 'something this build reads as training', takeaway: answer.takeaway }), true);
        assert.equal(isCoachCrisisTurn({ question: 'q', takeaway: ` ${answer.takeaway} ` }), true);
      }
      assert.equal(isCoachCrisisTurn({ question: 'how many sets for chest?', takeaway: 'Ten a week.' }), false);
      // Malformed is not a crisis, and does not throw.
      assert.equal(isCoachCrisisTurn(null), false);
      assert.equal(isCoachCrisisTurn({ role: 'user', text: 'x' }), false);
      assert.equal(isCoachCrisisTurn({ question: 42, takeaway: null }), false);
    },
  },
  {
    name: 'crisis turn: a thread reopened from memory sends no crisis turn back',
    run() {
      const crisisTakeaway = t('en', 'coachPreview.crisis.takeaway');
      const messages = [
        { id: 'me:1', fromCoach: false, text: 'I wanted to die' },
        { id: 'coach:1', fromCoach: true, text: crisisTakeaway },
      ];
      const turns = [
        { question: 'how many sets for chest?', takeaway: 'Ten a week.' },
        { question: 'I wanted to die', takeaway: crisisTakeaway },
        { question: 'and legs?', takeaway: 'The same.' },
      ];
      const resumed = resumeCoachChat({ lastActiveAt: '2026-10-08T07:00:00.000Z', messages, turns }, '2026-10-08T07:05:00.000Z');
      assert.ok(resumed);
      assert.deepEqual(resumed.turns.map((turn) => turn.question), ['how many sets for chest?', 'and legs?']);
      // The thread is drawn as it was.
      assert.deepEqual(resumed.messages, messages);
      assert.deepEqual(withoutCoachCrisisTurns(turns), resumed.turns);
    },
  },
  {
    name: 'crisis turn: the chat appends no crisis answer to the conversation',
    run() {
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');
      const code = screen.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const appends = [...code.matchAll(/conversation\.current = appendCoachTurn\(/g)];
      assert.ok(appends.length > 0);
      for (const match of appends) {
        const before = code.slice(Math.max(0, match.index - 200), match.index);
        assert.match(
          before,
          /if \(!isCoachCrisisTurn\(\{ question: trimmed, takeaway: answer\.takeaway \}\)\) \{\s*$/,
          'an answered turn is appended without asking whether it was a crisis answer',
        );
      }
    },
  },
];
