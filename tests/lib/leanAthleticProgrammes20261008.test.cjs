const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const { DEFAULT_FIRST_RUN_SELECTION, resolveFirstRunRecommendationWithTailoring } = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { getRecommendationProgramDefinition } = require(dist + 'lib/recommendationCatalog.js');
const { getWorkoutTemplateById, WORKOUT_TEMPLATES_V1 } = require(dist + 'features/workout/workoutCatalog.js');
const { createSeedExerciseLibrary } = require(dist + 'data/seed.js');
const { findGuidedLibraryIndex } = require(dist + 'lib/guidedPlayer.js');
const { getReadyProgramBlockWeeks } = require(dist + 'lib/readyProgramDuration.js');
const { estimateProgrammeSessionMinutesList, readyTemplateCardMinutes } = require(dist + 'lib/programmeMinutes.js');
const { buildProgramFocusSplit } = require(dist + 'lib/programFocusSplit.js');
const { programFitsEquipment } = require(dist + 'lib/programEquipmentFit.js');
const { resolveProgramEquipment, resolveProgramEquipmentBucket } = require(dist + 'lib/programEquipment.js');
const { getReadyProgramContent } = require(dist + 'lib/readyProgramContent.js');
const { t } = require(dist + 'lib/i18n.js');

/**
 * Three unisex lean and athletic weeks for the readers the goal had no week
 * for (owner, 2026-10-08).
 *
 * Measured before the change, for lean and athletic with a full gym: an
 * advanced or pro reader asking four to six days got SHRED (three days) padded
 * with light filler days, a pro got Athlete Conditioning cut to four, an
 * advanced woman asking six got Runner's Strength (no upper body) and three
 * fillers, and an advanced man got the men-only Lean Shred Cut. A reader with
 * dumbbells, a bench and bands got Fat Burn HIIT (four days) stretched to
 * anything from two to six.
 *
 *  - Athletic Upper/Lower: gym, four days.
 *  - Athletic Performance: gym, five days. Six days is these five and the
 *    composer's one light day.
 *  - Home Dumbbell Athletic: dumbbells, a bench and bands, five days.
 *
 * Beginners are held to three days by the waterfall, so none of these is
 * for them.
 */
const UL4 = 'tpl_athletic_upper_lower_4_day_v1';
const PERF5 = 'tpl_athletic_performance_5_day_v1';
const HOME5 = 'tpl_home_dumbbell_athletic_5_day_v1';
const ALL = [UL4, PERF5, HOME5];
const GYM_PROGRAMMES = [UL4, PERF5];

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const GYM = { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL };
const HOME_DUMBBELLS = {
  equipment: 'minimal',
  trainingEnvironment: 'minimal_equipment',
  equipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'],
};

function selectionFor(card, gender, level, daysPerWeek) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    gender,
    goal: 'lean_athletic',
    goals: ['lean_athletic'],
    level,
    daysPerWeek,
    availableDays: [],
    scheduleMode: 'app_managed',
    secondaryOutcomes: [],
    focusAreas: [],
    ...card,
  };
}

function featured(card, gender, level, daysPerWeek) {
  const selection = selectionFor(card, gender, level, daysPerWeek);
  return resolveFirstRunRecommendationWithTailoring(selection, { setupEquipment: selection.equipment }, 'en').featuredProgramId;
}

const library = createSeedExerciseLibrary();
const libraryNames = library.map((item) => item.name);
const template = (id) => {
  const found = getWorkoutTemplateById(id);
  assert.ok(found, `${id} is in the catalog`);
  return found;
};
const exercisesOf = (id) => template(id).sessions.flatMap((session) => session.exercises);
const sumSets = (exercises, test) => exercises.filter(test).reduce((sum, exercise) => sum + exercise.sets, 0);

const PRESS = new Set(['horizontal_press', 'vertical_press', 'bodyweight_press']);
const PULL = new Set(['horizontal_pull', 'vertical_pull', 'bodyweight_pull', 'cable_machine_row']);
const isPress = (exercise) => PRESS.has(exercise.substitutionGroup);
const isPull = (exercise) =>
  PULL.has(exercise.substitutionGroup) || /rear delt|face pull|pull-apart|renegade row/i.test(exercise.exerciseName);
