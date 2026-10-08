const assert = require('node:assert/strict');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const { exerciseMechanic } = require('../../.test-dist/lib/exerciseClassification.js');
const { displayEquipmentValue } = require('../../.test-dist/lib/libraryLabel.js');

/**
 * Every library row's classification, swept by rule (#bugs 2026-10-06,
 * "kaikki filtterit uusiksi"). The reader found cable hip adduction in
 * "Etureidet" and the leg extension missing from "Eristävä"; each was one
 * row of a family the source files consistently, so the family is the test:
 * a name that says what it trains, how many joints it moves, or what it is
 * done with has to agree with the row. Every row a rule lets stand is named,
 * with the reason — the next wrong row fails here, not on the phone.
 *
 * Stretches and cardio are out of scope: the source names a muscle for the
 * treadmill, and no chip lists either as training.
 */
const library = createSeedExerciseLibrary();
const trained = library.filter((item) => item.sourceCategory !== 'stretching' && item.category !== 'cardio');
const names = (rows) => rows.map((item) => item.name);

/** [rule, name pattern, primary muscles any of which the row must name]. */
const MUSCLE_RULES = [
  ['curl', /\bcurls?\b/i, ['biceps', 'forearms', 'hamstrings']],
  ['calf raise / press', /\bcalf (raises?|press)\b|calf raise/i, ['calves']],
  ['leg press', /\bleg press\b/i, ['quadriceps']],
  ['leg extension', /\bleg extensions?\b/i, ['quadriceps']],
  ['fly', /\b(fly|flys|flye|flyes|flies)\b|pec deck|butterfly|cross ?over/i, ['chest', 'shoulders']],
  ['row', /\brows?\b/i, ['lats', 'middle back', 'traps', 'shoulders']],
  ['squat', /\bsquats?\b/i, ['quadriceps', 'glutes', 'hamstrings']],
  ['lunge', /\blunges?\b/i, ['quadriceps', 'glutes', 'hamstrings']],
  ['bench press', /\bbench press\b/i, ['chest', 'triceps']],
  ['shoulder press', /shoulder press|military press|overhead press|arnold/i, ['shoulders']],
  ['delt raise', /lateral raise|front raise|rear delt|side lateral/i, ['shoulders']],
  ['triceps', /pushdown|tricep|skull ?crusher|french press/i, ['triceps']],
  ['shrug', /\bshrugs?\b/i, ['traps']],
  ['pull-up / pulldown', /pulldown|pull-?ups?\b|chin-?ups?\b|\bchins?\b/i, ['lats', 'middle back', 'biceps']],
  ['crunch / sit-up', /\bcrunch(es)?\b|sit-?ups?\b/i, ['abdominals']],
  ['deadlift', /deadlift|\brdl\b/i, ['hamstrings', 'lower back', 'quadriceps', 'glutes']],
  ['hip thrust / bridge', /hip thrust|glute bridge|glute kickback/i, ['glutes', 'hamstrings']],
  ['adduction', /\badduct/i, ['adductors']],
  ['abduction', /\babduct/i, ['abductors']],
  ['dip', /\bdips?\b/i, ['triceps', 'chest']],
  ['push-up', /push-?ups?\b|pushups?/i, ['chest', 'triceps', 'shoulders']],
  ['good morning', /good morning/i, ['hamstrings', 'lower back']],
  ['back extension', /hyperextension|back extension/i, ['lower back', 'hamstrings', 'glutes']],
  ['wrist', /\bwrist\b/i, ['forearms']],
  ['plank', /\bplank\b/i, ['abdominals']],
];

/** Rows a muscle rule matches by a word that is not the movement. */
const MUSCLE_RULE_EXCEPTIONS = {
  // Calves, on the leg press machine.
  'Calf Press On The Leg Press Machine': 'leg press',
  // A jump, not a cable crossover.
  'Stride Jump Crossover': 'fly',
  // Turkish get-ups: a loaded shoulder held overhead while you stand.
  'Kettlebell Turkish Get-Up (Squat style)': 'squat',
  'Kettlebell Turkish Get-Up (Lunge style)': 'lunge',
  // The raise is half of a pullover, filed with the chest.
  'Front Raise And Pullover': 'delt raise',
  // A straight-arm lat pushdown, not a triceps one.
  'Cable Incline Pushdown': 'triceps',
  // A scapular retraction, filed with the middle back.
  'Middle Back Shrug': 'shrug',
  // "Chin" the body part; and a scapular pull-up is the traps.
  'Gorilla Chin/Crunch': 'pull-up / pulldown',
  'Lying Close-Grip Barbell Triceps Press To Chin': 'pull-up / pulldown',
  'Scapular Pull-Up': 'pull-up / pulldown',
  // The dip of a jerk is a quarter squat.
  'Jerk Dip Squat': 'dip',
  // A push-up that turns into a side plank, filed with the push-up.
  'Push Up to Side Plank': 'plank',
};

