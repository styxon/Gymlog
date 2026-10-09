const assert = require('node:assert/strict');

const {
  AI_LOG_WRITE_WINDOW_MS,
  MAX_PENDING_AI_LOG_DELETIONS,
  aiLogDeleteSettlesAt,
  aiLogRetryAt,
  createAiLogDeletionRunner,
  normalizePendingAiLogDeletions,
  withPendingAiLogDeletion,
  withoutAiLogDeletions,
} = require('../../.test-dist/lib/aiLogDeletion.js');
const { buildAccountBackupPayload } = require('../../.test-dist/lib/accountBackup.js');
const { DEVICE_ONLY_PREFERENCE_FIELDS, keepDeviceEntitlement } = require('../../.test-dist/lib/proEntitlement.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed');

/**
 * A coach-log delete that failed is owed, not forgotten (decision 2026-09-17).
 * The privacy policy promises the kept copies go when permission is taken
 * back; Reset takes it back, and a network that was down at that moment used
 * to leave the copies behind with nothing left that could name them.
 */

const A = '0123abcd-0000-4000-8000-00000000000a';
const B = '0123abcd-0000-4000-8000-00000000000b';

/** A forget that answers from a script and counts its calls. */
function scriptedForget(answers) {
  const calls = [];
  const forget = async (logId) => {
    calls.push(logId);
    const answer = answers[logId];
    if (answer instanceof Error) {
      throw answer;
    }
    return { ok: answer === true, removed: 0 };
  };
  return { forget, calls };
}

