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

- #382 Onboarding: the Continue buttons are orange, and a disabled one
  says on a line under it what it still waits for.
- #382 Start path: shorter, centred lines, and the recommended path is
  marked "Recommended".
- #382 About you: gender, age and weight open as bottom sheets; gender
  can be skipped.
- #382 Equipment step: Home opens a sheet of what you have at home and
  is chosen only with at least one item; the badges on the cards are gone.

## Server

_Nothing yet._

## Known, not yet fixed

Logged in `#bugs` after the vc4 device check (2026-10-15):

- Membership end screen: the two buttons should stand on their own, without
  the large box behind them.
- Membership end screen after the subscription is already cancelled: the
  screen should go away, or its buttons change (for example to "Back").