/** One joint, by name — and the rows where the word is not the movement. */
const ISOLATION_NAME = /\bcurls?\b|lateral raise|front raise|\b(fly|flys|flye|flyes|flies)\b|leg extension|triceps? extension|kickback|\bshrugs?\b|calf raise|\bwrist\b|pushdown|cross ?over|pec deck/i;
const ISOLATION_NAME_EXCEPTIONS = new Set([
  // The shrug at the top of an Olympic pull: the whole pull, finished high.
  'Clean Shrug',
  'Snatch Shrug',
  // A raise and a pullover in one rep.
  'Front Raise And Pullover',
  // A jump.
  'Stride Jump Crossover',
]);
/** Several joints, by name — and the rows where the word is not the movement. */
const COMPOUND_NAME = /squat|\bpress\b|\brows?\b|deadlift|pull-?ups?\b|pullups?\b|chin-?ups?\b|\bdips?\b|\blunges?\b|\bclean\b|snatch|push-?ups?\b|pushups?\b|thrust|step[- ]?ups?\b|good morning|pulldown/i;
const COMPOUND_NAME_EXCEPTIONS = new Set([
  // Triceps "presses" are elbow extensions.
  'Body Tricep Press',
  'Lying Triceps Press',
  'Seated Triceps Press',
  'Tate Press',
  'Lying Close-Grip Barbell Triceps Press To Chin',
  // Calf "presses" move the ankle.
  'Calf Press',
  'Calf Press On The Leg Press Machine',
  // Straight-arm pulldowns move the shoulder alone.
  'Straight-Arm Pulldown',
  'Rope Straight-Arm Pulldown',
  // The shoulder blades, not the elbows.
  'Scapular Pull-Up',
]);

/** Equipment a name states, and the displayed value it has to agree with. */
const GEAR_IN_NAME = [
  ['barbell', /\bbarbell\b/i],
  ['dumbbell', /\bdumbbells?\b/i],
  ['kettlebells', /\bkettlebells?\b/i],
  ['cable', /\bcable\b|\bpulley\b/i],
  ['machine', /\bmachine\b|\bsmith\b|\bleverage\b/i],
  ['band', /\bbands?\b/i],
];
const GEAR_EXCEPTIONS = {
  // A push-up with one hand on a dumbbell for a handle.
  'Close-Grip Push-Up off of a Dumbbell': 'dumbbell',
};

