const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isValidTarget,
  normalizeStrengthGoals,
  removeStrengthGoal,
  resolveGoalProgress,
  upsertStrengthGoal,
} = require('../../src/lib/strengthGoals');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

const GOAL = { exerciseName: 'Bench Press', targetKg: 100, createdAt: '2026-01-01T00:00:00.000Z' };

module.exports = [
  {
    name: 'progress is measured from the logged best, never an estimate',
    run() {
      const [entry] = resolveGoalProgress([GOAL], new Map([['Bench Press', 82.5]]));
      assert.equal(entry.currentKg, 82.5);
      assert.equal(Math.round((entry.ratio ?? 0) * 100), 83);
      assert.equal(entry.reached, false);

      const [done] = resolveGoalProgress([GOAL], new Map([['Bench Press', 102.5]]));
      assert.equal(done.reached, true);
      // Clamped: a bar cannot draw past its box, and "110%" is not a state.
      assert.equal(done.ratio, 1);
    },
  },
  {
    name: 'a lift never logged is not started, which is not the same as zero',
    run() {
      // An empty bar reads as "you have made no progress". The truth is "you
      // have not begun", and the row says so instead of drawing nothing.
      const [never] = resolveGoalProgress([GOAL], new Map());
      assert.equal(never.currentKg, null);
      assert.equal(never.ratio, null);
      assert.equal(never.reached, false);

      // A stored zero is the same state, not a real measurement.
      const [zero] = resolveGoalProgress([GOAL], new Map([['Bench Press', 0]]));
      assert.equal(zero.ratio, null);
    },
  },
  {
    name: 'stored goals are normalised, not trusted',
    run() {
      // These live in AsyncStorage JSON, and a corrupt entry would otherwise
      // divide by zero or draw a bar past its container.
      const goals = normalizeStrengthGoals([
        GOAL,
        { exerciseName: 'Bench Press', targetKg: 200, createdAt: 'x' }, // duplicate lift
        { exerciseName: '  ', targetKg: 100 },
        { exerciseName: 'Squat', targetKg: 0 },
        { exerciseName: 'Deadlift', targetKg: -50 },
        { exerciseName: 'Row', targetKg: 99999 },
        'nonsense',
        null,
      ]);
      assert.deepEqual(goals.map((goal) => goal.exerciseName), ['Bench Press']);
      assert.equal(goals[0].targetKg, 100, 'the first entry wins a duplicate');
      assert.deepEqual(normalizeStrengthGoals(undefined), []);

      assert.equal(isValidTarget(100), true);
      assert.equal(isValidTarget(0), false);
      assert.equal(isValidTarget(Number.NaN), false);
      assert.equal(isValidTarget(1001), false);
    },
  },
  {
    name: 'one goal per lift, and removing one leaves the rest',
    run() {
      const squat = { exerciseName: 'Squat', targetKg: 140, createdAt: 'now' };
      let goals = upsertStrengthGoal([GOAL], squat);
      assert.equal(goals.length, 2);

      // Setting a new target for the same lift replaces rather than stacks.
      goals = upsertStrengthGoal(goals, { ...GOAL, targetKg: 110 });
      assert.equal(goals.length, 2);
      assert.equal(goals.find((goal) => goal.exerciseName === 'Bench Press')?.targetKg, 110);

      assert.deepEqual(removeStrengthGoal(goals, 'Squat').map((goal) => goal.exerciseName), ['Bench Press']);
      assert.equal(removeStrengthGoal(goals, 'Nothing').length, 2);
    },
  },
  {
    /**
     * The target flow's four quiet failures.
     *
     * None of these shows up as a crash or a red test — each one is a screen
     * that keeps working while doing the wrong thing, which is why they are
     * pinned rather than left to a reader noticing.
     */
    name: 'the target flow refuses, resets, asks once and says what is already set',
    run() {
      const flow = read('src', 'screens', 'StrengthGoalFlowScreen.tsx');

      // The same ceiling on both branches. It guarded only the typed number,
      // and a mistyped 999 kg best plus a delta cleared 1000 — a target the
      // flow accepted and normalizeStrengthGoals then dropped on next launch.
      assert.match(flow, /const targetUsable = isValidTarget\(targetKg\);/);
      assert.doesNotMatch(
        flow,
        /targetUsable = bestKg === null \? isValidTarget/,
        'the ceiling guards only the typed branch again',
      );

      // The proposal is built where it is shown. Unconditional, it ran the
      // 57-template ranker on every render of steps 1 and 2 — once per
      // character typed into the number field.
      assert.match(flow, /step === 3 && picked \? getProposal\(/);

      // A different lift starts its number over.
      assert.match(flow, /function pickLift\(exerciseName: string\) \{/);
      assert.match(flow, /onPress=\{\(\) => pickLift\(item\.exerciseName\)\}/);
      assert.doesNotMatch(flow, /onPress=\{\(\) => setPickedName\(/);

      // No setState while rendering. The old fallback called setStep(1) in the
      // render body and leaned on React's render-phase update to converge,
      // which is an infinite loop the day it stops.
      assert.doesNotMatch(flow, /^\s*setStep\(1\);$/m);
      assert.match(flow, /if \(step === 1 \|\| !picked\) \{/);

      // And a lift that already has a target says so, because setting a
      // second one replaces the first.
      assert.match(flow, /goalFlow\.alreadyAiming/);
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(app, /preferences\.strengthGoals\.find\(\(goal\) =>/);
    },
  },
  {
    name: 'the row is wired, and targets are ready-made rather than typed',
    run() {
      const screen = read('src', 'screens', 'ProgramsHomeScreen.tsx');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // The old sheet could only offer lifts already logged, so the reader a
      // first target would help most was shown an empty list. The page of
      // round numbers that replaced it had the opposite problem — 100 kg means
      // one thing to someone benching 95 and another to someone benching 60 —
      // and the flow that replaced THAT asks for a delta on the reader's own
      // best, over the eight lifts people actually put a number on.
      assert.doesNotMatch(app, /programsGoalCandidates/);
      assert.doesNotMatch(app, /buildGoalPresetRows\(/, 'the page of round numbers is back');
      assert.match(app, /const goalFlowLifts = useMemo/);
      assert.match(app, /rate: resolveObservedRate\(histories\.flatMap\(\(entry\) => entry\.points\)\)/);
      // The named eight, not the library: nobody puts a number on a cable
      // crossover, and step 3 has no programme to show for most of the 876.
      assert.match(app, /STRENGTH_GOAL_PRESETS\.map\(\(preset\) =>/);
      // Measured against the user's own log, through the same histories the
      // Pro insights read.
      assert.match(app, /proLiftHistories\.filter\(/);
      // Its own screen, reachable from the tab's target section.
      assert.match(app, /screen: 'goalFlow'/);
      assert.doesNotMatch(app, /screen: 'goalPicker'/);
      assert.match(screen, /onPress=\{onOpenGoalPicker\}/);

      // Accepting takes the programme on AND stores the target — in that
      // order. A target with no programme behind it is the thing feedback
      // round 2 asked to end, and storing first left exactly that behind when
      // the cap refused: three programmes on the free tier sends the reader to
      // the paywall, and the goal had already been written.
      assert.match(app, /async function handleAcceptTargetProposal/);
      // Sliced to the function's own closing brace: anchoring on whatever
      // declaration follows it broke the moment the block moved.
      const acceptStart = app.indexOf('async function handleAcceptTargetProposal');
      const accept = app.slice(acceptStart, app.indexOf('\n  }\n', acceptStart));
      const adoptAt = accept.indexOf('handleAdoptReadyProgram(input.templateId, { lead: true })');
      const storeAt = accept.indexOf('strengthGoals: upsertStrengthGoal(');
      assert.ok(adoptAt > 0 && storeAt > 0, 'the accept path lost one of its two halves');
      assert.ok(adoptAt < storeAt, 'the target is stored before the programme is taken on');
      assert.match(
        accept,
        /if \(!adopted\) \{\s+return;/,
        'a refused adoption still writes the goal',
      );
      // A failed write is said, and the success navigation stays behind it
      // (#bugs 2026-10-01): the navigate sits after the catch, which returns.
      const catchAt = accept.indexOf('} catch (error) {');
      assert.ok(catchAt > storeAt, 'the target write is outside the error handling');
      assert.match(accept.slice(catchAt), /showToast\(\s*t\(preferences\.appLanguage, adopted \? 'toast\.goalSaveFailedProgramOn' : 'toast\.goalSaveFailed'\)/);
      assert.ok(
        accept.indexOf('return;', catchAt) < accept.indexOf("navigate({ tab: 'workout', screen: 'programs_home' })"),
        'a failed save still arrives at the success page',
      );
      // And the adoption reports what happened rather than swallowing it.
      assert.match(app, /\): Promise<boolean> \{\s+const template = getWorkoutTemplateById/);

      // The bar renders the resolved ratio, and "not started" has its own copy.
      assert.match(screen, /entry\.currentKg === null/);
      assert.match(screen, /programs\.goals\.notStarted/);
      assert.match(screen, /Math\.round\(\(entry\.ratio \?\? 0\) \* 100\)/);

      // The target survives a restart: preferences, normalised on load.
      const database = read('src', 'storage', 'database.ts');
      assert.match(database, /strengthGoals: normalizeStrengthGoals\(input\?\.preferences\?\.strengthGoals\)/);
    },
  },
];
