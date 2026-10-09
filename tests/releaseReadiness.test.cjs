const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

/**
 * Guards for the things that block a Play release and are invisible while
 * developing — nothing here fails at runtime, so only a test notices.
 */

const root = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

module.exports = [
  {
    name: 'release: app.json declares an Android versionCode',
    run() {
      const app = readJson('app.json');
      const versionCode = app?.expo?.android?.versionCode;

      // Without this, prebuild regenerates versionCode 1 every time. Play takes
      // 1 once and then rejects every later upload, with nothing in the repo to
      // bump — the failure lands at submission, not in the build.
      assert.equal(
        typeof versionCode,
        'number',
        'app.json is missing expo.android.versionCode; Play needs it to be declared and bumped.',
      );
      assert.ok(Number.isInteger(versionCode) && versionCode >= 1, 'versionCode must be a positive integer');
    },
  },
  {
    name: 'release: the rest alert may ask for exact alarms, and nothing claims to be an alarm clock',
    run() {
      // USE_EXACT_ALARM is restricted to alarm clocks and calendars, and Play
      // asks for a justification at upload; a rest timer does not qualify.
      //
      // SCHEDULE_EXACT_ALARM is the user-granted one, and it is declared on
      // purpose (user decision 2026-09-17). Without it expo-notifications
      // checks canScheduleExactAlarms(), gets "no", and arms every alert with
      // setAndAllowWhileIdle — a reminder a few minutes late costs nothing, an
      // end-of-rest alert a few minutes late is no alert. Android 14 denies it
      // by default, so the app still has to work without it: the rest-alert
      // ask and Settings send the reader to "Alarms & reminders", and the
      // native module that reads the grant must be there to back them.
      const permissions = readJson('app.json')?.expo?.android?.permissions ?? [];
      assert.ok(
        !permissions.includes('android.permission.USE_EXACT_ALARM'),
        'USE_EXACT_ALARM is back in app.json — it turns a submission into a policy review.',
      );
      assert.ok(
        permissions.includes('android.permission.SCHEDULE_EXACT_ALARM'),
        'SCHEDULE_EXACT_ALARM is gone — every rest alert becomes an inexact alarm Android may hold for minutes.',
      );
      const moduleConfig = readJson('modules/exact-alarm/expo-module.config.json');
      assert.deepEqual(moduleConfig.android.modules, ['expo.modules.exactalarm.ExactAlarmModule']);
      const kotlin = read('modules/exact-alarm/android/src/main/java/expo/modules/exactalarm/ExactAlarmModule.kt');
      assert.match(kotlin, /Name\("ExactAlarm"\)/);
      assert.match(kotlin, /AsyncFunction<Boolean>\("canScheduleExactAlarms"\)/);
      assert.match(kotlin, /AsyncFunction<Boolean>\("openSettings"\)/);
      assert.match(kotlin, /Settings\.ACTION_REQUEST_SCHEDULE_EXACT_ALARM/);
      // The JS side asks for the module by the name the Kotlin side registers.
      const bridge = read('src/utils/exactAlarm.ts');
      assert.match(bridge, /requireOptionalNativeModule<ExactAlarmNativeModule>\('ExactAlarm'\)/);
      assert.match(bridge, /canScheduleExactAlarms\(\): Promise<boolean>;/);
      assert.match(bridge, /openSettings\(\): Promise<boolean>;/);
    },
  },
  {
    name: 'release: app.json and package.json agree on the version',
    run() {
      const app = readJson('app.json');
      const pkg = readJson('package.json');
      assert.equal(
        app?.expo?.version,
        pkg.version,
        'The store listing reads app.json and the repo reads package.json. They must not drift.',
      );
    },
  },
  {
    name: 'release: no document in docs/ still carries a fill-in placeholder',
    run() {
      // The old draft policy shipped with "[Your name or company name]" in it,
      // sitting next to the real documents where a release could grab the wrong
      // one. Anything bracket-shaped in docs/ is unfinished by definition.
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.md')) {
            const body = fs.readFileSync(full, 'utf8');
            if (/\[Your [^\]]+\]/i.test(body)) {
              offenders.push(path.relative(root, full));
            }
          }
        }
      };
      walk(path.join(root, 'docs'));

      assert.deepEqual(offenders, [], `Unfilled placeholders in: ${offenders.join(', ')}`);
    },
  },
  {
    name: 'release: docs/privacy-policy.md points at the real policy instead of being one',
    run() {
      // It is not the source of truth and must never look like it again.
      const stub = read('docs/privacy-policy.md');
      assert.ok(stub.length < 2000, 'docs/privacy-policy.md has grown back into a second policy');
      assert.ok(
        stub.includes('legalDocuments.ts'),
        'docs/privacy-policy.md should point at the single source of truth',
      );
    },
  },
  {
    name: 'release: the paywall does not sell a trial the app cannot deliver',
    run() {
      // The Pro page advertises a 7-day free trial and a monthly price. That is
      // deliberate and fine in a demo build (user decision 2026-08-01), and a
      // consumer-law problem the moment it reaches a store: there is no billing,
      // no trial, and nothing to cancel.
      //
      // A guard that is permanently red teaches people to ignore the suite, so
      // this one does not fail on the demo. It fails when the two facts stop
      // agreeing — which is exactly the release step: flip extra.demoBuild to
      // false, and this test names what became a lie.
      const screen = read('src/screens/PremiumScreen.tsx');
      // The onboarding paywall used to make the same promise and was covered
      // here too; the screen went unreachable when onboarding stopped ending
      // on it (d262ca1) and was deleted 2026-08-25. The Pro page is now the
      // one surface that can advertise a trial.
      // v6 moved the CTA copy out of the screen and into the tier table, so
      // reading only the screen would make this check pass by looking in the
      // wrong file — a guard that silently stops guarding is the exact failure
      // mode this suite exists to prevent.
      const advertisesTrial = /'pro\.v2\.cta'/.test(screen + read('src/lib/proTiers.ts'));
      if (!advertisesTrial) {
        return;
      }

      // Whatever ends up implementing purchases will name one of these.
      const billingMarkers = ['react-native-iap', 'expo-in-app-purchases', 'revenuecat', 'purchases'];
      const pkg = read('package.json').toLowerCase();
      const billingExists = billingMarkers.some((marker) => pkg.includes(marker));
      const demoBuild = readJson('app.json')?.expo?.extra?.demoBuild === true;

      assert.ok(
        billingExists || demoBuild,
        'A paywall advertises a 7-day free trial, no billing library is installed, and ' +
          'app.json no longer declares extra.demoBuild. One of the three has to give: wire ' +
          'billing, take the trial copy off the CTA, or admit this is still a demo.',
      );
    },
  },
  {
    name: 'release: the invented card and receipts do not reach a real store',
    run() {
      /**
       * The subscription screen shows a payment method, a next-charge date and
       * a receipt history. None of it exists — see MOCK_BILLING in
       * lib/subscriptionView. It is there because a management screen has to be
       * walkable before there is a store to walk it against (user decision
       * 2026-08-16, after the risk was put in front of them).
       *
       * That is fine in a demo build and indefensible in a real one: unlike
       * most placeholder copy, a reader can *check* this. They open Google Play,
       * find no subscription and no Visa ending 4242, and every other number in
       * the app becomes suspect.
       *
       * Two ways to satisfy this guard, and only two: keep declaring
       * extra.demoBuild, or wire real billing. Deleting MOCK_BILLING satisfies
       * it as well, which is the third and best answer if the screen turns out
       * not to be worth it.
       */
      const view = read('src/lib/subscriptionView.ts');
      if (!/export const MOCK_BILLING/.test(view)) {
        return;
      }

      const billingMarkers = ['react-native-iap', 'expo-in-app-purchases', 'revenuecat', 'purchases'];
      const pkg = read('package.json').toLowerCase();
      const billingExists = billingMarkers.some((marker) => pkg.includes(marker));
      const demoBuild = readJson('app.json')?.expo?.extra?.demoBuild === true;

      assert.ok(
        billingExists || demoBuild,
        'MOCK_BILLING still ships an invented payment method and receipt history, no ' +
          'billing library is installed, and app.json no longer declares extra.demoBuild. ' +
          'Wire billing or delete MOCK_BILLING — a reader can check this one against Google Play.',
      );

      // The gate is what makes the demo flag mean anything: without it the rows
      // would render regardless of the flag and this guard would be decoration.
      assert.match(
        view,
        /export function showsMockBilling/,
        'showsMockBilling is the gate that ties the invented rows to the demo flag',
      );
      assert.match(
        read('src/screens/SubscriptionScreen.tsx'),
        /showsMockBilling\(model, demoBuild\)/,
        'SubscriptionScreen must gate its billing rows on showsMockBilling',
      );
    },
  },
  {
    name: 'release: the free trial is back on before the app ships',
    run() {
      // The trial was switched off on purpose (2026-08-06) so the free tier
      // could be walked end to end — with it on, every new account is a Pro
      // account for the length of PRO_TRIAL_DAYS (a week then, fourteen days
      // since 2026-09-09) and nobody ever sees a lock.
      //
      // Shipping it that way would mean selling something no new user has
      // felt. Like the guard above, this one stays green on the demo and turns
      // red at exactly the release step: flip extra.demoBuild to false and
      // this names the switch that was left off.
      const entitlement = read('src/lib/proEntitlement.ts');
      const trialEnabled = /export const PRO_TRIAL_ENABLED = true;/.test(entitlement);
      const demoBuild = readJson('app.json')?.expo?.extra?.demoBuild === true;

      assert.ok(
        trialEnabled || demoBuild,
        'PRO_TRIAL_ENABLED is false and app.json no longer declares extra.demoBuild. ' +
          'The trial was switched off to inspect the free tier; turn it back on before release.',
      );

      // And while it is off, NOTHING may still promise it. Covering only the
      // onboarding paywall was the gap that let the Pro page keep advertising
      // "Start 7-day free trial" for a whole session after the switch flipped —
      // and the Pro page is where all twelve entry points lead. (The
      // onboarding paywall itself was deleted 2026-08-25 after going
      // unreachable, so the Pro page is the only CTA left to check.)
      if (!trialEnabled) {
        // v6 chooses the CTA through resolveTierCtaKey. Both halves are
        // checked, because either one alone can be true while the button still
        // lies: the screen must hand it the REAL flag, and the resolver must
        // be the only path to the trial wording.
        assert.match(
          read('src/screens/PremiumScreen.tsx'),
          /resolveTierCtaKey\(tier, PRO_TRIAL_ENABLED\)/,
          'The Pro page CTA no longer reads the trial flag, so it can promise a week it will not grant.',
        );
        assert.match(
          read('src/lib/proTiers.ts'),
          /trialEnabled && tier\.trialCtaKey \? tier\.trialCtaKey : tier\.ctaKey/,
          'resolveTierCtaKey stopped gating the trial wording on the flag.',
        );
        // And the same for the line under the button, which is where the
        // "then 79,90 €" promise actually lives.
        assert.match(
          read('src/screens/PremiumScreen.tsx'),
          /resolveTierFineKey\(tier, activePlan\.id, PRO_TRIAL_ENABLED\)/,
          'The fine print no longer reads the trial flag.',
        );
      }
    },
  },
  {
    name: 'release: nothing that needs a server ships pretending it has one',
    run() {
      // Two placeholders are allowed to exist while this is a demo, and both
      // become lies the moment it is not. Same shape as the paywall's invented
      // cohort: the flag is the permission slip, and this test is what makes
      // the permission expire.
      const demoBuild = readJson('app.json')?.expo?.extra?.demoBuild === true;

      // 1 · Trending. Social proof needs other people; this device only knows
      //     what its owner did. The invented counts went first, then the
      //     module: it returned null in every release build, so the section
      //     was never seen, and the brief's tab does not have it (2026-09-01).
      //     The strongest form of the old rule is that the file is gone.
      assert.ok(
        !fs.existsSync(path.join(ROOT, 'src', 'lib', 'programTrendingDemo.ts')),
        'the invented start counts are back',
      );
      assert.doesNotMatch(read('src/lib/i18n.ts'), /'programs\.trending/);

      // 1b · The paywall's three hero figures went for the same reason:
      //      "1,9x faster to a new PR" is an efficacy claim nobody measured.
      const i18nAll = read('src/lib/i18n.ts');
      assert.doesNotMatch(
        i18nAll,
        /'paywall\.stat[123]\.[vl]'/,
        'the paywall efficacy figures must stay deleted, not re-added behind a flag',
      );

      // 2 · "Continue with Google" and "Continue with Apple". Both currently
      //     call the same handler and sign nobody in. A user who presses one
      //     reasonably believes their data is now tied to that account; it is
      //     not, and a reinstall takes everything.
      const welcome = read('src/screens/WelcomeScreen.tsx');
      const providerHandlers = (welcome.match(/onPress=\{onContinue\}/g) ?? []).length;
      const providersAreDecorative = providerHandlers > 1;

      if (!demoBuild) {
        // Collected rather than thrown one at a time: on the day this fires,
        // the person reading it wants the whole list, not the first item and
        // another run to find the second.
        const problems = [];
        if (providersAreDecorative) {
          problems.push(
            'Welcome still routes both provider buttons to the same onContinue, so neither '
              + 'signs anyone in. Wire the providers to real identity, or take the buttons off '
              + 'the screen.',
          );
        }

        // A start counter is collection, and the privacy copy has to say so.
        //
        // This used to check for the sentence "We collect nothing", which was
        // then rewritten — leaving a clause that could never fire again. So it
        // now asserts the positive: if the row ships, the copy must NAME what
        // the counter takes. "Only what sign-in and competitions need" does
        // not cover it; a start counter is neither.
        const i18n = read('src/lib/i18n.ts');
        const analytics = i18n
          .split(String.fromCharCode(10))
          .filter((line) => line.includes("'settings.analytics.sub':"))
          .join(' ');
        const copyNamesStarts = /start|aloitu|popular|suositu/i.test(analytics);
        const rendersTrending = /trendingItems && trendingItems\.length > 0/.test(
          read('src/screens/ProgramsHomeScreen.tsx'),
        );
        if (rendersTrending && !copyNamesStarts) {
          problems.push(
            'The Programs tab renders a start counter and settings.analytics.sub does not '
              + 'mention it. A server-backed counter is collection: say so in the privacy '
              + 'copy and the policy, or drop the row.',
          );
        }

        assert.deepEqual(problems, [], problems.join(String.fromCharCode(10)));
      }
    },
  },
  {
    name: 'release: the paywall does not quote a study nobody ran',
    run() {
      // "1.9x faster to a new PR · 200+ decisions automated · +34% more volume,
      // n = 4,812" was a made-up cohort. The design it came from says so in its
      // own note ("Hero numbers are still placeholders").
      //
      // It used to hang off the demo flag and this test asserted that wiring.
      // That was the wrong bar: the demo build is the one a reader holds, so
      // "unreachable in a release build" made the claim unreachable by nobody.
      // The figures are deleted — and the screen that carried them
      // (ProPaywallScreen) followed on 2026-08-25, so what is left to guard
      // is the dictionary: the cohort citation lived there, not the screen,
      // and that is where it has to stay gone.
      assert.doesNotMatch(
        read('src/lib/i18n.ts'),
        /paywall\.cohort|n = 4/,
        'no cohort citation without a cohort',
      );
    },
  },
  {
    name: 'release: the sign-in backup keeps the promises the privacy policy makes',
    run() {
      // The privacy policy spent a year saying "no backend, no sync". Cloud
      // backup makes that conditional, and the policy has to say so in both
      // languages BEFORE a build with sign-in reaches anyone — the app.json
      // plugin is what makes such a build possible, so it is the trigger.
      const plugins = JSON.stringify(readJson('app.json')?.expo?.plugins ?? []);
      if (plugins.includes('@react-native-google-signin/google-signin')) {
        const legal = read('src/lib/legalDocuments.ts');
        assert.match(
          legal,
          /Cloud backup \(optional\)/,
          'app.json ships Google sign-in but the English privacy policy does not describe the cloud backup',
        );
        assert.match(
          legal,
          /Pilvivarmuuskopio \(vapaaehtoinen\)/,
          'app.json ships Google sign-in but the Finnish privacy policy does not describe the cloud backup',
        );
      }

      // And the endpoint must never trust a token without checking WHOSE
      // token it is: audience verification is what separates "a Google user"
      // from "a Google user of this app".
      const endpoint = read('api/backup.ts');
      assert.match(endpoint, /tokeninfo/, 'api/backup.ts must verify tokens against Google tokeninfo');
      assert.match(
        endpoint,
        /GOOGLE_WEB_CLIENT_ID/,
        'api/backup.ts must compare the token audience to GOOGLE_WEB_CLIENT_ID',
      );
      assert.doesNotMatch(
        endpoint,
        /console\.log/,
        'the backup endpoint must not log — payloads are training histories',
      );
    },
  },
  {
    name: 'release: the development transcript log is off before Play',
    run() {
      // This flag does not decide what transcripts/ keeps. The reader does,
      // and has since #92: a reader who ticked "keep a copy" has
      // a copy kept, with a 24-month sweep and a delete route behind it, and
      // that is a shipped feature that stays. What the flag still switches on
      // is development-only — the per-request effort and model overrides, and
      // api/transcripts.ts, which reads the folder back — and neither belongs
      // in a release. All of it was deleted on 2026-10-09, so this now holds
      // the line: nothing comes back. The folder also still holds entries the
      // development log wrote before #92 without asking; those are removed by
      // hand, by name (docs/play-data-safety.md §3), not here.
      const fs = require('node:fs');
      for (const gone of ['src/lib/aiCoachDebug.ts', 'api/transcripts.ts', 'scripts/coach-transcripts.cjs']) {
        assert.ok(
          !fs.existsSync(path.join(root, gone)),
          `${gone} is back. The development transcript reader and its switch were removed before release; `
            + 'leave the consented copies alone: the 24-month cron sweeps them and the Settings switch deletes them.',
        );
      }
      const endpoint = read('api/ai-coach.ts');
      for (const forbidden of ['AI_COACH_DEBUG_TRANSCRIPTS', 'effortOverride', 'modelOverride']) {
        assert.ok(
          !endpoint.includes(forbidden),
          `api/ai-coach.ts mentions ${forbidden}: a request must not choose the model or the effort in production.`,
        );
      }
    },
  },
  {
    name: 'release: live AI cannot ship before the spend cap is confirmed',
    run() {
      // The endpoint's request bounds and per-instance budget are brakes; the
      // only real ceiling on the bill is the usage limit set by hand in the
      // Anthropic Console. No test can see the Console, so the repo carries a
      // signature instead: AI_LIVE_SPEND_CAP_CONFIRMED in aiCoachLiveGate.ts.
      // While it is false, a release build ignores the live URL entirely —
      // which is only true as long as the client stays routed through the gate.
      const gate = read('src/lib/aiCoachLiveGate.ts');
      const flagMatch = gate.match(/export const AI_LIVE_SPEND_CAP_CONFIRMED = (true|false);/);
      assert.ok(
        flagMatch,
        'aiCoachLiveGate.ts must declare AI_LIVE_SPEND_CAP_CONFIRMED as a literal boolean — '
          + 'the constant is a human signature, not a computed value',
      );

      const client = read('src/lib/aiCoachClient.ts');
      assert.match(
        client,
        /resolveLiveAiCoachUrl\(\s*process\.env\.EXPO_PUBLIC_AI_COACH_API_URL/,
        'aiCoachClient must resolve its URL through resolveLiveAiCoachUrl; reading the env '
          + 'variable directly would let a misconfigured release build open the tap',
      );
      assert.equal(
        (client.match(/EXPO_PUBLIC_AI_COACH_API_URL/g) ?? []).length,
        1,
        'the env variable must be read exactly once, through the gate',
      );

      // A live URL committed to build config while the cap is unconfirmed is
      // the exact accident the gate exists for — name it here rather than let
      // the gate silently strip it in production.
      if (flagMatch[1] === 'false') {
        for (const candidate of ['.env', '.env.production', 'eas.json', 'app.json']) {
          const filePath = path.join(root, candidate);
          if (!fs.existsSync(filePath)) {
            continue;
          }
          assert.ok(
            !/EXPO_PUBLIC_AI_COACH_API_URL\s*[=:]\s*['"]?https?:\/\//.test(read(candidate)),
            `${candidate} points releases at a live coach URL, but AI_LIVE_SPEND_CAP_CONFIRMED `
              + 'is still false. Set the usage limit in the Anthropic Console first, then flip '
              + 'the constant (docs/ai-coach-backend.md, runbook step 1).',
          );
        }
      }
    },
  },
];
