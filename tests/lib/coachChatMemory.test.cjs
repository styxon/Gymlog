const assert = require('node:assert/strict');

const { COACH_CHAT_MEMORY_MS, resumeCoachChat } = require('../../src/lib/coachChatMemory');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

function memory(lastActiveAt, messages = [{ id: 'm1', fromCoach: false, text: 'Säädä ohjelmaani' }]) {
  return {
    lastActiveAt,
    messages,
    turns: [{ role: 'user', text: 'Säädä ohjelmaani' }],
  };
}

module.exports = [
  {
    /**
     * The bug this exists for: the coach proposes a workout, the reader taps
     * through to look at it, comes back — and the brief that earned the answer
     * is still there.
     */
    name: 'a thread from a minute ago is reopened, not restarted',
    run() {
      const resumed = resumeCoachChat(memory('2026-08-27T07:22:00.000Z'), '2026-08-27T07:23:00.000Z');
      assert.ok(resumed);
      assert.equal(resumed.messages.length, 1);
      assert.equal(resumed.turns.length, 1);
    },
  },
  {
    name: 'a thread older than the window starts fresh',
    run() {
      const stale = resumeCoachChat(memory('2026-08-27T07:00:00.000Z'), '2026-08-27T15:01:00.000Z');
      assert.equal(stale, null);
    },
  },
  {
    name: 'the window is exactly eight hours, and its edge still counts as live',
    run() {
      assert.equal(COACH_CHAT_MEMORY_MS, 8 * 60 * 60 * 1000);
      const edge = resumeCoachChat(memory('2026-08-27T07:00:00.000Z'), '2026-08-27T15:00:00.000Z');
      assert.ok(edge, 'exactly eight hours old is not yet stale');
    },
  },
  {
    name: 'nothing stored, an empty thread and an unreadable stamp all start fresh',
    run() {
      assert.equal(resumeCoachChat(null, '2026-08-27T07:23:00.000Z'), null);
      assert.equal(resumeCoachChat(undefined, '2026-08-27T07:23:00.000Z'), null);
      assert.equal(resumeCoachChat(memory('2026-08-27T07:22:00.000Z', []), '2026-08-27T07:23:00.000Z'), null);
      assert.equal(resumeCoachChat(memory('not a date'), '2026-08-27T07:23:00.000Z'), null);
    },
  },
  {
    /**
     * A stamp in the future is a clock that moved, not a stale thread — the
     * DST class of bug. Keeping the conversation is the safe direction.
     */
    name: 'a clock that moved backwards does not wipe the conversation',
    run() {
      const resumed = resumeCoachChat(memory('2026-08-27T09:00:00.000Z'), '2026-08-27T07:23:00.000Z');
      assert.ok(resumed);
    },
  },
  {
    /**
     * The lib is only worth anything if the thread is actually held above the
     * screen that unmounts. This pins that wiring.
     */
    name: 'the thread is held in the shell, not in the chat screen',
    run() {
      const source = readAppWiring();
      assert.ok(
        source.includes('coachChatMemory'),
        'App wiring must hold the coach thread so navigating away does not end it',
      );
      assert.ok(
        source.includes('onCoachChatMemoryChange'),
        'the chat screen must be able to publish the thread upward',
      );
    },
  },
];
