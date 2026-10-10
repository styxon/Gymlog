const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildNextSessionMoment,
  buildPlateauConclusion,
  buildWeeklyRead,
  detectPlateau,
  pickCompletionLift,
  recentLifts,
} = require('../../.test-dist/lib/proInsights.js');
const { buildLiftHistories } = require('../../.test-dist/lib/trainingHistory.js');
const { buildFatigueModel } = require('../../.test-dist/lib/fatigueModel.js');
const { buildRecoverySheet } = require('../../.test-dist/lib/recoverySheet.js');
const { buildSessionAnalysis } = require('../../.test-dist/lib/sessionAnalysis.js');
const { ALL_RANGE_CEILING_DAYS, buildValueWindow, measureRangeDays } = require('../../.test-dist/lib/bodyweightCard.js');
const { resolveSubscriptionView } = require('../../.test-dist/lib/subscriptionView.js');
const { t } = require('../../.test-dist/lib/i18n.js');
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');

/**
 * Bug hunt 2026-10-09, the Pro-insights cluster: recency of the findings, what
 * a bodyweight month says about recovery, the analysis' next-session advice,
 * the "All" range, the lapsed trial and the singular forms.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const NOW = new Date(2026, 9, 9, 18, 0, 0);
const DAY = 86400000;
const daysAgo = (days, hour = 10) => new Date(2026, 9, 9 - days, hour).toISOString();

let counter = 0;
/** One session per entry of `days`, each logging every `[name, weight, reps[]]` in `lifts`. */
function build(days, lifts, nameFor = () => 'Day') {
  const sessions = [];
  const logs = [];
  days.forEach((ago, index) => {
    counter += 1;
    const id = `s${counter}`;
    sessions.push({
      id,
      workoutTemplateId: 'tpl',
      workoutNameSnapshot: nameFor(index),
      performedAt: daysAgo(ago),
      durationMinutes: 50,
      setsCompleted: 3,
    });
    for (const [name, weightOf, reps] of lifts) {
      const weight = typeof weightOf === 'function' ? weightOf(index) : weightOf;
      logs.push({
        id: `${id}:${name}`,
        sessionId: id,
        exerciseTemplateId: null,
        exerciseNameSnapshot: name,
        weight,
        repsPerSet: reps,
        tracked: true,
        orderIndex: 0,
      });
    }
  });
  return { sessions, logs };
}

const merge = (...parts) => ({
  sessions: parts.flatMap((part) => part.sessions),
  logs: parts.flatMap((part) => part.logs),
});

const LOWER_BACK_AVOID = [{ area: 'lower_back', level: 'avoid', refinements: [] }];

