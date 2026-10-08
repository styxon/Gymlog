# Vinha AI backend setup

Last updated: 26 July 2026

This backend path is designed so that the app can work in two modes:
- preview mode: no backend configured, app stays local
- live mode: app calls your own endpoint, which calls Anthropic (Claude)

## Files
- <repo-root>\api\ai-coach.ts
- <repo-root>\src\lib\aiCoachClient.ts
- <repo-root>\src\lib\aiCoachPreview.ts
- <repo-root>\src\types\aiCoach.ts

## Environment variables
### App
Set these in the Expo environment for builds that should use live Vinha AI:
- `EXPO_PUBLIC_AI_COACH_API_URL=https://your-domain.example/api/ai-coach`
- `EXPO_PUBLIC_AI_COACH_APP_KEY=<the same value as the server's AI_COACH_APP_KEY>`

If either variable is missing, the app automatically falls back to local
preview mode and never makes the round trip.

### Serverless endpoint
Set these on the server / deployment platform:
- `ANTHROPIC_API_KEY=...`
- `AI_COACH_APP_KEY=...` — any long random string (`openssl rand -hex 32`). The
  endpoint refuses every request that does not carry it in `x-vinha-app-key`,
  and refuses everything when it is unset. It ships inside the APK, so it is a
  lock on the front door (public-repo readers, web pages, casual scripts), not
  a vault — Play Integrity is the stronger door. No CORS headers are sent: the
  only client is the app.
- `AI_COACH_CLAUDE_MODEL=claude-haiku-4-5-20251001` (optional)
- `AI_COACH_CLAUDE_MAX_TOKENS=700` (optional)
- `AI_COACH_RATE_LIMIT_MAX=12` (optional)
- `AI_COACH_RATE_LIMIT_WINDOW_MS=600000` (optional)
- `AI_COACH_CLAUDE_TIMEOUT_MS=12000` (optional)

Spend-control variables are listed under **Tuning** below.

## Why this model, and what it costs
Haiku 4.5 is the cheap tier, which is the right default: the reasoning here is
light because `trainingHistory.ts` has already done the arithmetic. The request
is mostly context, so the prompt cache does the heavy lifting — the rules and
the training context sit in one cached prefix, and follow-up questions inside a
conversation re-read it at the cache rate instead of the input rate.

## Spend controls (execution-plan A2)

Three layers, and it is worth being exact about what each one can actually
stop, because only one of them is a true ceiling.

**1. Per-request size bounds — enforceable, and the real lever.**
`src/lib/aiCoachBudget.ts` refuses a call whose prompt or context exceeds the
configured character limits, before any upstream request is made. The response
was already capped by `max_tokens`; this caps the input, which is the half that
carries eight weeks of training history and that a client could otherwise
inflate at will. An oversized request is rejected outright rather than charged
against the budget, so one bad client cannot starve everyone else.

**2. Per-instance token budget — a brake, not a ceiling.**
Spend is tracked in estimated tokens (input + capped output) against a rolling
window, and booked *before* the call so a timeout still counts. Be clear-eyed
about the limit of this: the endpoint is a stateless serverless function, so
the counter dies with the instance. A burst spread across cold starts slips
past it. It bounds a single warm instance; it does not bound your bill.

**3. Anthropic Console spend limit — the only real ceiling.**
Set a hard monthly limit on the API key in the Anthropic Console. This is a
manual step, it is not in code, and nothing in this repo can substitute for it.
**Do this before the endpoint is reachable by anyone but you.**

The per-IP rate limit above is unchanged and is likewise per-instance: a speed
bump against a single hammering client, not a spend control.

### Tuning
- `AI_COACH_MAX_PROMPT_CHARS=2000` (optional)
- `AI_COACH_MAX_CONTEXT_CHARS=24000` (optional)
- `AI_COACH_TOKEN_BUDGET=1500000` (optional, per instance per window)
- `AI_COACH_BUDGET_WINDOW_MS=3600000` (optional)

A zero, negative or unparseable value falls back to the default rather than
disabling the limit — a misconfigured deploy must not silently open the tap.

## Logging decision
Current decision:
- Prompt text is not intentionally logged by the endpoint.
- Training context is not intentionally logged by the endpoint.
- Generic error logging may still occur without prompt payloads.

## Flow
1. App collects prompt + limited training context.
2. App calls your own endpoint.
3. Endpoint applies a basic in-memory rate limit.
4. Endpoint checks the spend budget: an oversized prompt or context is refused
   before any upstream call, and the estimated cost is booked against the
   instance's token window.
5. Endpoint calls the Anthropic Messages API, forcing a tool call so the answer
   shape is enforced by the API rather than requested in prose.
6. If Claude fails, times out, or the budget refuses the call, the endpoint
   returns a preview fallback rather than an error at the user.
6. App renders either live or preview advice, plus a note when fallback is used.

## Compose mode (the "AI assisted" programme)

