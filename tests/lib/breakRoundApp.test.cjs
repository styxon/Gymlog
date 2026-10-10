const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { canCompleteSet } = require('../../.test-dist/features/workout/workoutState.js');
const { formatPlanSessionTitle, isReaderNamedSession } = require('../../.test-dist/lib/sessionNameLabel.js');
const { createExercise, createSet } = require('../helpers/workoutFixtures.cjs');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * The app half of the break round, 2026-09-28: each case below is one of the
 * repros the adversarial pass wrote against #202, #206, #208 and #214, turned
 * into the rule that now holds.
 */
module.exports = [
  // The bar-tap case went with the bar row itself (user 2026-09-29: "ei se
  // toimi, sekoittaa vain omaa päätä kun treenaa").
  {
    name: 'a phone that remembered bar choices loads without them, and the set screen has no bar row',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const loaded = normalizeDatabase({ preferences: { barChoiceByExercise: { 'sumo deadlift': 20 } } });
      assert.equal('barChoiceByExercise' in loaded.preferences, false);
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      assert.doesNotMatch(player, /barChoice|switchBar|guided\.bar\./);
      assert.match(player, /const \[kg, setKg\] = useState\(target\?\.loadKg \?\? 0\);/, 'the dial opens on the target alone');
    },
  },
  {
    name: 'break round: the store and the player share one rule for a loggable set',
    run() {
      const exercise = createExercise();
      const pending = (draftLoadText, draftRepsText) =>
        createSet({ status: 'pending', draftLoadText, draftRepsText, actualReps: null, actualLoadKg: null });
      assert.equal(canCompleteSet(exercise, pending('100', '8'), 'kg'), true);
      assert.equal(canCompleteSet(exercise, pending('600', '8'), 'kg'), true);
      // What the bar tap used to produce: refused, so the player must not cheer.
      // (The ceiling moved from 500 to 600 kg on 2026-10-05.)
      assert.equal(canCompleteSet(exercise, pending('620', '8'), 'kg'), false);
      assert.equal(canCompleteSet(exercise, pending('100', '0'), 'kg'), false);
      assert.equal(canCompleteSet(exercise, pending('100', ''), 'kg'), false);
      // An interval bout logs no load, and is still a set.
      const interval = createExercise({ exerciseName: 'Treadmill Intervals (30s on / 30s off)', trackingMode: 'reps_first' });
      const intervalSet = createSet({ status: 'pending', draftLoadText: '', draftRepsText: '30', plannedLoadKg: undefined });
      assert.equal(canCompleteSet(interval, intervalSet, 'kg'), true);

      // The reducer asks the same function rather than a copy of its rules.
      const reducer = strip(read('src', 'features', 'workout', 'workoutState.ts'));
      const complete = reducer.slice(reducer.indexOf("case 'set/complete': {"), reducer.indexOf("set.status = 'completed';"));
      assert.match(complete, /!canCompleteSet\(exercise, set, action\.payload\.unitPreference\)/);
      assert.doesNotMatch(complete, /isLiftableWeight/);
    },
  },
  {
    name: 'break round: a name the reader typed is shown as typed, and only while it is still the name',
    run() {
      const typed = { id: 's2', name: 'Päivä 2' };
      // The app's own placeholder reads as a positional workout…
      assert.equal(formatPlanSessionTitle(typed, 1, 'My plan', 'fi'), 'Treeni 2');
      // …and the reader's own words as they wrote them.
      assert.equal(formatPlanSessionTitle(typed, 1, 'My plan', 'fi', true), 'Päivä 2');
      assert.equal(formatPlanSessionTitle({ name: 'Workout B' }, 4, 'My plan', 'en', true), 'Workout B');
      assert.equal(formatPlanSessionTitle({ name: 'Päivä 1: Jalat' }, 0, 'My plan', 'fi', true), 'Päivä 1: Jalat');
      // Not through the display label either, which reads a one-letter name as "Workout".
      assert.equal(formatPlanSessionTitle({ name: 'A' }, 0, 'My plan', 'en', true), 'A');

      assert.equal(isReaderNamedSession({ s2: 'Päivä 2' }, typed), true);
      assert.equal(isReaderNamedSession({ s2: '  Päivä   2 ' }, typed), true, 'whitespace the store trims');
      // Renamed since by something else: the usual rule again.
      assert.equal(isReaderNamedSession({ s2: 'Päivä 2' }, { id: 's2', name: 'Workout B' }), false);
      assert.equal(isReaderNamedSession({}, typed), false);
      assert.equal(isReaderNamedSession(undefined, typed), false);
    },
  },
  {
    name: 'break round: the stored reader names load defensively on an old install',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      assert.deepEqual(normalizeDatabase({ preferences: {} }).preferences.readerSessionNames, {});
      assert.deepEqual(normalizeDatabase({ preferences: { readerSessionNames: null } }).preferences.readerSessionNames, {});
      assert.deepEqual(normalizeDatabase({ preferences: { readerSessionNames: ['x'] } }).preferences.readerSessionNames, {});
      assert.deepEqual(
        normalizeDatabase({ preferences: { readerSessionNames: { s1: 'Jalat', s2: 7, '': 'x', s3: '' } } }).preferences
          .readerSessionNames,
        { s1: 'Jalat' },
      );
    },
  },
  {
    name: 'break round: the day page pen opens on the stored name and records what was typed',
    run() {
      const day = strip(read('src', 'screens', 'ProgramDayScreen.tsx'));
      // Seeded from the stored name, never the title as shown (a translation
      // or a placeholder), which saving turned into the name for good.
      assert.match(day, /onPress=\{\(\) => setNameDraft\(session\.name\)\}/);
      assert.doesNotMatch(day, /setNameDraft\(dayTitle\)/);
      assert.match(day, /trimmed && trimmed !== session\.name\.trim\(\)/);

      // The day edits leave VinhaApp for src/app in the phase-B split
      // (2026-09-30): the handler is read wherever the shell keeps it, and
      // the slice asserts it is there before cutting.
      const app = strip(readAppWiring().replace(/\r\n/g, '\n'));
      const body = between(app, 'async function handleRenameProgramSession(', '\n  }\n');
      // Remembered only after the stored name changed.
      assert.match(body, /if \(!result\.saved\) \{\s*return;\s*\}/);
      // A failed save is said and stops there; the name is remembered in a
      // write of its own after it, whose failure is not told as a failed
      // rename — the name is already stored by then (review, 2026-09-28).
      assert.match(
        body,
        /reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);\s*return;\s*\}\s*try \{\s*await updatePreferences\(\(current\) => \(\{\s*readerSessionNames: \{ \.\.\.current\.readerSessionNames, \[sessionId\]: trimmed \},\s*\}\)\);\s*\} catch \(error\) \{\s*console\.error\(/,
      );
      assert.ok(body.indexOf('editWorkoutTemplateSessions(') < body.indexOf('readerSessionNames'));
    },
  },
];
