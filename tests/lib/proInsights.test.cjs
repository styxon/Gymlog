const assert = require('node:assert/strict');

const {
  PLATEAU_STALL_SESSIONS,
  detectPlateau,
  buildPlateauDetection,
  buildPlateauConclusion,
  buildPlateauMoment,
  buildNextSessionMoment,
  buildWeeklyRead,
  pickCompletionLift,
  buildCompletionConclusion,
  nextStepKg,
  horizonStepKg,
  liftCadenceDays,
  HORIZON_DAYS,
  plateauEpisodeKey,
  findPlateauDetection,
} = require('../../.test-dist/lib/proInsights.js');
const { buildLiftHistories } = require('../../.test-dist/lib/trainingHistory.js');

/**
 * These assert English copy, so they assert English number formatting with it.
 * removeTrailingZeros reads a module-level decimal mark (lib/format.ts) that
 * the app sets from preferences and that defaults to Finnish, so a suite that
 * wants points rather than commas has to say so — otherwise it passes or fails
 * on whichever suite ran before it.
 */
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
setNumberLanguage('en');

const DAY = 86400000;
const NOW = Date.parse('2026-07-28T09:00:00.000Z');
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

function history({ name = 'Barbell Back Squat', weights, reps = null }) {
  const sessions = [];
  const logs = [];
  weights.forEach((weight, index) => {
    const id = `s${index}`;
    const daysAgo = (weights.length - 1 - index) * 4;
    sessions.push({
      id,
      workoutTemplateId: 'tpl',
      workoutNameSnapshot: 'Day 1: Push',
      performedAt: at(daysAgo),
      durationMinutes: 50,
      setsCompleted: 9,
    });
    logs.push({
      id: `${id}-log`,
      sessionId: id,
      exerciseTemplateId: null,
      exerciseNameSnapshot: name,
      weight,
      repsPerSet: reps ? reps[index] : [8, 8, 8],
      tracked: true,
      orderIndex: 0,
    });
  });
  return buildLiftHistories(sessions, logs);
}

