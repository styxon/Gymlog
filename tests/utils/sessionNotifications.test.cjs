const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * The workout's notifications against an in-memory expo-notifications.
 *
 * sessionNotifications and appNotifications import expo-notifications and
 * react-native, so they are loaded here with both stubbed in the require
 * cache — the same trick tests/storage/fakeAsyncStorage.cjs plays on
 * AsyncStorage. The fake keeps what the OS would keep (pending requests,
 * presented ones, channels, button sets) and nothing else.
 *
 * Every native call yields before it acts, and a cancel can be told to take
 * longer than a schedule: the real module gives no ordering promise, and with
 * fixed ids the order is the whole correctness.
 */
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'src');

function createFakeNotifications() {
  const scheduled = new Map();
  /**
   * The alarms really set in the OS, apart from `scheduled` — the library's
   * stored list, which is what getAllScheduledNotificationsAsync reports. A
   * force-stop clears these and leaves the list (native audit, 2026-09-21).
   */
  const armed = new Set();
  const presented = new Map();
  const channels = new Map();
  const categories = new Map();
  const calls = { channel: 0, category: 0, schedule: 0 };
  const timing = { cancelDelayMs: 0 };
  let granted = true;
  let generated = 0;
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  const api = {
    // expo-notifications' own numbering (NotificationChannelManager.types).
    AndroidImportance: { NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6 },
    AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0 },
    AndroidNotificationPriority: { HIGH: 'high', LOW: 'low' },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
    setNotificationHandler() {},
    async setNotificationChannelAsync(id, channel) {
      await tick();
      calls.channel += 1;
      // Android lets an app rename its channel but keeps the importance the
      // reader set for it in system settings.
      const existing = channels.get(id);
      channels.set(id, existing ? { ...channel, importance: existing.importance } : { ...channel });
    },
    async getNotificationChannelAsync(id) {
      await tick();
      const channel = channels.get(id);
      return channel ? { id, ...channel } : null;
    },
    async setNotificationCategoryAsync(id, actions) {
      await tick();
      calls.category += 1;
      categories.set(id, actions);
    },
    async getPermissionsAsync() {
      await tick();
      return { granted, status: granted ? 'granted' : 'denied', canAskAgain: false };
    },
    async requestPermissionsAsync() {
      await tick();
      return { granted, status: granted ? 'granted' : 'denied', canAskAgain: false };
    },
    async scheduleNotificationAsync({ identifier, content, trigger }) {
      await tick();
      generated += 1;
      const id = identifier ?? `generated-${generated}`;
      const request = { identifier: id, content, trigger };
      if (trigger && (trigger.seconds !== undefined || trigger.date !== undefined)) {
        calls.schedule += 1;
        scheduled.set(id, request);
        armed.add(id);
      } else {
        presented.set(id, request);
      }
      return id;
    },
    async cancelScheduledNotificationAsync(id) {
      await tick(timing.cancelDelayMs);
      scheduled.delete(id);
      armed.delete(id);
    },
    async dismissNotificationAsync(id) {
      await tick();
      presented.delete(id);
    },
    async getAllScheduledNotificationsAsync() {
      await tick();
      return [...scheduled.values()];
    },
    async getPresentedNotificationsAsync() {
      await tick();
      return [...presented.values()].map((request) => ({ request }));
    },
  };

  return {
    api,
    scheduled,
    armed,
    presented,
    channels,
    categories,
    calls,
    timing,
    setGranted(value) {
      granted = value;
    },
    /** Force-stop, or exact alarms revoked: Android drops the app's alarms. */
    forceStop() {
      armed.clear();
    },
    /** A notification the OS delivered: pending becomes presented. */
    deliver(id) {
      const request = scheduled.get(id);
      scheduled.delete(id);
      armed.delete(id);
      presented.set(id, request);
    },
  };
}

const FRESH_MODULES = [
  'utils/sessionNotifications.js',
  'utils/notificationHandler.js',
  'utils/appNotifications.js',
  // appNotifications asks it whether exact alarms are allowed; with no
  // native module the answer is null, "cannot tell", which changes nothing.
  'utils/exactAlarm.js',
];

/**
 * A fresh process: the modules load again (no queue, no memory), against the
 * OS state `fake` already holds.
 */
