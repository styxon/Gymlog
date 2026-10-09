const assert = require('node:assert/strict');

const {
  buildHomeWidgetPayload,
  findHomeWidgetNextSession,
  resolveHomeWidgetSessionTap,
  HOME_WIDGET_PAYLOAD_VERSION,
  HOME_WIDGET_MONTH_ROWS,
} = require('../../.test-dist/lib/widgetPayload.js');
const { WIDGET_LINK_PREFIX, parseWidgetDeepLink } = require('../../.test-dist/lib/widgetDeepLink.js');
const { cycleSchedule, weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');

// Local wall-clock, built the same way the payload builds it, so the suite
// passes in any timezone.
function at(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

const SESSIONS = [
  {
    id: 's1',
    title: 'Squat & Bench',
    duration: '~45 min',
    exercises: [{ name: 'Back Squat', setsLabel: '4 sets' }, { name: 'Bench Press', setsLabel: '4 sets' }],
    hiddenExerciseCount: 0,
  },
  {
    id: 's2',
    title: 'Deadlift & Press',
    duration: '~50 min',
    exercises: [{ name: 'Deadlift', setsLabel: '3 sets' }],
    hiddenExerciseCount: 0,
  },
  {
    id: 's3',
    title: 'Upper Pull',
    duration: '~40 min',
    exercises: [{ name: 'Row', setsLabel: '4 sets' }],
    hiddenExerciseCount: 0,
  },
];

function build(overrides = {}) {
  return buildHomeWidgetPayload({
    // Thursday 2026-07-30, midday. July 2026 starts on a Wednesday and runs 31
    // days, so its Monday-first grid is five rows with two blanks in front.
    nowMs: at(2026, 7, 30),
    language: 'en',
    theme: 'dark',
    planName: 'Strong Chest',
    schedule: weekdaySchedule([1, 2, 3]), // tue, wed, thu (0 = Monday)
    sessions: SESSIONS,
    ...overrides,
  });
}

function dates(payload, rowIndex) {
  return payload.monthWeeks[rowIndex].map((day) => day.dateLabel);
}

function states(payload, rowIndex) {
  return payload.monthWeeks[rowIndex].map((day) => day.state);
}

/** The row today falls in — row 4 of July 2026, the week of the 27th. */
const CURRENT_ROW = 4;
/** Thursday, Monday-first. */
const THURSDAY = 3;

module.exports = [
  {
    name: 'widgetPayload: the calendar is the month the reader is in',
    run() {
      const payload = build();

      assert.equal(payload.monthLabel, 'July 2026');
      assert.equal(build({ language: 'fi' }).monthLabel, 'heinäkuu 2026');
      assert.equal(payload.monthWeeks.length, 5);
      for (const week of payload.monthWeeks) {
        assert.equal(week.length, 7);
      }
      // The 1st is a Wednesday, so Monday and Tuesday of the first row belong
      // to June and are drawn as nothing at all.
      assert.deepEqual(dates(payload, 0), ['', '', '1', '2', '3', '4', '5']);
      assert.deepEqual(dates(payload, CURRENT_ROW), ['27', '28', '29', '30', '31', '', '']);
    },
  },
  {
    name: 'widgetPayload: a month that needs six rows gets six',
    run() {
      // August 2026 starts on a Saturday and runs 31 days — the case the layout
      // holds six rows for, and the reason the native side hides the spares.
      const payload = build({ nowMs: at(2026, 8, 15) });
      assert.equal(payload.monthWeeks.length, 6);
      assert.ok(payload.monthWeeks.length <= HOME_WIDGET_MONTH_ROWS);
      assert.deepEqual(dates(payload, 0), ['', '', '', '', '', '1', '2']);
      assert.deepEqual(dates(payload, 5), ['31', '', '', '', '', '', '']);
    },
  },
  {
    name: 'widgetPayload: every day carries its date, and none of them says "today"',
    run() {
      // The flag that used to be here was wrong every morning: the app writes
      // this file when it runs, the widget reads it for as long as it likes,
      // and "this day is today" becomes a lie at the next midnight. The native
      // side compares these keys against the device's own clock instead.
      const payload = build();
      const flat = payload.monthWeeks.flat();

      for (const day of flat) {
        assert.match(day.dateKey, /^\d{4}-\d{2}-\d{2}$/, `${day.dateLabel} has no usable date`);
        assert.ok(!('isToday' in day), 'the payload still decides what today is');
      }
      // Local dates, not UTC: an evening east of Greenwich is already tomorrow
      // in UTC, and the two sides have to mean the same midnight.
      assert.equal(payload.monthWeeks[CURRENT_ROW][THURSDAY].dateKey, '2026-07-30');
      assert.equal(payload.monthWeeks[0][2].dateKey, '2026-07-01');
      // Every key is distinct and in order — a grid is a calendar or it is noise.
      const keys = flat.map((day) => day.dateKey);
      assert.equal(new Set(keys).size, keys.length);
      assert.deepEqual([...keys].sort(), keys);
    },
  },
  {
    name: 'widgetPayload: the days either side of the month are drawn as nothing',
    run() {
      // They hold their column so the weekdays line up, and say nothing else —
      // a June date marked under a July heading is a lie about the month. Not
      // 'off' either: a rest day now carries the green tint, and these cells
      // must carry no colour at all (2026-08-25).
      const payload = build({ completedDayStarts: [at(2026, 6, 30, 18)] });
      const outside = payload.monthWeeks.flat().filter((day) => !day.inMonth);

      assert.ok(outside.length > 0);
      for (const day of outside) {
        assert.equal(day.dateLabel, '');
        assert.equal(day.state, 'pad');
        // The key is still there: the native side needs it to know the ring
        // belongs to no cell at all on a day the grid does not contain.
        assert.match(day.dateKey, /^\d{4}-\d{2}-\d{2}$/);
      }
    },
  },
  {
    name: "widgetPayload: the axis runs Monday to Sunday in the app's language",
    run() {
      assert.deepEqual(build().weekdayLabels, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      assert.deepEqual(build({ language: 'fi' }).weekdayLabels, ['MA', 'TI', 'KE', 'TO', 'PE', 'LA', 'SU']);
    },
  },
  {
    name: 'widgetPayload: four states, and none of them is today',
    run() {
      const payload = build();
      for (const day of payload.monthWeeks.flat()) {
        assert.ok(['done', 'plan', 'off', 'pad'].includes(day.state), `${day.state} is not a state the widget can draw`);
      }
      // Today is a training day that has not been logged: planned. Whether it
      // is also today is the ring's business, drawn on its own axis.
      assert.equal(states(payload, CURRENT_ROW)[THURSDAY], 'plan');
    },
  },
  {
    name: 'widgetPayload: a logged day is done, and the ring is free to sit on it',
    run() {
      const payload = build({ completedDayStarts: [at(2026, 7, 28, 19), at(2026, 7, 30, 7)] });

      // Wednesday the 29th was a training day, is in the past and was never
      // logged, so it reads free — see the next case. The row's weekend is
      // August, which pads July's grid rather than resting in it.
      assert.deepEqual(states(payload, CURRENT_ROW), ['off', 'done', 'off', 'done', 'off', 'pad', 'pad']);
      // The old shape had to choose between "done" and "today". This one does
      // not: the state says trained, the date key lets the ring land on it too.
      assert.equal(payload.monthWeeks[CURRENT_ROW][THURSDAY].dateKey, '2026-07-30');
      assert.equal(payload.monthWeeks[CURRENT_ROW][THURSDAY].state, 'done');
    },
  },
  {
    name: 'widgetPayload: a past planned day that was never trained reads as free',
    run() {
      // The home screen is no place to be reminded of what did not happen.
      const payload = build();
      assert.equal(states(payload, CURRENT_ROW)[1], 'off');
      assert.equal(states(payload, CURRENT_ROW)[2], 'off');
      // Every training day still ahead this month is planned, though — and
      // the weekend after the 31st belongs to August, so it pads.
      assert.deepEqual(states(payload, CURRENT_ROW).slice(4), ['off', 'pad', 'pad']);
      assert.equal(payload.monthWeeks[0].filter((day) => day.state === 'plan').length, 0);
    },
  },
  {
    name: 'widgetPayload: without a program nothing is planned, and history still shows',
    run() {
      const payload = build({
        sessions: [],
        planName: null,
        completedDayStarts: [at(2026, 7, 14), at(2026, 7, 21)],
      });

      assert.equal(payload.monthWeeks.flat().filter((day) => day.state === 'plan').length, 0);
      assert.equal(payload.monthWeeks.flat().filter((day) => day.state === 'done').length, 2);
    },
  },
  {
    name: 'widgetPayload: the three figures are this month, formatted and translated',
    run() {
      const payload = build({ monthTotals: { workouts: 8, durationMinutes: 260, volumeKg: 12400 } });

      assert.deepEqual(
        payload.stats.map((stat) => stat.label),
        ['Workouts', 'Duration', 'Volume'],
      );
      assert.deepEqual(payload.stats.slice(0, 2).map((stat) => stat.value), ['8', '4 h 20 min']);
      // The decimal mark follows the app's number language, which is a module
      // global the rest of the suite also sets — so this asserts the shape.
      assert.match(payload.stats[2].value, /^12[.,]4 t$/);
      assert.deepEqual(
        build({ language: 'fi', monthTotals: { workouts: 8, durationMinutes: 260, volumeKg: 12400 } }).stats.map(
          (stat) => stat.label,
        ),
        ['Treenit', 'Kesto', 'Volyymi'],
      );
    },
  },
  {
    name: 'widgetPayload: a month with nothing in it says zero rather than nothing',
    run() {
      // A blank column reads as a broken widget. Three zeroes read as a month
      // that has not started.
      const payload = build();
      assert.equal(payload.stats.length, 3);
      assert.deepEqual(
        payload.stats.map((stat) => stat.value),
        ['0', '0 min', '0 kg'],
      );
    },
  },
  {
    name: 'widgetPayload: the small number counts every workout there has ever been',
    run() {
      // It counted a week streak until 2026-08-20, when the reader asked for the
      // total instead: "X treeniä".
      assert.equal(build({ totalWorkouts: 128 }).totalValue, '128');
      assert.equal(build({ totalWorkouts: 128 }).totalLabel, 'workouts');
      assert.equal(build({ totalWorkouts: 128, language: 'fi' }).totalLabel, 'treeniä');
      // Nothing logged, and nothing passed in: zero, not a blank.
      assert.equal(build().totalValue, '0');
      assert.equal(build({ totalWorkouts: -3 }).totalValue, '0');
    },
  },
  {
    name: 'widgetPayload: all seven days travel, so the widget can pick one itself',
    run() {
      // The reason: on 2026-08-20 the card still said Thursday's rest day on a
      // Friday training day, because the line was decided when the app last ran.
      const payload = build();

      assert.equal(payload.routineDays.length, 7);
      assert.ok(!('routineTitle' in payload), 'a single line is still being written');
      // Today first, then the six days after it — not Monday first. The
      // native side matches on the date, and a rhythm need not repeat weekly.
      assert.deepEqual(
        payload.routineDays.map((day) => day.dateKey),
        ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'],
      );
      assert.deepEqual(
        payload.routineDays.map((day) => day.when),
        ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday'],
      );
      // One word, not a session name: a 2×1 has no room for "Upper MA
      // (raskas)", and the only question a home screen answers at a glance is
      // whether today is a rest day.
      assert.deepEqual(
        payload.routineDays.map((day) => day.kind),
        ['work', 'rest', 'rest', 'rest', 'rest', 'work', 'work'],
      );
      assert.deepEqual(
        payload.routineDays.map((day) => day.title),
        ['Workout', 'Rest day', 'Rest day', 'Rest day', 'Rest day', 'Workout', 'Workout'],
      );
      assert.deepEqual(
        payload.routineDays.map((day) => day.target),
        ['session', 'home', 'home', 'home', 'home', 'session', 'session'],
      );
      assert.equal(build({ language: 'fi' }).routineDays[0].when, 'Torstai');
      assert.equal(build({ language: 'fi' }).routineDays[0].title, 'Treeni');
      assert.equal(build({ language: 'fi' }).routineDays[1].title, 'Lepopäivä');
    },
  },
  {
    name: 'widgetPayload: the session name is the one the app shows, not the catalog data',
    run() {
      // The card carried the catalog's raw English name past
      // localizeSessionName, and a 2×1 cut "Päivä 3: Kyykky & Soutu" down to
      // "Day 3: squ". Both are gone now for the simplest possible reason: the
      // card no longer names the session at all.
      const named = [{ ...SESSIONS[0], title: 'Day 3: Squat & Row' }];
      const payload = build({ sessions: named, schedule: weekdaySchedule([3]), language: 'fi' });
      assert.equal(payload.routineDays[0].title, 'Treeni');
      assert.equal(payload.routineDays[0].kind, 'work');

      const english = build({ sessions: named, schedule: weekdaySchedule([3]) });
      assert.equal(english.routineDays[0].title, 'Workout');

      // No session name reaches the card in any state, so none of them can be
      // cut, untranslated, or wrong.
      assert.ok(
        payload.routineDays.every((day) => !day.title.includes('Squat') && !day.title.includes('Kyykky')),
      );
    },
  },
  {
    /**
     * Home lets the reader tap the title and say "today is legs, not upper".
     * The widget went on naming what the rotation would have offered, so the
     * launcher and the screen the reader had just left disagreed about the same
     * day. Reported within the hour of the picker shipping.
     */
    name: "widgetPayload: today's line follows the reader's own pick, for today only",
    run() {
      // The card says one word now, so what the pick changes here is whether
      // the day is a training day at all — and the arrow's destination.
      const rest = build({ schedule: weekdaySchedule([0]) });
      assert.equal(rest.routineDays[0].kind, 'rest');
      assert.equal(rest.routineDays[0].target, 'home');

      const picked = build({ schedule: weekdaySchedule([0]), todaySessionId: SESSIONS[1].id });
      assert.equal(picked.routineDays[0].dateKey, '2026-07-30');
      assert.equal(picked.routineDays[0].kind, 'work');
      assert.equal(picked.routineDays[0].target, 'session');

      // Tomorrow has no answer yet, so the rotation still speaks for it.
      assert.equal(picked.routineDays[1].kind, 'rest');

      // A pick that names nothing in the programme is ignored rather than
      // inventing a training day: the plan can change under a stored id.
      assert.equal(build({ schedule: weekdaySchedule([0]), todaySessionId: 'gone' }).routineDays[0].kind, 'rest');
    },
  },

  {
    /**
     * "Is today a training day" stops being the question the moment the
     * training is done. The card said "Treeni" on an afternoon when the
     * calendar beside it had already gone green. Reported 2026-08-21.
     */
    name: "widgetPayload: today reads as done once its workout is logged",
    run() {
      const done = build({ completedWorkoutDayStarts: [at(2026, 7, 30, 8)] });

      assert.equal(done.routineDays[0].kind, 'done');
      assert.equal(done.routineDays[0].title, 'Done');
      assert.equal(build({ completedWorkoutDayStarts: [at(2026, 7, 30, 8)], language: 'fi' }).routineDays[0].title, 'Tehty');

      // Only today, and only a workout. Tomorrow is untouched, and a rest day
      // cannot be "done" — there was nothing to do.
      assert.equal(done.routineDays[1].kind, 'rest');
      const restDay = build({
        schedule: weekdaySchedule([1]),
        completedWorkoutDayStarts: [at(2026, 7, 30, 8)],
      });
      assert.equal(restDay.routineDays[0].kind, 'rest');
    },
  },

  {
    name: 'widgetPayload: no program at all asks for a program, on every day',
    run() {
      const payload = build({ sessions: [], planName: null });

      for (const day of payload.routineDays) {
        assert.equal(day.when, 'No plan yet');
        assert.equal(day.title, 'Pick a program');
        assert.equal(day.target, 'programs');
      }
    },
  },
  {
    name: 'widgetPayload: with no program it names the one the app recommends',
    run() {
      const payload = build({ sessions: [], planName: null, suggestion: { title: 'Strength · Base' } });

      // "Pick a program" asked a question the app could answer itself.
      assert.equal(payload.routineDays[0].when, 'Suggested for you');
      assert.equal(payload.routineDays[0].title, 'Strength · Base');
      // And the tap opens that programme, not the catalog it came from.
      assert.equal(payload.routineDays[0].target, 'suggestion');
      assert.equal(
        build({ sessions: [], planName: null, suggestion: { title: 'X' }, language: 'fi' }).routineDays[0].when,
        'Suositus sinulle',
      );
    },
  },
  {
    name: 'widgetPayload: no recommendation means it asks instead of inventing one',
    run() {
      // Onboarding may never have produced one, and a widget that names a
      // programme it was not given is worse than one that asks.
      for (const suggestion of [null, undefined, { title: '   ' }]) {
        const payload = build({ sessions: [], planName: null, suggestion });
        assert.equal(payload.routineDays[0].title, 'Pick a program', `suggestion ${JSON.stringify(suggestion)}`);
        assert.equal(payload.routineDays[0].when, 'No plan yet');
        assert.equal(payload.routineDays[0].target, 'programs');
      }
    },
  },
  {
    name: 'widgetPayload: a named plan with nothing in it keeps its name',
    run() {
      const payload = build({ sessions: [] });
      assert.equal(payload.routineDays[0].when, 'Strong Chest');
      assert.equal(payload.routineDays[0].title, 'Open the app to start a plan');
      assert.equal(payload.routineDays[0].target, 'programs');
    },
  },
  {
    name: 'widgetPayload: no picked days points at the editor',
    run() {
      const payload = build({ schedule: weekdaySchedule([]) });

      assert.equal(payload.routineDays[0].when, 'Strong Chest');
      assert.equal(payload.routineDays[0].title, 'Pick your training days');
      assert.equal(payload.routineDays[0].target, 'schedule');
      assert.equal(build({ schedule: weekdaySchedule([]), language: 'fi' }).routineDays[0].title, 'Valitse treenipäivät');
      // The month still renders, honestly empty of plans.
      assert.equal(payload.monthWeeks.flat().filter((day) => day.state === 'plan').length, 0);
    },
  },
  {
    name: 'widgetPayload: every prompt state still draws a full calendar',
    run() {
      // The calendar widgets have no words to fall back on, so the states that
      // change the routine line must not empty the month.
      for (const overrides of [
        { sessions: [], planName: null },
        { sessions: [] },
        { schedule: weekdaySchedule([]) },
      ]) {
        const payload = build({ ...overrides, completedDayStarts: [at(2026, 7, 14)] });
        assert.equal(payload.monthWeeks.length, 5);
        assert.equal(payload.monthLabel, 'July 2026');
        assert.equal(payload.monthWeeks.flat().filter((day) => day.state === 'done').length, 1);
      }
    },
  },
  {
    name: 'widgetPayload: the resolved theme travels with the payload',
    run() {
      // The launcher cannot read the app's preference, so the answer has to be
      // in the file. Whatever the app resolved — Pro gate included — is what
      // the widget paints.
      assert.equal(build({ theme: 'dark' }).theme, 'dark');
      assert.equal(build({ theme: 'light' }).theme, 'light');
    },
  },
  {
    name: 'widgetPayload: every field the widget draws is a finished string',
    run() {
      const payload = build({ totalWorkouts: 3, monthTotals: { workouts: 2, durationMinutes: 90, volumeKg: 400 } });

      assert.equal(payload.version, HOME_WIDGET_PAYLOAD_VERSION);
      assert.ok(!Number.isNaN(Date.parse(payload.updatedAt)), 'updatedAt is an ISO timestamp');
      for (const key of ['monthLabel', 'totalValue', 'totalLabel', 'theme']) {
        assert.equal(typeof payload[key], 'string', `${key} must be a string the native side can draw`);
      }
      for (const stat of payload.stats) {
        assert.equal(typeof stat.label, 'string');
        assert.equal(typeof stat.value, 'string');
      }
      for (const day of payload.routineDays) {
        assert.equal(typeof day.when, 'string');
        assert.equal(typeof day.title, 'string');
        assert.equal(typeof day.target, 'string');
      }
      for (const day of payload.monthWeeks.flat()) {
        assert.equal(typeof day.dateLabel, 'string');
        assert.equal(typeof day.dateKey, 'string');
        assert.equal(typeof day.inMonth, 'boolean');
      }
      // Serialisable as-is: this is what gets written to disk for Kotlin.
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(payload)));
    },
  },
  {
    name: 'widgetPayload: the named session is the one the app can reopen',
    run() {
      // The link says "the session you named" rather than carrying an id, so
      // the app has to resolve the same session the payload titled.
      const input = {
        nowMs: at(2026, 7, 30),
        schedule: weekdaySchedule([1, 2, 3]),
        sessions: SESSIONS,
      };
      const next = findHomeWidgetNextSession(input);

      assert.ok(next);
      assert.equal(next.offset, 0);
      assert.equal(next.weekdayIndex, THURSDAY);
      // The card no longer prints the name, so what it must agree on is that
      // today is a training day at all — and the arrow has a session to open.
      const sameDay = buildHomeWidgetPayload({ ...input, language: 'en', theme: 'light', planName: 'P' });
      assert.equal(sameDay.routineDays[0].kind, 'work');
      assert.equal(sameDay.routineDays[0].target, 'session');

      // Logged: the same call now names the following one instead — Thursday
      // the 30th to Tuesday the 4th.
      const after = findHomeWidgetNextSession({ ...input, completedWorkoutDayStarts: [at(2026, 7, 30, 7)] });
      assert.equal(after.offset, 5);
      assert.equal(after.weekdayIndex, 1);
    },
  },
  {
    name: 'widgetPayload: a workout from another programme does not skip the day this plan still owes',
    run() {
      // Mon/Wed/Fri, three sessions, Wednesday, session 2 (index 1) not yet
      // trained. A freestyle workout logged this morning puts today in the
      // all-programmes list, but the forecast says THIS plan is untrained
      // today. Skipping today made the widget (and its tap) name session 3 on
      // Friday while Home offers session 2 today and again on Friday.
      const three = [SESSIONS[0], SESSIONS[1], { ...SESSIONS[1], id: 's3' }];
      const wednesday = at(2026, 10, 7, 12);
      const todayStart = new Date(2026, 9, 7).getTime();
      const input = {
        nowMs: wednesday,
        schedule: weekdaySchedule([0, 2, 4]),
        sessions: three,
        completedWorkoutDayStarts: [todayStart],
        sessionForecast: { fromDayStart: todayStart, nextSlot: 1, trainedToday: false },
      };
      const owed = findHomeWidgetNextSession(input);
      assert.equal(owed.offset, 0);
      assert.equal(owed.session.id, 's2');

      // This plan WAS trained today: the forecast says so, today is skipped and
      // Friday gets the following slot.
      const done = findHomeWidgetNextSession({
        ...input,
        sessionForecast: { fromDayStart: todayStart, nextSlot: 2, trainedToday: true },
      });
      assert.equal(done.offset, 2);
      assert.equal(done.session.id, 's3');

      // Without a forecast the logged days decide, as before.
      const noForecast = findHomeWidgetNextSession({ ...input, sessionForecast: null });
      assert.equal(noForecast.offset, 2);
    },
  },
  {
    name: 'widgetPayload: nothing to name returns nothing rather than a guess',
    run() {
      assert.equal(findHomeWidgetNextSession({ nowMs: at(2026, 7, 30), schedule: weekdaySchedule([]), sessions: SESSIONS }), null);
      assert.equal(findHomeWidgetNextSession({ nowMs: at(2026, 7, 30), schedule: weekdaySchedule([1]), sessions: [] }), null);
    },
  },
  {
    name: 'widgetDeepLink: every target survives a round trip',
    run() {
      for (const target of ['session', 'calendar', 'home', 'programs', 'schedule']) {
        assert.equal(parseWidgetDeepLink(`${WIDGET_LINK_PREFIX}${target}`), target);
      }
    },
  },
  {
    name: 'widgetDeepLink: anything unrecognised is not a destination',
    run() {
      // An unknown slug means a newer widget is talking to an older app.
      // Guessing where it meant would be worse than leaving the reader where
      // they were.
      assert.equal(parseWidgetDeepLink('vinha://widget/tomorrow'), null);
      assert.equal(parseWidgetDeepLink('vinha://other/session'), null);
      assert.equal(parseWidgetDeepLink('https://vinha.app/widget/session'), null);
      assert.equal(parseWidgetDeepLink(''), null);
      assert.equal(parseWidgetDeepLink(null), null);
      assert.equal(parseWidgetDeepLink(undefined), null);
    },
  },
  {
    name: 'widgetDeepLink: a trailing slash or query does not break the tap',
    run() {
      assert.equal(parseWidgetDeepLink('vinha://widget/calendar/'), 'calendar');
      assert.equal(parseWidgetDeepLink('vinha://widget/calendar?from=widget'), 'calendar');
      assert.equal(parseWidgetDeepLink('VINHA://WIDGET/CALENDAR'), 'calendar');
      assert.equal(parseWidgetDeepLink('  vinha://widget/home  '), 'home');
    },
  },
  {
    /**
     * A running workout outranks the schedule.
     *
     * Reported from the device 2026-09-01: "minulla oli aktiivinen treeni ...
     * painoin widgetista se vie suoraan homeen eika jatkamaan treenia". The
     * tile resolved through findHomeWidgetNextSession alone, which answers
     * "the next SCHEDULED session" — and skips today once today's workout is
     * logged, so mid-session there could be nothing left for it to name and
     * the tap fell through to Home. The reader got back in through Home's own
     * continue button, which is the button this tile should have been.
     */
    name: 'widgetPayload: a running workout is what the session tile opens',
    run() {
      const base = {
        hasActivePlan: true,
        nowMs: at(2026, 7, 30),
        schedule: weekdaySchedule([1, 2, 3]),
        sessions: SESSIONS,
      };

      // Nothing running: unchanged, the next scheduled session.
      const scheduled = resolveHomeWidgetSessionTap({ ...base, hasActiveSession: false });
      assert.equal(scheduled.kind, 'open');
      assert.equal(scheduled.next.offset, 0);

      // Running: resume, and the schedule is not consulted at all.
      assert.deepEqual(
        resolveHomeWidgetSessionTap({ ...base, hasActiveSession: true }),
        { kind: 'resume' },
      );

      // The reported case exactly: a session is open AND today is already
      // marked done, so the scheduled lookup has nothing for today. Before the
      // fix this pair is what produced Home.
      const midSession = {
        ...base,
        hasActiveSession: true,
        completedWorkoutDayStarts: [at(2026, 7, 30, 7)],
      };
      assert.equal(
        findHomeWidgetNextSession(midSession).offset,
        5,
        'the scheduled lookup should still be pointing away from today',
      );
      assert.deepEqual(resolveHomeWidgetSessionTap(midSession), { kind: 'resume' });

      // And with no plan behind it, resume still wins — the session is open
      // whatever the plan says.
      assert.deepEqual(
        resolveHomeWidgetSessionTap({ ...base, hasActiveSession: true, hasActivePlan: false }),
        { kind: 'resume' },
      );

      // Nothing running and nothing to open is Home, not a guess.
      assert.deepEqual(
        resolveHomeWidgetSessionTap({ ...base, hasActiveSession: false, hasActivePlan: false }),
        { kind: 'home' },
      );
      assert.deepEqual(
        resolveHomeWidgetSessionTap({ ...base, hasActiveSession: false, sessions: [] }),
        { kind: 'home' },
      );
    },
  },
  {
    /**
     * Audit 2026-09-16 (N7): the tile opened the calendar's slot for today
     * while Home offered the rotation's next session — two different
     * workouts for the same day, one tap apart.
     */
    name: 'widgetPayload: today the tile opens the session Home is offering',
    run() {
      const base = {
        hasActiveSession: false,
        hasActivePlan: true,
        // Thursday: the calendar's third slot, s3.
        nowMs: at(2026, 7, 30),
        schedule: weekdaySchedule([1, 2, 3]),
        sessions: SESSIONS,
      };
      assert.equal(resolveHomeWidgetSessionTap(base).next.session.id, 's3', 'the calendar’s own answer');

      // Home's rotation says s1 is next: the tile opens s1, today.
      const home = resolveHomeWidgetSessionTap({ ...base, homeSessionId: 's1' });
      assert.equal(home.kind, 'open');
      assert.equal(home.next.session.id, 's1');
      assert.equal(home.next.offset, 0);

      // A later day keeps the calendar's answer: Home has none for it.
      const monday = resolveHomeWidgetSessionTap({ ...base, nowMs: at(2026, 7, 27), homeSessionId: 's1' });
      assert.equal(monday.next.offset, 1);
      assert.equal(monday.next.session.id, 's1', 'Tuesday is the calendar’s first slot');
      const mondayOther = resolveHomeWidgetSessionTap({ ...base, nowMs: at(2026, 7, 27), homeSessionId: 's2' });
      assert.equal(mondayOther.next.session.id, 's1', 'a rotation guess leaked onto another day');

      // Today done: the next training day, the calendar's.
      const done = resolveHomeWidgetSessionTap({
        ...base,
        homeSessionId: 's1',
        completedWorkoutDayStarts: [at(2026, 7, 30, 7)],
      });
      assert.equal(done.next.offset, 5);

      // A pick makes a rest day a training day, as the 2x1 reads it.
      const picked = resolveHomeWidgetSessionTap({
        ...base,
        nowMs: at(2026, 7, 27),
        homeSessionId: 's2',
        todayPicked: true,
      });
      assert.deepEqual([picked.next.session.id, picked.next.offset, picked.next.weekdayIndex], ['s2', 0, 0]);

      // A session the plan no longer has is no answer.
      assert.equal(resolveHomeWidgetSessionTap({ ...base, homeSessionId: 'gone' }).next.session.id, 's3');
      assert.equal(
        resolveHomeWidgetSessionTap({ ...base, homeSessionId: 'gone', todayPicked: true }).next.session.id,
        's3',
      );
    },
  },
  {
    /**
     * Audit 2026-09-16 (N5, N8): the app handed the widget Home's next
     * session as "today's pick", so every rest day read "Treeni"; and the
     * month totals were keyed on the data alone, so a month turned over under
     * last month's figures.
     */
    name: 'widgetPayload: the app hands the widget today’s pick only, and recounts when the day turns',
    run() {
      // The rule the wiring relies on: without a pick, a rest day is rest.
      const rest = build({ schedule: weekdaySchedule([0]) });
      assert.equal(rest.routineDays[0].kind, 'rest');

      const fs = require('node:fs');
      const path = require('node:path');
      const app = fs
        .readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The widget's feed and its taps left App.tsx for src/app hooks in the
      // phase-C split (2026-10-01), so those are read from the whole shell.
      // Next-session-as-today must not come back anywhere in the shell: App.tsx
      // or a src/app module (phase-B split, 2026-09-30).
      const { readAppWiring } = require('../helpers/appWiringSource.cjs');
      const shell = readAppWiring()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.match(shell, /todaySessionId: homeActivePlanCard\?\.todayPickSessionId \?\? null,/);
      assert.doesNotMatch(shell, /todaySessionId: homeActivePlanCard\?\.nextSession/);
      assert.match(shell, /todayPickSessionId: usablePick\?\.id \?\? null,/);
      assert.match(
        shell,
        // And the rotation forecast the tile was drawn with (review of the
        // forecast, 2026-09-28): without it a later day's tap opened the
        // calendar's session.
        /resolveHomeWidgetSessionTap\(\{[\s\S]*?homeSessionId: homeActivePlanCard\?\.nextSession\.id \?\? null,\s*todayPicked: Boolean\(homeActivePlanCard\?\.todayPickSessionId\),[\s\S]*?sessionForecast: homeActivePlanCard\?\.sessionForecast \?\? null,\s*\}\)/,
      );
      assert.match(
        shell,
        /const widgetMonthTotals = useMemo\(\s*\(\) => getMonthTrainingTotals\(database, new Date\(todayStartMs\)\),\s*\[database, todayStartMs\],\s*\);/,
      );
      assert.match(
        shell,
        /getRecentActivityStrip\(database, new Date\(todayStartMs\), 45\)[\s\S]{0,120}\[database, todayStartMs\],/,
      );
    },
  },
];
