# Telling an old build to update

Builds stay on phones for months after a release, and every one of them keeps
calling the same endpoints. So every request the app makes to our server —
backup, coach, usage statistics — carries two headers:

| Header | Value |
|---|---|
| `x-vinha-app-version` | `expo.version` from `app.json`, e.g. `1.1.0` |
| `x-vinha-platform` | `android` or `ios` |

The rule both sides share is `src/lib/appUpdateGate.ts`; the app's listener is
`src/features/appUpdate/`. Builds from before 2026-09-28 send neither header and
are never refused.

## Refusing a build

Set in Vercel → Project → Settings → Environment Variables (Production), then
redeploy — a changed variable applies to the next deploy only:

| Variable | Meaning |
|---|---|
| `APP_MIN_VERSION_ANDROID` | Oldest Android version the server still serves, e.g. `1.2.0` |
| `APP_MIN_VERSION_IOS` | The same for iOS |
| `APP_STORE_URL_IOS` | The App Store page (`https://apps.apple.com/...`). Until it is set, an iOS build is told to update without a button to press. Set in Production on 2026-10-28 to `https://apps.apple.com/fi/app/id6823676706`. |

Unset, empty or unreadable means nobody is refused — a typo cannot lock every
phone out. A refused build gets HTTP 426 with `{ ok: false, error:
"APP_UPDATE_REQUIRED", storeUrl }`, and shows "Päivitä Vinha" once per launch
with a button to the store. The app keeps working on the phone; only the server
features stop for that build.

What is refused, and what is not:

- `api/ai-coach.ts`: questions, the programme composer and the photo import.
  **Not** the withdrawal of log consent — taking back permission has to work
  from any build.
- `api/backup.ts`: uploads only. Restoring and deleting your own backup work
  from any build.
- `api/events.ts`: new usage batches. The phone keeps them queued.

## When to raise the minimum

Only when the server is about to stop understanding what an older build sends
(a changed request shape, a removed field). Raise it in the same deploy as that
change, to the first version that sends the new shape — and ship that version
to the stores first, since a refused reader needs somewhere to update to.

Every release must bump `expo.version` in `app.json` (and the copies in
`package.json` and `src/theme.ts`; `tests/lib/appUpdateGate.test.cjs` fails if
they differ). Two builds sharing a version cannot be told apart.
