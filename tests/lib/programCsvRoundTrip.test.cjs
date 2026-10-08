const assert = require('node:assert/strict');

const DIST = '../../.test-dist/';
const {
  buildProgramCsv,
  csvExportRowOfCatalogue,
  csvExportRowOfSaved,
  CSV_EXPORT_HEADER,
} = require(`${DIST}lib/programCsvExport.js`);
const { parseCsvProgram, buildDraftFromCsvPreview } = require(`${DIST}lib/csvProgramImport.js`);
const { savedPrescription } = require(`${DIST}lib/singleRepTarget.js`);
const { prescriptionUnitFromName } = require(`${DIST}lib/sessionDuration.js`);
const { WORKOUT_TEMPLATES_V1, getWorkoutTemplateById } = require(`${DIST}features/workout/workoutCatalog.js`);
const { prescriptionUnitOf } = require(`${DIST}features/workout/workoutTypes.js`);
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(`${DIST}features/workout/customWorkoutAdapter.js`);
const { createSeedExerciseLibrary } = require(`${DIST}data/seed.js`);

const LIBRARY = createSeedExerciseLibrary();
const ENTRIES = LIBRARY.map((item) => ({ id: item.id, name: item.name, sourceCategory: item.sourceCategory }));

/**
 * The CSV text → what AppProvider stores: the draft through the writer's own
 * savedPrescription, as buildTemplateUpsert runs it.
 */
function importAndSave(csv) {
  const preview = parseCsvProgram(csv, ENTRIES);
  const draft = buildDraftFromCsvPreview(preview, 'Imported');
  return {
    preview,
    sessions: draft.sessions.map((session) => ({
      name: session.name,
      exercises: session.exercises.map((exercise) => {
        const prescription = savedPrescription({
          name: exercise.name,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          restSeconds: exercise.restSeconds,
          trackingMode: exercise.trackingMode ?? null,
        });
        return { ...exercise, ...prescription, trackingMode: exercise.trackingMode ?? null };
      }),
    })),
  };
}

/** Stored sessions → the runtime programme the player runs. */
function run(sessions) {
  return adaptLegacyWorkoutTemplateToRuntimeTemplate(
    { id: 't', name: 'Imported', origin: 'authored' },
    sessions.map((session, sessionIndex) => ({
      id: `s${sessionIndex}`,
      name: session.name,
      orderIndex: sessionIndex,
      exercises: session.exercises.map((exercise, index) => ({
        ...exercise,
        id: `s${sessionIndex}_e${index}`,
        workoutTemplateId: 't',
        workoutTemplateSessionId: `s${sessionIndex}`,
        orderIndex: index,
        trackingMode: exercise.trackingMode ?? null,
        supersetGroup: null,
      })),
    })),
    LIBRARY,
    90,
  );
}

/** A saved custom programme → the CSV the Export plan screen shares. */
function exportSaved(sessions) {
  return buildProgramCsv(sessions.map((session) => ({
    name: session.name,
    exercises: session.exercises.map(csvExportRowOfSaved),
  })));
}

/** One row as the player runs it, in the terms a round trip has to keep. */
function shape(exercise) {
  return [
    exercise.exerciseName,
    prescriptionUnitOf(exercise.trackingMode),
    prescriptionUnitFromName(exercise.exerciseName),
    exercise.sets,
    exercise.repsMin,
    exercise.repsMax,
  ].join('|');
}

function shapes(runtime) {
  return runtime.sessions.map((session) => `${session.name}: ${session.exercises.map(shape).join('; ')}`);
}

