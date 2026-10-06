const assert = require('node:assert/strict');

const { getWorkoutTemplateById, WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { buildSessionGuidance: buildGuidanceWithMinutes } = require('../../.test-dist/lib/sessionGuidance.js');
const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');

// The duration is handed in (the programme page's own number), so these tests
// hand it the card's, as the page does with no plan and no gear.
const buildSessionGuidance = (template, session) =>
  buildGuidanceWithMinutes(template, session, readyTemplateCardMinutes(template));

// The by-id map was exported from src and read only here.
const buildSessionGuidanceById = (template) =>
  Object.fromEntries(template.sessions.map((session) => [session.id, buildSessionGuidance(template, session)]));

module.exports = [
  {
    name: 'session guidance gives strength days a warmup, main focus, rest, duration, and first action',
    run() {
      const template = getWorkoutTemplateById('tpl_4_day_powerbuilding_v1');
      const session = template.sessions.find((item) => item.id === 'power_upper_strength');
      const guidance = buildSessionGuidance(template, session);

      assert.match(guidance.warmup, /warm-up sets/i);
      assert.match(guidance.mainFocus, /Bench Press.*Barbell Row/i);
      assert.match(guidance.supportFocus, /Triceps Pushdown/i);
      assert.match(guidance.restGuidance, /150-210 sec.*45-150 sec/i);
      assert.equal(guidance.estimatedDuration, `${readyTemplateCardMinutes(template)} min`);
      assert.equal(buildGuidanceWithMinutes(template, session, 35).estimatedDuration, '35 min');
      assert.match(guidance.progressionHint, /lower-rep|load/i);
      assert.match(guidance.firstAction, /Bench Press.*first work set/i);
    },
  },
  {
    name: 'session guidance gives home bodyweight days bodyweight progression instead of load progression',
    run() {
      const template = getWorkoutTemplateById('tpl_2_day_minimal_full_body_v1');
      const session = template.sessions.find((item) => item.id === 'minimal_full_body_a');
      const guidance = buildSessionGuidance(template, session);

      assert.match(guidance.warmup, /easy round/i);
      assert.match(guidance.mainFocus, /Bodyweight Squat.*Incline Push-Up.*Inverted Row/i);
      assert.match(guidance.progressionHint, /reps|harder variations/i);
      assert.doesNotMatch(guidance.progressionHint, /add load/i);
      assert.match(guidance.firstAction, /Bodyweight Squat.*clean reps/i);
    },
  },
  {
    name: 'session guidance gives endurance days explicit run first actions',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_run_mobility_v1');
      const guidanceById = buildSessionGuidanceById(template);

      assert.match(guidanceById.run_mobility_easy.warmup, /easy movement/i);
      assert.match(guidanceById.run_mobility_easy.mainFocus, /Easy Run Blocks/i);
      assert.match(guidanceById.run_mobility_easy.progressionHint, /run work|blocks/i);
      assert.match(guidanceById.run_mobility_easy.firstAction, /Easy Run Blocks.*easy pace/i);
      // Names a real library exercise now, not the "Recovery Stretch Flow"
      // block placeholder that used to stand in for one.
      assert.match(guidanceById.run_mobility_reset.firstAction, /Seated Floor Hamstring Stretch/i);
    },
  },
  {
    name: 'session guidance exists for every ready workout session',
    run() {
      WORKOUT_TEMPLATES_V1.forEach((template) => {
        const guidanceById = buildSessionGuidanceById(template);

        template.sessions.forEach((session) => {
          const guidance = guidanceById[session.id];
          assert.ok(guidance, `${template.id} ${session.id}`);
          assert.ok(guidance.warmup.length > 20, `${template.id} ${session.id} warmup`);
          assert.ok(guidance.mainFocus.includes('Main focus:'), `${template.id} ${session.id} main focus`);
          assert.ok(guidance.restGuidance.includes('sec'), `${template.id} ${session.id} rest`);
          assert.ok(guidance.estimatedDuration.endsWith('min'), `${template.id} ${session.id} duration`);
          assert.ok(guidance.progressionHint.length > 20, `${template.id} ${session.id} progression`);
          assert.ok(guidance.firstAction.length > 20, `${template.id} ${session.id} first action`);
        });
      });
    },
  },
];
