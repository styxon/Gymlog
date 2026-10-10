const assert = require('node:assert/strict');

const {
  PENDING_REST_ACTION_TTL_MS,
  REST_OVER_REPEAT_WINDOW_MS,
  createRestActionBus,
  isRepeatedRestOverExtend,
} = require('../../.test-dist/lib/restActionBus.js');

function clock(start = 1000000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

module.exports = [
  {
    // #bugs 2026-10-02: "+30 s" / "Skip rest" from a killed app did nothing —
    // emitted at 350 ms into a listener set that mounts after the splash.
    name: 'rest action bus: an action emitted before any screen listens is delivered when one subscribes',
    run() {
      const now = clock();
      const bus = createRestActionBus(now);
      bus.emit({ kind: 'extend', seconds: 30 }, 'session-1');
      now.advance(4500);
      const heard = [];
      bus.subscribe((action) => heard.push(action), 'session-1');
      assert.deepEqual(heard, [{ kind: 'extend', seconds: 30 }]);
    },
  },
  {
    name: 'rest action bus: a held action is delivered once, to the first subscriber only',
    run() {
      const bus = createRestActionBus(clock());
      bus.emit({ kind: 'skip' }, 's');
      const first = [];
      const second = [];
      bus.subscribe((action) => first.push(action), 's');
      bus.subscribe((action) => second.push(action), 's');
      assert.equal(first.length, 1);
      assert.equal(second.length, 0);
    },
  },
  {
    name: 'rest action bus: a held action expires',
    run() {
      const now = clock();
      const bus = createRestActionBus(now);
      bus.emit({ kind: 'skip' }, 's');
      now.advance(PENDING_REST_ACTION_TTL_MS + 1);
      const heard = [];
      bus.subscribe((action) => heard.push(action), 's');
      assert.deepEqual(heard, []);
      // And it is gone, not merely skipped once.
      bus.subscribe((action) => heard.push(action), 's');
      assert.deepEqual(heard, []);
    },
  },
  {
    name: 'rest action bus: an action still inside its window is delivered',
    run() {
      const now = clock();
      const bus = createRestActionBus(now);
      bus.emit({ kind: 'skip' }, 's');
      now.advance(PENDING_REST_ACTION_TTL_MS);
      const heard = [];
      bus.subscribe((action) => heard.push(action), 's');
      assert.equal(heard.length, 1);
    },
  },
  {
    name: 'rest action bus: a held action meant for another session is dropped, not applied',
    run() {
      const bus = createRestActionBus(clock());
      bus.emit({ kind: 'extend', seconds: 60 }, 'old-session');
      const heard = [];
      bus.subscribe((action) => heard.push(action), 'new-session');
      assert.deepEqual(heard, []);
      bus.subscribe((action) => heard.push(action), 'old-session');
      assert.deepEqual(heard, [], 'dropped for good once a screen of another session met it');
    },
  },
  {
    name: 'rest action bus: only the latest of several held actions is kept',
    run() {
      const bus = createRestActionBus(clock());
      bus.emit({ kind: 'extend', seconds: 30 }, 's');
      bus.emit({ kind: 'skip' }, 's');
      const heard = [];
      bus.subscribe((action) => heard.push(action), 's');
      assert.deepEqual(heard, [{ kind: 'skip' }]);
    },
  },
  {
    name: 'rest action bus: with a listener already mounted the action is immediate and nothing is held',
    run() {
      const bus = createRestActionBus(clock());
      const heard = [];
      const unsubscribe = bus.subscribe((action) => heard.push(action), 's');
      bus.emit({ kind: 'extend', seconds: 30 }, 's');
      assert.deepEqual(heard, [{ kind: 'extend', seconds: 30 }]);
      unsubscribe();
      // The screen left; a later subscriber must not receive the old action.
      const later = [];
      bus.subscribe((action) => later.push(action), 's');
      assert.deepEqual(later, []);
    },
  },
  {
    name: 'rest action bus: a screen without a session id accepts a held action, and so does an untagged action',
    run() {
      const bus = createRestActionBus(clock());
      bus.emit({ kind: 'skip' }, 's');
      const heard = [];
      bus.subscribe((action) => heard.push(action));
      assert.equal(heard.length, 1);
      const bus2 = createRestActionBus(clock());
      bus2.emit({ kind: 'skip' });
      const heard2 = [];
      bus2.subscribe((action) => heard2.push(action), 'any');
      assert.equal(heard2.length, 1);
    },
  },
  {
    name: 'rest action bus: wired through the hook module and App, with no timer ahead of the rest actions',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8').replace(/\r\n/g, '\n');
      const hook = read('src/hooks/useRestEndAlert.ts');
      assert.match(hook, /createRestActionBus\(\)/);
      assert.doesNotMatch(hook, /listeners\.forEach/);
      const app = read('src/app/useSessionNotifications.ts');
      // The rest actions are emitted before (outside) the setTimeout; only
      // Finish and Still going stay behind it.
      const timeoutAt = app.indexOf('setTimeout(() => {');
      assert.ok(timeoutAt > 0);
      assert.ok(app.indexOf("emitRestAction({ kind: 'extend', seconds: 30 }, sessionId)") < timeoutAt);
      assert.ok(app.indexOf("emitRestAction({ kind: 'skip' }, sessionId)") < timeoutAt);
      const player = read('src/screens/GuidedPlayerScreen.tsx');
      assert.match(player, /subscribeRestActions\(\(action\) => \{[\s\S]*?\}, session\?\.sessionId \?\? null\)/);
    },
  },
  {
    // #bugs 2026-10-10: "+60 s" on the rest-over alert gave 2:00 one time and
    // 1:00 the next. The alert stays on the lock screen until the app has
    // opened and re-armed the rest; a second press in that gap arrived as a
    // second minute.
    name: 'rest-over +60 s: a second press inside the window is the same tap, a later one is a new minute',
    run() {
      assert.equal(isRepeatedRestOverExtend(null, 1000), false);
      assert.equal(isRepeatedRestOverExtend(1000, 1000), true);
      assert.equal(isRepeatedRestOverExtend(1000, 1000 + REST_OVER_REPEAT_WINDOW_MS - 1), true);
      assert.equal(isRepeatedRestOverExtend(1000, 1000 + REST_OVER_REPEAT_WINDOW_MS), false);
      // A clock that went back is not a repeat to swallow.
      assert.equal(isRepeatedRestOverExtend(5000, 1000), false);
      // Shorter than the minute it adds: the next real alert is never dropped.
      assert.ok(REST_OVER_REPEAT_WINDOW_MS < 60000);

      const fs = require('node:fs');
      const path = require('node:path');
      const hook = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useSessionNotifications.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      const branch = hook.slice(hook.indexOf('} else if (action === ACTION_EXTEND_60) {'));
      const guardAt = branch.indexOf('isRepeatedRestOverExtend(');
      const emitAt = branch.indexOf("emitRestAction({ kind: 'extend', seconds: 60 }");
      assert.ok(guardAt > 0 && emitAt > guardAt, 'the +60 s branch asks before it emits');
      // The +30 s on the running card is not filtered: pressed twice on purpose, it is a minute.
      const thirty = hook.slice(hook.indexOf('if (action === ACTION_EXTEND_30) {'), hook.indexOf('} else if (action === ACTION_EXTEND_60) {'));
      assert.doesNotMatch(thirty, /isRepeatedRestOverExtend/);
    },
  },
];
