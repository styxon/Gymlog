const assert = require('node:assert/strict');

const { resolveNextPlanEntryIndex } = require('../../src/lib/planRotation');
const { buildProgramWorkoutPlan, buildReadyProgramPlanId } = require('../../src/lib/programAdoption');
const { buildReadySessionRuntimeTemplate } = require('../../src/lib/programDetails');
const { getWorkoutTemplateById } = require('../../src/features/workout/workoutCatalog');

/**
 * The reported bug: after Monday's workout, Home offers Monday's workout again.
 *
 * Both ends of that chain have been read and found correct in isolation — the
 * rotation rule, and the save path that carries the session id. What was never
 * pinned is that the ids AGREE: the plan records one set of session ids at
 * adoption, and a started session carries whatever the runtime template names.
 * If those two ever drift, the rotation matches nothing, silently falls back to
 * entry 0, and every day is day one.
 */
function completedFrom(runtimeTemplate, performedAt) {
  return {
    // The two fields the adapter writes from the runtime session
    // (workoutAppAdapter: templateId / templateSessionId).
    workoutTemplateId: runtimeTemplate.id,
    workoutTemplateSessionId:
      runtimeTemplate.sessions.length === 1 ? runtimeTemplate.sessions[0].id : null,
    performedAt,
  };
}

module.exports = [
  {
    name: 'a ready plan advances one day per logged session and wraps',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const plan = buildProgramWorkoutPlan({
        planId: buildReadyProgramPlanId(template.id),
        workoutTemplateId: template.id,
        programName: template.name,
        sessionIds: template.sessions.map((session) => session.id),
        dayLabels: ['mon', 'wed', 'fri'],
        now: '2026-08-17T06:00:00.000Z',
      });

      const completed = [];
      const days = ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-24'];
      const expectedNext = [1, 2, 0, 1];

      days.forEach((day, round) => {
        const index = resolveNextPlanEntryIndex(plan.entries, completed);
        // The session the app would start for this round, built the same way
        // the start path builds it.
        const runtime = buildReadySessionRuntimeTemplate(
          template,
          plan.entries[index].workoutTemplateSessionId,
        );
        completed.push(completedFrom(runtime, `${day}T17:00:00.000Z`));

        assert.equal(
          resolveNextPlanEntryIndex(plan.entries, completed),
          expectedNext[round],
          `round ${round + 1}: the plan offered the same day again`,
        );
      });
    },
  },
  {
    name: 'the ids a started session carries are the ids the plan recorded',
    run() {
      const template = getWorkoutTemplateById('tpl_4_day_upper_lower_v1');
      const plan = buildProgramWorkoutPlan({
        planId: buildReadyProgramPlanId(template.id),
        workoutTemplateId: template.id,
        programName: template.name,
        sessionIds: template.sessions.map((session) => session.id),
        dayLabels: ['mon', 'tue', 'thu', 'fri'],
        now: '2026-08-17T06:00:00.000Z',
      });

      plan.entries.forEach((entry) => {
        const runtime = buildReadySessionRuntimeTemplate(template, entry.workoutTemplateSessionId);
        assert.equal(runtime.id, entry.workoutTemplateId);
        assert.equal(runtime.sessions.length, 1, 'a started day must be one session, or the id is dropped');
        assert.equal(runtime.sessions[0].id, entry.workoutTemplateSessionId);
      });
    },
  },
  {
    name: 'a plan whose entries name no session still advances per session',
    run() {
      // Older plans (and the demo) label entries by position, so every entry
      // stands for the whole template. The rotation must still step forward
      // instead of pinning itself to the first match.
      const entries = [
        { workoutTemplateId: 'tpl', workoutTemplateSessionId: null },
        { workoutTemplateId: 'tpl', workoutTemplateSessionId: null },
        { workoutTemplateId: 'tpl', workoutTemplateSessionId: null },
      ];
      const completed = [
        { workoutTemplateId: 'tpl', workoutTemplateSessionId: null, performedAt: '2026-08-17T17:00:00.000Z' },
      ];

      assert.equal(resolveNextPlanEntryIndex(entries, completed), 1);

      completed.push({
        workoutTemplateId: 'tpl',
        workoutTemplateSessionId: null,
        performedAt: '2026-08-19T17:00:00.000Z',
      });
      // This returned 1 again — and again after the third, and the fourth. With
      // nothing to match on, the count is what moves the plan forward.
      assert.equal(resolveNextPlanEntryIndex(entries, completed), 2);

      completed.push({
        workoutTemplateId: 'tpl',
        workoutTemplateSessionId: null,
        performedAt: '2026-08-21T17:00:00.000Z',
      });
      assert.equal(resolveNextPlanEntryIndex(entries, completed), 0);

      // Another programme's sessions are not this plan's days.
      completed.push({
        workoutTemplateId: 'other',
        workoutTemplateSessionId: null,
        performedAt: '2026-08-22T17:00:00.000Z',
      });
      assert.equal(resolveNextPlanEntryIndex(entries, completed), 0);
    },
  },
];
