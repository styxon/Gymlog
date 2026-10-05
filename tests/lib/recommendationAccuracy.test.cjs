const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * The onboarding recommendation, held to its accuracy over the whole answer
 * space: every equipment set (3 gym, 16 home, 5 bodyweight) × goal × level ×
 * days, 1440 answer sets (tests/recommendation/recommendationMatrix.cjs; run it
 * with `--extra 4` for the 7200-case report with patterns and root causes).
 *
 * Measured 2026-10-05: 54 % of answers broke a hard criterion, 59 % at home,
 * and a reader with dumbbells was handed the no-equipment plan. The ceilings
 * below are where the fixes of that day left it. They may only come down —
 * a change that raises one is a recommender that got worse. Lower a ceiling
 * when content or a fix earns it.
 *
 * - E2: owns gear, the plan uses none of it, and an eligible plan does.
 * - E3: the week holds a lift the reader's gear cannot do.
 * - E4: the reader owns a barbell, dumbbells, machines or cables, the plan
 *   uses none of them, and a programme for their goal and level does.
 * - L1: the plan does not list the reader's level.
 * - S1: a programme written for one gender shown to anyone else.
 * - C1: an area the reader asked to avoid is still loaded.
 * - HARD: any hard criterion, content gaps included. What is left is supply,
 *   not the ranker.
 *
 * New programmes, 2026-10-05: two dumbbell strength programmes left no
 * dumbbell or no-barbell strength answer without a programme that lists
 * strength, and two bodyweight strength programmes did the same for a reader
 * with no gear, a bar, bands, a kettlebell or a mat. Two bodyweight muscle
 * weeks (2 and 6 days, advanced and pro) and a beginner athletic week for a
 * home rack closed the last content gaps: HARD 481 -> 114, E2 85 -> 76.
 *
 * The bodyweight weeks then beat a barbell or dumbbell week a day or two off,
 * because they matched the day count: 147 answers left the reader's load unused
 * (E4). A programme that ignores it now costs two days when another serves the
 * goal and level with it: E4 147 -> 15, E2 76 -> 32, HARD 114 -> 57. The 15
 * left are mostly HOME Starter, the two-day base for general fitness, kept on
 * purpose (firstRunSetup.test.cjs pins it for a two-day gym reader).
 */
const CEILINGS = { E2: 32, E3: 0, E4: 15, L1: 0, S1: 0, C1: 0, HARD: 57 };

let cached = null;
function matrix() {
  if (cached) {
    return cached;
  }
  const out = path.join(os.tmpdir(), `vinha-recommendation-matrix-${process.pid}.json`);
  execFileSync(process.execPath, [path.join(__dirname, '..', 'recommendation', 'recommendationMatrix.cjs'), '--extra', '0', '--json', out], {
    stdio: 'ignore',
  });
  cached = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  return cached;
}

module.exports = [
  {
    name: 'recommendation accuracy: no criterion is worse than the 2026-10-05 fixes left it',
    run() {
      const results = matrix();
      assert.equal(results.length, 1440, 'the answer space changed: update the ceilings with it');
      const counts = {};
      for (const result of results) {
        for (const failure of result.fails) {
          counts[failure] = (counts[failure] ?? 0) + 1;
        }
      }
      const worse = Object.entries(CEILINGS)
        .filter(([criterion, ceiling]) => (counts[criterion] ?? 0) > ceiling)
        .map(([criterion, ceiling]) => `${criterion} ${counts[criterion]} > ${ceiling}`);
      assert.deepEqual(worse, [], `the recommender got worse: ${worse.join(', ')}`);
    },
  },
  {
    name: 'recommendation accuracy: a reader with dumbbells at home is handed the dumbbell programme, not the no-equipment one',
    run() {
      const dist = path.join(__dirname, '..', '..', '.test-dist', 'lib');
      const { recommendPrograms } = require(path.join(dist, 'recommendationScoring.js'));
      const { buildRecommendationInput } = require(path.join(dist, 'recommendationInput.js'));
      const { DEFAULT_FIRST_RUN_SELECTION } = require(path.join(dist, 'firstRunSetup.js'));
      // The device walk of 2026-10-05: dumbbells only, build muscle, 3 days.
      const input = buildRecommendationInput({
        ...DEFAULT_FIRST_RUN_SELECTION,
        goal: 'muscle',
        goals: ['muscle'],
        level: 'beginner',
        daysPerWeek: 3,
        equipment: 'home',
        trainingEnvironment: 'home_gym',
        equipmentItems: ['Dumbbells'],
      });
      assert.equal(recommendPrograms(input).featuredProgramId, 'tpl_home_dumbbell_upper_lower_v1');
    },
  },
];
