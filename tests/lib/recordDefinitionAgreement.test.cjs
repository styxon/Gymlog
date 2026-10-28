const assert = require('node:assert/strict');

const { buildCompletionCardsFromAdaptedSession } = require('../../src/app/workoutCompletionState');
const {
  buildExercisePrLookup,
  findLatestSessionPr,
} = require('../../src/lib/workoutCompletionSummary');
const { buildFreestyleFinish } = require('../../src/lib/emptyWorkoutSession');
const { resolveRecord } = require('../../src/lib/personalRecords');

/**
 * One record, everywhere.
 *
 * Until 2026-09-26 a "new record" meant two different things depending on
 * which screen said it: the completion screen and the freestyle finish
 * compared an Epley-estimated one-rep max (weight × (1 + reps/30)), while the
 * Records tab, the milestone ladder and the morning-after notification
 * compared the weight actually on the bar. A set of 80 kg × 10 estimates to
 * about 107 kg — enough to beat a 100 kg × 1 best on the completion screen —
 * while every other surface correctly said 80 kg is lighter than 100 kg and
 * called it nothing.
 *
 * Both surfaces now go through the same rule (`heaviestOfSets` in
 * personalRecords.ts): the record is the heaviest weight lifted, reps only
 * breaking a tie at the same weight (PR #154). This suite drives all four
 * record-declaring paths from the same two-session history and checks they
 * agree, both on the case that broke and on a lift that actually did go up.
 */

const BENCH_TEMPLATE_ID = null; // free workouts carry no template; the name index alone must agree.

function priorLog(sessionId, weightKg, reps) {
  return {
    sessionId,
    exerciseTemplateId: BENCH_TEMPLATE_ID,
    exerciseNameSnapshot: 'Bench Press',
    weight: weightKg,
    repsPerSet: [reps],
    sets: [],
    tracked: true,
    skipped: false,
  };
}

const PRIOR_SESSION = { id: 's1', performedAt: '2026-09-01T10:00:00.000Z' };

function completionCards(weightKg, reps, exercisePrLookup) {
  return buildCompletionCardsFromAdaptedSession({
    exercises: [
      {
        slotId: 'bench',
        exerciseName: 'Bench Press',
        persistedExerciseTemplateId: null,
        tracked: true,
        trackingMode: 'load_and_reps',
        notes: null,
        sets: [{ orderIndex: 0, status: 'completed', weightKg, reps }],
      },
    ],
    exerciseTemplates: [],
    exerciseLibrary: [],
    exercisePrLookup,
    language: 'en',
  }).prCards;
}

function freestyleCards(weightKg, reps, exercisePrLookup) {
  return buildFreestyleFinish({
    exercises: [
      {
        localKey: 'draft_1',
        name: 'Bench Press',
        libraryItemId: null,
        imageUrl: null,
        repMin: 1,
        repMax: 10,
        restSeconds: 120,
        trackedDefault: true,
        sets: [{ localKey: 'set_1', kg: String(weightKg), reps: String(reps), done: true }],
      },
    ],
    workoutName: 'Empty workout',
    startedAtIso: '2026-09-10T10:00:00.000Z',
    performedAtIso: '2026-09-10T10:40:00.000Z',
    elapsedSeconds: 600,
    exercisePrLookup,
  }).summary.prCards;
}

