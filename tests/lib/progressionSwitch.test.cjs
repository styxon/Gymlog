process.env.TZ = process.env.TZ || 'Europe/Helsinki';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

/**
 * The automatic-progression switch (owner Q5, 2026-10-12): Settings turns it
 * off for a Pro reader, and then no surface promises the raise the next start
 * will not make.
 */
const L = '../../.test-dist/lib/';
const { buildNextSessionAdvice, readLiftProgramme } = require(L + 'nextSessionAdvice.js');
const { buildSessionAnalysis } = require(L + 'sessionAnalysis.js');
const { buildCompletionConclusion, withProgrammeReads } = require(L + 'proInsights.js');
const { buildLiftHistories } = require(L + 'trainingHistory.js');
const { buildAiTrainingContext, normalizeAiCoachTrainingContext } = require(L + 'aiTrainingContext.js');
const { buildAiCoachContextText } = require(L + 'aiCoachSystemContext.js');
const { getTrackedExerciseProgress } = require(L + 'progression.js');
const { resolveProgressionOptions } = require(L + 'proEntitlement.js');
const { t } = require(L + 'i18n.js');

const dayAt = (daysAgo) => new Date(2026, 9, 10 - daysAgo, 18).toISOString();

/** Three weekly sessions of 3 × 8 at 100 kg on a 3 × 8 row: the gate raises next. */
function ceilingRun() {
  const sessions = [];
  const logs = [];
  [14, 7, 0].forEach((daysAgo, index) => {
    sessions.push({
      id: `s${index}`,
      workoutTemplateId: 'tpl',
      workoutTemplateSessionId: 'day',
      workoutNameSnapshot: 'Push',
      performedAt: dayAt(daysAgo),
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
  return { sessions, logs, lookupTemplate: () => template };
}

function adviceWith(automatedProgressionEnabled) {
  const { sessions, logs, lookupTemplate } = ceilingRun();
  return buildNextSessionAdvice({
    liftName: 'Bench Press',
    sessionId: 's2',
    sessions,
    logs,
    lookupTemplate,
    level: 'intermediate',
    automatedProgressionEnabled,
  });
}

function analysisWith(automatedProgressionEnabled) {
  const { sessions, logs, lookupTemplate } = ceilingRun();
  return buildSessionAnalysis({
    sessionId: 's2',
    sessions,
    logs,
    language: 'en',
    level: 'intermediate',
    lookupTemplate,
    automatedProgressionEnabled,
  });
}

function coachTextWith(automatedProgressionEnabled) {
  const { sessions, logs, lookupTemplate } = ceilingRun();
  const context = buildAiTrainingContext({
    unitPreference: 'kg',
    activeWorkoutSummary: null,
    homeSummary: { streak: { sessionsThisWeek: 1, sessionsLast30Days: 3, activity: { days: [] } } },
    workoutSessions: sessions,
    exerciseLogs: logs,
    trackedProgress: getTrackedExerciseProgress({
      workoutSessions: sessions,
      exerciseLogs: logs,
      exerciseTemplates: [],
      preferences: { strengthGoals: [] },
    }),
    readyProgramCount: 3,
    recommendedProgramId: null,
    recommendedProgramTitle: null,
    customProgramTitle: null,
    adviceTemplateLookup: lookupTemplate,
    automatedProgressionEnabled,
    now: new Date(2026, 9, 10, 21),
  });
  return buildAiCoachContextText(normalizeAiCoachTrainingContext(context), 'en');
}

module.exports = [
  {
    name: 'progression switch: off, the next-session advice gives no raise; on, it does',
    run() {
      assert.deepEqual(adviceWith(true), { kind: 'raise', fromKg: 100, toKg: 102.5 });
      assert.deepEqual(adviceWith(false), { kind: 'none' });
    },
  },
  {
    name: 'progression switch: off, the session analysis does not say "move up to", and the completion lock has nothing to sell',
    run() {
      const on = analysisWith(true);
      assert.ok(on.nextActions.some((action) => /102[.,]5 kg/.test(action.text)), JSON.stringify(on.nextActions));
      const off = analysisWith(false);
      assert.ok(off.nextActions.every((action) => !/102[.,]5/.test(action.text)), JSON.stringify(off.nextActions));

      const { sessions, logs, lookupTemplate } = ceilingRun();
      const lift = withProgrammeReads(buildLiftHistories(sessions, logs), { sessions, logs, lookupTemplate }).find(
        (entry) => entry.name === 'Bench Press',
      );
      assert.equal(buildCompletionConclusion(lift, 'en', 'intermediate', adviceWith(false)), null);
    },
  },
  {
    name: 'progression switch: off, the coach is not told the app adds weight on its own schedule',
    run() {
      const { sessions, logs, lookupTemplate } = ceilingRun();
      const ask = { liftName: 'Bench Press', sessionId: 's2', sessions, logs, lookupTemplate };
      assert.equal(readLiftProgramme(ask).onSchedule, true, 'left out, the switch reads as on');
      assert.equal(readLiftProgramme({ ...ask, automatedProgressionEnabled: false }).onSchedule, false);

      assert.match(coachTextWith(true), /adds weight on its own schedule/);
      const off = coachTextWith(false);
      assert.doesNotMatch(off, /adds weight on its own schedule/);
      assert.match(off, /no rep gain at 100 kg/);
    },
  },
  {
    name: 'progression switch: the gate option is the switch ANDed with Pro, so Free keeps a lock instead of a switch',
    run() {
      const pro = { proTrialUntil: '2099-01-01T00:00:00Z', setupLevel: 'beginner' };
      const now = new Date(2026, 9, 12, 12);
      assert.equal(resolveProgressionOptions({ ...pro, automatedProgressionEnabled: true }, now).automatedProgressionEnabled, true);
      assert.equal(resolveProgressionOptions({ ...pro, automatedProgressionEnabled: false }, now).automatedProgressionEnabled, false);
      assert.equal(
        resolveProgressionOptions({ setupLevel: 'beginner', automatedProgressionEnabled: true }, now).automatedProgressionEnabled,
        false,
      );

      // Settings: the live switch is Pro's; Free's row is the way to the Pro page.
      const settings = read('src', 'screens', 'SettingsScreen.tsx');
      const writes = settings.match(/onPreferencesChange\(\{ automatedProgressionEnabled: next \}\)/g) ?? [];
      assert.equal(writes.length, 1, 'one writer of the switch');
      const branch = settings.slice(settings.indexOf('{proUnlocked ? ('), settings.indexOf("t(language, 'settings.trainingBreak')"));
      const [proHalf, freeHalf] = branch.split(') : (');
      assert.ok(proHalf.includes('automatedProgressionEnabled: next'), 'the switch sits in the Pro half');
      assert.ok(freeHalf.includes('<ProPill />') && freeHalf.includes('onPress={onOpenPremium}'), 'Free sees PRO and opens the Pro page');
      assert.ok(!freeHalf.includes('ToggleSwitch'), 'no live switch on Free: it would change nothing');

      for (const language of ['en', 'fi']) {
        assert.notEqual(t(language, 'settings.autoProgression'), 'settings.autoProgression');
        assert.notEqual(t(language, 'settings.autoProgression.sub'), 'settings.autoProgression.sub');
      }

      // The completion lock (a Pro teaser) sells the raise to Free, so it reads
      // the reader's own switch. The session analysis is delivered, not sold:
      // owner 2026-10-19, Free gets no automatic progression, so it reads the
      // switch with Pro, as the coach does (tests/lib/freeNoAutoProgression).
      assert.match(read('src', 'app', 'useProInsights.ts'), /automatedProgressionEnabled: preferences\.automatedProgressionEnabled/);
      assert.match(read('src', 'app', 'usePlanReadouts.tsx'), /automatedProgressionEnabled: analysisProgressionOn,/);
      const coach = read('src', 'app', 'useCoachContext.ts');
      assert.match(coach, /const progressionOn = resolveProgressionOptions\(preferences\)\.automatedProgressionEnabled;/);
      assert.match(coach, /automatedProgressionEnabled: progressionOn,/);
    },
  },
];
