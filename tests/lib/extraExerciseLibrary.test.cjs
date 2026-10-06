const assert = require('node:assert/strict');

const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { buildSwapOptionsForSlot } = require('../../.test-dist/lib/tailoringFit.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { getExerciseInstructions } = require('../../.test-dist/lib/exerciseInstructions.js');

module.exports = [
  {
    name: 'extras: the hip thrust machine is offered as a swap, and resolves to a real entry',
    run() {
      // The swap list under "Lantionnosto tangolla" offered the banded,
      // bodyweight and single-leg versions but not the machine standing in the
      // gym (user 2026-08-26).
      const options = buildSwapOptionsForSlot('hip_thrust_bridge', 'Barbell Hip Thrust', null);
      const names = options.map((option) => option.exerciseName);
      assert.ok(names.includes('Machine Hip Thrust'), `machine missing from ${names.join(', ')}`);
      // The lift already in the slot is never offered back.
      assert.ok(!names.includes('Barbell Hip Thrust'));

      // Being in the group is not enough: a name the library cannot place is a
      // row with no photo and no instructions.
      const library = createSeedExerciseLibrary();
      const index = findGuidedLibraryIndex(
        'Machine Hip Thrust',
        library.map((item) => item.name),
      );
      assert.ok(index !== null && index >= 0, 'the swap target must resolve to a library entry');
      assert.equal(library[index].name, 'Machine Hip Thrust');
      assert.equal(library[index].equipment, 'machine');
    },
  },
  {
    name: 'extras: it is named and instructed in Finnish, in its own words',
    run() {
      assert.equal(exerciseNameLabel('fi', 'Machine Hip Thrust'), 'Lantionnosto laitteessa');

      const entry = createSeedExerciseLibrary().find((item) => item.name === 'Machine Hip Thrust');
      const fi = getExerciseInstructions(entry.name, entry.instructions, 'fi');
      assert.equal(fi.length, entry.instructions.length, 'a Finnish entry matches the English step count');
      // Aliasing this to the barbell entry would have been cheaper and wrong:
      // its steps tell you to roll a loaded bar over your hips and pad it,
      // which is equipment this reader is deliberately not using.
      const barbell = getExerciseInstructions('Barbell Hip Thrust', [], 'fi');
      assert.ok(barbell.length > 0, 'the barbell entry is the one this must not be confused with');
      assert.notDeepEqual(fi, barbell);
      assert.ok(!fi.join(' ').toLowerCase().includes('rullaa'), fi.join(' '));
    },
  },
  {
    name: 'extras: they add to the library and never shadow it',
    run() {
      const generated = new Set(GENERATED_EXERCISE_LIBRARY.map((item) => item.name));
      const ids = new Set(GENERATED_EXERCISE_LIBRARY.map((item) => item.id));
      for (const item of EXTRA_EXERCISE_LIBRARY) {
        // An extra that duplicates a generated name would give one exercise two
        // entries, and the swap list would offer the same lift twice.
        assert.ok(!generated.has(item.name), `${item.name} is already in the generated library`);
        assert.ok(!ids.has(item.id), `${item.id} collides with a generated id`);
        // `exercise:sync` rewrites the generated file wholesale, so the prefix
        // is what makes a hand-added entry recognisable afterwards.
        assert.match(item.id, /^extra_/);
        assert.ok(item.instructions?.length, `${item.name} needs its own steps — there is no photo to fall back on`);
      }

      const seeded = createSeedExerciseLibrary();
      assert.equal(
        seeded.filter((item) => item.name === 'Machine Hip Thrust').length,
        1,
        'exactly one entry per extra reaches the app',
      );
    },
  },
  {
    // Bug hunt, 2026-10-04: "Bulgarian Split Squat" opened "Split Squats" (a
    // jumping bodyweight move) and "Arnold Press" opened the kettlebell version.
    name: 'demo aliases: Bulgarian Split Squat and Arnold Press open the lift they name',
    run() {
      const library = createSeedExerciseLibrary();
      const names = library.map((item) => item.name);
      const open = (name) => library[findGuidedLibraryIndex(name, names)];

      const bulgarian = open('Bulgarian Split Squat');
      assert.equal(bulgarian.name, 'Bulgarian Split Squat');
      assert.match(bulgarian.instructions.join(' '), /back foot/i);
      assert.ok(!/jump/i.test(bulgarian.instructions.join(' ')));
      // Bodyweight programmes prescribe it too: the dumbbells are conditional.
      assert.match(bulgarian.instructions[0], /if your programme logs a weight/);

      assert.equal(open('Arnold Press').name, 'Arnold Dumbbell Press');
      assert.equal(open('Kettlebell Arnold Press').name, 'Kettlebell Arnold Press');

      // The new targets speak Finnish, step for step.
      for (const target of [bulgarian, open('Arnold Press')]) {
        const fi = getExerciseInstructions(target.name, target.instructions, 'fi');
        assert.equal(fi.length, target.instructions.length, target.name);
        assert.notDeepEqual(fi, target.instructions, `${target.name} still English`);
      }
    },
  },
  {
    name: 'the seated-calf-raise fallback and the bodyweight calves pool need no equipment',
    run() {
      const { EQUIPMENT_FALLBACKS, isExerciseAllowedWithEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
      const { FOCUS_ACCESSORY_POOL } = require('../../.test-dist/lib/catalogExercisePools.js');
      const library = createSeedExerciseLibrary();
      const fallback = new Map(EQUIPMENT_FALLBACKS).get('seated calf raise');
      assert.ok(fallback && fallback.length > 0);
      for (const name of fallback) {
        const entry = library.find((item) => item.name === name);
        assert.ok(entry, `${name} is not a library entry`);
        assert.equal(entry.equipment, 'bodyweight', name);
        assert.ok(isExerciseAllowedWithEquipment(name, []), `${name} is refused with no equipment`);
        assert.ok(!/machine/i.test(entry.instructions.join(' ')), `${name}'s steps ask for a machine`);
      }
      // The machine the fallback used to land on is now refused without Machines.
      assert.equal(isExerciseAllowedWithEquipment('Donkey Calf Raises', []), false);
      assert.equal(isExerciseAllowedWithEquipment('Donkey Calf Raises', ['Machines']), true);
      for (const name of FOCUS_ACCESSORY_POOL.calves.bodyweight) {
        if (name === 'Calf Raises - With Bands') continue; // needs a band, which the pool's bodyweight variant already assumes
        assert.ok(isExerciseAllowedWithEquipment(name, []), `${name} in the bodyweight calves pool needs gear`);
      }
      assert.ok(!FOCUS_ACCESSORY_POOL.calves.bodyweight.includes('Donkey Calf Raises'));
      assert.equal(exerciseNameLabel('fi', 'Bodyweight Calf Raise'), 'Pohjenosto ilman painoa');
    },
  },
  {
    // Bug hunt, 2026-10-04: "Calf Raise" (26 rows) opened the seated calf
    // machine, "Standing Calf Raise" (10) the standing machine, and
    // "Single-Leg Calf Raise" (10) nothing at all.
    name: 'calf raises: the plain, standing and single-leg names open a demo that needs no machine',
    run() {
      const library = createSeedExerciseLibrary();
      const names = library.map((item) => item.name);
      for (const name of ['Calf Raise', 'Standing Calf Raise', 'Single-Leg Calf Raise']) {
        const index = findGuidedLibraryIndex(name, names);
        assert.ok(index !== null, `${name} resolves to nothing`);
        assert.equal(library[index].equipment, 'bodyweight', `${name} -> ${library[index].name}`);
      }
      // The machines stay reachable under their own names.
      assert.equal(library[findGuidedLibraryIndex('Seated Calf Raise', names)].name, 'Seated Calf Raise');
      // Without the extras the alias target is absent and nothing throws.
      const generatedOnly = GENERATED_EXERCISE_LIBRARY.map((item) => item.name);
      assert.doesNotThrow(() => findGuidedLibraryIndex('Calf Raise', generatedOnly));

      // Gym programmes load the same rows, so both languages say a weight is optional.
      for (const name of ['Bodyweight Calf Raise', 'Single-Leg Calf Raise']) {
        const entry = library.find((item) => item.name === name);
        assert.match(entry.instructions.join(' '), /optional/, name);
        const fi = getExerciseInstructions(name, entry.instructions, 'fi');
        assert.equal(fi.length, entry.instructions.length, `${name}: Finnish step count`);
        assert.match(fi.join(' '), /valinnaiset|valinnainen/, name);
      }
      assert.equal(exerciseNameLabel('fi', 'Single-Leg Calf Raise'), 'Yhden jalan pohjenosto');
    },
  },
  {
    // Bug hunt, 2026-10-04. A prescribed row that its programme lets a reader
    // do with no equipment must not open a demo that needs gear. The allow-list
    // is what is still wrong or deliberately accepted; every entry is a reason
    // to look, and a name that starts resolving correctly must leave it.
    name: 'catalogue: a row doable with no equipment never opens a demo that needs equipment',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const { isExerciseAllowedWithEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
      const library = createSeedExerciseLibrary();
      const names = library.map((item) => item.name);
      const ALLOW = new Map([
        // Intended: the library has one entry whose steps hold for both
        // (extraExerciseLibrary), filed under dumbbells because most rows load it.
        ['Bulgarian Split Squat', 'one entry, steps cover loaded and unloaded'],
        // Known mismatches, not fixed here: no bodyweight entry of the same
        // movement exists, so a demo with gear in its steps is the closest.
        ['Reverse Lunge', 'only a dumbbell rear lunge exists'],
        ['Bodyweight Reverse Lunge', 'only a dumbbell rear lunge exists'],
        ['Sumo Squat', 'only a dumbbell plie squat exists'],
        ['Pistol Squat (each leg)', 'only the kettlebell pistol squat exists'],
        ['Bulgarian Split Squat (Jumping)', 'stripped to the loaded split squat'],
        ['Sissy Squat', 'only the weighted sissy squat exists'],
        ['Standing Side Bend', 'only the dumbbell side bend exists'],
      ]);
      const rows = new Set();
      const walk = (value) => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (value && typeof value === 'object') {
          if (typeof value.exerciseName === 'string') rows.add(value.exerciseName);
          Object.values(value).forEach(walk);
        }
      };
      walk(WORKOUT_TEMPLATES_V1);
      assert.ok(rows.size > 200, 'the catalogue walk found its rows');
      const offenders = [];
      for (const name of rows) {
        if (!isExerciseAllowedWithEquipment(name, [])) continue;
        const index = findGuidedLibraryIndex(name, names);
        if (index === null || library[index].equipment === 'bodyweight') continue;
        if (!ALLOW.has(name)) offenders.push(`${name} -> ${library[index].name} (${library[index].equipment})`);
      }
      assert.deepEqual(offenders, []);
      for (const name of ALLOW.keys()) {
        assert.ok(rows.has(name), `allow-list entry ${name} is no longer in the catalogue`);
      }
    },
  },
];
