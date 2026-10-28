const assert = require('node:assert/strict');

const { isHevyHistoryCsv, parseHevyCsv } = require('../../src/lib/hevyImport');
const {
  persistCompletedWorkoutSessionToDatabase,
} = require('../../src/state/completedWorkoutPersistence');

const HEADER =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';

const SAMPLE = [
  HEADER,
  '"Push Day","10 Jun 2024, 08:15","10 Jun 2024, 09:05",,"Bench Press (Barbell)",,,0,warmup,40,10,,,',
  '"Push Day","10 Jun 2024, 08:15","10 Jun 2024, 09:05",,"Bench Press (Barbell)",,,1,normal,80,8,,,7.5',
  '"Push Day","10 Jun 2024, 08:15","10 Jun 2024, 09:05",,"Bench Press (Barbell)",,,2,normal,80,6,,,',
  '"Push Day","10 Jun 2024, 08:15","10 Jun 2024, 09:05",,"Lateral Raise (Dumbbell)",,,0,normal,10,12,,,',
  // A cardio block: duration only, no reps — counted out loud, not imported.
  '"Push Day","10 Jun 2024, 08:15","10 Jun 2024, 09:05",,"Treadmill",,,0,normal,,,1.2,600,',
  '"Leg Day","12 Jun 2024, 17:30",,,"Squat (Barbell)",,,0,normal,100,5,,,',
].join('\n');

