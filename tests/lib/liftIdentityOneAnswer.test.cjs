const assert = require('node:assert/strict');

const dist = '../../src/';
const {
  bodyPartForExerciseName,
  holdsSameMovement,
  libraryBodyPartOf,
  resolveCatalogBodyPart,
  resolveLibraryItem,
} = require(dist + 'lib/catalogExercisePools.js');
const { buildMuscleFocus } = require(dist + 'lib/workoutCompleteView.js');
const { getRecentExerciseLibraryItems } = require(dist + 'lib/exerciseSuggestions.js');
const { normalizeStrengthGoals, removeStrengthGoal, upsertStrengthGoal } = require(dist + 'lib/strengthGoals.js');
const { isSameLift, isSameTargetLift } = require(dist + 'lib/goalProgramme.js');
const { foldThinSessions } = require(dist + 'lib/programDayComposer.js');
const { applyCautionFlagsToExercises } = require(dist + 'lib/cautionExerciseFilter.js');
const { formatHomeSessionTitle } = require(dist + 'app/homeSessionTitle.js');
const {
  WORKOUT_SUBSTITUTION_GROUPS,
  WORKOUT_TEMPLATES_V1,
  catalogSubstitutionGroupOf,
} = require(dist + 'features/workout/workoutCatalog.js');
const { GENERATED_EXERCISE_LIBRARY } = require(dist + 'data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require(dist + 'data/extraExerciseLibrary.js');

/**
 * Duplicate-truth sweep 13, area 4: one answer to "which lift is this".
 *
 * Each question below had two or more answers in the app, and the reader saw
 * whichever one the screen in front of them happened to ask: the completion
 * screen's muscle bars against the library, the Recent shelf and the Records
 * tags against the guided player's matcher, a strength target's "replaces"
 * promise against the store, the composer's duplicate check against focus
 * emphasis, and the auto-named day title against the session hero.
 */

// The app's library as it is seeded (seed.ts: generated, then the app's own).
const RUNTIME_LIBRARY = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY];
const LIBRARY_NAMES = RUNTIME_LIBRARY.map((item) => item.name);
const done = (weightKg, reps) => ({ status: 'completed', weightKg, reps });

const LABELS = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  legs: 'Legs',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
  glutes: 'Glutes',
  'full body': 'Full body',
};

function catalogNames() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        names.add(exercise.exerciseName);
      }
    }
  }
  return [...names];
}

/** Checked by hand: the matcher's row is right for a demo, wrong for the muscle. */
const CHECKED = {
  'Side Plank': 'core',
  'Curtsy Lunge': 'legs',
  'Competition Bench Press': 'chest',
  'Paused Bench Press': 'chest',
  'Inchworm to Push-Up': 'core',
};

