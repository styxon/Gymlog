# Next release

What has merged to `main` since the last store build, so the release notes
write themselves when the next version ships.

**Last shipped:** 1.1.0, published in both stores on 2026-10-24 (Finland
only) — iOS build 6 (`main` 46e4e963, tag `ios-v1.1.0`) and Android
versionCode 6 (`main` 2bbbab84, tag `android-v1.1.0`, the same app code).

**Next:** 1.1.1 (iOS build 7, Android versionCode 7). Internal test builds
(TestFlight internal, Play internal testing) started 2026-10-30; SQLite PR 3
joins a later test build before the store build.

## How to keep this file

- Every PR that changes what a user sees or how the app behaves adds a line
  under **Merged** in the same PR: PR number, then one sentence of what the
  user notices, in plain words. Server-only changes (`api/`) go under
  **Server**, because they reach users without a store build.
- Tests, docs, tooling and refactors with no visible change are not listed.
- When a later build ships: the same from **Merged**, then empty **Merged**
  and **Server** and update **Last shipped**.

## Merged

Since build 6 (`main` 2bbbab84); goes into 1.1.1.

- #476 "New best" on the Progress chip now matches Records: a first weighted session after bodyweight-only ones counts, holds and minutes lifts no longer get it from seconds read as reps, and a lift logged twice in one workout reads the same whatever the order. The weekly read ranks lifts by sessions, so a lift logged twice a workout no longer crowds out one that qualifies.

- #475 Coach: a chat question in flight now holds its place in the month's allowance, so tapping Build on an older offer beside it can no longer take the same last question (26 of 25). A build refused for no questions left or ended Pro now says so and keeps the offer, instead of "could not build". "Painoni 30 päivää sitten oli 85" / "weight 30 days ago was 85" now offers to log 85, not 30.

- #474 Delete account on an Apple sign-in: when the answer to a delete was lost and the retry finds the account already gone, the app now shows the "remove Vinha in Settings → Sign in with Apple" guidance instead of a plain "deleted", and a delete cut off by the app being closed is still recognised on the next launch.

- #472 Pro that runs out while the app is open now closes at that moment: the coach, the programme builder and the Programs cap line no longer keep Pro on until something else redraws (one more coach question could be spent). A lifetime purchase no longer reads "Already cancelled" on the membership page, and the Subscription page's store links no longer fail silently with an unhandled error when the store cannot open.

