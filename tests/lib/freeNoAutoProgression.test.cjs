process.env.TZ = process.env.TZ || 'Europe/Helsinki';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Automatic progression is Pro, with no exception (owner, 2026-10-19: "Ei saa
 * missään nimessä").
 *
 * The line this suite holds:
 *  - ALLOWED for Free: a plain log. The next session opens on exactly what the
 *    reader logged last time (their own weight, the programme's reps), and a
 *    set opens on the set before it. Repeating a number is not progression.
 *  - PRO ONLY: any number the app COMPUTES from history: a raised load, +1 rep
 *    on bodyweight work, a lowered or ramped rep target, a recovery hold, and
 *    the badges and sentences that announce them ("next time ... kg").
 *
 * Each path below is run for a Free and a Pro reader through the one resolver
 * (resolveProgressionOptions), on the same history. Free must match the plain
 * log; Pro must still move, so the gate cannot pass by being dead.
 */
const L = '../../.test-dist/lib/';
const { workoutReducer, previewNextSession } = require('../../.test-dist/features/workout/workoutState');
const { resolveGuidedSetTarget } = require(L + 'guidedPlayer.js');
const { resolveProgressionOptions } = require(L + 'proEntitlement.js');
const { buildSessionAnalysis } = require(L + 'sessionAnalysis.js');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

const NOW = new Date(Date.UTC(2026, 9, 19, 9));
const FREE_PREFS = { setupLevel: 'intermediate', automatedProgressionEnabled: true };
const PRO_PREFS = { ...FREE_PREFS, proTrialUntil: '2099-01-01T00:00:00Z' };

const optionsFor = (prefs) => ({ ...resolveProgressionOptions(prefs, NOW), nowMs: NOW.getTime() });

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};

function templateOf(exercise) {
  return {
    id: 'tpl_free_gate',
    name: 'Free gate',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'day',
        name: 'Day',
        orderIndex: 0,
        exercises: [
          {
            id: 'e1',
            slotId: 'lift',
            role: 'primary',
            progressionPriority: 'high',
            restSecondsMin: 90,
            restSecondsMax: 120,
            substitutionGroup: 'g',
            ...exercise,
          },
        ],
      },
    ],
  };
}

/** Plays one session of the template (history is the same whoever starts it). */
function play(state, template, repsPerSet, loadKg, daysAgo) {
  const at = new Date(NOW.getTime() - daysAgo * 86400000);
  let next = workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template,
      sessionOrderIndex: 0,
      unitPreference: 'kg',
      progression: { automatedProgressionEnabled: false, setupLevel: 'intermediate', nowMs: at.getTime() },
    },
  });
  const opened = next.activeSession.exercises[0];
  repsPerSet.forEach((count, index) => {
    next = workoutReducer(next, {
      type: 'set/updateDraft',
      payload: { slotId: opened.slotId, setIndex: index, patch: { loadText: String(loadKg), repsText: String(count) } },
    });
    next = workoutReducer(next, {
      type: 'set/complete',
      payload: { slotId: opened.slotId, setIndex: index, nowMs: at.getTime(), unitPreference: 'kg' },
    });
  });
  next = workoutReducer(next, { type: 'session/finishWorkout', payload: { performedAt: at.toISOString() } });
  return workoutReducer(next, { type: 'session/clearCompletedSession' });
}

function historyOf(template, sessions) {
  return sessions.reduce((state, [reps, kg, daysAgo]) => play(state, template, reps, kg, daysAgo), EMPTY);
}

/** What a start opens on, per set, for the given reader. */
function opening(state, template, prefs) {
  const session = workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template, sessionOrderIndex: 0, unitPreference: 'kg', progression: optionsFor(prefs) },
  }).activeSession;
  const lift = session.exercises[0];
  return {
    progressionOn: session.progressionOn,
    sets: lift.sets.map((set, index) => ({
      draftLoadText: set.draftLoadText,
      plannedLoadKg: set.plannedLoadKg,
      autoProgressedFromKg: set.autoProgressedFromKg,
      autoProgressedFromReps: set.autoProgressedFromReps,
      plannedTargetReps: set.plannedTargetReps,
      rampTargetReps: set.rampTargetReps,
      heldForFatigue: set.heldForFatigue,
      shown: resolveGuidedSetTarget(lift.sets, index, lift.trackingMode),
    })),
  };
}

