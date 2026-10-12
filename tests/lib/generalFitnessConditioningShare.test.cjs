const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * A general-fitness week is not a lifting week (owner, 2026-10-12).
 *
 * The owner answered "Parantaa yleiskuntoa" on the device and was offered FIT
 * and FIT Lite: both "Muscle 100 %" on the where-your-week-goes bar, and FIT
 * Lite heavier than FIT. The decision: keep the bar, fix the programmes — a
 * programme offered for general fitness spends 30 to 50 % of its week's time
 * on conditioning, by buildProgramFocusSplit (time-weighted since the same
 * day; it counted sets, so a twenty-minute ride read as one set).
 *
 * "Offered" is what the onboarding pick screen shows for the answer: the two
 * cards it builds (OnboardingScreen programPickOptions — the featured
 * programme, then the next option id) for the general-fitness goal, over every
 * equipment card, level, day count and gender the cards can write. The share
 * is the catalog programme's own; the card shows the composed week's, which
 * a reader's gear and days can move.
 *
 * Some offered programmes sit outside the band and were left alone on purpose:
 * they are muscle, strength or mobility programmes that the goal borrows, and
 * thirty per cent cardio would make them wrong for the goal they are written
 * for. They are named here with their share, so the list can only shrink: an
 * entry that is no longer offered, or has come into the band, fails until it
 * is taken off.
 */
const KNOWN_OUTSIDE = {
  // Muscle programmes that also list general fitness.
  tpl_gainer_calisthenics_mastery_v1: 'Calisthenics Mastery: a skills and muscle week, 4 %',
  tpl_gainer_strong_lean_female_v1: 'Strong & Lean Female: a muscle week with one finisher, 12 %',
  tpl_6_day_ppl_v1: 'HUGE Elite: a six-day hypertrophy split, 0 %',
  // Offered as a backup when nothing for the goal fits the gear or the days.
  tpl_home_dumbbell_strength_v1: 'Home Dumbbell Strength: a strength week, 0 %',
  tpl_home_bodyweight_full_body_v1: 'Bodyweight Full Body: a muscle week, 0 %',
  tpl_home_bodyweight_ppl_v1: 'Bodyweight Push/Pull/Legs: a muscle week, 0 %',
  tpl_home_dumbbell_ppl_v1: 'Home Dumbbell Push/Pull/Legs: a muscle week, 0 %',
  tpl_gainer_beginner_bro_split_v1: 'Bro Split: a muscle week, 0 %',
  tpl_6_day_arnold_v1: 'HUGE Classic: a muscle week, 0 %',
  tpl_focus_glutes_program_v1: 'FOCUS Glutes: a single-area muscle week, 0 %',
  // A conditioning programme a little over the band, which is its point.
  tpl_gainer_fat_burn_hiit_v1: 'Fat Burn HIIT: a HIIT week, 54 %',
};

const MIN_PCT = 30;
const MAX_PCT = 50;

const dist = path.join(__dirname, '..', '..', '.test-dist');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));

const HEAVY = ['Barbell & plates', 'Squat rack'];
const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const homeCard = (items) => {
  if (items.length === 0) return { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] };
  const heavy = items.some((item) => HEAVY.includes(item));
  return { equipment: heavy ? 'home' : 'minimal', trainingEnvironment: heavy ? 'home_gym' : 'minimal_equipment', equipmentItems: items };
};
const bodyweightCard = (items) => ({ equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: items });
const gymCard = (items) => ({ equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: items });
const D = 'Dumbbells', B = 'Bench', R = 'Resistance bands', K = 'Kettlebells', P = 'Pull-up bar';
const BB = 'Barbell & plates', RK = 'Squat rack', C = 'Cardio machines';
// The answer space of tests/recommendation/recommendationMatrix.cjs.
const CARDS = [
  gymCard(GYM_ALL),
  gymCard(GYM_ALL.filter((item) => item !== 'Barbells' && item !== 'Squat rack')),
  gymCard(GYM_ALL.filter((item) => item !== 'Machines' && item !== 'Cables')),
  homeCard([]), homeCard([D]), homeCard([D, B]), homeCard([D, B, R]), homeCard([D, P]), homeCard([D, K]),
  homeCard([D, B, R, P]), homeCard([R]), homeCard([K]), homeCard([P]), homeCard([R, P]), homeCard([BB, RK]),
  homeCard([BB, RK, B]), homeCard([D, B, RK, BB]), homeCard([D, B, RK, BB, P]), homeCard([D, B, RK, BB, R, K, P]),
  homeCard([D, B, C]),
  bodyweightCard([]), bodyweightCard([P]), bodyweightCard([R]), bodyweightCard([P, R, 'Yoga mat']),
];