- #471 Subscription and the membership end page: a renewing subscription's next payment / paid-until date is the store's own date. A monthly bought on the 31st showed the 28th after a February renewal, three days early.
- #470 Membership end page (Subscription → Manage membership): one card with the date Pro runs to and one button. A renewing subscription lists what changes if you end it, with "Keep Vinha Pro" in the card and "End membership" as a red text line under it; an already cancelled one, a failed payment or a promo shows only the date and Back, without the list of what you lose.
- #469 Android: the download is smaller (code shrunk and renamed by R8, as Play asks from February 2027); nothing on screen changes. First minified build: before it ships, check that Play shows the ReTrace mapping file for the bundle, and walk sign-in, backup, the Pro page and a purchase on a Play-installed phone (see docs/android-release-signing.md).
- #468 Privacy policy and terms (version 2026-10-28, so every phone is asked to accept again): the coach no longer describes a keep-a-copy permission it does not ask for, the local free trial is gone from the text, Android's alarms permission is listed, the minimum age is 18 (the lowest age choice in setup and My data now reads "18" instead of "16–18"), the iPhone backup is named as a second copy outside the phone, and the storage check joins the usage events. The sign-in prompt says training and body data are kept on our server in the EU, and the coach notice says Anthropic writes the answer in the United States.
- #457 Guided workout: the "Next up" list's "+N more" counts only the lifts still to come, not the warm-up and recovery stretches, and is left out when only stretches remain. A lift's card shows "New best" for the same weight lifted for more reps, as Records and the finish screen already did. The finish screen writes a long workout as "1 h 15 min" instead of "75 min". A one-letter exercise name is shown as typed instead of "Unnamed lift", and a blank one reads "Nimetön liike" / "Unnamed exercise".
- #456 Records and Progress agree: the finish screen's "New record" card and the morning-after record notification no longer name a lift Records has no row for (an untracked accessory such as a lateral raise); a target lift's card no longer says "New best" when a heavier set is already logged in another programme; a lighter second round of a lift in the same workout no longer turns its weekly read from "Improving" to "Declining"; and volume totals read "1 t" instead of "1000 kg" and "1 000 t" instead of "1000 t".
- #455 History's "How it has felt": answering "Just right" most of the time now reads "Mostly about right" ("Enimmäkseen sopivaa") instead of "Mixed" ("Vaihtelevaa"); "Mixed" is kept for runs where no answer dominates.
- #454 Delete account on an iPhone: if the first try failed offline and Apple later reports the sign-in gone, the app says the session ended and to sign in again, instead of claiming the account was deleted while the cloud copy was still there.
- #453 Subscription: a payment the store could not collect (card declined, store retrying) no longer reads as "Cancelled" / "Jo peruttu" on the membership pages; they say the payment did not go through and the store is retrying, and Pro still runs to the same date.
- #452 AI coach allowance: two programme builds, a photo read or a chat question beside a build, can no longer both take the month's last question (the 25 a month was exceeded by one). A build or photo read whose charge cannot be saved no longer comes through free; it reports failure instead.
- #451 The first beep or cue of a workout no longer plays up to a second and a half late. The sound setup starts when the workout screen opens, and a countdown tick that missed its moment is skipped instead of firing in a burst with the next ones.
- #449 More counts of one in the singular: a one-day programme reads "1 training day" and "1 day / week" ("1 treenipäivä", "1 pv / viikko"), a one-workout programme "1 workout", a recent session without sets "1 exercise", and a one-programme group "1 program".
- #448 Light theme: the empty pick circle on Add exercise and Swap exercise rows, and the sheet's grab handle, show again. Opening another filter (say Equipment after Body part) starts its options at "All" instead of where the last list was scrolled.
- #447 AI coach: a measurement typed with a date after it ("painoni 30.10. oli 82") or a week number before it ("viikolla 43 painoni oli 82 kg") is offered as 82 kg, not 30.1 or 43.
- #446 Light theme: the exercise sheet's selected tab, card frames and lock icon, and the New programme icons, stand out from their card again. In the New programme paste view, Android's back button returns to the menu instead of closing the sheet and dropping the pasted text, and a "questions used up" photo note no longer reappears the next time the sheet opens.
- #445 One menu style: New programme, Add exercise, Swap exercise and the exercise sheet share a left-aligned title with a round ✕ (the exercise sheet had none), one chip style, and lifts as a list with a small picture instead of a two-column grid, so long names read whole. Swap and the full add sheet fold their three filter rows into one row of chips that open their options. The New programme choices are one card with shorter lines.
- #440 Counts of one read in the singular: a one-lift plan day says "1 exercise · 3 sets" ("1 liike · 3 sarjaa"), a one-set row "1 set · 8-12 reps" ("1 sarja"), the training log export "1 session" ("1 treeni"), the coach's header "Reads your 1 logged session" and its opening line, the recent-session row, the guided start card and the emphasis sheet ("1 set" / "1 sarja").
- #438 AI coach: a measurement typed into the chat is offered for logging with the right number — a date or time before it ("30.10. painoni 82 kg") is no longer read as the value, pounds and inches are no longer offered as kg or cm, and "1000 kg" is refused instead of offered as 100. A question turned away for rate while you were typing keeps its "log this" button.
- #442 Dates in lists read the same everywhere ("19.10." / "Oct 19", with the year only when it is not this one): the Progress lifts, recent sessions on Home and Progress, the exercise sheet's history and the set log sheet.
- #439 The last hand-drawn lists join the one-card list style: Progress "Recent sessions" and the bodyweight entries, My data, Export, the notification groups (one card per section; a group that is on shows a lit icon instead of a purple border), the training plan's sessions, Home's other programmes and the Profile milestones. Section headings on a programme page, the session analysis and the exercise library use the shared label; the library's Popular and Suggested headings lose a "View all" that did nothing when tapped.
- #437 The last pushed screens get the round back button beside a left-aligned title: the session analysis, the legal documents, the membership end page, a programme day and the programme builder (its Save stays on the right). A collection's back button over its cover is round too.
- #436 Records: "Last session" no longer shows a record from an earlier workout the same day when your latest workout set none.
- #435 Delete account (Google): a retry after a try that got no answer no longer says "Account deleted" when Google has meanwhile signed the phone out — the copy may still be on the server, so it says to sign in again. A deletion that went through no longer shows "could not delete" when the phone cannot save the sign-out.
- #443 Edit profile: tapping Back while your name is still saving goes back one screen, to Settings, instead of two.
- #434 The store reviewers' Pro account unlocks Pro through Sign in with Apple as well as Google; the old review address no longer does.
- #433 Records: the "Last session" group now shows only records your latest workout set; a record from weeks ago no longer sits under that heading.
- #432 The price row on the Pro page keeps its size when the system text is at its largest; screen readers now say which measure is selected on the Progress tab, and that a locked option needs Pro.
- #431 Delete account: if Apple's sign-in could not be ended, the "Account deleted" message now says Vinha is still on your Sign in with Apple list and tells you to remove it in Settings → your name → Sign-In & Security → Sign in with Apple. A deletion the server finished no longer shows "could not delete" when the phone cannot save the sign-out, and retrying a deletion whose answer was lost no longer says "signed out, deleted elsewhere".
- #427, #429 The app's own typeface (Manrope) is back on every screen; since 3.10 most text used the phone's system font. A coloured word inside bold text (the greeting's "AI") keeps the bold weight.
- #425 Very large system text sizes now stop growing at 1.5x, so titles, exercise names and charts stay readable instead of breaking mid-word or overlapping.
- #417, #419–#424 Lists and menus look the same everywhere now: Settings, Notifications, My data, Export, Training plan, Milestones, Subscription, Progress (read rows and records), Profile cards and the Programs rows sit in one rounded card with thin dividers; pushed screens have a round back button next to a left-aligned title; section labels are one style; the Progress tabs show icon and name; the Recovery row no longer draws a meaningless single bar. Follow-ups: Progress lifts and measures are one list card each, the new-best pill and the switch off-state are readable in dark and light, the Progress calendar fills only days you trained (planned days are outlined), the BMI scale fits its card, Home shows the date in the app language and no longer leaves a gap under a collapsed Recovery row, the coach opening sits under the header, the library count matches its list, and the library header has one search. Also: exercise names on lifts and measures no longer break mid-word on small phones, the Records row value keeps its size, and a number in a list line stays with its unit ("47 min"). The exercise page has the same round back button, now announced as "Back" by VoiceOver and TalkBack. Last of the headers: Training break, Edit profile (its Save keeps its place on the right), the exercise library and the exercise page use it too. The exercise page's working-weight chart reads in rounded steps (70 / 72.5 / 75) with the unit said once above the axis, stat-card lines and programme or notification lines wrap to two lines instead of ending in "...", and a programme's level badge drops under its name instead of cutting the name short.
- #416 One list style across History and Records: a list is a single rounded card with thin dividers, dates read "su 19.10." / "Sun, Oct 19", a round back button sits beside the title, and section labels look the same everywhere. Records drop the NEW badge for a "Last session" group at the top; History shows how the session felt as a small coloured dot before the date; the History subtitle is gone. The remaining list and menu screens follow in the next updates. Tabs, long titles and headers now fit narrow screens and large text.
- #415 Reading a programme from a photo (Pro) now counts as one of the month's 25 coach questions, like building a week with the coach; with none left the sheet says so instead of reading the photo, and a photo that fails to read costs nothing.
- #414 Second review follow-ups: the screen reliably goes to sleep after a workout even when a second keep-awake request failed, the coach's "log this" button only appears for a plausible reading in the right unit (and says so if the save was refused), the home-screen widget no longer shows days that have already passed as planned after it rolls to the next month, and older installs can no longer land on an English-only workouts list.
- #413 Automatic progression is Pro only, with no exception: a Free reader's workout analysis no longer suggests a heavier weight for next time (Free keeps opening each lift on what they logged last, and the Pro features are unchanged).
- #411 Pro and coach review follow-ups: Pro now ends exactly where the store says (a grace period the store extends keeps Pro on, a cancelled trial ends with the trial), the app asks the store again when it returns to the front for a cancelled or past-due subscription, a promo, trial or review member no longer reads "already cancelled" on the membership end screen, a rate-limited coach question is not lost when something new was typed meanwhile, and tapping "Build the week" twice with no questions left no longer stacks notices or starts two builds.
- #412 Exercise instructions audit: 390 exercises got corrected steps in English and
  Finnish (no knees-past-toes, hard lockout, reps to failure, chin-high upright
  row or bar on the neck; kg and cm only; menu and marketing filler replaced by
  coaching cues; "Toista ohjelman mukainen määrä toistoja" everywhere). The swap
  sheet's how-to now follows the app language too.