module.exports = [
  {
    name: 'hevyImport: detection needs both history columns, so a programme CSV never trips it',
    run() {
      assert.equal(isHevyHistoryCsv(SAMPLE), true);
      assert.equal(isHevyHistoryCsv('Day,Exercise,Sets,Reps\nDay 1,Bench Press,4,6-10'), false);
      assert.equal(isHevyHistoryCsv(''), false);
    },
  },
  {
    name: 'hevyImport: rows group into workouts by start time, exercises keep their sets in order',
    run() {
      const preview = parseHevyCsv(SAMPLE);
      assert.equal(preview.errors.length, 0);
      assert.equal(preview.workouts.length, 2);
      assert.equal(preview.setCount, 5);
      assert.equal(preview.skippedRowCount, 1);

      const push = preview.workouts[0];
      assert.equal(push.name, 'Push Day');
      assert.equal(push.exercises.length, 2);
      assert.deepEqual(
        push.exercises[0].sets.map((set) => set.reps),
        [10, 8, 6],
      );
      assert.equal(push.exercises[0].sets[0].kind, 'warmup');
      assert.equal(push.exercises[0].sets[1].kind, 'working');
      // The quoted "10 Jun 2024, 08:15" timestamp parses despite its comma.
      assert.equal(new Date(push.startedAt).getFullYear(), 2024);
    },
  },
  {
    name: 'hevyImport: pounds convert when the export has no kg column',
    run() {
      const lbs = [
        'title,start_time,exercise_title,set_type,weight_lbs,reps',
        '"A","2024-06-10T08:15:00.000Z","Bench Press",normal,225,5',
      ].join('\n');
      const preview = parseHevyCsv(lbs);
      assert.equal(preview.workouts.length, 1);
      const weight = preview.workouts[0].exercises[0].sets[0].weightKg;
      assert.ok(Math.abs(weight - 102.06) < 0.01, String(weight));
    },
  },
  {
    // The whole point of the deterministic id: mailing the same export twice
    // must not double anyone's history.
    name: 'hevyImport: re-importing the same file reports duplicates instead of doubling history',
    run() {
      const preview = parseHevyCsv(SAMPLE);
      let database = {
        workoutTemplates: [],
        exerciseTemplates: [],
        workoutPlans: [],
        exerciseLibrary: [],
        workoutSessions: [],
        cardioSessions: [],
        exerciseLogs: [],
        bodyweightEntries: [],
        measurementEntries: [],
        preferences: {},
      };
      const persistAll = () => {
        let imported = 0;
        let duplicates = 0;
        for (const workout of preview.workouts) {
          const result = persistCompletedWorkoutSessionToDatabase(database, {
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
          });
          if (result.didPersist) {
            imported += 1;
            database = result.database;
          } else {
            duplicates += 1;
          }
        }
        return { imported, duplicates };
      };

      const first = persistAll();
      assert.deepEqual(first, { imported: 2, duplicates: 0 });
      assert.equal(database.workoutSessions.length, 2);
      assert.equal(database.exerciseLogs.length, 3);
      // The bench log carries its real sets, so records and history can read them.
      const bench = database.exerciseLogs.find((log) => log.exerciseNameSnapshot.includes('Bench'));
      assert.equal(bench.sets.length, 3);
      assert.equal(bench.weight, 80);

      const second = persistAll();
      assert.deepEqual(second, { imported: 0, duplicates: 2 });
      assert.equal(database.workoutSessions.length, 2);
    },
  },
  {
    name: 'hevyImport: a note written on two lines keeps its workout',
    run() {
      // A quoted description with a line break used to split every row of the
      // workout in two; the halves did not parse and all six sets were dropped
      // as "cardio and duration-only blocks".
      const multiline = [
        HEADER,
        '"Push","10 Jun 2024, 08:15","10 Jun 2024, 09:05","Felt strong.\nShoulder fine.","Bench Press (Barbell)",,"Pause on chest\r\nevery rep",1,normal,80,8,,,',
        '"Push","10 Jun 2024, 08:15","10 Jun 2024, 09:05","Felt strong.\nShoulder fine.","Bench Press (Barbell)",,,2,normal,80,6,,,',
      ].join('\r\n');
      const preview = parseHevyCsv(multiline);
      assert.equal(preview.skippedRowCount, 0);
      assert.equal(preview.workouts.length, 1);
      assert.equal(preview.setCount, 2);
      assert.deepEqual(preview.workouts[0].exercises[0].sets.map((set) => set.reps), [8, 6]);
    },
  },
  {
    name: 'hevyImport: a stray quote inside a note does not swallow the rest of the file',
    run() {
      // Hand-edited or non-conformant: the note is unquoted and carries an
      // inch mark. Every quote used to flip the scan, so every row after this
      // one joined a single record that did not parse.
      const stray = [
        HEADER,
        '"Legs","12 Jun 2024, 17:30",,,"Box Jump",,Notes: 6" box,0,normal,0,5,,,',
        '"Legs","12 Jun 2024, 17:30",,,"Squat (Barbell)",,,0,normal,100,5,,,',
        '"Legs","12 Jun 2024, 17:30",,,"Squat (Barbell)",,,1,normal,100,5,,,',
        // A quoted field with an escaped quote still reads as one field.
        '"Legs","12 Jun 2024, 17:30",,"Said ""easy"", then, not","Squat (Barbell)",,,2,normal,100,4,,,',
      ].join('\n');
      const preview = parseHevyCsv(stray);
      assert.equal(preview.skippedRowCount, 0);
      assert.equal(preview.workouts.length, 1);
      const squat = preview.workouts[0].exercises.find((exercise) => /squat/i.test(exercise.name));
      assert.ok(squat, 'the squat rows after the stray quote are read');
      assert.deepEqual(squat.sets.map((set) => set.reps), [5, 5, 4]);
      assert.equal(preview.setCount, 4);

      // A writer that puts a space before a quoted field still gets its
      // quoted comma kept inside the field.
      // quoted comma — and its quoted line break — kept inside the field.
      const spaced = [
        HEADER,
        '"Legs", "12 Jun 2024, 17:30",, "Heavy.\nKnees fine.","Squat (Barbell)",,,0,normal,100,5,,,',
        '"Legs", "12 Jun 2024, 17:30",,,"Squat (Barbell)",,,1,normal,100,5,,,',
      ].join('\n');
      const spacedPreview = parseHevyCsv(spaced);
      assert.equal(spacedPreview.skippedRowCount, 0);
      assert.equal(spacedPreview.setCount, 2);
    },
  },
  {
    // The #228 regression: an opening quote with no matching close used to
    // stay "inside quotes" to EOF, joining every row after it into one
    // record that failed to parse — every set after the broken row vanished
    // as "no importable sets" (recheck round 2026-09-29).
    name: 'hevyImport: an unterminated quote in one row does not lose the rows after it',
    run() {
      // ISO timestamps here (no embedded comma) so none of these rows need
      // quoting at all — the only quote character anywhere in the file is
      // the stray, unclosed one below, which is what actually proves the
      // recovery reaches true EOF rather than being closed early by some
      // later field's own quotes.
      const lines = [HEADER];
      // Row 2 (index 1 into the data rows): a stray opening quote, never
      // closed.
      lines.push('Legs,2024-06-12T17:30:00.000Z,,,"Unclosed note,,,0,normal,100,5,,,');
      for (let set = 1; set <= 18; set += 1) {
        lines.push(`Legs,2024-06-12T17:30:00.000Z,,,Squat (Barbell),,,${set},normal,100,5,,,`);
      }
      const preview = parseHevyCsv(lines.join('\n'));

      assert.equal(preview.workouts.length, 1);
      const squat = preview.workouts[0].exercises.find((exercise) => /squat/i.test(exercise.name));
      assert.ok(squat, 'the squat rows after the broken row are read');
      assert.equal(squat.sets.length, 18, 'every squat row after the broken one survives');
      // The broken row itself is counted out, not guessed at.
      assert.equal(preview.skippedRowCount, 1);
    },
  },
  {
    name: 'hevyImport: an assisted set is filed under a name that says so, never merged into the unassisted lift',
    run() {
      // Hevy writes assistance as a NEGATIVE weight_kg, sometimes under its own
      // "Assisted ..." title and sometimes under the reader's ordinary title
      // for the lift. Clamped to 0, a -20 kg assisted set reads exactly like a
      // real bodyweight set — and every downstream grouping (Records,
      // Progress) keys purely on exercise name, so it would silently become a
      // reps record for the unassisted lift (#bugs).
      const csv = [
        HEADER,
        // Logged against the reader's ordinary "Pull Up" entry, assisted.
        '"Back","10 Jun 2024, 08:00",,,"Pull Up",,,0,normal,-20,10,,,',
        // A real weighted pull-up, same day, same title.
        '"Back","10 Jun 2024, 08:00",,,"Pull Up",,,1,normal,8,5,,,',
        // Already named as assisted — must not become "... (assisted) (assisted)".
        '"Back","10 Jun 2024, 08:00",,,"Assisted Pull-Up",,,0,normal,-15,12,,,',
      ].join('\n');
      const preview = parseHevyCsv(csv);
      assert.equal(preview.workouts.length, 1);
      const names = preview.workouts[0].exercises.map((exercise) => exercise.name);
      assert.deepEqual(names.sort(), ['Assisted Pull-Up', 'Pull Up', 'Pull Up (assisted)']);

      const byName = Object.fromEntries(preview.workouts[0].exercises.map((exercise) => [exercise.name, exercise]));
      // The unassisted bucket only ever sees the real weighted set.
      assert.deepEqual(byName['Pull Up'].sets.map((set) => set.reps), [5]);
      assert.equal(byName['Pull Up'].sets[0].weightKg, 8);
      // The assisted set landed in its own bucket, weight clamped like any
      // other, but under a name Records and Progress will never confuse with
      // plain Pull Up (both group purely by exerciseNameSnapshot).
      assert.deepEqual(byName['Pull Up (assisted)'].sets.map((set) => set.reps), [10]);
      assert.equal(byName['Pull Up (assisted)'].sets[0].weightKg, 0);
      // A title that already says "assisted" is not suffixed again.
      assert.deepEqual(byName['Assisted Pull-Up'].sets.map((set) => set.reps), [12]);
    },
  },
  {
    name: 'hevyImport: an imported lift is tracked, so Records and Progress read it',
    run() {
      const provider = require('node:fs')
        .readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'state', 'AppProvider.tsx'), 'utf8');
      const importer = provider.slice(provider.indexOf('function importWorkoutHistory('), provider.indexOf('function restoreDatabaseFromBackup('));
      assert.match(importer, /tracked: true,/);
      assert.doesNotMatch(importer, /tracked: false/);
    },
  },
];
