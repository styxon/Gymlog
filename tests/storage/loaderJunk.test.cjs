const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');

function loadNormalize() {
  const fake = createFakeAsyncStorage();
  return loadAgainstFake(fake, () => require(path.join(DIST, 'storage', 'database.js'))).normalizeDatabase;
}

/**
 * The loader is the one reader that must not trust what it reads.
 *
 * CLAUDE.md: "src/storage/database.ts normalizes on load ... a new field that
 * skips it is a crash on someone's old install." Two gaps found by handing
 * normalizeDatabase junk (2026-09-20). A throw here is worse than a crash:
 * loadDatabase catches it, sets the whole blob aside as corrupt and opens on
 * an empty database — every workout gone from the app over one bad field.
 */
module.exports = [
  {
    name: 'loader: preferences stored as null load as the defaults, not as a corrupt install',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        preferences: null,
        workoutSessions: [{ id: 's1', performedAt: '2026-09-20T10:00:00.000Z' }],
      });
      assert.equal(out.preferences.appLanguage, 'en');
      assert.equal(out.workoutSessions.length, 1, 'the history survives a null preferences key');
    },
  },
  {
    name: 'loader: a session entry that is not an object with an id is dropped, not dated today',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        workoutSessions: [
          null,
          5,
          {},
          { id: '', performedAt: '2026-09-01T10:00:00.000Z' },
          { id: 'real', performedAt: '2026-09-20T10:00:00.000Z', workoutNameSnapshot: 'Lower A' },
        ],
      });
      assert.deepEqual(
        out.workoutSessions.map((session) => session.id),
        ['real'],
        'junk became sessions called "Workout", dated now',
      );
    },
  },
  {
    // Passed straight through: AppProvider sorts the list on `recordedAt`
    // while it renders, with nothing above it to catch, so one null weigh-in
    // crashed every launch (persistence audit, 2026-09-20).
    name: 'loader: a weigh-in that is not an id, a date and a weight is dropped, and the app can read the rest',
    run() {
      const normalizeDatabase = loadNormalize();
      const real = { id: 'bw1', recordedAt: '2026-09-20T07:00:00.000Z', weight: 80.4 };
      const out = normalizeDatabase({
        bodyweightEntries: [
          null,
          7,
          {},
          { id: '', recordedAt: '2026-09-19T07:00:00.000Z', weight: 80 },
          { id: 'no_date', weight: 80 },
          { id: 'text', recordedAt: '2026-09-19T07:00:00.000Z', weight: '80' },
          { id: 'nan', recordedAt: '2026-09-19T07:00:00.000Z', weight: Number.NaN },
          { id: 'zero', recordedAt: '2026-09-19T07:00:00.000Z', weight: 0 },
          real,
        ],
      });
      assert.deepEqual(out.bodyweightEntries, [real]);

      const { bodyweightRepository } = require(path.join(DIST, 'storage', 'repositories.js'));
      const { getBodyweightProgress } = require(path.join(DIST, 'lib', 'progression.js'));
      assert.equal(bodyweightRepository.list(out).length, 1);
      assert.equal(getBodyweightProgress(out).entries.length, 1);
    },
  },
  {
    // A null plan loaded as `{ entries: [] }` with no id, and the sign-in
    // restore decision threw on it (persistence audit, 2026-09-20).
    name: 'loader: a plan without an id is dropped, and so is an entry that names no programme',
    run() {
      const normalizeDatabase = loadNormalize();
      const entry = { id: 'e1', workoutTemplateId: 'tpl_x', workoutTemplateSessionId: 's1', label: 'Mon', orderIndex: 0 };
      const plan = { id: 'ready_plan_tpl_x', name: 'X', mode: 'rotation', isActive: true, createdAt: 'a', updatedAt: 'a' };
      const out = normalizeDatabase({
        workoutPlans: [null, 'plan', {}, { id: '', entries: [entry] }, { ...plan, entries: [null, {}, { id: 'e0', workoutTemplateId: '' }, entry] }],
      });
      // A plan from before rhythms moved onto it reads as its own week.
      assert.deepEqual(out.workoutPlans, [{ ...plan, trainingCycle: null, entries: [entry] }]);

      const { hasLocalDataWorthKeeping } = require(path.join(DIST, 'lib', 'accountBackup.js'));
      assert.equal(hasLocalDataWorthKeeping(normalizeDatabase({ workoutPlans: [null] })), false);
      assert.equal(hasLocalDataWorthKeeping(out), true, 'the adopted programme that is really there still counts');
    },
  },
  {
    // A null programme became one called "Workout" with an empty id, and it
    // took a slot of the free limit (persistence audit, 2026-09-20).
    name: 'loader: a programme without an id is dropped, not counted against the free limit',
    run() {
      const normalizeDatabase = loadNormalize();
      const mine = {
        id: 'wt1',
        name: 'Mine',
        sessions: [{ id: 's1', name: 'A', orderIndex: 0, exerciseIds: [] }],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        origin: 'authored',
      };
      const out = normalizeDatabase({ workoutTemplates: [null, 3, {}, { id: '  ', name: 'Blank' }, mine] });
      assert.deepEqual(
        out.workoutTemplates.map((template) => [template.id, template.name]),
        [['wt1', 'Mine']],
      );
      const { countAuthoredPrograms } = require(path.join(DIST, 'lib', 'programSlots.js'));
      assert.equal(countAuthoredPrograms(out.workoutTemplates), 1);
    },
  },
  {
    // Missing on every install from before the plateau card could be
    // dismissed (#bugs 2026-09-29) — an old install's stored preferences has
    // no dismissedPlateauEpisodes key at all, which must load as [], not throw.
    name: 'loader: dismissedPlateauEpisodes defaults to empty on an old install and drops junk entries',
    run() {
      const normalizeDatabase = loadNormalize();
      const oldInstall = normalizeDatabase({ preferences: { appLanguage: 'fi' } });
      assert.deepEqual(oldInstall.preferences.dismissedPlateauEpisodes, []);

      const withJunk = normalizeDatabase({
        preferences: { dismissedPlateauEpisodes: ['barbell back squat::82.5', null, 7, {}] },
      });
      assert.deepEqual(withJunk.preferences.dismissedPlateauEpisodes, ['barbell back squat::82.5']);
    },
  },
  {
    // A double tap before the App.tsx guard shipped (or a write from an
    // older build without it) could have landed the same episode twice on
    // disk. De-duplicated the same way normalizeActivePlanIds is, so a
    // stored repeat does not cost more than one entry (break round,
    // 2026-09-29).
    name: 'loader: a repeated dismissedPlateauEpisodes entry on disk collapses to one',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        preferences: {
          dismissedPlateauEpisodes: [
            'barbell back squat::82.5',
            'barbell back squat::82.5',
            'incline dumbbell press::24',
          ],
        },
      });
      assert.deepEqual(out.preferences.dismissedPlateauEpisodes, [
        'barbell back squat::82.5',
        'incline dumbbell press::24',
      ]);
    },
  },
  {
    // Duplicate sweep 13, D6-7: a saved workout dated "garbage" loaded, and
    // every screen that formats a session date threw on it.
    name: 'loader: a session whose date does not read is dropped with its logs, unless its start time reads',
    run() {
      const normalizeDatabase = loadNormalize();
      const logFor = (sessionId) => ({
        id: `l-${sessionId}`,
        sessionId,
        exerciseNameSnapshot: 'Bench Press',
        orderIndex: 0,
        sets: [{ orderIndex: 0, weight: 100, reps: 5, kind: 'working', outcome: 'completed', status: 'completed' }],
      });
      const out = normalizeDatabase({
        workoutSessions: [
          { id: 's1', performedAt: 'garbage', startedAt: 'nope', durationMinutes: -40 },
          { id: 's2', performedAt: '2026-10-01T10:00:00.000Z', startedAt: 'nope', durationMinutes: -40 },
          { id: 's3', performedAt: 'garbage', startedAt: '2026-10-02T09:00:00.000Z' },
          { id: 's4' },
        ],
        exerciseLogs: [logFor('s1'), logFor('s2'), logFor('s3')],
      });
      assert.deepEqual(out.workoutSessions.map((session) => session.id), ['s2', 's3', 's4']);
      assert.deepEqual(out.exerciseLogs.map((entry) => entry.sessionId), ['s2', 's3']);
      const byId = Object.fromEntries(out.workoutSessions.map((session) => [session.id, session]));
      assert.equal(byId.s2.startedAt, undefined);
      assert.equal(byId.s2.durationMinutes, undefined);
      assert.equal(byId.s3.performedAt, '2026-10-02T09:00:00.000Z');
      // No date at all keeps the oldest fallback: a readable one.
      assert.ok(Number.isFinite(Date.parse(byId.s4.performedAt)));

      // A duplicate row with a bad date does not take its readable twin's logs.
      const twins = normalizeDatabase({
        workoutSessions: [
          { id: 'd1', performedAt: '2026-10-01T18:00:00.000Z' },
          { id: 'd1', performedAt: 'garbage' },
        ],
        exerciseLogs: [logFor('d1')],
      });
      assert.deepEqual(twins.workoutSessions.map((session) => session.id), ['d1']);
      assert.deepEqual(twins.exerciseLogs.map((entry) => entry.sessionId), ['d1']);
    },
  },
  {
    // Review R1 of duplicate sweep 13: the Hevy import writes reps with no
    // ceiling, and a loader that dropped a set past the dial's 1800 deleted a
    // real jump-rope set for good on the next save.
    name: 'loader: an imported 2000-rep set loads intact, in the sets and the legacy reps list',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        workoutSessions: [{ id: 'hevy_1', workoutTemplateId: 'hevy_import', workoutNameSnapshot: 'Cardio day', performedAt: '2024-06-10T09:00:00.000Z' }],
        exerciseLogs: [
          {
            id: 'l1',
            sessionId: 'hevy_1',
            exerciseTemplateId: null,
            exerciseNameSnapshot: 'Jump Rope',
            weight: 0,
            repsPerSet: [2000],
            tracked: true,
            orderIndex: 0,
            skipped: false,
            sets: [{ orderIndex: 0, weight: 0, reps: 2000, kind: 'working', outcome: 'completed', status: 'completed' }],
          },
        ],
      });
      const loaded = out.exerciseLogs.find((entry) => entry.id === 'l1');
      assert.ok(loaded, 'the log is kept');
      assert.deepEqual(loaded.sets.map((set) => set.reps), [2000]);
      assert.deepEqual(loaded.repsPerSet, [2000]);
    },
  },
  {
    // D6-2: a -10 rep set summed into a session volume of -750 kg.
    name: 'loader: a set with impossible reps is dropped, and the session total is the sets that remain',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        workoutSessions: [{ id: 's1', performedAt: '2026-10-01T10:00:00.000Z' }],
        exerciseLogs: [
          {
            id: 'l1',
            sessionId: 's1',
            exerciseNameSnapshot: 'Bench Press',
            orderIndex: 0,
            sets: [
              { orderIndex: 0, weight: 100, reps: -10, kind: 'working', outcome: 'completed', status: 'completed' },
              { orderIndex: 1, weight: 100, reps: 5, kind: 'working', outcome: 'completed', status: 'completed' },
            ],
          },
        ],
      });
      assert.equal(out.workoutSessions[0].totalVolumeKg, 500);
    },
  },
  {
    // D6-6 and D6-7: weigh-ins and setup weights read by one window, dates by one rule.
    name: 'loader: body weights outside a person\'s range and weigh-ins without a date do not load',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({
        preferences: { setupCurrentWeightKg: -80, bodyweightGoalKg: 5000, setupWeeklyMinutes: -80 },
        bodyweightEntries: [
          { id: 'b1', recordedAt: '2026-10-01T07:00:00.000Z', weight: 5000 },
          { id: 'b2', recordedAt: '2026-10-01T07:00:00.000Z', weight: 260 },
          { id: 'b3', recordedAt: 'garbage', weight: 80 },
          { id: 'b4', recordedAt: '2026-10-01T07:00:00.000Z', weight: 28 },
        ],
        measurementEntries: [
          { id: 'm1', kind: 'waist', unit: 'cm', value: 80, recordedAt: 'garbage' },
          { id: 'm2', kind: 'waist', unit: 'cm', value: 80, recordedAt: '2026-10-01T07:00:00.000Z' },
        ],
      });
      assert.equal(out.preferences.setupCurrentWeightKg, null);
      assert.equal(out.preferences.bodyweightGoalKg, null);
      assert.equal(out.preferences.setupWeeklyMinutes, null);
      assert.deepEqual(out.bodyweightEntries.map((entry) => entry.id), ['b2', 'b4']);
      assert.deepEqual(out.measurementEntries.map((entry) => entry.id), ['m2']);

      const kept = normalizeDatabase({ preferences: { setupCurrentWeightKg: 82.5, bodyweightGoalKg: 78, setupWeeklyMinutes: 0 } });
      assert.equal(kept.preferences.setupCurrentWeightKg, 82.5);
      assert.equal(kept.preferences.bodyweightGoalKg, 78);
      assert.equal(kept.preferences.setupWeeklyMinutes, 0);
    },
  },
  {
    // D6-7: a grant date that does not read falls back; it never granted anything.
    name: 'loader: an unreadable promo or trial date loads as none',
    run() {
      const normalizeDatabase = loadNormalize();
      const out = normalizeDatabase({ preferences: { promoProUntil: 'garbage', proTrialUntil: 'garbage', firstLaunchAt: 'garbage' } });
      assert.equal(out.preferences.promoProUntil, null);
      assert.equal(out.preferences.proTrialUntil, null);
      const kept = normalizeDatabase({ preferences: { proTrialUntil: '2026-10-22T07:00:00.000Z' } });
      assert.equal(kept.preferences.proTrialUntil, '2026-10-22T07:00:00.000Z');
    },
  },
  {
    // D6-4: the template row's rest by the writer's rule.
    name: 'loader: a programme row\'s rest is none when negative, capped when day-long, and 0 stays 0',
    run() {
      const normalizeDatabase = loadNormalize();
      const row = (restSeconds) => ({
        id: `e${restSeconds}`,
        workoutTemplateId: 't1',
        workoutTemplateSessionId: 's1',
        name: 'Bench Press',
        targetSets: 3,
        repMin: 8,
        repMax: 8,
        restSeconds,
        orderIndex: 0,
      });
      // 900 s: an imported rest past the editor's 480 is kept, not saved back as less.
      const out = normalizeDatabase({ exerciseTemplates: [row(-30), row(99999), row(0), row(90), row(900)] });
      assert.deepEqual(out.exerciseTemplates.map((exercise) => exercise.restSeconds), [null, 3600, 0, 90, 900]);
    },
  },
];
