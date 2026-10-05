const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const {
  resolveProgramEquipmentBucket,
  resolveProgramEquipment,
} = require('../../.test-dist/lib/programEquipment.js');
const { getReadyProgramEquipmentBucket } = require('../../.test-dist/lib/workoutDiscovery.js');

/**
 * Which programmes can be trained without a gym.
 *
 * The bucket used to be read out of the English equipment sentence — a
 * programme counted as low-equipment if that prose said "bodyweight",
 * "minimal setup" or "no heavy equipment" — so a copy edit moved programmes
 * between buckets, and the recommendation score and the catalog's equipment
 * filter both moved with it. Mobility Flow needs a band and a mat and said so
 * in words the rule did not know, so it was scored as a full-gym programme.
 *
 * The list below is the answer derived from the exercises. It is written out
 * rather than recomputed, because a programme joining or leaving it changes
 * who gets recommended what, and that should be a decision somebody made.
 */
const LOW_EQUIPMENT_PROGRAMS = [
  'tpl_2_day_minimal_full_body_v1',
  'tpl_2_day_mobility_reset_v1',
  'tpl_2_day_yoga_recovery_v1',
  'tpl_3_day_run_mobility_v1',
  'tpl_season_summer_v1',
  'tpl_gainer_fat_burn_hiit_v1',
  'tpl_gainer_mobility_flow_v1',
  'tpl_gainer_at_home_beginner_v1',
  'tpl_gainer_postpartum_recovery_v1',
  // Dumbbells only: four days at home (coverage sweep, 2026-10-04).
  'tpl_home_dumbbell_upper_lower_v1',
  'tpl_home_dumbbell_ppl_v1',
  'tpl_home_dumbbell_strength_v1',
  'tpl_home_dumbbell_strength_split_v1',
  'tpl_home_bodyweight_upper_lower_v1',
  'tpl_home_athletic_5_day_v1',
  // Strength with no load: hard variations at low reps. The five-day one asks for
  // a pull-up bar, and turns its pull-ups into rows without one.
  'tpl_home_bodyweight_strength_3_day_v1',
  'tpl_home_calisthenics_strength_5_day_v1',
  // A pull-up bar and a floor. It read as full-gym only because "Nordic
  // Hamstring Curl (Assisted)" and "Lower Back Curl" were refused as barbell
  // curls, and its page listed Barbells (sweep, 2026-10-04).
  'tpl_gainer_calisthenics_mastery_v1',
];

function exerciseNames(template) {
  return template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
}

module.exports = [
  {
    name: 'the low-equipment programmes are exactly the ones whose exercises need no gym',
    run() {
      const low = WORKOUT_TEMPLATES_V1.filter(
        (template) => resolveProgramEquipmentBucket(exerciseNames(template)) === 'low_equipment',
      ).map((template) => template.id);

      assert.deepEqual(
        low.slice().sort(),
        LOW_EQUIPMENT_PROGRAMS.slice().sort(),
        'a programme changed equipment bucket — decide whether that is right, then update the list',
      );
    },
  },
  {
    name: 'every low-equipment programme asks only for gear that fits in a room',
    run() {
      const HOME = new Set(['Dumbbells', 'Kettlebells', 'Resistance bands', 'Yoga mat', 'Pull-up bar']);
      for (const id of LOW_EQUIPMENT_PROGRAMS) {
        const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === id);
        assert.ok(template, `${id} is not in the catalog`);
        for (const chip of resolveProgramEquipment(exerciseNames(template))) {
          assert.ok(HOME.has(chip), `${id} is bucketed low but needs ${chip}`);
        }
      }
    },
  },
  {
    name: 'the catalog filter and the tailoring score read the same bucket',
    run() {
      // Two modules each kept their own copy of a hardcoded id list beside
      // their own copy of the prose rule. One function answers now, so the
      // filter cannot disagree with the score about the same programme.
      for (const template of WORKOUT_TEMPLATES_V1) {
        assert.equal(
          getReadyProgramEquipmentBucket({ template, content: null }),
          resolveProgramEquipmentBucket(exerciseNames(template)),
          `${template.id} buckets differently through the discovery filter`,
        );
      }
    },
  },
  {
    name: 'the bucket does not move when the equipment copy is rewritten',
    run() {
      // The regression itself: the discovery filter takes the content object,
      // and used to parse this sentence. Handing it prose that says the
      // opposite of the truth must change nothing.
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === 'tpl_3_day_strength_base_v1');
      assert.ok(template, 'the strength base programme left the catalog');
      const lying = { equipmentProfile: 'Bodyweight only, a minimal setup with no heavy equipment.' };
      assert.equal(getReadyProgramEquipmentBucket({ template, content: lying }), 'full_gym');
    },
  },
];
