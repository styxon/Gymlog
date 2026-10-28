const assert = require('node:assert/strict');

const { buildAiCoachProgramme, renderAiCoachProgramme } = require('../../src/lib/aiCoachProgramme');
const { buildAiCoachSystemContext } = require('../../src/lib/aiCoachSystemContext');
const { normalizeAiCoachTrainingContext } = require('../../src/lib/aiTrainingContext');

function card(overrides = {}) {
  return {
    title: 'Pakarakunto · Pro',
    programType: 'custom',
    sessions: [
      {
        title: 'Alavartalo',
        dayLabel: 'Ma',
        durationMinutes: 52,
        exercises: [
          { name: 'Hip Thrust', setsLabel: '4 sets', schemeLabel: '4 × 8' },
          { name: 'Bulgarian Split Squat', setsLabel: '3 sets', schemeLabel: '3 × 10' },
        ],
      },
      {
        title: 'Ylävartalo',
        dayLabel: 'To',
        durationMinutes: 44,
        exercises: [{ name: 'Bench Press', setsLabel: '4 sets', schemeLabel: '4 × 6' }],
      },
    ],
    ...overrides,
  };
}

module.exports = [
  {
    name: 'the running programme reaches the coach as days and exercises, not just a name',
    run() {
      // The coach was given `custom: Pakarakunto · Pro` and nothing else, so
      // asked what the programme contained it answered "I cannot see your
      // programme's exercises in this data" — true of the payload, absurd to a
      // reader one tap from the list (#bugs 2026-08-25).
      const programme = buildAiCoachProgramme(card());
      assert.equal(programme.title, 'Pakarakunto · Pro');
      assert.equal(programme.source, 'custom');
      assert.equal(programme.daysPerWeek, 2);
      assert.equal(programme.truncated, false);
      assert.deepEqual(programme.days[0], {
        name: 'Alavartalo',
        dayLabel: 'Ma',
        estimatedMinutes: 52,
        exercises: [
          { name: 'Hip Thrust', scheme: '4 × 8' },
          { name: 'Bulgarian Split Squat', scheme: '3 × 10' },
        ],
      });
    },
  },
  {
    name: 'no plan is no section, and an empty week never renders as a programme with no days',
    run() {
      assert.equal(buildAiCoachProgramme(null), null);
      assert.equal(buildAiCoachProgramme(card({ sessions: [] })), null);
      assert.equal(buildAiCoachProgramme(card({ title: '   ' })), null);
    },
  },
  {
    name: 'a trimmed day says so, and still counts the days the plan really has',
    run() {
      const long = card({
        sessions: Array.from({ length: 9 }, (unused, index) => ({
          title: `Day ${index + 1}`,
          dayLabel: null,
          durationMinutes: null,
          exercises: Array.from({ length: 14 }, (alsoUnused, slot) => ({
            name: `Lift ${slot + 1}`,
            schemeLabel: '3 × 10',
          })),
        })),
      });
      const programme = buildAiCoachProgramme(long);
      assert.equal(programme.days.length, 7, 'the payload is capped');
      assert.equal(programme.days[0].exercises.length, 12);
      // A trimmed payload must not read as a shorter week than the reader has,
      // or the coach advises on a programme that does not exist.
      assert.equal(programme.daysPerWeek, 9);
      assert.equal(programme.truncated, true);
      assert.ok(renderAiCoachProgramme(programme).some((row) => row.includes('shortened')));
    },
  },
  {
    name: 'a card with no scheme falls back to the set count rather than an empty column',
    run() {
      const programme = buildAiCoachProgramme(
        card({
          sessions: [
            { title: 'Koko keho', dayLabel: null, durationMinutes: null, exercises: [{ name: 'Deadlift', setsLabel: '5 sets' }] },
          ],
        }),
      );
      assert.deepEqual(programme.days[0].exercises, [{ name: 'Deadlift', scheme: '5 sets' }]);
    },
  },
  {
    name: 'the prompt carries the week, and an older client that sends none still builds a prompt',
    run() {
      const context = normalizeAiCoachTrainingContext({ programme: buildAiCoachProgramme(card()) });
      const text = buildAiCoachSystemContext(context);
      assert.ok(text.includes('## Current programme'), text.slice(0, 400));
      assert.ok(text.includes('Hip Thrust: 4 × 8'));
      assert.ok(text.includes('Ma · Alavartalo'));

      // A payload from an installed app that predates this field must not
      // throw on the way to the model, and must not invent a programme.
      const older = normalizeAiCoachTrainingContext({});
      assert.equal(older.programme, null);
      assert.ok(!buildAiCoachSystemContext(older).includes('Current programme'));
    },
  },
];
