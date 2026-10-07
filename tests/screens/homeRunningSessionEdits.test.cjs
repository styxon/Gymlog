const assert = require('node:assert/strict');

const activeWorkout = require('../../.test-dist/lib/activeWorkout.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * Home's rows do not edit the session that is already running (bug hunt
 * 2026-10-07, finding 9).
 *
 * With today's session in progress or paused, Home still offered its rows'
 * swap and drop. The change was held for the card's session and drawn in
 * violet as if in force, but the hero's Resume opens the running workout and
 * returns before any held change is applied (programmeStarts) — the workout
 * kept the old lift. The edit belongs in the player, so Home's rows go
 * read-only while their session runs.
 */
module.exports = [
  {
    name: 'running session: only an unfinished workout of this very programme session counts',
    run() {
      const { isWorkoutInProgressFor } = activeWorkout;
      assert.equal(typeof isWorkoutInProgressFor, 'function', 'lib/activeWorkout has no isWorkoutInProgressFor');
      const held = (status, templateSessionId = 'day-1') => ({ status, templateId: 'prog', templateSessionId });
      assert.equal(isWorkoutInProgressFor(held('active'), 'prog', 'day-1'), true);
      assert.equal(isWorkoutInProgressFor(held('paused'), 'prog', 'day-1'), true, 'paused is still the running session');
      assert.equal(isWorkoutInProgressFor(held('completed'), 'prog', 'day-1'), false, 'a finished one waits only for its summary');
      assert.equal(isWorkoutInProgressFor(held('active', 'day-2'), 'prog', 'day-1'), false, 'another day of the same programme');
      assert.equal(isWorkoutInProgressFor(held('active'), 'other', 'day-1'), false, 'another programme');
      assert.equal(isWorkoutInProgressFor(held('active', null), 'prog', 'day-1'), false, 'a free workout');
      assert.equal(isWorkoutInProgressFor(null, 'prog', 'day-1'), false);
      assert.equal(isWorkoutInProgressFor(held('active'), null, undefined), false, 'no card, no session');
    },
  },
  {
    name: 'running session: Home passes no swap, drop or restore for the session that is running',
    run() {
      const wiring = readAppWiring();
      const start = wiring.indexOf('    <HomeScreen\n');
      assert.ok(start !== -1, 'the dashboard renders HomeScreen');
      const end = wiring.indexOf('\n    />', start);
      const props = wiring.slice(start, end);

      // The flag is about the card's own session, through the shared rule.
      const head = wiring.slice(wiring.lastIndexOf('export function renderHomeDashboard', start), start);
      assert.match(
        head,
        /const todayIsRunning = isWorkoutInProgressFor\(\s*workout\.activeSession,\s*homeActivePlanCard\?\.programId,\s*homeActivePlanCard\?\.nextSession\?\.id,?\s*\);/,
        'todayIsRunning does not ask about the card\'s own session',
      );
      for (const prop of ['onSwapSessionExercise', 'onDropSessionExercise', 'onRestoreSessionExercise']) {
        const at = props.indexOf(`\n      ${prop}=`);
        assert.ok(at !== -1, `${prop} is not passed to HomeScreen`);
        const value = props.slice(at + prop.length + 8, at + prop.length + 8 + 60);
        assert.match(value, /^\{\s*todayIsRunning \? undefined :/, `${prop} is offered while the session runs: ${value}`);
      }
    },
  },
];
