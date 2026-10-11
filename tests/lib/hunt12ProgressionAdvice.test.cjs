process.env.TZ = process.env.TZ || 'Europe/Helsinki';
const assert = require('node:assert/strict');

/**
 * Progression hunt 12, advice cluster: what the stall surfaces, the Pro
 * next-step numbers, the coach context and the Progress chip say after a
 * session, held against the progression gate's own answer.
 */
const L = '../../.test-dist/lib/';
const { buildNextSessionAdvice, readLiftProgramme } = require(L + 'nextSessionAdvice.js');
const {
  buildCompletionConclusion,
  buildNextSessionMoment,
  buildPlateauConclusion,
  buildWeeklyRead,
  detectPlateau,
  findPlateauDetection,
  horizonStepKg,
  isLiftPlateaued,
  nextStepKg,
  withProgrammeReads,
} = require(L + 'proInsights.js');
const { buildSessionAnalysis } = require(L + 'sessionAnalysis.js');
const { buildLiftHistories } = require(L + 'trainingHistory.js');
const { nextTimeDirection } = require(L + 'aiCoachSystemContext.js');
const { pickDemoQuestion } = require(L + 'coachDemoMoments.js');
const { getExerciseProgressSignal, getTrackedExerciseProgress } = require(L + 'progression.js');
const { t } = require(L + 'i18n.js');

const dayAt = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 18).toISOString();

/**
 * One session per spec, a week apart by default, all of programme day "day"
 * of programme "tpl". A spec's sets are [kg, reps] pairs; `added` are sets
 * the reader added after the programme's ones (saved with basis 'added').
 */
function sessionsFor(specs, { name = 'Bench Press', templateId = 'tpl' } = {}) {
  const sessions = [];
  const logs = [];
  specs.forEach((spec, index) => {
    const id = `s${index}`;
    sessions.push({
      id,
      workoutTemplateId: templateId,
      workoutTemplateSessionId: 'day',
      workoutNameSnapshot: 'Push',
      performedAt: dayAt(spec.daysAgo),
    });
    const sets = [
      ...spec.sets.map(([kg, reps]) => ({ kg, reps, added: false })),
      ...(spec.added ?? []).map(([kg, reps]) => ({ kg, reps, added: true })),
    ];
    logs.push({
      id: `l${index}`,
      sessionId: id,
      exerciseTemplateId: null,
      exerciseNameSnapshot: name,
      weight: Math.max(...sets.map((set) => set.kg)),
      repsPerSet: sets.map((set) => set.reps),
      sets: sets.map((set, order) => ({
        orderIndex: order,
        weight: set.kg,
        reps: set.reps,
        kind: 'working',
        outcome: 'completed',
        status: 'completed',
        ...(set.added
          ? {
              planned: {
                loadKg: null,
                repsMin: 0,
                repsMax: 0,
                targetReps: null,
                basis: 'added',
                fromKg: null,
                fromReps: null,
                cautionArea: null,
              },
            }
          : {}),
      })),
      tracked: true,
      orderIndex: 0,
      templateSlotId: 'bench',
    });
  });
  return { sessions, logs };
}

function programme({ sets = 3, repsMin = 8, repsMax = 8 } = {}) {
  const template = {
    sessions: [
      {
        id: 'day',
        exercises: [{ exerciseName: 'Bench Press', slotId: 'bench', sets, repsMin, repsMax, trackingMode: 'load_and_reps' }],
      },
    ],
  };
  return () => template;
}

const flat = (kg, ...reps) => reps.map((count) => [kg, count]);
const weekly = (...sessionSets) =>
  sessionSets.map((sets, index) => ({ daysAgo: 7 * (sessionSets.length - 1 - index), sets }));

/** Everything a stall surface reads, for one history. */
function surfaces(specs, { lookup = programme(), level = 'intermediate' } = {}) {
  const { sessions, logs } = sessionsFor(specs);
  const latest = sessions[sessions.length - 1];
  const lifts = withProgrammeReads(buildLiftHistories(sessions, logs), { sessions, logs, lookupTemplate: lookup });
  const lift = lifts.find((entry) => entry.name === 'Bench Press');
  const advice = buildNextSessionAdvice({
    liftName: 'Bench Press',
    sessionId: latest.id,
    sessions,
    logs,
    lookupTemplate: lookup,
    level,
  });
  const analysis = buildSessionAnalysis({
    sessionId: latest.id,
    sessions,
    logs,
    language: 'en',
    level,
    lookupTemplate: lookup,
  });
  return { sessions, logs, lifts, lift, advice, analysis, level };
}

