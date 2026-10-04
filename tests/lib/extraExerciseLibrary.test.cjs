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
];
