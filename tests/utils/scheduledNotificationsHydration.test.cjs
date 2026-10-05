const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The scheduling hook (useScheduledNotifications) driven end to end against an
 * in-memory expo-notifications, under Helsinki's clock and a frozen `now`. The
 * compiled hook and the compiled appNotifications are the real ones; only
 * react (the hook harness), react-native and expo-notifications are replaced.
 *
 * Bug hunt, 2026-10-05: AppProvider's first render is createEmptyDatabase(),
 * whose pushEnabled is false, and the hook planned from it — cancelling every
 * pending reminder on every cold start before the stored data arrived.
 */
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const { createHookRuntime, requireWithStubs } = require('../helpers/hookHarness.cjs');

const RealDate = Date;
const world = { now: RealDate.now() };
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(world.now);
    } else {
      super(...args);
    }
  }
  static now() {
    return world.now;
  }
}

async function withHelsinki(body) {
  const original = process.env.TZ;
  process.env.TZ = 'Europe/Helsinki';
  global.Date = FrozenDate;
  try {
    assert.deepEqual(
      [
        new RealDate(2026, 9, 24, 12).getTimezoneOffset(),
        new RealDate(2026, 9, 27, 12).getTimezoneOffset(),
        new RealDate(2027, 2, 27, 12).getTimezoneOffset(),
        new RealDate(2027, 2, 29, 12).getTimezoneOffset(),
      ],
      [-180, -120, -120, -180],
      'TZ override did not take effect',
    );
    await body();
  } finally {
    global.Date = RealDate;
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  }
}

const at = (y, m, d, h = 0, mi = 0) => new RealDate(y, m - 1, d, h, mi, 0, 0).getTime();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createFakeNotifications() {
  const scheduled = new Map();
  let granted = true;
  let generated = 0;
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = [];
  const api = {
    AndroidImportance: { NONE: 2, DEFAULT: 5, HIGH: 6, LOW: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0 },
    AndroidNotificationPriority: { HIGH: 'high', LOW: 'low' },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
    setNotificationHandler() {},
    async setNotificationChannelAsync() {
      await tick();
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
      await tick(1);
      generated += 1;
      const id = identifier ?? `generated-${generated}`;
      scheduled.set(id, { identifier: id, content, trigger });
      log.push(['schedule', id]);
      return id;
    },
    async cancelScheduledNotificationAsync(id) {
      await tick(1);
      scheduled.delete(id);
      log.push(['cancel', id]);
    },
    async getAllScheduledNotificationsAsync() {
      await tick();
      return [...scheduled.values()];
    },
  };
  return {
    api,
    scheduled,
    log,
    setGranted(value) {
      granted = value;
    },
    /** What the OS will actually deliver, oldest first: [{ at, title, key }]. */
    pending() {
      return [...scheduled.values()]
        .filter((request) => request.content.data?.gymlogPlan === true)
        .map((request) => ({
          at: request.trigger.date,
          category: request.content.data.category,
          signature: request.content.data.signature,
        }))
        .sort((a, b) => a.at - b.at);
    },
  };
}

/** Loads appNotifications + the hook fresh, as one process, against `fake`. */
function bootProcess(fake) {
  const listeners = new Set();
  const AppState = {
    currentState: 'active',
    addEventListener(type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const rn = { Platform: { OS: 'android', Version: 34 }, AppState };
  const runtime = createHookRuntime();
  const app = requireWithStubs(path.join(DIST, 'utils', 'appNotifications.js'), {
    'expo-notifications': fake.api,
    'react-native': rn,
    expo: { requireOptionalNativeModule: () => null },
    './notificationHandler': { PLAN_NOTIFICATION_MARKER: 'gymlogPlan', installNotificationHandler() {} },
  });
  const { useScheduledNotifications } = requireWithStubs(path.join(DIST, 'hooks', 'useScheduledNotifications.js'), {
    react: runtime.react,
    'react-native': rn,
    '../utils/appNotifications': app,
  });
  return {
    runtime,
    render: (database, hydrated = true) =>
      runtime.render((props) => useScheduledNotifications(props.database, props.hydrated), { database, hydrated }),
    foreground: () => [...listeners].forEach((listener) => listener('active')),
  };
}

async function settle(fake) {
  let last = -1;
  for (let i = 0; i < 100; i += 1) {
    await sleep(25);
    const now = fake.log.length;
    if (now === last) {
      return;
    }
    last = now;
  }
}

const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));

function databaseWith(patch = {}, prefsPatch = {}, notifPatch = {}) {
  const base = createEmptyDatabase('en');
  return {
    ...base,
    ...patch,
    preferences: {
      ...base.preferences,
      ...prefsPatch,
      notificationPrefs: {
        ...base.preferences.notificationPrefs,
        pushEnabled: true,
        sessionReminders: true,
        reminderTime: '17:30',
        personalRecords: false,
        weeklySummary: false,
        comebackNudge: false,
        ...notifPatch,
      },
    },
  };
}

module.exports = [
  {
    name: 'scheduled notifications: a cold start on the not-yet-loaded database leaves the pending reminders alone',
    async run() {
      await withHelsinki(async () => {
        world.now = at(2026, 10, 20, 12);
        const fake = createFakeNotifications();
        const stored = databaseWith({}, { setupAvailableDays: ['mon', 'wed', 'fri'] });

        // The previous process armed the reminders.
        const first = bootProcess(fake);
        first.render(stored);
        await settle(fake);
        const armed = fake.pending();
        assert.ok(armed.length > 5, `only ${armed.length} armed`);

        // A new process: the empty default renders first, the stored database
        // is still loading — or never loads.
        const second = bootProcess(fake);
        second.render(createEmptyDatabase('en'), false);
        await settle(fake);
        assert.deepEqual(fake.pending(), armed, 'a not-yet-loaded database cancelled the pending reminders');

        // Once it lands, the plan is the stored one.
        second.render(stored, true);
        await settle(fake);
        assert.deepEqual(fake.pending(), armed);
      });
    },
  },
  {
    name: 'scheduled notifications: a loaded database that really has reminders off still clears them',
    async run() {
      await withHelsinki(async () => {
        world.now = at(2026, 10, 20, 12);
        const fake = createFakeNotifications();
        const proc = bootProcess(fake);
        proc.render(databaseWith({}, { setupAvailableDays: ['mon', 'wed', 'fri'] }));
        await settle(fake);
        assert.ok(fake.pending().length > 5);
        proc.render(databaseWith({}, { setupAvailableDays: ['mon', 'wed', 'fri'] }, { pushEnabled: false }), true);
        await settle(fake);
        assert.equal(fake.pending().length, 0);
      });
    },
  },
];
