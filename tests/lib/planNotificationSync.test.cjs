const assert = require('node:assert/strict');
const path = require('node:path');

const { planNotificationSync, shouldRearmPlan } = require(path.join(__dirname, '..', '..', 'src', 'lib', 'planNotificationSync.js'));

/**
 * The rule behind syncing the planned notifications (native audit,
 * 2026-09-21): the first sync of a process re-arms everything, because the
 * pending list outlives the alarms behind it; every later one diffs. The
 * writes against a fake expo-notifications are in
 * tests/utils/sessionNotifications.test.cjs.
 */
const pending = (...pairs) => pairs.map(([identifier, signature]) => ({ identifier, signature }));

module.exports = [
  {
    name: 'plan sync: the first sync of a process cancels and re-schedules an unchanged plan',
    run() {
      const steps = planNotificationSync({
        pending: pending(['a', 'x'], ['b', 'y']),
        wanted: ['x', 'y'],
        rearm: true,
        allowed: true,
      });
      assert.deepEqual(steps, { cancel: ['a', 'b'], schedule: ['x', 'y'], keep: [] });
    },
  },
  {
    name: 'plan sync: later syncs keep what is pending, schedule what is missing, cancel the stale and the duplicate',
    run() {
      const steps = planNotificationSync({
        pending: pending(['a', 'x'], ['b', 'x'], ['c', 'old'], ['d', '']),
        wanted: ['x', 'y', 'y'],
        rearm: false,
        allowed: true,
      });
      assert.deepEqual(steps, { cancel: ['b', 'c', 'd'], schedule: ['y'], keep: ['x'] });

      // Nothing changed: nothing is written.
      assert.deepEqual(
        planNotificationSync({ pending: pending(['a', 'x']), wanted: ['x'], rearm: false, allowed: true }),
        { cancel: [], schedule: [], keep: ['x'] },
      );
    },
  },
  {
    name: 'plan sync: no permission or no plan clears everything, re-arm or not',
    run() {
      for (const rearm of [true, false]) {
        assert.deepEqual(
          planNotificationSync({ pending: pending(['a', 'x']), wanted: ['x'], rearm, allowed: false }),
          { cancel: ['a'], schedule: [], keep: [] },
        );
        assert.deepEqual(
          planNotificationSync({ pending: pending(['a', 'x']), wanted: [], rearm, allowed: true }),
          { cancel: ['a'], schedule: [], keep: [] },
        );
      }
    },
  },
  {
    /**
     * Measured on an Android 14 emulator (2026-09-30): allowing "Alarms &
     * reminders" does not restart the app, and the reminder armed without it
     * stayed at `window=+1h` through a foreground. A changed answer re-arms;
     * an unchanged one diffs; "cannot tell" (null) assumes nothing changed.
     */
    name: 'plan sync: a changed exact-alarm answer re-arms the plan',
    run() {
      // First sync of a process: always.
      assert.equal(shouldRearmPlan({ armedThisProcess: false, exactNow: false, exactWhenArmed: null }), true);
      // Granted since the plan was armed inexact.
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: true, exactWhenArmed: false }), true);
      // Revoked since (the process normally dies first, but the rule holds).
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: false, exactWhenArmed: true }), true);
      // Unchanged: diff, so a foreground does not re-arm a month of alarms.
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: true, exactWhenArmed: true }), false);
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: false, exactWhenArmed: false }), false);
      // Unknown on either side: no change assumed.
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: null, exactWhenArmed: false }), false);
      assert.equal(shouldRearmPlan({ armedThisProcess: true, exactNow: true, exactWhenArmed: null }), false);
    },
  },
  {
    name: 'plan sync: the writer asks for exact alarms and records the answer it armed with',
    run() {
      const fs = require('node:fs');
      const source = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'appNotifications.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(source, /const exactNow = await canScheduleExactAlarms\(\);/);
      assert.match(source, /rearm: shouldRearmPlan\(\{ armedThisProcess, exactNow, exactWhenArmed \}\),/);
      // Recorded on both ways out of a completed sync, never before the writes.
      assert.equal((source.match(/exactWhenArmed = exactNow;/g) ?? []).length, 2);
      // And the rest screen's "alerts are off" banner re-reads the permission
      // on every return to the app, not only when the screen mounts.
      const hook = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'hooks', 'useRestAlertPermissionMoment.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(
        hook,
        /if \(state === 'active'\) \{\s*void getRestAlertPermission\(\)\.then\(setPermission\);\s*void isRestAlertChannelBlocked\(\)\.then\(setChannelMuted\);/,
      );
    },
  },
];
