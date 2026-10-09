const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  LEGAL_VERSION,
  buildLegalDocument,
  renderLegalDocumentMarkdown,
} = require('../../.test-dist/lib/legalDocuments.js');
const { compareLegalVersions } = require('../../.test-dist/lib/legalAcceptance.js');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/**
 * Every wording the documents have gone out with, oldest first, and the
 * version each went out under (LEGAL_VERSION, which acceptances are stored
 * against). Not a lock on the text — a record that makes a change of text
 * carry a new version, so every reader is asked again.
 *
 * A new wording is a new entry, and its version must be later than the one
 * before, so pasting the new hash under the old version fails. Until
 * 2026-10-05 the version was the date the documents show, which pushed that
 * date ahead of the calendar; they are two constants now (legalDocuments.ts).
 * The failing assertion prints what to write here.
 */
const LEGAL_TEXT_VERSIONS = [
  { version: '2026-09-16', fingerprint: 'c52c7814c8a7ba76' },
  { version: '2026-09-28', fingerprint: '7019c14a32fca330' },
  { version: '2026-09-29', fingerprint: 'c0f19e9dea408950' },
  { version: '2026-09-30', fingerprint: '5998cb9be6282a40' },
  { version: '2026-10-01', fingerprint: 'e3a2198516dc68a3' },
  { version: '2026-10-02', fingerprint: 'de881a6024122a47' },
  // From here the fingerprint covers all three renders (android, ios, both) in
  // both languages; the entries above hashed the 'both' text only.
  { version: '2026-10-03', fingerprint: 'e5d4d3139906bfd2' },
  // Error reports join the usage statistics (same switch, same retention).
  { version: '2026-10-04', fingerprint: '7444fcea5efd63d0' },
  // The crash screen's set-aside copy joins the bookkeeping line; account
  // deletion without the app, on the web page.
  { version: '2026-10-05', fingerprint: '75c46b9081ec08fb' },
  // The cookie line names the web deletion page's Google sign-in.
  { version: '2026-10-06', fingerprint: '4e2656f3346bf4e6' },
];

const IDS = ['privacy', 'terms'];
const LANGUAGES = ['en', 'fi'];

