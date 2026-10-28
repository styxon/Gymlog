const assert = require('node:assert/strict');

const {
  WORKOUT_TEMPLATES_V1,
  WORKOUT_SUBSTITUTION_GROUPS,
} = require('../../src/features/workout/workoutCatalog');
const { emphasisAreaForExercise } = require('../../src/lib/programEmphasis');

// The swap groups used to include 57-name body-part buckets: a leg curl's
// "alternatives" opened with a bench press, and 47% of all swap options were a
// different body area than the exercise being replaced. These suites pin the
// repaired state — every group is one movement family — so a new program
// cannot quietly reintroduce a bucket.

/**
 * Names whose library-derived emphasis area is known to disagree with what
 * the movement is. The area here is what the swap family actually trains;
 * each entry exists because the library filed the name somewhere surprising
 * (deadlifts under "back", a side plank under "chest").
 *
 * When this test fails on a new name, either the name joined the wrong group
 * (fix the group) or the library misfiles it (add it here, with the reason).
 */
const AREA_OVERRIDES = new Map([
  // The library files every conventional deadlift under back. The swap family
  // is the hinge, alongside sumo and good mornings.
  ['Deadlift', 'glutesLegs'],
  ['Conventional Deadlift', 'glutesLegs'],
  ['Competition Deadlift', 'glutesLegs'],
  ['Deficit Deadlift', 'glutesLegs'],
  // Filed under back; it is a lunge.
  ['Curtsy Lunge', 'glutesLegs'],
  // Plank-position work is core however the library labels the limb that
  // moves (climbers as cardio, side plank as chest, renegade row as back).
  ['Mountain Climbers', 'core'],
  ['Mountain Climber', 'core'],
  ['Mountain Climber (20s on / 10s off)', 'core'],
  ['Push Up to Side Plank', 'core'],
  ['Side Plank', 'core'],
  ['Plank Shoulder Tap', 'core'],
  ['Renegade Row', 'core'],
  ['Dumbbell Renegade Row', 'core'],
  // A loaded carry is a conditioning piece, not the chest exercise the
  // library files it as.
  ["Farmer's Walk", 'conditioning'],
  // A walkout is a dynamic mobility drill however the library reads the legs.
  ['Inchworm to Push-Up', 'mobility'],
  // Ballistic power family: swing, clean and slam swap for each other.
  ['Kettlebell Swing', 'conditioning'],
  ['Power Clean', 'conditioning'],
  ['Medicine Ball Slam', 'conditioning'],
  // Jumps are plyometric conditioning even when the library files the squat
  // shape under legs.
  ['Jump Squat', 'conditioning'],
  ['Squat Jump (20s on / 10s off)', 'conditioning'],
  ['Lateral Bound', 'conditioning'],
  ['Bulgarian Split Squat (Jumping)', 'conditioning'],
  // Stretches and balance drills filed under the muscle they touch.
  ['Kneeling Hip Flexor', 'mobility'],
  ['Deep Squat Hold', 'mobility'],
  ['Supported Deep Squat Hold', 'mobility'],
  ['Single-Leg Balance Hold', 'mobility'],
  ['Single-Leg Balance Reach', 'mobility'],
  ['Supported Single-Leg Balance', 'mobility'],
  // Spine mobility drills filed under back/chest/core by the library.
  ['Cat-Cow', 'mobility'],
  ['Thoracic Extension on Roller', 'mobility'],
  ['Spinal Twist (Supine)', 'mobility'],
  ['Seated Spinal Twist', 'mobility'],
  // Straight-arm calisthenics skill work; the L-sit and dragon flag belong to
  // the same progression family as the planche and lever holds.
  ['L-Sit Hold', 'shouldersBack'],
  ['Dragon Flag', 'shouldersBack'],
  // The library has no area for the pec deck at all.
  ['Pec Deck', 'chestArms'],
]);

function areaFor(name) {
  return AREA_OVERRIDES.get(name) ?? emphasisAreaForExercise(name);
}

/**
 * Rows allowed to use a group other than the first one that contains their
 * name. RESET Yoga prescribes two drills that also live in mobility_flow, but
 * a yoga session should offer yoga swaps.
 */
