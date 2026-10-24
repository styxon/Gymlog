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
  {
    name: 'measurementIntent: the reading is the number after its own word, not another measurement or a note (hunt 1.1.1 re-check)',
    run() {
      const kg = (value) => ({ kind: 'bodyweight', value, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('paino 82 ja vyötärö 90 cm'), kg(82));
      assert.deepEqual(parseMeasurementIntent('paino 82, vyötärö 90 cm'), kg(82));
      assert.deepEqual(parseMeasurementIntent('painoni 82 (viime viikolla 84 kg)'), kg(82));
      assert.deepEqual(parseMeasurementIntent('paino 82-83 kg'), kg(82));
      assert.deepEqual(parseMeasurementIntent('vyötärö 90, hauis 35 cm'), { kind: 'waist', value: 90, unit: 'cm' });
      assert.deepEqual(parseMeasurementIntent('82 kg paino'), kg(82));
      // A value with its unit right before the word wins over a number after it (second re-check).
      assert.deepEqual(parseMeasurementIntent('82 kg paino, treenasin 3 kertaa'), kg(82));
      assert.deepEqual(parseMeasurementIntent('82 kg paino 3.11.'), kg(82));
      assert.deepEqual(parseMeasurementIntent('82 paino 3 kertaa'), kg(82));
      assert.deepEqual(parseMeasurementIntent('18 % rasvaprosentti 3 kk sitten'), { kind: 'bodyfat', value: 18, unit: '%' });
      assert.deepEqual(parseMeasurementIntent('90 cm vyötärö 2 viikon jälkeen'), { kind: 'waist', value: 90, unit: 'cm' });
      // Another measurement's value before the word is not adjacent: still the one after.
      assert.deepEqual(parseMeasurementIntent('vyötärö 90cm, paino 82kg'), kg(82));
      // A trailing full stop after the reading is not a date.
      assert.deepEqual(parseMeasurementIntent('rasvaprosentti 18.5.'), { kind: 'bodyfat', value: 18.5, unit: '%' });
      assert.deepEqual(parseMeasurementIntent('body fat 12.5.', 'en'), { kind: 'bodyfat', value: 12.5, unit: '%' });
      // "at", a colon and quotes are not clocks or inches.
      assert.deepEqual(parseMeasurementIntent('my weight is at 82', 'en'), kg(82));
      assert.deepEqual(parseMeasurementIntent('paino 82:'), kg(82));
      assert.deepEqual(parseMeasurementIntent('painoni "82"'), kg(82));
      assert.deepEqual(parseMeasurementIntent('kello 7 paino 81,4'), kg(81.4));
    },
  },
  {
    name: 'measurementIntent: a date after the word or a count just before it is not the reading (hunt 1.1.1 r2)',
    run() {
      const kg = (value) => ({ kind: 'bodyweight', value, unit: 'kg' });
      // A "30.10." after the word, with the reading behind it, was read as 30.1.
      assert.deepEqual(parseMeasurementIntent('painoni 30.10. oli 82'), kg(82));
      assert.deepEqual(parseMeasurementIntent('paino 28.10. 82 kg'), kg(82));
      assert.deepEqual(parseMeasurementIntent('weight 30.10. 82kg', 'en'), kg(82));
      assert.deepEqual(parseMeasurementIntent('vyötärö 30.10. 90 cm'), { kind: 'waist', value: 90, unit: 'cm' });
      // A week or day number right before the word lost to nothing: 43 kg.
      assert.deepEqual(parseMeasurementIntent('viikolla 43 painoni oli 82 kg'), kg(82));
      assert.deepEqual(parseMeasurementIntent('week 43 weight 82 kg', 'en'), kg(82));
      assert.deepEqual(parseMeasurementIntent('päivä 40 paino 82'), kg(82));
      assert.deepEqual(parseMeasurementIntent('Day 30 weight 82', 'en'), kg(82));
      // Still the number before the word when what follows is no reading.
      assert.deepEqual(parseMeasurementIntent('82 paino 3 kertaa'), kg(82));
      assert.deepEqual(parseMeasurementIntent('82 kg paino, treenasin 3 kertaa'), kg(82));
      // A lone "30.5." after the word is still the reading, not a date.
      assert.deepEqual(parseMeasurementIntent('pohje 30.5.'), { kind: 'calves', value: 30.5, unit: 'cm' });
    },
  },
];
