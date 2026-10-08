const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildProgramFingerprint,
  fingerprintsMatch,
} = require('../../.test-dist/lib/programFingerprint.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'the bars are the week: one per session, tallest is the biggest day',
    run() {
      const template = {
        sessions: [
          { exercises: [{ sets: 3 }, { sets: 3 }] }, // 6
          { exercises: [{ sets: 4 }, { sets: 4 }, { sets: 4 }] }, // 12
          { exercises: [{ sets: 3 }] }, // 3
        ],
      };
      const bars = buildProgramFingerprint(template);

      // Bar COUNT is information: three sessions, three bars. A fixed count
      // would throw away the days per week, which is the first thing a
      // browsing reader wants.
      assert.equal(bars.length, 3);
      assert.equal(bars[1], 1, 'the biggest day is full height');
      assert.ok(bars[0] > bars[2], 'a 6-set day is taller than a 3-set day');

      // Floored, so a light day is still a bar. A hairline reads as a
      // rendering fault rather than as a light day.
      assert.ok(bars[2] >= 0.25);
      assert.ok(bars.every((value) => value <= 1));
    },
  },
  {
    name: 'programs that differ actually look different',
    run() {
      // The whole point. The design this replaced drew
      // 0.32 + 0.62 * |sin(t * 3.1 + split[0] / 100 * 2.4)| — a sine wave one
      // number nudged, so two programs sharing that number drew the same
      // cover while claiming to show their shape. A fingerprint that collapses
      // is worse than no bars: it looks like data and is not.
      const shapes = new Map();
      for (const template of WORKOUT_TEMPLATES_V1) {
        const bars = buildProgramFingerprint(template);
        const key = bars.map((value) => value.toFixed(3)).join(',');
        shapes.set(key, (shapes.get(key) ?? 0) + 1);
      }
      // Not every program needs a unique cover — two 3-day full-body programs
      // with the same set counts genuinely have the same shape — but the
      // catalog must not collapse to a handful.
      assert.ok(shapes.size >= 20, `only ${shapes.size} distinct shapes across ${WORKOUT_TEMPLATES_V1.length}`);

      // And no single shape may dominate.
      const biggest = Math.max(...shapes.values());
      assert.ok(biggest <= 8, `one shape is used by ${biggest} programs`);
    },
  },
  {
    name: 'a program with nothing prescribed draws something rather than dividing by zero',
    run() {
      const empty = buildProgramFingerprint({ sessions: [{ exercises: [] }, { exercises: [{ sets: 0 }] }] });
      assert.deepEqual(empty, [0.5, 0.5]);
      assert.deepEqual(buildProgramFingerprint({ sessions: [] }), []);
      assert.equal(fingerprintsMatch([0.5, 0.5], [0.5, 0.5]), true);
      assert.equal(fingerprintsMatch([0.5], [0.5, 0.5]), false);
    },
  },
  {
    name: 'every cover on the Programs tab draws the real thing',
    run() {
      const screen = read('src', 'screens', 'ProgramsHomeScreen.tsx');

      // A cover that took no fingerprint would silently fall back to the
      // gradient alone, and the feature would be half-present. Every cover on
      // the page passes one — the count is not pinned, because rows come and
      // go; what must hold is that none of them skips it. ("Jatka siitä mihin
      // jäit" was one of the two and is gone: it answered the same question as
      // "Omat ohjelmasi" below it and the active programme on Home.)
      const covers = (screen.match(/<ProgramCover/g) ?? []).length;
      assert.ok(covers >= 1, `only ${covers} covers on the page`);
      const passes = (screen.match(/fingerprint=\{item\.fingerprint\}/g) ?? []).length;
      assert.ok(passes >= covers, `${covers} covers but only ${passes} fingerprints`);
      // The sheet rows draw the same week at 74px, and so does the catalog:
      // both go through the one shared row now, so this follows it there
      // rather than pinning a component to the screen it started in. A row
      // cover that skipped the fingerprint would be a flat gradient claiming
      // to be a program.
      const row = read('src', 'components', 'ProgramLadderRow.tsx');
      assert.match(row, /export function ProgramRowCover/);
      assert.match(row, /<ProgramRowCover style=\{item\.cover\} fingerprint=\{item\.fingerprint\} \/>/);
      // And both doors reach the programme through it, or one of them draws
      // its own row and the two drift apart.
      for (const [file, source] of [
        ['ProgramsHomeScreen.tsx', screen],
        ['CatalogScreen.tsx', read('src', 'screens', 'CatalogScreen.tsx')],
      ]) {
        assert.match(source, /<ProgramLadderRow$/m, `${file} draws its own program row`);
      }
      // Built from the programme's week, not from a card field that could
      // drift. Two rows build one: the catalog items every sheet and the
      // catalog screen read, and the "for you" cards. It was three until the
      // season rows were parked with their section. Counted across the shell —
      // App.tsx and the src/app modules — since the rows left App.tsx for
      // useProgramsCatalog (phase-C split, 2026-10-01). The week is the one
      // the page shows, the reader's composed one for their own programme
      // (programmeCardWeek, bug hunt 2026-10-08), so the bars and the days
      // count the same sessions.
      const { readAppWiring } = require('../helpers/appWiringSource.cjs');
      assert.ok((readAppWiring().match(/fingerprint: week\.fingerprint,/g) ?? []).length >= 2);
      assert.match(read('src', 'lib', 'programDetails.ts'), /fingerprint: buildProgramFingerprint\(week\),/);

      // The bars scale with the cover. They were hard-coded to a 74px ceiling
      // against a 176px card; dropped onto a 92px continue cover unchanged
      // they would have run off the top of it.
      assert.match(screen, /const barCeiling = Math\.max\(18, height \* 0\.42\)/);
      assert.match(screen, /barRatio \* barCeiling/);
    },
  },
];
