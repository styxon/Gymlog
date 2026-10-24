const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { afterRateLimitedQuestion, withNotice } = require('../../.test-dist/lib/coachThread.js');
const { createSingleFlight } = require('../../.test-dist/lib/singleFlight.js');
const { accountAfterCloudCopyDeleted, visibleBackupPause } = require('../../.test-dist/lib/backupPause.js');
const { membershipEndCancelled, resolveMembershipEndView } = require('../../.test-dist/lib/membershipEndView.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const reply = { id: 'coach:3', fromCoach: true, text: 'wait' };
const thread = [
  { id: 'me:3', fromCoach: false, text: 'how much protein?' },
  { id: 'offer:3', fromCoach: true, text: 'offer' },
  { id: 'coach:1', fromCoach: true, text: 'earlier' },
];

module.exports = [
  {
    name: 'rate limited: an empty field gets the question back and its bubble is lifted out',
    run() {
      const after = afterRateLimitedQuestion(thread, 3, 'how much protein?', '   ', reply);
      assert.equal(after.draft, 'how much protein?');
      assert.deepEqual(after.messages.map((m) => m.id), ['coach:1', 'coach:3']);
    },
  },
  {
    name: 'rate limited: a draft typed meanwhile is kept, and the old question stays in the thread',
    run() {
      const after = afterRateLimitedQuestion(thread, 3, 'how much protein?', 'and sleep?', reply);
      assert.equal(after.draft, 'and sleep?');
      // Its log offer stays with it (hunt 1.1.1): lifted alone, the reading in the question could no longer be logged.
      assert.deepEqual(after.messages.map((m) => m.id), ['me:3', 'offer:3', 'coach:1', 'coach:3']);
      // The question is never in neither place.
      assert.ok(after.draft.includes('sleep') && after.messages.some((m) => m.text === 'how much protein?'));
    },
  },
  {
    name: 'rate limited wiring: the screen applies the rule to both the thread and the field',
    run() {
      const src = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(src, /afterRateLimitedQuestion\(current, token, trimmed, draftNow, limitedReply\)\.messages/);
      assert.match(src, /setDraft\(afterRateLimitedQuestion\(\[\], token, trimmed, draftNow, limitedReply\)\.draft\)/);
    },
  },
  {
    name: 'spent notice: tapping again replaces the bubble instead of adding a second with the same key',
    run() {
      const first = withNotice([{ id: 'offer:1', text: 'o' }], { id: 'offer:1:spent', text: 'a' });
      const second = withNotice(first, { id: 'offer:1:spent', text: 'b' });
      assert.equal(second.length, 2);
      assert.equal(new Set(second.map((m) => m.id)).size, second.length);
      assert.equal(second[1].text, 'b');
    },
  },
  {
    name: 'compose gate: the spent notice goes through withNotice, and a build is gated before its first await',
    run() {
      const src = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(src, /withNotice\(current, \{\s*id: `\$\{messageId\}:spent`/);
      const gate = src.indexOf('composeGate.current.add(messageId)');
      assert.ok(gate > -1);
      assert.ok(src.indexOf('await onComposeProgramme(', gate) > gate, 'the gate is set before the build is awaited');
      assert.match(src, /if \(composeGate\.current\.has\(messageId\)\) \{\s*return;\s*\}/);
      assert.match(src, /composeGate\.current\.delete\(messageId\);\s*\}/);
    },
  },
  {
    name: 'single flight: a second trigger while one runs does nothing, and the flag is released after success or failure',
    async run() {
      const flight = createSingleFlight();
      let runs = 0;
      let release;
      const first = flight.run(async () => {
        runs += 1;
        await new Promise((resolve) => {
          release = resolve;
        });
        return 'done';
      });
      assert.equal(flight.busy, true);
      assert.equal(await flight.run(async () => (runs += 1)), undefined);
      assert.equal(runs, 1);
      release();
      assert.equal(await first, 'done');
      assert.equal(flight.busy, false);
      // A failing run releases it too.
      await assert.rejects(flight.run(async () => Promise.reject(new Error('store down'))));
      assert.equal(flight.busy, false);
      assert.equal(await flight.run(async () => 'again'), 'again');
    },
  },
  {
    name: 'single flight wiring: the store restore runs inside it',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(profile, /const restoreFlight = createSingleFlight\(\);/);
      assert.match(profile, /await restoreFlight\.run\(async \(\) => \{\s*const customer = await restoreStorePurchases\(\);/);
    },
  },
  {
    name: 'backup pause: deleting the cloud copy leaves no backup on record, auto-backup held, and no "deleted elsewhere" mark',
    run() {
      const account = {
        sub: 'g:1',
        lastBackupAt: '2026-10-01T00:00:00.000Z',
        lastBackupItemCount: 40,
        lastBackupHistoryCount: 12,
        lastBackupFingerprint: 'abc',
        autoBackupPaused: false,
        cloudVersion: 'v7',
        cloudCopyDeletedAt: '2026-09-01T00:00:00.000Z',
      };
      const after = accountAfterCloudCopyDeleted(account);
      assert.equal(after.sub, 'g:1');
      assert.equal(after.lastBackupAt, null);
      assert.equal(after.lastBackupFingerprint, null);
      assert.equal(after.autoBackupPaused, true);
      assert.equal(after.cloudVersion, null);
      assert.equal(after.cloudCopyDeletedAt, null);
      // With the session's pause cleared, the row shows no pause. Had the mark
      // survived, it would read "copy deleted" for a copy the reader just deleted.
      assert.equal(visibleBackupPause(null, after.cloudCopyDeletedAt), null);
      assert.equal(visibleBackupPause(null, account.cloudCopyDeletedAt), 'copy_deleted');
      assert.equal(visibleBackupPause('other_phone', null), 'other_phone');
    },
  },
  {
    name: 'backup pause wiring: the delete persists the cleaned account, then clears the pause before it reports done',
    run() {
      const hook = read('src', 'features', 'account', 'useAccountBackup.ts');
      const del = hook.slice(hook.indexOf('const deleteRemoteBackup = useCallback'));
      const body = del.slice(0, del.indexOf('const deleteAccount = useCallback'));
      assert.match(body, /await persistAccount\(accountAfterCloudCopyDeleted\(current\)\);[\s\S]*?clearPause\(\);\s*return 'done';/);
      assert.match(hook, /backupPaused: visibleBackupPause\(backupPaused, account\.cloudCopyDeletedAt\)/);
    },
  },
  {
    name: 'membership end: "already cancelled" is said only for a purchase with a cancellation stamp',
    run() {
      for (const source of ['promo', 'trial', 'review', null]) {
        assert.equal(membershipEndCancelled(source, '2026-09-01T00:00:00.000Z'), false, `${source} with a stale stamp`);
      }
      assert.equal(membershipEndCancelled('purchase', null), false);
      assert.equal(membershipEndCancelled('purchase', '2026-09-01T00:00:00.000Z'), true);
      // And the view refuses it too when the plan cannot end anything.
      assert.deepEqual(resolveMembershipEndView({ canEndNow: false, cancelled: true }), {
        mode: 'back',
        alreadyCancelled: false,
        billingIssue: false,
      });
    },
  },
  {
    name: 'membership end wiring: the screen is handed the cancelled prop through the helper',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(
        profile,
        /cancelled=\{membershipEndCancelled\(proEntitlement\.source, preferences\.mockSubscriptionCancelledAt\)\}/,
      );
      assert.doesNotMatch(profile, /<MembershipEndScreen[\s\S]{0,600}cancelled=\{preferences\.mockSubscriptionCancelledAt !== null\}/);
    },
  },
];
