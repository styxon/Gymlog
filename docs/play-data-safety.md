# Google Play Data Safety — Vinha

Last reviewed: 9 October 2026 · package `app.vinha` (previous full review 16 September 2026)

**What changed since 16 September:** coach copies are off (`COACH_COPIES_KEPT = false`,
2026-09-30), the development transcript reader is gone (#347) and `transcripts/` is
empty (2026-10-09, §3), error reports joined the usage events (2026-10-04), and
purchases go through RevenueCat (#344, live once the store is set up). The
**one blocker** this leaves for the form is in §3: the privacy policy does not
name RevenueCat yet.

The working draft for the Play Console **Data safety** form. It is derived from
the privacy policy (`src/lib/legalDocuments.ts`, the single source of truth) and
the code that policy describes. Not legal advice — verify every answer in Play
Console before submitting, and re-review whenever the policy's date changes.

## 1. What actually leaves the device (verified in code, 2026-09-16)

`src/` has exactly three outbound request sites; `tests/lib/legalDocuments.test.cjs`
fails if a fourth appears. The policy names all three.

| Feature | Client → endpoint | Sent | Stored server-side | Processor |
|---|---|---|---|---|
| Cloud backup (optional, Google sign-in) | `src/features/account/backupApi.ts` → `api/backup.ts` | Google ID token + the whole app database (profile, log, body data, programmes, preferences) | The backup JSON, filed under HMAC(Google `sub`) in a **private** Vercel Blob store (EU region per `docs/account-backup.md`). No email, no name, no logs of payloads. | Vercel (function and storage in Stockholm, `arn1`), Google (token verification) |
| AI coach online mode, programme composer, photo import | `src/lib/aiCoachClient.ts` → `api/ai-coach.ts` | Question + conversation history + training summary **including latest weight, measurements, height, age, gender, goals and setup answers**; the composer brief; the downscaled photo | **Nothing.** Since 2026-09-30 `COACH_COPIES_KEPT = false` (`src/lib/aiCoachLogId.ts`): the app no longer offers or sends the keep permission, and `keepTranscript()` in `api/ai-coach.ts` writes nothing even if an older build asks. The three consent lines (`aiLogChatConsent` / `aiLogComposerConsent` / `aiLogPhotoConsent`) stay visible in Settings only for a reader who said yes before, so they can take it back. **Never the training summary** — that is sent, answered from, and dropped. `transcripts/` held 123 pre-#92 development-log entries and no consented copy; all 123 deleted 2026-10-09 (§3), the prefix is empty | Vercel (function and storage in Stockholm, `arn1`), Anthropic (model, United States; deletes within 30 days, no training) |
| Report a coach answer (the Report link under an online answer) | `src/lib/aiCoachClient.ts` → `api/ai-coach.ts` → Slack webhook | The answer's own text (takeaway, why, next steps, attention, example, plan) and the reason picked from a closed list (`src/lib/coachAnswerReport.ts`). Not the question, not the training summary, no id | Nothing on our server; the message sits in the `#bugs` Slack channel | Slack (United States) — named in the policy |
| Anonymous usage events | `src/features/analytics/analyticsClient.ts` → `api/events.ts` | Random install id + event names, timestamps, `step` / `path`; since 2026-10-04 also **error reports** (`app_error`: error class, up to five `bundle:line:col` positions, screen key, app version, platform; `operation_failed`: which operation and a closed code). Never an error message (`src/lib/errorReport.ts`) | Batches as private blobs (Vercel, EU); deleted after 24 months by the daily cron (`api/prune-events.ts`, `docs/usage-events.md`) | Vercel (function and storage in Stockholm, `arn1`) |

**Purchases (since 2026-10-08, not live until the store is set up).** A fourth
recipient, and not a `src/` request site, so the count above does not see it:
the RevenueCat SDK (`react-native-purchases`, `src/features/billing/storeBilling.ts`)
talks to RevenueCat from native code once `EXPO_PUBLIC_REVENUECAT_*_KEY` is set.
It sends an anonymous RevenueCat app user id, the Play purchase token and
purchase history, and device and app info such as the OS, the app version and
the store country. **Verified 2026-10-09:** the app calls only `configure({ apiKey })`
(anonymous — no `logIn`), `getCustomerInfo`, `getOfferings`, `purchasePackage`,
`restorePurchases` and the customer-info listener; it sets no customer attributes
(no email, no name) and does not call `collectDeviceIdentifiers`. On that setup
RevenueCat's own Play guidance
(revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety)
lists one data type: *Financial info → Purchase history*. It collects no location
(only locale and currency), no crash logs, no diagnostics. **Action for the
publisher before a build with the key ships:**
- name RevenueCat (a US processor) in the privacy policy, in both languages (§3 —
  the one open blocker);
- answer *Financial info → Purchase history* as in §2.

The merged manifest also gains `com.android.vending.BILLING`, which is the
billing library's own permission. See `docs/store-billing.md`.

**App version on every request (since 2026-09-28).** All three clients also send
`x-vinha-app-version` (e.g. `1.1.0`) and `x-vinha-platform` (`android` / `ios`), so
the server can refuse a build too old for it (`src/lib/appUpdateGate.ts`,
`docs/app-updates.md`). Neither is stored, and neither identifies a person or a
device. The policy names it (the short version, and the legitimate-interest basis).
When filling the form, check whether Play wants it under *App info and
performance*; it is used for app functionality only and never shared.

**Regions verified 2026-09-16**, on the production deployment of that day.
*Storage:* `vercel blob list-stores --scope vinha-fit` shows the one store,
`vinha-backups`, in `arn1` — backups, usage events and coach copies all live there.
*Functions:* `vercel inspect` shows the five functions it lists as `[arn1]` (it hides
one), and responses from `/api/transcripts` and `/api/coach-health` carry
`x-vercel-id: arn1::arn1::…` — the second segment is where the function actually ran.
On the Hobby plan the function region is a dashboard setting (Settings → Functions →
Function Region); `vercel.json` cannot set it and is ignored if it tries, and a
changed setting applies to the next deploy.
Vercel itself is a US company, so the policy's standard-contractual-clauses sentence
still applies to it; what is settled is where the code runs and the data sits.

Everything else stays on the device: eight AsyncStorage keys (`@vinha/account`,
`analytics`, `coach/memory`, `database`, `database/corrupt`, `preferences`,
`workout`, `workout/corrupt` — the two `corrupt` slots hold a quarantined copy of
the reader's own data) plus the home-screen widget's summary file. The list is
guarded by `tests/lib/legalDocuments.test.cjs`, which fails on a ninth.

And it stays on the device: Android's own backup is **off** (#117 —
`app.json` → `android.allowBackup: false`), and `plugins/withDataExtractionRules.js`
excludes every domain from both the cloud-backup and the device-to-device
channel. Nothing of the app's data reaches Google's backup, so no answer here
depends on it.

Not present, and must stay absent from the merged manifest: location, contacts,
microphone, camera, Health Connect, ads, third-party analytics or crash SDKs.

**How the manifest is kept that way (native audit, 2026-09-21).** Until then it
was not: the release APK of 21 September requested `RECORD_AUDIO`, `CAMERA`,
`SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
and declared expo-audio's `AudioControlsService` as a `mediaPlayback` foreground
service — all library defaults, none used. The app plays its cues in the
foreground only and picks photos from the library only. Now:

- `app.json` switches the defaults off at the plugin: expo-audio
  `enableBackgroundPlayback: false` (no service, no foreground-service
  permissions) and `recordAudioAndroid: false`; expo-image-picker
  `cameraPermission: false` and `microphonePermission: false`.
- `android.blockedPermissions` names all five. Prebuild writes each as
  `tools:node="remove"`, which also strips what a library's own manifest declares
  at the Gradle merge — expo-audio's `RECORD_AUDIO`, expo-image-picker's `CAMERA`,
  the template's `SYSTEM_ALERT_WINDOW`.
- `tests/lib/androidPermissions.test.cjs` computes the manifest prebuild would
  write and fails if any of the five is requested, if any foreground service is
  declared, or if app code starts using the camera, recording or lock-screen
  media controls.
- `android/` is generated, so a change here reaches the APK only after
  `npx expo prebuild --clean`. On the day, read
  `android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`
  and confirm that none of the five appears and no `<service>` carries
  `foregroundServiceType`.

## 2. Form answers

> **Status 2026-10-09:** the form has not been filled in anywhere yet — the Play
> developer account waits for the D-U-N-S number. Fill it once, from this table,
> the day the account exists. The App Store's App Privacy answers follow the same
> rows (Diagnostics → Crash Data, Other Diagnostic Data; Purchases → Purchase
> History; nothing linked to the user except the backup's User ID, nothing used
> for tracking).

**Does your app collect or share any of the required user data types?** → **Yes.**
"Collected" means transmitted off the device. Processing by a service provider
on our behalf (Vercel, Anthropic) is *not* "sharing" under Play's definition.

| Category → data type | Collected | Shared | Optional for the user | Purpose | Notes |
|---|---|---|---|---|---|
| Personal info → User IDs | Yes | No | Yes (only with sign-in) | App functionality (backup) | Google account id, stored hashed on the server |
| Personal info → Email address, Name | Processed ephemerally | No | Yes | App functionality | Arrive inside the Google token; the backup never stores them (`api/backup.ts` reads only `sub`) and they are otherwise kept on the device. The email *was* stored once — from 23 August until #128 a signed-in reader's coach question carried it as `reporter`, and the pre-#92 development log filed it (44 entries). All of those were deleted on 2026-10-09 (§3), and the endpoint has refused the field since #128 (`tests/lib/legalDocuments.test.cjs`). The name was never sent |
| Health and fitness → Fitness info, Health info | Yes | No | Yes | App functionality | Workout log, body weight, measurements — sent for the backup (stored) and the coach (answered from, not stored by us; Anthropic ≤ 30 days). A reader may also write health details into a coach question |
| Photos and videos → Photos | Yes | No | Yes | App functionality | Programme import. Not kept by us since 2026-09-30; Anthropic ≤ 30 days. **Do not tick "processed ephemerally"**: Play's ephemeral means held only as long as the request needs, and the model provider's 30-day abuse window is longer than that. If coach copies are ever switched back on, this row becomes *retained up to 24 months* again |
| Messages / Other user-generated content | Yes | No | Yes | App functionality | Coach questions and composer briefs (Anthropic ≤ 30 days), and a reported answer's text plus its reason (Slack, kept for review). Not kept on our server since 2026-09-30; same note on "ephemeral" as Photos |
| Financial info → Purchase history | Yes, once billing ships (#344) | No | Yes (Pro is optional) | App functionality | RevenueCat, anonymous app user id, no attributes (§1). Google Play itself handles the payment; card details never reach the app, RevenueCat or us |
| App activity → App interactions | Yes | No | Yes | Analytics | The eight usage events. Settings → Usage statistics switches them off; off drops the queue |
| App info and performance → Crash logs | Yes (since 2026-10-04) | No | Yes | Analytics; App functionality | `app_error`: the error's class, up to five positions in the app's own code (`index.android.bundle:1:2345`), the screen, app version, platform. **No error message, no stack text beyond those positions, no user content.** Same random install id as the usage events, linked to no account; the same switch (Settings → Usage statistics) turns it off and drops the queue; same 24-month retention |
| App info and performance → Diagnostics | Yes (since 2026-10-04) | No | Yes | Analytics; App functionality | `operation_failed`: which of save / backup / restore / load / account deletion / sign-in failed, and a short closed code (`NETWORK`, `STORAGE_FAILED`, …). Not linked to identity, not shared. Same switch and retention as above |
| Device or other IDs | Yes | No | Yes | Analytics; App functionality | Random ids, minted separately and linked to nothing — including to each other. The install id (analytics) resets on reinstall and is discarded when the switch is off. RevenueCat's anonymous app user id exists only once billing ships and only for purchases. `aiLogId` (the coach-log label) is no longer minted while copies are off; a reader who said yes before keeps theirs until they withdraw |
| Location, Contacts, Audio, Files and docs, Calendar, Web browsing, Installed apps; Financial info other than Purchase history | No | No | — | — | — |

If coach copies are switched back on after release: the copies are kept for one
stated reason — making the coach better at writing programmes. Play's list has no
"product improvement" entry, so it lands under **App functionality** or
**Analytics** depending on how the Console words it then. Pick one, and make sure
the policy's sentence and the form agree on it.

**Security practices**
- Data encrypted in transit: **Yes** (the app talks HTTPS to Vercel; Vercel talks HTTPS to Anthropic and Google).
- Users can request data deletion: **Yes** — in the app (Settings → Delete account / Delete cloud backup; Settings → Reset all data) and on the web without the app (Google account: the deletion page below).
- Committed to the Play Families policy: No. Independent security review (MASA): No.

**Account creation and deletion.** Google sign-in for the cloud backup counts as
account creation → answer **Yes, optional**. Play requires an in-app deletion
path (Settings → Delete account) **and a public account-deletion URL** that
works "without sending the user back to the app and requiring them to
re-download it". URL: `https://styxon.fi/vinha-fitness/legal/delete-account.fi`
(EN: `.en`), built by `scripts/build-legal-site.cjs` from
`src/lib/accountDeletionPage.ts` (2026-10-03). The page signs in with Google in
the browser and sends the app's own Delete account request
(`src/lib/webAccountDeletion.ts`); an email alone cannot find an account,
because the server stores no name or email. Apple accounts: in the app only,
until the web Apple sign-in in docs/ios-launch.md is built.

**Is collection optional?** Yes, all of it. Backup, coach and photo import sit
behind the user's own action, and usage events plus the install id can be
switched off in Settings → Usage statistics (2026-09-16): off means the client
sends nothing and discards its queue and install id, and nothing leaves before
the stored preference has been read at startup. Retention is optional on top of
that: the three consent lines start at no, and switching any one of them off
deletes every copy kept for the reader — including those made under the lines
left on — rather than only stopping new ones. (`forgetTranscripts` matches on the
label, not on the line; the policy says the same since 2026-09-16.)

## 3. True on the day of submission

Done (keep true):

- [x] **Development transcript reader gone** (#347, 2026-10-09): `src/lib/aiCoachDebug.ts`,
  `api/transcripts.ts`, `scripts/coach-transcripts.cjs` and the effort/model overrides
  deleted; `tests/releaseReadiness.test.cjs` fails if any of it comes back.
  `AI_COACH_DEBUG_TRANSCRIPTS` and `TRANSCRIPT_READ_SECRET` removed from Vercel and both
  `.env.local` files the same day.
- [x] **`transcripts/` cleaned by name** (2026-10-09). Dry run: 123 entries, all the
  pre-#92 development log (no `--` in the name, dated before 11 September), 0
  consented copies, 0 unlabelled entries after the cut-off. All 123 deleted; a
  re-count showed 0. The rules, should it ever be needed again: a name with `--` is a
  consented copy and stays (24-month cron, Settings switch); a name without `--`
  dated 2026-09-11 or earlier is the development log and goes; one dated later is
  reported, not deleted; a kept copy holding a non-empty `reporter` is reported by
  path only. Never empty the folder wholesale. The store authenticates with OIDC
  for Production and Preview only, so a local script needs a read-write token; the
  one used that day was revoked straight after (no code uses it). The owner's
  script: `private/scripts/clean-dev-transcripts.cjs`, outside the repo.
- [x] `demoBuild` removed from `app.json` (#344).
- [x] Pro is bought through Google Play — RevenueCat wired in #344. **Still needs**
  the Play Console products and offer, and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` in
  the release build (`docs/store-billing.md`). Until then the policy and terms
  sentences about Google Play payments describe a purchase that cannot be made.

Open:

- [ ] **Name RevenueCat in the privacy policy, in both languages** — the one
  blocker for this form. In the processor list of `src/lib/legalDocuments.ts`, next
  to Google and Apple, and in the "outside the European Union" sentence; then bump
  `LEGAL_LAST_UPDATED`, rebuild the legal site and upload it to styxon.fi by hand.
- [ ] Storage still in the EU — the policy says so in both languages; the function region (§1) is not claimed there.
  Verified 2026-09-16 (§1); on the day, re-check both: `vercel blob list-stores
  --scope vinha-fit` for the store, and the second segment of `x-vercel-id` on any
  `/api/*` response for the functions.
- [ ] Privacy policy URL in Play Console points at the published policy, and the
  in-app text is the same version (`LEGAL_LAST_UPDATED`).
- [ ] The public account-deletion URL is live and entered in the form (§2).
- [ ] The store listing's target audience matches the policy's "not for under 16".
