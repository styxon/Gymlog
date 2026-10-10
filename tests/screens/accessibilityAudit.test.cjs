const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
const home = read('src', 'screens', 'HomeScreen.tsx');
const ruler = read('src', 'components', 'RulerPicker.tsx');
const cardio = read('src', 'screens', 'CardioScreen.tsx');
const kit = read('src', 'components', 'sheetKit.tsx');
const freestyle = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
const restBar = read('src', 'components', 'RestBar.tsx');
const i18n = read('src', 'lib', 'i18n.ts');

/**
 * The accessibility audit of 2026-09-21, held at the call sites.
 *
 * These are source guards on purpose: every finding was a prop that was
 * missing or wrong on one element — a label that named an action instead of
 * the content, a ruler with no role, an ✕ with no name — and the only place
 * that can be seen is the element itself. The pure halves (the label wording,
 * the ruler's step, the palette's ratios) have their own suites in tests/lib.
 */
module.exports = [
  {
    name: 'a11y: a pressable card is read by what it shows, and its action is the hint',
    run() {
      // The set screen's lift card.
      const card = player.slice(player.indexOf('onPress={onOpenSheet}') - 900, player.indexOf('onPress={onOpenSheet}'));
      assert.match(card, /accessibilityLabel=\{exerciseCardAccessibilityLabel\(/);
      assert.match(card, /accessibilityHint=\{t\(language, 'guided\.panelsToggle'\)\}/);
      assert.doesNotMatch(player, /accessibilityLabel=\{t\(language, 'guided\.panelsToggle'\)\}/);
      // Home's workout title: the name is the label, switching is the hint.
      assert.match(home, /accessibilityLabel=\{localizeWorkoutFocus\(focusTitle, language\)\}/);
      assert.match(home, /\? t\(language, 'home\.a11y\.pickTodaySession'\)/);
      assert.doesNotMatch(
        home,
        /accessibilityLabel=\{\s*onPickTodaySession \? t\(language, 'home\.a11y\.pickTodaySession'\)/,
      );
    },
  },
  {
    name: 'a11y: the ruler is an adjustable a screen reader can move',
    run() {
      assert.match(ruler, /accessibilityRole="adjustable"/);
      assert.match(ruler, /accessibilityValue=\{\{ text: `\$\{removeTrailingZeros\(value\)\} \$\{unit\}` \}\}/);
      assert.match(ruler, /accessibilityActions=\{\[\{ name: 'increment' \}, \{ name: 'decrement' \}\]\}/);
      assert.match(ruler, /actionName === 'increment'\) \{\s*stepBy\(1\);/);
      assert.match(ruler, /actionName === 'decrement'\) \{\s*stepBy\(-1\);/);
      // A step goes through the same arithmetic as a thumb, moves the ruler
      // to it, and reports it once.
      const stepBy = ruler.slice(ruler.indexOf('const stepBy ='), ruler.indexOf('const onLayout ='));
      assert.match(stepBy, /stepRulerValue\(reportedRef\.current, direction, bounds\)/);
      assert.match(stepBy, /scrollRef\.current\?\.scrollTo\(\{ x: index \* TICK_GAP, animated: false \}\)/);
      assert.match(stepBy, /reportedRef\.current = next;[\s\S]*onChange\(next\);/);
      // Every ruler says what it measures and in what.
      assert.match(ruler, /accessibilityLabel: string;/);
      assert.match(ruler, /unit: string;/);
      for (const file of [
        ['src', 'screens', 'AboutYouScreen.tsx'],
        ['src', 'components', 'MeasureRulerSheet.tsx'],
      ]) {
        const source = read(...file);
        const count = (source.match(/<RulerPicker\b/g) ?? []).length;
        assert.ok(count > 0);
        const named = [...source.matchAll(/<RulerPicker\b[\s\S]*?\/>/g)].filter(
          ([element]) => /accessibilityLabel=/.test(element) && /unit=/.test(element),
        ).length;
        assert.equal(named, count, `${file.join('/')}: a ruler without a name or a unit`);
      }
    },
  },
  {
    name: 'a11y: icon-only buttons have names, and scrims do not pose as nameless buttons',
    run() {
      // The player's top bar: ✕ and the sound toggle, which is a switch.
      const topBar = player.slice(player.indexOf('function TopBar('), player.indexOf('function ProgressRail('));
      assert.match(topBar, /accessibilityLabel=\{t\(language, 'guided\.a11y\.exit'\)\}\s*onPress=\{onExit\}/);
      assert.match(topBar, /accessibilityRole="switch"/);
      assert.match(topBar, /accessibilityState=\{\{ checked: !muted \}\}/);
      assert.equal((player.match(/<TopBar\s+dark=\{[^}]*\}\s+language=\{language\}/g) ?? []).length, 2);
      // The entry screen's ✕.
      assert.match(player, /accessibilityLabel=\{t\(language, 'common\.close'\)\}\s*onPress=\{onLeave\}/);

      // Cardio: back, ✕, pause/resume and end.
      assert.match(cardio, /accessibilityLabel=\{t\(language, 'common\.back'\)\}\s*onPress=\{onLeave\}/);
      assert.match(cardio, /accessibilityLabel=\{t\(language, running \? 'cardio\.pause' : 'cardio\.resume'\)\}/);
      assert.equal(
        (cardio.match(/accessibilityLabel=\{t\(language, 'cardio\.end'\)\}\s*onPress=\{onExit\}/g) ?? []).length,
        2,
        'the ✕ and End both open the end sheet, and both say so',
      );

      // The sheet kit's ✕ is named at every call site; its scrim is out of the tree.
      assert.match(kit, /accessibilityLabel=\{closeLabel\}/);
      assert.match(kit, /closeLabel: string;/);
      assert.match(kit, /style=\{styles\.scrim\}\s*onPress=\{onClose\}\s*accessible=\{false\}\s*importantForAccessibility="no"/);
      for (const dir of ['src/screens', 'src/components']) {
        for (const entry of fs.readdirSync(path.join(ROOT, dir))) {
          const source = read(dir, entry);
          for (const [element] of source.matchAll(/<KitSheet\b[\s\S]*?\n\s*>/g)) {
            assert.match(element, /closeLabel=\{t\(language, 'common\.close'\)\}/, `${entry}: a KitSheet without a close label`);
          }
        }
      }
      // The coach demo's scrim repeats its skip button: hidden.
      assert.match(
        read('src', 'components', 'CoachDemoSheet.tsx'),
        /onPress=\{onDismiss\}\s*accessible=\{false\}\s*importantForAccessibility="no"/,
      );
      // Home's sign-in scrim is a third answer ("not now"), so it stays, named.
      assert.match(
        home,
        /onPress=\{\(\) => setSignInPopupOpen\(false\)\}\s*accessibilityRole="button"\s*accessibilityLabel=\{t\(language, 'common\.close'\)\}/,
      );
      // Welcome's flags, in the reader's language, naming each language in itself.
      const welcome = read('src', 'screens', 'WelcomeScreen.tsx');
      assert.doesNotMatch(welcome, /`Language \$\{/);
      assert.match(welcome, /accessibilityLabel=\{t\(language, 'welcome\.a11y\.language', \{ name: option\.name \}\)\}/);
      assert.match(i18n, /\{ key: 'fi', label: 'FIN', name: 'Suomi'/);
      assert.match(i18n, /\{ key: 'en', label: 'ENG', name: 'English'/);
    },
  },
  {
    name: 'a11y: a set\'s kg and reps fields say which set and what they hold',
    run() {
      assert.match(
        freestyle,
        /accessibilityLabel=\{setFieldAccessibilityLabel\(\s*language,\s*'kg',\s*setIndex \+ 1,\s*exerciseNameLabel\(language, exercise\.displayName\),?\s*\)\}/,
      );
      assert.match(
        freestyle,
        /accessibilityLabel=\{setFieldAccessibilityLabel\(\s*language,\s*'reps',\s*setIndex \+ 1,\s*exerciseNameLabel\(language, exercise\.displayName\),?\s*\)\}/,
      );
      const editor = player.slice(player.indexOf('function LoggedSetEditor('), player.indexOf('function SetStepView('));
      assert.match(editor, /accessibilityLabel=\{setFieldAccessibilityLabel\(language, 'reps', setNumber\)\}/);
      assert.match(editor, /accessibilityLabel=\{setFieldAccessibilityLabel\(language, 'kg', setNumber\)\}/);
      assert.match(player, /setNumber=\{restEdit\.setIndex \+ 1\}/);
    },
  },
  {
    name: 'a11y: the weight dial steps like a slider and says the step it takes',
    run() {
      assert.match(player, /downLabel=\{weightStepAccessibilityLabel\(language, -1\)\}/);
      assert.match(player, /upLabel=\{weightStepAccessibilityLabel\(language, 1\)\}/);
      const dial = player.slice(player.indexOf('function DialCard('), player.indexOf('function GPSheet('));
      assert.match(dial, /accessibilityRole=\{open \? undefined : 'adjustable'\}/);
      assert.match(dial, /accessibilityValue=\{\{ text: /);
      assert.match(dial, /\{ name: 'increment', label: upLabel \}/);
      assert.match(dial, /\{ name: 'decrement', label: downLabel \}/);
      // The swipe goes through the same step as the buttons — which clears
      // any typed text, as a button press does.
      assert.match(dial, /actionName === 'increment'\) \{\s*step\(1\);/);
      assert.match(dial, /actionName === 'decrement'\) \{\s*step\(-1\);/);
    },
  },
  {
    name: 'a11y: an unloggable typed weight is said in words, not only in red',
    run() {
      const setStep = player.slice(player.indexOf('function SetStepView('), player.indexOf('function FinishView('));
      assert.match(
        setStep,
        /\{typedErrorShown \? \(\s*<View style=\{styles\.setWeightError\} accessibilityLiveRegion="polite">\s*<Text style=\{styles\.setWeightErrorText\}>\s*\{t\(language, dial === 'reps' \? 'guided\.repsInvalid' : 'guided\.weightInvalid'\)\}\s*<\/Text>/,
      );
      assert.match(i18n, /'guided\.weightInvalid': 'Not a valid weight'/);
      assert.match(i18n, /'guided\.weightInvalid': 'Ei kelvollinen paino'/);
      assert.match(i18n, /'guided\.repsInvalid': 'Not a valid number'/);
      assert.match(i18n, /'guided\.repsInvalid': 'Ei kelvollinen luku'/);
    },
  },
  {
    name: 'a11y: large text wraps or scales instead of clipping',
    run() {
      // The confirm dialog's buttons can go to two rows.
      assert.match(read('src', 'components', 'ConfirmDialog.tsx'), /actions: \{[^}]*flexWrap: 'wrap',/);
      // The rest clock is capped, and shrinks to fit the ring past the cap.
      assert.match(player, /const RING_CLOCK_FIT = \{\s*maxFontSizeMultiplier: 1\.3,\s*numberOfLines: 1,\s*adjustsFontSizeToFit: true,/);
      assert.equal((player.match(/<Text style=\{styles\.restCountdown\} \{\.\.\.RING_CLOCK_FIT\}>/g) ?? []).length, 2);
      assert.equal((player.match(/styles\.restCountdown\b/g) ?? []).length, 2, 'a ring clock without the fit');
      // Fields and tabs grow with their text.
      assert.match(freestyle, /setInput: \{\s*minHeight: 40,/);
      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      assert.match(premium, /segmentTab: \{[^}]*minHeight: 40,/);
      assert.doesNotMatch(premium, /segmentTab: \{[^}]*\bheight: 40/);
      assert.doesNotMatch(premium, /<Text style=\{styles\.priceSub\} numberOfLines=\{1\}>/);
    },
  },
  {
    name: 'a11y: small controls reach 44 to the thumb, inside parents that do not clip them',
    run() {
      // Freestyle ✕: slop, and a head row built to hold it.
      assert.match(
        freestyle,
        /accessibilityLabel=\{t\(language, 'emptyWorkout\.a11y\.remove', \{ name: exercise\.displayName \}\)\}\s*hitSlop=\{\{ top: 7, bottom: 7, left: 3, right: 7 \}\}/,
      );
      assert.match(freestyle, /exerciseHead: \{[^}]*minHeight: 44,\s*marginRight: -7,\s*paddingRight: 7,/);
      // Rest bar pills, in a row padded to hold their slop.
      assert.equal((restBar.match(/hitSlop=\{PILL_SLOP\}/g) ?? []).length, 3);
      assert.match(restBar, /const PILL_SLOP = \{ top: 5, bottom: 5, left: 3, right: 3 \} as const;/);
      assert.match(restBar, /pillRow: \{[^}]*paddingVertical: PILL_SLOP\.top,\s*marginVertical: -PILL_SLOP\.top,/);
      // The template editor's remove, named and slopped; the plan stepper, 44 square.
      const template = read('src', 'screens', 'CreateTemplateScreen.tsx');
      assert.match(template, /accessibilityLabel=\{t\(language, 'emptyWorkout\.a11y\.remove', \{[\s\S]{0,200}?\}\)\}\s*hitSlop=\{6\}\s*onPress=\{\(\) => removeExercise/);
      assert.match(read('src', 'screens', 'TrainingPlanScreen.tsx'), /stepperButton: \{\s*width: 44,\s*height: 44,/);
      // The plateau card's "Selvä"/"Got it": sized on the control itself, no
      // hitSlop the amber head row would clip (break round, 2026-09-29).
      assert.match(home, /plateauDismiss: \{\s*minHeight: 44,/);
      assert.doesNotMatch(
        home.slice(home.indexOf('onPress={() => onDismissPlateau(plateau.episodeKey)}') - 200, home.indexOf('onPress={() => onDismissPlateau(plateau.episodeKey)}')),
        /hitSlop=/,
      );
      // Catalog and library chips.
      const catalog = read('src', 'screens', 'CatalogScreen.tsx');
      assert.match(catalog, /hitSlop=\{\{ top: 5, bottom: 5 \}\}/);
      assert.match(catalog, /chipRow: \{[^}]*paddingVertical: 5,/);
      const library = read('src', 'components', 'ExerciseLibraryBrowser.tsx');
      assert.match(library, /hitSlop=\{\{ top: 5, bottom: 5 \}\}\s*onPress=\{\(\) => setBodyPartFilter/);
      assert.match(library, /categoryRail: \{[^}]*paddingBottom: 5,/);
      // The swap sheet's chips (break round 2026-09-29) are the shared
      // exercise sheet's filter pills since #bugs 2026-10-06: 38 drawn, 44 to
      // the thumb by the same hitSlop + padded-row pattern as above.
      assert.doesNotMatch(player, /swapBrowseToggle|swapBrowseChip/);
      const sheet = read('src', 'components', 'AddExerciseSheet.tsx');
      assert.match(sheet, /const PILL_SLOP = \{ top: 3, bottom: 3 \} as const;/);
      assert.match(sheet, /hitSlop=\{PILL_SLOP\}\s*onPress=\{\(\) => onSelect\(option\)\}/);
      assert.match(sheet, /filterRow: \{[^}]*paddingVertical: PILL_SLOP\.top,\s*marginVertical: -PILL_SLOP\.top,/);
      assert.match(sheet, /filterPill: \{\s*minHeight: 38,/);
    },
  },
  {
    name: 'a11y: the player\'s entrances and the cardio pulse stop when the phone asks for less motion',
    run() {
      // One question per session, answered through the helper that always answers.
      assert.match(player, /import \{ queryReduceMotion \} from '\.\.\/utils\/reduceMotion';/);
      assert.match(player, /<ReducedMotionContext\.Provider value=\{reduceMotion\}>/);
      for (const name of ['StepIn', 'PopIn']) {
        const body = player.slice(player.indexOf(`function ${name}(`), player.indexOf(`function ${name}(`) + 1400);
        assert.match(body, /const reduceMotion = React\.useContext\(ReducedMotionContext\);/, name);
        assert.match(body, /if \(reduceMotion\) \{\s*anim\.stopAnimation\(\);\s*anim\.setValue\(1\);\s*return;\s*\}/, name);
        assert.match(body, /\}, \[anim, (stepKey|popKey), reduceMotion\]\);/, name);
      }
      assert.match(cardio, /import \{ queryReduceMotion \} from '\.\.\/utils\/reduceMotion';/);
      assert.match(cardio, /if \(!running \|\| reduceMotion\) \{\s*pulse\.setValue\(1\);\s*return;\s*\}/);
      assert.match(cardio, /\}, \[pulse, running, reduceMotion\]\);/);
    },
  },
];
