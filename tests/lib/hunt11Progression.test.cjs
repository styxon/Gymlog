process.env.TZ = process.env.TZ || 'Europe/Helsinki';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = '../../.test-dist/lib/';
const { buildFatigueModel } = require(L + 'fatigueModel.js');
const {
  evaluateProgression,
  progressionFatigueSignalAt,
  toProgressionFatigueSignal,
} = require(L + 'progressionGate.js');
const { buildSessionAnalysis } = require(L + 'sessionAnalysis.js');
const { buildRecoverySheet, lightenRuntimeTemplate } = require(L + 'recoverySheet.js');
const { buildCompletionConclusion, nextSessionKg, repsKeptAtTopWeight } = require(L + 'proInsights.js');
const { buildLiftHistories } = require(L + 'trainingHistory.js');
const { workoutReducer } = require('../../.test-dist/features/workout/workoutState.js');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

let counter = 0;
/** spec: [{ sid, name, date, weight, reps, session }] -> sessions + logs. */
function build(spec) {
  const sessions = [];
  const logs = [];
  spec.forEach((item) => {
    const sid = item.sid || `s${++counter}`;
    if (!sessions.find((s) => s.id === sid)) {
      sessions.push({
        id: sid,
        workoutTemplateId: 't',
        workoutNameSnapshot: item.session || 'Push',
        performedAt: item.date,
        totalVolumeKg: item.vol,
      });
    }
    logs.push({
      id: `l${++counter}`,
      sessionId: sid,
      exerciseTemplateId: null,
      exerciseNameSnapshot: item.name,
      weight: item.weight,
      repsPerSet: item.reps,
      tracked: true,
      orderIndex: 0,
    });
  });
  return { sessions, logs };
}

const day = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 18).toISOString();

const entry = (iso, reps, load) => ({
  slotId: 's',
  templateId: 't',
  templateName: 'T',
  exerciseName: 'Bench Press',
  substitutionGroup: '',
  performedAt: iso,
  sessionId: iso,
  skipped: false,
  sets: reps.map((r, i) => ({ setIndex: i, loadKg: load, reps: r, completedAt: iso, effort: null })),
});

