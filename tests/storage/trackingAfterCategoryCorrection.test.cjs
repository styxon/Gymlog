const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { GENERATED_EXERCISE_LIBRARY } = require(path.join(DIST, 'data', 'generatedExerciseLibrary.js'));
const { createSeedDatabase, createSeedExerciseLibrary } = require(path.join(DIST, 'data', 'seed.js'));
const { WORKOUT_TEMPLATES_V1 } = require(path.join(DIST, 'features', 'workout', 'workoutCatalog.js'));
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(path.join(DIST, 'features', 'workout', 'customWorkoutAdapter.js'));
const { buildProgrammeDraft, composeProgrammePreview, resolveLiveProposal } = require(path.join(DIST, 'lib', 'programmeBrief.js'));
const { TRACKING_CATEGORY_MIGRATION_ID } = require(path.join(DIST, 'lib', 'trackingCategoryMigration.js'));

/**
 * No one's progression changes with the library's category correction (user
 * decision, 2026-10-06).
 *
 * A custom programme's lift is tracked when the library calls it compound, and
 * otherwise when its stored `trackedDefault` says so. Copies of ready
 * programmes and AI-coach programmes stored false on every row, so the
 * correction — 220 curls, raises and flies filed isolation instead of
 * compound — would have taken those lifts out of the progression in every
 * such programme already on a phone. These run old saves through the real
 * loader and compare each lift's role with the one it had before.
 *
 * "Before" is what the phone had, read independently of the migration's own
 * list: the generated rows with their raw, uncorrected category (that file is
 * what shipped; the correction is applied at runtime) and the seven
 * hand-written rows that shipped, with their shipped category. A row added to
 * the library since gives a copied name a library row for the first time;
 * where that row is compound the lift is tracked whatever was stored — a gain
 * the stored value cannot undo, and never a loss. Those are told apart below.
 */

/** The hand-written rows as 493f3d30 shipped them. */
const SHIPPED_EXTRA_CATEGORIES = {
  extra_machine_hip_thrust: 'compound',
  extra_kettlebell_swing: 'compound',
  extra_burpee: 'compound',
  extra_band_curl: 'compound',
  extra_bulgarian_split_squat: 'compound',
  extra_bodyweight_calf_raise: 'isolation',
  extra_single_leg_calf_raise: 'isolation',
};

const generatedCategory = new Map(GENERATED_EXERCISE_LIBRARY.map((item) => [item.id, item.category]));
const library = createSeedExerciseLibrary();
const shipped = (item) => generatedCategory.has(item.id) || item.id in SHIPPED_EXTRA_CATEGORIES;
const shippedLibrary = library
  .filter(shipped)
  .map((item) => ({ ...item, category: SHIPPED_EXTRA_CATEGORIES[item.id] ?? generatedCategory.get(item.id) }));