// Quads: squats, single-leg work and jumps. Hinge: hinges, deadlifts, bridges, swings and slams.
const QUAD = new Set(['squat_pattern', 'single_leg', 'jump_plyo', 'bodyweight_squat_pattern']);
const HINGE = new Set(['hinge_pattern', 'deadlift_pattern', 'bodyweight_hinge', 'hip_thrust_bridge', 'accessory_hamstrings']);
const isQuad = (exercise) => QUAD.has(exercise.substitutionGroup) && !/thruster/i.test(exercise.exerciseName);
const isHinge = (exercise) => HINGE.has(exercise.substitutionGroup) || /swing|clean/i.test(exercise.exerciseName);
const isHeavyHinge = (exercise) =>
  (exercise.substitutionGroup === 'hinge_pattern' || exercise.substitutionGroup === 'deadlift_pattern')
  && exercise.trackingMode === 'load_and_reps'
  && exercise.repsMax <= 6;
const LOWER_GROUPS = new Set([...QUAD, ...HINGE, 'deadlift_pattern', 'calves']);
const isLowerLoad = (exercise) => exercise.role !== 'accessory' && LOWER_GROUPS.has(exercise.substitutionGroup);

module.exports = [
  {
    name: 'lean athletic: a full gym, advanced or pro, either gender: four days is the four-day week, five and six the five-day week',
    run() {
      for (const gender of ['female', 'male']) {
        for (const level of ['advanced', 'pro']) {
          assert.equal(featured(GYM, gender, level, 4), UL4, `${gender} ${level} 4d`);
          assert.equal(featured(GYM, gender, level, 5), PERF5, `${gender} ${level} 5d`);
          assert.equal(featured(GYM, gender, level, 6), PERF5, `${gender} ${level} 6d`);
        }
      }
    },
  },
  {
    name: 'lean athletic: dumbbells, a bench and bands, advanced or pro: five and six days are the home five-day week, and four is not stretched to it',
    run() {
      for (const gender of ['female', 'male']) {
        for (const level of ['advanced', 'pro']) {
          assert.equal(featured(HOME_DUMBBELLS, gender, level, 5), HOME5, `${gender} ${level} 5d`);
          assert.equal(featured(HOME_DUMBBELLS, gender, level, 6), HOME5, `${gender} ${level} 6d`);
          // Four days keeps the four-day week that sits exactly on it.
          assert.notEqual(featured(HOME_DUMBBELLS, gender, level, 4), HOME5, `${gender} ${level} 4d`);
        }
      }
    },
  },
  {
    name: 'lean athletic: six days is the five-day week and one light day, never a second filler or a trimmed week',
    run() {
      for (const [card, level, programId] of [
        [GYM, 'advanced', PERF5],
        [GYM, 'pro', PERF5],
        [HOME_DUMBBELLS, 'advanced', HOME5],
        [HOME_DUMBBELLS, 'pro', HOME5],
      ]) {
        const selection = selectionFor(card, 'female', level, 6);
        const week = composeProgramWeekForSelection(selection, programId);
        assert.equal(week.days, 6, `${programId} ${level}`);
        const suggested = week.sessions.filter((session) => session.source === 'suggested');
        assert.equal(suggested.length, 1, `${programId} ${level}: one added day`);
        assert.equal(week.sessions.filter((session) => session.source === 'template').length, 5, `${programId} ${level}`);
      }
    },
  },
  {
    name: 'lean athletic: a beginner is never handed one of these, at any gear or day count',
    run() {
      for (const card of [GYM, HOME_DUMBBELLS]) {
        for (const gender of ['female', 'male']) {
          for (const days of [2, 3, 4, 5, 6]) {
            const id = featured(card, gender, 'beginner', days);
            assert.ok(!ALL.includes(id), `${gender} beginner ${days}d was handed ${id}`);
          }
        }
      }
    },
  },
  {
    name: 'lean athletic: unisex, advanced and pro, written for the goal alone, on the right shelf',
    run() {
      for (const id of ALL) {
        const definition = getRecommendationProgramDefinition(id);
        assert.ok(definition, id);
        assert.equal(definition.targetGender, 'unisex', id);
        assert.deepEqual(definition.supportedLevels, ['advanced', 'pro'], id);
        assert.deepEqual(definition.supportedGoals, ['lean_athletic'], id);
        assert.ok(definition.styleTags.includes('conditioning'), `${id}: the lean lane picks from the conditioning tag`);
        assert.equal(definition.equipmentTier, GYM_PROGRAMMES.includes(id) ? 'full_gym' : 'low_equipment', id);
      }
      assert.equal(getRecommendationProgramDefinition(UL4).daysPerWeek, 4);
      assert.equal(getRecommendationProgramDefinition(PERF5).daysPerWeek, 5);
      assert.equal(getRecommendationProgramDefinition(HOME5).daysPerWeek, 5);
    },
  },
  {
    name: 'lean athletic: day counts agree with the sessions, and each runs 8 to 12 weeks',
    run() {
      for (const [id, days] of [[UL4, 4], [PERF5, 5], [HOME5, 5]]) {
        const found = template(id);
        assert.equal(found.daysPerWeek, days, id);
        assert.equal(found.sessions.length, days, id);
        found.sessions.forEach((session, index) => assert.equal(session.orderIndex, index + 1, `${id} ${session.id}`));
        const weeks = getReadyProgramBlockWeeks(found);
        assert.ok(weeks >= 8 && weeks <= 12, `${id}: ${weeks} weeks`);
      }
    },
  },
  {
    name: 'lean athletic: one rep number per lift (holds keep a seconds range), ids unique, every lift resolves in the library',
    run() {
      const seen = new Set();
      for (const id of ALL) {
        for (const session of template(id).sessions) {
          assert.ok(!seen.has(session.id), `session id ${session.id} is unique`);
          seen.add(session.id);
          for (const exercise of session.exercises) {
            assert.ok(!seen.has(exercise.id), `exercise id ${exercise.id} is unique`);
            seen.add(exercise.id);
            if (exercise.trackingMode === 'hold') {
              assert.ok(exercise.repsMin <= exercise.repsMax, `${exercise.id}: a hold keeps its seconds bracket`);
            } else {
              assert.equal(exercise.repsMin, exercise.repsMax, `${id} ${exercise.id}: ${exercise.repsMin}-${exercise.repsMax}`);
            }
            assert.notEqual(
              findGuidedLibraryIndex(exercise.exerciseName, libraryNames),
              null,
              `${id}: "${exercise.exerciseName}" has no library row`,
            );
          }
        }
      }
    },
  },
  {
    name: 'lean athletic: every lift files under a swap group that holds its own name',
    run() {
      const groups = new Map();
      const { WORKOUT_SUBSTITUTION_GROUPS } = require(dist + 'features/workout/workoutCatalog.js');
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) groups.set(group.id, group.allowedExerciseNames);
      for (const id of ALL) {
        for (const exercise of exercisesOf(id)) {
          const allowed = groups.get(exercise.substitutionGroup);
          assert.ok(allowed, `${id}: group ${exercise.substitutionGroup} exists`);
          assert.ok(allowed.includes(exercise.exerciseName), `${id}: ${exercise.exerciseName} is in ${exercise.substitutionGroup}`);
        }
      }
    },
  },
  {
    name: 'lean athletic: each week pulls at least as many sets as it presses (no more than 1.5 times), and trains quads and hinges within 0.7 to 1.4 of each other',
    run() {
      for (const id of ALL) {
        const exercises = exercisesOf(id);
        const press = sumSets(exercises, isPress);
        const pull = sumSets(exercises, isPull);
        assert.ok(pull >= press && pull <= 1.5 * press, `${id}: ${pull} pull sets against ${press} press sets`);
        const quad = sumSets(exercises, isQuad);
        const hinge = sumSets(exercises, isHinge);
        const ratio = quad / hinge;
        assert.ok(ratio >= 0.7 && ratio <= 1.4, `${id}: ${quad} quad sets against ${hinge} hinge sets (${ratio.toFixed(2)})`);
      }
    },
  },
  {
    name: 'lean athletic: the gym weeks hold one heavy hinge, and the session after it is an upper-body day',
    run() {
      for (const id of GYM_PROGRAMMES) {
        const sessions = template(id).sessions;
        const heavy = sessions.map((session, index) => (session.exercises.some(isHeavyHinge) ? index : -1)).filter((index) => index >= 0);
        assert.equal(heavy.length, 1, `${id}: ${heavy.length} heavy hinge days`);
        const next = sessions[(heavy[0] + 1) % sessions.length];
        assert.ok(!next.exercises.some(isLowerLoad), `${id}: ${next.name} follows the heavy hinge with lower-body work`);
        // And the heavy hinge is a lower-body day, not tucked into an upper one.
        assert.ok(sessions[heavy[0]].exercises.filter(isLowerLoad).length >= 3, `${id}: ${sessions[heavy[0]].name}`);
      }
      // The home week has no barbell, so no heavy hinge to space out.
      assert.equal(template(HOME5).sessions.filter((session) => session.exercises.some(isHeavyHinge)).length, 0);
    },
  },
  {
    name: 'lean athletic: upper and lower days alternate, with no two lower-body days back to back in the rotation',
    run() {
      for (const id of ALL) {
        const sessions = template(id).sessions;
        const lowerDay = sessions.map((session) => session.exercises.filter(isLowerLoad).length >= 3);
        for (let index = 0; index < sessions.length; index += 1) {
          const next = (index + 1) % sessions.length;
          assert.ok(!(lowerDay[index] && lowerDay[next]), `${id}: ${sessions[index].name} then ${sessions[next].name}`);
        }
      }
    },
  },
  {
    name: 'lean athletic: sessions run 40 to 55 minutes by the estimator, and the hand-written figure is the card figure',
    run() {
      for (const id of ALL) {
        const found = template(id);
        for (const [index, minutes] of estimateProgrammeSessionMinutesList(found.sessions).entries()) {
          assert.ok(minutes >= 40 && minutes <= 55, `${id} ${found.sessions[index].name}: ${minutes} min`);
        }
        assert.equal(found.estimatedSessionDuration, readyTemplateCardMinutes(found), `${id}: estimatedSessionDuration`);
      }
    },
  },
  {
    name: 'lean athletic: the week says what it is: conditioning is at least 15 percent of the lifts, and the weeks are not a conditioning programme',
    run() {
      for (const id of ALL) {
        const split = buildProgramFocusSplit(template(id).sessions);
        const conditioning = split.find((segment) => segment.quality === 'Conditioning')?.pct ?? 0;
        assert.ok(conditioning >= 15 && conditioning <= 40, `${id}: conditioning ${conditioning}`);
      }
    },
  },
  {
    name: 'lean athletic: the home week needs a pair of dumbbells and nothing else (no barbell, no machine), and runs for a reader with a bench and bands too',
    run() {
      const names = exercisesOf(HOME5).map((exercise) => exercise.exerciseName);
      assert.deepEqual(resolveProgramEquipment(names), ['Dumbbells']);
      assert.equal(resolveProgramEquipmentBucket(names), 'low_equipment');
      for (const chips of [['Dumbbells', 'Bench', 'Resistance bands'], ['Dumbbells', 'Bench'], ['Dumbbells']]) {
        assert.equal(programFitsEquipment(HOME5, chips), true, chips.join('+'));
      }
      // And the gym weeks are the other shelf: they ask for a barbell and a rack.
      for (const id of GYM_PROGRAMMES) {
        assert.equal(programFitsEquipment(id, ['Dumbbells', 'Bench', 'Resistance bands']), false, id);
        assert.equal(programFitsEquipment(id, GYM_ALL), true, id);
      }
    },
  },
  {
    name: 'lean athletic: the programmes the new weeks replaced as first choice are still on offer for the goal, as backups',
    run() {
      for (const id of ['tpl_gainer_lean_shred_v1', 'tpl_gainer_athlete_conditioning_v1', 'tpl_shred_elite_v1']) {
        const definition = getRecommendationProgramDefinition(id);
        assert.ok(definition.backupGoals.includes('lean_athletic'), id);
        assert.ok(!definition.supportedGoals.includes('lean_athletic'), `${id} listed the goal outright and outbid the new weeks`);
      }
    },
  },
  {
    name: 'lean athletic: the pages and cards read in both languages',
    run() {
      for (const id of ALL) {
        for (const language of ['en', 'fi']) {
          const content = getReadyProgramContent(id, language);
          assert.ok(content, `${id} ${language}`);
          for (const field of ['summary', 'audience', 'equipmentProfile', 'whyItWorks']) {
            assert.ok(content[field] && content[field].trim().length > 20, `${id} ${language} ${field}`);
          }
        }
        const english = getReadyProgramContent(id, 'en');
        const finnish = getReadyProgramContent(id, 'fi');
        for (const field of ['summary', 'audience', 'equipmentProfile', 'whyItWorks']) {
          assert.notEqual(finnish[field], english[field], `${id}.${field} was left in English`);
        }
        const key = `prog.sub.${id}`;
        assert.notEqual(t('en', key), key, `${key} has no English line`);
        assert.notEqual(t('fi', key), t('en', key), `${key} has no Finnish line`);
        assert.ok(WORKOUT_TEMPLATES_V1.some((entry) => entry.id === id));
      }
    },
  },
];
