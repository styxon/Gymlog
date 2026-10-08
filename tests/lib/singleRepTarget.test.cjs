const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { collapseRepRange } = require('../../.test-dist/lib/singleRepTarget.js');
const { intervalOffSeconds } = require('../../.test-dist/lib/intervalScheme.js');

/**
 * Every catalog exercise prescribes ONE rep number, not a range (user decision
 * 2026-08-25: "8-10" became "10" everywhere, because a single target is what
 * lets automated progression say "hit it → next time +2.5 kg" without the
 * range making the claim mushy). Holds are exempt: their numbers are seconds,
 * and 30-60 s is a dose bracket, not a rep range.
 *
 * repsMax was kept as the value on purpose — the progression gate always
 * measured readiness against repsMax, so collapsing onto it changed nothing
 * about when anyone's load moves.
 */
module.exports = [
  {
    name: 'every catalog exercise has a single rep target (holds excepted)',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            if (exercise.trackingMode === 'hold') {
              continue;
            }
            if (exercise.repsMin !== exercise.repsMax) {
              offenders.push(`${template.id} ${exercise.id}: ${exercise.repsMin}-${exercise.repsMax}`);
            }
          }
        }
      }
      assert.deepEqual(
        offenders,
        [],
        'Catalog exercises with a rep range — set repsMin equal to repsMax:\n  ' + offenders.join('\n  '),
      );
    },
  },
  {
    name: 'a saved programme collapses its rep ranges the way the catalog did',
    run() {
      // repsMax wins, same as the catalog on 2026-08-25 — the progression
      // gate always measured readiness against it (user 2026-08-26: the same
      // rule for programmes already in the reader's own database).
      assert.deepEqual(collapseRepRange({ name: 'Bench Press', repMin: 8, repMax: 10 }), { repMin: 10, repMax: 10 });
      assert.deepEqual(collapseRepRange({ name: 'Kettlebell Swing', repMin: 15, repMax: 20 }), { repMin: 20, repMax: 20 });
      // Already single: untouched.
      assert.deepEqual(collapseRepRange({ name: 'Back Squat', repMin: 5, repMax: 5 }), { repMin: 5, repMax: 5 });
      // A hold's numbers are seconds, and 30-60 s is a dose bracket.
      assert.deepEqual(collapseRepRange({ name: 'Plank', repMin: 30, repMax: 60 }), { repMin: 30, repMax: 60 });
    },
  },
  {
    name: 'the load and the save of a programme row go through the one prescription rule',
    run() {
      // Source-read guard: the writer lives in the React provider. This
      // pinned the loader's two calls, collapseRepRange and
      // intervalOffSeconds, and nothing on the writer's side — which wrote
      // the editor's "6-8" and a raised interval rest as given, so the screen
      // said one thing after a save and another after the next launch
      // (persistence audit, 2026-09-20). Both now call savedPrescription; the
      // behaviour is in tests/storage/prescriptionRoundTrip.
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (...parts) =>
        fs
          .readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
          .replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
      const database = read('src', 'storage', 'database.ts');
      assert.match(database, /const prescription = savedPrescription\(\{\s*name,/);
      assert.match(database, /repMin: prescription\.repMin,\s*repMax: prescription\.repMax,\s*restSeconds: prescription\.restSeconds,/);
      assert.doesNotMatch(database, /collapseRepRange|intervalOffSeconds/, 'the loader applies a rule of its own again');

      const provider = read('src', 'state', 'AppProvider.tsx');
      const upsert = provider.slice(provider.indexOf('function buildTemplateUpsert('), provider.indexOf('function saveOnboardingResult('));
      assert.ok(upsert.length > 0, 'buildTemplateUpsert is gone');
      assert.match(upsert, /const prescription = savedPrescription\(\{\s*name,/);
      assert.match(upsert, /repMin: prescription\.repMin,\s*repMax: prescription\.repMax,\s*restSeconds: prescription\.restSeconds,/);
      // Both hand the rule the row's mode: a hold under a name that is not
      // one's lost its seconds bracket on the save (round 2, 2026-10-08).
      assert.match(upsert, /savedPrescription\(\{[^}]*trackingMode: exercise\.trackingMode \?\? null,[^}]*\}\)/);
      assert.match(database, /savedPrescription\(\{[^}]*trackingMode: readStoredTrackingMode\(exercise\?\.trackingMode\),[^}]*\}\)/);
    },
  },
  {
    name: 'a row stored as a hold keeps its seconds bracket under any name (round 2, 2026-10-08)',
    run() {
      const { savedPrescription } = require('../../.test-dist/lib/singleRepTarget.js');
      assert.deepEqual(
        savedPrescription({ name: 'Barbell Glute Bridge', repMin: 30, repMax: 45, restSeconds: 90, trackingMode: 'hold' }),
        { repMin: 30, repMax: 45, restSeconds: 90 },
      );
      // The name still decides for a row that does not say, and a counted mode does not exempt it.
      assert.deepEqual(collapseRepRange({ name: 'Barbell Glute Bridge', repMin: 30, repMax: 45 }), { repMin: 45, repMax: 45 });
      assert.deepEqual(
        collapseRepRange({ name: 'Barbell Glute Bridge', repMin: 8, repMax: 10, trackingMode: 'load_and_reps' }),
        { repMin: 10, repMax: 10 },
      );
    },
  },
  {
    name: 'a saved row is written as the loader reads it: one rep number, an interval resting its off-phase',
    run() {
      const { savedPrescription } = require('../../.test-dist/lib/singleRepTarget.js');
      // The editors' own defaults are ranges (getExerciseTemplateDefaults).
      assert.deepEqual(savedPrescription({ name: 'Bench Press', repMin: 6, repMax: 8, restSeconds: 120 }), {
        repMin: 8,
        repMax: 8,
        restSeconds: 120,
      });
      // A hold keeps its bracket, and a lift with no rest keeps none.
      assert.deepEqual(savedPrescription({ name: 'Plank', repMin: 30, repMax: 60, restSeconds: null }), {
        repMin: 30,
        repMax: 60,
        restSeconds: null,
      });
      // An interval rests its named off-phase whatever the tune sheet stepped it to.
      assert.deepEqual(savedPrescription({ name: 'Treadmill HIIT (30s on / 30s off)', repMin: 30, repMax: 30, restSeconds: 45 }), {
        repMin: 30,
        repMax: 30,
        restSeconds: 30,
      });
      // And applying it twice changes nothing: a save followed by a load is a fixed point.
      for (const row of [
        { name: 'Bench Press', repMin: 6, repMax: 8, restSeconds: 120 },
        { name: 'Plank', repMin: 30, repMax: 60, restSeconds: 45 },
        { name: 'Bike HIIT (45s sprint / 15s rest)', repMin: 45, repMax: 45, restSeconds: 90 },
      ]) {
        const once = savedPrescription(row);
        assert.deepEqual(savedPrescription({ ...row, ...once }), once, row.name);
      }
    },
  },
  {
    name: 'an interval rests exactly the off-phase its name states',
    run() {
      // 30/30 means the walk IS the rest — a saved programme carried a 60 s
      // rest on top of the 30 s walk, and the player offered "30 s kävelyä,
      // 30 s juoksua, sitten minuutin tauko" (user, 2026-08-26).
      assert.equal(intervalOffSeconds('Treadmill HIIT (30s on / 30s off)'), 30);
      assert.equal(intervalOffSeconds('Bike HIIT (45s sprint / 15s rest)'), 15);
      // Everything that is not an interval keeps its own rest.
      assert.equal(intervalOffSeconds('Bench Press'), null);
      assert.equal(intervalOffSeconds('Plank'), null);
      assert.equal(intervalOffSeconds('Air Bike (30s sprint)'), null);
    },
  },
  {
    name: 'the catalogs already prescribe the exact off-phase as the interval rest',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const off = intervalOffSeconds(exercise.exerciseName);
            if (off === null) {
              continue;
            }
            assert.equal(
              exercise.restSecondsMin,
              off,
              `${template.id} ${exercise.id}: interval rest floor must equal the named off-phase`,
            );
            assert.equal(
              exercise.restSecondsMax,
              off,
              `${template.id} ${exercise.id}: interval rest ceiling must equal the named off-phase`,
            );
          }
        }
      }
    },
  },
];