function loadAgainst(fake) {
  const from = { paths: [path.join(DIST, 'utils')] };
  const stubs = [
    ['expo-notifications', fake.api],
    ['react-native', { Platform: { OS: 'android', Version: 34 }, AppState: { currentState: 'background' } }],
    ['expo', { requireOptionalNativeModule: () => null }],
  ];
  const saved = new Map();
  const put = (file, entry) => {
    if (!saved.has(file)) {
      saved.set(file, require.cache[file]);
    }
    if (entry) {
      require.cache[file] = entry;
    } else {
      delete require.cache[file];
    }
  };
  for (const [name, exports] of stubs) {
    const file = require.resolve(name, from);
    put(file, { id: file, filename: file, loaded: true, exports });
  }
  for (const relative of FRESH_MODULES) {
    put(require.resolve(path.join(DIST, relative)), null);
  }
  try {
    return {
      session: require(path.join(DIST, 'utils/sessionNotifications.js')),
      app: require(path.join(DIST, 'utils/appNotifications.js')),
    };
  } finally {
    for (const [file, entry] of saved) {
      if (entry) {
        require.cache[file] = entry;
      } else {
        delete require.cache[file];
      }
    }
  }
}

const COPY = {
  warningTitle: 'w',
  warningBody: 'w',
  endTitle: 'Rest over',
  endBody: 'e',
  repeatTitle: 'r',
  repeatBody: 'r',
};

function ladderOf(fake) {
  return [...fake.scheduled.values()]
    .filter((request) => request.content.data?.gymlogRest === true && request.identifier.startsWith('vinha-rest-'))
    .map((request) => [request.identifier, request.trigger.seconds])
    .sort();
}

const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

