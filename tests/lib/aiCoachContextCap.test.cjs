const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AI_COACH_MAX_PROMPT_CHARS, DEFAULT_BUDGET_LIMITS, checkBudget, createBudgetState } = require('../../src/lib/aiCoachBudget');
const { buildAiCoachContextText, buildAiCoachSystemContext } = require('../../src/lib/aiCoachSystemContext');
const {
  buildAiTrainingContext,
  fitAiCoachContextToCap,
  normalizeAiCoachTrainingContext,
} = require('../../src/lib/aiTrainingContext');
const { heavyCoachContext } = require('../helpers/coachContextFixture.cjs');

/**
 * A heavy reader was answered offline (server audit, 2026-09-21).
 *
 * The endpoint counted its own ~11 KB of rules against the 24 KB context cap,
 * leaving the reader's data about 12.6 KB — and the app's own caps allow more
 * than that: a full week of programme rows, eight weeks of sessions and lift
 * trajectories. The refusal came back as a 502 with the offline answer. The
 * rules are now charged, not counted against the cap, and the app sheds what
 * it must so that whatever it builds, the endpoint takes.
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/**
 * The text the endpoint sends and measures, after the repair it applies first.
 * Spelled out rather than borrowed from buildAiCoachContextText, so this suite
 * measures the same thing on a tree without it; the first case pins the two
 * together.
 */
const sent = (context) => `# Training context\n\n${buildAiCoachSystemContext(normalizeAiCoachTrainingContext(context))}`;

/** How long the endpoint's rules are, read from api/ai-coach.ts. */
function rulesLength(name) {
  const source = read('api', 'ai-coach.ts');
  const head = `const ${name} = [`;
  const start = source.indexOf(head);
  const end = source.indexOf("].join('\\n')", start);
  return Function(`return [${source.slice(start + head.length, end)}]`)().join('\n').length;
}

const NOW = 1_700_000_000_000;

