const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const {
  planSetupHandoff,
  resolveSetupTrackingOffer,
} = require('../../src/lib/setupHandoff');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

module.exports = [
  {
    name: 'setupHandoff: a focus area maps to the tape that actually measures it',
    run() {
      // Twelve focus areas, seven tape measurements. Glutes are measured at the
      // hips and hamstrings at the thigh, so this is a mapping and not a rename.
      assert.deepEqual(resolveSetupTrackingOffer(['glutes']), { cardKey: 'hips', focus: 'glutes' });
      assert.deepEqual(resolveSetupTrackingOffer(['hamstrings']), { cardKey: 'thighs', focus: 'hamstrings' });
      assert.deepEqual(resolveSetupTrackingOffer(['quads']), { cardKey: 'thighs', focus: 'quads' });
      assert.deepEqual(resolveSetupTrackingOffer(['core']), { cardKey: 'waist', focus: 'core' });
      assert.deepEqual(resolveSetupTrackingOffer(['chest']), { cardKey: 'chest', focus: 'chest' });
    },
  },
  {
    name: 'setupHandoff: an area with no tape falls back to the one number everyone has',
    run() {
      // Mobility and conditioning are not measured with a tape anywhere in
      // this app. Back WAS in this list until 2026-08-31, when it got its own
      // measurement — it was a focus area onboarding let a reader pick and
      // nothing downstream could act on.
      for (const focus of [['mobility'], ['conditioning'], ['bodyweight'], []]) {
        assert.deepEqual(
          resolveSetupTrackingOffer(focus),
          { cardKey: 'bodyweight', focus: null },
          JSON.stringify(focus),
        );
      }
    },
  },
  {
    name: 'setupHandoff: several focus areas still produce one offer',
    run() {
      // Onboarding allows several. Three cards at the door is a form, not an
      // offer, so the first area with a measurement wins.
      assert.deepEqual(resolveSetupTrackingOffer(['glutes', 'chest', 'arms']), { cardKey: 'hips', focus: 'glutes' });
      // ...and an unmeasurable area does not block the ones behind it.
      assert.deepEqual(resolveSetupTrackingOffer(['mobility', 'conditioning', 'arms']), { cardKey: 'arms', focus: 'arms' });
      // Back now answers for itself rather than falling through.
      assert.deepEqual(resolveSetupTrackingOffer(['back']), { cardKey: 'back', focus: 'back' });
    },
  },
  {
    name: 'setupHandoff: the step does not appear when it has nothing to offer',
    run() {
      // What happens to a reader who runs onboarding again: the widget is
      // already placed and the card is already on Home. One more tap between
      // the questions and the app, for nothing.
      const plan = planSetupHandoff({
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight', 'hips'],
        focusAreas: ['glutes'],
      });
      assert.equal(plan.shouldShow, false);
      assert.equal(plan.tracking, null);
      assert.equal(plan.offerWidget, false);
    },
  },
  {
    name: 'setupHandoff: an already-pinned card is not offered twice',
    run() {
      // Bodyweight is on Home by default, so a reader whose only focus has no
      // tape is offered the widget alone rather than a card they already have.
      // (Back was the example here until it got its own measurement on
      // 2026-08-31 — it now answers for itself.)
      const plan = planSetupHandoff({
        canOfferWidget: true,
        pinnedCardKeys: ['bodyweight'],
        focusAreas: ['mobility'],
      });
      assert.equal(plan.shouldShow, true);
      assert.equal(plan.offerWidget, true);
      assert.equal(plan.tracking, null);
    },
  },
  {
    name: 'setupHandoff: an install that predates the flag is not ambushed by the step',
    run() {
      // The flag defaults to false, and a stored install has no value for it. On
      // the next launch that reads as "never handed off" and an old install with
      // months of history would meet a first-run step before its own Home.
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
        'utf8',
      );
      const block = source.slice(source.indexOf('setupHandoffCompleted:'));
      assert.match(
        block.slice(0, 400),
        /onboardingCompleted === true/,
        'a missing setupHandoffCompleted must fall back to onboardingCompleted, not to false',
      );
    },
  },
  {
    name: 'setupHandoff: the widget alone, or the card alone, is enough to show it',
    run() {
      const cardOnly = planSetupHandoff({
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight'],
        focusAreas: ['glutes'],
      });
      assert.equal(cardOnly.shouldShow, true);
      assert.deepEqual(cardOnly.tracking, { cardKey: 'hips', focus: 'glutes' });

      const both = planSetupHandoff({
        canOfferWidget: true,
        pinnedCardKeys: [],
        focusAreas: ['glutes'],
      });
      assert.equal(both.shouldShow, true);
      assert.equal(both.offerWidget, true);
      assert.deepEqual(both.tracking, { cardKey: 'hips', focus: 'glutes' });
    },
  },
  {
    name: 'the heading names one thing, because the page holds one row',
    run() {
      // It used to count the plan's offers, and that count stopped being what
      // the page showed when sign-in, Pro and the sites each became a page of
      // their own (2026-09-10): four offers, one switch, and a heading
      // claiming the other three. The list page renders only when the widget
      // can be pinned, and the widget is the only row on it.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'SetupHandoffScreen.tsx'),
        'utf8',
      );
      assert.match(screen, /const titleKey = 'handoff\.titleOne' as const;/);
      // No count reaches the heading any more, by either name.
      assert.doesNotMatch(screen, /countSetupHandoffOffers/);
      assert.doesNotMatch(screen, /handoff\.titleMany/);

      // And the copy exists in both languages, while the two headings that
      // could only ever be wrong are gone from both.
      const i18n = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
      assert.match(i18n, /'handoff\.titleOne': 'One more thing'/);
      assert.match(i18n, /'handoff\.titleOne': 'Yksi asia vielä'/);
      assert.doesNotMatch(i18n, /'handoff\.titleMany':/);
      assert.doesNotMatch(i18n, /'handoff\.title':/);
    },
  },
  {
    name: 'the sign-in card is an offer beside the door, never in it',
    run() {
      // Decision 2026-08-22: real Google sign-in, offered on the hand-off
      // screen for free and Pro alike — and only when this build can actually
      // sign someone in. A build without the OAuth client shows nothing.
      const offered = planSetupHandoff({
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight', 'hips'],
        focusAreas: ['glutes'],
        canOfferAccountBackup: true,
      });
      assert.equal(offered.offerAccountBackup, true);
      // Even when every other offer is exhausted, the sign-in card alone
      // keeps the step alive...
      assert.equal(offered.shouldShow, true);
      // Every site this reader's answers point at is already on Home, so the
      // tracking page has nothing to ask and the account is genuinely alone.
      assert.equal(offered.offerTrackedSites, false);

      // ...and without it, the same exhausted plan hides the step entirely —
      // a signed-in reader re-running onboarding sees no dead card.
      const hidden = planSetupHandoff({
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight', 'hips'],
        focusAreas: ['glutes'],
        canOfferAccountBackup: false,
      });
      assert.equal(hidden.offerAccountBackup, false);
      assert.equal(hidden.shouldShow, false);

      // "Beside the door, never in it" is a fact about the SWITCH, not about
      // a word in the sentence.
      //
      // This used to assert that the copy contained "Optional" /
      // "Vapaaehtoinen". That pinned one wording of the principle rather than
      // the principle, and it went red on 2026-08-31 for a copy pass that did
      // not weaken the offer at all. What actually keeps sign-in optional is
      // that the toggle starts OFF, so pressing Done without touching it is a
      // complete answer — a string cannot promise that and this can.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'SetupHandoffScreen.tsx'),
        'utf8',
      );
      assert.match(screen, /const \[signInForBackup, setSignInForBackup\] = useState\(false\)/);
      // The answer defaults to that state, and only the sign-in button passes
      // a yes in its place (see the next suite).
      assert.match(screen, /const finish = \(widget = addWidget, signIn = signInForBackup\) =>/);
      assert.match(screen, /signInForBackup: plan\.offerAccountBackup && signIn,/);
      // And no separate "not now": Done with everything off already is one.
      assert.doesNotMatch(screen, /handoff\.notNow|handoff\.skip/);
    },
  },
  {
    /**
     * The last screen of onboarding ends on the same button as the five before
     * it, clear of the gesture bar.
     *
     * It was the A3 cut button at 50dp — a cut corner and a diagonal sheen
     * where every other footer in the flow is a plain rounded rectangle at
     * 56–62dp — and its clearance was a bare `insets.bottom`, which on this
     * screen comes back 0. Measured on the emulator (2026-09-08): the button
     * ended at y=2368 of 2400 with 31px under it, and the gesture pill is drawn
     * at y=2364..2372 — on the button's bottom edge. It has 164px now.
     */
    name: 'the handoff footer clears the gesture bar and wears the same button as the rest of the flow',
    run() {
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'SetupHandoffScreen.tsx'),
        'utf8',
      );

      // A floor under the inset, not the inset alone: an inset that can be
      // zero is not a clearance.
      assert.match(screen, /paddingBottom: Math\.max\(insets\.bottom, GESTURE_BAR_FLOOR\) \+ spacing\.md/);
      assert.match(screen, /const GESTURE_BAR_FLOOR = 24;/);
      assert.doesNotMatch(
        screen,
        /paddingBottom: insets\.bottom \+ spacing/,
        'the bare inset is back, and on this screen it is 0',
      );

      // The shape the rest of the flow ends on: OnboardingScreen's primary
      // button is minHeight 62 / radius 18, StartPathScreen's is height 56 /
      // radius 18. The cut button is neither.
      assert.match(screen, /done: \{\s*\r?\n\s*minHeight: 62,\s*\r?\n\s*borderRadius: 18,/);
      assert.doesNotMatch(screen, /CutButton/, 'the A3 cut button is back on the last onboarding screen');

      // Orange, as the onboarding Continue, with the ink made for orange
      // (user 2026-10-17; violet for a day after #384).
      //
      // Scoped to the button's own block. Unscoped, this matched the check
      // circle's fill further down the same file (review, #78).
      assert.match(screen, /done: \{[^}]*backgroundColor: theme\.orange,/);
      assert.match(screen, /doneText: \{\s*\r?\n\s*color: theme\.onHighlight,/);
    },
  },
  {
    name: 'the Pro row is offered to everyone who has not bought it, and to nobody who has',
    run() {
      const base = {
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight', 'chest'],
        focusAreas: ['chest'],
        canOfferAccountBackup: false,
      };

      // Nothing else to offer, and Pro alone is enough to show the step: it is
      // the last screen before the app, which is where the page belongs.
      const withPro = planSetupHandoff({ ...base, canOfferPro: true });
      assert.equal(withPro.offerPro, true);
      assert.equal(withPro.shouldShow, true);
      assert.equal(withPro.offerTrackedSites, false);

      // A reader who already bought it is not sold it again, and with nothing
      // else left the step does not appear at all.
      const bought = planSetupHandoff({ ...base, canOfferPro: false });
      assert.equal(bought.offerPro, false);
      assert.equal(bought.shouldShow, false);

      // Same three-valued trap the account offer had: an older stored call
      // carries no field, and `undefined` must not leak into shouldShow.
      const older = planSetupHandoff(base);
      assert.equal(older.offerPro, false);
      assert.equal(older.shouldShow, false);

      // And it stands alongside the others rather than replacing one.
      const everything = planSetupHandoff({
        canOfferWidget: true,
        pinnedCardKeys: [],
        focusAreas: ['chest'],
        canOfferAccountBackup: true,
        canOfferPro: true,
      });
      // Before the Pro page only sign-in is asked; the widget waits for the
      // second half (user 2026-10-17).
      assert.equal(everything.phase, 'beforePro');
      assert.equal(everything.offerWidget, false);
      assert.equal(everything.offerAccountBackup, true);
      assert.equal(everything.offerPro, true);
      assert.equal(everything.offerTrackedSites, true);
      assert.deepEqual(everything.trackedSiteOptions, ['chest']);

      const after = planSetupHandoff({
        canOfferWidget: true,
        pinnedCardKeys: [],
        focusAreas: ['chest'],
        canOfferAccountBackup: true,
        canOfferPro: true,
        proStepDone: true,
      });
      assert.equal(after.phase, 'afterPro');
      assert.equal(after.offerWidget, true);
      assert.equal(after.offerPro, false, 'the Pro page is not opened twice');
    },
  },
  {
    /**
     * A page only when it has something on it.
     *
     * The tracking dialog was on every hand-off. A reader whose chest was on
     * Home already — exactly the plan the test above describes — was asked to
     * pick chest again, unselected, and picking it changed nothing (backfill
     * review of #92, 2026-09-16).
     */
    name: 'the hand-off shows only the pages that have something to ask',
    run() {
      const base = {
        canOfferWidget: false,
        pinnedCardKeys: ['bodyweight', 'chest'],
        focusAreas: ['chest'],
        canOfferAccountBackup: false,
        canOfferPro: true,
      };

      // Every site on Home, Pro still to offer: no page, straight to Pro.
      const onlyPro = planSetupHandoff(base);
      assert.deepEqual(onlyPro.pages, []);
      assert.equal(onlyPro.shouldShow, true);
      assert.equal(onlyPro.offerPro, true);

      // The second half, once the Pro page has been shown.
      const after = { ...base, proStepDone: true };
      assert.deepEqual(planSetupHandoff(after).pages, []);
      assert.equal(planSetupHandoff(after).shouldShow, false, 'nothing left after Pro: the step closes');

      // A site not on Home yet brings the dialog back, and so does naming
      // nothing measurable, when the dialog offers every site.
      assert.deepEqual(planSetupHandoff({ ...after, pinnedCardKeys: ['bodyweight'] }).pages, ['tracking']);
      assert.deepEqual(planSetupHandoff({ ...after, focusAreas: [] }).pages, ['tracking']);
      // In order, each on its own condition: sign-in before the Pro page, the
      // widget, the sites and the theme after it (user 2026-10-17).
      const full = { ...base, pinnedCardKeys: [], canOfferAccountBackup: true, canOfferWidget: true, canOfferTheme: true };
      assert.deepEqual(planSetupHandoff(full).pages, ['signin']);
      assert.deepEqual(planSetupHandoff({ ...full, proStepDone: true }).pages, ['offers', 'tracking', 'theme']);
      // No Pro page to show (bought): no first half, and sign-in leads the second.
      assert.deepEqual(planSetupHandoff({ ...full, canOfferPro: false }).pages, ['signin', 'offers', 'tracking', 'theme']);
      // Bought on the Pro page: canOfferPro flips, and sign-in, already asked
      // in the first half, is not asked again.
      assert.deepEqual(
        planSetupHandoff({ ...full, canOfferPro: false, proStepDone: true }).pages,
        ['offers', 'tracking', 'theme'],
      );
      assert.deepEqual(planSetupHandoff({ ...after, canOfferWidget: true }).pages, ['offers']);
      assert.deepEqual(planSetupHandoff({ ...base, canOfferAccountBackup: true }).pages, ['signin']);
      // The theme page alone is enough to show the second half.
      assert.deepEqual(planSetupHandoff({ ...after, canOfferTheme: true }).pages, ['theme']);
      assert.equal(planSetupHandoff({ ...after, canOfferTheme: true }).shouldShow, true);

      // The screen reads the plan's list, and with nothing on it goes to Pro
      // once rather than drawing a title over an empty page.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'SetupHandoffScreen.tsx'),
        'utf8',
      );
      assert.match(screen, /const pages = plan\.pages;/);
      assert.doesNotMatch(screen, /'tracking' as const,/);
      assert.match(
        screen,
        /if \(pages\.length === 0 && !finishedEmpty\.current\) \{\s*finishedEmpty\.current = true;\s*finish\(\);/,
      );
      assert.match(screen, /if \(pages\.length === 0\) \{\s*return <View style=\{styles\.screen\} \/>;/);
    },
  },
  {
    /**
     * The policy and the terms open over the hand-off, not as a route, so the
     * route-level back handler never knew they were up: on a fresh install
     * back left the app with the terms still showing (backfill review of #92,
     * 2026-09-16).
     */
    name: 'the back key closes a document opened over the hand-off',
    run() {
      // The whole shell: both listeners left App.tsx for one src/app hook in
      // the phase-C split (2026-10-01), in the order they were declared, so
      // `route < own` still compares positions within one file.
      const app = readAppWiring();
      const own = app.search(
        /if \(!handoffLegalDocument\) \{\s*return undefined;\s*\}\s*const subscription = BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*setHandoffLegalDocument\(null\);\s*return true;/,
      );
      assert.ok(own > 0, 'no back listener of its own while a document is open');
      // The hand-off's own check sits between (2026-09-17): after the
      // document, before the route. So does the terms sheet's (2026-09-26),
      // which is also drawn over the route rather than routed — and the
      // document check still comes first, so back closes a document opened
      // from either.
      const route = app.search(
        /if \(handoffLegalOpenRef\.current\) \{\s*setHandoffLegalDocument\(null\);\s*return true;\s*\}\s*(?:\/\/[^\n]*\n\s*)*if \(setupHandoffActiveRef\.current\) \{\s*return false;\s*\}\s*(?:\/\/[^\n]*\n\s*)*if \(legalConsentDueRef\.current\) \{\s*return false;\s*\}\s*const nextRoute = getBackRoute/,
      );
      assert.ok(route > 0, 'the route handler would walk past an open document');
      // Registered after the route handler, so it is the newest listener.
      assert.ok(route < own, 'the document listener has to be declared after the route one');
      assert.match(app, /handoffLegalOpenRef\.current = handoffLegalDocument !== null;/);
    },
  },
  {
    /**
     * The Pro page between the two halves (user 2026-10-17): sign-in, Pro,
     * then the widget, the sites and the theme. Three places have to agree:
     * the shell lets the Pro page show while the hand-off is still owed, the
     * first Done records the Pro step only after it has navigated, and a
     * stored install from before the flag loads it as false, not undefined.
     */
    name: 'the hand-off steps aside for the Pro page and comes back after it',
    run() {
      // Shown, not owed: aside on any Profile screen but the list, so the
      // Pro page's terms, policy and subscription links open, and the terms
      // sheet can ask over the Pro page before anything is bought.
      // The route-to-screen dispatch moved out of App.tsx into src/app/renderAppContent.tsx.
      const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderAppContent.tsx'), 'utf8');
      assert.match(app, /\} else if \(\s*(\/\/[^\n]*\n\s*)*setupHandoffShown &&\s*setupHandoffPlan\s*\)/);

      const done = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'setupHandoffDone.tsx'), 'utf8');
      const navigateAt = done.indexOf("navigate({ tab: 'profile', screen: 'premium' })");
      const proSeenAt = done.indexOf('setupHandoffProSeen: true');
      assert.ok(navigateAt > 0 && proSeenAt > navigateAt, 'the Pro step is recorded after the Pro page opens');
      // The first half does not finish the hand-off.
      assert.match(done, /beforePro \? \{\} : \{ setupHandoffCompleted: true \}/);

      const overlays = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useSetupHandoffOverlays.tsx'), 'utf8');
      assert.match(overlays, /proStepDone: preferences\.setupHandoffProSeen,/);
      assert.match(
        overlays,
        /setupHandoffShown =\s*setupHandoffActive && !\(route\.tab === 'profile' && route\.screen !== ROOT_ROUTES\.profile\.screen\)/,
      );
      assert.match(overlays, /!onboardingActive && !setupHandoffShown\s*\? legalAcceptanceDue/);
      assert.match(overlays, /canOfferTheme: true,/);

      const { normalizeDatabase } = require('../../src/storage/database');
      const old = normalizeDatabase({ preferences: { onboardingCompleted: false } });
      assert.equal(old.preferences.setupHandoffProSeen, false);
      assert.equal(
        normalizeDatabase({ preferences: { setupHandoffProSeen: true } }).preferences.setupHandoffProSeen,
        true,
      );
      // An install from before the dark default keeps the light it had.
      assert.equal(normalizeDatabase({ preferences: { onboardingCompleted: true } }).preferences.darkThemeEnabled, false);
      assert.equal(normalizeDatabase({ preferences: {} }).preferences.darkThemeEnabled, true);
    },
  },
];
