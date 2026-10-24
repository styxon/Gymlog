const assert = require('node:assert/strict');

const {
  PRO_COACH_QUESTIONS_PER_MONTH,
  coachQuotaMonthStart,
  coachQuotaReset,
  resolveCoachQuota,
  recordCoachQuestion,
} = require('../../.test-dist/lib/aiCoachQuota.js');

// Local dates on purpose: the window is the reader's calendar month, not UTC's.
const MID_JULY = new Date(2026, 6, 15, 18, 30);
const LAST_JULY = new Date(2026, 6, 31, 23, 59);
const EARLY_AUG = new Date(2026, 7, 2, 8, 0);

module.exports = [
  {
    name: 'coach quota: the window is the local calendar month',
    run() {
      assert.equal(coachQuotaMonthStart(MID_JULY), '2026-07');
      assert.equal(coachQuotaMonthStart(LAST_JULY), '2026-07');
      assert.equal(coachQuotaMonthStart(EARLY_AUG), '2026-08');
      // Late on the last evening of a month the key is still that month —
      // a UTC key would have rolled it over for anyone east of Greenwich.
      assert.notEqual(coachQuotaMonthStart(LAST_JULY), coachQuotaMonthStart(EARLY_AUG));
    },
  },
  {
    name: 'coach quota: twenty-five a month, then zero remaining',
    run() {
      assert.equal(PRO_COACH_QUESTIONS_PER_MONTH, 25);

      let state = null;
      for (let i = 1; i <= PRO_COACH_QUESTIONS_PER_MONTH; i += 1) {
        state = recordCoachQuestion(state, MID_JULY);
        const now = resolveCoachQuota(state, MID_JULY);
        assert.equal(now.used, i);
        assert.equal(now.remaining, PRO_COACH_QUESTIONS_PER_MONTH - i);
      }
      assert.equal(resolveCoachQuota(state, MID_JULY).remaining, 0);

      // Past the cap it clamps rather than going negative: a negative
      // remaining renders as "-1 questions left this month".
      state = recordCoachQuestion(state, MID_JULY);
      assert.equal(resolveCoachQuota(state, MID_JULY).remaining, 0);
    },
  },
  {
    name: 'coach quota: resets by comparison when the month rolls over',
    run() {
      // No timer anywhere: a phone asleep through midnight on the 1st still
      // wakes with a full allowance, because the month key is compared rather
      // than counted down.
      const spent = { monthStart: '2026-07', used: PRO_COACH_QUESTIONS_PER_MONTH };
      assert.equal(resolveCoachQuota(spent, LAST_JULY).remaining, 0);
      assert.equal(resolveCoachQuota(spent, EARLY_AUG).remaining, PRO_COACH_QUESTIONS_PER_MONTH);
      assert.equal(resolveCoachQuota(spent, EARLY_AUG).used, 0);
    },
  },
  {
    name: 'coach quota: malformed stored state is treated as unused, never as extra credit',
    run() {
      for (const bad of [null, undefined, { monthStart: '2026-07', used: -5 }]) {
        const resolved = resolveCoachQuota(bad, MID_JULY);
        assert.equal(resolved.used, 0);
        assert.equal(resolved.remaining, PRO_COACH_QUESTIONS_PER_MONTH);
      }
    },
  },
  {
    name: 'coach quota: the reset says the date and how far off, never zero days',
    run() {
      const reset = coachQuotaReset(MID_JULY);
      assert.equal(reset.at.getFullYear(), 2026);
      assert.equal(reset.at.getMonth(), 7, 'August');
      assert.equal(reset.at.getDate(), 1);
      assert.equal(reset.inDays, 17);

      // The last evening of the month reports one day, not none. Counting
      // between local midnights is what makes 23:59 still say "tomorrow".
      assert.equal(coachQuotaReset(LAST_JULY).inDays, 1);

      // December has to roll the year, which naive month arithmetic drops.
      const december = coachQuotaReset(new Date(2026, 11, 20, 12, 0));
      assert.equal(december.at.getFullYear(), 2027);
      assert.equal(december.at.getMonth(), 0);
    },
  },
  {
    name: 'the free tier has no self-serve quota to spend',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const source = fs.readFileSync(path.join(root, 'src', 'lib', 'aiCoachQuota.ts'), 'utf8');

      // The weekly free allowance was removed on 2026-08-29: at $0.027 a
      // question it cost about as much per free user as a paying one, and it
      // drew from the same shared Console limit paying users depend on. What a
      // free reader gets instead is three demo moments (lib/coachDemoMoments)
      // and the blurred local answer, neither of which has a counter.
      assert.doesNotMatch(source, /FREE_COACH_QUESTIONS/);
      assert.doesNotMatch(source, /weekStart/);

      // And the screen must not hand a free reader a live send. The rule is
      // one line at the call site, so this checks the line.
      const chat = fs.readFileSync(
        path.join(root, 'src', 'screens', 'AICoachChatScreen.tsx'),
        'utf8',
      );
      assert.match(chat, /const canAsk = proUnlocked && questionsRemaining - composingIds\.length > 0;/);
    },
  },
];
