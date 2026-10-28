const assert = require('node:assert/strict');

const {
  buildPersistedSessionNames,
  getAutoSessionName,
} = require('../../src/lib/workoutEditorNaming');

module.exports = [
  {
    name: 'editor session naming uses first exercise as the automatic session name',
    run() {
      const suggestion = getAutoSessionName({
        sessionIndex: 0,
        workoutName: 'Upper Split',
        exerciseNames: ['Smith penkki', 'Kulmasoutu'],
      });

      assert.equal(suggestion, 'Smith penkki');
    },
  },
  {
    name: 'editor session naming falls back to workout name when a session has no exercises yet',
    run() {
      const suggestion = getAutoSessionName({
        sessionIndex: 1,
        workoutName: 'Upper Split',
        exerciseNames: [],
      });

      assert.equal(suggestion, 'Upper Split 2');
    },
  },
  {
    name: 'editor session naming persists unique names when duplicate sessions share the same first exercise',
    run() {
      const names = buildPersistedSessionNames(
        [
          { exerciseNames: ['Smith penkki'] },
          { exerciseNames: ['Smith penkki'] },
          { exerciseNames: ['Kulmasoutu'] },
        ],
        'Upper Split',
      );

      assert.deepEqual(names, ['Smith penkki', 'Smith penkki 2', 'Kulmasoutu']);
    },
  },
];
