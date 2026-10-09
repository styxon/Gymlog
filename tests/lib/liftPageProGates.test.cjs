const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
setNumberLanguage('en');

const {
  buildExerciseSheetHistory,
  gateExerciseSheetHistory,
} = require('../../.test-dist/lib/exerciseSheetHistory.js');
const { isLiftBestLocked, liftBestPerformedAt } = require('../../.test-dist/lib/liftBestGate.js');
const { isRecordLocked, isSetLogLocked } = require('../../.test-dist/lib/historyWindow.js');

/*
 * The exercise sheet's History tab and the exercise page read the lift's whole
 * log. Two Pro promises reach them: the per-lift set log, and the figure of a
 * record older than the free window. Both were free there (hunt, 2026-10-09).
 * Owner decision 2026-10-09: lock them for Free, the way Progress does.
 */

const NOW = new Date(2026, 9, 9, 12, 0, 0, 0);
const monthsAgo = (months, day = 0) => {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - months);
  d.setDate(d.getDate() - day);
  return d.toISOString();
};
const session = (performedAt, sets) => ({
  performedAt,
  sets: sets.map(([loadKg, reps]) => ({ loadKg, reps })),
});

/** Ten sessions from eight months ago, getting heavier; the heaviest is the newest. */
function oldLift() {
  return Array.from({ length: 10 }).map((_, i) =>
    session(monthsAgo(8 - Math.floor(i / 2), i % 2), [
      [100 + i * 5, 5],
      [100 + i * 5, 4],
    ]),
  );
}

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');

