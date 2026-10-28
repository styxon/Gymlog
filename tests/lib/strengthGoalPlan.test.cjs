const assert = require('node:assert/strict');

const {
  estimateWeeksToTarget,
  orderTargetLifts,
  RATE_HORIZON_WEEKS,
  RATE_MAX_GAP_WEEKS,
  RATE_WINDOW_SESSIONS,
  resolveObservedRate,
  TARGET_DELTAS_KG,
} = require('../../src/lib/strengthGoalPlan');

/**
 * The target flow's arithmetic.
 *
 * Every number this produces is shown to the reader as a fact about their own
 * training, so the cases that matter most here are the ones with nothing to
 * divide: no log, a plateau, a target already passed. Each has to come back
 * named, because a screen that gets NaN or Infinity prints it.
 */

const WEEK = 7 * 86_400_000;
const at = (weeksAgo, kg) => ({ time: 1_000_000_000_000 - weeksAgo * WEEK, topSetWeightKg: kg });

module.exports = [
  {
    name: 'goal plan: the rate is the log, oldest in the window against newest',
    run() {
      // 80 → 90 over six weeks.
      const rate = resolveObservedRate([at(6, 80), at(4, 82.5), at(2, 87.5), at(0, 90)]);
      assert.ok(rate);
      assert.equal(rate.gainKg, 10);
      assert.equal(rate.spanWeeks, 6);
      assert.equal(rate.kgPerWeek, 10 / 6);
      assert.equal(rate.sessions, 4);
    },
  },
  {
    /**
     * A rate from last spring should not dilute this month's. Six is a COUNT,
     * and a count straddles a layoff: eight sessions last spring plus three
     * this month means the last six span a year, and the rate comes out at a
     * third of the reader's actual pace. The window ends at the break.
     */
    name: 'goal plan: a layoff ends the window, however few sessions it has',
    run() {
      const lastSpring = Array.from({ length: 8 }, (_, index) => at(60 - index, 40));
      const thisMonth = [at(4, 80), at(2, 85), at(0, 90)];
      const rate = resolveObservedRate([...lastSpring, ...thisMonth]);
      assert.ok(rate);

      // Three sessions, not six: the other three are on the far side of a
      // 49-week gap.
      assert.equal(rate.sessions, 3);
      assert.equal(rate.spanWeeks, 4);
      assert.equal(rate.kgPerWeek, 10 / 4);

      // Without a layoff the count still caps the window at six.
      const steady = Array.from({ length: 10 }, (_, index) => at(9 - index, 60 + index * 2));
      const capped = resolveObservedRate(steady);
      assert.equal(capped.sessions, RATE_WINDOW_SESSIONS);
      assert.equal(capped.spanWeeks, RATE_WINDOW_SESSIONS - 1);

      // A gap just inside the limit does not end the window.
      const nearMiss = resolveObservedRate([at(RATE_MAX_GAP_WEEKS, 100), at(0, 110)]);
      assert.equal(nearMiss.sessions, 2);
      // A gap just past it leaves nothing to measure.
      assert.equal(resolveObservedRate([at(RATE_MAX_GAP_WEEKS + 1, 100), at(0, 110)]), null);

      // Points out of order are sorted, not trusted.
      const shuffled = resolveObservedRate([at(0, 90), at(4, 80), at(2, 85)]);
      assert.equal(shuffled.gainKg, 10);
      assert.equal(shuffled.spanWeeks, 4);
    },
  },
  {
    /**
     * "No rate yet" and "no gain" are different things to tell someone. A
     * beginner with one logged session has not stalled.
     */
    name: 'goal plan: nothing to measure is null, not zero',
    run() {
      assert.equal(resolveObservedRate([]), null);
      assert.equal(resolveObservedRate([at(0, 100)]), null);
      // Two sessions on the same day: a span of zero, not a rate of infinity.
      assert.equal(resolveObservedRate([at(0, 90), at(0, 100)]), null);
      // Nor three days: 60 then 65 was "about 3 weeks" to +30, beside "5 kg in 0 weeks".
      assert.equal(resolveObservedRate([at(3 / 7, 60), at(0, 65)]), null);
      assert.ok(resolveObservedRate([at(1, 60), at(0, 65)]), 'a week is enough to measure');
      // Seven calendar days across the spring clock change are 167 hours: still a week.
      require('../helpers/clockChange.cjs').withHelsinkiClocks(() => {
        const spring = resolveObservedRate([
          { time: new Date(2026, 2, 25, 18, 0, 0).getTime(), topSetWeightKg: 60 },
          { time: new Date(2026, 3, 1, 18, 0, 0).getTime(), topSetWeightKg: 65 },
        ]);
        assert.ok(spring, 'a week that lost an hour measured no pace');
      });
      // Garbage in the log does not become a number.
      assert.equal(resolveObservedRate([{ time: NaN, topSetWeightKg: 80 }, at(0, 90)]), null);
      assert.equal(resolveObservedRate([at(2, 80), { time: 1, topSetWeightKg: NaN }]), null);
    },
  },
  {
    name: 'goal plan: a flat or falling log gives a rate of zero or less, not null',
    run() {
      const flat = resolveObservedRate([at(4, 100), at(2, 100), at(0, 100)]);
      assert.ok(flat);
      assert.equal(flat.kgPerWeek, 0);

      const falling = resolveObservedRate([at(4, 100), at(0, 90)]);
      assert.ok(falling);
      assert.ok(falling.kgPerWeek < 0);
    },
  },
  {
    /**
     * Every branch that cannot answer says which one it is. A screen that gets
     * Infinity prints it.
     */
    name: 'goal plan: the weeks estimate never returns a non-number',
    run() {
      const rate = resolveObservedRate([at(4, 80), at(0, 90)]); // 2.5 kg/wk
      assert.ok(rate);

      const ok = estimateWeeksToTarget(90, 100, rate);
      assert.equal(ok.kind, 'weeks');
      assert.equal(ok.weeks, 4);
      assert.equal(ok.rate, rate);

      // A plateau is not a division.
      const flat = resolveObservedRate([at(4, 100), at(0, 100)]);
      assert.equal(estimateWeeksToTarget(100, 120, flat).kind, 'noGain');
      const falling = resolveObservedRate([at(4, 100), at(0, 90)]);
      assert.equal(estimateWeeksToTarget(90, 120, falling).kind, 'noGain');

      assert.equal(estimateWeeksToTarget(90, 100, null).kind, 'noRate');

      // Already there, and the degenerate inputs that could reach this.
      assert.equal(estimateWeeksToTarget(100, 100, rate).kind, 'reached');
      assert.equal(estimateWeeksToTarget(120, 100, rate).kind, 'reached');
      assert.equal(estimateWeeksToTarget(NaN, 100, rate).kind, 'reached');
      assert.equal(estimateWeeksToTarget(90, NaN, rate).kind, 'reached');
    },
  },
  {
    /**
     * Two years extrapolated from six sessions is a number with no evidence in
     * it, and printing 137 weeks implies a precision the log cannot carry.
     */
    name: 'goal plan: an estimate past the horizon says so instead of printing digits',
    run() {
      // 0.1 kg/wk, in steps short enough that no gap ends the window: 40 kg
      // away is 400 weeks.
      const crawl = resolveObservedRate([at(8, 100), at(4, 100.4), at(0, 100.8)]);
      assert.ok(crawl);
      // Floats: 0.8 / 8 is 0.09999999999999964, and pinning it exactly would
      // be testing IEEE 754 rather than the window.
      assert.ok(Math.abs(crawl.kgPerWeek - 0.1) < 1e-9, `rate was ${crawl.kgPerWeek}`);
      const far = estimateWeeksToTarget(100.8, 140.8, crawl);
      assert.equal(far.kind, 'beyondHorizon');

      // And just inside it still gives weeks.
      const near = estimateWeeksToTarget(100.8, 110.8, crawl);
      assert.equal(near.kind, 'weeks');
      assert.ok(near.weeks <= RATE_HORIZON_WEEKS, `${near.weeks} weeks slipped past the horizon`);

      // Never zero: a target one gram away is still next week, not now.
      const fast = resolveObservedRate([at(1, 100), at(0, 120)]);
      assert.equal(estimateWeeksToTarget(120, 120.5, fast).weeks, 1);
    },
  },
  {
    /**
     * The stretch warning is gone, and so is the arithmetic behind it.
     *
     * It read "that is a 40% jump, reachable but it will need most of a year"
     * under a target of +5 kg on a 12,5 kg best (#bugs 2026-09-05). The
     * percentage was right and the sentence was nonsense: a share of a small
     * number says nothing about how long the number takes, and the wizard
     * already prints the honest answer directly above it — the weeks estimate
     * divided out of the reader's own log.
     *
     * Pinned as an absence because the module still exports the estimate this
     * was sitting next to, and the two are easy to confuse when reading it
     * back.
     */
    name: 'goal plan: nothing judges a target by what share of the best it adds',
    run() {
      const planModule = require('../../src/lib/strengthGoalPlan');
      assert.equal(planModule.describeStretch, undefined);
      assert.equal(planModule.STRETCH_RATIO, undefined);

      // Required here rather than at the top, the way io_kinds() below does.
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'StrengthGoalFlowScreen.tsx'),
        'utf8',
      );
      assert.doesNotMatch(screen, /describeStretch|goalFlow\.stretch/);
      // The estimate it stood beside stays: that one is division on the
      // reader's own sets rather than a percentage of one number.
      assert.match(screen, /goalFlow\.weeksAtRate/);
    },
  },
  {
    name: 'goal plan: lifts with a log come first, most recent of those first',
    run() {
      const row = (exerciseName, bestKg, lastLoggedAt) => ({
        exerciseName,
        bestKg,
        rate: null,
        lastLoggedAt,
      });
      const ordered = orderTargetLifts([
        row('Overhead Press', null, null),
        row('Barbell Squat', 140, 500),
        row('Barbell Deadlift', null, null),
        row('Barbell Bench Press - Medium Grip', 100, 900),
      ]);
      assert.deepEqual(ordered.map((entry) => entry.exerciseName), [
        'Barbell Bench Press - Medium Grip',
        'Barbell Squat',
        'Barbell Deadlift',
        'Overhead Press',
      ]);

      // Never-logged lifts hold a stable order rather than shuffling.
      const unlogged = orderTargetLifts([row('Zercher Squat', null, null), row('Ab Wheel', null, null)]);
      assert.deepEqual(unlogged.map((entry) => entry.exerciseName), ['Ab Wheel', 'Zercher Squat']);

      // The input is not mutated.
      const source = [row('B', 10, 1), row('A', null, null)];
      orderTargetLifts(source);
      assert.deepEqual(source.map((entry) => entry.exerciseName), ['B', 'A']);
    },
  },
  {
    name: 'goal plan: the offered deltas are four decisions, ascending',
    run() {
      assert.deepEqual([...TARGET_DELTAS_KG], [5, 10, 20, 30]);
      for (let index = 1; index < TARGET_DELTAS_KG.length; index += 1) {
        assert.ok(TARGET_DELTAS_KG[index] > TARGET_DELTAS_KG[index - 1]);
      }
      // Every one of them is a weight a gym has plates for.
      for (const delta of TARGET_DELTAS_KG) {
        assert.equal(delta % 5, 0, `${delta} kg is not a plate-friendly step`);
      }
    },
  },
  {
    /**
     * The real log, through the same builder the app uses. A rate helper that
     * only ever sees hand-made points is a helper that has never met a session
     * with two entries for the same lift on the same day.
     */
    name: 'goal plan: the arithmetic survives a real lift history',
    run() {
      const { buildLiftHistories } = require('../../src/lib/trainingHistory');

      const day = (index) => new Date(Date.UTC(2026, 0, 5 + index * 3)).toISOString();
      const sessions = Array.from({ length: 8 }, (_, index) => ({
        id: `s${index}`,
        performedAt: day(index),
        templateId: 'tpl',
        exercises: [],
      }));
      const logs = sessions.map((session, index) => ({
        id: `l${index}`,
        sessionId: session.id,
        exerciseNameSnapshot: 'Barbell Bench Press - Medium Grip',
        performedAt: session.performedAt,
        weight: 80 + index * 2.5,
        repsPerSet: [5, 5, 5],
      }));

      const histories = buildLiftHistories(sessions, logs);
      const bench = histories.find((entry) => /bench/i.test(entry.name));
      assert.ok(bench, 'the builder found no bench history');

      const rate = resolveObservedRate(bench.points);
      assert.ok(rate, 'a real eight-session history produced no rate');
      assert.ok(rate.kgPerWeek > 0);
      assert.equal(rate.sessions, RATE_WINDOW_SESSIONS);

      const estimate = estimateWeeksToTarget(bench.bestWeightKg, bench.bestWeightKg + 10, rate);
      assert.equal(estimate.kind, 'weeks');
      assert.ok(Number.isInteger(estimate.weeks) && estimate.weeks > 0);
    },
  },
  {
    /**
     * Every estimate the library can return renders a sentence, in both
     * languages.
     *
     * This exists because the same defect happened twice in a row, in opposite
     * directions. First `goalFlow.estimate.reached` was written and no branch
     * used it; then the 07 review read that as "a string no path can render"
     * and DELETED it — but the path is reachable, by typing a target under
     * your own best (isValidTarget takes any positive number to 1000, so a
     * best of 140 and a typed 100 lands there). `t()` answers a missing key
     * with undefined, and `<Text>{undefined}</Text>` is a blank line where the
     * sentence should be. No crash, nothing in the logs.
     *
     * So the rule is driven, not grepped: run the real function into every
     * kind it can produce, build the key the screen builds, and demand a
     * non-empty string back.
     *
     * Both languages are read, but only the ENGLISH side is really held here:
     * `t()` falls back to EN for a missing key, so dropping the Finnish one
     * survives this case. `FI: Record<I18nKey, string>` is what catches that,
     * at compile time — verified by deleting the Finnish key and watching
     * TS2741. Nothing to duplicate; noted so the next reader does not trust
     * this case for something it cannot see.
     */
    name: 'estimate: every kind the flow can reach renders a sentence',
    run() {
      const assert = require('node:assert/strict');
      const { t } = require('../../src/lib/i18n');
      const rate = { kgPerWeek: 1, gainKg: 6, spanWeeks: 6 };
      const flat = { kgPerWeek: 0, gainKg: 0, spanWeeks: 6 };
      const crawl = { kgPerWeek: 0.001, gainKg: 0.006, spanWeeks: 6 };

      // best, target, rate -> the kind each is meant to produce.
      const CASES = [
        ['reached', [140, 100, rate]],
        ['reached', [140, 140, rate]],
        ['noRate', [100, 140, null]],
        ['noGain', [100, 140, flat]],
        ['beyondHorizon', [100, 140, crawl]],
        ['weeks', [100, 140, rate]],
      ];

      const seen = new Set();
      for (const [expected, args] of CASES) {
        const estimate = estimateWeeksToTarget(...args);
        assert.equal(estimate.kind, expected, `${args.join('/')} produced ${estimate.kind}`);
        seen.add(estimate.kind);

        for (const language of ['en', 'fi']) {
          // The branch StrengthGoalFlowScreen takes for the card's title.
          const title =
            estimate.kind === 'weeks'
              ? t(language, 'goalFlow.weeksAtRate', { weeks: estimate.weeks })
              : t(language, `goalFlow.estimate.${estimate.kind}`);
          assert.equal(
            typeof title,
            'string',
            `${language}: ${estimate.kind} renders ${title} — the key is missing`,
          );
          assert.ok(title.trim().length > 0, `${language}: ${estimate.kind} renders blank`);
          assert.doesNotMatch(title, /\{\w+\}/, `${language}: ${estimate.kind} left a placeholder unfilled`);
        }
      }

      // And the list above must keep covering the union — a sixth kind added
      // to WeeksToTarget with no case here would otherwise pass unnoticed.
      const declared = io_kinds();
      assert.deepEqual(
        [...declared].sort(),
        [...seen].sort(),
        'estimateWeeksToTarget can return a kind this case never drives',
      );
    },
  },
  {
    /**
     * A target and a programme are two decisions. The flow made them one: the
     * only button changed the whole week, and a lift the catalog does not
     * train as a main lift could not be targeted at all - the note said so and
     * the button was disabled ("en aina halua etta se vaikuttaa koko
     * ohjelmaan, voisi olla myos vain normaali tavoite", user 2026-09-07).
     */
    name: 'goal flow: the target can be set without taking up a programme',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const flowSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'StrengthGoalFlowScreen.tsx'),
        'utf8',
      );
      const appSource = require('../helpers/appWiringSource.cjs').readAppWiring();
      const i18nSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'),
        'utf8',
      );

      // The screen offers the second way out, and it is never disabled.
      assert.match(flowSource, /templateId: string \| null/);
      assert.match(flowSource, /templateId: null \}\)/);
      assert.match(flowSource, /'goalFlow\.goalOnly'/);
      assert.doesNotMatch(flowSource, /disabled=\{!proposal\}/, 'the flow can dead-end again');

      // The programme half only runs when a programme was chosen. Without the
      // guard a null id would reach adoption and the target would be dropped.
      const at = appSource.indexOf('async function handleAcceptTargetProposal');
      assert.ok(at > 0, 'handleAcceptTargetProposal not found');
      const body = appSource.slice(at, at + 2200);
      assert.match(body, /if \(input\.templateId !== null\) \{/);
      assert.match(body, /handleAdoptReadyProgram\(input\.templateId, \{ lead: true \}\)/);
      // And the target is still written after the programme, never before.
      assert.ok(
        body.indexOf('handleAdoptReadyProgram') < body.indexOf('upsertStrengthGoal'),
        'the target is written before the programme it depends on',
      );

      for (const key of ['goalFlow.goalOnly', 'goalFlow.goalOnlyHint']) {
        assert.equal(i18nSource.split(`'${key}': '`).length - 1, 2, `${key} in EN and FI`);
      }
    },
  },
];

/** The kinds declared on WeeksToTarget, read from the source of truth. */
function io_kinds() {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'strengthGoalPlan.ts'),
    'utf8',
  );
  const union = source.slice(
    source.indexOf('export type WeeksToTarget'),
    source.indexOf('export function estimateWeeksToTarget'),
  );
  return new Set([...union.matchAll(/kind: '([a-zA-Z]+)'/g)].map((m) => m[1]));
}
