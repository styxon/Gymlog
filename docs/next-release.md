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

## Server

_Nothing yet._

## Known, not yet fixed

Logged in `#bugs` after the vc4 device check (2026-10-15):

- Membership end screen: the two buttons should stand on their own, without
  the large box behind them.
- Membership end screen after the subscription is already cancelled: the
  screen should go away, or its buttons change (for example to "Back").