module.exports = [
  {
    name: 'aiLogDeletion: the stored list keeps only labels, once each, and the newest when it overflows',
    run() {
      assert.deepEqual(normalizePendingAiLogDeletions(undefined), []);
      assert.deepEqual(normalizePendingAiLogDeletions('abc'), []);
      // A label ends up in a server path, so anything that is not one's shape is dropped.
      assert.deepEqual(normalizePendingAiLogDeletions([A, '../transcripts', 42, null, '', A, B]), [A, B]);

      const many = Array.from({ length: MAX_PENDING_AI_LOG_DELETIONS + 5 }, (_, index) =>
        `0123abcd-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );
      const kept = normalizePendingAiLogDeletions(many);
      assert.equal(kept.length, MAX_PENDING_AI_LOG_DELETIONS);
      assert.equal(kept[kept.length - 1], many[many.length - 1], 'the newest label is the one kept');

      assert.deepEqual(withPendingAiLogDeletion([A], B), [A, B]);
      assert.deepEqual(withPendingAiLogDeletion([A], A), [A], 'a label is owed once');
      assert.deepEqual(withPendingAiLogDeletion([A], null), [A]);
      assert.deepEqual(withoutAiLogDeletions([A, B], [A]), [B]);
    },
  },
  {
    name: 'aiLogDeletion: a confirmed delete leaves the list, a failed one stays owed',
    async run() {
      const { forget, calls } = scriptedForget({ [A]: true, [B]: false });
      const deleted = [];
      const run = createAiLogDeletionRunner({
        live: true,
        forget,
        onDeleted: async (labels) => {
          deleted.push(...labels);
        },
      });

      assert.deepEqual(await run([A, B]), [B], 'the runner names what it could not confirm');
      assert.deepEqual(calls, [A, B]);
      assert.deepEqual(deleted, [A], 'only a confirmed label is taken off');

      // A delete that throws is a delete that did not happen.
      const throwing = createAiLogDeletionRunner({
        live: true,
        forget: scriptedForget({ [A]: new Error('offline') }).forget,
        onDeleted: async () => assert.fail('nothing was confirmed'),
      });
      assert.deepEqual(await throwing([A]), [A]);

      // The copies are gone even if the note of it failed to save: the reader
      // is not told otherwise, and the label stays for a harmless second ask.
      const unsaved = createAiLogDeletionRunner({
        live: true,
        forget: scriptedForget({ [A]: true }).forget,
        onDeleted: async () => {
          throw new Error('disk full');
        },
      });
      assert.deepEqual(await unsaved([A]), []);
    },
  },
  {
    name: 'aiLogDeletion: a build without the live coach sends nothing and reports nothing',
    async run() {
      // No server copy can come from such a build, so a reset there must not
      // toast on every press — and the labels stay owed for a build that can
      // reach the server, because an earlier one may have filed copies.
      const { forget, calls } = scriptedForget({ [A]: false });
      const run = createAiLogDeletionRunner({
        live: false,
        forget,
        onDeleted: async () => assert.fail('nothing was sent'),
      });
      assert.deepEqual(await run([A]), []);
      assert.deepEqual(calls, []);
    },
  },
  {
    name: 'aiLogDeletion: a label already on its way is asked once, and every caller hears the answer',
    async run() {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const calls = [];
      const run = createAiLogDeletionRunner({
        live: true,
        forget: async (logId) => {
          calls.push(logId);
          await gate;
          return { ok: false };
        },
        onDeleted: async () => undefined,
      });
      // The start-up retry and the reset, a moment apart.
      const retry = run([A]);
      const reset = run([A]);
      release();
      assert.deepEqual(await retry, [A]);
      assert.deepEqual(await reset, [A], 'the reset learns its label did not go');
      assert.deepEqual(calls, [A], 'one request for one label');

      // Once settled, the next foreground asks again.
      assert.deepEqual(await run([A]), [A]);
      assert.deepEqual(calls, [A, A]);
    },
  },
  {
    name: 'aiLogDeletion: the owed labels stay on this phone — not uploaded, not restored',
    run() {
      const device = { ...createEmptyDatabase('fi').preferences, pendingAiLogDeletions: [A] };
      const database = { ...createEmptyDatabase('fi'), preferences: device };

      const payload = buildAccountBackupPayload(database, { sessions: [], slotHistory: {}, lastSelectedTemplateId: null }, '2026-09-17T10:00:00.000Z');
      assert.deepEqual(payload.database.preferences.pendingAiLogDeletions, [], 'a backup must not carry the labels');
      assert.equal(payload.database.preferences.appLanguage, 'fi', 'the rest of the preferences still go');
      assert.deepEqual(database.preferences.pendingAiLogDeletions, [A], 'the phone’s own list is untouched');

      // A restore keeps this phone's list, whatever the backup says.
      assert.ok(DEVICE_ONLY_PREFERENCE_FIELDS.includes('pendingAiLogDeletions'));
      const fromBackup = { ...createEmptyDatabase('fi').preferences, pendingAiLogDeletions: [B] };
      assert.deepEqual(keepDeviceEntitlement(fromBackup, device).pendingAiLogDeletions, [A]);
    },
  },
  {
    name: 'aiLogDeletion: a backup from before the reset does not revive a label whose delete is owed',
    run() {
      // Reset while offline files A as owed; the cloud copy, made before the
      // reset, still says A with every line on. Restored as it was, the coach
      // would keep new copies under A and the next retry would delete them.
      const device = { ...createEmptyDatabase('fi').preferences, pendingAiLogDeletions: [A] };
      const backup = {
        ...createEmptyDatabase('fi').preferences,
        profileName: 'Sanna',
        aiLogId: A,
        aiLogChatConsent: true,
        aiLogComposerConsent: true,
        aiLogPhotoConsent: true,
      };
      const kept = keepDeviceEntitlement(backup, device);
      assert.equal(kept.aiLogId, null, 'the owed label is not handed back');
      assert.equal(kept.aiLogChatConsent, false);
      assert.equal(kept.aiLogComposerConsent, false);
      assert.equal(kept.aiLogPhotoConsent, false);
      assert.deepEqual(kept.pendingAiLogDeletions, [A], 'and its delete is still owed');
      assert.equal(kept.profileName, 'Sanna', 'the rest of the backup is restored');

      // A label nobody owes a delete for restores as it was.
      const other = keepDeviceEntitlement({ ...backup, aiLogId: B }, device);
      assert.equal(other.aiLogId, B);
      assert.equal(other.aiLogChatConsent, true);
    },
  },
  {
    name: 'aiLogDeletion: the app retries on start and on foreground, and Reset uses the same runner',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const code = (...parts) =>
        fs
          .readFileSync(path.join(root, ...parts), 'utf8')
          .replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');

      const hook = code('src', 'hooks', 'usePendingAiLogDeletions.ts');
      assert.match(hook, /live: isAiCoachLiveConfigured\(\),\s*forget: forgetAiCoachLog,/);
      assert.match(hook, /if \(!input\.hydrated\) \{\s*return undefined;\s*\}/);
      // Once when the load lands, and on every return to the foreground.
      assert.match(hook, /retry\(\);\s*const subscription = AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) \{\s*retry\(\);/);
      assert.match(hook, /void run\(pendingRef\.current\);/);

      const app = code('App.tsx');
      assert.match(
        app,
        /const deletePendingAiLogs = usePendingAiLogDeletions\(\{\s*hydrated,\s*pending: preferences\.pendingAiLogDeletions,\s*clear: clearPendingAiLogDeletions,\s*\}\);/,
      );
      assert.match(app, /resetAllData: handleResetAllData,\s*deletePendingAiLogs,/);

      // The provider drops confirmed labels from the list as it is NOW, inside
      // the write queue — a retry older than a reset must not undo its filing.
      const provider = code('src', 'state', 'AppProvider.tsx');
      const clear = provider.slice(
        provider.indexOf('function clearPendingAiLogDeletions('),
        provider.indexOf('function resetAllData()'),
      );
      assert.match(clear, /return runExclusive\(async \(\) => \{\s*const current = databaseRef\.current;/);
      assert.match(clear, /withoutAiLogDeletions\(pending, deleted\)/);
      assert.match(clear, /await savePreferences\(next\.preferences\);/);
    },
  },
  {
    // The server keeps a copy after the model answers, and a delete lists the
    // copies there when it arrives: a withdrawal made while a question was
    // still being answered deleted every copy but that one, and the label was
    // retired as done (server audit, 2026-09-21).
    name: 'aiLogDeletion: a delete confirmed while a request carrying the label may still be writing stays owed until it cannot be',
    async run() {
      // The app's own outer bound on a coach call.
      const WINDOW = 40_000;
      let clock = 10_000;
      const deleted = [];
      const { forget, calls } = scriptedForget({ [A]: true });
      const run = createAiLogDeletionRunner({
        live: true,
        forget,
        onDeleted: async (labels) => {
          deleted.push(...labels);
        },
        // A question under A left the phone at 0.
        lastCarriedAt: (label) => (label === A ? 0 : null),
        now: () => clock,
      });
      assert.deepEqual(await run([A]), [A], 'a delete that raced a copy still being written was called final');
      assert.deepEqual(deleted, []);
      assert.equal(calls.length, 1, 'the delete is still sent: what was there goes now');

      clock = WINDOW;
      assert.deepEqual(await run([A]), []);
      assert.deepEqual(deleted, [A]);

      assert.equal(AI_LOG_WRITE_WINDOW_MS, WINDOW);
      assert.equal(aiLogDeleteSettlesAt(null, 1_000), null, 'no request carried it: the delete is final');
      assert.equal(aiLogDeleteSettlesAt(0, 10_000), WINDOW);
      assert.equal(aiLogDeleteSettlesAt(0, WINDOW), null);
      // When to ask again: once the latest of the late copies has landed.
      assert.equal(aiLogRetryAt([A, B], (label) => (label === A ? 0 : 5_000), 10_000), 5_000 + WINDOW);
      assert.equal(aiLogRetryAt([A], () => null, 10_000), null);
    },
  },
  {
    name: 'aiLogDeletion: the app knows when a request last carried a label, and asks again once its copy has landed',
    async run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
      const code = (...parts) => read(...parts).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      // The window is the app's own outer bound on a coach call, which is
      // past the endpoint's upstream timeout.
      const client = code('src', 'lib', 'aiCoachClient.ts');
      assert.equal(Number(client.match(/const REQUEST_TIMEOUT_MS = (\d+);/)[1]), AI_LOG_WRITE_WINDOW_MS);
      const endpoint = read('api', 'ai-coach.ts');
      assert.ok(Number(endpoint.match(/AI_COACH_CLAUDE_TIMEOUT_MS \?\? (\d+)\)/)[1]) < AI_LOG_WRITE_WINDOW_MS);

      // Every request that can leave a copy notes it before it is sent.
      const notes = client.match(/noteAiLogCarried\(input\.keepConsent, input\.logId\);\s*const response = await fetch\(/g) ?? [];
      assert.equal(notes.length, 3, 'a request that can leave a copy does not say when it left');

      // Run: a question under a label, with the switch on and with it off.
      const saved = {
        fetch: global.fetch,
        url: process.env.EXPO_PUBLIC_AI_COACH_API_URL,
        key: process.env.EXPO_PUBLIC_AI_COACH_APP_KEY,
        mode: process.env.NODE_ENV,
      };
      const modulePath = path.join(root, '.test-dist', 'lib', 'aiCoachClient.js');
      process.env.EXPO_PUBLIC_AI_COACH_API_URL = 'https://coach.example.test/api/ai-coach';
      process.env.EXPO_PUBLIC_AI_COACH_APP_KEY = 'app-key';
      // A development build reaches the URL without the spend-cap sign-off.
      process.env.NODE_ENV = 'development';
      delete require.cache[modulePath];
      delete require.cache[path.join(root, '.test-dist', 'lib', 'aiCoachLiveGate.js')];
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, source: 'live', answer: { takeaway: 'x', why: [], nextSteps: [], plan: [], assumptions: [] } }) });
      const logIdModule = require(path.join(root, '.test-dist', 'lib', 'aiCoachLogId.js'));
      const savedCopies = logIdModule.COACH_COPIES_KEPT;
      const sent = [];
      global.fetch = async (url, init) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, source: 'live', answer: { takeaway: 'x', why: [], nextSteps: [], plan: [], assumptions: [] } }) };
      };
      try {
        const coach = require(modulePath);
        // Copies off (2026-09-30): a stored yes still leaves as a no, with no label.
        logIdModule.COACH_COPIES_KEPT = false;
        await coach.requestAiCoachAdvice({ prompt: 'Why?', context: {}, keepConsent: true, logId: B });
        assert.equal(coach.lastAiLogCarriedAt(B), null, 'a request with copies off was noted as carrying a label');
        assert.equal(sent[0].keepConsent, false);
        assert.ok(!('logId' in sent[0]), 'a label left the phone with copies off');
        // And on, the path the retries were built for.
        logIdModule.COACH_COPIES_KEPT = true;
        assert.equal(coach.lastAiLogCarriedAt(B), null);
        await coach.requestAiCoachAdvice({ prompt: 'Why?', context: {}, keepConsent: false, logId: B });
        assert.equal(coach.lastAiLogCarriedAt(B), null, 'a request that keeps nothing was noted');
        const before = Date.now();
        await coach.requestAiCoachAdvice({ prompt: 'Why?', context: {}, keepConsent: true, logId: B });
        assert.ok(coach.lastAiLogCarriedAt(B) >= before);
        assert.equal(sent[sent.length - 1].keepConsent, true);
        assert.equal(sent[sent.length - 1].logId, B);
      } finally {
        logIdModule.COACH_COPIES_KEPT = savedCopies;
        global.fetch = saved.fetch;
        for (const [key, value] of [['EXPO_PUBLIC_AI_COACH_API_URL', saved.url], ['EXPO_PUBLIC_AI_COACH_APP_KEY', saved.key], ['NODE_ENV', saved.mode]]) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        delete require.cache[modulePath];
      }

      // The retry runner reads it, and a timer asks again when the late copy has landed.
      const hook = code('src', 'hooks', 'usePendingAiLogDeletions.ts');
      assert.match(hook, /lastCarriedAt: lastAiLogCarriedAt,/);
      assert.match(hook, /const at = aiLogRetryAt\(input\.pending, lastAiLogCarriedAt, Date\.now\(\)\);/);
      assert.match(hook, /void run\(pendingRef\.current\);\s*\}\s*\}, at - Date\.now\(\) \+ SETTLE_MARGIN_MS\);/);
    },
  },
  {
    // Review of #346: the retry backoff counted a delete the server had
    // confirmed, still inside its write window, as a failure.
    name: 'aiLogDeletion: the runner tells a delete the server refused from one it confirmed that is not yet final',
    async run() {
      const { forget } = scriptedForget({ [A]: true, [B]: false });
      const run = createAiLogDeletionRunner({
        live: true,
        forget,
        onDeleted: async () => undefined,
        // A's last request left the phone at 5 s: a delete sent at 10 s can still miss its copy.
        lastCarriedAt: (logId) => (logId === A ? 5_000 : null),
        now: () => 10_000,
      });
      const result = await run.detailed([A, B]);
      assert.deepEqual(result.owed, [A, B], 'both are still owed');
      assert.deepEqual(result.refused, [B], 'but only B was refused');
      assert.deepEqual(await run([A, B]), [A, B], 'run keeps answering with what is owed');

      const idle = createAiLogDeletionRunner({ live: false, forget, onDeleted: async () => undefined });
      assert.deepEqual(await idle.detailed([A]), { owed: [], refused: [] });
    },
  },
];
