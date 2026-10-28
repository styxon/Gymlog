const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { weeklyTrainingStreak } = require('../../src/lib/trainingCalendar');
const { getCurrentWeekStreak, getMonthlyActivityCalendar, subtractCalendarMonths } = require('../../src/lib/completedSessions');
const { isRecordLocked } = require('../../src/lib/historyWindow');
const { sumMonthTrainingTotals } = require('../../src/lib/dashboard');
const { measurementUnitForKind } = require('../../src/lib/measurementKinds');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const i18n = read('src', 'lib', 'i18n.ts');
const bothLanguages = (key) =>
  assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} is missing one of its two languages`);

/** A run, as the database stores one. */
const run = (day) => ({
  id: `c${day}`,
  activityType: 'run',
  startedAt: new Date(2026, 8, day, 7, 0).toISOString(),
  endedAt: new Date(2026, 8, day, 7, 40).toISOString(),
  performedAt: new Date(2026, 8, day, 7, 40).toISOString(),
  durationSec: 2400,
  distanceKm: 6,
});

const cardioOnly = {
  workoutTemplates: [],
  exerciseTemplates: [],
  workoutPlans: [],
  exerciseLibrary: [],
  workoutSessions: [],
  exerciseLogs: [],
  cardioSessions: [run(16), run(17), run(18)],
  bodyweightEntries: [],
  measurementEntries: [],
};

/**
 * Numbers that disagreed with each other, or with the thing beside them —
 * audit round 3, 2026-09-19.
 */
module.exports = [
  {
    name: 'progress: the month counter and the streak count the runs the calendar marks',
    run() {
      const now = new Date(2026, 8, 19, 12, 0);
      // The contradiction: the calendar marks the days, the counter said none.
      const marked = getMonthlyActivityCalendar(cardioOnly, now)
        .weeks.flat()
        .filter((day) => day.inCurrentMonth && day.active).length;
      assert.equal(marked, 3, 'the calendar marks cardio days');

      // The streak beside it now counts the same activity Home's does. The
      // unfinished-week rule stays this function's own: it is deliberate, and
      // documented where it is written.
      assert.equal(weeklyTrainingStreak([], cardioOnly.cardioSessions, now), 1);
      assert.equal(getCurrentWeekStreak(cardioOnly, now), 1, 'and agrees with Home on this data');
      assert.equal(weeklyTrainingStreak([], [], now), 0);

      const screen = strip(read('src', 'screens', 'ProgressScreen.tsx'));
      assert.match(screen, /weeklyTrainingStreak\(workoutSessions, cardioSessions\)/);
      // The month card counts both, in the count and in the average duration —
      // through the widget's own month sum now, not a copy of it (dup sweep
      // 13, D2-10).
      assert.match(screen, /const totals = sumMonthTrainingTotals\(\s*workoutSessions,\s*getCanonicalCardioSessions\(\{ cardioSessions \}\),/);
      assert.match(screen, /sessions: totals\.workouts,/);
      assert.match(screen, /averageDuration: totals\.averageDurationMinutes,/);
      const totals = sumMonthTrainingTotals([], cardioOnly.cardioSessions, now);
      assert.equal(totals.workouts, marked, 'the counter counts the runs the calendar marks');
      // Volume stays strength-only: a run has no tonnage to add.
      assert.equal(totals.volumeKg, 0);
    },
  },
  {
    name: 'history: a reader who has only run is not told nothing is logged',
    run() {
      const screen = strip(read('src', 'screens', 'HistoryScreen.tsx'));
      // The gate read the lifted sessions alone, and the cardio section lives
      // inside the branch it skipped.
      assert.match(screen, /\{sessions\.length === 0 && cardioSessions\.length === 0 \? \(/);
      assert.doesNotMatch(screen, /\{sessions\.length === 0 \? \(/);
      // And "nothing matched your search" only when something was searched
      // for: with runs and no lifts, nothing was.
      assert.match(screen, /\{filteredSessions\.length === 0 && !filtersActive \? null : filteredSessions\.length \? \(/);
      // Nor a search card counting the lifted sessions: its "0 treeniä" sat
      // directly above the list of the reader's actual runs (CI review of
      // #147) — the same class of disagreement this batch is about.
      // The search card itself is gone (#bugs 2026-10-01), so it cannot count
      // anything at all.
      assert.doesNotMatch(screen, /styles\.browseCard/);
    },
  },
  {
    name: 'records: the free window steps by calendar month, like the charts it promises to match',
    run() {
      // In Helsinki time whatever the machine's zone: the dates below are the
      // reader's local days, and on a UTC runner this failed (#bugs 2026-10-01).
      withHelsinkiClocks(() => {
        // 31 May minus three months is 28 February, not 3 March — the raw
        // construction asked for 31 February and JavaScript answered next month.
        const now = new Date(2026, 4, 31, 12, 0);
        const raw = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        const calendar = subtractCalendarMonths(now, 3);
        assert.notEqual(raw.getMonth(), calendar.getMonth(), 'the two constructions must differ on the 31st');

        // A record from 2 March is inside three calendar months of 31 May.
        assert.equal(isRecordLocked('2026-03-02T10:00:00.000Z', false, now), false);
        assert.equal(isRecordLocked('2026-02-28T10:00:00.000Z', false, now), false);
        // And one genuinely older is still locked.
        assert.equal(isRecordLocked('2026-01-05T10:00:00.000Z', false, now), true);
        // Pro is never locked.
        assert.equal(isRecordLocked('2020-01-05T10:00:00.000Z', true, now), false);
      });

      const source = strip(read('src', 'lib', 'historyWindow.ts'));
      assert.match(source, /const cutoff = subtractCalendarMonths\(now, FREE_RECORD_MONTHS\);/);
      assert.doesNotMatch(source, /new Date\(now\.getFullYear\(\), now\.getMonth\(\) - FREE_RECORD_MONTHS/);
    },
  },
  {
    name: 'measurements: body fat is a percentage wherever it is entered, and on old rows too',
    run() {
      assert.equal(measurementUnitForKind('bodyfat'), '%');
      assert.equal(measurementUnitForKind('waist'), 'cm');

      // The reading the Progress tab wrote before this carries `cm`; the kind
      // decides the unit on load, so the coach stops being handed "20 cm".
      const { normalizeDatabase } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) =>
        requireDist('storage/database.js'),
      );
      const loaded = normalizeDatabase({
        measurementEntries: [
          { id: 'm1', kind: 'bodyfat', unit: 'cm', value: 20, recordedAt: '2026-09-01T10:00:00.000Z' },
          { id: 'm2', kind: 'waist', unit: 'in', value: 33, recordedAt: '2026-09-01T10:00:00.000Z' },
        ],
      });
      const byId = new Map(loaded.measurementEntries.map((entry) => [entry.id, entry]));
      assert.equal(byId.get('m1').unit, '%', 'a stored body-fat row is read as a percentage');
      // A length keeps whichever of cm and in it was stored with.
      assert.equal(byId.get('m2').unit, 'in');

      const screen = strip(read('src', 'screens', 'ProgressScreen.tsx'));
      assert.match(screen, /measurementUnitForKind\(selectedMeasureModel\.kind\)/);
      assert.doesNotMatch(screen, /onAddMeasurement\(selectedMeasureModel\.kind, value, 'cm'\)/);
    },
  },
  {
    name: 'exercise detail: a lift with no bar is measured in reps, not in 0 kg',
    run() {
      const screen = strip(read('src', 'screens', 'ExerciseDetailScreen.tsx'));
      // `bestWeight` is 0 for a pull-up, not null, so `!= null` printed "0 kg".
      assert.match(screen, /const unloaded = \(history\?\.bestWeight \?\? 0\) <= 0 && \(history\?\.bestReps \?\? 0\) > 0;/);
      assert.match(screen, /history\?\.bestReps === 1 \? 'exDetail\.bestRepsOne' : 'exDetail\.bestReps', \{\s+count: history\?\.bestReps \?\? 0,/);
      assert.match(screen, /history\?\.bestWeight != null && history\.bestWeight > 0/);
      // And the line plots the reps rather than a row of zeroes — counted the
      // way `bestReps` above it is counted. A raw sum over `log.sets` takes
      // warm-up sets too (a Hevy import writes each set's kind), so the line
      // could rise above the personal best printed over it (CI review of #147).
      assert.match(screen, /value: unloaded\s*\?\s*getComparableLogSets\(log\)\.reduce/);
      assert.doesNotMatch(screen, /\(log\.sets \?\? \[\]\)\.reduce/);
      // The unit follows the measure everywhere on the screen, not only on the
      // card: "33 toistoa" sat beside a trend reading "+12 kg" and a kg axis.
      // A bout of minutes says "min" in the same places (2026-10-06).
      assert.match(screen, /const unloadedUnit = minutesLift \? 'min' : t\(language, 'exDetail\.repsUnit'\);/);
      assert.match(screen, /\{unloaded \? unloadedUnit : unitPreference\}\{' '\}/);
      assert.match(screen, /unitLabel=\{unloaded \? unloadedUnit : unitPreference\}/);
      /*
       * Every line in the block, not the ones that were easy.
       *
       * `bestReps` is the highest SESSION total (`Math.max` over
       * `getTotalReps`), so "40 reps · raskain työsarja" named a set nobody
       * did; and the header over a reps-labelled chart still read "Työpaino"
       * (CI review of #147). Each sibling branches on the same flag.
       */
      assert.match(screen, /meta=\{t\(language, unloaded \? 'exDetail\.bestSession' : 'exDetail\.topSet'\)\}/);
      assert.match(screen, /t\(language, unloaded \? 'exDetail\.repsPerSession' : 'progress\.workingWeight'\)/);
      for (const key of ['exDetail.bestReps', 'exDetail.repsUnit', 'exDetail.bestSession', 'exDetail.repsPerSession']) {
        bothLanguages(key);
      }
    },
  },
];
