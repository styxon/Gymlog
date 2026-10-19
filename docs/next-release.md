# Next release

What has merged to `main` since the last store build, so the release notes
write themselves when the next version ships.

**Last shipped:** Android 1.1.0 (versionCode 4), `main` df3f039b, sent to
production review 2026-10-16.

**Next:** versionCode 5 — not scheduled. It ships when there is a larger
update to carry, not for each fix.

## How to keep this file

- Every PR that changes what a user sees or how the app behaves adds a line
  under **Merged** in the same PR: PR number, then one sentence of what the
  user notices, in plain words. Server-only changes (`api/`) go under
  **Server**, because they reach users without a store build.
- Tests, docs, tooling and refactors with no visible change are not listed.
- When the build ships: write the Play release notes (FI + EN, 500 characters
  each) from **Merged**, run `npm run release:android:done`, then empty both
  lists and update **Last shipped**.

## Merged

- Pro: "Restore purchase" on the Pro page now really restores (tap shows "Checking purchases..."), repeated taps on either Restore link start one restore, a failed renewal no longer grants an extra period of Pro, and deleting the cloud backup clears the old "Backup paused" reason on the account row.
- Membership end screen: Keep Pro and End sit as two plain buttons with no box behind them; an already cancelled, promo or trial membership shows only "Back" and no longer offers to end or keep it.
- #382 Onboarding: a disabled Continue button says on a line under it what
  it still waits for.
- #384 Onboarding: the chosen start-path card is a soft violet tint instead
  of solid violet. (Its violet buttons were made orange again by #385.)
- #384 Onboarding: the last setup screen's terms box, links and chosen rows
  are violet; weight is picked on a two-column wheel; the gender options are
  colour-coded; shorter level, rhythm and avoid-step copy; "Recommended" no
  longer cut off.
- #384 After onboarding the widget's add dialog comes first and the
  measurements question only after it closes, never both at once.
- #384 Widget: the duration figure shrinks to fit instead of being cut off;
  the 4×2 widget has no description line in the picker.
- #382 Start path: shorter, centred lines, and the recommended path is
  marked "Recommended".
- #382 About you: gender, age and weight open as bottom sheets; gender
  can be skipped.
- #382 Equipment step: Home opens a sheet of what you have at home and
  is chosen only with at least one item; the badges on the cards are gone.
- #383 Onboarding level step: the choices are years trained (0–1, 1–3,
  3–5) instead of level names, and the moving bars around the logo are gone.
- #383 "Fitness" in the Vinha Fitness name is orange everywhere.
- #385 Onboarding: every button that moves you on is orange, violet stays
  for choices and the brand.
- #385 The light/dark question is no longer asked right after "Let's
  begin": a new install starts dark, and the question is the last step of
  setup, after the Pro page, the widget and the measurements question.
- #385 The measurements question's example card shows the site you tap
  first (waist, arms, …), with its own example numbers.
- #385 "Your programme is ready": a flat violet background instead of the
  striped one, and an orange "Start training".
- #385 Level step: the description no longer changes height, so the
  selector and Continue stay put; the home equipment sheet's choices are
  centred and inset.
- #385 Pro page, Lifetime: a fifth line, "Comes with you to a new phone".
- #385 Settings: "Continue with Google" is a white button matching "Continue
  with Apple".
- #385 Workout tour, set screen: the history beat shows the current set
  outlined, then painted green as a logged set; the set row's buttons get a
  legend (green + adds a set, red − removes the last one); Pause, the menu
  and Log set each get their own beat.
- #385 Workout tour, rest screen: four beats top to bottom — the workout
  contents (the sheet opens and closes by itself), −15s/+15s, Pause, Skip
  rest — and the rest timer stands still while the tour is up.
- #385 Skip rest takes two presses: the first turns it red and asks again.
- #385 The exercise picture on the set screen has no play badge; the rest
  alert permission sheet drops "Never a marketing push" and its button is
  orange.
- #385 Terms and privacy policy name the trade name's holder correctly
  (Tatu Ylönen); dated 17.10.2026, so every reader is asked to accept again.

- #389 iPhone: "Skip this exercise" in the workout menu no longer freezes the
  app; the confirmation, the exercise swap, the workout contents and the end
  confirmation open once the menu has closed.
- #390 iPhone: the end of setup no longer leaves a blank screen that takes
  no touches: the theme question waits for the measurements question to
  close, and the Pro page no longer opens under an invisible layer that
  takes every touch. Home's "Keep your training safe" sign-in dialog opens a moment
  after Home appears and never over another sheet, so it no longer freezes
  Home after a finished workout.
