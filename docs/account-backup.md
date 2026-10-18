# Google sign-in & cloud backup — setup runbook

Last updated: 22 August 2026

**Deployed state (2026-08-22):** project `vinha-fit/vinha`, production URL
`https://api.vinha.app/api/backup` since 2026-10-03 (CNAME in Cloudflare, DNS
only). The old `https://vinha-azure.vercel.app` stays attached to the same
project, because builds before that date have it baked in; remove it only
once no installed build uses it. Server env complete, smoke-tested: a nonsense
token answers `INVALID_TOKEN`. `.vercelignore` limits the upload to api/ + src/ —
without it the CLI tried to push the whole 1.4 GB working tree.

Optional Google sign-in that backs the training data up to a server, so a new
phone restores it. Offered on the post-onboarding hand-off screen and in
Settings → YOUR DATA. Free and Pro alike (decision 2026-08-22). On iPhone,
Sign in with Apple sits beside Google (2026-10-01, App Review guideline 4.8) —
see "Sign in with Apple" below.

The whole feature is configuration-gated: a build without
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_BACKUP_API_URL` shows no
sign-in anywhere. No dead buttons.

## Files

- `api/backup.ts` — serverless endpoint: verify Google ID token, store/fetch/delete one blob per account
- `src/features/account/accountAuth.ts` — which sign-in the backup uses (the hook's only auth import)
- `src/features/account/googleAuth.ts` — the only file that touches Google Sign-In
- `src/features/account/appleAuth.ts` — the only file that touches Sign in with Apple (iPhone)
- `src/features/account/backupApi.ts` — the app's side of the endpoint
- `src/features/account/useAccountBackup.ts` — sign-in / backup / restore state machine
- `src/features/account/accountStore.ts` — `@vinha/account/v1` (identity, last backup time)
- `src/lib/accountBackup.ts` — payload build/parse/describe (pure, tested)

## What is stored where

One JSON blob per Google account in Vercel Blob, at
`backups/hmac_sha256(googleSub, BACKUP_PATH_SECRET).json` — deterministic for
the server, unguessable without the secret, and the URL never leaves the
endpoint. The payload is the app database (exercise library stripped, exactly
like the local save) plus the workout history. The active session is never
backed up.

## Manual steps, in this order

### 1. Google Cloud Console (identity)

1. Create/open a project at console.cloud.google.com.
2. **OAuth consent screen**: External, app name Vinha Fitness, your email.
   Scopes: only the default openid/email/profile.
3. **Credentials → Create credentials → OAuth client ID**, twice:
   - **Web application** → this client id is `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
     (yes, the *web* one — the native library exchanges through it) and
     `GOOGLE_WEB_CLIENT_ID` on the server.
   - **Android** → package name `app.vinha`, plus the SHA-1 of BOTH keystores:
     - debug: `keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android`
     - release: `keytool -list -v -keystore <release.keystore> -alias <alias>`
   Sign-in fails with DEVELOPER_ERROR when the SHA-1 or package is missing.

### 2. Vercel (storage + endpoint)

1. In the Vercel project: **Storage → Create → Blob** (EU region). Creating it
   from inside the project connects it automatically — `BLOB_STORE_ID` appears
   in the env list, and the SDK authenticates via the function's OIDC identity.
   There is no `BLOB_READ_WRITE_TOKEN` in this flow.
2. Environment variables (production):
   - `GOOGLE_WEB_CLIENT_ID` — the web client id from step 1
   - `BACKUP_PATH_SECRET` — any long random string (e.g. `openssl rand -hex 32`).
     Changing it later orphans every stored backup.
   - `BACKUP_MAX_BYTES` — optional, default 4 MB. Leave it unset: Vercel refuses
     bodies over 4.5 MB anyway, and the app gzips a backup whose JSON passes
     1 MB (`ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS`), so the cap is compressed bytes.
3. Deploy (`npx vercel`). Smoke test:
   `curl -X PUT https://api.vinha.app/api/backup -H 'authorization: Bearer nonsense' -d '{}'`
   must answer `401 INVALID_TOKEN` — not 500 (500 = missing env).

### 3. App build

1. Build env:
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>`
   - `EXPO_PUBLIC_BACKUP_API_URL=https://api.vinha.app/api/backup`
2. The native module needs a prebuild (`npx expo prebuild` — the config plugin
   `@react-native-google-signin/google-signin` is already in app.json).
   Remember the local.properties restore afterwards (see project notes).
   An old dev client without the module degrades gracefully: sign-in reports
   "needs an app update" instead of crashing.

