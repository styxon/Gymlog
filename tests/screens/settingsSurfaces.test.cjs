const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

// The sources are CRLF; the anchors below are written with \n.
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');

/** Comments go first: a guard must not be satisfied by its own explanation. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '{}');
}

/** Slices between two anchors, failing loudly when one is missing. */
function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

function countIn(text, needle) {
  return text.split(needle).length - 1;
}

const i18n = read('src', 'lib', 'i18n.ts');

function assertBothLanguages(key) {
  assert.equal(countIn(i18n, `'${key}':`), 2, `${key} needs EN and FI`);
}

/**
 * Settings, the subscription page and the unlock moment (audit 2026-09-16).
 * Screens have no renderer in this suite, so these read the source — with the
 * comments stripped, because every one of these places now carries a comment
 * naming the old shape.
 */
module.exports = [
  {
    name: 'settings: every row icon is one the icon set draws',
    run() {
      const settings = read('src', 'screens', 'SettingsScreen.tsx');
      const code = stripComments(settings);
      const table = between(code, 'const IC_PATHS = {', '} satisfies Record<string, string>;');
      const names = new Set([...table.matchAll(/^\s*([a-zA-Z]+):/gm)].map((match) => match[1]));
      assert.ok(names.size > 10, 'the icon table should be readable');

      // The three coach-log rows asked for brain, file and eye, which the set
      // never had: three blank tiles, and nothing failed.
      const asked = [...code.matchAll(/\b(?:icon|n)="([^"]+)"/g)].map((match) => match[1]);
      assert.ok(asked.length > 20, 'the rows should be readable');
      const missing = asked.filter((name) => !names.has(name));
      assert.deepEqual(missing, [], `rows ask for icons the set does not draw: ${missing.join(', ')}`);

      // And the compiler says so next time: the name is a key of the table,
      // not any string, and a missing one is no longer papered over with ''.
      assert.match(code, /type IcName = keyof typeof IC_PATHS;/);
      assert.match(code, /function Ic\(\{ n, c, s = 20, sw = 2 \}: \{ n: IcName;/);
      assert.match(code, /icon: IcName;/);
      assert.doesNotMatch(code, /IC_PATHS: Record<string, string>/);
      assert.doesNotMatch(code, /IC_PATHS\[n\] \?\? ''/);
    },
  },
  {
    name: 'subscription page: a trial reads as a trial, with no charge and nothing to cancel',
    run() {
      const screen = stripComments(read('src', 'screens', 'SubscriptionScreen.tsx'));
      assert.doesNotMatch(screen, /promoBacked/, 'the view no longer has a promo-only flag');
      assert.match(screen, /model\.grant === 'trial'\)\s*\{\s*return t\(language, 'subs\.status\.trial', \{ date: date\(model\.endsAt\) \}\);/);
      // Both grants get the same two facts: when Pro ends, and no payment.
      assert.match(screen, /if \(model\.grant\) \{\s*return \[proEnds, nothingScheduled\];/);
      // The membership page explains the trial rather than offering to end it.
      assert.match(screen, /\) : model\.grant \? \(/);
      assert.match(screen, /model\.grant === 'trial'\s*\?\s*t\(language, 'subs\.trialNote', \{ date: date\(model\.endsAt\) \}\)/);
      assert.match(screen, /: model\.grant === 'trial'\s*\?\s*'subs\.row\.manageMembershipSubTrial'/);
      assert.match(screen, /model\.state === 'active' && model\.grant === 'trial'\s*\?\s*'subs\.foot\.trial'/);
      for (const key of [
        'subs.status.trial',
        'subs.trialNote',
        'subs.row.manageMembershipSubTrial',
        'subs.foot.trial',
      ]) {
        assertBothLanguages(key);
      }
    },
  },
  {
    name: 'subscription page: the invented card, charge and join date exist only in a demo build',
    run() {
      const screen = stripComments(read('src', 'screens', 'SubscriptionScreen.tsx'));
      const rows = between(screen, 'const metaRows = () => {', '\n  };\n');

      // Every MOCK_BILLING read in the status card sits behind `billing`.
      // They were drawn in every build, with only their tap gated.
      assert.match(rows, /const method: Meta\[\] = billing\s*\?\s*\[\s*\{[^\]]*MOCK_BILLING\.methods\[0\]\.titleKey/);
      assert.match(rows, /const paid: Meta\[\] = billing\s*\?\s*\[\s*\{[^\]]*MOCK_BILLING\.lastChargedAt/);
      assert.equal(countIn(rows, 'MOCK_BILLING.methods'), 1);
      assert.equal(countIn(rows, 'MOCK_BILLING.lastChargedAt'), 1);
      // A release build returns before the join date and the card. What it
      // shows is the next charge counted from the store's period start
      // (lib/storePurchase), with no tap behind it — since 2026-10-08 a
      // release build has a store, and "none scheduled" under a renewing
      // subscription was false.
      const releaseReturn = rows.indexOf('if (!billing) {\n      return [');
      assert.ok(releaseReturn > 0, 'a release build returns before the demo rows');
      const releaseEnd = rows.indexOf('];', releaseReturn);
      const release = rows.slice(releaseReturn, releaseEnd);
      assert.doesNotMatch(release, /MOCK_BILLING|onPress/);
      assert.equal(countIn(release, "'subs.meta.nextChargeValue'"), 1);
      assert.equal(countIn(rows, "'subs.meta.nextChargeValue'"), 2);
      assert.equal(countIn(rows, 'MOCK_BILLING.memberSince'), 1);
      assert.ok(rows.indexOf('MOCK_BILLING.memberSince') > releaseEnd, 'the join date must come after the release return');

      // And the card renders the list, not hand-written rows beside it.
      const statusCard = between(screen, 'styles.statusCard', "model.state === 'active' ? (");
      assert.match(statusCard, /metaRows\(\)\.map\(\(row, index, rows\) =>/);
      assert.doesNotMatch(statusCard, /MOCK_BILLING/);
      assert.doesNotMatch(statusCard, /'subs\.meta\.(method|memberSince|paid|nextChargeValue)'/);
    },
  },
  {
    /**
     * The subscription sheets fit above the navigation keys, and the billing
     * and payment sheets say only their title (#bugs 2026-09-23).
     *
     * Every sheet's Close sat under the phone's navigation bar: the sheet is a
     * Modal, and inside one this app measures the bottom inset as zero. The
     * inset is read on the screen and handed down — a sheet that measured its
     * own would compile, render, and still be covered.
     */
    name: 'subscription sheets: every one clears the navigation bar, and two say only their title',
    run() {
      const sheet = stripComments(read('src', 'components', 'SubscriptionSheet.tsx'));
      assert.match(sheet, /bottomInset: number;/, 'the inset is optional again');
      assert.match(sheet, /style=\{\[styles\.sheet, \{ paddingBottom: 20 \+ bottomInset \}\]\}/);
      assert.doesNotMatch(sheet, /useSafeAreaInsets/, 'measured inside the Modal it is zero');

      const screen = stripComments(read('src', 'screens', 'SubscriptionScreen.tsx'));
      assert.match(screen, /const insets = useSafeAreaInsets\(\);/);
      const opened = countIn(screen, '<SubscriptionSheet');
      assert.ok(opened >= 4, `expected the four sheets, found ${opened}`);
      assert.equal(countIn(screen, 'bottomInset={insets.bottom}'), opened, 'a sheet was left under the navigation bar');

      // Title only, as asked: no line under it and no fine print below.
      for (const [open, close] of [
        ["title={t(language, 'subs.term.title')}", "title={t(language, 'subs.pay.title')}"],
        ["title={t(language, 'subs.pay.title')}", "title={t(language, 'subs.receipts.title')}"],
      ]) {
        const block = between(screen, open, close);
        assert.doesNotMatch(block, /\bsub=\{/, `${open} has a subtitle again`);
        assert.doesNotMatch(block, /footer=|'subs\.(term|pay)\.foot'/, `${open} has fine print again`);
      }
      // "This is your current period" said what the NYKYINEN badge says.
      for (const key of ['subs.term.same', 'subs.term.sub', 'subs.term.foot', 'subs.pay.sub', 'subs.pay.foot']) {
        assert.equal(countIn(i18n, `'${key}':`), 0, `${key} is back`);
      }
      // The change note stays: when the new period lands is not on screen
      // anywhere else.
      assert.match(screen, /termDraft !== mockTerm \? \(\s*<Text style=\{styles\.sheetNote\}>/);
    },
  },
  {
    name: 'unlock moment: a trial gets the trial receipt, not a renewal price',
    run() {
      const tab = stripComments(read('src', 'app', 'renderProfileTab.tsx'));
      const unlock = stripComments(read('src', 'screens', 'PremiumUnlockScreen.tsx'));

      // The trial press carries its end date on the route, so the first frame
      // knows — the preferences write is still on its way. The permission ask
      // for the trial's warning sits between the two now, so the window is
      // wide enough to hold it and no wider.
      assert.match(
        tab,
        /if \(trialUntil\) \{[\s\S]{0,900}navigate\(\{ tab: 'profile', screen: 'premium_unlock', plan, trialUntil \}\);/,
      );
      assert.match(tab, /renewsAt=\{\s*route\.trialUntil\s*\?\s*null\s*:\s*nextChargeAt\(/);
      assert.match(tab, /trialEndsAt=\{route\.trialUntil \?\? null\}/);
      assert.match(
        stripComments(read('src', 'navigation', 'routes.ts')),
        /screen: 'premium_unlock';\s*plan\?: 'monthly' \| 'yearly' \| 'lifetime';\s*trialUntil\?: string;/,
      );

      const receipt = between(unlock, 'styles.receipt, ready', 'unlock.receipt.manage');
      const trialBranch = between(receipt, '{trialEndsAt ? (', ') : (');
      assert.match(trialBranch, /'unlock\.receipt\.trial', \{ days: PRO_TRIAL_DAYS \}/);
      assert.match(trialBranch, /'unlock\.receipt\.trialEnds', \{ date: formatDate\(trialEndsAt, language\) \}/);
      // No price, no renewal and no preview-price note on a trial.
      assert.doesNotMatch(trialBranch, /priceKey|unlock\.receipt\.renews|unlock\.receipt\.noRenewal|pro\.v3\.notice/);
      assert.match(unlock, /\{trialEndsAt\s*\?\s*t\(language, 'unlock\.body\.trial', \{ days: PRO_TRIAL_DAYS \}\)\s*:\s*t\(language, 'unlock\.body'\)\}/);
      for (const key of ['unlock.receipt.trial', 'unlock.receipt.trialEnds', 'unlock.body.trial']) {
        assertBothLanguages(key);
      }
    },
  },
  {
    name: 'unlock moment: the back key goes to Profile, not to the paywall behind it',
    run() {
      const { backSkipsHistory, getBackRoute } = require('../../.test-dist/app/backRoute.js');
      const { ROOT_ROUTES } = require('../../.test-dist/navigation/routes.js');
      const unlock = { tab: 'profile', screen: 'premium_unlock', plan: 'yearly' };
      assert.deepEqual(getBackRoute(unlock, ROOT_ROUTES.workout), ROOT_ROUTES.profile);
      assert.equal(backSkipsHistory(unlock), true);
      // Everywhere else the history still wins over the fallback.
      for (const route of [
        { tab: 'profile', screen: 'premium' },
        { tab: 'profile', screen: 'subscription' },
        { tab: 'home', screen: 'history' },
        ROOT_ROUTES.profile,
      ]) {
        assert.equal(backSkipsHistory(route), false, JSON.stringify(route));
      }

      // navigateBack pops the history before it looks at the fallback, and the
      // unlock moment always has the paywall on top — so the shell must land
      // on the route itself, with the history dropped.
      // The route-level listener, found by its own first stand-down and
      // bounded by its deps — not "the first listener in App.tsx", which
      // stopped naming it when it left for a src/app hook (phase-C split,
      // 2026-10-01).
      const shell = stripComments(readAppWiring().replace(/\r\n/g, '\n'));
      const standDown = "if (cardioRunActive && route.tab === 'home' && route.screen === 'cardio') {";
      assert.equal(shell.split(standDown).length - 1, 1, 'the route-level back is not one listener');
      const routeBack = between(shell, standDown, '}, [cardioRunActive, navigationState.history.length, onboardingActive, route]);');
      const handler = between(routeBack, "BackHandler.addEventListener('hardwareBackPress', () => {", 'return () => subscription.remove();');
      const skip = handler.indexOf('if (nextRoute && backSkipsHistory(route)) {\n        resetToRoute(nextRoute);\n        return true;');
      assert.ok(skip > 0, 'the unlock route resets to its back route');
      assert.ok(skip < handler.indexOf('navigateBack(nextRoute);'), 'before the history is popped');
    },
  },
  {
    name: 'reset: the coach copies kept under the label are deleted too, and a failure is said once',
    run() {
      const tab = stripComments(read('src', 'app', 'renderProfileTab.tsx'));
      const reset = between(tab, 'onResetAllData={async () => {', '\n        }}\n');
      // The label is read before the wipe clears it (the wipe itself files it
      // as owed — tests/storage/resetKeepsInstall)...
      const label = reset.indexOf('const logId = preferences.aiLogId;');
      const wipe = reset.indexOf('await resetAllData();');
      assert.ok(label >= 0 && label < wipe, 'the label is read before the reset drops it');
      // ...and the delete is asked for after it, through the runner that
      // retries, so the local wipe never waits on the network.
      assert.doesNotMatch(reset, /forgetAiCoachLog/, 'one path to the server, the retrying one');
      const ask = reset.search(/if \(logId\) \{\s*const notYet = await deletePendingAiLogs\(\[logId\]\);/);
      assert.ok(ask > wipe, 'the delete is asked for after the reset');
      // A failure becomes a sentence, once, in the language the reset came
      // back in (the phone's). The retries after it are silent.
      assert.match(
        reset,
        /if \(notYet\.includes\(logId\)\) \{\s*showToast\(t\(resolveDeviceLanguage\(\), 'toast\.resetCoachCopiesPending'\)\);/,
      );
      assert.equal(countIn(tab, "'toast.resetCoachCopiesPending'"), 1, 'said in one place only');
      assertBothLanguages('toast.resetCoachCopiesPending');
      assert.doesNotMatch(i18n, /'toast\.resetCoachCopiesKept'/, 'the 24-month sentence is gone with the lost label');
    },
  },
  {
    name: 'onboarding: the recommendation page that nothing rendered is gone with its doors',
    run() {
      // renderRecommendation and renderProjectedPreview were never called, so
      // the two props only they used — and the four App.tsx handlers behind
      // them — were wiring to nowhere. `onSkip` was only ever the fallback of
      // `onBackToEntry`, which the first run always passes.
      const onboarding = stripComments(read('src', 'screens', 'OnboardingScreen.tsx'));
      for (const name of ['renderRecommendation', 'renderProjectedPreview', 'onCompleteToProgramDetail', 'onCompleteToCustom', 'onSkip']) {
        assert.doesNotMatch(onboarding, new RegExp(`\\b${name}\\b`), `${name} is back in OnboardingScreen`);
      }
      // The dead handlers are checked over the whole shell — App.tsx and the
      // src/app modules the phase-B split (2026-09-30) moved VinhaApp's hooks
      // into — so none of them can come back in a hook either.
      const shell = stripComments(readAppWiring().replace(/\r\n/g, '\n'));
      for (const name of [
        'handleOnboardingCompleteToProgramDetail',
        'handleOnboardingCompleteToCustom',
        'handleSetupOpenProgramDetail',
        'handleSetupBuildOwn',
        'persistSetupSelection',
        'handleRedoOnboarding',
        'handleOnboardingSkip',
        'openRecommendedProgramDetail',
      ]) {
        assert.doesNotMatch(shell, new RegExp(`\\b${name}\\b`), `${name} is back in App.tsx or src/app`);
      }
      // The back button on the first question still has somewhere to go.
      assert.match(onboarding, /void runAction\(\(\) => onBackToEntry\?\.\(\)\);/);
      // Over the shell: the first run's render moved to
      // src/app/renderOnboarding.tsx (phase C, 2026-10-01).
      assert.match(shell, /onBackToEntry=\{\(\) => setOnboardingStep\('about'\)\}/);
    },
  },
];