module.exports = [
  {
    name: 'both documents build in both languages with no empty sections',
    run() {
      for (const id of IDS) {
        for (const language of LANGUAGES) {
          const doc = buildLegalDocument(id, language);
          assert.equal(doc.id, id);
          assert.ok(doc.title.length > 3, `${id}/${language} needs a title`);
          assert.ok(doc.summary.length > 20, `${id}/${language} needs a summary`);
          assert.ok(doc.updatedLabel.includes(LEGAL_LAST_UPDATED.slice(0, 4)));
          assert.ok(doc.sections.length >= 8, `${id}/${language} is too thin`);
          for (const section of doc.sections) {
            assert.ok(section.heading.length > 2, `${id}/${language} empty heading`);
            const lines = [...(section.body ?? []), ...(section.bullets ?? [])];
            assert.ok(lines.length > 0, `${id}/${language} "${section.heading}" has no content`);
            for (const line of lines) {
              assert.ok(line.trim().length > 0, `${id}/${language} blank line`);
            }
          }
        }
      }
    },
  },
  {
    name: 'the two languages stay structurally parallel',
    run() {
      for (const id of IDS) {
        const en = buildLegalDocument(id, 'en');
        const fi = buildLegalDocument(id, 'fi');
        assert.equal(
          en.sections.length,
          fi.sections.length,
          `${id}: a section exists in one language only — a translated policy that omits a clause is not the same policy`,
        );
        en.sections.forEach((section, index) => {
          const other = fi.sections[index];
          assert.equal(
            (section.body ?? []).length,
            (other.body ?? []).length,
            `${id} section ${index} ("${section.heading}") has a different paragraph count in Finnish`,
          );
          assert.equal(
            (section.bullets ?? []).length,
            (other.bullets ?? []).length,
            `${id} section ${index} ("${section.heading}") has a different bullet count in Finnish`,
          );
        });
      }
    },
  },
  {
    name: 'every document carries the contact address and the publisher',
    run() {
      for (const id of IDS) {
        for (const language of LANGUAGES) {
          const text = renderLegalDocumentMarkdown(buildLegalDocument(id, language));
          assert.ok(text.includes(LEGAL_ENTITY.email), `${id}/${language} has no contact address`);
          assert.ok(text.includes(LEGAL_ENTITY.name), `${id}/${language} does not name the publisher`);
        }
      }
    },
  },
  {
    name: 'the terms carry the health warning in both languages',
    run() {
      const en = renderLegalDocumentMarkdown(buildLegalDocument('terms', 'en')).toLowerCase();
      const fi = renderLegalDocumentMarkdown(buildLegalDocument('terms', 'fi')).toLowerCase();
      // A fitness app that ships terms without these is a liability, not a document.
      for (const needle of ['not medical advice', 'doctor', 'own risk']) {
        assert.ok(en.includes(needle), `English terms are missing "${needle}"`);
      }
      for (const needle of ['ei ole lääketieteellistä', 'lääkär', 'omalla vastuullasi']) {
        assert.ok(fi.includes(needle), `Finnish terms are missing "${needle}"`);
      }
    },
  },
  {
    name: 'the privacy claims still match what the code does',
    run() {
      // Each of these is a factual claim in the policy. If the app grows a new
      // network call, an analytics SDK or a third storage key, this fails
      // before the policy becomes a lie.
      const srcFiles = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.tsx?$/.test(entry.name)) srcFiles.push(full);
        }
      };
      walk(path.join(root, 'src'));

      // Comments and copy are not call sites. A prose mention of the word
      // was enough to fail this with "update the policy or remove the call",
      // which is a confusing way to be told a sentence was worded badly.
      const isCallSite = (source) =>
        source
          .split(String.fromCharCode(10))
          .filter((line) => {
            const trimmed = line.trim();
            return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
          })
          .some((line) => /\bfetch\s*\(/.test(line));
      const fetchSites = srcFiles.filter((file) => isCallSite(fs.readFileSync(file, 'utf8')));
      assert.deepEqual(
        fetchSites.map((file) => path.basename(file)).sort(),
        ['aiCoachClient.ts', 'analyticsClient.ts', 'backupApi.ts', 'serverNoticeClient.ts'],
        'The policy names exactly four outbound request sites: the AI coach, the '
          + 'anonymous usage events, the optional cloud backup, and the notice check. '
          + 'Update the policy or remove the call.',
      );
      // The fourth is named in the policy, in both languages, as what it is.
      for (const language of LANGUAGES) {
        const policy = renderLegalDocumentMarkdown(buildLegalDocument('privacy', language));
        assert.match(
          policy,
          language === 'en' ? /At present that is four things/ : /Tällä hetkellä asioita on neljä/,
          `the ${language} policy must count the notice check among what the app sends`,
        );
        assert.match(
          policy,
          language === 'en' ? /whether there is a notice for everyone/ : /onko kaikille Vinhan käyttäjille tiedotetta/,
          `the ${language} policy must say what the notice check is`,
        );
      }

      const allSource = srcFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
      for (const banned of ['firebase', 'amplitude', 'mixpanel', 'segment.com', 'Sentry', 'AppsFlyer']) {
        assert.ok(
          !allSource.includes(banned),
          `The policy says there is no analytics or crash reporting, but ${banned} appears in src/`,
        );
      }

      // The live keys are @vinha/*. Two @gymlog/* constants also remain — the
      // pre-rename fallback that loadDatabase/loadWorkoutBundle read once — and
      // they are the same two stores, so they are not a third thing to declare.
      // Three live stores now: the training log, the workout in progress, and
      // the small preferences key a theme or language change writes on its own
      // rather than paying for the whole database. Plus the quarantine slot an
      // unreadable database is
      // moved to rather than deleted. The policy declares that one too, in
      // "Where it is stored" — it holds the reader's own data. The account
      // signed out of last is kept as its identifier alone, so the next
      // account to sign in is asked about the data it left (break round,
      // 2026-09-28); the cloud-backup paragraph says so.
      const keys = new Set(allSource.match(/@vinha\/[a-z0-9/]+/g) ?? []);
      assert.deepEqual(
        [...keys].sort(),
        [
          // The Apple session on iPhone (2026-10-01): the cloud-backup paragraph
          // says the phone keeps it.
          '@vinha/account/apple/v1',
          '@vinha/account/signedout/v1',
          '@vinha/account/v1',
          // An urgent error event raised before the usage queue had loaded
          // (2026-10-03): the same events as the queue, waiting to be sent, and
          // removed once folded into it. The queue line in the policy covers it.
          '@vinha/analytics/crash',
          '@vinha/analytics/v1',
          '@vinha/coach/memory/pendingerase/v1',
          '@vinha/coach/memory/v1',
          '@vinha/database/corrupt',
          '@vinha/database/v1',
          '@vinha/preferences/v1',
          // The workout in progress, put aside from the crash screen when the
          // reader asks (2026-10-03); the same bookkeeping line names it.
          '@vinha/workout/aside',
          // The workout bundle's own quarantine slot (2026-09-15). The same
          // "copy of a damaged data file" line in the policy covers it.
          '@vinha/workout/corrupt',
          '@vinha/workout/v1',
        ],
        'The policy declares these storage keys. A new one needs a line in "Where it is stored".',
      );
      // And the line itself, in both languages (break round, 2026-09-28).
      const policy = (language) => renderLegalDocumentMarkdown(buildLegalDocument('privacy', language));
      assert.match(policy('en'), /the phone keeps only the identifiers of the accounts that signed out of it/);
      assert.match(policy('fi'), /puhelin säilyttää vain niiden tilien tunnisteet, jotka ovat kirjautuneet siitä ulos/);
      assert.match(policy('en'), /a sign-in of our own, kept on the phone/);
      assert.match(policy('fi'), /omaksi kirjautumiseksemme, joka säilytetään puhelimessa/);
      const legacy = new Set(allSource.match(/@gymlog\/[a-z0-9/]+/g) ?? []);
      assert.deepEqual(
        [...legacy].sort(),
        ['@gymlog/database/v1', '@gymlog/workout/v1'],
        'The only pre-rename keys left should be the two migration fallbacks.',
      );
    },
  },
  {
    name: 'the usage-statistics switch is a real gate, and the policy says it exists',
    run() {
      // The old analytics row was a useState(true) that sent nothing, and it
      // was removed with the other explainer rows (user, 2026-07-29). Usage
      // events became real on 2026-08-25, and the switch came back on
      // 2026-09-04 as a real gate: Settings writes the preference, App.tsx
      // hands it to the client, and the client sends nothing until told and
      // drops its queue when told no. Each link is pinned here, because a
      // switch that writes a preference nobody reads is the old bug again.
      const settings = read('src/screens/SettingsScreen.tsx');
      assert.ok(!settings.includes('settings.analytics'), 'the old inert analytics row must stay dead');
      assert.match(settings, /usageStatisticsEnabled: next/, 'the usage-statistics switch must write the preference');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(
        app,
        /setUsageStatisticsEnabled\(preferences\.usageStatisticsEnabled\)/,
        'App.tsx must hand the preference to the analytics client',
      );
      const client = read('src/features/analytics/analyticsClient.ts');
      assert.match(client, /export function setUsageStatisticsEnabled/);
      // Sending is gated on an explicit yes, so nothing leaves before the
      // stored preference has been read.
      assert.match(client, /enabled !== true/, 'flush must refuse until the switch has been read');
      assert.match(client, /enabled === false/, 'trackEvent must queue nothing once the switch is off');
      // And the policy carries the fact and the switch, in both languages.
      const legal = read('src/lib/legalDocuments.ts');
      assert.match(legal, /No third-party analytics and no crash-reporting/);
      assert.match(legal, /Usage statistics/);
      assert.match(legal, /analytiikkaa/i);
      assert.match(legal, /Settings → Usage statistics/);
      assert.match(legal, /Asetukset → Käyttötilastot/);
    },
  },
  {
    name: 'no surface claims push notifications the app cannot send',
    run() {
      // The policy says notifications are scheduled locally and no device token
      // exists. Settings used to say "Push and reminders", which contradicted it.
      const i18n = read('src/lib/i18n.ts');
      // The Settings row and the master switch on the Notifications screen both
      // name the feature, so both have to stay honest about what it is.
      for (const key of ['settings.notifications.sub', 'notif.push']) {
        const line = i18n.split('\n').filter((row) => row.includes(`'${key}'`));
        assert.equal(line.length, 2, `expected an English and a Finnish value for ${key}`);
        for (const row of line) {
          // Only the value: the key itself is allowed to be called notif.push.
          const value = row.slice(row.indexOf(':') + 1);
          assert.ok(
            !/push/i.test(value),
            `"${row.trim()}" promises push notifications; the app schedules them locally`,
          );
        }
      }
    },
  },
  {
    name: 'every account surface is backed by the real sign-in, never a decorative one',
    run() {
      // Settings once carried "Sign out" and "Delete account" rows with
      // chevrons and no handler. Since 2026-08-22 the app HAS an account —
      // the optional Google sign-in that keys the cloud backup — so the guard
      // flips: account rows are allowed, but only wired through the real
      // feature and hidden in builds that cannot sign anyone in.
      const settings = read('src/screens/SettingsScreen.tsx');
      const referencesAccount = /account\.(signIn|signOut|backupNow|deleteRemote)/.test(settings);
      if (referencesAccount) {
        assert.ok(
          fs.existsSync(path.join(root, 'src', 'features', 'account', 'googleAuth.ts')),
          'Settings shows account rows but src/features/account/googleAuth.ts is gone — '
            + 'that is the decorative-buttons bug coming back.',
        );
        // The rows must be gated on the account prop, so a build without a
        // configured OAuth client shows nothing rather than a dead button.
        assert.match(
          settings,
          /\{account && /,
          'Account rows must render behind the account prop gate.',
        );
      }

      // The old fake keys stay dead either way; the real feature has its own.
      const i18n = read('src/lib/i18n.ts');
      for (const key of ['settings.signOut', 'settings.deleteAccount']) {
        assert.ok(
          !i18n.includes(`'${key}'`),
          `${key} is back. The account rows live under account.* and are gated on the real feature.`,
        );
      }
    },
  },
  {
    name: 'the CSV rows in settings reach a real importer and exporter',
    run() {
      // These two sat inert for months. Wired now: import opens the same paste
      // sheet the Programs tab uses, export shares the plan as CSV text.
      const settings = read('src/screens/SettingsScreen.tsx');
      assert.ok(settings.includes('onPress={onImportPlan}'), 'Import plan (CSV) does nothing again');
      assert.ok(settings.includes('onPress={onExportPlan}'), 'Export plan (CSV) does nothing again');

      // The row promised a download for months; there is no file to download.
      const i18n = read('src/lib/i18n.ts');
      const subs = i18n.split('\n').filter((row) => row.includes("'settings.exportCsv.sub'"));
      assert.equal(subs.length, 2, 'expected an English and a Finnish export subtitle');
      for (const row of subs) {
        assert.ok(
          !/download|lataa/i.test(row.slice(row.indexOf(':') + 1)),
          `"${row.trim()}" promises a download; the plan is shared as text.`,
        );
      }
    },
  },
  {
    name: 'both documents are reachable from settings and from the Pro page',
    run() {
      const settings = read('src/screens/SettingsScreen.tsx');
      assert.ok(settings.includes("onOpenLegal('privacy')"), 'Settings privacy row does not open anything');
      assert.ok(settings.includes("onOpenLegal('terms')"), 'Settings terms row does not open anything');

      const premium = read('src/screens/PremiumScreen.tsx');
      assert.ok(premium.includes("onOpenLegal('privacy')"), 'Pro page privacy link is inert text');
      assert.ok(premium.includes("onOpenLegal('terms')"), 'Pro page terms link is inert text');

      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.ok(app.includes('<LegalDocumentScreen'), 'The legal screen is never rendered');
      assert.ok(
        (app.match(/screen: 'legal', document/g) ?? []).length >= 2,
        'Both entry points must navigate to the legal route',
      );
    },
  },
  {
    name: 'a coach question carries no account identity, and the server will not take one',
    run() {
      // The policy says of a coach question: "The question cannot be tied to
      // you." For a while it could. A development field carried the signed-in
      // account's email with every request, and when the reader had allowed a
      // copy to be kept, the email was filed next to the question.
      //
      // Two halves, and the second is the one that mattered. The client sent
      // the field only while AI_COACH_DEBUG_TRANSCRIPTS was on, so flipping
      // that constant looked like the fix — but the endpoint accepted the
      // field from anyone, ungated, so an older install kept sending it and
      // the server kept writing it down. A gate on the sender is not a gate.
      //
      // Named fields rather than the word: `reporter` is ordinary English and
      // a comment explaining this is not a regression.
      const endpoint = read('api/ai-coach.ts');
      for (const forbidden of ['candidate.reporter', 'input.reporter', 'reporter:']) {
        assert.ok(
          !endpoint.includes(forbidden),
          `api/ai-coach.ts reads or writes ${forbidden}. The coach endpoint must not accept an account `
            + 'identity, whatever the client sends and whatever the debug flag says.',
        );
      }

      // The emails already in the store stay there on one condition: nothing
      // shows them to anyone (user decision, 2026-09-16). Since 2026-10-09
      // nothing reads the store back at all: the reader endpoint and its
      // script are gone (docs/play-data-safety.md §3), and no tool reads the field.
      for (const gone of ['api/transcripts.ts', 'scripts/coach-transcripts.cjs']) {
        assert.ok(!fs.existsSync(path.join(root, gone)), `${gone} is back: it read coach copies out of the store`);
      }
      assert.ok(!/\.reporter\b/.test(read('scripts/analytics-dashboard.cjs')), 'the dashboard reads the email field');

      // And nothing on the phone puts one into a coach request. The files are
      // found by what they import, not listed by hand: the composer and the
      // photo import build requests in files a hand-written list forgot.
      const sources = [path.join(root, 'App.tsx')];
      const walkSource = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkSource(full);
          else if (/\.tsx?$/.test(entry.name)) sources.push(full);
        }
      };
      walkSource(path.join(root, 'src'));
      const files = sources.map((full) => ({ file: path.relative(root, full), text: fs.readFileSync(full, 'utf8') }));

      // What a request carries is read too: the files that build the training
      // context, which since the phase-B split (2026-09-30) need not be the
      // ones that call the client. The shell's own build is looked for, so the
      // guard cannot quietly stop reading the context it hands the coach.
      const coachCallers = files.filter(
        ({ file, text }) => file.endsWith('aiCoachClient.ts') || /aiCoachClient'|aiTrainingContext'/.test(text),
      );
      assert.ok(
        coachCallers.length >= 3,
        `expected the coach client and at least two callers, found: ${coachCallers.map(({ file }) => file).join(', ')}`,
      );
      assert.ok(
        coachCallers.some(
          ({ file, text }) =>
            (file === 'App.tsx' || path.dirname(file) === path.join('src', 'app')) && text.includes('buildAiTrainingContext({'),
        ),
        'the shell file that builds the coach context is not among the files read',
      );
      for (const { file, text } of coachCallers) {
        assert.ok(
          !/transcriptReporter|reporter:/.test(text),
          `${file} attaches an account identity to a coach request`,
        );
      }

      // The chat screen is the one that was handed the email as a prop, so
      // every place it is rendered is read to the end of its element — the
      // line that closes it at the same indentation, so a nested `<Icon />`
      // inside a prop does not end the read early. And at least one render
      // must be found: a guard that finds nothing to look at passes forever.
      const renders = [];
      for (const { file, text } of files) {
        const lines = text.split(String.fromCharCode(10));
        lines.forEach((line, index) => {
          const open = line.match(/^(\s*)<AICoachChatScreen\b/);
          if (!open) return;
          const close = new RegExp(`^${open[1]}(/>|</AICoachChatScreen>)`);
          const end = lines.findIndex((candidate, at) => at > index && close.test(candidate));
          assert.ok(end > index, `${file}:${index + 1} — could not find where <AICoachChatScreen> closes`);
          renders.push({ file, line: index + 1, props: lines.slice(index, end).join(String.fromCharCode(10)) });
        });
      }
      assert.ok(renders.length > 0, 'AICoachChatScreen is rendered nowhere — this guard is looking in the wrong place');
      for (const { file, line, props } of renders) {
        assert.ok(
          !/email|reporter/i.test(props),
          `${file}:${line} hands an account identity to AICoachChatScreen under some prop name`,
        );
      }
    },
  },
  {
    name: 'the exported Markdown matches the in-app documents',
    run() {
      for (const id of IDS) {
        for (const language of LANGUAGES) {
          const file = path.join(root, 'docs', 'legal', `${id}.${language}.md`);
          assert.ok(fs.existsSync(file), `Missing export: run node scripts/export-legal.cjs`);
          // Line endings are git's business, not the document's: checked out on
          // Windows these files are CRLF and the renderer emits LF, so a
          // byte-for-byte comparison failed on every machine that has one —
          // which is a guard nobody can read, not a guard.
          assert.equal(
            fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
            renderLegalDocumentMarkdown(buildLegalDocument(id, language)),
            `docs/legal/${id}.${language}.md is stale — re-run node scripts/export-legal.cjs`,
          );
        }
      }
    },
  },
  {
    name: 'the online-coach notice and the policy disclose everything the context carries',
    run() {
      // The AI context grew the body record (weight, measurements) and the
      // profile (height, age, gender) on 2026-08-23, and for twelve days the
      // in-app notice and the policy went on saying "body measurements are
      // not sent". This pins the disclosure to the call site: whatever
      // App.tsx hands buildAiTrainingContext, the reader is told about, in
      // the notice they read before the first question and in the policy.
      //
      // The call site is the source of truth, not two hand-picked regexes:
      // every top-level key of the object App.tsx passes must be listed in
      // DISCLOSED below, and every listed key that carries something personal
      // must be named in both notices and both policies. A new input to the
      // coach therefore fails here until someone has decided what the reader
      // is told about it.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      const callStart = app.indexOf('buildAiTrainingContext({');
      assert.ok(callStart >= 0, 'App.tsx no longer builds the AI context — move this guard to wherever it went');
      // The literal closes on the first line that dedents back to `})`.
      const callEnd = app.indexOf('\n      })', callStart);
      assert.ok(callEnd > callStart, 'could not find the end of the buildAiTrainingContext call');
      const call = app.slice(callStart, callEnd);
      // Top-level keys sit at exactly eight spaces; nested keys and comments do not.
      const keys = [...call.matchAll(/^ {8}([a-zA-Z]+)[,:]/gm)].map((match) => match[1]);
      assert.ok(keys.length >= 10, `expected the call site's keys, got: ${keys.join(', ')}`);

      // What each input is, in the reader's words. null = nothing personal
      // (a unit, a count, a title, the state of the Home screen).
      const DISCLOSED = {
        unitPreference: null,
        activeWorkoutSummary: 'workouts',
        homeSummary: 'workouts',
        workoutSessions: 'workouts',
        // Runs and rides are workouts in the app's own words ("Cardio workouts").
        cardioSessions: 'workouts',
        exerciseLogs: 'workouts',
        trackedProgress: 'workouts',
        readyProgramCount: null,
        recommendedProgramId: null,
        recommendedProgramTitle: 'programme',
        customProgramTitle: 'programme',
        programme: 'programme',
        trainingDays: 'programme',
        schedule: 'programme',
        bodyweightEntries: 'weight',
        measurementEntries: 'measurements',
        coachGoals: 'goals',
        primaryGoalId: 'goals',
        bodyweightGoalKg: 'goals',
        profile: 'profile',
        homeState: null,
        plannerSetup: 'setup',
        // The body areas flagged in setup (2026-09-30): a setup answer.
        cautionFlags: 'setup',
        coachMemory: 'pastAdvice',
        // Computed from the logged workouts already sent: the set screen's next
        // targets for the last session's lifts (2026-09-27).
        nextSessionTargets: 'workouts',
      };
      const PHRASES = {
        workouts: { en: /recent workouts/, fi: /viimeaikaiset treenisi/ },
        programme: { en: /programme/, fi: /ohjelmasi/ },
        weight: { en: /latest weight/, fi: /viimeisin painosi/ },
        measurements: { en: /measurements/, fi: /mittasi/ },
        goals: { en: /goals/, fi: /tavoitteesi/ },
        profile: { en: /height, age and gender/, fi: /pituutesi, ikäsi ja sukupuolesi/ },
        setup: { en: /setup answers/, fi: /käyttöönoton vastauksesi/ },
        pastAdvice: {
          en: /answers from the last three weeks/,
          fi: /vastaukset viimeisiltä kolmelta viikolta/,
        },
      };
      const unknown = keys.filter((key) => !(key in DISCLOSED));
      assert.deepEqual(
        unknown,
        [],
        `new input(s) reach the coach: ${unknown.join(', ')} — add each to DISCLOSED here, and to `
          + 'coachChat.online.body and the privacy policy in both languages if it is personal',
      );

      // The notice value starts on the line after its key and ends where the
      // next key begins: two spaces of indent and a quote.
      const i18n = read('src/lib/i18n.ts');
      const notices = i18n
        .split("'coachChat.online.body':")
        .slice(1)
        .map((rest) => rest.split(/\n {2}'/)[0]);
      assert.equal(notices.length, 2, 'expected an English and a Finnish online-coach notice');
      const [noticeEn, noticeFi] = notices;
      const policyEn = renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'en'));
      const policyFi = renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'fi'));

      const required = new Set(keys.map((key) => DISCLOSED[key]).filter(Boolean));
      for (const item of required) {
        const { en, fi } = PHRASES[item];
        assert.match(noticeEn, en, `the English online notice must disclose ${item}`);
        assert.match(noticeFi, fi, `the Finnish online notice must disclose ${item}`);
        assert.match(policyEn, en, `the English privacy policy must disclose ${item}`);
        assert.match(policyFi, fi, `the Finnish privacy policy must disclose ${item}`);
      }
      // And the sentence that was untrue for twelve days stays gone.
      assert.doesNotMatch(noticeEn, /body measurements are not sent/, 'the old English notice is back');
      assert.doesNotMatch(noticeFi, /kehonmittojasi ei lähetetä/, 'the old Finnish notice is back');
    },
  },
  {
    name: 'the policy names its processors in both languages',
    run() {
      // Four companies touch data on our behalf. A policy that loses one of
      // them by accident is the kind of omission a regulator reads as hiding.
      // Checked on the rendered document per language, not the source: the
      // file's header comment names the same companies and must not count.
      for (const language of LANGUAGES) {
        const text = renderLegalDocumentMarkdown(buildLegalDocument('privacy', language));
        for (const processor of ['Anthropic', 'Vercel', 'Google', 'Slack']) {
          assert.ok(text.includes(processor), `${processor} is missing from the ${language} privacy policy`);
        }
      }
    },
  },
  {
    name: 'the terms quote the free limits the code enforces',
    run() {
      // The terms say what Free is in numbers, so a reader knows what they
      // are buying out of. Each number is a constant in src/lib; change the
      // constant and this points at the two sentences to change with it.
      const { FREE_CUSTOM_PROGRAM_LIMIT } = require('../../.test-dist/lib/programSlots.js');
      const { FREE_ACTIVE_PROGRAM_CAP } = require('../../.test-dist/lib/activeProgramSet.js');
      const { FREE_TREND_MONTHS } = require('../../.test-dist/lib/historyWindow.js');
      assert.equal(FREE_CUSTOM_PROGRAM_LIMIT, 3, 'the terms say "three programmes of your own" — update the Pro section in both languages');
      assert.equal(FREE_ACTIVE_PROGRAM_CAP, 2, 'the terms say "two in use at a time" — update the Pro section in both languages');
      assert.equal(FREE_TREND_MONTHS, 3, 'the terms say "the most recent three months" — update the Pro section in both languages');
      const en = renderLegalDocumentMarkdown(buildLegalDocument('terms', 'en'));
      const fi = renderLegalDocumentMarkdown(buildLegalDocument('terms', 'fi'));
      assert.match(en, /three programmes of your own, two in use at a time/);
      assert.match(en, /most recent three months/);
      assert.match(fi, /kolme omaa ohjelmaa, kaksi käytössä kerrallaan/);
      assert.match(fi, /viimeisimmän kolmen kuukauden/);
    },
  },
  {
    name: 'the policy tells the truth about Android’s own backup',
    run() {
      // #117 switched allowBackup off and left the policy saying it was on,
      // in the direction that costs a reader their history: "this is the only
      // way your history survives changing phones" was, by then, describing a
      // channel the app had just closed. The flag has its own guard in
      // tests/lib/allowBackup.test.cjs; this one ties the flag to the two
      // places the document makes a promise about it, so flipping it back on
      // cannot leave either one behind.
      //
      // Read the way Expo reads it. Android's default is on, so a missing key
      // means on — comparing the raw value with `=== true` read a deleted line
      // as off and kept demanding the "switched off" wording (review, #127).
      const { AndroidConfig } = require('@expo/config-plugins');
      const allowBackup = AndroidConfig.AllowBackup.getAllowBackup(JSON.parse(read('app.json')).expo);
      const expected = allowBackup
        ? {
            en: [/Android’s own backup is switched on/, /Android backup: as long as your Google account keeps it/],
            fi: [/varmuuskopiointi on tälle sovellukselle päällä/, /Android-varmuuskopio: niin kauan kuin/],
          }
        : {
            en: [/Android’s own backup is switched off/, /Android backup: nothing to keep/],
            fi: [/varmuuskopiointi on tälle sovellukselle pois päältä/, /Android-varmuuskopio: ei mitään säilytettävää/],
          };
      for (const language of LANGUAGES) {
        const text = renderLegalDocumentMarkdown(buildLegalDocument('privacy', language));
        for (const pattern of expected[language]) {
          assert.match(
            text,
            pattern,
            `app.json says android.allowBackup=${allowBackup}, and the ${language} privacy policy still says otherwise. `
              + 'Both the Android backup section and the retention list have to agree with the flag.',
          );
        }
      }
    },
  },
  {
    name: 'each phone is told about its own store and backup, and the published documents name both',
    run() {
      // #261/#262 gave an iPhone Apple's sign-in and Apple's subscription
      // screen and left the legal text saying "Google Play" and "Android's
      // own backup" — payment, cancelling, refunds, rating, the backup. The
      // document is built for a platform now, and each one is held to
      // naming only its own.
      const text = (id, language, platform) => renderLegalDocumentMarkdown(buildLegalDocument(id, language, platform));
      // The one place the other platform is named on purpose: what the app
      // reports with each request, which is the same on both.
      const withoutRequestNote = (value) => value.replace('whether the phone runs Android or iOS', '').replace('onko puhelin Android vai iOS', '');

      for (const id of IDS) {
        for (const language of LANGUAGES) {
          const ios = withoutRequestNote(text(id, language, 'ios'));
          assert.doesNotMatch(
            ios,
            /Google Play|Playssä|Playn|Playst|Android/,
            `the iPhone ${language} ${id} still talks about Google Play or Android`,
          );
          const android = text(id, language, 'android');
          assert.doesNotMatch(android, /App Store|iCloud|App Storen|App Storessa/, `the Android ${language} ${id} talks about Apple's store or backup`);
        }
      }

      // Each says what it is the store: the payment line in both documents.
      assert.match(text('privacy', 'en', 'ios'), /handled entirely by Apple, through the App Store/);
      assert.match(text('privacy', 'fi', 'ios'), /maksun hoitaa kokonaan Apple App Storen kautta/);
      assert.match(text('privacy', 'en', 'android'), /handled entirely by Google Play\./);
      assert.match(text('terms', 'en', 'ios'), /Cancel in your Apple ID’s subscriptions/);
      assert.match(text('terms', 'fi', 'ios'), /Peruuta Apple ID:si tilauksissa/);
      assert.match(text('terms', 'en', 'ios'), /Refunds follow Apple’s refund policy/);
      assert.match(text('terms', 'en', 'android'), /Cancel in Google Play/);
      assert.match(text('terms', 'en', 'ios'), /If a price changes, you will be told in advance through Apple/);
      assert.match(text('privacy', 'en', 'ios'), /Rate Vinha opens Apple’s review prompt/);
      assert.match(text('privacy', 'fi', 'ios'), /Arvioi Vinha avaa Applen arviointikehotteen/);
      assert.match(text('privacy', 'en', 'ios'), /Apple handles the payment for Pro/);

      // The published ones, for the website and the store listings, cover both.
      for (const language of LANGUAGES) {
        for (const id of IDS) {
          const published = text(id, language);
          assert.equal(published, text(id, language, 'both'));
          assert.match(published, /Google Play/, `the published ${language} ${id} dropped Google Play`);
          assert.match(published, /App Store/, `the published ${language} ${id} says nothing of the App Store`);
        }
      }
      assert.match(text('terms', 'en'), /Google Play on Android and through the App Store on iPhone/);
      assert.match(text('terms', 'en'), /Cancel in Google Play on Android, or in your Apple ID’s subscriptions on iPhone/);

      // All three keep the two languages the same document.
      for (const platform of ['android', 'ios', 'both']) {
        for (const id of IDS) {
          const en = buildLegalDocument(id, 'en', platform);
          const fi = buildLegalDocument(id, 'fi', platform);
          assert.equal(en.sections.length, fi.sections.length, `${platform} ${id}: a section exists in one language only`);
          en.sections.forEach((section, index) => {
            assert.equal((section.body ?? []).length, (fi.sections[index].body ?? []).length, `${platform} ${id} "${section.heading}" paragraphs`);
            assert.equal((section.bullets ?? []).length, (fi.sections[index].bullets ?? []).length, `${platform} ${id} "${section.heading}" bullets`);
          });
        }
      }
    },
  },
  {
    name: 'the policy tells an iPhone reader about the phone’s own backup, and the Android section stays Android’s',
    run() {
      // app.json's android.allowBackup=false and plugins/withDataExtractionRules.js
      // keep Vinha out of Android's backup. Nothing does on iOS: AsyncStorage's
      // files go into an iCloud or computer backup like any other app's, and
      // the policy used to say nothing — a reader who thought "no backup"
      // was wrong the other way. Excluding it natively would be the
      // alternative (isExcludedFromBackup on the storage directory); until
      // then the text says what is true.
      const policy = (language, platform) => renderLegalDocumentMarkdown(buildLegalDocument('privacy', language, platform));
      for (const platform of ['ios', 'both']) {
        assert.match(policy('en', platform), /## iPhone backup/);
        assert.match(policy('en', platform), /If iCloud Backup is switched on, or you back the phone up to a computer, Vinha’s data goes into that backup/);
        assert.match(policy('en', platform), /We do not make it, cannot see it and cannot delete it/);
        assert.match(policy('en', platform), /iPhone backup: if iCloud Backup or a computer backup is switched on/);
        assert.match(policy('fi', platform), /## iPhonen varmuuskopio/);
        assert.match(policy('fi', platform), /Jos iCloud-varmuuskopiointi on päällä tai varmuuskopioit puhelimen tietokoneelle/);
        assert.match(policy('fi', platform), /Emme tee sitä, emme näe sitä emmekä voi poistaa sitä/);
        assert.match(policy('fi', platform), /iPhonen varmuuskopio: jos iCloud-varmuuskopiointi/);
      }
      // An iPhone is not told Android's backup is off, and an Android phone is not told about iCloud.
      assert.doesNotMatch(policy('en', 'ios'), /## Android backup|switched off for this app/);
      assert.doesNotMatch(policy('en', 'android'), /## iPhone backup/);
      assert.match(policy('en', 'android'), /## Android backup/);
      assert.match(policy('en', 'both'), /## Android backup/);
      assert.match(policy('fi', 'ios'), /iOS:n sovellusten välinen eristys/);
    },
  },
  {
    name: 'the policy describes Delete account the way the endpoint and the app do it',
    run() {
      // api/backup.ts `delete-account`: the copy is deleted, then one marker
      // (revoked/<hash>.json) ends sessions issued before it. No name, email
      // or training data, and nothing removes it by itself — each of those
      // is a sentence in the policy, in both languages.
      const server = read('api/backup.ts');
      // The marker is a date and, when the phone sent one, the random id of the request (x-delete-request-id,
      // 32 hex characters validated server-side): a field added beyond those is a field the policy does not describe.
      assert.match(
        server,
        /JSON\.stringify\(\{\s*revokedAtMs: Date\.now\(\),\s*\.\.\.\(requestId && DELETE_REQUEST_ID\.test\(requestId\) \? \{ deleteRequestId: requestId \} : \{\}\),\s*\}\)/,
        'the revocation marker is more than a date and the request id now',
      );
      // The policy says the server's clean-up removes it after 180 days: the code has to.
      assert.match(server, /const REVOCATION_KEPT_MS = \(APPLE_SESSION_DAYS \+ 1\) \* 24 \* 60 \* 60 \* 1000;/);
      assert.match(server, /await purgeOldRevocations\(\);\s*res\.status\(200\)\.json\(\{ ok: true, \.\.\.issueAppleSession\(apple\.sub/, 'sign-ins no longer sweep old markers');
      assert.match(server, /async function purgeOldRevocations/);
      // …and only on a sign-in: the deletion answers a phone that is waiting under a timeout, so it does not sweep (the policy says so).
      const deleteBranch = server.slice(server.indexOf("if (req.method === 'DELETE')"), server.indexOf('res.status(405)'));
      assert.doesNotMatch(deleteBranch, /purgeOldRevocations/, 'the deletion sweeps again — the policy says the clean-up runs on Apple sign-ins');
      // The Finnish lifetime purchase is not a "tilaus": no rewrite of the store sentences may say the reader bought one.
      for (const platform of ['both', 'android', 'ios']) {
        const terms = renderLegalDocumentMarkdown(buildLegalDocument('terms', 'fi', platform));
        assert.doesNotMatch(terms, /josta ostit tilauksen/, `the ${platform} Finnish terms treat every Pro purchase as a subscription`);
      }
      for (const platform of ['android', 'ios', 'both']) {
        const en = renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'en', platform));
        const fi = renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'fi', platform));
        assert.match(en, /Settings → Delete account does the same and more: it deletes the server copy, signs you out on this phone/);
        assert.match(en, /one scrambled marker with a date/);
        assert.match(en, /It also holds a random number your phone made for that request, used only to tell that phone its deletion went through/);
        assert.match(en, /one scrambled marker with a date and a random number your phone made for the deletion request/);
        assert.match(en, /The server’s routine clean-up removes it once 180 days have passed/);
        assert.match(en, /That clean-up runs when someone signs in with Apple, so it can take a little longer/);
        assert.doesNotMatch(en, /write to us and we delete it/, 'the policy promises a deletion on request that nobody can perform — the marker has no email on it');
        assert.match(en, /your other phones signed in with Apple are signed out at their next request to our server, and a sign-in made with Apple before the deletion can no longer be used to start a new one/);
        assert.match(en, /asks our server to delete any copies the AI coach kept for you/);
        assert.match(en, /does not delete them; they are kept for up to 24 months/);
        assert.doesNotMatch(en, /Afterwards our server holds nothing of yours except/, 'the usage events are not deleted with the account, so "nothing" is too broad');
        assert.match(en, /Settings → Reset all data deletes everything on this phone and signs you out\. It keeps the cloud backup, .* and it keeps your answer about usage statistics/);
        assert.match(en, /does not take Vinha off the list of apps you use Sign in with Apple with/);
        assert.match(fi, /Asetukset → Poista tili tekee saman ja enemmän/);
        assert.match(fi, /yksi sekoitettu merkintä päivämäärineen/);
        assert.match(fi, /Siinä on myös satunnainen luku, jonka puhelimesi teki tätä pyyntöä varten ja jota käytetään vain kertomaan sille puhelimelle, että poisto onnistui/);
        assert.match(fi, /yksi sekoitettu merkintä päivämäärineen sekä satunnainen luku, jonka puhelimesi teki poistopyyntöä varten/);
        assert.match(fi, /Palvelimen rutiinisiivous poistaa sen, kun 180 päivää on kulunut/);
        assert.match(fi, /Siivous ajetaan, kun joku kirjautuu Applella, joten/);
        assert.doesNotMatch(fi, /Sitä ei poisteta automaattisesti/);
        assert.match(fi, /muut Applella kirjautuneet puhelimesi kirjautuvat ulos seuraavalla pyynnöllään palvelimellemme, eikä ennen poistoa Applella tehdyllä kirjautumisella voi enää aloittaa uutta/);
        assert.match(fi, /pyytää palvelintamme poistamaan kaikki kopiot, jotka AI-valmentaja on säilyttänyt sinusta/);
        assert.match(fi, /tilin poistaminen ei poista niitä; ne säilyvät enintään 24 kuukautta/);
        assert.doesNotMatch(fi, /Sen jälkeen palvelimellamme ei ole sinusta mitään/, 'käyttötilastot eivät poistu tilin mukana, joten "ei mitään" on liian laaja');
        assert.match(fi, /Asetukset → Nollaa kaikki tiedot poistaa kaiken tästä puhelimesta ja kirjaa sinut ulos\. Se säilyttää pilvivarmuuskopion, .* ja säilyttää valintasi käyttötilastoista/);
        assert.match(fi, /ei poista Vinhaa luettelosta sovelluksista, joissa käytät Apple-kirjautumista/);
      }
      // The providers: no number in the sentence that drifted from the list (it said three beside five).
      for (const language of LANGUAGES) {
        const text = renderLegalDocumentMarkdown(buildLegalDocument('privacy', language));
        assert.doesNotMatch(text, /three providers named above|kolmea yllä nimettyä/, `the ${language} policy counts the providers wrongly again`);
      }
      assert.match(renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'en')), /beyond the providers named above who work for us/);
      assert.match(renderLegalDocumentMarkdown(buildLegalDocument('privacy', 'fi')), /lukuun ottamatta yllä nimettyjä palveluntarjoajia/);
      // The Finnish price-change sentence reads as a sentence.
      assert.match(renderLegalDocumentMarkdown(buildLegalDocument('terms', 'fi')), /saat siitä tiedon etukäteen sovelluskaupan kautta, josta ostit \(Google Play tai App Store\), eikä muutos/);
      // The row the policy names exists, under the name it uses.
      const i18n = read('src/lib/i18n.ts');
      assert.match(i18n, /'account\.deleteAccount': 'Delete account'/);
      assert.match(i18n, /'account\.deleteAccount': 'Poista tili'/);
      // The confirmation names the Apple consequence only in its own, Apple-only, key.
      for (const [message, apple] of [
        [/'account\.deleteAccount\.message':\s*'([^']*)'/g, false],
        [/'account\.deleteAccount\.message\.apple':\s*'([^']*)'/g, true],
      ]) {
        const found = [...i18n.matchAll(message)].map((match) => match[1]);
        assert.equal(found.length, 2, 'an English and a Finnish confirmation each');
        for (const text of found) {
          assert.equal(/Apple/.test(text), apple, `a confirmation ${apple ? 'for Apple readers lost' : 'for everyone else carries'} the Apple sentence`);
        }
      }
    },
  },
  {
    name: 'a new wording goes out under a new date',
    run() {
      // The policy promises that "the date at the top always tells you which
      // version you are reading". Nothing enforced it: #92 rewrote the whole
      // coach-consent section on 11 September and #118 dropped the promo
      // paragraph on the 15th, both under a document still dated the 5th, and
      // both published to the public page by the legal-pages workflow.
      //
      // The first version of this guard kept one hash and only named the date
      // in its message, so pasting the new hash under the stale date went
      // green (review, #127). The record is a history now, and the date is
      // part of what has to match: a new entry must be later than the last,
      // and the last must be the date the documents show. The one way left to
      // keep a stale date is to overwrite a past entry, which is what a
      // same-day edit does and what a reviewer can see in the diff.
      //
      // Everything the reader sees except one field. updatedLabel is derived
      // from the date, so hashing it would let a bump satisfy this guard
      // without anyone reading what changed. The first version hashed the
      // sections alone and missed the title and summary, which live in a
      // separate map and are published on the same page (review, #127) — so
      // the one field is named and taken out, and anything added to a
      // document later is covered without anyone remembering to list it.
      //
      // Every render a reader can get: the website's 'both', and the two
      // platform-only texts the app shows on a phone. The first version of the
      // record hashed 'both' alone, so a line that exists only in the iOS or
      // only in the Android text (the `pick` wordings, the platform-only
      // sections) could change with no new date — and no re-acceptance for the
      // readers of that platform, who never see the 'both' wording.
      const PLATFORMS = ['android', 'ios', 'both'];
      const payload = PLATFORMS.flatMap((platform) =>
        IDS.flatMap((id) =>
          LANGUAGES.map((language) => {
            const { updatedLabel, ...wording } = buildLegalDocument(id, language, platform);
            return JSON.stringify(wording);
          }),
        ),
      ).join(String.fromCharCode(10));
      const fingerprint = require('node:crypto').createHash('sha256').update(payload).digest('hex').slice(0, 16);

      assert.ok(LEGAL_TEXT_VERSIONS.length > 0, 'LEGAL_TEXT_VERSIONS is empty');
      for (let index = 1; index < LEGAL_TEXT_VERSIONS.length; index += 1) {
        const before = LEGAL_TEXT_VERSIONS[index - 1];
        const after = LEGAL_TEXT_VERSIONS[index];
        assert.ok(
          compareLegalVersions(after.version, before.version) > 0,
          `LEGAL_TEXT_VERSIONS: the entry for ${after.version} is not later than the one for ${before.version}. `
            + 'A new wording needs a new LEGAL_VERSION in src/lib/legalDocuments.ts (a second change on one day: '
            + 'the same day with a ".1", ".2" suffix).',
        );
      }

      const current = LEGAL_TEXT_VERSIONS[LEGAL_TEXT_VERSIONS.length - 1];
      assert.equal(
        fingerprint,
        current.fingerprint,
        `The legal wording changed (the last recorded version is ${current.version}). `
          + 'Set LEGAL_LAST_UPDATED to today and LEGAL_VERSION past the current one in src/lib/legalDocuments.ts, '
          + 're-run node scripts/export-legal.cjs, and add '
          + `{ version: '<the new LEGAL_VERSION>', fingerprint: '${fingerprint}' } to the end of LEGAL_TEXT_VERSIONS.`,
      );
      assert.equal(
        LEGAL_VERSION,
        current.version,
        `LEGAL_VERSION is ${LEGAL_VERSION}, but the last recorded wording is ${current.version}. `
          + 'The version and the record move together: a bumped version without a changed wording asks every '
          + 'reader again about nothing, and a recorded wording under another version is never asked about.',
      );
      // The date the reader is shown is a real one: never past the version it
      // belongs to, and never ahead of the calendar — the sheet said "changed
      // on 6.10.2026" on the 5th (bug hunt, 2026-10-05).
      assert.match(LEGAL_LAST_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(
        LEGAL_LAST_UPDATED <= LEGAL_VERSION.slice(0, 10),
        `LEGAL_LAST_UPDATED ${LEGAL_LAST_UPDATED} is past LEGAL_VERSION ${LEGAL_VERSION}`,
      );
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      assert.ok(
        LEGAL_LAST_UPDATED <= today,
        `LEGAL_LAST_UPDATED is ${LEGAL_LAST_UPDATED}, after today (${today}): the documents would say they changed on a day that has not come.`,
      );
    },
  },
  {
    // Bug hunt 5 (2026-10-03): the policy said "No cookies. The app is not a web page", while the web page for
    // deleting an account without the app loads Google's sign-in script, which can set and read Google's cookies.
    // Every script the published pages load from another site is one the policy has to account for.
    name: 'privacy policy: what the published pages load from other sites is what its cookie line names',
    run() {
      // Scripts, stylesheets, fonts and other resources the pages fetch, not links a reader follows. styxon.fi is ours.
      const site = read('scripts/build-legal-site.cjs');
      const fetched = [...site.matchAll(/<(?:script|link|img|iframe)\b[^>]*\s(?:src|href)="https:\/\/([^/"]+)/g)].map((match) => match[1]);
      const hosts = [...new Set(fetched)].filter((host) => host !== 'styxon.fi');
      assert.deepEqual(hosts, ['accounts.google.com'], 'something new loaded from another site on the legal pages: say in the cookie line what it does');
      assert.match(site, /src: url\('fonts\/Manrope\.ttf'\)/, 'the font is served beside the pages, not fetched from a font service');
      const said = {
        en: /No cookies in the app\. [^']*Our web pages set none either\. On the page for deleting an account without the app \(above\), the Sign in with Google button is Google’s own, loaded from Google when the page opens, and Google can set and read its own cookies for that sign-in/,
        fi: /Ei evästeitä sovelluksessa\. [^']*Myöskään verkkosivumme eivät aseta niitä\. Yllä mainitulla sivulla, jolla tilin voi poistaa ilman sovellusta, Kirjaudu Googlella -painike on Googlen oma ja ladataan Googlelta, kun sivu avautuu, ja Google voi asettaa ja lukea kirjautumista varten omia evästeitään/,
      };
      for (const platform of ['android', 'ios', 'both']) {
        for (const language of LANGUAGES) {
          const text = buildLegalDocument('privacy', language, platform)
            .sections.flatMap((section) => [...(section.body ?? []), ...(section.bullets ?? [])])
            .join('\n');
          assert.match(text, said[language], `${platform}/${language}`);
          // "above": the page is named before the cookie line, with the address it is at.
          assert.ok(text.indexOf('legal/delete-account.') > -1 && text.indexOf('legal/delete-account.') < text.search(said[language]), `${platform}/${language}: the page is named above`);
        }
      }
    },
  },
];
