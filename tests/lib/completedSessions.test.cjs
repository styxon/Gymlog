const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
const {
  getCalendarWeekStartAfter,
  getCalendarWeekStartBefore,
  getCalendarWeekStartTimestamp,
  getRollingWindowStart,
} = require('../../.test-dist/lib/completedSessions.js');

module.exports = [
  {
    name: 'calendar week stepping lands on real week starts across a clock change',
    run() {
      withHelsinkiClocks(() => {
        // The week of 23 March 2026 is 167 hours long and the week of 26
        // October is 169, so neither can be reached by adding or subtracting a
        // fixed 168. Every caller looks these values up in a set of week starts,
        // where being an hour off is the same as not existing.
        const march30 = getCalendarWeekStartTimestamp(new Date(2026, 2, 31, 9, 0, 0));
        const march23 = getCalendarWeekStartTimestamp(new Date(2026, 2, 24, 9, 0, 0));
        const october26 = getCalendarWeekStartTimestamp(new Date(2026, 9, 27, 9, 0, 0));
        const october19 = getCalendarWeekStartTimestamp(new Date(2026, 9, 20, 9, 0, 0));

        assert.equal(getCalendarWeekStartBefore(march30), march23);
        assert.equal(getCalendarWeekStartAfter(march23), march30);
        assert.equal(getCalendarWeekStartBefore(october26), october19);
        assert.equal(getCalendarWeekStartAfter(october19), october26);

        // The spans the fixed-millisecond arithmetic assumed are not 168 hours.
        assert.equal((march30 - march23) / 3600000, 167);
        assert.equal((october26 - october19) / 3600000, 169);
      });
    },
  },
  {
    name: 'stepping several weeks in one hop matches stepping one at a time',
    run() {
      withHelsinkiClocks(() => {
        // trainingRhythm indexes its bars with a single multi-week hop, so the
        // two forms have to agree or the chart disagrees with the streak.
        const start = getCalendarWeekStartTimestamp(new Date(2026, 3, 1, 12, 0, 0));

        let iterative = start;
        for (let step = 0; step < 4; step += 1) {
          iterative = getCalendarWeekStartBefore(iterative);
        }

        assert.equal(getCalendarWeekStartBefore(start, 4), iterative);
      });
    },
  },
  {
    name: 'stepping zero weeks is the identity',
    run() {
      withHelsinkiClocks(() => {
        // trainingRhythm asks for offset 0 on its newest bar.
        const start = getCalendarWeekStartTimestamp(new Date(2026, 3, 1, 12, 0, 0));

        assert.equal(getCalendarWeekStartBefore(start, 0), start);
        assert.equal(getCalendarWeekStartAfter(start, 0), start);
      });
    },
  },
  {
    name: 'a rolling day window keeps the time of day it started from',
    run() {
      withHelsinkiClocks(() => {
        // The 30-day counter's contract: same wall-clock time, N calendar days
        // back, rather than N fixed 24-hour chunks.
        const now = new Date(2026, 3, 10, 12, 0, 0);
        const start = new Date(getRollingWindowStart(now, 30));

        assert.equal(start.getHours(), 12);
        assert.equal(start.getDate(), 11);
        assert.equal(start.getMonth(), 2);
        assert.equal((now.getTime() - start.getTime()) / 3600000, 719);
      });
    },
  },
  {
    /*
     * Audit round 4 (2026-09-20): the canonical list built a signature with
     * `new Date(performedAt).toISOString()`, which throws on a date that does
     * not parse — and it runs from a top-level memo on every render, so one
     * bad string in a restored backup was a red screen at every launch. The
     * loader accepts any string here; the reader of it must not throw.
     */
    name: 'a session whose date does not parse is kept as written, not thrown on',
    run() {
      const { getCanonicalCompletedSessions } = require('../../.test-dist/lib/completedSessions.js');
      const database = {
        workoutSessions: [
          { id: 'ok', workoutTemplateId: 't', workoutTemplateSessionId: 'd1', workoutNameSnapshot: 'Upper', performedAt: '2026-09-20T10:00:00.000Z' },
          { id: 'bad', workoutTemplateId: 't', workoutTemplateSessionId: 'd1', workoutNameSnapshot: 'Upper', performedAt: 'not a date' },
        ],
        // Both did work: the canonical list is of sessions with a completed set.
        exerciseLogs: [
          { id: 'log_ok', sessionId: 'ok', exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', weight: 80, repsPerSet: [5], sets: [{ orderIndex: 0, weight: 80, reps: 5, kind: 'working', outcome: 'completed', status: 'completed' }], tracked: true, orderIndex: 0 },
          { id: 'log_bad', sessionId: 'bad', exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', weight: 80, repsPerSet: [5], sets: [{ orderIndex: 0, weight: 80, reps: 5, kind: 'working', outcome: 'completed', status: 'completed' }], tracked: true, orderIndex: 0 },
        ],
        cardioSessions: [],
      };
      const sessions = getCanonicalCompletedSessions(database);
      assert.deepEqual(sessions.map((session) => session.id).sort(), ['bad', 'ok']);
    },
  },
  {
    // Duplicate sweep 13 (D2-8 / D5-7, 2026-10-12). The streak walk — start at
    // this week if it has activity, else last week, step back by calendar week
    // — lived three times: Home (getCurrentWeekStreak), Profile
    // (lifetimeSummary) and Progress (trainingCalendar.weeklyTrainingStreak).
    // Three audits had made them match by hand. One walk now.
    name: 'one streak walk: fourteen weeks across the autumn clock change, from an empty current week',
    run() {
      const { streakFromWeekStarts, getCurrentWeekStreak } = require('../../.test-dist/lib/completedSessions.js');
      const { getLifetimeTrainingSummary } = require('../../.test-dist/lib/lifetimeSummary.js');
      const { weeklyTrainingStreak } = require('../../.test-dist/lib/trainingCalendar.js');
      withHelsinkiClocks(() => {
        // Fourteen consecutive Mondays ending 2 November 2026; 25 October is a
        // 25-hour Sunday inside the run.
        const lastMonday = new Date(2026, 10, 2).getTime();
        const starts = [];
        for (let back = 13; back >= 0; back -= 1) {
          starts.push(getCalendarWeekStartBefore(lastMonday, back));
        }
        const mondayAfter = new Date(getCalendarWeekStartAfter(lastMonday) + 9 * 60 * 60 * 1000);
        assert.equal(streakFromWeekStarts(starts, mondayAfter), 14, 'an empty current week breaks nothing');
        assert.equal(streakFromWeekStarts(new Set(starts), new Date(2026, 10, 4, 12)), 14);
        assert.equal(streakFromWeekStarts([], mondayAfter), 0);

        // The three surfaces, over one database: a session a week on Tuesdays,
        // a run in one of those weeks, and a date that does not parse.
        const sessions = starts.map((start, index) => ({
          id: `s${index}`,
          workoutTemplateId: 'tpl',
          workoutTemplateSessionId: null,
          workoutNameSnapshot: 'Day',
          performedAt: new Date(getCalendarWeekStartAfter(start, 0) + 34 * 60 * 60 * 1000).toISOString(),
          totalVolumeKg: 100,
        }));
        const exerciseLogs = sessions.map((session) => ({
          id: `log_${session.id}`,
          sessionId: session.id,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Squat',
          weight: 100,
          repsPerSet: [5],
          sets: [{ orderIndex: 0, weight: 100, reps: 5, kind: 'working', outcome: 'completed' }],
          tracked: true,
          orderIndex: 0,
          skipped: false,
        }));
        const cardioSessions = [
          { id: 'run', performedAt: new Date(2026, 9, 27, 18).toISOString() },
          { id: 'garbled', performedAt: 'not a date' },
        ];
        const database = { workoutSessions: sessions, exerciseLogs, cardioSessions };
        const home = getCurrentWeekStreak(database, mondayAfter);
        assert.equal(home, 14);
        assert.equal(getLifetimeTrainingSummary(database, mondayAfter).currentWeekStreak, home);
        assert.equal(weeklyTrainingStreak(sessions, cardioSessions, mondayAfter), home);
      });

      const fs = require('node:fs');
      const path = require('node:path');
      const ROOT = path.join(__dirname, '..', '..');
      const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const file of ['src/lib/lifetimeSummary.ts', 'src/lib/trainingCalendar.ts']) {
        const source = strip(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        assert.doesNotMatch(source, /while \(/, `${file} walks its own streak`);
        assert.match(source, /streakFromWeekStarts\(/);
      }
    },
  },
  {
    // Duplicate sweep 13 (D2-7, 2026-10-12): the Monday-first week start was
    // copied into trainingCalendar (mondayOf), trainingHistory (startOfWeek)
    // and workoutCompletionState (getStartOfWeek / getEndOfWeek, Home's
    // done-this-week chips). Each now asks getCalendarWeekStartTimestamp.
    name: 'one Monday: no week-start arithmetic outside completedSessions',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const ROOT = path.join(__dirname, '..', '..');
      const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const weekStartArithmetic = /getDay\(\)\s*(===|[+-])|\(\s*\w+\.getDay\(\)\s*\+\s*6\s*\)\s*%\s*7/;
      for (const file of ['src/lib/trainingCalendar.ts', 'src/lib/trainingHistory.ts', 'src/app/useHomeTrainingSchedule.ts']) {
        const source = strip(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        assert.doesNotMatch(source, weekStartArithmetic, `${file} computes its own Monday`);
      }
      const home = strip(fs.readFileSync(path.join(ROOT, 'src/app/useHomeTrainingSchedule.ts'), 'utf8'));
      assert.match(home, /const weekStart = getCalendarWeekStartTimestamp\(new Date\(todayStartMs\)\);/);
      assert.doesNotMatch(
        strip(fs.readFileSync(path.join(ROOT, 'src/app/workoutCompletionState.ts'), 'utf8')),
        /getStartOfWeek|getEndOfWeek/,
      );
    },
  },
  {
    // Duplicate sweep 13 (D2-9, 2026-10-12): three private copies of "whole
    // days between two local midnights" now delegate to calendarDaysBetween.
    // coachDemoMoments keeps its own guard: an install date that does not
    // parse is day 0 (no moment due), where calendarDaysBetween gives NaN.
    name: 'one day count: the schedule, the body-weight axis and the coach demo ask calendarDaysBetween',
    run() {
      const { daysSince } = require('../../.test-dist/lib/coachDemoMoments.js');
      const now = new Date(2026, 10, 1, 12);
      assert.equal(daysSince('not-a-date', now), 0);
      withHelsinkiClocks(() => {
        assert.equal(daysSince(new Date(2026, 9, 24, 23, 30).toISOString(), new Date(2026, 9, 26, 0, 30)), 2);
      });

      const fs = require('node:fs');
      const path = require('node:path');
      const ROOT = path.join(__dirname, '..', '..');
      const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const file of ['src/lib/trainingSchedule.ts', 'src/lib/bodyweightCard.ts', 'src/lib/coachDemoMoments.ts']) {
        const source = strip(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        assert.doesNotMatch(source, /\/\s*(DAY_MS|86_?400_?000)\b/, `${file} divides by a fixed day`);
        assert.match(source, /calendarDaysBetween\(/);
      }
    },
  },
];
