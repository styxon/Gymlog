# Store billing (RevenueCat)

Pro is bought from Google Play (and later the App Store) through RevenueCat's
React Native SDK, `react-native-purchases`. The app code is in place and the
demo flag is cleared (2026-10-08). What is left is store-side setup, which
needs the Play merchant account, which needs the D-U-N-S number.

## How it fits together

| Piece | File |
|---|---|
| What a store answer means: the purchase record the app already reads | `src/lib/storePurchase.ts` (pure, tested in `tests/lib/storePurchase.test.cjs`) |
| Asking the store: configure, buy, restore, listen | `src/features/billing/storeBilling.ts` |
| Keeping the record in step: one read after load, then every pushed answer | `src/app/useStoreBillingSync.ts` |
| Buy, restore, end, resume | `src/app/renderProfileTab.tsx` |

The purchase record is the three `mockSubscription*` preferences. In a release
build only the store writes them; an answer with no Pro clears them. The names
predate billing and stayed so every install's stored data keeps loading.

Without a key the store is absent: Buy shows "not available yet", Restore opens
the store's subscription page, and nothing is synced. A purchase the demo
build invented stays on that phone until the first sync with a configured
store clears it.

## Setup, in order (after the D-U-N-S number)

1. **Play Console → Monetize → Products.**
   - Subscription `vinha_pro` with base plans `monthly` (9,90 €) and `yearly`
     (79,90 €), both auto-renewing.
   - In-app product `vinha_pro_lifetime` (179,00 €).
   - The ids must name their term. `termForStoreProduct` reads the term from
     the id (`month`, `year`/`annual`, `lifetime`).
2. **Play Console → Setup → API access.** Create a service account with
   financial-data access and give its JSON key to RevenueCat (Project → Google
   Play app → Service credentials).
3. **RevenueCat dashboard.**
   - Entitlement `pro`, attached to all three products.
   - Offering `default`, marked current, with packages Monthly → `vinha_pro:monthly`,
     Annual → `vinha_pro:yearly` and Lifetime → `vinha_pro_lifetime`.
     `storePackageForPlan` picks these slots.
4. **Build env.**
   - Put `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (the public SDK key, `goog_…`) in
     `.env.local` for the release build. It is public by design, but keep it
     out of git like the other `EXPO_PUBLIC_*` values.
   - iOS later: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`appl_…`), with the same
     product ids in App Store Connect.
5. **Test.**
   - Upload the build to the internal testing track and add your Google
     account as a licence tester (Play Console → Settings → License testing).
   - A side-loaded APK cannot buy: Play Billing only serves an install whose
     package and signature match an uploaded build.

## Before release: owner decisions

- **The trial.** Decided 2026-10-08: the trial moves into Play, as a free-trial
  offer on the `monthly` and `yearly` base plans, set up together with the
  products. Until then the Pro page offers a 14-day local grant
  (`PRO_TRIAL_ENABLED`) under the line "Then 79,90 € / year", and nothing
  charges when the grant ends. With the offer live:
  - the trial button buys the plan, and Play applies the offer;
  - the local grant goes (`PRO_TRIAL_ENABLED`, `canStartProTrial`);
  - a cancelled period ends on the store's `expirationDate`, not one full term
    from the purchase (`purchaseRecordFromStore`, PR #344 review);
  - `releaseReadiness` checks the offer, not just the library.
- **"Billing is not live" copy.** The Pro moment sheet's fine print and the
  receipt's "Payments are not live yet" note show only while
  `paymentsAreLive(isDemoBuild(), isStoreBillingConfigured())` is false
  (`lib/billingCopy`), so a build with the RevenueCat key says neither.
- **The privacy policy and the Data safety form** must name RevenueCat. See
  `docs/play-data-safety.md` §1. The policy text is the owner's to edit.
- **Server-side Pro.** The coach endpoint does not check the store. Checking
  needs the RevenueCat secret key on Vercel (REST `GET /subscribers/{id}`, or
  webhooks).
