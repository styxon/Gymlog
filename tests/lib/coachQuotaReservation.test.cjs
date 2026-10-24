const assert = require('node:assert/strict');

const { createCoachQuotaLedger, coachQuotaMonthStart, PRO_COACH_QUESTIONS_PER_MONTH } = require('../../.test-dist/lib/aiCoachQuota.js');

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
      assert.match(app, /renderHomeScreens\(\{\s*coachQuotaLedger,/);
    },
  },
];
