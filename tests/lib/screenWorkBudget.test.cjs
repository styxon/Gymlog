const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const { createHookRuntime, requireWithStubs } = require('../helpers/hookHarness.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'src');
const dist = (file) => require(path.join(DIST, file));

const format = dist('lib/format.js');
const progression = dist('lib/progression.js');
const { groupLogsBySession, logsOfSession } = dist('lib/sessionLogIndex.js');
const { getSummaryChartPoints, getSummaryChartValues, getTrackedSummaryValues } = dist('lib/progressChartPoints.js');
const { buildExerciseSheetHistory } = dist('lib/exerciseSheetHistory.js');
const search = dist('lib/exerciseSearch.js');
const { exerciseNameLabel } = dist('lib/exerciseNameLabel.js');
const { exerciseLogRepository } = dist('storage/repositories.js');
const { GENERATED_EXERCISE_LIBRARY } = dist('data/generatedExerciseLibrary.js');
const { createEmptyDatabase } = dist('data/seed.js');

/**
 * What a long history costs the screens that read it, held to counts rather
 * than clocks.
 *
 * Each of these was a per-row or per-render cost that grew with the history:
 * a date formatter built for every row, a scan of the whole log table for every
 * session, a 71-programme insight pass for every logged set. A wall-clock
 * budget flakes on a slow runner, so the guards count the work instead —
 * formatters constructed, array reads, calls made — which is the same on any
 * machine and fails on the old code by a factor of the history's length. The
 * phone's engine (Hermes) has no JIT, so a loop that is cheap here is not.
 */

const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

/** Counts every Intl.DateTimeFormat built while `work` runs. */
function countFormatterBuilds(work) {
  const Real = Intl.DateTimeFormat;
  let builds = 0;
  function Counting(...args) {
    builds += 1;
    return new Real(...args);
  }
  Counting.prototype = Real.prototype;
  Counting.supportedLocalesOf = Real.supportedLocalesOf.bind(Real);
  Intl.DateTimeFormat = Counting;
  try {
    work();
  } finally {
    Intl.DateTimeFormat = Real;
  }
  return builds;
}

const DAY = 24 * 60 * 60 * 1000;
const NAMES = ['Barbell Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-Up'];

/** A history with `sessions` sessions of six lifts each, newest last, logs shuffled within the table. */
function bigHistory(sessions) {
  const workoutSessions = [];
  const exerciseLogs = [];
  const start = Date.UTC(2023, 0, 2, 17, 0, 0);
  for (let s = 0; s < sessions; s += 1) {
    const performedAt = new Date(start + s * 2 * DAY).toISOString();
    workoutSessions.push({
      id: `s${s}`,
      workoutTemplateId: 'tpl',
      workoutNameSnapshot: `Day ${(s % 3) + 1}`,
      performedAt,
      durationMinutes: 50 + (s % 20),
    });
    NAMES.forEach((name, i) => {
      // Reverse order index in the table, and a tie on two of them: the
      // index must sort exactly as the filter did.
      const orderIndex = i === 4 ? 3 : NAMES.length - i;
      exerciseLogs.push({
        id: `l${s}_${i}`,
        sessionId: `s${s}`,
        exerciseTemplateId: null,
        exerciseNameSnapshot: name,
        weight: 40 + i * 10 + (s % 40),
        repsPerSet: [8, 8, 8],
        sets: [0, 1, 2].map((k) => ({ orderIndex: k, weight: 40 + i * 10 + (s % 40), reps: 8, kind: 'working', outcome: 'completed' })),
        tracked: i < 3,
        orderIndex,
      });
    });
  }
  return { ...createEmptyDatabase('fi'), exerciseLibrary: [], workoutSessions, exerciseLogs, exerciseTemplates: [] };
}

module.exports = [
  {
    name: 'screen work: date helpers share one formatter per locale and options, and read the same',
    run() {
      const stamps = ['2026-01-05T08:09:00.000Z', '2026-03-29T00:30:00.000Z', '2026-10-25T23:59:00.000Z', '2025-12-31T22:15:00.000Z'];
      for (const language of ['fi', 'en', undefined]) {
        const locale = format.localeFor(language);
        for (const stamp of stamps) {
          const at = new Date(stamp);
          assert.equal(
            format.formatDate(stamp, language),
            new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(at),
          );
          assert.equal(
            format.formatShortDate(stamp, language),
            new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at),
          );
          // The day through Intl, the clock HH:mm by hand (D3-2).
          const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(at);
          const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
          assert.equal(
            format.formatSessionDate(stamp, language),
            language === 'fi' ? `${day} klo ${clock}` : `${day}, ${clock}`,
          );
        }
      }
      // Clock times are written out, HH:mm in both languages (owner,
      // 2026-10-12; dup sweep 13, D3-2) — no formatter at all.
      for (const language of ['fi', 'en']) {
        for (const stamp of stamps) {
          const at = new Date(stamp);
          const pad = (value) => String(value).padStart(2, '0');
          assert.equal(format.formatTime(stamp, language), `${pad(at.getHours())}:${pad(at.getMinutes())}`);
        }
      }

      // 1,000 rows of a History list, a chart and a sheet: one formatter each.
      const builds = countFormatterBuilds(() => {
        for (let i = 0; i < 1000; i += 1) {
          const stamp = new Date(Date.UTC(2024, 0, 1) + i * DAY).toISOString();
          format.formatShortDate(stamp, 'fi');
          format.formatDate(stamp, 'en');
          format.formatSessionDate(stamp, 'fi');
          format.formatTime(stamp, 'fi');
        }
      });
      assert.ok(builds <= 4, `4,000 date formats built ${builds} formatters; one per locale and options is 4`);
    },
  },
  {
    name: 'screen work: the shared formatter follows the device time zone when it changes',
    run() {
      const SESSION_DAY = { weekday: 'short', day: 'numeric', month: 'short' };
      const saved = process.env.TZ;
      // 06:00 on 1 June in Helsinki, 20:00 on 31 May in Los Angeles: the day
      // part (the cached formatter) differs, not only the clock.
      const stamp = '2026-06-01T03:00:00.000Z';
      const dayOf = (text) => text.split(' klo ')[0];
      try {
        process.env.TZ = 'Europe/Helsinki';
        // formatSessionDate carries a time and goes through the cached
        // formatter (formatTime no longer does).
        const helsinki = format.formatSessionDate(stamp, 'fi');
        assert.equal(dayOf(helsinki), new Intl.DateTimeFormat('fi-FI', SESSION_DAY).format(new Date(stamp)));
        process.env.TZ = 'America/Los_Angeles';
        const losAngeles = format.formatSessionDate(stamp, 'fi');
        assert.equal(dayOf(losAngeles), new Intl.DateTimeFormat('fi-FI', SESSION_DAY).format(new Date(stamp)));
        assert.notEqual(dayOf(losAngeles), dayOf(helsinki), 'a cached formatter would still read Helsinki');
      } finally {
        if (saved === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = saved;
        }
      }
    },
  },
  {
    name: 'screen work: the player sheet history builds one formatter for a 400-session lift, not 400',
    run() {
      const past = Array.from({ length: 400 }, (_, i) => ({
        performedAt: new Date(Date.UTC(2023, 0, 1) + i * DAY).toISOString(),
        sets: [{ loadKg: 60 + (i % 30), reps: 5 }],
      }));
      let built;
      const builds = countFormatterBuilds(() => {
        built = buildExerciseSheetHistory(past, null, 'fi');
      });
      assert.ok(builds <= 2, `${builds} formatters built for 400 sessions`);
      assert.ok(built.rows.length >= 8);
      const player = readGuidedPlayerSource();
      const memo = between(player, '  const sheetHistory = useMemo(() => {', '  /* ── rest screen');
      assert.match(memo, /if \(!setPanelsOpen\) \{\s*return gateExerciseSheetHistory\(buildExerciseSheetHistory\(\[\], null, language\), proUnlocked\);/, 'a closed sheet builds nothing');
      assert.match(memo, /\}, \[[^\]]*\bsetPanelsOpen\b[^\]]*\]\);/, 'the memo must be keyed on the sheet being open');
      assert.ok(
        player.indexOf('<ExerciseSheet') > 0 && /setPanelsOpen && step\.type === 'set' \? \(\s*<ExerciseSheet/.test(player),
        'sheetHistory is only read behind setPanelsOpen',
      );
    },
  },
  {
    name: 'screen work: Progress Tracked rows take values for the sparkline and labels only for the open row',
    run() {
      const db = bigHistory(300);
      const summaries = progression.getTrackedExerciseProgress(db);
      assert.ok(summaries.length >= 3 && summaries.every((summary) => summary.logs.length > 100));
      for (const language of ['fi', 'en']) {
        for (const summary of summaries) {
          const points = getSummaryChartPoints(summary, 'kg', language);
          assert.deepEqual(getSummaryChartValues(summary, 'kg'), points.map((point) => point.value));
          assert.equal(points.length, summary.logs.length);
          assert.equal(points[0].label, format.formatShortDate(summary.logs[summary.logs.length - 1].performedAt, language));
        }
      }
      const values = getTrackedSummaryValues([null, ...summaries], 'kg');
      assert.equal(values.size, summaries.length);
      for (const summary of summaries) {
        assert.deepEqual(values.get(summary.key), getSummaryChartPoints(summary, 'kg', 'fi').map((point) => point.value));
      }

      // The value path formats no date at all, however long the history.
      const builds = countFormatterBuilds(() => getTrackedSummaryValues(summaries, 'kg'));
      assert.equal(builds, 0);

      // And the screen builds the labelled points for the open row only, in a hook.
      const screen = source('src/screens/ProgressScreen.tsx');
      assert.doesNotMatch(
        between(screen, '  function renderTracked() {', '  function renderMeasures() {'),
        /getSummaryChartPoints\(/,
        'the Tracked rows must not build labelled points per render',
      );
      assert.match(screen, /const trackedValues = useMemo\(/);
      assert.match(screen, /const expandedTrackedPoints = useMemo\(/);
      assert.match(screen, /\}, \[expandedKey, trackedRows, unitPreference, language\]\);/);
    },
  },
  {
    name: 'screen work: the exercise page asks for its history through a lookup that holds between renders',
    run() {
      const db = bigHistory(120);
      const sameLift = (logged, row) => logged.toLowerCase() === row.toLowerCase();
      const lookup = progression.createExerciseProgressLookup(db, sameLift);
      const first = lookup('Bench Press');
      assert.equal(lookup('Bench Press'), first, 'the same name returns the same summary object');
      assert.deepEqual(first, progression.getExerciseProgressForName(db, 'Bench Press', sameLift));
      const other = lookup('Deadlift');
      assert.notEqual(other, first);
      assert.deepEqual(other, progression.getExerciseProgressForName(db, 'Deadlift', sameLift));

      // The hook: a render that changes none of the three tables keeps the lookup.
      const runtime = createHookRuntime();
      const { useExerciseDetailHistory: hook } = requireWithStubs(path.join(DIST, 'app', 'useExerciseDetailHistory.js'), {
        react: runtime.react,
      });
      const render = (database, matcher) => runtime.render(() => hook(database, matcher), undefined);
      const baseline = render(db, sameLift);
      const afterPreference = render({ ...db, preferences: { appLanguage: 'en' } }, sameLift);
      assert.equal(afterPreference, baseline, 'a preference change must not rebuild the lookup');
      assert.equal(afterPreference('Bench Press'), baseline('Bench Press'));
      const afterLog = render({ ...db, exerciseLogs: [...db.exerciseLogs] }, sameLift);
      assert.notEqual(afterLog, baseline, 'a change to the logs must');
      runtime.unmount();

      // And the page no longer builds it inline in the render.
      const tab = source('src/app/renderWorkoutTab.tsx');
      assert.doesNotMatch(tab, /getExerciseProgressForName\(/);
      assert.match(tab, /history=\{exerciseProgressFor\(exercise\.name\)\}/);
    },
  },
  {
    name: 'screen work: the log index answers each session as the filter did, reading each log once',
    run() {
      const db = bigHistory(200);
      const index = groupLogsBySession(db.exerciseLogs);
      assert.equal(index.size, 200);
      for (const session of db.workoutSessions) {
        assert.deepEqual(logsOfSession(index, session.id), exerciseLogRepository.listBySessionId(db, session.id));
      }
      assert.deepEqual(logsOfSession(index, 'nope'), []);

      let reads = 0;
      const counted = new Proxy(db.exerciseLogs, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) {
            reads += 1;
          }
          return Reflect.get(target, key, receiver);
        },
      });
      groupLogsBySession(counted);
      assert.equal(reads, db.exerciseLogs.length, 'every log is read exactly once, not once per session');

      const provider = source('src/state/AppProvider.tsx');
      assert.match(provider, /const sessionLogIndex = useMemo\(\(\) => groupLogsBySession\(database\.exerciseLogs\), \[database\.exerciseLogs\]\);/);
      // getSessionLogs keeps its identity until the logs change, so History's memoised rows are not rebuilt by a preference toggle.
      assert.match(provider, /const getSessionLogs = useCallback\([\s\S]*?\[sessionLogIndex\],\s*\);/);
      assert.doesNotMatch(provider, /listBySessionId/, 'getSessionLogs must not filter the table per question');
    },
  },
  {
    name: 'screen work: History rows are memoised and handed the same handlers on every render',
    run() {
      const screen = source('src/screens/HistoryScreen.tsx');
      assert.match(screen, /const SessionRow = React\.memo\(function SessionRow\(/);
      const rows = between(screen, '<SessionRow\n', '/>\n');
      assert.match(rows, /onPress=\{selectSession\}/);
      assert.match(rows, /onDelete=\{editing && onDeleteSession \? requestDelete : undefined\}/);
      assert.doesNotMatch(rows, /=> /, 'no inline arrow function among the row props');
      assert.match(screen, /const selectSession = useCallback\(/);
      assert.match(screen, /const requestDelete = useCallback\(/);
    },
  },
  {
    name: 'screen work: picker search matches before it ranks, with the same order',
    run() {
      /** The implementation before: rank every row, then drop the ones that do not match. */
      function frozenRank(items, query, language, popularity) {
        const needle = query.trim();
        if (!needle) {
          return [...items];
        }
        const popular = (item) => popularity?.(item) ?? Number.MAX_SAFE_INTEGER;
        return items
          .map((item, index) => {
            const label = exerciseNameLabel(language, item.name);
            return {
              item,
              index,
              rank: search.rankExerciseMatch(item, needle, language),
              popular: popular(item),
              label,
              nameHit: search.exerciseMatchesQuery(`${label} ${item.name}`, needle) ? 0 : 1,
            };
          })
          .filter(({ item }) => search.exerciseMatchesQuery(search.buildExerciseSearchHaystack(item, language), needle))
          .sort(
            (left, right) =>
              left.rank - right.rank ||
              left.popular - right.popular ||
              left.nameHit - right.nameHit ||
              left.label.length - right.label.length ||
              left.index - right.index,
          )
          .map(({ item }) => item);
      }
      const popularityOf = new Map(GENERATED_EXERCISE_LIBRARY.map((row, i) => [row.name, i % 5 === 0 ? undefined : (i * 7) % 60]));
      const popularity = (item) => popularityOf.get(item.name);
      for (const language of ['fi', 'en']) {
        for (const query of ['press', 'squat', 'hauis', 'pr', 'p', 'ylätal', 'leg ext', '  curl ', '', 'xyzzy']) {
          const now = search.rankExerciseMatches(GENERATED_EXERCISE_LIBRARY, query, language, popularity);
          const before = frozenRank(GENERATED_EXERCISE_LIBRARY, query, language, popularity);
          assert.deepEqual(
            now.map((row) => row.name),
            before.map((row) => row.name),
            `"${query}" in ${language}`,
          );
          assert.deepEqual(
            search.rankExerciseMatches(GENERATED_EXERCISE_LIBRARY, query, language),
            frozenRank(GENERATED_EXERCISE_LIBRARY, query, language),
          );
        }
      }

      // The ranking reads several normalised strings per row; a selective word
      // must rank its matches only. popularity() is asked once per ranked row.
      let asked = 0;
      const matches = search.rankExerciseMatches(GENERATED_EXERCISE_LIBRARY, 'press', 'en', (item) => {
        asked += 1;
        return popularity(item);
      });
      assert.ok(matches.length > 10 && matches.length < GENERATED_EXERCISE_LIBRARY.length / 2);
      assert.equal(asked, matches.length, `ranked ${asked} rows for ${matches.length} matches`);
    },
  },
  {
    name: 'screen work: a logged set does not rebuild the coach summary when its inputs held',
    run() {
      // The programme-insight map this test also pinned is gone: it was built
      // for every programme on every database change and no screen drew it
      // (duplicate sweep 13, D5-6, 2026-10-12). Its absence is the guard now.
      assert.doesNotMatch(source('src/app/useCustomProgramViews.ts'), /programInsights|buildProgramInsightMap/);
      assert.equal(fs.existsSync(path.join(ROOT, 'src', 'lib', 'programInsights.ts')), false);

      // The coach summary: a new object only when title, next exercise or meta change.
      const summaryRuntime = createHookRuntime();
      const { useStableActiveWorkoutSummary } = requireWithStubs(path.join(DIST, 'app', 'useStableActiveWorkoutSummary.js'), {
        react: summaryRuntime.react,
      });
      const run = (parts) => summaryRuntime.render(() => useStableActiveWorkoutSummary(parts), undefined);
      const a = run({ title: 'Push', nextExercise: 'Bench', meta: '5 sets left | Started 10:00' });
      const b = run({ title: 'Push', nextExercise: 'Bench', meta: '5 sets left | Started 10:00' });
      assert.equal(b, a, 'a value-equal summary is the same object');
      assert.deepEqual(a, { title: 'Push', nextExercise: 'Bench', meta: '5 sets left | Started 10:00' });
      const c = run({ title: 'Push', nextExercise: 'Bench', meta: '4 sets left | Started 10:00' });
      assert.notEqual(c, a);
      const d = run({ title: 'Push', nextExercise: null, meta: '4 sets left | Started 10:00' });
      assert.notEqual(d, c);
      assert.equal(d.nextExercise, null);
      assert.equal(run(null), null);
      assert.equal(run(null), null);
      summaryRuntime.unmount();

      const app = readAppWiring();
      assert.match(app, /const homeActiveWorkoutSummary = useHomeActiveWorkoutSummary\(workout\.activeSession, preferences\.appLanguage\);/);
      assert.match(
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useHomeActiveWorkoutSummary.ts'), 'utf8'),
        /return useStableActiveWorkoutSummary\(homeActiveWorkoutParts\);/,
      );
    },
  },
];
