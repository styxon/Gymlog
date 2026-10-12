const assert = require('node:assert/strict');

const { cautionAreaLoadedBy, exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionAreaMatching.js');
const { applyCautionFlagsToExercises } = require('../../.test-dist/lib/cautionExerciseFilter.js');
const { GUIDED_LIBRARY_ALIASES } = require('../../.test-dist/lib/guidedPlayer.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState.js');

/** What the progression hold reads: the area a careful flag holds the lift for. */
const held = (name, area) => cautionAreaLoadedBy(name, [{ area, level: 'careful', refinements: [] }]) === area;

/**
 * Caution areas by name (progression hunt 12, A13-1/2/3, 2026-10-11).
 *
 * A reader who flags an area is promised that the app never adds weight to a
 * lift that loads it. The promise is kept by name, and it missed the same
 * lifts spelled the library's way: Standing Military Press, a jerk, a snatch,
 * Pike Push-Up, Cable Front Raise, Pushups, EZ-Bar Skullcrusher, Rack Pulls,
 * the Glute Bridge that the alias table already calls the same movement as a
 * Hip Thrust. Each of those got AUTO +2.5 kg under a careful flag.
 *
 * Hips and lower back widened on the owner's answer (2026-10-11): hips hold
 * the bridges, glute kickbacks, every lunge and the hip-hinge deadlifts; the
 * lower back holds rack pulls and the unsupported T-bar and bent-over rows.
 * Squats stay out of both, split squats and the plie included, and so do
 * step-ups. The widening is for the HOLD only: an `avoid` removes from the
 * week exactly what it removed before (HOLD_ONLY below).
 */
const MUST_HIT = {
  shoulders: [
    'Standing Military Press',
    'Seated Barbell Military Press',
    'Machine Shoulder (Military) Press',
    'Two-Arm Kettlebell Military Press',
    'Standing Barbell Press Behind Neck',
    'Bradford/Rocky Presses',
    'Standing Bradford Press',
    'Cuban Press',
    'Kettlebell Seesaw Press',
    'See-Saw Press (Alternating Side Press)',
    'Clean and Press',
    'Clean and Jerk',
    'Split Jerk',
    'Power Jerk',
    'Squat Jerk',
    'Jerk Balance',
    'Double Kettlebell Jerk',
    'Two-Arm Kettlebell Jerk',
    'One-Arm Kettlebell Clean and Jerk',
    'One-Arm Kettlebell Split Jerk',
    'Snatch',
    'Power Snatch',
    'Hang Snatch',
    'Split Snatch',
    'Snatch Balance',
    'Heaving Snatch Balance',
    'Double Kettlebell Snatch',
    'One-Arm Kettlebell Split Snatch',
    'Pike Push-Up',
    'Pike Push-Up (Elevated)',
    'Cable Front Raise',
    'Front Cable Raise',
    'Front Dumbbell Raise',
    'Front Incline Dumbbell Raise',
    'Front Plate Raise',
    'Front Two-Dumbbell Raise',
    'Standing Front Barbell Raise Over Head',
    'Standing Dumbbell Straight-Arm Front Delt Raise Above Head',
    'Side Laterals to Front Raise',
    'Alternating Deltoid Raise',
    'Standing Low-Pulley Deltoid Raise',
    'Landmine Press',
    'Standing Dumbbell Press',
    'Standing Alternating Dumbbell Press',
    'Standing Palm-In One-Arm Dumbbell Press',
    'Standing Palms-In Dumbbell Press',
    'Alternating Kettlebell Press',
    'Reverse Flyes',
    'Reverse Flyes With External Rotation',
    'Reverse Machine Flyes',
    'Sled Reverse Flye',
    'Reverse Pec Deck',
  ],
  wrists: ['Pushups', 'Pushups (Close and Wide Hand Positions)', 'Plyo Kettlebell Pushups', 'Front Barbell Squat'],
  elbows: ['EZ-Bar Skullcrusher'],
  lower_back: [
    'Rack Pulls',
    'Rack Pull with Bands',
    // The unsupported rows (owner, 2026-10-11).
    'T-Bar Row',
    'T-Bar Row with Handle',
    'Bent Over Two-Dumbbell Row',
    'Bent Over Barbell Row',
  ],
  hips: [
    // The alias twins of Hip Thrust, Bulgarian Split Squat and Sumo Squat.
    'Butt Lift (Bridge)',
    'Glute Bridge',
    'Single Leg Glute Bridge',
    'Banded Glute Bridge',
    'Glute Bridge Hold',
    // Owner, 2026-10-11: glute kickbacks, every lunge, the hip-hinge deadlifts.
    'Glute Kickback',
    'Cable Glute Kickback',
    'Cable Kickback',
    'One-Legged Cable Kickback',
    'Lateral Lunge',
    'Curtsy Lunge',
    'Crossover Reverse Lunge',
    'Reverse Lunge',
    'Walking Lunge',
    'Barbell Lunge',
    'Dumbbell Lunges',
    'Lunge Sprint',
    'Lunge Pass Through',
    'Kettlebell Turkish Get-Up (Lunge style)',
    'Romanian Deadlift',
    'Single-Leg RDL',
    'Deadlift',
    'Conventional Deadlift',
    'Sumo Deadlift',
    'Trap Bar Deadlift',
    'Stiff-Legged Barbell Deadlift',
    'Wide Stance Stiff Legs',
  ],
};

/** Names that share a word with the new patterns and do not load the area. */
const MUST_MISS = {
  shoulders: [
    'Snatch Pull',
    'Snatch Deadlift',
    'Snatch Shrug',
    'Clean Pull',
    'Front Squat (Clean Grip)',
    'Bench Press',
    'Seated Calf Raise',
    'Hanging Leg Raise',
    'Front Leg Raises',
    'Standing Cable Chest Press',
  ],
  // A sprint on a bike is seated: knees already veto it, and the alias table
  // sends both bike prescriptions to the plain Bike HIIT row.
  ankles: ['Bike HIIT (45s sprint / 15s rest)', 'Air Bike (30s sprint)', 'Bike HIIT'],
  // Not asked (owner, 2026-10-11): squats and step-ups, and a triceps kickback
  // is not a glute kickback.
  // Split squats and the plie are squats (owner, 2026-10-11).
  hips: [
    'Back Squat',
    'Front Squat',
    'Goblet Squat',
    'Step-Up',
    'Barbell Side Split Squat',
    'Smith Single-Leg Split Squat',
    'Suspended Split Squat',
    'Split Squats',
    'Split Squat with Dumbbells',
    'Plie Dumbbell Squat',
    'Tricep Dumbbell Kickback',
    'Cable Triceps Kickback',
    'Triceps Kickback',
  ],
  // Chest-supported rows stay vetoed, and squats are not added to the back.
  lower_back: ['Chest-Supported T-Bar Row', 'Lying T-Bar Row', 'Chest-Supported Row', 'Back Squat'],
};

/** Held under careful, left in the week under avoid (owner, 2026-10-11). */
const HOLD_ONLY = {
  hips: [
    'Glute Bridge',
    'Single Leg Glute Bridge',
    'Butt Lift (Bridge)',
    'Glute Kickback',
    'Cable Kickback',
    'Walking Lunge',
    'Lateral Lunge',
    'Curtsy Lunge',
    'Lunge Sprint',
    'Romanian Deadlift',
    'Deadlift',
    'Trap Bar Deadlift',
    'Single-Leg RDL',
    'Stiff-Legged Barbell Deadlift',
  ],
  lower_back: ['Rack Pulls', 'Rack Pull with Bands', 'T-Bar Row', 'T-Bar Row with Handle'],
};

const AREAS = ['shoulders', 'lower_back', 'knees', 'elbows', 'wrists', 'hips', 'neck', 'ankles'];

/**
 * Alias pairs the matcher may read differently, each with why. The alias
 * table is a demo table: it points a name at the row whose photo and steps
 * fit, which is not always a claim about the joint.
 */
const ALIAS_DISAGREEMENT_ALLOWED = new Set([
  // The burpee row's steps teach the push-up variant too, so the push-up
  // burpee opens it; a plain burpee is not prescribed a push-up and is not
  // a wrists lift (no owner ruling widens wrists).
  'wrists|burpee with push-up|burpee',
  // The owner counts split squats and the plie as squats, which hips do not
  // hold (2026-10-11); the Bulgarian and sumo names were hip lifts before
  // this hunt and the owner did not move them.
  'hips|bulgarian split squat|split squat with dumbbells',
  'hips|sumo squat|plie dumbbell squat',
]);

module.exports = [
  {
    name: 'hunt 12 A13: every must-hit name holds its caution area',
    run() {
      const missed = [];
      for (const [area, names] of Object.entries(MUST_HIT)) {
        for (const name of names) {
          if (!held(name, area)) {
            missed.push(`${area}: ${name}`);
          }
        }
      }
      assert.deepEqual(missed, []);
    },
  },
  {
    name: 'hunt 12 A13: the must-miss controls do not',
    run() {
      const hit = [];
      for (const [area, names] of Object.entries(MUST_MISS)) {
        for (const name of names) {
          if (held(name, area)) {
            hit.push(`${area}: ${name}`);
          }
        }
      }
      assert.deepEqual(hit, []);
    },
  },
  {
    name: 'hunt 12 A13: every alias pair (the same movement) agrees on every area',
    run() {
      const disagree = [];
      for (const [name, alias] of Object.entries(GUIDED_LIBRARY_ALIASES)) {
        for (const area of AREAS) {
          if (held(name, area) !== held(alias, area)) {
            const key = `${area}|${name}|${alias}`;
            if (!ALIAS_DISAGREEMENT_ALLOWED.has(key)) {
              disagree.push(key);
            }
          }
        }
      }
      assert.deepEqual(disagree, []);
      // An allowance whose pair agrees again is stale.
      for (const key of ALIAS_DISAGREEMENT_ALLOWED) {
        const [area, name, alias] = key.split('|');
        assert.equal(GUIDED_LIBRARY_ALIASES[name], alias, `${key} is not an alias pair`);
        assert.notEqual(held(name, area), held(alias, area), `${key} agrees now`);
      }
    },
  },
  {
    name: 'hunt 12 A13: careful and avoid hold a must-hit lift, info never does',
    run() {
      for (const [area, names] of Object.entries(MUST_HIT)) {
        for (const name of names) {
          const flag = (level) => [{ area, level, refinements: [] }];
          assert.equal(cautionAreaLoadedBy(name, flag('careful')), area, `${name} careful`);
          assert.equal(cautionAreaLoadedBy(name, flag('avoid')), area, `${name} avoid`);
          assert.equal(cautionAreaLoadedBy(name, flag('info')), null, `${name} info`);
        }
      }
    },
  },
  {
    // The owner's widening of hips and the lower back is for the hold only.
    name: 'hunt 12 A13-3: the widened hip and lower-back lifts are held under careful and stay in an avoid week',
    run() {
      const leaks = [];
      for (const [area, names] of Object.entries(HOLD_ONLY)) {
        for (const name of names) {
          if (!held(name, area)) leaks.push(`${area}: ${name} is not held under careful`);
          if (exerciseHitsCautionArea(name, area)) leaks.push(`${area}: ${name} reaches the avoid filter`);
          const week = applyCautionFlagsToExercises([{ exerciseName: name, trackingMode: 'load_and_reps' }], [
            { area, level: 'avoid', refinements: [] },
          ]);
          if (week.removed.length !== 0) leaks.push(`${area}: ${name} removed under avoid`);
        }
      }
      assert.deepEqual(leaks, []);
      // The filter's own hip and lower-back lifts are unchanged.
      for (const [name, area] of [
        ['Hip Thrust', 'hips'],
        ['Bulgarian Split Squat', 'hips'],
        ['Sumo Squat', 'hips'],
        ['Sumo Deadlift', 'hips'],
        ['Romanian Deadlift', 'lower_back'],
        ['Bent Over Barbell Row', 'lower_back'],
      ]) {
        assert.equal(exerciseHitsCautionArea(name, area), true, `${name} still in the ${area} filter`);
      }
    },
  },
  {
    // Pinned on the catalog as it was before this hunt: every session of every
    // ready programme filtered for a hips (or lower-back) avoid. A pattern
    // that also removes would show here as more rows and more thin days.
    name: 'hunt 12 A13-3: an avoid removes the same rows as before, and no new day drops under three lifts',
    run() {
      // The numbers of base 4191c04d (the filter's hip and lower-back name
      // sets over the whole library and catalog are identical to it). The two
      // thin hip days were thin before: Heavy Glutes Strength and the Hip
      // Opening Flow.
      //
      // Lower back went from four thin days to three on 2026-10-12 with the
      // same 122 removals: FIT Elite's Upper Power took treadmill intervals,
      // so when its barbell row and swings go it keeps three rows, not two.
      //
      // Hips went from 91 removals to 90 on 2026-10-12: Bodyweight
      // Upper/Lower's Day 4 gave its Frog Pump (a hip-avoid row) to a block of
      // High Knees, which the hips filter does not touch.
      //
      // Hips went back to 91 later the same day, through content and not a
      // pattern: WALK's Kneeling Hip Flexor and Standing Hip Abduction are
      // hip-avoid rows (+2), and Joint-Friendly Strength gave its Standing
      // Hip Abduction to a bike finisher (-1). No day went thin.
      //
      // Lower back went to 127 the same day, content again: HUGE Guided and
      // HUGE Home hinge with a stiff-legged dumbbell deadlift (three rows), a
      // cable pull-through and a bent-over row, all lower-back-avoid rows. Each
      // of their days keeps five lifts; no day went thin.
      //
      // Hips went to 92 and lower back to 131 the same day, content again:
      // HUGE Bodyweight's Hip Thrust (Bodyweight) is a hip-avoid row (+1 hips),
      // and its Single-Leg RDL (+1) and STRONG Home's two stiff-legged
      // dumbbell deadlifts and bent-over row (+3) are lower-back-avoid rows.
      // STRONG Home's hinge day keeps three lifts, not fewer; no day went thin.
      //
      // And to 133 the same day: SHRED Guided pulls through a cable on two of
      // its days, a lower-back-avoid row each. Its days keep four lifts or
      // more; none went thin.
      //
      // Hips went to 94 and lower back to 134 with STRONG Bodyweight, content
      // again: its Single Leg Glute Bridge on two days is a hip-avoid row (+2),
      // and its Single-Leg RDL (+1) is a lower-back-avoid row. Every day keeps
      // at least four lifts; no day went thin.
      const expected = { hips: { removed: 94, thin: 2 }, lower_back: { removed: 134, thin: 3 } };
      for (const area of Object.keys(expected)) {
        let removed = 0;
        let thin = 0;
        for (const template of WORKOUT_TEMPLATES_V1) {
          for (const session of template.sessions) {
            const week = applyCautionFlagsToExercises(session.exercises, [{ area, level: 'avoid', refinements: [] }]);
            removed += week.removed.length;
            if (week.exercises.length < 3 && session.exercises.length >= 3) thin += 1;
          }
        }
        assert.deepEqual({ removed, thin }, expected[area], area);
      }
    },
  },
  {
    // End to end through the reducer: the hold reaches the set screen, not just
    // the matcher. Each lift cleared its ceiling twice, so without the flag it
    // would climb 2.5 kg.
    name: 'hunt 12 A13: a lift under another name keeps its weight on the set screen',
    run() {
      const DAY_MS = 86400000;
      const now = Date.parse('2026-10-11T09:00:00.000Z');
      const start = (exerciseName, cautionFlags) => {
        const SLOT = 'slot_1';
        const entry = (daysAgo) => ({
          slotId: SLOT,
          templateId: 'tpl',
          templateName: 'Day',
          exerciseName,
          substitutionGroup: 'any',
          performedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
          sessionId: `sess-${daysAgo}`,
          sets: [0, 1, 2].map((setIndex) => ({
            setIndex,
            loadKg: 40,
            reps: 8,
            completedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
          })),
          skipped: false,
        });
        return workoutReducer(
          {
            ...workoutInitialState,
            history: { sessions: [], lastSelectedTemplateId: null, slotHistory: { [SLOT]: [entry(0), entry(3)] } },
          },
          {
            type: 'session/startFromRuntimeTemplate',
            payload: {
              template: {
                id: 'tpl',
                name: 'Day',
                defaultScheduleMode: 'weekday',
                sessions: [
                  {
                    id: 'day_a',
                    name: 'Day A',
                    orderIndex: 1,
                    exercises: [
                      {
                        id: 'ex_1',
                        exerciseName,
                        slotId: SLOT,
                        role: 'primary',
                        progressionPriority: 'high',
                        trackingMode: 'load_and_reps',
                        sets: 3,
                        repsMin: 5,
                        repsMax: 8,
                        restSecondsMin: 120,
                        restSecondsMax: 150,
                        substitutionGroup: 'any',
                      },
                    ],
                  },
                ],
              },
              sessionOrderIndex: 1,
              unitPreference: 'kg',
              progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', cautionFlags, nowMs: now },
            },
          },
        ).activeSession.exercises[0].sets[0];
      };
      for (const [name, area] of [
        ['Standing Military Press', 'shoulders'],
        ['Pushups', 'wrists'],
        ['Rack Pulls', 'lower_back'],
        ['Glute Bridge', 'hips'],
        ['Walking Lunge', 'hips'],
        ['Romanian Deadlift', 'hips'],
        ['T-Bar Row', 'lower_back'],
      ]) {
        assert.equal(start(name, []).plannedLoadKg, 42.5, `${name} climbs with no flag`);
        const held = start(name, [{ area, level: 'careful', refinements: [] }]);
        assert.equal(held.plannedLoadKg, 40, `${name} keeps its weight`);
        assert.equal(held.autoProgressedFromKg, undefined, `${name} has no AUTO`);
        assert.equal(held.heldForCautionArea, area, `${name} says which area`);
      }
    },
  },
];
