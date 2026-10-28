const assert = require('node:assert/strict');

const {
  FREE_RECORD_MONTHS,
  FREE_TREND_MONTHS,
  isRecordLocked,
} = require('../../src/lib/historyWindow');
const { PRO_LIVE_BENEFITS } = require('../../src/lib/proBenefits');

const NOW = new Date(2026, 7, 6, 12, 0, 0, 0);

function iso(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

module.exports = [
  {
    name: 'the free record window is three months, and matches the charts',
    run() {
      assert.equal(FREE_RECORD_MONTHS, 3);
      // Two different free depths for two views of the same history is a rule
      // nobody can hold in their head.
      assert.equal(FREE_RECORD_MONTHS, FREE_TREND_MONTHS);

      assert.equal(isRecordLocked(iso(2026, 8, 1), false, NOW), false, 'this month');
      assert.equal(isRecordLocked(iso(2026, 5, 10), false, NOW), false, 'inside the window');
      assert.equal(isRecordLocked(iso(2026, 5, 5), false, NOW), true, 'a day past the cutoff');
      assert.equal(isRecordLocked(iso(2024, 1, 1), false, NOW), true, 'years back');
    },
  },
  {
    name: 'Pro locks nothing, and an unreadable date locks nothing either',
    run() {
      assert.equal(isRecordLocked(iso(2019, 1, 1), true, NOW), false, 'Pro reads all of it');
      // Locking on a parse failure would hide a record set yesterday. A date
      // that cannot be read cannot be shown to be old.
      assert.equal(isRecordLocked('not-a-date', false, NOW), false);
      assert.equal(isRecordLocked('', false, NOW), false);
    },
  },
  {
    name: 'the Pro page claims the record window, and names the gate enforcing it',
    run() {
      const claim = PRO_LIVE_BENEFITS.find(
        (benefit) => benefit.titleKey === 'pro.v2.read.records.t',
      );
      assert.ok(claim, 'the benefit is sold on the Pro page');
      // The gate names a real module. A benefit whose gate does not exist is
      // the exact failure PRO_LIVE_BENEFITS was built to prevent.
      assert.equal(claim.gate, 'isRecordLocked');
      assert.equal(typeof isRecordLocked, 'function');
    },
  },
];
