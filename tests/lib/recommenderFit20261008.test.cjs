const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const {
  DEFAULT_FIRST_RUN_SELECTION,
  buildFirstRunRecommendationReasons,
  resolveFirstRunRecommendationWithTailoring,
} = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { buildRecommendationInput } = require(dist + 'lib/recommendationInput.js');
const { reasonOverProgramme, selectWaterfallDecision } = require(dist + 'lib/recommendationWaterfall.js');
const {
  getRecommendationProgramDefinition,
  isRecoveryOnlyProgram,
  RECOMMENDATION_PROGRAMS,
} = require(dist + 'lib/recommendationCatalog.js');
const {
  lowerBodyOnlyAgainstFocus,
  programHoldsConditioning,
  trainsLowerBodyOnly,
} = require(dist + 'lib/recommendationWeekFit.js');
const { classifySessionFocus } = require(dist + 'lib/homeSessionHero.js');
const { t } = require(dist + 'lib/i18n.js');

/**
 * Recommender fit (round 3 persona hunt, 2026-10-08).
 *
 * - A woman who wanted muscle or general fitness was featured Glute
 *   Foundations by the -1 gender tie-break alone: three lower-body days, not
 *   one set for the chest, back or shoulders, where a man with the same
 *   answers got a full week. Picking a lower-body focus keeps it.
 * - "Lean & athletic" went to the women's physique programmes, none of which
 *   lists the goal, under "Balanced strength and conditioning" with no
 *   conditioning in them. Women now get the pick men get from the
 *   conditioning lane.
 * - The lean line said the plan drives fat loss for a reader who never said so.
 * - The gym beginner's second card was the bodyweight starter, "without
 *   needing a gym".
 */

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const GEARS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  homeDumbbells: {
    equipment: 'minimal',
    trainingEnvironment: 'minimal_equipment',
    equipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'],
  },
};
const NEUTRAL_TAILORING = {
  setupEquipment: null,
  setupFreeWeightsPreference: 'neutral',
  setupBodyweightPreference: 'neutral',
  setupMachinesPreference: 'neutral',
  setupShoulderFriendlySwaps: 'neutral',
  setupElbowFriendlySwaps: 'neutral',
  setupKneeFriendlySwaps: 'neutral',
};

function selection({ gear = GEARS.gym, ...rest }) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    equipment: gear.equipment,
    trainingEnvironment: gear.trainingEnvironment,
    equipmentItems: gear.equipmentItems,
    gender: 'female',
    focusAreas: [],
    cautionFlags: [],
    availableDays: [],
    ...rest,
    goals: [rest.goal],
  };
}

function featured(sel) {
  return resolveFirstRunRecommendationWithTailoring(sel, NEUTRAL_TAILORING, 'en');
}

const GLUTE_FOUNDATIONS = 'tpl_gainer_glute_foundations_v1';
const RUNNERS_STRENGTH = 'tpl_gainer_runners_strength_v1';

