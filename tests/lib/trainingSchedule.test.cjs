const assert = require('node:assert/strict');

const {
  cycleSchedule,
  cycleSessionsPerWeek,
  forecastSlotOn,
  isScheduleKnown,
  patternFromOnOff,
  sessionSlotOn,
  trainsOn,
  UNKNOWN_SCHEDULE,
  weekdaySchedule,
  withRestDays,
} = require('../../.test-dist/lib/trainingSchedule.js');
const { planWeekdayIndexes } = require('../../.test-dist/lib/programTrainingDays.js');
const { planLabelsForProgramme } = require('../../.test-dist/lib/trainingWeekSync.js');

/** Local wall-clock, the way the schedule reads dates. */
function on(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

const SESSIONS = ['A', 'B', 'C'];

/** What the app would show for a run of days, as a readable string. */
function walk(schedule, from, days) {
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const slot = sessionSlotOn(schedule, date);
    return slot === null ? '-' : SESSIONS[((slot % 3) + 3) % 3];
  }).join('');
}

module.exports = [
  {
    name: 'trainingSchedule: a weekday list still means what it always meant',
    run() {
      // Tue, Wed, Thu — the shape every existing plan is written in.
      const schedule = weekdaySchedule([1, 2, 3]);

      // Monday 2026-07-27 through the following Sunday.
      assert.equal(walk(schedule, on(2026, 7, 27), 14), '-ABC----ABC---');
      assert.equal(isScheduleKnown(schedule), true);
    },
  },
  {
    name: 'trainingSchedule: two days on and one off, the rhythm a week cannot hold',
    run() {
      // Reported 2026-08-21: "2pv treeni 1 lepo" repeated. The point of the
      // whole file — no set of weekdays produces this, because Wednesday is a
      // training day this week and a rest day the next.
      const schedule = cycleSchedule(patternFromOnOff(2, 1), on(2026, 8, 19));

      assert.equal(walk(schedule, on(2026, 8, 19), 12), 'AB-CA-BC-AB-');

      // Wednesday the 19th trains and Wednesday 2 September does not — the
      // weekday walks one slot forward a week, so it takes three weeks to come
      // back to where it started. That is the whole reason weekdays cannot
      // hold this rhythm.
      assert.equal(trainsOn(schedule, on(2026, 8, 19)), true);
      assert.equal(trainsOn(schedule, on(2026, 8, 26)), true);
      assert.equal(trainsOn(schedule, on(2026, 9, 2)), false);
      assert.equal(trainsOn(schedule, on(2026, 9, 9)), true);
    },
  },
  {
    name: 'trainingSchedule: the programme walks its sessions in order across the cycle',
    run() {
      // Three sessions on a three-day cycle would repeat A on every training
      // day if the slot were the position inside the cycle rather than a count
      // of training days. It is a count, so the programme actually rotates.
      const schedule = cycleSchedule(patternFromOnOff(2, 1), on(2026, 8, 19));

      assert.equal(sessionSlotOn(schedule, on(2026, 8, 19)), 0);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 20)), 1);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 21)), null);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 22)), 2);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 23)), 3);
    },
  },
  {
    name: 'trainingSchedule: the days before the anchor belong to the cycle too',
    run() {
      // The reader sets the rhythm today, and the calendar they are looking at
      // already shows the rest of the month behind them. Those days walk
      // backwards through the same pattern rather than falling off it.
      const schedule = cycleSchedule(patternFromOnOff(2, 1), on(2026, 8, 19));

      assert.equal(trainsOn(schedule, on(2026, 8, 18)), false);
      assert.equal(trainsOn(schedule, on(2026, 8, 17)), true);
      assert.equal(trainsOn(schedule, on(2026, 8, 16)), true);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 17)), -1);
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 16)), -2);
      // And the walk stays continuous across the anchor, with no repeat or gap.
      assert.equal(walk(schedule, on(2026, 8, 16), 6), 'BC-AB-');
    },
  },
  {
    name: 'trainingSchedule: a cycle survives the clock change',
    run() {
      // 2026-10-25 is a 25-hour day in most of Europe. Stepped by milliseconds
      // this lands on 0.96 of a day and truncates, and every date after the
      // change reads the day before it — the class of bug that drew Sunday
      // twice in the home calendar.
      const schedule = cycleSchedule(patternFromOnOff(2, 1), on(2026, 10, 20));

      assert.equal(walk(schedule, on(2026, 10, 20), 12), 'AB-CA-BC-AB-');
      assert.equal(walk(schedule, on(2026, 10, 24), 6), 'A-BC-A');
    },
  },
  {
    name: 'trainingSchedule: a rhythm with no training day in it is no rhythm',
    run() {
      // An all-rest pattern would stop the app dead: every day free, forever.
      assert.equal(isScheduleKnown(cycleSchedule([false, false], on(2026, 8, 19))), false);
      assert.equal(isScheduleKnown(UNKNOWN_SCHEDULE), false);
      assert.equal(isScheduleKnown(weekdaySchedule([])), false);
      assert.equal(trainsOn(UNKNOWN_SCHEDULE, on(2026, 8, 19)), false);
      assert.equal(sessionSlotOn(weekdaySchedule([]), on(2026, 8, 19)), null);
    },
  },
  {
    name: 'trainingSchedule: on/off counts become a pattern, and stay sane at the edges',
    run() {
      assert.deepEqual(patternFromOnOff(2, 1), [true, true, false]);
      assert.deepEqual(patternFromOnOff(3, 1), [true, true, true, false]);
      // No rest day is a legitimate answer — every day trains.
      assert.deepEqual(patternFromOnOff(1, 0), [true]);
      // Zero training days is not, and would otherwise produce a dead app.
      assert.deepEqual(patternFromOnOff(0, 2), [true, false, false]);
    },
  },
  {
    name: 'trainingSchedule: the schedule is copied, not captured',
    run() {
      // The pattern comes from React state on the way in and goes into
      // AsyncStorage on the way out; a shared array would let one mutate the
      // other behind the reader's back.
      const pattern = [true, true, false];
      const schedule = cycleSchedule(pattern, on(2026, 8, 19));
      pattern[2] = true;

      assert.equal(trainsOn(schedule, on(2026, 8, 21)), false);

      const weekdays = [1, 3];
      const weekly = weekdaySchedule(weekdays);
      weekdays.push(5);
      assert.equal(trainsOn(weekly, on(2026, 8, 22)), false);
    },
  },
  {
    name: "the day the plan opens on is the day it calls session one",
    run() {
      // The whole chain, because the break was between its links rather
      // than inside one: adoption rotates the plan labels so session one
      // takes the first day that has not gone (trainingWeekSync), the
      // schedule is built from those labels (planWeekdayIndexes) and the
      // calendar asks the schedule which session a date owns.
      // Availability wed/fri/sun, adopted on Sunday 30 Aug 2026.
      const labels = planLabelsForProgramme(3, ["wed", "fri", "sun"], on(2026, 8, 30));
      assert.deepEqual(labels, ["sun", "wed", "fri"]);

      const schedule = weekdaySchedule(planWeekdayIndexes(labels.map((label) => ({ label }))));

      // Today is session ONE. Sorting the indexes Monday-first made this 2,
      // so Home offered session one in the hero and stamped WED on its row.
      assert.equal(sessionSlotOn(schedule, on(2026, 8, 30)), 0, "Sunday opens the programme");
      assert.equal(sessionSlotOn(schedule, on(2026, 9, 2)), 1, "Wednesday is session two");
      assert.equal(sessionSlotOn(schedule, on(2026, 9, 4)), 2, "Friday is session three");
      // (The row badges that read `upcomingSessionDayStarts` went with the
      // day cards; every calendar asks `sessionSlotOn`, checked above.)
    },
  },
  {
    name: 'a cycle states its own weekly frequency, fraction and all',
    run() {
      // The number the rhythm dial prints under itself. Two on, one off is the
      // preset the questionnaire offered as a chip, and nothing on the screen
      // ever said what it came to.
      assert.equal(cycleSessionsPerWeek(2, 1), 14 / 3);
      assert.ok(Math.abs(cycleSessionsPerWeek(2, 1) - 4.6667) < 0.001);

      // The two rhythms that land on whole weeks land on whole numbers.
      assert.equal(cycleSessionsPerWeek(1, 1), 3.5);
      assert.equal(cycleSessionsPerWeek(6, 1), 6);
      assert.equal(cycleSessionsPerWeek(1, 6), 1);

      // No rest at all is training every day, and that is seven, not Infinity.
      assert.equal(cycleSessionsPerWeek(1, 0), 7);
      assert.equal(cycleSessionsPerWeek(3, 0), 7);

      // Nonsense is clamped rather than propagated: a zero or negative count
      // of training days would divide the reader's week by nothing.
      assert.equal(cycleSessionsPerWeek(0, 1), 3.5);
      assert.equal(cycleSessionsPerWeek(-2, 1), 3.5);
      assert.equal(cycleSessionsPerWeek(2, -1), 7);

      // Fractional input is a dial that slipped, not a new kind of rhythm.
      assert.equal(cycleSessionsPerWeek(2.4, 1), 14 / 3);

      // It agrees with the pattern the same numbers build: the pattern's true
      // entries over its length is the same ratio.
      const pattern = patternFromOnOff(3, 2);
      const ratio = (pattern.filter(Boolean).length / pattern.length) * 7;
      assert.equal(cycleSessionsPerWeek(3, 2), ratio);
    },
  },
{
    // Break round, 2026-09-28: a rest day on a training day of a 2-on-1-off
    // rhythm, and every later label was one session off what Start offered.
    name: 'forecast: after a rest day on a training day, the next training day is the session Home offers',
    run() {
      const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      // Jan 1 anchor: 1 Push, 2 Pull, 3 rest, 4 Legs, 5 Push ... by the calendar.
      const rhythm = cycleSchedule([true, true, false], midnight(on(2026, 1, 1)));
      const withRest = withRestDays(rhythm, [midnight(on(2026, 1, 2))]);
      // Push trained on the 1st; today is the 2nd, taken off. Home offers Pull.
      const forecast = { fromDayStart: midnight(on(2026, 1, 2)), nextSlot: 1, trainedToday: false };
      assert.equal(forecastSlotOn(withRest, on(2026, 1, 2), forecast), null, 'the rest day trains');
      assert.equal(forecastSlotOn(withRest, on(2026, 1, 3), forecast), null, 'the rhythm\'s own rest day trains');
      assert.equal(forecastSlotOn(withRest, on(2026, 1, 4), forecast), 1, 'Pull is not the next training day\'s session');
      assert.equal(forecastSlotOn(withRest, on(2026, 1, 5), forecast), 2);
      // The calendar count, for contrast: it says Legs on the 4th.
      assert.equal(sessionSlotOn(withRest, on(2026, 1, 4)), 2);
    },
  },
  {
    name: 'forecast: a missed weekday moves the names along, today trained names today by what was done, and past days keep the calendar',
    run() {
      const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const monWedFri = weekdaySchedule([0, 2, 4]);
      // Wednesday 7 Jan 2026. Monday was missed, so Home still offers slot 0.
      const today = on(2026, 1, 7);
      const forecast = { fromDayStart: midnight(today), nextSlot: 0, trainedToday: false };
      assert.equal(forecastSlotOn(monWedFri, today, forecast), 0);
      assert.equal(forecastSlotOn(monWedFri, on(2026, 1, 9), forecast), 1);
      assert.equal(forecastSlotOn(monWedFri, on(2026, 1, 12), forecast), 2);
      // Monday, before today: what the calendar always said.
      assert.equal(forecastSlotOn(monWedFri, on(2026, 1, 5), forecast), sessionSlotOn(monWedFri, on(2026, 1, 5)));

      // Trained today: the rotation already points past it.
      const done = { fromDayStart: midnight(today), nextSlot: 1, trainedToday: true };
      assert.equal(forecastSlotOn(monWedFri, today, done), 0, 'today is named by what was just done');
      assert.equal(forecastSlotOn(monWedFri, on(2026, 1, 9), done), 1);

      // No forecast: the calendar count, as the rhythm editor's preview wants.
      assert.equal(forecastSlotOn(monWedFri, on(2026, 1, 9), null), sessionSlotOn(monWedFri, on(2026, 1, 9)));
    },
  },
  {
    name: 'forecast: counted by calendar day across the spring clock change',
    run() {
      const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
      withHelsinkiClocks(() => {
        const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const everyDay = cycleSchedule([true], midnight(on(2026, 3, 1)));
        const forecast = { fromDayStart: midnight(on(2026, 3, 28)), nextSlot: 0, trainedToday: false };
        // 28, 29 (23 hours), 30, 31: four training days, slots 0..3.
        assert.equal(forecastSlotOn(everyDay, on(2026, 3, 29), forecast), 1);
        assert.equal(forecastSlotOn(everyDay, on(2026, 3, 31), forecast), 3);
      });
    },
  },
  {
    // Bug hunt 9, 2026-10-09: the programme page's preset chips and the
    // training-plan screen's rhythm preview anchored on today whatever was
    // stored, while the rule above says an unchanged pattern keeps its anchor.
    name: 'cycle anchor: the preset chips and the plan screen preview follow the same rule',
    run() {
      const read = (file) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', file), 'utf8');
      const detail = read('src/screens/ProgramDetailScreen.tsx');
      const apply = detail.slice(detail.indexOf('const applyPreset'), detail.indexOf('const cycleWeek'));
      assert.ok(apply.length > 0);
      assert.match(apply, /resolveCycleAnchor\(preset\.pattern, trainingCycle, new Date\(\)\)/);
      assert.doesNotMatch(apply, /anchorDayStart:/, 'a chip must not write today as the anchor itself');

      const plan = read('src/screens/TrainingPlanScreen.tsx');
      assert.match(plan, /resolveCycleAnchor\(cyclePattern, trainingCycle, new Date\(\)\)\?\.anchorDayStart/);
      assert.doesNotMatch(plan, /editingSchedule \|\| !trainingCycle \? todayStart\(\)/);
    },
  },
  {
    // Bug hunt, 2026-10-04: the setup preview anchored a re-run's unchanged
    // cycle on today while the save kept the old anchor.
    name: 'cycle anchor: an unchanged pattern keeps its anchor, a changed one starts today',
    run() {
      const { resolveCycleAnchor } = require('../../.test-dist/lib/trainingSchedule.js');
      const now = new Date(2026, 9, 4, 15, 30);
      const todayStart = new Date(2026, 9, 4).getTime();
      const old = { pattern: [true, true, false], anchorDayStart: new Date(2026, 8, 1).getTime() };
      assert.equal(resolveCycleAnchor([true, true, false], old, now), old);
      assert.deepEqual(resolveCycleAnchor([true, false], old, now), { pattern: [true, false], anchorDayStart: todayStart });
      assert.deepEqual(resolveCycleAnchor([true, true, false], null, now), { pattern: [true, true, false], anchorDayStart: todayStart });
      assert.equal(resolveCycleAnchor(null, old, now), null);
      assert.equal(resolveCycleAnchor([], old, now), null);

      // The preview and the save must both go through it.
      const read = (file) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', file), 'utf8');
      assert.match(read('src/app/onboardingHandoff.ts'), /resolveCycleAnchor\(selection\.trainingCyclePattern, previousCycle/);
      assert.match(read('src/screens/OnboardingScreen.tsx'), /resolveCycleAnchor\(cyclePattern, existingTrainingCycle/);
      // Both against the lead programme's rhythm, the one the questions replace.
      assert.match(read('src/app/renderOnboarding.tsx'), /existingTrainingCycle=\{leadTrainingCycle\}/);
      assert.match(read('App.tsx'), /const leadTrainingCycle = leadPlanTrainingCycle\(database\.workoutPlans, preferences\.activePlanId\);/);
      assert.match(read('App.tsx'), /renderSetupEditor\(\{\s*leadTrainingCycle,/);

      // And the saved plan, end to end.
      const { buildSavedOnboardingWorkoutPlan } = require('../../.test-dist/app/onboardingHandoff.js');
      const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
      const kept = buildSavedOnboardingWorkoutPlan(
        { ...DEFAULT_FIRST_RUN_SELECTION, trainingCyclePattern: [true, true, false] },
        'wt_1',
        ['s1'],
        'fi',
        old,
      );
      assert.equal(kept.trainingCycle.anchorDayStart, old.anchorDayStart);
    },
  },

];
