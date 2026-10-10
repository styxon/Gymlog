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
const { buildRecoverySheet, lightenRuntimeTemplate, resolveProgrammeStart } = require(L + 'recoverySheet.js');
const { programmeSetCount, toWorkingHistoryEntry } = require(L + 'warmupSets.js');
const { buildCompletionConclusion, buildNextSessionMoment } = require(L + 'proInsights.js');
const { buildNextSessionAdvice } = require(L + 'nextSessionAdvice.js');
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


// ── next-session advice scenarios ────────────────────────────────────────────
const EIGHT = { repsMax: 8, targetSets: 3, level: 'beginner' };
const dayAt = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 18).toISOString();

/** One session per spec, all of programme day "day" of programme "tpl". */
function sessionsFor(specs, { dayId = 'day' } = {}) {
  const sessions = [];
  const logs = [];
  // A spec may also say: dayId / templateId (another day or programme), skipped,
  // name (the lift as logged), slot (null: a log with no slot), and sets
  // ([[kg, reps], ...]) when the loads differ within the session.
  specs.forEach((spec, index) => {
    const id = `s${index}`;
    sessions.push({
      id,
      workoutTemplateId: spec.templateId ?? 'tpl',
      workoutTemplateSessionId: 'dayId' in spec ? spec.dayId : dayId,
      workoutNameSnapshot: 'Push',
      performedAt: dayAt(spec.daysAgo),
    });
    logs.push({
      id: `l${index}`,
      sessionId: id,
      exerciseTemplateId: null,
      exerciseNameSnapshot: spec.name ?? 'Bench Press',
      weight: spec.sets ? Math.max(...spec.sets.map(([kg]) => kg)) : spec.weight,
      repsPerSet: spec.sets ? spec.sets.map(([, reps]) => reps) : spec.reps,
      ...(spec.sets
        ? {
            sets: spec.sets.map(([kg, reps], order) => ({
              orderIndex: order,
              weight: kg,
              reps,
              kind: 'working',
              outcome: 'completed',
              status: 'completed',
            })),
          }
        : {}),
      tracked: true,
      orderIndex: 0,
      ...(spec.skipped ? { skipped: true } : {}),
      ...(spec.slot === null ? {} : { templateSlotId: spec.slot ?? 'bench' }),
    });
  });
  return { sessions, logs };
}

function templateFor(config) {
  return {
    sessions: [
      {
        id: 'day',
        exercises: [
          {
            exerciseName: 'Bench Press',
            slotId: 'bench',
            sets: config.targetSets,
            repsMin: config.repsMax === 12 ? 8 : config.repsMax,
            repsMax: config.repsMax,
            trackingMode: 'load_and_reps',
          },
        ],
      },
    ],
  };
}

function currentOf(specs, sessions, daysAgo) {
  const target = daysAgo ?? Math.min(...specs.map((spec) => spec.daysAgo));
  return sessions[specs.findIndex((spec) => spec.daysAgo === target)];
}

function adviceFor(specs, config, opts = {}) {
  const { sessions, logs } = sessionsFor(specs, opts);
  const lookup = 'lookup' in opts ? opts.lookup : () => opts.template ?? templateFor(config);
  return buildNextSessionAdvice({
    liftName: opts.liftName ?? 'Bench Press',
    sessionId: currentOf(specs, sessions, opts.currentDaysAgo).id,
    sessions,
    logs,
    lookupTemplate: lookup,
    level: config.level,
  });
}

/** The gate on the same history, built by hand the way the logger files it. */
function gateFor(specs, config) {
  const ordered = [...specs].sort((a, b) => a.daysAgo - b.daysAgo);
  const history = ordered.map((spec) => entry(dayAt(spec.daysAgo), spec.reps, spec.weight));
  return evaluateProgression({
    history,
    repsMin: config.repsMax === 12 ? 8 : config.repsMax,
    repsMax: config.repsMax,
    targetSets: config.targetSets,
    level: config.level,
    nowMs: Date.parse(dayAt(Math.min(...specs.map((spec) => spec.daysAgo)))),
  });
}

