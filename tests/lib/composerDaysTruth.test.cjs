const assert = require('node:assert/strict');

const { buildFocusEmphasisAdditions } = require('../../.test-dist/lib/focusEmphasis');
const {
  FOCUS_ACCESSORY_POOL,
  isSameCatalogMovement,
  pickPoolVariant,
} = require('../../.test-dist/lib/catalogExercisePools');
const { isExerciseAllowedWithEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter');
const { buildComposedFallbackExercise, composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer');
const { isRepsStretchName } = require('../../.test-dist/lib/holdExercises');
const { exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionExerciseFilter');
const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require('../../.test-dist/lib/firstRunSetup');
const { buildRecommendationPlanReadyPayload } = require('../../.test-dist/lib/recommendationProgramme');
const { readyProgramWeek } = require('../../.test-dist/lib/programDetails');
const { WORKOUT_TEMPLATES_V1: ALL_TEMPLATES } = require('../../.test-dist/features/workout/workoutCatalog');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog');

// Every programme onboarding can recommend (a season programme is not one).
const RECOMMENDABLE = new Set(RECOMMENDATION_PROGRAMS.map((entry) => entry.programId));
const WORKOUT_TEMPLATES_V1 = ALL_TEMPLATES.filter((entry) => RECOMMENDABLE.has(entry.id));

/**
 * Composer days (persona hunt, round 3, 2026-10-08): a focus accessory that
 * repeats a lift the day already holds under another spelling, a recovery day
 * dosed like a lift day, a bodyweight reader's padded day, the shoulder flag
 * that missed the overhead presses, and a card quoting days the reader does
 * not run.
 */

function session(id, exerciseNames) {
  return {
    id,
    exercises: exerciseNames.map((name, index) => ({
      id: `${id}_${index}`,
      exerciseName: name,
      slotId: `slot_${index}`,
      role: 'primary',
      progressionPriority: 'high',
      trackingMode: 'load_and_reps',
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      restSecondsMin: 60,
      restSecondsMax: 120,
      substitutionGroup: 'none',
    })),
  };
}

function selectionWith(overrides) {
  return { ...DEFAULT_FIRST_RUN_SELECTION, availableDays: [], scheduleMode: 'app_managed', ...overrides };
}

const isFocusRow = (exercise) => exercise.slotId.startsWith('focus_accessory_');

module.exports = [
  {
    name: 'composer days: two spellings of one lift are one lift on a day',
    run() {
      for (const [a, b] of [
        ['Hip Thrust', 'Barbell Hip Thrust'],
        ['Cable Kickback', 'One-Legged Cable Kickback'],
        ['Dumbbell Fly', 'Dumbbell Flyes'],
        ['Glute Bridge', 'Butt Lift (Bridge)'],
      ]) {
        assert.equal(isSameCatalogMovement(a, b), true, `${a} / ${b}`);
        assert.equal(isSameCatalogMovement(b, a), true, `${b} / ${a}`);
      }
      // Variants the library files apart stay apart.
      assert.equal(isSameCatalogMovement('Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press'), false);
      assert.equal(isSameCatalogMovement('Leg Press', 'Barbell Squat'), false);
    },
  },
  {
    name: 'composer days: focus emphasis does not add the lift a template day holds under another name, and still adds what it promised',
    run() {
      const glute = buildFocusEmphasisAdditions([session('a', ['Hip Thrust', 'Cable Kickback'])], ['glutes'], null);
      const names = glute.additions.map((entry) => entry.exerciseName);
      assert.equal(names.length, 2, names.join(', '));
      for (const name of names) {
        assert.equal(isSameCatalogMovement(name, 'Hip Thrust'), false, name);
        assert.equal(isSameCatalogMovement(name, 'Cable Kickback'), false, name);
      }

      const chest = buildFocusEmphasisAdditions([session('a', ['Dumbbell Fly'])], ['chest'], null);
      assert.equal(chest.additions.length, 2);
      assert.ok(chest.additions.every((entry) => !isSameCatalogMovement(entry.exerciseName, 'Dumbbell Fly')));

      const bridge = buildFocusEmphasisAdditions([session('a', ['Glute Bridge'])], ['glutes'], []);
      assert.equal(bridge.additions.length, 2);
      assert.ok(bridge.additions.every((entry) => !isSameCatalogMovement(entry.exerciseName, 'Glute Bridge')));

      // A second glute day takes the pool's own first entries, as it always did.
      const two = buildFocusEmphasisAdditions(
        [session('a', ['Hip Thrust', 'Cable Kickback']), session('b', ['Barbell Squat', 'Romanian Deadlift'])],
        ['glutes'],
        null,
      );
      assert.deepEqual(
        two.additions.map((entry) => [entry.exerciseName, entry.sessionId]),
        [
          ['Barbell Hip Thrust', 'b'],
          ['One-Legged Cable Kickback', 'b'],
        ],
      );
    },
  },
  {
    name: 'composer days: no composed day holds a focus accessory beside the same lift, across every ready programme, focus area and gear',
    run() {
      const gears = [
        {},
        { trainingEnvironment: 'bodyweight_only', equipment: 'home' },
        { trainingEnvironment: 'home_gym', equipment: 'home', equipmentItems: ['Dumbbells', 'Resistance bands'] },
      ];
      const duplicates = [];
      let checked = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const area of Object.keys(FOCUS_ACCESSORY_POOL)) {
          for (const gear of gears) {
            const week = composeProgramWeekForSelection(
              selectionWith({ daysPerWeek: template.daysPerWeek, focusAreas: [area], ...gear }),
              template.id,
            );
            if (!week) continue;
            for (const day of week.sessions) {
              day.exercises.forEach((row, index) => {
                if (!isFocusRow(row)) return;
                checked += 1;
                day.exercises.forEach((other, otherIndex) => {
                  if (otherIndex !== index && isSameCatalogMovement(row.exerciseName, other.exerciseName)) {
                    duplicates.push(`${template.id} ${area} ${day.name}: ${other.exerciseName} + ${row.exerciseName}`);
                  }
                });
              });
            }
          }
        }
      }
      assert.ok(checked > 500, `only ${checked} focus rows were looked at`);
      assert.deepEqual(duplicates, []);
    },
  },
  {
    name: 'composer days: focus emphasis adds only what the reader\'s gear allows, so no gear swap lands a repeat beside it',
    run() {
      let additions = 0;
      for (const area of Object.keys(FOCUS_ACCESSORY_POOL)) {
        for (const gear of [[], ['Dumbbells'], ['Barbells', 'Bench'], ['Resistance bands']]) {
          const sessions = [session('a', ['Glute Bridge', 'Calf Raise']), session('b', ['Push-Up', 'Plank'])];
          for (const entry of buildFocusEmphasisAdditions(sessions, [area], gear).additions) {
            additions += 1;
            assert.equal(isExerciseAllowedWithEquipment(entry.exerciseName, gear), true, `${area} / ${gear.join('+') || 'no gear'}: ${entry.exerciseName}`);
          }
        }
      }
      assert.ok(additions > 40, String(additions));
      // The case from the sweep: a band good morning with no band came back as
      // a glute bridge beside the day's own.
      const hamstrings = buildFocusEmphasisAdditions([session('a', ['Glute Bridge'])], ['hamstrings'], []);
      assert.ok(hamstrings.additions.every((entry) => entry.exerciseName !== 'Band Good Morning'));
    },
  },
  {
    name: 'composer days: every pool entry past the promised count is a real lift the gear filter can read',
    run() {
      for (const [area, pool] of Object.entries(FOCUS_ACCESSORY_POOL)) {
        assert.equal(pool.bodyweight.length, pool.loaded.length, `${area}: swapped place for place`);
      }
      // The reserves exist where a template most often holds the lift already.
      for (const area of ['chest', 'back', 'shoulders', 'quads', 'legs', 'hamstrings']) {
        assert.ok(FOCUS_ACCESSORY_POOL[area].loaded.length >= 3, area);
      }
      assert.ok(FOCUS_ACCESSORY_POOL.glutes.loaded.length >= 4);
      // A loaded reserve that asks for gear must be refused to a reader with
      // none: a name the filter cannot read ("Pull Through") reached them.
      for (const area of ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes']) {
        const pool = FOCUS_ACCESSORY_POOL[area];
        for (const name of pool.loaded.slice(2)) {
          assert.equal(isExerciseAllowedWithEquipment(name, []), false, `${area}: ${name} passes for a reader with no gear`);
        }
        // And the gear a reader does have swaps a reserve for its bodyweight twin.
        assert.equal(pickPoolVariant(pool, []).length, pool.bodyweight.length, area);
      }
    },
  },
  {
    name: 'composer days: a cat-cow is dosed as the mobility programmes dose it, not as a lift',
    run() {
      assert.equal(isRepsStretchName('Cat Stretch'), true);
      assert.equal(isRepsStretchName('Plank'), false);
      assert.equal(isRepsStretchName('Hamstring Stretch'), false);

      const catStretch = buildComposedFallbackExercise('Cat Stretch', 'x', 0);
      assert.deepEqual([catStretch.repsMin, catStretch.repsMax], [6, 6]);
      assert.ok(catStretch.sets <= 3);
      assert.ok(catStretch.restSecondsMin >= 30 && catStretch.restSecondsMax <= 45, String(catStretch.restSecondsMax));
      // A lift on the same slot keeps the lift's bracket.
      const lift = buildComposedFallbackExercise('Push-Up Wide', 'x', 0);
      assert.deepEqual([lift.sets, lift.repsMax, lift.restSecondsMax], [3, 15, 120]);
    },
  },
  {
    name: 'composer days: no suggested day rests a stretch for longer than 45 s',
    run() {
      let stretches = 0;
      for (const template of WORKOUT_TEMPLATES_V1.filter((entry) => entry.daysPerWeek <= 3)) {
        for (const goal of ['general_fitness', 'muscle', 'lean_athletic', 'strength']) {
          for (const gear of [{}, { equipment: 'home', trainingEnvironment: 'bodyweight_only' }]) {
            const week = composeProgramWeekForSelection(
              selectionWith({ goal, goals: [goal], daysPerWeek: 6, ...gear }),
              template.id,
            );
            if (!week) continue;
            for (const day of week.sessions.filter((entry) => entry.source === 'suggested')) {
              for (const row of day.exercises.filter((entry) => isRepsStretchName(entry.exerciseName))) {
                stretches += 1;
                assert.ok(
                  row.restSecondsMax <= 45 && row.repsMax <= 8,
                  `${template.id} ${day.name}: ${row.exerciseName} ${row.sets} x ${row.repsMax} on ${row.restSecondsMax} s`,
                );
              }
            }
          }
        }
      }
      assert.ok(stretches > 10, `only ${stretches} stretches were looked at`);
    },
  },
  {
    name: 'composer days: a bodyweight-only muscle reader is padded with the bodyweight volume day, as the home reader is',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.daysPerWeek === 3);
      assert.ok(template);
      const firstPaddedDay = (equipment) =>
        buildRecommendationPlanReadyPayload(
          selectionWith({ goal: 'muscle', goals: ['muscle'], level: 'beginner', daysPerWeek: 5, equipment }),
          template.id,
        ).weeklySchedule.find((day) => day.source === 'suggested');

      assert.equal(firstPaddedDay('home').name, 'Bodyweight Volume Day');
      assert.equal(firstPaddedDay('minimal').name, 'Bodyweight Volume Day');
      assert.deepEqual(firstPaddedDay('minimal').keyLifts, firstPaddedDay('home').keyLifts);
      // The full gym keeps its own order.
      assert.notEqual(firstPaddedDay('gym').name, 'Bodyweight Volume Day');
    },
  },
  {
    name: 'composer days: shoulders flagged leaves no overhead press, seated dumbbell press or thruster in a ready programme',
    run() {
      for (const name of ['Seated Dumbbell Press', 'Kettlebell Seated Press', 'Dumbbell Thruster', 'Thruster']) {
        assert.equal(exerciseHitsCautionArea(name, 'shoulders'), true, name);
      }
      // Not a wider net than the press.
      for (const name of ['Dumbbell Bench Press', 'Barbell Squat', 'Seated Cable Rows']) {
        assert.equal(exerciseHitsCautionArea(name, 'shoulders'), false, name);
      }

      let seen = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        const holdsOne = template.sessions.some((entry) =>
          entry.exercises.some((exercise) => /seated dumbbell press|thruster/i.test(exercise.exerciseName)),
        );
        if (!holdsOne) continue;
        seen += 1;
        for (const level of ['avoid', 'careful']) {
          const week = composeProgramWeekForSelection(
            selectionWith({
              daysPerWeek: template.daysPerWeek,
              cautionFlags: [{ area: 'shoulders', level, refinements: [] }],
            }),
            template.id,
          );
          for (const day of week.sessions) {
            for (const row of day.exercises) {
              assert.doesNotMatch(
                row.exerciseName,
                /seated dumbbell press|thruster/i,
                `${template.id} (${level}) ${day.name}: ${row.exerciseName}`,
              );
            }
          }
        }
      }
      assert.ok(seen >= 5, `${seen} programmes hold one — the fixture no longer matches the report`);
    },
  },
  {
    name: 'composer days: a programme composed down to fewer days does not say it keeps the start at the catalog days',
    run() {
      // A beginner man, muscle, three days at the gym is handed a four-day
      // programme composed to three: "keeps this start at 4 days" beside a
      // three-day week was false.
      const selection = selectionWith({
        goal: 'muscle',
        goals: ['muscle'],
        level: 'beginner',
        daysPerWeek: 3,
        equipment: 'gym',
      });
      const recommendation = resolveFirstRunRecommendationWithTailoring(selection, null);
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === recommendation.featuredProgramId);
      assert.ok(template.daysPerWeek > 3, `${template.id} has ${template.daysPerWeek} days — the fixture no longer matches the report`);
      assert.doesNotMatch(recommendation.mismatchNote ?? '', /closest match|keeps this start/i);

      // A programme with fewer sessions than asked keeps its note: that one is true.
      const padded = resolveFirstRunRecommendationWithTailoring(
        selectionWith({ goal: 'strength', level: 'advanced', daysPerWeek: 5, equipment: 'gym' }),
        null,
      );
      assert.match(padded.mismatchNote ?? '', /closest match/i);
    },
  },
  {
    name: 'composer days: the Program page quotes the days the reader runs',
    run() {
      // The days the page quotes are the week it draws (readyProgramWeek, which
      // the "Why it fits" line reads through readyProgramFit): fewer sessions
      // than the catalog has, and the days a reader asked for beyond it, are
      // both what the page shows.
      const template = { daysPerWeek: 4, sessions: [] };
      const week = (days) => ({ days, sessions: Array.from({ length: days }, (_, index) => ({ id: `d${index}` })) });
      assert.equal(readyProgramWeek(template, week(3)).days, 3);
      assert.equal(readyProgramWeek(template, week(2)).days, 2);
      assert.equal(readyProgramWeek(template, week(5)).days, 5);
      assert.equal(readyProgramWeek(template, week(4)).days, 4);
      // Not the reader's programme: the catalog's own count.
      assert.equal(readyProgramWeek(template, null).days, 4);
      assert.equal(readyProgramWeek(template, undefined).days, 4);
    },
  },
  {
    name: 'composer days: no accessory pool entry passes a lower-back, knee or shoulder flag when its library row loads that area',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary');
      const { SUPPLEMENTAL_DAY_POOL } = require('../../.test-dist/lib/catalogExercisePools');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer');
      const libraryNames = GENERATED_EXERCISE_LIBRARY.map((item) => item.name);

      // Library primary muscle -> the flag that has to read the name. A stretch
      // is mobility work and not the lift the flag is about; the elliptical and
      // the recumbent bike load the quads without landing on the knee; the pull
      // apart, arm circles and ropes are light shoulder work, not a press.
      const areaOfMuscle = { 'lower back': 'lower_back', quadriceps: 'knees', shoulders: 'shoulders' };
      const lightLoad = new Set(['Elliptical Trainer', 'Recumbent Bike', 'Band Pull Apart', 'Arm Circles', 'Battling Ropes']);

      const names = new Set();
      for (const pool of [...Object.values(FOCUS_ACCESSORY_POOL), ...Object.values(SUPPLEMENTAL_DAY_POOL)]) {
        for (const name of [...pool.bodyweight, ...pool.loaded]) names.add(name);
      }
      const unflagged = [];
      let checked = 0;
      for (const name of names) {
        const index = findGuidedLibraryIndex(name, libraryNames);
        if (index === null) continue;
        const row = GENERATED_EXERCISE_LIBRARY[index];
        if (/stretch/i.test(name) || lightLoad.has(name)) continue;
        for (const muscle of row.primaryMuscles) {
          const area = areaOfMuscle[muscle];
          if (!area) continue;
          checked += 1;
          if (!exerciseHitsCautionArea(name, area)) unflagged.push(`${name} (${muscle}) is not read as ${area}`);
        }
      }
      assert.ok(checked >= 10, `${checked} rows checked: the pools or the library moved`);
      assert.deepEqual(unflagged, []);
    },
  },
  {
    name: 'composer days: a lower-back flag leaves no lower-back extension in a back-focus accessory, for any programme, gear or flag level',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer');
      const libraryNames = GENERATED_EXERCISE_LIBRARY.map((item) => item.name);
      const loadsLowerBack = (name) => {
        const index = findGuidedLibraryIndex(name, libraryNames);
        return index !== null && GENERATED_EXERCISE_LIBRARY[index].primaryMuscles.includes('lower back');
      };
      // The pool itself: nothing in the back pool is a lower-back lift.
      for (const name of [...FOCUS_ACCESSORY_POOL.back.bodyweight, ...FOCUS_ACCESSORY_POOL.back.loaded]) {
        assert.equal(loadsLowerBack(name), false, name);
      }
      const gears = [
        { trainingEnvironment: 'bodyweight_only', equipment: 'home' },
        { trainingEnvironment: 'home_gym', equipment: 'home', equipmentItems: ['Dumbbells', 'Resistance bands'] },
      ];
      let focusRows = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const level of ['avoid', 'careful']) {
          for (const gear of gears) {
            const week = composeProgramWeekForSelection(
              selectionWith({
                daysPerWeek: template.daysPerWeek,
                focusAreas: ['back'],
                cautionFlags: [{ area: 'lower_back', level, refinements: [] }],
                ...gear,
              }),
              template.id,
            );
            if (!week) continue;
            for (const day of week.sessions) {
              for (const row of day.exercises) {
                if (!isFocusRow(row)) continue;
                focusRows += 1;
                assert.equal(
                  loadsLowerBack(row.exerciseName),
                  false,
                  `${template.id} (${level}) ${day.name}: ${row.exerciseName}`,
                );
              }
            }
          }
        }
      }
      assert.ok(focusRows > 0, 'no focus rows composed: the fixture no longer exercises the pool');
    },
  },
];
