const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = '../../.test-dist';
const { getCanonicalCompletedSessions, getCurrentWeekStreak, getMonthlyActivityCalendar } = require(`${DIST}/lib/completedSessions.js`);
const { weeklyTrainingStreak } = require(`${DIST}/lib/trainingCalendar.js`);
const { getMonthTrainingTotals } = require(`${DIST}/lib/dashboard.js`);
const { getLifetimeTrainingSummary } = require(`${DIST}/lib/lifetimeSummary.js`);
const { buildFreestyleFinish } = require(`${DIST}/lib/emptyWorkoutSession.js`);
const { persistCompletedWorkoutSessionToDatabase } = require(`${DIST}/state/completedWorkoutPersistence.js`);
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * From `start`, through the bracket that closes the first `(` or `{` after it.
 * Read to the matching close rather than a fixed number of characters: a
 * window cut short proves nothing about what follows it, and one run long
 * reads the next function's code as this one's.
 */
function through(source, start, opener = /[({]/) {
  assert.ok(start > -1, 'the code this guard reads is not there');
  const openAt = source.slice(start).search(opener) + start;
  const open = source[openAt];
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    if (source[index] === open) {
      depth += 1;
    } else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error('unbalanced brackets after the start this guard was given');
}

const emptyDatabase = () => ({
  workoutTemplates: [],
  exerciseTemplates: [],
  workoutPlans: [],
  exerciseLibrary: [],
  workoutSessions: [],
  exerciseLogs: [],
  cardioSessions: [],
  bodyweightEntries: [],
  measurementEntries: [],
  preferences: {},
});

/**
 * One count of what was done, and nothing claimed before it happened — the
 * wiring half of the audit of 2026-09-20. The rules are in lib/sessionTotals
 * and lib/completedSessions; these hold the places that read them.
 */
module.exports = [
  {
    name: 'progress: the activity card counts the sessions its own calendar marks',
    run() {
      let n = 0;
      const id = (prefix) => `${prefix}_${++n}`;
      const lifted = (database, iso) =>
        persistCompletedWorkoutSessionToDatabase(database, {
          sessionId: id('session'),
          workoutTemplateId: 'tpl_a',
          workoutNameSnapshot: 'Day 1',
          startedAt: new Date(Date.parse(iso) - 50 * 60000).toISOString(),
          performedAt: iso,
          logs: [{
            exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', tracked: true, orderIndex: 0, skipped: false,
            status: 'completed',
            sets: [{ orderIndex: 0, weight: 60, reps: 8, kind: 'working', outcome: 'completed', status: 'completed', completedAt: iso }],
          }],
        }, id).database;
      // A free workout with the weights typed and nothing ticked: Finish is
      // enabled by having an exercise at all, and the save keeps it.
      const typedOnly = (database, iso) => {
        const { summary } = buildFreestyleFinish({
          exercises: [{
            localKey: 'k', name: 'Squat', libraryItemId: null, imageUrl: null, repMin: 5, repMax: 5, restSeconds: 120,
            trackedDefault: true,
            sets: [{ localKey: 's1', kg: '100', reps: '5', done: false }, { localKey: 's2', kg: '100', reps: '5', done: false }],
          }],
          workoutName: 'Free workout',
          startedAtIso: new Date(Date.parse(iso) - 40 * 60000).toISOString(),
          performedAtIso: iso,
          elapsedSeconds: 2400,
          exercisePrLookup: { byLibraryItemId: {}, byName: {} },
        });
        return persistCompletedWorkoutSessionToDatabase(database, {
          sessionId: id('session'), workoutTemplateId: 'tpl_free', workoutNameSnapshot: summary.workoutName,
          logs: summary.logs, startedAt: summary.startedAt, performedAt: summary.performedAt,
        }, id).database;
      };

      let database = emptyDatabase();
      database = lifted(database, new Date(2026, 8, 8, 16).toISOString());
      database = typedOnly(database, new Date(2026, 8, 15, 16).toISOString());
      database = lifted(database, new Date(2026, 8, 22, 16).toISOString());
      const now = new Date(2026, 8, 24, 12);
      assert.equal(database.workoutSessions.length, 3, 'the untouched session is saved');

      // What the card computes, from the list App hands it.
      const completed = getCanonicalCompletedSessions(database);
      assert.equal(completed.length, 2, 'a session with nothing done in it is not a completed one');
      const marked = getMonthlyActivityCalendar(database, now).weeks.flat().filter((day) => day.active && day.inCurrentMonth).length;
      // The week of the untouched session is a gap, so the run is this week's.
      assert.equal(weeklyTrainingStreak(completed, [], now), 1);
      assert.equal(getCurrentWeekStreak(database, now), 1);
      assert.equal(completed.length, marked, 'the month figure and the calendar count the same sessions');
      assert.equal(completed.length, getMonthTrainingTotals(database, now).workouts, 'and the widget');
      assert.equal(completed.length, getLifetimeTrainingSummary(database, now).sessionCount, 'and Profile');
      // Every saved session reads differently — the trap this closes.
      assert.equal(weeklyTrainingStreak(database.workoutSessions, [], now), 3);

      // App hands the tab the canonical list, and only that list.
      const app = strip(read('App.tsx'));
      // The list itself, found in the shell: it left App.tsx for
      // useRecentSessions in the phase-C split (2026-10-01).
      const shell = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.equal(shell.split('const completedWorkoutSessions = useMemo(').length, 2, 'one list by that name');
      const memo = through(shell, shell.indexOf('const completedWorkoutSessions = useMemo('));
      assert.match(memo, /getCanonicalCompletedSessions\(\{\s*workoutSessions: database\.workoutSessions,\s*exerciseLogs: database\.exerciseLogs,?\s*\}\)/);
      const call = through(app, app.indexOf('content = renderProgressTab('));
      assert.match(call, /^\s*completedWorkoutSessions,$/m);
      assert.doesNotMatch(call, /^\s*workoutSessions[,:]/m, 'every saved session went to the activity card');

      const tab = strip(read('src', 'app', 'renderProgressTab.tsx'));
      assert.match(tab, /workoutSessions=\{completedWorkoutSessions\}/);
      assert.doesNotMatch(tab, /workoutSessions=\{workoutSessions\}/);
    },
  },
  {
    name: 'completion: the guided tile says what the save recorded, by the rule History reads it with',
    run() {
      // The guided finish on its own, wherever the shell keeps it (it leaves
      // VinhaApp in the phase-C split, 2026-10-01).
      const app = functionBody(strip(readAppWiring().replace(/\r\n/g, '\n')), 'async function handleConfirmFinishWorkout()');
      const saveAt = app.indexOf('const summary = await saveCompletedWorkoutSession({');
      assert.ok(saveAt > -1);
      // The summary the guided finish sets once its save has resolved.
      const shown = through(app, app.indexOf('setCompletionSummary({', saveAt));
      assert.match(shown, /exercisesLogged: summary\.exercisesCompleted,/);
      // Over the whole shell, App.tsx and its src/app modules (phase-B split,
      // 2026-09-30): the card count must not come back from a hook either.
      assert.doesNotMatch(
        strip(readAppWiring().replace(/\r\n/g, '\n')),
        /exercisesLogged: completionCards\.exerciseCards\.filter/,
        'counted off the cards, the tile said 1 where History said 2',
      );
    },
  },
  {
    name: 'reset: the open coach conversation goes with everything else',
    run() {
      // App.tsx and the src/app modules, App.tsx first: the reset handler
      // leaves VinhaApp in the phase-B split (2026-09-30).
      const wiring = strip(readAppWiring().replace(/\r\n/g, '\n'));
      // The thread lives in exactly one place, so clearing that place is the
      // whole of the job.
      assert.equal(wiring.split('useState<CoachChatMemory').length, 2);
      const handler = through(wiring, wiring.indexOf('const handleResetAllData = useCallback('));
      const afterWipe = handler.slice(handler.indexOf('await resetAllData();'));
      assert.ok(handler.includes('await resetAllData();'));
      assert.match(afterWipe, /setCoachAdviceMemory\(\[\]\);/);
      assert.match(afterWipe, /setCoachChatMemory\(null\);/, 'the old thread resumed after a reset, and was sent as history');
    },
  },
  {
    name: 'pro: the unlock screen follows the write that turns Pro on, and a refused write is said',
    run() {
      const profile = strip(read('src', 'app', 'renderProfileTab.tsx'));
      const handler = through(profile, profile.indexOf('onPurchase={'));
      assert.doesNotMatch(handler, /void updatePreferences\(/, 'a dropped write under a success screen');

      // The one writer: awaited, success only on resolve, a toast on refusal.
      const writer = through(handler, handler.indexOf('const turnProOn = async ('), /\{/);
      const tryAt = writer.indexOf('await updatePreferences(patch);');
      const okAt = writer.indexOf('return true;');
      const catchAt = writer.indexOf('catch (error)');
      assert.ok(tryAt > -1 && okAt > tryAt && catchAt > okAt);
      assert.match(writer.slice(catchAt), /showToast\(t\(preferences\.appLanguage, 'toast\.proUnlockFailed'\)\);\s*return false;/);

      // Three ways onto the unlock screen, each behind a write that landed:
      // the trial, the store's purchase (release) and the invented one (demo).
      assert.equal(handler.split("screen: 'premium_unlock'").length - 1, 3);
      const storeWrite = handler.indexOf('if (await turnProOn(record)) {');
      const storeScreen = handler.indexOf("screen: 'premium_unlock', plan: record.mockSubscriptionTerm })");
      assert.ok(storeWrite > -1 && storeScreen > storeWrite, 'the store purchase is announced before it is stored');
      const trialWrite = handler.search(
        /if \(!\(await turnProOn\(\{ proTrialUntil: trialUntil, proTrialStartedAt: new Date\(\)\.toISOString\(\) \}\)\)\) \{\s*return;\s*\}/,
      );
      const trialScreen = handler.indexOf("screen: 'premium_unlock', plan, trialUntil");
      assert.ok(trialWrite > -1 && trialScreen > trialWrite, 'the trial is announced before it is stored');
      const purchaseWrite = handler.indexOf('const purchased = await turnProOn({');
      const gate = handler.indexOf('if (purchased) {');
      const purchaseScreen = handler.indexOf("screen: 'premium_unlock', plan })");
      assert.ok(purchaseWrite > trialScreen && gate > purchaseWrite && purchaseScreen > gate, 'the purchase is announced before it is stored');

      // Waiting keeps the page up for a moment; a second tap in it is ignored.
      const premium = strip(read('src', 'screens', 'PremiumScreen.tsx'));
      const buy = through(premium, premium.indexOf('const buy = () =>'), /\{/);
      const busy = buy.indexOf('if (purchasing.current) {');
      assert.ok(busy > -1 && busy < buy.indexOf('onPurchase('));
      assert.match(buy, /await onPurchase\([\s\S]*finally \{\s*purchasing\.current = false;\s*\}/);

      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal(i18n.split("'toast.proUnlockFailed':").length - 1, 2, 'both languages');
    },
  },
];
