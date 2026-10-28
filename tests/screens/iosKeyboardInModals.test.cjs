const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(next));
    else if (entry.name.endsWith('.tsx')) out.push(next);
  }
  return out;
}

const FILES = [...walk('src'), 'App.tsx'];
/** A Modal, or one of the app's sheets that renders one. */
const SHEET = /<(Modal|SheetShell|KitSheet|GPSheet)\b/;
const SHEET_TAGS = ['Modal', 'SheetShell', 'KitSheet', 'GPSheet'];
/** A text field, or a component that renders one. */
const INPUT = /<(TextInput|TypedRulerValue|KitSearch)\b/g;
const IOS_LIFT = /<KeyboardAvoidingView\s+behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/;

/** Each text field in the file sits outside every sheet the file renders. */
function inputsOutsideSheets(src) {
  const spans = [];
  for (const tag of SHEET_TAGS) {
    for (const open of src.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
      const close = src.indexOf(`</${tag}>`, open.index);
      spans.push([open.index, close === -1 ? src.length : close]);
    }
  }
  return [...src.matchAll(INPUT)].every((input) => spans.every(([from, to]) => input.index < from || input.index > to));
}

/**
 * Files with a sheet and a text field that need no lift, and the reason,
 * checked so it cannot go stale.
 */
const EXEMPT = {
  'src/components/sheetKit.tsx': {
    reason: 'KitSearch is not rendered anywhere',
    holds: () => FILES.every((file) => !/<KitSearch\b/.test(read(file))),
  },
  'src/screens/OnboardingScreen.tsx': {
    reason: 'the AI helper sheet is never opened',
    holds: (src) => !/setHelperVisible\(true\)/.test(src),
  },
  'src/screens/CardioScreen.tsx': {
    reason: 'its fields are on the screen, not in its Modal (cardio is frozen, 2026-10-10)',
    holds: inputsOutsideSheets,
  },
  'src/screens/ProgramDayScreen.tsx': {
    reason: 'its field is on the screen, not in its sheets',
    holds: inputsOutsideSheets,
  },
};

/**
 * iOS hunt 2026-10-17 (S5b-1, S5b-3/P1-4, S5b-4). iOS lifts no Modal's content
 * for the keyboard, and the app's sheets are anchored to the bottom: the
 * number pad covered the set correction's fields and Save, the search's
 * keyboard covered the exercise picker's "Add N" bar, and typing a weight on
 * the ruler sheet hid the whole sheet, the number included. Android's Modal
 * window resizes for the keyboard, which is why none of it showed there.
 */
