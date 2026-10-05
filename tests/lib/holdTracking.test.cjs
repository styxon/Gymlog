const assert = require('node:assert/strict');

const {
  isTimedTrackingMode,
  isUnloadedTrackingMode,
} = require('../../.test-dist/features/workout/workoutTypes.js');
const { formatSetScheme } = require('../../.test-dist/lib/format.js');
const { resolveGuidedSetTarget } = require('../../.test-dist/lib/guidedPlayer.js');
const { estimateWorkingSetSeconds } = require('../../.test-dist/lib/sessionDuration.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

const CATALOG_EXERCISES = WORKOUT_TEMPLATES_V1.flatMap((template) =>
  template.sessions.flatMap((session) =>
    session.exercises.map((exercise) => ({ ...exercise, programName: template.name, sessionName: session.name })),
  ),
);

/**
 * Rows whose numbers are seconds or metres but which are NOT a static hold:
 * work intervals and distances. They are the known remainder of the same
 * problem and are pinned here so the list cannot grow without someone saying
 * so — see the "interval and distance" suite at the bottom.
 */
const INTERVAL_OR_DISTANCE = /hiit|\d+\s*m\b|\(\d+s|sprint|20s on|30s on|45s sprint|500m|200m|40m/i;

module.exports = [
  {
    name: 'the hold list and the catalog data say the same thing, both ways round',
    run() {
      const {
        HOLD_EXERCISE_NAME_LIST,
        isHoldExerciseName,
      } = require('../../.test-dist/lib/holdExercises.js');

      // Two lists would drift, and the drift would be silent: the same plank
      // reading "3 × 30-60 s" in a ready program and "3 × 60" in your own.
      const markedButNotListed = [
        ...new Set(
          CATALOG_EXERCISES.filter(
            (exercise) => exercise.trackingMode === 'hold' && !isHoldExerciseName(exercise.exerciseName),
          ).map((exercise) => exercise.exerciseName),
        ),
      ];
      const listedButNotMarked = [
        ...new Set(
          CATALOG_EXERCISES.filter(
            (exercise) => exercise.trackingMode !== 'hold' && isHoldExerciseName(exercise.exerciseName),
          ).map((exercise) => `${exercise.exerciseName} (${exercise.trackingMode})`),
        ),
      ];

      assert.deepEqual(markedButNotListed, [], 'catalog rows marked hold that the list does not know');
      assert.deepEqual(listedButNotMarked, [], 'exercises the list calls holds but the catalog logs as reps');
      assert.ok(HOLD_EXERCISE_NAME_LIST.length >= 40);
    },
  },
  {
    name: 'a hold picked from the library gets seconds in a custom program too',
    run() {
      const { getCatalogTrackingMode } = require('../../.test-dist/lib/catalogExercisePools.js');
      const { isHoldExerciseName } = require('../../.test-dist/lib/holdExercises.js');

      assert.equal(getCatalogTrackingMode('Plank'), 'hold');
      assert.equal(getCatalogTrackingMode("Child's Pose"), 'hold');
      // A hold is bodyweight, so the equipment branch must not answer first.
      assert.equal(getCatalogTrackingMode('Bodyweight Squat'), 'bodyweight');
      assert.equal(getCatalogTrackingMode('Barbell Squat'), 'load_and_reps');

      // The library's own spelling counts, not just the catalogs'.
      assert.equal(isHoldExerciseName('Intermediate Hip Flexor and Quad Stretch'), true);
      assert.equal(isHoldExerciseName('  plank  '), true);
      assert.equal(isHoldExerciseName('Plank Jack'), false, 'a plank jack is repetitions');
      assert.equal(isHoldExerciseName('Push-Up'), false);
    },
  },
  {
    name: 'a hold is unloaded and timed; a bodyweight rep is unloaded but not timed',
    run() {
      assert.equal(isUnloadedTrackingMode('hold'), true);
      assert.equal(isUnloadedTrackingMode('bodyweight'), true);
      assert.equal(isUnloadedTrackingMode('load_and_reps'), false);
      assert.equal(isUnloadedTrackingMode('reps_first'), false);

      assert.equal(isTimedTrackingMode('hold'), true);
      assert.equal(isTimedTrackingMode('bodyweight'), false);
    },
  },
  {
    name: 'a hold prescription carries its unit, so 60 is not read as sixty repetitions',
    run() {
      assert.equal(formatSetScheme(3, 30, 60, 'hold'), '3 × 30-60 s');
      assert.equal(formatSetScheme(1, 180, 300, 'hold'), '1 × 180-300 s');
      assert.equal(formatSetScheme(4, 8, 10, 'load_and_reps'), '4 × 8-10');
      assert.equal(formatSetScheme(3, 12, 12, 'bodyweight'), '3 × 12');
    },
  },
  {
    name: 'the guided player prefills a hold with no weight',
    run() {
      const sets = [{ setIndex: 0, status: 'pending', plannedRepsMax: 45, plannedLoadKg: undefined }];
      const target = resolveGuidedSetTarget(sets, 0, 'hold');

      assert.equal(target.reps, 45);
      assert.equal(target.loadKg, null);
    },
  },
  {
    name: 'the finish screen reports a hold in seconds',
    run() {
      const { getTopSetLabel } = require('../../.test-dist/lib/workoutCompleteView.js');
      const sets = [
        { status: 'completed', weightKg: 0, reps: 45 },
        { status: 'completed', weightKg: 0, reps: 60 },
      ];

      assert.equal(getTopSetLabel(sets, 'en', 'hold'), '60 s');
      assert.equal(getTopSetLabel(sets, 'fi', 'hold'), '60 s');
      // A bodyweight set is still repetitions.
      assert.match(getTopSetLabel(sets, 'en', 'bodyweight'), /60 reps/);
      assert.match(getTopSetLabel(sets, 'fi', 'bodyweight'), /60 toistoa/);
      // A loaded set states its unit. It used to read "60 × 8" under a label
      // saying "heaviest set", which is a load without saying of what.
      assert.equal(
        getTopSetLabel([{ status: 'completed', weightKg: 60, reps: 8 }], 'en', 'load_and_reps'),
        '60 kg × 8',
      );
    },
  },
  {
    name: 'a held second costs a second, not three and a half',
    run() {
      // 60 seconds of plank used to be estimated as 60 reps: 60 × 3.5 + 20 =
      // 230 s per set, so a mobility session quoted double the time it takes.
      assert.equal(estimateWorkingSetSeconds(60, true), 80);
      assert.equal(estimateWorkingSetSeconds(60, false), 230);
      assert.equal(estimateWorkingSetSeconds(10, false), 55);
    },
  },
  {
    name: 'every catalog hold is prescribed in seconds, never in single-digit reps',
    run() {
      const holds = CATALOG_EXERCISES.filter((exercise) => exercise.trackingMode === 'hold');
      assert.ok(holds.length >= 50, `only ${holds.length} hold rows — did the marking get lost?`);

      const suspicious = holds
        .filter((exercise) => exercise.repsMax < 10)
        .map((exercise) => `${exercise.programName} / ${exercise.exerciseName}: ${exercise.repsMin}-${exercise.repsMax}`);

      assert.deepEqual(suspicious, [], 'a hold measured in single digits is a rep count that never got converted');
    },
  },
  {
    name: 'nothing else is prescribed in what can only be seconds',
    run() {
      // The catalogs wrote seconds into the rep fields long before there was a
      // mode to say so. Anything left at 30+ "reps" that is not a hold must be
      // a genuine high-rep set or a work interval — this pins the exceptions
      // so a new "Plank 3x30-60" cannot slip back in as repetitions.
      //
      // The line was 20 while rep RANGES existed: a 15-20 burnout kept a floor
      // under 20 and only seconds started there. Single rep targets (2026-08-25)
      // put honest ×20 and ×25 accessory sets right on the old line, so it
      // moves to where seconds prescriptions actually start: 30.
      const KNOWN_HIGH_REP = new Set([
        'Bicycle Crunch',
        "Farmer's Walk",
        'Frog Pump',
        'Frog Pump (Banded)',
        'High Knees',
        'Jumping Jack',
        'Kettlebell Swing',
        'Mountain Climber',
        'Mountain Climbers',
        'Pogo Hops',
        'Sled Push',
        'Standing Marching',
        'Battle Rope Slam',
        'Battle Rope Wave',
      ]);

      const unexplained = [
        ...new Set(
          CATALOG_EXERCISES.filter(
            (exercise) =>
              exercise.trackingMode !== 'hold' &&
              exercise.repsMin >= 30 &&
              !KNOWN_HIGH_REP.has(exercise.exerciseName) &&
              !INTERVAL_OR_DISTANCE.test(exercise.exerciseName),
          ).map((exercise) => `${exercise.exerciseName} (${exercise.repsMin}-${exercise.repsMax})`),
        ),
      ];

      assert.deepEqual(unexplained.sort(), []);
    },
  },
  {
    name: 'a stretch or isometric picked from the library is logged in seconds, a dynamic one in reps (bug hunt 2026-10-05)',
    run() {
      const path = require('node:path');
      const dist = (p) => require(path.join(__dirname, '..', '..', '.test-dist', p));
      const { GENERATED_EXERCISE_LIBRARY } = dist('data/generatedExerciseLibrary.js');
      const { EXTRA_EXERCISE_LIBRARY } = dist('data/extraExerciseLibrary.js');
      const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = dist('features/workout/customWorkoutAdapter.js');
      const { getExerciseTemplateDefaults } = dist('lib/exerciseSuggestions.js');
      const library = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY];
      const modeOf = (item) => {
        const defaults = getExerciseTemplateDefaults(item, 90);
        const exercise = { id: 'e', workoutTemplateSessionId: 's', name: item.name, orderIndex: 0, libraryItemId: item.id, trackingMode: null, ...defaults };
        const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate({ id: 't', name: 'T' }, [{ id: 's', name: 'S', orderIndex: 0, exercises: [exercise] }], library, 90);
        return { mode: runtime.sessions[0].exercises[0].trackingMode, repMin: defaults.repMin };
      };
      const timed = library.filter((item) => /\b(stretch|isometric)\b/i.test(item.name) && !/\bdynamic\b/i.test(item.name) && !['cat stretch', 'iron crosses (stretch)', 'isometric wipers'].includes(item.name.toLowerCase()));
      assert.ok(timed.length >= 40, `only ${timed.length} timed rows`);
      const wrong = timed.map((item) => ({ name: item.name, ...modeOf(item) })).filter((row) => row.mode !== 'hold' || row.repMin < 20);
      assert.deepEqual(wrong, [], 'a stretch or isometric opens a reps dial, or a hold of a few seconds');
      // Moved through, not held.
      const dynamic = library.find((item) => /\bdynamic\b.*\bstretch\b/i.test(item.name));
      for (const name of ['Isometric Wipers', 'Iron Crosses (stretch)']) {
        const item = library.find((row) => row.name === name);
        assert.ok(item, name);
        assert.notEqual(modeOf(item).mode, 'hold', name);
      }
      if (dynamic) {
        assert.notEqual(modeOf(dynamic).mode, 'hold', dynamic.name);
      }
    },
  },
];
