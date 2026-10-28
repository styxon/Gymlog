const assert = require('node:assert/strict');

const {
  getProgrammeBlockWeeks,
  getReadyProgramBlockWeeks,
  READY_PROGRAM_MIN_BLOCK_WEEKS,
  READY_PROGRAM_MAX_BLOCK_WEEKS,
} = require('../../src/lib/readyProgramDuration');
const { WORKOUT_TEMPLATES_V1, getWorkoutTemplateById } = require('../../src/features/workout/workoutCatalog');
const { buildHomePlanProgress } = require('../../src/lib/homePlanProgress');
const { countSessionsSince, resolveCompletionCard } = require('../../src/lib/programCompletion');
const { programmeHistoryIds } = require('../../src/lib/programLineage');
const { READY_PROGRAM_COLLECTIONS } = require('../../src/lib/readyProgramCollections');

const days = (count) => Array.from({ length: count }, (_, index) => ({ id: `s${index}` }));

module.exports = [
  {
    name: 'readyProgramDuration: the Amateur block is a dose, so fewer days a week means more weeks',
    run() {
      // 24 sessions' worth, held inside the band.
      assert.equal(getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(2) }), 12);
      assert.equal(getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(3) }), 8);
      // Denser weeks reach 24 sooner but are held at the floor, not below it.
      assert.equal(getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(4) }), 8);
      assert.equal(getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(6) }), 8);

      // The tiers above keep their own tier length.
      assert.equal(getReadyProgramBlockWeeks({ level: 'intermediate', sessions: days(3) }), 8);
      assert.equal(getReadyProgramBlockWeeks({ level: 'advanced', sessions: days(2) }), 12);
    },
  },
  {
    name: 'readyProgramDuration: an override wins inside the band and is ignored outside it',
    run() {
      assert.equal(
        getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(3), blockLengthWeeks: 10 }),
        10,
      );
      // The floor cannot be reopened one template at a time: a four-week
      // override falls back to the rule instead of being honoured.
      assert.equal(
        getReadyProgramBlockWeeks({ level: 'beginner', sessions: days(3), blockLengthWeeks: 4 }),
        8,
      );
      assert.equal(
        getReadyProgramBlockWeeks({ level: 'advanced', sessions: days(4), blockLengthWeeks: 20 }),
        12,
      );
    },
  },
  {
    name: 'readyProgramDuration: no ready program is offered as a four-week block',
    run() {
      assert.equal(READY_PROGRAM_MIN_BLOCK_WEEKS, 8);
      assert.equal(READY_PROGRAM_MAX_BLOCK_WEEKS, 12);

      for (const template of WORKOUT_TEMPLATES_V1) {
        const weeks = getReadyProgramBlockWeeks(template);
        assert.ok(
          weeks >= READY_PROGRAM_MIN_BLOCK_WEEKS && weeks <= READY_PROGRAM_MAX_BLOCK_WEEKS,
          `${template.id} block length ${weeks} outside ${READY_PROGRAM_MIN_BLOCK_WEEKS}-${READY_PROGRAM_MAX_BLOCK_WEEKS}`,
        );
      }
    },
  },
  {
    name: 'readyProgramDuration: a twice-a-week program never claims the same calendar as a denser one',
    run() {
      // The guard is on the reason, not the number: if the frequency rule ever
      // stops applying, these two land on the same week count and the block
      // silently starts meaning different amounts of work.
      const twiceAWeek = WORKOUT_TEMPLATES_V1.filter(
        (template) => template.level === 'beginner' && template.sessions.length === 2,
      );
      const threeAWeek = WORKOUT_TEMPLATES_V1.filter(
        (template) => template.level === 'beginner' && template.sessions.length === 3,
      );
      assert.ok(twiceAWeek.length > 0 && threeAWeek.length > 0, 'catalog no longer has both shapes');

      for (const template of twiceAWeek) {
        assert.equal(
          getReadyProgramBlockWeeks(template),
          12,
          `${template.id} trains twice a week but runs ${getReadyProgramBlockWeeks(template)} weeks`,
        );
      }
      for (const template of threeAWeek) {
        assert.equal(getReadyProgramBlockWeeks(template), 8, `${template.id} should run 8 weeks`);
      }
    },
  },
  {
    name: 'catalog tier coverage: the Pro tier has programs across at least three goal directions',
    run() {
      const proTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.level === 'advanced');
      assert.ok(proTemplates.length >= 5, `expected >=5 Pro programs, got ${proTemplates.length}`);

      const goalTypes = new Set(proTemplates.map((template) => template.goalType));
      assert.ok(goalTypes.size >= 3, `Pro tier covers only: ${[...goalTypes].join(', ')}`);

      // The new Pro programs are reachable from the catalog collections.
      const collected = new Set(READY_PROGRAM_COLLECTIONS.flatMap((collection) => collection.templateIds));
      for (const id of ['tpl_strong_elite_v1', 'tpl_fit_elite_v1', 'tpl_shred_elite_v1']) {
        assert.ok(collected.has(id), `${id} missing from collections`);
        assert.ok(WORKOUT_TEMPLATES_V1.some((template) => template.id === id), `${id} missing from catalog`);
      }
    },
  },
  {
    name: 'programme block: the copy made by changing one lift runs the block of the programme it came from',
    run() {
      // Two days a week of a 24-session dose: twelve weeks.
      const ready = getWorkoutTemplateById('tpl_2_day_beginner_strength_v1');
      assert.equal(getReadyProgramBlockWeeks(ready), 12);
      const stored = [
        { id: 'tpl_custom_copy', sourceTemplateId: ready.id },
        { id: 'tpl_custom_own', sourceTemplateId: null },
        { id: 'tpl_custom_orphan', sourceTemplateId: 'tpl_retired_v0' },
      ];

      assert.equal(getProgrammeBlockWeeks(ready.id, stored, getWorkoutTemplateById), 12);
      // The copy was counted as the generic eight weeks.
      assert.equal(getProgrammeBlockWeeks('tpl_custom_copy', stored, getWorkoutTemplateById), 12);
      // No catalog programme behind it: no block to claim, so the caller's
      // default still applies.
      assert.equal(getProgrammeBlockWeeks('tpl_custom_own', stored, getWorkoutTemplateById), undefined);
      assert.equal(getProgrammeBlockWeeks('tpl_custom_orphan', stored, getWorkoutTemplateById), undefined);
    },
  },
  {
    name: 'programme block: every ready programme and a copy of it count the same weeks',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        const copyId = `copy_of_${template.id}`;
        const stored = [{ id: copyId, sourceTemplateId: template.id }];
        assert.equal(
          getProgrammeBlockWeeks(copyId, stored, getWorkoutTemplateById),
          getReadyProgramBlockWeeks(template),
          template.id,
        );
      }
    },
  },
  {
    name: 'programme block: changing a lift sixteen sessions into a twelve-week block leaves it 16 of 24',
    run() {
      // The audit's walk (2026-09-20), through the pieces Home composes. The
      // copy keeps the plan record's start and counts the original's
      // sessions; before this it counted them over eight weeks, read "week
      // 8/8, 16/16", and the completion card called the block finished with
      // eight sessions still to go.
      const ready = getWorkoutTemplateById('tpl_2_day_beginner_strength_v1');
      const planStart = new Date(2026, 6, 1, 8).toISOString();
      const sessions = Array.from({ length: 16 }, (_, index) => ({
        id: `s${index}`,
        workoutTemplateId: ready.id,
        performedAt: new Date(2026, 6, 2 + index * 3, 18).toISOString(),
      }));
      const copy = { id: 'tpl_custom_copy', sourceTemplateId: ready.id };
      const progress = buildHomePlanProgress({
        language: 'fi',
        completedSessions: countSessionsSince(sessions, new Set(programmeHistoryIds(copy.id, [copy], [])), planStart),
        sessionsPerWeek: ready.sessions.length,
        totalWeeks: getProgrammeBlockWeeks(copy.id, [copy], getWorkoutTemplateById),
      });

      assert.equal(progress.weekLabel, 'Viikko 9 / 12');
      assert.deepEqual([progress.sessionsDone, progress.sessionsTotal], [16, 24]);
      assert.equal(
        resolveCompletionCard({
          planId: 'custom_plan_tpl_custom_copy',
          sessionsDone: progress.sessionsDone,
          sessionsTotal: progress.sessionsTotal,
          activeTemplate: null,
          catalog: WORKOUT_TEMPLATES_V1,
          dismissedPlanIds: [],
        }),
        null,
      );
    },
  },
];