module.exports = [
  {
    name: 'recommender fit: Glute Foundations and Runner\'s Strength train the lower body and next to nothing else',
    run() {
      const lowerOnly = RECOMMENDATION_PROGRAMS.filter((definition) => trainsLowerBodyOnly(definition.programId)).map(
        (definition) => definition.programId,
      );
      // Runner's Strength by share: one side plank is 3 of its 44 lifting sets
      // (bug hunt, 2026-10-09, #10). Advanced Glutes keeps its upper day, a
      // fifth of the week, and is not one.
      assert.deepEqual(lowerOnly.sort(), [GLUTE_FOUNDATIONS, RUNNERS_STRENGTH]);
      // The rule asks the reader's focus, and a run or mobility ask is not it.
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: [] }), true);
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: ['chest', 'back'] }), true);
      for (const area of ['glutes', 'legs', 'quads', 'hamstrings', 'calves']) {
        assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: [area] }), false, area);
      }
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'run_mobility', focusAreas: [] }), false);
      assert.equal(lowerBodyOnlyAgainstFocus('tpl_3_day_full_body_v1', { goal: 'muscle', focusAreas: [] }), false);
    },
  },
  {
    name: 'recommender fit: a woman who wants muscle or general fitness is not handed a week with no upper body',
    run() {
      for (const gearName of Object.keys(GEARS)) {
        for (const goal of ['muscle', 'general_fitness']) {
          for (const focusAreas of [[], ['chest'], ['back', 'shoulders']]) {
            for (const days of [2, 3, 4, 5]) {
              const sel = selection({ gear: GEARS[gearName], goal, level: 'beginner', daysPerWeek: days, focusAreas });
              const label = `${gearName} ${goal} ${days}d focus ${focusAreas.join('+') || 'none'}`;
              const result = featured(sel);
              assert.notEqual(result.featuredProgramId, GLUTE_FOUNDATIONS, label);
              const week = composeProgramWeekForSelection(sel, result.featuredProgramId);
              const upperDays = week.sessions.filter((session) =>
                session.exercises.some((exercise) => {
                  const kind = classifySessionFocus([exercise.exerciseName]);
                  return kind !== 'lower' && kind !== 'general';
                }),
              );
              assert.ok(upperDays.length >= 1, `${label}: the week trains no upper body`);
            }
          }
        }
      }
    },
  },
  {
    name: 'recommender fit: a woman who picks a lower-body focus still gets Glute Foundations, and a man never does',
    run() {
      for (const focus of ['glutes', 'legs', 'hamstrings']) {
        const sel = selection({ goal: 'muscle', level: 'beginner', daysPerWeek: 3, focusAreas: [focus] });
        assert.equal(featured(sel).featuredProgramId, GLUTE_FOUNDATIONS, focus);
        const general = selection({ goal: 'general_fitness', level: 'beginner', daysPerWeek: 3, focusAreas: [focus] });
        assert.equal(featured(general).featuredProgramId, GLUTE_FOUNDATIONS, `${focus} general`);
      }
      const man = selection({ gender: 'male', goal: 'muscle', level: 'beginner', daysPerWeek: 3, focusAreas: ['glutes'] });
      assert.notEqual(featured(man).featuredProgramId, GLUTE_FOUNDATIONS);
    },
  },
  {
    // Bug hunt, 2026-10-09, #10: a two-day lean-athletic reader at the gym was
    // featured Runner's Strength, 38 sets for the legs and 0 above the waist,
    // under "Balanced strength and conditioning". The old rule asked for not
    // one upper set, and its side plank counted as one.
    name: 'recommender fit: an advanced reader who did not name the lower body is not handed Runner\'s Strength',
    run() {
      for (const gender of ['male', 'female']) {
        for (const goal of ['lean_athletic', 'general_fitness']) {
          for (const days of [2, 3, 4]) {
            const sel = selection({ gender, goal, level: 'advanced', daysPerWeek: days });
            assert.notEqual(featured(sel).featuredProgramId, RUNNERS_STRENGTH, `${gender} ${goal} ${days}d`);
          }
        }
        // The runner it is written for, and the reader who asks for legs, keep it.
        assert.equal(lowerBodyOnlyAgainstFocus(RUNNERS_STRENGTH, { goal: 'run_mobility', focusAreas: [] }), false);
        const legs = selection({ gender, goal: 'lean_athletic', level: 'advanced', daysPerWeek: 2, focusAreas: ['legs'] });
        assert.equal(featured(legs).featuredProgramId, RUNNERS_STRENGTH, `${gender} legs`);
      }
      // At home too, where it took most of its readers: a bar, a barbell and
      // rack, dumbbells and bands.
      const HOME = [['Pull-up bar'], ['Barbells', 'Squat rack', 'Bench'], ['Dumbbells', 'Resistance bands']];
      for (const equipmentItems of HOME) {
        for (const days of [2, 3, 4]) {
          const gear = { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems };
          const sel = selection({ gear, gender: 'male', goal: 'lean_athletic', level: 'advanced', daysPerWeek: days });
          assert.notEqual(featured(sel).featuredProgramId, RUNNERS_STRENGTH, `${equipmentItems.join('+')} ${days}d`);
        }
      }
    },
  },
  {
    // Review, 2026-10-09: with Runner's Strength gone, a home lean-athletic
    // reader with a barbell and rack was handed Strength Base under "Balanced
    // strength and conditioning", a week with no conditioning set in it.
    name: 'recommender fit: the lean-athletic line names conditioning only over a week that holds some',
    run() {
      const line = t('en', 'recExp.why.leanAthletic');
      const reasonsFor = (sel, programId) =>
        buildFirstRunRecommendationReasons(sel, { projectedDaysPerWeek: sel.daysPerWeek, language: 'en', programId });
      const lean = selection({ gender: 'male', goal: 'lean_athletic', level: 'advanced', daysPerWeek: 2 });
      assert.equal(programHoldsConditioning('tpl_shred_v1'), true);
      assert.ok(reasonsFor(lean, 'tpl_shred_v1').includes(line), 'SHRED keeps it');
      for (const programId of ['tpl_3_day_strength_base_v1', 'tpl_home_bodyweight_full_body_v1', 'tpl_home_dumbbell_upper_lower_v1']) {
        assert.equal(programHoldsConditioning(programId), false, programId);
        assert.ok(!reasonsFor(lean, programId).includes(line), programId);
      }
      assert.equal(programHoldsConditioning('tpl_no_such_programme'), null);
    },
  },
  {
    // Bug hunt, 2026-10-09: the reason belonged to the lane, not the week.
    // "A balanced week that covers strength, condition, and energy" sat over
    // FIT, HOME Starter and the six-day HUGE Elite, and "a balanced base with
    // less conditioning" over FIT; none of them has a conditioning set.
    name: 'recommender fit: a reason that names conditioning sits only over a week that holds some',
    run() {
      const CLAIMS = new Set(['wf.general.primary', 'wf.lean_athletic.alt']);
      const DISCLAIMS = new Set(['wf.general.primaryStrength', 'wf.lean_athletic.altStrength']);
      const offenders = [];
      const seen = { claims: 0, disclaims: 0 };
      const check = (label, key, programId) => {
        if (!key || !programId) return;
        const holds = programHoldsConditioning(programId);
        if (CLAIMS.has(key)) {
          seen.claims += 1;
          if (holds !== true) offenders.push(`${label}: ${key} over ${programId}`);
        }
        if (DISCLAIMS.has(key)) {
          seen.disclaims += 1;
          if (holds !== false) offenders.push(`${label}: ${key} over ${programId}`);
        }
      };
      for (const [gearName, gear] of Object.entries(GEARS)) {
        for (const gender of ['male', 'female']) {
          for (const level of ['beginner', 'advanced', 'pro']) {
            for (const days of [2, 3, 4, 5, 6]) {
              for (const goal of ['general', 'general_fitness', 'lean_athletic']) {
                const sel = selection({ gear, gender, goal, level, daysPerWeek: days });
                const label = `${gearName} ${gender} ${goal} ${level} ${days}d`;
                // The waterfall's own decision, and the one the cards print
                // after the scoring's swaps.
                const decision = selectWaterfallDecision(buildRecommendationInput(sel));
                check(`${label} waterfall`, decision.whyPrimary, decision.primaryProgramId);
                check(`${label} waterfall`, decision.whyAlternative, decision.alternativeProgramId);
                const applied = featured(sel).waterfall;
                if (applied) {
                  check(`${label} applied`, applied.whyPrimary, applied.primaryProgramId);
                  check(`${label} applied`, applied.whyAlternative, applied.alternativeProgramId);
                }
              }
            }
          }
        }
      }
      assert.deepEqual(offenders, []);
      assert.ok(seen.claims > 0 && seen.disclaims > 0, JSON.stringify(seen));

      // The cases the hunt found, by name.
      const general = featured(selection({ gender: 'male', goal: 'general_fitness', level: 'advanced', daysPerWeek: 5 })).waterfall;
      assert.equal(general.primaryProgramId, 'tpl_6_day_ppl_v1');
      assert.equal(general.whyPrimary, 'wf.general.primaryStrength');
      const lean = selectWaterfallDecision(
        buildRecommendationInput(selection({ gender: 'male', goal: 'lean_athletic', level: 'advanced', daysPerWeek: 2 })),
      );
      assert.equal(lean.alternativeProgramId, 'tpl_3_day_full_body_v1');
      assert.equal(lean.whyAlternative, 'wf.lean_athletic.altStrength');
      // The scoring asks again after a swap, with whichever form the waterfall
      // chose: each form turns into the one the new programme needs.
      for (const key of ['wf.general.primary', 'wf.general.primaryStrength']) {
        assert.equal(reasonOverProgramme(key, 'tpl_shred_v1'), 'wf.general.primary', key);
        assert.equal(reasonOverProgramme(key, 'tpl_3_day_full_body_v1'), 'wf.general.primaryStrength', key);
      }
      for (const key of ['wf.lean_athletic.alt', 'wf.lean_athletic.altStrength']) {
        assert.equal(reasonOverProgramme(key, 'tpl_shred_v1'), 'wf.lean_athletic.alt', key);
        assert.equal(reasonOverProgramme(key, 'tpl_3_day_full_body_v1'), 'wf.lean_athletic.altStrength', key);
      }
      // Other lines, and a programme the catalog does not know, pass through.
      assert.equal(reasonOverProgramme('wf.muscle.primary', 'tpl_3_day_full_body_v1'), 'wf.muscle.primary');
      assert.equal(reasonOverProgramme('wf.general.primary', 'tpl_no_such_programme'), 'wf.general.primary');
      for (const language of ['en', 'fi']) {
        assert.doesNotMatch(t(language, 'wf.general.primaryStrength'), /condition|kunto|energ/i, language);
        assert.doesNotMatch(t(language, 'wf.lean_athletic.altStrength'), /less|vähemmän/i, language);
      }
    },
  },
  {
    name: 'recommender fit: a woman wanting lean & athletic gets a programme that lists the goal and holds conditioning',
    run() {
      for (const level of ['advanced', 'pro']) {
        for (const days of [2, 3, 4, 5, 6]) {
          const input = buildRecommendationInput(selection({ goal: 'lean_athletic', level, daysPerWeek: days }));
          const decision = selectWaterfallDecision(input);
          const label = `${level} ${days}d`;
          assert.equal(decision.rule, 'lean_athletic', label);
          const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
          assert.ok(primary.supportedGoals.includes('lean_athletic'), `${label}: ${primary.programId} does not list the goal`);
          assert.ok(primary.styleTags.includes('conditioning'), `${label}: ${primary.programId} has no conditioning`);
          assert.notEqual(primary.familyId, 'glute_priority', label);
        }
      }
    },
  },
  {
    name: 'recommender fit: the lean & athletic line speaks of fat loss only for a reader whose target is a loss',
    run() {
      const lean = (extra) =>
        selectWaterfallDecision(
          buildRecommendationInput(selection({ gender: 'male', goal: 'lean_athletic', level: 'advanced', daysPerWeek: 4, ...extra })),
        );
      const plain = lean({});
      assert.equal(plain.rule, 'lean_athletic');
      for (const language of ['en', 'fi']) {
        for (const key of [plain.whyPrimary, plain.whyAlternative]) {
          assert.doesNotMatch(t(language, key), /fat loss|rasvanpol/i, `${language}: ${key}`);
        }
      }
      const loss = lean({ currentWeightKg: 80, targetWeightKg: 74 });
      assert.equal(loss.whyPrimary, 'wf.lean_athletic.primaryLoss');
      assert.equal(loss.whyAlternative, 'wf.lean_athletic.altLoss');
      assert.match(t('en', loss.whyPrimary), /fat loss/i);
      assert.match(t('fi', loss.whyPrimary), /rasvanpol/i);
    },
  },
  {
    name: 'recommender fit: a gym beginner at three days or more is not offered the bodyweight starter as the second card',
    run() {
      for (const gender of ['female', 'male']) {
        for (const goal of ['strength', 'muscle', 'lean_athletic']) {
          for (const days of [3, 4, 5, 6]) {
            const sel = selection({ gender, goal, level: 'beginner', daysPerWeek: days });
            const decision = selectWaterfallDecision(buildRecommendationInput(sel));
            if (decision.alternativeProgramId) {
              const alt = getRecommendationProgramDefinition(decision.alternativeProgramId);
              assert.notEqual(alt.equipmentTier, 'low_equipment', `${gender} ${goal} ${days}d: ${alt.programId}`);
            }
          }
        }
      }
      // The two-day gym reader keeps it, as the 2-day base.
      const twoDay = selectWaterfallDecision(
        buildRecommendationInput(selection({ goal: 'strength', level: 'beginner', daysPerWeek: 2 })),
      );
      assert.equal(twoDay.alternativeProgramId, 'tpl_2_day_minimal_full_body_v1');
    },
  },
  {
    name: 'recommender fit: no second card is a week of stretching for a reader who did not ask for recovery',
    run() {
      const GOALS = ['general', 'general_fitness', 'strength', 'muscle', 'lean_athletic'];
      for (const gearName of Object.keys(GEARS)) {
        for (const gender of ['female', 'male', 'unspecified']) {
          for (const goal of GOALS) {
            for (const level of ['beginner', 'intermediate', 'advanced']) {
              for (const days of [2, 3, 4, 5, 6]) {
                const sel = selection({ gear: GEARS[gearName], gender, goal, level, daysPerWeek: days });
                const result = featured(sel);
                const label = `${gearName} ${gender} ${goal} ${level} ${days}d`;
                const primary = getRecommendationProgramDefinition(result.featuredProgramId);
                if (isRecoveryOnlyProgram(primary)) {
                  continue;
                }
                for (const id of result.alternativeProgramIds) {
                  assert.equal(isRecoveryOnlyProgram(getRecommendationProgramDefinition(id)), false, `${label}: ${id}`);
                }
              }
            }
          }
        }
      }
      // The gym beginner at general fitness keeps two real cards at 4-5 days.
      for (const goal of ['general', 'general_fitness']) {
        for (const days of [4, 5]) {
          const result = featured(selection({ gender: 'male', goal, level: 'beginner', daysPerWeek: days }));
          assert.ok(result.alternativeProgramIds.length >= 1, `${goal} ${days}d`);
        }
      }
      // Asking for mobility still gets it.
      const asked = featured(selection({ gender: 'male', goal: 'general', level: 'beginner', daysPerWeek: 5, secondaryOutcomes: ['mobility'] }));
      assert.ok(
        [asked.featuredProgramId, ...asked.alternativeProgramIds].some((id) => isRecoveryOnlyProgram(getRecommendationProgramDefinition(id))),
      );
    },
  },
];