function loadModule() {
  const fake = createFakeAsyncStorage();
  return { fake, database: loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js')) };
}

/** Stored rows the way the provider writes them, from a list of days. */
function storedTemplate(id, name, days, extra = {}) {
  const sessions = [];
  const exercises = [];
  days.forEach((day, dayIndex) => {
    const sessionId = `${id}_s${dayIndex}`;
    const rows = day.exercises.map((exercise, index) => ({
      id: `${sessionId}_e${index}`,
      workoutTemplateId: id,
      workoutTemplateSessionId: sessionId,
      name: exercise.name,
      targetSets: exercise.targetSets ?? 3,
      repMin: exercise.repMin ?? 8,
      repMax: exercise.repMax ?? 8,
      restSeconds: exercise.restSeconds ?? 90,
      trackedDefault: exercise.trackedDefault,
      orderIndex: index,
      libraryItemId: exercise.libraryItemId ?? null,
      trackingMode: exercise.trackingMode ?? null,
      supersetGroup: null,
    }));
    sessions.push({ id: sessionId, name: day.name, orderIndex: dayIndex, exerciseIds: rows.map((row) => row.id) });
    exercises.push(...rows);
  });
  return {
    template: {
      id,
      name,
      exerciseIds: exercises.map((row) => row.id),
      sessions,
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z',
      origin: 'authored',
      sourceTemplateId: null,
      ...extra,
    },
    exercises,
  };
}

/** A ready programme copied the way the copy writer did before 2026-10-06: every row false, no library id. */
function oldCopyOf(ready) {
  return storedTemplate(
    `copy_${ready.id}`,
    `${ready.name} (kopio)`,
    ready.sessions.map((session) => ({
      name: session.name,
      exercises: session.exercises.map((exercise) => ({
        name: exercise.exerciseName,
        targetSets: exercise.sets,
        repMin: exercise.repsMin,
        repMax: exercise.repsMax,
        restSeconds: exercise.restSecondsMin,
        trackedDefault: false,
        trackingMode: exercise.trackingMode,
      })),
    })),
    { sourceTemplateId: ready.id },
  );
}

/** An AI-coach programme as buildProgrammeDraft wrote it before 2026-10-06: every row false. */
function oldCoachProgramme(id, proposal) {
  const draft = buildProgrammeDraft(proposal, []);
  return storedTemplate(
    id,
    draft.name,
    draft.sessions.map((session) => ({
      name: session.name,
      exercises: session.exercises.map((exercise) => ({ ...exercise, trackedDefault: false })),
    })),
  );
}

function coachProgrammes() {
  const preferences = createSeedDatabase().preferences;
  const briefs = ['4 päivää, kädet ja rinta', '3 päivää, jalat ja selkä', '5 days push pull legs', '6 päivää'];
  const live = resolveLiveProposal(
    {
      title: 'Arms and shoulders',
      sessions: [
        {
          name: 'Arms',
          exercises: ['Barbell Curl', 'Preacher Curl', 'Incline Dumbbell Curl', 'Dumbbell Bicep Curl', 'Triceps Pushdown', 'Band Curl'].map((name) => ({ name, sets: 3, repsMin: 10, repsMax: 10 })),
        },
        {
          name: 'Legs',
          exercises: ['Barbell Squat', 'Seated Leg Curl', 'Seated Calf Raise', 'Leg Extensions', 'Single Leg Glute Bridge', 'Plank'].map((name) => ({ name, sets: 3, repsMin: 10, repsMax: 10 })),
        },
        {
          name: 'Chest',
          exercises: ['Barbell Bench Press - Medium Grip', 'Cable Crossover', 'Side Lateral Raise', 'Cable Crunch'].map((name) => ({ name, sets: 3, repsMin: 10, repsMax: 10 })),
        },
      ],
    },
    'kädet, jalat ja rinta',
    library,
    120,
  );
  return [
    ...briefs.map((brief, index) => oldCoachProgramme(`coach_preview_${index}`, composeProgrammePreview(brief, preferences, library))),
    oldCoachProgramme('coach_live', live),
  ];
}

/** Each stored lift's role and priority, as a custom programme is played. */
function rolesOf(templates, exerciseRows, exerciseLibrary) {
  const roles = new Map();
  for (const template of templates) {
    const sessions = template.sessions.map((session) => ({
      ...session,
      exercises: exerciseRows.filter((row) => row.workoutTemplateId === template.id && row.workoutTemplateSessionId === session.id),
    }));
    const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, exerciseLibrary, 120);
    for (const session of runtime.sessions) {
      for (const exercise of session.exercises) {
        roles.set(exercise.id, `${exercise.role}/${exercise.progressionPriority}`);
      }
    }
  }
  return roles;
}

/** The library row a stored lift plays as — customWorkoutAdapter's lookup. */
function resolve(row, exerciseLibrary) {
  return (
    (row.libraryItemId ? exerciseLibrary.find((item) => item.id === row.libraryItemId) : undefined) ??
    exerciseLibrary.find((item) => item.name.trim().toLowerCase() === row.name.trim().toLowerCase())
  );
}

