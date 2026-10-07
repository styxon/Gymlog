const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

/**
 * Onboarding's ways in and out, and its saves (audit round 2, 2026-09-17).
 *
 * Wiring, so it is pinned at the source. Comments are stripped first: every
 * fix below explains the old shape in a comment, and a guard that can match
 * its own explanation passes itself.
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const app = strip(readAppWiring());
const onboarding = strip(read('src', 'screens', 'OnboardingScreen.tsx'));
const i18n = read('src', 'lib', 'i18n.ts');

/**
 * One of App's handlers, from its signature to its own closing brace,
 * bracket-matched. It used to end at the next member at the same depth, and
 * the phase-B split (2026-09-30) moved members: past the setup finish, a memo
 * that stood next became a hook call, and the slice ran on over it.
 */
function appFunction(name) {
  return functionBody(app, `function ${name}(`);
}

function between(source, from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `${from} should exist`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `${to} should follow ${from}`);
  return source.slice(start, end);
}

module.exports = [
  {
    name: 'onboarding: setup writes no name, so a Finnish one is never re-capitalised',
    run() {
      // formatProfileName capitalised after every ASCII word boundary, and ä/ö
      // are not word characters to \b: "Ylönen" came back "YlÖNen".
      assert.doesNotMatch(onboarding, /formatProfileName/);
      // The questionnaire does not ask for a name, so its output carries none.
      assert.doesNotMatch(onboarding, /\bprofileName\b/);
    },
  },
  {
    name: 'onboarding: a reader without finished setup is seeded with basics, not defaults',
    run() {
      const editor = app.match(/<OnboardingScreen\s[^>]*?mode="edit"[\s\S]*?\/>/);
      assert.ok(editor, 'the setup route renders the questionnaire in edit mode');
      assert.doesNotMatch(editor[0], /DEFAULT_FIRST_RUN_SELECTION/);
      assert.match(editor[0], /initialSelection=\{setupEditSelection\}/);
      assert.match(editor[0], /basicsSeed=\{setupEditSelection \? null : setupBasics\}/);
      assert.match(
        app,
        /const setupBasics = useMemo\(\s*\(\) => buildSetupBasicsFromPreferences\(preferences, latestWeighInKg\),\s*(\/\/[^\n]*\n\s*)?\[setupSelectionKey, latestWeighInKg\],\s*\);/,
      );
      // Answered-ness is a fact about the seed, not about the mode: edit mode
      // with no selection opens its questions unanswered.
      assert.doesNotMatch(onboarding, /initialSelection \|\| editMode/);
      assert.match(onboarding, /const seededAnswers = Boolean\(initialSelection\);/);
      assert.match(onboarding, /const \[profileLevelSelected, setProfileLevelSelected\] = useState\(seededAnswers\);/);
      // A week the reader named elsewhere answers the days question: the
      // rhythm from the plan screen, or the weekdays from Profile.
      assert.match(
        onboarding,
        /\(\) => seededAnswers \|\| Boolean\(setupSeed\.trainingCyclePattern\) \|\| setupSeed\.availableDays\.length > 0/,
      );
      // And an age band nobody gave is not invented.
      assert.doesNotMatch(onboarding, /: '19_25';/);
    },
  },
  {
    name: 'onboarding: the setup memo key comes from the builders, cycle included',
    run() {
      assert.match(app, /const setupSelectionKey = buildSetupSeedKey\(preferences\);/);
      assert.match(
        app,
        /const setupSelection = useMemo\(\(\) => buildSetupSelectionFromPreferences\(preferences\), \[setupSelectionKey\]\);/,
      );
      assert.doesNotMatch(app, /const setupSelectionKey = JSON\.stringify\(/);
    },
  },
  {
    name: 'onboarding: no finish writes a weigh-in; the flagged effect seeds it once',
    run() {
      for (const name of [
        'handleOnboardingPickReadyProgram',
        'handleOnboardingCompleteToTraining',
        'handleSetupCompleteToTraining',
      ]) {
        assert.doesNotMatch(appFunction(name), /addBodyweightEntry\(/, `${name} writes a weigh-in of its own`);
      }
      // The one writer left asks the flag first and sets it after the write.
      assert.match(app, /if \(preferences\.setupWeightSeeded \|\| database\.bodyweightEntries\.length > 0\) \{/);
      assert.match(
        app,
        /void addBodyweightEntry\(preferences\.setupCurrentWeightKg\)\s*\.then\(\(\) => updatePreferences\(\{ setupWeightSeeded: true \}\)\)/,
      );
    },
  },
  {
    name: 'onboarding: a catalogue pick is placed from today, like every other adoption',
    run() {
      const pick = appFunction('handleOnboardingPickReadyProgram');
      assert.match(pick, /const dayLabels = planLabelsForProgramme\(template\.sessions\.length, \[\], new Date\(\)\);/);
      assert.doesNotMatch(pick, /DEFAULT_RHYTHM_BY_DAYS/);
    },
  },
  {
    name: 'onboarding: removing a rhythm restores the lit weekdays and their count',
    run() {
      const clear = between(onboarding, 'function clearCycle()', 'function renderDays');
      assert.match(clear, /const week = weekAfterCycleRemoved\(availableDays, daysPerWeek\);/);
      assert.match(clear, /setAvailableDays\(week\.availableDays\);/);
      assert.match(clear, /setDaysPerWeek\(week\.daysPerWeek\);/);
      assert.match(clear, /setCyclePattern\(null\);/);
    },
  },
  {
    name: 'onboarding: the back key answers on every step before and after the questions',
    run() {
      const hook = strip(read('src', 'hooks', 'useHardwareBack.ts'));
      assert.match(
        hook,
        /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*onBackRef\.current\(\);\s*return true;\s*\}\);/,
      );
      // Subscribed once: a re-subscription moves the listener to the front.
      assert.match(hook, /return \(\) => subscription\.remove\(\);\s*\}, \[\]\);/);

      const startPath = strip(read('src', 'screens', 'StartPathScreen.tsx'));
      assert.match(startPath, /useHardwareBack\(onBack\);/);
      const aboutYou = strip(read('src', 'screens', 'AboutYouScreen.tsx'));
      assert.match(aboutYou, /useHardwareBack\(onBack\);/);
      const catalog = strip(read('src', 'screens', 'OnboardingReadyCatalogScreen.tsx'));
      // Like the chevron, it waits while the pick is being saved.
      assert.match(catalog, /useHardwareBack\(\(\) => \{\s*if \(!busy\) \{\s*onBack\(\);\s*\}\s*\}\);/);

      // The hand-off declines the page in front, and never says yes to the
      // widget row that is on by default.
      const handoff = strip(read('src', 'screens', 'SetupHandoffScreen.tsx'));
      const back = between(handoff, 'useHardwareBack(', '});');
      assert.match(back, /if \(page === 'offers' && pageIndex >= pages\.length - 1\) \{\s*finish\(false\);/);
      assert.match(back, /advance\(\);/);
      assert.match(handoff, /const finish = \(widget = addWidget, signIn = signInForBackup\) =>/);
      assert.match(handoff, /addWidget: plan\.offerWidget && widget,/);
      // A press handler passes its event: `onPress={finish}` would have read
      // it as the widget answer, and `onPress={advance}` as a yes to sign-in.
      assert.doesNotMatch(handoff, /onPress=\{finish\}/);
      assert.doesNotMatch(handoff, /onPress=\{advance\}|onDone=\{advance\}/);

      // The shell's route listener, newest after onboarding closes, hands the
      // key on while the hand-off is up — after closing a document over it.
      // Found by its own first stand-down and bounded by its deps, not as
      // "the first listener" in the shell: it left App.tsx for a src/app hook
      // (phase-C split, 2026-10-01), and the first one in the file order of
      // App.tsx + src/app is whichever module sorts first.
      const standDown = "if (cardioRunActive && route.tab === 'home' && route.screen === 'cardio') {";
      assert.equal(app.split(standDown).length - 1, 1, 'the route-level back is not one listener');
      const routeBack = between(app, standDown, '}, [cardioRunActive, navigationState.history.length, onboardingActive, route]);');
      const listener = between(routeBack, "BackHandler.addEventListener('hardwareBackPress', () => {", 'navigateBack(nextRoute);');
      assert.match(listener, /if \(setupHandoffActiveRef\.current\) \{\s*return false;\s*\}/);
      assert.ok(
        listener.indexOf('handoffLegalOpenRef.current') < listener.indexOf('setupHandoffActiveRef.current'),
        'a document over the hand-off closes first',
      );
      assert.ok(listener.indexOf('setupHandoffActiveRef.current') < listener.indexOf('getBackRoute('));
      assert.match(app, /setupHandoffActiveRef\.current = setupHandoffActive;/);
    },
  },
  {
    name: 'onboarding: "Edit limitations" saves the limitations and leaves the way it came',
    run() {
      // Back from the step the editor was opened on leaves, as from the first.
      assert.match(onboarding, /if \(stage === 'location' \|\| \(editMode && stage === initialStage\)\) \{/);
      assert.match(
        onboarding,
        /const limitationsOnly = editMode && initialStage === 'avoid' && Boolean\(onSaveLimitations\);/,
      );
      assert.match(
        onboarding,
        /if \(stage === 'avoid' && limitationsOnly && onSaveLimitations\) \{\s*void runAction\(\(\) => onSaveLimitations\(cautionFlags\)\);\s*return;\s*\}/,
      );
      // The save comes before the default step forward.
      const footer = between(onboarding, "if (stage === 'planning') {", 'disabled={!canContinue || busy}');
      assert.ok(
        footer.indexOf('onSaveLimitations(cautionFlags)') <
          footer.indexOf('setStageIndex((current) => Math.min(current + 1, STAGES.length - 1));'),
      );

      assert.match(app, /onSaveLimitations=\{route\.stage === 'avoid' \? handleSaveSetupLimitations : undefined\}/);
      const save = appFunction('handleSaveSetupLimitations');
      assert.match(save, /try \{\s*await updatePreferences\(\{ setupCautionFlags: cautionFlags \}\);\s*\} catch/);
      assert.match(save, /showToast\(t\(preferences\.appLanguage, 'toast\.limitationsSaveFailed'\)\);\s*return;/);
      // Leaving is the success state, so it follows the write.
      assert.ok(save.indexOf('navigateBack(') > save.indexOf('} catch'));
    },
  },
  {
    name: 'onboarding: the catalogue and "Start empty" say so when their save fails',
    run() {
      const pick = appFunction('handleOnboardingPickReadyProgram');
      assert.match(
        pick,
        /\} catch \(error\) \{[\s\S]*showToast\(t\(preferences\.appLanguage, 'toast\.planSaveFailed'\)\);[\s\S]*\} finally \{\s*setBusySavingReadyPick\(false\);/,
      );
      // Counted once the write has landed.
      assert.ok(
        pick.indexOf("trackEvent('onboarding_completed'") > pick.indexOf('await completeOnboarding('),
      );

      // Both anchors are props of the one <StartPathScreen> (in
      // src/app/renderOnboarding.tsx since phase C, 2026-10-01), so the slice
      // stays inside that element.
      const empty = between(app, 'onStartEmpty={() => {', 'onBrowsePrograms=');
      assert.match(
        empty,
        /return completeOnboarding\(\{[\s\S]*?\}\)\s*\.then\(\(\) => \{\s*trackEvent\('onboarding_completed', \{ path: 'empty' \}\);\s*navigate\(\{ tab: 'home', screen: 'dashboard' \}\);\s*\}\)\s*\.catch\(\(error\) => \{[\s\S]*?showToast\(t\(preferences\.appLanguage, 'toast\.startEmptyFailed'\)\);/,
      );

      for (const key of ['toast.startEmptyFailed', 'toast.limitationsSaveFailed']) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} is missing one of its two languages`);
      }
    },
  },
  {
    name: 'onboarding: the questionnaire finish is counted, after it is saved',
    run() {
      const finish = appFunction('handleOnboardingCompleteToTraining');
      assert.match(
        finish,
        /if \(!saved\) \{\s*return;\s*\}\s*trackEvent\('onboarding_completed', \{ path: 'build' \}\);/,
      );
    },
  },
];
