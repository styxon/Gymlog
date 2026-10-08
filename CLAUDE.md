# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm run start           # Expo dev server (scan QR to open on device)
npm run android         # Launch on Android emulator / device
npm run typecheck       # TypeScript type check (no emit)
npm run typecheck:api   # api/ without strict, as the Vercel deploy compiles it
npm run test:unit       # Run all unit tests (requires .test-dist to be up to date)
npm run android:release # Build signed Android APK via Gradle
npm run measure:startup # Cold start on the connected phone, after every APK install (fails over 3.5 s)
npm run release:ios      # Store build for iOS, behind the version guard (scripts/releaseGuard.cjs)
npm run release:android  # The same for Android
npm run release:ios:done # After the store accepted it: tags ios-v<version>, so that version cannot ship twice
npm run exercise:sync   # Regenerate src/data/generatedExerciseLibrary.ts
npm run texts:export    # Regenerate outputs/app-texts-fi-en/ (every static text, EN beside FI)
npm run slack:notify    # Post a note to a Slack channel (see docs/slack-workflow.md)
```

### Slack notes

Findings that are real but out of scope go to Slack rather than into the change
in front of you. `#bugs` for defects, `#marketing` for store copy and competitor
notes, `#releases` for what shipped, `#to-do` for post-launch work with its
cost estimate attached (read/write through the Slack connector; no webhook) —
setup in
[docs/slack-workflow.md](docs/slack-workflow.md).

The user logs bugs from their phone into `#bugs`. Read the channel through the
Slack connector when asked, and work from it — that direction needs no webhook.

```powershell
npm run slack:notify -- --channel bugs --text "Plan tiles clip at 320dp"
```

Two rules. Do not post on the user's behalf unless they asked — a webhook writes
to a real channel other people read, so surface the note and let them send it.
And never commit a webhook URL: they live in `SLACK_WEBHOOK_*` environment
variables, and anyone holding one can post to that channel.

### Running tests

Tests import from `.test-dist/`, which is compiled separately from the main Expo build.
Compile first, then run:

```powershell
npx tsc -p tsconfig.test.json   # compile src/ -> .test-dist/
node tests/run-tests.cjs        # run all suites
```

`npm run test:unit` only runs the Node step — if you change `src/` files, recompile first.
To run a single suite, require it directly:

```powershell
node -e "const s = require('./tests/lib/guidedPlayer.test.cjs'); s.forEach(t => t.run()); console.log('ok')"
```

### Code review

Run `/code-review` before opening a PR, in the same session that wrote the
change. This is not optional politeness: the median PR here merges 2.9 minutes
after it opens, so a reviewer that comments on the open PR — Codex, the Claude
review workflow, any of them — usually arrives after the merge. The only review
that reliably lands while the code can still change is the one that runs before
the PR exists.

`.github/workflows/claude-review.yml` posts a second review on the PR itself,
one for every pushed commit, using `.claude/commands/ci-review.md` from `main`.
Its check is green only when that commit's `## Code review` summary is on the
PR; a run that reviewed nothing goes red rather than silent, whatever the model
reported. Both paths read this file, so review guidance belongs here — see
[docs/pr-review-process.md](docs/pr-review-process.md) for the history and the
one-time setup.

What is worth flagging in this repo, beyond ordinary correctness:

- **Date arithmetic that steps by `DAY_MS`.** Helsinki changes clocks twice a
  year, and a 23- or 25-hour day makes fixed-millisecond stepping land off local
  midnight. Step by calendar date.
- **UX that claims something finished before it did.** A success state must
  follow the resolved write, never precede it.
- **Anything impure in `src/lib/`** — AsyncStorage, React, side effects.
- **New domain logic with no suite in `tests/lib/`**, or a new suite missing
  from `tests/run-tests.cjs`.
- **Loaders that trust stored data.** `src/storage/database.ts` normalizes on
  load; a new field that skips it is a crash on someone's old install.
- **Work at the top of a module.** Every module is evaluated before the first
  render, on Hermes without a JIT — about twenty times slower than Node. A
  table built when a module loads is paid on every cold start, screen opened
  or not; one whose size is a product (slots × options, a `flatMap` inside a
  `flatMap`) grows by multiplication when a row is added. The crisis filter's
  rows once multiplied out to 195,800 phrases and the cold start went from
  2.4 to 9.4 s (2026-10-08). Build on first use, or index without
  multiplying. `tests/lib/startupWorkBudget.test.cjs` fails a module over
  150 ms of its own load in Node — that is about 3 s on the phone, so it
  catches a disaster, not a slow drift; `npm run measure:startup` on the
  device catches the drift.

## Architecture

### App shell

`App.tsx` is the single monolithic shell. It owns:
- All screen imports and conditional rendering
- In-memory `route` + `routeHistory` state
- Props passed into every screen (screens receive no props from React Navigation — there is no React Navigation)

This file is large. When changing screen-level routing, always edit `App.tsx`.