module.exports = [
  {
    name: 'plan CSV: a programme whose days share a name comes back with every day apart (round 2, 2026-10-08)',
    run() {
      const template = getWorkoutTemplateById('tpl_gainer_strength_5x5_v1');
      assert.deepEqual(template.sessions.map((session) => session.name), ['Workout A', 'Workout B', 'Workout A']);
      const csv = buildProgramCsv(template.sessions.map((session) => ({
        name: session.name,
        exercises: session.exercises.map(csvExportRowOfCatalogue),
      })));
      const { preview, sessions } = importAndSave(csv);
      assert.deepEqual(preview.errors, []);
      assert.equal(preview.dayCount, 3, 'the preview counts three days, as exported');
      assert.deepEqual(
        sessions.map((session) => [session.name, session.exercises.length]),
        template.sessions.map((session) => [session.name, session.exercises.length]),
        'the second Workout A is its own day again, not three more lifts on the first',
      );

      // A plan whose names are all different writes the four columns it always did.
      const plain = buildProgramCsv([
        { name: 'Push', exercises: [{ name: 'Bench Press', sets: 3, repMin: 8, repMax: 8 }] },
        { name: 'Pull', exercises: [{ name: 'Barbell Row', sets: 3, repMin: 8, repMax: 8 }] },
      ]);
      assert.equal(plain.split('\n')[0], CSV_EXPORT_HEADER);

      // A CSV written before the day number, or by hand, still groups by name.
      const old = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nA,Bench Press,3,8\nB,Barbell Row,3,8\nA,Back Squat,3,5',
        [{ id: 'b', name: 'Bench Press' }, { id: 'r', name: 'Barbell Row' }, { id: 's', name: 'Back Squat' }],
      );
      assert.deepEqual(old.errors, []);
      assert.equal(old.dayCount, 2);
      assert.deepEqual(
        buildDraftFromCsvPreview(old, 'Old').sessions.map((session) => [session.name, session.exercises.length]),
        [['A', 2], ['B', 1]],
      );
    },
  },
  {
    name: 'plan CSV: a day named like a role tag keeps its own day when the app wrote it',
    run() {
      const csv = buildProgramCsv([
        { name: 'Push', exercises: [{ name: 'Bench Press', sets: 3, repMin: 8, repMax: 8 }] },
        { name: 'Extra', exercises: [{ name: 'Barbell Curl', sets: 3, repMin: 12, repMax: 12 }] },
      ]);
      const { preview, sessions } = importAndSave(csv);
      assert.deepEqual(preview.errors, []);
      assert.deepEqual(sessions.map((session) => session.name), ['Push', 'Extra']);
    },
  },
  {
    name: 'plan CSV: a CSV-imported hold and HIIT row export and import again in their own unit (round 2, 2026-10-08)',
    run() {
      const first = importAndSave('Day,Exercise,Sets,Reps\nA,Glute Bridge Hold,3,30-45\nA,Rowing Machine HIIT,3,30');
      assert.deepEqual(first.preview.errors, []);
      const second = importAndSave(exportSaved(first.sessions));
      assert.deepEqual(second.preview.errors, []);
      assert.deepEqual(shapes(run(second.sessions)), shapes(run(first.sessions)));
      assert.deepEqual(shapes(run(first.sessions)), [
        'A: Glute Bridge Hold|seconds||3|30|45; Rowing Machine HIIT|reps|seconds|3|30|30',
      ]);
    },
  },
  {
    name: 'plan CSV: a stored row whose mode its name does not say exports with the unit written',
    run() {
      // Rows saved by the build that filed a ready row under its library
      // name: a hold under the barbell bridge, 30 s on the rower.
      const stored = [{
        name: 'A',
        exercises: [
          { name: 'Barbell Glute Bridge', targetSets: 3, repMin: 30, repMax: 45, restSeconds: 90, trackedDefault: true, libraryItemId: null, trackingMode: 'hold' },
          { name: 'Rowing, Stationary', targetSets: 3, repMin: 30, repMax: 30, restSeconds: 90, trackedDefault: true, libraryItemId: null, trackingMode: 'reps_first' },
          { name: 'Plank', targetSets: 3, repMin: 10, repMax: 10, restSeconds: 60, trackedDefault: true, libraryItemId: null, trackingMode: 'bodyweight' },
          { name: 'Stairmaster', targetSets: 1, repMin: 20, repMax: 20, restSeconds: 0, trackedDefault: true, libraryItemId: null, trackingMode: 'duration_minutes' },
        ],
      }];
      const csv = exportSaved(stored);
      assert.match(csv, /^A,Barbell Glute Bridge,3,30-45 s$/m);
      assert.match(csv, /^A,"Rowing, Stationary",3,30 reps$/m);
      assert.match(csv, /^A,Plank,3,10 reps$/m);
      assert.match(csv, /^A,Stairmaster,1,20 min$/m);
      const again = importAndSave(csv);
      assert.deepEqual(again.preview.errors, []);
      assert.deepEqual(
        run(again.sessions).sessions[0].exercises.map((exercise) => [exercise.exerciseName, prescriptionUnitOf(exercise.trackingMode), exercise.repsMin, exercise.repsMax]),
        [
          ['Barbell Glute Bridge', 'seconds', 30, 45],
          ['Rowing, Stationary', 'reps', 30, 30],
          ['Plank', 'reps', 10, 10],
          ['Stairmaster', 'minutes', 20, 20],
        ],
      );
    },
  },
  {
    name: 'plan CSV: a ready name whose bracket states the dose keeps it on import (round 2, 2026-10-08)',
    run() {
      const { sessions } = importAndSave([
        'Day,Exercise,Sets,Reps',
        'A,Sprint Interval (200m),6,200',
        'A,Rowing Machine (500m intervals),6,500',
        'A,air bike (30s sprint),8,30',
      ].join('\n'));
      assert.deepEqual(
        sessions[0].exercises.map((exercise) => [exercise.name, prescriptionUnitFromName(exercise.name), exercise.repMax]),
        [
          ['Sprint Interval (200m)', 'metres', 200],
          ['Rowing Machine (500m intervals)', 'metres', 500],
          ['Air Bike (30s sprint)', 'seconds', 30],
        ],
      );
      assert.ok(sessions[0].exercises.every((exercise) => exercise.libraryItemId), 'still linked to its library row');
    },
  },
  {
    name: 'plan CSV: an inch mark inside an unquoted cell is part of the name (round 2, 2026-10-08)',
    run() {
      const library = [{ id: 'lib_box', name: 'Box Jump' }, { id: 'lib_plank', name: 'Plank' }];
      // Two marks in one cell, too: read as a quoted run, the text between
      // them lost both.
      for (const written of ['6" Box Jump', 'Box Jump (24")', 'Box Jump (20" or 24")']) {
        const preview = parseCsvProgram(`Day,Exercise,Sets,Reps\nA,${written},3,10\nA,Plank,3,30`, library);
        assert.deepEqual(preview.errors, [], written);
        assert.deepEqual(
          preview.rows.map((row) => [row.exerciseName, row.sets, row.repMax]),
          [[written, 3, 10], ['Plank', 3, 30]],
          written,
        );
      }
      // The RFC form still reads, and the app writes it for a name with a quote.
      const quoted = parseCsvProgram('Day,Exercise,Sets,Reps\nA,"Box Jump (24"")",3,10', library);
      assert.equal(quoted.rows[0].exerciseName, 'Box Jump (24")');
      const csv = buildProgramCsv([{ name: 'A', exercises: [{ name: 'Box Jump (24", wide)', sets: 3, repMin: 10, repMax: 10 }] }]);
      assert.equal(parseCsvProgram(csv, library).rows[0].exerciseName, 'Box Jump (24", wide)');
    },
  },
  {
    name: 'plan CSV: a quote opened and never closed is the one error its row gets',
    run() {
      const preview = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nA,"Box Jump,3,10\nA,Plank,3,30',
        [{ id: 'lib_box', name: 'Box Jump' }, { id: 'lib_plank', name: 'Plank' }],
      );
      assert.equal(preview.errors.length, 1, JSON.stringify(preview.errors));
      assert.match(preview.errors[0], /^Row 2: a quote/);
      assert.deepEqual(preview.rows.map((row) => [row.matchedName, row.sets, row.repMax]), [['Box Jump', 3, 10], ['Plank', 3, 30]]);
    },
  },
  {
    name: 'plan CSV: every mode a saved row can carry, under every kind of name, comes back in its unit',
    run() {
      const { WORKOUT_TRACKING_MODES } = require(`${DIST}features/workout/workoutTypes.js`);
      const { isHoldExerciseName } = require(`${DIST}lib/holdExercises.js`);
      const names = [
        'Barbell Bench Press - Medium Grip',
        'Barbell Glute Bridge',
        'Plank',
        'Rowing, Stationary',
        'Glute Bridge Hold',
        'Push-Up (20s on / 10s off)',
      ];
      const numbers = { reps: [8, 8], seconds: [30, 45], minutes: [20, 20] };
      const stored = [];
      for (const mode of WORKOUT_TRACKING_MODES) {
        const [repMin, repMax] = numbers[prescriptionUnitOf(mode)];
        stored.push({
          // Day names the importer could fold together, or into the day above.
          name: ['Day 1', 'Push, Upper', 'Extra', 'day 1', 'Day 1'][stored.length % 5],
          // Minutes on a hold's name are no shape the app writes, and the
          // importer reads them as the hold in seconds by decision
          // ("Plank, 3, 1 min", 2026-10-07).
          exercises: names
            .filter((name) => !(mode === 'duration_minutes' && isHoldExerciseName(name)))
            .map((name) => ({
              name, targetSets: 3, repMin, repMax, restSeconds: 60, trackedDefault: true, libraryItemId: null, trackingMode: mode,
            })),
        });
      }
      const before = run(stored);
      const { preview, sessions } = importAndSave(exportSaved(stored));
      assert.deepEqual(preview.errors, []);
      assert.equal(preview.unmatchedCount, 0);
      const after = run(sessions);
      const unitAndDose = (runtime) => runtime.sessions.map((session) =>
        `${session.name}: ${session.exercises.map((exercise) =>
          [exercise.exerciseName, prescriptionUnitOf(exercise.trackingMode), exercise.sets, exercise.repsMin, exercise.repsMax].join('|')).join('; ')}`);
      assert.deepEqual(unitAndDose(after), unitAndDose(before));
    },
  },
  {
    name: 'plan CSV: every ready programme survives export, import, save, export and import again',
    run() {
      const drift = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const csv = buildProgramCsv(template.sessions.map((session) => ({
          name: session.name,
          exercises: session.exercises.map(csvExportRowOfCatalogue),
        })));
        const first = importAndSave(csv);
        assert.deepEqual(first.preview.errors, [], template.id);
        assert.deepEqual(
          first.sessions.map((session) => session.name),
          template.sessions.map((session) => session.name),
          `${template.id}: one day per exported day`,
        );
        // The draft drops only the rows the importer could not link.
        const linked = new Set(first.preview.rows.filter((row) => row.matchedName).map((row) => row.exerciseName));
        const expected = template.sessions.map((session) =>
          `${session.name}: ${session.exercises
            .filter((exercise) => linked.has(exercise.exerciseName))
            .map((exercise) => [
              exercise.exerciseName,
              prescriptionUnitOf(exercise.trackingMode),
              prescriptionUnitFromName(exercise.exerciseName),
              exercise.sets,
              // What the writer keeps of the catalogue's own row.
              savedPrescription({ name: exercise.exerciseName, repMin: exercise.repsMin, repMax: exercise.repsMax, restSeconds: null, trackingMode: exercise.trackingMode }).repMin,
              exercise.repsMax,
            ].join('|'))
            .join('; ')}`);
        const once = shapes(run(first.sessions));
        if (JSON.stringify(once) !== JSON.stringify(expected)) {
          drift.push({ template: template.id, hop: 1, expected, got: once });
          continue;
        }
        const second = importAndSave(exportSaved(first.sessions));
        assert.deepEqual(second.preview.errors, [], template.id);
        const twice = shapes(run(second.sessions));
        if (JSON.stringify(twice) !== JSON.stringify(once)) {
          drift.push({ template: template.id, hop: 2, expected: once, got: twice });
        }
      }
      assert.deepEqual(drift, []);
    },
  },
];
