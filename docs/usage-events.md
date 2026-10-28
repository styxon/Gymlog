# Usage events: the pipeline and its retention

The app sends ten anonymous events to our own Vercel endpoint — eight usage
events and, since 2026-10-04, two error events (the vocabulary is
`src/lib/analytics.ts`; the privacy policy lists every event). This page is the
operator's view: where the data sits, how long, and what keeps that promise.

**Coming with the SQLite history mirror (1.1.1):** one more event, the
start-up check of the mirror against the stored database: counts and a
status only (matched, rebuilt, and why), never record contents (owner
decision S5, 2026-10-28). The privacy policy lists it from version
`2026-10-28`; it joins `src/lib/analytics.ts` and `api/events.ts` in the
mirror's PR, server first (see Deploy order below). Play Data safety
(Diagnostics) and App Store App Privacy are updated in the same release.

## Error reports (`app_error`, `operation_failed`)

Production failures ride the same pipe and the same switch — no third-party
crash service. Shapes and validation: `src/lib/errorReport.ts` (client and
server validate with the same code; per batch at most 20 `app_error` and 40
`operation_failed`, which the client's `takeBatch` respects). **No message field
exists**: an error message is free text that can hold exercise names or an email.

**The server validates per event.** `api/events.ts` stores the valid events of a
batch, drops the invalid ones and answers `200 { ok, accepted, dropped }`; only a
batch that is not a batch (no install id, no events, more than 100) is a 400. The
client drops a batch the server refused for good (a 4xx carrying the server's own
JSON error, other than 408/425/426/429) and retries only what a later try can
fix: no network, 5xx, a rate limit, "update the app". Refusing a batch whole and
retrying the same head forever used to stall every funnel event behind it.

**Deploy order.** A client that sends a new event shape or a new route key must
not ship before the server that accepts it is live. Merging to `main` deploys the
server automatically, so merge first and build the APK after; an older server
would now drop the new events (counted, harmless) rather than stall the queue,
but they would be lost.

**Play vitals.** A render error the boundary catches no longer ends the process,
so it no longer reaches Play Console's Android vitals as a native crash; it
shows up here as `app_error` with kind `render`. Fatal JS errors outside React's
render still end the process and still count there.

- `app_error`: `kind` (`js_fatal`, `js_error`, `render`, `unhandled_rejection`),
  `name` (class), `signature` (hash of class + top 3 frames), up to 5
  `bundle:line:col` frames, `screen` (`tab/screen` route key, `onboarding` or
  `unknown`), `appVersion`, `platform`. Frames are positions in the Hermes
  bundle: look them up in that build's source map.
- `operation_failed`: `op` (`workout_save`, `backup_upload`, `backup_restore`,
  `database_load`, `workout_load`, `account_delete`, `sign_in`) and a closed
  `code` (`NETWORK`, `STORE_UNAVAILABLE`, `SERVER_ERROR`, `PAYLOAD_TOO_LARGE`,
  `RATE_LIMITED`, `INVALID_TOKEN`, `SESSION_REVOKED`, `SESSION_EXPIRED`,
  `STORAGE_FAILED`, `QUOTA`, `UNKNOWN`).
- Per launch: one report per signature, at most 10 `app_error`; one per op and
  code, at most 20 `operation_failed`. Development builds report nothing.
- Capture: `AppErrorBoundary` at the root of `App.tsx` (`render`), the global
  handler and Hermes' rejection tracker (`installErrorReporting`, imported first
  by `index.ts`), and one line at each failure point (`reportOperationFailed`).
- A **fatal** error is put on the queue with the write already issued before the
  process ends, and sent on the next launch. Not guaranteed: that the phone
  finishes the write before the process dies, and any crash in the first moments
  of a launch before the queue is in memory. A database/workout load failure is
  reported once the app next opens, because the reader's switch lives in the
  data that did not load.
- Reading: `node scripts/analytics-report.cjs` and `analytics.cmd` have an
  **Errors** section — app errors by signature (installs, count, first/last seen,
  versions, screens, frames), worst first, then failed operations by op + code
  per day.

| Piece | Where |
|---|---|
| Vocabulary and validation (shared by client and server) | `src/lib/analytics.ts` |
| Device queue, install id, the Settings switch's gate | `src/features/analytics/analyticsClient.ts` |
| Sink and reader | `api/events.ts` → private Vercel Blob store, `events/YYYY-MM-DD/<batch>.json` |
| Report and dashboard | `node scripts/analytics-report.cjs`, `analytics.cmd` |
| Retention rule | `src/lib/analyticsRetention.ts` (`ANALYTICS_RETENTION_MONTHS = 24`) |
| Retention enforcement | `api/prune-events.ts`, scheduled by `vercel.json` |

## Reading it

`GET /api/events` answers a page of the store's listing at a time, up to 500
batches, with `next` (the cursor to continue from); the first page also
carries `total`, every batch the query matches. The report follows `next` to
the end and prints a warning when it read fewer batches than `total`.
`--since` is a lower bound on the arrival day, not the only day.

The report's days are Europe/Helsinki calendar days. Retention is two windows
named for the days they cover — back on day 1–2 and on day 6–8 after the first
open — and an install is in a window's denominator only once that window is
over in the data. The funnel is one block per onboarding branch, each row a
share of the installs that reached the branch's first row.

When each event is true is decided in `src/lib/analyticsMoments.ts`: an open is
a cold start or a return after 30 minutes away, a paywall view is once per
visit and never for a reader with Pro on, an adoption is a plan joining the
running set.

## The user's switch

Settings → Usage statistics (`usageStatisticsEnabled`, on by default). The client
sends nothing until App.tsx has handed it the stored preference after hydration,
so a reader who turned it off never has a batch leave during startup. Off also
drops the queue and the install id; on again starts as a new install.

## Retention: 24 months, deleted automatically

The policy says events are kept for up to 24 months and then deleted
automatically. `vercel.json` runs `/api/prune-events` every day at 04:00 UTC
(Hobby plan: once a day is the maximum frequency, and the run lands somewhere
inside that hour). Daily rather than monthly on purpose: a monthly run would
let a batch live up to 25 months against a promise of "up to 24"; a daily one
bounds the overshoot to under a day. The endpoint lists `events/`, keeps every
batch whose arrival day is inside the window, and deletes the rest in chunks
of a hundred. It is idempotent, so a skipped or doubled run is harmless.

`tests/lib/analyticsRetention.test.cjs` pins the number in the policy to the
constant, the cron path to an existing function, the schedule to a fixed
daily run, and `.vercelignore` to letting `vercel.json` through.

### One-time setup in Vercel

1. Project → Settings → Environment Variables: add `CRON_SECRET` (any random
   string of 16+ characters, production scope). Vercel sends it as
   `Authorization: Bearer <CRON_SECRET>` on every cron call; the endpoint
   refuses anything else.
2. Deploy (`npx vercel --prod`). `vercel.json` is uploaded because
   `.vercelignore` allows it by name. The cron then appears under Project →
   Settings → Cron Jobs, with a View Logs link.
3. Dry run from your machine, proven with the analytics read secret:

```bash
node scripts/prune-events.cjs --dry
```

   The first real deletion is due in September 2028; until then the dry run
   reports zero expired batches, which is the right answer.

### Changing the period

Change `ANALYTICS_RETENTION_MONTHS`, then the two policy sentences the test
names (English and Finnish) in `src/lib/legalDocuments.ts`, bump
`LEGAL_LAST_UPDATED`, re-run `node scripts/export-legal.cjs`, and redeploy.
