const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getMilestoneFacts } = require('../../.test-dist/lib/milestoneFacts.js');
const { recordSetsOfLog } = require('../../.test-dist/lib/personalRecords.js');
const { buildRepsLiftHistories } = require('../../.test-dist/lib/trainingHistory.js');
const { isHoldLogEntry } = require('../../.test-dist/lib/holdExercises.js');
const { getWorkedLogSets } = require('../../.test-dist/lib/exerciseLog.js');
const { getSessionTotals } = require('../../.test-dist/lib/sessionTotals.js');
const { buildExercisePrLookup } = require('../../.test-dist/lib/workoutCompletionSummary.js');
const { buildSessionAnalysis, describeVolumeChange } = require('../../.test-dist/lib/sessionAnalysis.js');
const { buildHistorySessionViewModel } = require('../../.test-dist/lib/historyView.js');
const { formatHomeStatValue } = require('../../.test-dist/lib/homeStatCards.js');
const { getOverviewVolumeTicks, formatOverviewVolumeTick } = require('../../.test-dist/lib/progressChartTicks.js');
const { buildWeightAxisTicks } = require('../../.test-dist/lib/bodyweightCard.js');
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');

/**
 * History and statistics numbers, bug hunt 9 (2026-10-09): what a count, a
 * total, a record and an axis label say must be what was lifted.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

const set = (o) => ({ orderIndex: 0, weight: 0, reps: 0, kind: 'working', outcome: 'completed', status: 'completed', ...o });
const log = (o) => ({
  id: `l${Math.random()}`,
  sessionId: 's1',
  exerciseNameSnapshot: 'Bench',
  weight: 0,
  repsPerSet: [],
  tracked: true,
  orderIndex: 0,
  ...o,
});
const session = (id, day, extra = {}) => ({
  id,
  workoutTemplateId: 't',
  workoutNameSnapshot: 'Core',
  performedAt: new Date(2026, 8, day, 18).toISOString(),
  totalVolumeKg: 0,
  ...extra,
});

function database(sessions, logs) {
  return { workoutSessions: sessions, exerciseLogs: logs, cardioSessions: [], bodyweightEntries: [], exerciseTemplates: [] };
}

/** Planks and a stretch: the player saves a hold as reps = seconds, weight 0, no unit. */
function holdSessions(count) {
  const sessions = [];
  const logs = [];
  for (let i = 0; i < count; i += 1) {
    const id = `s${i}`;
    sessions.push(session(id, 1 + i * 2));
    logs.push(log({
      id: `p${i}`, sessionId: id, exerciseNameSnapshot: 'Plank',
      sets: [set({ orderIndex: 0, reps: 60 }), set({ orderIndex: 1, reps: 60 }), set({ orderIndex: 2, reps: 60 })],
      repsPerSet: [60, 60, 60],
    }));
    logs.push(log({
      id: `c${i}`, sessionId: id, orderIndex: 1, exerciseNameSnapshot: "Child's Pose",
      sets: [set({ orderIndex: 0, reps: 90 }), set({ orderIndex: 1, reps: 90 })],
      repsPerSet: [90, 90],
    }));
  }
  return { sessions, logs };
}

