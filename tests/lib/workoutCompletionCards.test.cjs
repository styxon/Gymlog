const assert = require('node:assert/strict');

const { buildCompletionCardsFromAdaptedSession } = require('../../src/app/workoutCompletionState');

const exercise = (slotId, name, weightKg, reps) => ({
  slotId,
  exerciseName: name,
  persistedExerciseTemplateId: null,
  tracked: true,
  trackingMode: 'load_and_reps',
  notes: null,
  sets: [{ orderIndex: 0, status: 'completed', weightKg, reps }],
});

module.exports = [
  {
    /*
     * Audit round 4 (2026-09-20): the PR badges came from the three cards the
     * hero strip has room for, so a fourth record had no badge on its row —
     * and the hero showed the first record in exercise order while the
     * morning-after notification names the strongest by the same estimate,
     * so the two could name different lifts for one session.
     */
    name: 'every record gets its badge, and the hero is the strongest one',
    run() {
      const { exerciseCards, prCards } = buildCompletionCardsFromAdaptedSession({
        exercises: [
          exercise('a', 'Curl', 20, 10),
          exercise('b', 'Bench Press', 100, 5),
          exercise('c', 'Row', 60, 8),
          exercise('d', 'Squat', 140, 3),
        ],
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: { byLibraryItemId: {}, byName: {}, namesWithRecordsRow: {} },
        language: 'en',
      });
      assert.deepEqual(
        exerciseCards.map((card) => [card.id, card.isPr === true]),
        [['a', true], ['b', true], ['c', true], ['d', true]],
        'the fourth record lost its badge',
      );
      assert.equal(prCards.length, 3, 'the hero strip still shows three');
      assert.equal(prCards[0].exerciseName, 'Squat', 'the hero names the strongest record, as the notification does');
      assert.deepEqual(prCards.map((card) => card.exerciseName), ['Squat', 'Bench Press', 'Row']);
    },
  },
];
