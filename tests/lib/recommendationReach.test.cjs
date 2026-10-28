const assert = require('node:assert/strict');

const { RECOMMENDATION_PROGRAMS } = require('../../src/lib/recommendationCatalog');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
const { buildRecommendationInput } = require('../../src/lib/recommendationInput');
const { recommendPrograms } = require('../../src/lib/recommendationScoring');

/**
 * A program in the catalog that nobody registered here can never be
 * recommended, however good it is — it exists only for whoever happens to
 * browse. Twenty-one of fifty-seven were in that state, including every
 * top-tier program in the app, which is why "pro" handed out the same plans as
 * "advanced".
 *
 * Anything deliberately left out belongs on this list with the reason. Adding
 * a program to the catalog and forgetting the registry now fails here.
 */
const BROWSE_ONLY = {
  // Built for the season competition (removed 2026-10-12); never a setup answer.
  tpl_season_summer_v1: 'former season programme',
  tpl_season_winter_v1: 'former season programme',
  // Single muscle days are add-ons to a program, not a program to be given.
  tpl_focus_chest_v1: 'one-day add-on',
  tpl_focus_back_v1: 'one-day add-on',
  tpl_focus_shoulders_v1: 'one-day add-on',
  tpl_focus_arms_v1: 'one-day add-on',
  tpl_focus_legs_v1: 'one-day add-on',
  tpl_focus_glutes_v1: 'one-day add-on',
  // Nothing in the setup asks about pregnancy, so nothing may infer it. These
  // stay browse-only until there is a question whose answer means this.
  tpl_gainer_prenatal_fitness_v1: 'no setup question can select it',
  tpl_gainer_postpartum_recovery_v1: 'no setup question can select it',
};

const GOALS = ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness'];
const DAYS = [2, 3, 4, 5, 6];

function selection(overrides) {
  return {
    gender: 'male',
    // A real band (it said '25_34', which no setup writes; 2026-10-12).
    ageRange: '26_30',
    goal: 'muscle',
    goals: ['muscle'],
    level: 'beginner',
    daysPerWeek: 3,
    equipment: 'gym',
    trainingEnvironment: 'full_gym',
    secondaryOutcomes: [],
    focusAreas: [],
    guidanceMode: 'guided',
    scheduleMode: 'app_managed',
    ...overrides,
  };
}

function featured(overrides) {
  return recommendPrograms(buildRecommendationInput(selection(overrides))).featuredProgramId;
}

/** Everything the recommendation screen puts in front of the reader. */
function offered(overrides) {
  const result = recommendPrograms(buildRecommendationInput(selection(overrides)));
  return [result.featuredProgramId, result.secondaryProgramId, ...(result.alternativeProgramIds ?? [])].filter(Boolean);
}

