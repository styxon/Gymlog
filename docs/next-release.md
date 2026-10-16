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
- #TBD Onboarding: the Continue buttons are violet again, and the chosen
  start-path card is a soft violet tint instead of solid violet.
- #TBD Onboarding: Welcome's start button and the last setup screen (Done,
  terms box, links, chosen rows) are violet; weight is picked on a two-column
  wheel; the gender options are colour-coded; shorter level, rhythm and
  avoid-step copy; "Recommended" no longer cut off.
- #TBD After onboarding the widget's add dialog comes first and the
  measurements question only after it closes, never both at once.
- #TBD Widget: the duration figure shrinks to fit instead of being cut off;
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

## Server

_Nothing yet._

## Known, not yet fixed

Logged in `#bugs` after the vc4 device check (2026-10-15):

- Membership end screen: the two buttons should stand on their own, without
  the large box behind them.
- Membership end screen after the subscription is already cancelled: the
  screen should go away, or its buttons change (for example to "Back").
