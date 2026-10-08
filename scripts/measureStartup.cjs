/**
 * Cold start on the connected phone, measured after every APK install.
 *
 *   npm run measure:startup                      3 cold starts, fail over 3500 ms
 *   node scripts/measureStartup.cjs --runs 5 --max-ms 3000 --serial RZCX217J6SV
 *
 * Each run force-stops the app and starts it with `am start -W`, whose
 * TotalTime ends when the native splash hides: the app holds the splash until
 * its first screen is ready, so the figure is the wait the reader sees before
 * the brand animation. The median of the runs is checked against --max-ms.
 *
 * Why it exists: on 2026-10-08 a merge built every crisis phrase when its
 * module loaded, and the cold start went from 2.4 to 9.4 s. The unit suite's
 * module-load budget runs in Node, which is about twenty times faster than
 * Hermes on the phone, so only a start on the device shows a one-second
 * regression. The APK that carried it was built at night and installed in the
 * morning, and nobody measured it until the reader felt it.
 *
 * Reference: 2.4 s on a Galaxy A54 (SM-A546B) after #329, 2026-10-06. The
 * budget is device-specific; on a slower phone, pass --max-ms.
 *
 * Force-stopping is safe for the app's data — an active workout is persisted
 * and restored — but it does close the app, so do not run this mid-set.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'app.vinha';
const ACTIVITY = `${PACKAGE}/.MainActivity`;

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const runs = Number(option('runs', '3'));
const maxMs = Number(option('max-ms', '3500'));
const serial = option('serial', null);

if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(maxMs) || maxMs <= 0) {
  console.error('Usage: node scripts/measureStartup.cjs [--runs N] [--max-ms MS] [--serial SERIAL]');
  process.exit(2);
}

/** adb from the SDK: ANDROID_HOME, then android/local.properties, then the default install. */
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  const localProperties = path.join(process.cwd(), 'android', 'local.properties');
  if (fs.existsSync(localProperties)) {
    const match = fs.readFileSync(localProperties, 'utf8').match(/^sdk\.dir=(.+)$/m);
    if (match) roots.push(match[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\'));
  }
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  if (process.env.HOME) roots.push(path.join(process.env.HOME, 'Library', 'Android', 'sdk'), path.join(process.env.HOME, 'Android', 'Sdk'));
  for (const root of roots.filter(Boolean)) {
    const candidate = path.join(root, 'platform-tools', exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return exe;
}

const adbPath = findAdb();

function adb(...args) {
  const result = spawnSync(adbPath, [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8' });
  if (result.error) {
    console.error(`adb could not run (${adbPath}): ${result.error.message}`);
    process.exit(2);
  }
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const devices = adb('devices').out.split('\n').slice(1).filter((line) => /\tdevice\s*$/.test(line));
if (devices.length === 0) {
  console.error('No device connected (adb devices lists none). Connect the phone and allow USB debugging.');
  process.exit(2);
}
if (devices.length > 1 && !serial) {
  console.error(`Several devices connected; pass --serial. ${devices.map((line) => line.split('\t')[0]).join(', ')}`);
  process.exit(2);
}

const installed = adb('shell', 'dumpsys', 'package', PACKAGE).out;
const version = installed.match(/versionName=(\S+)/)?.[1];
const updated = installed.match(/lastUpdateTime=(.+)/)?.[1]?.trim();
if (!version) {
  console.error(`${PACKAGE} is not installed on the device.`);
  process.exit(2);
}
console.log(`${PACKAGE} ${version}, installed ${updated}`);

/**
 * One cold start's TotalTime, or null. Now and then Android reports a start
 * as `LaunchState: UNKNOWN` with no TotalTime (seen twice on 2026-10-08, once
 * in three runs), so a run is tried up to three times before it counts as
 * failed.
 */
function coldStart() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    adb('shell', 'am', 'force-stop', PACKAGE);
    pause(2500);
    const { out } = adb('shell', 'am', 'start', '-W', '-n', ACTIVITY);
    const total = Number(out.match(/TotalTime:\s*(\d+)/)?.[1]);
    if (Number.isFinite(total)) return total;
    console.log(`  (no TotalTime reported, ${attempt < 3 ? 'retrying' : 'giving up'})`);
    pause(3000);
  }
  return null;
}

const times = [];
for (let run = 1; run <= runs; run += 1) {
  const total = coldStart();
  if (total === null) {
    console.error(`Run ${run}: Android reported no TotalTime in three tries.`);
    process.exit(2);
  }
  times.push(total);
  console.log(`  run ${run}: ${total} ms`);
  pause(1500);
}
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');

const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
console.log(`Cold start median ${median} ms (budget ${maxMs} ms)`);
if (median > maxMs) {
  console.error(
    `Cold start over budget. Trace it before looking at code: module evaluation, first render, data load ` +
      `(see the startup notes in CLAUDE.md under Code review).`,
  );
  process.exit(1);
}
