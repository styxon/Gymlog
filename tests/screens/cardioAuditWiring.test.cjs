const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
/** Comments out, so a guard is matched against code and not against its own explanation. */
const code = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The text from `start` to the first `end` after it. */
function slice(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `marker not found after ${start}: ${end}`);
  return source.slice(from, to);
}

/**
 * Cardio audit, 2026-09-16 (round 2): the wiring half. The screens and App are
 * React on native modules and do not run under Node, so these pin the shape of
 * each fix; each was put back to the old shape to see it fail.
 */
module.exports = [
  {
    name: 'cardio wiring: two quick taps on Complete save the run once',
    run() {
      const screen = code(read('src', 'screens', 'CardioScreen.tsx'));
      const complete = slice(screen, 'onComplete={async (distanceKm, feel, minutesText) => {', 'onLeave();');
      // The guard answers before anything is awaited; App's isSaving lands a
      // render too late to stop the second tap.
      assert.match(
        complete,
        /^onComplete=\{async \(distanceKm, feel, minutesText\) => \{\s*if \(completeInFlightRef\.current\) \{\s*return;\s*\}/,
      );
      assert.ok(complete.indexOf('completeInFlightRef.current = true') !== -1);
      assert.ok(complete.indexOf('completeInFlightRef.current = true') < complete.indexOf('await onSaveCardioSession('));
      // Only a failed save opens it again, so the retry is a real retry.
      assert.match(complete, /\} catch \{\s*completeInFlightRef\.current = false;\s*return;\s*\}/);
      assert.match(screen, /if \(!activeCardio\) \{[^}]*completeInFlightRef\.current = false;/);
    },
  },
  {
    name: 'cardio wiring: the finish screen counts this week once, while the save is pending too',
    run() {
      const screen = code(read('src', 'screens', 'CardioScreen.tsx'));
      const finish = slice(screen, 'function CardioFinishView(', 'function CardioSheet(');
      // The stored rows are frozen when Finish opens; the run joins them as a row
      // and the seconds are rounded once (hunt 10: two roundings read a minute short).
      assert.match(finish, /const \[storedAtOpen\] = useState\(cardioSessions\);/);
      assert.match(finish, /const weekMinutes = getWeekCardioMinutesWithRun\(storedAtOpen, \{\s*activityType: session\.activityType,\s*startedAt: session\.startedAt,\s*performedAt: finish\.endedAt,\s*durationSec,\s*\}\);/);
      assert.doesNotMatch(finish, /getWeekCardioMinutes\(cardioSessions/);
      assert.doesNotMatch(finish, /Math\.round\(durationSec \/ 60\)/);
    },
  },
  {
    name: 'cardio wiring: the saved run carries the moment it stopped',
    run() {
      const screen = code(read('src', 'screens', 'CardioScreen.tsx'));
      assert.match(screen, /const finish = resolveCardioFinish\(activeCardio, nowMs, minutesText\);/);
      assert.match(screen, /endedAt: finish\.endedAt,/);
      const provider = code(read('src', 'state', 'AppProvider.tsx'));
      const save = slice(provider, 'function saveCardioSession(', 'function resetAllData(');
      assert.match(save, /performedAt:\s*input\.endedAt && Number\.isFinite\(Date\.parse\(input\.endedAt\)\)\s*\?\s*input\.endedAt/);
      assert.doesNotMatch(save, /performedAt: new Date\(\)\.toISOString\(\),/);
    },
  },
  {
    name: 'cardio wiring: Home shows a run still on the clock, and the empty workout asks first',
    run() {
      const home = code(read('src', 'screens', 'HomeScreen.tsx'));
      const row = slice(home, '{activeCardioActivity && onOpenCardio ? (', ') : null}');
      assert.match(row, /onPress=\{onOpenCardio\}/);
      // A row that mounts and unmounts while Home is open must not borrow an
      // animated node another view already holds.
      assert.doesNotMatch(row, /rise\(|Animated\./);
      assert.match(row, /t\(language, 'home\.cardio\.inProgress', \{/);
      // Near the top: before the plateau card and the session hero.
      assert.ok(home.indexOf('{activeCardioActivity && onOpenCardio ? (') < home.indexOf('{plateau ? ('));

      // The <HomeScreen> element moved from App.tsx to
      // src/app/renderHomeDashboard.tsx (phase C, 2026-10-01): read the shell.
      const app = code(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(app, /activeCardioActivity=\{workout\.activeCardio\?\.activityType \?\? null\}/);
      assert.match(
        app,
        /onCreateWorkoutFromExercises=\{\(\) =>\s*guardStrengthStartOverCardio\(\(\) => navigate\(\{ tab: 'workout', screen: 'empty' \}\)\)/,
      );
      // The unguarded door must not come back anywhere in the shell: App.tsx or
      // a src/app module (phase-B split, 2026-09-30).
      assert.doesNotMatch(
        code(readAppWiring().replace(/\r\n/g, '\n')),
        /onCreateWorkoutFromExercises=\{\(\) => navigate\(/,
      );

      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of ['home.cardio.inProgress', 'home.a11y.resumeCardio', 'toast.deleteFailed', 'export.log.cardioOne', 'export.log.cardioMany']) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
      }
    },
  },
  {
    name: 'cardio wiring: a refused delete says so, for runs and workouts alike',
    run() {
      const home = code(read('src', 'app', 'renderHomeScreens.tsx'));
      assert.doesNotMatch(home, /void deleteCompletedWorkoutSession\(/);
      assert.doesNotMatch(home, /void deleteCardioSession\(/);
      for (const call of ['deleteCompletedWorkoutSession(sessionId)', 'deleteCardioSession(sessionId)']) {
        const handler = slice(home, `${call}.catch(`, '});');
        assert.match(handler, /showToast\(t\(preferences\.appLanguage, 'toast\.deleteFailed'\)\)/, call);
      }
    },
  },
  {
    name: 'cardio wiring: back on a running session opens its end sheet instead of walking Home',
    run() {
      // The listener is found in the whole shell — it left App.tsx for a
      // src/app hook in the phase-C split (2026-10-01) — and every slice is
      // searched from it, so it stays in that one file. cardioRunActive is
      // still worked out in App.tsx.
      const app = code(readAppWiring().replace(/\r\n/g, '\n'));
      const nextRouteAt = app.indexOf('const nextRoute = getBackRoute(route, workoutHomeRoute);');
      assert.notEqual(nextRouteAt, -1);
      const listenerAt = app.lastIndexOf("BackHandler.addEventListener('hardwareBackPress', () => {", nextRouteAt);
      const effectAt = app.lastIndexOf('useEffect(() => {', listenerAt);
      const head = app.slice(effectAt, listenerAt);
      assert.match(
        head,
        /if \(cardioRunActive && route\.tab === 'home' && route\.screen === 'cardio'\) \{\s*return undefined;\s*\}/,
      );
      const deps = app.slice(app.indexOf('}, [', listenerAt), app.indexOf(']);', listenerAt) + 3);
      assert.match(deps, /\bcardioRunActive\b/);
      assert.match(code(read('App.tsx')), /const cardioRunActive = workout\.activeCardio !== null;/);
      // And the screen it defers to answers back in the player.
      const screen = code(read('src', 'screens', 'CardioScreen.tsx'));
      assert.match(screen, /if \(mode === 'player'\) \{\s*setEndSheetOpen\(true\);\s*return true;\s*\}/);
    },
  },
  {
    name: 'cardio wiring: runs reach the duration chart, the export and the coach',
    run() {
      const progress = code(read('src', 'screens', 'ProgressScreen.tsx'));
      const duration = slice(progress, "if (overviewMetric === 'duration') {", 'bucketOverviewPointsByRange(');
      assert.match(duration, /addCardioMinutesByDay\(/);
      assert.match(code(read('src', 'app', 'renderProgressTab.tsx')), /cardioSessions=\{cardioSessions\}/);

      const app = code(read('App.tsx'));
      const progressCall = slice(app, 'content = renderProgressTab({', '});');
      assert.match(progressCall, /\n\s*cardioSessions,\n/);
      // The coach's context is built in the shell's wiring: App.tsx, or the
      // src/app module the memo moves to in the phase-B split (2026-09-30).
      // There is one such call, so the slice is that call wherever it sits.
      const wiring = code(readAppWiring().replace(/\r\n/g, '\n'));
      assert.equal(
        wiring.split('buildAiTrainingContext({').length - 1,
        1,
        'expected exactly one buildAiTrainingContext call in the shell',
      );
      const coachCall = slice(wiring, 'buildAiTrainingContext({', '}),');
      assert.match(coachCall, /\n\s*cardioSessions,\n/);

      const exportScreen = code(read('src', 'screens', 'ExportPlanScreen.tsx'));
      assert.match(exportScreen, /const logEmpty = logSummary\.sets === 0 && logSummary\.cardio === 0;/);
      assert.match(exportScreen, /disabled=\{logEmpty\}/);
      assert.doesNotMatch(exportScreen, /logSummary\.sets === 0 \?/);
    },
  },
  {
    name: 'cardio wiring: the evening reminder asks whether a workout was done, not any activity',
    run() {
      const hook = code(read('src', 'hooks', 'useScheduledNotifications.ts'));
      assert.match(hook, /lastWorkoutAtMs: getLastWorkoutTimestamp\(database\),/);
      assert.match(hook, /lastWorkoutAtMs: signals\.lastWorkoutAtMs,/);
      assert.match(hook, /signals\.lastWorkoutAtMs,\n/);
      const plan = code(read('src', 'lib', 'notificationPlan.ts'));
      const reminders = slice(plan, 'function buildSessionReminders(', 'function buildWeighInReminders(');
      assert.doesNotMatch(reminders, /lastSessionAtMs/);
      assert.match(reminders, /input\.lastWorkoutAtMs/);
    },
  },
];