module.exports = [
  {
    name: '80 kg × 10 after a 100 kg × 1 best is a record nowhere',
    run() {
      const lookup = buildExercisePrLookup({
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1)],
        workoutSessions: [PRIOR_SESSION],
        exerciseTemplates: [],
      });
      assert.deepEqual(lookup.byName['bench press'], { weight: 100, reps: 1 });

      // Completion screen: the hero and the recap badge.
      assert.equal(completionCards(80, 10, lookup).length, 0, 'completion screen');

      // Freestyle finish: the same badge, built by a different function.
      assert.equal(freestyleCards(80, 10, lookup).length, 0, 'freestyle completion');

      // Records tab: the 80 × 10 session does not move the weight record.
      const record = resolveRecord(
        {
          key: 'bench-press',
          name: 'Bench Press',
          entries: [
            { performedAt: PRIOR_SESSION.performedAt, sets: [{ weight: 100, reps: 1 }] },
            { performedAt: '2026-09-10T10:40:00.000Z', sets: [{ weight: 80, reps: 10 }] },
          ],
        },
        'weight',
      );
      assert.equal(record.value, 100, 'Records tab');
      assert.equal(record.performedAt, PRIOR_SESSION.performedAt);

      // Morning-after notification: nothing to say the next day.
      const latest = findLatestSessionPr({
        workoutSessions: [PRIOR_SESSION, { id: 's2', performedAt: '2026-09-10T10:40:00.000Z' }],
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1), priorLog('s2', 80, 10)],
        exerciseTemplates: [],
      });
      assert.equal(latest, null, 'morning notification');
    },
  },
  {
    name: 'a genuinely heavier 110 kg × 1 is a record everywhere',
    run() {
      const lookup = buildExercisePrLookup({
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1)],
        workoutSessions: [PRIOR_SESSION],
        exerciseTemplates: [],
      });

      const completion = completionCards(110, 1, lookup);
      assert.equal(completion.length, 1, 'completion screen');
      assert.equal(completion[0].performedWeightKg, 110);
      assert.equal(completion[0].previousBestWeightKg, 100);

      const freestyle = freestyleCards(110, 1, lookup);
      assert.equal(freestyle.length, 1, 'freestyle completion');
      assert.equal(freestyle[0].performedWeightKg, 110);

      const record = resolveRecord(
        {
          key: 'bench-press',
          name: 'Bench Press',
          entries: [
            { performedAt: PRIOR_SESSION.performedAt, sets: [{ weight: 100, reps: 1 }] },
            { performedAt: '2026-09-10T10:40:00.000Z', sets: [{ weight: 110, reps: 1 }] },
          ],
        },
        'weight',
      );
      assert.equal(record.value, 110, 'Records tab');
      assert.equal(record.previous, 100);

      const latest = findLatestSessionPr({
        workoutSessions: [PRIOR_SESSION, { id: 's2', performedAt: '2026-09-10T10:40:00.000Z' }],
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1), priorLog('s2', 110, 1)],
        exerciseTemplates: [],
      });
      assert.ok(latest, 'morning notification');
      assert.equal(latest.weightKg, 110);
    },
  },
  {
    // The rule everywhere is "beaten, not matched" — equalling the old best
    // reads as steady work, not a celebration.
    name: 'matching the old best, not beating it, is a record nowhere',
    run() {
      const lookup = buildExercisePrLookup({
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1)],
        workoutSessions: [PRIOR_SESSION],
        exerciseTemplates: [],
      });

      assert.equal(completionCards(100, 1, lookup).length, 0, 'completion screen');
      assert.equal(freestyleCards(100, 1, lookup).length, 0, 'freestyle completion');

      const latest = findLatestSessionPr({
        workoutSessions: [PRIOR_SESSION, { id: 's2', performedAt: '2026-09-10T10:40:00.000Z' }],
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 1), priorLog('s2', 100, 1)],
        exerciseTemplates: [],
      });
      assert.equal(latest, null, 'morning notification');
    },
  },
  {
    // User, 2026-09-26: the same weight for more reps is a record, everywhere.
    // The Records tab already moved its record to the better set (PR #154);
    // the completion screen, the freestyle finish, the morning notification,
    // the exercise sheet's pill and the coach's line asked for a heavier bar.
    name: 'the same weight for more reps is a record everywhere',
    run() {
      const { buildExerciseSheetHistory } = require('../../src/lib/exerciseSheetHistory');
      const { buildCoachModules } = require('../../src/lib/aiCoachModules');

      const lookup = buildExercisePrLookup({
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 3)],
        workoutSessions: [PRIOR_SESSION],
        exerciseTemplates: [],
      });

      const completion = completionCards(100, 5, lookup);
      assert.equal(completion.length, 1, 'completion screen');
      assert.equal(completion[0].previousBestWeightKg, 100);
      assert.equal(completion[0].previousBestReps, 3);
      assert.equal(freestyleCards(100, 5, lookup).length, 1, 'freestyle completion');
      // Fewer reps at the same weight is not.
      assert.equal(completionCards(100, 2, lookup).length, 0, 'completion screen, fewer reps');

      const record = resolveRecord(
        {
          key: 'bench-press',
          name: 'Bench Press',
          entries: [
            { performedAt: PRIOR_SESSION.performedAt, sets: [{ weight: 100, reps: 3 }] },
            { performedAt: '2026-09-10T10:40:00.000Z', sets: [{ weight: 100, reps: 5 }] },
          ],
        },
        'weight',
      );
      assert.equal(record.performedAt, '2026-09-10T10:40:00.000Z', 'Records tab');

      const latest = findLatestSessionPr({
        workoutSessions: [PRIOR_SESSION, { id: 's2', performedAt: '2026-09-10T10:40:00.000Z' }],
        exerciseLogs: [priorLog(PRIOR_SESSION.id, 100, 3), priorLog('s2', 100, 5)],
        exerciseTemplates: [],
      });
      assert.ok(latest, 'morning notification');
      assert.equal(latest.reps, 5);

      const sheet = buildExerciseSheetHistory(
        [{ performedAt: PRIOR_SESSION.performedAt, sets: [{ loadKg: 100, reps: 3 }] }],
        { performedAt: '2026-09-10T10:40:00.000Z', sets: [{ loadKg: 100, reps: 5 }] },
        'en',
      );
      assert.equal(sheet.rows.find((row) => row.isPr) !== undefined, true, 'exercise sheet pill');

      const coachSession = (id, performedAt) => ({
        id,
        workoutTemplateId: 'tpl',
        workoutNameSnapshot: 'Push',
        performedAt,
        totalVolumeKg: 500,
      });
      const modules = buildCoachModules({
        sessions: [coachSession('s2', '2026-09-10T10:40:00.000Z'), coachSession(PRIOR_SESSION.id, PRIOR_SESSION.performedAt)],
        logs: [priorLog(PRIOR_SESSION.id, 100, 3), priorLog('s2', 100, 5)],
        language: 'en',
        now: new Date('2026-09-10T12:00:00.000Z'),
      });
      const text = modules.analysis.bullets.map((bullet) => bullet.body.text).join(' ');
      assert.match(text, /a new best/, 'coach analysis line');

      // And the card says what moved, the reps, rather than "+0 kg".
      const screen = require('node:fs')
        .readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'screens', 'WorkoutCompletionScreen.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(
        screen,
        /if \(pr\.performedWeightKg === pr\.previousBestWeightKg && pr\.previousBestReps !== null\) \{\s*return prMoreRepsLabel\(/,
      );
    },
  },
  {
    // Bodyweight/unloaded lifts: no weight was ever on the bar, so nobody
    // declares a weight record — matching the Records tab's own rule that a
    // set at 0 kg produces no weight candidate at all.
    name: 'an unloaded set never earns a weight record',
    run() {
      const emptyLookup = { byLibraryItemId: {}, byName: {}, namesWithRecordsRow: {} };
      assert.equal(completionCards(0, 12, emptyLookup).length, 0, 'completion screen');
      assert.equal(freestyleCards(0, 12, emptyLookup).length, 0, 'freestyle completion');

      const record = resolveRecord(
        {
          key: 'pull-up',
          name: 'Pull-Up',
          entries: [{ performedAt: '2026-09-10T10:40:00.000Z', sets: [{ weight: 0, reps: 12 }] }],
        },
        'weight',
      );
      assert.equal(record, null, 'Records tab');
    },
  },
  {
    // Hunt, 2026-10-26: the lift card's chip compared kilos alone, so 80 × 8
    // after 80 × 5 read "Rakentuu" while Records and the finish screen above
    // called it a record. The chip reads the same rule (beatsBest).
    name: "the lift card's chip agrees: the same weight for more reps is a new best, fewer reps is not",
    run() {
      const {
        getTrackedExerciseProgress,
        getLiftProgress,
        getExerciseProgressSignal,
      } = require('../../src/lib/progression');
      let n = 0;
      const entry = (performedAt, weight, reps, tracked = true) => {
        n += 1;
        const sessionId = `chip-s${n}`;
        return {
          session: { id: sessionId, performedAt, workoutNameSnapshot: 'Push' },
          log: {
            id: `chip-l${n}`,
            sessionId,
            exerciseTemplateId: null,
            exerciseNameSnapshot: 'Bench Press',
            weight,
            repsPerSet: reps,
            tracked,
            skipped: false,
            orderIndex: 0,
            sets: reps.map((r, i) => ({ id: `chip-x${n}-${i}`, weight, reps: r, status: 'completed', kind: 'working' })),
          },
        };
      };
      const database = (entries) => ({
        exerciseLogs: entries.map((e) => e.log),
        workoutSessions: entries.map((e) => e.session),
        exerciseTemplates: [],
        preferences: { strengthGoals: [] },
      });
      const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
      const chips = (entries) => {
        const summaries = getTrackedExerciseProgress(database(entries));
        return [
          getExerciseProgressSignal(summaries[0]).kind,
          getExerciseProgressSignal(getLiftProgress('Bench Press', summaries, sameName)).kind,
        ];
      };

      const more = [entry('2026-10-01T10:00:00.000Z', 80, [5, 5, 5]), entry('2026-10-08T10:00:00.000Z', 80, [8, 8, 8])];
      assert.deepEqual(chips(more), ['new_best', 'new_best'], 'same weight, more reps');
      const record = resolveRecord(
        {
          key: 'bench-press',
          name: 'Bench Press',
          entries: [
            { performedAt: '2026-10-01T10:00:00.000Z', sets: [{ weight: 80, reps: 5 }] },
            { performedAt: '2026-10-08T10:00:00.000Z', sets: [{ weight: 80, reps: 8 }] },
          ],
        },
        'weight',
      );
      assert.equal(record.performedAt, '2026-10-08T10:00:00.000Z', 'Records tab agrees');

      const fewer = [entry('2026-10-01T10:00:00.000Z', 80, [8]), entry('2026-10-08T10:00:00.000Z', 80, [5])];
      assert.ok(!chips(fewer).includes('new_best'), 'same weight, fewer reps');
      const matched = [entry('2026-10-01T10:00:00.000Z', 80, [5]), entry('2026-10-08T10:00:00.000Z', 80, [5])];
      assert.ok(!chips(matched).includes('new_best'), 'matched, not beaten');
      // More reps than an untracked heavier set's weight is still not a best:
      // the bests read every performed set.
      const untrackedHeavier = [
        entry('2026-09-01T10:00:00.000Z', 100, [3], false),
        entry('2026-10-01T10:00:00.000Z', 80, [5]),
        entry('2026-10-08T10:00:00.000Z', 80, [8]),
      ];
      assert.ok(!chips(untrackedHeavier).includes('new_best'), 'an untracked 100 kg stands');
    },
  },
];
