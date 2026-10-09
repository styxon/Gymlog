const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { getHomeDayView, sessionForSlot } = require('../../.test-dist/lib/homeCalendar.js');
const { hasOnlyEmptyDays, nextStartableSessionIndex } = require('../../.test-dist/lib/programSessionList.js');
const { weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');
const { findHomeWidgetNextSession, resolveHomeWidgetSessionTap } = require('../../.test-dist/lib/widgetPayload.js');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * A day added empty ("Lisää päivä", #187) — audit 8, 2026-09-26.
 *
 * Home's hero skipped it; the week strip and the widget indexed the list
 * straight and called it today's workout, "0 exercises". And a programme left
 * with only empty days made Home look like it had no programme at all.
 */

// Mon = Push, Wed = the day just added empty, Fri = Pull.
const SESSIONS = [
  { id: 's0', title: 'Push', duration: '~40 min', exercises: [{ name: 'Bench' }] },
  { id: 's1', title: 'Treeni 2', duration: '~20 min', exercises: [] },
  { id: 's2', title: 'Pull', duration: '~35 min', exercises: [{ name: 'Row' }] },
];
const SCHEDULE = weekdaySchedule([0, 2, 4]);
const WEDNESDAY = new Date(2026, 8, 30);

module.exports = [
  {
    name: 'empty day: a slot on an empty day goes to the next day with lifts, the hero\'s rule',
    run() {
      assert.equal(sessionForSlot(SESSIONS, 0).id, 's0');
      assert.equal(sessionForSlot(SESSIONS, 1).id, 's2');
      // A cycle longer than the programme still walks round it.
      assert.equal(sessionForSlot(SESSIONS, 4).id, 's2');
      assert.equal(sessionForSlot(SESSIONS, -2).id, 's2');
      assert.equal(sessionForSlot(SESSIONS, null), null);
      assert.equal(sessionForSlot([], 0), null);
      assert.equal(sessionForSlot([{ id: 'x', exercises: [] }], 0), null);
      // The same answer as Home's hero for the same slot.
      const hero = nextStartableSessionIndex(SESSIONS.map((session) => session.exercises.length), 1);
      assert.equal(SESSIONS[hero].id, sessionForSlot(SESSIONS, 1).id);
    },
  },
  {
    name: 'empty day: the week strip\'s day view and the widget agree with the hero',
    run() {
      const view = getHomeDayView(
        { dayStart: WEDNESDAY.getTime(), weekdayIndex: 2, weekdayLabel: 'WED', dateLabel: '30', label: '', isToday: true },
        SCHEDULE,
        SESSIONS,
      );
      assert.equal(view.kind, 'training');
      assert.equal(view.session.id, 's2');

      const widget = findHomeWidgetNextSession({ nowMs: WEDNESDAY.getTime(), schedule: SCHEDULE, sessions: SESSIONS });
      assert.ok(widget);
      assert.equal(widget.session.id, 's2');
      assert.ok(widget.session.exercises.length > 0);

      // Home's own strip goes through the same function, not its own modulo.
      const home = strip(read('src', 'screens', 'HomeScreen.tsx'));
      // From today on it names days by the rotation Home offers (sessionForForecastDay).
      assert.match(
        home,
        /session:\s*picked \?\?\s*sessionForForecastDay\(planSessions, trainingSchedule, date, activePlan\?\.sessionForecast \?\? null\),/,
      );
      // Today the reader's own pick names the chip, as it names the hero
      // (review of the forecast, 2026-09-28).
      assert.match(
        home,
        /isToday && activePlan\?\.todayPickSessionId\s*\?\s*planSessions\.find\(\(session\) => session\.id === activePlan\.todayPickSessionId\) \?\? null\s*:\s*null;/,
      );

      // Break round, 2026-09-28: Monday missed, Home still offers Push on
      // Wednesday — and so does the widget, not the calendar's Wednesday slot.
      const missedMonday = { fromDayStart: WEDNESDAY.getTime(), nextSlot: 0, trainedToday: false };
      const forecastWidget = findHomeWidgetNextSession({
        nowMs: WEDNESDAY.getTime(),
        schedule: SCHEDULE,
        sessions: SESSIONS,
        sessionForecast: missedMonday,
      });
      assert.equal(forecastWidget.session.id, 's0');
      assert.equal(forecastWidget.offset, 0);

      // The tap opens what the tile shows on a later day too (review of the
      // forecast): Monday missed, A done today, so Friday is B — the
      // calendar's Friday slot is C.
      const ABC = [
        { id: 'a', title: 'A', duration: '~40 min', exercises: [{ name: 'Bench' }] },
        { id: 'b', title: 'B', duration: '~40 min', exercises: [{ name: 'Row' }] },
        { id: 'c', title: 'C', duration: '~40 min', exercises: [{ name: 'Squat' }] },
      ];
      const tap = resolveHomeWidgetSessionTap({
        hasActiveSession: false,
        hasActivePlan: true,
        nowMs: WEDNESDAY.getTime() + 18 * 3600 * 1000,
        schedule: SCHEDULE,
        sessions: ABC,
        completedWorkoutDayStarts: [WEDNESDAY.getTime()],
        homeSessionId: 'b',
        todayPicked: false,
        sessionForecast: { fromDayStart: WEDNESDAY.getTime(), nextSlot: 1, trainedToday: true },
      });
      assert.equal(tap.kind, 'open');
      assert.equal(tap.next.offset, 2, 'the tap did not go to Friday');
      assert.equal(tap.next.session.id, 'b', 'the tap opened the calendar\'s Friday, not the one the tile showed');
      // The chips and what a screen reader hears come from the same walk: the
      // label was built from each session's next date and kept announcing
      // the empty day (CI review, 2026-09-26).
      assert.match(home, /accessibilityLabel=\{programWeek\s*\.flatMap\(/);
      assert.match(home, /\{programWeek\.map\(\(\{ date: monday, session \}, offset\) => \{/);
      assert.doesNotMatch(home, /planSessionDayStarts/);
      assert.doesNotMatch(home, /activePlan\.sessions\[\(\(slot %/);
    },
  },
  {
    name: 'empty day: a programme with only empty days is named on Home, not dropped',
    run() {
      assert.equal(hasOnlyEmptyDays([0]), true);
      assert.equal(hasOnlyEmptyDays([0, 0, 0]), true);
      assert.equal(hasOnlyEmptyDays([0, 3]), false);
      assert.equal(hasOnlyEmptyDays([]), false);

      // The whole shell: the <HomeScreen> element moved out of App.tsx into
      // src/app/renderHomeDashboard.tsx, and the reading into the src/app
      // module its block moved into (phase-C split, 2026-10-01).
      const app = strip(readAppWiring().replace(/\r\n/g, '\n'));
      const shell = app;
      assert.match(
        shell,
        /const homeEmptyProgramme = useMemo\(\(\) => \{\s*if \(homeActivePlanCard\) \{\s*return null;\s*\}/,
      );
      assert.match(shell, /return hasOnlyEmptyDays\(counts\) \? \{ workoutTemplateId: template\.id, title: template\.name \} : null;/);
      assert.match(app, /emptyProgramme=\{homeEmptyProgramme\}/);
      const home = strip(read('src', 'screens', 'HomeScreen.tsx'));
      // In place of "find a programme", not beside it: the two would say
      // opposite things about the same Home.
      assert.match(
        home,
        /\) : emptyProgramme \? \(\s*<View style=\{styles\.emptyProgramme\}>[\s\S]{0,900}?<\/View>\s*\) : \(\s*startCta\s*\)\}/,
      );
      assert.match(home, /onPress=\{onOpenEmptyProgramme\}/);
      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of ['home.emptyProgramme.body', 'home.emptyProgramme.action', 'toast.setupHandoffFailed']) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
      }
    },
  },
  {
    name: 'setup hand-off: the page stays up until its write lands, and a refusal is said on it',
    run() {
      // The whole shell: the hand-off's hold and its Done handler left App.tsx
      // for src/app in the phase-C split (2026-10-01).
      const app = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(app, /\(!preferences\.setupHandoffCompleted \|\| setupHandoffHeld\) &&/);
      // And what it shows is frozen for the write: the patch re-plans the page.
      assert.match(
        app,
        /const setupHandoffPlan = setupHandoffHeld \? heldSetupHandoffPlanRef\.current : liveSetupHandoffPlan;/,
      );
      assert.match(
        app,
        /setSetupHandoffHeld\(true\);\s*try \{\s*await updatePreferences\(patch\);\s*\} catch \(error\) \{[\s\S]{0,200}showToast\(t\(preferences\.appLanguage, 'toast\.setupHandoffFailed'\)\);\s*return;\s*\} finally \{\s*setupHandoffHeldRef\.current = false;\s*setSetupHandoffHeld\(false\);/,
      );
    },
  },
  {
    name: 'swap sheet: Home says why it is empty, as the programme day does',
    run() {
      const home = strip(read('src', 'screens', 'HomeScreen.tsx'));
      // Home's swap is the player's sheet (2026-10-07): the library sits under
      // the cards, so an empty list means the search or a chip found nothing,
      // and it says so in the player's words.
      assert.match(home, /emptyTitle=\{t\(language, 'guided\.swap\.noMatch'\)\}/);
      // …unless the search hit a lift already in the session: then the sheet
      // names it instead of saying the library has nothing (#bugs 2026-09-27).
      assert.match(home, /t\(language, 'swap\.alreadyInSession', \{ names: swapSessionHits\.join\(', '\) \}\)/);
    },
  },
];