/**
 * Loads the old save through the real loader and compares every lift's role
 * with the one it had on the shipped library. `changed` is every difference
 * on a lift whose library row shipped, or that has none; `gained` the lifts a
 * row added since puts in the trend. `wouldChange` counts what the correction
 * alone, with no migration, would have changed — so the suite shows it
 * measures something.
 */
function compareAfterLoad(stored) {
  const blob = {
    workoutTemplates: stored.map((entry) => entry.template),
    exerciseTemplates: stored.flatMap((entry) => entry.exercises),
  };
  const before = rolesOf(blob.workoutTemplates, blob.exerciseTemplates, shippedLibrary);
  const unmigrated = rolesOf(blob.workoutTemplates, blob.exerciseTemplates, library);
  const { database } = loadModule();
  const loaded = database.normalizeDatabase(JSON.parse(JSON.stringify(blob)));
  const after = rolesOf(loaded.workoutTemplates, loaded.exerciseTemplates, loaded.exerciseLibrary);
  const changed = [];
  const gained = [];
  let wouldChange = 0;
  for (const [id, role] of before) {
    const row = blob.exerciseTemplates.find((entry) => entry.id === id);
    const item = resolve(row, loaded.exerciseLibrary);
    const label = `${row.workoutTemplateId} ${row.name}: ${role} -> ${after.get(id)}`;
    if (item && !shipped(item)) {
      if (after.get(id) !== role) {
        gained.push({ label, role, after: after.get(id), item });
      }
      continue;
    }
    if (unmigrated.get(id) !== role) {
      wouldChange += 1;
    }
    if (after.get(id) !== role) {
      changed.push(label);
    }
  }
  return { changed, gained, wouldChange, rows: before.size };
}

/** A gain is an untracked lift that a new compound library row now tracks — never the other way. */
function assertOnlyGains(gained) {
  for (const entry of gained) {
    assert.equal(entry.role, 'accessory/low', entry.label);
    assert.equal(entry.after, 'secondary/medium', entry.label);
    assert.equal(entry.item.category, 'compound', entry.label);
  }
}

