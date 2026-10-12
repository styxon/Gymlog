const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getReadyTemplatePresentation, runningProgrammeTitle } = require('../../.test-dist/lib/templatePresentation.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');

const ROOT = path.join(__dirname, '..', '..');
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (file) => strip(fs.readFileSync(path.join(ROOT, file), 'utf8'));

module.exports = [
  {
    // Duplicate sweep 13 (D5-8, 2026-10-12). A running ready programme was
    // named three ways: App.tsx's runningProgrammeTitle (presentation title,
    // the plan's name only when the template is gone) for the Programs list,
    // Home's hero (the STORED plan name first, "because the plan may carry a
    // season's name" — the name the 2026-09-21 decision took off every list),
    // and the coach (the raw template name). One function now, in lib.
    name: 'a running ready programme has one title: its presentation title, the plan name only when the template is gone',
    run() {
      const template = getWorkoutTemplateById('tpl_strong_elite_v1');
      assert.ok(template);
      const presented = getReadyTemplatePresentation(template, 'fi', 4).title;
      assert.equal(runningProgrammeTitle(template, 'Talvikunto', 'fi', 4), presented);
      assert.notEqual(runningProgrammeTitle(template, 'Talvikunto', 'fi', 4), 'Talvikunto');
      assert.equal(runningProgrammeTitle(null, 'Old plan', 'fi', 0), 'Old plan');

      // Every surface asks it.
      const home = read('src/app/useHomeActivePlan.ts');
      assert.match(home, /runningProgrammeTitle\(readyPlanTemplate, activeWorkoutPlan\.name, preferences\.appLanguage\)/);
      assert.doesNotMatch(home, /activeWorkoutPlan\.name \|\| activeTemplate\.name/, 'Home reads the stored plan name first again');
      const app = read('App.tsx');
      assert.match(app, /runningProgrammeTitleOf\(/);
      assert.doesNotMatch(
        between(app, 'const runningProgrammeTitle = useCallback(', '[preferences.appLanguage],'),
        /getReadyTemplatePresentation|formatWorkoutDisplayLabel/,
        'App.tsx keeps its own copy of the rule',
      );
      assert.match(read('src/screens/AICoachChatScreen.tsx'), /runningProgrammeTitle\(template, null, language\)/);
      assert.match(
        read('src/app/useCoachContext.ts'),
        /recommendedProgramTitle: preferences\.recommendedProgramId\s*\?\s*runningProgrammeTitle\(/,
      );
    },
  },
];

function between(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = text.indexOf(end, from);
  assert.ok(to >= 0, `missing ${end}`);
  return text.slice(from, to);
}
