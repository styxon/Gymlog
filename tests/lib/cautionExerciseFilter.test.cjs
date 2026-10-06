const assert = require('node:assert/strict');

const {
  applyCautionFlagsToExercises,
  cautionAreaLoadedBy,
  exerciseHitsCautionArea,
  CAUTION_TO_FOCUS_AREAS,
  AREA_CAREFUL_SWAPS,
  AREA_BODYWEIGHT_SWAPS,
} = require('../../.test-dist/lib/cautionExerciseFilter');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');
const { trackingModeAfterSwap } = require('../../.test-dist/lib/catalogExercisePools');

function exercise(name, overrides = {}) {
  return {
    id: `ex_${name.replace(/\W+/g, '_').toLowerCase()}`,
    exerciseName: name,
    slotId: 'slot',
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    restSecondsMin: 60,
    restSecondsMax: 120,
    substitutionGroup: 'none',
    ...overrides,
  };
}

const AREA_LABELS = {
  shoulders: 'Shoulders',
  lower_back: 'Lower back',
  knees: 'Knees',
  elbows: 'Elbows',
  wrists: 'Wrists',
  hips: 'Hips',
  neck: 'Neck',
  ankles: 'Ankles',
};

module.exports = [
  {
    name: 'cautionExerciseFilter: avoid removes every exercise that stresses the area',
    run() {
      const result = applyCautionFlagsToExercises(
        [exercise('Back Squat'), exercise('Reverse Lunge'), exercise('Leg Press'), exercise('Bench Press')],
        [{ area: 'knees', level: 'avoid', refinements: [] }],
      );

      assert.deepEqual(
        result.exercises.map((entry) => entry.exerciseName),
        ['Bench Press'],
      );
      assert.equal(result.removed.length, 3);
      assert.ok(result.removed.every((entry) => entry.area === 'knees'));
    },
  },
  {
    name: 'cautionExerciseFilter: careful swaps to joint-friendly variants and keeps the prescription',
    run() {
      const result = applyCautionFlagsToExercises(
        [exercise('Back Squat', { sets: 4, repsMin: 5, repsMax: 8 }), exercise('Walking Lunge'), exercise('Bench Press')],
        [{ area: 'knees', level: 'careful', refinements: [] }],
      );

      const names = result.exercises.map((entry) => entry.exerciseName);
      assert.deepEqual(names, ['Box Squat', 'Glute Bridge', 'Bench Press']);
      assert.equal(result.exercises[0].sets, 4);
      assert.equal(result.exercises[0].repsMin, 5);
      // Glute Bridge reads as bodyweight work.
      assert.equal(result.exercises[1].trackingMode, 'bodyweight');
      assert.equal(result.swapped.length, 2);
    },
  },
  {
    name: 'cautionExerciseFilter: careful area picked as focus swaps bodyweight-first',
    run() {
      const result = applyCautionFlagsToExercises(
        [exercise('Back Squat'), exercise('Walking Lunge')],
        [{ area: 'knees', level: 'careful', refinements: [] }],
        ['quads'],
      );

      assert.deepEqual(
        result.exercises.map((entry) => entry.exerciseName),
        ['Bodyweight Squat', 'Bodyweight Walking Lunge'],
      );
      assert.ok(result.exercises.every((entry) => entry.trackingMode === 'bodyweight'));
    },
  },
  {
    name: 'cautionExerciseFilter: info flags change nothing and swaps never land on a banned exercise',
    run() {
      const info = applyCautionFlagsToExercises(
        [exercise('Back Squat')],
        [{ area: 'knees', level: 'info', refinements: [] }],
      );
      assert.equal(info.exercises[0].exerciseName, 'Back Squat');
      assert.equal(info.swapped.length, 0);

      // knees careful would swap Leg Press -> Hip Thrust, but hips avoid bans
      // hip thrusts — the original stays rather than swapping into a ban.
      const guarded = applyCautionFlagsToExercises(
        [exercise('Leg Press')],
        [
          { area: 'knees', level: 'careful', refinements: [] },
          { area: 'hips', level: 'avoid', refinements: [] },
        ],
      );
      assert.equal(guarded.exercises[0].exerciseName, 'Leg Press');
    },
  },
  {
    name: 'cautionExerciseFilter: composed week contains no avoided movements end to end',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) =>
        entry.sessions.some((session) =>
          session.exercises.some((item) => exerciseHitsCautionArea(item.exerciseName, 'knees')),
        ),
      );
      assert.ok(template, 'catalog should contain knee-stressing work');

      const week = composeProgramWeekForSelection(
        {
          ...DEFAULT_FIRST_RUN_SELECTION,
          daysPerWeek: template.daysPerWeek,
          availableDays: [],
          scheduleMode: 'app_managed',
          cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }],
        },
        template.id,
      );

      assert.ok(week);
      assert.ok(week.cautionRemoved.length > 0);
      for (const session of week.sessions) {
        for (const item of session.exercises) {
          assert.equal(
            exerciseHitsCautionArea(item.exerciseName, 'knees'),
            false,
            `${item.exerciseName} should not stress avoided knees`,
          );
        }
      }
    },
  },
  {
    name: 'cautionExerciseFilter: a careful knee never turns a timed hold into a lift',
    run() {
      // "Deep Squat Hold" 60–90 s became Box Squat (or Bodyweight Squat) with
      // the same 60–90 — ninety squats (2026-09-14). A hold goes to its
      // supported hold, or stays; its seconds never become reps.
      const careful = [{ area: 'knees', level: 'careful', refinements: [] }];
      const hold = exercise('Deep Squat Hold', { trackingMode: 'hold', repsMin: 60, repsMax: 90 });
      const supported = exercise('Supported Deep Squat Hold', { trackingMode: 'hold', repsMin: 20, repsMax: 40 });

      for (const focusAreas of [[], ['quads']]) {
        const result = applyCautionFlagsToExercises([hold], careful, focusAreas);
        const [first] = result.exercises;
        assert.equal(first.exerciseName, 'Supported Deep Squat Hold', `focus ${focusAreas}`);
        assert.equal(first.trackingMode, 'hold');
        assert.equal(first.repsMax, 90, 'the hold keeps its seconds');
        assert.deepEqual(result.swapped.map((swap) => swap.from), ['Deep Squat Hold']);

        // Already the supported version: nothing to swap to, nothing recorded.
        // And a day that has it already does not get it twice — the hold
        // keeps its place, as one with no swap does (bug hunt 2026-10-05, B7).
        const both = applyCautionFlagsToExercises([hold, supported], careful, focusAreas);
        assert.deepEqual(both.exercises.map((item) => item.exerciseName), ['Deep Squat Hold', 'Supported Deep Squat Hold']);
        assert.equal(both.exercises[0].trackingMode, 'hold');
        assert.deepEqual(both.swapped, []);
      }

      // A hold with no hold to swap to keeps its place rather than becoming a lift.
      const wallSit = exercise('Wall Sit Squat Hold', { trackingMode: 'hold', repsMin: 30, repsMax: 45 });
      const kept = applyCautionFlagsToExercises([wallSit], careful, []);
      assert.equal(kept.exercises[0].exerciseName, 'Wall Sit Squat Hold');
      assert.deepEqual(kept.swapped, []);

      // A loaded squat still swaps as before.
      assert.equal(applyCautionFlagsToExercises([exercise('Back Squat')], careful, []).exercises[0].exerciseName, 'Box Squat');
    },
  },
  {
    name: 'cautionExerciseFilter: no composed week swaps a hold into a lift',
    run() {
      const holdNames = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const item of session.exercises) {
            if (item.trackingMode === 'hold') holdNames.add(item.exerciseName);
          }
        }
      }
      const offenders = [];
      let composed = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const area of ['knees', 'hips', 'lower_back', 'shoulders', 'wrists', 'ankles']) {
          const selection = {
            ...DEFAULT_FIRST_RUN_SELECTION,
            cautionFlags: [{ area, level: 'careful', refinements: [] }],
          };
          let week;
          try {
            week = composeProgramWeekForSelection(selection, template.id);
          } catch (error) {
            // Seasons and other programmes onboarding never recommends.
            if (/Unknown recommendation programme/.test(String(error && error.message))) continue;
            throw error;
          }
          composed += 1;
          for (const swap of week?.cautionSwapped ?? []) {
            if (holdNames.has(swap.from) && !holdNames.has(swap.to)) {
              offenders.push(`${template.id}: ${swap.from} -> ${swap.to} (${area})`);
            }
          }
        }
      }
      assert.ok(composed > 100, `the sweep composed only ${composed} weeks`);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'cautionExerciseFilter: every swap this filter can produce tracks the way the library says',
    run() {
      // Tracking mode used to be guessed from words in the REPLACEMENT's name
      // (a short list: "bodyweight", "push-up", "glute bridge", "inverted row",
      // "plank", "mountain climber") rather than read from the exercise it
      // names. "Bench Dips" flagged for shoulders swapped to "Machine Chest
      // Press" and kept `bodyweight` — a machine lift with no kg field — because
      // "machine chest press" matches none of those words (found 2026-09-26).
      //
      // This sweeps every [pattern, replacement] pair in both swap tables,
      // under every tracking mode a real exercise could carry that name with,
      // and checks the filter's answer against trackingModeAfterSwap — the
      // same rule the live player and Home use for every other swap, grounded
      // in the ready programmes' own prescriptions and the generated library's
      // equipment field, not in the replacement's spelling.
      const startingModes = ['load_and_reps', 'reps_first', 'bodyweight', 'hold'];
      const tables = [
        ['careful', AREA_CAREFUL_SWAPS, []],
        ['focus', AREA_BODYWEIGHT_SWAPS, null],
      ];

      const offenders = [];
      let swept = 0;

      for (const [kind, table] of tables) {
        for (const [area, entries] of Object.entries(table)) {
          const focusAreas = kind === 'focus' ? CAUTION_TO_FOCUS_AREAS[area] : [];
          for (const [pattern, to] of entries) {
            for (const trackingMode of startingModes) {
              const result = applyCautionFlagsToExercises(
                [exercise(pattern, { trackingMode })],
                [{ area, level: 'careful', refinements: [] }],
                focusAreas,
              );
              const swap = result.swapped.find((entry) => entry.to === to);
              // Not every [pattern, mode] combination reaches this table's
              // swap (a hold pattern into a non-hold replacement is guarded
              // off elsewhere) — that guard has its own test above.
              if (!swap) continue;

              swept += 1;
              const got = result.exercises[0].trackingMode;
              const want = trackingModeAfterSwap(trackingMode, to);
              if (got !== want) {
                offenders.push(`${area}/${kind}: ${pattern} (${trackingMode}) -> ${to}: got ${got}, want ${want}`);
              }
            }
          }
        }
      }

      assert.ok(swept > 50, `the sweep only produced ${swept} swaps`);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'cautionAreaLoadedBy: careful and avoid name the area a lift loads, info names nothing',
    run() {
      const flag = (area, level) => ({ area, level, refinements: [] });
      assert.equal(cautionAreaLoadedBy('Back Squat', [flag('knees', 'careful')]), 'knees');
      assert.equal(cautionAreaLoadedBy('Back Squat', [flag('knees', 'avoid')]), 'knees');
      assert.equal(cautionAreaLoadedBy('Back Squat', [flag('knees', 'info')]), null);
      assert.equal(cautionAreaLoadedBy('Back Squat', [flag('shoulders', 'careful')]), null);
      assert.equal(cautionAreaLoadedBy('Back Squat', []), null);
      assert.equal(cautionAreaLoadedBy('Back Squat', undefined), null);

      // The filter's knee-friendly swaps: one still loads the knee and is
      // held, the other spares it and progresses as usual.
      const knees = [flag('knees', 'careful')];
      const swapped = applyCautionFlagsToExercises(
        [
          { ...WORKOUT_TEMPLATES_V1[0].sessions[0].exercises[0], exerciseName: 'Back Squat' },
          { ...WORKOUT_TEMPLATES_V1[0].sessions[0].exercises[0], exerciseName: 'Leg Press' },
        ],
        knees,
      ).exercises.map((exercise) => exercise.exerciseName);
      assert.deepEqual(swapped, ['Box Squat', 'Hip Thrust']);
      assert.equal(cautionAreaLoadedBy('Box Squat', knees), 'knees');
      assert.equal(cautionAreaLoadedBy('Hip Thrust', knees), null);

      // The first flag that matches is the one named.
      assert.equal(
        cautionAreaLoadedBy('Dip', [flag('shoulders', 'careful'), flag('elbows', 'careful')]),
        'shoulders',
      );
    },
  },
];