- #410 Exercise instructions (Finnish): the 708 translated exercises no longer say knees must not pass the toes, "arch your back" no longer reads as a rounded back, presses say "ojenna kädet" instead of a hard lockout, upright rows stop at chest or shoulder height, the neck and behind-the-neck lifts carry a caution, "to failure" and breathing narration are gone, and the rep line follows the programme.
- #409 Review fixes: Swap suggestions are narrowed only by a body-part chip you tapped,
  not the lift's own muscle; the Recovery sheet says "Päivä 2" and hides the zone
  marker without a ratio; the screen no longer sleeps mid-workout after a quick
  leave-and-return; "1 toisto" / "1 rep" everywhere a count is shown; the swap
  search field grows with large text; a hold exercise gets no PR card.
- #408 Exercise instructions: the other 708 exercises in the library now show their steps in Finnish too, in the exercise detail and in the guided workout (before, they stayed in English).
- #407 Swap sheet: the body-part filter now narrows the suggested lifts too; the exercise search field centres its placeholder; Bodyweight Reverse Lunge is listed as bodyweight, not dumbbell.
- #406, #409 Hunt fixes: the morning weigh-in outranks the training-day reminder at every
  level (quiet keeps only the weigh-in, normal keeps both); the plan review has a back control; building a week with the
  AI coach counts as a coach question and stops when none are left; the Android
  widget swaps to next month (needs the new APK, widget payload v10) and a
  rate-limited coach question leaves no duplicate bubble; About you shows kg with
  a comma, Last done shows the localized session name, the lock-screen card
  names the lift in Finnish, and "1 toisto" replaces "1 toistoa".
