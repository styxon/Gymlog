const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');
const homeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'HomeScreen.tsx'),
  'utf8',
);
const playerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'),
  'utf8',
);

/**
 * Four things a device walkthrough found on 2026-08-21, all of the same shape:
 * the app knew the answer and had no way to say it.
 */
module.exports = [
  {
    name: 'lead program: holding a programme is not the same as leading with it',
    run() {
      // Adoption returned early on anything already held, so the only route to
      // changing which programme Home leads with was to REMOVE the other one —
      // a destructive answer to a question about ordering.
      // The helper over the shell, to its own closing brace: it moves to
      // src/app in phase C (2026-10-01). The adoptions calling it stay here.
      const promote = functionBody(readAppWiring(), 'async function promoteHeldProgramToLead(');
      assert.match(promote, /async function promoteHeldProgramToLead\(workoutTemplateId: string(, replacingPlanId\?: string)?\)/);
      assert.match(appSource, /if \(options\?\.lead\) \{\s*\r?\n\s*await promoteHeldProgramToLead/);
      // Matched on the template, because the same programme can be held under a
      // plan id minted by onboarding, by adoption, or by a season.
      assert.match(promote, /entry\.entries\[0\]\?\.workoutTemplateId === workoutTemplateId/);
    },
  },
  {
    name: 'lead program: Home never says "find a programme" while one is running',
    run() {
      // Removing the lead promotes the next in line, but that is one path of
      // several that can empty it. The invariant is repaired wherever it broke.
      // And a lead naming a plan that is gone is repaired too, not only an
      // empty one (2026-09-16). The rule is resolveLeadPlanId, tested in
      // tests/lib/runningProgrammes.
      // The whole shell, App.tsx and src/app: the repair effect left VinhaApp
      // for a hook in the phase-C split (2026-10-01).
      const shell = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(shell, /const lead = resolveLeadPlanId\(\{/);
      assert.match(shell, /if \(lead !== preferences\.activePlanId\) \{\s*tryOnce\(`lead:\$\{lead\}`, \(\) => updatePreferences\(\{ activePlanId: lead \}\)\);/);
    },
  },
  {
    name: 'discard confirm: the app asks with its own dialog, not the platform one',
    run() {
      // Alert.alert is a grey box with teal buttons dropped into a near-black
      // screen — another app's dialog, on the one screen where the reader is
      // agreeing to lose work.
      // The call, not the name: the comment above the handler explains the old
      // dialog by quoting it, and a bare name match hits the explanation.
      assert.doesNotMatch(playerSource, /Alert\.alert\(/);
      assert.match(playerSource, /<ConfirmDialog[\s\S]{0,400}visible=\{confirmingEnd\}/);
      assert.match(playerSource, /destructive/);
    },
  },
  {
    name: 'home: no fixed pink card on a fixed cream, wherever it is drawn',
    run() {
      // The Adapt sheet's destructive row was a fixed pink on a fixed cream —
      // a white card sitting in a dark sheet, the same class as the button
      // that drew white on white. The sheet went on 2026-08-30; the rule it
      // was written for is about Home, not about that row, so it stays.
      assert.doesNotMatch(homeSource, /borderColor: '#F3C8C2'/);
      assert.doesNotMatch(homeSource, /backgroundColor: '#FDF4F3'/);
    },
  },
];
