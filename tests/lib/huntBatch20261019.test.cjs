const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildHomeWidgetPayload, homeWidgetMonthKey } = require('../../.test-dist/lib/widgetPayload.js');
const { weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');
const { formatGuidedTarget } = require('../../.test-dist/lib/guidedPlayer.js');
const { trackedLiftAmount } = require('../../.test-dist/lib/trackedLiftAmount.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour, 0, 0, 0).getTime();

const SESSIONS = [
  { id: 's1', title: 'A', duration: '~45 min', exercises: [{ name: 'Squat', setsLabel: '4 sets' }], hiddenExerciseCount: 0 },
];

function build(nowMs) {
  return buildHomeWidgetPayload({
    nowMs,
    language: 'en',
    theme: 'light',
    planName: 'Plan',
    schedule: weekdaySchedule([0, 2, 4]),
    sessions: SESSIONS,
    monthTotals: { workouts: 7, durationMinutes: 300, volumeKg: 9000 },
  });
}

/** Hunt batch 2026-10-19 (fixes 21-34): the wiring that nothing else executes, and the pure parts. */
module.exports = [
  {
    name: 'hunt 20-34 #29: the widget payload names its month and carries next month, ready and zeroed',
    run() {
      const payload = build(at(2026, 7, 30));
      assert.equal(payload.monthKey, '2026-07');
      assert.equal(payload.nextMonth.monthKey, '2026-08');
      assert.match(payload.nextMonth.monthLabel, /August/);
      const inMonth = payload.nextMonth.monthWeeks.flat().filter((day) => day.inMonth);
      assert.equal(inMonth.length, 31);
      assert.ok(inMonth.every((day) => day.state !== 'done'), 'nothing is done in a month not begun');
      assert.ok(inMonth.some((day) => day.state === 'plan'), 'the rhythm carries into the next month');
      assert.equal(payload.nextMonth.stats[0].value, '0');
      // The current month keeps its real totals.
      assert.equal(payload.stats[0].value, '7');
    },
  },
  {
    name: 'hunt 20-34 #29: December rolls into January by calendar month, not by days',
    run() {
      const payload = build(at(2026, 12, 31));
      assert.equal(payload.monthKey, '2026-12');
      assert.equal(payload.nextMonth.monthKey, '2027-01');
      assert.equal(homeWidgetMonthKey(new Date(2027, 0, 1)), '2027-01');
    },
  },
  {
    name: 'hunt 20-34 #29: the native side draws the month that is true today, or asks to be opened',
    run() {
      const plugin = read('plugins', 'withHomeWidget.js');
      assert.match(plugin, /private fun monthFor\(payload: JSONObject\): JSONObject\?/);
      assert.match(plugin, /optString\("monthKey"\) == key/);
      assert.match(plugin, /optJSONObject\("nextMonth"\)/);
      assert.match(plugin, /val month = monthFor\(payload\)/);
    },
  },
  {
    name: 'hunt 20-34 #34: one repetition has its own form, in both languages',
    run() {
      assert.equal(formatGuidedTarget({ reps: 1, loadKg: null }, 'fi'), '1 toisto');
      assert.equal(formatGuidedTarget({ reps: 1, loadKg: null }, 'en'), '1 rep');
      assert.equal(formatGuidedTarget({ reps: 5, loadKg: null }, 'fi'), '5 toistoa');
      assert.equal(trackedLiftAmount(null, '1', {}, 'kg', 'fi'), '1 toisto');
      assert.equal(trackedLiftAmount(null, '8,8', {}, 'kg', 'fi'), '8 toistoa');
    },
  },
  {
    name: 'hunt 20-34 #21: the plan review has a back control that leaves without saving when opened as a new plan',
    run() {
      const onboarding = read('src', 'screens', 'OnboardingScreen.tsx');
      const pick = read('src', 'screens', 'ProgramPickScreen.tsx');
      assert.match(pick, /onBack\?: \(\) => void/);
      assert.match(pick, /<OnboardingBackButton language=\{language\} onPress=\{onBack\}/);
      assert.match(onboarding, /onBack=\{stageBack\}/);
            assert.match(onboarding, /stage === 'review' && reviewOpenedHere/);
    },
  },
  {
    name: 'hunt 20-34 #22: an AI programme build spends a coach question and is refused when none are left',
    run() {
      const home = read('src', 'app', 'renderHomeScreens.tsx');
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(home, /resolveCoachQuota\(preferences\.aiCoachProQuota\)\.remaining <= 0\) \{\s*return null;/);
      assert.match(home, /if \(live && !isProgrammeCompositionCrisis\(live\)\) \{\s*void updatePreferences\(\(current\) => \(\{ aiCoachProQuota: recordCoachQuestion/);
      assert.match(chat, /if \(questionsRemaining <= 0\) \{[\s\S]{0,200}coachQuotaReset\(\)/);
      assert.match(chat, /coachChat\.compose\.spent/);
    },
  },
  {
    name: 'hunt 20-34 #30: a rate-limited question is lifted out of the thread, as the unmount path does',
    run() {
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      const start = chat.indexOf('if (result.limited) {');
      assert.ok(start > 0);
      const block = chat.slice(start, start + 1400);
      assert.match(block, /message\.id !== `me:\$\{token\}` && message\.id !== `offer:\$\{token\}`/);
    },
  },
  {
    name: 'hunt 20-34 #31-33: weight, last-done title and lock-screen lift name go through the localizing helpers',
    run() {
      assert.match(read('src', 'screens', 'AboutYouScreen.tsx'), /formatWeight\(weightKg\)/);
      assert.doesNotMatch(read('src', 'screens', 'AboutYouScreen.tsx'), /`\$\{weightKg\} kg`/);
      assert.match(read('src', 'screens', 'ExerciseDetailScreen.tsx'), /localizeSessionName\(history\.latestLog\.workoutNameSnapshot, language\)/);
      assert.match(read('src', 'screens', 'EmptyWorkoutScreen.tsx'), /exercise: current \? exerciseNameLabel\(language, current\.name\) : ''/);
    },
  },
];
