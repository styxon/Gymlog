const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const sourceSlices = require('../helpers/sourceSlices.cjs');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
// The fork (runProgramExerciseEdit) leaves VinhaApp for src/app in the
// phase-B split (2026-09-30), so its pins read the whole shell: App.tsx first,
// then every src/app module.
const wiring = readAppWiring().replace(/\r\n/g, '\n');

/**
 * A programme the reader holds but has switched off is one programme, with
 * its block, and not a second one.
 *
 * Audit round 4 (2026-09-20), three handlers in App.tsx: forking a running
 * ready programme (editing one lift copies it) removed its plan from the
 * running set but left the record, so the programme was listed twice and the
 * second row's Active switch re-adopted the catalog version beside the copy;
 * adopting a held programme from the goal flow or the completion card rebuilt
 * its plan and reset the block (week 5 → week 1); and the rhythm editor of a
 * held programme rewrote the app's availability, so Profile and the reminders
 * followed a programme Home was not running. Source-level: all three are wiring.
 */
const between = (from, to) => {
  const start = app.indexOf(from);
  assert.ok(start >= 0, `${from} is gone`);
  const end = app.indexOf(to, start);
  return app.slice(start, end > 0 ? end : undefined);
};

module.exports = [
  {
    name: 'programmes: the fork forgets the record it replaced, adoption resumes a held one, the rhythm of a held one stays its own',
    run() {
      // Both anchors asserted: a fork with no replace branch after it fails
      // here rather than reading on to the end of the shell.
      const fork = sourceSlices.between(wiring, 'const replacedPlan = wasHeld', "if (edit.kind === 'replace' &&");
      // On the record, not on the running set: a programme switched off
      // still has its plan, and editing a lift in one left that record
      // behind while the copy started from week 1 (CI review of #161).
      // Its failure is cleanup, not a failed copy, since #bugs 2026-10-01 —
      // hence the .catch and the longer comment before it.
      assert.match(fork, /if \(wasHeld\) \{[\s\S]{0,900}await forgetHeldProgramme\(template\.id\)\.catch\(/, 'the replaced plan record must go with the copy');
      assert.match(wiring, /const wasHeld = database\.workoutPlans\.some\(\(item\) => item\.id === readyPlanId\);/, 'held is read off the plan records');

      // Resuming is one rule in one place now: the reader's own copy of a
      // catalog programme comes back through the same helper, so the block
      // that was written here went with it rather than being copied.
      const adopt = between('async function handleAdoptReadyProgram(', 'const dayLabels = planLabelsForProgramme(');
      assert.match(adopt, /const resumedHeld = await resumeHeldProgramme\(workoutTemplateId, options\);\s*if \(resumedHeld !== null\) \{\s*return resumedHeld;/, 'a held programme must be resumed, not rebuilt');
      // The helper and the rhythm editor over the shell: both move to src/app
      // in phase C (2026-10-01). The rhythm is read to its first
      // setupScheduleMode inside its own body, not on to whatever follows it.
      assert.match(wiring, /async function resumeHeldProgramme\([\s\S]{0,400}resumeProgramme\(\{/, 'and the helper is the one that resumes');

      const rhythm = sourceSlices.between(
        sourceSlices.functionBody(wiring, 'async function handleSaveRhythm('),
        'async function handleSaveRhythm(',
        'setupScheduleMode:',
      );
      // Not the running set: two programmes may run at once, and the second
      // one's rhythm is not the app's availability either (CI review of #161).
      assert.match(rhythm, /if \(days\.length > 0 && plan\.id === preferences\.activePlanId\) \{/, "availability must follow the lead plan's rhythm only");
      assert.ok(!/activeProgramTemplateIds/.test(rhythm), 'the running set is not the lead');
    },
  },
];
