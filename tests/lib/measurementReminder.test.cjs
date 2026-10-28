const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MEASUREMENT_REMINDER_KINDS,
  isMeasurementReminderKind,
  isSetupWeekday,
  normalizeMeasurementReminder,
} = require('../../src/lib/measurementReminder');

const loader = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
  'utf8',
);

const FALLBACK = { kind: null, day: 'sun' };

module.exports = [
  {
    name: 'measurementReminder: a stored setting comes back as itself, and anything else falls back field by field',
    run() {
      assert.deepEqual(normalizeMeasurementReminder('hips', 'wed', FALLBACK), { kind: 'hips', day: 'wed' });
      // Off is a real answer, not a missing one.
      assert.deepEqual(normalizeMeasurementReminder(null, 'mon', FALLBACK), { kind: null, day: 'mon' });
      // A kind this build does not know (a typo, a newer build's kind) is
      // off rather than a crash on someone's old install; the day survives.
      assert.deepEqual(normalizeMeasurementReminder('neck', 'fri', FALLBACK), { kind: null, day: 'fri' });
      // Body fat is a measurement, not a tape measurement: the reminder names
      // its instrument, so it cannot be reminded as one.
      assert.deepEqual(normalizeMeasurementReminder('bodyfat', 'fri', FALLBACK), { kind: null, day: 'fri' });
      assert.equal(isMeasurementReminderKind('bodyfat'), false);
      assert.equal(isMeasurementReminderKind('hips'), true);
      assert.deepEqual([...MEASUREMENT_REMINDER_KINDS], ['shoulders', 'chest', 'back', 'arms', 'waist', 'hips', 'thighs', 'calves']);
      // A day it does not know is the fallback's day, because a reminder on
      // no day would be a setting that quietly does nothing.
      assert.deepEqual(normalizeMeasurementReminder('waist', 'someday', FALLBACK), { kind: 'waist', day: 'sun' });
      assert.deepEqual(normalizeMeasurementReminder(undefined, undefined, FALLBACK), FALLBACK);
      assert.deepEqual(normalizeMeasurementReminder(7, {}, { kind: 'chest', day: 'tue' }), { kind: 'chest', day: 'tue' });

      assert.equal(isSetupWeekday('sun'), true);
      assert.equal(isSetupWeekday('Sun'), false);
      assert.equal(isSetupWeekday(0), false);
    },
  },
  {
    name: 'measurementReminder: the loader delegates both fields to the rule instead of judging them inline',
    run() {
      // database.ts imports AsyncStorage and cannot be required here, so this
      // guards the delegation and the suite above guards the rule
      // (CLAUDE.md: "Loaders that trust stored data").
      assert.match(loader, /import \{ normalizeMeasurementReminder \} from '\.\.\/lib\/measurementReminder';/);
      const prefs = loader.slice(loader.indexOf('notificationPrefs: {'), loader.indexOf('trainingBreak:'));
      assert.match(prefs, /\.\.\.measurementReminderPrefs\(input\?\.preferences\?\.notificationPrefs, fallback\.preferences\.notificationPrefs\)/);
      assert.doesNotMatch(prefs, /measurementReminderKind:/, 'the field must not be normalized inline');
    },
  },
];
