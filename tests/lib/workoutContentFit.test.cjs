const assert = require('node:assert/strict');

const { evaluateWorkoutContentFit } = require('../../.test-dist/lib/workoutContentFit.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

module.exports = [
  {
    name: 'workout content fit accepts strength templates with low-rep loaded anchors',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_4_day_powerbuilding_v1', {
        goalType: 'strength',
        setupContext: 'full_gym',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.hasLowRepLoadedAnchors, true);
      assert.equal(fit.signals.primarySetCount >= 14, true);
      assert.equal(fit.signals.hasFullGymOnlyExercises, true);
    },
  },
  {
    name: 'workout content fit accepts muscle gain templates with enough volume work',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_5_day_hybrid_v1', {
        goalType: 'hypertrophy',
        setupContext: 'full_gym',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.hasHypertrophyVolume, true);
      assert.equal(fit.signals.accessoryExerciseCount >= 8, true);
      assert.equal(fit.signals.weeklySetCount >= 60, true);
    },
  },
  {
    name: 'workout content fit accepts fat-loss full-gym templates when fatigue stays moderate',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_3_day_full_body_v1', {
        goalType: 'fat_loss',
        setupContext: 'full_gym',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.maxExercisesPerSession <= 5, true);
      assert.equal(fit.signals.averageSessionMinutes <= 55, true);
      assert.equal(fit.signals.loadedExerciseCount >= 8, true);
      assert.equal(fit.signals.hasResistanceWork, true);
      assert.equal(fit.signals.hasRunWork, false);
    },
  },
  {
    name: 'workout content fit accepts endurance templates with run and mobility work',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_3_day_run_mobility_v1', {
        goalType: 'endurance',
        setupContext: 'outdoor_running',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.hasRunWork, true);
      assert.equal(fit.signals.runExerciseCount >= 2, true);
      assert.equal(fit.signals.hasMobilityWork, true);
      assert.equal(fit.signals.hasFullGymOnlyExercises, false);
    },
  },
  {
    name: 'workout content fit accepts home bodyweight templates without full-gym-only work',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_2_day_minimal_full_body_v1', {
        goalType: 'hypertrophy',
        setupContext: 'bodyweight',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.hasFullGymOnlyExercises, false);
      assert.equal(fit.signals.bodyweightExerciseCount >= 6, true);
    },
  },
  {
    name: 'workout content fit requires fat-loss plans to include resistance work',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_2_day_yoga_recovery_v1', {
        goalType: 'fat_loss',
        setupContext: 'bodyweight',
      });

      assert.match(fit.issues.join(' '), /resistance/i);
    },
  },
  {
    name: 'workout content fit validates every strength template has heavy anchors',
    run() {
      // The gainer catalog tags the postpartum recovery programme as
      // goalType 'strength' but its content is intentionally gentle - no
      // low-rep loaded anchor lifts. Pin that exception explicitly so any
      // OTHER anchor-less strength template still fails this test.
      const GENTLE_STRENGTH_EXCEPTIONS = new Set(['tpl_gainer_postpartum_recovery_v1']);
      // The two bodyweight strength programmes are strength without a load: their
      // anchors are hard variations at low reps (a decline push-up for six, a
      // pistol squat for four), not loaded lifts. They are held to that instead of
      // being let through unchecked: every lead lift unloaded, five or six reps at
      // most, and enough of them (tests/lib/recommendationFixes20261005.test.cjs).
      const BODYWEIGHT_STRENGTH = new Set(['tpl_home_bodyweight_strength_3_day_v1', 'tpl_home_calisthenics_strength_5_day_v1']);
      const strengthTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.goalType === 'strength');

      assert.ok(strengthTemplates.length >= 3);
      assert.ok(strengthTemplates.some((template) => GENTLE_STRENGTH_EXCEPTIONS.has(template.id)));

      strengthTemplates.forEach((template) => {
        const fit = evaluateWorkoutContentFit(template.id, {
          goalType: 'strength',
          setupContext: 'full_gym',
        });

        if (BODYWEIGHT_STRENGTH.has(template.id)) {
          assert.equal(fit.signals.hasLowRepLoadedAnchors, false, template.id);
          assert.equal(fit.signals.loadedExerciseCount, 0, template.id);
          assert.equal(fit.signals.primarySetCount >= 6, true, template.id);
          return;
        }

        if (GENTLE_STRENGTH_EXCEPTIONS.has(template.id)) {
          // Deliberately anchor-free recovery content; keep it beginner and short.
          assert.equal(fit.signals.hasLowRepLoadedAnchors, false, template.id);
          assert.equal(template.level, 'beginner', template.id);
          assert.equal(fit.signals.averageSessionMinutes <= 40, true, template.id);
          return;
        }

        assert.deepEqual(fit.issues, [], template.id);
        assert.equal(fit.signals.hasLowRepLoadedAnchors, true, template.id);
        assert.equal(fit.signals.primarySetCount >= 6, true, template.id);
      });
    },
  },
  {
    name: 'workout content fit validates every hypertrophy template has enough volume',
    run() {
      const hypertrophyTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.goalType === 'hypertrophy');

      assert.ok(hypertrophyTemplates.length >= 4);
      hypertrophyTemplates.forEach((template) => {
        const fit = evaluateWorkoutContentFit(template.id, {
          goalType: 'hypertrophy',
          setupContext: 'full_gym',
        });

        assert.deepEqual(fit.issues, [], template.id);
        assert.equal(fit.signals.hasHypertrophyVolume, true, template.id);
        assert.equal(fit.signals.weeklySetCount >= 24, true, template.id);
      });
    },
  },
  {
    name: 'workout content fit keeps beginner templates within manageable complexity',
    run() {
      // Every row in a session is now a working exercise: the gainer xlsx
      // import's inert "Dynamic Warm-Up" / "Cooldown Flow" rows were removed
      // from the catalog, so the raw count is the real working density and no
      // longer has to be filtered before it can be judged.
      const beginnerTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.level === 'beginner');

      assert.ok(beginnerTemplates.length >= 6);
      beginnerTemplates.forEach((template) => {
        const fit = evaluateWorkoutContentFit(template.id, {
          goalType: template.goalType === 'strength' ? 'strength' : template.goalType === 'hypertrophy' ? 'hypertrophy' : 'recomposition',
          setupContext: template.id === 'tpl_2_day_minimal_full_body_v1' ? 'bodyweight' : 'full_gym',
        });

        const maxWorkingExercisesPerSession = Math.max(
          ...template.sessions.map((session) => session.exercises.length),
        );

        assert.equal(maxWorkingExercisesPerSession <= 7, true, template.id);
        assert.equal(fit.signals.averageSessionMinutes <= 55, true, template.id);
        assert.equal(fit.signals.technicalLiftCount <= 2, true, template.id);
      });
    },
  },
  {
    name: 'workout content fit validates endurance templates have at least two run exposures',
    run() {
      const fit = evaluateWorkoutContentFit('tpl_3_day_run_mobility_v1', {
        goalType: 'endurance',
        setupContext: 'outdoor_running',
      });

      assert.deepEqual(fit.issues, []);
      assert.equal(fit.signals.runExerciseCount >= 2, true);
    },
  },
];
