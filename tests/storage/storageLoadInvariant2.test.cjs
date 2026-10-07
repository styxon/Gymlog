const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, createFakeIosAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

/**
 * The app opens on any data it ever wrote (never-list N3), part two: the
 * stored shapes that landed after storageLoadInvariant.test.cjs (2026-10-03).
 *
 *   1. RHYTHM PER PROGRAMME (#335). The old app-wide `preferences.trainingCycle`
 *      moves onto the lead plan exactly once, survives load -> save -> load,
 *      never lands on another plan, and a plan's malformed rhythm never throws.
 *   2. WORKOUT BUNDLE. `session.minutesClock` (#337/#339) in every state,
 *      warm-ups (#321) live and in "last time", and a session saved by the
 *      pre-#321 shape: the running workout survives and nothing throws.
 *   3. ONE-SHOT MIGRATIONS. The category-tracking rule (#330), the minutes-mode
 *      rule and its undo run once, are idempotent, never touch a logged set,
 *      and do not run again once the database carries their marker. The
 *      corrupt-copy slots (#320) keep every distinct copy and only one of each.
 *   4. LIBRARY IDS. Custom programme rows pointing at every id #330 refiled,
 *      every hand-written extra row, a retired `lib_*` id and an id no build
 *      ever shipped load and keep a name to display.
 *
 * Fixtures are built from the newest release in tests/fixtures/storage-history
 * (2026-10-01, before #321, #330, #335 and #337) so "old database" means a row
 * that release actually wrote.
 */

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'storage-history', '2026-10-01-40c35d45.json');
const DB_KEY = '@vinha/database/v1';
const PREFS_KEY = '@vinha/preferences/v1';
const WK_KEY = '@vinha/workout/v1';
const DB_CORRUPT = '@vinha/database/corrupt';
const WK_CORRUPT = '@vinha/workout/corrupt';
const DIST = path.join(__dirname, '..', '..', '.test-dist');

const LEGACY_CYCLE = { pattern: [true, true, true, false], anchorDayStart: Date.UTC(2026, 8, 7, 21) };
const OWN_CYCLE = { pattern: [true, false], anchorDayStart: Date.UTC(2026, 8, 1, 21) };

// --------------------------------------------------------------- plumbing

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseRows() {
  return clone(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).rows);
}

function baseDb() {
  return JSON.parse(baseRows()[DB_KEY]);
}

function basePrefs() {
  return JSON.parse(baseRows()[PREFS_KEY]);
}

function baseBundle() {
  return JSON.parse(baseRows()[WK_KEY]);
}

function openOn(fake, options) {
  const mods = loadAgainstFake(
    fake,
    (requireDist) => ({
      database: requireDist('storage/database.js'),
      workout: requireDist('features/workout/workoutPersistence.js'),
      large: requireDist('storage/largeItem.js'),
      corrupt: requireDist('storage/corruptCopies.js'),
    }),
    options,
  );
  return { fake, ...mods };
}

function openRows(rows, options) {
  const fake = createFakeAsyncStorage();
  for (const [key, value] of Object.entries(rows)) {
    if (value !== undefined) fake.rows.set(key, value);
  }
  return openOn(fake, options);
}

/** Rows for a database `db` and a preferences key `prefs` (undefined: no key). */
function rowsFor(db, prefs, bundle) {
  const rows = { [DB_KEY]: JSON.stringify(db) };
  if (prefs !== undefined) rows[PREFS_KEY] = JSON.stringify(prefs);
  rows[WK_KEY] = JSON.stringify(bundle === undefined ? baseBundle() : bundle);
  return rows;
}

function planNamed(db, id, extra = {}) {
  const template = db.workoutPlans[0];
  return { ...clone(template), id, name: `Plan ${id}`, ...extra };
}

function cycleOf(db, planId) {
  const plan = db.workoutPlans.find((item) => item.id === planId);
  return plan ? plan.trainingCycle ?? null : undefined;
}

async function readStored(app) {
  const raw = await app.large.getLargeItem(DB_KEY);
  const prefs = app.fake.rows.get(PREFS_KEY);
  return { db: raw ? JSON.parse(raw) : null, prefs: prefs ? JSON.parse(prefs) : null };
}

/** Loads, saves what it loaded (both keys), loads again on a fresh module set. */
async function loadSaveLoad(app) {
  const first = await app.database.loadDatabase();
  await app.database.saveDatabase(first, { withPreferences: true });
  const again = openOn(app.fake);
  const second = await again.database.loadDatabase();
  return { first, second, again };
}

function plansCycles(db) {
  return Object.fromEntries(db.workoutPlans.map((plan) => [plan.id, plan.trainingCycle ?? null]));
}

// The whole bundle's logged numbers, for "nothing logged was dropped".
function loggedSets(session) {
  if (!session) return [];
  return session.exercises.flatMap((exercise) =>
    exercise.sets
      .filter((set) => set && set.status === 'completed')
      .map((set) => `${exercise.slotId}#${set.setIndex}:${set.actualLoadKg}x${set.actualReps}`),
  );
}

function logSets(db) {
  return db.exerciseLogs.flatMap((log) => (log.sets || []).map((set) => `${log.id}:${set.weight}x${set.reps}:${set.kind ?? ''}`));
}

