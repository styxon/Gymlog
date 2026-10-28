const assert = require('node:assert/strict');

const { composeProgramWeekForSelection } = require('../../src/lib/programDayComposer');
const { buildProgramFocusSplit } = require('../../src/lib/programFocusSplit');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../src/lib/firstRunSetup');
const {
  WORKOUT_SUBSTITUTION_GROUPS,
  WORKOUT_TEMPLATES_V1,
} = require('../../src/features/workout/workoutCatalog');

function findTemplateWithDays(days) {
  const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.daysPerWeek === days);
  assert.ok(template, `catalog should have a ${days}-day template`);
  return template;
}

function selectionWithDays(days) {
  return { ...DEFAULT_FIRST_RUN_SELECTION, daysPerWeek: days, availableDays: [], scheduleMode: 'app_managed' };
}

module.exports = [
  {
    name: 'programDayComposer: requested days below template trims the week to exactly N template sessions',
    run() {
      const template = findTemplateWithDays(5);
      const week = composeProgramWeekForSelection(selectionWithDays(4), template.id);

      assert.ok(week);
      assert.equal(week.days, 4);
      assert.equal(week.sessions.length, 4);
      assert.ok(week.sessions.every((session) => session.source === 'template'));
      assert.ok(week.sessions.every((session) => session.exercises.length > 0));
      assert.equal(week.composed, true);
      assert.equal(week.totalWorkouts, week.weeks * 4);
    },
  },
  {
    name: 'programDayComposer: requested days above template extends with suggested days that hold real exercises',
    run() {
      const template = findTemplateWithDays(3);
      const week = composeProgramWeekForSelection(selectionWithDays(5), template.id);

      assert.ok(week);
      assert.equal(week.days, 5);
      const templateSessions = week.sessions.filter((session) => session.source === 'template');
      const suggestedSessions = week.sessions.filter((session) => session.source === 'suggested');
      assert.equal(templateSessions.length, 3);
      assert.equal(suggestedSessions.length, 2);
      for (const session of suggestedSessions) {
        assert.ok(session.exercises.length > 0);
        for (const exercise of session.exercises) {
          assert.ok(exercise.sets >= 1);
          assert.ok(exercise.exerciseName.length > 0);
        }
      }
      assert.equal(week.composed, true);
    },
  },
  {
    name: 'programDayComposer: exact match keeps the template week untouched',
    run() {
      const template = findTemplateWithDays(4);
      const week = composeProgramWeekForSelection(selectionWithDays(4), template.id);

      assert.ok(week);
      assert.equal(week.days, template.daysPerWeek);
      assert.equal(week.composed, false);
      assert.ok(week.sessions.every((session) => session.source === 'template'));
      const sortedTemplateSessions = [...template.sessions].sort((a, b) => a.orderIndex - b.orderIndex);
      week.sessions.forEach((session, index) => {
        assert.equal(session.exercises.length, sortedTemplateSessions[index].exercises.length);
      });
    },
  },
  {
    name: 'programDayComposer: days-per-week truth holds for every selectable count on a 5-day base',
    run() {
      const template = findTemplateWithDays(5);
      for (const days of [2, 3, 4, 5, 6]) {
        const week = composeProgramWeekForSelection(selectionWithDays(days), template.id);
        assert.ok(week);
        assert.equal(week.days, days, `requested ${days} days must compose ${days} sessions`);
        assert.equal(week.totalWorkouts, week.weeks * days);
        const split = buildProgramFocusSplit(week.sessions);
        assert.equal(split.reduce((sum, segment) => sum + segment.pct, 0), 100);
      }
    },
  },
  {
    name: 'programDayComposer: unknown program returns null',
    run() {
      assert.equal(composeProgramWeekForSelection(selectionWithDays(3), 'tpl_does_not_exist'), null);
    },
  },
  {
    name: 'composed exercises land in real swap groups, so a built plan can be swapped',
    run() {
      // The composer used to stamp every exercise with `onboarding_<role>_<n>`
      // — ids that exist in no group — so getAllowedSwaps found nothing and
      // NOTHING built through onboarding could be substituted. The list logger
      // opened an empty swap sheet; the guided player showed no swap row.
      const template = findTemplateWithDays(3);
      const week = composeProgramWeekForSelection(selectionWithDays(3), template.id);
      assert.ok(week, 'the composer should produce a week');

      const exercises = week.sessions.flatMap((session) => session.exercises);
      assert.ok(exercises.length > 0);

      const swappable = exercises.filter((exercise) => {
        const group = WORKOUT_SUBSTITUTION_GROUPS.find(
          (candidate) => candidate.id === exercise.substitutionGroup,
        );
        return Boolean(group && group.allowedExerciseNames.length > 1);
      });

      // Not all of them: an exercise the catalog does not group is genuinely
      // unswappable and keeps the synthetic id. Most of them must be.
      assert.ok(
        swappable.length > exercises.length / 2,
        `only ${swappable.length}/${exercises.length} composed exercises can be swapped`,
      );
    },
  },
];
