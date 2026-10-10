const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { t } = require('../../.test-dist/lib/i18n.js');
const { resolveDueCoachDemoMoment } = require('../../.test-dist/lib/coachDemoMoments.js');
const { resolveRecord, recordEntriesOfLogs } = require('../../.test-dist/lib/personalRecords.js');
const { isRecordLocked } = require('../../.test-dist/lib/historyWindow.js');
const { liftBestPerformedAt, isLiftBestLocked } = require('../../.test-dist/lib/liftBestGate.js');
const { buildExerciseSheetHistory, gateExerciseSheetHistory } = require('../../.test-dist/lib/exerciseSheetHistory.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

// Bug hunt 11 (2026-10-10), insights cluster.

const NOW = new Date(2026, 9, 10, 12);

function liftOf(name, stalledSessions, lastDate) {
  const time = Date.parse(lastDate);
  const points = [0, 1, 2].map((i) => ({
    sessionId: `${name}${i}`,
    performedAt: lastDate,
    time: time - (2 - i) * 86_400_000,
    topSetWeightKg: 100,
    totalReps: 24,
  }));
  return {
    key: name,
    name,
    stalledSessions,
    weightChangeKg: 0,
    spanDays: 10,
    points,
    first: { performedAt: lastDate, topSetWeightKg: 100, time },
    latest: { performedAt: lastDate, topSetWeightKg: 100, topSetReps: 8, time },
  };
}

function due(lifts, language) {
  return resolveDueCoachDemoMoment({
    firstLaunchAt: '2026-08-01T09:00:00.000Z',
    usedMoments: ['week1'],
    proUnlocked: false,
    sessionCount: 40,
    lifts,
    fatigueSignal: null,
    language,
    now: NOW,
  });
}

module.exports = [
  {
    name: 'coach demo moment: a lift dropped months ago is not the one asked about',
    run() {
      const old = liftOf('Leg Press', 10, '2026-01-12T10:00:00.000Z');
      const recent = liftOf('Bench Press', 4, '2026-10-08T10:00:00.000Z');
      assert.equal(due([old, recent], 'en').vars.lift, 'Bench Press');
      // Nothing trained lately and stalled: the generic question, not the old lift.
      assert.equal(due([old], 'en').questionKey, 'coach.demo.month1.pace');
    },
  },
  {
    name: 'coach demo moment: the lift is named in the reader\'s language',
    run() {
      const recent = liftOf('Leg Press', 4, '2026-10-08T10:00:00.000Z');
      assert.equal(due([recent], 'fi').vars.lift, 'Jalkaprässi');
      assert.equal(due([recent], 'en').vars.lift, 'Leg Press');
      assert.match(read('src', 'app', 'useCoachDemoMoment.ts'), /language: preferences\.appLanguage/);
    },
  },
  {
    name: 'records tab: one exercise reads in the singular, in both languages',
    run() {
      assert.equal(t('en', 'pr.liftCountOne'), '1 EXERCISE');
      assert.equal(t('fi', 'pr.liftCountOne'), '1 LIIKE');
      assert.equal(t('en', 'pr.liftCount', { count: 3 }), '3 EXERCISES');
      assert.match(read('src', 'screens', 'RecordsScreen.tsx'), /shown\.length === 1[\s\S]{0,60}pr\.liftCountOne/);
    },
  },
  {
    name: 'goal flow: one week reads in the singular, in both languages',
    run() {
      assert.equal(t('en', 'goalFlow.weeksAtRateOne'), '≈ 1 week at your rate');
      assert.equal(t('fi', 'goalFlow.weeksAtRateOne'), '≈ 1 viikko omalla tahdillasi');
      assert.match(t('en', 'goalFlow.rateBodyOne', { kg: 5, unit: 'kg', sessions: 3 }), /over 1 week across/);
      assert.match(t('fi', 'goalFlow.rateBodyOne', { kg: 5, unit: 'kg', sessions: 3 }), / 1 viikossa /);
      const screen = read('src', 'screens', 'StrengthGoalFlowScreen.tsx');
      assert.match(screen, /estimate\.weeks === 1[\s\S]{0,80}goalFlow\.weeksAtRateOne/);
      assert.match(screen, /Math\.round\(estimate\.rate\.spanWeeks\) === 1 \? 'goalFlow\.rateBodyOne'/);
    },
  },
  {
    name: 'lift page: a same-weight, more-reps best is dated and locked like the Records list',
    run() {
      const logs = [
        { sessionId: 'a', performedAt: '2026-04-01T10:00:00.000Z', exerciseNameSnapshot: 'Back Squat', weight: 100, repsPerSet: [5] },
        { sessionId: 'b', performedAt: '2026-10-08T10:00:00.000Z', exerciseNameSnapshot: 'Back Squat', weight: 100, repsPerSet: [6] },
      ];
      const rec = resolveRecord({ key: 'k', name: 'Back Squat', entries: recordEntriesOfLogs(logs) }, 'weight', NOW);
      assert.equal(liftBestPerformedAt(logs, 'weight'), rec.performedAt);
      assert.equal(isLiftBestLocked(logs, 'weight', false, NOW), isRecordLocked(rec.performedAt, false, NOW));
      assert.equal(isLiftBestLocked(logs, 'weight', false, NOW), false);
      const past = logs.map((l) => ({ performedAt: l.performedAt, sets: [{ loadKg: l.weight, reps: l.repsPerSet[0] }] }));
      assert.equal(gateExerciseSheetHistory(buildExerciseSheetHistory(past, null, 'en'), false, NOW).bestLocked, false);
      // The identical set again later is still matched, not beaten.
      const matched = [logs[0], { ...logs[1], repsPerSet: [5] }];
      assert.equal(liftBestPerformedAt(matched, 'weight'), logs[0].performedAt);
      assert.equal(isLiftBestLocked(matched, 'weight', false, NOW), true);
    },
  },
];
