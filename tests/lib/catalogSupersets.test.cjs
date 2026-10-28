const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
const { buildSupersetRuns, normalizeSupersetGroups } = require('../../src/lib/supersetGrouping');
const { parseIntervalScheme } = require('../../src/lib/intervalScheme');

/** Every superset the catalog prescribes, with the day it belongs to. */
function catalogSupersets() {
  const groups = [];
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const run of buildSupersetRuns(normalizeSupersetGroups(session.exercises))) {
        if (run.groupId === null || run.indexes.length < 2) {
          continue;
        }
        groups.push({
          where: `${template.id}/${session.id}`,
          members: run.indexes.map((index) => session.exercises[index]),
        });
      }
    }
  }
  return groups;
}

module.exports = [
  {
    /**
     * The catalog prescribes supersets, and a reader who never edits a
     * programme still meets one. Asserted as a floor rather than a count, so
     * adding programmes does not fail this — but deleting the last superset
     * does.
     */
    name: 'catalog: ready programmes prescribe supersets',
    run() {
      const groups = catalogSupersets();
      assert.ok(groups.length >= 50, `only ${groups.length} supersets in the catalog`);
    },
  },
  {
    /**
     * A prescribed superset must not ask the reader the question the day view
     * asked on 2026-09-11: how can this be "4 × 8" and "3 × 10" at once? The
     * answer is that the block is four ROUNDS — so every lift in one has to
     * have the same number of sets, or the last round is one lift alone.
     */
    name: 'catalog: every prescribed superset runs the same number of sets per lift',
    run() {
      for (const group of catalogSupersets()) {
        const counts = new Set(group.members.map((member) => member.sets));
        assert.equal(counts.size, 1, `${group.where}: ${[...counts].join(' vs ')}`);
      }
    },
  },
  {
    /**
     * Supersets are prescribed on the light work at the end of a day, where
     * the two lifts do not compete for the same recovery. An anchor lift
     * paired with anything is a different prescription, and not one the
     * catalog makes by accident.
     */
    name: 'catalog: supersets hold accessory work, never an anchor',
    run() {
      for (const group of catalogSupersets()) {
        for (const member of group.members) {
          assert.equal(member.role, 'accessory', `${group.where}: ${member.exerciseName}`);
          assert.equal(member.progressionPriority, 'low', `${group.where}: ${member.exerciseName}`);
        }
      }
    },
  },
  {
    /**
     * A hold is measured in seconds and an interval states its own recovery.
     * Neither belongs in a block whose rule is "no rest until the round ends"
     * — the interval's own off-phase would be the thing being skipped.
     */
    name: 'catalog: no holds or intervals inside a superset',
    run() {
      for (const group of catalogSupersets()) {
        for (const member of group.members) {
          assert.notEqual(member.trackingMode, 'hold', `${group.where}: ${member.exerciseName}`);
          assert.equal(
            parseIntervalScheme(member.exerciseName),
            null,
            `${group.where}: ${member.exerciseName}`,
          );
        }
      }
    },
  },
  {
    /**
     * And the two lifts train different patterns. Two rows from one
     * substitution group are two ways of doing the same thing, which is a drop
     * set, not a superset.
     */
    name: 'catalog: a superset pairs different movement patterns',
    run() {
      for (const group of catalogSupersets()) {
        const patterns = new Set(group.members.map((member) => member.substitutionGroup));
        assert.equal(patterns.size, group.members.length, `${group.where}: ${[...patterns].join(', ')}`);
      }
    },
  },
  {
    /**
     * A tag with no partner is the bug the adjacency rule exists to erase:
     * `normalizeSupersetGroups` would drop it on load, so the catalog would
     * ship a pairing nothing ever honours. Counted before normalization, which
     * is the only place it is still visible.
     */
    name: 'catalog: no superset tag is left without its partner',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          const tagged = session.exercises.filter((exercise) => exercise.supersetGroup);
          const kept = normalizeSupersetGroups(session.exercises).filter(
            (exercise) => exercise.supersetGroup,
          );
          assert.equal(
            tagged.length,
            kept.length,
            `${template.id}/${session.id}: ${tagged.length - kept.length} tag(s) dropped on load`,
          );
        }
      }
    },
  },
];