// =====================================================================
// 1. Rhythm per programme (#335)
// =====================================================================

/** Every old shape the rhythm can be stored in, and where it must end up. */
function cycleCases() {
  const cases = [];
  const db0 = baseDb();
  const prefs0 = basePrefs();
  const lead = db0.preferences.activePlanId; // plan_push_pull_legs

  // A. Legacy rhythm in both copies, one plan, which leads.
  {
    const db = baseDb();
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({ name: 'one plan, lead, rhythm in both copies', db, prefs, expect: { [lead]: LEGACY_CYCLE } });
  }
  // B. Only the blob's copy (no preferences key: an install from before the split).
  {
    const db = baseDb();
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    cases.push({ name: 'rhythm in the blob only, no preferences key', db, prefs: undefined, expect: { [lead]: LEGACY_CYCLE } });
  }
  // C. The key's copy wins over the blob's null.
  {
    const db = baseDb();
    db.preferences.trainingCycle = null;
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({ name: 'rhythm in the preferences key only', db, prefs, expect: { [lead]: LEGACY_CYCLE } });
  }
  // D. Two plans, both running; only the lead takes it.
  {
    const db = baseDb();
    db.workoutPlans.push(planNamed(db, 'plan_second'));
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.activePlanIds = [lead, 'plan_second'];
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanIds: [lead, 'plan_second'] };
    cases.push({ name: 'two running plans', db, prefs, expect: { [lead]: LEGACY_CYCLE, plan_second: null } });
  }
  // E. Second plan leads; the first does not take it.
  {
    const db = baseDb();
    db.workoutPlans.push(planNamed(db, 'plan_second'));
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.activePlanId = 'plan_second';
    db.preferences.activePlanIds = [lead, 'plan_second'];
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanId: 'plan_second', activePlanIds: [lead, 'plan_second'] };
    cases.push({ name: 'the second plan leads', db, prefs, expect: { [lead]: null, plan_second: LEGACY_CYCLE } });
  }
  // F. Lead already has a rhythm of its own: it keeps it.
  {
    const db = baseDb();
    db.workoutPlans.push(planNamed(db, 'plan_second'));
    db.workoutPlans[0].trainingCycle = clone(OWN_CYCLE);
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({ name: 'lead with its own rhythm', db, prefs, expect: { [lead]: OWN_CYCLE, plan_second: null } });
  }
  // G. No plans at all: nowhere to go, dropped.
  {
    const db = baseDb();
    db.workoutPlans = [];
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({ name: 'no plans', db, prefs, expect: {} });
  }
  // H. No lead (null) and a plan that is not running.
  {
    const db = baseDb();
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.activePlanId = null;
    db.preferences.activePlanIds = [];
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanId: null, activePlanIds: [] };
    cases.push({ name: 'plans but no lead', db, prefs, expect: { [lead]: null } });
  }
  // I. A dangling lead id with nothing else running: dropped, no plan takes it.
  {
    const db = baseDb();
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.activePlanId = 'plan_gone';
    db.preferences.activePlanIds = ['plan_gone'];
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanId: 'plan_gone', activePlanIds: ['plan_gone'] };
    cases.push({ name: 'dangling lead id, nothing else running', db, prefs, expect: { [lead]: null } });
  }
  // J. A dangling lead id beside a running plan: the load promotes the running
  //    one (reconcileRunningSet), which is the plan Home showed the rhythm on.
  {
    const db = baseDb();
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.activePlanId = 'plan_gone';
    db.preferences.activePlanIds = ['plan_gone', lead];
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanId: 'plan_gone', activePlanIds: ['plan_gone', lead] };
    cases.push({ name: 'dangling lead id beside a running plan', db, prefs, expect: { [lead]: LEGACY_CYCLE } });
  }
  // K. Malformed rhythm on the lead: read as none, takes the legacy one.
  const malformed = [
    'every day',
    7,
    true,
    [],
    [true, false],
    {},
    { pattern: 'tttf', anchorDayStart: 0 },
    { pattern: [true, false] },
    { pattern: [true, false], anchorDayStart: '2026-09-01' },
    { pattern: [true, false], anchorDayStart: null },
    { pattern: [false, false, false], anchorDayStart: 0 },
    { pattern: [], anchorDayStart: 0 },
    { pattern: [null, 0, 'x'], anchorDayStart: 0 },
  ];
  malformed.forEach((value, index) => {
    const db = baseDb();
    db.workoutPlans.push(planNamed(db, 'plan_second', { trainingCycle: clone(OWN_CYCLE) }));
    db.workoutPlans[0].trainingCycle = value;
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({
      name: `lead's rhythm malformed #${index} ${JSON.stringify(value)}`,
      db,
      prefs,
      expect: { [lead]: LEGACY_CYCLE, plan_second: OWN_CYCLE },
    });
  });
  // L. Malformed legacy rhythm: nothing moves, nothing throws.
  [
    'x',
    { pattern: [false, false], anchorDayStart: 0 },
    { pattern: 'abc', anchorDayStart: 0 },
    { anchorDayStart: 0 },
  ].forEach((value, index) => {
    const db = baseDb();
    db.preferences.trainingCycle = value;
    const prefs = { ...basePrefs(), trainingCycle: value };
    cases.push({ name: `legacy rhythm malformed #${index}`, db, prefs, expect: { [lead]: null } });
  });
  // M. A plan entry list or plan list that is malformed beside the rhythm.
  {
    const db = baseDb();
    db.workoutPlans = [null, 'plan', { id: '' }, { id: 'plan_noentries', entries: 'x', trainingCycle: clone(OWN_CYCLE) }, ...db.workoutPlans];
    db.preferences.trainingCycle = clone(LEGACY_CYCLE);
    const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
    cases.push({ name: 'junk plans beside the lead', db, prefs, expect: { [lead]: LEGACY_CYCLE, plan_noentries: OWN_CYCLE } });
  }
  // N. Newer install: already moved. Nothing to do, nothing changes.
  {
    const db = baseDb();
    db.workoutPlans.push(planNamed(db, 'plan_second', { trainingCycle: clone(OWN_CYCLE) }));
    db.workoutPlans[0].trainingCycle = clone(LEGACY_CYCLE);
    db.preferences.trainingCycle = null;
    const prefs = { ...basePrefs(), trainingCycle: null };
    cases.push({ name: 'already moved', db, prefs, expect: { [lead]: LEGACY_CYCLE, plan_second: OWN_CYCLE } });
  }
  void db0;
  void prefs0;
  return cases;
}