function analyse(specs, config, opts = {}) {
  const { sessions, logs } = sessionsFor(specs, opts);
  return buildSessionAnalysis({
    sessionId: currentOf(specs, sessions).id,
    sessions,
    logs,
    language: 'en',
    level: config.level,
    lookupTemplate: 'lookup' in opts ? opts.lookup : () => templateFor(config),
  });
}

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
    name: 'a programme start resolves recovery at the start clock, and a lighter session holds its loads',
    run() {
      const sessions = [];
      let id = 0;
      const add = (y, m, d, vol) =>
        sessions.push({ id: `s${id++}`, performedAt: new Date(y, m, d, 18).toISOString(), totalVolumeKg: vol, workoutNameSnapshot: 'x' });
      for (const w of [0, 7, 14]) for (const o of [0, 2, 4]) add(2026, 8, 14 + w + o, 5000);
      for (const o of [21, 23, 25]) add(2026, 8, 14 + o, 9000);
      const input = { workoutSessions: sessions, exerciseLogs: [] };
      const template = {
        id: 't',
        name: 'T',
        defaultScheduleMode: 'weekly',
        sessions: [{ id: 'd', name: 'D', orderIndex: 0, exercises: [{ id: 'e', exerciseName: 'Bench Press', slotId: 'b', sets: 4, repsMin: 8, repsMax: 8 }] }],
      };
      const justSaved = resolveProgrammeStart(template, false, input, new Date(2026, 9, 9, 19, 30));
      const nextWeek = resolveProgrammeStart(template, false, input, new Date(2026, 9, 14, 18, 0));
      assert.equal(justSaved.fatigueSignal, 'elevated');
      assert.equal(nextWeek.fatigueSignal, 'normal');
      assert.equal(nextWeek.template.sessions[0].exercises[0].sets, 4);
      const lighter = resolveProgrammeStart(template, true, input, new Date(2026, 9, 14, 18, 0));
      assert.equal(lighter.fatigueSignal, 'elevated');
      assert.equal(lighter.template.sessions[0].exercises[0].sets, 3);
    },
  },
  {
    name: 'a programme start asks for recovery at its own clock, and the shared memo moves on with the day',
    run() {
      const starts = read('src', 'app', 'programmeStarts.tsx');
      assert.match(starts, /resolveProgrammeStart\(runtimeTemplate, lighten, database, now\)/);
      assert.doesNotMatch(starts, /progressionFatigueSignal\b(?!At)/, 'no stale memo passed in');
      const insights = read('src', 'app', 'useProInsights.ts');
      assert.match(insights, /\[database\.exerciseLogs, database\.workoutSessions, todayKey\]/);
    },
  },

  // 2. next-session advice is the gate's own answer
  {
    name: 'post-session advice does not raise the weight after the reps collapsed',
    run() {
      const analysis = analyse([
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [5, 4, 4] },
      ], EIGHT);
      const text = analysis.nextActions.map((a) => a.text).join(' | ');
      assert.doesNotMatch(text, /62[.,]5/);
      assert.match(text, /Hold Bench Press where it is and get the reps back first/);
    },
  },
  {
    name: 'advice equals the gate in each ordinary case, raise and hold alike',
    run() {
      const climbing = { repsMax: 12, targetSets: 3, level: 'beginner' };
      const intermediate = { repsMax: 8, targetSets: 3, level: 'intermediate' };
      const intermediate12 = { repsMax: 12, targetSets: 3, level: 'intermediate' };
      // [name, specs, config, expected advice kind]
      const cases = [
        ['reps climbing inside a range', [
          { daysAgo: 7, weight: 60, reps: [9, 9, 9] }, { daysAgo: 0, weight: 60, reps: [10, 10, 10] }], climbing, 'none'],
        ['first session at a new weight after 12s at the old one', [
          { daysAgo: 7, weight: 57.5, reps: [12, 12, 12] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], climbing, 'none'],
        ['intermediate waits for a second ceiling session', [
          { daysAgo: 14, weight: 57.5, reps: [12, 12, 12] }, { daysAgo: 7, weight: 57.5, reps: [12, 12, 12] },
          { daysAgo: 0, weight: 60, reps: [12, 12, 12] }], intermediate12, 'none'],
        ['intermediate with three ceiling sessions', [
          { daysAgo: 14, weight: 60, reps: [8, 8, 8] }, { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
          { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], intermediate, 'raise'],
        ['after a 40-day break', [
          { daysAgo: 40, weight: 60, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], EIGHT, 'none'],
        ['one session ever', [{ daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT, 'none'],
        ['an old higher-rep record from 700 days ago', [
          { daysAgo: 700, weight: 60, reps: [15, 12, 10] }, { daysAgo: 14, weight: 60, reps: [8, 8, 8] },
          { daysAgo: 7, weight: 60, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], EIGHT, 'raise'],
        ['one big set earlier (8/8/12), now 8/8/8 twice', [
          { daysAgo: 14, weight: 60, reps: [8, 8, 12] }, { daysAgo: 7, weight: 60, reps: [8, 8, 8] }], EIGHT, 'raise'],
        ['a tired extra set (8/8/8/5)', [
          { daysAgo: 7, weight: 60, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8, 5] }], EIGHT, 'raise'],
        ['10/9/8 then 8/8/8 against a ceiling of 8', [
          { daysAgo: 7, weight: 60, reps: [10, 9, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], EIGHT, 'raise'],
        ['10/9/8 twice against a ceiling of 8: the gate raises', [
          { daysAgo: 7, weight: 60, reps: [10, 9, 8] }, { daysAgo: 0, weight: 60, reps: [10, 9, 8] }], EIGHT, 'raise'],
        ['10/9/8 twice inside a range to 12: held, but not a fall', [
          { daysAgo: 7, weight: 60, reps: [10, 9, 8] }, { daysAgo: 0, weight: 60, reps: [10, 9, 8] }], climbing, 'none'],
        ['reps fell after two clean sessions', [
          { daysAgo: 14, weight: 60, reps: [8, 8, 8] }, { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
          { daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT, 'rebuild_reps'],
        ['early jump on a weight far too light', [{ daysAgo: 0, weight: 60, reps: [10, 10, 10] }], EIGHT, 'raise'],
      ];
      for (const [name, specs, config, expected] of cases) {
        const advice = adviceFor(specs, config);
        const decision = gateFor(specs, config);
        assert.equal(advice.kind, expected, `${name}: ${JSON.stringify(advice)} vs gate ${JSON.stringify(decision)}`);
        // Advice raises exactly where the gate raises, and to the gate's weight.
        assert.equal(advice.kind === 'raise', decision.recommendation === 'increase', name);
        if (advice.kind === 'raise') {
          assert.equal(advice.toKg, decision.loadKg, name);
        }
        if (advice.kind === 'rebuild_reps') {
          assert.equal(decision.holdReason, 'rep_ceiling_not_reached', name);
        }
      }
    },
  },
  {
    name: 'post-session advice names a weight only when the gate raises, and the reps only when they fell',
    run() {
      const text = (specs, config) => analyse(specs, config).nextActions.map((a) => a.text).join(' | ');
      assert.match(
        text([{ daysAgo: 7, weight: 60, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], EIGHT),
        /62[.,]5/,
      );
      // First session at 60 after 57.5 x 8/8/8 with 6/6/6: the gate holds, reps did not fall at 60.
      const stepped = text([{ daysAgo: 7, weight: 57.5, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT);
      assert.doesNotMatch(stepped, /62[.,]5/);
      assert.doesNotMatch(stepped, /get the reps back/);
      const same = text([{ daysAgo: 7, weight: 60, reps: [10, 9, 8] }, { daysAgo: 0, weight: 60, reps: [10, 9, 8] }], { repsMax: 12, targetSets: 3, level: 'beginner' });
      assert.doesNotMatch(same, /get the reps back|62[.,]5/);
    },
  },
  {
    name: 'the analysis and the completion lock are given the programme to read the gate against',
    run() {
      assert.match(read('src', 'app', 'usePlanReadouts.tsx'), /lookupTemplate: createAdviceTemplateLookup\(/);
      const insights = read('src', 'app', 'useProInsights.ts');
      assert.match(insights, /buildNextSessionAdvice\(/);
      assert.match(insights, /buildCompletionConclusion\(proCompletionLift, preferences\.appLanguage, preferences\.setupLevel, advice\)/);
      assert.match(insights, /buildNextSessionMoment\(proCompletionLift, preferences\.appLanguage, preferences\.setupLevel, advice\)/);
    },
  },
  {
    name: 'no advice about a weight when the programme cannot be found',
    run() {
      const specs = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8] },
      ];
      assert.deepEqual(adviceFor(specs, EIGHT, { lookup: () => null }), { kind: 'none' });
      assert.deepEqual(adviceFor(specs, EIGHT, { lookup: null }), { kind: 'none' });
      // A freestyle workout names no programme day.
      assert.deepEqual(adviceFor(specs, EIGHT, { dayId: null }), { kind: 'none' });
      // A day the programme no longer has.
      assert.deepEqual(adviceFor(specs, EIGHT, { dayId: 'gone' }), { kind: 'none' });
      const analysis = analyse(specs, EIGHT, { lookup: () => null });
      assert.ok(!analysis.nextActions.some((a) => /62[.,]5|Hold Bench/.test(a.text)));
    },
  },
  // Each input the advice hands the gate has its own guard; one test apiece.
  {
    name: 'advice reads last time\'s warm-ups against the programme\'s set count',
    run() {
      // 40 x 5 then 3 x 60 x 8, twice, on a three-set programme: the 40 is a warm-up.
      const sets = [[40, 5], [60, 8], [60, 8], [60, 8]];
      const advice = adviceFor([{ daysAgo: 7, sets }, { daysAgo: 0, sets }], EIGHT);
      assert.deepEqual(advice, { kind: 'raise', fromKg: 60, toKg: 62.5 });
    },
  },
  {
    name: 'advice stops at the session it follows: a newer session of the lift does not count',
    run() {
      const specs = [
        { daysAgo: 14, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [4, 4, 4] },
      ];
      assert.deepEqual(adviceFor(specs, EIGHT, { currentDaysAgo: 7 }), { kind: 'raise', fromKg: 60, toKg: 62.5 });
      assert.equal(adviceFor(specs, EIGHT, { currentDaysAgo: 0 }).kind, 'rebuild_reps');
      // Nor does a later session make the earlier one a baseline it did not have.
      const two = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8] },
      ];
      assert.equal(adviceFor(two, EIGHT, { currentDaysAgo: 7 }).kind, 'none');
    },
  },
  {
    name: 'advice tells two rows of one lift apart by slot, and takes the done log when another was skipped',
    run() {
      const twoRows = {
        sessions: [
          {
            id: 'day',
            exercises: [
              { exerciseName: 'Bench Press', slotId: 'benchA', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' },
              { exerciseName: 'Bench Press', slotId: 'benchB', sets: 3, repsMin: 8, repsMax: 12, trackingMode: 'load_and_reps' },
            ],
          },
        ],
      };
      // 8/8/8 twice in the row whose range runs to 12: held, where the 8-rep row would raise.
      const inB = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8], slot: 'benchB' },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8], slot: 'benchB' },
      ];
      assert.equal(adviceFor(inB, EIGHT, { template: twoRows }).kind, 'none');
      const inA = inB.map((spec) => ({ ...spec, slot: 'benchA' }));
      assert.equal(adviceFor(inA, EIGHT, { template: twoRows }).kind, 'raise');
      // The session also holds a skipped log of the lift under the other row: the done one decides.
      const { sessions, logs } = sessionsFor(inA);
      logs.unshift({ ...logs[logs.length - 1], id: 'skipped', skipped: true, templateSlotId: 'benchB' });
      const advice = buildNextSessionAdvice({
        liftName: 'Bench Press',
        sessionId: 's1',
        sessions,
        logs,
        lookupTemplate: () => twoRows,
        level: 'beginner',
      });
      assert.equal(advice.kind, 'raise');
    },
  },
  {
    name: 'advice counts only sessions of the same programme day',
    run() {
      // One session of this day and one of another: a single session is not a baseline.
      const specs = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8], dayId: 'other' },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8] },
      ];
      assert.equal(adviceFor(specs, EIGHT).kind, 'none');
      assert.equal(gateFor([specs[1]], EIGHT).recommendation, 'silent');
    },
  },
  {
    name: 'advice counts only sessions of the same programme',
    run() {
      const specs = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8], templateId: 'elsewhere' },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8] },
      ];
      assert.equal(adviceFor(specs, EIGHT).kind, 'none');
    },
  },
  {
    name: 'advice ignores a skipped lift in history, and says nothing when this session skipped it',
    run() {
      const skippedBefore = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8], skipped: true },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8] },
      ];
      assert.equal(adviceFor(skippedBefore, EIGHT).kind, 'none');
      const skippedNow = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8], skipped: true },
      ];
      assert.equal(adviceFor(skippedNow, EIGHT).kind, 'none');
    },
  },
  {
    name: 'advice does not pick between two rows of a lift by guessing: a log with no slot needs one row',
    run() {
      const twoRows = {
        sessions: [
          {
            id: 'day',
            exercises: [
              { exerciseName: 'Bench Press', slotId: 'benchA', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' },
              { exerciseName: 'Bench Press', slotId: 'benchB', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' },
            ],
          },
        ],
      };
      const noSlot = [
        { daysAgo: 7, weight: 60, reps: [8, 8, 8], slot: null },
        { daysAgo: 0, weight: 60, reps: [8, 8, 8], slot: null },
      ];
      assert.equal(adviceFor(noSlot, EIGHT, { template: twoRows }).kind, 'none');
      // The same history on a programme with the one row, a log with no slot, is read by the lift's name.
      assert.equal(adviceFor(noSlot, EIGHT).kind, 'raise');
    },
  },
  {
    name: 'advice follows the slot a log was filed under: a swapped-in lift has no row of its own',
    run() {
      const template = {
        sessions: [
          {
            id: 'day',
            exercises: [
              { exerciseName: 'Bench Press', slotId: 'benchA', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' },
              { exerciseName: 'Incline Press', slotId: 'incl', sets: 3, repsMin: 12, repsMax: 12, trackingMode: 'load_and_reps' },
            ],
          },
        ],
      };
      // Incline Press swapped into the bench slot, twice: that is not the incline row's history.
      const swapped = [
        { daysAgo: 7, weight: 30, reps: [12, 12, 12], name: 'Incline Press', slot: 'benchA' },
        { daysAgo: 0, weight: 30, reps: [12, 12, 12], name: 'Incline Press', slot: 'benchA' },
      ];
      assert.equal(adviceFor(swapped, EIGHT, { template, liftName: 'Incline Press' }).kind, 'none');
      // Done in its own slot it is read against its own row.
      const own = swapped.map((spec) => ({ ...spec, slot: 'incl' }));
      assert.deepEqual(adviceFor(own, EIGHT, { template, liftName: 'Incline Press' }), { kind: 'raise', fromKg: 30, toKg: 32.5 });
      // And a session of the lift under the other slot is not pooled into this slot's history.
      const mixed = [
        { daysAgo: 7, weight: 30, reps: [12, 12, 12], name: 'Incline Press', slot: 'benchA' },
        { daysAgo: 0, weight: 30, reps: [12, 12, 12], name: 'Incline Press', slot: 'incl' },
      ];
      assert.equal(adviceFor(mixed, EIGHT, { template, liftName: 'Incline Press' }).kind, 'none');
    },
  },
  {
    name: 'the Pro next-session moment and completion lock follow the gate, and say nothing of a weight otherwise',
    run() {
      const lockFor = (specs, config) => {
        const { sessions, logs } = sessionsFor(specs);
        const lift = buildLiftHistories(sessions, logs)[0];
        const advice = adviceFor(specs, config);
        return {
          advice,
          conclusion: buildCompletionConclusion(lift, 'en', config.level, advice),
          moment: buildNextSessionMoment(lift, 'en', config.level, advice),
        };
      };
      const raise = lockFor([{ daysAgo: 7, weight: 60, reps: [8, 8, 8] }, { daysAgo: 0, weight: 60, reps: [8, 8, 8] }], EIGHT);
      assert.equal(raise.advice.kind, 'raise');
      assert.match(raise.conclusion.body, /62[.,]5/);
      assert.equal(raise.moment.nextValue, 62.5);
      assert.notEqual(raise.moment.horizonValue, null);

      const fell = lockFor([
        { daysAgo: 7, weight: 60, reps: [8, 8, 8] },
        { daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT);
      assert.equal(fell.advice.kind, 'rebuild_reps');
      assert.match(fell.conclusion.body, /get the reps back first/);
      assert.equal(fell.moment.nextValue, 60);
      assert.equal(fell.moment.horizonValue, null);

      const waiting = lockFor([{ daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT);
      assert.equal(waiting.advice.kind, 'none');
      // No change from the gate and no plateau: no lock, so no promise of one.
      assert.equal(waiting.conclusion, null);
      assert.equal(waiting.moment.nextValue, null);
      assert.equal(waiting.moment.horizonValue, null);
      // On a plateau the lock stays, whatever the gate says.
      const stuck = lockFor([
        { daysAgo: 14, weight: 60, reps: [6, 6, 6] }, { daysAgo: 7, weight: 60, reps: [6, 6, 6] },
        { daysAgo: 0, weight: 60, reps: [6, 6, 6] }], EIGHT);
      assert.notEqual(stuck.conclusion, null);
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

      // The swap path and the "Last time" panel read the live sets: one number.
      const lightSets = start(lighter).activeSession.exercises[0].sets;
      assert.equal(programmeSetCount(lightSets), 4);
      const found = state.history.slotHistory[slotId][0];
      assert.deepEqual(
        toWorkingHistoryEntry(found, programmeSetCount(lightSets)).sets.map((set) => set.loadKg),
        [60, 80, 100, 100],
      );
      // An ordinary session, and one saved before the field existed, count as before.
      const ordinarySets = start(template).activeSession.exercises[0].sets;
      assert.equal(ordinarySets.some((set) => 'programmeSets' in set), false);
      assert.equal(programmeSetCount(ordinarySets), 4);
      assert.equal(programmeSetCount(lightSets.map(({ programmeSets, ...rest }) => rest)), 3);
      assert.equal(programmeSetCount([{ programmeSets: 'x' }, { addedMidSession: true }]), 1);
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