module.exports = [
  {
    name: 'proInsights: a lift stalled for 4 sessions is detected with real numbers and dates',
    run() {
      const lifts = history({ weights: [80, 82.5, 82.5, 82.5, 82.5] });
      const lift = detectPlateau(lifts);
      assert.ok(lift, 'four sessions at one top set is a plateau');
      assert.equal(lift.stalledSessions, 4);

      const detection = buildPlateauDetection(lift, 'en');
      // The finding is stated from the log: the weight, the reps, the count.
      assert.match(detection.headline, /hasn't moved in 4 sessions/);
      assert.match(detection.meta, /82\.5 kg × 8\/8\/8, 4 sessions running/);
    },
  },
  {
    name: 'proInsights: a rep gained at the same weight is progress, not a plateau (#bugs 2026-10-01)',
    run() {
      // 60 × 6/6/6 twice, then 6/6/7: double progression working. The card
      // said "hasn't moved in 3 sessions · 60 kg × 7" and asked for 8 on
      // every set.
      const climbing = history({
        name: 'Bench Press',
        weights: [60, 60, 60],
        reps: [[6, 6, 6], [6, 6, 6], [6, 6, 7]],
      });
      assert.equal(climbing[0].stalledSessions, 1);
      assert.equal(detectPlateau(climbing), null);

      // Flat again after that gain: the run counts from the gain, not from
      // the first session at the weight.
      const flatAfterGain = history({
        name: 'Bench Press',
        weights: [60, 60, 60, 60, 60],
        reps: [[6, 6, 6], [6, 6, 7], [6, 6, 7], [6, 6, 7], [6, 6, 7]],
      });
      const lift = detectPlateau(flatAfterGain);
      assert.ok(lift);
      assert.equal(lift.stalledSessions, 4);
      // The meta says what was logged, set by set — not "× 7", which read
      // as three sets of seven.
      assert.match(buildPlateauDetection(lift, 'en').meta, /^60 kg × 6\/6\/7, 4 sessions running/);
      // One rep more than the weakest set: 7 on every set, not 8.
      assert.equal(
        buildPlateauConclusion(lift, 'en', 'beginner').body,
        'Next time 60 kg × 7 on every set. Once that holds, move up to 62.5 kg.',
      );
    },
  },
  {
    name: 'proInsights: "later sets fade" needs sets that fade within the sessions, not a lower total (#bugs 2026-10-02)',
    run() {
      // 19, 18, 18 total reps: lower than the first session, but no set faded.
      // It said "Your later sets fade every session" and told the reader to cut a set.
      const flat = history({
        name: 'Bench Press',
        weights: [60, 60, 60],
        reps: [[6, 6, 7], [6, 6, 6], [6, 6, 6]],
      });
      const flatLift = detectPlateau(flat);
      assert.ok(flatLift);
      assert.equal(
        buildPlateauConclusion(flatLift, 'en', 'beginner').body,
        'Next time 60 kg × 7 on every set. Once that holds, move up to 62.5 kg.',
      );

      // A real fade, set by set in each session, still reads as recovery.
      const fading = history({
        name: 'Bench Press',
        weights: [60, 60, 60],
        reps: [[8, 7, 6], [8, 6, 5], [7, 6, 5]],
      });
      assert.equal(
        buildPlateauConclusion(detectPlateau(fading), 'en', 'beginner').body,
        'Your later sets fade every session. Hold 60 kg and do one set fewer.',
      );
    },
  },
  {
    name: 'proInsights: a lighter log of the first stalled session is not weighed in the fade rule',
    run() {
      // S1 also has 100 kg 10/8/6 earlier in the workout. The run at 102.5 kg
      // is 6/6/6, 6/6/6, 6/5/4: one fading session of three, not recovery.
      const reps = [
        [[100, [10, 8, 6]], [102.5, [6, 6, 6]]],
        [[102.5, [6, 6, 6]]],
        [[102.5, [6, 5, 4]]],
      ];
      const sessions = [];
      const logs = [];
      reps.forEach((entries, index) => {
        sessions.push({
          id: `s${index}`,
          workoutTemplateId: 'tpl',
          workoutNameSnapshot: 'Push',
          performedAt: at((reps.length - 1 - index) * 4),
          durationMinutes: 50,
        });
        entries.forEach(([weight, repsPerSet], order) => {
          logs.push({
            id: `s${index}-${order}`,
            sessionId: `s${index}`,
            exerciseTemplateId: null,
            exerciseNameSnapshot: 'Bench Press',
            weight,
            repsPerSet,
            tracked: true,
            orderIndex: order,
          });
        });
      });
      const lift = buildLiftHistories(sessions, logs)[0];
      assert.equal(lift.stalledSessions, 3);
      assert.doesNotMatch(buildPlateauConclusion(lift, 'en', 'beginner').body, /later sets fade/);
    },
  },
  {
    name: 'proInsights: a duplicate log does not weigh a session twice in the fade rule',
    run() {
      // 8/8/8, then 8/6/5 logged twice, 8/6/5, 8/8/8: two of four sessions
      // fade, not "most". Counting logs made it three of five: recovery.
      const reps = [[[8, 8, 8]], [[8, 6, 5], [8, 6, 5]], [[8, 6, 5]], [[8, 8, 8]]];
      const sessions = [];
      const logs = [];
      reps.forEach((entries, index) => {
        sessions.push({
          id: `s${index}`,
          workoutTemplateId: 'tpl',
          workoutNameSnapshot: 'Push',
          performedAt: at((reps.length - 1 - index) * 4),
          durationMinutes: 50,
        });
        entries.forEach((repsPerSet, order) => {
          logs.push({
            id: `s${index}-${order}`,
            sessionId: `s${index}`,
            exerciseTemplateId: null,
            exerciseNameSnapshot: 'Bench Press',
            weight: 60,
            repsPerSet,
            tracked: true,
            orderIndex: order,
          });
        });
      });
      const lift = detectPlateau(buildLiftHistories(sessions, logs));
      assert.ok(lift);
      assert.equal(lift.stalledSessions, 4);
      assert.match(buildPlateauConclusion(lift, 'en', 'beginner').body, /^Next time 60 kg/);
      // The card's "from" is the first stalled session, not a later log.
      assert.match(buildPlateauDetection(lift, 'en').meta, /4 sessions running/);
    },
  },
  {
    name: 'proInsights: an improving lift is NOT a plateau',
    run() {
      const lifts = history({ weights: [60, 62.5, 65, 67.5, 70] });
      assert.equal(detectPlateau(lifts), null);
    },
  },
  {
    name: 'proInsights: falling later-set reps read as recovery, holding reps as earn-the-step',
    run() {
      // Total reps decline across the stalled run → recovery.
      const declining = history({
        weights: [82.5, 82.5, 82.5, 82.5],
        reps: [[8, 8, 8], [8, 8, 7], [8, 7, 6], [8, 6, 5]],
      });
      const decliningFix = buildPlateauConclusion(detectPlateau(declining), 'en', 'beginner');
      assert.match(decliningFix.body, /later sets fade/);
      // Recovery says HOLD — the weight the reader is already at is correct here.
      assert.equal(decliningFix.body, 'Your later sets fade every session. Hold 82.5 kg and do one set fewer.');
      const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
      setNumberLanguage('fi');
      try {
        assert.equal(
          buildPlateauConclusion(detectPlateau(declining), 'fi', 'beginner').body,
          'Loppusarjat hiipuvat joka treenissä. Pidä 82,5 kg ja tee yksi sarja vähemmän.',
        );
      } finally {
        setNumberLanguage('en');
      }

      // Reps hold → the reps path. Same weight appears in the real text.
      const holding = history({
        weights: [82.5, 82.5, 82.5, 82.5],
        reps: [[8, 8, 8], [8, 8, 8], [8, 8, 8], [8, 8, 8]],
      });
      const holdingFix = buildPlateauConclusion(detectPlateau(holding), 'en', 'beginner');
      // What to do next time, in the reader's own numbers: this weight for
      // one rep more on every set, then the next step up. It opened on "Your
      // reps are holding at this weight", which the card above it had already
      // said (#bugs 2026-09-30, "Toistosi pitävät tällä painolla on aika
      // huono").
      assert.equal(holdingFix.body, 'Next time 82.5 kg × 9 on every set. Once that holds, move up to 85 kg.');
      setNumberLanguage('fi');
      try {
        assert.equal(
          buildPlateauConclusion(detectPlateau(holding), 'fi', 'beginner').body,
          'Ensi kerralla 82,5 kg × 9 joka sarjassa. Kun se menee, nosta 85 kg.',
        );
      } finally {
        setNumberLanguage('en');
      }
      assert.doesNotMatch(holdingFix.body, /holding at this weight/);
      // The weight to move up to is still the next step the progression gate
      // would take (beginner: +2.5 kg), never the weight the reader is stuck
      // at (#bugs 2026-09-29).
      assert.match(holdingFix.body, /move up to 85 kg\.$/);
    },
  },
  {
    name: 'proInsights: the moment sheet bars are the real top sets and the next step is one increment',
    run() {
      const lifts = history({ weights: [77.5, 80, 82.5, 82.5, 82.5, 82.5] });
      const lift = detectPlateau(lifts);
      const moment = buildPlateauMoment(lift, 'en', 'beginner');
      assert.deepEqual(moment.bars, [80, 82.5, 82.5, 82.5, 82.5]);
      // Beginner increment is 2.5 kg — the progression gate's own step, not a
      // forecast.
      assert.equal(moment.nextValue, 85);
      // Every level steps 2.5 kg now: 1.25 kg is 0.625 kg a side, which
      // standard plates cannot build (user decision 2026-09-28).
      assert.equal(nextStepKg(lift, 'intermediate'), 85);
    },
  },
  {
    name: 'proInsights: weekly read gives a green improving row and an amber stalled row with a locked conclusion',
    run() {
      const improving = history({ name: 'Barbell Bench Press', weights: [60, 62.5, 65, 67.5] });
      const stalled = history({ weights: [82.5, 82.5, 82.5, 82.5] });
      const rows = buildWeeklyRead([...stalled, ...improving], null, 'en');

      const amber = rows.find((row) => row.tone === 'amber');
      assert.ok(amber, 'stalled lift gets an amber row');
      assert.equal(amber.status, 'Stalled');
      assert.ok(amber.locked, 'the stalled conclusion is the paid part');

      const green = rows.find((row) => row.tone === 'green');
      assert.ok(green, 'improving lift gets a green row');
      assert.equal(green.locked, null, 'nothing to sell on a lift that is working');
      assert.ok(green.bars.every((bar) => bar >= 0.3 && bar <= 1));
    },
  },
  {
    name: 'proInsights: no recovery row without a confident fatigue model',
    run() {
      const lifts = history({ weights: [60, 62.5, 65, 67.5] });
      const unconfident = { confident: false, signal: 'high', recoveryScore: 10, sessionCount7d: 6 };
      const rows = buildWeeklyRead(lifts, unconfident, 'en');
      assert.equal(rows.find((row) => row.key === 'recovery'), undefined);

      const confident = { confident: true, signal: 'high', recoveryScore: 20, sessionCount7d: 6 };
      const withRecovery = buildWeeklyRead(lifts, confident, 'en');
      const recovery = withRecovery.find((row) => row.key === 'recovery');
      assert.ok(recovery);
      assert.equal(recovery.tone, 'red');
      assert.ok(recovery.locked);
    },
  },
  {
    name: 'proInsights: completion conclusion states the honest next step for a healthy lift',
    run() {
      const lifts = history({ weights: [60, 62.5, 65] });
      const lift = pickCompletionLift(lifts);
      assert.ok(lift);
      // The step is the progression gate's answer (lib/nextSessionAdvice).
      const conclusion = buildCompletionConclusion(lift, 'en', 'beginner', { kind: 'raise', fromKg: 65, toKg: 67.5 });
      assert.match(conclusion.body, /67\.5 kg/);
      assert.match(conclusion.body, /top of its rep range/);
    },
  },
  {
    name: 'proInsights: the stall threshold matches the coach context (3 sessions)',
    run() {
      assert.equal(PLATEAU_STALL_SESSIONS, 3);
      const lifts = history({ weights: [80, 82.5, 82.5, 82.5] });
      assert.ok(detectPlateau(lifts), 'three sessions at one top set already reads as stalled');
      const next = buildNextSessionMoment(lifts[0], 'en', null);
      assert.ok(next.bars.length > 0);
    },
  },

  {
    name: 'the month-out bar follows the cadence this lift is actually trained at',
    run() {
      // The fixture logs every 4 days, so four weeks is seven more sessions.
      const lifts = history({ weights: [80, 82.5, 85, 87.5] });
      const lift = lifts[0];
      assert.equal(liftCadenceDays(lift), 4);
      assert.equal(HORIZON_DAYS, 28);

      const next = nextStepKg(lift, null);
      const horizon = horizonStepKg(lift, null);
      assert.equal(horizon.sessions, 7);
      const step = next - lift.latest.topSetWeightKg;
      assert.ok(step > 0, 'a next step exists to project from');
      // The same per-session step the app applies, repeated — no other maths.
      assert.equal(horizon.kg, lift.latest.topSetWeightKg + step * 7);
      assert.ok(horizon.kg > next, 'a month out is always past next session');
    },
  },
  {
    name: 'one logged session projects at a weekly pace instead of dividing by zero',
    run() {
      const lift = history({ weights: [60] })[0];
      assert.equal(liftCadenceDays(lift), 7);
      assert.equal(horizonStepKg(lift, null).sessions, 4);
    },
  },
  {
    name: 'a long layoff cannot squash the projection below two sessions',
    run() {
      // Two sessions 60 days apart: the gap is clamped to a fortnight, so the
      // far bar stays two steps out instead of collapsing onto the next one.
      const sessions = [];
      const logs = [];
      [0, 1].forEach((index) => {
        const id = `g${index}`;
        sessions.push({
          id,
          workoutTemplateId: 'tpl',
          workoutNameSnapshot: 'Day 1: Push',
          performedAt: at(index === 0 ? 60 : 0),
          durationMinutes: 50,
          setsCompleted: 9,
        });
        logs.push({
          id: `${id}-log`,
          sessionId: id,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Barbell Back Squat',
          weight: 100 + index * 2.5,
          repsPerSet: [8, 8, 8],
          tracked: true,
          orderIndex: 0,
        });
      });
      const lift = buildLiftHistories(sessions, logs)[0];
      assert.equal(liftCadenceDays(lift), 14);
      assert.equal(horizonStepKg(lift, null).sessions, 2);
    },
  },
  {
    name: 'both pro moments hand the sheet a month-out bar',
    run() {
      const climbing = history({ weights: [80, 82.5, 85, 87.5] })[0];
      const nextMoment = buildNextSessionMoment(climbing, 'en', null, { kind: 'raise', fromKg: 87.5, toKg: 90 });
      assert.equal(nextMoment.horizonValue, horizonStepKg(climbing, null).kg);
      assert.equal(nextMoment.horizonSessions, 7);
      assert.ok(nextMoment.horizonValue > nextMoment.nextValue);

      const stalled = history({ weights: [80, 82.5, 82.5, 82.5] })[0];
      const plateauMoment = buildPlateauMoment(stalled, 'en', null);
      assert.equal(plateauMoment.horizonValue, horizonStepKg(stalled, null).kg);
      assert.ok(plateauMoment.horizonValue > plateauMoment.nextValue);
    },
  },
  {
    name: 'plateauEpisodeKey names the lift AND the weight it is stuck at',
    run() {
      const stalled = history({ weights: [80, 82.5, 82.5, 82.5] })[0];
      const key = plateauEpisodeKey(stalled);
      assert.equal(key, `${stalled.key}::82.5`);

      // The same lift stalled at a different weight is a different episode:
      // resolving one stall and re-stalling higher up must not stay hidden
      // behind an old dismissal (#bugs 2026-09-29).
      const stalledHigher = history({ weights: [82.5, 85, 85, 85] })[0];
      assert.notEqual(plateauEpisodeKey(stalledHigher), key);
    },
  },
  {
    name: 'detectPlateau skips a dismissed episode but never a different lift\'s',
    run() {
      const squat = history({ name: 'Barbell Back Squat', weights: [80, 82.5, 82.5, 82.5] });
      const bench = history({ name: 'Barbell Bench Press', weights: [55, 57.5, 57.5, 57.5] });
      const both = [...squat, ...bench];

      const undismissed = detectPlateau(both);
      assert.ok(undismissed, 'a plateau exists with nothing dismissed');

      const dismissed = new Set([plateauEpisodeKey(undismissed)]);
      const next = detectPlateau(both, dismissed);
      assert.ok(next, 'dismissing one episode still finds the other lift\'s plateau');
      assert.notEqual(next.key, undismissed.key, 'the dismissed lift itself must not come back');

      // Dismissing both leaves nothing to show.
      const bothDismissed = new Set([plateauEpisodeKey(squat[0]), plateauEpisodeKey(bench[0])]);
      assert.equal(detectPlateau(both, bothDismissed), null);
    },
  },
  {
    name: 'findPlateauDetection finds a specific lift by name for the in-workout reminder, ignoring any dismiss list',
    run() {
      const squat = history({ name: 'Barbell Back Squat', weights: [80, 82.5, 82.5, 82.5] });
      const bench = history({ name: 'Barbell Bench Press', weights: [55, 57.5, 60, 62.5] });
      const both = [...squat, ...bench];

      // Case-insensitive, trims whitespace like normalizedName does — the
      // guided player hands over the exercise name as it names the slot.
      const found = findPlateauDetection(both, '  barbell back squat  ', 'en');
      assert.ok(found, 'the stalled lift is found by name');
      assert.match(found.headline, /hasn't moved in 3 sessions/);

      // A lift that is improving is not a plateau — no reminder to show.
      assert.equal(findPlateauDetection(both, 'Barbell Bench Press', 'en'), null);

      // detectPlateau is the Home card's SINGLE best pick and honours a
      // dismiss list; findPlateauDetection is the in-workout reminder and
      // must keep answering for this lift even after Home's card is put
      // away — that is the whole point of the reminder as the alternative
      // to dismissing (user 2026-09-29).
      const homeDismissed = new Set([plateauEpisodeKey(squat[0])]);
      assert.equal(detectPlateau(squat, homeDismissed), null, 'Home stops showing the dismissed episode');
      assert.ok(
        findPlateauDetection(squat, 'Barbell Back Squat', 'en'),
        'but the in-workout reminder still finds it',
      );
    },
  },
  {
    // The progression gate holds a lift that loads a flagged area on purpose
    // (#244). Reporting that hold as a stall, then telling the reader to move
    // up, contradicts it (2026-10-02).
    name: 'a lift held for a flagged area is not a plateau: no card, reminder, completion lock or weekly stall row',
    run() {
      const knees = [{ area: 'knees', level: 'careful', refinements: [] }];
      const avoidKnees = [{ area: 'knees', level: 'avoid', refinements: [] }];
      const infoKnees = [{ area: 'knees', level: 'info', refinements: [] }];
      const shoulders = [{ area: 'shoulders', level: 'careful', refinements: [] }];
      const squat = history({ name: 'Barbell Back Squat', weights: [100, 100, 100, 100], reps: [[9, 9, 9], [9, 9, 9], [9, 9, 9], [9, 9, 9]] });

      // Unflagged: the plateau as before, and its card says to move up.
      assert.ok(detectPlateau(squat));
      assert.match(buildPlateauConclusion(squat[0], 'en', 'beginner').body, /102\.5 kg/);

      // Flagged (careful or avoid): nothing to report.
      assert.equal(detectPlateau(squat, undefined, knees), null);
      assert.equal(detectPlateau(squat, undefined, avoidKnees), null);
      // info promises nothing about training; another area does not touch it.
      assert.ok(detectPlateau(squat, undefined, infoKnees));
      assert.ok(detectPlateau(squat, undefined, shoulders));
      assert.ok(detectPlateau(squat, undefined, []));
      assert.ok(detectPlateau(squat, undefined, null));

      // The in-workout reminder is the same finding.
      assert.ok(findPlateauDetection(squat, 'Barbell Back Squat', 'en'));
      assert.equal(findPlateauDetection(squat, 'Barbell Back Squat', 'en', knees), null);

      // The completion lock never offers a next weight for a held lift; the
      // next lift in line is used instead.
      const bench = history({ name: 'Barbell Bench Press', weights: [60, 62.5, 65] });
      assert.equal(pickCompletionLift(squat, knees), null);
      assert.ok(pickCompletionLift(squat));
      assert.equal(pickCompletionLift([...squat, ...bench], knees).name, 'Barbell Bench Press');
      // The conclusion for a lift that did get picked is unchanged.
      assert.match(buildCompletionConclusion(squat[0], 'en', 'beginner').body, /move up to/);

      // The weekly read keeps the status honest and drops the stalled/fix row.
      const rows = (flags) => buildWeeklyRead([...squat, ...bench], null, 'en', 'beginner', flags);
      const stalledRow = rows(undefined).find((row) => row.key === squat[0].key);
      assert.equal(stalledRow.status, 'Stalled');
      assert.ok(stalledRow.locked);
      const heldRow = rows(knees).find((row) => row.key === squat[0].key);
      assert.notEqual(heldRow.status, 'Stalled');
      assert.equal(heldRow.locked, null);
      assert.equal(rows(knees).find((row) => row.tone === 'amber'), undefined);
    },
  },
  {
    name: 'a held lift that went down keeps its declining status but not the "move up" fix',
    run() {
      const knees = [{ area: 'knees', level: 'careful', refinements: [] }];
      const declining = history({ name: 'Barbell Back Squat', weights: [100, 95, 90] });
      const free = buildWeeklyRead(declining, null, 'en', 'beginner');
      const held = buildWeeklyRead(declining, null, 'en', 'beginner', knees);
      assert.equal(free[0].status, held[0].status);
      assert.ok(free[0].locked);
      assert.equal(held[0].locked, null);
    },
  },
];
