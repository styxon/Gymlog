const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

/**
 * Onboarding / reset bug hunt, 2026-10-04. No React renderer lives in this
 * suite, so the wiring faults are checked against the source, like the other
 * src/app tests; the composer and the loader are run for real.
 */
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

const CAUTION_AREAS = ['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'hips', 'knees', 'ankles'];

module.exports = [
  {
    name: 'reset all data: the workout bundle is cleared before the database write that makes the app look reset',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      const handler = profile.slice(profile.indexOf('onResetAllData={async () => {'));
      const workoutAt = handler.indexOf('await workout.resetWorkoutData();');
      const databaseAt = handler.indexOf('await resetAllData();');
      assert.ok(workoutAt > 0 && databaseAt > 0, 'a step of the reset is missing');
      assert.ok(workoutAt < databaseAt, 'the database reset lands before the workout bundle is cleared');
    },
  },
  {
    name: 'onboarding: backing out of About-you clears what was typed, so the ready-pick finish cannot write it',
    run() {
      const source = read('src', 'app', 'renderOnboarding.tsx');
      const about = source.slice(source.indexOf('<AboutYouScreen'), source.indexOf('<OnboardingReadyCatalogScreen'));
      assert.match(about, /onBack=\{\(\) => \{\s*(\/\/[^\n]*\n\s*)*setAboutYouValues\(null\);\s*setOnboardingStep\('path'\);/);
    },
  },
  {
    name: 'onboarding: start-empty holds its button until the write settles',
    run() {
      const screen = read('src', 'screens', 'StartPathScreen.tsx');
      assert.match(screen, /if \(startingEmptyRef\.current\) \{\s*return;\s*\}\s*startingEmptyRef\.current = true;/);
      assert.match(screen, /\.finally\(\(\) => \{\s*startingEmptyRef\.current = false;/);
      // The handler hands its promise back; a void-returning one would release at once.
      const flow = read('src', 'app', 'renderOnboarding.tsx');
      assert.match(flow, /onStartEmpty=\{\(\) => \{[^]*?return completeOnboarding\(/);
    },
  },
  {
    name: 'database: every sign-in method in the type survives a load',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      for (const method of ['apple', 'email', 'local', 'google', null]) {
        assert.equal(normalizeDatabase({ preferences: { selectedSignInMethod: method } }).preferences.selectedSignInMethod, method);
      }
      assert.equal(normalizeDatabase({ preferences: { selectedSignInMethod: 'bogus' } }).preferences.selectedSignInMethod, null);
    },
  },
  {
    name: 'composer: caution + scarce gear on a six-day week keeps all six days',
    run() {
      const week = composeProgramWeekForSelection(
        {
          ...DEFAULT_FIRST_RUN_SELECTION,
          goal: 'muscle',
          level: 'pro',
          daysPerWeek: 6,
          equipment: 'gym',
          trainingEnvironment: 'full_gym',
          equipmentItems: ['Cardio machines'],
          cautionFlags: [{ area: 'wrists', level: 'avoid', refinements: [] }],
          availableDays: [],
          scheduleMode: 'app_managed',
        },
        'tpl_6_day_arnold_v1',
      );
      assert.ok(week);
      assert.equal(week.days, 6);
      assert.deepEqual(
        week.sessions.map((session) => session.orderIndex),
        [0, 1, 2, 3, 4, 5],
      );
      assert.ok(week.sessions.every((session) => session.exercises.length > 0));
    },
  },
  {
    name: 'composer sweep: caution or scarce gear never shortens a week below the template\'s own days',
    run() {
      const gearScenarios = [undefined, [], ['Cardio machines'], ['Dumbbells'], ['Resistance bands']];
      const problems = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const equipmentItems of gearScenarios) {
          for (const area of [null, ...CAUTION_AREAS]) {
            const selection = {
              ...DEFAULT_FIRST_RUN_SELECTION,
              daysPerWeek: template.daysPerWeek,
              availableDays: [],
              scheduleMode: 'app_managed',
              ...(equipmentItems ? { equipmentItems } : {}),
              cautionFlags: area ? [{ area, level: 'avoid', refinements: [] }] : [],
            };
            // Only the day-count programmes are recommendable; the composer
            // does not take every catalogue template (focus, season, specialist).
            let week;
            try {
              week = composeProgramWeekForSelection(selection, template.id);
            } catch (error) {
              if (!/Unknown recommendation programme/.test(String(error))) {
                throw error;
              }
              continue;
            }
            if (week && week.days !== template.daysPerWeek) {
              problems.push(`${template.id} gear=${JSON.stringify(equipmentItems)} avoid=${area}: ${week.days}/${template.daysPerWeek}`);
            }
          }
        }
      }
      assert.deepEqual(problems, []);
    },
  },
];
