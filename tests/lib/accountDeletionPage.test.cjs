const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { APPLE_DELETION_MARKER_DAYS, buildAccountDeletionPage } = require('../../src/lib/accountDeletionPage');
const { ANALYTICS_RETENTION_MONTHS } = require('../../src/lib/analyticsRetention');
const { t } = require('../../src/lib/i18n');
const { LEGAL_ENTITY, buildLegalDocument } = require('../../src/lib/legalDocuments');
const { WEB_DELETION_ENDPOINT } = require('../../src/lib/webAccountDeletion');

const root = path.join(__dirname, '..', '..');
const LANGUAGES = ['fi', 'en'];

const pageText = (page) =>
  [
    page.title,
    page.summary,
    ...page.sections.flatMap((s) => [s.heading, ...(s.steps ?? []), ...(s.body ?? []), ...(s.bullets ?? [])]),
    ...Object.values(page.web),
  ].join('\n');

const policyText = (language) =>
  buildLegalDocument('privacy', language)
    .sections.flatMap((s) => [...(s.body ?? []), ...(s.bullets ?? [])])
    .join('\n');

module.exports = [
  {
    name: 'account deletion page: deleting on the page comes first, the app second (Play: without the app)',
    run() {
      for (const language of LANGUAGES) {
        const page = buildAccountDeletionPage(language);
        assert.equal(page.sections[0].webDeletion, true, `${language}: the browser form is the first section`);
        assert.equal(page.sections.filter((s) => s.webDeletion).length, 1, `${language}: one form`);
        assert.ok(page.sections[1].steps?.length >= 3, `${language}: the app's steps follow`);
      }
    },
  },
  {
    name: 'account deletion page: the steps and the form name the buttons by the app’s own labels',
    run() {
      for (const language of LANGUAGES) {
        const page = buildAccountDeletionPage(language);
        const steps = page.sections.find((s) => s.steps).steps.join('\n');
        for (const key of ['tabs.profile', 'settings.title', 'account.deleteAccount']) {
          assert.ok(steps.includes(t(language, key)), `${language}: steps should name ${key} ("${t(language, key)}")`);
        }
        const dangerZone = t(language, 'settings.section.dangerZone');
        assert.ok(
          steps.toLocaleLowerCase().includes(dangerZone.toLocaleLowerCase()),
          `${language}: steps should name the ${dangerZone} section`,
        );
        const text = pageText(page);
        assert.ok(text.includes(t(language, 'settings.resetData')), `${language}: names Reset all data`);
        assert.ok(text.includes(t(language, 'account.deleteRemote')), `${language}: names Delete cloud backup`);
        assert.equal(page.web.confirmButton, t(language, 'account.deleteAccount'), `${language}: the form's button`);
        assert.ok(page.web.confirm.includes('{email}') && page.web.done.includes('{email}'), `${language}: names the account`);
      }
    },
  },
  {
    name: 'account deletion page: names the publisher and the privacy contact',
    run() {
      for (const language of LANGUAGES) {
        const text = pageText(buildAccountDeletionPage(language));
        assert.ok(text.includes(LEGAL_ENTITY.name), `${language}: publisher`);
        assert.ok(text.includes(LEGAL_ENTITY.email), `${language}: contact`);
      }
    },
  },
  {
    name: 'account deletion page: retention periods and the retry wait match the server and the privacy policy',
    run() {
      const backup = fs.readFileSync(path.join(root, 'api', 'backup.ts'), 'utf8');
      const serverDays = Number(/const APPLE_SESSION_DAYS = (\d+);/.exec(backup)?.[1]);
      assert.equal(APPLE_DELETION_MARKER_DAYS, serverDays, 'Apple marker days = api/backup.ts APPLE_SESSION_DAYS');
      const windowMs = /const RATE_LIMIT_WINDOW_MS = Number\(process\.env\.BACKUP_RATE_LIMIT_WINDOW_MS \?\? 10 \* 60 \* 1000\);/;
      assert.match(backup, windowMs, 'the form says "ten minutes": the rate-limit window must stay 10 minutes');
      for (const language of LANGUAGES) {
        const text = pageText(buildAccountDeletionPage(language));
        const unit = language === 'fi' ? 'kuukau' : 'months';
        assert.ok(text.includes(`${ANALYTICS_RETENTION_MONTHS} ${unit}`), `${language}: statistics retention`);
        assert.ok(text.includes(`${APPLE_DELETION_MARKER_DAYS} `), `${language}: Apple marker days`);
        const policy = policyText(language);
        assert.ok(policy.includes(`${ANALYTICS_RETENTION_MONTHS} ${unit}`), `${language}: policy states the same months`);
        assert.ok(policy.includes(`${APPLE_DELETION_MARKER_DAYS} `), `${language}: policy states the same days`);
        assert.ok(policy.includes(t(language, 'account.deleteAccount')), `${language}: policy names the same button`);
      }
    },
  },
  {
    name: 'account deletion page: Finnish and English have the same shape',
    run() {
      const [fi, en] = LANGUAGES.map(buildAccountDeletionPage);
      assert.equal(fi.sections.length, en.sections.length);
      fi.sections.forEach((section, i) => {
        for (const field of ['steps', 'body', 'bullets']) {
          assert.equal(section[field]?.length ?? 0, en.sections[i][field]?.length ?? 0, `section ${i} ${field}`);
        }
        assert.equal(Boolean(section.webDeletion), Boolean(en.sections[i].webDeletion), `section ${i} form`);
      });
      assert.deepEqual(Object.keys(fi.web).sort(), Object.keys(en.web).sort());
    },
  },
  {
    name: 'account deletion page: the built page carries the form, the client id and the endpoint',
    run() {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-site-'));
      try {
        execFileSync(process.execPath, [path.join(root, 'scripts', 'build-legal-site.cjs')], {
          env: { ...process.env, LEGAL_SITE_OUT_DIR: out, GOOGLE_WEB_CLIENT_ID: 'test-web-client</script>' },
          stdio: 'pipe',
        });
        for (const language of LANGUAGES) {
          const html = fs.readFileSync(path.join(out, `delete-account.${language}.html`), 'utf8');
          assert.ok(html.includes('https://accounts.google.com/gsi/client'), `${language}: loads Google sign-in`);
          assert.ok(html.includes(JSON.stringify(WEB_DELETION_ENDPOINT)), `${language}: sends to the endpoint`);
          assert.ok(html.includes('"action":"delete-account"'), `${language}: as Delete account`);
          assert.ok(html.includes('test-web-client\\u003c/script>'), `${language}: the client id, unable to close the tag`);
          assert.equal(html.split('</script>').length - 1, 2, `${language}: only the page's own two script tags close`);
          assert.ok(html.indexOf('id="gsi-button"') < html.indexOf('<ol>'), `${language}: the form before the app's steps`);
        }
        const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
        assert.ok(index.includes('delete-account.fi.html') && index.includes('delete-account.en.html'));
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    },
  },
  {
    // Bug hunt 5 (2026-10-03): the page said "removed after 180 days", the policy that the clean-up runs on an
    // Apple sign-in and can take a little longer (api/backup.ts sweeps only then). Both say the second now.
    name: 'account deletion page: the Apple marker is removed by the clean-up once its days have passed, which can take longer, as the policy says',
    run() {
      const backup = fs.readFileSync(path.join(root, 'api', 'backup.ts'), 'utf8');
      // The markers are swept from the Apple sign-in exchange alone, not on a timer: if a cron ever sweeps them, the
      // "can take a little longer" in both texts can go.
      assert.equal(backup.split('await purgeOldRevocations()').length - 1, 1, 'swept from one request path');
      const crons = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons ?? [];
      assert.ok(!crons.some((cron) => /backup/.test(cron.path)), 'no cron reaches the backup endpoint');
      const wording = {
        en: { page: /The server’s routine clean-up removes it once 180 days have passed; that clean-up runs when someone signs in with Apple, so it can take a little longer\./, policy: /removes it once 180 days have passed[^.]*\. That clean-up runs when someone signs in with Apple, so it can take a little longer\./ },
        fi: { page: /Palvelimen rutiinisiivous poistaa sen, kun 180 päivää on kulunut; siivous ajetaan, kun joku kirjautuu Applella, joten siinä voi mennä hieman pidempään\./, policy: /poistaa sen, kun 180 päivää on kulunut[^.]*\. Siivous ajetaan, kun joku kirjautuu Applella, joten siinä voi mennä hieman pidempään\./ },
      };
      for (const language of LANGUAGES) {
        const text = pageText(buildAccountDeletionPage(language));
        assert.match(text, wording[language].page, `${language}: the page`);
        assert.match(policyText(language), wording[language].policy, `${language}: the policy`);
        assert.ok(!/removed after \d+ days|poistuu \d+ päivän jälkeen/.test(text), `${language}: no flat "after N days"`);
      }
    },
  },
  {
    // Bug hunt 5 (2026-10-03): String.replace with a string reads $& and $' in the replacement as patterns, so
    // an address holding them (legal in an email's local part) was shown mangled in the confirm and done lines.
    name: 'account deletion page: the signed-in address is shown as it is, whatever characters it holds',
    async run() {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-site-'));
      try {
        execFileSync(process.execPath, [path.join(root, 'scripts', 'build-legal-site.cjs')], {
          env: { ...process.env, LEGAL_SITE_OUT_DIR: out, GOOGLE_WEB_CLIENT_ID: 'test-web-client' },
          stdio: 'pipe',
        });
        for (const language of LANGUAGES) {
          const html = fs.readFileSync(path.join(out, `delete-account.${language}.html`), 'utf8');
          const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
          const elements = {};
          const element = (id) =>
            (elements[id] ??= { id, hidden: false, disabled: false, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
          const page = {};
          const context = {
            window: page,
            document: { getElementById: element },
            atob: (text) => Buffer.from(text, 'base64').toString('binary'),
            TextDecoder,
            Uint8Array,
            JSON,
            google: { accounts: { id: { initialize(options) { page.signedIn = options.callback; }, renderButton() {} } } },
            fetch: () => Promise.resolve({ ok: true, status: 200 }),
          };
          vm.createContext(context);
          vm.runInContext(script, context);
          page.vinhaGoogleLoaded();
          const email = "a$&b$'c$`d$$e@example.com";
          page.signedIn({ credential: `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y` });
          assert.ok(elements['confirm-text'].textContent.includes(email), `${language}: confirm line ${elements['confirm-text'].textContent}`);
          elements['confirm-yes'].listeners.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.ok(elements.status.textContent.includes(email), `${language}: done line ${elements.status.textContent}`);
        }
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    },
  },
];
