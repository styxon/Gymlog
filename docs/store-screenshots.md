# App Store screenshots

The iPhone screenshots are taken on simulators in GitHub Actions, because
the owner has no Mac. The repo is public, so macOS runners cost nothing.
The Android set is still made by hand with adb (memory: ref-website-screenshots).

## Running it

1. Open **Actions → Store screenshots → Run workflow** on `main`. Before
   this file is on `main`, push any commit to a branch named
   `store-screenshots` instead (`git push origin HEAD:store-screenshots`).
   The inputs pick the languages, themes and simulators. The defaults are
   `fi en`, `dark light`, and iPhone 17 Pro Max plus iPhone 17.
2. Wait. The first run builds the app (about 30–40 min). Later runs reuse
   the cached build unless something inside the app changed. Then every
   device × language × theme takes about two minutes.
3. Download the artifacts:
   - `store-screenshots`: the finished images, `<size>/<language>/<theme>/NN-name.png`:

     | Folder | Pixels | App Store Connect slot | From |
     |---|---|---|---|
     | `6.9` | 1320 × 2868 | iPhone 6.9" | iPhone 17 Pro Max |
     | `6.5` | 1284 × 2778 | iPhone 6.5" only: the "Dynamic Island (medium display)" slot refused this size on 2026-10-18 | iPhone 17 Pro Max |
     | `6.3` | 1206 × 2622 | iPhone 6.3" | iPhone 17 |

     It also writes `header/header-<language>-<theme>-3840x1646.png`: three
     screens and a caption, an experiment for the "Header and Search
     Results" image (#to-do 12).
   - `raw-screenshots`: the simulator's own captures, before any caption or
     frame, at the simulator's size: `iphone-6.9/<language>-<theme>/` at
     1320 × 2868 and `iphone-6.3/<language>-<theme>/` at 1206 × 2622. These
     are what the Design canvas's panels take.
     It also holds Maestro's logs and view hierarchies (`maestro-<attempt>/`
     beside each variant's shots), plus a `failure.png` when a variant failed
     twice.

Nothing is uploaded to App Store Connect. Choosing the images and uploading
them is a manual step.

No secrets are needed. The workflow builds with `xcodebuild` on the runner
and does not use EAS.

## What runs

| Piece | File |
|---|---|
| Seeded reader | `src/screenshots/screenshotSeed.ts` |
| First-launch writer | `src/screenshots/SeededApp.tsx` |
| The gate | `index.ts` |
| Simulator walk | `.maestro/store-screenshots/*.yaml` |
| Device matrix | `scripts/store-screenshots/shoot.sh` |
| Layout and captions | `scripts/store-screenshots/compose.py`, `captions.json` |
| Workflow | `.github/workflows/store-screenshots.yml` |
| EAS alternative | the `screenshots` profile in `eas.json` |

**The seed.** On a first launch the seed builds six weeks of HUGE Pro
(4 days a week), weekly weigh-ins, monthly tape measurements and Pro (a
lifetime purchase on record). It also leaves today's workout open: started
about 50 minutes ago, with the next lift's last set still to log. Every
session goes through the same steps a real one does: the workout reducer
logs the sets, the finish adapter builds the save, and
`persistCompletedWorkoutSessionToDatabase` and the reducer's finish write it.
The seed is written through `saveDatabase` and `saveWorkoutBundle` before
the app mounts. Dates are relative to the moment of launch and step by
calendar day. `tests/lib/screenshotSeed.test.cjs` holds the three data traps
the Android shots fell into: a plateau, "recovery low" and a "5/4" week.

**The gate.** `index.ts` mounts `SeededApp` only when
`EXPO_PUBLIC_SCREENSHOT_SEED` is `"1"` at bundle time. That happens only in
this workflow and in the simulator-only `screenshots` EAS profile.
`tests/lib/screenshotSeedGate.test.cjs` fails if another profile,
app.json, another workflow, or any app module reaches the flag or the seed.

**Language and theme.** `shoot.sh` launches each fresh install with
`-vinhaLanguage fi -vinhaTheme dark` (via `simctl launch`), and the seed
reads them through `Settings`. Maestro's own `launchApp` did not substitute
`-e` values into its `arguments` on iOS, so the flow attaches to the
running app instead. `shoot.sh` also sets the simulator's own language and
locale. The flow checks the language by the Home tab's name, and
`compose.py` checks the theme against each screen's background colour.
The status bar is set to 9:41, full Wi-Fi and a charged battery.

**Shots.** Each run captures these screens: 01 set screen, 02 rest with the
next lift, 03 workout complete, 04 Progress summary, 05 records, 06 history,
07 Home, 08 Programs, 09 the coach, 10 a conversation with the coach (a
starter chip). The coach answers in preview mode, since this build has no
server URLs. For the same reason the build has no analytics and no store.

## Changing it

- **Captions:** edit `scripts/store-screenshots/captions.json`. Its order is
  the store order, `accent` is the one word drawn in violet, and `pro: true`
  adds the gold PRO pill. To re-lay out raw shots without the simulator, run
  this anywhere Pillow is installed:

  ```bash
  python scripts/store-screenshots/compose.py <raw-dir> <out-dir>
  ```

- **A new screen:** add its steps and a `takeScreenshot` to `store.yaml`,
  then give it an entry in `captions.json`. The app has no testIDs, so each
  step finds its control by visible text or accessibility label, as
  `"Finnish|English"` (the strings are in `src/lib/i18n.ts`).
- **Different data:** change `screenshotSeed.ts`, then run its suite.

## Building with EAS instead

```bash
eas build -p ios --profile screenshots
```

This produces the same seeded simulator `.app` on Expo's servers. It needs
the owner's Expo login, and the workflow does not use it. To feed that
build into the workflow, add an `EXPO_TOKEN` secret and a download step in
place of "Build for the simulator".