module.exports = [
  {
    name: 'iOS keyboard in modals: a sheet with a text field rises over the keyboard',
    run() {
      const unlifted = [];
      for (const file of FILES) {
        const src = read(file);
        if (!SHEET.test(src) || !new RegExp(INPUT.source).test(src)) continue;
        // A measured inset is a lift too (the Modal sheets on Home and the
        // programme detail ride on keyboardDidShow's height).
        if (IOS_LIFT.test(src) || /keyboardDidShow/.test(src)) continue;
        const exempt = EXEMPT[file];
        if (exempt) {
          assert.ok(exempt.holds(src), `${file} no longer holds: ${exempt.reason}`);
          continue;
        }
        unlifted.push(file);
      }
      assert.deepEqual(unlifted, [], `a sheet with a text field and no keyboard lift: ${unlifted.join(', ')}`);
      // The four the hunt found, by name.
      for (const file of [
        'src/screens/GuidedPlayerScreen.tsx',
        'src/components/AddExerciseSheet.tsx',
        'src/components/MeasureRulerSheet.tsx',
        'src/screens/MyDataScreen.tsx',
      ]) {
        assert.match(read(file), IOS_LIFT, file);
      }
      const editor = readGuidedPlayerSource();
      const loggedSetEditor = editor.slice(editor.indexOf('function LoggedSetEditor('), editor.indexOf('function LoggedSetEditorFields('));
      assert.match(loggedSetEditor, IOS_LIFT);
    },
  },
  {
    name: 'iOS keyboard in modals: with the keyboard up, a tap outside the sheet puts the keyboard away',
    run() {
      // Closing would have dropped what was typed, or the picks.
      assert.match(read('src/components/AddExerciseSheet.tsx'), /onPress=\{\(\) => \(Keyboard\.isVisible\(\) \? Keyboard\.dismiss\(\) : onClose\(\)\)\}/);
      assert.match(read('src/screens/MyDataScreen.tsx'), /onPress=\{\(\) => \(Keyboard\.isVisible\(\) \? Keyboard\.dismiss\(\) : setEditing\(null\)\)\}/);
      // A typed ruler number commits on blur: Save, or the backdrop, while it
      // is still typed would save the number from before it, or drop it. The
      // sheet asks the field, not the keyboard: Android's Modal does not
      // report its keyboard, and iOS reports it gone late.
      const ruler = read('src/components/MeasureRulerSheet.tsx');
      assert.match(ruler, /onPress=\{\(\) => \(typing \? Keyboard\.dismiss\(\) : onClose\(\)\)\}/);
      assert.match(ruler, /onPress=\{\(\) => \(typing \? Keyboard\.dismiss\(\) : onSave\(\)\)\}/);
      assert.doesNotMatch(ruler, /onPress=\{onSave\}|onPress=\{onClose\}/);
      assert.doesNotMatch(ruler, /Keyboard\.isVisible\(\)/);
      assert.match(ruler, /<SheetTyping\.Provider value=\{typingState\}>\{children\}<\/SheetTyping\.Provider>/);
      assert.match(ruler, /onEditingChange=\{onEditingChange\}/);
      // Counted: on the BMI sheet the second number starts before the first ends.
      assert.match(ruler, /setTypingCount\(\(count\) => Math\.max\(0, count \+ \(editing \? 1 : -1\)\)\)/);
      const typed = read('src/components/TypedRulerValue.tsx');
      assert.match(typed, /onBlur=\{commit\}/);
      assert.match(typed, /onEditingChange\?\.\(true\);\s*return \(\) => onEditingChange\?\.\(false\);/);
    },
  },
  {
    name: 'iOS keyboard in modals: the exercise picker lets go of the keyboard, and does not open with it on iOS',
    run() {
      const picker = read('src/components/AddExerciseSheet.tsx');
      assert.match(picker, /keyboardShouldPersistTaps="handled"[\s\S]{0,200}?keyboardDismissMode="on-drag"/);
      const editor = read('src/screens/CreateTemplateScreen.tsx');
      assert.match(editor, /autoFocusSearch=\{Platform\.OS === 'android'\}/);
      assert.doesNotMatch(editor, /autoFocusSearch\s*\n/, 'a bare autoFocusSearch is on for iOS too');
    },
  },
  {
    name: 'iOS keyboard: every number pad has a localized way off it',
    run() {
      // iOS's number and decimal pads have no return key. returnKeyType="done"
      // gets them a Done bar from React Native, and the bar says "Done" in
      // English unless it is given a label.
      const bare = [];
      for (const file of FILES) {
        if (file === 'src/screens/CardioScreen.tsx') continue; // frozen, 2026-10-10
        const src = read(file);
        for (const match of src.matchAll(/<TextInput\b[\s\S]*?\/>/g)) {
          const input = match[0];
          const type = input.match(/keyboardType=(\{[^}]*\}|"[^"]*")/);
          if (!type || !/pad|numeric/.test(type[1])) continue;
          if (!/returnKeyType="done"/.test(input) || !/inputAccessoryViewButtonLabel=\{/.test(input)) {
            bare.push(`${file}:${src.slice(0, match.index).split('\n').length}`);
          }
        }
      }
      assert.deepEqual(bare, [], `a number pad with no Done bar, or an English one: ${bare.join(', ')}`);
      const i18n = read('src/lib/i18n.ts');
      assert.match(i18n, /'common\.done': 'Done',/);
      assert.match(i18n, /'common\.done': 'Valmis',/);
    },
  },
];
