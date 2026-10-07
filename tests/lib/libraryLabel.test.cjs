const assert = require('node:assert/strict');

const { displayEquipmentValue, libraryLabel } = require('../../.test-dist/lib/libraryLabel.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

/** Every distinct value a library field takes, so the test tracks the data. */
function distinct(field) {
  const values = new Set();
  for (const item of library) {
    const raw = item[field];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value) {
        values.add(value);
      }
    }
  }
  return [...values];
}

/** Title-cased English is the fallback — the exact thing the map exists to avoid. */
function looksUntranslated(raw, label) {
  const titleCased = raw
    .split(/[_\s/()-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return label === titleCased;
}

module.exports = [
  {
    name: 'every muscle name in the library has a Finnish label',
    run() {
      // The exercise detail card and the how-to sheet listed "Quadriceps",
      // "Hamstrings", "Middle Back" in a Finnish app: nothing mapped the source
      // muscle names, so they fell through to title case.
      const muscles = [...new Set([...distinct('primaryMuscles'), ...distinct('secondaryMuscles')])];
      assert.ok(muscles.length >= 15, `expected the source's muscle list, got ${muscles.length}`);
      const english = muscles.filter((muscle) => looksUntranslated(muscle, libraryLabel(muscle, 'fi')));
      assert.deepEqual(english, [], `still English in Finnish: ${english.join(', ')}`);
    },
  },
  {
    name: 'every raw source equipment value has a Finnish label',
    run() {
      // The detail card prefers sourceEquipment ("kettlebells", "body only")
      // over the normalised equipment so kettlebells do not read as "other".
      const values = distinct('sourceEquipment');
      assert.ok(values.includes('kettlebells'));
      const english = values.filter((value) => looksUntranslated(value, libraryLabel(value, 'fi')));
      assert.deepEqual(english, [], `still English in Finnish: ${english.join(', ')}`);
    },
  },
  {
    name: 'source levels land on the app\'s own three-step scale',
    run() {
      // Amateur / Advanced / Pro is deliberately English everywhere. The
      // source has a fourth word, "intermediate", which must not surface.
      assert.equal(libraryLabel('beginner', 'fi'), 'Amateur');
      assert.equal(libraryLabel('intermediate', 'fi'), 'Advanced');
      assert.equal(libraryLabel('expert', 'fi'), 'Pro');
      assert.deepEqual(distinct('sourceLevel').sort(), ['beginner', 'expert', 'intermediate']);
    },
  },
  {
    /**
     * The sync folds all 53 kettlebell exercises into the `dumbbell` bucket,
     * because the five buckets are what the filter chips are made of. The
     * bucket is a filing decision; the row's subtitle is a sentence, and it
     * used to tell a Finnish reader "Käsipainot" under an exercise whose every
     * step says kahvakuula.
     *
     * Checked against the seeded library, not the generated file, so the three
     * hand-written extras (Kettlebell Swing among them) are covered too.
     */
    name: 'a kettlebell exercise never introduces itself as a dumbbell',
    run() {
      const seeded = createSeedExerciseLibrary();
      const kettlebells = seeded.filter(
        (item) => (item.sourceEquipment ?? '').trim().toLowerCase() === 'kettlebells',
      );
      assert.ok(kettlebells.length >= 50, `expected the source's kettlebells, got ${kettlebells.length}`);

      const mislabelled = kettlebells
        .filter((item) =>
          ['fi', 'en'].some((language) => {
            const label = libraryLabel(displayEquipmentValue(item), language);
            return label === libraryLabel('dumbbell', language);
          }),
        )
        .map((item) => item.name);
      assert.deepEqual(mislabelled, [], `still reads as a dumbbell: ${mislabelled.join(', ')}`);

      assert.equal(libraryLabel(displayEquipmentValue(kettlebells[0]), 'fi'), 'Kahvakuula');
      // Everything else keeps its bucket: the rule names its cases (kettlebells;
      // and, filed as bodyweight, bands, balls and the foam roller — #bugs
      // 2026-10-06), not a general preference for the raw source field (199
      // bodyweight rows would become "Other" and "Body only").
      const foamRoll = seeded.find((item) => (item.sourceEquipment ?? '') === 'foam roll');
      assert.equal(displayEquipmentValue(foamRoll), 'foam roll');
      for (const source of ['body only', 'other']) {
        const plain = seeded.find(
          (item) => item.sourceEquipment === source && item.equipment === 'bodyweight' && !/band|ball|-smr/i.test(item.name),
        );
        assert.equal(displayEquipmentValue(plain), 'bodyweight', source);
      }
    },
  },
  {
    name: 'body parts, equipment and categories still translate, and unknowns still read',
    run() {
      assert.equal(libraryLabel('legs', 'fi'), 'Jalat');
      assert.equal(libraryLabel('Bodyweight', 'fi'), 'Kehonpaino');
      assert.equal(libraryLabel('compound', 'en'), 'Compound');
      // A value the data does not have yet still reads as itself, capitalised.
      assert.equal(libraryLabel('resistance_band', 'fi'), 'Resistance Band');
    },
  },
];