module.exports = [
  // ── #12 a lift not trained for months is not a current finding ─────────────
  {
    name: 'a lift dropped months ago is not Home\'s plateau card or a Weekly read row',
    run() {
      setNumberLanguage('en');
      // Ten identical Leg Press sessions, the last 279 days ago; three stalled
      // Bench sessions in the last week.
      const dead = build([297, 295, 293, 291, 289, 287, 285, 283, 281, 279], [['Leg Press', 200, [10, 10, 10]]]);
      const live = build([8, 4, 1], [['Barbell Bench Press', 60, [8, 8, 8]]]);
      const { sessions, logs } = merge(dead, live);
      const all = buildLiftHistories(sessions, logs);

      assert.equal(detectPlateau(all).key, 'leg press', 'unfiltered, the longer dead run wins (the bug)');
      const recent = recentLifts(all, NOW);
      assert.deepEqual(recent.map((lift) => lift.key), ['barbell bench press']);
      assert.equal(detectPlateau(recent).key, 'barbell bench press');
      const rows = buildWeeklyRead(recent, null, 'en', 'beginner');
      assert.deepEqual(rows.map((row) => row.name), ['Barbell Bench Press']);
    },
  },
  {
    name: 'recentLifts keeps a lift last trained 55 days ago and drops one at 57 (the coach\'s 56-day window)',
    run() {
      const kept = buildLiftHistories(...Object.values(build([60, 55], [['Squat', 100, [5, 5, 5]]])));
      const dropped = buildLiftHistories(...Object.values(build([70, 57], [['Squat', 100, [5, 5, 5]]])));
      assert.equal(recentLifts(kept, NOW).length, 1);
      assert.equal(recentLifts(dropped, NOW).length, 0);
    },
  },
  {
    name: 'useProInsights builds the plateau card and the weekly read from recent lifts only',
    run() {
      const source = read('src', 'app', 'useProInsights.ts');
      assert.match(source, /recentLifts\(proLiftHistories, Date\.now\(\)\)/);
      assert.match(source, /detectPlateau\(proRecentLifts,/);
      assert.match(source, /buildWeeklyRead\(\s*proRecentLifts,/);
    },
  },

  // ── #56 the completion lock names a lift from the session just done ────────
  {
    name: 'pickCompletionLift with a session id names a lift logged in that session, not the all-time most-logged one',
    run() {
      const benchDays = build([20, 16, 12, 8, 4], [['Barbell Bench Press', (i) => 55 + i * 2.5, [8, 8, 8]]]);
      const legDay = build([1], [['Barbell Back Squat', 100, [5, 5, 5]]]);
      const earlierLegs = build([14, 7], [['Barbell Back Squat', 95, [5, 5, 5]]]);
      const { sessions, logs } = merge(benchDays, earlierLegs, legDay);
      const lifts = buildLiftHistories(sessions, logs);
      assert.equal(pickCompletionLift(lifts).name, 'Barbell Bench Press', 'unfiltered: the most-logged lift (the bug)');
      const picked = pickCompletionLift(lifts, null, legDay.sessions[0].id);
      assert.equal(picked.name, 'Barbell Back Squat');
    },
  },
  {
    name: 'pickCompletionLift gives no lock for a session with no lift that has history, rather than another lift',
    run() {
      const benchDays = build([20, 16, 12, 8, 4], [['Barbell Bench Press', (i) => 55 + i * 2.5, [8, 8, 8]]]);
      const cardio = build([1], [['Rowing machine', 0, [1]]]);
      const { sessions, logs } = merge(benchDays, cardio);
      const lifts = buildLiftHistories(sessions, logs);
      assert.equal(pickCompletionLift(lifts, null, cardio.sessions[0].id), null);
      assert.equal(pickCompletionLift(lifts, null, null), null, 'no session shown, no lock');
    },
  },
  {
    name: 'the completion screen\'s lock is picked for the session it shows',
    run() {
      assert.match(read('src', 'app', 'useProInsights.ts'), /pickCompletionLift\(proLiftHistories, preferences\.setupCautionFlags, completedSessionId\)/);
      assert.match(read('App.tsx'), /completedSessionId: completionSummary\?\.sessionId \?\? null/);
    },
  },

  // ── #13 a month with no loaded work has no load ratio to read ──────────────
  {
    name: 'a bodyweight-only month is not a confident fatigue model, and the recovery sheet does not claim "rested"',
    run() {
      const days = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
      const { sessions, logs } = build(days, [['Push-ups', 0, [15, 12, 10]]]);
      const fatigue = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: logs }, NOW);
      assert.equal(fatigue.chronicLoadKg, 0);
      assert.equal(fatigue.confident, false);
      const sheet = buildRecoverySheet({
        fatigue,
        sessionDates: sessions.map((session) => session.performedAt),
        now: NOW,
        nextSessionTitle: null,
        automatedProgression: true,
        proUnlocked: true,
        tomorrowTrains: true,
        restTomorrowMarked: false,
        lightenQueued: false,
        language: 'en',
      });
      assert.equal(sheet, null, 'no row, no sheet, so no "100% lighter"');
      assert.equal(buildWeeklyRead([], fatigue, 'en', 'beginner').length, 0, 'and no recovery row');
    },
  },
  {
    name: 'a month with loaded work stays confident',
    run() {
      const days = [0, 3, 7, 10, 14, 17, 21, 24];
      const { sessions, logs } = build(days, [['Barbell Squat', 100, [5, 5, 5]]]);
      const fatigue = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: logs }, NOW);
      assert.ok(fatigue.chronicLoadKg > 0);
      assert.equal(fatigue.confident, true);
    },
  },

  // ── #14 the analysis' next-session advice follows the plan's own rules ─────
  {
    name: 'session analysis never tells a reader to go up on a lift that loads a flagged area',
    run() {
      setNumberLanguage('en');
      const days = [28, 21, 14, 7, 0];
      const { sessions, logs } = build(days, [
        ['Barbell Deadlift', (i) => 120 + i * 5, [5]],
        ['Barbell Bench Press', (i) => 60 + i * 2.5, [8, 8, 8]],
      ]);
      const last = sessions[sessions.length - 1];
      const open = buildSessionAnalysis({ sessionId: last.id, sessions, logs, language: 'en' });
      assert.match(open.nextActions[0].text, /Deadlift/, 'with no flag the heaviest lift leads');
      const held = buildSessionAnalysis({
        sessionId: last.id,
        sessions,
        logs,
        language: 'en',
        cautionFlags: LOWER_BACK_AVOID,
      });
      assert.ok(held.nextActions.length > 0);
      for (const action of held.nextActions) {
        assert.doesNotMatch(action.text, /Deadlift/i);
      }
      assert.match(held.nextActions[0].text, /Bench Press/, 'the next lift in line is named instead');
    },
  },
  {
    name: 'session analysis gives a stalled lift the plateau card\'s reps-first advice, not +2.5 kg',
    run() {
      setNumberLanguage('en');
      const { sessions, logs } = build([28, 21, 14, 7, 0], [['Barbell Bench Press', 60, [6, 6, 6]]]);
      const last = sessions[sessions.length - 1];
      const analysis = buildSessionAnalysis({ sessionId: last.id, sessions, logs, language: 'en', level: 'beginner' });
      const lift = buildLiftHistories(sessions, logs)[0];
      assert.ok(lift.stalledSessions >= 3);
      assert.equal(analysis.nextActions[0].text, buildPlateauConclusion(lift, 'en', 'beginner').body);
      assert.doesNotMatch(analysis.nextActions[0].text, /^Try /);
    },
  },
  {
    name: 'the analysis route passes the reader\'s flags and level',
    run() {
      const source = read('src', 'app', 'usePlanReadouts.tsx');
      assert.match(source, /cautionFlags: preferences\.setupCautionFlags,\s*level: preferences\.setupLevel,/);
    },
  },

  // ── #53 "All" reaches back to the first entry ──────────────────────────────
  {
    name: 'the measure chart\'s "All" is not cut at two years',
    run() {
      const first = new Date(2023, 9, 1, 8).getTime();
      const now = NOW.getTime();
      const days = measureRangeDays('all', first, now);
      assert.ok(days > 1000, `three years of history is more than ${days} days`);
      const entries = [
        { recordedAt: new Date(2023, 9, 1, 8).toISOString(), value: 90 },
        { recordedAt: new Date(2024, 5, 1, 8).toISOString(), value: 86 },
        { recordedAt: new Date(2026, 9, 1, 8).toISOString(), value: 82 },
      ];
      const window = buildValueWindow(entries, now, days, 'en');
      assert.equal(window.filter((day) => day.value !== null).length, 3);
    },
  },
  {
    name: '"All" is still bounded against a wrongly stamped entry, and the other chips keep their ceilings',
    run() {
      const now = NOW.getTime();
      assert.equal(measureRangeDays('all', 0, now), ALL_RANGE_CEILING_DAYS);
      assert.equal(measureRangeDays('1y', new Date(2020, 0, 1).getTime(), now), 365);
      assert.match(read('src', 'screens', 'ProgressScreen.tsx'), /\?\? ALL_RANGE_CEILING_DAYS/);
      assert.doesNotMatch(read('src', 'screens', 'ProgressScreen.tsx'), /\?\? 730/);
    },
  },

  // ── #54 a lapsed trial is a lapse ───────────────────────────────────────────
  {
    name: 'subscription: an expired trial reads as lapsed with its end date, as an expired promo does',
    run() {
      const none = { unlocked: false, source: null, promoUntil: null, purchaseEndsAt: null };
      const base = { entitlement: none, mockTerm: 'yearly', mockCancelled: false };
      const trialEnded = resolveSubscriptionView({ ...base, lapsedTrialUntil: '2026-09-20T10:00:00.000Z' });
      assert.equal(trialEnded.state, 'lapsed');
      assert.equal(trialEnded.grant, 'trial');
      assert.equal(trialEnded.endsAt, '2026-09-20T10:00:00.000Z');
      const promoEnded = resolveSubscriptionView({ ...base, lapsedPromoUntil: '2026-08-01T10:00:00.000Z' });
      assert.equal(promoEnded.state, 'lapsed');
      assert.equal(promoEnded.grant, 'promo');
      const both = resolveSubscriptionView({
        ...base,
        lapsedPromoUntil: '2026-08-01T10:00:00.000Z',
        lapsedTrialUntil: '2026-09-20T10:00:00.000Z',
      });
      assert.equal(both.grant, 'trial', 'the one that ran out last ended the Pro');
      assert.equal(both.endsAt, '2026-09-20T10:00:00.000Z');
      assert.equal(resolveSubscriptionView({ ...base, lapsedTrialUntil: 'garbage' }).state, 'none');
      assert.equal(resolveSubscriptionView(base).state, 'none');
    },
  },
  {
    name: 'the subscription page is handed the trial\'s end while Pro is off',
    run() {
      assert.match(
        read('src', 'app', 'renderProfileTab.tsx'),
        /lapsedTrialUntil=\{proEntitlement\.unlocked \? null : preferences\.proTrialUntil\}/,
      );
      assert.match(read('src', 'screens', 'SubscriptionScreen.tsx'), /lapsedTrialUntil,\s*\}\);/);
    },
  },

  // ── #55 boundary copy ───────────────────────────────────────────────────────
  {
    name: 'one locked record reads in the singular, in both languages',
    run() {
      assert.equal(t('en', 'pr.locked.titleOne'), '1 older record is locked');
      assert.equal(t('fi', 'pr.locked.titleOne'), '1 vanhempi ennätys on lukossa');
      assert.equal(t('en', 'pr.locked.title', { count: 3 }), '3 older records are locked');
      const source = read('src', 'screens', 'RecordsScreen.tsx');
      assert.match(source, /lockedCount === 1\s*\? t\(language, 'pr\.locked\.titleOne'\)/);
    },
  },
  {
    name: 'a fully locked set log does not wear a "Free · 3 months" pill',
    run() {
      assert.doesNotMatch(read('src', 'components', 'SetLogSheet.tsx'), /freePill/);
      assert.doesNotMatch(read('src', 'lib', 'i18n.ts'), /setlog\.freePill/);
    },
  },

  // ── #57 singular forms ──────────────────────────────────────────────────────
  {
    name: 'weekly read: one week and one session read in the singular, in English and Finnish',
    run() {
      setNumberLanguage('en');
      const climbing = build([6, 3, 0], [['Barbell Bench Press', (i) => 60 + i * 2.5, [8, 8, 8]]]);
      const lifts = buildLiftHistories(climbing.sessions, climbing.logs);
      assert.equal(Math.max(1, Math.round(lifts[0].spanDays / 7)), 1);
      const [en] = buildWeeklyRead(lifts, null, 'en', 'beginner');
      assert.equal(en.meta, '+5 kg in 1 week');
      const [fi] = buildWeeklyRead(lifts, null, 'fi', 'beginner');
      assert.match(fi.meta, /\/ 1 viikko$/);
      const slower = build([20, 10, 0], [['Barbell Bench Press', (i) => 60 + i * 2.5, [8, 8, 8]]]);
      const [many] = buildWeeklyRead(buildLiftHistories(slower.sessions, slower.logs), null, 'en', 'beginner');
      assert.match(many.meta, /in 3 weeks$/);

      const fatigue = (count, signal) => ({
        acuteLoadKg: 5000,
        chronicLoadKg: 3000,
        acwr: 1.7,
        recoveryScore: 20,
        signal,
        sessionCount7d: count,
        sessionCount28d: 8,
        confident: true,
      });
      const [one] = buildWeeklyRead([], fatigue(1, 'high'), 'en', 'beginner');
      assert.equal(one.meta, '1 session in the last 7 days');
      assert.match(one.locked.body, /^1 hard session this week/);
      const [oneFi] = buildWeeklyRead([], fatigue(1, 'high'), 'fi', 'beginner');
      assert.equal(oneFi.meta, '1 treeni viimeisen 7 päivän aikana');
      assert.match(oneFi.locked.body, /^1 kova treeni viikossa/);
      const [three] = buildWeeklyRead([], fatigue(3, 'high'), 'en', 'beginner');
      assert.equal(three.meta, '3 sessions in the last 7 days');
      assert.match(three.locked.body, /^3 hard sessions this week/);
    },
  },
  {
    name: 'the next-session moment says "in 1 week" for a one-week climb',
    run() {
      setNumberLanguage('en');
      const climbing = build([6, 3, 0], [['Barbell Bench Press', (i) => 60 + i * 2.5, [8, 8, 8]]]);
      const lift = buildLiftHistories(climbing.sessions, climbing.logs)[0];
      assert.match(buildNextSessionMoment(lift, 'en', 'beginner').lead, / in 1 week\./);
      assert.match(buildNextSessionMoment(lift, 'fi', 'beginner').lead, / 1 viikossa\./);
    },
  },
  {
    name: 'session analysis says "over 1 exercise" for a single-lift session',
    run() {
      const one = build([7, 0], [['Barbell Squat', 100, [5, 5]]]);
      const last = one.sessions[one.sessions.length - 1];
      const sub = (language, data) =>
        buildSessionAnalysis({ sessionId: last.id, sessions: data.sessions, logs: data.logs, language }).keyNumbers.find(
          (metric) => metric.labelKey === 'analysis.key.sets',
        ).sub;
      assert.equal(sub('en', one), 'over 1 exercise');
      assert.equal(sub('fi', one), '1 liikkeessä');
      const two = build([7, 0], [
        ['Barbell Squat', 100, [5, 5]],
        ['Barbell Bench Press', 60, [8]],
      ]);
      const twoLast = two.sessions[two.sessions.length - 1];
      assert.equal(
        buildSessionAnalysis({ sessionId: twoLast.id, sessions: two.sessions, logs: two.logs, language: 'en' }).keyNumbers.find(
          (metric) => metric.labelKey === 'analysis.key.sets',
        ).sub,
        'over 2 exercises',
      );
    },
  },
];