## Behavior contract (what the tests pin)

- Sign-in with no cloud backup → local data uploaded as the first backup.
- Sign-in on a fresh install with a cloud backup → restored automatically.
- Sign-in when BOTH sides hold data → the app asks; nothing is destroyed
  without a choice. "Keep this phone" overwrites the cloud on the spot.
- Every upload names the cloud copy it replaces: the version (blob ETag) this
  phone last wrote or restored, or `none` for a first backup, in the
  `x-backup-expected-version` header. The endpoint writes only over that copy
  and otherwise answers 412 `BACKUP_CHANGED` without writing, so a second
  phone on the account can no longer replace newer data with older. The
  automatic backup then stops for that run of the app; "Back up now" asks
  restore-or-keep about the copy that is there. An upload without the header
  (a build from before 2026-09-21) still overwrites, so installed phones keep
  backing up until they update. Deploy the endpoint before shipping the build:
  against an endpoint that sends no versions, the new build reads the copy
  before every upload.
- Auto-backup after logged work changes (8 s debounce), only while signed in.
- Backup success is only shown after the server accepted the write.
- Sign-out keeps local data; "Delete cloud backup" removes the server copy.
- "Reset all data" signs out FIRST, so the wipe cannot auto-backup an empty
  database over the cloud copy — the reset stays recoverable by signing in.
- The endpoint verifies the token audience on every request and never logs
  payloads (guarded in tests/releaseReadiness.test.cjs).
- The privacy policy describes the feature in both languages; the release
  guard fails if the plugin ships without that text.

## Sign in with Apple (iPhone)

An Apple identity token lives ten minutes and Apple has no silent refresh, so
the phone trades it once for an **Apple session** issued by `api/backup.ts`:

1. `POST /api/backup` with `x-backup-action: apple-session` and the Apple
   identity token as the bearer. The server checks the signature against
   Apple's published keys, the issuer, the expiry, and that the audience is
   `APPLE_BUNDLE_ID` (default `app.vinha`).
2. It answers `{ sessionToken: "vs1.…", expiresAt }` — 180 days, signed with a
   key derived from `BACKUP_PATH_SECRET`. The phone keeps it in
   `@vinha/account/apple/v1` and sends it as the bearer from then on.
3. Before each use the phone asks Apple (`getCredentialStateAsync`) whether
   the reader has removed Vinha from their Apple ID; revoked means signed out.
   In its last 30 days the phone renews it first (`x-backup-action:
   apple-renew`, the session as the bearer), so a reader who keeps training is
   never timed out. Only a session that has actually run out — months offline —
   counts as signed out, and the reader signs in again with one Face ID.

**Delete account (2026-10-02).** Settings → Delete account sends `DELETE` with
`x-backup-action: delete-account`. The server deletes the copy first, then
writes `revoked/<hmac>.json` — `{ "revokedAtMs": <unix ms> }`, under a hash of
the account that is not the backup's pathname — and writes it a second time with
the time the first write returned (a renewal minted while the first write was in
flight is older than the second stamp). From then on every Apple session issued
at or before the marker's millisecond is refused: `verifyAppleSession` runs on
every request, `apple-renew` included, which looks a second time just before
answering. Sessions carry `iatMs` (and `iat` in seconds); one with only `iat`
counts from the start of that second, one with neither as issued at
`exp − 180 days`. A new Apple sign-in afterwards is a later session and works,
in the same second. The copy goes first so a failed marker write leaves the
session alive and the reader can ask again. It goes a second time after the two
stamps (hunt 3, 2026-10-03): a write that had passed its session check before the
first stamp, and names no copy to fail against (`none`, or no
`x-backup-expected-version` — a build from before versions), could land between
the first delete and the stamps. A failure of that second delete is a 502 as at the
first, but by then the marker is already written: the session is over, and the
phone's retry meets `SESSION_REVOKED`. The second delete is unconditional (a copy
written by a brand-new session in the milliseconds after the second stamp is lost
with it; accepted). A plain `DELETE` ("Delete cloud
backup") writes no marker: it keeps the reader signed in. A store that cannot
read the marker answers 502, not 401. A marker that cannot be parsed is resolved
ONCE to the store's `uploadedAt` and rewritten in valid form (the SDK's
`uploadedAt` is "now" when the store sends no Last-Modified, so a marker read
afresh each time would refuse every session for ever); a rewrite the store
refuses is a 502. Only a body that was read IN FULL and then does not parse is
"unparseable": a stream error part-way through a valid marker is a 502 and the
marker is left alone (rewriting it would date it with the store's time, which can
be later than its own). The rewrite is conditional on the ETag `head` reports, and
only when `head`'s and `get`'s forms are the same value (`etagCore`: quotes and `W/`
ignored) — the content response's ETag can be written differently, and named as the
condition it failed every time, a permanent 502 for the account. Forms that cannot
be matched, or a marker that moved or went, take the re-read path (a valid marker is
used; otherwise 502) and log `backup marker rewrite etag forms differ: get=<shape>
head=<shape>`.

