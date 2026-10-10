const assert = require('node:assert/strict');

const {
  listHeldProgrammes,
  listRunningProgrammes,
  planIdsForTemplate,
  planIdsHoldingTemplate,
  leadAfterStopping,
  leadTemplateId,
  programmeSwitchedFrom,
  programmeToSwitchTo,
  switchActiveProgramme,
  resolveLeadPlanId,
  resumeProgramme,
  stopProgramme,
} = require('../../.test-dist/lib/runningProgrammes.js');

const plan = (id, templateId, name = id) => ({
  id,
  name,
  entries: [{ workoutTemplateId: templateId }],
});

module.exports = [
  {
    /**
     * The bug this file exists for: an adopted ready programme has no row in
     * `workoutTemplates`, so the Programs tab listed it only while Home led
     * with it. Making a second programme lead dropped it out of the one list
     * called "your programmes" while it kept running — and kept holding a slot
     * against the programme cap (user 2026-09-07).
     */
    name: 'running programmes: every running one is listed, leader first',
    run() {
      const plans = [plan('ready_plan_strong', 'tpl_strong'), plan('ready_plan_glutes', 'tpl_glutes')];

      const rows = listRunningProgrammes({
        activePlanId: 'ready_plan_glutes',
        activePlanIds: ['ready_plan_strong', 'ready_plan_glutes'],
        plans,
      });

      assert.deepEqual(
        rows.map((row) => row.templateId),
        ['tpl_glutes', 'tpl_strong'],
        'the leader is not first, or a running programme is missing',
      );
      assert.equal(rows[0].leading, true);
      assert.equal(rows[1].leading, false);
      assert.equal(rows[1].planId, 'ready_plan_strong');
    },
  },
  {
    name: 'running programmes: one programme held under two plan ids is listed once',
    run() {
      // Onboarding writes `onboarding_plan_<id>` and adoption writes
      // `ready_plan_<id>`. Both point at one programme, and the list keys its
      // rows by template, so a row per plan would collide.
      const plans = [
        plan('onboarding_plan_strong', 'tpl_strong'),
        plan('ready_plan_strong', 'tpl_strong'),
      ];

      const rows = listRunningProgrammes({
        activePlanId: 'ready_plan_strong',
        activePlanIds: ['onboarding_plan_strong', 'ready_plan_strong'],
        plans,
      });

      assert.equal(rows.length, 1);
      // And it carries the LEADING plan, not whichever came first in the list.
      assert.equal(rows[0].planId, 'ready_plan_strong');
      assert.equal(rows[0].leading, true);
    },
  },
  {
    name: 'running programmes: an authored template is never listed twice',
    run() {
      const plans = [plan('custom_plan_mine', 'tpl_mine'), plan('ready_plan_strong', 'tpl_strong')];

      const rows = listRunningProgrammes({
        activePlanId: 'custom_plan_mine',
        activePlanIds: ['custom_plan_mine', 'ready_plan_strong'],
        plans,
        authoredTemplateIds: ['tpl_mine'],
      });

      assert.deepEqual(
        rows.map((row) => row.templateId),
        ['tpl_strong'],
        'the reader own template was listed as a running programme too',
      );
    },
  },
  {
    name: 'running programmes: a missing plan, a plan with no entries, and no leader at all',
    run() {
      const plans = [plan('ready_plan_strong', 'tpl_strong'), { id: 'empty', name: 'empty', entries: [] }];

      // A plan id with nothing behind it is skipped rather than throwing.
      const rows = listRunningProgrammes({
        activePlanId: null,
        activePlanIds: ['gone', 'empty', 'ready_plan_strong'],
        plans,
      });
      assert.deepEqual(rows.map((row) => row.templateId), ['tpl_strong']);
      assert.equal(rows[0].leading, false, 'nothing leads, so nothing may claim to');

      assert.deepEqual(listRunningProgrammes({ activePlanId: null, activePlanIds: [], plans }), []);
    },
  },
  {
    /**
     * Stopping a programme has to take every plan pointing at it. Removing
     * only the leading one left it running under the other id, and the switch
     * that reported it stopped would have been lying.
     */
    name: 'plans for a programme: all of them, leader included, and none of anything else',
    run() {
      const plans = [
        plan('onboarding_plan_strong', 'tpl_strong'),
        plan('ready_plan_strong', 'tpl_strong'),
        plan('ready_plan_glutes', 'tpl_glutes'),
      ];

      const ids = planIdsForTemplate({
        activePlanId: 'ready_plan_strong',
        activePlanIds: ['onboarding_plan_strong', 'ready_plan_glutes'],
        plans,
        templateId: 'tpl_strong',
      });

      assert.deepEqual([...ids].sort(), ['onboarding_plan_strong', 'ready_plan_strong']);

      assert.deepEqual(
        planIdsForTemplate({
          activePlanId: null,
          activePlanIds: ['ready_plan_glutes'],
          plans,
          templateId: 'tpl_strong',
        }),
        [],
        'a programme that is not running has no plans to stop',
      );
    },
  },
  {
    name: 'running programmes: stopping one takes every plan it is held under and passes the lead on',
    run() {
      const plans = [
        plan('onboarding_plan_tpl_mine', 'tpl_mine'),
        plan('custom_plan_tpl_mine', 'tpl_mine'),
        plan('ready_plan_run', 'tpl_run'),
      ];

      assert.deepEqual(
        stopProgramme({
          activePlanId: 'onboarding_plan_tpl_mine',
          activePlanIds: ['onboarding_plan_tpl_mine', 'ready_plan_run', 'custom_plan_tpl_mine'],
          plans,
          templateId: 'tpl_mine',
        }),
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'] },
      );

      // Not the lead: the lead stays where it is.
      assert.deepEqual(
        stopProgramme({
          activePlanId: 'ready_plan_run',
          activePlanIds: ['ready_plan_run', 'custom_plan_tpl_mine'],
          plans,
          templateId: 'tpl_mine',
        }),
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'] },
      );

      // The last one: nobody leads.
      assert.deepEqual(
        stopProgramme({ activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'], plans, templateId: 'tpl_run' }),
        { activePlanId: null, activePlanIds: [] },
      );

      assert.equal(
        stopProgramme({ activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'], plans, templateId: 'tpl_other' }),
        null,
        'a programme that was not running reports a change',
      );
    },
  },
  {
    name: 'held programmes: switching one off keeps it, it does not delete it',
    run() {
      // The Active switch took a ready programme out of the running set, and
      // with no template of its own nothing listed it any more — to the
      // reader, the switch had deleted it (device, 2026-09-16).
      const plans = [plan('ready_plan_a', 'tpl_a'), plan('ready_plan_b', 'tpl_b'), plan('custom_plan_c', 'own_c')];
      const held = listHeldProgrammes({
        activePlanId: 'ready_plan_b',
        activePlanIds: ['ready_plan_b'],
        plans,
        authoredTemplateIds: ['own_c'],
      });
      assert.deepEqual(
        held.map((row) => [row.templateId, row.running, row.leading]),
        [
          ['tpl_b', true, true],
          ['tpl_a', false, false],
        ],
      );
      // An authored programme is listed by its own source, not twice.
      assert.ok(!held.some((row) => row.templateId === 'own_c'));
      // Held once, even when two plans point at it.
      const twice = listHeldProgrammes({
        activePlanId: null,
        activePlanIds: [],
        plans: [plan('onboarding_plan_a', 'tpl_a'), plan('ready_plan_a', 'tpl_a')],
      });
      assert.equal(twice.length, 1);
    },
  },
  {
    name: 'held programmes: switched back on under the plan it already has',
    run() {
      const plans = [plan('ready_plan_a', 'tpl_a'), plan('ready_plan_b', 'tpl_b')];
      // Something else leads: rejoin the running set, and take the lead — the
      // switch is Active, and so is the tag (device, 2026-09-16). The other
      // keeps running.
      assert.deepEqual(
        resumeProgramme({ activePlanId: 'ready_plan_b', activePlanIds: ['ready_plan_b'], plans, templateId: 'tpl_a' }),
        { planId: 'ready_plan_a', activePlanIds: ['ready_plan_b', 'ready_plan_a'], activePlanId: 'ready_plan_a' },
      );
      // Nothing leads: this one does.
      assert.deepEqual(
        resumeProgramme({ activePlanId: null, activePlanIds: [], plans, templateId: 'tpl_a' }),
        { planId: 'ready_plan_a', activePlanIds: ['ready_plan_a'], activePlanId: 'ready_plan_a' },
      );
      // Already running: nothing doubles.
      assert.deepEqual(
        resumeProgramme({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'], plans, templateId: 'tpl_a' })?.activePlanIds,
        ['ready_plan_a'],
      );
      // Not held: nothing to switch on.
      assert.equal(resumeProgramme({ activePlanId: null, activePlanIds: [], plans, templateId: 'tpl_z' }), null);
    },
  },
  {
    // Off and on again, several times: the Active tag left the programme and
    // never came back (device, 2026-09-16).
    name: 'held programmes: off and on again, the programme is Home’s again every time',
    run() {
      const plans = [plan('ready_plan_a', 'tpl_a'), plan('ready_plan_b', 'tpl_b'), plan('ready_plan_c', 'tpl_c')];
      let state = { activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a', 'ready_plan_b', 'ready_plan_c'] };
      for (let round = 0; round < 3; round += 1) {
        const off = stopProgramme({ ...state, plans, templateId: 'tpl_a' });
        state = { activePlanId: off.activePlanId, activePlanIds: off.activePlanIds };
        assert.notEqual(state.activePlanId, 'ready_plan_a');
        assert.equal(leadTemplateId({ activePlanId: state.activePlanId, plans }), 'tpl_b', 'the lead passes to one still running');
        const on = resumeProgramme({ ...state, plans, templateId: 'tpl_a' });
        state = { activePlanId: on.activePlanId, activePlanIds: on.activePlanIds };
        assert.equal(leadTemplateId({ activePlanId: state.activePlanId, plans }), 'tpl_a');
        assert.deepEqual([...state.activePlanIds].sort(), ['ready_plan_a', 'ready_plan_b', 'ready_plan_c']);
      }
    },
  },
  {
    name: 'held programmes: switched on under the plan it already runs under',
    run() {
      // Held twice; the one it runs under is kept, not a second id added.
      const plans = [plan('onboarding_plan_a', 'tpl_a'), plan('ready_plan_a', 'tpl_a')];
      const resumed = resumeProgramme({ activePlanId: null, activePlanIds: ['ready_plan_a'], plans, templateId: 'tpl_a' });
      assert.equal(resumed.planId, 'ready_plan_a');
      assert.deepEqual(resumed.activePlanIds, ['ready_plan_a']);
      assert.equal(resumed.activePlanId, 'ready_plan_a');
      // Whichever place in the list that plan has.
      const first = resumeProgramme({
        activePlanId: null,
        activePlanIds: ['onboarding_plan_a'],
        plans: [...plans, plan('season_plan_a', 'tpl_a')],
        templateId: 'tpl_a',
      });
      assert.equal(first.planId, 'onboarding_plan_a');
      assert.deepEqual(first.activePlanIds, ['onboarding_plan_a']);
      // Not running at all: the first plan that holds it.
      assert.equal(resumeProgramme({ activePlanId: null, activePlanIds: [], plans, templateId: 'tpl_a' }).planId, 'onboarding_plan_a');
    },
  },
  {
    name: 'lead: the app repairs a stale lead, and the Active tag reads the lead plan',
    run() {
      const { readAppWiring } = require('../helpers/appWiringSource.cjs');
      const wiring = readAppWiring()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.match(
        wiring,
        /const lead = resolveLeadPlanId\(\{\s*activePlanId: preferences\.activePlanId,\s*activePlanIds: preferences\.activePlanIds,\s*plans: database\.workoutPlans,\s*\}\);\s*if \(lead !== preferences\.activePlanId\) \{\s*tryOnce\(`lead:\$\{lead\}`, \(\) => updatePreferences\(\{ activePlanId: lead \}\)\);/,
      );
      // The old repair, which looked only for an empty lead.
      assert.doesNotMatch(wiring, /if \(!appHydrated \|\| preferences\.activePlanId\) \{/);
      // Both kinds of row ask the lead plan, not Home's hero card.
      assert.match(wiring, /const leadingTemplateId = leadTemplateId\(\{ activePlanId: preferences\.activePlanId, plans: database\.workoutPlans \}\);/);
      assert.match(wiring, /active: leadingTemplateId === template\.id,/);
      assert.match(wiring, /const active = leadingTemplateId === row\.templateId;/);
      assert.doesNotMatch(wiring, /active: homeActivePlanCard\?\.programId === template\.id/);
    },
  },
  {
    name: 'lead: a lead naming a plan that is gone is repaired, not kept',
    run() {
      const plans = [plan('ready_plan_a', 'tpl_a'), plan('ready_plan_b', 'tpl_b'), { id: 'empty_plan', name: 'x', entries: [] }];
      // A lead that exists is kept, running or not.
      assert.equal(resolveLeadPlanId({ activePlanId: 'ready_plan_b', activePlanIds: ['ready_plan_a'], plans }), 'ready_plan_b');
      // Gone, or empty: the first running plan that exists.
      assert.equal(resolveLeadPlanId({ activePlanId: 'deleted_plan', activePlanIds: ['gone', 'ready_plan_a'], plans }), 'ready_plan_a');
      assert.equal(resolveLeadPlanId({ activePlanId: 'empty_plan', activePlanIds: ['ready_plan_b'], plans }), 'ready_plan_b');
      assert.equal(resolveLeadPlanId({ activePlanId: null, activePlanIds: ['ready_plan_a'], plans }), 'ready_plan_a');
      // Nothing running: nothing leads.
      assert.equal(resolveLeadPlanId({ activePlanId: 'deleted_plan', activePlanIds: [], plans }), null);
      assert.equal(resolveLeadPlanId({ activePlanId: null, activePlanIds: ['gone'], plans }), null);

      assert.equal(leadTemplateId({ activePlanId: 'ready_plan_b', plans }), 'tpl_b');
      assert.equal(leadTemplateId({ activePlanId: 'deleted_plan', plans }), null);
      assert.equal(leadTemplateId({ activePlanId: null, plans }), null);
    },
  },
  {
    name: 'held programmes: deleting one finds every plan that holds it',
    run() {
      const plans = [plan('onboarding_plan_a', 'tpl_a'), plan('ready_plan_a', 'tpl_a'), plan('ready_plan_b', 'tpl_b')];
      assert.deepEqual(planIdsHoldingTemplate(plans, 'tpl_a'), ['onboarding_plan_a', 'ready_plan_a']);
      assert.deepEqual(planIdsHoldingTemplate(plans, 'tpl_z'), []);
    },
  },
  {
    /**
     * One programme is active and the reader may hold several (user
     * 2026-09-21). Making another one active is a switch the page asks about,
     * naming the programme it moves off — and only when there is one.
     */
    name: 'active switch: asks only when another programme is the active one, and names it',
    run() {
      const rows = [
        { id: 'tpl_strong_elite_v1', name: 'STRONG Elite', active: true },
        { id: 'tpl_glutes', name: 'Advanced Glutes', active: false },
        { id: 'custom_mine', name: 'My week' },
      ];
      assert.equal(programmeSwitchedFrom(rows, 'tpl_glutes')?.name, 'STRONG Elite');
      assert.equal(programmeSwitchedFrom(rows, 'custom_mine')?.name, 'STRONG Elite');
      // Already the active one: nothing to move off.
      assert.equal(programmeSwitchedFrom(rows, 'tpl_strong_elite_v1'), null);
      // Nothing active: nothing to ask.
      assert.equal(
        programmeSwitchedFrom(rows.map((row) => ({ ...row, active: false })), 'tpl_glutes'),
        null,
      );
    },
  },
  {
    /**
     * Switching the active programme off hands the lead on, so the page says
     * which programme takes over before the switch is pressed. It has to be
     * the one the app actually lands on: stopProgramme, then the lead repair.
     */
    name: 'active switch: switching the active one off names the programme that takes over',
    run() {
      const plans = [
        plan('ready_plan_a', 'tpl_a'),
        plan('onboarding_plan_a', 'tpl_a'),
        { id: 'empty_plan', name: 'x', entries: [] },
        plan('ready_plan_b', 'tpl_b'),
      ];
      const running = {
        activePlanId: 'ready_plan_a',
        activePlanIds: ['onboarding_plan_a', 'empty_plan', 'ready_plan_a', 'ready_plan_b'],
        plans,
      };
      // Past A's second plan and the empty one, to the programme that can run.
      assert.equal(leadAfterStopping({ ...running, templateId: 'tpl_a' }), 'tpl_b');
      // The same answer the two real steps reach.
      const stopped = stopProgramme({ ...running, templateId: 'tpl_a' });
      assert.equal(
        leadTemplateId({ activePlanId: resolveLeadPlanId({ ...stopped, plans }), plans }),
        'tpl_b',
      );
      // B is not the active one: switching it off moves nothing.
      assert.equal(leadAfterStopping({ ...running, templateId: 'tpl_b' }), null);
      // The only programme running: nothing takes over.
      assert.equal(
        leadAfterStopping({
          activePlanId: 'ready_plan_a',
          activePlanIds: ['ready_plan_a', 'onboarding_plan_a'],
          plans,
          templateId: 'tpl_a',
        }),
        null,
      );
    },
  },
  {
    /**
     * Switching the active programme off asks first (user 2026-09-22):
     * "do you want X to be your active programme?" — X the next running
     * programme, else one the reader switched off; none, and the page offers
     * the catalogue instead.
     */
    name: 'switch off: the programme offered in the active one\'s place',
    run() {
      const plans = [
        plan('ready_plan_a', 'tpl_a'),
        plan('ready_plan_b', 'tpl_b'),
        plan('ready_plan_c', 'tpl_c'),
      ];
      // Another one running: it is the one offered.
      assert.deepEqual(
        programmeToSwitchTo({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a', 'ready_plan_c'], plans, templateId: 'tpl_a' }),
        { templateId: 'tpl_c', planId: 'ready_plan_c' },
      );
      // Nothing else running, one held and switched off: that one.
      assert.deepEqual(
        programmeToSwitchTo({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'], plans, templateId: 'tpl_a' }),
        { templateId: 'tpl_b', planId: 'ready_plan_b' },
      );
      // Only what the list can open is offered by name.
      assert.deepEqual(
        programmeToSwitchTo({
          activePlanId: 'ready_plan_a',
          activePlanIds: ['ready_plan_a'],
          plans,
          templateId: 'tpl_a',
          shown: ['tpl_a', 'tpl_c'],
        }),
        { templateId: 'tpl_c', planId: 'ready_plan_c' },
      );
      // Nothing else held: nothing to offer — the page offers the catalogue.
      assert.equal(
        programmeToSwitchTo({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'], plans: [plans[0]], templateId: 'tpl_a' }),
        null,
      );
      // Unless the reader has one of their own they never started: it is
      // another programme, offered last, with no plan yet (CI review of #179).
      assert.deepEqual(
        programmeToSwitchTo({
          activePlanId: 'ready_plan_a',
          activePlanIds: ['ready_plan_a'],
          plans: [plans[0]],
          templateId: 'tpl_a',
          unstarted: ['own_unstarted'],
        }),
        { templateId: 'own_unstarted', planId: null },
      );
      // Held ones still come first.
      assert.equal(
        programmeToSwitchTo({
          activePlanId: 'ready_plan_a',
          activePlanIds: ['ready_plan_a'],
          plans,
          templateId: 'tpl_a',
          unstarted: ['own_unstarted'],
        }).planId,
        'ready_plan_b',
      );
      // Not the active one: switching it off hands nothing on.
      assert.equal(
        programmeToSwitchTo({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a', 'ready_plan_b'], plans, templateId: 'tpl_b' }),
        null,
      );
    },
  },
  {
    name: 'switch off: one write stops every plan of the old one and leads with the new',
    run() {
      const plans = [
        plan('onboarding_plan_a', 'tpl_a'),
        plan('ready_plan_a', 'tpl_a'),
        plan('ready_plan_b', 'tpl_b'),
        plan('ready_plan_c', 'tpl_c'),
      ];
      // To one that was switched off: it joins, the old one goes, count holds.
      const toHeld = switchActiveProgramme({
        activePlanId: 'ready_plan_a',
        activePlanIds: ['onboarding_plan_a', 'ready_plan_a', 'ready_plan_c'],
        plans,
        fromTemplateId: 'tpl_a',
        toPlanId: 'ready_plan_b',
      });
      assert.deepEqual(toHeld, { activePlanId: 'ready_plan_b', activePlanIds: ['ready_plan_c', 'ready_plan_b'] });
      // To one already running: it leads, nothing is added twice.
      const toRunning = switchActiveProgramme({
        activePlanId: 'ready_plan_a',
        activePlanIds: ['ready_plan_a', 'ready_plan_c'],
        plans,
        fromTemplateId: 'tpl_a',
        toPlanId: 'ready_plan_c',
      });
      assert.deepEqual(toRunning, { activePlanId: 'ready_plan_c', activePlanIds: ['ready_plan_c'] });
      // stopProgramme alone would have led with the FIRST remaining plan,
      // which is not the one the reader said yes to.
      assert.equal(
        stopProgramme({ activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a', 'ready_plan_c', 'ready_plan_b'], plans, templateId: 'tpl_a' }).activePlanId,
        'ready_plan_c',
      );
      assert.equal(
        switchActiveProgramme({
          activePlanId: 'ready_plan_a',
          activePlanIds: ['ready_plan_a', 'ready_plan_c', 'ready_plan_b'],
          plans,
          fromTemplateId: 'tpl_a',
          toPlanId: 'ready_plan_b',
        }).activePlanId,
        'ready_plan_b',
      );
    },
  },
];
