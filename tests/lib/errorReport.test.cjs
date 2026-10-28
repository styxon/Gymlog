const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = require('../../src/lib/errorReport');
const {
  ANALYTICS_EVENTS,
  MAX_APP_ERRORS_PER_BATCH,
  MAX_BATCH_EVENTS,
  acceptBatch,
  isValidEvent,
  takeBatch,
} = require('../../src/lib/analytics');

const INSTALL = '12345678-1234-4123-8123-123456789abc';
const AT = '2026-10-03T10:00:00.000Z';

/**
 * The stack formats the two engines really print. Hermes (Android and iOS
 * release builds) names the bundle after "address at"; a development build
 * names Metro's URL; JavaScriptCore prints "fn@path:line:col". The first
 * line of a Hermes stack is the error's own message — free text, and the
 * thing that must never come out.
 */
const HERMES_RELEASE = [
  "TypeError: undefined is not an object (evaluating 'exercise.sets.length') for Jussi's squat at 10:30:45",
  '    at anonymous (address at index.android.bundle:1:1234567)',
  '    at renderWithHooks (address at index.android.bundle:1:98765)',
  '    at apply (native)',
  '    at call (native)',
  '    at updateFunctionComponent (address at index.android.bundle:1:4321)',
  '    at beginWork (address at index.android.bundle:1:700)',
  '    at performUnitOfWork (address at index.android.bundle:1:800)',
].join('\n');

const HERMES_DEV = [
  'ReferenceError: Property x doesn\'t exist',
  '    at render (http://10.0.2.2:8081/index.bundle//&platform=android&dev=true&hot=false&lazy=true&minify=false:12345:67)',
  '    at http://10.0.2.2:8081/index.bundle?platform=android&dev=true:999:1',
].join('\n');

const HERMES_PATH = '    at foo (/data/user/0/app.vinha/files/index.android.bundle:1:2345)';

const JSC = [
  'render@/var/containers/Bundle/Application/ABCD-1234/Vinha.app/main.jsbundle:123:456',
  '_performWork@/var/containers/Bundle/Application/ABCD-1234/Vinha.app/main.jsbundle:789:12',
  'forEach@[native code]',
  'global code@/var/containers/Bundle/Application/ABCD-1234/Vinha.app/main.jsbundle:1:2',
].join('\n');

const appError = (over = {}) => ({
  kind: 'render',
  name: 'TypeError',
  signature: 'a1b2c3d4e5f607',
  frames: ['index.android.bundle:1:2345'],
  screen: 'workout/programDay',
  appVersion: '1.1.0',
  platform: 'android',
  ...over,
});
const appErrorEvent = (over) => ({ name: 'app_error', at: AT, props: appError(over) });
const failedEvent = (over) => ({ name: 'operation_failed', at: AT, props: { op: 'workout_save', code: 'NETWORK', ...over } });

