const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const empty = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
const guided = read('src', 'screens', 'GuidedPlayerScreen.tsx');
const tab = read('src', 'app', 'renderWorkoutTab.tsx');
const i18n = read('src', 'lib', 'i18n.ts');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const { createHookRuntime, deferred, flush, requireWithStubs } = require('../helpers/hookHarness.cjs');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { windowBefore } = require('../helpers/sourceSlices.cjs');

/** The arguments a screen passes to the moment, comments dropped. */
function momentCall(source, name) {
  const code = strip(source);
  const start = code.indexOf('useRestAlertPermissionMoment({');
  assert.ok(start >= 0, `${name} does not call the moment`);
  const end = code.indexOf('\n  });', start);
  assert.ok(end > start, `${name}: the call has no end`);
  return code.slice(start, end);
}

/**
 * The compiled moment under the hook harness, with the OS replaced: the
 * permission and its dialog, the exact-alarm grant and its settings page,
 * and AppState, whose events the test sends.
 */
function loadMoment(runtime) {
  const listeners = new Set();
  const os = { permission: 'undetermined', channelMuted: false, exact: false, opened: 0, dialog: null };
  const AppState = {
    currentState: 'active',
    addEventListener(type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const { useRestAlertPermissionMoment } = requireWithStubs(
    path.join(__dirname, '..', '..', '.test-dist', 'hooks', 'useRestAlertPermissionMoment.js'),
    {
      react: runtime.react,
      'react-native': { AppState },
      '../utils/exactAlarm': {
        canScheduleExactAlarms: async () => os.exact,
        openExactAlarmSettings: async () => {
          os.opened += 1;
        },
      },
      '../utils/sessionNotifications': {
        getRestAlertPermission: async () => os.permission,
        isRestAlertChannelBlocked: async () => os.channelMuted,
        requestRestAlertPermission: () => os.dialog.promise,
      },
    },
  );
  return {
    os,
    hook: useRestAlertPermissionMoment,
    emit(state) {
      AppState.currentState = state;
      [...listeners].forEach((listener) => listener(state));
    },
    get listening() {
      return listeners.size;
    },
  };
}

/** Mounted onto a running rest, with the OS answer in and the sheet up. */
async function openSheet(runtime, env, props) {
  runtime.render(env.hook, props);
  await flush();
  runtime.render(env.hook, props);
  const moment = runtime.render(env.hook, props);
  assert.equal(moment.sheetOpen, true, 'the sheet did not open for an undetermined permission');
  return moment;
}

/**
 * The first-rest permission moment, measured on the emulator 2026-09-02:
 * three rests in an empty workout, one ladder. The ask granted the OS
 * permission and mirrored the rest that prompted it, and never touched the
 * master switch every later rest was gated on. The guided player never
 * asked at all. Source guards, because the moment is wiring across four
 * files and the pure rule is tested in tests/lib/restAlertAnswer.test.cjs.
 */
module.exports = [
  {
    /**
     * #bugs, 2026-09-26: a reader can grant the app's notification permission
     * and still mute the rest-alert channel itself in Android's settings. The
     * banner used to check `permission` alone, which stays 'granted' the
     * whole time — so the rest ran with no warning and no alert either.
     */
    name: 'rest alerts: a muted rest-alert channel shows the same banner as a refused permission, permission granted or not',
    async run() {
      const runtime = createHookRuntime();
      const env = loadMoment(runtime);
      env.os.permission = 'granted';
      env.os.channelMuted = true;
      const props = { restRunning: true, restKey: 'muted-channel', asked: true, alertsWanted: true, onAnswered: () => undefined };

      runtime.render(env.hook, props);
      await flush();
      runtime.render(env.hook, props);
      const moment = runtime.render(env.hook, props);
      assert.equal(
        moment.deniedBannerShown,
        true,
        'a muted rest-alert channel with the permission granted showed no banner',
      );

      // And the channel back on, nothing to warn about.
      const runtime2 = createHookRuntime();
      const clear = loadMoment(runtime2);
      clear.os.permission = 'granted';
      clear.os.channelMuted = false;
      runtime2.render(clear.hook, props);
      await flush();
      runtime2.render(clear.hook, props);
      const clean = runtime2.render(clear.hook, props);
      assert.equal(clean.deniedBannerShown, false);
    },
  },
  {
    /**
     * Emulator, 2026-09-30: the permission granted in system settings in the
     * middle of a rest, alarms armed — and the banner still said "the timer
     * only runs while this screen is open". The answer is read again on every
     * return to the app, and the banner follows it.
     */
    name: 'rest alerts: the "alerts are off" banner goes once the reader allows them in system settings',
    async run() {
      const runtime = createHookRuntime();
      const env = loadMoment(runtime);
      env.os.permission = 'denied';
      const props = { restRunning: true, restKey: 'settings-grant', asked: true, alertsWanted: true, onAnswered: () => undefined };

      runtime.render(env.hook, props);
      await flush();
      runtime.render(env.hook, props);
      assert.equal(runtime.render(env.hook, props).deniedBannerShown, true, 'no banner for a refused permission');

      // Allowed in Android's settings, then back to the app.
      env.os.permission = 'granted';
      env.emit('background');
      env.emit('active');
      await flush();
      assert.equal(runtime.render(env.hook, props).deniedBannerShown, false, 'the banner outlived the grant');
      runtime.unmount();
    },
  },
  {
    name: 'rest alerts: both workout screens ask at the first rest through the one hook, and render the sheet',
    run() {
      for (const [name, src] of [['EmptyWorkoutScreen', empty], ['GuidedPlayerScreen', guided]]) {
        assert.match(src, /useRestAlertPermissionMoment\(\{/, `${name} does not use the shared moment`);
        assert.match(src, /<RestAlertsSheet\s+visible=\{restAsk\.sheetOpen\}/, `${name} does not render the sheet from it`);
        assert.match(src, /onAnswered: onRestAlertsAnswered,/, `${name} does not report the answer`);
      }
      // And the hook asks only once the OS answer is in: a screen that mounts
      // onto a running rest must not show the sheet for a permission that was
      // never undetermined.
      const hook = read('src', 'hooks', 'useRestAlertPermissionMoment.ts');
      assert.match(hook, /useState<RestAlertPermission \| null>\(null\)/);
      assert.match(hook, /if \(!resolved \|\| !restRunning \|\| restKey === null\)/);
      assert.match(hook, /\}, \[restKey, resolved\]\);/);
      // The empty workout no longer keeps its own copy of the moment.
      assert.doesNotMatch(empty, /const \[permissionSheetOpen|const allowAlerts = async/);
    },
  },
  {
    name: 'rest alerts: the guided player honours the rest-alert switch like the empty workout does',
    run() {
      // The OS mirror goes through one wrapper that reads restAlerts.alerts;
      // the raw hook result is only handed the rest again when permission
      // has just landed.
      assert.match(guided, /syncRestEndAlert\(restAlerts\.alerts \? endsAtMs : null, nextName, recovery\)/);
      const rawCalls = (guided.match(/syncRestEndAlert\(/g) ?? []).length;
      assert.equal(rawCalls, 1, 'the raw sync is called from the wrapper only');
      // The sheet freezes the step, so a short rest cannot expire behind the
      // ask; unfreezing re-runs the step effect, which mirrors the rest.
      // addExerciseOpen joined the list 2026-09-29: the cooldown intro's
      // "Lisää liike" sheet is the same kind of overlay as the others here.
      // The list lives in lib/guidedClockHold since 2026-10-06.
      assert.match(guided, /const frozen = guidedClockHeld\(\{[^}]*restAlertsAskOpen: restAsk\.sheetOpen,[^}]*\}\);/);
      assert.match(guided, /restAlerts\?: \{ alerts: boolean; warning: boolean; ongoing: boolean; asked: boolean \};/);
    },
  },
  {
    name: 'rest alerts: the app records the answer through the one rule, for both screens',
    run() {
      assert.match(tab, /import \{ restAlertsAnswered \} from '\.\.\/lib\/restAlertAnswer';/);
      // From the stored prefs (the function form), not the render's (2026-09-26).
      const writes = tab.match(/notificationPrefs: restAlertsAnswered\(current\.notificationPrefs, outcome\)/g) ?? [];
      assert.equal(writes.length, 2, 'both screens write the answer through restAlertsAnswered');
      assert.doesNotMatch(tab, /onRestAlertsAsked/);
      // Both screens are told whether the ask has happened.
      assert.equal((tab.match(/asked: preferences\.notificationPrefs\.restAlertsAsked,/g) ?? []).length, 2);
    },
  },
  {
    name: 'rest alerts: their own switches and the OS decide them, not the Notifications switch',
    run() {
      // User decision 2026-09-17. `pushEnabled && restAlerts` left the
      // end-of-rest alert silent on every phone where the first-rest ask never
      // opened: Android 12 and older, or after the trial had asked.
      const code = strip(tab);
      const blocks = code.match(/restAlerts=\{\{[\s\S]*?\}\}/g) ?? [];
      assert.equal(blocks.length, 2, 'both workout screens are handed the rest-alert settings');
      for (const block of blocks) {
        assert.match(block, /alerts: preferences\.notificationPrefs\.restAlerts,/);
        assert.match(block, /ongoing: preferences\.notificationPrefs\.sessionOngoing,/);
        assert.doesNotMatch(block, /pushEnabled|trainingBreak/);
      }
      // The lock-screen card and the idle nudge: their own switches, and the
      // OS permission inside the module. A break does not silence a session.
      // Read across the shell's wiring (App.tsx and src/app), so the guard
      // follows the idle effect wherever the shell keeps it.
      const app = strip(readAppWiring());
      assert.match(
        app,
        /if \(!activeSessionId \|\| activeSessionStatus !== 'active' \|\| !preferences\.notificationPrefs\.idleNudge\) \{\s*void cancelIdleNudge\(\);/,
      );
      // Bounded and asserted: a renamed scheduling call fails here, rather
      // than leaving the window on whatever text ends the file.
      const idle = windowBefore(app, 'void scheduleIdleNudge({', 800);
      assert.ok(idle.includes('!preferences.notificationPrefs.idleNudge) {'), 'the window no longer covers the idle-nudge guard');
      assert.doesNotMatch(idle, /pushEnabled|trainingBreak/);
      const module = strip(read('src', 'utils', 'sessionNotifications.ts'));
      for (const fn of ['export function scheduleRestLadder', 'export function showOngoingSession', 'export function scheduleIdleNudge']) {
        const rest = module.slice(module.indexOf(fn));
        const body = rest.slice(0, rest.search(/\r?\n\}\r?\n/));
        assert.match(body, /\(await getRestAlertPermission\(\)\) !== 'granted'/, `${fn} fires without the OS permission`);
      }
    },
  },
  {
    name: 'rest alerts: an install from before the switch split keeps what its reader chose',
    run() {
      const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
      const { normalizeDatabase } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) =>
        requireDist('storage/database.js'),
      );
      const load = (notificationPrefs) => normalizeDatabase({ preferences: { notificationPrefs } }).preferences.notificationPrefs;

      // The common old install: master never turned on, rest switches at
      // their defaults — which the old screen showed dimmed and locked, so
      // nobody chose them. They are on now, and nothing else moved.
      const untouched = load({ pushEnabled: false, restAlerts: true, restWarning: true, sessionOngoing: true, idleNudge: true });
      assert.equal(untouched.pushEnabled, false);
      assert.equal(untouched.restAlerts, true);
      // A field the install never stored: the shipped default, on.
      const older = load({ pushEnabled: false });
      assert.deepEqual(
        [older.restAlerts, older.restWarning, older.sessionOngoing, older.idleNudge, older.restAlertsAsked],
        [true, true, true, true, false],
      );
      // A reader who switched the alerts off — possible only with the master
      // on — keeps them off, whatever the master says now.
      const chosen = load({ pushEnabled: false, restAlerts: false, restWarning: false, sessionOngoing: true, idleNudge: false });
      assert.deepEqual(
        [chosen.restAlerts, chosen.restWarning, chosen.sessionOngoing, chosen.idleNudge],
        [false, false, true, false],
      );
      // Garbage is not a choice.
      assert.equal(load({ restAlerts: 'no' }).restAlerts, true);
    },
  },
  {
    name: 'rest alerts: saying yes to the ask also opens exact alarms when Android is holding them',
    run() {
      const hook = strip(read('src', 'hooks', 'useRestAlertPermissionMoment.ts'));
      const allow = hook.slice(hook.indexOf('const allow = async'), hook.indexOf('const later ='));
      // The handler of the latest render (native audit, 2026-09-21), and a
      // re-arm waiting for the reader to come back from the settings page.
      assert.match(
        allow,
        /if \(next === 'granted'\) \{\s*onGrantedRef\.current\?\.\(\);\s*if \(\(await canScheduleExactAlarms\(\)\) === false\) \{\s*rearmWhenExactAllowed\(\);\s*void openExactAlarmSettings\(\);/,
      );
      // Unknown is not "no": a build without the native module says nothing.
      const bridge = read('src', 'utils', 'exactAlarm.ts');
      assert.match(bridge, /if \(!native\) \{\s*return null;\s*\}/);
    },
  },
  {
    name: 'rest alerts: the sheet promises what the card does — an end time, and a tap back in',
    run() {
      // The card states the wall-clock end (not a countdown) and every action
      // opens the app (opensAppToForeground), so the old "Countdown on the
      // lock screen, skip without unlocking" promised two things it did not do.
      const b2 = [...i18n.matchAll(/'rest\.perm\.b2': '([^']*)'/g)].map((m) => m[1]);
      assert.equal(b2.length, 2, 'EN and FI');
      for (const line of b2) {
        assert.doesNotMatch(line, /Countdown|without unlocking|Laskuri|ilman avaamista/i);
      }
    },
  },
  {
    name: 'rest alerts: the guided player hands the running rest to the OS once the grant is in',
    run() {
      // The sheet closes before the system dialog answers, so the step effect
      // re-armed the rest while the answer was still "not granted", and
      // without a grant handler nothing armed it after (native audit,
      // 2026-09-21): the rest that prompted the ask never rang.
      const call = momentCall(guided, 'GuidedPlayerScreen');
      assert.match(
        call,
        /onGranted: \(\) => \{\s*const endsAt = endsAtRef\.current;\s*const shown = stepRef\.current;\s*if \(shown\?\.type === 'rest' && endsAt !== null && endsAt > Date\.now\(\)\) \{\s*void syncRestNotification\(\s*endsAt,\s/,
        'the guided player does not re-arm the rest when permission lands',
      );
      // Through the wrapper that honours the rest-alert switch, never the raw sync.
      assert.doesNotMatch(call, /syncRestEndAlert\(/);
      // The freestyle screen keeps its own.
      assert.match(momentCall(empty, 'EmptyWorkoutScreen'), /onGranted: \(\) => \{\s*if \(rest && describeRest\(rest\.endsAtMs, Date\.now\(\)\)\.phase === 'running'\) \{\s*void syncRestAlert\(rest\.endsAtMs\);/);
    },
  },
  {
    name: 'rest alerts: a grant re-arms with the latest handler, and again on coming back with exact alarms allowed',
    async run() {
      const runtime = createHookRuntime();
      const env = loadMoment(runtime);
      const armed = [];
      const props = (tag) => ({
        restRunning: true,
        restKey: 4,
        asked: false,
        alertsWanted: true,
        onAnswered: () => undefined,
        onGranted: () => armed.push(tag),
      });

      const moment = await openSheet(runtime, env, props('opening render'));
      env.os.dialog = deferred();
      const allowing = moment.allow();
      // The screen renders again while the dialog is up — the sheet closed,
      // the step effect re-ran — so the handler the grant should reach is
      // that render's, not the one Allow was pressed in.
      runtime.render(env.hook, props('latest render'));
      env.os.permission = 'granted';
      env.os.dialog.resolve('granted');
      await allowing;
      assert.deepEqual(armed, ['latest render'], 'the grant reached a stale handler, or none');
      assert.equal(env.os.opened, 1, 'the exact-alarm page did not open');

      // The dialog closing reports "active" as well: nothing is allowed yet.
      env.emit('active');
      await flush();
      assert.deepEqual(armed, ['latest render'], 're-armed before exact alarms were allowed');

      // Back from "Alarms & reminders" with the grant: armed again, exactly.
      env.os.exact = true;
      env.emit('background');
      env.emit('active');
      await flush();
      assert.deepEqual(armed, ['latest render', 'latest render'], 'coming back with exact alarms did not re-arm the rest');

      // Once. The listener is gone.
      env.emit('background');
      env.emit('active');
      await flush();
      assert.equal(armed.length, 2);
      // One left: the banner's own refresh on every return, which lives as
      // long as the screen does (emulator, 2026-09-30).
      assert.equal(env.listening, 1, 'the return listener outlived its job');
      runtime.unmount();
    },
  },
  {
    name: 'rest alerts: no return listener when exact alarms are already allowed, and none after leaving the screen',
    async run() {
      const props = { restRunning: true, restKey: 1, asked: false, alertsWanted: true, onGranted: () => undefined };

      // Android 13 and older, or a reader who allowed them before.
      const runtime = createHookRuntime();
      const env = loadMoment(runtime);
      env.os.exact = true;
      const moment = await openSheet(runtime, env, props);
      env.os.dialog = deferred();
      const allowing = moment.allow();
      env.os.dialog.resolve('granted');
      await allowing;
      assert.equal(env.os.opened, 0);
      // Only the banner's refresh listener, no re-arm one.
      assert.equal(env.listening, 1);
      runtime.unmount();
      assert.equal(env.listening, 0);

      // Leaving the workout while the settings page is open drops the listener.
      const second = createHookRuntime();
      const leaving = loadMoment(second);
      let armed = 0;
      const sheet = await openSheet(second, leaving, { ...props, onGranted: () => (armed += 1) });
      leaving.os.dialog = deferred();
      const pending = sheet.allow();
      leaving.os.dialog.resolve('granted');
      await pending;
      // The re-arm listener, beside the banner's refresh.
      assert.equal(leaving.listening, 2);
      second.unmount();
      assert.equal(leaving.listening, 0, 'the return listener outlived the screen');
      leaving.os.exact = true;
      leaving.emit('active');
      await flush();
      assert.equal(armed, 1, 'a screen that was gone re-armed a rest');

      // The screen goes while the grant check for a return is still out.
      const third = createHookRuntime();
      const racing = loadMoment(third);
      let late = 0;
      const open = await openSheet(third, racing, { ...props, onGranted: () => (late += 1) });
      racing.os.dialog = deferred();
      const answer = open.allow();
      racing.os.dialog.resolve('granted');
      await answer;
      racing.os.exact = true;
      racing.emit('active');
      third.unmount();
      await flush();
      assert.equal(late, 1, 'a grant check that outlived the screen armed a rest behind it');
    },
  },
];
