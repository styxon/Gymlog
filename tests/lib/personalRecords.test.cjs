const assert = require('node:assert/strict');

const {
  FRESH_RECORD_DAYS,
  groupRecordsByMonth,
  resolveRecord,
  resolveRecords,
  firstRecordDates,
} = require('../../src/lib/personalRecords');
const { weeklyTrainingStreak } = require('../../src/lib/trainingCalendar');

function at(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function entry(date, sets) {
  return { performedAt: at(...date).toISOString(), sets };
}

const NOW = at(2026, 8, 6);

module.exports = [
  {
    name: 'the previous record is the one that actually stood before it',
    run() {
      // 80 -> 85 -> 82.5. The runner-up in a sorted list is 82.5, but the
      // record that 85 beat was 80, and that is what "+5 kg" has to mean.
      const record = resolveRecord(
        {
          key: 'bench',
          name: 'Penkkipunnerrus',
          entries: [
            entry([2026, 6, 1], [{ weight: 80, reps: 5 }]),
            entry([2026, 7, 1], [{ weight: 85, reps: 3 }]),
            entry([2026, 8, 1], [{ weight: 82.5, reps: 4 }]),
          ],
        },
        'weight',
        NOW,
      );
      assert.equal(record.value, 85);
      assert.equal(record.previous, 80);
      assert.equal(record.companion, 3, 'the reps at the record set');
      assert.equal(new Date(record.performedAt).getMonth(), 6, 'the day it was set, not the latest day');
      // The lift first held a record with its first set, and that day never
      // moves — performedAt follows the standing best, firstAt does not.
      assert.equal(new Date(record.firstAt).getMonth(), 5);
    },
  },
  {
    name: 'firstRecordDates: one fixed day per lift, the earliest of its kinds',
    run() {
      const bench = {
        key: 'bench',
        name: 'Penkkipunnerrus',
        entries: [entry([2026, 6, 1], [{ weight: 80, reps: 5 }]), entry([2026, 8, 1], [{ weight: 90, reps: 8 }])],
      };
      const row = { key: 'row', name: 'Kulmasoutu', entries: [entry([2026, 7, 10], [{ weight: 60, reps: 8 }])] };
      const records = {
        weight: resolveRecords([bench, row], 'weight', NOW),
        reps: resolveRecords([bench, row], 'reps', NOW),
        volume: resolveRecords([bench, row], 'volume', NOW),
      };
      const dates = firstRecordDates(records).map((iso) => new Date(iso).getMonth()).sort();
      // Two lifts, two dates: bench in June (its first set, though every
      // current best was set in August), row in July.
      assert.deepEqual(dates, [5, 6]);
      assert.equal(records.weight.find((record) => record.key === 'bench').performedAt, records.volume.find((record) => record.key === 'bench').performedAt);
      assert.equal(new Date(records.weight.find((record) => record.key === 'bench').performedAt).getMonth(), 7);
    },
  },
  {
    name: 'a first record has no previous, and no delta to claim',
    run() {
      const record = resolveRecord(
        { key: 'row', name: 'Kulmasoutu', entries: [entry([2026, 8, 1], [{ weight: 60, reps: 8 }])] },
        'weight',
        NOW,
      );
      assert.equal(record.value, 60);
      assert.equal(record.previous, null);
    },
  },
  {
    name: 'three kinds, because a bodyweight lift has no weight record',
    run() {
      const pullups = {
        key: 'pullup',
        name: 'Leuanveto',
        entries: [
          entry([2026, 7, 1], [{ weight: 0, reps: 8 }]),
          entry([2026, 8, 1], [{ weight: 0, reps: 12 }]),
        ],
      };
      // Nothing was ever loaded, so there is no heaviest set to report.
      assert.equal(resolveRecord(pullups, 'weight', NOW), null);

      const reps = resolveRecord(pullups, 'reps', NOW);
      assert.equal(reps.value, 12);
      assert.equal(reps.previous, 8);
      assert.equal(reps.companion, null, 'no weight to show for a bodyweight set');

      // Volume is the whole session on that lift, which is what makes a
      // session hard in a way one set cannot show.
      const volume = resolveRecord(
        {
          key: 'squat',
          name: 'Takakyykky',
          entries: [
            entry([2026, 7, 1], [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }]),
            entry([2026, 8, 1], [{ weight: 90, reps: 8 }, { weight: 90, reps: 8 }]),
          ],
        },
        'volume',
        NOW,
      );
      assert.equal(volume.value, 1440, 'the lighter, higher-rep session did more work');
      assert.equal(volume.previous, 1000);
    },
  },
  {
    name: 'freshness is a window, and the list leads with what is recent',
    run() {
      const sources = [
        { key: 'a', name: 'Vanha', entries: [entry([2026, 1, 5], [{ weight: 200, reps: 1 }])] },
        { key: 'b', name: 'Tuore', entries: [entry([2026, 8, 4], [{ weight: 50, reps: 5 }])] },
      ];
      const records = resolveRecords(sources, 'weight', NOW);

      // Sorted by date, not by kilos: ordered by size it is a list of which
      // lifts are heaviest, which the reader already knows.
      assert.deepEqual(records.map((record) => record.name), ['Tuore', 'Vanha']);
      assert.equal(records[0].fresh, true);
      assert.equal(records[1].fresh, false, `set more than ${FRESH_RECORD_DAYS} days ago`);
    },
  },
  {
    name: 'nothing logged is no records, not zeroes',
    run() {
      assert.deepEqual(resolveRecords([], 'weight', NOW), []);
      assert.equal(
        resolveRecord({ key: 'x', name: 'X', entries: [entry([2026, 8, 1], [])] }, 'weight', NOW),
        null,
      );
      // A corrupt timestamp cannot be placed on a timeline; dropping that one
      // entry beats sorting the whole lift by NaN.
      const record = resolveRecord(
        {
          key: 'x',
          name: 'X',
          entries: [
            { performedAt: 'not-a-date', sets: [{ weight: 999, reps: 1 }] },
            entry([2026, 8, 1], [{ weight: 60, reps: 5 }]),
          ],
        },
        'weight',
        NOW,
      );
      assert.equal(record.value, 60);
    },
  },
  {
    name: 'records group by the month they were set',
    run() {
      const groups = groupRecordsByMonth([
        { key: 'a', name: 'A', bodyPart: null, kind: 'weight', value: 1, companion: null, performedAt: at(2026, 8, 4).toISOString(), previous: null, fresh: true },
        { key: 'b', name: 'B', bodyPart: null, kind: 'weight', value: 1, companion: null, performedAt: at(2026, 7, 29).toISOString(), previous: null, fresh: false },
        { key: 'c', name: 'C', bodyPart: null, kind: 'weight', value: 1, companion: null, performedAt: at(2026, 8, 1).toISOString(), previous: null, fresh: true },
      ]);
      assert.equal(groups.length, 2);
      assert.equal(groups[0].month, 7, 'August first');
      assert.equal(groups[0].records.length, 2);
      assert.equal(groups[1].month, 6);
    },
  },
  {
    name: 'an empty current week does not break the streak',
    run() {
      // NOW is Thursday 6 August 2026. The week is not over, and a counter
      // that resets every Monday morning is a counter nobody trusts.
      const weeks = [at(2026, 7, 22), at(2026, 7, 29), at(2026, 8, 3)];
      const sessions = weeks.map((date, index) => ({ id: `s${index}`, performedAt: date.toISOString() }));
      assert.equal(weeklyTrainingStreak(sessions, [], NOW), 3);

      const withoutThisWeek = sessions.slice(0, 2);
      assert.equal(weeklyTrainingStreak(withoutThisWeek, [], NOW), 2, 'the unfinished week is not counted against');

      // A gap ends it.
      assert.equal(
        weeklyTrainingStreak(
          [{ id: 'old', performedAt: at(2026, 6, 1).toISOString() }],
          [],
          NOW,
        ),
        0,
      );
      assert.equal(weeklyTrainingStreak([], [], NOW), 0);
    },
  },
  {
    /*
     * The Slack screenshot: 4.9. had 8×55, 6×60, 5×60, 4×60 and 9.9. had 8×55
     * and three 8×60s, and the PR badge sat on the 6×60 with "60 kg × 6 ·
     * 4.9." on the best-weight card. A better set on the same number is the
     * record set now — and the record before 60 is still 55, not 60.
     */
    name: 'a better set on the same number moves the record, not the record before it',
    run() {
      const sumo = {
        key: 'sumo',
        name: 'Sumomaastaveto',
        entries: [
          entry([2026, 8, 27], [{ weight: 55, reps: 8 }]),
          entry([2026, 9, 4], [
            { weight: 55, reps: 8 },
            { weight: 60, reps: 6 },
            { weight: 60, reps: 5 },
            { weight: 60, reps: 4 },
          ]),
          entry([2026, 9, 9], [
            { weight: 55, reps: 8 },
            { weight: 60, reps: 8 },
            { weight: 60, reps: 8 },
            { weight: 60, reps: 8 },
          ]),
        ],
      };
      const now = at(2026, 9, 20);
      const weight = resolveRecord(sumo, 'weight', now);
      assert.equal(weight.value, 60);
      assert.equal(weight.companion, 8, 'the record set is the 8 × 60, not the first 60');
      assert.equal(weight.performedAt.slice(0, 10), '2026-09-09');
      assert.equal(weight.previous, 55, 'the record before 60 is 55, whichever set holds 60');

      // Most reps in a set: 8, and at 60 kg rather than the 55 that came first.
      const reps = resolveRecord(sumo, 'reps', now);
      assert.equal(reps.value, 8);
      assert.equal(reps.companion, 60);
      assert.equal(reps.performedAt.slice(0, 10), '2026-09-09');

      // A worse set on the same number leaves the record where it is.
      const later = { ...sumo, entries: [...sumo.entries, entry([2026, 9, 15], [{ weight: 60, reps: 5 }])] };
      assert.equal(resolveRecord(later, 'weight', now).performedAt.slice(0, 10), '2026-09-09');

      // Volume has no better set on a tie: the same work later is not a new record.
      const flat = {
        key: 'flat',
        name: 'Flat',
        entries: [
          entry([2026, 9, 1], [{ weight: 50, reps: 10 }]),
          entry([2026, 9, 8], [{ weight: 25, reps: 10 }, { weight: 25, reps: 10 }]),
        ],
      };
      assert.equal(resolveRecord(flat, 'volume', now).performedAt.slice(0, 10), '2026-09-01');
    },
  },
];
