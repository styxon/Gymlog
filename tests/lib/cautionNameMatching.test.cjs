const assert = require('node:assert/strict');

const { exerciseHitsCautionArea, applyCautionFlagsToExercises } = require('../../src/lib/cautionExerciseFilter');
const { GENERATED_EXERCISE_LIBRARY } = require('../../src/data/generatedExerciseLibrary');
const { EXTRA_EXERCISE_LIBRARY } = require('../../src/data/extraExerciseLibrary');
const { WORKOUT_TEMPLATES_V1, WORKOUT_SUBSTITUTION_GROUPS } = require('../../src/features/workout/workoutCatalog');

const AREAS = ['shoulders', 'lower_back', 'knees', 'elbows', 'wrists', 'hips', 'neck', 'ankles'];

// Every exercise name the app can show: the library, the extras, the ready
// catalog and its substitution pools.
function allExerciseNames() {
  const names = new Set();
  for (const item of [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]) names.add(item.name);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'exerciseName' && typeof value === 'string') names.add(value);
      else if (key === 'allowedExerciseNames' && Array.isArray(value)) value.forEach((name) => names.add(name));
      else walk(value);
    }
  };
  walk(WORKOUT_TEMPLATES_V1);
  walk(WORKOUT_SUBSTITUTION_GROUPS);
  return [...names];
}

const hits = (name, area) => exerciseHitsCautionArea(name, area);
const areasHit = (name) => AREAS.filter((area) => hits(name, area));

const MUST_HIT = {
  knees: ['Back Squat', 'Barbell Squat', 'Goblet Squat', 'Squats', 'Walking Lunge', 'Dumbbell Lunges', 'Leg Press', 'Leg Extension', 'Leg Extensions', 'Step-Up', 'Bulgarian Split Squat', 'Box Jump', 'Pistol Squat (each leg)'],
  elbows: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curls', 'Preacher Curl', 'EZ-Bar Curl', 'Skull Crusher', 'Triceps Pushdown', 'Rope Pushdown', 'Close-Grip Bench Press', 'Overhead Triceps Extension', 'Dips - Triceps Version', 'Weighted Dips', 'Bench Dips', 'Wrist Curl'],
  ankles: ['Standing Calf Raise', 'Seated Calf Raise', 'Calf Raises - With Bands', 'Treadmill HIIT (30s on / 30s off)', 'Running, Treadmill', 'Running', 'Treadmill Run', 'Easy Run Blocks', 'Tempo Run Blocks', 'Trail Running/Walking', 'Jogging, Treadmill', 'Rope Jumping', 'Jumping Jack', 'Box Jump', 'Fast Skipping', 'Wind Sprints', 'Sprint 40m'],
  lower_back: ['Deadlift', 'Barbell Deadlift', 'Romanian Deadlift', 'Sumo Deadlift', 'Good Morning', 'Barbell Row', 'Bent Over Barbell Row', 'Pendlay Row', 'Kettlebell Swing', 'Power Clean', 'Hang Clean', 'Snatch', 'Hyperextensions (Back Extensions)'],
  shoulders: ['Overhead Press', 'Standing Overhead Press', 'Dumbbell Shoulder Press', 'Arnold Press', 'Push Press', 'Standing Dumbbell Upright Row', 'Upright Barbell Row', 'Lateral Raise', 'Dumbbell Lateral Raise', 'Rear Delt Fly', 'Handstand Push-Ups', 'Dips - Chest Version', 'Weighted Dips', 'Bench Dips'],
  wrists: ['Barbell Curl', 'Push-Up', 'Push-Ups - Close Triceps Position', 'Front Squat', 'Wrist Curl', 'Handstand Push-Ups'],
  hips: ['Hip Thrust', 'Barbell Hip Thrust', 'Machine Hip Thrust', 'Sumo Deadlift', 'Sumo Squat', 'Thigh Adductor', 'Thigh Abductor', 'Bulgarian Split Squat', 'Pistol Squat (each leg)'],
  neck: ['Barbell Shrug', 'Dumbbell Shrug', 'Isometric Neck Exercise - Sides', 'Push Press - Behind the Neck'],
};

