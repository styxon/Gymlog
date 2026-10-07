const assert = require('node:assert/strict');

const {
  buildSavedOnboardingWorkoutPlan,
  buildSetupBasicsFromPreferences,
  buildSetupPreferencePatch,
  buildSetupSeedKey,
  buildSetupSelectionFromPreferences,
} = require('../../.test-dist/app/onboardingHandoff.js');
const {
  DEFAULT_FIRST_RUN_SELECTION,
  weekAfterCycleRemoved,
} = require('../../.test-dist/lib/firstRunSetup.js');
const { planLabelsForProgramme } = require('../../.test-dist/lib/trainingWeekSync.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');

/**
 * How stored preferences become the questionnaire's seed, and back (audit
 * round 2, 2026-09-17).
 */

function basePreferences(overrides = {}) {
  return { ...createEmptyDatabase('fi').preferences, ...overrides };
}

/** A reader who finished setup, with every field the builders read filled. */
function completedPreferences(overrides = {}) {
  return basePreferences({
    setupCompleted: true,
    onboardingCompleted: true,
    profileName: 'Santeri Ylönen',
    setupGender: 'male',
    setupAge: null,
    setupAgeRange: '31_40',
    setupHeightCm: 181,
    setupCurrentWeightKg: 82.5,
    bodyweightGoalKg: 78,
    setupGoal: 'strength',
    setupGoals: ['strength'],
    setupLevel: 'intermediate',
    setupDaysPerWeek: 4,
    setupEquipment: 'gym',
    setupTrainingEnvironment: 'full_gym',
    setupEquipmentItems: ['Barbell'],
    setupSecondaryOutcomes: ['consistency'],
    setupFocusAreas: ['chest'],
    setupCautionFlags: [{ area: 'knees', level: 'careful' }],
    setupGuidanceMode: 'guided_editable',
    setupScheduleMode: 'self_managed',
    automatedProgressionEnabled: false,
    setupWeeklyMinutes: 180,
    setupAvailableDays: ['mon', 'tue', 'thu', 'sat'],
    unitPreference: 'kg',
    ...overrides,
  });
}

/** The lead programme's rhythm, handed to the builders beside the preferences. */
const LEAD_CYCLE = { pattern: [true, true, false], anchorDayStart: 1_700_000_000_000 };

