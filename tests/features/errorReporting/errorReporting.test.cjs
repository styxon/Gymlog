const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

const { flush, requireWithStubs } = require('../../helpers/hookHarness.cjs');

/**
 * Error reporting on the phone (2026-10-03): the boundary, the global
 * handlers, the reporter's budget and, end to end, the reader's switch.
 *
 * The client and reporter run for real against a fake AsyncStorage and a fake
 * fetch; the boundary is transpiled from its .tsx and driven without a
 * renderer (React's own element objects are what is inspected).
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, '.test-dist');
const STORAGE_KEY = '@vinha/analytics/v1';
const URL = 'https://example.test/api/events';

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

// ---------------------------------------------------------------------------
// Fakes and loaders
// ---------------------------------------------------------------------------

function memoryStorage() {
  const items = new Map();
  const storage = {
    items,
    writes: 0,
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      storage.writes += 1;
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
  return storage;
}

/** The compiled client against `storage`, built with its URL configured. */
function loadClient(storage) {
  const saved = process.env.EXPO_PUBLIC_ANALYTICS_URL;
  process.env.EXPO_PUBLIC_ANALYTICS_URL = URL;
  try {
    return requireWithStubs(path.join(DIST, 'features', 'analytics', 'analyticsClient.js'), {
      '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    });
  } finally {
    if (saved === undefined) {
      delete process.env.EXPO_PUBLIC_ANALYTICS_URL;
    } else {
      process.env.EXPO_PUBLIC_ANALYTICS_URL = saved;
    }
  }
}

/** The compiled reporter, sending through `client` (the real one) or a recorder. */
function loadReporter(client) {
  return requireWithStubs(path.join(DIST, 'features', 'errorReporting', 'errorReporter.js'), {
    '../analytics/analyticsClient': client,
  });
}

function recorder() {
  const sent = [];
  return {
    sent,
    trackEvent(name, props, options) {
      sent.push({ name, props, options });
    },
  };
}

/** Fake fetch, restored by the caller. */
function withFetch(work) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({}) };
  };
  return Promise.resolve(work(calls)).finally(() => {
    globalThis.fetch = saved;
  });
}

/** Transpile and run a .tsx from src, with stubs for what is not Node's. */
function loadTsx(file, stubs, cache = new Map()) {
  if (cache.has(file)) {
    return cache.get(file);
  }
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module_ = { exports: {} };
  cache.set(file, module_.exports);
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    if (specifier.startsWith('.')) {
      const absolute = path.resolve(path.dirname(file), specifier);
      if (fs.existsSync(`${absolute}.tsx`)) {
        return loadTsx(`${absolute}.tsx`, stubs, cache);
      }
      return require(path.join(DIST, path.relative(SRC, absolute)));
    }
    return require(specifier);
  };
  new Function('require', 'module', 'exports', js)(localRequire, module_, module_.exports);
  cache.set(file, module_.exports);
  return module_.exports;
}

const appError = (message = 'x') => {
  const error = new TypeError(message);
  error.stack = [
    `TypeError: ${message}`,
    '    at anonymous (address at index.android.bundle:1:1234567)',
    '    at renderWithHooks (address at index.android.bundle:1:98765)',
  ].join('\n');
  return error;
};

