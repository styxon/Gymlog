const assert = require('node:assert/strict');

const { buildFocusEmphasisAdditions, getFocusEmphasisCount } = require('../../.test-dist/lib/focusEmphasis');
const { buildComposedFallbackExercise, composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer');
const { FOCUS_ACCESSORY_POOL } = require('../../.test-dist/lib/catalogExercisePools');
const { isRepsStretchName } = require('../../.test-dist/lib/holdExercises');
const { DEFAULT_MINUTES_PRESCRIPTION } = require('../../.test-dist/lib/minutesExercises');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog');
const { exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionExerciseFilter');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');

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

module.exports = [
  {
    name: 'focusEmphasis: big areas add two weekly accessories, small areas one',
    run() {
      assert.equal(getFocusEmphasisCount('chest'), 2);
      assert.equal(getFocusEmphasisCount('arms'), 1);

      const sessions = [session('a', ['Bench Press']), session('b', ['Barbell Row'])];
      const big = buildFocusEmphasisAdditions(sessions, ['chest']);
      assert.equal(big.additions.length, 2);
      assert.ok(big.additions.every((entry) => entry.area === 'chest'));

      const small = buildFocusEmphasisAdditions(sessions, ['arms']);
      assert.equal(small.additions.length, 1);
    },
  },
  {
    name: 'focusEmphasis: never duplicates a movement the session already holds',
    run() {
      // The first chest accessory in the pool, already sitting on session a.
      const sessions = [session('a', ['Incline Dumbbell Press']), session('b', ['Bench Press'])];
      const result = buildFocusEmphasisAdditions(sessions, ['chest']);

      const pressTargets = result.additions.filter((entry) => entry.exerciseName === 'Incline Dumbbell Press');
      assert.equal(pressTargets.length, 1);
      assert.equal(pressTargets[0].sessionId, 'b');
    },
  },
  {
    name: 'focusEmphasis: composed week contains the added accessories and reports them',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.daysPerWeek >= 4);
      assert.ok(template);

      const baseline = composeProgramWeekForSelection(
        selectionWith({ daysPerWeek: template.daysPerWeek, focusAreas: [] }),
        template.id,
      );
      const emphasized = composeProgramWeekForSelection(
        selectionWith({ daysPerWeek: template.daysPerWeek, focusAreas: ['chest'] }),
        template.id,
      );

      assert.ok(baseline && emphasized);
      const countExercises = (week) => week.sessions.reduce((sum, entry) => sum + entry.exercises.length, 0);
      assert.equal(countExercises(emphasized), countExercises(baseline) + emphasized.focusAdditions.length);
      assert.ok(emphasized.focusAdditions.length >= 1);
      assert.ok(emphasized.focusAdditions.every((entry) => entry.area === 'chest'));
    },
  },
  {
    name: 'focusEmphasis: caution flags veto emphasis — no banned movement sneaks in',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.daysPerWeek >= 3);
      assert.ok(template);

      const week = composeProgramWeekForSelection(
        selectionWith({
          daysPerWeek: template.daysPerWeek,
          focusAreas: ['legs'],
          cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }],
        }),
        template.id,
      );

      assert.ok(week);
      for (const entry of week.sessions) {
        for (const exercise of entry.exercises) {
          assert.equal(
            exerciseHitsCautionArea(exercise.exerciseName, 'knees'),
            false,
            `${exercise.exerciseName} must not stress avoided knees`,
          );
        }
      }
      // Reported additions only include survivors.
      for (const addition of week.focusAdditions) {
        assert.equal(exerciseHitsCautionArea(addition.exerciseName, 'knees'), false);
      }
    },
  },
  {
    name: 'focusEmphasis: an accessory is dosed in its own unit, as a suggested day doses the same name (bug hunt 2026-10-07)',
    run() {
      // Every accessory every focus area can add, in both variants. Emphasis
      // wrote "2 × 10-15" whatever the unit: an Elliptical Trainer was two
      // 15-minute bouts with a rest, a plank a 10-15 s hold. A suggested day
      // already dosed the same names by their unit; one rule now does both.
      const seen = { reps: 0, hold: 0, duration_minutes: 0 };
      for (const area of Object.keys(FOCUS_ACCESSORY_POOL)) {
        for (const equipment of [null, []]) {
          const sessions = [session('a', []), session('b', []), session('c', [])];
          const { bySessionId } = buildFocusEmphasisAdditions(sessions, [area], equipment);
          for (const rows of bySessionId.values()) {
            for (const row of rows) {
              const where = `${area} ${row.exerciseName}`;
              if (row.trackingMode === 'duration_minutes') {
                seen.duration_minutes += 1;
                assert.deepEqual(
                  [row.sets, row.repsMin, row.repsMax, row.restSecondsMin, row.restSecondsMax],
                  [DEFAULT_MINUTES_PRESCRIPTION.sets, DEFAULT_MINUTES_PRESCRIPTION.minutes, DEFAULT_MINUTES_PRESCRIPTION.minutes, 0, 0],
                  `${where}: one bout of minutes, no rest`,
                );
              } else if (row.trackingMode === 'hold') {
                seen.hold += 1;
                assert.ok(row.repsMin >= 20, `${where}: held for ${row.repsMin} s`);
              } else if (isRepsStretchName(row.exerciseName)) {
                // The cat-cow is dosed as the ready mobility programmes dose it.
                seen.reps += 1;
                assert.deepEqual([row.repsMin, row.repsMax], [6, 6], where);
                assert.ok(row.restSecondsMax <= 45, `${where}: ${row.restSecondsMax} s between cat-cows`);
              } else {
                seen.reps += 1;
                assert.deepEqual([row.repsMin, row.repsMax], [15, 15], where);
              }
              // A suggested day's accessory of the same name asks for the same numbers.
              const fallback = buildComposedFallbackExercise(row.exerciseName, 'x', 3);
              assert.equal(fallback.trackingMode, row.trackingMode, where);
              assert.deepEqual(
                [row.sets, row.repsMin, row.repsMax, row.restSecondsMin, row.restSecondsMax],
                [fallback.sets, fallback.repsMin, fallback.repsMax, fallback.restSecondsMin, fallback.restSecondsMax],
                `${where}: emphasis and a suggested day dose it alike`,
              );
            }
          }
        }
      }
      // Not empty loops: the pools hold each kind.
      assert.ok(seen.reps > 0 && seen.hold > 0 && seen.duration_minutes > 0, JSON.stringify(seen));

      const elliptical = buildFocusEmphasisAdditions([session('a', [])], ['conditioning'], null).bySessionId.get('a');
      assert.equal(elliptical[0].exerciseName, 'Elliptical Trainer');
      assert.deepEqual([elliptical[0].sets, elliptical[0].repsMin, elliptical[0].restSecondsMax], [1, 20, 0]);
    },
  },
  {
    name: 'focusEmphasis: a stretch on a suggested day is held as long as the editor holds one, not 10-15 s',
    run() {
      for (const name of ['All Fours Quad Stretch', 'Chin To Chest Stretch']) {
        const row = buildComposedFallbackExercise(name, 'x', 3);
        assert.equal(row.trackingMode, 'hold', name);
        assert.deepEqual([row.repsMin, row.repsMax], [30, 45], name);
      }
      // The plank keeps the 20-40 s a suggested day has always written.
      const plank = buildComposedFallbackExercise('Plank', 'x', 3);
      assert.deepEqual([plank.repsMin, plank.repsMax], [20, 40]);
    },
  },
  {
    name: 'focusEmphasis: core focus on a bodyweight-only week adds a plank held for at least 20 s',
    run() {
      let planks = 0;
      // Every programme onboarding can recommend.
      const recommendable = new Set(RECOMMENDATION_PROGRAMS.map((entry) => entry.programId));
      for (const template of WORKOUT_TEMPLATES_V1.filter((entry) => recommendable.has(entry.id))) {
        const week = composeProgramWeekForSelection(
          selectionWith({
            daysPerWeek: template.daysPerWeek,
            focusAreas: ['core'],
            trainingEnvironment: 'bodyweight_only',
            equipment: 'home',
          }),
          template.id,
        );
        if (!week) continue;
        for (const entry of week.sessions) {
          for (const exercise of entry.exercises) {
            if (exercise.slotId.startsWith('focus_accessory_') && exercise.exerciseName === 'Plank') {
              planks += 1;
              assert.ok(exercise.repsMin >= 20, `${template.id}: Plank held for ${exercise.repsMin} s`);
            }
          }
        }
      }
      assert.ok(planks > 0, 'no composed week added a core plank — the fixture no longer matches the report');
    },
  },
];