function checkCycles(db, expect, label) {
  for (const [planId, want] of Object.entries(expect)) {
    assert.deepEqual(cycleOf(db, planId), want === null ? null : want, `${label}: plan ${planId} rhythm`);
  }
  assert.equal(db.preferences.trainingCycle, null, `${label}: the app-wide rhythm is emptied`);
  // No plan holds a rhythm the case did not give it.
  for (const plan of db.workoutPlans) {
    if (!(plan.id in expect)) {
      assert.equal(plan.trainingCycle ?? null, null, `${label}: plan ${plan.id} got a rhythm that was not its own`);
    }
  }
}

async function runCycleCase(testCase) {
  const app = openRows(rowsFor(testCase.db, testCase.prefs));
  const loaded = await app.database.loadDatabase();
  checkCycles(loaded, testCase.expect, `${testCase.name} (first load)`);

  // Written down at once, both keys: a fresh load without any save agrees.
  // (A malformed legacy value reads as none and is left on disk as it was:
  // nothing moved, nothing written — the normalizer answers null every launch.)
  const stored = await readStored(app);
  if (stored.prefs && !testCase.name.startsWith('legacy rhythm malformed')) {
    assert.equal(stored.prefs.trainingCycle ?? null, null, `${testCase.name}: preferences key emptied on disk`);
  }
  const reopened = openOn(app.fake);
  const reloaded = await reopened.database.loadDatabase();
  checkCycles(reloaded, testCase.expect, `${testCase.name} (reload, no save)`);
  assert.deepEqual(plansCycles(reloaded), plansCycles(loaded), `${testCase.name}: reload agrees`);

  // A preferences-only write (theme switch) after the move does not bring it back
  // or lose it.
  await reopened.database.savePreferences({ ...reloaded.preferences, appLanguage: reloaded.preferences.appLanguage });
  // load -> save -> load is a fixed point for every plan's rhythm.
  const { first, second } = await loadSaveLoad(openOn(app.fake));
  checkCycles(first, testCase.expect, `${testCase.name} (after prefs write)`);
  assert.deepEqual(plansCycles(second), plansCycles(first), `${testCase.name}: load -> save -> load`);
  assert.deepEqual(clone(second.workoutPlans), clone(first.workoutPlans), `${testCase.name}: plans are a fixed point`);
}

// =====================================================================
// 2. Workout bundle: minutesClock, warm-ups, pre-#321 sessions
// =====================================================================

function bundleWith(mutate) {
  const bundle = baseBundle();
  mutate(bundle);
  return bundle;
}

const VALID_CLOCK = (slotId) => ({
  slotId,
  setIndex: 0,
  exerciseName: 'Bench Press',
  accumulatedMs: 125000,
  runningSinceMs: Date.UTC(2026, 9, 7, 9, 0, 0),
  plannedMinutes: 20,
});

function clockCases(slotId) {
  const valid = VALID_CLOCK(slotId);
  return [
    { name: 'absent', clock: undefined, want: undefined },
    { name: 'null', clock: null, want: undefined },
    { name: 'running', clock: valid, want: valid },
    { name: 'paused', clock: { ...valid, runningSinceMs: null }, want: { ...valid, runningSinceMs: null } },
    { name: 'no plannedMinutes', clock: { ...valid, plannedMinutes: undefined }, want: { ...valid, plannedMinutes: 0 } },
    { name: 'negative plannedMinutes', clock: { ...valid, plannedMinutes: -5 }, want: { ...valid, plannedMinutes: 0 } },
    { name: 'fractional setIndex', clock: { ...valid, setIndex: 1.7 }, want: { ...valid, setIndex: 1 } },
    { name: 'negative accumulatedMs', clock: { ...valid, accumulatedMs: -10 }, want: { ...valid, accumulatedMs: 0 } },
    { name: 'string', clock: 'running', want: undefined },
    { name: 'number', clock: 42, want: undefined },
    { name: 'array', clock: [valid], want: undefined },
    { name: 'empty object', clock: {}, want: undefined },
    { name: 'slotId number', clock: { ...valid, slotId: 5 }, want: undefined },
    { name: 'no exerciseName', clock: { ...valid, exerciseName: undefined }, want: undefined },
    { name: 'negative setIndex', clock: { ...valid, setIndex: -1 }, want: undefined },
    { name: 'setIndex as string', clock: { ...valid, setIndex: '0' }, want: undefined },
    { name: 'accumulatedMs null (NaN through JSON)', clock: { ...valid, accumulatedMs: null }, want: undefined },
    { name: 'runningSinceMs string', clock: { ...valid, runningSinceMs: '2026-10-07' }, want: undefined },
    { name: 'runningSinceMs missing', clock: { ...valid, runningSinceMs: undefined }, want: undefined },
  ];
}

