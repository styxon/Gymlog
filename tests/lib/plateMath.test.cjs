const assert = require('node:assert/strict');

const {
  BAR_WEIGHT_KG,
  PLATE_COLORS,
  PLATE_SIZES_KG,
  platesPerSide,
} = require('../../src/lib/plateMath');

module.exports = [
  {
    name: 'platesPerSide breaks the load into greedy per-side plates',
    run() {
      // 100 kg total = 40 kg per side = 25 + 15.
      assert.deepEqual(platesPerSide(100), [25, 15]);
      // 60 kg = 20 per side.
      assert.deepEqual(platesPerSide(60), [20]);
      // 142.5 kg = 61.25 per side = 25 + 25 + 10 + 1.25.
      assert.deepEqual(platesPerSide(142.5), [25, 25, 10, 1.25]);
    },
  },
  {
    name: 'platesPerSide handles bar-only, sub-bar, and invalid loads',
    run() {
      assert.deepEqual(platesPerSide(BAR_WEIGHT_KG), []);
      assert.deepEqual(platesPerSide(15), []);
      assert.deepEqual(platesPerSide(0), []);
      assert.deepEqual(platesPerSide(Number.NaN), []);
    },
  },
  {
    name: 'platesPerSide survives float drift on repeated small plates',
    run() {
      // 27.5 kg = 3.75 per side = 2.5 + 1.25; naive float math would miss the
      // 1.25 without the epsilon.
      assert.deepEqual(platesPerSide(27.5), [2.5, 1.25]);
      // Non-standard remainder is left off, not rounded up: 21 kg = 0.5/side.
      assert.deepEqual(platesPerSide(21), []);
    },
  },
  {
    name: 'platesPerSide respects a custom bar weight',
    run() {
      // 60 kg on a 15 kg bar = 22.5 per side = 20 + 2.5.
      assert.deepEqual(platesPerSide(60, 15), [20, 2.5]);
    },
  },
  {
    // "Just the bar (20 kg)" for 15 kg, and the plates for 60 under a set of
    // 62 without the other two (2026-09-26).
    name: 'plateLoad says when a weight is under the bar and what plates leave off',
    run() {
      const { plateLoad } = require('../../src/lib/plateMath');
      assert.deepEqual(plateLoad(15), { plates: [], belowBar: true, remainderKg: 0 });
      assert.deepEqual(plateLoad(20), { plates: [], belowBar: false, remainderKg: 0 });
      assert.deepEqual(plateLoad(62), { plates: [20], belowBar: false, remainderKg: 2 });
      assert.deepEqual(plateLoad(21), { plates: [], belowBar: false, remainderKg: 1 });
      assert.deepEqual(plateLoad(102.5), { plates: [25, 15, 1.25], belowBar: false, remainderKg: 0 });
      assert.deepEqual(plateLoad(60, 15), { plates: [20, 2.5], belowBar: false, remainderKg: 0 });

      const fs = require('node:fs');
      const path = require('node:path');
      const pop = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'PlatePop.tsx'), 'utf8');
      assert.match(pop, /load\.belowBar \? \(\s*<Text style=\{styles\.barOnly\}>\{t\(language, 'plates\.belowBar'/);
      assert.match(pop, /\{load\.remainderKg > 0 \? \(/);
    },
  },
  {
    name: 'every plate size has a color for the readout chips',
    run() {
      for (const plate of PLATE_SIZES_KG) {
        assert.match(PLATE_COLORS[plate], /^#[0-9A-Fa-f]{6}$/);
      }
    },
  },
];
