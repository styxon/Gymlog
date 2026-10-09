const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

/**
 * The exercise pictures ship inside the APK (owner decision 2026-10-09). They
 * were fetched from cdn.jsdelivr.net when an exercise was shown, which sent
 * the user's IP address to a third party the privacy policy does not name.
 *
 * What these suites hold in place:
 *  - every picture a library row names is a real .webp in assets/exercises and
 *    has an entry in the generated map, and nothing in either is orphaned;
 *  - the map is lazy: 873 eager require()s would run before the first render
 *    on every cold start (CLAUDE.md, "Work at the top of a module"), and
 *    startupWorkBudget.test.cjs cannot see a .webp require in Node;
 *  - no source file names the CDN, apart from the one resolver that has to
 *    recognise the URLs old installs stored;
 *  - that resolver maps those URLs to the bundled picture, and anything else
 *    that looks like an address to null, so nothing can ever be fetched.
 */

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const IMAGE_DIR = path.join(ROOT, 'assets', 'exercises');
const MAP_SOURCE = path.join(ROOT, 'src', 'assets', 'exerciseImages.ts');
const RESOLVER_SOURCE = path.join('src', 'lib', 'exerciseImageKey.ts');

const { GENERATED_EXERCISE_LIBRARY } = require(path.join(DIST, 'data', 'generatedExerciseLibrary.js'));
const { EXTRA_EXERCISE_LIBRARY } = (() => {
  try {
    return require(path.join(DIST, 'data', 'extraExerciseLibrary.js'));
  } catch {
    return { EXTRA_EXERCISE_LIBRARY: [] };
  }
})();
const { exerciseImageKeyFrom } = require(path.join(DIST, 'lib', 'exerciseImageKey.js'));

const LEGACY = (slug, n = 0) =>
  `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/${slug}/${n}.jpg`;

const libraryKeys = () => [
  ...new Set(
    [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]
      .map((item) => item.imageKey)
      .filter((key) => typeof key === 'string'),
  ),
];

/** The map source's entries: key -> file the thunk requires. */
function readMapEntries() {
  // A Windows checkout (core.autocrlf) has CRLF here, and ENTRY is anchored
  // at the line end.
  const text = fs.readFileSync(MAP_SOURCE, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('const EXERCISE_IMAGES');
  const end = text.indexOf('\n};', start);
  assert.ok(start > 0 && end > start, 'could not find the EXERCISE_IMAGES table in the generated map');
  const lines = text.slice(start, end).split('\n').slice(1);
  return { lines, text };
}

const ENTRY = /^ {2}'([A-Za-z0-9_-]+)': \(\) => require\('\.\.\/\.\.\/assets\/exercises\/([a-z0-9_-]+\.webp)'\),$/;

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.test-dist' || full === path.join(ROOT, 'assets')) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|cjs|mjs|json|py)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of ['src', 'api', 'scripts', 'modules', 'plugins']) {
    if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  }
  for (const file of ['App.tsx', 'index.ts', 'app.config.js', 'app.json', 'package.json', 'eas.json']) {
    if (fs.existsSync(path.join(ROOT, file))) out.push(path.join(ROOT, file));
  }
  return out;
}