module.exports = [
  {
    name: 'library sweep: a name that says what it trains agrees with the row\'s primary muscles',
    run() {
      const wrong = [];
      for (const [rule, pattern, muscles] of MUSCLE_RULES) {
        for (const item of trained) {
          if (!pattern.test(item.name) || MUSCLE_RULE_EXCEPTIONS[item.name] === rule) continue;
          if (!(item.primaryMuscles ?? []).some((muscle) => muscles.includes(muscle))) {
            wrong.push(`${item.name} (${rule}): ${(item.primaryMuscles ?? []).join('/')}`);
          }
        }
      }
      assert.deepEqual(wrong, []);
      // Every exception still matches its rule; a stale one is deleted, not kept.
      for (const [name, rule] of Object.entries(MUSCLE_RULE_EXCEPTIONS)) {
        const item = trained.find((entry) => entry.name === name);
        assert.ok(item, `${name} is no longer in the library`);
        const [, pattern, muscles] = MUSCLE_RULES.find(([label]) => label === rule);
        assert.ok(pattern.test(name), `${name} no longer matches "${rule}"`);
        assert.equal((item.primaryMuscles ?? []).some((muscle) => muscles.includes(muscle)), false, `${name} needs no exception`);
      }
    },
  },
  {
    name: 'library sweep: a name that says how many joints it moves agrees with the row\'s mechanic',
    run() {
      const isolationAsCompound = trained.filter(
        (item) => exerciseMechanic(item) === 'compound' && ISOLATION_NAME.test(item.name) && !ISOLATION_NAME_EXCEPTIONS.has(item.name),
      );
      assert.deepEqual(names(isolationAsCompound), []);
      const compoundAsIsolation = trained.filter(
        (item) =>
          exerciseMechanic(item) === 'isolation' &&
          item.category !== 'core' &&
          COMPOUND_NAME.test(item.name) &&
          !COMPOUND_NAME_EXCEPTIONS.has(item.name),
      );
      assert.deepEqual(names(compoundAsIsolation), []);
      // The corrected rows, by name, as the reader's chips see them.
      for (const name of ['Incline Dumbbell Flyes', 'Drag Curl', 'Glute Kickback', 'Band Curl']) {
        const item = library.find((entry) => entry.name === name);
        assert.equal(item.category, 'isolation', name);
        assert.equal(browse.matchesExerciseTypeFilter(item, 'isolation'), true, name);
      }
      const row = library.find((entry) => entry.name === 'Alternating Kettlebell Row');
      assert.equal(row.category, 'compound');
    },
  },
  {
    name: 'library sweep: a name that says what it is done with agrees with the row\'s equipment',
    run() {
      const wrong = [];
      for (const item of library) {
        const shown = displayEquipmentValue(item);
        for (const [gear, pattern] of GEAR_IN_NAME) {
          if (!pattern.test(item.name) || shown === gear || GEAR_EXCEPTIONS[item.name] === gear) continue;
          // A loaded lift that adds bands or a ball keeps its load; a lift
          // named for a barbell and done on a machine or cable is the
          // machine's ("Smith Machine Bench Press", "V-Bar Pulldown").
          if (gear === 'band' && shown !== 'bodyweight') continue;
          if (gear === 'barbell' && (shown === 'machine' || shown === 'cable')) continue;
          if (gear === 'dumbbell' && shown === 'kettlebells') continue;
          if (/\bit band\b/i.test(item.name)) continue;
          wrong.push(`${item.name}: says ${gear}, shows ${shown}`);
        }
      }
      assert.deepEqual(wrong, []);
      assert.equal(displayEquipmentValue(library.find((entry) => entry.name === 'Smith Incline Shoulder Raise')), 'machine');
    },
  },
  {
    name: 'library sweep: every row\'s body part is the one its primary muscles give',
    run() {
      // The generator's own mapping (scripts/generate_free_exercise_library.mjs,
      // mapBodyPart), so a correction that moves a muscle has to move the body
      // part with it, or say why not.
      const bodyPartOf = (muscles) => {
        const has = (values) => values.some((value) => muscles.includes(value));
        if (has(['abdominals', 'obliques'])) return 'core';
        if (has(['glutes'])) return 'glutes';
        if (has(['quadriceps', 'hamstrings', 'calves', 'abductors', 'adductors'])) return 'legs';
        if (has(['pectorals', 'chest'])) return 'chest';
        if (has(['middle back', 'lats', 'lower back', 'traps'])) return 'back';
        if (has(['shoulders'])) return 'shoulders';
        if (has(['biceps', 'forearms'])) return 'biceps';
        if (has(['triceps'])) return 'triceps';
        // The generator has no body part for the neck and says "full body";
        // the app files it with the back, beside the traps.
        if (has(['neck'])) return 'back';
        return 'full body';
      };
      // The app's own rows, filed by hand where two muscles share the work:
      // the swing, the burpee and the jumping jack as whole-body work, the split
      // squat with the legs.
      const ownRows = new Set(['Kettlebell Swing', 'Bulgarian Split Squat', 'Reverse Lunge', 'Burpee', 'Jumping Jack']);
      const wrong = library.filter(
        (item) => !ownRows.has(item.name) && bodyPartOf(item.primaryMuscles ?? []) !== item.bodyPart,
      );
      assert.deepEqual(wrong.map((item) => `${item.name}: ${item.bodyPart} <- ${(item.primaryMuscles ?? []).join('/')}`), []);
    },
  },
];
