const assert = require('node:assert/strict');

const {
  parseQuickLayoutFocuses,
  quickLayoutLiftNames,
  resolveQuickLayoutExercises,
} = require('../../.test-dist/lib/quickLayoutExercises.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { SPLIT_PRESETS } = require('../../.test-dist/lib/templateBuilderSteps.js');
const libraryModule = require('../../.test-dist/data/generatedExerciseLibrary.js');

const LIBRARY = Object.values(libraryModule)[0];

/** Every day name a quick layout can produce, read from the table that owns them. */
function presetDayNames() {
  const names = new Set();
  for (const presets of Object.values(SPLIT_PRESETS)) {
    for (const preset of presets) {
      for (const name of preset.names) {
        names.add(name);
      }
    }
  }
  return [...names];
}

module.exports = [
  {
    name: 'every quick-layout day opens with two to four lifts the library actually has',
    run() {
      // "Push / Pull / Legs" used to arrive as three named, empty days. And a
      // composer that once invented exercise names is why this checks the
      // real library rather than trusting the table.
      const names = presetDayNames();
      assert.ok(names.length >= 20, `only ${names.length} preset day names found — did the presets move?`);
      for (const dayName of names) {
        const resolved = resolveQuickLayoutExercises(dayName, LIBRARY);
        assert.ok(resolved.length >= 2, `${dayName}: only ${resolved.length} lifts resolved`);
        assert.ok(resolved.length <= 4, `${dayName}: ${resolved.length} lifts — a layout, not a programme`);
        for (const { name, item } of resolved) {
          assert.ok(item && item.name, `${dayName}: ${name} resolved to nothing`);
          // The catalog name is what the exercise is called; it has to speak Finnish.
          assert.notEqual(exerciseNameLabel('fi', name), name, `${dayName}: "${name}" has no Finnish name`);
        }
        // No duplicates within a day.
        assert.equal(new Set(resolved.map((entry) => entry.item)).size, resolved.length, `${dayName}: duplicate lift`);
      }
    },
  },
  {
    name: 'a two-focus day draws from both, and full-body letters rotate',
    run() {
      assert.deepEqual(parseQuickLayoutFocuses('Chest / Triceps'), ['chest', 'triceps']);
      const chestTri = quickLayoutLiftNames('Chest / Triceps');
      assert.ok(chestTri.includes('Bench Press'));
      assert.ok(chestTri.includes('Triceps Pushdown'));
      // A / B / C are three different days.
      const a = quickLayoutLiftNames('Full Body A');
      const b = quickLayoutLiftNames('Full Body B');
      const c = quickLayoutLiftNames('Full Body C');
      assert.equal(new Set([...a, ...b, ...c]).size, a.length + b.length + c.length, 'full-body days repeat a lift');
      // A name nobody recognises stays an empty day.
      assert.deepEqual(quickLayoutLiftNames('Päivä 3'), []);
    },
  },
];