- #391 iPhone: the free-tier programme walls ("3/3 programmes", "2 running")
  appear again and no longer freeze the app when they open as another sheet
  closes, for example "Build it yourself" at the limit.
- #392 iPhone, guided workout: the pencil in the workout contents opens
  "Correct set" again instead of stopping the rest clock; picking another set
  row keeps the sheet open; the sheet rises above the number pad, which gets
  a Done key, and a tap on the dimmed page with the keyboard up only puts the
  keyboard away. The rest-alert question no longer opens over another sheet,
  and a tap while it slides up no longer leaves it stuck on screen.
- #393 iPhone, keyboard: the AI coach chat and the AI programme questions
  keep the conversation and the field on screen while typing (the thread
  used to shrink to nothing), and a drag on the thread puts the keyboard away.
  The strength goal's weight field stays visible while typing. On the set
  screen the Reps and Weight cards no longer pile over the lift's card and
  "Log set"; the card above folds last time's numbers away and scrolls
  instead. The exercise picker, the weight and measurement sheets and My
  data's edit dialog rise above the keyboard; the picker no longer opens the
  keyboard by itself, and a tap outside a sheet with the keyboard up only puts
  the keyboard away. Number pads get a Done bar in the app's language. Both
  phones: Save on the weight sheet while still typing first puts the keyboard
  away and shows the typed number, so the old number is never saved.
- #394 iPhone: Vinha's data now goes into the phone's iCloud or computer
  backup, as the privacy policy says, so a new iPhone set up from that backup
  gets it back (it used to be left out). The rest banner's "Turn on" asks for
  the permission when the phone has never asked, instead of opening a
  Settings page with no switch on it. Notifications no longer shows "Keep
  session on lock screen", which the iPhone cannot do, and the 10-second
  warning says it is a silent notification; the rest-alert question no longer
  promises the end time on the lock screen. Both phones: opening the app
  during a rest no longer clears the "rest is over" alert before the workout
  has loaded.
- #395 iPhone: the guided workout's exercise pictures are no longer washed
  out, and the exercise picker's filter chips are no longer cut at the top or
  out of line. Both phones: Home's logo reads "Vinha"; pages fade out under
  the tab bar instead of ending in a hard line; the workout summary and a
  saved workout put a band behind the clock once scrolled; Programs shows a
  recommended programme's name on up to two lines and "General fitness" on
  one; the programme choice keeps less empty purple under the chosen card on
  a tall phone, and its small text is brighter; an exercise without a
  picture shows the same two letters everywhere; logging a loaded set with
  no weight set first says so, and the next tap logs it; Progress lists a
  session without weight in reps (a hold in seconds, a bout in minutes)
  instead of "0 kg".
- #396 iPhone: Delete account on an Apple account asks Apple to confirm once,
  and Vinha leaves the Apple ID's Sign in with Apple list (needs the server
  change below and its three env vars). The privacy policy says so (new
  wording, asked again).
- #397 About you: weight is picked on the same sheet as Progress → Weight →
  Log (big number, ruler, Skip / Done) instead of the two-column wheel, and a
  pen beside the number on both sheets opens the keys to type it.
- #397 Guided workout: while a weight or reps is typed, only the exercise's
  name stays above the dials, so the keys no longer push the dials over the
  exercise card.
- #397 Home says "Vinha Fitness" again (Fitness in orange); About you's gender
  row shows Male in blue and Female in pink, and the gender sheet's Skip sits
  lower under its rule.
- iPhone, workout summary: the Coach demo question no longer opens over the
  "how did it feel" or the Pro sheet if one is up or still closing (it waits,
  then appears); the other sheets are checked and need no change.

## Server

- #396 `api/backup.ts`: Delete account on an Apple account trades the
  phone's one-time Apple code and revokes the grant at Apple. Live once
  `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` are set in Vercel
  (docs/account-backup.md); until then deletion works as before and the log
  says `apple revoke skipped`.

- Walk-up praise names the lift just done ("Edellinen liike: ..."); the
  Recovery sheet hides ACWR when there is no ratio and sets a glued session
  number apart ("Jalat 1"); iPhone cue sounds wait for the audio mode, so the
  first cue no longer cuts the user's music.

## Known, not yet fixed

Logged in `#bugs` after the vc4 device check (2026-10-15):

- Membership end screen: the two buttons should stand on their own, without
  the large box behind them.
- Membership end screen after the subscription is already cancelled: the
  screen should go away, or its buttons change (for example to "Back").