const stalledLabel = t('en', 'pro.read.stalled');

module.exports = [
  // ── A12-1: the session the gate earns its raise is not a stall ─────────────
  {
    name: 'hunt12 A12-1: three ceiling sessions at a first weight raise, and no surface calls the lift stuck',
    run() {
      const { lift, lifts, advice, analysis, level } = surfaces(weekly(flat(100, 8, 8, 8), flat(100, 8, 8, 8), flat(100, 8, 8, 8)));
      assert.equal(lift.stalledSessions, 3, 'the count itself is unchanged: charts read it');
      assert.deepEqual(advice, { kind: 'raise', fromKg: 100, toKg: 102.5 });
      assert.equal(isLiftPlateaued(lift), false);
      assert.equal(detectPlateau(lifts, new Set()), null);
      assert.equal(findPlateauDetection(lifts, 'Bench Press', 'en'), null);
      const rows = buildWeeklyRead(lifts, null, 'en', level);
      assert.ok(rows.length > 0);
      assert.ok(rows.every((row) => row.status !== stalledLabel), JSON.stringify(rows));
      const completion = buildCompletionConclusion(lift, 'en', level, advice);
      assert.ok(completion && /102[.,]5 kg/.test(completion.body), completion && completion.body);
      assert.match(analysis.nextActions[0].text, /102[.,]5 kg/);
      const demo = pickDemoQuestion('month1', { lifts, cautionFlags: null, language: 'en' });
      assert.notEqual(demo.questionKey, 'coach.demo.month1.stalled');
    },
  },
  {
    name: 'hunt12 A12-1: the completion lock never contradicts a raise the gate gave, even on a lift read without its programme',
    run() {
      const { sessions, logs, advice, level } = surfaces(weekly(flat(100, 8, 8, 8), flat(100, 8, 8, 8), flat(100, 8, 8, 8)));
      const bare = buildLiftHistories(sessions, logs).find((entry) => entry.name === 'Bench Press');
      assert.equal(bare.stalledSessions, 3);
      const completion = buildCompletionConclusion(bare, 'en', level, advice);
      assert.ok(completion && /102[.,]5 kg/.test(completion.body), completion && completion.body);
      assert.doesNotMatch(completion.body, /× 9/);
    },
  },
  {
    name: 'hunt12 A12-1: a ready session waiting for its confirmation is not a stall either',
    run() {
      const { lift, lifts, advice, analysis, level } = surfaces(weekly(flat(100, 8, 8, 8), flat(100, 8, 7, 8), flat(100, 8, 8, 8)));
      assert.equal(lift.stalledSessions, 3);
      assert.deepEqual(advice, { kind: 'none' });
      assert.equal(lift.programme.onSchedule, true);
      assert.equal(detectPlateau(lifts, new Set()), null);
      assert.equal(findPlateauDetection(lifts, 'Bench Press', 'en'), null);
      assert.ok(buildWeeklyRead(lifts, null, 'en', level).every((row) => row.status !== stalledLabel));
      assert.equal(buildCompletionConclusion(lift, 'en', level, advice), null);
      assert.ok(analysis.nextActions.every((action) => !/every set/.test(action.text)), JSON.stringify(analysis.nextActions));
    },
  },
  {
    name: 'hunt12 A12-1 control: reps short of the ceiling three times is the plateau it always was',
    run() {
      const { lift, lifts, analysis, level } = surfaces(weekly(flat(100, 6, 6, 6), flat(100, 6, 6, 6), flat(100, 6, 6, 6)));
      assert.equal(lift.programme.onSchedule, false);
      assert.equal(detectPlateau(lifts, new Set()), lift);
      assert.ok(findPlateauDetection(lifts, 'Bench Press', 'en'));
      assert.ok(buildWeeklyRead(lifts, null, 'en', level).some((row) => row.status === stalledLabel));
      const body = buildPlateauConclusion(lift, 'en', level).body;
      assert.match(body, /100 kg × 7 on every set/);
      assert.match(analysis.nextActions[0].text, /100 kg × 7 on every set/);
      assert.equal(pickDemoQuestion('month1', { lifts, cautionFlags: null, language: 'en' }).questionKey, 'coach.demo.month1.stalled');
    },
  },
  {
    name: 'hunt12 A12-1: the plateau text never asks for reps above the programme ceiling',
    run() {
      // Two of three sets, three times: not ready (too few sets), a real stall.
      const { lift, lifts, level } = surfaces(weekly(flat(100, 8, 8), flat(100, 8, 8), flat(100, 8, 8)));
      assert.equal(detectPlateau(lifts, new Set()), lift);
      const body = buildPlateauConclusion(lift, 'en', level).body;
      assert.match(body, /100 kg × 8 on every set/);
      assert.doesNotMatch(body, /× 9/);
    },
  },
  {
    name: 'hunt12 A12-1: a lift with no programme to read keeps the old count',
    run() {
      const { lift, lifts } = surfaces(weekly(flat(100, 8, 8, 8), flat(100, 8, 8, 8), flat(100, 8, 8, 8)), { lookup: () => null });
      assert.ok(!lift.programme);
      assert.equal(detectPlateau(lifts, new Set()), lift);
      assert.equal(readLiftProgramme({ liftName: 'Bench Press', sessionId: 's2', sessions: [], logs: [], lookupTemplate: null }), null);
    },
  },

  // ── A12-2: next-step numbers read the programme's working sets ─────────────
  {
    name: 'hunt12 A12-2: an added heavier set does not move the plateau text or the next step',
    run() {
      const specs = weekly(...[0, 1, 2].map(() => flat(60, 10, 10, 10))).map((spec) => ({ ...spec, added: [[80, 5]] }));
      const { lift, lifts, level } = surfaces(specs, { lookup: programme({ repsMin: 8, repsMax: 12 }) });
      assert.equal(lift.latest.topSetWeightKg, 80, 'records keep the real heaviest set');
      assert.equal(detectPlateau(lifts, new Set()), lift);
      const body = buildPlateauConclusion(lift, 'en', level).body;
      assert.match(body, /60 kg × 11 on every set/);
      assert.match(body, /62[.,]5 kg/);
      assert.doesNotMatch(body, /80 kg|82[.,]5/);
      assert.equal(nextStepKg(lift, level), 62.5);
      assert.equal(horizonStepKg(lift, level).kg, 60 + 2.5 * horizonStepKg(lift, level).sessions);
    },
  },
  {
    name: 'hunt12 A12-2: the next-session sheet projects from the weight the gate raises, not an added set',
    run() {
      const specs = weekly(...[0, 1, 2].map(() => flat(60, 12, 12, 12))).map((spec) => ({ ...spec, added: [[80, 5]] }));
      const { lift, advice, level } = surfaces(specs, { lookup: programme({ repsMin: 8, repsMax: 12 }) });
      assert.deepEqual(advice, { kind: 'raise', fromKg: 60, toKg: 62.5 });
      const moment = buildNextSessionMoment(lift, 'en', level, advice);
      assert.equal(moment.nextValue, 62.5);
      assert.equal(moment.horizonValue, 60 + 2.5 * moment.horizonSessions);
    },
  },
  {
    name: 'hunt12 A12-2 controls: straight sets and a pyramid whose top set is the work keep their numbers',
    run() {
      const straight = surfaces(weekly(flat(60, 10, 10, 10), flat(60, 10, 10, 10), flat(60, 10, 10, 10)), {
        lookup: programme({ repsMin: 8, repsMax: 12 }),
      });
      assert.equal(nextStepKg(straight.lift, straight.level), 62.5);
      const pyramid = [[60, 10], [80, 10], [100, 10]];
      const ramp = surfaces(weekly(pyramid, pyramid, pyramid), { lookup: programme({ repsMin: 8, repsMax: 12 }) });
      assert.equal(nextStepKg(ramp.lift, ramp.level), 102.5);
      assert.match(buildPlateauConclusion(ramp.lift, 'en', ramp.level).body, /100 kg/);
    },
  },

  // ── A12-3: a raise the next start holds for recovery is not advised ────────
  {
    name: 'hunt12 A12-3: advice reads the recovery signal the next start will apply',
    run() {
      const { sessions, logs } = sessionsFor(weekly(flat(100, 8, 8, 8), flat(100, 8, 8, 8)));
      const input = { liftName: 'Bench Press', sessionId: 's1', sessions, logs, lookupTemplate: programme(), level: 'beginner' };
      assert.deepEqual(buildNextSessionAdvice(input), { kind: 'raise', fromKg: 100, toKg: 102.5 });
      assert.deepEqual(buildNextSessionAdvice({ ...input, fatigueSignal: 'normal' }), { kind: 'raise', fromKg: 100, toKg: 102.5 });
      assert.deepEqual(buildNextSessionAdvice({ ...input, fatigueSignal: 'elevated' }), { kind: 'none' });
      assert.deepEqual(buildNextSessionAdvice({ ...input, fatigueSignal: 'high' }), { kind: 'none' });
      const held = buildSessionAnalysis({
        sessionId: 's1',
        sessions,
        logs,
        language: 'en',
        level: 'beginner',
        lookupTemplate: programme(),
        fatigueSignal: 'high',
      });
      assert.ok(held.nextActions.every((action) => !/102[.,]5/.test(action.text)), JSON.stringify(held.nextActions));
    },
  },

  // ── C-1: the coach's "next time" direction compares like with like ────────
  {
    name: 'hunt12 C-1: a raised ramp is a step up, not "lighter than this session"',
    run() {
      const ramp = [
        { weightKg: 40, reps: 10 },
        { weightKg: 50, reps: 10 },
        { weightKg: 60, reps: 10 },
      ];
      const raised = nextTimeDirection(ramp, { loadKg: 42.5, reps: [10, 10, 10] }, false);
      assert.match(raised, /^up from 40 kg: moving on$/);
      const repeated = nextTimeDirection(
        [
          { weightKg: 40, reps: 10 },
          { weightKg: 50, reps: 8 },
          { weightKg: 60, reps: 5 },
        ],
        { loadKg: 40, reps: [10, 8, 6] },
        false,
      );
      assert.ok(repeated === null || !/lighter/.test(repeated), repeated);
      const withAdded = nextTimeDirection(
        [
          { weightKg: 60, reps: 10 },
          { weightKg: 60, reps: 10 },
          { weightKg: 60, reps: 10 },
          { weightKg: 80, reps: 3 },
        ],
        { loadKg: 62.5, reps: [10, 10, 10] },
        false,
      );
      assert.equal(withAdded, 'up from 60 kg: moving on');
      const straight = [0, 1, 2].map(() => ({ weightKg: 60, reps: 10 }));
      assert.equal(nextTimeDirection(straight, { loadKg: 62.5, reps: [10, 10, 10] }, false), 'up from 60 kg: moving on');
      assert.equal(nextTimeDirection(straight, { loadKg: 57.5, reps: [10, 10, 10] }, false), "lighter than this session's 60 kg");
    },
  },

  // ── C-2: a bodyweight lift is read per set, not in total reps ──────────────
  {
    name: 'hunt12 C-2: one set fewer at the same reps is not "below last" for a bodyweight lift',
    run() {
      const pushUps = (...sessions) => {
        const workoutSessions = sessions.map((_, index) => ({
          id: `p${index}`,
          workoutTemplateId: 'tpl',
          workoutNameSnapshot: 'Push',
          performedAt: dayAt(7 * (sessions.length - 1 - index)),
        }));
        const exerciseLogs = sessions.map((reps, index) => ({
          id: `pl${index}`,
          sessionId: `p${index}`,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Push-Up',
          weight: 0,
          repsPerSet: reps,
          sets: reps.map((count, order) => ({ orderIndex: order, weight: 0, reps: count, kind: 'working', outcome: 'completed', status: 'completed' })),
          tracked: true,
          orderIndex: 0,
        }));
        const summary = getTrackedExerciseProgress({
          workoutSessions,
          exerciseLogs,
          exerciseTemplates: [],
          preferences: { strengthGoals: [] },
        }).find(
          (entry) => entry.name === 'Push-Up',
        );
        return getExerciseProgressSignal(summary, 'en').kind;
      };
      assert.notEqual(pushUps([12, 12, 12], [12, 12]), 'below_last');
      assert.equal(pushUps([12, 12, 12], [13, 13, 12]), 'new_best');
      assert.equal(pushUps([12, 12, 12], [10, 10, 10]), 'below_last');
      assert.equal(pushUps([14, 14, 14], [12, 12, 12], [13, 13, 13]), 'moving_up');
    },
  },
];
