const assert = require('node:assert/strict');

const {
  buildLegacyTemplateSessions,
  buildWorkoutTemplateSessions,
} = require('../../src/lib/workoutTemplateSessions');
const {
  adaptLegacyWorkoutTemplateToRuntimeTemplate,
} = require('../../src/features/workout/customWorkoutAdapter');

const exerciseLibrary = [
  { id: 'lib_bench', name: 'Bench Press', category: 'compound', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'lib_row', name: 'Chest-Supported Row', category: 'compound', bodyPart: 'back', equipment: 'machine' },
  { id: 'lib_curl', name: 'Curl', category: 'isolation', bodyPart: 'biceps', equipment: 'dumbbell' },
];

module.exports = [
  {
    name: 'legacy workout templates get one ordered fallback session',
    run() {
      const sessions = buildLegacyTemplateSessions(
        { id: 'custom_1', name: 'My Split' },
        [
          { id: 'b', workoutTemplateId: 'custom_1', workoutTemplateSessionId: '', name: 'Row', targetSets: 3, repMin: 8, repMax: 10, restSeconds: 90, trackedDefault: true, orderIndex: 1, libraryItemId: 'lib_row' },
          { id: 'a', workoutTemplateId: 'custom_1', workoutTemplateSessionId: '', name: 'Bench Press', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, orderIndex: 0, libraryItemId: 'lib_bench' },
        ],
      );

      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].name, 'My Split');
      assert.deepEqual(sessions[0].exerciseIds, ['a', 'b']);
    },
  },
  {
    name: 'custom workout sessions preserve grouping and order',
    run() {
      const template = {
        id: 'custom_2',
        name: 'Upper Lower',
        exerciseIds: ['bench', 'row', 'curl'],
        sessions: [
          { id: 'upper', name: 'Upper', orderIndex: 0, exerciseIds: ['bench', 'row'] },
          { id: 'arms', name: 'Arms', orderIndex: 1, exerciseIds: ['curl'] },
        ],
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-05T10:00:00.000Z',
      };
      const exercises = [
        { id: 'curl', workoutTemplateId: 'custom_2', workoutTemplateSessionId: 'arms', name: 'Curl', targetSets: 2, repMin: 10, repMax: 12, restSeconds: 60, trackedDefault: false, orderIndex: 0, libraryItemId: 'lib_curl' },
        { id: 'row', workoutTemplateId: 'custom_2', workoutTemplateSessionId: 'upper', name: 'Chest-Supported Row', targetSets: 3, repMin: 8, repMax: 10, restSeconds: 90, trackedDefault: true, orderIndex: 1, libraryItemId: 'lib_row' },
        { id: 'bench', workoutTemplateId: 'custom_2', workoutTemplateSessionId: 'upper', name: 'Bench Press', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, orderIndex: 0, libraryItemId: 'lib_bench' },
      ];

      const sessions = buildWorkoutTemplateSessions(template, exercises);
      assert.equal(sessions.length, 2);
      assert.equal(sessions[0].name, 'Upper');
      assert.deepEqual(sessions[0].exercises.map((exercise) => exercise.id), ['bench', 'row']);
      assert.equal(sessions[1].name, 'Arms');
      assert.deepEqual(sessions[1].exercises.map((exercise) => exercise.id), ['curl']);
    },
  },
  {
    name: 'custom runtime template keeps multiple sessions for details and start selection',
    run() {
      const template = {
        id: 'custom_3',
        name: 'Upper Lower',
        exerciseIds: ['bench', 'row', 'curl'],
        sessions: [
          { id: 'upper', name: 'Upper', orderIndex: 0, exerciseIds: ['bench', 'row'] },
          { id: 'arms', name: 'Arms', orderIndex: 1, exerciseIds: ['curl'] },
        ],
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-05T10:00:00.000Z',
      };
      const sessions = buildWorkoutTemplateSessions(template, [
        { id: 'bench', workoutTemplateId: 'custom_3', workoutTemplateSessionId: 'upper', name: 'Bench Press', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, orderIndex: 0, libraryItemId: 'lib_bench' },
        { id: 'row', workoutTemplateId: 'custom_3', workoutTemplateSessionId: 'upper', name: 'Chest-Supported Row', targetSets: 3, repMin: 8, repMax: 10, restSeconds: 90, trackedDefault: true, orderIndex: 1, libraryItemId: 'lib_row' },
        { id: 'curl', workoutTemplateId: 'custom_3', workoutTemplateSessionId: 'arms', name: 'Curl', targetSets: 2, repMin: 10, repMax: 12, restSeconds: 60, trackedDefault: false, orderIndex: 0, libraryItemId: 'lib_curl' },
      ]);

      const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, exerciseLibrary, 120);
      assert.equal(runtime.sessions.length, 2);
      assert.equal(runtime.sessions[0].name, 'Upper');
      assert.equal(runtime.sessions[1].name, 'Arms');
      assert.equal(runtime.sessions[0].exercises[0].exerciseName, 'Bench Press');
      assert.equal(runtime.sessions[1].exercises[0].trackingMode, 'load_and_reps');
    },
  },
];
