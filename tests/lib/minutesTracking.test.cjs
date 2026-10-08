const assert = require('node:assert/strict');

/**
 * Minutes as a unit (user 2026-10-06, "Tuodaan minuuttiyksikkö appiin").
 *
 * Steady cardio — "Stairmaster (Moderate) 1×20", "Stationary Bike (Easy Pace)
 * 1×15", the run blocks — was always prescribed in minutes, and the app logged
 * and timed it as repetitions: twenty reps of a stair machine, costed at 3.5 s
 * apiece, offering a "20 reps" record. trackingMode 'duration_minutes' says
 * what the numbers were. These suites hold every place a set is read to it.
 */

const dist = (path) => require(`../../.test-dist/${path}`);

const { WORKOUT_TEMPLATES_V1, getWorkoutTemplateById } = dist('features/workout/workoutCatalog.js');

const CATALOG_SLOTS = WORKOUT_TEMPLATES_V1.flatMap((template) =>
  template.sessions.flatMap((session) =>
    session.exercises.map((exercise) => ({ ...exercise, templateId: template.id, sessionName: session.name })),
  ),
);

/**
 * What steady work looks like by name, written independently of the app's own
 * list so the sweep below is not the list checking itself: machines and runs
 * done for a time. Intervals, sprints and distances are excluded — their
 * numbers are seconds or metres.
 */
const STEADY_BY_NAME =
  /\b(stairmaster|step ?mill|stationary bike|recumbent bike|exercise bike|elliptical|treadmill walk|incline walk|jog|jogging|zone ?2|steady|easy pace|run blocks?|bicycling)\b/i;
