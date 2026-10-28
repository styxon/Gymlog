const assert = require('node:assert/strict');

const {
  CATALOG_FOCUS_OPTIONS,
  getProgramFocusTags,
  matchesCatalogFocus,
} = require('../../src/lib/programCatalogFocus');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

function templateById(id) {
  const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === id);
  assert.ok(template, `template ${id} missing from the catalog`);
  return template;
}

function makeTemplate(sessions) {
  return {
    id: 'test',
    sessions: sessions.map((exercises, index) => ({
      id: `s${index}`,
      name: `Session ${index}`,
      orderIndex: index,
      exercises: exercises.map((exerciseName, order) => ({
        id: `e${order}`,
        exerciseName,
        slotId: `slot${order}`,
        role: 'primary',
        progressionPriority: 'medium',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 6,
        repsMax: 10,
        restSecondsMin: 60,
        restSecondsMax: 90,
        substitutionGroup: 'group',
      })),
    })),
  };
}

module.exports = [
  {
    name: 'an upper/lower split is tagged upper AND lower, not full body',
    run() {
      const tags = getProgramFocusTags(
        makeTemplate([
          ['Barbell Bench Press', 'Barbell Row', 'Overhead Press'],
          ['Back Squat', 'Romanian Deadlift', 'Leg Press'],
        ]),
      );
      assert.deepEqual(tags, ['upper', 'lower']);
    },
  },
  {
    name: 'a full-body program is tagged full',
    run() {
      const tags = getProgramFocusTags(
        makeTemplate([['Back Squat', 'Barbell Bench Press', 'Barbell Row']]),
      );
      assert.deepEqual(tags, ['full']);
    },
  },
  {
    name: 'a mobility program is mobility only — never offered as full body',
    run() {
      const tags = getProgramFocusTags(
        makeTemplate([
          ['Cat Cow Stretch', 'Standing Forward Fold', 'Hip Flexor Stretch'],
          ['Downward Dog Pose', 'Child Pose', 'Thoracic Rotation Mobility'],
        ]),
      );
      assert.deepEqual(tags, ['mobility']);
      assert.ok(!tags.includes('full'), 'a stretching program must not answer the Full body filter');
    },
  },
  {
    name: 'a running program is tagged cardio',
    run() {
      const tags = getProgramFocusTags(
        makeTemplate([['Easy Run', 'Interval Run', 'Sprint']]),
      );
      assert.ok(tags.includes('cardio'));
    },
  },
  {
    name: 'the real catalog: every ready program answers at least one focus chip',
    run() {
      // The design shipped a hand-written map covering 29 of these. Deriving
      // the tags is only worth it if it actually covers all of them.
      const unreachable = WORKOUT_TEMPLATES_V1.filter(
        (template) => getProgramFocusTags(template).length === 0,
      ).map((template) => template.id);
      assert.deepEqual(unreachable, [], 'these programs are invisible under every focus filter');
    },
  },
  {
    name: 'the real catalog: no chip is dead and none selects everything',
    run() {
      const total = WORKOUT_TEMPLATES_V1.length;
      for (const option of CATALOG_FOCUS_OPTIONS) {
        const hits = WORKOUT_TEMPLATES_V1.filter((template) =>
          matchesCatalogFocus(template, option.key),
        ).length;
        if (option.key === 'all') {
          assert.equal(hits, total);
          continue;
        }
        assert.ok(hits > 0, `focus "${option.key}" matches nothing`);
        assert.ok(hits < total, `focus "${option.key}" matches every program, so it filters nothing`);
      }
    },
  },
  {
    name: 'the real catalog: the mobility reset is mobility, the PPL split is upper+lower',
    run() {
      assert.deepEqual(getProgramFocusTags(templateById('tpl_2_day_mobility_reset_v1')), ['mobility']);
      const ppl = getProgramFocusTags(templateById('tpl_3_day_push_pull_legs_v1'));
      assert.ok(ppl.includes('upper'));
      assert.ok(ppl.includes('lower'));
    },
  },
  {
    name: '"Any" matches everything, including a program with no sessions at all',
    run() {
      assert.equal(matchesCatalogFocus(makeTemplate([]), 'all'), true);
      assert.equal(matchesCatalogFocus(makeTemplate([]), 'upper'), false);
    },
  },
];
