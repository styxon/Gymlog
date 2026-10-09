const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

/**
 * Bug hunt 10 (2026-10-09): the wiring half of the Home "today" cluster and the
 * widget's calendar tap. The pure halves are in tests/lib/hunt10HomeToday.
 */
module.exports = [
  {
    name: 'hunt 10 #4: the pick is answered against the history in the programme\'s own day ids, the list the rotation reads',
    run() {
      const hook = read('src/app/useHomeActivePlan.ts');
      const call = hook.slice(hook.indexOf('resolveTodaySessionPick({'));
      assert.match(call.slice(0, 700), /completed: completedForTemplate,/);
      assert.doesNotMatch(call.slice(0, 700), /completed: completedPlanSessions/, 'the raw list carries the catalogue\'s ids');
      assert.ok(
        hook.indexOf('const completedForTemplate = completedSessionsForTemplate(') < hook.indexOf('resolveTodaySessionPick({'),
        'built before the pick reads it',
      );
    },
  },
  {
    name: 'hunt 10 #28: the card carries the pick the hero offers, not one it passed over',
    run() {
      const hook = read('src/app/useHomeActivePlan.ts');
      assert.match(hook, /const usablePick = offerablePick\(pickedToday\);/);
      assert.match(hook, /const nextSession =\n\s+usablePick \?\?/, 'the hero offers the usable pick');
      assert.match(hook, /todayPickSessionId: usablePick\?\.id \?\? null,/, 'and so does the field every other reader trusts');
      assert.doesNotMatch(hook, /pickedToday\?\.id/, 'nothing publishes the raw pick');
    },
  },
  {
    name: 'hunt 10 #31: the forecast is built after the pick and continues from it',
    run() {
      const hook = read('src/app/useHomeActivePlan.ts');
      const forecast = hook.indexOf('const sessionForecast = forecastFromPick(');
      assert.ok(forecast > hook.indexOf('const usablePick = offerablePick(pickedToday);'), 'the pick is known first');
      assert.match(hook.slice(forecast, forecast + 500), /usablePick \? homeSessions\.indexOf\(usablePick\) : null,\n\s+homeSessions\.length,/);
    },
  },
  {
    name: 'hunt 10 #29: the week strip and the day view name a date through the one forecast walk that skips empty days',
    run() {
      const home = read('src/screens/HomeScreen.tsx');
      assert.match(home, /picked \?\? sessionForForecastDay\(planSessions, trainingSchedule, date, activePlan\?\.sessionForecast \?\? null\)/);
      assert.doesNotMatch(home, /forecastSlotOn\(/, 'no screen counts raw slots for itself');
      const calendar = read('src/lib/homeCalendar.ts');
      assert.match(calendar, /const session = sessionForForecastDay\(sessions, schedule, new Date\(day\.dayStart\), forecast\);/);
    },
  },
  {
    name: 'hunt 10 #30: the 2x1 asks the forecast whether today is done, as the widget\'s tap does',
    run() {
      const payload = read('src/lib/widgetPayload.ts');
      assert.match(
        payload,
        /offset === 0 && input\.sessionForecast\s*\?\s*input\.sessionForecast\.trainedToday\s*:\s*workoutDoneDays\.has\(toDayStartMs\(date\)\)/,
      );
    },
  },
  {
    name: 'hunt 10 #32: the widget feed is given the empty programme and names it when there is no card',
    run() {
      const feed = read('src/app/useHomeWidgetFeed.ts');
      const app = read('App.tsx');
      assert.match(feed, /planName: homeActivePlanCard\?\.title \?\? homeEmptyProgramme\?\.title \?\? null,/);
      const deps = feed.slice(feed.lastIndexOf('}, ['), feed.lastIndexOf(']);'));
      assert.match(deps, /homeEmptyProgramme,/, 'a programme emptied or filled redraws the widget');
      const call = app.slice(app.indexOf('useHomeWidgetFeed({'));
      assert.match(call.slice(0, 400), /homeEmptyProgramme,/);
    },
  },
  {
    name: 'hunt 10 #38: the widget\'s calendar tap is stamped, the Progress scroll hears the stamp and waits for a fresh layout from another section',
    run() {
      const taps = read('src/app/useWidgetTaps.ts');
      assert.match(taps, /scrollTo: 'activity',\n\s+openedAt: Date\.now\(\),/);
      const progress = read('src/screens/ProgressScreen.tsx');
      const effect = progress.slice(progress.indexOf("if (scrollToTarget === 'activity') {"));
      const body = effect.slice(0, effect.indexOf('[scrollToTarget'));
      assert.match(body, /if \(progressSection !== 'overview'\) \{\n\s+activityBlockY\.current = null;/);
      assert.match(effect.slice(0, 900), /\}, \[scrollToTarget, routeOpenedAt\]\);/);
    },
  },
];
