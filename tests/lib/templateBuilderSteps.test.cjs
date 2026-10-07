const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SPLIT_PRESETS,
  TEMPLATE_BUILDER_STEPS,
  TEMPLATE_DAY_OPTIONS,
  baseChoiceDiscardsWork,
  baseSignature,
  canJumpToTemplateBuilderStep,
  clampDayCount,
  initialTemplateBuilderStep,
  laterTemplateBuilderStep,
  nextTemplateBuilderStep,
  presetsForDayCount,
  previousTemplateBuilderStep,
  templateDraftSignature,
} = require('../../.test-dist/lib/templateBuilderSteps.js');
const { parseQuickLayoutFocuses, resolveQuickLayoutExercises } = require('../../.test-dist/lib/quickLayoutExercises.js');
const { localizeWorkoutFocus } = require('../../.test-dist/lib/sessionNameLabel.js');
const i18n = require('../../.test-dist/lib/i18n.js');
const libraryModule = require('../../.test-dist/data/generatedExerciseLibrary.js');

const LIBRARY = Object.values(libraryModule)[0];

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
}

module.exports = [
  {
    name: 'template builder: one to six days, three or four layouts for each',
    run() {
      assert.deepEqual([...TEMPLATE_DAY_OPTIONS], [1, 2, 3, 4, 5, 6]);
      for (const count of TEMPLATE_DAY_OPTIONS) {
        const presets = SPLIT_PRESETS[count];
        assert.ok(presets.length >= 3 && presets.length <= 4, `${count} days: ${presets.length} layouts`);
        for (const preset of presets) {
          // A layout for N days is N days.
          assert.equal(preset.names.length, count, `${preset.id} has ${preset.names.length} days, offered for ${count}`);
        }
      }
      const ids = Object.values(SPLIT_PRESETS).flat().map((preset) => preset.id);
      assert.equal(new Set(ids).size, ids.length, 'preset ids repeat');
      // Out-of-range counts land on a real row of the table.
      assert.equal(clampDayCount(0), 1);
      assert.equal(clampDayCount(9), 6);
      assert.equal(clampDayCount(Number.NaN), 1);
      assert.equal(presetsForDayCount(7), SPLIT_PRESETS[6]);
    },
  },
  {
    name: 'template builder: every layout day is an English token the lift picker knows, and reads in Finnish',
    run() {
      for (const preset of Object.values(SPLIT_PRESETS).flat()) {
        for (const name of preset.names) {
          // Stored and matched in English, like every other plan name.
          assert.match(name, /^[A-Za-z /]+$/, `${preset.id}: "${name}" is not an English token`);
          assert.ok(parseQuickLayoutFocuses(name).length > 0, `${preset.id}: "${name}" names no focus`);
          assert.ok(resolveQuickLayoutExercises(name, LIBRARY).length >= 2, `${preset.id}: "${name}" opens near-empty`);
          assert.notEqual(localizeWorkoutFocus(name, 'fi'), name, `${preset.id}: "${name}" has no Finnish name`);
        }
      }
    },
  },
  {
    name: 'template builder: every label the path shows exists in both languages',
    run() {
      const source = read('src', 'lib', 'i18n.ts');
      const keys = new Set();
      for (const preset of Object.values(SPLIT_PRESETS).flat()) {
        keys.add(preset.labelKey);
        keys.add(preset.descriptionKey);
      }
      const screen = read('src', 'screens', 'CreateTemplateScreen.tsx');
      for (const match of screen.matchAll(/'(tpl\.[A-Za-z0-9.]+)'/g)) {
        keys.add(match[1]);
      }
      for (const key of keys) {
        const count = source.split(`'${key}':`).length - 1;
        assert.equal(count, 2, `${key} appears ${count} times in i18n.ts, expected EN + FI`);
        assert.notEqual(i18n.t('fi', key), i18n.t('en', key), `${key} is not translated`);
      }
    },
  },
  {
    name: 'template builder: a new programme walks name → days → base → exercises → save',
    run() {
      assert.deepEqual([...TEMPLATE_BUILDER_STEPS], ['name', 'days', 'base', 'build', 'review']);
      assert.equal(initialTemplateBuilderStep(false), 'name');
      assert.equal(nextTemplateBuilderStep('name'), 'days');
      assert.equal(nextTemplateBuilderStep('base'), 'build');
      assert.equal(nextTemplateBuilderStep('review'), null);
      // Back walks the path before it leaves it.
      assert.equal(previousTemplateBuilderStep('review', false), 'build');
      assert.equal(previousTemplateBuilderStep('build', false), 'base');
      assert.equal(previousTemplateBuilderStep('days', false), 'name');
      assert.equal(previousTemplateBuilderStep('name', false), null);
    },
  },
  {
    name: 'template builder: an edit opens on the days, and Back from there leaves',
    run() {
      assert.equal(initialTemplateBuilderStep(true), 'build');
      // Not into "choose a base", which would replace the days it came to edit.
      assert.equal(previousTemplateBuilderStep('build', true), null);
      assert.equal(previousTemplateBuilderStep('review', true), 'build');
      // A step jumped to from the indicator returns to the days it opened on,
      // rather than leaving from a step the edit never walked through.
      assert.equal(previousTemplateBuilderStep('name', true), 'build');
      assert.equal(previousTemplateBuilderStep('days', true), 'build');
      assert.equal(previousTemplateBuilderStep('base', true), 'build');
    },
  },
  {
    name: 'template builder: the indicator jumps back, never ahead of what was answered',
    run() {
      assert.equal(canJumpToTemplateBuilderStep('name', 'base'), true);
      assert.equal(canJumpToTemplateBuilderStep('base', 'base'), true);
      assert.equal(canJumpToTemplateBuilderStep('build', 'base'), false);
      // Going back does not forget how far the reader got.
      assert.equal(laterTemplateBuilderStep('build', 'name'), 'build');
      assert.equal(laterTemplateBuilderStep('days', 'review'), 'review');
    },
  },
  {
    name: 'template builder: a base asks before replacing lifts that are the reader\'s own',
    run() {
      const empty = [{ name: 'Day 1', exercises: [] }, { name: 'Day 2', exercises: [] }];
      // Nothing in the days: nothing to lose.
      assert.equal(baseChoiceDiscardsWork(empty, null), false);
      const fromBase = [
        { name: 'Push', exercises: [{ name: 'Bench Press', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120 }] },
      ];
      const lastBase = baseSignature(fromBase);
      // Exactly what the last base made: trying another is browsing.
      assert.equal(baseChoiceDiscardsWork(fromBase, lastBase), false);
      // A lift added, a day renamed, a prescription changed: the reader's work.
      const added = [{ ...fromBase[0], exercises: [...fromBase[0].exercises, { name: 'Dip' }] }];
      assert.equal(baseChoiceDiscardsWork(added, lastBase), true);
      const renamed = [{ ...fromBase[0], name: 'Chest day' }];
      assert.equal(baseChoiceDiscardsWork(renamed, lastBase), true);
      const changed = [{ ...fromBase[0], exercises: [{ ...fromBase[0].exercises[0], targetSets: 5 }] }];
      assert.equal(baseChoiceDiscardsWork(changed, lastBase), true);
      // An empty day added after the base holds nothing a new base could take.
      assert.equal(baseChoiceDiscardsWork([...fromBase, { name: 'Day 2', exercises: [] }], lastBase), false);
      // Lifts with no base behind them (an edited programme) are always the reader's.
      assert.equal(baseChoiceDiscardsWork(fromBase, null), true);
    },
  },
  {
    name: 'template builder: the signature sees every change that would save differently',
    run() {
      const days = [{ name: 'Push', exercises: [{ name: 'Bench Press', targetSets: 3 }] }];
      const base = templateDraftSignature('My plan', days);
      assert.equal(templateDraftSignature('  My plan ', days), base, 'surrounding spaces are trimmed on save');
      assert.notEqual(templateDraftSignature('Other', days), base);
      assert.notEqual(templateDraftSignature('My plan', [...days, { name: 'Pull', exercises: [] }]), base);
      assert.notEqual(templateDraftSignature('My plan', [{ name: 'Push', exercises: [] }]), base);
    },
  },
  {
    name: 'template builder: the screen hands back to its steps, and the route listener stands down',
    run() {
      const screen = read('src', 'screens', 'CreateTemplateScreen.tsx');
      // Chevron and hardware key share one rule.
      assert.match(screen, /onBack=\{handleBack\}/);
      assert.match(screen, /useHardwareBack\(handleBack\);/);
      assert.match(screen, /const previous = previousTemplateBuilderStep\(step, editing\);/);
      // Leaving with unsaved work asks; the dialog's confirm is what leaves.
      assert.match(screen, /if \(hasUnsavedWork\) \{\s*setConfirmingLeave\(true\);\s*return;\s*\}\s*onBack\(\);/);
      // Nothing moves while a save is on its way.
      assert.match(screen, /function handleBack\(\) \{\s*if \(savingRef\.current\) \{\s*return;\s*\}/);
      const routeBack = read('src', 'app', 'useRouteBack.ts');
      assert.match(routeBack, /if \(route\.tab === 'workout' && route\.screen === 'template'\) \{\s*return undefined;\s*\}/);
    },
  },
];
