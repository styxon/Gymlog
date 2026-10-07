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
];