module.exports = [
  {
    name: 'coach context: a reader at every one of the app\'s own limits is answered, and loses nothing to fit',
    run() {
      const context = heavyCoachContext();
      const text = sent(context);
      const rules = rulesLength('COACH_SYSTEM_RULES');
      assert.equal(buildAiCoachContextText(normalizeAiCoachTrainingContext(context)), text, 'the endpoint measures something else');

      // The old measurement refused this reader: context and rules together.
      assert.ok(text.length + rules > DEFAULT_BUDGET_LIMITS.maxContextChars, 'the fixture no longer shows the refusal it guards');

      // The endpoint's measurement now: the reader's context against the cap,
      // the rules charged. A full question and a full conversation ride too.
      const decision = checkBudget(
        { promptChars: AI_COACH_MAX_PROMPT_CHARS, historyChars: DEFAULT_BUDGET_LIMITS.maxHistoryChars, contextChars: text.length, fixedChars: rules },
        createBudgetState(NOW),
        NOW,
      );
      assert.equal(decision.allowed, true, `refused: ${JSON.stringify(decision.rejection)}`);

      // Under the cap, the app sends it exactly as built.
      assert.equal(fitAiCoachContextToCap(context), context);
    },
  },
  {
    name: 'coach context: whatever the reader named things, the app sends what the endpoint takes',
    run() {
      // Names and goals are the reader's own words, with no length; plateaus
      // have no cap in the builder.
      const context = heavyCoachContext({ nameLength: 120, goalLength: AI_COACH_MAX_PROMPT_CHARS, plateaus: 60 });
      assert.ok(sent(context).length > DEFAULT_BUDGET_LIMITS.maxContextChars);
      const fitted = fitAiCoachContextToCap(context);
      assert.ok(sent(fitted).length <= DEFAULT_BUDGET_LIMITS.maxContextChars, `still ${sent(fitted).length} characters`);
      // The least-needed parts went first: the lead goal is still there.
      assert.ok((fitted.goals ?? []).some((goal) => goal.isPrimary));
      // A trimmed history says so rather than reading as a shorter record.
      assert.equal(fitted.history.truncated, true);

      // Past every step, the last one still fits it.
      const absurd = heavyCoachContext({ nameLength: 4000, goalLength: 4000, plateaus: 200 });
      assert.ok(sent(fitAiCoachContextToCap(absurd)).length <= DEFAULT_BUDGET_LIMITS.maxContextChars);
    },
  },
  {
    name: 'coach context: the builder fits what it builds, and the chat fits what it sends',
    run() {
      // One goal per measured site, each stated in a long chat message.
      const kinds = ['bodyfat', 'shoulders', 'chest', 'back', 'arms', 'forearms', 'waist', 'hips', 'thighs', 'calves', 'neck'];
      const context = buildAiTrainingContext({
        unitPreference: 'kg',
        activeWorkoutSummary: null,
        homeSummary: { streak: { sessionsThisWeek: 0, sessionsLast30Days: 0, activity: { days: [] } } },
        workoutSessions: [],
        exerciseLogs: [],
        trackedProgress: [],
        readyProgramCount: 57,
        recommendedProgramId: null,
        recommendedProgramTitle: null,
        customProgramTitle: null,
        coachGoals: kinds.map((kind, index) => ({
          id: `goal-${index}`,
          text: `${kind} `.repeat(400).slice(0, AI_COACH_MAX_PROMPT_CHARS),
          kind,
          targetValue: 100,
          unit: 'cm',
          startValue: 90,
          createdAt: '2026-09-01T10:00:00.000Z',
        })),
        now: new Date('2026-09-21T10:00:00.000Z'),
      });
      assert.ok(sent(context).length <= DEFAULT_BUDGET_LIMITS.maxContextChars, 'the builder made a context the endpoint refuses');

      // The chat puts its pinned memory back into the context it was handed,
      // so it fits the result again.
      const chat = code(read('src', 'screens', 'AICoachChatScreen.tsx'));
      assert.match(chat, /fitAiCoachContextToCap\(\{ \.\.\.trainingContext, coachMemory: pinnedCoachMemory \}\)/);
    },
  },
  {
    name: 'coach context: the question box stops where the endpoint does',
    run() {
      // Both places a reader types a question for the coach.
      for (const screen of ['AICoachChatScreen.tsx', 'OnboardingScreen.tsx']) {
        const source = code(read('src', 'screens', screen));
        assert.match(source, /maxLength=\{AI_COACH_MAX_PROMPT_CHARS\}/, `${screen}: a question longer than the endpoint takes can be typed`);
      }
      assert.equal(DEFAULT_BUDGET_LIMITS.maxPromptChars, AI_COACH_MAX_PROMPT_CHARS);
      // And the conversation that rides with a question fits its own limit,
      // however long the endpoint lets each side be.
      const endpoint = read('api', 'ai-coach.ts');
      const turns = Number(endpoint.match(/const MAX_HISTORY_TURNS = (\d+);/)[1]);
      const perSide = Number(endpoint.match(/const MAX_HISTORY_CHARS = (\d+);/)[1]);
      assert.ok(turns * 2 * perSide <= DEFAULT_BUDGET_LIMITS.maxHistoryChars, 'a trimmed conversation can still be refused');
    },
  },
  {
    name: 'a history row without its shape is dropped, and the context is still written (break round 2026-09-28)',
    run() {
      const context = heavyCoachContext();
      const goodLift = context.history.lifts[0];
      const goodSession = context.history.sessions[0];
      const goodWeek = context.history.weeks[0];
      assert.ok(goodLift && goodSession && goodWeek, 'the fixture carries a row of each');
      const broken = {
        ...context,
        history: {
          ...context.history,
          lifts: [{ name: 'Bench Press', stalledSessions: 1 }, null, 'x', { ...goodLift, weightSeriesKg: [80, 'x'] }, goodLift],
          sessions: [{ name: 'Upper' }, goodSession],
          weeks: [{ weekStart: 1 }, goodWeek],
        },
      };
      const normalized = normalizeAiCoachTrainingContext(broken);
      assert.deepEqual(normalized.history.lifts, [goodLift]);
      assert.deepEqual(normalized.history.sessions, [goodSession]);
      assert.deepEqual(normalized.history.weeks, [goodWeek]);
      // What threw "Cannot read properties of undefined (reading 'map')".
      assert.doesNotThrow(() => buildAiCoachContextText(normalized, 'fi'));
      assert.ok(buildAiCoachContextText(normalized).includes(goodLift.name), 'the good row is still in the text');
      // A schedule without its day list is repaired, not thrown on.
      const scheduled = normalizeAiCoachTrainingContext({
        ...context,
        history: { ...context.history, schedule: { plannedPerWeek: 3, nextTrainingDate: 7 } },
      });
      assert.deepEqual(scheduled.history.schedule.trainingDays, []);
      assert.equal(scheduled.history.schedule.nextTrainingDate, null);
      assert.doesNotThrow(() => buildAiCoachContextText(scheduled, 'fi'));
      assert.equal(normalizeAiCoachTrainingContext({ history: { schedule: 'x' } }).history.schedule, null);
      // A thinner row from an older app is not a broken one: kept.
      const older = normalizeAiCoachTrainingContext({
        history: { sessionCount: 1, sessions: [{ sessionId: 's0', performedAt: '2026-09-01T09:00:00.000Z' }] },
      });
      assert.equal(older.history.sessions.length, 1);
      assert.doesNotThrow(() => buildAiCoachContextText(older, 'fi'));
      // A well-formed history comes through whole.
      assert.deepEqual(normalizeAiCoachTrainingContext(context).history.lifts, context.history.lifts);
    },
  },
  {
    name: 'an oversized posted history is capped like the device\'s own builder caps it',
    run() {
      // normalizeLastSession and normalizeCardio already bound what they
      // accept; normalizeHistory did not, so a posted context with far more
      // rows than the app itself ever sends rendered close to a megabyte and a
      // half before the size check ever saw it (server audit, 2026-09-29).
      const goodSession = { sessionId: 's0', performedAt: '2026-09-01T09:00:00.000Z', name: 'Upper' };
      const goodLift = { name: 'Bench Press', weightSeriesKg: [80, 82.5] };
      const goodWeek = { weekStart: '2026-07-06', sessions: 3, volumeKg: 12000, plannedSessions: 4 };
      const oversized = {
        history: {
          sessions: Array.from({ length: 20000 }, () => ({ ...goodSession })),
          lifts: Array.from({ length: 500 }, () => ({ ...goodLift })),
          repsLifts: Array.from({ length: 500 }, () => ({ name: 'Pull-up', reps: [8, 9, 10] })),
          weeks: Array.from({ length: 500 }, () => ({ ...goodWeek })),
        },
      };
      const normalized = normalizeAiCoachTrainingContext(oversized);
      assert.ok(normalized.history.sessions.length <= 24, `sessions not capped: ${normalized.history.sessions.length}`);
      assert.ok(normalized.history.lifts.length <= 24, `lifts not capped: ${normalized.history.lifts.length}`);
      assert.ok(normalized.history.repsLifts.length <= 24, `repsLifts not capped: ${normalized.history.repsLifts.length}`);
      assert.ok(normalized.history.weeks.length <= 12, `weeks not capped: ${normalized.history.weeks.length}`);
      // The rendered text this feeds the model stays small, which is the
      // actual point — the size check runs on this text, not on the arrays.
      assert.ok(buildAiCoachContextText(normalized, 'fi').length < 20000, 'an oversized posted history still rendered close to full size');
    },
  },
  {
    // The previous case capped how many lift rows a posted history carries;
    // it did not cap how long one row's own series is. A lift trained daily
    // for years, or a rep trajectory just as long, is still one row under
    // MAX_HISTORY_LIFTS, and one row still has to be cheap to render (recheck
    // round, 2026-09-29).
    name: 'a single history lift or reps-lift is capped on its own series, not only on row count',
    run() {
      const hugeWeightSeries = Array.from({ length: 6000 }, (_, index) => 80 + index * 0.1);
      const hugeRepList = Array.from({ length: 2000 }, (_, index) => 5 + (index % 10));
      const context = {
        history: {
          lifts: [{ name: 'Bench Press', weightSeriesKg: hugeWeightSeries }],
          repsLifts: [
            {
              name: 'Pull Up',
              spanDays: 40,
              unchangedSessions: 1,
              firstReps: hugeRepList,
              latestReps: hugeRepList,
              bestSetRepsSeries: hugeWeightSeries,
            },
          ],
        },
      };
      const normalized = normalizeAiCoachTrainingContext(context);
      assert.ok(normalized.history.lifts[0].weightSeriesKg.length <= 60, `weightSeriesKg not capped: ${normalized.history.lifts[0].weightSeriesKg.length}`);
      assert.ok(normalized.history.repsLifts[0].firstReps.length <= 20, `firstReps not capped: ${normalized.history.repsLifts[0].firstReps.length}`);
      assert.ok(normalized.history.repsLifts[0].latestReps.length <= 20, `latestReps not capped: ${normalized.history.repsLifts[0].latestReps.length}`);
      assert.ok(
        normalized.history.repsLifts[0].bestSetRepsSeries.length <= 60,
        `bestSetRepsSeries not capped: ${normalized.history.repsLifts[0].bestSetRepsSeries.length}`,
      );
      const text = buildAiCoachContextText(normalized, 'fi');
      assert.ok(
        text.length < DEFAULT_BUDGET_LIMITS.maxContextChars,
        `one lift's own series still rendered ${text.length} chars`,
      );

      // Mutation check (recheck round, 2026-09-29): reverting the
      // `.slice(-MAX_LIFT_SERIES_POINTS)` / `.slice(0, MAX_REPS_PER_SESSION)`
      // calls in aiTrainingContext.ts's normalizeHistory /
      // normalizeRepsLift makes this fail — the rendered text runs well past
      // the cap.
    },
  },
  {
    // Every array field a posted context carries besides the history block —
    // goals, plateaus, the three tracked-lift lists, rhythm, and a
    // programme's days and each day's exercises — went through the endpoint's
    // re-parse with no cap of its own; a posted context 100x any of the
    // app's own limits rendered in full before the size check ever ran on it
    // (recheck round, 2026-09-29).
    name: 'every other array in a posted context is capped, at a hundred times its real limit',
    run() {
      const many = (count, build) => Array.from({ length: count }, (unused, index) => build(index));
      const context = {
        goals: many(2000, (index) => ({
          text: `goal ${index}`,
          kind: `k${index}`,
          targetValue: 1,
          unit: 'kg',
          startValue: 1,
          currentValue: 1,
          setAt: '2026-01-01',
          isPrimary: index === 0,
        })),
        plateaus: many(2000, (index) => ({ exerciseKey: `p${index}`, name: `Lift ${index}`, stagnantSessions: 1, topWeightKg: 1 })),
        trackedLifts: many(300, (index) => ({ key: `t${index}`, name: `Lift ${index}`, latestWeight: 1, bestWeight: 1, latestReps: '8' })),
        latestTopSets: many(300, (index) => ({ exerciseName: `Lift ${index}`, weight: 1, reps: '8', performedAt: '2026-01-01T00:00:00.000Z' })),
        recentCompletedSessions: many(300, (index) => ({
          sessionId: `s${index}`,
          title: `Session ${index}`,
          performedAt: '2026-01-01T00:00:00.000Z',
          durationMinutes: 1,
          setsCompleted: 1,
          swappedExercises: 0,
          noteCount: 0,
        })),
        rhythm: many(1600, (index) => ({ dayStart: index, dayNumber: index, weekdayLabel: 'ma', active: true, isToday: false })),
        programme: {
          title: 'Everything',
          source: 'custom',
          daysPerWeek: 700,
          truncated: false,
          // A hundred times MAX_PROGRAMME_DAYS (7), each with a hundred times
          // MAX_PROGRAMME_EXERCISES (12) — checked as two separate dimensions
          // rather than multiplied together, which a real posted payload
          // could still do.
          days: many(700, (day) => ({
            name: `Day ${day}`,
            dayLabel: null,
            estimatedMinutes: 1,
            exercises: day === 0 ? many(1200, (exercise) => ({ name: `Exercise ${exercise}`, scheme: '3x5' })) : [{ name: 'Squat', scheme: '3x5' }],
          })),
        },
      };
      const normalized = normalizeAiCoachTrainingContext(context);
      assert.ok(normalized.goals.length <= 20, `goals not capped: ${normalized.goals.length}`);
      assert.ok(normalized.plateaus.length <= 20, `plateaus not capped: ${normalized.plateaus.length}`);
      assert.ok(normalized.trackedLifts.length <= 3, `trackedLifts not capped: ${normalized.trackedLifts.length}`);
      assert.ok(normalized.latestTopSets.length <= 3, `latestTopSets not capped: ${normalized.latestTopSets.length}`);
      assert.ok(
        normalized.recentCompletedSessions.length <= 3,
        `recentCompletedSessions not capped: ${normalized.recentCompletedSessions.length}`,
      );
      assert.ok(normalized.rhythm.length <= 16, `rhythm not capped: ${normalized.rhythm.length}`);
      assert.ok(normalized.programme.days.length <= 7, `programme days not capped: ${normalized.programme.days.length}`);
      assert.ok(
        normalized.programme.days.every((day) => day.exercises.length <= 12),
        'a single programme day\'s exercises not capped',
      );
      const text = buildAiCoachContextText(normalized, 'fi');
      assert.ok(
        text.length < DEFAULT_BUDGET_LIMITS.maxContextChars,
        `a hundredfold posted context still rendered ${text.length} chars`,
      );
    },
  },
  {
    // The same fields again, this time with the reader's own free text — a
    // goal, a name, a scheme, a planner note — a hundred times the longest
    // the app would ever knowingly send, rather than a hundred times as many
    // rows. "A single 1 MB goal string is the same attack" as an oversized
    // array (recheck round, 2026-09-29).
    name: 'reader-authored strings in a posted context are capped, at a hundred times a real one\'s length',
    run() {
      const hugeName = 'n'.repeat(12000); // 100x MAX_NAME_CHARS (120)
      const hugeGoalText = 'g'.repeat(200000); // 100x the endpoint's own longest prompt (2000)
      const hugeShort = 's'.repeat(8000); // 100x MAX_SHORT_TEXT_CHARS (80)
      const context = {
        activeSession: { title: hugeName, nextExercise: hugeName, meta: hugeShort },
        goals: [{ text: hugeGoalText, kind: hugeShort, targetValue: 1, unit: hugeShort, startValue: 1, currentValue: 1, setAt: hugeShort, isPrimary: true }],
        plateaus: [{ exerciseKey: hugeShort, name: hugeName, stagnantSessions: 1, topWeightKg: 1 }],
        trackedLifts: [{ key: hugeShort, name: hugeName, latestWeight: 1, bestWeight: 1, latestReps: hugeShort }],
        recentCompletedSessions: [
          { sessionId: 's1', title: hugeName, performedAt: '2026-01-01T00:00:00.000Z', durationMinutes: 1, setsCompleted: 1, swappedExercises: 0, noteCount: 0 },
        ],
        programme: {
          title: hugeName,
          source: 'custom',
          daysPerWeek: 1,
          truncated: false,
          days: [{ name: hugeName, dayLabel: hugeShort, estimatedMinutes: 1, exercises: [{ name: hugeName, scheme: hugeShort }] }],
        },
        plannerSetup: {
          goal: hugeShort,
          daysPerWeek: 1,
          experience: hugeShort,
          sessionMinutes: 1,
          equipment: hugeShort,
          recovery: hugeShort,
          mustInclude: [hugeShort],
          avoid: [hugeShort],
          limitations: [hugeShort],
        },
        homeState: { pinnedStatCardKeys: [hugeShort], weighInReminderEnabled: true, silencedSuggestions: [hugeShort] },
        history: {
          lifts: [{ name: hugeName, weightSeriesKg: [80] }],
          repsLifts: [{ name: hugeName, spanDays: 1, unchangedSessions: 1, firstReps: [5], latestReps: [5], bestSetRepsSeries: [5] }],
        },
      };
      const normalized = normalizeAiCoachTrainingContext(context);
      const text = buildAiCoachContextText(normalized, 'fi');
      assert.ok(
        text.length < DEFAULT_BUDGET_LIMITS.maxContextChars,
        `a hundredfold reader string still rendered ${text.length} chars`,
      );
    },
  },
  {
    // The other side of the same fix: a context built entirely at the app's
    // own limits — heavyCoachContext, plus the fields it leaves empty by
    // default — must reach the model exactly as built. A normaliser that
    // caps a hostile payload but also clips an honest one has traded one bug
    // for another (recheck round, 2026-09-29).
    name: 'a normal device-built context is unchanged by the endpoint\'s re-parse',
    run() {
      const context = {
        ...heavyCoachContext(),
        recentCompletedSessions: [
          {
            sessionId: 's1',
            title: 'Push Day',
            performedAt: '2026-09-20T09:00:00.000Z',
            day: '2026-09-20',
            durationMinutes: 52,
            setsCompleted: 15,
            swappedExercises: 1,
            noteCount: 2,
          },
        ],
        latestTopSets: [{ exerciseName: 'Bench Press', weight: 102.5, reps: '8,7,6', performedAt: '2026-09-20T09:00:00.000Z' }],
        rhythm: Array.from({ length: 16 }, (unused, index) => ({
          dayStart: index,
          dayNumber: index + 1,
          weekdayLabel: 'ma',
          active: index % 2 === 0,
          isToday: index === 15,
        })),
      };
      // As it would actually arrive at the endpoint: through JSON, not the
      // in-memory object the test built.
      const posted = JSON.parse(JSON.stringify(context));
      const normalized = normalizeAiCoachTrainingContext(posted);
      assert.deepEqual(normalized.recentCompletedSessions, context.recentCompletedSessions);
      assert.deepEqual(normalized.latestTopSets, context.latestTopSets);
      assert.deepEqual(normalized.rhythm, context.rhythm);
      assert.deepEqual(normalized.trackedLifts, context.trackedLifts);
      assert.deepEqual(normalized.plateaus, context.plateaus);
      assert.deepEqual(normalized.goals, context.goals);
      assert.deepEqual(normalized.programme, context.programme);
      assert.deepEqual(normalized.homeState, context.homeState);
      assert.deepEqual(normalized.plannerSetup, context.plannerSetup);
      assert.deepEqual(normalized.body, context.body);
      assert.deepEqual(normalized.profile, context.profile);
      assert.deepEqual(normalized.history.lifts, context.history.lifts);
      assert.deepEqual(normalized.history.sessions, context.history.sessions);
    },
  },
  {
    // `isHistoryLift` only requires `name` and `weightSeriesKg` to be
    // well-shaped; every other field a lift row carries — `latestReps`,
    // `stalledSessions`, `spanDays` among them — passed through the old
    // `{ ...lift, name, weightSeriesKg }` spread untouched. Three of those
    // are spliced straight into a trajectory line in aiCoachSystemContext.ts
    // with no guard of their own (recheck round, 2026-09-29).
    name: 'a single history lift\'s scalar fields are sanitised, not only its weight series',
    run() {
      const hugeReps = 'R'.repeat(5_000_000);
      const hugeStalled = 'S'.repeat(5_000_000);
      const hugeSpan = 'D'.repeat(5_000_000);
      const context = {
        history: {
          lifts: [
            {
              name: 'Bench Press',
              weightSeriesKg: [80],
              latestReps: hugeReps,
              stalledSessions: hugeStalled,
              spanDays: hugeSpan,
            },
          ],
        },
      };
      const normalized = normalizeAiCoachTrainingContext(context);
      const lift = normalized.history.lifts[0];
      assert.equal(typeof lift.latestReps, 'number', `latestReps not sanitised: ${typeof lift.latestReps}`);
      assert.equal(typeof lift.stalledSessions, 'number', `stalledSessions not sanitised: ${typeof lift.stalledSessions}`);
      assert.equal(typeof lift.spanDays, 'number', `spanDays not sanitised: ${typeof lift.spanDays}`);
      const text = buildAiCoachContextText(normalized, 'fi');
      assert.ok(text.length < DEFAULT_BUDGET_LIMITS.maxContextChars, `an oversized lift scalar still rendered ${text.length} chars`);

      // Mutation check (recheck round, 2026-09-29): reverting normalizeHistory's
      // `lifts.map(normalizeHistoryLiftRow)` back to
      // `{ ...lift, name: clipText(...), weightSeriesKg: ... }` makes this fail —
      // latestReps/stalledSessions/spanDays come back as multi-megabyte strings
      // and the rendered trajectory line runs well past the context cap.
    },
  },
  {
    // The sibling of `recentCompletedSessions`, which this file already caps
    // and clips (`normalizeRecentSession`, `clipText` on `title`):
    // `isHistorySession` only required `performedAt` to be a string, so a
    // session's `name` (rendered through `singleLine`, which has no length
    // cap) and the numeric fields spliced straight into the same line
    // (`durationMinutes`, `setCount`, `exerciseCount`) reached the renderer
    // as whatever the client posted (recheck round, 2026-09-29).
    name: 'a single history session\'s name and counts are sanitised, not only how many rows there are',
    run() {
      const hugeName = 'N'.repeat(2_000_000);
      const hugeCount = 'S'.repeat(2_000_000);
      const context = {
        history: {
          sessions: [
            { performedAt: '2026-01-01T00:00:00.000Z', name: hugeName, setCount: hugeCount, exerciseCount: 1 },
          ],
        },
      };
      const normalized = normalizeAiCoachTrainingContext(context);
      const session = normalized.history.sessions[0];
      assert.ok(session.name.length <= 120, `session name not capped: ${session.name.length}`);
      assert.equal(typeof session.setCount, 'number', `setCount not sanitised: ${typeof session.setCount}`);
      const text = buildAiCoachContextText(normalized, 'fi');
      assert.ok(text.length < DEFAULT_BUDGET_LIMITS.maxContextChars, `an oversized session field still rendered ${text.length} chars`);

      // Mutation check (recheck round, 2026-09-29): reverting normalizeHistory's
      // `sessions` step back to
      // `list(input.sessions, empty.sessions).filter(isHistorySession).slice(-MAX_HISTORY_SESSIONS)`
      // with no per-row normalizer makes this fail — the session name and
      // setCount come back as multi-megabyte strings.
    },
  },
  {
    // `boundedList` sliced a posted array from the head before this fix. For
    // most fields that is fine — the device sorts its own lists so the head
    // is what matters — but goals are appended in the order the reader states
    // them, oldest first, and the surrounding comment already says the newest
    // one (last in that order) should lead. Slicing the head over the cap kept
    // the oldest goals and crowned an old one primary instead (recheck round,
    // 2026-09-29).
    name: 'the newest goal survives an oversized goal list, and stays primary',
    run() {
      const goals = Array.from({ length: 25 }, (unused, index) => ({
        text: `goal ${index}`,
        kind: `k${index}`,
        targetValue: 1,
        unit: 'kg',
        startValue: 1,
        currentValue: 1,
        setAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
        // No isPrimary posted, the way an app that predates the flag would send.
      }));
      const normalized = normalizeAiCoachTrainingContext({ goals });
      assert.equal(normalized.goals.length, 20, `goals not capped: ${normalized.goals.length}`);
      const last = normalized.goals[normalized.goals.length - 1];
      assert.equal(last.text, 'goal 24', 'the true newest goal was dropped in favour of an older one');
      assert.ok(last.isPrimary, 'the newest goal did not lead');

      // Mutation check (recheck round, 2026-09-29): reverting the `goals`
      // call back to `boundedList(candidate.goals, normalizeGoal, MAX_GOALS)`
      // (dropping the trailing `true`) makes this fail — goal 19 leads
      // instead of goal 24.
    },
  },
];
