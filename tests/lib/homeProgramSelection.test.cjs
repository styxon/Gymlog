const assert = require('node:assert/strict');

const { selectHomeCustomProgram } = require('../../src/lib/homeProgramSelection');

const customWorkouts = [
  { id: 'custom_latest', name: 'Upper Split', exerciseCount: 4, updatedAt: '2026-03-20T12:00:00.000Z' },
  { id: 'custom_older', name: 'Push Day', exerciseCount: 5, updatedAt: '2026-03-10T12:00:00.000Z' },
];

module.exports = [
  {
    name: 'home custom program opens active custom session first',
    run() {
      const selection = selectHomeCustomProgram({
        customWorkouts,
        activeSessionTemplateId: 'custom_older',
        hasActiveSession: true,
        lastSelectedTemplateId: 'custom_latest',
        recentCompletedCustomTemplateId: 'custom_latest',
      });

      assert.equal(selection.mode, 'resume_active');
      assert.equal(selection.workoutId, 'custom_older');
      assert.equal(selection.title, 'Push Day');
      assert.equal(selection.ctaLabel, 'Open workout');
    },
  },
  {
    name: 'home custom program opens existing split when another workout is active',
    run() {
      const selection = selectHomeCustomProgram({
        customWorkouts,
        activeSessionTemplateId: 'ready_upper',
        hasActiveSession: true,
        lastSelectedTemplateId: 'custom_latest',
        recentCompletedCustomTemplateId: null,
      });

      assert.equal(selection.mode, 'open_existing');
      assert.equal(selection.workoutId, 'custom_latest');
      assert.equal(selection.ctaLabel, 'Open workout');
    },
  },
  {
    name: 'home custom program opens recent custom split when no active workout exists',
    run() {
      const selection = selectHomeCustomProgram({
        customWorkouts,
        activeSessionTemplateId: null,
        hasActiveSession: false,
        lastSelectedTemplateId: null,
        recentCompletedCustomTemplateId: 'custom_older',
      });

      assert.equal(selection.mode, 'open_existing');
      assert.equal(selection.workoutId, 'custom_older');
      assert.equal(selection.title, 'Push Day');
      assert.equal(selection.ctaLabel, 'Open workout');
    },
  },
  {
    name: 'home custom program falls back to create when no custom workouts exist',
    run() {
      const selection = selectHomeCustomProgram({
        customWorkouts: [],
        activeSessionTemplateId: null,
        hasActiveSession: false,
        lastSelectedTemplateId: null,
        recentCompletedCustomTemplateId: null,
      });

      assert.equal(selection.workoutId, null);
      assert.equal(selection.title, 'Custom workout');
      assert.equal(selection.ctaLabel, 'Create workout');
    },
  },
];