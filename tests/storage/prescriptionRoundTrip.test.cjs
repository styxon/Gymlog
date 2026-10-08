const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');

/**
 * A programme reads the same after the save and after the next launch.
 *
 * The loader collapses a rep range to one number and rests an interval on its
 * named off-phase; the writer kept whatever the editor handed it, and the
 * editors' own defaults are ranges. ProgramDayScreen showed "3 × 6–8" after a
 * save and "3 × 8" after a relaunch, and an interval's raised rest snapped
 * back (persistence audit, 2026-09-20). The writer lives in the React
 * provider, so its call is pinned in tests/lib/singleRepTarget; this runs
 * what it writes through the real save and load.
 */

function loadDatabaseModule() {
  const fake = createFakeAsyncStorage();
  return loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
}

module.exports = [
  {
    name: 'prescription: rows written the way the provider writes them load back unchanged',
    async run() {
      const database = loadDatabaseModule();
      const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));
      const { getExerciseTemplateDefaults } = require(path.join(DIST, 'lib', 'exerciseSuggestions.js'));
      const { stepProgramPrescription } = require(path.join(DIST, 'lib', 'programSessionEdit.js'));
      const { savedPrescription } = require(path.join(DIST, 'lib', 'singleRepTarget.js'));

      const empty = createEmptyDatabase('en');
      // What AppProvider.buildTemplateUpsert does with a draft row.
      const write = (name, draft) =>
        savedPrescription({
          name,
          repMin: Math.max(1, draft.repMin),
          repMax: Math.max(Math.max(1, draft.repMin), draft.repMax),
          restSeconds: draft.restSeconds && draft.restSeconds > 0 ? draft.restSeconds : null,
        });

      const rows = [];
      const add = (name, draft, extra = {}) => {
        const prescription = write(name, draft);
        rows.push({
          id: `ex_${rows.length}`,
          workoutTemplateId: 'wt1',
          workoutTemplateSessionId: 's1',
          name,
          targetSets: 3,
          ...prescription,
          trackedDefault: true,
          orderIndex: rows.length,
          libraryItemId: null,
          persistedExerciseTemplateId: null,
          supersetGroup: null,
          ...extra,
        });
      };
      // The editors' defaults, which are ranges, one per category.
      for (const category of ['compound', 'isolation', 'core']) {
        const item =
          empty.exerciseLibrary.find((entry) => entry.category === category && entry.equipment !== 'bodyweight') ??
          empty.exerciseLibrary.find((entry) => entry.category === category);
        const defaults = getExerciseTemplateDefaults(item, 120);
        assert.notEqual(defaults.repMin, defaults.repMax, `${category}: the defaults are no longer a range, so this proves nothing`);
        add(item.name, defaults);
      }
      // An interval copied from a ready programme, rest stepped up once in the tune sheet.
      const stepped = stepProgramPrescription({ targetSets: 8, repMin: 30, repMax: 30, restSeconds: 30 }, 'rest', 1);
      assert.notEqual(stepped.restSeconds, 30);
      add('Treadmill HIIT (30s on / 30s off)', stepped);
      // A hold keeps its bracket.
      add('Plank', { repMin: 30, repMax: 60, restSeconds: 45 });

      const stored = {
        ...empty,
        workoutTemplates: [
          {
            id: 'wt1',
            name: 'Mine',
            exerciseIds: rows.map((row) => row.id),
            sessions: [{ id: 's1', name: 'Day 1', orderIndex: 0, exerciseIds: rows.map((row) => row.id) }],
            createdAt: '2026-09-20T10:00:00.000Z',
            updatedAt: '2026-09-20T10:00:00.000Z',
            origin: 'authored',
            sourceTemplateId: null,
          },
        ],
        exerciseTemplates: rows,
      };
      await database.saveDatabase(stored);
      const loaded = await database.loadDatabase();
      for (const row of rows) {
        const back = loaded.exerciseTemplates.find((entry) => entry.id === row.id);
        assert.deepEqual(
          { repMin: back.repMin, repMax: back.repMax, restSeconds: back.restSeconds },
          { repMin: row.repMin, repMax: row.repMax, restSeconds: row.restSeconds },
          `${row.name}: saved as ${row.repMin}-${row.repMax} / ${row.restSeconds} s, read back as ${back.repMin}-${back.repMax} / ${back.restSeconds} s`,
        );
      }
      assert.equal(rows.find((row) => row.name === 'Plank').repMax, 60, 'the hold lost its bracket');
    },
  },
  {
    name: 'prescription: a programme saved before the rule still reads one rep number',
    async run() {
      // The rule itself is decided (2026-08-25/26) and stays on the load side.
      const database = loadDatabaseModule();
      const out = database.normalizeDatabase({
        workoutTemplates: [{ id: 'wt1', name: 'Old', sessions: [{ id: 's1', name: 'A', orderIndex: 0, exerciseIds: ['e1', 'e2'] }] }],
        exerciseTemplates: [
          { id: 'e1', workoutTemplateId: 'wt1', workoutTemplateSessionId: 's1', name: 'Bench Press', repMin: 8, repMax: 10, restSeconds: 120, orderIndex: 0 },
          { id: 'e2', workoutTemplateId: 'wt1', workoutTemplateSessionId: 's1', name: 'Bike HIIT (45s sprint / 15s rest)', repMin: 45, repMax: 45, restSeconds: 60, orderIndex: 1 },
        ],
      });
      const [bench, bike] = out.exerciseTemplates;
      assert.deepEqual([bench.repMin, bench.repMax, bench.restSeconds], [10, 10, 120]);
      assert.deepEqual([bike.repMin, bike.repMax, bike.restSeconds], [45, 45, 15]);
    },
  },
  {
    name: 'prescription: a row stored as a hold keeps its seconds bracket on load, whatever its name (round 2, 2026-10-08)',
    async run() {
      // What a CSV import of "Glute Bridge Hold, 3, 30-45" stored before it
      // kept the catalogue's name: the barbell bridge, marked a hold.
      const database = loadDatabaseModule();
      const out = database.normalizeDatabase({
        workoutTemplates: [{ id: 'wt1', name: 'Imported', sessions: [{ id: 's1', name: 'A', orderIndex: 0, exerciseIds: ['e1', 'e2'] }] }],
        exerciseTemplates: [
          { id: 'e1', workoutTemplateId: 'wt1', workoutTemplateSessionId: 's1', name: 'Barbell Glute Bridge', repMin: 30, repMax: 45, restSeconds: 90, orderIndex: 0, trackingMode: 'hold' },
          { id: 'e2', workoutTemplateId: 'wt1', workoutTemplateSessionId: 's1', name: 'Barbell Glute Bridge', repMin: 8, repMax: 10, restSeconds: 90, orderIndex: 1, trackingMode: 'load_and_reps' },
        ],
      });
      const [hold, lift] = out.exerciseTemplates;
      assert.deepEqual([hold.repMin, hold.repMax, hold.trackingMode], [30, 45, 'hold']);
      assert.deepEqual([lift.repMin, lift.repMax], [10, 10], 'the same name lifted for reps still reads one number');
    },
  },
];
