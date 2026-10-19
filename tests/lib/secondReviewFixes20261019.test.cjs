const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startKeepAwake } = require('../../.test-dist/lib/keepAwakeLifecycle.js');
const { parseMeasurementIntent, validMeasurementIntent } = require('../../.test-dist/lib/measurementIntent.js');
const { removeTrailingZeros } = require('../../.test-dist/lib/format.js');
const { buildHomeWidgetPayload } = require('../../.test-dist/lib/widgetPayload.js');
const { weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function listSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Second-review findings, 2026-10-19. */
module.exports = [
  {
    name: 'keep-awake: a newer handle whose activation fails does not strand an older active handle',
    async run() {
      let deactivated = 0;
      const deactivate = () => {
        deactivated += 1;
      };
      const older = startKeepAwake(() => Promise.resolve(), deactivate, 'seq-a');
      await tick();
      const newer = startKeepAwake(() => Promise.reject(new Error('native refused')), deactivate, 'seq-a');
      await tick();
      older.release();
      assert.equal(deactivated, 1, 'the older handle is the last holder and must switch the tag off');
      newer.release();
      assert.equal(deactivated, 1, 'a failed handle never switches anything off');
    },
  },
  {
    name: 'keep-awake: an older release waiting on a newer activation that then fails still ends deactivated',
    async run() {
      let deactivated = 0;
      const deactivate = () => {
        deactivated += 1;
      };
      let failNewer;
      const older = startKeepAwake(() => Promise.resolve(), deactivate, 'seq-b');
      await tick();
      const newer = startKeepAwake(() => new Promise((_, reject) => (failNewer = reject)), deactivate, 'seq-b');
      older.release(); // the newer handle is pending, so it still holds the tag
      assert.equal(deactivated, 0);
      failNewer(new Error('late failure'));
      await tick();
      assert.equal(deactivated, 1, 'nobody holds the tag now');
      newer.release();
      assert.equal(deactivated, 1);
    },
  },
  {
    name: 'keep-awake: a stale pending activation cannot be mistaken for a new handle after the tag emptied',
    async run() {
      let deactivated = 0;
      const deactivate = () => {
        deactivated += 1;
      };
      let resolveStale;
      const stale = startKeepAwake(() => new Promise((resolve) => (resolveStale = resolve)), deactivate, 'seq-c');
      stale.release(); // gone before its activation settled
      // A whole later workout on the same tag, which used to reuse generation 1.
      const fresh = startKeepAwake(() => Promise.resolve(), deactivate, 'seq-c');
      await tick();
      resolveStale(); // the stale activation settles mid-workout
      await tick();
      assert.equal(deactivated, 0, 'the stale activation must not switch off the live workout');
      fresh.release();
      assert.equal(deactivated, 1);
    },
  },
  {
    name: 'src has no U+FFFD replacement characters',
    run() {
      const bad = listSources(path.join(root, 'src')).filter((file) => fs.readFileSync(file, 'utf8').includes('�'));
      assert.deepEqual(bad.map((file) => path.relative(root, file)), []);
      assert.match(read('src', 'lib', 'recoverySheet.ts'), /\("Päivä 2"\)/);
    },
  },
  {
    name: 'coach log offer: the same unit and range rule as a typed reading',
    run() {
      // Valid.
      assert.deepEqual(validMeasurementIntent('bodyweight', 82.46, 'kg'), { kind: 'bodyweight', value: 82.5, unit: 'kg' });
      assert.deepEqual(validMeasurementIntent('waist', 90, 'cm'), { kind: 'waist', value: 90, unit: 'cm' });
      assert.deepEqual(validMeasurementIntent('bodyfat', 18, '%'), { kind: 'bodyfat', value: 18, unit: '%' });
      // Out of range, per unit.
      assert.equal(validMeasurementIntent('bodyweight', 24, 'kg'), null);
      assert.equal(validMeasurementIntent('bodyweight', 301, 'kg'), null);
      assert.equal(validMeasurementIntent('waist', 14, 'cm'), null);
      assert.equal(validMeasurementIntent('waist', 251, 'cm'), null);
      assert.equal(validMeasurementIntent('bodyfat', 1, '%'), null);
      assert.equal(validMeasurementIntent('bodyfat', 71, '%'), null);
      // Wrong unit for the kind: body fat is a percentage, the tape is cm.
      assert.equal(validMeasurementIntent('bodyfat', 18, 'cm'), null);
      assert.equal(validMeasurementIntent('waist', 90, '%'), null);
      assert.equal(validMeasurementIntent('waist', 90, 'kg'), null);
      assert.equal(validMeasurementIntent('bodyweight', 80, 'cm'), null);
      // Not numbers.
      assert.equal(validMeasurementIntent('bodyweight', NaN, 'kg'), null);
      assert.equal(validMeasurementIntent('bodyweight', '80', 'kg'), null);
      assert.equal(validMeasurementIntent('bodyweight', 80, undefined), null);
      // The typed path still answers the same way.
      assert.deepEqual(parseMeasurementIntent('vyötärö 90 cm'), { kind: 'waist', value: 90, unit: 'cm' });
      assert.equal(parseMeasurementIntent('paino 500 kg'), null);
    },
  },
  {
    name: 'coach log offer: the chat drops an invalid model value and says so when the write is refused',
    run() {
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(chat, /validMeasurementIntent\(kind, suggestion\.value, suggestion\.unit\)/);
      // "Logged" is said after the awaited write, inside no catch.
      const logged = chat.indexOf("'coachChat.measure.logged'");
      const awaited = chat.indexOf('await onLogMeasurement(offer.intent);');
      const failed = chat.indexOf("'coachChat.measure.failed'");
      assert.ok(awaited > 0 && failed > awaited && logged > failed, 'the success message must come after the failure branch');
      // The provider rejects an implausible weight instead of resolving.
      const provider = read('src', 'state', 'AppProvider.tsx');
      assert.match(provider, /if \(!isPlausibleBodyweightKg\(weightKg\)\) \{\s*throw new Error/);
    },
  },
  {
    name: 'widget: next month carries date keys, and the native side demotes planned days that have passed',
    run() {
      const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
      const payload = buildHomeWidgetPayload({
        nowMs: at(2026, 7, 30),
        language: 'en',
        theme: 'light',
        planName: 'Plan',
        schedule: weekdaySchedule([0, 2, 4]),
        sessions: [{ id: 's1', title: 'A', duration: '~45 min', exercises: [], hiddenExerciseCount: 0 }],
        monthTotals: { workouts: 0, durationMinutes: 0, volumeKg: 0 },
      });
      const planned = payload.nextMonth.monthWeeks.flat().filter((day) => day.state === 'plan');
      assert.ok(planned.length > 0);
      assert.ok(planned.every((day) => /^2026-08-\d\d$/.test(day.dateKey)), 'each planned day must say which date it is');
      const plugin = read('plugins', 'withHomeWidget.js');
      assert.match(plugin, /stored == "plan" && dateKey\.isNotEmpty\(\) && dateKey < todayKey\(\)/);
    },
  },
  {
    name: 'database: a stored programsTabEnabled false is forced on, so the English-only legacy list is unreachable',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      assert.equal(normalizeDatabase({ preferences: { programsTabEnabled: false } }).preferences.programsTabEnabled, true);
      assert.equal(normalizeDatabase({ preferences: { programsTabEnabled: true } }).preferences.programsTabEnabled, true);
      assert.equal(normalizeDatabase({}).preferences.programsTabEnabled, true);
    },
  },
  {
    name: 'home plan card: no English literals left in useHomeActivePlan',
    run() {
      const source = read('src', 'app', 'useHomeActivePlan.ts');
      assert.doesNotMatch(source, /\} sets`/);
      assert.doesNotMatch(source, /day custom plan|workouts in rotation/);
    },
  },
  {
    name: 'removeTrailingZeros never prints negative zero',
    run() {
      assert.equal(removeTrailingZeros(-0.004), '0');
      assert.equal(removeTrailingZeros(-0), '0');
      assert.equal(removeTrailingZeros(0.004), '0');
      assert.equal(removeTrailingZeros(-2.5), '-2.5');
      assert.equal(removeTrailingZeros(-0.01), '-0.01');
      assert.equal(removeTrailingZeros(60), '60');
    },
  },
];