module.exports = [
  {
    name: 'every catalog program is either recommendable or listed as browse-only with a reason',
    run() {
      const registered = new Set(RECOMMENDATION_PROGRAMS.map((entry) => entry.programId));
      const stranded = WORKOUT_TEMPLATES_V1.filter(
        (template) => !registered.has(template.id) && !BROWSE_ONLY[template.id],
      ).map((template) => template.id);
      assert.deepEqual(
        stranded,
        [],
        `these programs can never be recommended — register them or add them to BROWSE_ONLY: ${stranded.join(', ')}`,
      );

      // The other direction: a stale exemption hides a program that is in fact
      // wired up, so the list would stop meaning anything.
      const pointless = Object.keys(BROWSE_ONLY).filter((id) => registered.has(id));
      assert.deepEqual(pointless, [], `BROWSE_ONLY entries that are registered after all: ${pointless.join(', ')}`);

      const missingTemplate = Object.keys(BROWSE_ONLY).filter(
        (id) => !WORKOUT_TEMPLATES_V1.some((template) => template.id === id),
      );
      assert.deepEqual(missingTemplate, [], `BROWSE_ONLY names a program that no longer exists: ${missingTemplate.join(', ')}`);
    },
  },
  {
    name: 'the top setup level is not a synonym for the one below it',
    run() {
      // Both levels produced identical recommendations for every combination:
      // each registered program served 'advanced' and 'pro' alike, so the
      // hardest answer in the setup changed nothing.
      const differs = [];
      for (const goal of GOALS) {
        for (const daysPerWeek of DAYS) {
          const advanced = featured({ goal, goals: [goal], daysPerWeek, level: 'advanced' });
          const pro = featured({ goal, goals: [goal], daysPerWeek, level: 'pro' });
          if (advanced !== pro) {
            differs.push(`${goal}/${daysPerWeek}d`);
          }
        }
      }
      assert.ok(
        differs.length >= 8,
        `"pro" should reach further than "advanced" on more than a handful of answers, differed on ${differs.length}: ${differs.join(', ')}`,
      );
    },
  },
  {
    name: 'an experienced lifter with the days to spend is not handed a beginner program',
    run() {
      const byId = new Map(WORKOUT_TEMPLATES_V1.map((template) => [template.id, template]));
      const offenders = [];
      for (const goal of GOALS) {
        // Four days and up: at two or three the catalog genuinely has no
        // advanced program yet, and inventing one is a content decision.
        for (const daysPerWeek of [4, 5, 6]) {
          const id = featured({ goal, goals: [goal], daysPerWeek, level: 'pro' });
          const template = byId.get(id);
          if (template && template.level === 'beginner') {
            offenders.push(`${goal}/${daysPerWeek}d → ${id}`);
          }
        }
      }
      assert.deepEqual(offenders, [], `pro-level answers landing on beginner programs: ${offenders.join(', ')}`);
    },
  },
  {
    name: 'the elite tier is reachable at all',
    run() {
      // Every one of these existed with written copy and no way to be given.
      const elite = [
        'tpl_strong_elite_v1',
        'tpl_fit_elite_v1',
        'tpl_shred_elite_v1',
        'tpl_6_day_arnold_v1',
        'tpl_gainer_expert_powerbuilding_v1',
        'tpl_gainer_athlete_conditioning_v1',
        'tpl_gainer_calisthenics_mastery_v1',
      ];
      // Swept the way a real setup varies: gender decides between two 6-day
      // hypertrophy programs, and "strength + size" is what powerbuilding is
      // for, so a sweep without either misses both and blames the code.
      const reachable = new Set();
      for (const gender of ['male', 'female']) {
        for (const goal of GOALS) {
          for (const daysPerWeek of DAYS) {
            for (const equipment of ['gym', 'minimal', 'home']) {
              for (const secondaryOutcomes of [[], ['muscle'], ['conditioning']]) {
                // Offered, not only featured: the six-day classic is always
                // the alternative beside a gender-targeted primary, and an
                // alternative on that screen is something the reader can pick.
                for (const id of offered({
                  gender,
                  goal,
                  goals: [goal],
                  daysPerWeek,
                  level: 'pro',
                  equipment,
                  secondaryOutcomes,
                  trainingEnvironment: equipment === 'gym' ? 'full_gym' : 'minimal_equipment',
                })) {
                  if (elite.includes(id)) {
                    reachable.add(id);
                  }
                }
              }
            }
          }
        }
      }
      const unreachable = elite.filter((id) => !reachable.has(id));
      assert.deepEqual(unreachable, [], `registered but still never recommended: ${unreachable.join(', ')}`);
    },
  },
  {
    name: 'the age-gap programmes are reachable through the two age bands they were written for',
    run() {
      // VITAL Walk, VITAL Home, STRONG Guided, HUGE Guided and VITAL Muscle are offered
      // only through the age rule (ageGateAllows), so a sweep at 26-30 can
      // never reach them and proves nothing. Over 41 and at 16-18 every one
      // must come up.
      const added = [
        'tpl_3_day_walk_mobility_v1', 'tpl_3_day_home_easy_strength_v1', 'tpl_3_day_guided_strength_v1',
        'tpl_3_day_huge_guided_v1', 'tpl_3_day_huge_home_v1',
      ];
      const reachable = new Set();
      for (const ageRange of ['41_plus', '18']) {
        for (const goal of GOALS) {
          for (const daysPerWeek of DAYS) {
            for (const level of ['beginner', 'advanced']) {
              for (const equipment of ['gym', 'minimal', 'home']) {
                for (const id of offered({
                  ageRange,
                  goal,
                  goals: [goal],
                  daysPerWeek,
                  level,
                  equipment,
                  trainingEnvironment: equipment === 'gym' ? 'full_gym' : 'minimal_equipment',
                })) {
                  if (added.includes(id)) reachable.add(id);
                }
              }
            }
          }
        }
      }
      assert.deepEqual(added.filter((id) => !reachable.has(id)), [], 'registered but never offered at the bands they serve');
      // And nowhere else: at 26-30 none of them is offered, whatever the answer.
      for (const goal of GOALS) {
        for (const daysPerWeek of DAYS) {
          for (const equipment of ['gym', 'minimal', 'home']) {
            const ids = offered({ goal, goals: [goal], daysPerWeek, equipment, trainingEnvironment: equipment === 'gym' ? 'full_gym' : 'minimal_equipment' });
            assert.deepEqual(ids.filter((id) => added.includes(id)), [], `${goal} ${daysPerWeek}d ${equipment} at 26-30`);
          }
        }
      }
    },
  },
];