module.exports = [
  {
    name: 'cautionNameMatching: a pattern matches whole words, not the middle of one',
    run() {
      // 'run' is not in "crunch".
      for (const crunch of ['Crunch', 'Crunches', 'Cable Crunch', 'Bicycle Crunch', 'Decline Reverse Crunch', 'Ab Crunch Machine', 'Rope Crunch']) {
        assert.equal(hits(crunch, 'ankles'), false, `${crunch} must not hit ankles`);
      }
      assert.equal(hits("Runner's Stretch", 'ankles'), false);
      assert.equal(hits('Brunch', 'ankles'), false);

      // Simple inflections still match.
      assert.equal(hits('Run', 'ankles'), true);
      assert.equal(hits('Running', 'ankles'), true);
      assert.equal(hits('Treadmill Run', 'ankles'), true);
      assert.equal(hits('Jumping Lunges', 'knees'), true);
      assert.equal(hits('Dipping', 'shoulders'), true);
      assert.equal(hits('Lunges', 'knees'), true);
      assert.equal(hits('Dips', 'elbows'), true);
      // Hyphen and space are the same boundary in a name and in a pattern.
      assert.equal(hits('Step Ups', 'knees'), true);
      assert.equal(hits('Close Grip Bench Press', 'elbows'), true);
      assert.equal(hits('Bent Over Dumbbell Row', 'lower_back'), true);
    },
  },
  {
    name: 'cautionNameMatching: leg and hamstring curls do not load the elbow',
    run() {
      for (const lift of [
        'Leg Curl',
        'Lying Leg Curl',
        'Lying Leg Curls',
        'Seated Leg Curl',
        'Standing Leg Curl',
        'Ball Leg Curl',
        'Seated Band Hamstring Curl',
        'Nordic Hamstring Curl (Assisted)',
        'Lower Back Curl',
      ]) {
        assert.equal(hits(lift, 'elbows'), false, `${lift} must not hit elbows`);
      }
      // The arm curls still do, and an exclusion does not hide another pattern.
      assert.equal(hits('Dumbbell Curl', 'elbows'), true);
      assert.equal(hits('Seated Dumbbell Curl', 'elbows'), true);
      assert.equal(hits('Leg Curl and Triceps Pushdown', 'elbows'), true);
    },
  },
  {
    name: 'cautionNameMatching: lifts named after a grip, a bench or a machine stay out of the wrong area',
    run() {
      assert.equal(hits('Front Squat (Clean Grip)', 'lower_back'), false);
      assert.equal(hits('Front Squat (Clean Grip)', 'knees'), true);
      assert.equal(hits('Upright Barbell Row', 'lower_back'), false);
      assert.equal(hits('Upright Barbell Row', 'shoulders'), true);
      assert.equal(hits('Lying Cambered Barbell Row', 'lower_back'), false);
      assert.equal(hits('Calf Press On The Leg Press Machine', 'knees'), false);
      assert.equal(hits('Calf Press On The Leg Press Machine', 'ankles'), true);
      assert.equal(hits('Leg Press', 'knees'), true);
    },
  },
  {
    name: 'cautionNameMatching: sweep of every library and catalog name',
    run() {
      const names = allExerciseNames();
      assert.ok(names.length > 1000, `swept only ${names.length} names`);

      for (const name of names) {
        if (/crunch/i.test(name)) {
          assert.equal(hits(name, 'ankles'), false, `${name} must not hit ankles`);
        }
        if (/\b(leg|hamstring)\b.*\bcurl/i.test(name) || /\bnordic\b/i.test(name)) {
          assert.equal(hits(name, 'elbows'), false, `${name} must not hit elbows`);
        }
      }

      // Must-hit examples, by area. Each one must exist in the sweep too, so a
      // renamed catalog entry cannot quietly turn a pin into a no-op.
      const known = new Set(names);
      const synthetic = new Set(['Squats', 'Running', 'Treadmill Run', 'Hammer Curls', 'Leg Extensions', 'Dumbbell Lunges']);
      for (const [area, examples] of Object.entries(MUST_HIT)) {
        for (const name of examples) {
          assert.equal(hits(name, area), true, `${name} must hit ${area}`);
          if (!synthetic.has(name)) {
            assert.ok(known.has(name), `${name} is no longer an exercise name; update the pin`);
          }
        }
      }

      // The shoulder-and-elbow dip.
      assert.deepEqual(areasHit('Dips - Triceps Version').filter((a) => a === 'shoulders' || a === 'elbows'), ['shoulders', 'elbows']);
    },
  },
  {
    name: 'cautionNameMatching: a bench-supported bent-over lift is not a hinge; an unsupported one still is',
    run() {
      assert.equal(hits('Bent Over Dumbbell Rear Delt Raise With Head On Bench', 'lower_back'), false);
      assert.equal(hits('Chest-Supported Barbell Row', 'lower_back'), false);
      assert.equal(hits('Chest Supported Bent Over Row', 'lower_back'), false);
      // Unsupported bent-over work still loads the back, spelled either way.
      assert.equal(hits('Bent Over Low-Pulley Side Lateral', 'lower_back'), true);
      assert.equal(hits('Bent-Over Row', 'lower_back'), true);
      assert.equal(hits('Seated Bent-Over Rear Delt Raise', 'lower_back'), true);
      // The supported one is still a rear-delt lift.
      assert.equal(hits('Bent Over Dumbbell Rear Delt Raise With Head On Bench', 'shoulders'), true);
    },
  },
  {
    // The old substring rule caught these inside a reader's own Finnish names;
    // whole-word matching must not lose them (review, 2026-10-02).
    name: 'cautionNameMatching: Finnish names for dips and curls still hit, leg curls still do not hit elbows',
    run() {
      for (const name of ['Dippi', 'Dipit', 'Penkkidippi', 'Tricepsdipit', 'Lisäpainodipit', 'Dippi (painolla)']) {
        assert.equal(hits(name, 'shoulders'), true, `${name} must hit shoulders`);
        assert.equal(hits(name, 'elbows'), true, `${name} must hit elbows`);
      }
      for (const name of ['Hauiscurl', 'Vasaracurl', 'Curl', 'Hauiscurlit']) {
        assert.equal(hits(name, 'elbows'), true, `${name} must hit elbows`);
      }
      for (const name of [
        'Jalkacurl', 'Reisicurl', 'Takareisicurl', 'Reisicurlit', 'Jalkacurlit', 'Takareisicurlit',
        'Reisi curl', 'Jalka-curl', 'Takareisi curl', 'Seated Reisi Curl',
      ]) {
        assert.equal(hits(name, 'elbows'), false, `${name} must not hit elbows`);
      }
      // Whole-word still applies to the English ones.
      assert.equal(hits('Dipstick Row', 'shoulders'), false);
    },
  },
  {
    name: 'cautionNameMatching: a swap uses the same word rule as the hit test',
    run() {
      const exercise = (name) => ({
        id: `ex_${name}`,
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
      });
      const careful = (area) => [{ area, level: 'careful', refinements: [] }];
      const swapTo = (name, area) =>
        applyCautionFlagsToExercises([exercise(name)], careful(area)).exercises[0].exerciseName;

      assert.equal(swapTo('Back Squats', 'knees'), 'Box Squat');
      assert.equal(swapTo('Walking Lunges', 'knees'), 'Glute Bridge');
      assert.equal(swapTo('Deep Squat Hold', 'knees'), 'Supported Deep Squat Hold');
      assert.equal(swapTo('Dipit', 'shoulders'), 'Machine Chest Press');
      assert.equal(swapTo('Penkkidippi', 'shoulders'), 'Machine Chest Press');
      // A crunch is not an ankle lift, and a leg curl is not an elbow lift:
      // neither is held, swapped or removed.
      for (const [name, area] of [['Cable Crunch', 'ankles'], ['Seated Leg Curl', 'elbows']]) {
        const result = applyCautionFlagsToExercises([exercise(name)], [{ area, level: 'avoid', refinements: [] }]);
        assert.deepEqual(result.exercises.map((e) => e.exerciseName), [name]);
        assert.equal(result.removed.length, 0);
      }
      // The avoid still removes the real thing.
      const removed = applyCautionFlagsToExercises(
        [exercise('Barbell Curl'), exercise('Lying Leg Curl')],
        [{ area: 'elbows', level: 'avoid', refinements: [] }],
      );
      assert.deepEqual(removed.exercises.map((e) => e.exerciseName), ['Lying Leg Curl']);
    },
  },
];