module.exports = [
  {
    name: 'exercise pictures: every library row names a key, and the old URL list is gone from the data',
    run() {
      assert.ok(GENERATED_EXERCISE_LIBRARY.length > 800, 'the generated library is missing');
      const stale = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY].filter(
        (item) => 'imageUrls' in item,
      );
      assert.deepEqual(stale.map((item) => item.id), [], 'a row still carries imageUrls');
      const without = GENERATED_EXERCISE_LIBRARY.filter((item) => typeof item.imageKey !== 'string');
      assert.deepEqual(without.map((item) => item.id), [], 'generated rows without a picture key');
      for (const key of libraryKeys()) {
        assert.match(key, /^[A-Za-z0-9_-]+$/, `unsafe key ${key}`);
      }
    },
  },
  {
    name: 'exercise pictures: every key has a .webp on disk and an entry in the map, and neither has strays',
    run() {
      const keys = libraryKeys();
      const { lines } = readMapEntries();
      const entries = new Map();
      for (const line of lines) {
        const match = ENTRY.exec(line);
        if (match) entries.set(match[1], match[2]);
      }
      const onDisk = new Set(fs.readdirSync(IMAGE_DIR).filter((name) => name.endsWith('.webp')));

      const missingEntry = keys.filter((key) => !entries.has(key));
      assert.deepEqual(missingEntry, [], 'keys with no entry in src/assets/exerciseImages.ts');
      const stray = [...entries.keys()].filter((key) => !keys.includes(key));
      assert.deepEqual(stray, [], 'map entries no library row uses');

      for (const key of keys) {
        const file = entries.get(key);
        assert.equal(file, `${key.toLowerCase()}.webp`, `entry for ${key} points somewhere unexpected`);
        assert.ok(onDisk.has(file), `assets/exercises/${file} is missing`);
      }
      const unused = [...onDisk].filter((name) => ![...entries.values()].includes(name));
      assert.deepEqual(unused, [], 'files in assets/exercises that the map does not name');
    },
  },
  {
    name: 'exercise pictures: no two keys share a file name or an Android resource name',
    run() {
      // The file is the key lower-cased, and an Android release build turns
      // each bundled image into a drawable named from its path: lower case,
      // '/' to '_', every other character outside [a-z0-9_] dropped
      // (@react-native/assets-registry getAndroidResourceIdentifier). So
      // 'Sit-Up' and 'SitUp' would land on one drawable: a duplicate-resource
      // build error, or one exercise showing the other's picture. Nothing in
      // the source data stops an `exercise:sync` from bringing such a pair in.
      const keys = [...new Set(GENERATED_EXERCISE_LIBRARY.map((item) => item.imageKey).filter(Boolean))];
      const androidName = (key) =>
        `assets/exercises/${key.toLowerCase()}`.replace(/\//g, '_').replace(/[^a-z0-9_]/g, '').replace(/^assets_/, '');
      for (const [label, nameOf] of [['file name', (key) => key.toLowerCase()], ['Android resource name', androidName]]) {
        const seen = new Map();
        const clashes = [];
        for (const key of keys) {
          const name = nameOf(key);
          if (seen.has(name)) clashes.push(`${seen.get(name)} / ${key} -> ${name}`);
          else seen.set(name, key);
        }
        assert.deepEqual(clashes, [], `Picture keys that share a ${label}: ${clashes.join('; ')}`);
      }
    },
  },
  {
    name: 'exercise pictures: the files are real WebP images of a sane size, and the folder stays modest',
    run() {
      let total = 0;
      for (const name of fs.readdirSync(IMAGE_DIR)) {
        const bytes = fs.readFileSync(path.join(IMAGE_DIR, name));
        total += bytes.length;
        assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${name} is not a RIFF container`);
        assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${name} is not WebP`);
        assert.ok(bytes.length > 1000, `${name} is suspiciously small (${bytes.length} bytes)`);
        assert.ok(bytes.length < 80 * 1024, `${name} is ${bytes.length} bytes; resize it (720 px wide, q75)`);
      }
      // 873 pictures are about 19 MB at 720 px (2026-10-09). The APK is 85 MB, and this is the
      // line past which "a picture was added at full size" is the likely cause.
      assert.ok(total < 24 * 1024 * 1024, `assets/exercises is ${(total / 1048576).toFixed(1)} MB`);
    },
  },
  {
    // The map is read when a picture is shown, never when the module loads.
    name: 'exercise pictures: the generated map is lazy, every value a function that requires one file',
    run() {
      const { lines, text } = readMapEntries();
      assert.ok(lines.length > 800, 'the table is missing its entries');
      const eager = lines.filter((line) => !ENTRY.test(line));
      assert.deepEqual(eager, [], 'an entry that is not `() => require(...)` is evaluated at load');

      // No require() anywhere else in the module either: a loop or a helper
      // that built the table up front would defeat the thunks.
      const code = text.replace(/^\s*\/\/.*$/gm, '');
      const requires = code.match(/\brequire\(/g) ?? [];
      assert.equal(requires.length, lines.length, 'require() appears outside the table entries');
      assert.ok(!/\bimport\s+[^;]*\.webp/.test(text), 'a .webp is imported at the top of the module');
    },
  },
  {
    // Node cannot parse a .webp, so the extension is given a stand-in that
    // answers with the file's path. The thunk is then really called, and the
    // path it requires has to exist.
    name: 'exercise pictures: getExerciseImageSource resolves a key, or a legacy URL, to the bundled file',
    run() {
      const mapModule = path.join(DIST, 'assets', 'exerciseImages.js');
      const hadHook = Object.prototype.hasOwnProperty.call(require.extensions, '.webp');
      require.extensions['.webp'] = (module, filename) => {
        module.exports = filename;
      };
      try {
        delete require.cache[require.resolve(mapModule)];
        const { getExerciseImageSource } = require(mapModule);
        for (const key of libraryKeys()) {
          const file = path.join(IMAGE_DIR, `${key.toLowerCase()}.webp`);
          assert.equal(getExerciseImageSource(key), file, `key ${key}`);
          assert.equal(getExerciseImageSource(LEGACY(key)), file, `legacy url for ${key}`);
        }
        assert.equal(getExerciseImageSource('Not_A_Real_Exercise'), null);
        assert.equal(getExerciseImageSource(null), null);
        assert.equal(getExerciseImageSource(undefined), null);
        assert.equal(getExerciseImageSource('https://example.com/exercises/3_4_Sit-Up/0.jpg'), null);
        // Inherited properties are not pictures.
        assert.equal(getExerciseImageSource('constructor'), null);
        assert.equal(getExerciseImageSource('toString'), null);
      } finally {
        delete require.cache[require.resolve(mapModule)];
        if (!hadHook) delete require.extensions['.webp'];
      }
    },
  },
  {
    name: 'exercise pictures: no source file names the CDN, except the resolver that reads old stored URLs',
    run() {
      const offenders = [];
      for (const file of sourceFiles()) {
        const rel = path.relative(ROOT, file);
        if (rel === RESOLVER_SOURCE) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (/jsdelivr/i.test(text)) offenders.push(rel);
      }
      assert.deepEqual(offenders, [], 'these still mention jsDelivr; a request to it would leak the IP');
      // The resolver is the one allowed place: it names the host to recognise
      // a stored string, and must not be anywhere a request could be built.
      const resolver = fs.readFileSync(path.join(ROOT, RESOLVER_SOURCE), 'utf8');
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|Linking|\buri\s*:/.test(resolver.replace(/\/\*[\s\S]*?\*\//g, '')));
    },
  },
  {
    name: 'exercise pictures: no screen or component hands an exercise picture to <Image> as a remote uri',
    run() {
      const offenders = [];
      for (const file of sourceFiles().filter((f) => /\.tsx$/.test(f))) {
        const text = fs.readFileSync(file, 'utf8');
        // Any picture in an exercise surface comes from getExerciseImageSource.
        if (/imageKeys?\b|imageUrls?\b/.test(text) && /source=\{\{\s*uri:/.test(text)) {
          offenders.push(path.relative(ROOT, file));
        }
        if (/href=\{\{\s*uri:/.test(text)) offenders.push(path.relative(ROOT, file));
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'exercise pictures: an <Image> showing a bundled picture is sized, not only pinned by absoluteFill',
    run() {
      // A require()d picture brings its pixel size as the Image's default
      // width and height, and absoluteFill's edges do not override it: the
      // picture drew at full size from the corner, and the set card's thumb
      // and the exercise sheet showed its top-left (#bugs 2026-10-09).
      const offenders = [];
      // Every file, every attribute order: a source handed down as a prop is
      // just as bundled. Only a remote `{{ uri }}` has no size of its own.
      for (const file of sourceFiles().filter((f) => /\.tsx$/.test(f))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [element] of text.matchAll(/<(?:Animated\.)?Image\b[^>]*>/g)) {
          const bundled = /\bsource=\{(?!\{)/.test(element);
          if (bundled && /\bstyle=\{StyleSheet\.absoluteFill\}/.test(element)) {
            offenders.push(`${path.relative(ROOT, file)}: ${element.replace(/\s+/g, ' ').slice(0, 90)}`);
          }
        }
      }
      assert.deepEqual(offenders, [], 'give the Image width and height 100% as well');
    },
  },
  {
    name: 'exercise image key: a key passes through, a legacy jsDelivr URL maps to its key by slug',
    run() {
      assert.equal(exerciseImageKeyFrom('3_4_Sit-Up'), '3_4_Sit-Up');
      assert.equal(exerciseImageKeyFrom('  Barbell_Curl '), 'Barbell_Curl');
      assert.equal(exerciseImageKeyFrom(LEGACY('3_4_Sit-Up')), '3_4_Sit-Up');
      assert.equal(exerciseImageKeyFrom(LEGACY('Barbell_Curl', 1)), 'Barbell_Curl');
    },
  },
  {
    name: 'exercise image key: any other address, and anything that is not a string, is null (never a fetch)',
    run() {
      const refused = [
        'https://example.com/exercises/Barbell_Curl/0.jpg',
        'http://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/Barbell_Curl/0.jpg',
        'https://cdn.jsdelivr.net/gh/someone-else/free-exercise-db@main/exercises/Barbell_Curl/0.jpg',
        'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/Barbell_Curl/0.jpg?x=1',
        'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/../../Barbell_Curl/0.jpg',
        'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/Bar bell/0.jpg',
        'https://evil.test/https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/Barbell_Curl/0.jpg',
        'file:///sdcard/a.jpg',
        'data:image/png;base64,AAAA',
        'Barbell/Curl',
        '../Barbell_Curl',
        '',
        '   ',
        null,
        undefined,
        42,
        {},
        ['Barbell_Curl'],
      ];
      for (const value of refused) {
        assert.equal(exerciseImageKeyFrom(value), null, `${JSON.stringify(value)} must not resolve`);
      }
    },
  },
  {
    name: 'exercise pictures: a stored active workout with a legacy URL loads with the key, and a foreign URL loads as none',
    run() {
      const { normalizeFreestyleDraftSnapshot } = require(path.join(DIST, 'lib', 'emptyWorkoutSession.js'));
      const lift = (localKey, imageUrl) => ({
        localKey,
        name: 'Barbell Curl',
        libraryItemId: 'free_barbell_curl',
        imageUrl,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
        trackedDefault: true,
        sets: [{ localKey: `${localKey}_s`, kg: '20', reps: '10', done: false }],
      });
      const snapshot = normalizeFreestyleDraftSnapshot({
        exercises: [
          lift('a', LEGACY('Barbell_Curl')),
          lift('b', 'https://example.com/x.jpg'),
          lift('c', 'Barbell_Curl'),
          lift('d', null),
        ],
      });
      assert.deepEqual(
        snapshot.exercises.map((exercise) => exercise.imageUrl),
        ['Barbell_Curl', null, 'Barbell_Curl', null],
      );
    },
  },
  {
    name: 'exercise pictures: a library row stored with the old imageUrls loads without it, and keeps the seed picture key',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, () => require(path.join(DIST, 'storage', 'database.js')));
      const seeded = GENERATED_EXERCISE_LIBRARY[0];
      // As JSON stored it: a row from before the library was stripped on save.
      const { imageKey: _imageKey, ...storedRow } = seeded;
      const out = normalizeDatabase({
        exerciseLibrary: [{ ...storedRow, imageUrls: [LEGACY('3_4_Sit-Up'), LEGACY('3_4_Sit-Up', 1)] }],
      });
      const row = out.exerciseLibrary.find((item) => item.id === seeded.id);
      assert.ok(row, 'the row is still in the library');
      assert.equal('imageUrls' in row, false, 'the retired field survived the load');
      assert.equal(row.imageKey, seeded.imageKey);
      assert.ok(!JSON.stringify(out.exerciseLibrary).includes('jsdelivr'));
    },
  },
];