module.exports = [
  {
    name: 'rest ladder: a new rest replaces the old one, and a new process can still cancel it',
    async run() {
      const fake = createFakeNotifications();
      const first = loadAgainst(fake).session;
      const now = Date.now();

      await first.scheduleRestLadder({ endsAtMs: now + 60_000, warning: true, copy: COPY });
      assert.deepEqual(
        ladderOf(fake).map(([id]) => id),
        ['vinha-rest-end', 'vinha-rest-repeat', 'vinha-rest-warning'],
      );

      // Re-entering the player restarts the rest: one ladder, at the new time.
      await first.scheduleRestLadder({ endsAtMs: now + 120_000, warning: true, copy: COPY });
      const ladder = ladderOf(fake);
      assert.equal(ladder.length, 3, `two ladders armed: ${JSON.stringify(ladder)}`);
      assert.ok(ladder.find(([id]) => id === 'vinha-rest-end')[1] >= 119, 'the end alert kept the old time');

      // The process dies mid-rest. The next one has no memory of any id, and
      // logging the set still has to silence the alarms the dead one armed.
      const second = loadAgainst(fake).session;
      await second.cancelRestLadder();
      assert.deepEqual(ladderOf(fake), [], 'the dead process left its alarms armed');
    },
  },
  {
    name: 'rest ladder: the last thing asked for is what the OS holds, however slow a cancel is',
    async run() {
      const fake = createFakeNotifications();
      const { session } = loadAgainst(fake);
      const now = Date.now();
      // A cancel that lands after the schedule it preceded would delete the
      // new rest's alarms — same ids — and nothing would say so.
      fake.timing.cancelDelayMs = 15;

      const a = session.scheduleRestLadder({ endsAtMs: now + 60_000, warning: false, copy: COPY });
      const b = session.cancelRestLadder();
      const c = session.scheduleRestLadder({ endsAtMs: now + 90_000, warning: false, copy: COPY });
      await Promise.all([a, b, c]);
      assert.deepEqual(
        ladderOf(fake).map(([id]) => id),
        ['vinha-rest-end', 'vinha-rest-repeat'],
        'the newest rest lost its alarms to an older cancel',
      );
      assert.ok(ladderOf(fake)[0][1] >= 89);

      // And skip after a start leaves nothing, not the start.
      const d = session.scheduleRestLadder({ endsAtMs: now + 60_000, warning: true, copy: COPY });
      const e = session.cancelRestLadder();
      await Promise.all([d, e]);
      assert.deepEqual(ladderOf(fake), []);

      // No permission, no ladder — and the old one still goes.
      await session.scheduleRestLadder({ endsAtMs: now + 60_000, warning: true, copy: COPY });
      fake.setGranted(false);
      await session.scheduleRestLadder({ endsAtMs: now + 70_000, warning: true, copy: COPY });
      assert.deepEqual(ladderOf(fake), []);
    },
  },
  {
    name: 'opening a workout screen clears a dead rest but keeps the idle nudge; ending the session clears both',
    async run() {
      const fake = createFakeNotifications();
      const { session } = loadAgainst(fake);
      const now = Date.now();

      await session.scheduleIdleNudge({ atMs: now + 25 * 60_000, title: 'idle', body: 'idle' });
      await session.scheduleRestLadder({ endsAtMs: now + 60_000, warning: true, copy: COPY });
      // A ladder from a build that still generated its ids.
      await fake.api.scheduleNotificationAsync({
        content: { title: 'old', data: { gymlogRest: true } },
        trigger: { seconds: 30 },
      });
      // A planner reminder is not the workout's to touch.
      await fake.api.scheduleNotificationAsync({
        content: { title: 'reminder', data: { gymlogPlan: true } },
        trigger: { date: now + 86_400_000 },
      });
      // The last rest's alert is in the shade.
      await session.scheduleRestLadder({ endsAtMs: now + 60_000, warning: false, copy: COPY });
      fake.deliver('vinha-rest-end');

      await session.clearStaleSessionAlerts();
      // Stepping out of the player and back in used to cancel the nudge for
      // the rest of the session: App arms it only when a set is logged.
      assert.ok(fake.scheduled.has('vinha-session-idle'), 'opening the player cancelled the idle nudge');
      assert.deepEqual(
        [...fake.scheduled.values()]
          .filter((request) => request.content.data?.gymlogRest === true)
          .map((request) => request.identifier),
        ['vinha-session-idle'],
        'a rest alarm — fixed id or legacy — survived the sweep',
      );
      assert.equal(
        [...fake.scheduled.values()].filter((request) => request.content.data?.gymlogPlan === true).length,
        1,
        'the sweep took a planner reminder',
      );
      assert.equal(fake.presented.size, 0, 'a dead rest alert stayed in the shade');

      await session.clearAllSessionNotifications();
      assert.equal(
        [...fake.scheduled.values()].filter((request) => request.content.data?.gymlogRest === true).length,
        0,
        'the session ended with its alerts still armed',
      );
      assert.equal(fake.scheduled.size, 1, 'the planner reminder is still pending');
    },
  },
  {
    name: 'the buttons and channels under a workout alert follow the language, and are not rewritten for nothing',
    async run() {
      const fake = createFakeNotifications();
      const { session } = loadAgainst(fake);
      const titles = (category) => fake.categories.get(category).map((action) => action.buttonTitle);

      await session.setupSessionNotifications('en');
      assert.deepEqual(titles('vinha-rest-end'), ['Log set', '+1 min']);
      assert.equal(fake.channels.get('rest-timer').name, 'Rest alerts');
      assert.equal(fake.channels.get('session-ongoing').name, 'Workout in progress');

      // The switch: registered once per process, the buttons kept the
      // language the app had started in.
      await session.setupSessionNotifications('fi');
      assert.deepEqual(titles('vinha-rest-end'), ['Kirjaa sarja', '+1 min']);
      assert.deepEqual(titles('vinha-rest-running'), ['+30 s', 'Ohita lepo', 'Avaa']);
      assert.equal(fake.channels.get('rest-timer').name, 'Lepohälytykset');
      assert.equal(fake.channels.get('rest-warning').name, '10 sekunnin varoitus');
      assert.equal(fake.channels.get('session-ongoing').name, 'Treeni käynnissä');
      assert.equal(fake.channels.get('session-idle').name, 'Muistutus tauosta');

      // Same language again: nothing to write.
      const before = { ...fake.calls };
      await session.setupSessionNotifications('fi');
      assert.deepEqual(fake.calls, before);
    },
  },
  {
    name: 'rest alerts: the rest-alert channel switched off in Android settings reads as not allowed',
    async run() {
      // Native audit, 2026-09-21: the permission is app-wide and stays
      // granted when the reader mutes one channel, so Settings called a
      // muted rest alert allowed.
      const fake = createFakeNotifications();
      const { session } = loadAgainst(fake);
      const { NONE, HIGH } = fake.api.AndroidImportance;

      // No workout screen has made the channel yet: nothing has muted it.
      assert.equal(await session.isRestAlertChannelBlocked(), false);
      await session.setupSessionNotifications('en');
      assert.equal(await session.getRestAlertsAllowed(), true);

      fake.channels.get('rest-timer').importance = NONE;
      assert.equal(await session.getRestAlertPermission(), 'granted', 'the fixture should keep the permission on');
      assert.equal(await session.isRestAlertChannelBlocked(), true);
      assert.equal(await session.getRestAlertsAllowed(), false, 'a muted rest-alert channel reads as allowed');
      // Registering the channel again — a language switch — does not unmute it.
      await session.setupSessionNotifications('fi');
      assert.equal(await session.getRestAlertsAllowed(), false);

      // Another channel muted is not this one.
      fake.channels.get('rest-timer').importance = HIGH;
      fake.channels.get('session-ongoing').importance = NONE;
      assert.equal(await session.getRestAlertsAllowed(), true);
      // And without the permission it is no, whatever the channel says.
      fake.setGranted(false);
      assert.equal(await session.getRestAlertsAllowed(), false);
    },
  },
  {
    name: 'the reminders channel is named in the reader language',
    async run() {
      const fake = createFakeNotifications();
      const { app } = loadAgainst(fake);
      const item = {
        key: 'weighIn:1',
        category: 'weighIn',
        title: 'Punnitus',
        body: 'Aamulla',
        fireAtMs: Date.now() + 86_400_000,
      };

      await app.syncPlannedNotifications([item], 'fi');
      assert.equal(fake.channels.get('training').name, 'Muistutukset ja koosteet');
      await app.syncPlannedNotifications([item], 'en');
      assert.equal(fake.channels.get('training').name, 'Reminders and recaps');
      // The permission ask without a language leaves an existing name alone.
      await app.requestNotificationPermission();
      assert.equal(fake.channels.get('training').name, 'Reminders and recaps');
    },
  },
  {
    name: 'reminders: a new process re-arms the plan the OS dropped, and later syncs write nothing for an unchanged plan',
    async run() {
      // Native audit, 2026-09-21: after a force-stop or an exact-alarm revoke
      // the library still lists every request, the alarms behind them are
      // gone, and the library re-arms only on boot or update. A sync that
      // trusted the list kept them all and the reminders never came.
      const fake = createFakeNotifications();
      const day = 86_400_000;
      const now = Date.now();
      const plan = [1, 2, 3].map((n) => ({
        key: `reminder:${n}`,
        category: 'reminder',
        title: 'Treeni',
        body: `Päivä ${n}`,
        fireAtMs: now + n * day,
      }));
      const planIds = () =>
        [...fake.scheduled.values()].filter((request) => request.content.data?.gymlogPlan === true).map((r) => r.identifier);

      const first = loadAgainst(fake).app;
      assert.equal(await first.syncPlannedNotifications(plan, 'fi'), 3);
      assert.equal(fake.armed.size, 3);
      // Same process, same plan — every foreground does this: no writes.
      const before = fake.calls.schedule;
      assert.equal(await first.syncPlannedNotifications(plan, 'fi'), 3);
      assert.equal(fake.calls.schedule, before, 'an unchanged plan was re-armed within one process');

      fake.forceStop();
      assert.equal(planIds().length, 3, 'the library still lists the dropped requests');

      const second = loadAgainst(fake).app;
      assert.equal(await second.syncPlannedNotifications(plan, 'fi'), 3);
      assert.deepEqual(
        planIds().filter((id) => !fake.armed.has(id)),
        [],
        'a listed reminder has no alarm behind it after the restart',
      );
      assert.equal(planIds().length, 3, 'the re-arm left duplicates');

      // And the new process diffs from then on.
      const after = fake.calls.schedule;
      assert.equal(await second.syncPlannedNotifications(plan, 'fi'), 3);
      assert.equal(fake.calls.schedule, after);
    },
  },
  {
    name: 'the workout screens open onto a cleared rest once, and register their buttons per language',
    run() {
      const hook = strip(fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useRestEndAlert.ts'), 'utf8'));
      assert.match(hook, /useEffect\(\(\) => \{\s*void setupSessionNotifications\(language\);\s*\}, \[language\]\);/);
      assert.match(hook, /useEffect\(\(\) => \{\s*void clearStaleSessionAlerts\(\);\s*\}, \[\]\);/);
      // The session-wide sweep is the session's end, not a screen's opening.
      assert.doesNotMatch(hook, /clearAllSessionNotifications|cancelIdleNudge/);
      // App registers them too, for the idle nudge it arms itself — read
      // across the shell's wiring (App.tsx and src/app).
      const app = strip(readAppWiring());
      assert.match(
        app,
        /if \(activeSessionId && activeSessionStatus === 'active'\) \{\s*void setupSessionNotifications\(preferences\.appLanguage\);/,
      );
    },
  },
];
