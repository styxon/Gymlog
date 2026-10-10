const assert = require('node:assert/strict');

const DIST = '../../.test-dist';

const { getHomeDayView, getHomeCarouselCalendarDays, sessionForForecastDay } = require(`${DIST}/lib/homeCalendar.js`);
const { forecastFromPick, weekdaySchedule, trainsOn } = require(`${DIST}/lib/trainingSchedule.js`);
const { offerablePick, resolveTodaySessionPick, movePickToCopy } = require(`${DIST}/lib/todaySessionPick.js`);
const { alignHistoryToCopiedDays } = require(`${DIST}/lib/programLineage.js`);
const { resolveNextPlanEntryIndex } = require(`${DIST}/lib/planRotation.js`);
const { buildHomeWidgetPayload, findHomeWidgetNextSession } = require(`${DIST}/lib/widgetPayload.js`);

/**
 * Bug hunt 10 (2026-10-09), the Home "today" cluster: the pick of the day, the
 * week strip and the widget. The wiring half is in tests/screens/hunt10HomeToday.
 */

const mk = (id, exercises = 3) => ({
  id,
  title: id,
  duration: '~40 min',
  exercises: Array.from({ length: exercises }, () => ({ name: 'x', setsLabel: '3 sets' })),
});
const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

module.exports = [
  {
    // #4. The pick is moved onto the copy's day ids by the first edit of a
    // ready programme; the history it is answered against has to be read under
    // the same ids.
    name: 'hunt 10 #4: a pick already answered by a trained session stays answered once it is carried onto the programme\'s copy',
    run() {
      const today = new Date(2026, 9, 9).getTime();
      const toDayStart = (iso) => midnight(new Date(iso));
      const pick = { dayStart: today, sessionId: 'low_a', pickedAt: new Date(2026, 9, 9, 8).getTime(), workoutTemplateId: 'R' };
      const completed = [
        { workoutTemplateId: 'R', workoutTemplateSessionId: 'low_a', performedAt: new Date(2026, 9, 9, 9).toISOString() },
      ];
      const moved = movePickToCopy(pick, 'R', 'C', { up_a: 'c_up', low_a: 'c_low' });
      const sessions = [{ id: 'c_up' }, { id: 'c_low' }];
      const templateIds = new Set(['C', 'R']);
      const aligned = alignHistoryToCopiedDays(completed, {
        fromTemplateIds: ['R', 'C'],
        fromSessionIds: ['up_a', 'low_a'],
        toTemplateId: 'C',
        toSessionIds: ['c_up', 'c_low'],
      });
      assert.equal(
        resolveTodaySessionPick({ pick: moved, sessions, todayDayStart: today, completed: aligned, toDayStart, templateIds }),
        null,
        'answered against the history in the copy\'s ids',
      );
      // The contrast that makes the wiring matter: the catalogue-id history
      // cannot answer a pick that now carries the copy's ids.
      assert.equal(
        resolveTodaySessionPick({ pick: moved, sessions, todayDayStart: today, completed, toDayStart, templateIds })?.id,
        'c_low',
      );
    },
  },
  {
    // #28.
    name: 'hunt 10 #28: a pick of a day with nothing in it is not an offerable pick, a filled one is',
    run() {
      assert.equal(offerablePick(null), null);
      assert.equal(offerablePick(mk('B', 0)), null);
      const filled = mk('A', 2);
      assert.equal(offerablePick(filled), filled);
    },
  },
  {
    name: 'hunt 10 #28: with the empty pick passed over, the widget reads a rest day as rest',
    run() {
      const sessions = [mk('A'), mk('B', 0), mk('C')];
      const now = new Date(2026, 9, 6, 10); // Tuesday, a rest day for Mon/Wed/Fri
      const start = midnight(now);
      const schedule = weekdaySchedule([0, 2, 4]);
      const forecast = { fromDayStart: start, nextSlot: 0, trainedToday: false };
      const widgetToday = (picked) =>
        buildHomeWidgetPayload({
          nowMs: now.getTime(),
          language: 'en',
          theme: 'dark',
          planName: 'P',
          schedule,
          sessions,
          todaySessionId: picked ? picked.id : null,
          sessionForecast: forecast,
        }).routineDays[0];
      assert.equal(widgetToday(offerablePick(sessions[1])).kind, 'rest');
      assert.equal(widgetToday(offerablePick(sessions[0])).kind, 'work', 'a filled pick still makes a rest day a training day');
    },
  },
  {
    // #29.
    name: 'hunt 10 #29: an empty day takes no turn of the forecast, so the week strip walks the days the hero will',
    run() {
      const sessions = [mk('A'), mk('B', 0), mk('C'), mk('D')];
      const now = new Date(2026, 9, 5, 10); // Monday
      const schedule = weekdaySchedule([0, 1, 2, 3, 4]);
      const days = getHomeCarouselCalendarDays(now, { daysBefore: 0, daysAfter: 4 });
      const strip = (forecast) => days.map((day) => getHomeDayView(day, schedule, sessions, forecast).session?.id).join(' ');
      // A was trained before today: the raw slot is the empty B.
      assert.equal(strip({ fromDayStart: midnight(now), nextSlot: 1, trainedToday: false }), 'C D A C D');
      // A not yet trained: the empty day is only in the way of a later turn.
      assert.equal(strip({ fromDayStart: midnight(now), nextSlot: 0, trainedToday: false }), 'A C D A C');
      // A trained today (next raw slot is B): today keeps A, the rest walk on.
      assert.equal(strip({ fromDayStart: midnight(now), nextSlot: 1, trainedToday: true }), 'A C D A C');
      // The widget's routine and its next-session lookup read the same walk.
      const payload = buildHomeWidgetPayload({
        nowMs: now.getTime(),
        language: 'en',
        theme: 'dark',
        planName: 'P',
        schedule,
        sessions,
        sessionForecast: { fromDayStart: midnight(now), nextSlot: 1, trainedToday: false },
      });
      assert.equal(payload.routineDays.slice(0, 5).every((day) => day.kind === 'work'), true);
      const widgetNext = findHomeWidgetNextSession({
        nowMs: now.getTime(),
        schedule,
        sessions,
        sessionForecast: { fromDayStart: midnight(now), nextSlot: 1, trainedToday: false },
      });
      assert.equal(widgetNext.session.id, 'C');
    },
  },
  {
    name: 'hunt 10 #29: without a forecast, or for a day before today, the calendar count stands and an all-empty list names nothing',
    run() {
      const sessions = [mk('A'), mk('B', 0), mk('C')];
      const schedule = weekdaySchedule([0, 2, 4]);
      const monday = new Date(2026, 9, 5);
      const wednesday = new Date(2026, 9, 7);
      // No forecast: what the calendar always said (Mon slot 0, Wed slot 1 = the empty B, handed to C).
      assert.equal(sessionForForecastDay(sessions, schedule, monday, null).id, 'A');
      assert.equal(sessionForForecastDay(sessions, schedule, wednesday, null).id, 'C');
      // A day before the forecast's today keeps the calendar count too.
      const forecast = { fromDayStart: midnight(wednesday), nextSlot: 2, trainedToday: false };
      assert.equal(sessionForForecastDay(sessions, schedule, monday, forecast).id, 'A');
      assert.equal(sessionForForecastDay([mk('A', 0)], schedule, wednesday, { ...forecast, nextSlot: 0 }), null);
      // A rest day is none.
      assert.equal(sessionForForecastDay(sessions, schedule, new Date(2026, 9, 6), forecast), null);
    },
  },
  {
    // #30.
    name: 'hunt 10 #30: the 2x1 says Done for today only when this plan\'s session was trained, as its own tap decides',
    run() {
      const now = new Date(2026, 9, 9, 14); // Friday
      const todayStart = midnight(now);
      const sessions = [mk('A'), mk('B'), mk('C')];
      const input = {
        nowMs: now.getTime(),
        language: 'en',
        theme: 'dark',
        planName: 'Lead',
        schedule: weekdaySchedule([0, 2, 4]),
        sessions,
        // A freestyle workout today, the lead plan untouched.
        completedDayStarts: [todayStart],
        completedWorkoutDayStarts: [todayStart],
        sessionForecast: { fromDayStart: todayStart, nextSlot: 1, trainedToday: false },
        todaySessionId: null,
      };
      const today = buildHomeWidgetPayload(input).routineDays[0];
      assert.equal(today.kind, 'work');
      assert.equal(today.target, 'session');
      assert.equal(findHomeWidgetNextSession(input).offset, 0, 'the tap and the card agree');

      const trained = buildHomeWidgetPayload({
        ...input,
        sessionForecast: { ...input.sessionForecast, trainedToday: true },
      }).routineDays[0];
      assert.equal(trained.kind, 'done');
      // No forecast: the logged days are all there is to ask, as before.
      assert.equal(buildHomeWidgetPayload({ ...input, sessionForecast: null }).routineDays[0].kind, 'done');
    },
  },
  {
    // #31.
    name: 'hunt 10 #31: the days after a hand-picked session are forecast from the pick, the same before and after training it',
    run() {
      const sessions = ['Upper', 'Lower', 'Pull', 'Push'].map((id) => mk(id, 1));
      const entries = sessions.map((session, index) => ({
        workoutTemplateId: 'T',
        workoutTemplateSessionId: session.id,
        orderIndex: index,
      }));
      const now = new Date(2026, 9, 5, 10); // Monday
      const start = midnight(now);
      const schedule = weekdaySchedule([0, 2, 4]);
      const days = getHomeCarouselCalendarDays(now, { daysBefore: 0, daysAfter: 4 });
      const later = (forecast) =>
        days
          .filter((day) => trainsOn(schedule, new Date(day.dayStart)))
          .slice(1)
          .map((day) => getHomeDayView(day, schedule, sessions, forecast).session.id)
          .join(' ');

      // Nothing trained: the rotation says Upper, the reader picks Pull.
      const rotation = { fromDayStart: start, nextSlot: 0, trainedToday: false };
      assert.equal(later(rotation), 'Lower Pull', 'the rotation\'s own guess, which the pick makes wrong');
      const withPick = forecastFromPick(rotation, 2, sessions.length);
      assert.equal(later(withPick), 'Push Upper');

      // Pull trained today: the rotation itself moves on from it.
      const completed = [
        { workoutTemplateId: 'T', workoutTemplateSessionId: 'Pull', performedAt: new Date(2026, 9, 5, 18).toISOString() },
      ];
      const after = { fromDayStart: start, nextSlot: resolveNextPlanEntryIndex(entries, completed), trainedToday: true };
      assert.equal(later(after), later(withPick), 'training the pick changes nothing about the days after it');
      // And the pick held after another session was trained today: the same.
      assert.equal(later(forecastFromPick(after, 2, sessions.length)), later(after));
    },
  },
  {
    name: 'hunt 10 #31: no pick, or a pick naming no day of the list, leaves the forecast as it was',
    run() {
      const forecast = { fromDayStart: 1, nextSlot: 1, trainedToday: false };
      assert.equal(forecastFromPick(forecast, null, 4), forecast);
      assert.equal(forecastFromPick(forecast, -1, 4), forecast);
      assert.equal(forecastFromPick(forecast, 4, 4), forecast);
      // The last day picked and trained: the next slot wraps to the first.
      assert.equal(forecastFromPick({ ...forecast, trainedToday: true }, 3, 4).nextSlot, 0);
    },
  },
  {
    // #32.
    name: 'hunt 10 #32: the widget names a programme with days and nothing in them rather than suggesting another',
    run() {
      const base = {
        nowMs: new Date(2026, 9, 9, 10).getTime(),
        language: 'en',
        theme: 'dark',
        schedule: weekdaySchedule([0, 2, 4]),
        sessions: [],
        suggestion: { title: 'Starter Strength' },
      };
      const named = buildHomeWidgetPayload({ ...base, planName: 'My programme' });
      assert.equal(named.routineDays[0].when, 'My programme');
      assert.equal(named.routineDays[0].target, 'programs');
      const unnamed = buildHomeWidgetPayload({ ...base, planName: null });
      assert.equal(unnamed.routineDays[0].target, 'suggestion');
    },
  },
];
