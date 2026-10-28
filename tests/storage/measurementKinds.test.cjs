const assert = require('node:assert/strict');

const {
  MEASUREMENT_KIND_ORDER,
  isMeasurementKind,
} = require('../../src/lib/measurementKinds');
const { MEASUREMENT_LABEL_KEYS } = require('../../src/lib/homeStatCards');

module.exports = [
  {
    name: 'every measurement the app can take survives a save and a load',
    run() {
      // The bug this exists for: normalizeDatabase carried its own chain of
      // `entry.kind === '...'` comparisons, and arms and calves reached the
      // model and the measurement screen without ever reaching that chain.
      // A biceps or calf entry was written, read back, and dropped in
      // silence — the reader's own data, gone on the next app start.
      for (const kind of ['bodyfat', 'shoulders', 'chest', 'back', 'arms', 'waist', 'hips', 'thighs', 'calves']) {
        assert.ok(isMeasurementKind(kind), `${kind} must survive the loader`);
      }
    },
  },
  {
    name: 'the list and the labels cannot drift apart',
    run() {
      // MEASUREMENT_LABEL_KEYS is typed Record<MeasurementKind, I18nKey>, so
      // the compiler already forces it to hold every kind. Comparing the two
      // catches the other direction at runtime: a kind listed here that the
      // screens cannot name.
      assert.deepEqual(
        [...MEASUREMENT_KIND_ORDER].sort(),
        Object.keys(MEASUREMENT_LABEL_KEYS).sort(),
      );
    },
  },
  {
    name: 'anything that is not a measurement is refused',
    run() {
      for (const value of ['bodyweight', 'lift:squat', '', 'BACK', null, undefined, 7, {}, ['back']]) {
        assert.equal(isMeasurementKind(value), false, JSON.stringify(value) ?? String(value));
      }
    },
  },
  {
    name: 'the loader delegates instead of keeping a second opinion',
    run() {
      // The rule lives in one pure place a test can call. A chain of
      // comparisons inside normalizeDatabase cannot be run from Node at all —
      // that module imports AsyncStorage — which is exactly how this drifted
      // for two kinds without anything going red.
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
        'utf8',
      );
      assert.match(source, /const kind = isMeasurementKind\(entry\?\.kind\) \? entry\.kind : null;/);
      assert.doesNotMatch(source, /entry\?\.kind === '/);
    },
  },
  {
    name: 'every kind has a ruler default of its own, and none of them is the old 90',
    run() {
      // "hauiksen kirjauksen oletusarvo on 90 cm" (walkthrough 2026-08-28):
      // one number served every kind. Each opens somewhere plausible now.
      const { DEFAULT_MEASUREMENT_VALUE, MEASUREMENT_KIND_ORDER } = require('../../src/lib/measurementKinds');
      for (const kind of MEASUREMENT_KIND_ORDER) {
        assert.ok(Number.isFinite(DEFAULT_MEASUREMENT_VALUE[kind]) && DEFAULT_MEASUREMENT_VALUE[kind] > 0, kind);
      }
      assert.ok(DEFAULT_MEASUREMENT_VALUE.bodyfat < 50);
      assert.ok(DEFAULT_MEASUREMENT_VALUE.arms < 45 && DEFAULT_MEASUREMENT_VALUE.calves < 45, 'limbs are not waists');
      assert.ok(DEFAULT_MEASUREMENT_VALUE.shoulders > DEFAULT_MEASUREMENT_VALUE.waist);
    },
  },
];
