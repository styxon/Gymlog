const assert = require('node:assert/strict');

const {
  forgetRoutesForTemplate,
  isSameRoute,
  popRoute,
  pushRoute,
  withoutTrailingRoute,
} = require('../../src/navigation/routeHistory');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

module.exports = [
  {
    name: 'route history pushes the current route only when navigating to a different destination',
    run() {
      const home = { tab: 'home', screen: 'dashboard' };
      const program = { tab: 'workout', screen: 'program', programType: 'ready', workoutTemplateId: 'tpl_1' };

      assert.deepEqual(pushRoute([], home, program), [home]);
      assert.deepEqual(pushRoute([home], program, program), [home]);
    },
  },
  {
    name: 'route history can pop back to the previous route',
    run() {
      const home = { tab: 'home', screen: 'dashboard' };
      const workout = { tab: 'workout', screen: 'list' };

      assert.equal(isSameRoute(home, { tab: 'home', screen: 'dashboard' }), true);
      assert.equal(isSameRoute(home, workout), false);
      assert.deepEqual(popRoute([home, workout]), {
        history: [home],
        route: workout,
      });
      assert.deepEqual(popRoute([]), {
        history: [],
        route: null,
      });
    },
  },
  {
    name: 'a deleted programme takes its own pages out of the back stack',
    run() {
      const history = [
        { tab: 'home' },
        { tab: 'workout', screen: 'programs_home' },
        { tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId: 'tpl_gone' },
        { tab: 'workout', screen: 'programDay', programType: 'custom', workoutTemplateId: 'tpl_gone', sessionId: 'd1' },
        { tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId: 'tpl_kept' },
      ];

      assert.deepEqual(forgetRoutesForTemplate(history, 'tpl_gone'), [
        { tab: 'home' },
        { tab: 'workout', screen: 'programs_home' },
        { tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId: 'tpl_kept' },
      ]);
      // Nothing else is touched, and an id nothing names leaves the stack whole.
      assert.deepEqual(forgetRoutesForTemplate(history, 'tpl_never'), history);
      assert.deepEqual(forgetRoutesForTemplate([], 'tpl_gone'), []);
    },
  },
  {
    name: 'deleting a programme replaces the page rather than pushing over it',
    run() {
      const wiring = readAppWiring();
      // The delete and the leave it calls, each to its own closing brace: the
      // slice used to run on to the onboarding pick that stood below them, and
      // phase C (2026-10-01) moves that pick out of App.tsx.
      const body = [
        functionBody(wiring, 'async function handleDeleteCustomWorkout('),
        functionBody(wiring, 'function leaveDeletedProgramme('),
      ].join('\n');
      assert.match(
        body,
        /history: withoutTrailingRoute\(\s*forgetRoutesForTemplate\(current\.history, workoutTemplateId\),\s*workoutHomeRoute,\s*\)/,
      );
      assert.doesNotMatch(body, /navigate\(workoutHomeRoute\);/);
    },
  },
  {
    name: 'landing on a route does not leave a copy of it on top of the stack',
    run() {
      const list = { tab: 'workout', screen: 'programs_home' };
      const home = { tab: 'home' };

      // The programme was opened FROM the list, so the list is both the new
      // route and the top of the stack: the first Back press would pop the
      // duplicate and land on the screen already on screen (PR #126 review).
      assert.deepEqual(withoutTrailingRoute([home, list], list), [home]);
      // Anything else on top is a real page back.
      assert.deepEqual(withoutTrailingRoute([home, list], home), [home, list]);
      assert.deepEqual(withoutTrailingRoute([], list), []);
      // Only the top one: a copy further down is somewhere the reader really
      // was, and dropping it would shorten a path they can still walk.
      assert.deepEqual(withoutTrailingRoute([list, home], list), [list, home]);
    },
  },
];