**A write is looked at again once it has landed.** After a successful `PUT` of an
Apple session the endpoint reads the marker once more. If the session is now revoked
(Delete account landed while the write was in flight) the answer is `401
SESSION_REVOKED` — with the `deleteRequestId` as every other refusal — after the
write has happened, and the copy just written is taken back with `del(url, {
ifMatch: <the ETag put returned> })`, so only that copy goes and a newer one written
by a new sign-in stays. A put that returned no ETag is left in place (logged,
still 401): an unconditional delete could remove somebody else's copy. A marker that
cannot be read, or does not answer within 1.5 s, leaves the write standing and the
answer is the ordinary 200. Google accounts have no marker and are unchanged.

**Identity-token replay (2026-10-03).** An Apple identity token lives ten
minutes and the exchange (`apple-session`) accepts it as often as it is sent, so
a token issued before Delete account could buy a fresh 180-day session after it.
The exchange now reads the account's marker and refuses a token with
`(iat + 1) * 1000 <= revokedAtMs` (`iat` is whole seconds, so the end of that
second is the latest it can have been issued) — `401 { error: "SESSION_REVOKED" }`,
not `INVALID_TOKEN`. A token Apple issues after the deletion is later than the
marker, in the same second too, and works. A token with no `iat` counts as
issued at 0 (refused once any marker exists). A store that cannot be read is a
502.

**The delete request id (2026-10-03).** The phone may send
`x-delete-request-id: <32 lowercase hex characters>` on the delete-account
`DELETE` (anything else is ignored). It is stored in the marker as
`deleteRequestId` on both stamps (and kept when a corrupt marker that still
names it is rewritten). A `401 SESSION_REVOKED` caused by that marker — on a
request, a renewal or an exchange — carries `{ ok: false, error:
"SESSION_REVOKED", deleteRequestId }`, and nothing else is added. The requester
holds a session or identity token of the same account, so it shows nothing to
anyone else; a phone whose delete answer was lost compares it with the id it
sent to tell its own deletion from another phone's. A marker written before this
has no field, and the body then has none. The id is a random number with no
meaning to anyone but the phone that made it; the policy's "one scrambled marker
with a date" does not yet name it.

**Marker clean-up is conditional.** A stale marker is removed with
`del(url, { ifMatch })` (single URL; `BlobPreconditionFailedError` when the
copy changed — @vercel/blob 2.8.0 `del`), never unconditionally: a Delete
account stamping the same pathname while the removal was in flight would
otherwise be erased. The ETag `ifMatch` compares is the API's (`head`), which
may be written differently from the content response's header `get` reads
(quotes, `W/`); it is fetched with `head`, must equal (normalised) the one read
with the content, and is the one the `del` names. Anything else — the marker
moved, the forms do not match, the condition fails, the store errors — keeps the
marker, and never fails the request. A mismatch between the two forms logs one
line (`backup stale marker etag forms differ: get=<shape> head=<shape>`, shapes
like `strong-quoted-len34`, never the value), so forms that can never match —
and stale markers that therefore never go — leave a trace.

**412 BACKUP_CHANGED** now also carries `version`, the copy the store holds at
that moment (`null` only when there is truly no copy; left out when the store
could not say), so a phone whose own write was retried by the SDK after the
first attempt committed can recognise its own copy.