const WARMUP = { loadKg: 40, reps: 10, completedAt: '2026-10-07T09:00:00.000Z' };

function warmupCases() {
  return [
    { name: 'absent', value: undefined, want: undefined },
    { name: 'valid two', value: [WARMUP, { ...WARMUP, loadKg: 60, reps: 5 }], want: [WARMUP, { ...WARMUP, loadKg: 60, reps: 5 }] },
    { name: 'bodyweight 0 kg', value: [{ ...WARMUP, loadKg: 0 }], want: [{ ...WARMUP, loadKg: 0 }] },
    { name: 'empty list', value: [], want: undefined },
    { name: 'null', value: null, want: undefined },
    { name: 'object not list', value: { 0: WARMUP }, want: undefined },
    { name: 'string', value: 'warmup', want: undefined },
    { name: 'one null among valid', value: [null, WARMUP], want: [WARMUP] },
    { name: 'no completedAt', value: [{ loadKg: 40, reps: 10 }], want: undefined },
    { name: 'over the dial', value: [{ ...WARMUP, loadKg: 900 }], want: undefined },
    { name: 'reps 0', value: [{ ...WARMUP, reps: 0 }], want: undefined },
    { name: 'reps fractional', value: [{ ...WARMUP, reps: 2.5 }], want: undefined },
    { name: 'loadKg string', value: [{ ...WARMUP, loadKg: '40' }], want: undefined },
  ];
}

// =====================================================================
// 3/4. One-shot migrations and library ids
// =====================================================================

function requireDist(relative) {
  return require(path.join(DIST, relative));
}

function libraryIds() {
  const seed = requireDist('data/seed.js');
  return seed.createEmptyDatabase().exerciseLibrary;
}

/** A custom programme row, as the 2026-10-01 release wrote one. */
function customRow(id, fields) {
  return {
    id,
    workoutTemplateId: 'custom_tpl_1',
    workoutTemplateSessionId: 'custom_tpl_1_session_1',
    name: 'Exercise',
    targetSets: 3,
    repMin: 10,
    repMax: 10,
    restSeconds: 60,
    trackedDefault: true,
    orderIndex: 50,
    libraryItemId: null,
    supersetGroup: null,
    ...fields,
  };
}

// =====================================================================