module.exports = [
  {
    name: 'error report: stack frames are bundle:line:col from every real format, and nothing else',
    run() {
      assert.deepEqual(report.parseStackFrames(HERMES_RELEASE), [
        'index.android.bundle:1:1234567',
        'index.android.bundle:1:98765',
        'index.android.bundle:1:4321',
        'index.android.bundle:1:700',
        'index.android.bundle:1:800',
      ]);
      // Dev: the URL's host, query and slashes are gone; only the bundle name stays.
      assert.deepEqual(report.parseStackFrames(HERMES_DEV), ['index.bundle:12345:67', 'index.bundle:999:1']);
      // Directories never survive.
      assert.deepEqual(report.parseStackFrames(HERMES_PATH), ['index.android.bundle:1:2345']);
      assert.deepEqual(report.parseStackFrames(JSC), ['main.jsbundle:123:456', 'main.jsbundle:789:12', 'main.jsbundle:1:2']);
      // At most five, whatever the stack holds.
      assert.equal(report.parseStackFrames(HERMES_RELEASE, 99).length, 5);

      const all = JSON.stringify([HERMES_RELEASE, HERMES_DEV, JSC].map((stack) => report.parseStackFrames(stack)));
      for (const leak of ['Jussi', 'squat', 'exercise', 'ABCD', '/var/', '10.0.2.2', 'platform', 'data/user']) {
        assert.ok(!all.includes(leak), `a frame leaked "${leak}"`);
      }
      // Not a stack: nothing.
      assert.deepEqual(report.parseStackFrames(undefined), []);
      assert.deepEqual(report.parseStackFrames(''), []);
      assert.deepEqual(report.parseStackFrames('Error: it broke at 10:30:45'), []);
      assert.deepEqual(report.parseStackFrames('santeri@example.com:1:2'), [], 'an email is not a bundle file');
      assert.deepEqual(report.parseStackFrames('    at native'), []);
    },
  },
  {
    name: 'error report: the message lines at the top of a stack are never read as frames',
    run() {
      // A message that looks like a JavaScriptCore frame ("name@file:line:col")
      // sits above the real frames in both engines' stacks.
      const hermes = [
        'Error: user john@secret.js:3:4',
        '    at anonymous (address at index.android.bundle:1:100)',
      ].join('\n');
      assert.deepEqual(report.parseStackFrames(hermes), ['index.android.bundle:1:100']);

      const jsc = ['TypeError: bad input from john@secret.js:3:4', 'render@main.jsbundle:5:6'].join('\n');
      assert.deepEqual(report.parseStackFrames(jsc), ['main.jsbundle:5:6']);

      // A multi-line message, each line shaped like a frame of one engine or the other.
      const multi = [
        'Error: first line santeri@secret.js:1:2',
        'second line: x@other.js:7:8',
        '    at f (address at index.android.bundle:9:10)',
      ].join('\n');
      assert.deepEqual(report.parseStackFrames(multi), ['index.android.bundle:9:10']);

      // The message alone is no stack at all.
      assert.deepEqual(report.parseStackFrames('Error: user john@secret.js:3:4'), []);
      assert.deepEqual(report.parseStackFrames('Error john@secret.js:3:4'), []);
    },
  },
  {
    name: 'error report: the name is a class name or "Error", never a sentence; a thrown string is NonError',
    run() {
      assert.equal(report.errorNameOf(new TypeError('x')), 'TypeError');
      assert.equal(report.errorNameOf(new RangeError('x')), 'RangeError');
      const odd = new Error('x');
      odd.name = 'Cannot find exercise Barbell Squat';
      assert.equal(report.errorNameOf(odd), 'Error', 'a name with spaces is text, not a class');
      odd.name = 'A'.repeat(41);
      assert.equal(report.errorNameOf(odd), 'Error', 'capped at 40');
      assert.equal(report.errorNameOf('jussi@example.com'), 'NonError');
      assert.equal(report.errorNameOf(undefined), 'NonError');
      assert.equal(report.errorNameOf(null), 'NonError');
      // Only an Error gives a name: any other object's `name` is whatever it was given.
      assert.equal(report.errorNameOf({}), 'NonError');
      assert.equal(report.errorNameOf({ name: 'Santeri' }), 'NonError');
      assert.equal(report.errorNameOf({ name: 'Santeri', stack: 'x' }), 'NonError');
      assert.equal(report.errorNameOf({ name: 'TypeError' }), 'TypeError', 'another realm\'s built-in class');
      assert.equal(report.errorNameOf({ name: 'MyOwnError' }), 'NonError');
      // …and its stack is not read either.
      const props = report.buildAppErrorProps({
        kind: 'js_error',
        error: { name: 'Santeri', stack: '    at f (address at index.android.bundle:1:2)' },
        screen: 'unknown',
        appVersion: '1.1.0',
        platform: 'android',
      });
      assert.equal(props.name, 'NonError');
      assert.deepEqual(props.frames, []);
    },
  },
  {
    name: 'error report: a sign-in that ended is a known state, not a failure to count',
    run() {
      assert.equal(report.isExpectedOperationOutcome('sign_in', 'SESSION_REVOKED'), true);
      assert.equal(report.isExpectedOperationOutcome('sign_in', 'SESSION_EXPIRED'), true);
      assert.equal(report.isExpectedOperationOutcome('sign_in', 'UNKNOWN'), false);
      assert.equal(report.isExpectedOperationOutcome('sign_in', 'NETWORK'), false);
      assert.equal(report.isExpectedOperationOutcome('backup_upload', 'SESSION_REVOKED'), false);
    },
  },
  {
    name: 'error report: a signature groups the same bug and tells different ones apart',
    run() {
      const frames = ['index.android.bundle:1:100', 'index.android.bundle:1:200', 'index.android.bundle:1:300'];
      const base = report.errorSignature('TypeError', frames);
      assert.match(base, /^[0-9a-f]{14}$/);
      assert.equal(report.errorSignature('TypeError', frames), base, 'stable');
      assert.notEqual(report.errorSignature('RangeError', frames), base, 'the class is part of it');
      assert.notEqual(report.errorSignature('TypeError', ['index.android.bundle:1:101', ...frames.slice(1)]), base);
      // Only the top three name the bug: who called it varies.
      assert.equal(report.errorSignature('TypeError', [...frames, 'index.android.bundle:1:400']), base);
      // No frames is still a signature.
      assert.match(report.errorSignature('NonError', []), /^[0-9a-f]{14}$/);
    },
  },
  {
    name: 'error report: building a report reads the name and the stack and never the message',
    run() {
      const error = new TypeError("Cannot read 'sets' of Jussi's squat — santeri@example.com");
      error.stack = HERMES_RELEASE;
      const props = report.buildAppErrorProps({
        kind: 'js_error',
        error,
        screen: 'home/dashboard',
        appVersion: '1.1.0',
        platform: 'ios',
      });
      assert.equal(report.isValidAppErrorProps(props), true);
      assert.equal(props.name, 'TypeError');
      assert.equal(props.platform, 'ios');
      const text = JSON.stringify(props);
      for (const leak of ['Jussi', 'santeri', 'squat', 'Cannot read']) {
        assert.ok(!text.includes(leak), `the report leaked "${leak}"`);
      }
      assert.ok(!('message' in props));
      // Unregistered build / unknown screen fall to the closed "unknown" values.
      const bare = report.buildAppErrorProps({ kind: 'render', error: 'boom', screen: 'x/y', appVersion: null, platform: undefined });
      assert.equal(bare.screen, 'unknown');
      assert.equal(bare.appVersion, 'unknown');
      assert.equal(bare.platform, 'unknown');
      assert.equal(bare.name, 'NonError');
      assert.equal(report.isValidAppErrorProps(bare), true);
    },
  },
  {
    name: 'error report: the vocabulary is closed — a message field, a path, a long list or a stray key rejects the event',
    run() {
      assert.equal(isValidEvent(appErrorEvent()), true);
      assert.equal(isValidEvent(failedEvent()), true);

      // The mutation this test exists for: a message field.
      assert.equal(isValidEvent(appErrorEvent({ message: 'Cannot find exercise Squat' })), false);
      assert.equal(isValidEvent(failedEvent({ message: 'x' })), false);
      assert.equal(isValidEvent(failedEvent({ detail: 'x' })), false);

      assert.equal(isValidEvent(appErrorEvent({ kind: 'crash' })), false);
      assert.equal(isValidEvent(appErrorEvent({ name: 'Cannot find exercise' })), false);
      assert.equal(isValidEvent(appErrorEvent({ name: 'A'.repeat(41) })), false);
      assert.equal(isValidEvent(appErrorEvent({ signature: 'not hex!' })), false);
      assert.equal(isValidEvent(appErrorEvent({ frames: Array(6).fill('index.android.bundle:1:2') })), false, 'at most five frames');
      assert.equal(isValidEvent(appErrorEvent({ frames: ['src/lib/analytics.ts:1:2'] })), false, 'no path');
      assert.equal(isValidEvent(appErrorEvent({ frames: ['index.android.bundle'] })), false);
      assert.equal(isValidEvent(appErrorEvent({ frames: 'index.android.bundle:1:2' })), false);
      assert.equal(isValidEvent(appErrorEvent({ screen: 'home/Jussi' })), false);
      assert.equal(isValidEvent(appErrorEvent({ screen: 'workout/programDay/extra' })), false);
      assert.equal(isValidEvent(appErrorEvent({ appVersion: '1.1.0 beta test' })), false);
      assert.equal(isValidEvent(appErrorEvent({ platform: 'windows' })), false);
      for (const key of ['kind', 'name', 'signature', 'frames', 'screen', 'appVersion', 'platform']) {
        const event = appErrorEvent();
        delete event.props[key];
        assert.equal(isValidEvent(event), false, `${key} is required`);
      }
      assert.equal(isValidEvent({ name: 'app_error', at: AT }), false, 'a report needs its fields');
      assert.equal(isValidEvent({ name: 'operation_failed', at: AT }), false);

      assert.equal(isValidEvent(failedEvent({ op: 'delete_everything' })), false);
      assert.equal(isValidEvent(failedEvent({ code: 'Network request failed' })), false, 'a code is from the closed list');
      assert.equal(isValidEvent(failedEvent({ code: 'UNKNOWN' })), true);

      // And the two shapes belong to their events only.
      assert.equal(isValidEvent({ name: 'app_open', at: AT, props: appError() }), false);
      assert.equal(isValidEvent({ name: 'app_open', at: AT, props: { op: 'sign_in', code: 'UNKNOWN' } }), false);
      assert.equal(isValidEvent({ name: 'app_error', at: AT, props: { op: 'sign_in', code: 'UNKNOWN' } }), false);
      assert.ok(ANALYTICS_EVENTS.includes('app_error') && ANALYTICS_EVENTS.includes('operation_failed'));
    },
  },
  {
    name: 'error report: every screen key an AppRoute can have is in the closed set, and nothing else is',
    run() {
      const routes = fs.readFileSync(path.join(__dirname, '../../src/navigation/routes.ts'), 'utf8');
      const pairs = [...routes.matchAll(/tab: '(\w+)';\s*\r?\n\s*screen: '(\w+)'/g)];
      assert.ok(pairs.length > 30, 'the route list was not read');
      for (const [, tab, screen] of pairs) {
        assert.equal(report.screenKeyForRoute({ tab, screen }), `${tab}/${screen}`);
      }
      assert.equal(report.screenKeyForRoute({ tab: 'home', screen: 'dashboard' }), 'home/dashboard');
      assert.equal(report.screenKeyForRoute({ tab: 'home', screen: 'nonsense' }), 'unknown');
      assert.equal(report.screenKeyForRoute({ tab: 'nope', screen: 'list' }), 'unknown');
      assert.equal(report.screenKeyForRoute(null), 'unknown');
      assert.equal(report.isValidScreenKey('onboarding'), true);
      assert.equal(report.isValidScreenKey('__proto__/list'), false);
      assert.equal(report.isValidScreenKey('home/constructor'), false);
    },
  },
  {
    name: 'error report: a failure code is the closed one the text maps to, and UNKNOWN for anything else',
    run() {
      const code = report.operationFailureCode;
      assert.equal(code('NETWORK'), 'NETWORK');
      assert.equal(code('STORE_UNAVAILABLE'), 'STORE_UNAVAILABLE');
      assert.equal(code('PAYLOAD_TOO_LARGE'), 'PAYLOAD_TOO_LARGE');
      assert.equal(code('INVALID_TOKEN'), 'INVALID_TOKEN');
      assert.equal(code('SESSION_REVOKED'), 'SESSION_REVOKED');
      assert.equal(code('STORAGE_FAILED'), 'STORAGE_FAILED');
      assert.equal(code('RATE_LIMITED'), 'RATE_LIMITED');
      assert.equal(code('HTTP_503'), 'SERVER_ERROR');
      assert.equal(code('HTTP_413'), 'PAYLOAD_TOO_LARGE');
      assert.equal(code('HTTP_401'), 'INVALID_TOKEN');
      assert.equal(code(new Error('database or disk is full')), 'QUOTA');
      assert.equal(code(new Error('Network request failed')), 'NETWORK');
      assert.equal(code(new Error('AsyncStorage: failed to write the row')), 'STORAGE_FAILED');
      assert.equal(code('MISSING_SERVER_CONFIG'), 'UNKNOWN', 'a server code that is not in the list is UNKNOWN');
      assert.equal(code("Cannot find exercise Jussi's squat"), 'UNKNOWN');
      assert.equal(code(undefined), 'UNKNOWN');
      assert.equal(code(42), 'UNKNOWN');
      for (const input of ['NETWORK', 'HTTP_500', new Error('x'), 'free text', undefined]) {
        assert.ok(report.OPERATION_CODES.includes(code(input)));
      }
    },
  },
  {
    name: 'error report: the budget — one per signature, ten distinct errors and twenty failures a launch',
    run() {
      let budget = report.emptyErrorBudget();
      let result = report.admitAppError(budget, 'aaaaaaaaaaaa01');
      assert.equal(result.admitted, true);
      budget = result.budget;
      result = report.admitAppError(budget, 'aaaaaaaaaaaa01');
      assert.equal(result.admitted, false, 'the same signature twice in a launch');

      budget = report.emptyErrorBudget();
      let admitted = 0;
      for (let index = 0; index < 50; index += 1) {
        const next = report.admitAppError(budget, `aaaaaaaaaaaa${String(index).padStart(2, '0')}`);
        budget = next.budget;
        admitted += next.admitted ? 1 : 0;
      }
      assert.equal(admitted, report.MAX_APP_ERRORS_PER_LAUNCH);
      assert.equal(report.MAX_APP_ERRORS_PER_LAUNCH, 10);

      budget = report.emptyErrorBudget();
      const first = report.admitOperationFailure(budget, 'backup_upload', 'NETWORK');
      assert.equal(first.admitted, true);
      assert.equal(report.admitOperationFailure(first.budget, 'backup_upload', 'NETWORK').admitted, false, 'an offline phone is one finding');
      assert.equal(report.admitOperationFailure(first.budget, 'backup_upload', 'QUOTA').admitted, true);
      assert.equal(report.admitOperationFailure(first.budget, 'workout_save', 'NETWORK').admitted, true);

      budget = report.emptyErrorBudget();
      let failures = 0;
      for (const op of report.FAILED_OPERATIONS) {
        for (const failureCode of report.OPERATION_CODES) {
          const next = report.admitOperationFailure(budget, op, failureCode);
          budget = next.budget;
          failures += next.admitted ? 1 : 0;
        }
      }
      assert.equal(failures, report.MAX_OPERATION_FAILURES_PER_LAUNCH);
      assert.equal(report.MAX_OPERATION_FAILURES_PER_LAUNCH, 20);
    },
  },
  {
    name: 'error report: a batch is taken whole under the server caps, and the rest waits at the front',
    run() {
      const funnel = Array.from({ length: 30 }, () => ({ name: 'app_open', at: AT }));
      const errors = Array.from({ length: 30 }, () => appErrorEvent());
      const queue = [...errors, ...funnel];

      const batch = takeBatch(queue);
      assert.equal(batch.filter((event) => event.name === 'app_error').length, MAX_APP_ERRORS_PER_BATCH);
      // Order is kept and the cut falls at the first event over the cap.
      assert.equal(batch.length, MAX_APP_ERRORS_PER_BATCH);
      assert.equal(
        acceptBatch({ installId: INSTALL, sentAt: AT, events: batch }).dropped,
        0,
        'the batch the client builds is one the server takes whole',
      );
      const rest = queue.slice(batch.length);
      assert.equal(takeBatch(rest)[0].name, 'app_error', 'the remainder leads the next batch');

      // The server drops what the client never builds, and keeps the rest.
      const overErrors = acceptBatch({ installId: INSTALL, sentAt: AT, events: errors });
      assert.equal(overErrors.batch.events.length, MAX_APP_ERRORS_PER_BATCH, 'over the per-batch error cap');
      assert.equal(overErrors.dropped, 10);
      const overFailures = acceptBatch({ installId: INSTALL, sentAt: AT, events: Array.from({ length: 41 }, () => failedEvent()) });
      assert.equal(overFailures.batch.events.length, 40, 'over the per-batch failure cap');
      assert.equal(overFailures.dropped, 1);
      const mixed = acceptBatch({ installId: INSTALL, sentAt: AT, events: [appErrorEvent(), failedEvent(), ...funnel] });
      assert.equal(mixed.dropped, 0);

      // The ordinary queue still goes a hundred at a time.
      const busy = Array.from({ length: 250 }, () => ({ name: 'app_open', at: AT }));
      assert.equal(takeBatch(busy).length, MAX_BATCH_EVENTS);
    },
  },
];
