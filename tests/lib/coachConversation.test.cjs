const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  appendCoachTurn,
  MAX_COACH_CONVERSATION_TURNS,
} = require('../../.test-dist/lib/coachConversation.js');

module.exports = [
  {
    name: 'coach conversation: keeps the newest exchanges and drops empty ones',
    run() {
      let history = [];
      for (let index = 1; index <= 5; index += 1) {
        history = appendCoachTurn(history, { question: `q${index}`, takeaway: `a${index}` });
      }
      assert.equal(history.length, MAX_COACH_CONVERSATION_TURNS);
      assert.deepEqual(
        history.map((turn) => turn.question),
        ['q3', 'q4', 'q5'],
        'the oldest exchanges fall off, not the newest',
      );

      // An empty side would spend tokens saying nothing, and an empty
      // assistant turn is not a valid message either.
      const unchanged = appendCoachTurn(history, { question: '  ', takeaway: 'a6' });
      assert.equal(unchanged, history);
      assert.equal(appendCoachTurn(history, { question: 'q6', takeaway: '' }), history);

      assert.deepEqual(appendCoachTurn([], { question: ' miksi? ', takeaway: ' koska. ' }), [
        { question: 'miksi?', takeaway: 'koska.' },
      ]);
    },
  },
  {
    name: 'coach conversation: the chat sends it and records answers into it',
    run() {
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');

      // A ref, not state: state captured in the send callback's dependency
      // list would be one turn behind, and a follow-up would refer to the
      // wrong answer. What it STARTS from is now the resumed thread rather
      // than an empty list — leaving the screen no longer ends the
      // conversation (#bugs 2026-08-27) — but it is still a ref.
      assert.match(screen, /const conversation = useRef<AICoachConversationTurn\[\]>\(/);
      assert.doesNotMatch(screen, /useState<AICoachConversationTurn\[\]>/);
      assert.match(screen, /const resumed = useRef\(resumeCoachChat\(memory, /);
      assert.match(screen, /history: conversation\.current,/);
      // Through the rule that keeps crisis answers out (lib/coachCrisisTurn),
      // which appends with appendCoachTurn.
      assert.match(screen, /conversation\.current = coachHistoryAfterAnswer\(conversation\.current, trimmed, answer, false\);/);

      // Nothing about the thread is written to storage: it lives in memory for
      // as long as the app does, and no longer.
      const lib = fs.readFileSync(path.join(__dirname, '../../src/lib/coachConversation.ts'), 'utf8');
      const code = lib.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.doesNotMatch(code, /AsyncStorage|@vinha\//);
      assert.doesNotMatch(code, /^import (?!type )/m, 'nothing but a type import — this module is pure');
    },
  },
  {
    name: 'the endpoint bounds the conversation it accepts, and pays for it as prompt',
    run() {
      const source = fs.readFileSync(path.join(__dirname, '../../api/ai-coach.ts'), 'utf8');

      // Unbounded history would be resent, and paid for, on every turn.
      assert.match(source, /const MAX_HISTORY_TURNS = 3;/);
      assert.match(source, /return clean\.slice\(-MAX_HISTORY_TURNS\);/);
      assert.match(source, /history: sanitizeHistory\(candidate\.history\)/);

      // It rides in the uncached half, so the budget has to see it — against
      // its own limit: added to the question's, three exchanges alone passed
      // the 2,000-character cap and a follow-up went offline (server audit,
      // 2026-09-21).
      assert.match(source, /historyChars: \(input\.history \?\? \[\]\)\.reduce\(\(total, turn\) => total \+ turn\.question\.length \+ turn\.takeaway\.length, 0\)/);
      assert.doesNotMatch(source, /input\.prompt\.length \+/);

      // Real turns rather than a preamble, so "why?" has an antecedent.
      assert.match(source, /\{ role: 'user', content: turn\.question \}/);
      assert.match(source, /\{ role: 'assistant', content: turn\.takeaway \}/);
    },
  },
];