module.exports = [
  {
    name: 'N3 part 2 / rhythm: every old shape moves the app-wide rhythm to the lead once, and only to the lead',
    async run() {
      const failures = [];
      for (const testCase of cycleCases()) {
        try {
          await runCycleCase(testCase);
        } catch (error) {
          failures.push(`${testCase.name}: ${error.message.split('\n')[0]}`);
        }
      }
      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'N3 part 2 / rhythm: a refused move write loses nothing and the next launch makes it',
    async run() {
      const db = baseDb();
      db.preferences.trainingCycle = clone(LEGACY_CYCLE);
      const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE) };
      const app = openRows(rowsFor(db, prefs));
      app.fake.faults.multiSet = 1;
      const loaded = await app.database.loadDatabase();
      // Not moved this launch: the plan shows its own week, the rows are as they were.
      assert.equal(cycleOf(loaded, 'plan_push_pull_legs'), null);
      assert.deepEqual(JSON.parse(app.fake.rows.get(PREFS_KEY)).trainingCycle, LEGACY_CYCLE);
      const next = await openOn(app.fake).database.loadDatabase();
      assert.deepEqual(cycleOf(next, 'plan_push_pull_legs'), LEGACY_CYCLE);
      assert.equal(next.preferences.trainingCycle, null);
    },
  },
  {
    name: 'N3 part 2 / rhythm: on iOS a kill between the blob and the key keeps the rhythm on the lead',
    async run() {
      for (let killAfter = 0; killAfter <= 6; killAfter += 1) {
        const db = baseDb();
        db.workoutPlans.push(planNamed(db, 'plan_second'));
        db.preferences.activePlanIds = ['plan_push_pull_legs', 'plan_second'];
        db.preferences.trainingCycle = clone(LEGACY_CYCLE);
        const prefs = { ...basePrefs(), trainingCycle: clone(LEGACY_CYCLE), activePlanIds: db.preferences.activePlanIds };
        const fake = createFakeIosAsyncStorage();
        for (const [key, value] of Object.entries(rowsFor(db, prefs))) {
          fake.files.set(key, value);
        }
        const app = openOn(fake, { platform: 'ios' });
        fake.faults.killAfterFiles = killAfter;
        try {
          await app.database.loadDatabase();
        } catch {
          // a kill
        }
        fake.faults.killAfterFiles = Infinity;
        const next = await openOn(fake, { platform: 'ios' }).database.loadDatabase();
        assert.deepEqual(cycleOf(next, 'plan_push_pull_legs'), LEGACY_CYCLE, `kill after ${killAfter} files: lead keeps it`);
        assert.equal(cycleOf(next, 'plan_second'), null, `kill after ${killAfter} files: the other plan has none`);
        assert.equal(next.preferences.trainingCycle, null);
      }
    },
  },
  {
    name: 'N3 part 2 / rhythm: a backup restored from before #335 moves its rhythm to its own lead (lib)',
    run() {
      const { moveTrainingCycleToLeadPlan } = requireDist('lib/planTrainingCycle.js');
      const db = baseDb();
      db.workoutPlans.push(planNamed(db, 'plan_second', { trainingCycle: clone(OWN_CYCLE) }));
      db.preferences.trainingCycle = clone(LEGACY_CYCLE);
      const moved = moveTrainingCycleToLeadPlan(db);
      assert.deepEqual(cycleOf(moved, 'plan_push_pull_legs'), LEGACY_CYCLE);
      assert.deepEqual(cycleOf(moved, 'plan_second'), OWN_CYCLE);
      assert.equal(moved.preferences.trainingCycle, null);
      // Once: run again it is the same object.
      assert.equal(moveTrainingCycleToLeadPlan(moved), moved);
    },
  },
  {
    name: 'N3 part 2 / bundle: minutesClock in every state keeps the running workout, and a valid clock round-trips',
    async run() {
      const failures = [];
      const slotId = baseBundle().activeSession.exercises[0].slotId;
      for (const testCase of clockCases(slotId)) {
        const raw = bundleWith((bundle) => {
          if (testCase.clock !== undefined) bundle.activeSession.minutesClock = testCase.clock;
        });
        try {
          const app = openRows({ [WK_KEY]: JSON.stringify(raw) });
          const loaded = await app.workout.loadWorkoutBundle();
          assert.ok(loaded.activeSession, 'running workout survives');
          assert.deepEqual(loggedSets(loaded.activeSession), loggedSets(raw.activeSession), 'logged sets');
          assert.equal(Object.keys(loaded.history.slotHistory).length, Object.keys(raw.history.slotHistory).length, 'history');
          assert.deepEqual(loaded.activeSession.minutesClock, testCase.want, 'clock');
          assert.equal(app.fake.rows.has(WK_CORRUPT), false, 'nothing set aside');
          await app.workout.saveWorkoutBundle(loaded);
          const again = await openOn(app.fake).workout.loadWorkoutBundle();
          assert.deepEqual(clone(again), clone(loaded), 'load -> save -> load');
          // The clock names a lift of the session (stopwatchForSet keys on it).
          if (again.activeSession.minutesClock) {
            assert.ok(
              again.activeSession.exercises.some((exercise) => exercise.slotId === again.activeSession.minutesClock.slotId),
              'the clock still names a lift of the session',
            );
          }
        } catch (error) {
          failures.push(`${testCase.name}: ${error.message.split('\n')[0]}`);
        }
      }
      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'N3 part 2 / bundle: a clock saved before a slot rename follows the lift, like the rest timer does',
    async run() {
      // A ready-programme session written with unscoped slot ids (the shape the
      // loader's remap exists for): every other slot reference is remapped.
      const raw = bundleWith((bundle) => {
        const session = bundle.activeSession;
        for (const exercise of session.exercises) {
          exercise.slotId = exercise.templateSlotId;
        }
        const first = session.exercises[0];
        session.restTimer = { ...session.restTimer, exerciseSlotId: first.slotId };
        session.ui = { ...session.ui, activeSlotId: first.slotId };
        session.minutesClock = VALID_CLOCK(first.slotId);
      });
      const app = openRows({ [WK_KEY]: JSON.stringify(raw) });
      const loaded = await app.workout.loadWorkoutBundle();
      const session = loaded.activeSession;
      assert.ok(session, 'running workout survives');
      assert.notEqual(session.exercises[0].slotId, raw.activeSession.exercises[0].slotId, 'precondition: the remap ran');
      assert.equal(session.restTimer.exerciseSlotId, session.exercises[0].slotId, 'rest timer follows');
      assert.equal(session.ui.activeSlotId, session.exercises[0].slotId, 'ui follows');
      assert.equal(session.minutesClock.slotId, session.exercises[0].slotId, 'the minutes clock follows its lift');
    },
  },
  {
    name: 'N3 part 2 / bundle: warm-ups in every shape, live and in "last time", never cost the workout or a working set',
    async run() {
      const failures = [];
      for (const testCase of warmupCases()) {
        const raw = bundleWith((bundle) => {
          const exercise = bundle.activeSession.exercises[0];
          if (testCase.value !== undefined) exercise.warmups = testCase.value;
          const slot = Object.values(bundle.history.slotHistory)[0];
          if (testCase.value !== undefined) slot[0].warmups = Array.isArray(testCase.value) ? testCase.value.map((w) => (w && typeof w === 'object' ? { loadKg: w.loadKg, reps: w.reps } : w)) : testCase.value;
        });
        try {
          const app = openRows({ [WK_KEY]: JSON.stringify(raw) });
          const loaded = await app.workout.loadWorkoutBundle();
          assert.ok(loaded.activeSession, 'running workout survives');
          assert.equal(loaded.activeSession.exercises.length, raw.activeSession.exercises.length);
          assert.deepEqual(loggedSets(loaded.activeSession), loggedSets(raw.activeSession), 'working sets untouched');
          assert.deepEqual(loaded.activeSession.exercises[0].warmups, testCase.want, 'live warm-ups');
          const rawSlotId = Object.keys(raw.history.slotHistory)[0];
          const slot = loaded.history.slotHistory[rawSlotId];
          assert.equal(slot.length, raw.history.slotHistory[rawSlotId].length, 'history entries kept');
          assert.deepEqual(slot[0].sets, raw.history.slotHistory[rawSlotId][0].sets, 'history working sets kept');
          const wantHistory = testCase.want ? testCase.want.map(({ loadKg, reps }) => ({ loadKg, reps })) : undefined;
          // "last time" warm-ups do not need a moment; one with no completedAt is kept there.
          if (testCase.name !== 'no completedAt') {
            assert.deepEqual(slot[0].warmups, wantHistory, 'history warm-ups');
          }
          await app.workout.saveWorkoutBundle(loaded);
          assert.deepEqual(clone(await openOn(app.fake).workout.loadWorkoutBundle()), clone(loaded), 'round-trip');
        } catch (error) {
          failures.push(`${testCase.name}: ${error.message.split('\n')[0]}`);
        }
      }
      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'N3 part 2 / bundle: a session saved by the pre-#321 shape (2026-10-01) resumes with every set',
    async run() {
      const raw = baseBundle();
      assert.ok(raw.activeSession, 'the fixture holds a running workout');
      assert.ok(raw.activeSession.exercises.every((exercise) => exercise.warmups === undefined), 'pre-#321: no warm-ups');
      assert.equal(raw.activeSession.minutesClock, undefined, 'pre-#337: no clock');
      const app = openRows({ [WK_KEY]: JSON.stringify(raw) });
      const loaded = await app.workout.loadWorkoutBundle();
      assert.ok(loaded.activeSession);
      assert.equal(loaded.activeSession.sessionId, raw.activeSession.sessionId);
      assert.deepEqual(loggedSets(loaded.activeSession), loggedSets(raw.activeSession));
      assert.equal('minutesClock' in loaded.activeSession && loaded.activeSession.minutesClock !== undefined, false);
      for (const exercise of loaded.activeSession.exercises) {
        assert.equal('warmups' in exercise, false, 'no warm-ups key invented');
      }
      // Per-set progression fields (#321) carried as they were.
      const rawSets = raw.activeSession.exercises.flatMap((exercise) => exercise.sets);
      const gotSets = loaded.activeSession.exercises.flatMap((exercise) => exercise.sets);
      assert.deepEqual(
        gotSets.map((set) => [set.rampTargetReps, set.autoProgressedFromKg, set.plannedLoadKg]),
        rawSets.map((set) => [set.rampTargetReps, set.autoProgressedFromKg, set.plannedLoadKg]),
      );
      // A session the newest build writes (warm-ups, clock) over the same shape loads too.
      const newer = clone(raw);
      newer.activeSession.exercises[0].warmups = [WARMUP];
      newer.activeSession.minutesClock = VALID_CLOCK(newer.activeSession.exercises[0].slotId);
      const app2 = openRows({ [WK_KEY]: JSON.stringify(newer) });
      const loaded2 = await app2.workout.loadWorkoutBundle();
      assert.deepEqual(loaded2.activeSession.exercises[0].warmups, [WARMUP]);
      assert.deepEqual(loaded2.activeSession.minutesClock, newer.activeSession.minutesClock);
    },
  },
  {
    name: 'N3 part 2 / migrations: category tracking and minutes mode run once, are idempotent, never touch a logged set',
    async run() {
      const tracking = requireDist('lib/trackingCategoryMigration.js');
      const minutes = requireDist('lib/minutesModeMigration.js');
      const db = baseDb();
      delete db.appliedMigrations;
      db.exerciseTemplates.push(
        customRow('row_curl', { name: 'Barbell Curl', libraryItemId: 'free_barbell_curl', trackedDefault: false }),
        customRow('row_curl_by_name', { name: 'Barbell Curl', libraryItemId: null, trackedDefault: false, orderIndex: 51 }),
        customRow('row_bench_false', { name: 'Bench', libraryItemId: 'free_barbell_bench_press_medium_grip', trackedDefault: false, orderIndex: 52 }),
        customRow('row_bike', { name: 'Stationary Bike (Easy Pace)', trackingMode: 'bodyweight', repMin: 20, repMax: 20, orderIndex: 53 }),
        customRow('row_run', { name: 'Easy Run Blocks', trackingMode: 'reps_first', repMin: 5, repMax: 5, targetSets: 4, orderIndex: 54 }),
      );
      const logsBefore = logSets(db);
      const app = openRows(rowsFor(db, basePrefs()));
      const first = await app.database.loadDatabase();
      const row = (database, id) => database.exerciseTemplates.find((item) => item.id === id);
      assert.ok(first.appliedMigrations.includes(tracking.TRACKING_CATEGORY_MIGRATION_ID));
      assert.ok(first.appliedMigrations.includes(minutes.MINUTES_MODE_MIGRATION_ID));
      assert.ok(first.appliedMigrations.includes(minutes.IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID));
      assert.equal(row(first, 'row_curl').trackedDefault, true, 'corrected curl keeps progression');
      assert.equal(row(first, 'row_curl_by_name').trackedDefault, true, 'by name too');
      assert.equal(row(first, 'row_bench_false').trackedDefault, false, 'a compound lift is not touched');
      assert.equal(row(first, 'row_bike').trackingMode, 'duration_minutes');
      assert.equal(row(first, 'row_run').trackingMode, 'duration_minutes');
      assert.deepEqual(logSets(first), logsBefore.length ? logSets(first) : [], 'logs');
      assert.equal(first.exerciseLogs.length, db.exerciseLogs.length, 'no log dropped');
      assert.equal(first.exerciseTemplates.length, db.exerciseTemplates.length, 'no row dropped');

      // A writer today stores false on purpose (a curl added in the editor) and
      // 'reps_first' on a minutes name: the next load must not undo either.
      first.exerciseTemplates.push(
        customRow('row_new_curl', { name: 'Barbell Curl', libraryItemId: 'free_barbell_curl', trackedDefault: false, orderIndex: 60 }),
        customRow('row_new_bike', { name: 'Stationary Bike (Easy Pace)', trackingMode: 'reps_first', repMin: 20, repMax: 20, orderIndex: 61 }),
      );
      await app.database.saveDatabase(first, { withPreferences: true });
      const { first: second, second: third } = await loadSaveLoad(openOn(app.fake));
      assert.equal(row(second, 'row_new_curl').trackedDefault, false, 'not re-run after the marker (tracking)');
      assert.equal(row(second, 'row_new_bike').trackingMode, 'reps_first', 'not re-run after the marker (minutes)');
      assert.deepEqual(clone(third.exerciseTemplates), clone(second.exerciseTemplates), 'fixed point');
      assert.deepEqual(third.appliedMigrations, second.appliedMigrations, 'marker list stable');
      assert.equal(new Set(third.appliedMigrations).size, third.appliedMigrations.length, 'each marker once');

      // The pure rules: idempotent on their own output.
      const lib = libraryIds();
      const once = tracking.restoreTrackingAfterCategoryCorrection(db.exerciseTemplates, lib);
      assert.deepEqual(tracking.restoreTrackingAfterCategoryCorrection(once, lib), once);
      const m1 = minutes.undoImplausibleMinutesMode(minutes.moveOldCopiesToMinutesMode(db.exerciseTemplates));
      assert.deepEqual(minutes.undoImplausibleMinutesMode(minutes.moveOldCopiesToMinutesMode(m1)), m1);
    },
  },
  {
    name: 'N3 part 2 / logs: warm-up sets (kind warmup, numbered below zero) and minutes logs round-trip unchanged',
    async run() {
      const db = baseDb();
      const template = clone(db.exerciseLogs[0]);
      const warm = (orderIndex, weight, reps) => ({
        orderIndex, weight, reps, kind: 'warmup', outcome: 'completed', status: 'completed', effort: null,
        completedAt: '2026-10-06T09:00:00.000Z', skippedReason: null,
      });
      const work = (orderIndex, weight, reps) => ({ ...warm(orderIndex, weight, reps), kind: 'working' });
      db.exerciseLogs.push(
        { ...template, id: 'log_warm', sets: [warm(-2, 40, 10), warm(-1, 60, 5), work(0, 80, 8), work(1, 80, 7)] },
        { ...template, id: 'log_minutes', exerciseNameSnapshot: 'Stationary Bike (Easy Pace)', repsUnit: 'minutes', sets: [work(0, 0, 20)] },
      );
      const app = openRows(rowsFor(db, basePrefs()));
      const { first, second } = await loadSaveLoad(app);
      const get = (database, id) => database.exerciseLogs.find((log) => log.id === id);
      assert.deepEqual(
        get(first, 'log_warm').sets.map((set) => [set.orderIndex, set.kind, set.weight, set.reps]),
        [[-2, 'warmup', 40, 10], [-1, 'warmup', 60, 5], [0, 'working', 80, 8], [1, 'working', 80, 7]],
      );
      assert.equal(get(first, 'log_minutes').repsUnit, 'minutes');
      assert.deepEqual(clone(second.exerciseLogs), clone(first.exerciseLogs), 'fixed point');
    },
  },
  {
    name: 'N3 part 2 / migrations: an old database loaded and never saved keeps its result on the next launch',
    async run() {
      // The marker is only written by the next save. Until then each launch runs
      // the rules again on the stored rows, which must give the same answer.
      const db = baseDb();
      delete db.appliedMigrations;
      db.exerciseTemplates.push(customRow('row_curl', { name: 'Barbell Curl', libraryItemId: 'free_barbell_curl', trackedDefault: false }));
      const rows = rowsFor(db, basePrefs());
      const app = openRows(rows);
      const a = await app.database.loadDatabase();
      const b = await openOn(app.fake).database.loadDatabase();
      assert.deepEqual(clone(b.exerciseTemplates), clone(a.exerciseTemplates));
      assert.deepEqual(b.appliedMigrations, a.appliedMigrations);
    },
  },
  {
    name: 'N3 part 2 / quarantine: retried loads keep one copy, distinct corrupt blobs each keep theirs, and nothing logged is overwritten',
    async run() {
      for (const [key, corruptKey, load] of [
        [DB_KEY, DB_CORRUPT, (app) => app.database.loadDatabase()],
        [WK_KEY, WK_CORRUPT, (app) => app.workout.loadWorkoutBundle()],
      ]) {
        const fake = createFakeAsyncStorage();
        const blobs = [];
        for (let round = 0; round < 7; round += 1) {
          const blob = `{"truncated round ${round}": [`;
          blobs.push(blob);
          fake.rows.set(key, blob);
          // Twice: a retried load must not take a second slot.
          await load(openOn(fake));
          fake.rows.set(key, blob);
          await load(openOn(fake));
        }
        const app = openOn(fake);
        const slots = [];
        for (let index = 0; index < 5; index += 1) {
          slots.push(await app.large.getLargeItem(index === 0 ? corruptKey : `${corruptKey}/${index + 1}`));
        }
        // The four oldest stay; the last slot holds the newest.
        assert.deepEqual(slots.slice(0, 4), blobs.slice(0, 4), `${key}: oldest copies kept`);
        assert.equal(slots[4], blobs[6], `${key}: last slot gives way`);
        // The empty value the load wrote opens without a further copy.
        await load(openOn(fake));
        assert.equal(await app.large.getLargeItem(`${corruptKey}/5`), blobs[6]);
      }
    },
  },
  {
    name: 'N3 part 2 / library ids: rows pointing at every id #330 refiled or added, retired and unknown ids, load with a name',
    async run() {
      const { CATEGORY_CORRECTED_LIBRARY_IDS } = requireDist('data/categoryCorrectedLibraryIds.js');
      const { EXTRA_EXERCISE_LIBRARY } = requireDist('data/extraExerciseLibrary.js');
      const lib = libraryIds();
      const byId = new Map(lib.map((item) => [item.id, item]));
      const ids = [
        ...CATEGORY_CORRECTED_LIBRARY_IDS,
        ...EXTRA_EXERCISE_LIBRARY.map((item) => item.id),
        'lib_bench_press',
        'lib_squat',
        'free_this_id_never_shipped',
        '  free_barbell_curl  ',
        '',
      ];
      const db = baseDb();
      delete db.appliedMigrations;
      ids.forEach((id, index) => {
        db.exerciseTemplates.push(
          customRow(`row_lib_${index}`, {
            name: byId.get(id)?.name ?? `Stored name ${index}`,
            libraryItemId: id,
            trackedDefault: index % 2 === 0,
            orderIndex: 100 + index,
          }),
        );
      });
      // A log filed under one of those rows (logs carry the name they were logged as).
      db.exerciseLogs.push({
        ...clone(db.exerciseLogs[0]),
        id: 'log_lib_row',
        exerciseTemplateId: 'row_lib_0',
        exerciseNameSnapshot: byId.get(ids[0]).name,
      });
      const app = openRows(rowsFor(db, basePrefs()));
      const loaded = await app.database.loadDatabase();
      assert.equal(app.fake.rows.has(DB_CORRUPT), false, 'not set aside');
      ids.forEach((id, index) => {
        const row = loaded.exerciseTemplates.find((item) => item.id === `row_lib_${index}`);
        assert.ok(row, `row for ${JSON.stringify(id)} kept`);
        assert.ok(typeof row.name === 'string' && row.name.trim().length > 0, `row for ${id} has a name`);
      });
      const log = loaded.exerciseLogs.find((item) => item.id === 'log_lib_row');
      assert.ok(log && log.exerciseNameSnapshot.length > 0, 'log keeps its name');
      // The custom programme still adapts to a runtime template with a name on every lift.
      const adapter = requireDist('features/workout/customWorkoutAdapter.js');
      const template = loaded.workoutTemplates.find((item) => item.id === 'custom_tpl_1');
      const sessions = template.sessions.map((session) => ({
        ...session,
        exercises: loaded.exerciseTemplates.filter((exercise) => session.exerciseIds.includes(exercise.id)),
      }));
      const runtime = adapter.adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, loaded.exerciseLibrary, 90);
      const names = runtime.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      assert.ok(names.length >= ids.length, `every row reaches the programme (${names.length})`);
      assert.ok(names.every((name) => typeof name === 'string' && name.trim().length > 0), 'every lift has a name');
      // Every refiled id is in the library this build ships, and not compound.
      for (const id of CATEGORY_CORRECTED_LIBRARY_IDS) {
        assert.ok(byId.has(id), `${id} ships`);
        assert.notEqual(byId.get(id).category, 'compound', `${id} refiled`);
      }
    },
  },
];