const BENCH = templateOf({
  exerciseName: 'Bench Press',
  trackingMode: 'load_and_reps',
  sets: 3,
  repsMin: 8,
  repsMax: 8,
});
const PUSHUP = templateOf({
  exerciseName: 'Push-up',
  trackingMode: 'bodyweight',
  sets: 3,
  repsMin: 10,
  repsMax: 10,
});
const BENCH_12 = templateOf({
  exerciseName: 'Bench Press',
  trackingMode: 'load_and_reps',
  sets: 4,
  repsMin: 12,
  repsMax: 12,
});

// Three weekly sessions at the ceiling on every set: the gate has earned a raise.
const CEILING = [
  [[8, 8, 8], 100, 21],
  [[8, 8, 8], 100, 14],
  [[8, 8, 8], 100, 7],
];

module.exports = [
  {
    name: 'free start: the load repeats the last logged weight, no raise and no AUTO badge; Pro still raises on the same history',
    run() {
      const state = historyOf(BENCH, CEILING);
      const free = opening(state, BENCH, FREE_PREFS);
      assert.equal(free.progressionOn, false);
      for (const set of free.sets) {
        assert.equal(set.plannedLoadKg, 100, 'plain prefill of the logged weight');
        assert.equal(set.autoProgressedFromKg, undefined);
        assert.equal(set.shown.loadKg, 100);
        assert.equal(set.shown.autoProgressedFromKg, null);
      }
      const pro = opening(state, BENCH, PRO_PREFS);
      assert.equal(pro.progressionOn, true);
      assert.ok(pro.sets.every((set) => set.plannedLoadKg > 100 && set.autoProgressedFromKg === 100), JSON.stringify(pro.sets));
    },
  },
  {
    name: 'free start: a Free reader whose switch is on is still Free (the raw preference is not the gate)',
    run() {
      assert.equal(resolveProgressionOptions(FREE_PREFS, NOW).automatedProgressionEnabled, false);
      assert.equal(resolveProgressionOptions(PRO_PREFS, NOW).automatedProgressionEnabled, true);
    },
  },
  {
    name: 'free start: bodyweight reps do not climb, the target stays the programme\'s; Pro adds a rep',
    run() {
      const state = historyOf(PUSHUP, CEILING.map(([, , days]) => [[10, 10, 10], 0, days]));
      const free = opening(state, PUSHUP, FREE_PREFS);
      for (const set of free.sets) {
        assert.equal(set.plannedTargetReps, undefined);
        assert.equal(set.autoProgressedFromReps, undefined);
        assert.equal(set.shown.reps, 10);
        assert.equal(set.shown.autoProgressedFromReps, null);
      }
      const pro = opening(state, PUSHUP, PRO_PREFS);
      assert.ok(pro.sets.every((set) => set.plannedTargetReps === 11 && set.autoProgressedFromReps === 10), JSON.stringify(pro.sets));
    },
  },
  {
    name: 'free start: reps short of the programme do not lower the target; Pro gets the lowered one',
    run() {
      const state = historyOf(BENCH_12, [[[7, 6, 4, 4], 60, 7]]);
      const free = opening(state, BENCH_12, FREE_PREFS);
      for (const set of free.sets) {
        assert.equal(set.plannedTargetReps, undefined);
        assert.equal(set.shown.reps, 12);
        assert.equal(set.plannedLoadKg, 60, 'the weight still repeats');
      }
      const pro = opening(state, BENCH_12, PRO_PREFS);
      assert.ok(pro.sets.every((set) => set.plannedTargetReps === 6), JSON.stringify(pro.sets));
    },
  },
  {
    name: 'free start: a climbing session (ramp) is not read set by set; Pro gets per-set targets',
    run() {
      // 40x10, 50x8, 60x5 played as a ramp.
      const ramp = templateOf({ exerciseName: 'Bench Press', trackingMode: 'load_and_reps', sets: 3, repsMin: 5, repsMax: 5 });
      let played = EMPTY;
      const at = new Date(NOW.getTime() - 7 * 86400000);
      let next = workoutReducer(played, {
        type: 'session/startFromRuntimeTemplate',
        payload: {
          template: ramp,
          sessionOrderIndex: 0,
          unitPreference: 'kg',
          progression: { automatedProgressionEnabled: false, setupLevel: 'intermediate', nowMs: at.getTime() },
        },
      });
      const slotId = next.activeSession.exercises[0].slotId;
      [[40, 10], [50, 8], [60, 5]].forEach(([kg, reps], index) => {
        next = workoutReducer(next, {
          type: 'set/updateDraft',
          payload: { slotId, setIndex: index, patch: { loadText: String(kg), repsText: String(reps) } },
        });
        next = workoutReducer(next, {
          type: 'set/complete',
          payload: { slotId, setIndex: index, nowMs: at.getTime(), unitPreference: 'kg' },
        });
      });
      next = workoutReducer(next, { type: 'session/finishWorkout', payload: { performedAt: at.toISOString() } });
      played = workoutReducer(next, { type: 'session/clearCompletedSession' });

      const free = opening(played, ramp, FREE_PREFS);
      assert.ok(free.sets.every((set) => set.rampTargetReps === undefined && set.plannedTargetReps === undefined), JSON.stringify(free.sets));
      assert.deepEqual(free.sets.map((set) => set.plannedLoadKg), [40, 50, 60]);
      const pro = opening(played, ramp, PRO_PREFS);
      assert.ok(pro.sets.some((set) => set.rampTargetReps !== undefined), JSON.stringify(pro.sets));
    },
  },
  {
    name: 'free coach preview: the next-session example quotes the plain repeat, Pro quotes the raise',
    run() {
      const state = historyOf(BENCH, CEILING);
      const preview = (prefs) =>
        previewNextSession(BENCH, {
          history: state.history,
          unitPreference: 'kg',
          sessionOrderIndex: 0,
          ...optionsFor(prefs),
        })[0].sets.map((set) => set.loadKg);
      assert.deepEqual(preview(FREE_PREFS), [100, 100, 100]);
      assert.ok(preview(PRO_PREFS).every((kg) => kg > 100));
    },
  },
  {
    name: 'free session analysis: no "try X kg" raise; Pro keeps it',
    run() {
      const sessions = [];
      const logs = [];
      [14, 7, 0].forEach((daysAgo, index) => {
        sessions.push({
          id: `s${index}`,
          workoutTemplateId: 'tpl',
          workoutTemplateSessionId: 'day',
          workoutNameSnapshot: 'Push',
          performedAt: new Date(2026, 9, 10 - daysAgo, 18).toISOString(),
        });
        logs.push({
          id: `l${index}`,
          sessionId: `s${index}`,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Bench Press',
          weight: 100,
          repsPerSet: [8, 8, 8],
          sets: [0, 1, 2].map((order) => ({
            orderIndex: order,
            weight: 100,
            reps: 8,
            kind: 'working',
            outcome: 'completed',
            status: 'completed',
          })),
          tracked: true,
          orderIndex: 0,
          templateSlotId: 'bench',
        });
      });
      const template = {
        sessions: [
          {
            id: 'day',
            exercises: [{ exerciseName: 'Bench Press', slotId: 'bench', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' }],
          },
        ],
      };
      const analysis = (prefs) =>
        buildSessionAnalysis({
          sessionId: 's2',
          sessions,
          logs,
          language: 'en',
          level: 'intermediate',
          lookupTemplate: () => template,
          automatedProgressionEnabled: resolveProgressionOptions(prefs, NOW).automatedProgressionEnabled,
        });
      assert.ok(analysis(FREE_PREFS).nextActions.every((action) => !/102[.,]5/.test(action.text)));
      assert.ok(analysis(PRO_PREFS).nextActions.some((action) => /102[.,]5 kg/.test(action.text)));
    },
  },
  {
    name: 'wiring: every automatic-progression input in the app is the resolver\'s answer, never the raw switch',
    run() {
      const planReadouts = read('src', 'app', 'usePlanReadouts.tsx');
      assert.match(planReadouts, /const analysisProgressionOn = resolveProgressionOptions\(preferences\)\.automatedProgressionEnabled;/);
      assert.match(planReadouts, /automatedProgressionEnabled: analysisProgressionOn,/);
      assert.doesNotMatch(planReadouts, /automatedProgressionEnabled: preferences\.automatedProgressionEnabled/);

      const starts = read('src', 'app', 'programmeStarts.tsx');
      assert.match(starts, /\.\.\.resolveProgressionOptions\(preferences, now\),/);
      assert.equal((starts.match(/startCustomWorkout\(/g) ?? []).length, 1, 'one start door');

      // Nobody starts a workout with options built by hand.
      const offenders = [];
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, name.name);
          if (name.isDirectory()) {
            walk(full);
          } else if (/\.(ts|tsx)$/.test(name.name) && !full.includes(path.join('src', 'screenshots'))) {
            // Code only: a comment may name the door.
            const text = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            if (/\bstart(Custom)?Workout\(/.test(text) && !/programmeStarts|WorkoutProvider/.test(full)) {
              offenders.push(full);
            }
          }
        }
      };
      walk(path.join(__dirname, '..', '..', 'src'));
      assert.deepEqual(offenders, [], 'a second start door would need its own gate');
    },
  },
];
