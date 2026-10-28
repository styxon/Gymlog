const assert = require('node:assert/strict');

const { liveSessionBlocksProgrammeDelete } = require('../../src/lib/programmeDeletion');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

/**
 * Deleting your own programme while one of its days is running locked the
 * reader out of that session: the player is routed by the programme's id, the
 * route guard bounced it, and the sets logged so far could never be saved
 * (live-session audit, 2026-09-20). The delete is refused while that holds.
 */
module.exports = [
  {
    name: 'programme deletion: refused while a workout of that programme is running or paused',
    run() {
      assert.equal(liveSessionBlocksProgrammeDelete({ templateId: 'custom_1', status: 'active' }, 'custom_1'), true);
      assert.equal(liveSessionBlocksProgrammeDelete({ templateId: 'custom_1', status: 'paused' }, 'custom_1'), true);
    },
  },
  {
    name: 'programme deletion: allowed with no workout, another programme\'s workout, or one already saved',
    run() {
      assert.equal(liveSessionBlocksProgrammeDelete(null, 'custom_1'), false);
      assert.equal(liveSessionBlocksProgrammeDelete(undefined, 'custom_1'), false);
      assert.equal(liveSessionBlocksProgrammeDelete({ templateId: 'custom_2', status: 'active' }, 'custom_1'), false);
      // Finished and saved, waiting on its summary: nothing left to lose.
      assert.equal(liveSessionBlocksProgrammeDelete({ templateId: 'custom_1', status: 'completed' }, 'custom_1'), false);
    },
  },
  {
    // Break round, 2026-09-28: "Remove from my programmes" on a held ready
    // programme is the same button and confirm as deleting your own, and it
    // skipped the rule.
    name: 'programme deletion: both delete paths ask the rule before they delete',
    run() {
      const app = readAppWiring();
      for (const [handler, write] of [
        ['async function handleDeleteCustomWorkout(workoutTemplateId: string) {', 'await deleteWorkoutTemplate(workoutTemplateId);'],
        ['async function handleForgetHeldProgram(workoutTemplateId: string) {', 'await forgetHeldProgramme(workoutTemplateId);'],
      ]) {
        const start = app.indexOf(handler);
        assert.ok(start >= 0, `${handler} is gone`);
        const body = app.slice(start, app.indexOf(write, start));
        assert.match(
          body,
          /if \(liveSessionBlocksProgrammeDelete\(workout\.activeSession, workoutTemplateId\)\) \{[\s\S]*?return;\s*\}/,
          `${handler} deletes without asking whether a workout of it is running`,
        );
      }
      // Recheck of #222: the third call — editing a held ready programme
      // copies it and forgets the original — asks the same rule first.
      // Bounded to the function's own body: a slice to the end of the
      // concatenated shell let any later src/app module satisfy both
      // searches (#bugs 2026-10-01).
      const edit = functionBody(app, 'async function runProgramExerciseEdit(');
      const guardAt = edit.indexOf('if (wasHeld && liveSessionBlocksProgrammeDelete(workout.activeSession, programId)) {');
      // No semicolon: since #bugs 2026-10-01 the call carries a .catch, as cleanup.
      const forgetAt = edit.indexOf('await forgetHeldProgramme(template.id)');
      assert.ok(guardAt > 0 && forgetAt > guardAt, 'the edit copies a held programme and forgets it without the rule');
      // Three since #bugs 2026-10-01: the third forgets the plan of a copy
      // that was never committed — a programme made a moment ago in this same
      // call, which no running workout can be of.
      assert.equal((app.match(/await forgetHeldProgramme\(/g) ?? []).length, 3, 'a new call to forgetHeldProgramme needs the rule too');
      assert.match(app, /await forgetHeldProgramme\(copyId\)\.catch\(\(\) => undefined\);/);
    },
  },
];
