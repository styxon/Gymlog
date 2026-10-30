const fs = require('node:fs');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

/**
 * The owner's notes on iOS build 5 (#bugs 2026-10-18, 08:34–08:43).
 */
module.exports = [
  {
    name: 'iOS b5: About you weighs on the weight log sheet, not a third picker',
    run() {
      const assert = require('node:assert/strict');
      const about = read('src', 'screens', 'AboutYouScreen.tsx');
      // The wheel is gone, and nothing else draws a weight picker here.
      assert.doesNotMatch(about, /WeightWheel/);
      assert.ok(!fs.existsSync(path.join(root, 'src', 'components', 'WeightWheel.tsx')));
      const sheet = about.slice(about.indexOf('<WeightLogSheet'), about.indexOf('/>', about.indexOf('<WeightLogSheet')));
      assert.ok(sheet.length > 0, 'About you mounts WeightLogSheet');
      // Its own limits, no date pill, Skip / Done, and the backdrop only closes.
      assert.match(sheet, /limits=\{WEIGHT_LIMITS\}/);
      assert.match(sheet, /dateIso=\{null\}/);
      assert.match(sheet, /cancelLabel=\{t\(language, 'aboutYou\.weight\.skip'\)\}/);
      assert.match(sheet, /saveLabel=\{t\(language, 'aboutYou\.weight\.done'\)\}/);
      assert.match(sheet, /onCancel=\{skipWeight\}/);
      assert.match(sheet, /onSave=\{commitWeight\}/);
      assert.match(sheet, /onDismiss=\{\(\) => setOpenSheet\(null\)\}/);
      assert.match(about, /const WEIGHT_LIMITS = \{ min: 35, max: 220 \};/);
      // Only Done answers: the ruler's number becomes the weight on save.
      assert.match(about, /function commitWeight\(next: number\) \{\s*setWeight\(next\);\s*setOpenSheet\(null\);/);
      // The KitSheet no longer holds the weight, and hands off to it on iOS.
      assert.match(about, /visible=\{openSheet === 'gender' \|\| openSheet === 'age'\}/);
      assert.match(about, /onDismissed=\{onSheetDismissed\}/);
      assert.match(about, /handOff\(\(\) => setOpenSheet\(null\), \(\) => setOpenSheet\('weight'\)\)/);

      const ruler = read('src', 'components', 'MeasureRulerSheet.tsx');
      // The backdrop closes without answering when the caller says so.
      assert.match(ruler, /onClose=\{onDismiss \?\? onCancel\}/);
      assert.match(ruler, /\{dateIso \? \(/);
      assert.match(ruler, /const min = limits\?\.min \?\? WEIGHT_MIN;/);
      // The sheet still lifts over iOS's keys, and Save first ends the typing.
      assert.match(ruler, /<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
      assert.match(ruler, /onPress=\{\(\) => \(typing \? Keyboard\.dismiss\(\) : onSave\(\)\)\}/);
    },
  },
  {
    name: 'iOS b5: a pen beside the big number opens the keys, on every ruler sheet',
    run() {
      const assert = require('node:assert/strict');
      const typed = read('src', 'components', 'TypedRulerValue.tsx');
      assert.match(typed, /penColor \? \(/);
      // The pen does what a tap on the number does, and says so.
      assert.equal((typed.match(/onPress=\{startEditing\}/g) || []).length, 2);
      assert.match(typed, /accessibilityLabel=\{t\(language, 'ruler\.typeValue\.pen'\)\}/);
      // The Done bar on the decimal pad is still there, in the app's language.
      assert.match(typed, /inputAccessoryViewButtonLabel=\{t\(language, 'common\.done'\)\}/);
      const ruler = read('src', 'components', 'MeasureRulerSheet.tsx');
      assert.match(ruler, /penColor=\{theme\.highlight\}/);
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal((i18n.match(/'ruler\.typeValue\.pen': /g) || []).length, 2);
    },
  },
  {
    name: 'iOS b5: typing a dial leaves only the lift name above the dials',
    run() {
      const assert = require('node:assert/strict');
      const source = readGuidedPlayerSource();
      assert.match(source, /const typingKeys = dial !== null && keyboard\.open;/);
      // The card and the set row are hidden, not unmounted (the tour measures them).
      assert.match(source, /style=\{\[styles\.setTopScroll, typingKeys && styles\.hidden\]\}/);
      assert.match(source, /\{superset && !typingKeys \? \(/);
      // The name that stays gives way first: it shrinks and clips, one line.
      assert.match(source, /setTypingHead: \{ flexShrink: 1, minHeight: 0, overflow: 'hidden'/);
      const head = source.slice(source.indexOf('{typingKeys ? ('), source.indexOf('<ScrollView', source.indexOf('{typingKeys ? (')));
      assert.match(head, /numberOfLines=\{1\}/);
      assert.match(source, /hidden: \{ display: 'none' \}/);
    },
  },
  {
    name: 'iOS b5: About you colours the gender row as its sheet does, and Skip sits lower without a gap either side',
    run() {
      const assert = require('node:assert/strict');
      const about = read('src', 'screens', 'AboutYouScreen.tsx');
      assert.match(about, /const GENDER_ACCENT = \{ male: '#5B9DF5', female: '#E86FA6' \} as const;/);
      assert.match(about, /accent: gender === 'male' \|\| gender === 'female' \? GENDER_ACCENT\[gender\] : undefined/);
      assert.match(about, /row\.accent \? \{ color: row\.accent \} : null/);
      assert.match(about, /<View style=\{\[styles\.divider, styles\.dividerLowered\]\} \/>/);
      // Lowered, but not into a bar of its own: 18 + 22 pt read as one between
      // two gaps (#bugs 2026-10-30), so the rule keeps 6 and Skip its 44 pt.
      assert.match(about, /dividerLowered: \{\s*marginTop: 6,/);
      assert.doesNotMatch(about, /skipSpaced/);
      assert.match(about, /skipButton: \{[^}]*minHeight: 44,/);
    },
  },
];