The same endpoint accepts `{ "mode": "compose", "prompt": "<the user's brief>",
"context": {...}, "language": "fi" }`. It runs under the same key, rate limit
and budget, with a different tool (`ai_coach_programme`) and different rules:
return ONE week of sessions as common English exercise NAMES, follow the brief
first and the context second, never invent a name.

Two things differ from advice:

- **No fallback in the response.** The deterministic composer needs the
  exercise library, which is on the device. Every failure (`MISSING_API_KEY`,
  budget, timeout, invalid payload) is a plain error and the app composes
  locally from the same brief. In preview builds the app never calls this at
  all.
- **The app does the sweep.** Every name Claude returns goes through the
  library alias matcher (`programmeBrief.resolveLiveProposal`); a name that
  does not resolve is dropped and listed to the user, and a session left empty
  is dropped. A lift the brief avoids (a refusal, or one that loads a sore
  area) or that needs gear the reader lacks is dropped and listed the same
  way, by the preview composer's own limits (`aiCoachPlan.plannerLimits`).
  The endpoint validates shape only, never that a name exists.

## Deploy runbook (Vercel, in this order)

The endpoint is a plain `(req, res)` handler under `api/`, which is Vercel's
zero-config shape. Nothing here needs a `vercel.json`. Every step is manual and
needs your accounts; none can be done from the repo.

1. **Set the spend cap first.** Anthropic Console → Billing → usage limit. This
   is the only hard ceiling (the request-size and per-instance budgets in
   `aiCoachBudget.ts` are brakes, not caps — see A2 above). Do not skip to step 2
   without it: the moment the URL is public, the tap is open.
2. **Deploy.** `npx vercel` from the repo root, link or create the project, and
   in Vercel → Settings → Environment Variables set `ANTHROPIC_API_KEY` and
   `AI_COACH_APP_KEY` (production). The optional tuning variables above can
   wait; the defaults are the measured ones. A deploy without the app key is a
   coach that answers offline for everyone.

   **Order matters the first time.** Set `AI_COACH_APP_KEY` in Vercel *before*
   the keyed endpoint deploys, and ship an app build carrying the same
   `EXPO_PUBLIC_AI_COACH_APP_KEY` at the same time: every build made before
   the key existed is refused from that deploy on, and answers offline. Its
   withdrawals (`mode: 'forget'`) fail too, and the app keeps the label until
   a keyed build can retry — nothing is lost, but nothing is deleted either.

3. **Smoke it.** `curl -X POST https://<project>.vercel.app/api/ai-coach -H
   'content-type: application/json' -H "x-vinha-app-key: $AI_COACH_APP_KEY"
   -d '{"prompt":"hei","context":{}}'` should answer with the JSON envelope,
   not a 500. A `MISSING_API_KEY` in the body means step 2's Anthropic
   variable did not reach production; a 401 `UNAUTHORIZED` means the app key
   did not, or the header is missing.
4. **Point the app at it.** `EXPO_PUBLIC_AI_COACH_API_URL=https://<project>.vercel.app/api/ai-coach`
   and `EXPO_PUBLIC_AI_COACH_APP_KEY=<same value as AI_COACH_APP_KEY>` in the
   build environment (`.env` for local `npm run start`, EAS secret or the
   Gradle env for a release build). Without either the app stays in preview
   mode — which is the intended fallback, not an error.
5. **Prove the live path beats the baseline.** `node scripts/eval-ai-coach.cjs
   --live` against the deployed URL. Preview scores 84 % (21/25) and fails only
   the two cases that need the history read; live has to clear that or the
   endpoint is not earning its cost.

Rollback is step 4 in reverse: unset the URL and rebuild, and every install is
back on preview. The endpoint can stay up; nothing calls it.

## Daily key check

