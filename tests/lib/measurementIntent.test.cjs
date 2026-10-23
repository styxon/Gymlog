const assert = require('node:assert/strict');

const { parseMeasurementIntent } = require('../../.test-dist/lib/measurementIntent.js');

module.exports = [
  {
    name: 'measurementIntent: a stated body measurement parses to kind, value and unit',
    run() {
      assert.deepEqual(parseMeasurementIntent('Rinnanympärys on 90 cm'), { kind: 'chest', value: 90, unit: 'cm' });
      assert.deepEqual(parseMeasurementIntent('vyötärö 82,5'), { kind: 'waist', value: 82.5, unit: 'cm' });
      assert.deepEqual(parseMeasurementIntent('painoni on 81.4 kg'), { kind: 'bodyweight', value: 81.4, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('rasvaprosentti 18'), { kind: 'bodyfat', value: 18, unit: '%' });
      assert.deepEqual(parseMeasurementIntent('my chest is 100 cm', 'en'), { kind: 'chest', value: 100, unit: 'cm' });
      assert.deepEqual(parseMeasurementIntent('hauis 38'), { kind: 'arms', value: 38, unit: 'cm' });
    },
  },
  {
    // A false positive offers to log a number the reader never meant; these
    // are the shapes that must stay silent.
    name: 'measurementIntent: questions, goals, lifts and nonsense parse to nothing',
    run() {
      for (const text of [
        'Pitäisikö rinnan olla 100 cm?',
        'Tavoite on 95 cm rinta',
        'rinta 80 kg',            // a bench press, not a chest
        'Miten saisin isomman rinnan',
        'paino 2 kg',             // out of range
        'penkki 80 x 5',
        '',
      ]) {
        assert.equal(parseMeasurementIntent(text), null, text);
      }
    },
  },
  {
    name: 'measurementIntent: a date or a clock time before the reading is not the reading (hunt 1.1.1)',
    run() {
      assert.deepEqual(parseMeasurementIntent('30.10. painoni 82 kg'), { kind: 'bodyweight', value: 82, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('30.10.2026 paino 81,5'), { kind: 'bodyweight', value: 81.5, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('klo 22.30 vyötärö 82 cm'), { kind: 'waist', value: 82, unit: 'cm' });
      assert.deepEqual(parseMeasurementIntent('at 7:15 my waist was 84', 'en'), { kind: 'waist', value: 84, unit: 'cm' });
      // A sentence's own full stop is not a date.
      assert.deepEqual(parseMeasurementIntent('Painoni on 82.5.'), { kind: 'bodyweight', value: 82.5, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('hauis 38.'), { kind: 'arms', value: 38, unit: 'cm' });
    },
  },
  {
    name: 'measurementIntent: pounds and inches are refused, never read as kg or cm (hunt 1.1.1)',
    run() {
      for (const text of ['today I weigh 180 lb', 'I weigh 82 lbs', 'weight 180 pounds', 'waist 82 in', 'waist 32 inches', 'chest 40"']) {
        assert.equal(parseMeasurementIntent(text, 'en'), null, text);
      }
      // "in" as a word is not inches.
      assert.deepEqual(parseMeasurementIntent('my weight is 82 in the morning', 'en'), { kind: 'bodyweight', value: 82, unit: 'kg' });
    },
  },
  {
    name: 'measurementIntent: a number too long to be a reading is refused, not cut short (hunt 1.1.1)',
    run() {
      assert.equal(parseMeasurementIntent('1000 kg paino'), null);
      assert.equal(parseMeasurementIntent('vyötärö 8250'), null);
    },
  },
];
