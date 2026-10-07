const assert = require('node:assert/strict');

const {
  buildProgramCsv,
  formatCsvReps,
  summarizeExportSessions,
  CSV_EXPORT_HEADER,
} = require('../../.test-dist/lib/programCsvExport.js');
const { parseCsvProgram, buildDraftFromCsvPreview } = require('../../.test-dist/lib/csvProgramImport.js');

const SESSIONS = [
  {
    name: 'Day 1: Push',
    exercises: [
      { name: 'Bench Press', sets: 4, repMin: 6, repMax: 10 },
      { name: 'Incline Dumbbell Press', sets: 3, repMin: 8, repMax: 8 },
    ],
  },
  {
    name: 'Day 2: Pull',
    exercises: [{ name: 'Barbell Row', sets: 4, repMin: 6, repMax: 10 }],
  },
];

const LIBRARY = [
  { id: 'lib_bench', name: 'Bench Press' },
  { id: 'lib_incline', name: 'Incline Dumbbell Press' },
  { id: 'lib_row', name: 'Barbell Row' },
  { id: 'lib_squat', name: 'Back Squat' },
];

module.exports = [
  {
    name: 'programCsvExport: writes the header the importer requires',
    run() {
      const csv = buildProgramCsv(SESSIONS);
      assert.equal(csv.split('\n')[0], CSV_EXPORT_HEADER);
      assert.equal(CSV_EXPORT_HEADER, 'Day,Exercise,Sets,Reps');
    },
  },
  {
    name: 'programCsvExport: a fixed target stays a number, a range keeps its dash',
    run() {
      assert.equal(formatCsvReps(8, 8), '8');
      assert.equal(formatCsvReps(6, 10), '6-10');
      // Reversed or fractional input still produces something the importer reads.
      assert.equal(formatCsvReps(10, 6), '6-10', 'a reversed pair is sorted, not truncated');
      assert.equal(formatCsvReps(7.4, 9.6), '7-10');
      assert.equal(formatCsvReps(0, 0), '1', 'zero reps is not a thing the importer accepts');
    },
  },
  {
    name: 'programCsvExport: exported CSV parses back with every row intact',
    run() {
      const preview = parseCsvProgram(buildProgramCsv(SESSIONS), LIBRARY);

      assert.deepEqual(preview.errors, [], 'a plan we wrote ourselves must not produce errors');
      assert.equal(preview.rows.length, 3);
      assert.equal(preview.unmatchedCount, 0, 'every exercise name should match the library again');
      assert.equal(preview.dayCount, 2);

      assert.deepEqual(
        preview.rows.map((row) => [row.day, row.matchedName, row.sets, row.repMin, row.repMax]),
        [
          ['Day 1: Push', 'Bench Press', 4, 6, 10],
          ['Day 1: Push', 'Incline Dumbbell Press', 3, 8, 8],
          ['Day 2: Pull', 'Barbell Row', 4, 6, 10],
        ],
      );
    },
  },
  {
    name: 'programCsvExport: a full round trip rebuilds the same program',
    run() {
      const preview = parseCsvProgram(buildProgramCsv(SESSIONS), LIBRARY);
      const draft = buildDraftFromCsvPreview(preview, 'Rebuilt');

      assert.equal(draft.name, 'Rebuilt');
      assert.equal(draft.sessions.length, 2);
      assert.deepEqual(
        draft.sessions.map((session) => [session.name, session.exercises.length]),
        [['Day 1: Push', 2], ['Day 2: Pull', 1]],
      );
      assert.deepEqual(
        draft.sessions[0].exercises.map((exercise) => [
          exercise.name,
          exercise.targetSets,
          exercise.repMin,
          exercise.repMax,
        ]),
        [['Bench Press', 4, 6, 10], ['Incline Dumbbell Press', 3, 8, 8]],
      );
    },
  },
  {
    name: 'programCsvExport: a name containing a comma survives the round trip',
    run() {
      const sessions = [
        { name: 'Day 1', exercises: [{ name: 'Squat, Front', sets: 3, repMin: 5, repMax: 5 }] },
      ];
      const csv = buildProgramCsv(sessions);
      assert.match(csv, /"Squat, Front"/, 'a delimiter inside a cell has to be quoted');

      const preview = parseCsvProgram(csv, [{ id: 'lib_front', name: 'Squat, Front' }]);
      assert.deepEqual(preview.errors, []);
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.rows[0].exerciseName, 'Squat, Front');
      assert.equal(preview.rows[0].matchedName, 'Squat, Front');
    },
  },
  {
    name: 'programCsvExport: an empty day is dropped rather than written as a ghost',
    run() {
      const csv = buildProgramCsv([
        { name: 'Day 1', exercises: [{ name: 'Back Squat', sets: 3, repMin: 5, repMax: 5 }] },
        { name: 'Day 2', exercises: [] },
        { name: '   ', exercises: [{ name: 'Bench Press', sets: 3, repMin: 5, repMax: 5 }] },
      ]);

      assert.equal(csv.split('\n').length, 2, 'header plus the one real row');
      assert.ok(!csv.includes('Day 2'));

      const preview = parseCsvProgram(csv, LIBRARY);
      assert.equal(preview.dayCount, 1);
    },
  },
  {
    name: 'programCsvExport: a program with nothing in it still writes a valid header',
    run() {
      const csv = buildProgramCsv([]);
      assert.equal(csv, CSV_EXPORT_HEADER);
      // The importer reports no rows rather than a broken file.
      const preview = parseCsvProgram(csv, LIBRARY);
      assert.deepEqual(preview.rows, []);
      assert.deepEqual(preview.errors, []);
    },
  },
  {
    name: 'programCsvExport: every ready programme exported and imported again keeps each row in its own unit (bug hunt 2026-10-08)',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const { isMinutesTrackingMode, prescriptionUnitOf } = require('../../.test-dist/features/workout/workoutTypes.js');
      const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
      const { parseIntervalScheme } = require('../../.test-dist/lib/intervalScheme.js');
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const library = createSeedExerciseLibrary();
      const entries = library.map((item) => ({ id: item.id, name: item.name, sourceCategory: item.sourceCategory }));
      const dayKey = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

      const offenders = [];
      const unlinked = new Set();
      const seen = new Map();
      for (const template of WORKOUT_TEMPLATES_V1) {
        // The rows usePlanReadouts hands the export for a ready programme.
        const catalogueRows = template.sessions.flatMap((session) => session.exercises);
        const csv = buildProgramCsv(template.sessions.map((session) => ({
          name: session.name,
          exercises: session.exercises.map((exercise) => ({
            name: exercise.exerciseName,
            sets: exercise.sets,
            repMin: exercise.repsMin,
            repMax: exercise.repsMax,
            minutes: isMinutesTrackingMode(exercise.trackingMode),
          })),
        })));
        const preview = parseCsvProgram(csv, entries);
        assert.deepEqual(preview.errors, [], template.id);
        assert.equal(preview.rows.length, catalogueRows.length, template.id);
        const draft = buildDraftFromCsvPreview(preview, template.name);

        // Run the draft the way a saved custom programme runs.
        const sessions = draft.sessions.map((session, sessionIndex) => ({
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
        }));
        const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
          { id: 't', name: draft.name, origin: 'authored' },
          sessions,
          library,
          90,
        );

        // The draft keeps linked rows in order, one session per day name.
        const sessionOrder = [];
        const filled = new Map();
        preview.rows.forEach((row, index) => {
          const original = catalogueRows[index];
          if (!row.matchedName) {
            unlinked.add(original.exerciseName);
            return;
          }
          const key = dayKey(row.day);
          if (!filled.has(key)) {
            filled.set(key, 0);
            sessionOrder.push(key);
          }
          const imported = runtime.sessions[sessionOrder.indexOf(key)].exercises[filled.get(key)];
          filled.set(key, filled.get(key) + 1);

          const interval = parseIntervalScheme(original.exerciseName);
          const drift = [];
          if (prescriptionUnitOf(imported.trackingMode) !== prescriptionUnitOf(original.trackingMode)) {
            drift.push(`${prescriptionUnitOf(original.trackingMode)} -> ${prescriptionUnitOf(imported.trackingMode)}`);
          }
          if (JSON.stringify(parseIntervalScheme(imported.exerciseName)) !== JSON.stringify(interval)) {
            drift.push(`interval lost as "${imported.exerciseName}"`);
          }
          if (interval && imported.restSecondsMin !== interval.recoverySeconds) {
            drift.push(`rest ${imported.restSecondsMin} s, not the ${interval.recoverySeconds} s off-phase`);
          }
          if ([imported.sets, imported.repsMin, imported.repsMax].join() !== [original.sets, original.repsMin, original.repsMax].join()) {
            drift.push(`${original.sets}x${original.repsMin}-${original.repsMax} -> ${imported.sets}x${imported.repsMin}-${imported.repsMax}`);
          }
          if (drift.length && !seen.has(original.exerciseName)) {
            seen.set(original.exerciseName, true);
            offenders.push(`${template.id} / ${original.exerciseName}: ${drift.join(', ')}`);
          }
        });
      }

      assert.deepEqual(offenders, []);
      // Generic names the player files under no one row (DEMO_ONLY_ALIASES)
      // come back as a suggestion for the reader to confirm. Pinned, so a
      // new one fails here instead of quietly dropping out of the import.
      assert.deepEqual([...unlinked].sort(), [
        'Calf Raise',
        'Leg Curl',
        'Medicine Ball Slam',
        'Rear Delt Fly',
        'Sissy Squat',
        'Walking Lunge',
      ]);
    },
  },
  {
    name: 'programCsvExport: the list summary counts only days that carry exercises',
    run() {
      assert.deepEqual(summarizeExportSessions(SESSIONS), { dayCount: 2, exerciseCount: 3 });
      assert.deepEqual(
        summarizeExportSessions([...SESSIONS, { name: 'Day 3', exercises: [] }]),
        { dayCount: 2, exerciseCount: 3 },
      );
      assert.deepEqual(summarizeExportSessions([]), { dayCount: 0, exerciseCount: 0 });
    },
  },
];