module.exports = [
  // 1. recovery is read for the moment a workout starts
  {
    name: 'the recovery signal at a start is read at the start, not frozen at the last save',
    run() {
      const sessions = [];
      let id = 0;
      const add = (y, m, d, vol) =>
        sessions.push({ id: `s${id++}`, performedAt: new Date(y, m, d, 18).toISOString(), totalVolumeKg: vol, workoutNameSnapshot: 'x' });
      for (const w of [0, 7, 14]) for (const o of [0, 2, 4]) add(2026, 8, 14 + w + o, 5000);
      for (const o of [21, 23, 25]) add(2026, 8, 14 + o, 9000);
      const input = { workoutSessions: sessions, exerciseLogs: [] };
      const lastSaved = new Date(2026, 9, 9, 19, 30);
      const atStart = new Date(2026, 9, 14, 18, 0);
      assert.equal(toProgressionFatigueSignal(buildFatigueModel(input, lastSaved)), 'elevated');
      assert.equal(progressionFatigueSignalAt(input, lastSaved), 'elevated');
      assert.equal(progressionFatigueSignalAt(input, atStart), 'normal');
    },
  },
  {
    name: 'a programme start asks for recovery at its own clock, and the shared memo moves on with the day',
    run() {
      const starts = read('src', 'app', 'programmeStarts.tsx');
      assert.match(starts, /progressionFatigueSignalAt\(database, now\)/);
      assert.doesNotMatch(starts, /progressionFatigueSignal\b(?!At)/, 'no stale memo passed in');
      const insights = read('src', 'app', 'useProInsights.ts');
      assert.match(insights, /\[database\.exerciseLogs, database\.workoutSessions, todayKey\]/);
    },
  },

  // 2. next-session advice follows the reps
  {
    name: 'post-session advice does not raise the weight after the reps collapsed',
    run() {
      const { sessions, logs } = build([
        { sid: 's1', name: 'Bench Press', date: day(7), weight: 60, reps: [8, 8, 8], vol: 1440 },
        { sid: 's2', name: 'Bench Press', date: day(0), weight: 60, reps: [5, 4, 4], vol: 780 },
      ]);
      const analysis = buildSessionAnalysis({ sessionId: 's2', sessions, logs, language: 'en', level: 'beginner' });
      const text = analysis.nextActions.map((a) => a.text).join(' | ');
      assert.doesNotMatch(text, /62[.,]5/);
      assert.match(text, /Hold Bench Press where it is and get the reps back first/);
      // The gate says the same of the same history.
      const decision = evaluateProgression({
        history: [entry(day(0), [5, 4, 4], 60), entry(day(7), [8, 8, 8], 60)],
        repsMin: 8,
        repsMax: 8,
        targetSets: 3,
        level: 'beginner',
        nowMs: Date.parse(day(-2)),
      });
      assert.equal(decision.recommendation, 'hold');
    },
  },
  {
    name: 'post-session advice still raises when the reps held, and at a weight not yet tried',
    run() {
      const held = build([
        { sid: 'h1', name: 'Bench Press', date: day(7), weight: 60, reps: [8, 8, 8], vol: 1440 },
        { sid: 'h2', name: 'Bench Press', date: day(0), weight: 60, reps: [8, 8, 8], vol: 1440 },
      ]);
      const a = buildSessionAnalysis({ sessionId: 'h2', sessions: held.sessions, logs: held.logs, language: 'en', level: 'beginner' });
      assert.match(a.nextActions.map((x) => x.text).join(' | '), /62[.,]5/);
      // First session at a new weight: the earlier 8s were at 57.5.
      const stepped = build([
        { sid: 'p1', name: 'Bench Press', date: day(7), weight: 57.5, reps: [8, 8, 8], vol: 1380 },
        { sid: 'p2', name: 'Bench Press', date: day(0), weight: 60, reps: [6, 6, 6], vol: 1080 },
      ]);
      const b = buildSessionAnalysis({ sessionId: 'p2', sessions: stepped.sessions, logs: stepped.logs, language: 'en', level: 'beginner' });
      assert.match(b.nextActions.map((x) => x.text).join(' | '), /62[.,]5/);
    },
  },
  {
    name: 'the Pro next-session moment and completion lock hold the weight after collapsed reps',
    run() {
      const { sessions, logs } = build([
        { sid: 'c1', name: 'Bench Press', date: day(7), weight: 60, reps: [8, 8, 8] },
        { sid: 'c2', name: 'Bench Press', date: day(0), weight: 60, reps: [5, 4, 4] },
      ]);
      const lift = buildLiftHistories(sessions, logs)[0];
      assert.equal(repsKeptAtTopWeight(lift), false);
      assert.equal(nextSessionKg(lift, 'beginner'), 60);
      const lock = buildCompletionConclusion(lift, 'en', 'beginner');
      assert.doesNotMatch(lock.body, /62,5|62\.5/);
      assert.match(lock.body, /get the reps back first/);
    },
  },

  // 3. the gate ranks by the time on the entry
  {
    name: 'a session saved with a wrong past clock does not stay the newest for the gate',
    run() {
      const real1 = entry(new Date(2026, 9, 1, 18).toISOString(), [8, 8, 8], 60);
      const real2 = entry(new Date(2026, 9, 5, 18).toISOString(), [8, 8, 8], 60);
      const wrong = entry(new Date(2000, 0, 1, 12).toISOString(), [8, 8, 8], 60);
      const nowMs = new Date(2026, 9, 12, 18).getTime();
      const args = { repsMin: 8, repsMax: 8, targetSets: 3, level: 'beginner', nowMs };
      const clean = evaluateProgression({ ...args, history: [real2, real1] });
      assert.equal(clean.recommendation, 'increase');
      // Newest first by insertion, oldest by date.
      assert.deepEqual(evaluateProgression({ ...args, history: [wrong, real2, real1] }), clean);
      // Without a clock too.
      assert.equal(evaluateProgression({ ...args, nowMs: undefined, history: [wrong, real2, real1] }).recommendation, 'increase');
    },
  },
  {
    name: 'entries with the same time keep the order they were stored in',
    run() {
      const at = new Date(2026, 9, 5, 18).toISOString();
      const clean = entry(at, [8, 8, 8], 60);
      const short = entry(at, [5, 5, 5], 60);
      const args = { repsMin: 8, repsMax: 8, targetSets: 3, level: 'beginner' };
      assert.equal(evaluateProgression({ ...args, history: [short, clean] }).holdReason, 'rep_ceiling_not_reached');
    },
  },

  // 4. a lightened session keeps the programme's warm-up reading
  {
    name: 'a lightened pyramid keeps its first set: 60/80/100/100 opens 60/80/100',
    run() {
      const at = '2026-10-03T09:00:00.000Z';
      const exercise = {
        id: 'e_sq',
        exerciseName: 'Barbell Back Squat',
        slotId: 'sq',
        role: 'primary',
        progressionPriority: 'high',
        trackingMode: 'load_and_reps',
        sets: 4,
        repsMin: 8,
        repsMax: 8,
        restSecondsMin: 90,
        restSecondsMax: 120,
        substitutionGroup: 'squat',
      };
      const template = {
        id: 'tpl',
        name: 'Legs',
        defaultScheduleMode: 'weekly',
        sessions: [{ id: 'day_a', name: 'Legs', orderIndex: 0, exercises: [exercise] }],
      };
      let state = {
        activeSession: null,
        completionSummary: null,
        history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
        nowMs: 0,
      };
      const start = (tpl) =>
        workoutReducer(state, {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template: tpl,
            sessionOrderIndex: 0,
            unitPreference: 'kg',
            progression: { automatedProgressionEnabled: false, setupLevel: 'beginner', nowMs: Date.parse('2026-10-10T09:00:00.000Z') },
          },
        });
      state = start(template);
      const slotId = state.activeSession.exercises[0].slotId;
      [60, 80, 100, 100].forEach((load, index) => {
        state = workoutReducer(state, {
          type: 'set/updateDraft',
          payload: { slotId, setIndex: index, patch: { loadText: String(load), repsText: '8' } },
        });
        state = workoutReducer(state, {
          type: 'set/complete',
          payload: { slotId, setIndex: index, nowMs: Date.parse(at), unitPreference: 'kg' },
        });
      });
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: at } });
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      const loads = (tpl) => start(tpl).activeSession.exercises[0].sets.map((set) => set.draftLoadText);
      assert.deepEqual(loads(template), ['60', '80', '100', '100']);
      const lighter = lightenRuntimeTemplate(template);
      assert.equal(lighter.sessions[0].exercises[0].sets, 3);
      assert.deepEqual(loads(lighter), ['60', '80', '100']);
    },
  },

  // 5. a week without load is not a rested week
  {
    name: 'a week of bodyweight sessions is not "100% lighter, you are rested"',
    run() {
      const spec = [];
      for (const d of ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02']) {
        spec.push({ name: 'Back Squat', date: `${d}T10:00:00.000Z`, weight: 100, reps: [5, 5, 5] });
      }
      for (const d of ['2026-10-05', '2026-10-07', '2026-10-09']) {
        spec.push({ name: 'Pull-Up', date: `${d}T10:00:00.000Z`, weight: 0, reps: [8, 8, 8] });
      }
      const { sessions, logs } = build(spec);
      const now = new Date(2026, 9, 10, 12);
      const fatigue = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: logs }, now);
      assert.equal(fatigue.acuteLoadKg, 0);
      assert.equal(fatigue.sessionCount7d, 3);
      const lead = (language) =>
        buildRecoverySheet({
          fatigue,
          sessionDates: sessions.map((s) => s.performedAt),
          now,
          nextSessionTitle: null,
          automatedProgression: true,
          proUnlocked: true,
          tomorrowTrains: true,
          restTomorrowMarked: false,
          lightenQueued: false,
          language,
        }).lead;
      for (const language of ['en', 'fi']) {
        const text = lead(language);
        assert.doesNotMatch(text, /100/);
        assert.doesNotMatch(text, /rested|levännyt/i);
      }
      assert.match(lead('en'), /No weight was lifted/);
      assert.match(lead('fi'), /ei nostettu painoja/);
    },
  },

  // 6. a bodyweight workout has an analysis
  {
    name: 'the analysis of a bodyweight workout has rep rows and a trend, and no untrue "log one more"',
    run() {
      const { sessions, logs } = build([
        { sid: 'a', name: 'Pull-Up', date: '2026-10-01T10:00:00.000Z', weight: 0, reps: [8, 8, 6] },
        { sid: 'a', name: 'Push-Up', date: '2026-10-01T10:00:00.000Z', weight: 0, reps: [20, 18, 15] },
        { sid: 'b', name: 'Pull-Up', date: '2026-10-08T10:00:00.000Z', weight: 0, reps: [9, 8, 7] },
        { sid: 'b', name: 'Push-Up', date: '2026-10-08T10:00:00.000Z', weight: 0, reps: [20, 18, 15] },
      ]);
      const a = buildSessionAnalysis({ sessionId: 'b', sessions, logs, language: 'en' });
      assert.deepEqual(
        a.exercises.map((r) => [r.name, r.detail, r.trend, r.trendLabel]),
        [
          ['Pull-Up', '3 × 9/8/7', 'up', '+2 reps'],
          ['Push-Up', '3 × 20/18/15', 'flat', 'unchanged'],
        ],
      );
      assert.ok(a.observations.some((o) => /Pull-Up/.test(o.body.text)));
      assert.ok(!a.nextActions.some((x) => /Log one more/.test(x.text)));
      // The first of them has nothing to compare with, and says so.
      const first = buildSessionAnalysis({ sessionId: 'a', sessions, logs, language: 'en' });
      assert.ok(first.exercises.every((r) => r.trend === null));
      assert.ok(first.nextActions.some((x) => /Log one more/.test(x.text)));
    },
  },
];