On 2026-09-13 the production key had been refused by Anthropic (401, "API key is
invalid") for an unknown stretch. Every answer was the on-device fallback, and
the free tier keeps function logs for about an hour, so nothing recorded when it
started. `api/coach-health.ts` now runs once a day from `vercel.json`
(05:00 UTC, ±59 min on Hobby):

- It checks that `AI_COACH_APP_KEY` is set: without it the coach refuses every
  request the app makes, whatever the Anthropic key says.
- It asks the coach's own model (`AI_COACH_CLAUDE_MODEL`, or the default) for
  one token with the key — a few thousandths of a cent a day. It used to read
  the model list, which answers a valid key even while every real call is
  refused by a spend limit, spent credit or a model that no longer exists
  (server audit, 2026-09-21).
- A missing key or app key, a 401 or 403 (the key), or a 400 or 404 (the call)
  posts one line to Slack `#bugs`, naming the status, Anthropic's own reason
  and the fix. A timeout, 429 or 5xx does not: the next run asks again. The
  rule and its tests are `src/lib/coachKeyHealth.ts` /
  `tests/lib/coachKeyHealth.test.cjs`.
- It posts again every day until the key works, so a note that gets missed once
  comes back.
- The key is never logged, returned or posted.

Needs, in the Production environment: `CRON_SECRET` (already set for
`prune-events`) and **`SLACK_WEBHOOK_BUGS`** — the `#bugs` incoming webhook from
`docs/slack-workflow.md`. Without the webhook the check still runs and answers
`"notified": "no-webhook"`. Both take effect on the next deploy.

Run it by hand, without posting:

```bash
curl -s -H "x-analytics-secret: $ANALYTICS_READ_SECRET" "https://api.vinha.app/api/coach-health?notify=0"
```

## Important
This is a minimal Beta backend path.
If you enable it for public Play release, update:
- privacy policy (it already describes the online mode — "only training numbers
  are sent, never your identity" — and names no third party; add Anthropic as
  the processor when the endpoint goes live)
- Data Safety declarations
- any user-facing Beta disclosures

## Function region: Stockholm, and where it is actually set

Measured 2026-09-10. Every endpoint answered with

```
x-vercel-id: arn1::iad1::<id>
```

The first segment is the edge that received the request. **The second is where
the function actually ran**, and `iad1` is Washington DC. The Blob store was
already in the EU, so the privacy policy's "storage is in the European Union"
was true — and it only ever claimed the storage. The processing was in the
United States, which is a different sentence and one the policy did not make.

**`vercel.json` is not the lever on this plan.** `regions: ["arn1"]` sat in the
file through two production deploys and every function still built in `iad1`,
silently. Asking for the same single region from the command line says why:

```
$ vercel --prod --regions arn1
Error: Regions for Hobby projects are limited to 1. Upgrade to Pro.
```

The key was removed rather than left in place ignored. The region lives in the
Vercel dashboard instead, under Settings → Functions → Function Region, which
a Hobby project can set to exactly one region. Set to Stockholm on 2026-09-10;
it applies to new deployments only, so it takes a redeploy to move.

Verify from the network rather than from the file. A value in a config is not a
region; a running function is:

```bash
curl -s -o /dev/null -D - -X GET "$EXPO_PUBLIC_AI_COACH_API_URL" | grep -i x-vercel-id
```

Both segments now read `arn1`, and `vercel inspect <deployment>` lists every
function as `[arn1]`. If a future deploy reads `iad1` again, the dashboard
setting is the thing to look at — nothing in this repository decides it.

Anthropic still answers from the United States either way. Moving the function
moves our own processing, not the model's.

## Deployattu ja todennettu 10.9.2026

Kolme palvelinmuutosta olivat pitkään koodissa mutta eivät ajossa. Kaikki kolme
ovat nyt tuotannossa ja mitattu verkosta, ei tiedostosta.

1. **Keskustelujen poisto.** `api/ai-coach.ts` sai `mode: 'forget'` -reitin,
   joka poistaa yhden tunnisteen alle arkistoidut keskustelut. Reitti ohittaa
   kaikki muut portit paitsi pyyntörajoituksen: tiliä ei ole, ja jokainen kutsu
   listaa koko `transcripts/`-polun ennen kuin poistaa mitään, joten
   rajoittamaton reitti myisi täyden listauksen arvatulla tunnisteella. Puhelin
   luopuu tunnisteesta vasta kun poisto on onnistunut — epäonnistuneen kutsun
   jälkeen tunniste jää talteen, koska se on ainoa lanka kopioihin. Todennettu:
   tuntemattomalla tunnisteella vastaus on `{"ok":true,"removed":0}`.
2. **Siivous kattamaan keskustelut.** Cron osasi vain `events/`-polun. Nyt se
   lukee `RETAINED_PREFIXES`-listan, jossa on myös `transcripts/`. Samassa
   nipussa poistoreitin kanssa, eli ajossa senkin todennuksen nojalla; cronia
   itseään ei voi kutsua ilman `CRON_SECRET`-salaisuutta.
3. **Tukholman alue.** Ks. yllä oleva luku: ratkaisu ei ollut `vercel.json`
   vaan projektin asetus.

**Auki: epäonnistunutta poistoa ei yritetä uudelleen.** Jos peruutushetkellä
ei ole verkkoa tai palvelin vastaa 429, kytkin sammuu puhelimessa mutta kopiot
jäävät palvelimelle. Mitään ei ole menetetty, koska `aiLogId` jää talteen ja
poisto onnistuu kun kytkintä seuraavan kerran koskee — mutta itsestään se ei
tapahdu. Korjaus olisi käynnistyksessä ajettava tarkistus: jos kaikki kolme
lupaa ovat pois mutta tunniste on tallessa, yritä poistoa ja nollaa tunniste
vasta onnistumisesta.

Yksi ansa maksoi kolme deployta: muutokset elävät worktreessä committoimatta,
joten päähakemistosta ajettu `vercel --prod` lähetti vanhat tiedostot ja
onnistui. Deploy siitä hakemistosta missä muutokset ovat:

```bash
npx vercel --prod --cwd "<worktreen polku>"
```