module.exports = [
  {
    name: 'Free: the sheet keeps the curve and today, locks the earlier rows and an old best',
    run() {
      // A best from eight months ago, then lighter sessions: the record is old.
      const past = [
        session(monthsAgo(8), [[145, 5]]),
        session(monthsAgo(5), [[120, 5], [120, 4]]),
        session(monthsAgo(4), [[125, 5]]),
        session(monthsAgo(1), [[130, 5]]),
      ].reverse();
      const today = session(NOW.toISOString(), [[80, 8]]);
      const open = buildExerciseSheetHistory(past, today, 'en');
      const free = gateExerciseSheetHistory(open, false, NOW);

      assert.equal(isSetLogLocked(false), true, 'the gate this leans on');
      assert.equal(isRecordLocked(monthsAgo(8), false, NOW), true, 'the record is outside the window');

      // The sets behind earlier sessions: locked. Today's own sets: not.
      assert.deepEqual(free.rows.map((row) => row.isToday), [true]);
      assert.equal(free.lockedSessionCount, 4);
      // The figure of the locked record: withheld, not merely hidden by the screen.
      assert.equal(free.bestLocked, true);
      assert.equal(free.bestSetLabel, null);
      assert.equal(free.estimatedOneRepMaxKg, null);
      // The curve and the count are free in both tiers.
      assert.deepEqual(free.bars, open.bars);
      assert.equal(free.sessionCount, open.sessionCount);
      // Nothing of the locked rows survives anywhere in the object.
      assert.doesNotMatch(JSON.stringify(free), /145 kg|"145/);
    },
  },
  {
    name: 'Pro reads the sheet exactly as it was built',
    run() {
      const past = oldLift();
      const open = buildExerciseSheetHistory(past, session(NOW.toISOString(), [[60, 8]]), 'en');
      const pro = gateExerciseSheetHistory(open, true, NOW);
      assert.deepEqual(pro.rows, open.rows);
      assert.equal(pro.bestSetLabel, open.bestSetLabel);
      assert.equal(pro.estimatedOneRepMaxKg, open.estimatedOneRepMaxKg);
      assert.deepEqual(pro.bars, open.bars);
      assert.equal(pro.bestLocked, false);
      assert.equal(pro.lockedSessionCount, 0);
    },
  },
  {
    name: 'Free with a record inside the window still sees the figure; the earlier rows stay locked',
    run() {
      const past = [session(monthsAgo(1), [[100, 5]]), session(monthsAgo(2), [[90, 5]])];
      const open = buildExerciseSheetHistory(past, null, 'en');
      const free = gateExerciseSheetHistory(open, false, NOW);
      assert.equal(free.bestLocked, false);
      assert.equal(free.bestSetLabel, open.bestSetLabel);
      assert.equal(free.bestSetLabel, '100 kg × 5');
      assert.equal(free.estimatedOneRepMaxKg, open.estimatedOneRepMaxKg);
      assert.equal(free.rows.length, 0);
      assert.equal(free.lockedSessionCount, 2);
    },
  },
  {
    name: 'Free with only today on the sheet sees what they saw before, and nothing is locked',
    run() {
      const open = buildExerciseSheetHistory([], session(NOW.toISOString(), [[50, 10]]), 'en');
      const free = gateExerciseSheetHistory(open, false, NOW);
      assert.deepEqual(free.rows, open.rows);
      assert.equal(free.bestSetLabel, open.bestSetLabel);
      assert.equal(free.bestLocked, false);
      assert.equal(free.lockedSessionCount, 0);
      // An empty lift is the empty state, not a lock.
      const none = gateExerciseSheetHistory(buildExerciseSheetHistory([], null, 'en'), false, NOW);
      assert.equal(none.bestLocked, false);
      assert.equal(none.lockedSessionCount, 0);
      assert.equal(none.rows.length, 0);
    },
  },
  {
    name: 'a best matched again this month is still the old record: it is dated by the first session to reach it',
    run() {
      const past = [session(monthsAgo(9), [[140, 5]]), session(monthsAgo(1), [[140, 5]])];
      const open = buildExerciseSheetHistory(past, null, 'en');
      assert.equal(open.bestSetPerformedAt, monthsAgo(9));
      assert.equal(gateExerciseSheetHistory(open, false, NOW).bestLocked, true);
      // Beaten this month: the record moves into the window and opens.
      const beaten = buildExerciseSheetHistory([...past, session(monthsAgo(0, 3), [[142.5, 5]])], null, 'en');
      assert.equal(gateExerciseSheetHistory(beaten, false, NOW).bestLocked, false);
    },
  },
  {
    name: 'the exercise page: the personal best is locked for Free when it is older than the window',
    run() {
      const log = (performedAt, weight, reps) => ({ performedAt, weight, repsPerSet: reps });
      const logs = [
        log(monthsAgo(0, 2), 100, [5, 5]),
        log(monthsAgo(1), 105, [5, 5]),
        log(monthsAgo(7), 140, [5, 3]),
      ];
      assert.equal(liftBestPerformedAt(logs, 'weight'), monthsAgo(7));
      assert.equal(isLiftBestLocked(logs, 'weight', false, NOW), true, 'Free, record 7 months old');
      assert.equal(isLiftBestLocked(logs, 'weight', true, NOW), false, 'Pro reads it');
      // The best is recent: nothing changes for Free.
      assert.equal(isLiftBestLocked(logs.slice(0, 2), 'weight', false, NOW), false);
      // No log, no lock.
      assert.equal(isLiftBestLocked([], 'weight', false, NOW), false);
      // The same weight set again later: the first session is the record.
      const matched = [log(monthsAgo(0, 1), 140, [5]), ...logs];
      assert.equal(liftBestPerformedAt(matched, 'weight'), monthsAgo(7));
    },
  },
  {
    name: 'the exercise page locks the unloaded and the minutes figures by the session that set them',
    run() {
      const bodyweight = [
        { performedAt: monthsAgo(0, 1), weight: 0, repsPerSet: [8, 8] },
        { performedAt: monthsAgo(6), weight: 0, repsPerSet: [12, 12, 10] },
      ];
      assert.equal(liftBestPerformedAt(bodyweight, 'reps'), monthsAgo(6));
      assert.equal(isLiftBestLocked(bodyweight, 'reps', false, NOW), true);
      assert.equal(isLiftBestLocked(bodyweight, 'reps', true, NOW), false);
      const bike = [
        { performedAt: monthsAgo(0, 1), weight: 0, repsPerSet: [20] },
        { performedAt: monthsAgo(5), weight: 0, repsPerSet: [45] },
      ];
      assert.equal(liftBestPerformedAt(bike, 'minutes'), monthsAgo(5));
      assert.equal(isLiftBestLocked(bike, 'minutes', false, NOW), true);
      assert.equal(isLiftBestLocked(bike.slice(0, 1), 'minutes', false, NOW), false);
    },
  },
  {
    name: 'the screens read the gates: sheet history is gated in the player, the page asks isLiftBestLocked',
    run() {
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      // Every history the sheet is handed goes through the gate, closed or open.
      assert.equal((player.match(/gateExerciseSheetHistory\(/g) ?? []).length, 2);
      assert.doesNotMatch(player, /return buildExerciseSheetHistory\(/);
      assert.match(player, /proUnlocked = false,/, 'unset reads as Free');
      assert.match(player, /onOpenPro=\{onOpenPro\}/);

      const sheet = read('src', 'components', 'ExerciseSheet.tsx');
      // The sheet cannot be handed an ungated history.
      assert.match(sheet, /history: GatedExerciseSheetHistory;/);
      assert.match(sheet, /history\.lockedSessionCount > 0/);
      assert.match(sheet, /history\.bestLocked/);

      const page = read('src', 'screens', 'ExerciseDetailScreen.tsx');
      assert.match(page, /isLiftBestLocked\(/);
      assert.match(page, /proUnlocked = false,/);

      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.equal((tab.match(/onOpenPro=\{\(\) => navigate\(\{ tab: 'profile', screen: 'premium' \}\)\}/g) ?? []).length, 2);
      // Inside each element's own props, not anywhere later in the file.
      const props = (tag) => tab.slice(tab.indexOf(tag), tab.indexOf('\n      />', tab.indexOf(tag)));
      assert.match(props('<ExerciseDetailScreen'), /proUnlocked=\{proUnlocked\}/);
      assert.match(props('<GuidedPlayerScreen'), /proUnlocked=\{proUnlocked\}/);
    },
  },
  {
    name: 'the lock words read in both languages',
    run() {
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal(i18n.split(`'guided.sheet.setsLocked':`).length - 1, 2);
    },
  },
];