module.exports = [
  {
    name: 'D4-1: the completion bars file a leg curl under Legs and a rear-delt fly under Shoulders',
    run() {
      const rows = buildMuscleFocus(
        [
          { exerciseName: 'Rear Delt Fly', sets: [done(10, 12), done(10, 12), done(10, 12)] },
          { exerciseName: 'Leg Curl', sets: [done(40, 10), done(40, 10), done(40, 10)] },
        ],
        RUNTIME_LIBRARY,
      );
      assert.deepEqual(rows.map((row) => row.name).sort(), ['Legs', 'Shoulders']);
    },
  },
  {
    name: 'D4-1: step-ups, swings and hanging raises are out of Other; dips and thoracic work are not chest or triceps by their words',
    run() {
      for (const name of ['Kettlebell Swing', 'Step-Up', 'Hanging Knee Raise', 'Cable Pull-Through', 'Reverse Pec Deck']) {
        assert.notEqual(bodyPartForExerciseName(name), 'other', name);
      }
      assert.equal(bodyPartForExerciseName('Weighted Dips'), 'triceps');
      assert.equal(bodyPartForExerciseName('Thoracic Extension on Roller'), 'back');
      assert.equal(bodyPartForExerciseName('Deadlift'), 'back');
    },
  },
  {
    name: 'D4-1: the hand-checked names answer as checked, everywhere the library is asked, and none is a library row of its own',
    run() {
      const generated = new Set(GENERATED_EXERCISE_LIBRARY.map((item) => item.name.trim().toLowerCase()));
      const extra = new Map(EXTRA_EXERCISE_LIBRARY.map((item) => [item.name.trim().toLowerCase(), item.bodyPart]));
      for (const [name, bodyPart] of Object.entries(CHECKED)) {
        assert.equal(resolveCatalogBodyPart(name), bodyPart, name);
        assert.equal(bodyPartForExerciseName(name), bodyPart, name);
        assert.equal(libraryBodyPartOf(name, RUNTIME_LIBRARY), bodyPart, name);
        const [row] = buildMuscleFocus([{ exerciseName: name, sets: [done(0, 10)] }], RUNTIME_LIBRARY);
        assert.equal(row.name, LABELS[bodyPart], name);
        // A generated row of that exact name would be asked first by the
        // completion screen and the Records tags, and could say otherwise.
        assert.ok(!generated.has(name.toLowerCase()), `${name} is a generated library row`);
        const own = extra.get(name.toLowerCase());
        assert.ok(own === undefined || own === bodyPart, `${name}: the app's own row says ${own}`);
      }
    },
  },
  {
    name: 'D4-1: over every ready-programme name, the completion bars and the library resolver give one answer',
    run() {
      const extra = new Set(EXTRA_EXERCISE_LIBRARY.map((item) => item.name.trim().toLowerCase()));
      const disagreements = [];
      for (const name of catalogNames()) {
        const resolved = resolveCatalogBodyPart(name);
        // The app's own rows answer first on the completion screen, as they
        // always did; the resolver is built on the generated list.
        if (resolved === null || extra.has(name.trim().toLowerCase())) {
          continue;
        }
        const [row] = buildMuscleFocus([{ exerciseName: name, sets: [done(0, 10)] }], RUNTIME_LIBRARY);
        if (row.name !== LABELS[resolved]) {
          disagreements.push(`${name}: bars ${row.name}, library ${resolved}`);
        }
      }
      assert.deepEqual(disagreements, []);
    },
  },
  {
    name: 'D4-3: the Recent shelf holds lifts logged under a ready programme spelling, under that spelling',
    run() {
      const sessions = [
        { id: 's1', performedAt: '2026-10-01T16:00:00.000Z' },
        { id: 's2', performedAt: '2026-10-03T16:00:00.000Z' },
      ];
      const log = (id, sessionId, name) => ({
        id,
        sessionId,
        exerciseTemplateId: null,
        exerciseNameSnapshot: name,
        weight: 60,
        repsPerSet: [5],
        tracked: true,
        orderIndex: 0,
      });
      const recent = getRecentExerciseLibraryItems({
        exerciseLibrary: RUNTIME_LIBRARY,
        exerciseLogs: [log('l1', 's1', 'Back Squat'), log('l2', 's2', 'Bench Press '), log('l3', 's2', 'Mystery Move')],
        workoutSessions: sessions,
        exerciseTemplates: [],
      });
      assert.deepEqual(recent.map((item) => item.name), ['Bench Press', 'Back Squat']);
      // The row lends what it knows; the name stays the one the history keeps.
      assert.equal(recent[1].bodyPart, 'legs');
      assert.equal(recent[1].id, resolveLibraryItem('Back Squat', RUNTIME_LIBRARY).id);
      // An exact library name is offered as the library row itself, as before.
      const exact = getRecentExerciseLibraryItems({
        exerciseLibrary: RUNTIME_LIBRARY,
        exerciseLogs: [log('l4', 's1', 'Romanian Deadlift')],
        workoutSessions: sessions,
        exerciseTemplates: [],
      });
      assert.deepEqual(exact.map((item) => item.name), ['Romanian Deadlift']);
    },
  },
  {
    name: 'D4-3: a Records row for Back Squat or Bench Press carries its body part; an unknown lift carries none',
    run() {
      assert.equal(libraryBodyPartOf('Back Squat', RUNTIME_LIBRARY), 'legs');
      assert.equal(libraryBodyPartOf('Bench Press', RUNTIME_LIBRARY), 'chest');
      assert.equal(libraryBodyPartOf('barbell bench press - medium grip', RUNTIME_LIBRARY), 'chest');
      assert.equal(libraryBodyPartOf('Mystery Move', RUNTIME_LIBRARY), null);
      // The reader's library speaks first: a row of their own keeps its tag.
      assert.equal(libraryBodyPartOf('Back Squat', [{ name: 'Back Squat', bodyPart: 'glutes' }]), 'glutes');
    },
  },
  {
    name: 'D4-2: a target saved over one stored under an older spelling replaces it, and removing removes every spelling',
    run() {
      // The matcher the goal flow and the Programs tab's remove pass (review R2).
      const sameLift = (left, right) => isSameTargetLift(left, right, LIBRARY_NAMES);
      const stored = normalizeStrengthGoals([
        { exerciseName: 'back squat', targetKg: 140, createdAt: '2026-08-01T00:00:00.000Z' },
        { exerciseName: 'Conventional Deadlift', targetKg: 180, createdAt: '2026-08-01T00:00:00.000Z' },
      ]);
      // Older spellings still load.
      assert.deepEqual(stored.map((goal) => goal.exerciseName), ['back squat', 'Conventional Deadlift']);

      const squat = upsertStrengthGoal(stored, { exerciseName: 'Barbell Squat', targetKg: 150, createdAt: 'x' }, sameLift);
      assert.deepEqual(
        squat.map((goal) => `${goal.exerciseName}=${goal.targetKg}`),
        ['Conventional Deadlift=180', 'Barbell Squat=150'],
      );
      const deadlift = upsertStrengthGoal(squat, { exerciseName: 'Barbell Deadlift', targetKg: 200, createdAt: 'x' }, sameLift);
      assert.deepEqual(deadlift.map((goal) => goal.exerciseName), ['Barbell Squat', 'Barbell Deadlift']);

      const twoSpellings = [
        { exerciseName: 'bench press', targetKg: 100, createdAt: 'x' },
        { exerciseName: 'Barbell Bench Press - Medium Grip', targetKg: 110, createdAt: 'x' },
        { exerciseName: 'Barbell Squat', targetKg: 150, createdAt: 'x' },
      ];
      assert.deepEqual(
        removeStrengthGoal(twoSpellings, 'Barbell Bench Press - Medium Grip', sameLift).map((goal) => goal.exerciseName),
        ['Barbell Squat'],
      );
      // Without a matcher the names are compared exactly, as before.
      assert.equal(upsertStrengthGoal(stored, { exerciseName: 'Barbell Squat', targetKg: 1, createdAt: 'x' }).length, 3);
      assert.equal(removeStrengthGoal(stored, 'back squat').length, 1);
    },
  },
  {
    // Review R2 of dup sweep 13: isSameLift folds a name into the library row
    // its substring search finds — "Calf Raise" into "Seated Calf Raise" (the
    // generated library), "Standing Calf Raise" into "Bodyweight Calf Raise"
    // (the app's) — so saving one target deleted the other. A target merges
    // only another spelling of its lift.
    name: 'D4-2: a target replaces another spelling of its lift, never another lift of its family',
    run() {
      const sameTarget = (left, right) => isSameTargetLift(left, right, LIBRARY_NAMES);
      const goals = [
        { exerciseName: 'Standing Calf Raise', targetKg: 80, createdAt: 'x' },
        { exerciseName: 'Barbell Squat', targetKg: 150, createdAt: 'x' },
      ];
      const saved = upsertStrengthGoal(goals, { exerciseName: 'Bodyweight Calf Raise', targetKg: 20, createdAt: 'y' }, sameTarget);
      assert.deepEqual(saved.map((goal) => goal.exerciseName), ['Standing Calf Raise', 'Barbell Squat', 'Bodyweight Calf Raise']);
      assert.deepEqual(
        removeStrengthGoal(saved, 'Bodyweight Calf Raise', sameTarget).map((goal) => goal.exerciseName),
        ['Standing Calf Raise', 'Barbell Squat'],
      );
      const generatedNames = GENERATED_EXERCISE_LIBRARY.map((item) => item.name);
      assert.ok(isSameLift('Calf Raise', 'Seated Calf Raise', generatedNames), 'the log matcher still folds it');
      assert.ok(!isSameTargetLift('Calf Raise', 'Seated Calf Raise', generatedNames), "the reviewer's pair");

      // Same lift, another spelling: merges.
      for (const [left, right] of [
        ['back squat', 'Barbell Squat'],
        ['Conventional Deadlift', 'Barbell Deadlift'],
        ['Bench Press', 'Barbell Bench Press - Medium Grip'],
        ['Barbell Row', 'Bent Over Barbell Row'],
        ['Front Squat', 'Front Barbell Squat'],
        ['Squat (Barbell)', 'Barbell Squat'],
      ]) {
        assert.ok(sameTarget(left, right), `${left} | ${right} should be one target`);
      }
      // A variant of the family: apart, though the log matcher folds the first.
      for (const [left, right] of [
        ['Standing Calf Raise', 'Bodyweight Calf Raise'],
        ['Sissy Squat', 'Weighted Sissy Squat'],
        ['Romanian Deadlift', 'Barbell Deadlift'],
        ['Barbell Incline Bench Press - Medium Grip', 'Barbell Bench Press - Medium Grip'],
        ['Front Barbell Squat', 'Barbell Squat'],
        ['Hack Squat', 'Barbell Squat'],
        ['Upright Barbell Row', 'Bent Over Barbell Row'],
      ]) {
        assert.ok(!sameTarget(left, right), `${left} | ${right} should be two targets`);
      }

      // Both writers pass the target matcher.
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
      assert.match(read('src', 'app', 'useGoalFlow.tsx'), /upsertStrengthGoal\([\s\S]{0,300}sameTarget,\s*\)/);
      assert.match(
        read('src', 'app', 'renderWorkoutTab.tsx'),
        /removeStrengthGoal\(current\.strengthGoals, exerciseName, \(left, right\) =>\s*isSameTargetLift\(/,
      );
    },
  },
  {
    name: 'D4-2: one stored target per spelling whatever its case, the first one kept',
    run() {
      const goals = normalizeStrengthGoals([
        { exerciseName: 'Bench Press', targetKg: 100, createdAt: 'a' },
        { exerciseName: 'bench press ', targetKg: 120, createdAt: 'b' },
      ]);
      assert.deepEqual(goals, [{ exerciseName: 'Bench Press', targetKg: 100, createdAt: 'a' }]);
    },
  },
  {
    name: 'D4-4: two spellings of one movement are one lift on a day; variants the library files apart are not',
    run() {
      assert.ok(holdsSameMovement(['Dumbbell Fly'], 'Dumbbell Flyes'));
      assert.ok(holdsSameMovement(['Seated Cable Row'], 'Seated Cable Rows'));
      assert.ok(holdsSameMovement(['Band Pull Apart'], 'Band Pull-Apart'));
      assert.ok(holdsSameMovement(['Leg Extension'], 'leg extensions'));
      assert.ok(!holdsSameMovement(['Bench Press'], 'Dumbbell Bench Press'));
      assert.ok(!holdsSameMovement([], 'Bench Press'));
    },
  },
  {
    name: 'D4-4: a folded day does not take a second spelling of a lift its neighbour holds',
    run() {
      const lift = (name, slotId) => ({ exerciseName: name, slotId, trackingMode: 'load_and_reps' });
      const { sessions } = foldThinSessions(
        [
          { id: 'a', name: 'a', exercises: [lift('Dumbbell Fly', 'c1'), lift('Push-Up', 'c2'), lift('Plank', 'c3')] },
          { id: 'b', name: 'b', exercises: [lift('Dumbbell Flyes', 'x1'), lift('Inverted Row', 'x2')] },
        ],
        (session) => session.exercises.length < 3,
      );
      assert.deepEqual(
        sessions[0].exercises.map((exercise) => exercise.exerciseName),
        ['Dumbbell Fly', 'Push-Up', 'Plank', 'Inverted Row'],
      );
    },
  },
  {
    name: "D4-4: a careful swap avoids a second spelling of a lift the day already holds while another swap is safe",
    run() {
      // The back as a focus asks for the bodyweight swap first: Inverted Row
      // for the barbell row. The day's "Rows (Bar or Rings)" IS the inverted
      // row (one library row), so the careful Chest-Supported Row is taken.
      const exercise = (name, slotId) => ({
        id: slotId,
        slotId,
        exerciseName: name,
        sets: 3,
        repsMin: 8,
        repsMax: 8,
        restSecondsMin: 90,
        restSecondsMax: 90,
        trackingMode: 'load_and_reps',
      });
      const day = [exercise('Barbell Row', 's1'), exercise('Rows (Bar or Rings)', 's2')];
      const flags = [{ area: 'lower_back', level: 'careful' }];
      const names = applyCautionFlagsToExercises(day, flags, ['back']).exercises.map((entry) => entry.exerciseName);
      assert.deepEqual(names, ['Chest-Supported Row', 'Rows (Bar or Rings)']);
      // With nothing like it on the day, the bodyweight swap stands.
      const alone = applyCautionFlagsToExercises([day[0]], flags, ['back']).exercises.map((entry) => entry.exerciseName);
      assert.deepEqual(alone, ['Inverted Row']);
    },
  },
  {
    name: "D4-5: an auto-named day takes the session hero's reading of its opening lift",
    run() {
      assert.equal(formatHomeSessionTitle('Day 1', [{ name: 'Step-Up' }]), 'Lower Focus');
      assert.equal(formatHomeSessionTitle('Day 1', [{ name: 'Rear Delt Fly' }]), 'Pull Focus');
      assert.equal(formatHomeSessionTitle('Day 1', [{ name: 'Kettlebell Swing' }]), 'Posterior Focus');
      assert.equal(formatHomeSessionTitle('Day 1', [{ name: 'Cable Pull-Through' }]), 'Posterior Focus');
      assert.equal(formatHomeSessionTitle('Day 1', [{ name: 'Rowing Machine HIIT' }]), 'Conditioning Focus');
      // Conditioning is asked before the hero's lower reading (review R2):
      // these read "Lower Focus" and "Full Body Focus".
      for (const name of [
        'Sprint Interval (200m)',
        'Sprint 40m',
        'Air Bike (30s sprint)',
        'High Knees',
        'Rowing Machine (500m intervals)',
      ]) {
        assert.equal(formatHomeSessionTitle('Day 1', [{ name }]), 'Conditioning Focus', name);
      }
      // A rowing exercise is still a pull.
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Barbell Row' }]), 'Pull Focus');
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Seated Cable Row' }]), 'Pull Focus');
      // Unchanged where the two already agreed.
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Back Squat' }]), 'Lower Focus');
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Bench Press' }]), 'Push Focus');
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Pull-Up' }]), 'Pull Focus');
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Romanian Deadlift' }]), 'Posterior Focus');
      assert.equal(formatHomeSessionTitle('Day 2', [{ name: 'Plank' }]), 'Full Body Focus');
    },
  },
  {
    name: 'D4-8: one answer to which swap group a name is in, for the custom adapter and the composer alike',
    run() {
      assert.equal(catalogSubstitutionGroupOf(' bench press '), 'horizontal_press');
      assert.equal(catalogSubstitutionGroupOf('Mystery Move'), null);
      assert.equal(catalogSubstitutionGroupOf(''), null);
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
        for (const name of group.allowedExerciseNames) {
          const first = WORKOUT_SUBSTITUTION_GROUPS.find((candidate) =>
            candidate.allowedExerciseNames.some((allowed) => allowed.trim().toLowerCase() === name.trim().toLowerCase()),
          );
          assert.equal(catalogSubstitutionGroupOf(name.toUpperCase()), first.id, name);
        }
      }
    },
  },
];
