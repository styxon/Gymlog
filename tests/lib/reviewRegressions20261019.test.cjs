const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState.js');
const { recordSetsOfExercise } = require('../../.test-dist/app/workoutCompletionState.js');
const { narrowSwapAlternatives, swapSuggestionFilters } = require('../../.test-dist/lib/swapPickerLists.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { matchesExercisePickerFilters } = require('../../.test-dist/lib/exercisePicker.js');
const { tidySessionTitle, buildRecoverySheet } = require('../../.test-dist/lib/recoverySheet.js');
const { startKeepAwake } = require('../../.test-dist/lib/keepAwakeLifecycle.js');
const { buildNotificationPlan } = require('../../.test-dist/lib/notificationPlan.js');
const { weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');
const { t } = require('../../.test-dist/lib/i18n.js');
const { formatWeightInputValue } = require('../../.test-dist/lib/format.js');
const {
  repsDeltaLabel,
  prMoreRepsLabel,
  unloadedSetRowLabel,
  walkRampLabel,
  walkSupersetRampLabel,
  milestoneRepsTitle,
  milestoneRepsMeta,
  templateSetsRepsLabel,
} = require('../../.test-dist/lib/repCountCopy.js');
const { targetSetsAfterEmphasis, withSupersetPartners } = require('../../.test-dist/lib/setCountChanges.js');
const { createCompletedSession } = require('../helpers/workoutFixtures.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ── 1. Swap suggestions ────────────────────────────────────────────────────
const library = createSeedExerciseLibrary();
const BODY_PARTS = ['chest', 'back', 'shoulders', 'quadriceps', 'hamstrings', 'glutes', 'biceps', 'triceps'];
function twoLiftsOnDifferentParts() {
  for (const part of BODY_PARTS) {
    const filters = { category: 'all', bodyPart: part, equipment: 'all' };
    const inside = library.find((item) => matchesExercisePickerFilters(item, filters));
    const outside = library.find((item) => !matchesExercisePickerFilters(item, filters));
    if (inside && outside) {
      return { part, inside, outside };
    }
  }
  throw new Error('no body part separates the seed library');
}

// ── 3. Keep-awake ──────────────────────────────────────────────────────────
// ── 4. Notification plan ───────────────────────────────────────────────────
function at(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}
const PREFS = {
  pushEnabled: true,
  level: 'normal',
  personalRecords: true,
  weeklySummary: false,
  comebackNudge: false,
  sessionReminders: true,
  reminderTime: '17:30',
  measurementReminderKind: null,
  measurementReminderDay: 'sun',
  weighInReminder: true,
};
function plan(prefs, extra = {}) {
  return buildNotificationPlan({
    nowMs: at(2026, 7, 1, 12, 0),
    prefs: { ...PREFS, ...prefs },
    language: 'en',
    schedule: weekdaySchedule([0, 2, 4]),
    lastSessionAtMs: null,
    lastWorkoutAtMs: null,
    weekSessionCount: 0,
    weekVolumeKg: 0,
    latestPr: null,
    onTrainingBreak: false,
    ...extra,
  });
}

// ── 9. Insert fixtures ─────────────────────────────────────────────────────
function historyWith(exerciseName, loadKg) {
  return {
    sessions: [],
    lastSelectedTemplateId: null,
    slotHistory: {
      'tpl_other:day_2:x_1': [
        {
          slotId: 'tpl_other:day_2:x_1',
          templateId: 'tpl_other',
          templateName: 'Other plan',
          exerciseName,
          substitutionGroup: 'g',
          performedAt: '2026-07-12T09:00:00.000Z',
          sessionId: 'session_x',
          sets: [{ setIndex: 0, loadKg, reps: 8, completedAt: '2026-07-12T09:05:00.000Z' }],
          skipped: false,
        },
      ],
    },
  };
}
function insert(exerciseName, trackingMode, loadKg, unitPreference) {
  const activeSession = createCompletedSession({ status: 'active', completedAt: undefined, exercises: [] });
  const next = workoutReducer(
    { ...workoutInitialState, history: historyWith(exerciseName, loadKg), activeSession },
    {
      type: 'exercise/insertAfter',
      payload: {
        afterSlotId: null,
        unitPreference,
        exercise: {
          exerciseName,
          trackingMode,
          sets: 1,
          repsMin: 6,
          repsMax: 10,
          restSecondsMin: 60,
          restSecondsMax: 90,
          substitutionGroup: 'g',
        },
      },
    },
  );
  return next.activeSession.exercises[0];
}

module.exports = [
  // 1
  {
    name: 'swap suggestions: the default body-part chip does not narrow, a picked one does',
    run() {
      const { part, inside, outside } = twoLiftsOnDifferentParts();
      const rows = [
        { name: inside.name, item: inside },
        { name: outside.name, item: outside },
      ];
      // The lift's own muscle is the chip's default: nobody tapped anything.
      const withDefault = { category: 'all', bodyPart: part, equipment: 'all' };
      const untouched = narrowSwapAlternatives(rows, swapSuggestionFilters(withDefault, { category: null, bodyPart: null }));
      assert.equal(untouched.length, 2, 'the programme alternatives are all still there');
      // The reader tapped the same chip: now it narrows.
      const picked = narrowSwapAlternatives(rows, swapSuggestionFilters(withDefault, { category: null, bodyPart: part }));
      assert.deepEqual(picked.map((row) => row.name), [inside.name]);
      // An alternative the library lacks is hidden only under a picked chip.
      const unknown = [{ name: 'Home Made Lift', item: null }];
      assert.equal(narrowSwapAlternatives(unknown, swapSuggestionFilters(withDefault, { category: null, bodyPart: null })).length, 1);
      assert.equal(narrowSwapAlternatives(unknown, swapSuggestionFilters(withDefault, { category: null, bodyPart: part })).length, 0);
    },
  },
  // 2
  {
    name: 'recovery sheet title: "Day 2" is translated whole, glued and plain names keep their number, other titles stay',
    run() {
      assert.equal(tidySessionTitle('Day 2', 'fi'), 'Päivä 2');
      assert.equal(tidySessionTitle('Day1', 'fi'), 'Päivä 1');
      assert.equal(tidySessionTitle('Day 2', 'en'), 'Day 2');
      assert.equal(tidySessionTitle('Jalat1', 'fi'), 'Jalat 1');
      assert.equal(tidySessionTitle('Legs1', 'fi'), 'Jalat 1');
      assert.equal(tidySessionTitle('Squat 5x5', 'fi'), 'Squat 5x5');
      assert.equal(tidySessionTitle('HIIT 20', 'fi'), 'HIIT 20');
      assert.equal(tidySessionTitle('5x5', 'fi'), '5x5');
    },
  },
  // 3
  {
    name: 'keep-awake: a late release of an old handle never deactivates a tag a newer handle holds',
    async run() {
      let deactivated = 0;
      const deactivate = () => {
        deactivated += 1;
      };
      let resolveOld;
      const old = startKeepAwake(() => new Promise((resolve) => (resolveOld = resolve)), deactivate, 'workout');
      old.release(); // released before its activation settled
      const fresh = startKeepAwake(() => Promise.resolve(), deactivate, 'workout');
      await tick();
      resolveOld(); // the old activation settles late
      await tick();
      assert.equal(deactivated, 0, 'the screen must stay awake for the newer handle');
      fresh.release();
      assert.equal(deactivated, 1, 'the newer handle still switches it off');
      // A different tag is independent.
      const other = startKeepAwake(() => Promise.resolve(), deactivate, 'other');
      await tick();
      other.release();
      assert.equal(deactivated, 2);
      // Re-activating the same tag after a clean release works as before.
      const again = startKeepAwake(() => Promise.resolve(), deactivate, 'workout');
      await tick();
      again.release();
      assert.equal(deactivated, 3);
    },
  },
  // 4
  {
    name: 'notification cap: [record, weigh-in, reminder] keeps record and weigh-in on normal; quiet gives the weigh-in the slot',
    run() {
      const latestPr = { exerciseName: 'Deadlift', weightKg: 180, reps: 1, achievedAtMs: at(2026, 7, 2, 19, 0) };
      const friday = (items) => items.filter((item) => item.fireAtMs >= at(2026, 7, 3) && item.fireAtMs < at(2026, 7, 4));
      assert.deepEqual(friday(plan({ level: 'normal' }, { latestPr })).map((item) => item.category).sort(), ['record', 'weighIn']);
      // Without a PR the two that remain both fit on normal.
      assert.deepEqual(friday(plan({ level: 'normal' })).map((item) => item.category).sort(), ['reminder', 'weighIn']);
      // Quiet: one slot, the weigh-in outranks the reminder.
      assert.deepEqual(friday(plan({ level: 'quiet' })).map((item) => item.category), ['weighIn']);
      // The reminder still fires on days with no weigh-in.
      assert.deepEqual(friday(plan({ level: 'quiet', weighInReminder: false })).map((item) => item.category), ['reminder']);
    },
  },
  // 5
  {
    name: 'rep counts: one is singular and many plural, in both languages, for every count-carrying line',
    run() {
      for (const language of ['fi', 'en']) {
        const one = language === 'fi' ? 'toisto' : 'rep';
        const many = language === 'fi' ? 'toistoa' : 'reps';
        const singular = [
          repsDeltaLabel(1, language),
          prMoreRepsLabel(1, '80', language),
          unloadedSetRowLabel(1, language),
          walkRampLabel([1], 90, language),
          walkSupersetRampLabel([1], 'Curl', language),
          milestoneRepsTitle(1, '1', language),
          milestoneRepsMeta('0', 1, '1', language),
          templateSetsRepsLabel(3, '1', language),
          t(language, 'guided.entry.progressed.repOne'),
        ];
        singular.forEach((text) => {
          assert.ok(new RegExp(`\\b1 ${one}\\b`).test(text) || /\+1 /.test(text), `${language}: "${text}"`);
          assert.ok(!text.includes(many), `${language}: "${text}" must not use the plural`);
        });
        const plural = [
          repsDeltaLabel(2, language),
          prMoreRepsLabel(2, '80', language),
          unloadedSetRowLabel(5, language),
          walkRampLabel([10, 8, 6], 90, language),
          walkSupersetRampLabel([10, 8, 6], 'Curl', language),
          milestoneRepsTitle(1000, '1,000', language),
          milestoneRepsMeta('5', 1000, '1,000', language),
          templateSetsRepsLabel(3, '8–12', language),
          t(language, 'guided.entry.progressed.reps', { delta: 2 }),
        ];
        plural.forEach((text) => assert.ok(text.includes(many), `${language}: "${text}"`));
      }
      assert.equal(repsDeltaLabel(1, 'fi'), '+1 toisto');
      assert.equal(unloadedSetRowLabel(1, 'en'), '1 rep');
      assert.equal(unloadedSetRowLabel(8, 'fi'), '8 toistoa');
    },
  },
  // 7
  {
    name: 'recovery sheet: no ratio, no zone marker',
    run() {
      const fatigue = {
        acwr: 0,
        acuteLoadKg: 0,
        chronicLoadKg: 0,
        recoveryScore: 90,
        signal: 'undertrained',
        sessionCount7d: 0,
        sessionCount28d: 0,
        confident: true,
      };
      const build = (overrides) =>
        buildRecoverySheet({
          fatigue: { ...fatigue, ...overrides },
          sessionDates: [],
          now: new Date(2026, 8, 25, 12),
          nextSessionTitle: null,
          automatedProgression: false,
          proUnlocked: false,
          tomorrowTrains: false,
          restTomorrowMarked: false,
          lightenQueued: false,
          language: 'en',
        });
      const bare = build({});
      assert.equal(bare.acwrLabel, null);
      assert.equal(bare.markerPercent, null);
      const real = build({ acwr: 1.25, acuteLoadKg: 5000, chronicLoadKg: 4000 });
      assert.equal(real.markerPercent, 50);
    },
  },
  // 8
  {
    name: 'records: a hold-mode lift with an unlisted name offers no record sets',
    run() {
      const hold = {
        slotId: 's',
        exerciseName: 'Zzyzx Stillness Block',
        persistedExerciseTemplateId: null,
        trackingMode: 'hold',
        notes: null,
        sets: [{ orderIndex: 0, status: 'completed', weightKg: 10, reps: 45 }],
      };
      assert.deepEqual(recordSetsOfExercise(hold), []);
      assert.equal(recordSetsOfExercise({ ...hold, trackingMode: 'load_and_reps', sets: [{ orderIndex: 0, status: 'completed', weightKg: 10, reps: 8 }] }).length, 1);
    },
  },
  // 9 (#405 fix 19)
  {
    name: 'emphasis save: a row takes the superset-expanded count, and keeps its own when unnamed',
    run() {
      const sessions = [
        {
          exercises: [
            { id: 'a', name: 'A', targetSets: 3, supersetGroup: 'g' },
            { id: 'b', name: 'B', targetSets: 3, supersetGroup: 'g' },
            { id: 'c', name: 'C', targetSets: 2, supersetGroup: null },
          ],
        },
      ];
      const counts = withSupersetPartners(sessions, new Map([['a', 5]]));
      const written = sessions[0].exercises.map((exercise) => targetSetsAfterEmphasis(exercise, counts));
      assert.deepEqual(written, [5, 5, 2], 'the partner follows; the unnamed row is untouched');
    },
  },
  // 9 (#405 fix 17)
  {
    name: 'inserted lift: lb users get the history weight in pounds, bodyweight lifts open empty',
    run() {
      const lb = insert('Front Squat', 'load_and_reps', 65, 'lb');
      assert.equal(lb.sets[0].draftLoadText, formatWeightInputValue(65, 'lb'));
      // The logger is kg-only, so an lb preference reads the same number.
      assert.equal(lb.sets[0].draftLoadText, '65');
      assert.equal(lb.sets[0].plannedLoadKg, 65);
      const kg = insert('Front Squat', 'load_and_reps', 65, 'kg');
      assert.equal(kg.sets[0].draftLoadText, '65');
      const bodyweight = insert('Push-Up', 'bodyweight', 20, 'kg');
      assert.equal(bodyweight.sets[0].draftLoadText, '');
      assert.equal(bodyweight.sets[0].plannedLoadKg, undefined);
      assert.equal(bodyweight.sets[0].prefilledFromPerformedAt, undefined);
    },
  },
  // 6 and the source-level wiring that has no pure seam
  {
    name: 'search field uses minHeight and caps font scaling',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../../src/components/AddExerciseSheet.tsx'), 'utf8');
      const block = source.slice(source.indexOf('searchInput: {'), source.indexOf('clearButton: {'));
      // 44 since the menu redesign (2026-10-24); a minimum either way.
      assert.match(block, /minHeight: 44/);
      assert.doesNotMatch(block, /\n\s*height: \d+/);
      assert.match(source, /maxFontSizeMultiplier=\{TEXT_SCALE_CAP\}/);
    },
  },
];
