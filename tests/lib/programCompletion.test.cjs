const assert = require('node:assert/strict');

const {
  isPlanComplete,
  resolveCompletionCard,
  countSessionsSince,
} = require('../../src/lib/programCompletion');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

function template(id, goalType, level, daysPerWeek) {
  return { id, name: id, goalType, level, daysPerWeek, splitType: 'upper_lower', sessions: [] };
}

module.exports = [
  {
    name: 'a plan is complete when the planned total is real and reached',
    run() {
      assert.equal(isPlanComplete(32, 32), true);
      assert.equal(isPlanComplete(33, 32), true);
      assert.equal(isPlanComplete(31, 32), false);
      // A freestyle plan reports 0 planned sessions; 0 >= 0 must not declare
      // every empty plan finished on install day.
      assert.equal(isPlanComplete(0, 0), false);
    },
  },
  {
    name: 'the completion card carries the step up and respects dismissal',
    run() {
      const catalog = [
        template('a_mid', 'strength', 'intermediate', 4),
        template('a_adv', 'strength', 'advanced', 4),
        template('b_mid', 'hypertrophy', 'intermediate', 4),
      ];
      const input = {
        planId: 'ready_plan_a_mid',
        sessionsDone: 32,
        sessionsTotal: 32,
        activeTemplate: catalog[0],
        catalog,
        dismissedPlanIds: [],
      };

      const card = resolveCompletionCard(input);
      assert.ok(card);
      assert.equal(card.nextLevelTemplateId, 'a_adv');

      // Answered once, gone for good — the card is a question, not a banner.
      assert.equal(
        resolveCompletionCard({ ...input, dismissedPlanIds: ['ready_plan_a_mid'] }),
        null,
      );
      // Not complete → no card, regardless of anything else.
      assert.equal(resolveCompletionCard({ ...input, sessionsDone: 31 }), null);
    },
  },
  {
    name: 'finishing the top of a family offers no invented step up',
    run() {
      const catalog = [
        template('a_mid', 'strength', 'intermediate', 4),
        template('a_adv', 'strength', 'advanced', 4),
      ];
      const card = resolveCompletionCard({
        planId: 'ready_plan_a_adv',
        sessionsDone: 32,
        sessionsTotal: 32,
        activeTemplate: catalog[1],
        catalog,
        dismissedPlanIds: [],
      });
      assert.ok(card);
      assert.equal(card.nextLevelTemplateId, null);
    },
  },
  {
    // The suggestion must survive the real catalog, not just fixtures: every
    // non-advanced ready program should resolve SOME card, and any step up it
    // names must exist in the catalog it came from.
    name: 'against the real catalog, every named step up exists',
    run() {
      for (const active of WORKOUT_TEMPLATES_V1) {
        const card = resolveCompletionCard({
          planId: `ready_plan_${active.id}`,
          sessionsDone: 1,
          sessionsTotal: 1,
          activeTemplate: active,
          catalog: WORKOUT_TEMPLATES_V1,
          dismissedPlanIds: [],
        });
        assert.ok(card, `${active.id} resolved no card at completion`);
        if (card.nextLevelTemplateId) {
          assert.ok(
            WORKOUT_TEMPLATES_V1.some((item) => item.id === card.nextLevelTemplateId),
            `${active.id} suggested a template that does not exist`,
          );
        }
      }
    },
  },
  {
    name: 'a restarted plan counts only sessions after the boundary',
    run() {
      const templateIds = new Set(['tpl_a']);
      const sessions = [
        { workoutTemplateId: 'tpl_a', performedAt: '2026-07-01T10:00:00.000Z' },
        { workoutTemplateId: 'tpl_a', performedAt: '2026-08-05T10:00:00.000Z' },
        { workoutTemplateId: 'tpl_b', performedAt: '2026-08-05T11:00:00.000Z' },
        { workoutTemplateId: 'tpl_a', performedAt: 'not-a-date' },
      ];

      assert.equal(countSessionsSince(sessions, templateIds, '2026-08-01T00:00:00.000Z'), 1);
      assert.equal(countSessionsSince(sessions, templateIds, '2026-01-01T00:00:00.000Z'), 2);
      // An unreadable boundary must not mean "count everything" — a restarted
      // plan born complete is the bug this exists to prevent.
      assert.equal(countSessionsSince(sessions, templateIds, 'garbage'), 0);
    },
  },
  // The three suites that stood here pinned countPlanSessionsInRange, the
  // Monday-to-Sunday counter behind the "VIIKKO 1 · 2/2" pill. The pill
  // counted the calendar under a week label taken from the block, and the
  // two disagreed for every plan not started on a Monday (audit,
  // 2026-09-20); it reads the block now, and the counter had no other
  // caller. Its two rules — only the plan's own sessions, and none without
  // a completed set — are held where the pill's count comes from, in
  // homePlanProgress.test.cjs.
];
