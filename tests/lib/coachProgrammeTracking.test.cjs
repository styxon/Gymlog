const assert = require('node:assert/strict');

const {
  applyBriefToPreferences,
  buildProgrammeDraft,
  composeProgrammePreview,
  liveExerciseTracked,
  parseProgrammeBrief,
  resolveLiveProposal,
} = require('../../.test-dist/lib/programmeBrief.js');
const { buildAiCoachPlanSchema } = require('../../.test-dist/lib/aiCoachPlan.js');
const { createSeedDatabase, createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');

/**
 * A programme the AI coach builds stores the plan's tracking.
 *
 * buildProgrammeDraft wrote `trackedDefault: false` for every row and left the
 * rest to the library's category. That held only while the library filed
 * every curl and pushdown as compound: with the category following the source
 * mechanic (2026-10-06), a coach's arm day saved with no lift in the trend.
 */

const library = createSeedExerciseLibrary();
const preferences = createSeedDatabase().preferences;

/** The draft as the provider stores it, read back the way a custom programme is played. */
function runtimeOf(draft) {
  const sessions = draft.sessions.map((session, sessionIndex) => {
    const id = `s${sessionIndex}`;
    const exercises = session.exercises.map((exercise, index) => ({
      id: `${id}_e${index}`,
      workoutTemplateId: 't',
      workoutTemplateSessionId: id,
      name: exercise.name,
      targetSets: exercise.targetSets,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      restSeconds: exercise.restSeconds,
      trackedDefault: exercise.trackedDefault,
      orderIndex: index,
      libraryItemId: exercise.libraryItemId ?? null,
    }));
    return { id, name: session.name, orderIndex: sessionIndex, exerciseIds: exercises.map((row) => row.id), exercises };
  });
  const template = { id: 't', name: draft.name, exerciseIds: [], sessions, createdAt: '', updatedAt: '', origin: 'authored' };
  return adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, library, 120);
}

const byName = (name) => library.find((item) => item.name === name);

module.exports = [
  {
    name: 'coach programme tracking: the preview plan\'s own answer is stored — primary and secondary lifts tracked, accessories not',
    run() {
      let isolationTracked = 0;
      let accessories = 0;
      for (const brief of ['4 päivää, kädet ja rinta', '3 päivää, jalat ja selkä', '5 days push pull legs', '2 päivää']) {
        const proposal = composeProgrammePreview(brief, preferences, library);
        const plan = buildAiCoachPlanSchema(applyBriefToPreferences(preferences, parseProgrammeBrief(brief), library), library);
        const draft = buildProgrammeDraft(proposal, []);
        const runtime = runtimeOf(draft);
        draft.sessions.forEach((session, sessionIndex) => {
          const planned = plan.sessions[sessionIndex].exercises.filter((exercise) => exercise.libraryItemId);
          assert.equal(session.exercises.length, planned.length, `${brief}: day ${sessionIndex + 1}`);
          session.exercises.forEach((exercise, index) => {
            assert.equal(exercise.trackedDefault, planned[index].tracked, `${brief}: ${exercise.name}`);
            const played = runtime.sessions[sessionIndex].exercises[index];
            const item = library.find((entry) => entry.id === exercise.libraryItemId);
            if (planned[index].tracked) {
              assert.notEqual(played.progressionPriority, 'low', `${brief}: the plan's ${exercise.name} is out of the trend`);
              if (item.category !== 'compound') {
                isolationTracked += 1;
              }
            } else {
              accessories += 1;
            }
          });
        });
      }
      assert.ok(accessories > 0, 'the briefs reach the plan\'s accessory slots');
      assert.ok(isolationTracked > 0, 'a plan slot tracks an isolation lift, which the old flat false dropped');
    },
  },
  {
    name: 'coach programme tracking: a live answer tracks its strength lifts, compound or isolation, and not stretches, holds or core work',
    run() {
      const raw = {
        title: 'Arms',
        sessions: [
          {
            name: 'Arms',
            exercises: [
              { name: 'Barbell Squat', sets: 3, repsMin: 5, repsMax: 5 },
              { name: 'Barbell Curl', sets: 3, repsMin: 8, repsMax: 8 },
              { name: 'Triceps Pushdown', sets: 3, repsMin: 10, repsMax: 10 },
              { name: 'Seated Leg Curl', sets: 3, repsMin: 10, repsMax: 10 },
              { name: 'Plank', sets: 3, repsMin: 30, repsMax: 30 },
              { name: 'Cable Crunch', sets: 3, repsMin: 12, repsMax: 12 },
              { name: "Child's Pose", sets: 1, repsMin: 30, repsMax: 30 },
            ],
          },
        ],
      };
      const proposal = resolveLiveProposal(raw, 'kädet', library, 120, preferences);
      const tracked = Object.fromEntries(proposal.sessions[0].exercises.map((exercise) => [exercise.name, exercise.tracked]));
      assert.deepEqual(tracked, {
        'Barbell Squat': true,
        'Barbell Curl': true,
        'Triceps Pushdown': true,
        'Seated Leg Curl': true,
        Plank: false,
        'Cable Crunch': false,
        "Child's Pose": false,
      });
      const draft = buildProgrammeDraft(proposal, []);
      const played = Object.fromEntries(runtimeOf(draft).sessions[0].exercises.map((exercise) => [exercise.exerciseName, exercise.progressionPriority]));
      // The regression itself: a coach's curl, now filed isolation, stays in the trend.
      for (const name of ['Barbell Curl', 'Triceps Pushdown', 'Seated Leg Curl']) {
        assert.equal(byName(name).category, 'isolation', `${name} is an isolation lift in the corrected library`);
        assert.equal(played[name], 'medium', `${name} dropped out of the progression`);
      }
      assert.equal(played.Plank, 'low');
    },
  },
  {
    name: 'coach programme tracking: the live rule over the whole library — compound always, isolation unless a stretch or a hold, core and cardio never',
    run() {
      const { exerciseTypeOf } = require('../../.test-dist/lib/exerciseClassification.js');
      const { isHoldExerciseName } = require('../../.test-dist/lib/holdExercises.js');
      for (const item of library) {
        const expected =
          item.category === 'compound' ||
          (item.category === 'isolation' && exerciseTypeOf(item) !== 'stretch' && !isHoldExerciseName(item.name));
        assert.equal(liveExerciseTracked(item), expected, item.name);
      }
    },
  },
  {
    name: 'coach programme tracking: the draft writes the proposal\'s answer, not a flat false',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../../src/lib/programmeBrief.ts'), 'utf8');
      assert.doesNotMatch(source, /trackedDefault: false,/);
      assert.match(source, /trackedDefault: exercise\.tracked === true,/);
    },
  },
];