### Navigation

Custom flat navigation built on a plain array:
- Route type: `AppRoute` union in `src/navigation/routes.ts`
- Stack helpers: `pushRoute` / `popRoute` in `src/navigation/routeHistory.ts`
- Four tabs (`home | workout | progress | profile`), each with nested screens identified by `screen` key on the route object
- Back button pops the array; tab changes reset the nested screen to the tab's root route

### State layers

Two React context providers wrap the app:

**AppProvider** (`src/state/AppProvider.tsx`)
- Owns all persisted app data: preferences, custom workout templates, completed sessions, exercise logs, bodyweight/measurements
- Root type: `AppDatabase` in `src/types/models.ts`
- Persists to AsyncStorage key `@vinha/database/v1`
- Exercise library is seeded on load but **stripped on save** (regenerated from `src/data/generatedExerciseLibrary.ts` each load)
- Access via `useAppContext()`

**WorkoutProvider** (`src/features/workout/WorkoutProvider.tsx`)
- Owns the live workout session state machine: `useReducer(workoutReducer, workoutInitialState)`
- All session mutations dispatch `WorkoutAction` — see `src/features/workout/workoutState.ts` for the full action union and reducer
- Persists active session + slot history to AsyncStorage key `@vinha/workout/v1`
- Access via `useWorkoutContext()`

### Ready programs vs custom programs

- **Ready programs**: static `WorkoutTemplateV1[]` in `src/features/workout/workoutCatalog.ts`. Never written to AppDatabase.
- **Custom programs**: user-created, stored in `AppDatabase.workoutTemplates` via `workoutTemplateRepository` in `src/storage/repositories.ts`
- Routes distinguish them with `programType: 'ready' | 'custom'`

### Domain logic (`src/lib/`)

Pure TypeScript functions with no React dependencies. This is where all business logic lives. Key modules:

| Area | Files |
|---|---|
| Recommendation & onboarding | `recommendationScoring`, `recommendationProfile`, `recommendationProgramme`, `firstRunSetup`, `onboardingStructure` |
| Home decisions | `homeProgramSelection`, `dashboard` |
| Workout session | `guidedPlayer`, `sessionDuration`, `workoutLoggingSessionBootstrap`, `workoutLoggerNavigation` |
| AI Coach | `aiCoachClient`, `aiCoachPreview`, `aiCoachActions`, `aiTrainingContext`, `aiCoachPlan` |
| Progress & history | `historyView`, `progressionActivePlan`, `progressionSignal` |
| Formatting | `format`, `displayLabel` |

New domain logic belongs in `src/lib/` as a pure function, covered by a test in `tests/lib/`.

### Test conventions

Test files are CommonJS (`.cjs`) in `tests/`. Each file exports an array of suite objects:

```js
module.exports = [
  {
    name: 'describes what is tested',
    run() {
      const assert = require('node:assert/strict');
      // assertions — throws on failure
    },
  },
];
```

No test framework — only `node:assert/strict`. Tests import compiled output from `.test-dist/` (mirrors `src/` path structure). Add new suites to `tests/run-tests.cjs` to include them in `npm run test:unit`.

### Storage

| Key | Contents |
|---|---|
| `@vinha/database/v1` | Full `AppDatabase` (minus exerciseLibrary which is stripped on write) |
| `@vinha/workout/v1` | `WorkoutPersistenceBundle`: active session + slot history |

`src/storage/database.ts` normalizes all fields on load, providing safe defaults for missing or malformed stored values.

Both keys go through `src/storage/largeItem.ts`, never bare `AsyncStorage.getItem`/`setItem`: Android cannot read back a row over 2 MB, so a value near that size is split into `<key>#0`, `<key>#1`, … behind a manifest. The history grows about 8 KB per session with no trimming, so a direct read or write of either key breaks for long histories.

### AI Coach

The app works fully offline. AI Coach has two modes:
- **Preview mode** (default): local mock responses from `src/lib/aiCoachPreview.ts`
- **Live mode**: calls `EXPO_PUBLIC_AI_COACH_API_URL` → serverless endpoint in `api/ai-coach.ts` → Anthropic Messages API (Claude)

Do not call Anthropic (or any model provider) directly from the mobile app — the `ANTHROPIC_API_KEY` lives only on the server. See `docs/ai-coach-backend.md` for server setup.

## Key constraints

- All state flows through `AppProvider` or `WorkoutProvider` — no component-local persistence
- Saved workout UX must be truthful: do not show a success state before `saveCompletedWorkoutSession` resolves
- Use `src/theme.ts` colors and existing shared components in `src/components/` before adding new styling
- Keep `src/lib/` pure — no AsyncStorage, no React, no side effects
- Ready program templates in `workoutCatalog.ts` are immutable at runtime; duplication into custom templates is done via `src/lib/customProgramDuplication.ts` (`buildDuplicatedCustomProgramDraft`, wired in `App.tsx`).