module.exports = [
  {
    name: 'error reporter: a report names the screen, version and platform, and carries no message',
    run() {
      const { registerAppIdentity } = require(path.join(DIST, 'features', 'appUpdate', 'appUpdateSignal.js'));
      registerAppIdentity('1.1.0', 'android');
      const client = recorder();
      const reporter = loadReporter(client);
      reporter.resetErrorReportBudget();

      reporter.noteRenderedScreen(false, { tab: 'workout', screen: 'programDay' });
      reporter.reportAppError('js_error', appError("Cannot find exercise Jussi's squat — santeri@example.com"));
      assert.equal(client.sent.length, 1);
      const { name, props } = client.sent[0];
      assert.equal(name, 'app_error');
      assert.equal(props.screen, 'workout/programDay');
      assert.equal(props.appVersion, '1.1.0');
      assert.equal(props.platform, 'android');
      assert.equal(props.name, 'TypeError');
      assert.deepEqual(props.frames, ['index.android.bundle:1:1234567', 'index.android.bundle:1:98765']);
      assert.ok(!JSON.stringify(props).includes('Jussi') && !JSON.stringify(props).includes('santeri'));

      reporter.noteRenderedScreen(true, { tab: 'home', screen: 'dashboard' });
      reporter.reportAppError('render', 'a thrown string with a name in it');
      assert.equal(client.sent[1].props.screen, 'onboarding');
      assert.equal(client.sent[1].props.name, 'NonError');
      reporter.resetErrorReportBudget();
      registerAppIdentity(undefined, undefined);
    },
  },
  {
    // Bug hunt 5 (2026-10-03): the identity was registered at the bottom of App.tsx, after App's whole import
    // graph, so a fatal while those modules loaded (what the crash key is for) was reported as 'unknown' build.
    name: 'error reporter: a crash while the app modules load names the build: the identity is registered before App is imported',
    run() {
      const imports = [...read('index.ts').matchAll(/^import (?:[\w{}\s,]+ from )?'([^']+)';/gm)].map((match) => match[1]);
      assert.deepEqual(
        imports.slice(0, 2),
        ['./src/features/errorReporting/installErrorReporting', './src/features/appUpdate/registerAppIdentityAtStartup'],
        'the error handlers first, the identity second',
      );
      assert.ok(imports.indexOf('./App') > 1, 'App after both');
      assert.ok(!/registerAppIdentity\(/.test(read('App.tsx')), 'registered once, before App, not again at its bottom');

      const signal = require(path.join(DIST, 'features', 'appUpdate', 'appUpdateSignal.js'));
      signal.registerAppIdentity(undefined, undefined);
      requireWithStubs(path.join(DIST, 'features', 'appUpdate', 'registerAppIdentityAtStartup.js'), {
        'expo-constants': { __esModule: true, default: { expoConfig: { version: '1.1.0' } } },
        'react-native': { Platform: { OS: 'android' } },
      });
      const client = recorder();
      const reporter = loadReporter(client);
      reporter.resetErrorReportBudget();
      reporter.reportAppError('js_fatal', appError('boom while modules load'), { urgent: true });
      assert.equal(client.sent[0].props.appVersion, '1.1.0');
      assert.equal(client.sent[0].props.platform, 'android');
      reporter.resetErrorReportBudget();
      signal.registerAppIdentity(undefined, undefined);
    },
  },
  {
    name: 'error reporter: the budget holds — one per signature, ten errors and twenty failures a launch',
    run() {
      const client = recorder();
      const reporter = loadReporter(client);
      reporter.resetErrorReportBudget();

      const same = appError();
      for (let index = 0; index < 5; index += 1) {
        reporter.reportAppError('js_error', same);
      }
      assert.equal(client.sent.length, 1, 'the same bug five times is one report');

      // A flood of distinct errors: a different frame each time.
      for (let index = 0; index < 40; index += 1) {
        const error = new RangeError('x');
        error.stack = `RangeError: x\n    at f (address at index.android.bundle:1:${1000 + index})`;
        reporter.reportAppError('js_error', error);
      }
      assert.equal(client.sent.filter((event) => event.name === 'app_error').length, 10);

      const OPS = ['workout_save', 'backup_upload', 'backup_restore', 'database_load', 'workout_load', 'account_delete', 'sign_in'];
      const CODES = ['NETWORK', 'STORE_UNAVAILABLE', 'QUOTA', 'STORAGE_FAILED'];
      for (const op of OPS) {
        for (const code of CODES) {
          reporter.reportOperationFailed(op, code);
          reporter.reportOperationFailed(op, code);
        }
      }
      assert.equal(client.sent.filter((event) => event.name === 'operation_failed').length, 20);
      const first = client.sent.find((event) => event.name === 'operation_failed');
      assert.deepEqual(first.props, { op: 'workout_save', code: 'NETWORK' });
      reporter.resetErrorReportBudget();
    },
  },
  {
    name: 'error reporter: never recursive, never throws, and a development build reports nothing',
    run() {
      // A sink that reports from inside itself, and one that throws.
      let reporter;
      let depth = 0;
      const nested = {
        sent: 0,
        trackEvent() {
          nested.sent += 1;
          depth += 1;
          reporter.reportAppError('js_error', appError('inner'));
          reporter.reportOperationFailed('sign_in');
        },
      };
      reporter = loadReporter(nested);
      reporter.resetErrorReportBudget();
      reporter.reportAppError('js_error', appError('outer'));
      assert.equal(nested.sent, 1, 'an error raised while reporting is dropped');
      assert.equal(depth, 1);

      reporter = loadReporter({
        trackEvent() {
          throw new Error('the sink broke');
        },
      });
      reporter.resetErrorReportBudget();
      assert.doesNotThrow(() => reporter.reportAppError('js_fatal', appError(), { urgent: true }));
      assert.doesNotThrow(() => reporter.reportOperationFailed('workout_save', new Error('x')));
      // …and the guard is released: the next report still works.
      const client = recorder();
      reporter = loadReporter(client);
      reporter.reportAppError('js_error', appError('after'));
      assert.equal(client.sent.length, 1);

      globalThis.__DEV__ = true;
      try {
        reporter.resetErrorReportBudget();
        const before = client.sent.length;
        reporter.reportAppError('js_error', appError('dev'));
        reporter.reportOperationFailed('workout_save', 'NETWORK');
        assert.equal(client.sent.length, before, 'a development build sends nothing');
      } finally {
        delete globalThis.__DEV__;
        reporter.resetErrorReportBudget();
      }
    },
  },
  {
    name: 'error reporting: the global handler reports fatal and non-fatal errors, chains the previous one, and hooks rejections',
    run() {
      const reports = [];
      const calls = [];
      const install = requireWithStubs(path.join(DIST, 'features', 'errorReporting', 'installErrorReporting.js'), {
        './errorReporter': {
          isDevelopmentBuild: () => true, // the module-load install is a no-op here
          reportAppError: () => undefined,
        },
      });
      const report = (...args) => reports.push(args);

      let handler = (error, isFatal) => calls.push(['previous', error, isFatal]);
      const errorUtils = {
        getGlobalHandler: () => handler,
        setGlobalHandler: (next) => {
          handler = next;
        },
      };
      let tracker = null;
      const scope = { ErrorUtils: errorUtils, HermesInternal: { enablePromiseRejectionTracker: (options) => (tracker = options) } };

      install.resetInstallForTests();
      install.installErrorReporting({ scope, report, development: false });

      const boom = new Error('boom');
      handler(boom, true);
      handler(boom, false);
      assert.deepEqual(reports[0], ['js_fatal', boom, { urgent: true }], 'a fatal error is urgent: written before the process ends');
      assert.deepEqual(reports[1], ['js_error', boom, undefined]);
      assert.deepEqual(calls.map((call) => call[0]), ['previous', 'previous'], 'the previous handler still runs, after the report');
      assert.equal(calls[0][2], true);

      assert.ok(tracker, 'the rejection tracker was enabled');
      assert.equal(tracker.allRejections, true);
      tracker.onUnhandled(1, boom);
      assert.deepEqual(reports[2], ['unhandled_rejection', boom]);

      // A report that throws must not stop the original handler.
      install.resetInstallForTests();
      calls.length = 0;
      handler = (error, isFatal) => calls.push(['previous', error, isFatal]);
      install.installErrorReporting({
        scope,
        report: () => {
          throw new Error('reporting broke');
        },
        development: false,
      });
      assert.doesNotThrow(() => handler(boom, true));
      assert.equal(calls.length, 1);

      // A runtime with none of it (web, tests): nothing to hook, nothing thrown.
      install.resetInstallForTests();
      assert.doesNotThrow(() => install.installErrorReporting({ scope: {}, report, development: false }));
      install.resetInstallForTests();
      assert.doesNotThrow(() =>
        install.installErrorReporting({ scope: { ErrorUtils: {}, HermesInternal: {} }, report, development: false }),
      );

      // A development build leaves the red box and Metro's tracker alone.
      install.resetInstallForTests();
      let touched = false;
      install.installErrorReporting({
        scope: { ErrorUtils: { setGlobalHandler: () => (touched = true) } },
        report,
        development: true,
      });
      assert.equal(touched, false);
      install.resetInstallForTests();
    },
  },
  {
    name: 'error reporting: reports obey the reader\'s switch — off queues nothing and sends nothing',
    async run() {
      await withFetch(async (fetchCalls) => {
        // Off from the start (the stored preference said no).
        let storage = memoryStorage();
        let client = loadClient(storage);
        let reporter = loadReporter(client);
        client.setUsageStatisticsEnabled(false);
        await flush();
        reporter.resetErrorReportBudget();
        reporter.reportAppError('js_error', appError());
        reporter.reportOperationFailed('workout_save', 'NETWORK');
        await flush();
        assert.equal(storage.items.size, 0, 'nothing is queued while the switch is off');
        assert.equal(storage.writes, 0);
        assert.equal(fetchCalls.length, 0);

        // Raised before the preference was read, then the answer is no: dropped.
        storage = memoryStorage();
        client = loadClient(storage);
        reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        reporter.reportAppError('js_error', appError());
        await flush();
        client.setUsageStatisticsEnabled(false);
        await flush();
        assert.equal(storage.items.size, 0, 'what queued while the answer was unknown is thrown away');
        assert.equal(fetchCalls.length, 0);

        // On: queued like any usage event, in the same key.
        storage = memoryStorage();
        client = loadClient(storage);
        reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        client.setUsageStatisticsEnabled(true);
        await flush();
        reporter.reportAppError('js_error', appError());
        reporter.reportOperationFailed('backup_upload', 'HTTP_503');
        await flush();
        const queued = JSON.parse(storage.items.get(STORAGE_KEY)).queue;
        assert.deepEqual(queued.map((event) => event.name), ['app_error', 'operation_failed']);
        assert.deepEqual(queued[1].props, { op: 'backup_upload', code: 'SERVER_ERROR' });
        client.setUsageStatisticsEnabled(false); // clears the flush timer, and the queue
        await flush();
        assert.equal(storage.items.size, 0);
        reporter.resetErrorReportBudget();
      });
    },
  },
  {
    name: 'analytics client: a batch the server refuses for good is dropped and the next one flows; a retryable answer keeps it',
    async run() {
      const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
      const REFUSED = json(400, { ok: false, error: 'BAD_REQUEST' });
      const ACCEPTED = json(200, { ok: true, accepted: 1, dropped: 0 });

      /** A client whose timers and network the test drives. */
      async function drive(answers, work) {
        const timers = [];
        const sent = [];
        const savedTimeout = globalThis.setTimeout;
        const savedClear = globalThis.clearTimeout;
        const savedFetch = globalThis.fetch;
        // A clock the timers move: the client refuses to start a batch before
        // its pacing allows (lib/requestPacing), so running a timer is only a
        // flush if the time it was armed for has come.
        const savedNow = Date.now;
        let clockNow = 2_000_000_000_000;
        Date.now = () => clockNow;
        globalThis.setTimeout = (fn, ms) => {
          timers.push({ fn, ms: ms ?? 0 });
          return timers.length;
        };
        globalThis.clearTimeout = () => undefined;
        globalThis.fetch = async (url, init) => {
          sent.push(JSON.parse(init.body).events.map((event) => event.name));
          const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
          if (answer instanceof Error) {
            throw answer;
          }
          return answer;
        };
        try {
          const storage = memoryStorage();
          const client = loadClient(storage);
          client.setUsageStatisticsEnabled(true);
          await flush();
          await work({ client, storage, sent, runTimers: async () => {
            const due = timers.splice(0);
            clockNow += Math.max(0, ...due.map((timer) => timer.ms));
            for (const timer of due) timer.fn();
            await flush();
            await flush();
          } });
          client.setUsageStatisticsEnabled(false);
        } finally {
          Date.now = savedNow;
          globalThis.setTimeout = savedTimeout;
          globalThis.clearTimeout = savedClear;
          globalThis.fetch = savedFetch;
        }
      }
      const queued = (storage) => JSON.parse(storage.items.get(STORAGE_KEY)).queue.map((event) => event.name);

      // A 400: this batch is dropped, and the event tracked after it is sent.
      await drive([REFUSED, ACCEPTED], async ({ client, storage, sent, runTimers }) => {
        client.trackEvent('app_open');
        await flush();
        await runTimers();
        assert.deepEqual(sent, [['app_open']]);
        assert.deepEqual(queued(storage), [], 'the refused batch is not kept to be refused again');
        client.trackEvent('workout_started');
        await flush();
        await runTimers();
        assert.deepEqual(sent, [['app_open'], ['workout_started']], 'the next batch flows');
        assert.deepEqual(queued(storage), []);
      });

      // Behind a refused batch, the rest of the queue still goes out by itself.
      await drive([REFUSED, ACCEPTED], async ({ client, storage, sent, runTimers }) => {
        for (let index = 0; index < 101; index += 1) {
          client.trackEvent('app_open');
        }
        await flush();
        await flush();
        await runTimers();
        assert.equal(sent.length, 1);
        assert.equal(sent[0].length, 100);
        assert.equal(queued(storage).length, 1, 'the 101st waits');
        await runTimers();
        assert.equal(sent.length, 2, 'and is sent on the next flush');
        assert.deepEqual(queued(storage), []);
      });

      // What a later try can fix keeps the batch: a 5xx, no network, a rate
      // limit, "update the app", and an answer that is not our server's.
      for (const answer of [
        json(500, { ok: false, error: 'INTERNAL' }),
        json(503, { ok: false, error: 'SERVICE_PAUSED' }),
        json(429, { ok: false, error: 'RATE_LIMIT' }),
        json(426, { ok: false, error: 'APP_UPDATE_REQUIRED' }),
        json(403, null),
        new Error('Network request failed'),
      ]) {
        await drive([answer], async ({ client, storage, sent, runTimers }) => {
          client.trackEvent('app_open');
          await flush();
          await runTimers();
          assert.equal(sent.length, 1);
          assert.deepEqual(queued(storage), ['app_open'], `kept after ${answer.status ?? answer.message}`);
        });
      }
    },
  },
  {
    name: 'error reporting: a sign-in that ended is not reported, a failed one is',
    run() {
      const client = recorder();
      const reporter = loadReporter(client);
      reporter.resetErrorReportBudget();
      reporter.reportOperationFailed('sign_in', 'SESSION_REVOKED');
      reporter.reportOperationFailed('sign_in', 'SESSION_EXPIRED');
      assert.equal(client.sent.length, 0);
      reporter.reportOperationFailed('sign_in');
      assert.deepEqual(client.sent.map((event) => event.props), [{ op: 'sign_in', code: 'UNKNOWN' }]);
      reporter.resetErrorReportBudget();
      // And the hook no longer raises one for the session that ended.
      const hook = read('src', 'features', 'account', 'useAccountBackup.ts');
      assert.doesNotMatch(hook, /reportOperationFailed\('sign_in', SESSION_REVOKED\)/);
    },
  },
  {
    name: 'error reporting: a fatal error is written to the queue before the handler returns',
    async run() {
      await withFetch(async () => {
        const storage = memoryStorage();
        const client = loadClient(storage);
        const reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        client.setUsageStatisticsEnabled(true);
        await flush();
        // Loads the queue into memory, as the launch's app_open does.
        client.trackEvent('app_open');
        await flush();
        const writesBefore = storage.writes;

        // No await between the report and the look: the process may be gone by then.
        reporter.reportAppError('js_fatal', appError(), { urgent: true });
        assert.equal(storage.writes, writesBefore + 1, 'the write was issued synchronously');
        const stored = JSON.parse(storage.items.get(STORAGE_KEY)).queue;
        assert.equal(stored[stored.length - 1].name, 'app_error');
        assert.equal(stored[stored.length - 1].props.kind, 'js_fatal');

        // After the switch goes off, even an urgent one is not kept.
        client.setUsageStatisticsEnabled(false);
        const writes = storage.writes;
        reporter.resetErrorReportBudget();
        reporter.reportAppError('js_fatal', appError(), { urgent: true });
        await flush();
        assert.equal(storage.writes, writes);
        assert.equal(storage.items.size, 0);
        reporter.resetErrorReportBudget();
      });
    },
  },
  {
    name: 'error reporting: a fatal error before the queue loads is written to its own key at once, and the next launch sends it',
    async run() {
      await withFetch(async () => {
        const CRASH_KEY = '@vinha/analytics/crash';
        const storage = memoryStorage();
        let client = loadClient(storage);
        let reporter = loadReporter(client);
        reporter.resetErrorReportBudget();

        // First moments of a launch: the switch is unknown and no queue is in
        // memory. No await, no flush: the process may be gone by the next tick.
        reporter.reportAppError('js_fatal', appError(), { urgent: true });
        const stored = JSON.parse(storage.items.get(CRASH_KEY));
        assert.equal(stored.length, 1, 'the event was not written in the same tick');
        assert.equal(stored[0].props.kind, 'js_fatal');
        assert.equal(storage.items.has(STORAGE_KEY), false, 'nothing read or wrote the queue first');

        // The process dies. The next launch loads the queue, the switch is on.
        client = loadClient(storage);
        reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        client.setUsageStatisticsEnabled(true);
        await flush();
        const queue = JSON.parse(storage.items.get(STORAGE_KEY)).queue;
        assert.deepEqual(queue.map((event) => event.props && event.props.kind), ['js_fatal']);
        assert.equal(storage.items.has(CRASH_KEY), false, 'a drained crash key is removed');
        client.setUsageStatisticsEnabled(false);
        await flush();
        reporter.resetErrorReportBudget();
      });
    },
  },
  {
    name: 'error reporting: the early-crash key keeps every gate — off writes nothing, an off answer erases it, a failed queue write keeps it',
    async run() {
      await withFetch(async () => {
        const CRASH_KEY = '@vinha/analytics/crash';

        // Switch known off: nothing is written, not even the crash key.
        let storage = memoryStorage();
        let client = loadClient(storage);
        let reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        client.setUsageStatisticsEnabled(false);
        await flush();
        reporter.reportAppError('js_fatal', appError(), { urgent: true });
        await flush();
        assert.equal(storage.items.size, 0);
        assert.equal(storage.writes, 0);

        // Switch unknown, crash, then the stored answer is no: the crash key goes.
        storage = memoryStorage();
        client = loadClient(storage);
        reporter = loadReporter(client);
        reporter.resetErrorReportBudget();
        reporter.reportAppError('js_fatal', appError(), { urgent: true });
        assert.ok(storage.items.has(CRASH_KEY));
        client.setUsageStatisticsEnabled(false);
        await flush();
        assert.equal(storage.items.size, 0, 'a reader who said no keeps no crash record');

        // A stored crash from the last launch, then the answer is no: dropped.
        storage = memoryStorage();
        storage.items.set(CRASH_KEY, JSON.stringify([{ name: 'app_error', at: new Date().toISOString(), props: { kind: 'js_fatal' } }]));
        client = loadClient(storage);
        client.setUsageStatisticsEnabled(false);
        await flush();
        assert.equal(storage.items.size, 0);

        // Junk under the key is ignored, the queue still loads.
        storage = memoryStorage();
        storage.items.set(CRASH_KEY, '{not json');
        client = loadClient(storage);
        client.setUsageStatisticsEnabled(true);
        await flush();
        assert.deepEqual(JSON.parse(storage.items.get(STORAGE_KEY)).queue, []);
        client.setUsageStatisticsEnabled(false);
        await flush();

        // The queue write fails: the crash key stays for the next launch.
        storage = memoryStorage();
        storage.items.set(CRASH_KEY, JSON.stringify([{ name: 'app_error', at: new Date().toISOString(), props: { kind: 'js_fatal' } }]));
        const setItem = storage.setItem;
        storage.setItem = async (key, value) => {
          if (key === STORAGE_KEY) {
            throw new Error('disk full');
          }
          return setItem(key, value);
        };
        client = loadClient(storage);
        client.setUsageStatisticsEnabled(true);
        await flush();
        assert.ok(storage.items.has(CRASH_KEY), 'the event was lost with a failed write');
        client.setUsageStatisticsEnabled(false);
        await flush();
        reporter.resetErrorReportBudget();
      });
    },
  },
  {
    name: 'error boundary: a render error shows the recovery screen and reports it, and Try again remounts',
    run() {
      const reported = [];
      const stubs = {
        'react-native': {
          View: 'View',
          Text: 'Text',
          Pressable: 'Pressable',
          StyleSheet: { create: (styles) => styles },
        },
        'expo-splash-screen': { hideAsync: async () => undefined },
        '../storage/deviceLocale': { resolveDeviceLanguage: () => 'fi' },
        './errorReporter': { reportAppError: (...args) => reported.push(args) },
        '../../storage/workoutAside': { hasWorkoutToPutAside: async () => true, setWorkoutBundleAside: async () => true },
      };
      const cache = new Map();
      const { AppErrorBoundary } = loadTsx(path.join(SRC, 'features', 'errorReporting', 'AppErrorBoundary.tsx'), stubs, cache);
      const { AppCrashScreen } = loadTsx(path.join(SRC, 'components', 'AppCrashScreen.tsx'), stubs, cache);

      // The two halves React calls on a throw.
      assert.equal(typeof AppErrorBoundary.getDerivedStateFromError, 'function', 'a class without it is not a boundary');
      assert.equal(AppErrorBoundary.getDerivedStateFromError(new Error('x')).failed, true);

      const boundary = new AppErrorBoundary({ children: 'the app' });
      boundary.setState = (update) => {
        boundary.state = { ...boundary.state, ...(typeof update === 'function' ? update(boundary.state) : update) };
      };
      let out = boundary.render();
      assert.equal(out.type, React.Fragment);
      assert.equal(out.props.children, 'the app', 'healthy: the app');
      assert.equal(out.key, '0');

      const error = new TypeError('Cannot read sets of Jussi');
      boundary.state = { ...boundary.state, ...AppErrorBoundary.getDerivedStateFromError(error) };
      boundary.componentDidCatch(error);
      assert.deepEqual(reported, [['render', error]]);

      out = boundary.render();
      assert.equal(out.type, AppCrashScreen, 'failed: the recovery screen, not the app');
      assert.equal(typeof out.props.onRetry, 'function');

      assert.equal(out.props.aside, undefined, 'the first failure offers Try again alone');

      out.props.onRetry();
      out = boundary.render();
      assert.equal(out.type, React.Fragment, 'Try again shows the app again');
      assert.equal(out.key, '1', 'under a new key, so every child mounts from scratch');
    },
  },
  {
    name: 'error boundary: the set-aside action appears from the second consecutive failure, and a retry that held resets the count',
    run() {
      const stubs = {
        'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
        'expo-splash-screen': { hideAsync: async () => undefined },
        '../storage/deviceLocale': { resolveDeviceLanguage: () => 'en' },
        './errorReporter': { reportAppError: () => undefined },
        '../../storage/workoutAside': { hasWorkoutToPutAside: async () => true, setWorkoutBundleAside: async () => true },
      };
      const cache = new Map();
      const { AppErrorBoundary, CRASH_SETTLE_MS } = loadTsx(path.join(SRC, 'features', 'errorReporting', 'AppErrorBoundary.tsx'), stubs, cache);

      const timers = [];
      const savedSet = globalThis.setTimeout;
      const savedClear = globalThis.clearTimeout;
      globalThis.setTimeout = (fn, ms) => {
        timers.push({ fn, ms, live: true });
        return timers.length - 1;
      };
      globalThis.clearTimeout = (id) => {
        if (timers[id]) timers[id].live = false;
      };
      try {
        const boundary = new AppErrorBoundary({ children: 'the app' });
        boundary.setState = (update) => {
          boundary.state = { ...boundary.state, ...(typeof update === 'function' ? update(boundary.state) : update) };
        };
        // The workout's failures (marked as the workout tab and the provider mark them): only those offer the action.
        const { markWorkoutFailure } = require(path.join(DIST, 'features', 'errorReporting', 'workoutFailure.js'));
        const fail = () => {
          const error = new Error('x');
          markWorkoutFailure(error);
          boundary.state = { ...boundary.state, ...AppErrorBoundary.getDerivedStateFromError(error) };
          return boundary.render();
        };

        let out = fail();
        assert.equal(out.props.aside, undefined, 'first failure: no second action');
        out.props.onRetry();
        out = fail();
        assert.equal(typeof out.props.aside.run, 'function', 'a retry that failed again offers the second action');
        assert.equal(typeof out.props.aside.isAvailable, 'function');

        // The settle timer firing while the screen is still failed changes nothing.
        const firing = timers.filter((timer) => timer.live);
        assert.ok(firing.length > 0 && firing.every((timer) => timer.ms === CRASH_SETTLE_MS));
        firing[firing.length - 1].fn();
        assert.notEqual(boundary.render().props.aside, undefined);

        // A retry that holds past the window: the next failure is a new first one.
        boundary.render().props.onRetry();
        const settle = timers.filter((timer) => timer.live).pop();
        settle.fn();
        out = fail();
        assert.equal(out.props.aside, undefined, 'a failure long after a retry that worked is a first failure again');

        // Nothing is persisted: a new boundary starts at the first failure.
        assert.equal(new AppErrorBoundary({ children: 'the app' }).state.recentlyRetried, false);
      } finally {
        globalThis.setTimeout = savedSet;
        globalThis.clearTimeout = savedClear;
      }
    },
  },
  {
    name: 'crash screen: the set-aside action remounts only after the copy resolved, never deletes, and its copy promises no restore',
    run() {
      const screen = read('src', 'components', 'AppCrashScreen.tsx');
      const boundary = read('src', 'features', 'errorReporting', 'AppErrorBoundary.tsx');
      const aside = read('src', 'storage', 'workoutAside.ts');

      // Success follows the resolved write (CLAUDE.md): onRetry is the resolve
      // branch of aside.run(), the failure branch only says so.
      assert.match(
        screen,
        /aside\.run\(\)\.then\(\s*\(\) => onRetry\(\),\s*\(\) => \{\s*setMoving\(false\);\s*setMoveFailed\(true\);/,
      );
      assert.doesNotMatch(screen, /AsyncStorage|removeItem|multiRemove|workoutAside/, 'the screen deletes nothing itself');
      // Offered only from the boundary's repeated-failure state, and only when a workout exists.
      assert.match(boundary, /aside=\{this\.state\.recentlyRetried && this\.state\.fromWorkout \? SET_ASIDE : undefined\}/);
      assert.match(screen, /aside && asideAvailable/);
      assert.match(screen, /aside\.isAvailable\(\)/);
      // The copy lands before the live rows go.
      // (The function alone, up to the next export: the restore after it has catches of its own.)
      const start = aside.indexOf('export async function setWorkoutBundleAside');
      const body = aside.slice(start, aside.indexOf('\nexport ', start + 1));
      const copy = body.indexOf('await putCopy(text)');
      const removal = body.indexOf('await removeLargeItem(WORKOUT_STORAGE_KEY)');
      assert.ok(copy > 0 && removal > copy, 'the live bundle is removed before, or without, its copy');
      assert.match(aside, /await setLargeItem\(WORKOUT_ASIDE_STORAGE_KEY, text\)/);
      assert.doesNotMatch(body, /catch/, 'a failed copy must not fall through to the removal');
      // The boundary documents the exception it now is.
      assert.match(boundary, /one deliberate exception \(user 2026-10-03\)/);

      const { t } = require(path.join(DIST, 'lib', 'i18n.js'));
      for (const key of ['appCrash.asideHint', 'appCrash.aside', 'appCrash.asideWorking', 'appCrash.asideFailed']) {
        assert.ok(t('en', key) && t('en', key) !== key, `${key} missing in English`);
        assert.ok(t('fi', key) && t('fi', key) !== key, `${key} missing in Finnish`);
        assert.notEqual(t('en', key), t('fi', key));
        assert.ok(screen.includes(`'${key}'`) || screen.includes('moving ?'), `the screen must use ${key}`);
      }
      assert.match(t('en', 'appCrash.asideHint'), /not deleted/);
      assert.match(t('fi', 'appCrash.asideHint'), /Niitä ei poisteta/);
      // The way back is Settings' Restore set-aside workout (user decision 2026-10-03), and the hint names it;
      // the button and its failure promise nothing more.
      assert.match(t('en', 'appCrash.asideHint'), /bring them back in Settings/);
      assert.match(t('fi', 'appCrash.asideHint'), /Voit palauttaa ne asetuksista/);
      for (const language of ['en', 'fi']) {
        for (const key of ['appCrash.aside', 'appCrash.asideFailed']) {
          assert.doesNotMatch(t(language, key), /restor|recover|undo|palaut|palauta|peru/i, `${language} ${key} promises a way back`);
        }
      }
      // And the body still says what is true beside it.
      assert.match(t('en', 'appCrash.body'), /Nothing has been deleted/);
    },
  },

  {
    name: 'error boundary: the recovery screen says nothing was deleted, in English and Finnish, and the screen and boundary themselves touch no storage',
    run() {
      const { t } = require(path.join(DIST, 'lib', 'i18n.js'));
      assert.match(t('en', 'appCrash.body'), /Nothing has been deleted/);
      assert.match(t('fi', 'appCrash.body'), /Mitään ei ole poistettu/);
      assert.equal(t('en', 'appCrash.retry'), 'Try again');
      assert.equal(t('fi', 'appCrash.retry'), 'Yritä uudelleen');
      assert.notEqual(t('en', 'appCrash.title'), t('fi', 'appCrash.title'));

      const screen = read('src', 'components', 'AppCrashScreen.tsx');
      const boundary = read('src', 'features', 'errorReporting', 'AppErrorBoundary.tsx');
      for (const key of ['appCrash.title', 'appCrash.body', 'appCrash.retry']) {
        assert.ok(screen.includes(`'${key}'`), `the screen must use ${key}`);
      }
      // "Nothing was deleted" must stay true: neither file writes or clears anything
      // itself. The set-aside action goes through storage/workoutAside, which copies first.
      for (const source of [screen, boundary]) {
        assert.doesNotMatch(source, /AsyncStorage|removeItem|resetAllData|clearWorkoutBundle|deleteDatabase|multiRemove/);
      }
      assert.match(screen, /from '\.\.\/theme'/, 'the fixed palette from theme.ts');
    },
  },
  {
    name: 'error reporting: the app is wrapped in the boundary, the handlers install first, and every operation has a call site',
    run() {
      const app = read('App.tsx');
      assert.match(
        app,
        /<AppErrorBoundary>\s*<AppProvider>\s*<ThemedRoot \/>\s*<\/AppProvider>\s*<\/AppErrorBoundary>/,
        'the boundary sits outside both providers',
      );
      assert.match(app, /noteRenderedScreen\(onboardingActive, route\);/);

      const index = read('index.ts');
      const firstImport = /^import .*$/m.exec(index.replace(/^\s*\/\/.*$/gm, ''))[0];
      assert.match(firstImport, /installErrorReporting/, 'installed before the rest of the app loads');

      let sources = app;
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(entry.name)) sources += fs.readFileSync(full, 'utf8');
        }
      };
      walk(SRC);
      const { FAILED_OPERATIONS } = require(path.join(DIST, 'lib', 'errorReport.js'));
      for (const op of FAILED_OPERATIONS) {
        assert.ok(sources.includes(`reportOperationFailed('${op}'`), `no call site reports ${op}`);
      }
      assert.match(sources, /reportAppError\('render'/);
    },
  },
  {
    name: 'error reporting: the privacy policy says error reports are included, what they carry and what they never do',
    run() {
      const { buildLegalDocument, renderLegalDocumentMarkdown } = require(path.join(DIST, 'lib', 'legalDocuments.js'));
      for (const [language, needles] of [
        ['en', [/error reports/i, /the type of error/i, /where in the app’s code/i, /never sent/i, /error messages/i, /Settings → Usage statistics/]],
        ['fi', [/virheraportit/i, /virheen tyyppi/i, /sovelluksen koodissa/i, /ei koskaan lähetetä/i, /virheilmoitusten tekstejä/i, /Asetukset → Käyttötilastot/]],
      ]) {
        const policy = renderLegalDocumentMarkdown(buildLegalDocument('privacy', language, 'both'));
        const section = policy.slice(policy.indexOf(language === 'en' ? '## Usage statistics' : '## Käyttötilastot'));
        const usage = section.slice(0, section.indexOf('\n## ', 5));
        for (const needle of needles) {
          assert.match(usage, needle, `the ${language} usage-statistics section must say ${needle}`);
        }
      }
    },
  },
  {
    // Bug hunt 5 (2026-10-03), user decision: "put the workout aside" only for a crash on a workout screen or
    // while the workout data was applied — not after any repeated crash.
    name: 'error boundary: the set-aside action is offered only for a failure the workout threw, and the workout screens and provider mark theirs',
    run() {
      const failures = require(path.join(DIST, 'features', 'errorReporting', 'workoutFailure.js'));
      const stubs = {
        'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
        'expo-splash-screen': { hideAsync: async () => undefined },
        '../storage/deviceLocale': { resolveDeviceLanguage: () => 'en' },
        './errorReporter': { reportAppError: () => undefined },
        '../../storage/workoutAside': { hasWorkoutToPutAside: async () => true, setWorkoutBundleAside: async () => true },
      };
      const cache = new Map();
      const { AppErrorBoundary } = loadTsx(path.join(SRC, 'features', 'errorReporting', 'AppErrorBoundary.tsx'), stubs, cache);
      const { WorkoutAreaBoundary } = loadTsx(path.join(SRC, 'features', 'errorReporting', 'WorkoutAreaBoundary.tsx'), stubs, cache);

      const savedSet = globalThis.setTimeout;
      globalThis.setTimeout = () => 0;
      try {
        const twice = (makeError) => {
          const boundary = new AppErrorBoundary({ children: 'the app' });
          boundary.setState = (update) => {
            boundary.state = { ...boundary.state, ...(typeof update === 'function' ? update(boundary.state) : update) };
          };
          boundary.state = { ...boundary.state, ...AppErrorBoundary.getDerivedStateFromError(makeError()) };
          boundary.render().props.onRetry();
          boundary.state = { ...boundary.state, ...AppErrorBoundary.getDerivedStateFromError(makeError()) };
          return boundary.render().props.aside;
        };
        assert.equal(twice(() => new Error('a profile screen bug')), undefined, 'a crash from elsewhere offers Try again alone');
        assert.equal(twice(() => 'a thrown string'), undefined);

        // A workout-tab screen's failure, through the area boundary: marked, and thrown on unchanged.
        const area = new WorkoutAreaBoundary({ children: 'the workout tab' });
        assert.equal(area.render(), 'the workout tab');
        const drawn = new TypeError('Cannot read sets of undefined');
        area.state = WorkoutAreaBoundary.getDerivedStateFromError(drawn);
        assert.throws(() => area.render(), (error) => error === drawn, 'the root boundary must see the same failure');
        assert.equal(failures.isWorkoutFailure(drawn), true);
        assert.notEqual(
          twice(() => {
            const error = new Error('player');
            WorkoutAreaBoundary.getDerivedStateFromError(error);
            return error;
          }),
          undefined,
          'a repeated workout-screen failure offers the action',
        );

        // The provider's reducer and summary: marked, thrown on.
        const applied = new Error('hydrate');
        assert.throws(() => failures.markingWorkoutFailures(() => {
          throw applied;
        }), (error) => error === applied);
        assert.equal(failures.isWorkoutFailure(applied), true);
        assert.equal(failures.markingWorkoutFailures(() => 7), 7);
        assert.doesNotThrow(() => failures.markWorkoutFailure('a string'));
        assert.equal(failures.isWorkoutFailure('a string'), false);
        assert.equal(failures.isWorkoutFailure(new Error('unrelated')), false);
      } finally {
        globalThis.setTimeout = savedSet;
      }

      // Wired: the workout tab and the finish screens are drawn inside the area boundary, the provider marks its
      // reducer (where the stored bundle is applied), and the shell marks its read of the session for Home.
      const app = read('App.tsx');
      assert.match(app, /const inWorkoutArea = \(node: React\.ReactNode\) => \(node == null \? node : <WorkoutAreaBoundary>\{node\}<\/WorkoutAreaBoundary>\);/);
      assert.match(app, /content = inWorkoutArea\(renderWorkoutTab\(\{/);
      assert.match(app, /content = inWorkoutArea\(renderWorkoutCompletion\(\{/);
      const provider = read('src', 'features', 'workout', 'WorkoutProvider.tsx');
      assert.match(provider, /useReducer\(markedWorkoutReducer, workoutInitialState\)/);
      assert.match(provider, /const markedWorkoutReducer: typeof workoutReducer = \(state, action\) => markingWorkoutFailures\(\(\) => workoutReducer\(state, action\)\);/);
      assert.match(app, /const homeActiveWorkoutParts = useMemo\(\(\) => markingWorkoutFailures\(\(\) => \{/, 'the session read for Home on every route');
    },
  },
  {
    name: 'settings: Restore set-aside workout shows only while a copy exists, asks first, and says what happened only after it resolved',
    run() {
      const settings = read('src', 'screens', 'SettingsScreen.tsx');
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      const provider = read('src', 'features', 'workout', 'WorkoutProvider.tsx');
      assert.match(settings, /\{onRestoreSetAsideWorkout \? \(\s*<Row/);
      assert.match(settings, /onPress=\{\(\) => setRestoreAsideVisible\(true\)\}/, 'asked first');
      assert.match(settings, /setRestoreAsideVisible\(false\);\s*onRestoreSetAsideWorkout\?\.\(\);/);
      assert.match(profile, /onRestoreSetAsideWorkout=\{\s*workout\.setAsideWorkoutAvailable\s*\?/);
      assert.match(profile, /void workout\.restoreSetAsideWorkout\(\)\.then\(/, 'the toast follows the resolved restore');
      assert.match(provider, /if \(isWorkoutInProgress\(now\.activeSession\) \|\| now\.activeCardio \|\| now\.freestyleDraft\) \{\s*return 'busy';/);
      assert.match(provider, /return await bringBackWorkoutAside\(/);
      const { t } = require(path.join(DIST, 'lib', 'i18n.js'));
      for (const key of [
        'settings.restoreAside',
        'settings.restoreAside.sub',
        'settings.restoreAside.dialog.title',
        'settings.restoreAside.dialog.message',
        'settings.restoreAside.dialog.confirm',
        'settings.restoreAside.done',
        'settings.restoreAside.busy',
        'settings.restoreAside.unreadable',
        'settings.restoreAside.none',
        'settings.restoreAside.failed',
      ]) {
        assert.ok(t('en', key) !== key && t('fi', key) !== key && t('en', key) !== t('fi', key), key);
      }
      assert.match(t('en', 'settings.restoreAside.dialog.message'), /nothing is deleted/);
      assert.match(t('fi', 'settings.restoreAside.dialog.message'), /mitään ei poisteta/);
    },
  },
];
