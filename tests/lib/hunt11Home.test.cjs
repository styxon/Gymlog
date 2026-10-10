// Bug hunt 11, home cluster.
process.env.TZ = 'Europe/Helsinki';
const assert = require('node:assert/strict');
const DIST = '../../.test-dist';

const { programmeStartSessionId } = require(`${DIST}/lib/programSessionList.js`);
const { sessionIsOnPlanToday } = require(`${DIST}/lib/coachChat.js`);
const { buildHomeWidgetPayload } = require(`${DIST}/lib/widgetPayload.js`);
const { forecastFromPick, weekdaySchedule } = require(`${DIST}/lib/trainingSchedule.js`);
const { sessionForForecastDay } = require(`${DIST}/lib/homeCalendar.js`);

const mk = (id) => ({ id, title: id, duration: '~40 min', exercises: [{ name: 'x', setsLabel: '3 sets' }] });
const sessions = ['A', 'B', 'C'].map(mk);

module.exports = [
  {
    name: 'hunt 11 home #1: a leading programme starts the day Home offers, not its first day',
    run() {
      const days = [
        { id: 'a', exerciseCount: 3 },
        { id: 'b', exerciseCount: 3 },
        { id: 'c', exerciseCount: 3 },
      ];
      const card = { programId: 'P', nextSession: { id: 'b' } };
      assert.equal(programmeStartSessionId(days, 'P', card), 'b');
      assert.equal(programmeStartSessionId(days, 'P', null), 'a', 'no programme leading: the first day with lifts');
      assert.equal(programmeStartSessionId(days, 'Q', card), 'a', 'the card belongs to another programme');
      assert.equal(programmeStartSessionId(days, 'P', { programId: 'P', nextSession: { id: 'gone' } }), 'a', 'a day no longer in the programme');
      assert.equal(programmeStartSessionId([{ id: 'a', exerciseCount: 0 }, ...days.slice(1)], 'P', { programId: 'P', nextSession: { id: 'a' } }), 'b', 'an empty day is not offered');
      assert.equal(programmeStartSessionId([{ id: 'a', exerciseCount: 0 }], 'P', card), null);
    },
  },
  {
    name: 'hunt 11 home #1: App.tsx starts a custom programme through the helper with the programme id and the Home card',
    run() {
      const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
      const fn = app.slice(app.indexOf('function handleStartCustomProgram('));
      assert.match(fn.slice(0, 900), /programmeStartSessionId\(\n[^\n]*\n\s+workoutTemplateId,\n\s+homeActivePlanCard,\n/);
    },
  },
  {
    name: 'hunt 11 home #2: the coach does not call the next session today\'s once today is trained',
    run() {
      const base = { hasNextSession: true, pickStands: false, trainedToday: false, scheduledToday: true };
      assert.equal(sessionIsOnPlanToday(base), true);
      assert.equal(sessionIsOnPlanToday({ ...base, trainedToday: true }), false);
      assert.equal(sessionIsOnPlanToday({ ...base, scheduledToday: false }), false, 'a rest day');
      assert.equal(sessionIsOnPlanToday({ ...base, scheduledToday: false, pickStands: true }), true, 'a rest-day pick');
      assert.equal(sessionIsOnPlanToday({ ...base, trainedToday: true, pickStands: true }), true, 'picked after training');
      assert.equal(sessionIsOnPlanToday({ ...base, hasNextSession: false }), false);
      const hook = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/app/useCoachContext.ts'), 'utf8');
      assert.match(hook, /trainedToday: homeActivePlanCard\.sessionForecast\?\.trainedToday === true,/, 'the intro reads the forecast');
    },
  },
  {
    name: 'hunt 11 home #2: the opening line after training today says so, not that today is a rest day',
    run() {
      const { buildCoachOpeningLine, buildCoachOpeningOffer, buildCoachContextChips } = require(`${DIST}/lib/coachChat.js`);
      const input = { todaySessionTitle: null, nextSessionTitle: 'Lower', sessionsThisWeek: 1, weeklyRead: [], fatigue: null, hasProgramme: true };
      assert.equal(buildCoachOpeningLine({ ...input, trainedToday: true }, 'en'), 'You have trained today. Next on the plan: Lower.');
      assert.equal(buildCoachOpeningLine({ ...input, trainedToday: true }, 'fi'), 'Olet treenannut tänään. Seuraavana ohjelmassa: Lower.');
      assert.match(buildCoachOpeningLine(input, 'en'), /^Today is a rest day/, 'a real rest day keeps its line');
      assert.match(buildCoachOpeningLine(input, 'fi'), /^Tänään on lepopäivä/);
      // The chip and the offer follow the same state: no "today" chip, and the offer names the NEXT session.
      const trained = { ...input, trainedToday: true };
      assert.equal(buildCoachContextChips(trained, 'en').some((chip) => chip.key === 'today'), false);
      assert.match(buildCoachOpeningOffer(trained, 'en').question, /next session, Lower/);
      const hook = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/app/useCoachContext.ts'), 'utf8').replace(/\r\n/g, '\n');
      assert.match(hook, /trainedToday:\n\s+homeActivePlanCard\?\.sessionForecast\?\.trainedToday === true && !homeActivePlanCard\.todayPickSessionId,/);
      // A pick made after training is today's session again, and wins.
      const picked = { ...input, todaySessionTitle: 'Pull', trainedToday: false };
      assert.match(buildCoachOpeningLine(picked, 'en'), /^Pull is on the plan today/);
    },
  },
  {
    name: 'hunt 11 home #3: the 2x1 says work, not done, while a pick made after today\'s workout stands',
    run() {
      const now = new Date(2026, 9, 5, 12); // Monday
      const dayStart = new Date(2026, 9, 5).getTime();
      const schedule = weekdaySchedule([0, 2, 4]);
      const forecast = { fromDayStart: dayStart, nextSlot: 1, trainedToday: true };
      const payload = (todaySessionId) =>
        buildHomeWidgetPayload({
          nowMs: now.getTime(), language: 'en', theme: 'dark', planName: 'P', schedule, sessions,
          sessionForecast: forecastFromPick(forecast, todaySessionId ? 1 : null, 3),
          todaySessionId,
          completedDayStarts: [dayStart], completedWorkoutDayStarts: [dayStart],
        }).routineDays[0];
      assert.equal(payload(null).kind, 'done', 'trained, nothing picked');
      assert.equal(payload('B').kind, 'work', 'a pick stands');
    },
  },
  {
    name: 'hunt 11 home #4: a pick made on a rest day is not repeated on the next training day',
    run() {
      const schedule = weekdaySchedule([0, 2, 4]); // Mon/Wed/Fri
      const today = new Date(2026, 9, 6).getTime(); // Tuesday, rest
      const strip = (forecast) =>
        Array.from({ length: 7 }, (_, i) => {
          const s = sessionForForecastDay(sessions, schedule, new Date(2026, 9, 6 + i), forecast);
          return s ? s.id : '-';
        }).join(' ');
      // A trained Monday: the rotation points at B.
      const base = { fromDayStart: today, nextSlot: 1, trainedToday: false };
      assert.equal(strip(base), '- B - C - - A');
      // C picked on Tuesday: Wednesday continues from it.
      assert.equal(strip(forecastFromPick(base, 2, 3)), '- A - B - - C');
      // And the same once C is trained that day.
      assert.equal(strip(forecastFromPick({ ...base, nextSlot: 0, trainedToday: true }, 2, 3)), 'C A - B - - C');
      // A pick on a training day still takes that day's own turn.
      const monday = new Date(2026, 9, 5).getTime();
      const onTrainingDay = forecastFromPick({ fromDayStart: monday, nextSlot: 1, trainedToday: false }, 2, 3);
      assert.equal(sessionForForecastDay(sessions, schedule, new Date(2026, 9, 7), onTrainingDay).id, 'A', 'Monday C, Wednesday A');
    },
  },
];