const NOT_STEADY = /hiit|sprint|interval|\(\d+\s*s\b|\b\d+\s*s on\b|\b\d+\s*m\b|\d+m\b/i;

function stairmasterDay() {
  const template = getWorkoutTemplateById('tpl_gainer_dream_body_female_v1');
  const session = template.sessions.find((candidate) =>
    candidate.exercises.some((exercise) => exercise.exerciseName === 'Stairmaster (Moderate)'),
  );
  return { template, session };
}

function minutesLog(overrides = {}) {
  return {
    id: 'log_bike',
    sessionId: 's1',
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Stationary Bike (Easy Pace)',
    weight: 0,
    repsPerSet: [20],
    sets: [{ orderIndex: 0, weight: 0, reps: 20, kind: 'working', outcome: 'completed', status: 'completed' }],
    tracked: true,
    orderIndex: 0,
    repsUnit: 'minutes',
    ...overrides,
  };
}

module.exports = [
  {
    name: 'minutes: every catalog slot dosed in minutes is logged in minutes, and the list agrees both ways',
    run() {
      const { isMinutesExerciseName, MINUTES_EXERCISE_NAME_LIST } = dist('lib/minutesExercises.js');

      const steady = CATALOG_SLOTS.filter(
        (slot) => STEADY_BY_NAME.test(slot.exerciseName) && !NOT_STEADY.test(slot.exerciseName),
      );
      // Not vacuous: the sweep has to find the slots this change is about.
      assert.ok(steady.length >= 6, `the steady sweep found only ${steady.length} slots`);
      const notMinutes = steady
        .filter((slot) => slot.trackingMode !== 'duration_minutes')
        .map((slot) => `${slot.templateId} / ${slot.sessionName}: ${slot.exerciseName} (${slot.trackingMode})`);
      assert.deepEqual(notMinutes, [], 'steady work the catalog still logs as reps');

      // The two the user named, by their own numbers.
      const stair = CATALOG_SLOTS.find((slot) => slot.id === 'quads_cardio_stairmaster_moderate');
      const bike = CATALOG_SLOTS.find((slot) => slot.id === 'low_impact_cardio_stability_stationary_bike_easy_pace');
      assert.deepEqual(
        [stair.trackingMode, stair.sets, stair.repsMax],
        ['duration_minutes', 1, 20],
        'Dream Body Female: Stairmaster (Moderate) 1 × 20 min',
      );
      assert.deepEqual(
        [bike.trackingMode, bike.sets, bike.repsMax],
        ['duration_minutes', 1, 15],
        'Prenatal: Stationary Bike (Easy Pace) 1 × 15 min',
      );

      // One list for every place that only has a name, agreeing with the slots.
      const markedNotListed = [
        ...new Set(
          CATALOG_SLOTS.filter(
            (slot) => slot.trackingMode === 'duration_minutes' && !isMinutesExerciseName(slot.exerciseName),
          ).map((slot) => slot.exerciseName),
        ),
      ];
      const listedNotMarked = [
        ...new Set(
          CATALOG_SLOTS.filter(
            (slot) => slot.trackingMode !== 'duration_minutes' && isMinutesExerciseName(slot.exerciseName),
          ).map((slot) => `${slot.exerciseName} (${slot.trackingMode})`),
        ),
      ];
      assert.deepEqual(markedNotListed, [], 'minutes slots the name list does not know');
      assert.deepEqual(listedNotMarked, [], 'names the list calls minutes that a slot logs otherwise');
      assert.ok(MINUTES_EXERCISE_NAME_LIST.length >= 10);
    },
  },
  {
    name: 'minutes: a session is costed in minutes, not 3.5 s a "rep"',
    run() {
      const { estimateSessionSeconds } = dist('lib/sessionDuration.js');
      const { estimateProgrammeSessionMinutesList } = dist('lib/programmeMinutes.js');

      const seconds = estimateSessionSeconds({
        exercises: [{ name: 'Stairmaster (Moderate)', sets: 1, reps: 20, minutes: true, restSeconds: 0 }],
      });
      assert.ok(seconds >= 20 * 60, `20 minutes costed as ${seconds} s`);

      // The ready day the user named: with the bout taken out it is at least
      // twenty minutes shorter, because the bout is twenty minutes long.
      const { session } = stairmasterDay();
      const [withBout] = estimateProgrammeSessionMinutesList([session]);
      const [withoutBout] = estimateProgrammeSessionMinutesList([
        { exercises: session.exercises.filter((exercise) => exercise.exerciseName !== 'Stairmaster (Moderate)') },
      ]);
      assert.ok(withBout - withoutBout >= 15, `the bout added ${withBout - withoutBout} min to the day`);
    },
  },
  {
    name: 'minutes: the player opens a minutes slot as minutes and the reducer logs them, no weight',
    run() {
      const { workoutReducer, workoutInitialState, repsCeilingFor } = dist('features/workout/workoutState.js');
      const { buildReadySessionRuntimeTemplate } = dist('lib/programDetails.js');
      const { buildExerciseLogDraftsFromWorkoutSession } = dist('features/workout/workoutAppAdapter.js');
      const { resolveGuidedSetTarget, formatGuidedTarget } = dist('lib/guidedPlayer.js');

      const { template, session } = stairmasterDay();
      const runtime = buildReadySessionRuntimeTemplate(template, session.id);
      let state = workoutReducer(
        { ...workoutInitialState, hydrated: true, isRestoring: false },
        {
          type: 'session/startFromRuntimeTemplate',
          payload: { template: runtime, sessionOrderIndex: session.orderIndex, unitPreference: 'kg' },
        },
      );
      const bout = state.activeSession.exercises.find((exercise) => exercise.exerciseName === 'Stairmaster (Moderate)');
      assert.equal(bout.trackingMode, 'duration_minutes');
      assert.equal(bout.sets.length, 1);
      assert.ok(repsCeilingFor(bout, bout.sets[0]) >= 120, 'a long ride must not be refused');

      const target = resolveGuidedSetTarget(bout.sets, 0, bout.trackingMode);
      assert.equal(target.minutes, true);
      assert.equal(target.loadKg, null);
      assert.equal(formatGuidedTarget(target, 'fi'), '20 min');

      state = workoutReducer(state, {
        type: 'set/updateDraft',
        payload: { slotId: bout.slotId, setIndex: 0, patch: { repsText: '18' } },
      });
      state = workoutReducer(state, {
        type: 'set/complete',
        payload: { slotId: bout.slotId, setIndex: 0, nowMs: Date.parse('2026-10-06T10:00:00Z'), unitPreference: 'kg' },
      });
      const logged = state.activeSession.exercises.find((exercise) => exercise.slotId === bout.slotId).sets[0];
      assert.equal(logged.status, 'completed');
      assert.equal(logged.actualReps, 18);
      assert.ok(!(logged.actualLoadKg > 0), 'a bout of minutes carries no weight');

      const log = buildExerciseLogDraftsFromWorkoutSession(state.activeSession).find(
        (draft) => draft.exerciseNameSnapshot === 'Stairmaster (Moderate)',
      );
      assert.equal(log.repsUnit, 'minutes', 'the saved log says its reps are minutes');
      assert.equal(log.sets.find((set) => set.kind === 'working').reps, 18);
      // The lifts beside it are saved exactly as they were.
      const lift = buildExerciseLogDraftsFromWorkoutSession(state.activeSession).find(
        (draft) => draft.exerciseNameSnapshot !== 'Stairmaster (Moderate)',
      );
      assert.equal(lift === undefined || !('repsUnit' in lift), true);
    },
  },
  {
    name: 'minutes: never tonnage, never a record — whatever the weight column holds',
    run() {
      const { getTotalVolume } = dist('lib/progression.js');
      const { getSessionTotals } = dist('lib/sessionTotals.js');
      const { recordSetsOfLog, resolveRecords } = dist('lib/personalRecords.js');

      const timed = minutesLog({ weight: 5, sets: [{ ...minutesLog().sets[0], weight: 5 }] });
      assert.equal(getTotalVolume(timed), 0, 'five "kg" × twenty minutes is not 100 kg lifted');
      const totals = getSessionTotals([timed]);
      assert.equal(totals.totalVolumeKg, 0);
      assert.equal(totals.setsCompleted, 1, 'the bout is still a set done');
      assert.equal(totals.exercisesCompleted, 1);

      assert.deepEqual(recordSetsOfLog(timed), []);
      // A log saved before the unit existed, under a name logged in minutes,
      // does not keep the record the old reading made either.
      const legacy = minutesLog({ repsUnit: undefined, exerciseNameSnapshot: 'Stairmaster (Moderate)' });
      delete legacy.repsUnit;
      assert.deepEqual(recordSetsOfLog(legacy), []);
      // A lift's log still offers its sets.
      assert.equal(
        recordSetsOfLog(minutesLog({ repsUnit: undefined, exerciseNameSnapshot: 'Push-Up' })).length,
        1,
      );

      const source = {
        key: 'bike',
        name: 'Stationary Bike (Easy Pace)',
        entries: [timed, minutesLog({ sets: [{ ...minutesLog().sets[0], reps: 25 }] })].map((log, index) => ({
          performedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
          sets: recordSetsOfLog(log),
        })),
      };
      for (const kind of ['weight', 'reps', 'volume']) {
        assert.deepEqual(resolveRecords([source], kind), [], `a ${kind} record from minutes`);
      }
    },
  },
  {
    name: 'minutes: history, the finish screen and the dose all say "min"',
    run() {
      const { formatLogResult, formatSetScheme } = dist('lib/format.js');
      const { getTopSetLabel } = dist('lib/workoutCompleteView.js');
      const { buildOverviewColumns } = dist('lib/sessionOverviewRows.js');

      assert.equal(formatSetScheme(1, 20, 20, 'duration_minutes'), '1 × 20 min');
      assert.equal(formatSetScheme(4, 5, 5, 'duration_minutes'), '4 × 5 min');
      assert.equal(formatSetScheme(3, 30, 45, 'hold'), '3 × 30-45 s', 'a hold keeps its seconds');
      assert.equal(formatLogResult(minutesLog(), 'kg', 'fi'), '20 min');
      assert.equal(
        getTopSetLabel([{ status: 'completed', weightKg: null, reps: 20 }], 'fi', 'duration_minutes'),
        '20 min',
      );
      assert.deepEqual(
        buildOverviewColumns({ exerciseName: 'Easy Run Blocks', setCount: 4, repsLabel: '5', timed: false, minutes: true, loadKg: null }),
        { sets: '4', reps: '', load: '5 min' },
      );
    },
  },
  {
    name: 'minutes: the plan CSV round-trips "20 min", and the log CSV writes the unit',
    run() {
      const { buildProgramCsv } = dist('lib/programCsvExport.js');
      const { parseCsvProgram, buildDraftFromCsvPreview } = dist('lib/csvProgramImport.js');
      const { buildWorkoutLogCsv } = dist('lib/workoutLogCsvExport.js');

      const csv = buildProgramCsv([
        {
          name: 'Cardio',
          exercises: [
            { name: 'Stairmaster', sets: 1, repMin: 20, repMax: 20, unit: 'minutes' },
            { name: 'Push-Up', sets: 3, repMin: 12, repMax: 12 },
          ],
        },
      ]);
      assert.match(csv, /^Cardio,Stairmaster,1,20 min$/m);
      assert.match(csv, /^Cardio,Push-Up,3,12$/m, 'a reps row is exactly as it was');

      const library = [
        { id: 'lib_stair', name: 'Stairmaster' },
        { id: 'lib_push', name: 'Push-Up' },
      ];
      const preview = parseCsvProgram(csv, library);
      assert.deepEqual(preview.errors, []);
      const stairRow = preview.rows.find((row) => row.matchedName === 'Stairmaster');
      assert.equal(stairRow.minutes, true);
      assert.equal(stairRow.repMax, 20);
      const draft = buildDraftFromCsvPreview(preview, 'Imported');
      const exercises = draft.sessions.flatMap((session) => session.exercises);
      assert.equal(exercises.find((exercise) => exercise.name === 'Stairmaster').trackingMode, 'duration_minutes');
      assert.equal(exercises.find((exercise) => exercise.name === 'Push-Up').trackingMode, undefined);

      const logCsv = buildWorkoutLogCsv({
        sessions: [{ id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'Day', performedAt: '2026-10-06T10:00:00.000Z' }],
        logs: [minutesLog()],
      });
      assert.match(logCsv, /,Stationary Bike \(Easy Pace\),1,20 min,,yes$/m);
    },
  },
  {
    name: 'minutes: stored data from before the unit loads as it was, and an unknown mode falls back',
    run() {
      const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
      const { database } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) => ({
        database: requireDist('storage/database.js'),
      }));

      const template = (id, trackingMode) => ({
        id,
        workoutTemplateId: 'tpl_mine',
        workoutTemplateSessionId: 'day_1',
        name: id === 'ex_bike' ? 'Stationary Bike (Easy Pace)' : 'Push-Up',
        targetSets: 1,
        repMin: 20,
        repMax: 20,
        restSeconds: 0,
        trackedDefault: true,
        orderIndex: 0,
        ...(trackingMode === undefined ? {} : { trackingMode }),
      });
      const restored = database.normalizeDatabase({
        workoutTemplates: [
          { id: 'tpl_mine', name: 'Mine', exerciseIds: [], sessions: [{ id: 'day_1', name: 'Day 1', orderIndex: 0 }] },
        ],
        exerciseTemplates: [
          template('ex_bike', 'duration_minutes'),
          template('ex_old'),
          template('ex_future', 'warp_speed'),
        ],
        workoutSessions: [
          { id: 's1', workoutTemplateId: 'tpl_mine', workoutNameSnapshot: 'Mine', performedAt: '2026-10-01T10:00:00.000Z' },
        ],
        exerciseLogs: [
          minutesLog({ id: 'log_new' }),
          (() => {
            const old = minutesLog({ id: 'log_old', exerciseNameSnapshot: 'Push-Up' });
            delete old.repsUnit;
            return old;
          })(),
          minutesLog({ id: 'log_future', repsUnit: 'hours' }),
        ],
      });

      const modeOf = (id) => restored.exerciseTemplates.find((exercise) => exercise.id === id).trackingMode;
      assert.equal(modeOf('ex_bike'), 'duration_minutes', 'a stored minutes mode survives the load');
      assert.equal(modeOf('ex_old'), null, 'no mode stored: derived from the name, as before');
      assert.equal(modeOf('ex_future'), null, 'a mode this build does not know is no mode');

      const logOf = (id) => restored.exerciseLogs.find((log) => log.id === id);
      assert.equal(logOf('log_new').repsUnit, 'minutes');
      assert.equal('repsUnit' in logOf('log_old'), false, 'an old log keeps its exact shape');
      assert.equal('repsUnit' in logOf('log_future'), false, 'an unknown unit reads as repetitions');
    },
  },
  {
    name: 'minutes: swaps keep the unit, the composer doses a bout, and progression never moves it',
    run() {
      const { getCatalogTrackingMode, trackingModeAfterSwap, prescriptionAfterSwap } = dist('lib/catalogExercisePools.js');
      const { buildComposedFallbackExercise } = dist('lib/programDayComposer.js');
      const { evaluateProgression } = dist('lib/progressionGate.js');

      assert.equal(getCatalogTrackingMode('Recumbent Bike'), 'duration_minutes');
      assert.equal(getCatalogTrackingMode('Walking, Treadmill'), 'duration_minutes');
      assert.equal(getCatalogTrackingMode('Bike HIIT (45s sprint / 15s rest)') === 'duration_minutes', false);

      // Bike to elliptical stays minutes; a lift swapped for a bike becomes one,
      // and its numbers stop being the lift's.
      assert.equal(trackingModeAfterSwap('duration_minutes', 'Elliptical Trainer'), 'duration_minutes');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Stairmaster'), 'duration_minutes');
      const dose = prescriptionAfterSwap('load_and_reps', 'duration_minutes', { repsMin: 10, repsMax: 10 }, 'Stairmaster');
      // The programmes' middle minutes row (a run block's five), not the
      // lift's ten carried across the unit.
      assert.notEqual(dose.repsMax, 10, 'ten reps are not ten minutes');
      assert.ok(dose.repsMax >= 1 && dose.repsMax <= 30);

      const trail = buildComposedFallbackExercise('Trail Running/Walking', 'easy_run_day', 0);
      assert.deepEqual(
        [trail.trackingMode, trail.sets, trail.repsMax, trail.restSecondsMax],
        ['duration_minutes', 1, 20, 0],
        'a supplemental run is one bout of minutes, not 3 × 12',
      );

      // The conservative choice: the programme's minutes are the dose, and the
      // gate never moves them on its own. Same history, loaded lift: it would.
      const performedAt = (daysAgo) => new Date(Date.parse('2026-10-06T10:00:00Z') - daysAgo * 86400000).toISOString();
      const entry = (daysAgo) => ({
        slotId: 'slot',
        templateId: 'tpl',
        templateName: 'Day',
        exerciseName: 'Stationary Bike (Easy Pace)',
        substitutionGroup: 'steady_cardio',
        performedAt: performedAt(daysAgo),
        sessionId: `s${daysAgo}`,
        skipped: false,
        sets: [{ setIndex: 0, loadKg: 60, reps: 12, completedAt: performedAt(daysAgo) }],
      });
      const input = { history: [entry(0), entry(3)], repsMin: 8, repsMax: 12, targetSets: 1, level: 'beginner' };
      assert.equal(evaluateProgression({ ...input, trackingMode: 'load_and_reps' }).recommendation, 'increase');
      assert.equal(evaluateProgression({ ...input, trackingMode: 'duration_minutes' }).recommendation, 'silent');
    },
  },
  {
    name: 'minutes: the coach reads minutes, not "20 with no added load"',
    run() {
      const { buildAiCoachLastSession } = dist('lib/aiTrainingContext.js');
      const last = buildAiCoachLastSession(
        [{ id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'Low-Impact Cardio', performedAt: '2026-10-06T10:00:00.000Z' }],
        [minutesLog()],
        new Date('2026-10-06T12:00:00.000Z'),
      );
      assert.equal(last.exercises[0].unit, 'minutes');

      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../../src/lib/aiCoachSystemContext.ts'), 'utf8');
      assert.match(source, /exercise\.unit === 'minutes'/, 'the coach block renders the unit');
      assert.match(source, /\(minutes, not reps\)/);
    },
  },
];
