const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const format = require(`${DIST}/lib/format.js`);
const { buildCoachModules } = require(`${DIST}/lib/aiCoachModules.js`);
const { buildSessionAnalysis, volumeChangePercent } = require(`${DIST}/lib/sessionAnalysis.js`);
const { formatClock, formatEndsAt } = require(`${DIST}/lib/restSchedule.js`);
const { formatHomeStatRecency, formatHomeStatValue } = require(`${DIST}/lib/homeStatCards.js`);
const { formatRecordWhenLabel } = require(`${DIST}/lib/profileOverview.js`);
const { formatLoadKg } = require(`${DIST}/lib/recoverySheet.js`);
const { formatMilestoneDecimal, formatMilestoneVolume } = require(`${DIST}/lib/profileMilestoneRows.js`);
const { calendarDaysBetween } = require(`${DIST}/lib/completedSessions.js`);
const { trendRangeDays, trendRangeStart } = require(`${DIST}/lib/historyWindow.js`);
const { getMonthTrainingTotals, sumMonthTrainingTotals } = require(`${DIST}/lib/dashboard.js`);

/**
 * Duplicate-truth sweep 13, fixer C: one formatter per quantity.
 *
 * Each case below is a question the app answered in two or more places with
 * different answers — a weight rounded to a value nobody lifted, a clock in
 * two styles, "Last week" beside a date — and pins the one answer now.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function inFinnish(body) {
  format.setNumberLanguage('fi');
  try {
    return body();
  } finally {
    // The runner asserts English numbers everywhere else.
    format.setNumberLanguage('en');
  }
}

function session(id, name, performedAt, totalVolumeKg, durationMinutes) {
  return { id, workoutTemplateId: 'tpl', workoutNameSnapshot: name, performedAt, totalVolumeKg, durationMinutes };
}

function log(sessionId, name, weight, repsPerSet) {
  return {
    id: `${sessionId}:${name}`,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: name,
    weight,
    repsPerSet,
    tracked: true,
    orderIndex: 0,
  };
}

// English numbers unless a case says otherwise, whatever ran before.
format.setNumberLanguage('en');

const NOW = new Date(2026, 9, 12, 12, 0);
const daysBefore = (days, hour = 10) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour).toISOString();

module.exports = [
  {
    name: 'dup13 D3-1: the coach sheet prints a 1.25 kg step as lifted — 61,25 and +1,25, not 61,3',
    run() {
      const modules = inFinnish(() =>
        buildCoachModules({
          sessions: [session('s2', 'Push', daysBefore(1), undefined), session('s1', 'Push', daysBefore(8), undefined)],
          logs: [log('s1', 'Bench Press', 60, [5]), log('s2', 'Bench Press', 61.25, [5])],
          language: 'fi',
          now: NOW,
        }),
      );
      const values = modules.focus.metrics.map((metric) => metric.value);
      assert.ok(values.includes('61,25 kg'), `focus metric: ${values}`);
      assert.ok(values.includes('+1,25 kg'), `focus delta: ${values}`);
      const bullets = modules.analysis.bullets.map((bullet) => bullet.body.text).join(' | ');
      assert.match(bullets, /61,25 kg × 5/);
      assert.doesNotMatch(bullets, /61,3/);

      // The Progress tab's tracked-lift line, beside "60 → 61,25": the change
      // keeps its hundredths; body measures (DeltaPill) keep their tenth.
      const progress = strip(read('src', 'screens', 'ProgressScreen.tsx'));
      assert.match(progress, /\{removeTrailingZeros\(delta\)\} \{unitPreference\} · \{removeTrailingZeros\(start \?\? 0\)\}/);
      assert.doesNotMatch(progress, /\bfmtDelta\(/);
    },
  },
  {
    name: 'dup13 D3-2: a clock time is HH:mm in both languages, written by one function',
    run() {
      const at = new Date(2026, 9, 12, 18, 6);
      assert.equal(format.formatClockTime(at), '18:06');
      assert.equal(format.formatClockTime(new Date(2026, 9, 12, 9, 5)), '09:05');
      assert.equal(format.formatTime(at.toISOString(), 'fi'), '18:06', 'Intl wrote the Finnish 18.06');
      assert.equal(format.formatTime(at.toISOString(), 'en'), '18:06', 'Intl wrote 06:06 PM on an en-US phone');
      assert.equal(formatEndsAt(at.getTime()), format.formatClockTime(at));
      // The session stamp's clock too (History hero, weigh-in list; review R2):
      // Intl wrote "klo 18.06" and "06:06 PM" beside a tooltip's "18:06".
      const fiStamp = format.formatSessionDate(at.toISOString(), 'fi');
      const enStamp = format.formatSessionDate(at.toISOString(), 'en');
      assert.ok(fiStamp.endsWith(' klo 18:06'), fiStamp);
      assert.ok(enStamp.endsWith(', 18:06'), enStamp);
      for (const stamp of [fiStamp, enStamp]) {
        assert.doesNotMatch(stamp, /18\.06|06:06|PM|AM/i, stamp);
      }

      // Every formatTime call says whose clock it is: left out, it fell to the
      // device locale (Progress tooltip, the active-workout card).
      const offenders = [];
      const files = [['App.tsx']];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(ROOT, ...dir), { withFileTypes: true })) {
          if (entry.isDirectory()) {
            walk([...dir, entry.name]);
          } else if (/\.tsx?$/.test(entry.name)) {
            files.push([...dir, entry.name]);
          }
        }
      };
      walk(['src']);
      for (const file of files) {
        const source = strip(read(...file));
        for (const match of source.matchAll(/\bformatTime\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
          if (!match[1].includes(',')) {
            offenders.push(`${file.join('/')}: ${match[0]}`);
          }
        }
      }
      assert.deepEqual(offenders, []);

      // And no screen pads its own hours and minutes any more.
      for (const file of [
        ['src', 'lib', 'restSchedule.ts'],
        ['src', 'screens', 'EmptyWorkoutScreen.tsx'],
        ['src', 'screens', 'GuidedPlayerScreen.tsx'],
        ['src', 'screens', 'SettingsScreen.tsx'],
        ['src', 'screens', 'NotificationsScreen.tsx'],
      ]) {
        assert.doesNotMatch(
          strip(read(...file)),
          /getHours\(\)\)\.padStart\(2, '0'\)|padStart\(2, '0'\)\}:\$\{/,
          `${file.join('/')} writes a clock time by hand`,
        );
      }
    },
  },
  {
    name: 'dup13 D3-4: the session clock grows to h:mm:ss on both workout screens',
    run() {
      assert.equal(formatClock(4530), '1:15:30');
      assert.equal(formatClock(3599), '59:59');
      const empty = strip(read('src', 'screens', 'EmptyWorkoutScreen.tsx'));
      assert.doesNotMatch(empty, /function formatSessionClock/, 'the free workout read "75:30" past the hour');
      assert.match(empty, /formatClock\(elapsedSeconds\)/);
      const guided = strip(read('src', 'screens', 'GuidedPlayerScreen.tsx'));
      assert.doesNotMatch(guided, /function formatSessionClock/);
      assert.match(guided, /const formatSessionClock = formatClock;/);
    },
  },
  {
    name: 'dup13 D3-5: a date on the Home card and the completion header is in the reader\'s language',
    run() {
      const now = new Date(2026, 7, 30, 21);
      const at = new Date(2026, 7, 16, 8).getTime();
      assert.equal(formatHomeStatRecency(at, 'en', now), 'Aug 16', 'an English card read the Finnish "16.8."');
      assert.equal(formatHomeStatRecency(at, 'fi', now), '16.8.');
      const completion = strip(read('src', 'screens', 'WorkoutCompletionScreen.tsx'));
      assert.match(completion, /sameDay \? t\(language, 'common\.today'\) : formatShortDate\(performedAt, language\)/);
      // The key that carried the Finnish pattern into the English table is gone.
      assert.doesNotMatch(read('src', 'lib', 'i18n.ts'), /'cards\.when\.onDate'/);
    },
  },
  {
    name: 'dup13 D3-6: the coach sheet words a volume change as the analysis does — "+20 %", and no change is a word',
    run() {
      assert.equal(volumeChangePercent(1200, 1000), 20);
      assert.equal(volumeChangePercent(1000, 1000), 0);
      assert.equal(volumeChangePercent(1000, 0), null);
      assert.equal(volumeChangePercent(null, 1000), null);

      const input = (secondWeight) => ({
        sessions: [session('s2', 'Push', daysBefore(1), undefined), session('s1', 'Push', daysBefore(8), undefined)],
        logs: [log('s1', 'Bench Press', 100, [5, 5]), log('s2', 'Bench Press', secondWeight, [5, 5])],
        now: NOW,
      });
      const up = inFinnish(() => buildCoachModules({ ...input(120), language: 'fi' }));
      const upBullet = up.analysis.bullets[0];
      assert.equal(upBullet.tone, 'up');
      assert.match(upBullet.body.text, /\+20 %/, 'Finnish puts a no-break space before the sign');
      assert.ok(upBullet.body.highlights.includes('+20 %'));

      for (const language of ['fi', 'en']) {
        const flat = buildCoachModules({ ...input(100), language });
        const bullet = flat.analysis.bullets[0];
        assert.equal(bullet.tone, 'flat');
        assert.doesNotMatch(bullet.body.text, /0\s?%/, `${language}: "0 %" is not a result`);
        assert.match(bullet.body.text, language === 'fi' ? /ennallaan/ : /unchanged/);
        assert.ok(bullet.body.text.includes(bullet.body.highlights[0]), 'the highlight is in the sentence');
      }

      const completion = strip(read('src', 'screens', 'WorkoutCompletionScreen.tsx'));
      assert.match(completion, /formatPercent\(muscle\.sharePercent, language\)/);
    },
  },
  {
    name: 'dup13 D3-7: a kg total groups its thousands one way — no-break space in Finnish, comma in English',
    run() {
      format.setNumberLanguage('en');
      assert.equal(format.groupThousands(18400), '18,400');
      assert.equal(format.groupThousands(950), '950');
      assert.equal(format.groupThousands(1234567.4), '1,234,567');
      assert.equal(format.groupThousands(-1500), '-1,500');
      assert.equal(format.formatVolume(18400), '18,400 kg');
      // A total is whole kilograms: History printed "306.25 kg" over an
      // analysis that said "306 kg".
      assert.equal(format.formatVolume(306.25), '306 kg');
      inFinnish(() => {
        assert.equal(format.groupThousands(18400), '18 400');
        assert.equal(format.formatVolume(18400), '18 400 kg');
        assert.equal(formatLoadKg(18400), '18 400 kg');
        assert.equal(formatMilestoneVolume(18400, 'kg'), '18 400 kg', 'the milestone card had a thin space');
      });
      assert.equal(formatLoadKg(18400), '18,400 kg', 'the recovery sheet wrote the Finnish space in English');
      assert.equal(formatMilestoneVolume(18400, 'kg'), '18,400 kg');

      // The History card and its analysis print the same number for one session.
      const stored = session('s1', 'Push', daysBefore(1), 18400.25, 60);
      const analysis = buildSessionAnalysis({
        sessionId: 's1',
        sessions: [stored],
        logs: [log('s1', 'Bench Press', 100, [5])],
        language: 'en',
      });
      assert.ok(analysis.metaParts.includes(format.formatVolume(stored.totalVolumeKg)), analysis.metaParts.join(' · '));
      assert.equal(
        analysis.keyNumbers.find((metric) => metric.labelKey === 'analysis.key.volume').value,
        '18,400 kg',
      );

      // No screen asks the platform for its own grouping, or prints a bare total.
      for (const file of [
        ['src', 'components', 'SetLogSheet.tsx'],
        ['src', 'screens', 'RecordsScreen.tsx'],
      ]) {
        assert.doesNotMatch(strip(read(...file)), /toLocaleString\(/, `${file.join('/')} groups thousands itself`);
      }
      assert.doesNotMatch(strip(read('src', 'lib', 'sessionAnalysis.ts')), /Math\.round\(volume\)\} kg/);
      assert.doesNotMatch(strip(read('src', 'lib', 'aiCoachModules.ts')), /roundVolume/);
      // A single lift is a weight, not a total: it keeps its hundredths.
      assert.match(strip(read('src', 'lib', 'notificationPlan.ts')), /weight: formatWeight\(latestPr\.weightKg\)/);

      // The free workout's live total is History's number while it runs
      // (review R2): it printed "18400 kg" / "306,25 kg" against History's
      // "18 400 kg" / "306 kg".
      const { t } = require(`${DIST}/lib/i18n.js`);
      const live = strip(read('src', 'screens', 'EmptyWorkoutScreen.tsx'));
      assert.match(live, /'emptyWorkout\.stat\.volume', \{ volume: formatVolume\(volumeKg\) \}/);
      assert.doesNotMatch(live, /removeTrailingZeros\(volumeKg\)/);
      assert.equal(t('en', 'emptyWorkout.stat.volume', { volume: format.formatVolume(18400) }), '18,400 kg volume');
      inFinnish(() => {
        assert.equal(t('fi', 'emptyWorkout.stat.volume', { volume: format.formatVolume(306.25) }), '306 kg volyymia');
        assert.equal(t('fi', 'emptyWorkout.stat.volume', { volume: format.formatVolume(18400) }), '18 400 kg volyymia');
      });
    },
  },
  {
    name: 'dup13 D3-8: the analysis states a long session the way History does — 1 h 35 min',
    run() {
      const make = (minutes) =>
        buildSessionAnalysis({
          sessionId: 's1',
          sessions: [session('s1', 'Push', daysBefore(1), 1000, minutes)],
          logs: [log('s1', 'Bench Press', 100, [5])],
          language: 'en',
        }).metaParts[0];
      assert.equal(make(95), format.formatDurationMinutes(95));
      assert.equal(make(95), '1 h 35 min');
      assert.equal(make(45), '45 min');
    },
  },
  {
    name: 'dup13 D3-9: tenths have one formatter, hundredths go straight to removeTrailingZeros',
    run() {
      inFinnish(() => {
        assert.equal(format.formatDecimalTenths(4.666), '4,7');
        assert.equal(format.formatDecimalTenths(3), '3');
        assert.equal(format.formatDecimalTenths(1.25), '1,3');
        assert.equal(formatMilestoneDecimal(-2), '0');
        assert.equal(formatHomeStatValue(61.25), '61,25');
      });
      assert.equal(format.formatDecimalTenths(4.666), '4.7');

      const chat = strip(read('src', 'screens', 'AICoachChatScreen.tsx'));
      assert.doesNotMatch(chat, /String\(intent\.value\)\.replace/, 'the chat swapped its own decimal mark');
      for (const file of [
        ['src', 'lib', 'homeStatCards.ts'],
        ['src', 'lib', 'exerciseSetLog.ts'],
        ['src', 'components', 'SetLogSheet.tsx'],
        ['src', 'screens', 'RecordsScreen.tsx'],
      ]) {
        assert.doesNotMatch(
          strip(read(...file)),
          /removeTrailingZeros\(Math\.round\([^)]*\* 100\) \/ 100\)/,
          `${file.join('/')} rounds again in front of removeTrailingZeros`,
        );
      }
    },
  },
  {
    name: 'dup13 D2-3: a date 7–13 days ago is the date on Profile, the Home card and the exercise page',
    run() {
      const now = new Date(2026, 9, 12, 9);
      for (const days of [7, 10, 13]) {
        const at = new Date(2026, 9, 12 - days, 18);
        const expected = format.formatShortDate(at.toISOString(), 'en');
        assert.equal(format.formatRelativeDay(at, now, 'en'), expected);
        assert.equal(formatHomeStatRecency(at.getTime(), 'en', now), expected, 'the Home card said "Last week"');
        assert.equal(formatRecordWhenLabel(at.toISOString(), now, 'en'), expected);
        assert.equal(format.formatRelativeDay(at, now, 'fi'), `${at.getDate()}.${at.getMonth() + 1}.`);
      }
      assert.equal(format.formatRelativeDay(new Date(2026, 9, 11, 23, 50), now, 'en'), 'Yesterday');
      assert.equal(format.formatRelativeDay(new Date(2026, 9, 6, 8), now, 'fi'), '6 pv sitten');
      assert.equal(format.formatRelativeDay('not a date', now, 'en'), '');

      // The day count is calendarDaysBetween's, across both clock changes.
      withHelsinkiClocks(() => {
        for (const reference of [new Date(2026, 2, 31, 0, 30), new Date(2026, 9, 27, 23, 30)]) {
          for (let back = 0; back < 7; back += 1) {
            for (const hour of [0, 3, 12, 23]) {
              const at = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - back, hour, 15);
              const days = calendarDaysBetween(at, reference);
              const words = format.formatRelativeDay(at, reference, 'en');
              const expected = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
              assert.equal(words, expected, `${at.toString()} → ${reference.toString()}`);
            }
          }
        }
      });

      const detail = strip(read('src', 'screens', 'ExerciseDetailScreen.tsx'));
      assert.match(detail, /return formatRelativeDay\(iso, Date\.now\(\), language\);/);
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.doesNotMatch(i18n, /'exDetail\.lastWeek'|'cards\.when\.lastWeek'/);
    },
  },
  {
    name: 'dup13 D2-6: every chart under a range chip reaches back to the same day',
    run() {
      withHelsinkiClocks(() => {
        const now = new Date(2026, 9, 12, 9);
        const threeMonths = trendRangeStart('3m', now);
        assert.equal(threeMonths.getFullYear(), 2026);
        assert.equal(threeMonths.getMonth(), 6);
        assert.equal(threeMonths.getDate(), 12);
        // The weight chart counted 91 days and began on 14 July.
        assert.equal(trendRangeDays('3m', now), 93);
        assert.equal(trendRangeDays('6m', now), calendarDaysBetween(new Date(2026, 3, 12), now) + 1);
        assert.equal(trendRangeDays('1m', new Date(2026, 2, 12, 9)), 29, 'February is short: not 31');

        const week = trendRangeStart('7d', now);
        assert.equal(week.getTime(), new Date(2026, 9, 6).getTime(), 'six days back, at midnight');
        assert.equal(trendRangeDays('7d', now), 7);
        // Across the October change the week is still seven calendar days.
        assert.equal(trendRangeDays('7d', new Date(2026, 9, 28, 9)), 7);
        assert.equal(trendRangeStart('all', now), null);
        assert.equal(trendRangeDays('all', now), null);
      });
    },
  },
  {
    name: 'dup13 D2-10: the month card and the widget take their month totals from one sum',
    run() {
      withHelsinkiClocks(() => {
        const now = new Date(2026, 9, 12, 9);
        const lifted = [
          session('a', 'Push', new Date(2026, 9, 2, 18).toISOString(), 1000, 60),
          session('b', 'Pull', new Date(2026, 9, 9, 18).toISOString(), 1500, 90),
          session('old', 'Pull', new Date(2026, 8, 30, 18).toISOString(), 900, 50),
        ];
        const run = { id: 'r1', performedAt: new Date(2026, 9, 5, 7).toISOString(), durationSec: 1800 };
        const totals = sumMonthTrainingTotals(lifted, [run], now);
        assert.equal(totals.workouts, 3);
        assert.equal(totals.durationMinutes, 180);
        assert.equal(totals.volumeKg, 2500, 'a run has no tonnage');
        assert.equal(totals.averageDurationMinutes, 60);
        assert.equal(sumMonthTrainingTotals([], [], now).averageDurationMinutes, 0);

        // The widget's entry point is the same sum over the canonical lists.
        const runsOnly = {
          workoutSessions: [],
          exerciseLogs: [],
          cardioSessions: [run, { ...run }],
        };
        const widget = getMonthTrainingTotals(runsOnly, now);
        assert.equal(widget.workouts, 1, 'one run saved twice is one run');
        assert.equal(widget.averageDurationMinutes, 30);
      });

      const progress = strip(read('src', 'screens', 'ProgressScreen.tsx'));
      assert.doesNotMatch(progress, /monthEnd\.setMonth/, 'the month card kept its own month window');
      assert.match(progress, /sumMonthTrainingTotals\(\s*workoutSessions,\s*getCanonicalCardioSessions\(\{ cardioSessions \}\),/);
    },
  },
];
