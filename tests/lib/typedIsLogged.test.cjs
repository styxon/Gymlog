const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isCardioDistanceTextSavable, parseCardioDistanceKm } = require('../../.test-dist/lib/cardio.js');
const { isLoggableFreestyleSet } = require('../../.test-dist/lib/emptyWorkoutSession.js');
const { parseHevyCsv } = require('../../.test-dist/lib/hevyImport.js');
const { parseCsvProgram } = require('../../.test-dist/lib/csvProgramImport.js');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * What is typed is what is logged (decimal audit, 2026-09-21).
 *
 * The app is used in Finnish, where 82,5 is written with a comma, on keyboards
 * that sometimes offer both marks. Each case below was a number that reached
 * storage as something other than what the field showed, or a field that
 * silently dropped what it could not read.
 */
module.exports = [
  {
    name: 'typed: a cardio distance that is not one holds the save instead of vanishing',
    run() {
      assert.equal(parseCardioDistanceKm('4,2'), 4.2);
      assert.equal(isCardioDistanceTextSavable(''), true, 'no distance is a complete answer');
      assert.equal(isCardioDistanceTextSavable('  '), true);
      assert.equal(isCardioDistanceTextSavable('4,2'), true);
      assert.equal(isCardioDistanceTextSavable('0,5'), true);
      // These all parsed to null and saved the run with no distance.
      for (const text of ['4,2,', '4..2', '1000', 'abc', '0']) {
        assert.equal(isCardioDistanceTextSavable(text), false, text);
      }
      const screen = strip(read('src', 'screens', 'CardioScreen.tsx'));
      assert.match(screen, /const distanceInvalid = !isCardioDistanceTextSavable\(distanceText\);/);
      assert.match(
        screen,
        /onPress=\{\s*isSaving \|\| distanceInvalid \|\| finish\.durationSec === null\s*\? undefined\s*: \(\) => void onComplete\(distanceKm, feel, minutesText\)\s*\}/,
      );
    },
  },
  {
    name: 'typed: freestyle reps are whole',
    run() {
      assert.equal(isLoggableFreestyleSet({ kg: '82,5', reps: '8' }), true);
      // Stored as 8.5 reps — into volume, a PR card and the history line.
      assert.equal(isLoggableFreestyleSet({ kg: '82,5', reps: '8,5' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '82,5', reps: '8.5' }), false);
      // A blank row is not a set (2026-09-26): it had saved a session nobody
      // did once one tick became enough to save. A missing weight is fine.
      assert.equal(isLoggableFreestyleSet({ kg: '', reps: '' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '', reps: '12' }), true);
    },
  },
  {
    name: 'typed: a Hevy export saved by a Finnish spreadsheet still imports',
    run() {
      const header = 'title;start_time;exercise_title;set_type;weight_kg;reps';
      const semicolons = [header, '"Push";"2024-06-10T08:15:00.000Z";"Bench Press";normal;82,5;5'].join('\n');
      const preview = parseHevyCsv(semicolons);
      assert.deepEqual(preview.errors, []);
      assert.equal(preview.setCount, 1);
      assert.equal(preview.workouts[0].exercises[0].sets[0].weightKg, 82.5);

      const tabs = semicolons.replace(/;/g, '\t');
      assert.equal(parseHevyCsv(tabs).workouts[0].exercises[0].sets[0].weightKg, 82.5);

      // A quoted note with a line break in a later field: the record splitter
      // has to know the separator too, or the row is torn in two and its set
      // dropped (CI review of #174).
      const noted = [
        'title;start_time;exercise_title;exercise_notes;set_type;weight_kg;reps',
        '"Push";"2024-06-10T08:15:00.000Z";"Bench Press";"felt heavy\ntoday";normal;82,5;5',
        '"Push";"2024-06-10T08:15:00.000Z";"Bench Press";;normal;85;3',
      ].join('\n');
      const notedPreview = parseHevyCsv(noted);
      assert.deepEqual(notedPreview.errors, []);
      assert.equal(notedPreview.setCount, 2);
      assert.equal(notedPreview.skippedRowCount, 0);

      // And the comma file Hevy itself writes is read as before.
      const commas = ['title,start_time,exercise_title,set_type,weight_kg,reps', '"Push","2024-06-10T08:15:00.000Z","Bench Press",normal,82.5,5'].join('\n');
      assert.equal(parseHevyCsv(commas).workouts[0].exercises[0].sets[0].weightKg, 82.5);
    },
  },
  {
    name: 'typed: a programme CSV with a count of sets that is not whole says so',
    run() {
      const library = [{ name: 'Bench Press' }];
      const csv = (sets) => `Day,Exercise,Sets,Reps\nDay 1,Bench Press,${sets},6-10`;
      assert.equal(parseCsvProgram(csv('4'), library).rows[0].sets, 4);
      // parseInt read these as 2 and 3 and reported nothing.
      for (const sets of ['"2,5"', '3-4', '2.5', '0']) {
        const preview = parseCsvProgram(csv(sets), library);
        assert.equal(preview.rows.length, 0, sets);
        assert.equal(preview.errors.length, 1, sets);
      }
    },
  },
  {
    name: 'typed: the goal target is parsed, rounded and written the way every weight is',
    run() {
      const screen = strip(read('src', 'screens', 'StrengthGoalFlowScreen.tsx'));
      // parseFloat took "100,5,5" as 100.5; the shared parser takes it as nothing.
      assert.match(screen, /const typedTargetKg = parseNumberInput\(typedKg\) \?\? Number\.NaN;/);
      assert.doesNotMatch(screen, /parseFloat/);
      // A pound best plus a delta stored 71.22999999999999.
      assert.match(screen, /const targetKg = bestKg === null \? typedTargetKg : Number\(\(bestKg \+ delta\)\.toFixed\(2\)\);/);
      // And shown with the reader's decimal mark.
      assert.match(screen, /<Text style=\{styles\.number\}>\{removeTrailingZeros\(targetKg\)\}<\/Text>/);
    },
  },
  {
    name: 'typed: My Data parses what is typed with the shared parser',
    run() {
      // Its weight editor is gone (the row opens the weigh-in log, audit 7);
      // height is still typed, and goes through the same parser.
      const screen = strip(read('src', 'screens', 'MyDataScreen.tsx'));
      assert.match(screen, /const parsed = parseNumberInput\(draftValue\);/);
      assert.doesNotMatch(screen, /Number\(draftValue\.replace/);
    },
  },
  {
    name: 'typed: a rest that is not whole minutes reads as a clock, not a decimal',
    run() {
      const screen = strip(read('src', 'screens', 'ProgramDayScreen.tsx'));
      assert.match(screen, /: Number\.isInteger\(seconds \/ 60\)\s*\? `\$\{seconds \/ 60\} min`\s*: `\$\{formatClock\(seconds\)\} min`;/);
      assert.doesNotMatch(screen, /\(seconds \/ 60\)\.toFixed\(1\)/);
      const { formatClock } = require('../../.test-dist/lib/restSchedule.js');
      assert.equal(formatClock(135), '2:15');
    },
  },
];