/** Every property a builder touches, read through a proxy. */
function fieldsRead(build, preferences) {
  const read = new Set();
  const proxy = new Proxy(preferences, {
    get(target, key, receiver) {
      if (typeof key === 'string') {
        read.add(key);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  build(proxy);
  return read;
}

module.exports = [
  {
    name: 'setup seed: the memo key moves with every field the seed builders read',
    run() {
      const completed = completedPreferences();
      const read = new Set([
        ...fieldsRead(buildSetupSelectionFromPreferences, completed),
        ...fieldsRead(buildSetupBasicsFromPreferences, completed),
        ...fieldsRead(buildSetupBasicsFromPreferences, basePreferences()),
        // The early return reads the gate and nothing else.
        ...fieldsRead(buildSetupSelectionFromPreferences, basePreferences()),
      ]);
      // The app-wide rhythm is gone: the lead programme's comes in beside
      // the preferences (2026-10-07).
      assert.ok(!read.has('trainingCycle'), 'the old app-wide rhythm is not read');
      assert.ok(read.size >= 20, `the proxy saw the builders' reads (${read.size})`);

      const baseKey = buildSetupSeedKey(completed);
      for (const field of read) {
        const changed = { ...completed, [field]: { changed: field } };
        assert.notEqual(
          buildSetupSeedKey(changed),
          baseKey,
          `the seed reads "${field}", so changing it must change the memo key`,
        );
      }

      // The case that shipped: a rhythm set or removed on the plan screen.
      assert.notEqual(buildSetupSeedKey(completed, LEAD_CYCLE), baseKey);
      assert.notEqual(
        buildSetupSeedKey(completed, LEAD_CYCLE),
        buildSetupSeedKey(completed, { ...LEAD_CYCLE, pattern: [true, false] }),
      );
      // And a theme switch still rebuilds nothing.
      assert.equal(buildSetupSeedKey(completedPreferences({ darkThemeEnabled: true })), baseKey);
    },
  },
  {
    name: 'setup seed: a reader with no finished setup keeps their basics through a re-run',
    run() {
      // Started empty, then filled in My Data and set a rhythm on the plan
      // screen. No answers, so no selection.
      const stored = basePreferences({
        onboardingCompleted: true,
        setupCompleted: false,
        setupGender: 'female',
        setupAgeRange: '41_plus',
        setupHeightCm: 168,
        setupCurrentWeightKg: 64.2,
        bodyweightGoalKg: 60,
        automatedProgressionEnabled: false,
        setupCautionFlags: [{ area: 'shoulders', level: 'avoid' }],
      });
      const leadCycle = { pattern: [true, false], anchorDayStart: 1_700_000_000_000 };
      assert.equal(buildSetupSelectionFromPreferences(stored, null, leadCycle), null);

      const basics = buildSetupBasicsFromPreferences(stored, null, leadCycle);
      // What the questionnaire hands on when it asks none of these.
      const answered = { ...DEFAULT_FIRST_RUN_SELECTION, ...basics };
      const patch = buildSetupPreferencePatch(answered, 'tpl_3_day_strength_base_v1');

      assert.equal(patch.setupGender, 'female');
      assert.equal(patch.setupAgeRange, '41_plus');
      assert.equal(patch.setupHeightCm, 168);
      assert.equal(patch.setupCurrentWeightKg, 64.2);
      assert.equal(patch.bodyweightGoalKg, 60);
      assert.equal(patch.automatedProgressionEnabled, false);
      assert.deepEqual(patch.setupCautionFlags, [{ area: 'shoulders', level: 'avoid' }]);
      // The same rhythm, with its anchor: not re-stamped, not cleared — and on
      // the programme the questions build, not on the preferences.
      assert.equal('trainingCycle' in patch, false);
      const plan = buildSavedOnboardingWorkoutPlan(answered, 'wt_1', ['s1', 's2'], 'fi', leadCycle);
      assert.equal(plan.trainingCycle, leadCycle);
    },
  },
  {
    name: 'setup seed: weekdays named in Profile survive a re-run, count and mode with them',
    run() {
      // The other half of the same week. Profile's weekday picker and dragging
      // a day on the plan screen write these three without finishing setup, so
      // a reader who never answered the questions can still have named them.
      const stored = basePreferences({
        onboardingCompleted: true,
        setupCompleted: false,
        setupAvailableDays: ['mon', 'wed', 'thu', 'sat'],
        setupDaysPerWeek: 4,
        setupScheduleMode: 'self_managed',
      });
      assert.equal(buildSetupSelectionFromPreferences(stored), null);

      const basics = buildSetupBasicsFromPreferences(stored);
      assert.deepEqual(basics.availableDays, ['mon', 'wed', 'thu', 'sat']);
      assert.equal(basics.daysPerWeek, 4);
      assert.equal(basics.scheduleMode, 'self_managed');

      // Finishing without touching the days step keeps the week it opened on.
      const patch = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, ...basics }, null);
      assert.deepEqual(patch.setupAvailableDays, ['mon', 'wed', 'thu', 'sat']);
      assert.equal(patch.setupDaysPerWeek, 4);
      assert.equal(patch.setupScheduleMode, 'self_managed');

      // A reader who has named nothing still gets the questionnaire's own
      // defaults, not an empty week presented as an answer.
      const blank = buildSetupBasicsFromPreferences(
        basePreferences({ onboardingCompleted: true, setupCompleted: false }),
      );
      assert.deepEqual(blank.availableDays, DEFAULT_FIRST_RUN_SELECTION.availableDays);
      assert.equal(blank.daysPerWeek, DEFAULT_FIRST_RUN_SELECTION.daysPerWeek);
      assert.equal(blank.scheduleMode, DEFAULT_FIRST_RUN_SELECTION.scheduleMode);

      // And a finished setup reads the same week through the same builder.
      const selection = buildSetupSelectionFromPreferences(completedPreferences());
      assert.deepEqual(selection.availableDays, ['mon', 'tue', 'thu', 'sat']);
      assert.equal(selection.daysPerWeek, 4);
      assert.equal(selection.scheduleMode, 'self_managed');
    },
  },
  {
    name: 'setup seed: an age band nobody gave is not written as 19-25',
    run() {
      const blank = basePreferences({ onboardingCompleted: true, setupCompleted: false });
      const basics = buildSetupBasicsFromPreferences(blank);
      assert.equal(basics.ageRange, undefined);
      assert.equal(basics.age, null);
      const patch = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, ...basics }, null);
      assert.equal(patch.setupAgeRange, null);
      assert.equal(patch.setupHeightCm, null);
      assert.equal(patch.setupCurrentWeightKg, null);
      assert.equal('trainingCycle' in patch, false);
      assert.equal(buildSavedOnboardingWorkoutPlan({ ...DEFAULT_FIRST_RUN_SELECTION, ...basics }, 'wt_1', ['s1'], 'fi').trainingCycle, null);

      // A finished setup with no band stays without one as well.
      const selection = buildSetupSelectionFromPreferences(completedPreferences({ setupAgeRange: null }));
      assert.equal(selection.ageRange, undefined);
      assert.equal(selection.age, null);
    },
  },
  {
    name: 'setup seed: a Finnish name is never rewritten by setup',
    run() {
      const stored = completedPreferences();
      const selection = buildSetupSelectionFromPreferences(stored);
      const patch = buildSetupPreferencePatch(selection, null);
      // Byte for byte — the old capitaliser made this "Santeri YlÖNen".
      assert.equal(patch.profileName ?? stored.profileName, 'Santeri Ylönen');
      assert.equal(buildSetupPreferencePatch({ ...selection, profileName: 'äijä öljynen' }, null).profileName, 'äijä öljynen');
      // The questionnaire's own output carries no name, and then none is written.
      const { profileName, ...withoutName } = selection;
      assert.equal(profileName, 'Santeri Ylönen');
      assert.equal('profileName' in buildSetupPreferencePatch(withoutName, null), false);
    },
  },
  {
    name: 'days step: removing a rhythm hands the count back to the lit weekdays',
    run() {
      // The reported case: Mon/Wed/Fri lit, "2 on, 1 off" added (five a week),
      // then removed.
      assert.deepEqual(weekAfterCycleRemoved(['mon', 'wed', 'fri'], 5), {
        availableDays: ['mon', 'wed', 'fri'],
        daysPerWeek: 3,
      });
      // Out of order in, weekday order out.
      assert.deepEqual(weekAfterCycleRemoved(['sat', 'mon', 'thu', 'tue'], 2), {
        availableDays: ['mon', 'tue', 'thu', 'sat'],
        daysPerWeek: 4,
      });
      // No list: the step draws the count's own rhythm, so that is the answer.
      assert.deepEqual(weekAfterCycleRemoved([], 5), {
        availableDays: ['mon', 'tue', 'thu', 'fri', 'sat'],
        daysPerWeek: 5,
      });
      // A stored list the step could not have produced falls back the same way.
      assert.deepEqual(weekAfterCycleRemoved(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], 4), {
        availableDays: ['mon', 'tue', 'thu', 'sat'],
        daysPerWeek: 4,
      });
      // The input is not sorted in place.
      const input = ['fri', 'mon'];
      weekAfterCycleRemoved(input, 3);
      assert.deepEqual(input, ['fri', 'mon']);
    },
  },
  {
    name: 'catalogue pick: the rhythm starts on the next training day, not on Monday',
    run() {
      // Thursday 17.9.2026. The catalogue path dealt Mon/Wed/Fri as it came,
      // so day 1 was Monday while Home offered it today.
      const thursday = new Date(2026, 8, 17, 10, 0, 0);
      assert.deepEqual(planLabelsForProgramme(3, [], thursday), ['fri', 'mon', 'wed']);
      const monday = new Date(2026, 8, 14, 10, 0, 0);
      assert.deepEqual(planLabelsForProgramme(3, [], monday), ['mon', 'wed', 'fri']);
    },
  },
];
