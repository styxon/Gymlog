const assert = require('node:assert/strict');

const { createCoachQuotaLedger, coachQuotaMonthStart, PRO_COACH_QUESTIONS_PER_MONTH } = require('../../src/lib/aiCoachQuota');

/**
 * The monthly coach allowance is checked on a render-time snapshot and spent
 * seconds later, after the model answers. Two requests started in that window
 * (two builds, or a photo read beside a build) both passed on the last
 * question and the month ended on 26 of 25.
 */
const month = coachQuotaMonthStart();
const lastOne = { monthStart: month, used: PRO_COACH_QUESTIONS_PER_MONTH - 1 };

module.exports = [
  {
    name: 'coach quota reservation: a second request sees the first one claim the last question',
    run() {
      const ledger = createCoachQuotaLedger();
      assert.equal(ledger.reserve(lastOne), true);
      // Same stale snapshot, nothing recorded yet: the claim is what stops it.
      assert.equal(ledger.reserve(lastOne), false);
      assert.equal(ledger.held(), 1);
      // A failure gives the claim back and costs nothing: the next one may go.
      ledger.release();
      assert.equal(ledger.reserve(lastOne), true);
      ledger.release();
      ledger.release();
      assert.equal(ledger.held(), 0);
    },
  },
  {
    name: 'coach quota reservation: claims count against the stored allowance, not beyond it',
    run() {
      const ledger = createCoachQuotaLedger();
      const two = { monthStart: month, used: PRO_COACH_QUESTIONS_PER_MONTH - 2 };
      assert.equal(ledger.reserve(two), true);
      assert.equal(ledger.reserve(two), true);
      assert.equal(ledger.reserve(two), false);
      assert.equal(createCoachQuotaLedger().reserve(null), true);
      assert.equal(createCoachQuotaLedger().reserve({ monthStart: month, used: PRO_COACH_QUESTIONS_PER_MONTH }), false);
    },
  },
  {
    name: 'coach quota reservation: the two spend sites claim before the wait and answer a refused write',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
      const home = read('src', 'app', 'renderHomeScreens.tsx');
      const photo = read('src', 'app', 'onboardingFinishes.tsx');
      assert.doesNotMatch(home + photo, /void updatePreferences\(\(current\) => \(\{ aiCoachProQuota/);
      assert.match(home, /await updatePreferences\(\(current\) => \(\{ aiCoachProQuota[\s\S]{0,400}return null;/);
      assert.match(photo, /await updatePreferences\(\(current\) => \(\{ aiCoachProQuota[\s\S]{0,400}status: 'failed'/);
      // One ledger, made once, given to both.
      const app = read('App.tsx');
      assert.match(app, /createCoachQuotaLedger\(\)/);
      assert.match(app, /createOnboardingFinishes\(\{\s*coachQuotaLedger,/);
      assert.match(read('src', 'app', 'renderAppContent.tsx'), /renderHomeScreens\(\{\s*coachQuotaLedger,/);
    },
  },
  {
    name: 'coach quota reservation: a request from a closure older than the last spend reads that spend',
    run() {
      // A build writes 24 -> 25 and gives its claim back; a request started
      // from a render before that write still passes 24 and took the 26th.
      const month = coachQuotaMonthStart(new Date());
      const ledger = createCoachQuotaLedger();
      const before = { monthStart: month, used: PRO_COACH_QUESTIONS_PER_MONTH - 1 };
      assert.equal(ledger.reserve(before), true);
      const written = ledger.record(before);
      assert.equal(written.used, PRO_COACH_QUESTIONS_PER_MONTH);
      ledger.release();
      assert.equal(ledger.reserve(before), false, 'the stale snapshot is not the whole truth');
      // A new month starts over, whatever was written last month.
      const next = new Date();
      next.setMonth(next.getMonth() + 1, 1);
      assert.equal(ledger.reserve({ monthStart: coachQuotaMonthStart(next), used: 0 }, next), true);
    },
  },
  {
    name: 'coach quota reservation: every spend writes through the ledger, and the chat counts its own running builds',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
      const sites = read('src', 'app', 'renderHomeScreens.tsx') + read('src', 'app', 'onboardingFinishes.tsx');
      assert.doesNotMatch(sites, /aiCoachProQuota: recordCoachQuestion\(/);
      assert.equal((sites.match(/aiCoachProQuota: coachQuotaLedger\.record\(current\.aiCoachProQuota\)/g) || []).length, 3);
      // A chat question beside a running build cannot take the build's question.
      assert.match(read('src', 'screens', 'AICoachChatScreen.tsx'), /const canAsk = proUnlocked && questionsRemaining - composingIds\.length > 0;/);
    },
  },
];
