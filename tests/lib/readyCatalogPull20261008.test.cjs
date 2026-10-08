const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const { RECOMMENDATION_PROGRAMS } = require(dist + 'lib/recommendationCatalog.js');
const { getWorkoutTemplateById } = require(dist + 'features/workout/workoutCatalog.js');

/**
 * HOME Starter's second day pushed (Push-Up Wide) and never pulled, so the
 * 12-week block ran six push sets against three pull sets a week for every
 * reader it was handed to (round 3 persona hunt, 2026-10-08). Every other
 * short full-body starter pulls on each day it presses.
 */

module.exports = [
  {
    name: 'ready catalog: every short full-body programme pulls on each day it presses',
    run() {
      const gaps = [];
      let checked = 0;
      for (const definition of RECOMMENDATION_PROGRAMS) {
        const template = getWorkoutTemplateById(definition.programId);
        if (!template || template.sessions.length > 3) {
          continue;
        }
        // The split programmes (push/pull/legs, focus blocks) are not full-body
        // days and are exempt by their session names.
        if (!template.sessions.every((session) => /full body/i.test(session.name))) {
          continue;
        }
        checked += 1;
        for (const session of template.sessions) {
          const presses = session.exercises.some((exercise) => /press/.test(exercise.slotId));
          const pulls = session.exercises.some((exercise) => /pull|row/.test(exercise.slotId));
          if (presses && !pulls) {
            gaps.push(`${definition.programId} ${session.name}`);
          }
        }
      }
      assert.ok(checked >= 3, 'the short full-body programmes the invariant reads');
      assert.deepEqual(gaps, []);
    },
  },
];
