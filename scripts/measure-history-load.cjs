/**
 * What a long history costs to read, in Node. SQLite plan, PR 0.
 *
 *   npm run measure:history                    300, 1000 and 3000 sessions, 7 runs each
 *   node scripts/measure-history-load.cjs --sizes 300,3000 --runs 5 --json
 *
 * For each size it builds a seeded history (src/lib/historyFixture), writes it
 * through the real saveDatabase into an in-memory AsyncStorage stub that
 * refuses rows over 2 MB the way Android does, then reports the median of
 * several runs of: the blob's size, JSON.parse, normalizeDatabase, the whole
 * loadDatabase path, JSON.stringify of the history (the work a content hash
 * or a mirror write starts from) and saveDatabase.
 *
 * READ THE NUMBERS AS NODE'S. Hermes on the phone has no JIT and is about
 * twenty times slower than Node (CLAUDE.md), so multiply a figure here by about
 * 20 for a rough guide to the phone, not a measurement. The phone's own figure comes from
 * `npm run measure:startup` after an APK install. Nothing is read from a real
 * install: the history is generated.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
require('./registerTs.cjs');

const { createFakeAsyncStorage, loadAgainstFake } = require(path.join(ROOT, 'tests', 'storage', 'fakeAsyncStorage.cjs'));

const BLOB_KEY = '@vinha/database/v1';
const HERMES_FACTOR = 20;

function parseArgs(argv) {
  const options = { sizes: [300, 1000, 3000], runs: 7, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sizes') {
      options.sizes = String(argv[(index += 1)])
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
    } else if (arg === '--runs') {
      options.runs = Number(argv[(index += 1)]);
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (options.sizes.length === 0 || !Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error('Usage: measure-history-load.cjs [--sizes 300,1000,3000] [--runs 7] [--json]');
  }
  return options;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Wall time of one call in milliseconds. */
async function timed(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, result };
}

async function medianOf(runs, fn, prepare = () => undefined) {
  // `prepare` builds each run's input outside the timer (a fresh copy, so a
  // function that mutates its input cannot time a different workload later).
  await fn(prepare()); // warm-up: the first call pays for compiling the code, not the work
  const times = [];
  for (let run = 0; run < runs; run += 1) {
    const input = prepare();
    times.push((await timed(() => fn(input))).ms);
  }
  return median(times);
}

async function measureSize(sessionCount, runs, modules) {
  const { createEmptyDatabase } = require(path.join(ROOT, 'src', 'data', 'seed'));
  const { buildHistoryFixture } = require(path.join(ROOT, 'src', 'lib', 'historyFixture'));

  const empty = createEmptyDatabase('fi');
  const history = buildHistoryFixture(sessionCount);
  const stored = { ...empty, ...history, preferences: { ...empty.preferences, onboardingCompleted: true } };

  const { database, largeItem, fake } = modules;
  fake.rows.clear();
  await database.saveDatabase(stored);

  const blobBytes = [...fake.rows]
    .filter(([key]) => key.startsWith(BLOB_KEY))
    .reduce((sum, [, value]) => sum + Buffer.byteLength(value, 'utf8'), 0);
  const parts = [...fake.rows.keys()].filter((key) => key.startsWith(`${BLOB_KEY}#`)).length;
  const raw = await largeItem.getLargeItem(BLOB_KEY);
  const parsed = JSON.parse(raw);

  const result = {
    sessions: sessionCount,
    exerciseLogs: history.exerciseLogs.length,
    bodyweightEntries: history.bodyweightEntries.length,
    measurementEntries: history.measurementEntries.length,
    cardioSessions: history.cardioSessions.length,
    blobBytes,
    blobParts: parts,
    parseMs: await medianOf(runs, () => JSON.parse(raw)),
    normalizeMs: await medianOf(runs, (input) => database.normalizeDatabase(input), () => structuredClone(parsed)),
    stringifyHistoryMs: await medianOf(runs, () =>
      JSON.stringify([
        history.workoutSessions,
        history.exerciseLogs,
        history.bodyweightEntries,
        history.measurementEntries,
        history.cardioSessions,
      ]),
    ),
    saveMs: await medianOf(runs, () => database.saveDatabase(stored)),
    // The fake has no separate preferences key, so the preferences overlay in a real
    // load is near-free here and a real install pays slightly more than this.
    loadMs: await medianOf(runs, () => database.loadDatabase()),
  };

  // The load path must hand back everything that was written, or the timing proves nothing.
  const loaded = await database.loadDatabase();
  if (loaded.workoutSessions.length !== sessionCount || loaded.exerciseLogs.length !== history.exerciseLogs.length) {
    throw new Error(`loadDatabase returned ${loaded.workoutSessions.length} sessions for ${sessionCount} written`);
  }
  return result;
}

const fmtMs = (ms) => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)).padStart(8);
const fmtMb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`.padStart(9);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fake = createFakeAsyncStorage();
  const modules = loadAgainstFake(fake, (requireDist) => ({
    database: requireDist('storage/database.js'),
    largeItem: requireDist('storage/largeItem.js'),
    fake,
  }));

  const results = [];
  for (const size of options.sizes) {
    results.push(await measureSize(size, options.runs, modules));
  }

  if (options.json) {
    console.log(JSON.stringify({ node: process.version, runs: options.runs, hermesFactor: HERMES_FACTOR, results }, null, 2));
    return;
  }

  console.log(`Node ${process.version}, median of ${options.runs} runs after one warm-up. Generated history, no real data.`);
  console.log('');
  console.log('sessions   logs   blob size  parts   parse  normalize  stringify    save     load   (ms, Node)');
  for (const r of results) {
    console.log(
      `${String(r.sessions).padStart(8)} ${String(r.exerciseLogs).padStart(6)} ${fmtMb(r.blobBytes)} ${String(r.blobParts).padStart(6)} ` +
        `${fmtMs(r.parseMs)} ${fmtMs(r.normalizeMs)} ${fmtMs(r.stringifyHistoryMs)} ${fmtMs(r.saveMs)} ${fmtMs(r.loadMs)}`,
    );
  }
  console.log('');
  console.log(`These are NODE times. Hermes on the phone has no JIT and is roughly ${HERMES_FACTOR}x slower (CLAUDE.md), so the phone`);
  console.log(`takes on the order of ${HERMES_FACTOR}x these figures (a rough guide, not a measurement). The phone's own cold start is measured`);
  console.log('with `npm run measure:startup` after an APK install (fails over 3.5 s).');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
