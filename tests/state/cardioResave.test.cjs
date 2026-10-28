const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const { findSavedCardioRun, mergeContinuedCardioRun, settleSavedCardioRun } = require('../../src/lib/cardio');
const { workoutReducer, workoutInitialState } = require('../../src/features/workout/workoutState');

const ROOT = path.join(__dirname, '..', '..');

/**
 * A cardio run is saved once (bug hunt 2026-10-03).
 *
 * CardioScreen's Complete saves, and only then clears the live run, with a bundle write nobody
 * awaits. When that write is lost the run comes back on the next launch, and Complete saved it
 * again under a fresh id: one run, two History rows, double in every total. A run is named by when
 * it started and what it was, so a second save of the same one is the first landing again.
 */

/** saveCardioSession as written in AppProvider, run against a fake store (the same lift the lifecycle invariant makes). */
function liftSaveCardioSession() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'state', 'AppProvider.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('  function saveCardioSession(input: {');
  assert.ok(start >= 0, 'saveCardioSession moved');
  const end = source.indexOf('\n  }\n', start) + 5;
  const wrapped = [
    'function __part(__scope) {',
    '  const { databaseRef, runExclusive, commit, createId, findSavedCardioRun, mergeContinuedCardioRun } = __scope;',
    source.slice(start, end),
    '  return saveCardioSession;',
    '}',
  ].join('\n');
  const js = ts.transpileModule(wrapped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(`'use strict';\n${js}\nreturn __part;`)();
}

function fakeStore(initial = []) {
  let counter = 0;
  const store = {
    commits: 0,
    databaseRef: { current: { cardioSessions: initial } },
    runExclusive: (task) => task(),
    commit: async (next) => {
      store.commits += 1;
      store.databaseRef.current = next;
    },
    createId: (prefix) => `${prefix}_${(counter += 1)}`,
    findSavedCardioRun,
    mergeContinuedCardioRun,
  };
  store.save = liftSaveCardioSession()(store);
  return store;
}

const RUN = { activityType: 'run', startedAt: '2026-10-03T08:00:00.000Z', endedAt: '2026-10-03T08:32:00.000Z', durationSec: 1920, distanceKm: 5.2, feel: null };

module.exports = [
  {
    name: 'cardio: a Complete of a run that is already stored is not counted as a second finished workout',
    run() {
      const screens = fs.readFileSync(path.join(ROOT, 'src', 'app', 'renderHomeScreens.tsx'), 'utf8').replace(/\r\n/g, '\n');
      const handler = screens.slice(screens.indexOf('onSaveCardioSession={async (input) => {'), screens.indexOf('onLeave={() => navigateBack(ROOT_ROUTES.home)}'));
      const check = handler.indexOf('findSavedCardioRun(cardioSessions, input) !== null');
      const saved = handler.indexOf('await saveCardioSession(input)');
      assert.ok(check > 0 && check < saved, 'asked before the save, which would store it');
      assert.match(handler, /if \(!alreadyStored\) \{\s*trackEvent\('workout_completed'\);\s*\}/);
    },
  },
  {
    name: 'cardio: findSavedCardioRun names a run by when it started and what it was',
    run() {
      const stored = [{ id: 'c1', activityType: 'run', startedAt: '2026-10-03T08:00:00.000Z' }];
      assert.equal(findSavedCardioRun(stored, { activityType: 'run', startedAt: '2026-10-03T08:00:00.000Z' }), stored[0]);
      assert.equal(findSavedCardioRun(stored, { activityType: 'walk', startedAt: '2026-10-03T08:00:00.000Z' }), null, 'another activity is another run');
      assert.equal(findSavedCardioRun(stored, { activityType: 'run', startedAt: '2026-10-03T08:00:00.001Z' }), null, 'a different start is a new run');
      assert.equal(findSavedCardioRun([], RUN), null);
    },
  },
  {
    name: 'cardio: a run continued after a relaunch extends its stored row under the same id, and never shortens it',
    async run() {
      const store = fakeStore();
      const first = await store.save({ ...RUN, distanceKm: 5.2, feel: 'good' });
      // Complete landed, its clear was lost, the run came back paused; the reader ran 20 more minutes.
      const extended = await store.save({ ...RUN, endedAt: '2026-10-03T08:52:00.000Z', durationSec: 3120, distanceKm: 8.4, feel: 'hard' });
      const rows = store.databaseRef.current.cardioSessions;
      assert.equal(rows.length, 1, 'one run, one row');
      assert.equal(extended.id, first.id, 'under its own id');
      assert.equal(rows[0].id, first.id);
      assert.equal(rows[0].durationSec, 3120, 'the extra time is kept');
      assert.equal(rows[0].performedAt, '2026-10-03T08:52:00.000Z');
      assert.equal(rows[0].distanceKm, 8.4);
      assert.equal(rows[0].feel, 'hard');
      assert.equal(rows[0].startedAt, first.startedAt);
      assert.equal(store.commits, 2);

      // The longer finish with no distance or feel entered keeps the ones stored.
      await store.save({ ...RUN, endedAt: '2026-10-03T09:00:00.000Z', durationSec: 3600, distanceKm: null, feel: null });
      assert.equal(store.databaseRef.current.cardioSessions[0].durationSec, 3600);
      assert.equal(store.databaseRef.current.cardioSessions[0].distanceKm, 8.4);
      assert.equal(store.databaseRef.current.cardioSessions[0].feel, 'hard');
      assert.equal(store.databaseRef.current.cardioSessions.length, 1);

      // The pure half: nothing new is nothing written.
      const stored = { id: 'c', activityType: 'run', startedAt: '2026-10-03T08:00:00.000Z', performedAt: '2026-10-03T08:10:00.000Z', durationSec: 100, distanceKm: 1, feel: null };
      assert.equal(mergeContinuedCardioRun(stored, { ...stored }), stored);
      assert.equal(mergeContinuedCardioRun(stored, { ...stored, durationSec: 99, distanceKm: null }), stored);
    },
  },
  {
    name: 'cardio: a re-Complete of the same length keeps the distance and feel entered on it',
    async run() {
      const store = fakeStore();
      // The first save had no distance and no feel; the clear was lost; the run came back paused, the same length.
      const first = await store.save({ ...RUN, distanceKm: null, feel: null });
      assert.equal(first.distanceKm, null);
      const again = await store.save({ ...RUN, distanceKm: 5, feel: 'good' });
      const rows = store.databaseRef.current.cardioSessions;
      assert.equal(rows.length, 1, 'one row');
      assert.equal(again.id, first.id);
      assert.equal(rows[0].distanceKm, 5);
      assert.equal(rows[0].feel, 'good');
      assert.equal(rows[0].durationSec, 1920, 'the time is the stored time');
      assert.equal(store.commits, 2, 'written once for the entry');
      // And again with nothing new: nothing written.
      await store.save({ ...RUN, distanceKm: 5, feel: 'good' });
      assert.equal(store.commits, 2);
    },
  },
  {
    name: 'cardio: the time and the end only move forward together',
    async run() {
      const store = fakeStore();
      await store.save({ ...RUN, distanceKm: null });
      await store.save({ ...RUN, endedAt: '2026-10-03T08:52:00.000Z', durationSec: 3120 });
      assert.equal(store.databaseRef.current.cardioSessions[0].durationSec, 3120);
      assert.equal(store.databaseRef.current.cardioSessions[0].performedAt, '2026-10-03T08:52:00.000Z');
      // A longer reading that ended before the stored end is not further.
      await store.save({ ...RUN, endedAt: '2026-10-03T08:20:00.000Z', durationSec: 4000 });
      assert.equal(store.databaseRef.current.cardioSessions[0].durationSec, 3120);
    },
  },
  {
    name: 'cardio: a run whose clear was lost is not saved a second time on relaunch, and a genuinely new run is',
    async run() {
      const store = fakeStore();
      const first = await store.save(RUN);
      assert.equal(store.databaseRef.current.cardioSessions.length, 1);
      assert.equal(store.commits, 1);

      // The live run came back after a kill and the reader pressed Complete again, as it was.
      const again = await store.save({ ...RUN });
      assert.equal(again.id, first.id, 'the stored run is handed back');
      assert.equal(store.databaseRef.current.cardioSessions.length, 1, 'one run, one row');
      assert.equal(store.commits, 1, 'nothing was written');
      // An older or shorter reading never shortens it, nor moves its end.
      await store.save({ ...RUN, endedAt: '2026-10-03T08:10:00.000Z', durationSec: 1000 });
      assert.deepEqual(store.databaseRef.current.cardioSessions[0], first, 'a shorter finish leaves the stored run as it is');
      assert.equal(store.commits, 1);
      await store.save({ ...RUN, durationSec: 1000, distanceKm: 3 });
      assert.equal(store.databaseRef.current.cardioSessions[0].durationSec, 1920, 'the time is not shortened');
      assert.equal(store.databaseRef.current.cardioSessions[0].distanceKm, 3, 'what was entered on this finish is kept');

      // Different runs still save: another start, and another activity at the same instant.
      await store.save({ ...RUN, startedAt: '2026-10-04T08:00:00.000Z' });
      await store.save({ ...RUN, activityType: 'walk' });
      assert.equal(store.databaseRef.current.cardioSessions.length, 3);
      assert.equal(store.commits, 4, 'the first save, the distance entered on a re-Complete, and the two new runs');
    },
  },
  {
    name: 'a saved run that came back running is stopped where it was saved; one resumed after its save runs on',
    run() {
      const startedAt = '2026-10-03T09:00:00.000Z';
      const savedAt = '2026-10-03T09:30:00.000Z';
      const sessions = [{ id: 'c1', activityType: 'run', startedAt, performedAt: savedAt, durationSec: 1800, distanceKm: 5, feel: null }];
      // The pause and the clear both lost: back running, resumed at the start, eight hours later on the clock.
      const lostPause = { activityType: 'run', startedAt, accumulatedMs: 0, resumedAt: startedAt, pausedAt: null };
      assert.deepEqual(settleSavedCardioRun(lostPause, sessions), { ...lostPause, accumulatedMs: 1800 * 1000, resumedAt: null, pausedAt: savedAt });
      // Paused already, or resumed after its save (the reader carrying on), or not saved at all: nothing to settle.
      assert.equal(settleSavedCardioRun({ ...lostPause, resumedAt: null, pausedAt: savedAt, accumulatedMs: 1800 * 1000 }, sessions), null);
      assert.equal(settleSavedCardioRun({ ...lostPause, accumulatedMs: 1800 * 1000, resumedAt: '2026-10-03T17:00:00.000Z' }, sessions), null);
      assert.equal(settleSavedCardioRun({ ...lostPause, startedAt: '2026-10-03T08:00:00.000Z', resumedAt: '2026-10-03T08:00:00.000Z' }, sessions), null);
      assert.equal(settleSavedCardioRun({ ...lostPause, activityType: 'walk' }, sessions), null);
      assert.equal(settleSavedCardioRun(null, sessions), null);

      // The reducer takes it only for the same run.
      let state = { ...workoutInitialState, hydrated: true, activeCardio: lostPause };
      const settled = settleSavedCardioRun(lostPause, sessions);
      // A pause or a resume dispatched between the read and the settle is the reader's, and stands.
      const pausedSince = workoutReducer(state, { type: 'cardio/pause', payload: { nowMs: Date.parse('2026-10-03T17:00:00.000Z') } });
      assert.equal(workoutReducer(pausedSince, { type: 'cardio/settle', payload: { session: settled, wasResumedAt: startedAt } }), pausedSince);
      const other = workoutReducer(state, { type: 'cardio/settle', payload: { session: { ...settled, startedAt: '2026-10-03T07:00:00.000Z' }, wasResumedAt: startedAt } });
      assert.equal(other, state, 'another run is not put over this one');
      state = workoutReducer(state, { type: 'cardio/settle', payload: { session: settled, wasResumedAt: startedAt } });
      assert.deepEqual(state.activeCardio, settled);

      // App settles it once both stores have loaded.
      const app = readAppWiring().replace(/\r\n/g, '\n');
      assert.match(app, /if \(!hydrated \|\| !workoutHydrated\) \{\s*return;\s*\}\s*const settled = settleSavedCardioRun\(activeCardio, cardioSessions\);\s*if \(settled\) \{\s*settleCardio\(settled, activeCardio\?\.resumedAt \?\? null\);/);
    },
  },
];
