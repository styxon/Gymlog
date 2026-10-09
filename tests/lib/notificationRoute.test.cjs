const assert = require('node:assert/strict');

const { routeForNotification } = require('../../.test-dist/lib/notificationRoute.js');
const fs = require('node:fs');
const path = require('node:path');

const appWiring = require('../helpers/appWiringSource.cjs').readAppWiring();
const handlerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'utils', 'notificationHandler.ts'),
  'utf8',
);
const schedulerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'utils', 'appNotifications.ts'),
  'utf8',
);

/** What the scheduler stamps on its own notifications. */
const PLAN = { gymlogPlan: true };

module.exports = [
  {
    /**
     * The report: tapping "Uusi ennätys" opened the activity calendar. It was
     * not a wrong destination — nothing read the tap at all, so the app
     * resumed the screen it had been left on, which happened to be the
     * calendar (#bugs 2026-09-05).
     */
    name: 'a record notification opens the records page',
    run() {
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'record' }), {
        tab: 'progress',
        screen: 'list',
        section: 'records',
      });
    },
  },
  {
    name: 'a reminder that asks for a number opens where the number is entered',
    run() {
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'weighIn' }), {
        tab: 'progress',
        screen: 'list',
        section: 'measures',
        measure: 'bodyweight',
      });
      // The weekly one NAMES a measurement, so it opens on that one — the
      // same reason the route grew `measure` for the Home stat cards.
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'measure', measureKind: 'hips' }), {
        tab: 'progress',
        screen: 'list',
        section: 'measures',
        measure: 'hips',
      });
      // A kind that did not travel still lands on the list rather than nowhere.
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'measure' }), {
        tab: 'progress',
        screen: 'list',
        section: 'measures',
      });
    },
  },
  {
    name: 'the week in review opens the overview; "come and train" opens Home',
    run() {
      assert.equal(routeForNotification({ ...PLAN, category: 'weekly' }).section, 'overview');
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'comeback' }), { tab: 'home', screen: 'dashboard' });
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'reminder' }), { tab: 'home', screen: 'dashboard' });
    },
  },
  {
    // "Your Pro trial ends soon" fell through to null: the warning the
    // hand-off row promised opened onto whatever screen the app was left on.
    name: 'the trial warning opens the Pro page',
    run() {
      assert.deepEqual(routeForNotification({ ...PLAN, category: 'trial' }), { tab: 'profile', screen: 'premium' });
      // Every category the planner can send has somewhere to go.
      const planner = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'notificationPlan.ts'), 'utf8');
      const union = planner.slice(planner.indexOf('export type NotificationCategory ='), planner.indexOf('export interface PlannedNotification'));
      const categories = [...union.matchAll(/\| '([a-zA-Z]+)'/g)].map((match) => match[1]);
      assert.ok(categories.length >= 7, `read ${categories.join(',')}`);
      for (const category of categories) {
        assert.notEqual(routeForNotification({ ...PLAN, category, measureKind: 'hips' }), null, category);
      }
    },
  },
  {
    /**
     * A notification still pending from an older build can carry a category
     * this one has never heard of. Null leaves the app where it is, which is
     * the behaviour every notification had until today — wrong to keep as the
     * rule, right to keep as the fallback.
     */
    name: 'a notification this build does not understand moves nothing',
    run() {
      assert.equal(routeForNotification({ ...PLAN, category: 'streak-o-meter' }), null);
      assert.equal(routeForNotification({ ...PLAN }), null);
      // A rest-timer notification is not the planner's, and its tap belongs to
      // the OTHER listener — the one that drives the running workout.
      assert.equal(routeForNotification({ gymlogRest: true, category: 'record' }), null);
      assert.equal(routeForNotification({ category: 'record' }), null, 'unmarked data steered the route');
      assert.equal(routeForNotification(null), null);
      assert.equal(routeForNotification('record'), null);
      assert.equal(routeForNotification(undefined), null);
    },
  },
  {
    /**
     * And the app has to LISTEN. The mapping is inert on its own — that was
     * the whole bug, so a test that only exercises the function would have
     * passed against the broken build.
     */
    name: 'the app reads notification taps, cold start included',
    run() {
      // NOT `assert.match(appWiring, /addNotificationResponseReceivedListener/)`:
      // the rest timer has had one of those since long before this, so that
      // assertion passed against the broken build. Every line below names
      // something only the planner's handler does.
      assert.match(appWiring, /routeForNotification\(response\.notification\.request\.content\.data\)/);
      // The cold start: the tap launched the process, and the listener is
      // attached long after the response was delivered. Read once and then
      // CLEARED — the stored response outlives the launch it belongs to, so
      // reading without clearing answers every later cold start with the same
      // tap and the app reopens on Records forever (found in review,
      // 2026-09-05). The async pair is deprecated in expo-notifications 55.
      //
      // Pinned to the cold-start block itself: a bare
      // `/clearLastNotificationResponse\(\)/` is also satisfied by the live
      // listener's clear below, so deleting this one stayed green (#bugs
      // 2026-10-01).
      assert.match(
        appWiring,
        // Read inside a try since it throws on web (#bugs 2026-10-01).
        /cold = Notifications\.getLastNotificationResponse\(\);\s*\} catch \(error\) \{[\s\S]{0,300}?cold = null;\s*\}\s*if \(cold\) \{\s*handle\(cold\);\s*Notifications\.clearLastNotificationResponse\(\);\s*\}/,
      );
      // And a tap while the app runs is forgotten too, once routed: it is
      // stored for as long as the native module lives, which outlasts a
      // remount — and the remount read it back as a cold start.
      assert.match(
        appWiring,
        /addNotificationResponseReceivedListener\(\(response\) => \{\s*handle\(response\);\s*try \{\s*Notifications\.clearLastNotificationResponse\(\);/,
      );
      assert.doesNotMatch(appWiring, /getLastNotificationResponseAsync/);
      // Held until the store is loaded, like the widget's target — a route
      // reset into a half-built app lands somewhere about to re-render.
      assert.match(appWiring, /if \(!appHydrated \|\| !pendingNotificationRoute\)/);
      assert.match(appWiring, /resetToRoute\(\s*pendingNotificationRoute\.tab === 'progress'[\s\S]*?: pendingNotificationRoute,\s*\)/);
      // And the older listener still guards its own notifications, so merging
      // the two cannot quietly hand rest actions to the router.
      assert.match(appWiring, /data\[SESSION_NOTIFICATION_MARKER\] !== true/);
      // The marker is copied into the pure module; this is the copy's leash.
      assert.match(handlerSource, /PLAN_NOTIFICATION_MARKER = 'gymlogPlan'/);

      /*
       * And the wire BETWEEN the two ends. The planner sets measureKind and
       * the router reads it, and both of those have their own test — but the
       * scheduler in the middle is what actually puts it on the notification,
       * and deleting that line broke the feature with every other guard still
       * green (found by mutating it, 2026-09-05). It cannot be required from
       * Node: expo-notifications.
       */
      assert.match(schedulerSource, /category: item\.category,/);
      assert.match(schedulerSource, /measureKind: item\.measureKind,/);
      assert.match(schedulerSource, /\[PLAN_NOTIFICATION_MARKER\]: true,/);
    },
  },
  {
    name: 'a lock-screen action that launched the app runs once the session is back, and "still going" re-arms the nudge (#bugs 2026-10-01)',
    run() {
      const sessionHook = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'app', 'useSessionNotifications.ts'),
        'utf8',
      );
      // Read at mount, only when it is ours — the planner taps stay with the
      // route hook — and held rather than run into an unrestored session.
      assert.match(
        sessionHook,
        /const cold = Notifications\.getLastNotificationResponse\(\);\s*if \(cold && \(cold\.notification\.request\.content\.data \?\? \{\}\)\[SESSION_NOTIFICATION_MARKER\] === true\) \{\s*coldSessionResponseRef\.current = cold;/,
      );
      assert.match(sessionHook, /if \(!appHydrated \|\| !coldSessionResponseRef\.current\) \{/);
      assert.match(sessionHook, /if \(activeSessionId && activeSessionStatus === 'active'\) \{\s*runSessionActionRef\.current\(response\);/);
      // The live listener and the cold start take the same path.
      assert.match(sessionHook, /runSessionActionRef\.current\(response\);\s*\}\);/);
      // The read happens before the route hook's, which clears the store:
      // App.tsx calls this hook first.
      assert.ok(
        appWiring.indexOf('useSessionNotifications({') < appWiring.indexOf('useNotificationRoute({'),
        'the route hook must not clear the cold response before this one reads it',
      );
      // "Still going" and a return to the foreground both feed the idle effect.
      assert.match(sessionHook, /action === ACTION_STILL_GOING\) \{\s*setActivityTick\(/);
      assert.match(sessionHook, /if \(state === 'active'\) \{\s*setActivityTick\(/);
      assert.match(sessionHook, /completedSetCount,\s*activityTick,/);
    },
  },
  {
    // Bug hunt 9, 2026-10-09: Progress holds the section and measure as state
    // the reader can change, and the route's own values compare equal on a
    // second tap, so neither effect ran again.
    name: 'a second tap for the same Progress destination brings the reader back to it',
    run() {
      const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
      const hook = read('src/app/useNotificationRoute.ts');
      assert.match(
        hook,
        /pendingNotificationRoute\.tab === 'progress' && pendingNotificationRoute\.screen === 'list'\s*\?\s*\{ \.\.\.pendingNotificationRoute, openedAt: Date\.now\(\) \}/,
      );
      assert.match(
        read('src/app/renderProgressTab.tsx'),
        /routeOpenedAt=\{route\.screen === 'list' \? route\.openedAt : undefined\}/,
      );
      const screen = read('src/screens/ProgressScreen.tsx');
      assert.match(screen, /setProgressSection\(initialSection\);\s*\}\s*\}, \[initialSection, routeOpenedAt\]\);/);
      assert.match(screen, /\}, \[initialMeasure, routeOpenedAt\]\);/);
      assert.match(read('src/navigation/routes.ts'), /openedAt\?: number;/);
      // The mapping itself stays a plain destination: the stamp is the hook's.
      assert.deepEqual(routeForNotification({ gymlogPlan: true, category: 'record' }), {
        tab: 'progress',
        screen: 'list',
        section: 'records',
      });
    },
  },
];
