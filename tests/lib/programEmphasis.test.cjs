const assert = require('node:assert/strict');

const { resolveProgramEmphasis } = require('../../src/lib/programEmphasis');
const {
  programCoverIndex,
  PROGRAM_COVER_STYLES,
  EMPHASIS_RAMP,
} = require('../../src/lib/programVisualIdentity');
const { EMPHASIS_AREA_KEYS } = require('../../src/lib/programEmphasis');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

function toEmphasisSessions(template) {
  return template.sessions.map((session) => ({
    exercises: session.exercises.map((exercise) => ({ name: exercise.exerciseName, sets: exercise.sets })),
  }));
}

module.exports = [
  {
    // The card is computed from the sessions the programme actually
    // prescribes; a distribution that disagreed with the exercise list below
    // it would be the seed-data lie one card up.
    name: 'every ready program yields an emphasis whose sets and percents add up',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        const emphasis = resolveProgramEmphasis(toEmphasisSessions(template));
        assert.ok(emphasis, `${template.id} produced no emphasis`);

        const declaredSets = template.sessions.reduce(
          (sum, session) => sum + session.exercises.reduce((inner, exercise) => inner + exercise.sets, 0),
          0,
        );
        const slicedSets = emphasis.slices.reduce((sum, slice) => sum + slice.sets, 0);
        assert.equal(slicedSets, declaredSets, `${template.id} lost sets in the split`);
        assert.equal(emphasis.totalSets, declaredSets);

        const percentSum = emphasis.slices.reduce((sum, slice) => sum + slice.percent, 0);
        assert.equal(percentSum, 100, `${template.id} percents sum to ${percentSum}`);
      }
    },
  },
  {
    /**
     * Every programme's week is named — none of it is "Other".
     *
     * "Where the week goes" is the design's promise that a reader can see what
     * a programme trains before running it, and `other` breaks that promise
     * silently: the bar still draws, the percentages still add to 100, and the
     * largest slice says nothing. Mobility Flow's week was 51 % "Other", RUN's
     * 45 %, Calisthenics Mastery's 44 % — the card was a shrug.
     *
     * Zero is the bar because a new exercise name that lands nowhere is
     * exactly the drift this catches. Naming it costs one word in NAME_HINTS.
     */
    name: 'no programme has an unnamed slice in "where the week goes"',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const emphasis = resolveProgramEmphasis(toEmphasisSessions(template));
        const other = emphasis.slices.find((slice) => slice.area === 'other');
        if (other) {
          offenders.push(`${template.name}: ${other.percent} %`);
        }
      }

      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'every exercise the catalog prescribes lands in a named area',
    run() {
      const { emphasisAreaForExercise } = require('../../src/lib/programEmphasis');
      const unplaced = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            if (emphasisAreaForExercise(exercise.exerciseName) === 'other') {
              unplaced.add(exercise.exerciseName);
            }
          }
        }
      }

      // Named per exercise rather than per programme, so the failure tells you
      // which word to add instead of which programme to go hunting through.
      assert.deepEqual([...unplaced].sort(), []);
    },
  },
  {
    name: 'a glute-focused week puts glutes and legs on top',
    run() {
      const emphasis = resolveProgramEmphasis([
        {
          exercises: [
            { name: 'Barbell Hip Thrust', sets: 4 },
            { name: 'Romanian Deadlift', sets: 4 },
            { name: 'Cable Kickback', sets: 3 },
            { name: 'Overhead Press', sets: 2 },
          ],
        },
      ]);
      assert.equal(emphasis.slices[0].area, 'glutesLegs');
      assert.equal(emphasis.slices[0].sets, 11);
    },
  },
  {
    name: 'an empty program yields no emphasis rather than a fabricated one',
    run() {
      assert.equal(resolveProgramEmphasis([]), null);
      assert.equal(resolveProgramEmphasis([{ exercises: [] }]), null);
    },
  },
  {
    // Identity, not position: the same programme must wear the same colour on
    // every surface, forever — the browse screen used to colour by list index,
    // so one programme changed colour between rows.
    name: 'cover colours are stable, in range, and spread across the palette',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        const first = programCoverIndex(template.id);
        assert.equal(first, programCoverIndex(template.id));
        assert.ok(first >= 0 && first < PROGRAM_COVER_STYLES.length);
      }
      // The hash must actually spread: a catalog painted one colour is the
      // bug this replaces, reintroduced through the back door.
      const used = new Set(WORKOUT_TEMPLATES_V1.map((template) => programCoverIndex(template.id)));
      assert.ok(used.size >= 4, `only ${used.size} of ${PROGRAM_COVER_STYLES.length} styles in use`);
    },
  },
  {
    /**
     * Every area of the week is told apart by hue, not by tint.
     *
     * The ramp was four shades of one violet plus two outliers, and at
     * legend-dot size the difference between two tints of the same hue is a
     * guess — so matching a slice to its label was guesswork on the three
     * biggest slices of most programmes.
     */
    name: 'the emphasis bar gives every area its own colour, and none of them the action accent',
    run() {
      const areas = Object.keys(EMPHASIS_AREA_KEYS);
      const colours = areas.map((area) => EMPHASIS_RAMP[area]);

      for (const [index, colour] of colours.entries()) {
        assert.ok(colour, `${areas[index]} has no colour in the ramp`);
        assert.match(colour, /^#[0-9A-F]{6}$/, `${areas[index]}: ${colour} is not a plain hex`);
      }
      assert.equal(
        new Set(colours).size,
        areas.length,
        `two areas share a colour: ${areas.map((area, index) => `${area} ${colours[index]}`).join(', ')}`,
      );

      // Orange means "you can press this" on the screen this bar lives on
      // (darkTheme.ts, user decision 2026-08-01). A slice of a chart cannot be
      // pressed, so the action accent stays out of the ramp.
      assert.ok(!colours.includes('#FF8A4C'), 'the action accent is in the emphasis ramp');

      // And the ramp answers for exactly the areas that exist: a colour with
      // no area is dead, an area with no colour renders a transparent slice.
      assert.deepEqual(Object.keys(EMPHASIS_RAMP).slice().sort(), areas.slice().sort());
    },
  },
];
