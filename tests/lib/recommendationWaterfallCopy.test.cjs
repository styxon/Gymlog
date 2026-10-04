const assert = require('node:assert/strict');

const { selectWaterfallDecision } = require('../../.test-dist/lib/recommendationWaterfall.js');
const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { getReadyTemplatePresentation } = require('../../.test-dist/lib/templatePresentation.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { t, I18N_KEYS } = require('../../.test-dist/lib/i18n.js');

const GOALS = ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const ENVIRONMENTS = ['full_gym', 'home_gym', 'minimal_equipment', 'bodyweight_only'];

function decisionFor(overrides) {
  return selectWaterfallDecision(
    buildRecommendationInput({ ...DEFAULT_FIRST_RUN_SELECTION, ...overrides }),
  );
}

module.exports = [
  {
    name: 'waterfall reasons are i18n keys that resolve in every language',
    run() {
      const seen = new Set();

      for (const goal of GOALS) {
        for (const level of LEVELS) {
          for (const trainingEnvironment of ENVIRONMENTS) {
            for (const gender of ['male', 'female', 'unspecified']) {
              const decision = decisionFor({
                goal,
                goals: [goal],
                level,
                gender,
                trainingEnvironment,
                equipment: trainingEnvironment === 'full_gym' ? 'gym' : 'home',
              });

              for (const key of [decision.whyPrimary, decision.whyAlternative].filter(Boolean)) {
                seen.add(key);
                // A sentence here means the reason was hardcoded again — that
                // is how a Finnish user got English prose on the plan card.
                assert.ok(
                  I18N_KEYS.includes(key),
                  `waterfall reason must be an i18n key, got: ${JSON.stringify(key)}`,
                );
                for (const language of ['en', 'fi']) {
                  const text = t(language, key);
                  assert.ok(text.length > 0 && text !== key, `${key} has no ${language} copy`);
                }
              }
            }
          }
        }
      }

      assert.ok(seen.size >= 10, `expected the sweep to reach most rules, saw ${seen.size}`);
    },
  },
  {
    name: 'the day tag follows the composed week, in every language',
    run() {
      // HOME Starter is a 2-day base. A user who asked for 3 runs a 3-day
      // composed week, and the card said "3 workouts a week" beside a "2 pv"
      // chip because the fix only pattern-matched English.
      const template = getWorkoutTemplateById('tpl_2_day_minimal_full_body_v1');
      assert.ok(template);
      assert.equal(template.daysPerWeek, 2);

      for (const language of ['en', 'fi']) {
        const untouched = getReadyTemplatePresentation(template, language);
        const composed = getReadyTemplatePresentation(template, language, 3);

        assert.ok(
          untouched.tags.some((tag) => tag.includes('2')),
          `${language}: without an override the template's own count stands`,
        );
        assert.ok(
          composed.tags.some((tag) => tag.includes('3')),
          `${language}: the composed count must reach the tag`,
        );
        assert.ok(
          !composed.tags.some((tag) => /(^|\D)2(\D|$)/.test(tag)),
          `${language}: no tag may still claim 2 days — got ${composed.tags.join(', ')}`,
        );
      }
    },
  },
  {
    name: 'run_mobility only says running comes first when the pick is the run programme',
    run() {
      // Bug hunt, 2026-10-04: the 2-day mobility reset and the 5-6 day mobility
      // flow were announced with "Running comes first" though neither has a run.
      const base = { goal: 'run_mobility', goals: ['run_mobility'], trainingEnvironment: 'full_gym', equipment: 'gym' };
      for (const level of ['beginner', 'advanced']) {
        for (const daysPerWeek of [2, 3, 4, 5, 6]) {
          const decision = decisionFor({ ...base, level, daysPerWeek });
          if (decision.whyPrimary === 'wf.run_mobility.primary') {
            assert.equal(
              decision.primaryProgramId,
              'tpl_3_day_run_mobility_v1',
              `${level}/${daysPerWeek}: running-first copy on ${decision.primaryProgramId}`,
            );
          }
        }
      }
      const reset = decisionFor({ ...base, level: 'advanced', daysPerWeek: 2 });
      assert.equal(reset.primaryProgramId, 'tpl_2_day_mobility_reset_v1');
      assert.equal(reset.whyPrimary, 'wf.run_mobility.mobilityPrimary');
      const flow = decisionFor({ ...base, level: 'advanced', daysPerWeek: 6 });
      assert.equal(flow.primaryProgramId, 'tpl_gainer_mobility_flow_v1');
      assert.equal(flow.whyPrimary, 'wf.run_mobility.mobilityPrimary');
      for (const language of ['en', 'fi']) {
        for (const key of ['wf.run_mobility.mobilityPrimary', 'wf.run_mobility.closestPrimary']) {
          assert.ok(!/running comes first|juoksu edellä/i.test(t(language, key)), `${language} ${key}`);
        }
      }
    },
  },
];
