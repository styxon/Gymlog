const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const {
  MAX_SEEN_NOTICE_IDS,
  SERVER_NOTICE_RECHECK_MS,
  SERVER_NOTICE_RETRY_MS,
  SERVICE_PAUSED,
  isServicePaused,
  normalizeSeenNoticeIds,
  parseServerNotice,
  rememberServerNotice,
  serverNoticeFromEnv,
  serverNoticeText,
  serverNoticeUrl,
  servicePausedBody,
  shouldCheckServerNotice,
  unseenServerNotice,
} = require('../../src/lib/serverNotice');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const NOTICE = {
  id: '2026-11-03-backup',
  fi: { title: 'Varmuuskopio tauolla', body: 'Pilvivarmuuskopio on pois käytöstä tarkistuksen ajan.' },
  en: { title: 'Backup paused', body: 'Cloud backup is off while we check something.' },
};

module.exports = [
  {
    name: 'server notice: both languages or none, trimmed and bounded',
    run() {
      assert.deepEqual(parseServerNotice(NOTICE), NOTICE);
      assert.deepEqual(
        parseServerNotice({ ...NOTICE, id: '  x  ', fi: { title: ' T ', body: ' B ' } }),
        { id: 'x', fi: { title: 'T', body: 'B' }, en: NOTICE.en },
      );
      // Half a notice would show one language's reader nothing, or the other
      // language: it is no notice at all.
      assert.equal(parseServerNotice({ ...NOTICE, en: undefined }), null);
      assert.equal(parseServerNotice({ ...NOTICE, fi: { title: 'T', body: '' } }), null);
      assert.equal(parseServerNotice({ ...NOTICE, id: '' }), null);
      assert.equal(parseServerNotice({ ...NOTICE, id: 'x'.repeat(65) }), null);
      assert.equal(parseServerNotice({ ...NOTICE, en: { title: 'x'.repeat(81), body: 'B' } }), null);
      assert.equal(parseServerNotice(null), null);
      assert.equal(parseServerNotice('notice'), null);

      assert.deepEqual(serverNoticeText(NOTICE, 'fi'), NOTICE.fi);
      assert.deepEqual(serverNoticeText(NOTICE, 'en'), NOTICE.en);
    },
  },
  {
    name: 'server notice: the environment says it, and a variable that does not parse says nothing',
    run() {
      assert.deepEqual(serverNoticeFromEnv({ APP_NOTICE: JSON.stringify(NOTICE) }), NOTICE);
      assert.equal(serverNoticeFromEnv({}), null);
      assert.equal(serverNoticeFromEnv({ APP_NOTICE: '' }), null);
      assert.equal(serverNoticeFromEnv({ APP_NOTICE: '{not json' }), null);
      assert.equal(serverNoticeFromEnv({ APP_NOTICE: JSON.stringify({ id: 'x' }) }), null);

      assert.equal(isServicePaused({ SERVICE_PAUSED: '1' }), true);
      assert.equal(isServicePaused({ SERVICE_PAUSED: ' 1 ' }), true);
      assert.equal(isServicePaused({ SERVICE_PAUSED: '0' }), false);
      assert.equal(isServicePaused({ SERVICE_PAUSED: 'true' }), false);
      assert.equal(isServicePaused({}), false);
      assert.deepEqual(servicePausedBody(), { ok: false, error: SERVICE_PAUSED });
    },
  },
  {
    name: 'server notice: shown once per id, remembered newest last, capped',
    run() {
      assert.deepEqual(unseenServerNotice(NOTICE, []), NOTICE);
      assert.equal(unseenServerNotice(NOTICE, [NOTICE.id]), null);
      assert.equal(unseenServerNotice(null, []), null);

      assert.deepEqual(rememberServerNotice(['a', 'b'], 'a'), ['b', 'a']);
      const many = Array.from({ length: MAX_SEEN_NOTICE_IDS }, (_, index) => `n${index}`);
      const after = rememberServerNotice(many, 'new');
      assert.equal(after.length, MAX_SEEN_NOTICE_IDS);
      assert.equal(after[after.length - 1], 'new');
      assert.equal(after.includes('n0'), false);

      assert.deepEqual(normalizeSeenNoticeIds(['a', '', 5, null, 'x'.repeat(65), 'b']), ['a', 'b']);
      assert.deepEqual(normalizeSeenNoticeIds('a'), []);
    },
  },
  {
    name: 'server notice: asked at launch, then again only after hours away',
    run() {
      const now = Date.parse('2026-10-01T09:00:00.000Z');
      assert.equal(shouldCheckServerNotice(null, now), true);
      assert.equal(shouldCheckServerNotice(now - 60 * 1000, now), false);
      assert.equal(shouldCheckServerNotice(now - SERVER_NOTICE_RECHECK_MS, now), true);
      // A clock set back is not a reason to go quiet for hours.
      assert.equal(shouldCheckServerNotice(now + 60 * 1000, now), true);
    },
  },
  {
    name: 'server notice: a failed ask retries after minutes, only an answer starts the six-hour window',
    run() {
      const now = Date.parse('2026-10-01T09:00:00.000Z');
      const MIN = 60 * 1000;
      // Never answered, one failure a minute ago: wait out the short backoff.
      assert.equal(shouldCheckServerNotice(null, now, now - MIN), false);
      // Never answered, failed past the backoff: ask again (was: six hours of silence).
      assert.equal(shouldCheckServerNotice(null, now, now - SERVER_NOTICE_RETRY_MS), true);
      assert.ok(SERVER_NOTICE_RETRY_MS < SERVER_NOTICE_RECHECK_MS);
      // Answered recently, then a failure: the long window still holds.
      assert.equal(shouldCheckServerNotice(now - 10 * MIN, now, now - SERVER_NOTICE_RETRY_MS - MIN), false);
      // A clock set back does not freeze the retry.
      assert.equal(shouldCheckServerNotice(null, now, now + MIN), true);

      // The dialog records an answer (even "no notice") and a failure apart.
      const dialog = read('src/features/serverNotice/ServerNoticeDialog.tsx');
      assert.match(dialog, /if \(answer\) \{\s*lastAnsweredRef\.current = now;/);
      assert.match(dialog, /\} else \{\s*lastFailedRef\.current = now;/);
      assert.doesNotMatch(dialog, /lastCheckedRef\.current = now;\s*const answer/, 'the window starts before the answer');
    },
  },
  {
    name: 'server notice: a closed notice stays closed through a restore and a reset',
    run() {
      const { DEVICE_ONLY_PREFERENCE_FIELDS, keepDeviceEntitlement } = require('../../src/lib/proEntitlement');
      const { preferencesForRestore } = require('../../src/lib/accountBackup');
      const { createEmptyDatabase } = require('../../src/data/seed');
      assert.ok(DEVICE_ONLY_PREFERENCE_FIELDS.includes('seenServerNoticeIds'));
      const device = { ...createEmptyDatabase('fi').preferences, seenServerNoticeIds: ['closed-here'] };
      const fromBackup = { ...createEmptyDatabase('fi').preferences, seenServerNoticeIds: [] };
      assert.deepEqual(keepDeviceEntitlement(fromBackup, device).seenServerNoticeIds, ['closed-here']);
      assert.deepEqual(preferencesForRestore(fromBackup, device, []).seenServerNoticeIds, ['closed-here']);
      // The reset keeps the whole list (tests/storage/resetKeepsInstall.test.cjs
      // reads it from a used install).
    },
  },
  {
    name: 'server notice: asked of the same server as every other feature, with no build variable of its own',
    run() {
      assert.equal(
        serverNoticeUrl(['https://api.vinha.app/api/ai-coach', undefined]),
        'https://api.vinha.app/api/notice',
      );
      assert.equal(serverNoticeUrl(['', '  ', 'https://x.vercel.app/api/backup']), 'https://x.vercel.app/api/notice');
      assert.equal(serverNoticeUrl(['not a url', 'ftp://x/y']), null);
      // The same answer whatever the case or the rest of the address.
      assert.equal(serverNoticeUrl(['HTTPS://Api.Vinha.app:8443/x?y=1']), 'https://Api.Vinha.app:8443/api/notice');
      assert.equal(serverNoticeUrl([undefined, undefined]), null);

      const client = read('src/features/serverNotice/serverNoticeClient.ts');
      for (const name of ['EXPO_PUBLIC_AI_COACH_API_URL', 'EXPO_PUBLIC_BACKUP_API_URL', 'EXPO_PUBLIC_ANALYTICS_URL']) {
        // Written out literally: Expo inlines only literal reads.
        assert.ok(client.includes(`process.env.${name}`), `${name} is read literally`);
      }
    },
  },
  {
    /**
     * The kill switch is only a kill switch if every door checks it before it
     * does anything, and the notice is only useful if its own door stays open
     * while the others are shut.
     */
    name: 'kill switch: every endpoint checks it first, and the notice endpoint stays open',
    run() {
      const apiDir = path.join(root, 'api');
      const files = fs.readdirSync(apiDir).filter((name) => name.endsWith('.ts'));
      assert.ok(files.includes('notice.ts'));
      for (const name of files) {
        const source = fs.readFileSync(path.join(apiDir, name), 'utf8');
        const handlerAt = source.indexOf('export default');
        assert.ok(handlerAt >= 0, `${name} has a default handler`);
        const body = source.slice(handlerAt);
        if (name === 'notice.ts') {
          assert.equal(body.includes('isServicePaused(process.env)) {'), false, 'the notice endpoint is never paused');
          assert.match(body, /notice: serverNoticeFromEnv\(process\.env\)/);
          assert.match(body, /paused: isServicePaused\(process\.env\)/);
          continue;
        }
        // Two doors stay open on purpose, and only for deleting: the policy
        // promises a reader's copy goes at once, and in an incident that is
        // the request that matters most.
        const guard = {
          'backup.ts': "if (isServicePaused(process.env) && req.method !== 'DELETE') {",
          'ai-coach.ts': 'if (isServicePaused(process.env) && !readForgetLogId(req.body)) {',
        }[name] ?? 'if (isServicePaused(process.env)) {';
        const guardAt = body.indexOf(guard);
        assert.ok(guardAt >= 0, `${name} checks the kill switch: ${guard}`);
        assert.match(body.slice(guardAt, guardAt + 200), /res\.status\(503\)\.json\(servicePausedBody\(\)\);\s*return;/);
        // Before anything that reads, parses, writes or calls out.
        const afterGuard = guardAt + guard.length;
        // The coach checks its app key first (a stranger costs a header
        // comparison and nothing else — aiCoachAppKey.test), then the switch.
        const laterThings = ['await ', 'req.body', 'hasAppKey(', 'authorized(', 'isRateLimited(', 'handlePost(']
          .filter((later) => !(name === 'ai-coach.ts' && later === 'hasAppKey('));
        for (const later of laterThings) {
          const at = body.indexOf(later, 0);
          const inGuard = at >= guardAt && at < afterGuard;
          assert.ok(at === -1 || at > guardAt || inGuard, `${name}: "${later}" comes before the kill switch`);
        }
      }
    },
  },
  {
    name: 'server notice: the app mounts it at a calm moment and remembers what was closed',
    run() {
      // The shell's render tail, dialog included, moved out of App.tsx into src/app.
      const app = readAppWiring();
      assert.match(app, /<ServerNoticeDialog\s+language=\{preferences\.appLanguage\}\s+held=\{appUpdateHeld\}\s+seenIds=\{preferences\.seenServerNoticeIds\}\s+onSeen=\{handleServerNoticeSeen\}/);
      // The "seen" write left App.tsx for a src/app hook, and the dialog's
      // mount above for the shell's render function, in the phase-C split
      // (2026-10-01); both are read from the whole shell.
      assert.match(readAppWiring(), /seenServerNoticeIds: rememberServerNotice\(preferences\.seenServerNoticeIds, id\)/);

      const dialog = read('src/features/serverNotice/ServerNoticeDialog.tsx');
      // Closing it is what marks it seen, and the dialog cannot be dismissed
      // any other way.
      assert.match(dialog, /onPress: \(\) => onSeen\(due\.id\)/);
      assert.match(dialog, /cancelable: false/);

      const database = read('src/storage/database.ts');
      assert.match(database, /seenServerNoticeIds: Array\.isArray\(input\?\.preferences\?\.seenServerNoticeIds\)\s+\? normalizeSeenNoticeIds/);
    },
  },
];