const CONTEXT_GROUP_EXCEPTIONS = new Set([
  "World's Greatest Stretch|yoga_flow",
  'Standing Hip Circles|yoga_flow',
]);

const groupsById = new Map(WORKOUT_SUBSTITUTION_GROUPS.map((group) => [group.id, group]));

module.exports = [
  {
    name: 'every catalog row points at a group that exists and contains the exercise itself',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const group = groupsById.get(exercise.substitutionGroup);
            assert.ok(
              group,
              `${template.name} / ${session.name} / ${exercise.exerciseName} points at unknown group "${exercise.substitutionGroup}"`,
            );
            assert.ok(
              group.allowedExerciseNames.includes(exercise.exerciseName),
              `${template.name} / ${session.name}: "${exercise.exerciseName}" is not in its own swap group "${group.id}"`,
            );
          }
        }
      }
    },
  },
  {
    // One area per group. This is what keeps a swap pool a movement family:
    // the moment a leg exercise lands in an arm group, this names the exact
    // exercise and group rather than degrading the swap sheet silently.
    name: 'every substitution group holds a single emphasis area',
    run() {
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
        const areas = new Map();
        for (const name of group.allowedExerciseNames) {
          const area = areaFor(name);
          if (!areas.has(area)) {
            areas.set(area, []);
          }
          areas.get(area).push(name);
        }
        assert.equal(
          areas.size,
          1,
          `group "${group.id}" mixes areas: ${[...areas.entries()]
            .map(([area, names]) => `${area}(${names.join(', ')})`)
            .join(' | ')}`,
        );
      }
    },
  },
  {
    // A 57-name pool is not a swap list, it is the exercise library with
    // extra steps. The cap is far above any real movement family.
    name: 'no substitution group grows past 12 exercises',
    run() {
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
        assert.ok(
          group.allowedExerciseNames.length <= 12,
          `group "${group.id}" has ${group.allowedExerciseNames.length} exercises — that is a bucket, not a movement family`,
        );
      }
    },
  },
  {
    // Custom programs and onboarding resolve a group from the exercise name
    // (first group that contains it). If a ready row uses a different group
    // for the same name, the same lift gets two different swap sheets
    // depending on which surface shows it — the two-truths bug class.
    name: 'ready rows agree with name-based group resolution',
    run() {
      const firstGroupFor = (name) => {
        const normalized = name.trim().toLowerCase();
        return (
          WORKOUT_SUBSTITUTION_GROUPS.find((candidate) =>
            candidate.allowedExerciseNames.some((allowed) => allowed.trim().toLowerCase() === normalized),
          )?.id ?? null
        );
      };
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            if (CONTEXT_GROUP_EXCEPTIONS.has(`${exercise.exerciseName}|${exercise.substitutionGroup}`)) {
              continue;
            }
            assert.equal(
              exercise.substitutionGroup,
              firstGroupFor(exercise.exerciseName),
              `${template.name} / ${session.name}: "${exercise.exerciseName}" would resolve to a different group in a custom program`,
            );
          }
        }
      }
    },
  },
  {
    // Overrides and exceptions must stay real: an entry for a name no group
    // carries is either a typo or leftovers from a removed exercise.
    name: 'guard tables only name exercises that exist in the groups',
    run() {
      const allNames = new Set();
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
        for (const name of group.allowedExerciseNames) {
          allNames.add(name);
        }
      }
      for (const name of AREA_OVERRIDES.keys()) {
        assert.ok(allNames.has(name), `AREA_OVERRIDES names "${name}", which no substitution group contains`);
      }
      for (const entry of CONTEXT_GROUP_EXCEPTIONS) {
        const [name, groupId] = entry.split('|');
        const group = groupsById.get(groupId);
        assert.ok(group, `CONTEXT_GROUP_EXCEPTIONS names unknown group "${groupId}"`);
        assert.ok(
          group.allowedExerciseNames.includes(name),
          `CONTEXT_GROUP_EXCEPTIONS names "${name}", which is not in "${groupId}"`,
        );
      }
    },
  },
];
