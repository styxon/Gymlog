const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * Every Modal in the app, and how it keeps out of another one's way on iOS.
 *
 * React Native presents each Modal from the root view controller on iOS, and
 * UIKit refuses a presentation while that controller is still showing another
 * modal or still animating one away. The refused Modal is recorded as shown
 * anyway and is never tried again, and its host stays in the window as an
 * invisible full-screen layer that takes every touch: the app looks frozen
 * (#bugs 2026-10-17, build 4; iOS hunt 2026-10-17). Android stacks modals and
 * never shows any of this.
 *
 * So a modal that opens as another closes has to wait for the first one's
 * onDismiss (hooks/useModalHandoff), and a modal can only report onDismiss if
 * it passes it to its own Modal and is closed through `visible` — iOS never
 * reports it for a Modal that was unmounted.
 *
 * The ledger below is that, written down: each `<Modal` site with how it
 * closes and how it is sequenced. A new site fails until it is listed; so does
 * a listed site whose code no longer says what the entry claims. The check
 * runs on a map of file name -> text, so the last suite feeds it a doctored
 * tree: a guard that cannot fail proves nothing.
 */

const ROOT = path.join(__dirname, '..', '..');

/** How a site is kept from colliding with another modal. */
const SEQUENCING = {
  // Passes onDismiss={onDismissed}: a caller can open the next modal from it
  // through useModalHandoff.
  'reports-dismiss': 'passes the Modal onDismiss on, for useModalHandoff',
  // Opens only once its screen has stood still for longer than a sheet takes
  // to leave, and never in the screen's first render.
  'deferred-open': 'opens after a pause, never in the first render',
  // Never presented on iOS: drawn in the window (InTreeLayer) instead, so
  // there is nothing for UIKit to refuse. The Modal is Android's.
  'in-tree-on-ios': 'drawn in the window on iOS; the Modal is Android\'s',
  // Opened only by useModalHandoff's open step, once the sheet it is opened
  // from has gone, and nothing opens as it closes. Pinned in
  // tests/screens/iosModalHandoff.test.cjs.
  'opened-after-handoff': 'opened only after the sheet before it has gone',
  // Opened by its screen on its own, never while another sheet of the screen
  // is up, and takes no press before it has arrived (onShow). Pinned in
  // tests/screens/iosModalHandoff.test.cjs.
  'opened-when-clear': 'opens only with no other sheet up, and waits for onShow',
  // Opened by a timer or an effect, so it can come due while another modal of
  // its screen is up or leaving: it waits for useSheetsSettled, which turns
  // true only after the other modals' onDismiss. Pinned below.
  'opens-when-settled': 'opens on its own only after the screen\'s other modals have gone',
  // Opened only by a touch on the page under it, from a handler that closes no
  // other modal. Each entry says, in `why`, which modals share its screen and
  // why none of them can be closing as it opens. A touch cannot arrive in the
  // window a dismissal takes: the dismissing sheet still covers the screen and
  // UIKit gives the presenting view no touches until the transition is done.
  // Android stacks modals and never shows any of this.
  'opened-by-touch': 'opened only by a touch, from a handler that closes no other modal',
  // Never presented on iOS at all: the code that would open it is gated off
  // there. Pinned below.
  'never-on-ios': 'the code that opens it does not run on iOS',
  // Never opened on any platform: nothing sets its visible prop to true.
  // Pinned below.
  'never-opened': 'nothing opens it',
};

/**
 * `file` -> the sites in it, in order. `in` is the component the site sits
 * in; `closes` is 'visible' (a visible prop that turns false) or 'unmount'
 * (no visible prop, or a bare `visible`).
 */
const LEDGER = {
  'src/components/AddExerciseSheet.tsx': [{ in: 'ExercisePickerSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'Its four screens (the programme builder, the empty workout, the guided player, the programme day) open it from an Add exercise button, and every close path (pick, confirm, back) closes only this sheet. The guided player\'s rest-alerts ask is the one modal that opens by itself, and it only arrives on a rest step, where the add sheet cannot have been opened.' }],
  'src/components/CoachDemoSheet.tsx': [{ in: 'CoachDemoSheet', closes: 'visible', sequencing: 'opens-when-settled' }],
  'src/components/ConfirmDialog.tsx': [{ in: 'ConfirmDialog', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/components/ExerciseSheet.tsx': [{ in: 'ExerciseSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'Mounted by the guided player\'s card tap only. The one modal that opens by itself there, the rest-alerts ask, is held back while it is up (blocked: runSheetOpen || setPanelsOpen, pinned below), and no handler closes another modal as it opens.' }],
  'src/components/MeasureRulerSheet.tsx': [{ in: 'SheetShell', closes: 'visible', sequencing: 'opened-by-touch', why: 'The three ruler sheets open from a button on Progress or About you, and each saves or cancels with its own state flag only. About you\'s move from the gender or age sheet to the weight sheet already goes through useModalHandoff; the weight sheet itself closes into nothing.' }],
  'src/components/NewProgramSheet.tsx': [{ in: 'NewProgramSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'Opened by the Create button of the programme screens and by the settings import row. Choosing a door closes it and then navigates to another route, which opens no modal in the same tick; the screens it sits on have no other modal that is closed from its handlers.' }],
  'src/components/ProMomentSheet.tsx': [{ in: 'ProMomentSheet', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/components/ProgramLimitSheet.tsx': [{ in: 'ProgramLimitSheet', closes: 'visible', sequencing: 'in-tree-on-ios' }],
  'src/components/RateAppSheet.tsx': [{ in: 'RateAppSheet', closes: 'visible', sequencing: 'never-on-ios' }],
  'src/components/RestAlertsSheet.tsx': [{ in: 'RestAlertsSheet', closes: 'visible', sequencing: 'opened-when-clear' }],
  'src/components/SetLogSheet.tsx': [{ in: 'SetLogSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'Opened by a row tap on Progress. Progress\'s other sheets (weight, measure, BMI, recovery, Pro moment) are each opened by a touch of their own and closed by their own flag, and this sheet\'s Start and Pro buttons close it and navigate away, opening no modal.' }],
  'src/components/SubscriptionSheet.tsx': [{ in: 'SubscriptionSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'The four panels share one state (`sheet`), so at most one is up and every change of it is a touch. Their buttons close the panel with setSheet(null) and open nothing.' }],
  'src/components/ThemeChoiceDialog.tsx': [{ in: 'ThemeChoiceDialog', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/components/TrackChangeDialog.tsx': [{ in: 'TrackChangeDialog', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/components/sheetKit.tsx': [{ in: 'KitSheet', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/screens/CardioScreen.tsx': [{ in: 'CardioSheet', closes: 'unmount', sequencing: 'opened-by-touch', why: 'The end sheet needs a running cardio session (player mode, from the exit button or Android\'s back key) and the conflict sheet is opened from the activity list, which is shown only without one. Choosing in either closes it and starts a different mode, which has no modal.' }],
  'src/screens/GuidedPlayerScreen.tsx': [
    { in: 'LoggedSetEditor', closes: 'unmount', sequencing: 'opened-after-handoff' },
  ],
  'src/screens/GuidedPlayerSheet.tsx': [{ in: 'GPSheet', closes: 'visible', sequencing: 'reports-dismiss' }],
  'src/screens/HomeScreen.tsx': [{ in: 'HomeScreen', closes: 'visible', sequencing: 'deferred-open' }],
  'src/screens/MyDataScreen.tsx': [{ in: 'MyDataScreen', closes: 'visible', sequencing: 'opened-by-touch', why: 'The screen\'s only modal. A field row opens the editor, and Save or Cancel closes it.' }],
  'src/screens/OnboardingScreen.tsx': [{ in: 'OnboardingScreen', closes: 'visible', sequencing: 'never-opened' }],
  'src/screens/ProgramsHomeScreen.tsx': [{ in: 'ProgramSheet', closes: 'visible', sequencing: 'opened-by-touch', why: 'The category sheet is opened by a category card, and picking a row closes it and navigates. The screen\'s other modal, the create sheet, is opened by its own button; no handler closes one and opens the other.' }],
};

function listSourceFiles() {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name)) {
        files[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
      }
    }
  };
  walk('src');
  files['App.tsx'] = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
  return files;
}

/** The opening tag from `start`, up to its `>` outside any `{ }` or quoted prop. */
function readOpeningTag(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (depth === 0 && (ch === '"' || ch === "'")) {
      const end = text.indexOf(ch, i + 1);
      i = end === -1 ? text.length : end;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The component a site sits in: the last top-level function or arrow component above it. */
function enclosingComponent(text, index) {
  const before = text.slice(0, index);
  const matches = [
    ...before.matchAll(/^(?:export )?(?:default )?(?:function (\w+)|const ([A-Z]\w*) = (?:React\.memo\()?(?:\(|function))/gm),
  ];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last[1] ?? last[2];
}

function findModalSites(files) {
  const sites = [];
  for (const [file, text] of Object.entries(files)) {
    for (const match of text.matchAll(/<Modal\b/g)) {
      const tag = readOpeningTag(text, match.index);
      sites.push({
        file,
        in: enclosingComponent(text, match.index),
        closes: /\svisible=\{/.test(tag) ? 'visible' : 'unmount',
        onDismiss: (tag.match(/\sonDismiss=\{([^}]*)\}/) || [])[1] ?? null,
        tag,
      });
    }
  }
  return sites;
}

/** Every way the tree disagrees with the ledger, as sentences. */
function checkModalLedger(files) {
  const problems = [];
  const sites = findModalSites(files);
  const byFile = {};
  for (const site of sites) {
    (byFile[site.file] ??= []).push(site);
  }
  for (const [file, found] of Object.entries(byFile)) {
    const listed = LEDGER[file] ?? [];
    found.forEach((site, i) => {
      const entry = listed[i];
      if (!entry) {
        problems.push(
          `${file}: a <Modal in ${site.in} is not in the ledger. Add it, with how it closes and how it waits for another modal on iOS.`,
        );
        return;
      }
      if (entry.in !== site.in) {
        problems.push(`${file}: the ledger expects a <Modal in ${entry.in} here, found one in ${site.in}.`);
      }
      if (entry.closes !== site.closes) {
        problems.push(`${file} (${site.in}): the ledger says it closes by ${entry.closes}, the code by ${site.closes}.`);
      }
      if (!SEQUENCING[entry.sequencing]) {
        problems.push(`${file} (${site.in}): unknown sequencing '${entry.sequencing}'.`);
      }
      if (entry.sequencing === 'reports-dismiss') {
        if (site.closes === 'unmount') {
          problems.push(`${file} (${site.in}): iOS never reports onDismiss for an unmounted Modal; close it through visible.`);
        }
        if (site.onDismiss !== 'onDismissed') {
          problems.push(`${file} (${site.in}): listed as reporting its dismissal, but its Modal has no onDismiss={onDismissed}.`);
        }
      }
      if (
        entry.sequencing === 'in-tree-on-ios' &&
        !/if \(Platform\.OS === 'ios'\) \{\s*return <InTreeLayer\b/.test(files[file])
      ) {
        problems.push(`${file} (${site.in}): listed as drawn in the window on iOS, but it does not return an InTreeLayer there.`);
      }
      if (entry.sequencing === 'opened-when-clear' && !/\sonShow=\{/.test(site.tag)) {
        problems.push(`${file} (${site.in}): listed as waiting for its own arrival, but its Modal has no onShow.`);
      }
      if (entry.sequencing === 'opened-by-touch' && !(typeof entry.why === 'string' && entry.why.length > 40)) {
        problems.push(`${file} (${site.in}): listed as opened by a touch, but the entry does not say why no other modal can be closing.`);
      }
      if (entry.sequencing === 'opens-when-settled' && site.onDismiss !== null) {
        problems.push(`${file} (${site.in}): listed as opening when settled, but it reports a dismissal now; list it as reporting its dismissal.`);
      }
      if (entry.sequencing === 'opened-after-handoff' && site.closes === 'visible') {
        problems.push(`${file} (${site.in}): listed as opened after a handoff by mounting, but it closes through visible now; list it as reporting its dismissal.`);
      }
    });
    if (listed.length > found.length) {
      problems.push(`${file}: the ledger lists ${listed.length} <Modal sites, the file has ${found.length}. Remove the stale entry.`);
    }
  }
  for (const file of Object.keys(LEDGER)) {
    if (!byFile[file]) {
      problems.push(`${file}: listed in the ledger but has no <Modal any more. Remove the entry.`);
    }
  }
  return problems;
}

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

module.exports = [
  {
    name: 'iOS modal sequencing: every <Modal site is in the ledger, and the ledger matches the code',
    run() {
      assert.deepEqual(checkModalLedger(listSourceFiles()), []);
    },
  },
  {
    name: 'iOS modal sequencing: the hand-off moves from a dialog only after it has gone',
    run() {
      const handoff = read('src', 'screens', 'SetupHandoffScreen.tsx');
      // Done on either dialog closes it first; the next page comes on its
      // onDismiss. The last page waits too, so sign-in and the Pro page are
      // not asked for while the theme dialog is still leaving.
      assert.match(
        handoff,
        /<TrackChangeDialog\s+visible=\{page === 'tracking' && !dialogLeaving\}[\s\S]{0,300}?onDone=\{leaveDialog\}\s+onDismissed=\{page === 'tracking' \? onSheetDismissed : undefined\}/,
      );
      assert.match(
        handoff,
        /<ThemeChoiceDialog\s+visible=\{page === 'theme' && !dialogLeaving\}[\s\S]{0,300}?onDone=\{leaveDialog\}\s+onDismissed=\{page === 'theme' \? onSheetDismissed : undefined\}/,
      );
      assert.match(
        handoff,
        /handOff\(\s*\(\) => setDialogLeaving\(true\),\s*\(\) => \{\s*if \(!lastPage\) \{\s*setDialogLeaving\(false\);\s*advance\(\);\s*return;\s*\}\s*void Promise\.resolve\(finish\(\)\)\.finally\(\(\) => setDialogLeaving\(false\)\);/,
      );
      assert.match(handoff, /const \{ handOff, onSheetDismissed \} = useModalHandoff\(\);/);
      assert.doesNotMatch(handoff, /onDone=\{\(\) => advance\(\)\}/);
      // The last dialog stays down until the write settles, which it can only
      // do if the shell hands the promise over rather than voiding it.
      assert.match(handoff, /onDone: \(choices: SetupHandoffChoices\) => void \| Promise<void>;/);
      const wiring = read('src', 'app', 'renderOnboarding.tsx');
      assert.match(wiring, /onDone=\{handleSetupHandoffDone\}/);
      assert.doesNotMatch(wiring, /onDone=\{\(choices\) => void handleSetupHandoffDone/);
    },
  },
  {
    name: 'iOS modal sequencing: the hand-off\'s hop to the Pro page lands in the same render as its write',
    run() {
      const app = readAppWiring();
      // Not a transition: the route and the Pro-step write commit together, so
      // the second half is never due on the old route for a frame.
      const body = app.match(/function navigateNow\(nextRoute: AppRoute\) \{([\s\S]*?)\n  \}/);
      assert.ok(body, 'navigateNow exists');
      assert.doesNotMatch(body[1], /startTransition/);
      assert.match(body[1], /setNavigationState\(/);
      assert.match(app, /createSetupHandoffDone\(\{[\s\S]{0,600}?navigate: navigateNow,/);
    },
  },
  {
    name: 'iOS modal sequencing: Home\'s sign-in dialog waits, and never opens over one of Home\'s sheets',
    run() {
      const home = read('src', 'screens', 'HomeScreen.tsx');
      assert.match(home, /useState<'waiting' \| 'open' \| 'closed'>\('waiting'\)/);
      assert.doesNotMatch(home, /signInPopupOpen/);
      assert.match(home, /visible=\{signInPromptDue && signInPopup === 'open'\}/);
      assert.match(
        home,
        /if \(!signInPromptDue \|\| signInPopup !== 'waiting' \|\| modalUp\) \{\s*return;\s*\}\s*const timer = setTimeout\(\(\) => setSignInPopup\('open'\), Platform\.OS === 'ios' \? SIGN_IN_POPUP_DELAY_IOS_MS : 0\);\s*return \(\) => clearTimeout\(timer\);/,
      );
      assert.match(home, /const modalUp = homeSheetOpen \|\| shellSheetOpen;/);
      // Every other modal on Home holds the dialog back: a sheet added to Home
      // and not to homeSheetOpen fails here. Each term is matched whole, so a
      // negated or partial expression does not count.
      const held = home.match(/const homeSheetOpen =\s*([^;]+);/);
      assert.ok(held, 'homeSheetOpen exists');
      const terms = held[1].split('||').map((term) => term.trim());
      const sheetsIn = (text) =>
        [...text.matchAll(/<(\w+(?:Sheet|Dialog))\b/g)].map((match) => {
          const tag = readOpeningTag(text, match.index);
          return { name: match[1], visible: (tag.match(/\svisible=\{([^}]*)\}/) || [])[1] };
        });
      const sheets = sheetsIn(home);
      assert.ok(sheets.length >= 4, 'Home\'s sheets were found');
      for (const sheet of sheets) {
        assert.ok(sheet.visible, `${sheet.name} on Home has a visible prop`);
        assert.ok(terms.includes(sheet.visible.trim()), `${sheet.name} (${sheet.visible}) is in homeSheetOpen`);
      }
      // A section of Home with a sheet of its own reports it, and Home counts it.
      const stats = read('src', 'components', 'HomeStatCardsSection.tsx');
      const statSheets = sheetsIn(stats);
      assert.ok(statSheets.length >= 1, 'the stat cards\' sheet was found');
      for (const sheet of statSheets) {
        assert.ok(
          stats.includes(`onSheetVisibleChange?.(${sheet.visible})`),
          `HomeStatCardsSection reports its ${sheet.name}`,
        );
      }
      assert.match(home, /onSheetVisibleChange=\{setStatSheetOpen\}/);
      assert.ok(terms.includes('statSheetOpen'), 'the stat cards\' sheet holds the dialog');
      // And the shell's modals, from App: the walls, the import, the rating
      // ask and the update dialog.
      assert.match(
        readAppWiring(),
        /shellSheetOpen: programLimitVisible \|\| runningCapSheet\.visible \|\| settingsImportVisible \|\| ratingSheetVisible \|\| appUpdateShown,/,
      );
      assert.match(
        read('src', 'features', 'appUpdate', 'AppUpdateDialog.tsx'),
        /onShownChange\?\.\(shown\);[\s\S]*visible=\{shown\}/,
      );
    },
  },
  {
    name: 'iOS modal sequencing: the Pro walls are drawn in the window on iOS, over the whole shell',
    run() {
      // The wall is one shape for both platforms; iOS draws it, Android presents it.
      const sheet = read('src', 'components', 'ProgramLimitSheet.tsx');
      assert.match(
        sheet,
        /if \(Platform\.OS === 'ios'\) \{\s*return <InTreeLayer visible=\{visible\}>\{wall\}<\/InTreeLayer>;\s*\}\s*return \(\s*<Modal visible=\{visible\} transparent animationType="fade" onRequestClose=\{onClose\}>\s*\{wall\}\s*<\/Modal>/,
      );
      // Both walls sit in the shell's top layer, and nowhere else.
      const shell = read('src', 'app', 'renderAppShell.tsx');
      const layer = shell.match(/topLayer=\{\s*<>([\s\S]*?)<\/>\s*\}/);
      assert.ok(layer, 'the shell passes a topLayer');
      assert.equal((layer[1].match(/<ProgramLimitSheet\b/g) || []).length, 2);
      assert.equal((shell.match(/<ProgramLimitSheet\b/g) || []).length, 2);
      // The top layer covers what a Modal would: outside the safe area and the
      // keyboard lift, after everything else, and it takes no touch itself.
      const appShell = read('src', 'components', 'AppShell.tsx');
      assert.match(
        appShell,
        /<\/SafeAreaView>\s*\{topLayer \? \(\s*<View style=\{StyleSheet\.absoluteFill\} pointerEvents="box-none">\s*\{topLayer\}\s*<\/View>\s*\) : null\}\s*<\/SafeAreaProvider>/,
      );
      // A Modal hides the screen under it from VoiceOver; drawn in the window,
      // the shell has to, while either wall is up on iOS (code review of PR B).
      assert.match(
        appShell,
        /<SafeAreaView[^>]*accessibilityElementsHidden=\{topLayerActive\}\s*importantForAccessibility=\{topLayerActive \? 'no-hide-descendants' : 'auto'\}\s*>/,
      );
      assert.match(
        shell,
        /topLayerActive=\{Platform\.OS === 'ios' && \(programLimitVisible \|\| runningCapSheet\.visible\)\}/,
      );
      // The layer itself: modal to VoiceOver, takes the focus and the keyboard
      // as a Modal would, no touches while it leaves, gone once it has faded.
      const inTree = read('src', 'components', 'InTreeLayer.tsx');
      assert.doesNotMatch(inTree, /\bModal\b.*from 'react-native'/);
      assert.match(inTree, /accessibilityViewIsModal/);
      assert.match(
        inTree,
        /if \(visible\) \{\s*setDrawn\(true\);[\s\S]*?Keyboard\.dismiss\(\);[\s\S]*?AccessibilityInfo\.sendAccessibilityEvent\(layerRef\.current, 'focus'\);/,
      );
      assert.match(inTree, /<Animated\.View\s*ref=\{layerRef\}/);
      assert.match(inTree, /pointerEvents=\{visible \? 'auto' : 'none'\}/);
      assert.match(inTree, /if \(!visible && !drawn\) \{\s*return null;\s*\}/);
      assert.match(inTree, /if \(finished && !visible\) \{\s*setDrawn\(false\);/);
    },
  },
  {
    name: 'iOS modal sequencing: the completion screen\'s demo waits for the feel and Pro sheets to leave',
    run() {
      const screen = read('src', 'screens', 'WorkoutCompletionScreen.tsx');
      // The timer only marks the demo due; an effect opens it once settled.
      assert.match(screen, /setTimeout\(\(\) => setDemoDue\(true\), 900\)/);
      assert.doesNotMatch(screen, /setTimeout\(\(\) => setDemoSheetVisible\(true\)/);
      assert.match(
        screen,
        /useSheetsSettled\(\s*feelSheetVisible \|\| momentSheetVisible,?\s*\)/,
      );
      assert.match(
        screen,
        /if \(demoDue && otherSheetsSettled\) \{\s*setDemoDue\(false\);\s*setDemoSheetVisible\(true\);/,
      );
      // Both sheets it waits for report their dismissal to the hook.
      assert.equal((screen.match(/onDismissed=\{onOtherSheetDismissed\}/g) || []).length, 2);
      // The hook: not settled in the render that closes a sheet, settled again on onDismiss or the fallback.
      const hook = read('src', 'hooks', 'useSheetsSettled.ts');
      assert.match(hook, /if \(up !== previousUp\) \{\s*setPreviousUp\(up\);\s*setLeaving\(!up && Platform\.OS === 'ios'\);/);
      assert.match(hook, /setTimeout\(\(\) => setLeaving\(false\), MODAL_HANDOFF_FALLBACK_MS\)/);
      assert.match(hook, /return \{ settled: !up && !leaving, onDismissed \};/);
    },
  },
  {
    name: 'iOS modal sequencing: the rating sheet is never presented on iOS, and the onboarding helper never opens',
    run() {
      // Both ways to the rating sheet go through usesSystemReviewPrompt, which
      // is true on iOS: there Apple's prompt (or the store page) is used.
      const finish = read('src', 'app', 'finishExits.ts');
      assert.match(
        finish,
        /if \(usesSystemReviewPrompt\(storePlatformOf\(Platform\.OS\)\)\) \{\s*void requestSystemReview\(\);\s*\} else \{\s*setRatingSheetVisible\(true\);/,
      );
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(
        profile,
        /if \(!usesSystemReviewPrompt\(store\)\) \{\s*return \(\) => setRatingSheetVisible\(true\);/,
      );
      for (const file of Object.keys(listSourceFiles())) {
        if (file === 'src/app/finishExits.ts' || file === 'src/app/renderProfileTab.tsx') continue;
        assert.doesNotMatch(read(...file.split('/')), /setRatingSheetVisible\(true\)/, `${file} opens the rating sheet`);
      }
      // The onboarding AI helper's Modal has no opener: its flag is only ever set to false.
      const onboarding = read('src', 'screens', 'OnboardingScreen.tsx');
      assert.match(onboarding, /const \[helperVisible, setHelperVisible\] = useState\(false\);/);
      assert.doesNotMatch(onboarding, /setHelperVisible\((?!false\))/);
      assert.doesNotMatch(onboarding, /setHelperVisible\(\(/);
    },
  },
  {
    name: 'iOS modal sequencing: the guided player\'s rest-alerts ask is held back while the lift sheet is up',
    run() {
      const guided = readGuidedPlayerSource();
      assert.match(guided, /blocked: runSheetOpen \|\| setPanelsOpen,/);
    },
  },
  {
    name: 'iOS modal sequencing: the ledger check fails on a doctored tree',
    run() {
      const files = listSourceFiles();
      // A new Modal nobody listed.
      const added = { ...files, 'src/components/NewThing.tsx': 'export function NewThing() {\n  return <Modal visible={open} transparent>\n</Modal>;\n}\n' };
      assert.match(checkModalLedger(added).join('\n'), /NewThing\.tsx: a <Modal in NewThing is not in the ledger/);
      // A wrapper that stopped passing onDismiss on.
      const kit = 'src/components/sheetKit.tsx';
      const unwired = { ...files, [kit]: files[kit].replace('onDismiss={onDismissed}', '') };
      assert.match(checkModalLedger(unwired).join('\n'), /KitSheet\): listed as reporting its dismissal/);
      // A site moved from visible to unmount.
      const dialog = 'src/components/ConfirmDialog.tsx';
      const unmounted = { ...files, [dialog]: files[dialog].replace('<Modal visible={visible} ', '<Modal ') };
      const problems = checkModalLedger(unmounted).join('\n');
      assert.match(problems, /ConfirmDialog\): the ledger says it closes by visible, the code by unmount/);
      assert.match(problems, /never reports onDismiss for an unmounted Modal/);
      // A removed site.
      const rate = 'src/components/RateAppSheet.tsx';
      const removed = { ...files, [rate]: files[rate].replace(/<Modal\b/g, '<View') };
      assert.match(checkModalLedger(removed).join('\n'), /RateAppSheet\.tsx: listed in the ledger but has no <Modal/);
      // A wall that went back to presenting on iOS.
      const wall = 'src/components/ProgramLimitSheet.tsx';
      const presented = { ...files, [wall]: files[wall].replace("Platform.OS === 'ios'", "Platform.OS === 'web'") };
      assert.match(checkModalLedger(presented).join('\n'), /ProgramLimitSheet\): listed as drawn in the window on iOS/);
      // An ask that takes presses before it has arrived again.
      const ask = 'src/components/RestAlertsSheet.tsx';
      const ungated = { ...files, [ask]: files[ask].replace(/\s+onShow=\{\(\) => setShown\(true\)\}/, '') };
      assert.match(checkModalLedger(ungated).join('\n'), /RestAlertsSheet\): listed as waiting for its own arrival/);
    },
  },
];