- #405 Fixes: a lift added mid-workout opens at its last weight; hold and minutes lifts no longer get a PR card on the finish screen; editing programme emphasis keeps superset pairs at one set count; the screen no longer stays awake after leaving a workout right away; swapping a lift in a ready programme keeps the weekday labels; "Squat 5x5" is no longer split in the recovery sheet.
- #404 Pro: "Restore purchase" on the Pro page now really restores (tap shows "Checking purchases..."), repeated taps on either Restore link start one restore, a failed renewal no longer grants an extra period of Pro, and deleting the cloud backup clears the old "Backup paused" reason on the account row.
- #403 Walk-up praise names the lift just done ("Edellinen liike: ..."); the
  Recovery sheet hides ACWR when there is no ratio and sets a glued session
  number apart ("Jalat 1"); iPhone cue sounds wait for the audio mode, so the
  first cue no longer cuts the user's music.
- #402 AI coach without a connection names the workout in the reader's
  language ("HUGE Pro - Päivä 1: Ylävartalo", not "Day 1: Upper Body"), and
  the English answer's broken dash ("order â the first lift") is a dash again;
  one workout this week reads "1 treeni" / "1 session", not "1 treeniä" /
  "1 sessions".
- #401 iPhone, workout summary: the Coach demo question no longer opens over the
  "how did it feel" or the Pro sheet if one is up or still closing (it waits,
  then appears); the other sheets are checked and need no change.
- #400 Membership end screen: Keep Pro and End sit as two plain buttons with no box behind them; an already cancelled, promo or trial membership shows only "Back" and no longer offers to end or keep it.
- #477 Singular counts: one-day programs read "1 day" / "1 päivä" on the catalog card and in the "Lighter week" / "Same goal" reasons, a one-set superset says "1 round" / "1 kierros", one swapped exercise says "1 exercise" / "yhden liikkeen", and the strength-goal list says "today", "yesterday" and "1 week ago" instead of "0 days ago", "1 days ago" and "1 weeks ago".
- #477 Charts: the y-axis numbers shrink to fit instead of being cut to "10…" at large text size.
- #477 Subscription: a paid subscription is shown as the subscription, not as an old promo code that is still running.

## Server

- #431 `api/backup.ts`: Delete account on an Apple account answers `{ ok: true, appleRevoked }`; `appleRevoked` is false when Apple's sign-in was not ended (no key set, no code, code refused, Apple down). Google accounts get no such field. Goes live on deploy; old app versions ignore the field and show "Account deleted" as before.

## Known, not yet fixed

- Delete account leaves the name that sign-in copied into the profile on
  the phone (on purpose: the phone's own data stays until Reset all data);
  could clear it when it is still the account's name.
- The Sign in with Apple button follows the phone's language, not the app's
  (it is Apple's system button, which App Review requires). Leave as is.