module.exports = [
  {
    name: 'tracking after the category correction: every lift of an old copy of every ready programme keeps its role and priority',
    run() {
      const { changed, gained, wouldChange, rows } = compareAfterLoad(WORKOUT_TEMPLATES_V1.map(oldCopyOf));
      assert.ok(rows > 1000, `the copies hold ${rows} lifts`);
      assert.ok(wouldChange > 50, `without the migration ${wouldChange} copied lifts would change role`);
      assert.deepEqual(changed, []);
      assertOnlyGains(gained);
    },
  },
  {
    name: 'tracking after the category correction: every lift of an old AI-coach programme keeps its role and priority',
    run() {
      const { changed, gained, wouldChange, rows } = compareAfterLoad(coachProgrammes());
      assert.ok(rows > 40, `the coach programmes hold ${rows} lifts`);
      assert.ok(wouldChange > 5, `without the migration ${wouldChange} coach lifts would change role`);
      assert.deepEqual(changed, []);
      assertOnlyGains(gained);
    },
  },
  {
    name: 'tracking after the category correction: an old database blob with copies, coach, onboarding and hand-built programmes loads, and saves and loads back unchanged',
    async run() {
      // A save from before 2026-10-06: no appliedMigrations, the copy and the
      // coach programme with every row false, onboarding's with every row
      // true, a hand-built one as the template editor's old defaults wrote it.
      const copy = storedTemplate(
        'workout_copy',
        'Upper Lower (kopio)',
        [
          {
            name: 'Upper',
            exercises: [
              { name: 'Bench Press', trackedDefault: false },
              { name: 'Barbell Curl', trackedDefault: false },
              { name: 'Triceps Pushdown', trackedDefault: false },
              { name: 'Plank', trackedDefault: false },
            ],
          },
        ],
        { sourceTemplateId: 'tpl_upper_lower_v1' },
      );
      const coach = storedTemplate('workout_coach', 'Vinha AI', [
        {
          name: 'Legs',
          exercises: [
            { name: 'Barbell Squat', trackedDefault: false, libraryItemId: 'free_barbell_squat' },
            { name: 'Seated Calf Raise', trackedDefault: false, libraryItemId: 'free_seated_calf_raise' },
            { name: 'Cable Crossover', trackedDefault: false, libraryItemId: 'free_cable_crossover' },
          ],
        },
      ]);
      const onboarding = storedTemplate(
        'workout_onboarding',
        'Full Body',
        [{ name: 'A', exercises: [{ name: 'Barbell Curl', trackedDefault: true }, { name: 'Plank', trackedDefault: true }] }],
        { sourceTemplateId: 'tpl_full_body_v1' },
      );
      const handBuilt = storedTemplate('workout_own', 'Oma', [
        { name: 'A', exercises: [{ name: 'Leg Extensions', trackedDefault: true, libraryItemId: 'free_leg_extensions' }, { name: 'Cable Crunch', trackedDefault: false }] },
      ]);
      const stored = [copy, coach, onboarding, handBuilt];
      const blob = {
        workoutTemplates: stored.map((entry) => entry.template),
        exerciseTemplates: stored.flatMap((entry) => entry.exercises),
        workoutPlans: [],
        workoutSessions: [],
        exerciseLogs: [],
        preferences: createSeedDatabase().preferences,
      };
      const { fake, database } = loadModule();
      fake.rows.set('@vinha/database/v1', JSON.stringify(blob));
      const loaded = await database.loadDatabase();
      const tracked = Object.fromEntries(loaded.exerciseTemplates.map((row) => [`${row.workoutTemplateId}:${row.name}`, row.trackedDefault]));
      assert.deepEqual(tracked, {
        'workout_copy:Bench Press': false,
        'workout_copy:Barbell Curl': true,
        'workout_copy:Triceps Pushdown': true,
        'workout_copy:Plank': false,
        'workout_coach:Barbell Squat': false,
        'workout_coach:Seated Calf Raise': true,
        'workout_coach:Cable Crossover': true,
        'workout_onboarding:Barbell Curl': true,
        'workout_onboarding:Plank': true,
        'workout_own:Leg Extensions': true,
        'workout_own:Cable Crunch': false,
      });
      assert.deepEqual(loaded.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);
      assert.equal(loaded.workoutTemplates.length, 4);
      // Saved and loaded again: nothing moves.
      await database.saveDatabase(loaded);
      const again = await database.loadDatabase();
      assert.deepEqual(again.exerciseTemplates, loaded.exerciseTemplates);
      assert.deepEqual(again.workoutTemplates, loaded.workoutTemplates);
      assert.deepEqual(again.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);
    },
  },
  {
    name: 'tracking after the category correction: it runs once — a false a writer stores after the update stays false',
    run() {
      const { database } = loadModule();
      const first = database.normalizeDatabase({
        exerciseTemplates: [
          { id: 'e1', workoutTemplateId: 't', workoutTemplateSessionId: 's', name: 'Barbell Curl', targetSets: 3, repMin: 8, repMax: 8, restSeconds: 90, trackedDefault: false, orderIndex: 0 },
        ],
        workoutTemplates: [{ id: 't', name: 'T', sessions: [{ id: 's', name: 'A', orderIndex: 0, exerciseIds: ['e1'] }], origin: 'authored' }],
      });
      assert.equal(first.exerciseTemplates[0].trackedDefault, true);
      assert.deepEqual(database.normalizeDatabase(first), first, 'normalized twice is normalized once');
      // A curl added in the template editor today: the corrected library's
      // defaults store it untracked, and that is meant.
      const added = {
        ...first,
        exerciseTemplates: [...first.exerciseTemplates, { ...first.exerciseTemplates[0], id: 'e2', orderIndex: 1, trackedDefault: false }],
      };
      const reloaded = database.normalizeDatabase(JSON.parse(JSON.stringify({ ...added, exerciseLibrary: [] })));
      assert.deepEqual(reloaded.exerciseTemplates.map((row) => [row.id, row.trackedDefault]), [['e1', true], ['e2', false]]);
      assert.deepEqual(reloaded.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);
    },
  },
  {
    name: 'tracking after the category correction: a stored marker list that is junk loads as none, and the migration still runs once',
    run() {
      const { database } = loadModule();
      const loaded = database.normalizeDatabase({
        appliedMigrations: 'yes',
        exerciseTemplates: [
          { id: 'e1', workoutTemplateId: 't', workoutTemplateSessionId: 's', name: 'Preacher Curl', targetSets: 3, repMin: 8, repMax: 8, restSeconds: 90, trackedDefault: false, orderIndex: 0 },
        ],
        workoutTemplates: [{ id: 't', name: 'T', sessions: [{ id: 's', name: 'A', orderIndex: 0, exerciseIds: ['e1'] }] }],
      });
      assert.equal(loaded.exerciseTemplates[0].trackedDefault, true);
      assert.deepEqual(loaded.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);
    },
  },
  {
    name: 'tracking after the category correction: restoring an old backup runs the migration; restoring a new one leaves a stored false alone',
    run() {
      // AppProvider.restoreDatabaseFromBackup is normalizeDatabase over the
      // downloaded payload's database (guarded by backupRoundTripInvariant),
      // so this is the restore path: build, upload, download, parse, normalize.
      const { buildAccountBackupPayload, encodeAccountBackupBody, decodeAccountBackupBody, parseAccountBackupPayload } = require(path.join(DIST, 'lib', 'accountBackup.js'));
      const { database } = loadModule();
      const old = storedTemplate('workout_copy', 'Upper Lower (kopio)', [
        { name: 'Upper', exercises: [{ name: 'Barbell Curl', trackedDefault: false }, { name: 'Plank', trackedDefault: false }] },
      ]);
      const history = { sessions: [], slotHistory: {} };
      const restore = (databaseInBackup) => {
        const payload = buildAccountBackupPayload(databaseInBackup, history, '2026-10-06T08:00:00.000Z');
        const downloaded = parseAccountBackupPayload(decodeAccountBackupBody(JSON.parse(encodeAccountBackupBody(payload))));
        assert.ok(downloaded, 'the backup parses');
        return database.normalizeDatabase(downloaded.database);
      };

      // A backup an old release uploaded: no marker, every copied row false.
      const oldBackupDatabase = {
        ...createSeedDatabase(),
        workoutTemplates: [old.template],
        exerciseTemplates: old.exercises,
      };
      delete oldBackupDatabase.appliedMigrations;
      const restoredOld = restore(oldBackupDatabase);
      assert.deepEqual(
        restoredOld.exerciseTemplates.map((row) => [row.name, row.trackedDefault]),
        [['Barbell Curl', true], ['Plank', false]],
      );
      assert.deepEqual(restoredOld.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);

      // A backup this release uploaded carries the marker through the round
      // trip, and a false a writer stored after the update is not undone.
      const newBackupDatabase = {
        ...restoredOld,
        exerciseTemplates: restoredOld.exerciseTemplates.map((row) => (row.name === 'Barbell Curl' ? { ...row, trackedDefault: false } : row)),
      };
      const restoredNew = restore(newBackupDatabase);
      assert.deepEqual(
        restoredNew.exerciseTemplates.map((row) => [row.name, row.trackedDefault]),
        [['Barbell Curl', false], ['Plank', false]],
      );
      assert.deepEqual(restoredNew.appliedMigrations, [TRACKING_CATEGORY_MIGRATION_ID]);
    },
  },
];
