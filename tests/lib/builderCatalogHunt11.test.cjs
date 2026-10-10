const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const eq = require('../../.test-dist/lib/equipmentExerciseFilter');
const { buildSwapAlternatives } = require('../../.test-dist/lib/swapPickerLists');
const { buildTailoredSwapOptions } = require('../../.test-dist/lib/tailoringFit');
const { clampProgrammeName, PROGRAMME_NAME_MAX } = require('../../.test-dist/lib/templateBuilderSteps');
const { buildFirstRunRecommendationReasons, DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup');
const { buildProgramFocusSplit } = require('../../.test-dist/lib/programFocusSplit');
const { isInCategory } = require('../../.test-dist/lib/programCategories');
const { meetsMobilityFocus, getProgramFocusTags } = require('../../.test-dist/lib/programCatalogFocus');
const { buildDuplicatedCustomProgramDraft } = require('../../.test-dist/lib/customProgramDuplication');
const { formatPlanSessionTitle } = require('../../.test-dist/lib/sessionNameLabel');
const { getReadyTemplatePresentation } = require('../../.test-dist/lib/templatePresentation');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary');
const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary');
const { displayEquipmentValue } = require('../../.test-dist/lib/libraryLabel');
const {
  WORKOUT_TEMPLATES_V1,
  WORKOUT_SUBSTITUTION_GROUPS,
  getWorkoutTemplateById,
} = require('../../.test-dist/features/workout/workoutCatalog');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

function exercise(name) {
  return {
    id: `ex_${name.replace(/\W+/g, '_').toLowerCase()}`,
    exerciseName: name,
    slotId: 'slot',
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin: 8,
    repsMax: 10,
    restSecondsMin: 60,
    restSecondsMax: 120,
    substitutionGroup: 'none',
  };
}

const poolNames = [...new Set(WORKOUT_SUBSTITUTION_GROUPS.flatMap((group) => group.allowedExerciseNames))];
const libraryByName = new Map(
  [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY].map((item) => [item.name.trim().toLowerCase(), item]),
);

const HOME_DB_BENCH = ['Dumbbells', 'Bench', 'Resistance bands'];
const PREFS = (items) => ({
  setupEquipment: 'minimal',
  setupFreeWeightsPreference: 'neutral',
  setupMachinesPreference: 'neutral',
  setupBodyweightPreference: 'neutral',
  setupShoulderFriendlySwaps: 'neutral',
  setupElbowFriendlySwaps: 'neutral',
  setupKneeFriendlySwaps: 'neutral',
  setupTrainingEnvironment: items.length ? 'minimal_equipment' : 'bodyweight_only',
  setupEquipmentItems: items,
});

module.exports = [
  {
    name: 'hunt 11: dumbbell bench presses need dumbbells and a bench, not a barbell',
    run() {
      for (const name of [
        'Dumbbell Bench Press',
        'Decline Dumbbell Bench Press',
        'One Arm Dumbbell Bench Press',
        'Dumbbell Bench Press with Neutral Grip',
        'Hammer Grip Incline DB Bench Press',
        'Incline Dumbbell Press',
      ]) {
        assert.equal(eq.isExerciseAllowedWithEquipment(name, ['Dumbbells', 'Bench']), true, name);
        assert.equal(eq.isExerciseAllowedWithEquipment(name, ['Dumbbells']), false, `${name} with no bench`);
        assert.equal(eq.isExerciseAllowedWithEquipment(name, ['Bench', 'Barbells']), false, `${name} with no dumbbells`);
      }
      // The machine press is a machine's, the barbell press is still a barbell's.
      assert.equal(eq.isExerciseAllowedWithEquipment('Machine Bench Press', ['Machines']), true);
      assert.equal(eq.isExerciseAllowedWithEquipment('Machine Bench Press', ['Dumbbells', 'Bench']), false);
      assert.equal(eq.isExerciseAllowedWithEquipment('Barbell Bench Press - Medium Grip', ['Dumbbells', 'Bench']), false);
      assert.equal(eq.isExerciseAllowedWithEquipment('Barbell Bench Press - Medium Grip', ['Barbells', 'Bench']), true);
    },
  },
  {
    name: 'hunt 11: a dumbbells-and-bench reader keeps the bench and incline press as dumbbell presses',
    run() {
      const result = eq.applyEquipmentToExercises(
        [exercise('Bench Press'), exercise('Incline Bench Press')],
        ['Dumbbells', 'Bench'],
      );
      assert.deepEqual(
        result.exercises.map((entry) => entry.exerciseName),
        ['Dumbbell Bench Press', 'Incline Dumbbell Press'],
      );
      // With no bench the floor press is still the answer, never a bench lift.
      const noBench = eq.applyEquipmentToExercises(
        [exercise('Bench Press'), exercise('Incline Bench Press')],
        ['Dumbbells'],
      );
      assert.deepEqual(
        noBench.exercises.map((entry) => entry.exerciseName),
        ['Dumbbell Floor Press', 'Push-Up Wide'],
      );
      // A machine gym still gets the machine press first.
      const machines = eq.applyEquipmentToExercises([exercise('Bench Press')], ['Machines', 'Dumbbells', 'Bench']);
      assert.equal(machines.exercises[0].exerciseName, 'Leverage Chest Press');
    },
  },
  {
    name: 'hunt 11: no catalog programme hands a reader a lift their gear lacks, and the swap sheet offers the dumbbell bench press',
    run() {
      for (const gear of [['Dumbbells', 'Bench'], ['Dumbbells'], ['Barbells', 'Bench'], []]) {
        for (const template of WORKOUT_TEMPLATES_V1) {
          for (const session of template.sessions) {
            const adjusted = eq.applyEquipmentToExercises(session.exercises, gear);
            for (const entry of adjusted.exercises) {
              assert.equal(
                eq.isExerciseAllowedWithEquipment(entry.exerciseName, gear),
                true,
                `${template.id}: ${entry.exerciseName} for ${gear.join('+') || 'no gear'}`,
              );
            }
          }
        }
      }
      const offered = buildSwapAlternatives({
        currentName: 'Dumbbell Floor Press',
        substitutionGroup: 'horizontal_press',
        preferences: PREFS(HOME_DB_BENCH),
        sessionLifts: ['Dumbbell Floor Press'],
        query: '',
        language: 'en',
      });
      assert.ok(offered.includes('Dumbbell Bench Press'), offered.join(', '));
      assert.ok(!offered.includes('Machine Chest Press'));
    },
  },
  {
    name: 'hunt 11: the pec deck needs a machine and the EZ-bar curl a bar',
    run() {
      for (const gear of [[], ['Dumbbells', 'Bench', 'Resistance bands']]) {
        assert.equal(eq.isExerciseAllowedWithEquipment('Pec Deck', gear), false);
        assert.equal(eq.isExerciseAllowedWithEquipment('Butterfly', gear), false);
        assert.equal(eq.isExerciseAllowedWithEquipment('EZ-Bar Curl', gear), false);
        assert.equal(eq.isExerciseAllowedWithEquipment('Close-Grip EZ Bar Curl', gear), false);
      }
      assert.equal(eq.isExerciseAllowedWithEquipment('Pec Deck', ['Machines']), true);
      assert.equal(eq.isExerciseAllowedWithEquipment('Butterfly', ['Machines']), true);
      assert.equal(eq.isExerciseAllowedWithEquipment('EZ-Bar Curl', ['Barbells']), true);
      // The hip stretch of that name is not the machine.
      assert.equal(eq.isExerciseAllowedWithEquipment('Butterfly Stretch', []), true);
      // And a bodyweight-only reader is not offered either in the chest fly's swap sheet.
      const offered = buildSwapAlternatives({
        currentName: 'Push-Up Wide',
        substitutionGroup: 'chest_fly',
        preferences: PREFS([]),
        sessionLifts: ['Push-Up Wide'],
        query: '',
        language: 'en',
      });
      assert.ok(!offered.includes('Pec Deck'), offered.join(', '));
      // A custom programme's EZ-bar curl falls back to a curl the gear allows.
      const swapped = eq.applyEquipmentToExercises([exercise('EZ-Bar Curl')], ['Dumbbells']);
      assert.equal(swapped.exercises[0].exerciseName, 'Dumbbell Bicep Curl');
    },
  },
  {
    name: 'hunt 11: every swap-pool lift that passes for a reader with no gear is one that needs none',
    run() {
      // A pool member that is filed as loaded gear (barbell, cable, machine,
      // kettlebell) in the library, or says so in its name, and still passes
      // an empty kit has no rule that knows what it needs. Dumbbell rows stay
      // allowed where the lift is done bodyweight too (lunges, split squats).
      const GEAR_WORDS =
        /barbell|cable|machine|pec deck|butterfly(?! stretch)|\bez\b|ez-bar|kettlebell|smith|lever|sled|rope|pulldown|dumbbell|\bdb\b/i;
      const unknown = [];
      for (const name of poolNames) {
        if (!eq.isExerciseAllowedWithEquipment(name, [])) {
          continue;
        }
        const row = libraryByName.get(name.trim().toLowerCase());
        const filed = row ? displayEquipmentValue(row) : null;
        if (filed && !['bodyweight', 'foam roll', 'dumbbell'].includes(filed)) {
          unknown.push(`${name} (${filed})`);
        } else if (GEAR_WORDS.test(name)) {
          unknown.push(`${name} (name)`);
        }
      }
      assert.deepEqual(unknown, []);
    },
  },
  {
    name: 'hunt 11: a day of a programme is renamed to at most PROGRAMME_NAME_MAX characters, in the input and the handler',
    run() {
      assert.equal(PROGRAMME_NAME_MAX, 60);
      assert.equal(clampProgrammeName('  Push  '), 'Push');
      assert.equal(clampProgrammeName('x'.repeat(200)).length, PROGRAMME_NAME_MAX);
      assert.equal(clampProgrammeName(`${'x'.repeat(59)} tail`), 'x'.repeat(59));
      assert.equal(clampProgrammeName('   '), '');
      const handler = read('src', 'app', 'programmeDayEdits.tsx');
      assert.match(handler, /const trimmed = clampProgrammeName\(name\);/);
      const home = read('src', 'screens', 'HomeScreen.tsx');
      const at = home.indexOf('style={styles.todayRenameInput}');
      assert.ok(at > 0);
      assert.match(home.slice(at - 400, at), /maxLength=\{PROGRAMME_NAME_MAX\}/);
    },
  },
  {
    name: 'hunt 11: "Also keeps conditioning/mobility" is said only over a week that holds it',
    run() {
      const HELD_PCT = 15;
      const pct = (programId, quality) =>
        buildProgramFocusSplit(getWorkoutTemplateById(programId).sessions).find((segment) => segment.quality === quality)
          ?.pct ?? 0;
      const setup = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        goal: 'strength',
        goals: ['strength'],
        level: 'beginner',
        daysPerWeek: 3,
        equipment: 'gym',
        trainingEnvironment: 'full_gym',
        equipmentItems: ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench'],
      };
      const lines = (selection, programId) =>
        buildFirstRunRecommendationReasons(
          selection,
          { projectedDaysPerWeek: selection.daysPerWeek, language: 'en', programId },
          null,
        );

      // A strength week with neither in it.
      assert.ok(pct('tpl_3_day_strength_base_v1', 'Conditioning') < HELD_PCT);
      assert.ok(pct('tpl_3_day_strength_base_v1', 'Mobility') < HELD_PCT);
      for (const secondaryOutcomes of [['conditioning'], ['mobility'], ['conditioning', 'mobility']]) {
        const text = lines({ ...setup, secondaryOutcomes }, 'tpl_3_day_strength_base_v1').join(' | ');
        assert.doesNotMatch(text, /Also keeps/);
      }
      // One held, one not: only the held one is claimed.
      assert.ok(pct('tpl_2_day_mobility_reset_v1', 'Mobility') >= HELD_PCT);
      assert.ok(pct('tpl_2_day_mobility_reset_v1', 'Conditioning') < HELD_PCT);
      const mixed = lines(
        { ...setup, secondaryOutcomes: ['conditioning', 'mobility'] },
        'tpl_2_day_mobility_reset_v1',
      ).join(' | ');
      assert.match(mixed, /Also keeps mobility\./);
      // A week that holds it still says so.
      assert.ok(pct('tpl_shred_v1', 'Conditioning') >= HELD_PCT);
      const shred = lines(
        { ...setup, goal: 'muscle', goals: ['muscle'], secondaryOutcomes: ['conditioning'] },
        'tpl_shred_v1',
      ).join(' | ');
      assert.match(shred, /Also keeps conditioning/);
    },
  },
  {
    name: 'hunt 11: the Mobility tile is read off the sessions and agrees with the Mobility chip',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        assert.equal(isInCategory(template, 'mobility'), meetsMobilityFocus(template), template.id);
        assert.equal(isInCategory(template, 'mobility'), getProgramFocusTags(template).includes('mobility'), template.id);
      }
      const byId = (id) => WORKOUT_TEMPLATES_V1.find((template) => template.id === id);
      assert.equal(isInCategory(byId('tpl_2_day_mobility_reset_v1'), 'mobility'), true);
      assert.equal(isInCategory(byId('tpl_gainer_joint_friendly_v1'), 'mobility'), false);
      assert.equal(isInCategory(byId('tpl_2_day_mobility_reset_v1'), 'mobility'), true);
    },
  },
  {
    name: 'hunt 11: the band-assisted pull-up keeps the assisted pull-up joint-friendly metadata',
    run() {
      const shoulders = {
        setupEquipment: 'home',
        setupFreeWeightsPreference: 'neutral',
        setupMachinesPreference: 'neutral',
        setupBodyweightPreference: 'neutral',
        setupShoulderFriendlySwaps: 'prioritize',
        setupElbowFriendlySwaps: 'prioritize',
        setupKneeFriendlySwaps: 'neutral',
      };
      const score = (name) => buildTailoredSwapOptions([name], shoulders)[0];
      assert.equal(score('Band Assisted Pull-Up').score, score('Assisted Pull-Up').score);
      assert.equal(score('Band Assisted Pull-Up').reason, score('Assisted Pull-Up').reason);
      assert.ok(score('Band Assisted Pull-Up').score > score('Pull-Up').score);
      // Every pool name that says "assisted" is read as the gentler pull-up.
      for (const name of poolNames.filter((entry) => /assisted/i.test(entry) && /pull-up/i.test(entry))) {
        assert.equal(score(name).score, score('Assisted Pull-Up').score, name);
      }
    },
  },
  {
    name: 'hunt 11: a copy of a ready programme names its days as the programme did, in both languages',
    run() {
      for (const language of ['en', 'fi']) {
        for (const template of WORKOUT_TEMPLATES_V1) {
          const sessions = template.sessions.map((session, index) => ({
            id: session.id,
            name: session.name,
            orderIndex: index,
            exercises: [],
          }));
          const draft = buildDuplicatedCustomProgramDraft(template.name, sessions, [], language);
          const title = getReadyTemplatePresentation(template, language).title;
          template.sessions.forEach((session, index) => {
            assert.equal(
              formatPlanSessionTitle({ name: draft.sessions[index].name }, index, draft.name, language, false),
              formatPlanSessionTitle({ name: session.name }, index, title, language, false),
              `${language} ${template.id} day ${index + 1}`,
            );
          });
        }
      }
    },
  },
];
