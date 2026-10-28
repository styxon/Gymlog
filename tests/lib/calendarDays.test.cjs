const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
const calendarDays = require('../../.test-dist/lib/calendarDays.js');
const completedSessions = require('../../.test-dist/lib/completedSessions.js');
const recoverySheet = require('../../.test-dist/lib/recoverySheet.js');

const { startOfLocalDay, dayStartPlus, addCalendarDays, localDateKey } = calendarDays;

module.exports = [
  {
    name: 'calendarDays: ordinary days resolve to local midnight and 24-hour steps',
    run() {
      const noon = new Date(2026, 5, 10, 12, 30);
      assert.equal(startOfLocalDay(noon), new Date(2026, 5, 10).getTime());
      assert.equal(dayStartPlus(noon, 1), new Date(2026, 5, 11).getTime());
      assert.equal(dayStartPlus(noon, -10), new Date(2026, 4, 31).getTime());
      assert.equal(addCalendarDays(noon, 3), new Date(2026, 5, 13, 12, 30).getTime());
      assert.equal(localDateKey(noon), '2026-06-10');
      assert.equal(localDateKey(noon.toISOString()), '2026-06-10');
    },
  },
  {
    name: 'calendarDays: invalid input stays invalid instead of throwing',
    run() {
      assert.ok(Number.isNaN(startOfLocalDay(new Date('nope'))));
      assert.equal(localDateKey('nope'), '');
      assert.ok(Number.isNaN(addCalendarDays('nope', 1)));
    },
  },
  {
    name: 'calendarDays: stepping across a Helsinki clock change lands on local midnight',
    run() {
      withHelsinkiClocks(() => {
        // 29 March 2026 is a 23-hour day, 25 October a 25-hour one.
        const beforeSpring = new Date(2026, 2, 28, 23, 30);
        const afterSpring = dayStartPlus(beforeSpring, 2);
        assert.equal(afterSpring, new Date(2026, 2, 30).getTime());
        assert.equal(new Date(afterSpring).getHours(), 0);
        assert.equal(dayStartPlus(beforeSpring, 1) - startOfLocalDay(beforeSpring), 24 * 3600 * 1000);
        assert.equal(dayStartPlus(beforeSpring, 2) - dayStartPlus(beforeSpring, 1), 23 * 3600 * 1000);
        assert.notEqual(afterSpring, startOfLocalDay(beforeSpring) + 2 * 24 * 3600 * 1000);

        const beforeAutumn = new Date(2026, 9, 24, 23, 30);
        const afterAutumn = dayStartPlus(beforeAutumn, 2);
        assert.equal(afterAutumn, new Date(2026, 9, 26).getTime());
        assert.equal(dayStartPlus(beforeAutumn, 2) - dayStartPlus(beforeAutumn, 1), 25 * 3600 * 1000);

        // addCalendarDays keeps the wall-clock time across the change.
        const evening = new Date(2026, 9, 24, 18, 15);
        const later = new Date(addCalendarDays(evening, 3));
        assert.deepEqual([later.getDate(), later.getHours(), later.getMinutes()], [27, 18, 15]);

        // A session just after local midnight belongs to that local day, not UTC's.
        const lateNight = new Date(2026, 2, 30, 0, 20);
        assert.equal(localDateKey(lateNight), '2026-03-30');
        assert.equal(startOfLocalDay(lateNight), new Date(2026, 2, 30).getTime());
      });
    },
  },
  {
    name: 'calendarDays: the old import paths still resolve to the shared helpers',
    run() {
      assert.equal(completedSessions.localDateKey, localDateKey);
      assert.equal(recoverySheet.dayStartPlus, dayStartPlus);
    },
  },
];