module.exports = [
  // 6 ─ holds are seconds, not repetitions
  {
    name: 'a hold log is recognised by its name, a lift is not',
    run() {
      assert.equal(isHoldLogEntry({ exerciseNameSnapshot: 'Plank' }), true);
      assert.equal(isHoldLogEntry({ exerciseNameSnapshot: "Child's Pose" }), true);
      assert.equal(isHoldLogEntry({ exerciseNameSnapshot: 'Push-Up' }), false);
      assert.equal(isHoldLogEntry({ exerciseNameSnapshot: 'Bench Press' }), false);
      assert.equal(isHoldLogEntry(null), false);
      assert.equal(isHoldLogEntry({}), false);
    },
  },
  {
    name: 'seconds held are not repetitions: no lifetime reps, no reps milestone, no rep record, no rep trajectory',
    run() {
      const { sessions, logs } = holdSessions(10);
      const facts = getMilestoneFacts(database(sessions, logs), { currentWeekStreak: 0 }, []);
      assert.equal(facts.current.reps, 0, 'ten sessions of planks and stretches counted as repetitions');
      // The sets were done, and still count as sets.
      assert.equal(facts.current.sets, 50);
      for (const entry of logs) {
        assert.deepEqual(recordSetsOfLog(entry), [], `${entry.exerciseNameSnapshot} offered a rep record`);
      }
      assert.deepEqual(buildRepsLiftHistories(sessions, logs), []);
    },
  },
  {
    name: 'a bodyweight lift still counts its repetitions, records and trajectory',
    run() {
      const sessions = [session('a', 1), session('b', 3)];
      const logs = [
        log({ id: 'a1', sessionId: 'a', exerciseNameSnapshot: 'Push-Up', sets: [set({ reps: 10 }), set({ orderIndex: 1, reps: 10 })], repsPerSet: [10, 10] }),
        log({ id: 'b1', sessionId: 'b', exerciseNameSnapshot: 'Push-Up', sets: [set({ reps: 12 }), set({ orderIndex: 1, reps: 12 })], repsPerSet: [12, 12] }),
      ];
      const facts = getMilestoneFacts(database(sessions, logs), { currentWeekStreak: 0 }, []);
      assert.equal(facts.current.reps, 44);
      assert.deepEqual(recordSetsOfLog(logs[1]), [{ weight: 0, reps: 12 }, { weight: 0, reps: 12 }]);
      const histories = buildRepsLiftHistories(sessions, logs);
      assert.deepEqual(histories.map((lift) => lift.name), ['Push-Up']);
    },
  },

  // 7 ─ a drop set is work
  {
    name: 'drop sets count in sets and volume beside the working sets, warm-ups and undone sets do not',
    run() {
      const entry = log({
        sets: [
          set({ orderIndex: 0, weight: 40, reps: 10, kind: 'warmup' }),
          set({ orderIndex: 1, weight: 100, reps: 5 }),
          set({ orderIndex: 2, weight: 100, reps: 5 }),
          set({ orderIndex: 3, weight: 80, reps: 8, kind: 'drop' }),
          set({ orderIndex: 4, weight: 60, reps: 10, kind: 'drop' }),
          set({ orderIndex: 5, weight: 100, reps: 0, status: 'pending', outcome: null }),
        ],
        weight: 100,
        repsPerSet: [5, 5],
      });
      assert.equal(getWorkedLogSets(entry).length, 4);
      const totals = getSessionTotals([entry]);
      assert.equal(totals.setsCompleted, 4);
      assert.equal(totals.totalVolumeKg, 100 * 5 * 2 + 80 * 8 + 60 * 10);
      // A record still reads the working sets: a drop set is not the lift's top set.
      assert.deepEqual(recordSetsOfLog(entry), [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }]);
      // The lifetime set count agrees with History.
      const facts = getMilestoneFacts(database([session('s1', 1)], [entry]), { currentWeekStreak: 0 }, []);
      assert.equal(facts.current.sets, 4);
    },
  },
  {
    name: 'a log of drop sets only still counts, and a skipped log counts nothing',
    run() {
      const dropsOnly = log({ sets: [set({ weight: 80, reps: 8, kind: 'drop' }), set({ orderIndex: 1, weight: 60, reps: 10, kind: 'drop' })], weight: 80, repsPerSet: [8, 10] });
      assert.equal(getSessionTotals([dropsOnly]).setsCompleted, 2);
      assert.equal(getSessionTotals([{ ...dropsOnly, skipped: true }]).setsCompleted, 0);
    },
  },

  // 35 ─ a log from before repsUnit existed is read as minutes everywhere
  {
    name: 'an old cardio log with a level in the weight column adds no volume and no PR set',
    run() {
      const old = log({
        id: 'o', sessionId: 's1', exerciseNameSnapshot: 'Stairmaster',
        sets: [set({ weight: 8, reps: 20 })], weight: 8, repsPerSet: [20],
      });
      assert.equal(getSessionTotals([old]).totalVolumeKg, 0);
      assert.deepEqual(recordSetsOfLog(old), []);
      const lookup = buildExercisePrLookup({
        exerciseLogs: [old],
        workoutSessions: [{ id: 's1', performedAt: new Date().toISOString(), workoutNameSnapshot: 'x', workoutTemplateId: 't' }],
        exerciseTemplates: [],
      });
      assert.deepEqual(lookup.byName, {});
    },
  },
  {
    name: 'a lift that is not minutes keeps its volume and its PR',
    run() {
      const bench = log({ id: 'b', sets: [set({ weight: 80, reps: 5 })], weight: 80, repsPerSet: [5] });
      assert.equal(getSessionTotals([bench]).totalVolumeKg, 400);
      const lookup = buildExercisePrLookup({
        exerciseLogs: [bench],
        workoutSessions: [{ id: 's1', performedAt: new Date().toISOString(), workoutNameSnapshot: 'x', workoutTemplateId: 't' }],
        exerciseTemplates: [],
      });
      assert.deepEqual(lookup.byName.bench, { weight: 80, reps: 5 });
    },
  },

  // 34 ─ session analysis counts what was done and prints each set's own weight
  {
    name: 'session analysis counts the exercises History counts, and prints a ramp as a range',
    run() {
      const sess = {
        id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'Push',
        performedAt: new Date(2026, 9, 8, 18).toISOString(),
        startedAt: new Date(2026, 9, 8, 17).toISOString(),
      };
      const bench = log({
        id: 'a', sessionId: 's1',
        sets: [set({ orderIndex: 0, weight: 60, reps: 8 }), set({ orderIndex: 1, weight: 80, reps: 5 }), set({ orderIndex: 2, weight: 100, reps: 3 })],
        weight: 100, repsPerSet: [8, 5, 3],
      });
      const swapped = log({ id: 'b', sessionId: 's1', orderIndex: 1, exerciseNameSnapshot: 'Dips', swappedFrom: 'Fly', sets: [set({ status: 'pending', outcome: null })] });
      const note = log({ id: 'c', sessionId: 's1', orderIndex: 2, exerciseNameSnapshot: 'Curl', notes: 'sore', sets: [set({ status: 'pending', outcome: null })] });
      const logs = [bench, swapped, note];
      const analysis = buildSessionAnalysis({ sessionId: 's1', sessions: [sess], logs, language: 'en' });
      const setsKey = analysis.keyNumbers.find((key) => key.labelKey === 'analysis.key.sets');
      assert.equal(setsKey.value, '3');
      assert.match(setsKey.sub, /over 1 /, 'the unperformed rows were counted as exercises');
      assert.equal(buildHistorySessionViewModel(sess, logs).exerciseCount, 1);
      assert.equal(analysis.exercises.length, 1);
      assert.equal(analysis.exercises[0].detail, '3 × 8/5/3 · 60–100 kg');
      assert.equal(analysis.exercises[0].topSet, '100 kg × 3');
    },
  },
  {
    name: 'session analysis: a lift at one weight keeps the single weight, and drop sets are in the row',
    run() {
      const sess = { id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'Push', performedAt: new Date(2026, 9, 8, 18).toISOString() };
      const flat = log({ sessionId: 's1', sets: [set({ weight: 100, reps: 5 }), set({ orderIndex: 1, weight: 100, reps: 5 })], weight: 100, repsPerSet: [5, 5] });
      const flatRow = buildSessionAnalysis({ sessionId: 's1', sessions: [sess], logs: [flat], language: 'en' }).exercises[0];
      assert.equal(flatRow.detail, '2 × 5 · 100 kg');

      const withDrops = log({
        sessionId: 's1',
        sets: [set({ weight: 100, reps: 5 }), set({ orderIndex: 1, weight: 80, reps: 8, kind: 'drop' })],
        weight: 100, repsPerSet: [5],
      });
      const analysis = buildSessionAnalysis({ sessionId: 's1', sessions: [sess], logs: [withDrops], language: 'en' });
      assert.equal(analysis.keyNumbers.find((key) => key.labelKey === 'analysis.key.sets').value, '2');
      assert.equal(analysis.exercises[0].detail, '2 × 5/8 · 80–100 kg');
    },
  },

  // 36 ─ the volume axis
  {
    name: 'volume axis: labels sit on the gridlines they name, from 751 kg up through a tonne',
    run() {
      for (const max of [760, 800, 960, 1000]) {
        const ticks = getOverviewVolumeTicks(max);
        assert.deepEqual(ticks, [0, 250, 500, 750, 1000], `max ${max}`);
        assert.deepEqual(
          ticks.map((tick) => formatOverviewVolumeTick(tick, ticks)),
          ['0 t', '0,25 t', '0,5 t', '0,75 t', '1 t'],
          `max ${max}`,
        );
      }
    },
  },
  {
    name: 'volume axis: whole-hundred ticks keep one decimal and big tonnes none',
    run() {
      const a = getOverviewVolumeTicks(1900);
      assert.deepEqual(a.map((tick) => formatOverviewVolumeTick(tick, a)), ['0 t', '0,5 t', '1 t', '1,5 t', '2 t']);
      const b = getOverviewVolumeTicks(2400);
      assert.deepEqual(b.map((tick) => formatOverviewVolumeTick(tick, b)), ['0 t', '1 t', '2 t', '3 t']);
      const small = getOverviewVolumeTicks(300);
      assert.ok(small.every((tick) => /^\d+ kg$/.test(formatOverviewVolumeTick(tick, small))));
    },
  },

  // 37 ─ the weight axis keeps clear air above and below the data
  {
    name: 'weight axis: the heaviest and lightest weigh-ins never sit on an outer gridline',
    run() {
      const known = [[139.7, 140.2], [173.2, 172.7], [187.6, 188.2]];
      const series = [...known];
      // Every pair of one-decimal weights 50-120 kg up to 3 kg apart, the range
      // the card is used in; floating-point sums put about 0.5 % of them on a line.
      for (let a = 500; a <= 1200; a += 1) {
        for (let d = 0; d <= 30; d += 1) {
          series.push([a / 10, (a + d) / 10]);
        }
      }
      const offenders = [];
      for (const values of series) {
        const ticks = buildWeightAxisTicks(values);
        const max = Math.max(...values);
        const min = Math.min(...values);
        if (!(max < ticks[0] - 1e-9) || !(min > ticks[ticks.length - 1] + 1e-9)) {
          offenders.push(`${JSON.stringify(values)} -> ${ticks[0]}..${ticks[ticks.length - 1]}`);
        }
      }
      assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} series sit on an outer gridline`);
    },
  },

  // 52 ─ the volume change is a percentage like every other
  {
    name: 'the volume change is written by formatPercent: Finnish spaces the sign, English does not',
    run() {
      assert.deepEqual(describeVolumeChange(8, 'fi'), { kind: 'up', text: '+8 %' });
      assert.deepEqual(describeVolumeChange(-12, 'fi'), { kind: 'down', text: '-12 %' });
      assert.deepEqual(describeVolumeChange(8, 'en'), { kind: 'up', text: '+8%' });
      assert.deepEqual(describeVolumeChange(-8, 'en'), { kind: 'down', text: '-8%' });
      const source = read('src', 'lib', 'sessionAnalysis.ts');
      assert.doesNotMatch(source, /\$\{percent\}%/, 'a percent is written by hand again');
      assert.match(source, /formatPercent\(percent, language\)/);
    },
  },

  // 11 ─ weights on the 1.25 kg grid are not rounded to a tenth
  {
    name: 'a 1.25 kg step is printed as it was lifted: Home stat cards and session analysis',
    run() {
      setNumberLanguage('fi');
      try {
        assert.equal(formatHomeStatValue(61.25), '61,25');
        assert.equal(formatHomeStatValue(63.75), '63,75');
        assert.equal(formatHomeStatValue(61.3), '61,3');
        assert.equal(formatHomeStatValue(60), '60');

        const sess = (id, day) => ({ id, workoutTemplateId: 't', workoutNameSnapshot: 'Legs', performedAt: new Date(2026, 8, day, 18).toISOString() });
        const logs = [
          log({ id: 'q1', sessionId: 'a', exerciseNameSnapshot: 'Squat', sets: [set({ weight: 60, reps: 5 }), set({ orderIndex: 1, weight: 60, reps: 5 })], weight: 60, repsPerSet: [5, 5] }),
          log({ id: 'q2', sessionId: 'b', exerciseNameSnapshot: 'Squat', sets: [set({ weight: 61.25, reps: 5 }), set({ orderIndex: 1, weight: 61.25, reps: 5 })], weight: 61.25, repsPerSet: [5, 5] }),
        ];
        const analysis = buildSessionAnalysis({ sessionId: 'b', sessions: [sess('a', 1), sess('b', 8)], logs, language: 'fi' });
        const row = analysis.exercises[0];
        assert.match(row.detail, /61,25 kg/);
        assert.equal(row.trendLabel, '+1,25 kg');
        assert.equal(analysis.keyNumbers.find((key) => key.labelKey === 'analysis.key.topSet').value, '61,25 kg × 5');
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'a 1.25 kg step is printed as it was lifted: the PR card, Records and the set-log sheet round to hundredths',
    run() {
      // The call sites are components; the rounding in front of removeTrailingZeros is what decided
      // the digits, so it is read from the source.
      const TENTHS = /Math\.round\([^)]*\* 10\) \/ 10|\.toFixed\(1\)/;
      for (const [file, fn] of [
        [['src', 'screens', 'RecordsScreen.tsx'], 'function decimal('],
        [['src', 'components', 'SetLogSheet.tsx'], 'function decimal('],
      ]) {
        const source = read(...file);
        const body = source.slice(source.indexOf(fn), source.indexOf('\n}\n', source.indexOf(fn)));
        assert.ok(body.length > 0, `${file.join('/')}: ${fn} not found`);
        assert.doesNotMatch(body, TENTHS, `${file.join('/')} rounds a weight to a tenth`);
        assert.match(body, /Math\.round\(value \* 100\) \/ 100/);
      }
      const completion = read('src', 'screens', 'WorkoutCompletionScreen.tsx');
      const prNote = completion.slice(completion.indexOf('function formatPrNote('), completion.indexOf('export function WorkoutCompletionScreen'));
      assert.doesNotMatch(prNote, TENTHS, 'the PR note rounds a weight to a tenth');
      assert.match(prNote, /delta\.toFixed\(2\)/);
      assert.match(prNote, /pr\.performedWeightKg\.toFixed\(2\)/);
    },
  },
];