let offeredCache = null;
/** Every programme the pick screen shows for a general-fitness answer. */
function offeredForGeneralFitness() {
  if (offeredCache) return offeredCache;
  const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
  const { buildRecommendationOptionIds } = lib('recommendationPresentation');
  const offered = new Set();
  for (const card of CARDS) {
    for (const level of ['beginner', 'advanced', 'pro']) {
      for (const daysPerWeek of [2, 3, 4, 5, 6]) {
        for (const gender of ['unspecified', 'male', 'female']) {
          const selection = {
            gender, ageRange: '19_25', goal: 'general_fitness', goals: ['general_fitness'], level, daysPerWeek,
            equipment: card.equipment, trainingEnvironment: card.trainingEnvironment, equipmentItems: card.equipmentItems,
            secondaryOutcomes: [], focusAreas: [], cautionFlags: [], guidanceMode: 'guided_editable',
            scheduleMode: 'app_managed', automatedProgression: true, weeklyMinutes: null, availableDays: [],
            trainingCyclePattern: null, currentWeightKg: null, targetWeightKg: null, unitPreference: 'kg',
          };
          const recommendation = resolveFirstRunRecommendationWithTailoring(selection, {
            setupEquipment: selection.equipment,
            setupFreeWeightsPreference: 'neutral',
            setupBodyweightPreference: 'neutral',
            setupMachinesPreference: 'neutral',
            setupShoulderFriendlySwaps: 'neutral',
            setupElbowFriendlySwaps: 'neutral',
            setupKneeFriendlySwaps: 'neutral',
          }, 'en');
          // The screen's two cards: the featured programme, then the next option.
          const ids = [
            recommendation.featuredProgramId,
            ...buildRecommendationOptionIds(recommendation).filter((id) => id !== recommendation.featuredProgramId),
          ].slice(0, 2);
          for (const id of ids) offered.add(id);
        }
      }
    }
  }
  offeredCache = [...offered].sort();
  return offeredCache;
}

function conditioningPct(programId) {
  const { buildProgramFocusSplit } = lib('programFocusSplit');
  const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));
  const template = getWorkoutTemplateById(programId);
  assert.ok(template, `${programId} is in the catalog`);
  return buildProgramFocusSplit(template.sessions).find((segment) => segment.quality === 'Conditioning')?.pct ?? 0;
}

module.exports = [
  {
    name: 'general fitness: every programme offered for it spends 30-50 % of its week on conditioning, or is a named exception',
    run() {
      const offered = offeredForGeneralFitness();
      assert.ok(offered.length >= 10, `only ${offered.length} programmes offered: did the answer space change?`);

      const outside = [];
      for (const programId of offered) {
        const pct = conditioningPct(programId);
        if ((pct < MIN_PCT || pct > MAX_PCT) && !(programId in KNOWN_OUTSIDE)) {
          outside.push(`${programId}: conditioning ${pct} %`);
        }
      }
      assert.deepEqual(outside, [], 'a general-fitness answer offers a week outside 30-50 % conditioning');

      // The exceptions hold only while they are true.
      const stale = [];
      for (const programId of Object.keys(KNOWN_OUTSIDE)) {
        if (!offered.includes(programId)) {
          stale.push(`${programId}: no longer offered for general fitness`);
          continue;
        }
        const pct = conditioningPct(programId);
        if (pct >= MIN_PCT && pct <= MAX_PCT) stale.push(`${programId}: now ${pct} %, inside the band`);
      }
      assert.deepEqual(stale, [], 'take these off KNOWN_OUTSIDE');
    },
  },
  {
    name: 'general fitness: FIT leans to lifting, FIT Lite to cardio, and FIT Lite is the lighter week with legs on two days',
    run() {
      const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));
      const { readyTemplateCardMinutes } = lib('programmeMinutes');
      const fit = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const lite = getWorkoutTemplateById('tpl_3_day_upper_lower_lite_v1');
      const fitPct = conditioningPct(fit.id);
      const litePct = conditioningPct(lite.id);
      for (const [name, pct] of [['FIT', fitPct], ['FIT Lite', litePct]]) {
        assert.ok(pct >= MIN_PCT && pct <= MAX_PCT, `${name}: conditioning ${pct} %`);
      }
      assert.ok(litePct > fitPct, `FIT Lite ${litePct} % is the cardio-leaning one, FIT ${fitPct} %`);

      assert.equal(fit.daysPerWeek, 3);
      assert.equal(lite.daysPerWeek, 3);
      const CARDIO_GROUPS = new Set(['cardio_intervals', 'running_blocks', 'steady_cardio']);
      const liftingSets = (template) =>
        template.sessions.flatMap((session) => session.exercises)
          .filter((exercise) => !CARDIO_GROUPS.has(exercise.substitutionGroup))
          .reduce((sum, exercise) => sum + exercise.sets, 0);
      assert.ok(liftingSets(lite) < liftingSets(fit), `FIT Lite lifts ${liftingSets(lite)} sets a week, FIT ${liftingSets(fit)}`);
      assert.ok(
        readyTemplateCardMinutes(lite) <= readyTemplateCardMinutes(fit),
        `FIT Lite ${readyTemplateCardMinutes(lite)} min against FIT ${readyTemplateCardMinutes(fit)}`,
      );
      // The card numbers are honest: the hand-written one agrees with them.
      for (const template of [fit, lite]) {
        assert.equal(template.estimatedSessionDuration, readyTemplateCardMinutes(template), template.name);
      }

      const LEGS = new Set(['squat_pattern', 'hinge_pattern', 'single_leg', 'accessory_hamstrings']);
      const legDays = lite.sessions.filter((session) => session.exercises.some((exercise) => LEGS.has(exercise.substitutionGroup)));
      assert.ok(legDays.length >= 2, `FIT Lite trains legs on ${legDays.length} day(s)`);
    },
  },
];
