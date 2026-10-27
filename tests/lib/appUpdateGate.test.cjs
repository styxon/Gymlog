const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

const root = path.join(__dirname, '..', '..');
const DIST = path.join(root, '.test-dist');
const gate = require(path.join(DIST, 'lib', 'appUpdateGate.js'));

// Comments are stripped before the source guards read a file: the comments
// here name the very calls the guards look for.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (file) => strip(fs.readFileSync(path.join(root, file), 'utf8'));

/** A fresh copy of the signal module: it keeps its state at module level. */
function freshSignal() {
  const file = path.join(DIST, 'features', 'appUpdate', 'appUpdateSignal.js');
  delete require.cache[require.resolve(file)];
  return require(file);
}

const headers = (version, platform) => ({
  ...(version === undefined ? {} : { 'x-vinha-app-version': version }),
  ...(platform === undefined ? {} : { 'x-vinha-platform': platform }),
});

module.exports = [
  {
    name: 'app update gate: versions parse as up to three numbers and compare part by part',
    run() {
      assert.deepEqual(gate.parseAppVersion('1.1.0'), [1, 1, 0]);
      assert.deepEqual(gate.parseAppVersion(' 2.10 '), [2, 10, 0]);
      assert.deepEqual(gate.parseAppVersion('3'), [3, 0, 0]);
      for (const bad of ['', '1.2.3.4', '1.2.3-beta', 'v1.2', '1..2', '1.2.', null, undefined, 12]) {
        assert.equal(gate.parseAppVersion(bad), null, `${JSON.stringify(bad)} must not parse`);
      }
      const v = gate.parseAppVersion;
      // Numeric, not string, order: 1.10 is newer than 1.9.
      assert.ok(gate.compareAppVersions(v('1.9.0'), v('1.10.0')) < 0);
      assert.ok(gate.compareAppVersions(v('2.0.0'), v('1.99.99')) > 0);
      assert.equal(gate.compareAppVersions(v('1.2'), v('1.2.0')), 0);
    },
  },
  {
    name: 'app update gate: only a readable version below a readable minimum is refused',
    run() {
      const env = { APP_MIN_VERSION_ANDROID: '1.2.0', APP_MIN_VERSION_IOS: '1.0.0' };
      assert.equal(gate.isAppVersionRefused(headers('1.1.9', 'android'), env), true);
      assert.equal(gate.isAppVersionRefused(headers('1.2.0', 'android'), env), false, 'the minimum itself is allowed');
      assert.equal(gate.isAppVersionRefused(headers('1.1.9', 'ios'), env), false, 'each platform has its own minimum');
      // Every doubt answers no.
      assert.equal(gate.isAppVersionRefused(headers(undefined, undefined), env), false, 'a build from before the header');
      assert.equal(gate.isAppVersionRefused(headers('1.0.0', undefined), env), false);
      assert.equal(gate.isAppVersionRefused(headers('1.0.0', 'web'), env), false);
      assert.equal(gate.isAppVersionRefused(headers('nonsense', 'android'), env), false);
      assert.equal(gate.isAppVersionRefused(headers('1.0.0', 'android'), {}), false, 'no minimum set');
      assert.equal(
        gate.isAppVersionRefused(headers('1.0.0', 'android'), { APP_MIN_VERSION_ANDROID: '1.2.O' }),
        false,
        'a typo in the setting must not lock every phone out',
      );
      // Node hands a repeated header over as an array.
      assert.equal(gate.isAppVersionRefused({ 'x-vinha-app-version': ['1.0.0'], 'x-vinha-platform': ['android'] }, env), true);
    },
  },
  {
    name: 'app update gate: the app raises the prompt only on our own refusal, and opens only a store',
    run() {
      const body = { ok: false, error: gate.APP_UPDATE_REQUIRED };
      assert.equal(gate.isAppUpdateRefusal(426, body), true);
      assert.equal(gate.isAppUpdateRefusal(426, null), false, 'a 426 from a proxy is not our server');
      assert.equal(gate.isAppUpdateRefusal(426, { error: 'SOMETHING_ELSE' }), false);
      assert.equal(gate.isAppUpdateRefusal(400, body), false);

      assert.equal(gate.safeStoreUrl('https://apps.apple.com/app/id123'), 'https://apps.apple.com/app/id123');
      for (const bad of ['http://play.google.com/x', 'https://evil.example/play.google.com', 'https://play.google.com.evil.example/', 'javascript:alert(1)', 42]) {
        assert.equal(gate.safeStoreUrl(bad), null, `${bad} is not a store`);
      }
      assert.equal(gate.appStoreUrl('android', { storeUrl: 'https://evil.example/' }), gate.PLAY_STORE_URL);
      assert.equal(gate.appStoreUrl('ios', {}), null, 'no App Store address until the server names one');
      assert.equal(gate.appStoreUrl('ios', { storeUrl: 'https://apps.apple.com/app/id1' }), 'https://apps.apple.com/app/id1');

      assert.equal(gate.appUpdateRefusalBody(headers('1.0.0', 'android'), {}).storeUrl, gate.PLAY_STORE_URL);
      assert.equal('storeUrl' in gate.appUpdateRefusalBody(headers('1.0.0', 'ios'), {}), false);
      assert.equal(
        gate.appUpdateRefusalBody(headers('1.0.0', 'ios'), { APP_STORE_URL_IOS: 'https://apps.apple.com/app/id9' }).storeUrl,
        'https://apps.apple.com/app/id9',
      );
    },
  },
  {
    name: 'app update signal: headers once registered, and one notice per refusal',
    run() {
      let signal = freshSignal();
      assert.deepEqual(signal.appVersionHeaders(), {}, 'nothing is sent before the app says who it is');
      signal.registerAppIdentity('1.x', 'android');
      assert.deepEqual(signal.appVersionHeaders(), {}, 'an unreadable version is not sent');

      signal = freshSignal();
      signal.registerAppIdentity('1.1.0', 'android');
      assert.deepEqual(signal.appVersionHeaders(), { 'x-vinha-app-version': '1.1.0', 'x-vinha-platform': 'android' });

      const heard = [];
      const unsubscribe = signal.subscribeAppUpdateNotice((notice) => heard.push(notice));
      signal.noteServerAnswer(200, { ok: true });
      signal.noteServerAnswer(426, { ok: false });
      assert.equal(signal.getAppUpdateNotice(), null);
      assert.equal(heard.length, 0);

      signal.noteServerAnswer(426, { ok: false, error: 'APP_UPDATE_REQUIRED' });
      signal.noteServerAnswer(426, { ok: false, error: 'APP_UPDATE_REQUIRED' });
      assert.equal(heard.length, 1, 'a second refused request does not ask again');
      assert.deepEqual(signal.getAppUpdateNotice(), { storeUrl: gate.PLAY_STORE_URL });
      unsubscribe();
    },
  },
  {
    name: 'app update wiring: every request to our server carries the version and reports the answer',
    run() {
      // Every file that makes a request, found rather than listed: a client
      // added later is held to the same rule without anyone naming it here.
      const walk = (dir) =>
        fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : [],
        );
      const clients = [...walk('src'), 'App.tsx'].filter((file) => /\bfetch\(/.test(read(file)));
      for (const known of ['src/features/aiCoach/aiCoachClient.ts', 'src/features/account/backupApi.ts', 'src/features/analytics/analyticsClient.ts']) {
        assert.ok(clients.includes(known), `${known} makes no request any more — update this guard`);
      }
      for (const file of clients) {
        const source = read(file);
        const fetches = source.split(/\bfetch\(/).slice(1);
        assert.ok(fetches.length > 0, `${file}: no requests found`);
        fetches.forEach((after, index) => {
          // Up to the next request: its headers and its answer both belong to this one.
          const call = after.slice(0, after.indexOf('\n  } finally') > 0 ? after.indexOf('\n  } finally') : undefined);
          assert.match(call, /appVersionHeaders\(\)|coachHeaders\(\)/, `${file} request ${index + 1} sends no version`);
          assert.match(call, /noteServerAnswer\(response\.status,/, `${file} request ${index + 1} does not report the answer`);
        });
      }
      assert.match(read('src/features/aiCoach/aiCoachClient.ts'), /function coachHeaders\(\)[^}]*\.\.\.appVersionHeaders\(\)/);

      // Registered from index.ts before App's modules load (bug hunt 2026-10-03), so an early crash's report names it too.
      assert.match(read('src/features/appUpdate/registerAppIdentityAtStartup.ts'), /registerAppIdentity\(Constants\.expoConfig\?\.version \?\? appInfo\.version, Platform\.OS\)/);
      // The dialog mounts in the shell's render tail, which moved to src/app.
      assert.match(
        strip(readAppWiring()),
        /<AppUpdateDialog\s+language=\{preferences\.appLanguage\}\s+held=\{appUpdateHeld\}\s+onShownChange=\{onAppUpdateShownChange\}\s*\/>/,
      );
      // Never over the terms sheet, the tour or a workout in progress (review, 2026-09-28).
      // Bounded on both anchors, read from the whole shell: the hold left
      // App.tsx for a src/app hook in the phase-C split (2026-10-01).
      const held = between(strip(readAppWiring()), 'const appUpdateHeld =', 'const renderLegalConsent');
      assert.match(held, /legalConsentDue !== null/);
      assert.match(held, /isWorkoutInProgress\(workout\.activeSession\)/);
      assert.match(held, /Boolean\(tourElement\)/);
    },
  },
  {
    name: 'app update wiring: the endpoints refuse old builds, never a withdrawal, a restore or a delete',
    run() {
      const refusal = /if \(([^\n]*?)isAppVersionRefused\(req\.headers, process\.env\)\) \{\s*res\.status\(426\)\.json\(appUpdateRefusalBody\(req\.headers, process\.env\)\);\s*return;/;

      const coach = read('api/ai-coach.ts');
      const coachGate = coach.search(refusal);
      assert.ok(coachGate > 0, 'api/ai-coach.ts does not refuse old builds');
      const forget = coach.indexOf('const forgetLogId = readForgetLogId(req.body);');
      assert.ok(forget > 0 && forget < coachGate, 'withdrawing consent must work from any build, so it comes before the refusal');
      assert.ok(coachGate < coach.indexOf('imageInput = parseImageBody(req.body);'), 'the refusal comes before any model call');

      const backup = read('api/backup.ts');
      const backupGate = backup.match(refusal);
      assert.ok(backupGate, 'api/backup.ts does not refuse old builds');
      assert.equal(backupGate[1].trim(), "(req.method === 'PUT' || req.method === 'POST') &&", 'only a write is refused');

      const events = read('api/events.ts');
      const post = events.slice(events.indexOf('async function handlePost('), events.indexOf('async function handleGet('));
      assert.match(post, refusal, 'api/events.ts does not refuse old builds');
    },
  },
  {
    name: 'app update: the version the fallback and Settings show is the one the build is made from',
    run() {
      const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version;
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
      const theme = fs.readFileSync(path.join(root, 'src', 'theme.ts'), 'utf8').match(/version: '([^']+)'/);
      assert.ok(gate.parseAppVersion(appJson), `app.json expo.version ${appJson} must parse, or no build sends a version`);
      assert.equal(theme && theme[1], appJson, 'src/theme.ts appInfo.version must match app.json expo.version');
      assert.equal(pkg, appJson, 'package.json version must match app.json expo.version');
    },
  },
];
