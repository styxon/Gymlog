const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

// The switchboard and its extracted tab modules — see helpers/appWiringSource.
const appSource = readAppWiring();
const settingsSource = read('src', 'screens', 'SettingsScreen.tsx');
const premiumSource = read('src', 'screens', 'PremiumScreen.tsx');
const homeSource = read('src', 'screens', 'HomeScreen.tsx');
const i18nSource = read('src', 'lib', 'i18n.ts');
const unlockSource = read('src', 'screens', 'PremiumUnlockScreen.tsx');
const guidedSource = read('src', 'screens', 'GuidedPlayerScreen.tsx');

/**
 * The Pro/Free audit (2026-07-28) found three ways the paid tier lied: a promo
 * code that never expired, screens that read the preview switch instead of the
 * entitlement, and a dark-theme toggle sold as a Pro perk that repainted
 * nothing. These guard the fixes, because every one of them is invisible until
 * someone pays.
 */

module.exports = [
  {
    name: 'the guided player can do everything the list logger can do to a session',
    run() {
      // The list logger was the only place you could swap an exercise, skip
      // one, or add a set — so the only way to do any of them mid-workout was
      // to leave the guided flow entirely. All three happen in a real gym
      // (rack taken, shoulder complaining, one more set in you).
      //
      // This is the precondition for ever retiring the list view: while the
      // guided player is missing any of these, the list is not redundant, it
      // is the only editor.
      for (const action of ['swapExercise', 'skipExercise', 'addSet', 'completeSet']) {
        assert.match(
          guidedSource,
          new RegExp(`workout\\.${action}\\(`),
          `the guided player cannot ${action} — the list logger still has to exist for it`,
        );
      }

      // Skipping drops that exercise's steps, so whatever followed slides into
      // the index its block started at — that index is the landing. Asking
      // resolveGuidedResumeIndex instead is the bug this replaced: it answers 0
      // when no set is complete, so skipping the first exercise before logging
      // anything threw the user back to the warm-up.
      assert.match(guidedSource, /resyncTargetRef/);
      assert.doesNotMatch(guidedSource, /resolveGuidedResumeIndex\(steps, null/);

      // The clock must not run while a sheet is open over the set.
      assert.match(guidedSource, /const frozen = guidedClockHeld\(\{[^}]*\bswapOpen,/);

      // Calling the action is not the same as the action landing. The swap
      // above satisfied this suite while being completely dead on screen: the
      // step list is memoised, every set step bakes in the exercise name, and
      // the memo key listed only slots, set counts and skips. The name moved in
      // state and the player went on rendering the steps it already had. The
      // key now comes from the module that builds the steps, so the thing the
      // steps depend on and the thing that invalidates them cannot drift apart.
      assert.match(guidedSource, /getGuidedStepPlanKey\(guidedExercises\)/);
    },
  },
  {
    name: 'every screen that pins its own CTA hides the floating tab bar',
    run() {
      // Three screens shipped with a pinned footer under the floating bar: the
      // Pro page (a bar of dead space reserved under the CTA), the membership
      // screen (second button covered) and the post-onboarding offer (primary
      // button covered outright, on the one screen shown once). The bar is a
      // sibling of the content, not a layout the screens can see, so nothing
      // catches this except looking at the phone.
      //
      // If you add a screen with a bottom-pinned action, add it here too.
      const gate = appSource.slice(
        appSource.indexOf('const showTabBar ='),
        appSource.indexOf('const setupOnboardingActive'),
      );
      assert.match(gate, /screen === 'premium'/);
      assert.match(gate, /screen === 'membership_end'/);
      // pro_offer was the third entry until the screen was deleted (2026-08-25).
    },
  },
  {
    name: 'no screen takes a promo code any more: the codes lived in the bundle',
    run() {
      // The list of codes shipped inside the APK, so anyone who unpacked it
      // could redeem without limit (user 2026-09-15: "promokoodit nyt pois").
      // The door is closed until Play's own promo codes, which Play checks.
      assert.doesNotMatch(appSource, /PromoCodeScreen|onRedeemed|screen(?: ===|:) 'promo'|onOpenPromo/);
      assert.doesNotMatch(settingsSource, /onOpenPromo|settings\.promo/);
      assert.doesNotMatch(i18nSource, /'settings\.promo'|'promo\./);
      // The files themselves, and any write of the grant, are pinned in proLock.
    },
  },
  {
    name: 'the logger and the premium screen ask the entitlement, not the preview switch',
    run() {
      // hasAdaptiveCoachPremium was the list logger's prop and went with it.
      assert.doesNotMatch(appSource, /hasAdaptiveCoachPremium/);
      assert.match(appSource, /proUnlocked=\{coachProUnlocked\}/);
    },
  },
  {
    name: 'Settings resolves Pro through the entitlement',
    run() {
      // Plan settings sat beside this guard until the screen was removed
      // outright (user decision 2026-08-25) — its equipment, swap and
      // progression editors went with it.

      // Settings resolves through resolveProEntitlement — a promo user
      // is Pro. The demo row that named the granting source is gone
      // (2026-08-22), so the unlocked boolean alone is what remains.
      assert.match(
        settingsSource,
        /import \{ resolveProEntitlement \} from '\.\.\/lib\/proEntitlement';/,
      );
      assert.match(settingsSource, /resolveProEntitlement\(preferences\)\.unlocked/);

      // The demo switch left Settings entirely (2026-08-22), so there is no
      // longer ANY legitimate read of the raw preview flag here: everywhere it
      // would hide promo users from a Pro surface, which is the bug this whole
      // suite exists for.
      assert.doesNotMatch(
        settingsSource,
        /preferences\.adaptiveCoachPremiumUnlocked/,
        'SettingsScreen reads the raw preview flag — a promo user is Pro too',
      );
    },
  },
  {
    name: 'the dark-theme row is one live switch, for everyone',
    run() {
      // History of this row: "Soon" until the engine landed 2026-08-01, then a
      // two-state row (switch for Pro, PRO pill for everyone else), then free
      // outright on 2026-08-23. What it must not grow back is a locked state —
      // a switch that repaints nothing is the failure this guards.
      assert.match(settingsSource, /value=\{preferences\.darkThemeEnabled\}/);
      assert.match(settingsSource, /onPreferencesChange\(\{ darkThemeEnabled: next \}\)/);
      assert.doesNotMatch(settingsSource, /themeRow|themeProPill/);
      // The row is not a paywall entry point any more, but the membership row
      // above it still is — so onOpenPremium must stay wired for that one.
      assert.match(settingsSource, /onPress=\{proUnlocked \? onOpenSubscription : onOpenPremium\}/);
      // The subtitle no longer promises something unbuilt, nor sells Pro.
      assert.doesNotMatch(i18nSource, /'settings\.darkTheme\.sub': '[^']*still in build/);
      assert.doesNotMatch(i18nSource, /'settings\.darkTheme\.sub': '[^']*Pro/);
    },
  },
  {
    name: 'the Pro page sells five reasons, and every one of them is wired',
    run() {
      // v2 sold with a 22-row comparison table and twelve feature cards. v3
      // deletes both (design: "Vinha Pro v3 — tumma"). The guard does not go
      // with them — it narrows to the claims that are left, because a shorter
      // page is only an improvement if the five survivors are all true.
      // v6 turned the one pitch into three tabs and moved the rows out of the
      // screen into lib/proTiers, where each one names the gate that makes it
      // true. tests/lib/proTiers checks that every named gate exists; what is
      // checked HERE is the part that was always the point — the free-tier
      // numbers are read from the constants that enforce them.
      const tiersSource = read('src', 'lib', 'proTiers.ts');
      const pro = tiersSource.match(/  pro: \{[\s\S]*?\n  \},/);
      assert.ok(pro, 'the Pro tier should be declared');

      // Six rows, and a seventh is a decision rather than a tidy-up. Fewer
      // than that and the tab is thinner than the Free tab beside it, which on
      // a page where the two are one tap apart is its own argument.
      assert.equal(
        (pro[0].match(/titleKey: 'pro\.v6\.pro\./g) ?? []).length,
        6,
        'the Pro pitch is six rows — changing that is a product decision',
      );

      for (const key of ['coach', 'progression', 'programs', 'history', 'setlog', 'analysis']) {
        assert.match(pro[0], new RegExp(`titleKey: 'pro\\.v6\\.pro\\.${key}\\.t'`));
      }

      // A number typed into sales copy drifts silently; a number read from the
      // gate cannot. This is why the comparison table could be deleted at all.
      for (const [key, constant] of [
        ['pro.v6.free.own', 'FREE_CUSTOM_PROGRAM_LIMIT'],
        ['pro.v6.free.history', 'FREE_TREND_MONTHS'],
        ['pro.v6.pro.coach', 'PRO_COACH_QUESTIONS_PER_MONTH'],
      ]) {
        assert.match(
          tiersSource,
          new RegExp(`${key.replace(/\./g, '\\.')}\\.[\\s\\S]{0,220}?${constant}`),
          `${key} should read its free number from ${constant}`,
        );
      }

      // Unbuilt things are not sold at all any more. Cloud backup used to wear
      // a SOON badge here; a paywall that sells a roadmap has to be re-read
      // every time the roadmap slips, so v3 simply does not mention it.
      assert.doesNotMatch(premiumSource, /'pro\.v3\.[a-z.]*backup/i);
      assert.doesNotMatch(premiumSource, /soon: true/);

      // The one claim that could still read as a lie: "all of your history"
      // next to "free shows 3 months". The log is never capped in either
      // tier — only the charts and records are — so the body has to say which,
      // and the trust block has to state the log outright.
      const historyBody = i18nSource
        .split('\n')
        .filter((line) => line.includes("'pro.v6.pro.history.b':"));
      assert.equal(historyBody.length, 2, 'both languages');
      for (const line of historyBody) {
        assert.match(
          line,
          /[Cc]harts and records|[Kk]uvaajat ja ennätykset/,
          'the history row must say charts and records, not "your history" — the log is never capped',
        );
      }
      // And the log promise itself is still stated on the page. It was a
      // standing line under the CTA until 2026-08-29, when the footer prose was
      // cut back to the legal links; it now lives on the Free tab's own row,
      // which is the tab a lapsing subscriber lands on.
      const yours = i18nSource
        .split('\n')
        .filter((line) => line.includes("'pro.v6.free.yours.b':"));
      assert.equal(yours.length, 2, 'both languages');
      for (const line of yours) {
        assert.match(line, /forever|ikuisesti/, 'the log promise must survive the trim');
      }
      assert.doesNotMatch(premiumSource, /8 weeks|8 viikkoa/);

      // Claims from the mocks that describe things this app does not do.
      const copy = i18nSource.match(/'pro\.v3\.[\s\S]*?'pro\.v3\.fine\.lifetime': '[^']*'/g)?.join('\n') ?? '';
      assert.ok(copy.length > 0, 'the pro.v3 copy block should be findable');
      assert.ok(
        copy.length < 20000,
        'the pro.v3 span ran past its own block — a pro.v3.* key was added after pro.v3.fine.lifetime',
      );
      assert.doesNotMatch(copy, /watch|wrist|kello|ranteest/i, 'there is no watch app');
      assert.doesNotMatch(copy, /cloud|pilvi/i, 'cloud backup is unbuilt and is not sold here');
    },
  },
  {
    name: 'the Pro page table promises are wired, not just printed',
    run() {
      // "AI coach — 25 / month": App resolves the allowance and the chat gates
      // on it. The tier flipped on 2026-08-29 — the counter belongs to Pro now,
      // and free reaches the model only through its three demo moments.
      assert.match(appSource, /questionsRemaining=\{resolveCoachQuota\(preferences\.aiCoachProQuota\)\.remaining\}/);
      assert.match(appSource, /recordCoachQuestion\(current\.aiCoachProQuota\)/);
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(chat, /const canAsk = proUnlocked && questionsRemaining > 0;/);
      // And the demo question is the only thing allowed past that gate.
      assert.match(chat, /if \(!canAsk && !force\) \{/);
      assert.match(appSource, /resolveDueCoachDemoMoment\(\{/);
      // Out of quota the door stays open: the question still sends and the
      // answer comes back blurred, rather than the chat refusing to talk. This
      // is what makes a free tier with no allowance liveable rather than a
      // dead input — the blurred answer is real, local and costs nothing.
      // What is blurred is the REAL withheld answer — the offline coach is
      // free and deterministic, so blurring a placeholder would be a bluff.
      assert.match(chat, /buildAiCoachPreviewAnswer\(trimmed, trainingContext, language\)/);
      assert.match(chat, /lockedBody: \[withheld\.takeaway/);

      // "AI program builder — Pro". The composer screen is gone and every
      // entrance now opens the chat, which is free for everyone — so the gate
      // moved from the route onto the ACT of composing. Gating the entrance
      // instead would have sent a free reader to a paywall rather than to a
      // chat they can use, and gating nothing would have given the feature away
      // (user 2026-08-26, "koostajaruudun voi poistaa").
      assert.doesNotMatch(appSource, /ai_setup/);
      // Composing is gated inside the compose branch, and the catalog branch is
      // checked BEFORE the gate on purpose: browsing and running ready
      // programmes is free, so a reader who asks for five days gets a real
      // answer rather than a paywall.
      const composeAt = chat.indexOf("if (offer.type === 'compose') {");
      const gateAt = chat.indexOf('if (!proUnlocked) {', composeAt);
      assert.ok(composeAt !== -1 && gateAt !== -1, 'the compose branch gates on Pro');
      assert.match(chat.slice(gateAt, gateAt + 120), /if \(!proUnlocked\) \{\s*\n\s*onOpenPremium\(\);/);
      assert.match(chat.slice(composeAt, gateAt), /shouldOfferCatalogInstead\(signals\)/);
      // The offer says so before the tap, so the paywall is not a surprise.
      assert.match(chat, /coachChat\.compose\.pro/);
    },
  },
  {
    name: 'the written session analysis stays behind Pro, quota or not',
    run() {
      // The free weekly quota buys coach questions; the Pro page's table says
      // the written analysis is Pro. Without this gate a free user reached the
      // analysis screen through the unlocked chat and the table was a lie.
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(chat, /proUnlocked \? onOpenAnalysis\(lastSession\.id\) : onOpenPremium\(\)/);
      assert.match(chat, /coach\.analysisLocked/);
    },
  },
  {
    /**
     * Two savings badges, one plan.
     *
     * The paywall's 'pro.page.save' and the subscription screen's
     * 'subs.term.yearlyBadge' both advertise what the yearly plan saves
     * against twelve monthly payments. They are read minutes apart by the same
     * person, so they cannot disagree — and they did: a price change corrected
     * one and left the other quoting the retired 50 % (PR #62 review).
     *
     * Compared as numbers rather than pinned to a value, so the guard survives
     * the next price change instead of becoming the thing that has to be
     * remembered.
     */
    name: 'both savings badges quote the same discount, in both languages',
    run() {
      const i18n = read('src', 'lib', 'i18n.ts');
      const lines = i18n.split(String.fromCharCode(10));
      const percents = (key) => {
        const matches = lines.filter((row) => row.includes(`'${key}':`));
        assert.equal(matches.length, 2, `${key} should exist in both languages`);
        return matches.map((row) => {
          const found = row.match(/(\d+)\s*%/);
          assert.ok(found, `${key} must quote a percentage: ${row.trim()}`);
          return found[1];
        });
      };
      const paywall = percents('pro.page.save');
      const subscription = percents('subs.term.yearlyBadge');
      assert.deepEqual(
        new Set([...paywall, ...subscription]).size,
        1,
        `the yearly saving is advertised as ${[...paywall, ...subscription].join(' / ')} on different screens`,
      );
    },
  },
  {
    name: 'one price set, and no price outside the dictionary',
    run() {
      const i18n = read('src', 'lib', 'i18n.ts');

      // This guard existed and still let two coherent price sets ship in one
      // build. It failed twice over: it forbade 59,99 and 69,99 where the
      // onboarding paywall actually said the live yearly price, and it pinned
      // three keys while
      // the paywall's own keys were not among them.
      //
      // The set is arithmetic, not a list of forbidden numbers: 79,90 / 12 =
      // 6,66, and against 9,90 x 12 = 118,80 that is 33% off.
      //
      // Each retired price is anchored on a non-digit. Unanchored these are
      // substring checks, so /9[.,]99/ rejects any price ending in 9,99 and
      // /5[.,]99/ any price ending in 5,99 — a live price set was briefly
      // written as 79,99 and this guard turned it down. A forbidden-price
      // check has to mean a whole number, not any number ending in one.
      for (const shape of [/(?<!\d)71[.,]99/, /(?<!\d)69[.,]99/, /(?<!\d)5[.,]99/, /(?<!\d)9[.,]99/]) {
        assert.doesNotMatch(i18n, shape, `${shape} belongs to the retired price set`);
      }
      // Every key here must be one a reader can actually reach.
      //
      // Three have now been dropped for failing that, and all three the same
      // way: 'unlock.trialBody' was left behind by a retired version of the
      // unlock screen, and 'subs.yearlyPrice' / 'subs.monthlyPrice' by the
      // subscription screen's own price list, which the redesign removed
      // (a price list on a management screen is half a paywall in the wrong
      // place). Each was pinning a price onto a surface that could not render
      // it — a guard line that stays green no matter what the live copy says.
      //
      // The prices lost nothing: five other keys pin the yearly price and two
      // pin the monthly one, all from screens that exist.
      //
      // Three more paywall.* keys left the map on 2026-08-25 the same way the
      // first three did: ProPaywallScreen went unreachable when onboarding
      // stopped ending on it and was deleted, and cta.footYear / yearly.note /
      // yearly.week rendered nowhere else. The two plan prices below survive
      // because PremiumScreen and PremiumUnlockScreen read them.
      //
      // A fourth round on 2026-09-08 took 'pro.page.billedYearly',
      // 'pro.page.perYearly', 'pro.page.perMonthly' and 'coach.lock.fine' out
      // of this map together with the keys themselves: the v4 Pro page and the
      // locked-chat footer that rendered them are gone, and a price pinned to a
      // surface nobody sees is the hollow guard the first paragraph describes.
      // The per-month figure of the yearly plan is pinned through the two lines
      // that do render it — the v6 plan card's sub line and the Pro moment
      // sheet's fine print.
      const priced = {
        'pro.v2.ctaSubYearly': /79,90/,
        'paywall.plan.yearly.price': /79,90/,
        'pro.v6.sub.yearly': /6,66/,
        'pro.sheet.fine': /6,66/,
        'paywall.plan.monthly.price': /9,90/,
        'pro.page.perLifetime': /179,00/,
        'pro.v2.ctaSubLifetime': /179,00/,
      };
      const lines = i18n.split(String.fromCharCode(10));
      for (const [key, shape] of Object.entries(priced)) {
        const matches = lines.filter((row) => row.includes(`'${key}':`));
        assert.ok(matches.length >= 2, `${key} should exist in both languages`);
        for (const line of matches) {
          assert.match(line, shape, `${key} must quote the one price set`);
        }
      }

      // The root cause: PremiumScreen carried '5,99 €' and '9,99 €' as string
      // literals in its plan array, so the numbers this guard exists for were
      // not in the file this guard reads.
      for (const file of ['PremiumScreen.tsx']) {
        // Comments are exempt: the one in PremiumScreen quotes both retired
        // prices to explain how they came to ship together, and losing that
        // to a guard about rendered strings would be the wrong trade.
        const code = read('src', 'screens', file)
          .split(String.fromCharCode(10))
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          .join(String.fromCharCode(10));
        assert.doesNotMatch(code, /[0-9]+[.,][0-9][0-9]\s*€/, `${file} must take prices from i18n`);
      }
    },
  },
  {
    name: 'the Pro page knows whether the reader already pays',
    run() {
      // proUnlocked once reached this screen and nothing looked at it, so an
      // existing subscriber saw the same buy button as everyone else — and the
      // button ran onTogglePreview, which flips the switch OFF. The page's only
      // button was a cancel button wearing a purchase label.
      assert.match(premiumSource, /\{proUnlocked \? \(/);
      assert.match(premiumSource, /t\(language, 'pro\.page\.proOn'\)/);
      // A subscriber must not be shown a price to select, either — the plan
      // tiles live inside the not-yet-Pro branch, not above it.
      assert.match(premiumSource, /\) : \([\s\S]{0,200}?styles\.planRow/);
      // While Pro is on there is ONE door, and it goes to management. The old
      // branch here handed a non-promo subscriber a button that turned Pro off
      // for free — a paywall with its own off switch (user 2026-09-03).
      assert.match(premiumSource, /onPress=\{onManageSubscription\}/);
      assert.doesNotMatch(premiumSource, /promoOnly|onTogglePreview/);
      // The buy button only ever buys.
      assert.match(premiumSource, /onPurchase\(activePlan\.id as PlanId\)/);
      assert.match(appSource, /onManageSubscription=\{\(\) => navigate\(\{ tab: 'profile', screen: 'subscription' \}\)\}/);

      // The personal proof has moved three times: v3 took it off this page, v4
      // put it back as the chat hero, v6 takes it off again. What survives all
      // three is the rule, not the component — a proof shown to a reader is
      // built from that reader's own log, or it is labelled as an example.
      //
      // v6's argument for removing it is that the proof is not missing, it is
      // better placed: the withheld conclusions on Home, Progress and Workout
      // Complete are built from the same log and appear where the reader
      // actually hits the wall. So the rule is checked THERE now, and this
      // page must not grow a second, fake one.
      // Usage, not mention: the screen's own comment explains why the hero is
      // gone, and a guard that forbids naming the thing you removed makes the
      // next reader delete the explanation instead of the code.
      assert.doesNotMatch(premiumSource, /<ProChatHero|chatScript[=:]/);
      assert.doesNotMatch(appSource, /premiumChatScript|buildProChatHeroScript/);
      for (const file of ['HomeScreen.tsx', 'ProgressScreen.tsx', 'WorkoutCompletionScreen.tsx']) {
        assert.match(
          read('src', 'screens', file),
          /<ProLockedCard/,
          `${file} is where the personal proof lives now`,
        );
      }

      // Nothing on the paywall may fake a coach read in its place — not the
      // v3 specimen block, and not a hardcoded conversation.
      assert.doesNotMatch(premiumSource, /coachSpecimen|specimenScrim/);
    },
  },
  {
    name: 'the Progress trend chart is rendered, not just computed',
    run() {
      const progress = read('src', 'screens', 'ProgressScreen.tsx');
      // overviewChart was assigned to a const nobody read, and the metric and
      // range setters were never called: three metrics and four ranges existed
      // in code that no user could reach.
      assert.match(progress, /points=\{overviewChart\.points\}/);
      assert.match(progress, /onChange=\{setOverviewMetric\}/);
      assert.match(progress, /onChange=\{setOverviewRange\}/);

      // Volume was the one metric with no tick values, so the chart made its
      // own and printed "1730.8 kg" under a headline reading "2,2 t".
      assert.match(progress, /yTickValues: volumeTicks/);
      assert.match(progress, /formatOverviewVolumeTick\(value, volumeTicks\)/);
      assert.doesNotMatch(progress, /yTickValues: undefined/);
    },
  },
  {
    name: 'the adaptive set coach is gone from the code AND from every price list',
    run() {
      // The effort question, the coach's rest override and the adaptive set
      // coach lived only in WorkoutLoggingScreen. Removing the list logger
      // removed them (user decision 2026-08-02), so the guard flips: they must
      // not be sold anywhere. A feature the app no longer has is the worst
      // kind of paywall claim, because nobody can find it to complain.
      assert.ok(
        !fs.existsSync(path.join(__dirname, '..', '..', 'src', 'lib', 'adaptiveCoach.ts')),
        'adaptiveCoach.ts is back — if the feature returns, restore its Pro claims too',
      );
      assert.doesNotMatch(premiumSource, /pro\.v2\.coach\.adaptive|pro\.v2\.coach\.rest/);
      assert.doesNotMatch(premiumSource, /pro\.v2\.row\.adaptive'/);
      // (The pro-offer screen carried the claim too, until it was deleted.)

      const benefits = read('src', 'lib', 'proBenefits.ts');
      assert.doesNotMatch(benefits, /coach\.adaptive|coach\.rest/);

      // Onboarding's progression step sold the effort feedback too.
      //
      // The whole file, not a window between two constants. Both of those
      // constants have since been deleted as dead code, and `slice(-1, -1)`
      // is the empty string — the assertion went on passing against nothing
      // (CI review of #143, 2026-09-19). A claim that must not appear anywhere
      // never needed a window in the first place.
      const onboarding = read('src', 'screens', 'OnboardingScreen.tsx');
      assert.doesNotMatch(onboarding, /'onb\.progression\.b2'/);
    },
  },
  {
    name: 'the paywall moments blur the real conclusion, never a feature list',
    run() {
      const locked = read('src', 'components', 'ProLockedCard.tsx');

      /**
       * The blur must be the real one, over a caller-provided REAL conclusion.
       *
       * This used to pin `color: 'transparent'` and `textShadowRadius` — the
       * technique rather than the property. That was the best RN could do when
       * the card was written, and it was already known to be weak: Android's
       * text shadow is a mask filter, not a gaussian, so glyph shapes survive
       * it. Reported from the phone as the recommendation being readable
       * through the blur, which is the whole product given away by the screen
       * that is supposed to be selling it.
       *
       * Pinning the implementation is what kept it: BlurredPreview had shipped
       * a true gaussian (react-native-svg's FeGaussianBlur) months earlier, and
       * this guard would have failed the day anyone switched to it.
       */
      assert.match(locked, /<BlurredPreview/);
      assert.match(locked, /kind: 'text', text: body/);
      assert.doesNotMatch(
        locked,
        /textShadowRadius/,
        'the text-shadow blur is legible on Android — use BlurredPreview',
      );

      // And the gaussian it delegates to is still a gaussian.
      const preview = read('src', 'components', 'BlurredPreview.tsx');
      assert.match(preview, /FeGaussianBlur/);
      // The scrim is the safety net: if a device ever no-ops the filter, the
      // result has to be an unreadable block rather than the conclusion.
      assert.match(preview, /styles\.scrim/);

      // Home: the detection card carries the plateau conclusion from
      // proInsights — the same sentence Pro reads unblurred in place. It is
      // one string, not a pre-wrapped pair: a line break authored for English
      // width split a Finnish genitive from its head noun.
      assert.match(appSource, /locked: proPlateau\.conclusion/);
      assert.match(homeSource, /plateau\.locked\.body/);
      assert.match(homeSource, /proUnlocked \?/);

      // Progress: statuses always free. The footer that SAID so is gone —
      // "statukset ovat ilmaisia poista" (#bugs 2026-09-05): a standing line
      // announcing that nothing is locked, on a page where nothing is locked.
      // The promise is pinned where it is kept instead: the readout renders
      // for everyone, with no proUnlocked gate anywhere near it.
      const progress = read('src', 'screens', 'ProgressScreen.tsx');
      assert.doesNotMatch(progress, /pro\.read\.footer/);
      const readout = progress.slice(
        progress.indexOf('function renderWeeklyRead'),
        progress.indexOf('function renderOverview'),
      );
      assert.ok(readout.length > 200, 'renderWeeklyRead was renamed — recheck by hand');
      // The STATUS is free — the row, its meta and its bars are drawn before
      // any gate is consulted. What Pro buys is the sentence about what to do
      // next, which hangs off `row.locked` further down. So: exactly one gate
      // in the whole readout, and it sits inside that branch.
      // One more mention is allowed, and it takes away from Pro, never from
      // free: the plateau's "Same top set × N" is dropped for a reader who
      // can read the fix under it, and stays as the free finding for one who
      // cannot (#bugs 2026-10-01).
      const proOnlyHide = /\{proUnlocked && row\.tone === 'amber' && row\.key !== 'recovery' \? null : \(/;
      assert.match(readout, proOnlyHide);
      const gated = readout.replace(proOnlyHide, '');
      assert.equal(
        (gated.match(/proUnlocked/g) ?? []).length,
        1,
        'a second lock appeared',
      );
      // `&& !recoveryDoor` since 2026-09-26: the recovery row's conclusion
      // moved into its sheet, which draws the same lock (RecoverySheet).
      const gate = 'row.locked && !recoveryDoor ? (';
      assert.ok(readout.indexOf(gate) > 0, 'the conclusion gate was restructured — recheck by hand');
      assert.ok(
        gated.indexOf(gate) < gated.indexOf('proUnlocked'),
        'the lock moved out of the conclusion and onto the status itself',
      );
      assert.ok(
        readout.indexOf('styles.readBars') < readout.indexOf(gate),
        'the bars are drawn after the gate — the status is no longer free',
      );

      // Moment 4 (the logger's post-effort coach chip) went with the list
      // logger and the effort question it hung off.

      // The old Home pro sheet is gone: one full page, moments elsewhere.
      assert.doesNotMatch(homeSource, /PRO_STATS|PRO_COMPARISON|proSheetVisible/);
      // The PRO pill is gone from the header, so this is now the only place
      // Home reaches the Pro page: the plateau moment's sheet. The prop and
      // the route stay — twelve other surfaces use them.
      assert.match(homeSource, /onSeePro=\{\(\) => \{[\s\S]{0,120}onOpenPremium\?\.\(\);/);
    },
  },
  {
    name: 'automated progression is sold as Pro, so every start path gates it on Pro',
    run() {
      // App.tsx: all three start call sites go through the one helper that
      // combines the toggle with the entitlement.
      assert.doesNotMatch(
        appSource,
        /automatedProgressionEnabled: (preferences|nextPreferences)\.automatedProgressionEnabled/,
        'a start call passing the raw toggle would hand a free user the paid prefill',
      );
      // Two start paths now: ready and custom. The AI branch no longer starts
      // a workout of its own — it composes a programme that is saved as a
      // custom one and starts through the custom path like any other.
      // Since 2026-09-26 both go through one door, startProgrammeWorkout,
      // which also applies a lighter session from the recovery sheet — so the
      // entitlement is resolved once, and both paths must use that door.
      assert.equal(
        (appSource.match(/resolveProgressionOptions\((preferences|nextPreferences)\)/g) ?? []).length,
        1,
        'a start path resolves progression on its own, past the shared door',
      );
      assert.equal(
        (appSource.match(/startProgrammeWorkout\(runtimeTemplate, (nextUnitPreference|unitPreference)\)/g) ?? []).length,
        2,
        'the ready and custom start paths must both start through the shared door',
      );

      // There used to be a fourth path — the list logger's own bootstrap —
      // and it went with the screen. The three above are now all of them.
    },
  },
  {
    name: 'onboarding ends on the app, and the retired offer screens stay deleted',
    run() {
      // Two paywall surfaces used to sit after onboarding: the standalone
      // pro_offer hop, then the in-onboarding "GAINER Paywall Sell" step.
      // The user removed the step (2026-08-24), which orphaned both screens,
      // and both were deleted 2026-08-25. The sale lives on the Pro page.
      // This keeps them from coming back as unreachable code with guards
      // dutifully reading their source — which is exactly how they lingered.
      for (const gone of ['ProOfferScreen.tsx', 'ProPaywallScreen.tsx']) {
        assert.ok(
          !fs.existsSync(path.join(__dirname, '..', '..', 'src', 'screens', gone)),
          `${gone} is back — if a post-onboarding sale returns, route it and re-add its guards`,
        );
      }
      // Route usages only — the seam's history comment may name the screen.
      assert.doesNotMatch(appSource, /screen === 'pro_offer'|screen: 'pro_offer'/);
    },
  },
  {
    name: 'the unlock moment announces exactly what PRO_LIVE_BENEFITS sells',
    run() {
      // The unlock screen used to carry its own parallel card list, which is
      // how it sold the adaptive set coach for a day after the feature was
      // deleted. The cards now live in proBenefits.ts next to the source list
      // and the union invariant is tested at runtime in proBenefits.test.cjs;
      // here we pin the screen to that source and to the honest behaviours.
      assert.match(unlockSource, /PRO_UNLOCK_CARDS\.map/);
      assert.doesNotMatch(unlockSource, /adaptive|sarjavalmentaja|nextSet|\+2,5/i);

      // No splash phase: the reveal IS the staggered checklist, and it must
      // settle instantly under reduced motion — the animation is never the
      // thing hiding the content.
      assert.doesNotMatch(unlockSource, /MOMENT_MS|setShowMoment/);
      // Whitespace-tolerant: the point is that the stagger reads the named
      // constant, not how prettier wrapped the call.
      assert.match(unlockSource, /Animated\.stagger\(\s*ROW_STAGGER_MS/);
      // Asked through queryReduceMotion now, which cannot leave the screen
      // waiting on an answer that never comes (utils/reduceMotion.ts).
      assert.match(unlockSource, /queryReduceMotion()/);

      // One CTA, not two labels for the same navigation.
      assert.match(unlockSource, /onPress=\{onDone\}/);
      assert.doesNotMatch(unlockSource, /onOpenLogger/);

      // The specimen card renders only with real data — no invented read.
      assert.match(unlockSource, /coachSpecimen \? \(/);

      // Old lies stay dead: no history-restoration claims in the copy.
      //
      // Every unlock.* line, rather than a span anchored on whichever key
      // happens to sit last. That anchor has now moved twice — unlock.noBadge
      // was retired with the promise it made (the Home header carries a PRO
      // pill again, user decision), and unlock.trialBody went with the four
      // other keys left behind by two earlier versions of this screen. Each
      // move broke this guard for a reason that had nothing to do with what it
      // guards, so it no longer depends on the order of the block.
      const copy = i18nSource
        .split(String.fromCharCode(10))
        .filter((line) => /^\s*'unlock\.[^']*':/.test(line))
        .join(String.fromCharCode(10));
      assert.ok(copy.length > 0, 'the unlock copy block should be findable');
      assert.doesNotMatch(copy, /logs are back|lokit ovat takaisin|months of logs/i);
      assert.doesNotMatch(copy, /8 weeks|8 viikkoa/);
    },
  },
  {
    name: 'the coach chat says each fact once',
    run() {
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');

      // What the coach has read and what today is were three surfaces saying
      // one thing: a subtitle, a strip of context chips, and an evidence
      // footnote under every answer. They are one line now.
      assert.match(chat, /const contextLine = useMemo/);
      assert.doesNotMatch(chat, /styles.chipStrip/);
      assert.doesNotMatch(chat, /'coachChat.evidence'/);

      // The PRO pill is gone; the free quota still has its own row, so nothing
      // honest was lost with it.
      //
      // This assertion used to end in a literal backspace (0x08), left by a
      // word-boundary escape that went through a shell heredoc. It asked for
      // "styles.badge" followed by a control character no source file
      // contains, so the guard could never fail whatever the screen did.
      assert.doesNotMatch(chat, /styles[.]badge[^A-Za-z]/);
      // The count sits in the header for every Pro reader, always — not a
      // row in the thread that appeared only in the last five questions: the
      // owner looked for it, found nothing, and ran the month out to see
      // (#bugs, 2026-09-30). Once, so the thread row is gone.
      assert.match(chat, /\{proUnlocked \? \(\s*<Text style=\{styles\.headerQuota\}>\s*\{t\(language, 'coachChat\.quotaOf', \{ count: Math\.max\(0, questionsRemaining\), max: PRO_COACH_QUESTIONS_PER_MONTH \}\)\}/);
      assert.doesNotMatch(chat, /styles[.]quotaRow[^A-Za-z]|coachChat[.]quotaLeft|PRO_COACH_QUESTIONS_PER_MONTH \/ 5/);
      // And the coach says it is a beta, as a state beside its name.
      assert.match(chat, /<Text style=\{styles\.headerTitle\}>\{t\(language, 'coachChat\.title'\)\}<\/Text>\s*\{\/\*[\s\S]*?\*\/\}\s*<View style=\{styles\.betaBadge\} accessibilityRole="text" accessibilityLabel=\{t\(language, 'coachChat\.betaA11y'\)\}>/);

      // The coach gets no bubble — it is the voice of the screen. Only the
      // user's own words are enclosed. Checked as the absence of a bubble
      // rather than as an exact style block, so the layout can change without
      // the coach quietly growing a background.
      const coachBubble = chat.slice(chat.indexOf('coachBubble: {'), chat.indexOf('meBubble: {'));
      assert.doesNotMatch(coachBubble, /backgroundColor|borderRadius|paddingVertical|paddingHorizontal/);
      // It must take the row, though. Sized to its content, an answer whose
      // takeaway is one short sentence squeezed its reasons and steps into
      // that same narrow column and doubled in height (user, 2026-08-25).
      assert.match(coachBubble, /flex: 1,/);
      assert.match(coachBubble, /maxWidth: '96%',/);
      assert.match(chat, /meBubble: \{[\s\S]*?backgroundColor: theme\.purple/);

      // Bottom-anchored: a half-empty thread must not leave a dead middle.
      assert.match(chat, /thread: \{[\s\S]*?justifyContent: 'flex-end'/);
    },
  },
  {
    /**
     * The paywall spends the token, not the literal behind it.
     *
     * CLAUDE.md: "Use src/theme.ts colors and existing shared components in
     * src/components/ before adding new styling." Two rules had drifted back
     * to raw values identical to tokens the same stylesheet already used a
     * few lines above (PR #33 review) — the way a surface stops being one
     * surface is exactly this, one literal at a time.
     */
    name: 'the Pro surface reaches for its tokens rather than re-typing their values',
    run() {
      const theme = read('src', 'theme.ts');
      // The tokens exist and still hold the values that were being retyped.
      assert.match(theme, /glassEdge: 'rgba\(255,255,255,0\.13\)'/);
      assert.match(theme, /ink: '#FFFFFF'/);

      // And the paywall's own rules name them.
      assert.match(premiumSource, /tierBadge: \{[\s\S]*?backgroundColor: PRO_SURFACE\.glassEdge/);
      assert.match(premiumSource, /cta: \{[\s\S]*?backgroundColor: PRO_SURFACE\.ink/);
    },
  },
  {
    /**
     * "tama on vahan keskenerainen ruutu ja lukossa" (user 2026-09-07).
     *
     * The locked set log drew grey blocks in the shape of a list, which reads
     * as a screen nobody finished rather than as one the reader cannot see
     * into. `BlurredPreview` exists for this and says so itself: "a skeleton
     * says there is something here, a blur says there is THIS here."
     */
    name: 'set log: the lock blurs the reader own sets rather than drawing a skeleton of them',
    run() {
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const sheet = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'SetLogSheet.tsx'),
        'utf8',
      );

      assert.match(sheet, /import \{ BlurredPreview \} from '\.\/BlurredPreview';/);
      assert.match(sheet, /<BlurredPreview/);
      // The CODE, not the prose: this file's comments explain the skeleton
      // that was removed, and a looser pattern matched the explanation.
      assert.doesNotMatch(sheet, /styles\.skeleton/, 'the skeleton grew back');

      // Blurred from the REAL sets, in the same words the unlocked list uses.
      // Inventing figures would be a lie the blur only hides.
      assert.match(sheet, /const blurredSets = log\.sessions/);
      // The same words the unlocked chips use (lib/exerciseSetLog formatSetLogSet).
      assert.match(sheet, /session\.sets\.map\(\(set\) => formatSetLogSet\(set, log\.timed, language\)\)/);
      // And the preview is fed those lines, not a constant.
      assert.match(sheet, /content=\{\{ kind: 'text', text: blurredSets/);

      // The safety net stays: a device that ignores the SVG filter must get an
      // unreadable block, never the figures in clear text.
      const preview = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'BlurredPreview.tsx'),
        'utf8',
      );
      assert.match(preview, /scrim/);
    },
  },
  {
    /*
     * The plateau card (#bugs 2026-09-29, owner: "positiivinen huomio saako
     * vielä ruksin että selvä"): a dismiss that only hides THIS lift's run at
     * THIS weight, and a reminder inside the guided player that survives the
     * dismissal — the alternative the owner asked for.
     */
    name: 'the plateau card can be dismissed per episode, and the guided player reminds independently of that dismissal',
    run() {
      // App.tsx reads the dismiss list before calling detectPlateau, so a
      // dismissed episode is skipped rather than trusted straight from
      // the lift histories (the recent ones: a lift dropped months ago is not a finding).
      assert.match(appSource, /dismissedPlateauEpisodes/);
      assert.match(appSource, /detectPlateau\(proRecentLifts, dismissedPlateauEpisodes, preferences\.setupCautionFlags\)/);
      assert.match(appSource, /episodeKey: plateauEpisodeKey\(proPlateauLift\)/);
      // Dismissing writes the episode key, appended — never a wholesale
      // replace that could drop another lift's earlier dismissal.
      assert.match(
        appSource,
        /onDismissPlateau=\{\(episodeKey\) =>[\s\S]{0,160}dismissedPlateauEpisodes: \[\.\.\.current\.dismissedPlateauEpisodes, episodeKey\]/,
      );

      // Home renders a dismiss control only when the caller wired one, and
      // hands back the episode's own key — never the lift name alone, which
      // would keep the card hidden after the same lift stalls again higher up.
      assert.match(homeSource, /onDismissPlateau\(plateau\.episodeKey\)/);
      assert.match(homeSource, /episodeKey: string;/);

      // The in-workout reminder is a SEPARATE read of the same lifts, by
      // name, that does not consult the dismiss list at all — dismissing
      // Home's card must not silence it.
      assert.match(appSource, /findPlateauDetection\(\s*proLiftHistories, exerciseName, preferences\.appLanguage, preferences\.setupCautionFlags,?\s*\)/);
      assert.doesNotMatch(
        appSource,
        /findPlateauDetection\([^)]*dismissedPlateauEpisodes[^)]*\)/,
        'the in-workout reminder must not be filtered by the dismiss list',
      );

      // The reminder shows once, on the beat where the lift is introduced
      // (the 'position' step), reusing proInsights' own text rather than a
      // second rule.
      assert.match(guidedSource, /const walkPlateau = step\.type === 'position' \? plateauNotice\?\.\(step\.exerciseName\)/);
      assert.match(guidedSource, /\{walkPlateau \? \(/);
      assert.match(guidedSource, /\{walkPlateau\.headline\}/);
    },
  },
  {
    /*
     * A double tap on "Selvä" before the first write lands re-fires
     * onPress with the same episodeKey — Pressable has no built-in
     * debounce. Guarded the same way handleDismissTip and
     * dismissCompletionCard guard their own lists (break round,
     * 2026-09-29): the second write is a no-op, not a second entry.
     */
    name: 'a second dismiss of the same plateau episode before the first write lands is a no-op',
    run() {
      const onDismiss = appSource.slice(
        appSource.indexOf('onDismissPlateau={(episodeKey) =>'),
        appSource.indexOf('onDismissPlateau={(episodeKey) =>') + 320,
      );
      // Reads the episode list at write time (the updatePreferences
      // functional form), not the render-time closure, and only appends
      // when the key is not already there.
      assert.match(
        onDismiss,
        /void updatePreferences\(\(current\) =>\s*current\.dismissedPlateauEpisodes\.includes\(episodeKey\)\s*\?\s*current\s*:\s*\{ dismissedPlateauEpisodes: \[\.\.\.current\.dismissedPlateauEpisodes, episodeKey\] \}/,
      );
    },
  },
];