**What the phone is told.** A refused Apple session is answered `401` with
`SESSION_REVOKED` (the marker) or `SESSION_EXPIRED`; a session that does not
verify (bad mac, malformed — also what a wrongly configured
`BACKUP_PATH_SECRET` looks like, for everyone at once) is `INVALID_TOKEN`. The
phone signs out like the Sign out row on the first two, for a `vs1.` session
only (upload, download, delete, and the sign-in's own look at the cloud), so the
other phones of a deleted account stop saying "Signed in". `INVALID_TOKEN`, a
Google token's 401 and any 502 sign nobody out, so a bad deploy cannot mass
sign-out phones that a rollback would not bring back. A retried Delete account
whose first answer was lost meets `SESSION_REVOKED` and is reported as done
(the copy went before the marker was written; the second delete after the stamps
may be missing if it was that one that failed, and a retry cannot repeat it — the
marker already refuses the session).

**Clean-up.** A marker older than 181 days no longer changes anything. A
request from the account itself removes its own; `purgeOldRevocations` (a
paged `list` of `revoked/`, 5 pages of 100 at most, 1.5 s at most, each
candidate re-read before it is deleted) runs on Apple sign-in exchanges and
never on the deletion, whose answer the phone is waiting for. Removal therefore
comes some time after the 180 days, depending on sign-in traffic — which is what
the policy says.

**Known, not fixed here.** An Apple upload in flight when the account is deleted
no longer brings the copy back (the second delete and the post-write look above).
What remains is the same race for a plain "Delete cloud backup" and for a Google
account, which have no marker: an upload already in flight can write the copy back
after the delete, and the blob stays until the reader deletes it again. **Needs a
Vercel deploy** — until
then the app's `delete-account` request is an ordinary `DELETE` that leaves the
Apple sessions alive, and the new codes are never sent.

**Ending the sign-in at Apple (2026-10-17).** App Review asks an app that
offers Sign in with Apple to revoke the reader's tokens when the account is
deleted, and until then Vinha stayed on the reader's Apple ID → Sign in with
Apple list. As the reader confirms Delete account, the phone asks Apple once
more (`signInAsync` with no scopes, `appleAuth.appleDeletionCode`) for a
one-time authorization code, and sends it with the delete as
`x-apple-authorization-code`. After the copy and the sessions are gone the
server trades it at `https://appleid.apple.com/auth/token` with a client
secret it signs (ES256, `iss` = Team ID, `sub` = `APPLE_BUNDLE_ID`, `aud` =
`https://appleid.apple.com`, `kid` = Key ID, five minutes), checks that the
grant's `id_token` names the account being deleted, and revokes the refresh
token at `/auth/revoke`. Nothing of it is stored. It never decides the
answer: no key configured, a refused code or Apple not answering (4 s per call)
is logged as `apple revoke …` and the account is still deleted. Backing out of
Apple's sheet backs out of the deletion before anything is sent; a phone that
cannot show the sheet deletes without the code, as before.

Apple accounts are stored under `apple:<sub>`, so an Apple account and a
Google account never share a blob. Google subjects stay unprefixed — changing
them would orphan every existing backup.

Setup: `APPLE_BUNDLE_ID` only if the bundle id ever changes. For ending the
sign-in at Apple, three more, all Production: in Apple Developer → Certificates,
Identifiers & Profiles → Keys, a new key with "Sign in with Apple" enabled and
`app.vinha` as its primary App ID; download the `.p8` (once only) and note
its Key ID. Then in Vercel: `APPLE_TEAM_ID` (the team id, top right in Apple
Developer), `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` (the `.p8`'s whole text;
pasted on one line, its line breaks may be written `\n`), and redeploy.
Without them deletion works as before and the log says `apple revoke skipped`.
On Apple's side, the App ID needs the "Sign in with Apple" capability; EAS sets
it from `ios.usesAppleSignIn`.

## Deleting from the web page (2026-10-03)

`styxon.fi/vinha-fitness/legal/delete-account.{fi,en}` (the Play Data safety
deletion URL) signs a reader in with Google in the browser and sends the app's
own request: `DELETE` with the ID token and `x-backup-action: delete-account`.
The token comes from the same **Web** OAuth client as the app's
(`GOOGLE_WEB_CLIENT_ID`), so the server checks it as it checks the app's, and
the `sub`, hence the blob, is the same.

- **Google Cloud Console**: that Web client's *Authorized JavaScript origins*
  must list `https://styxon.fi` and `https://www.styxon.fi`, or Google refuses
  the sign-in on the page.
- **CORS** (`src/lib/webAccountDeletion.ts`): only `DELETE` and its preflight
  from those two origins get an `Access-Control-Allow-Origin`. A `GET` with a
  token is not preflighted by method, so it gets none; the browser then keeps
  the backup from the page.
- The page cannot reach the coach copies (they are filed under the phone's
  `aiLogId`, not the account); the page and the policy say so, and they expire
  with the 24-month prune.
- Apple accounts: in the app only, until the plan in docs/ios-launch.md.
- Publishing: `npx tsc -p tsconfig.test.json && node scripts/build-legal-site.cjs`
  (reads `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` from `.env.local`), copy
  `dist-legal/` into the styxon.fi site, upload. The API change needs a Vercel
  deploy first, or the page's request is refused by the browser.
