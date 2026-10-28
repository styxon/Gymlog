const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');

/**
 * These assert English copy, so they assert English number formatting with it.
 * removeTrailingZeros reads a module-level decimal mark (lib/format.ts) that
 * the app sets from preferences and that defaults to Finnish, so a suite that
 * wants points rather than commas has to say so — otherwise it passes or fails
 * on whichever suite ran before it.
 */
const { setNumberLanguage } = require('../../src/lib/format');
setNumberLanguage('en');

const {
  parseSchemeLabelSeconds,
  buildGuidedDrillsFromBlock,
  buildGuidedSteps,
  getGuidedPhaseRail,
  getGuidedPhaseSkipTargetIndex,
  findGuidedPhaseStart,
  getGuidedStepLabel,
  getGuidedNextPreview,
  getGuidedNextName,
  resolveGuidedSetTarget,
  getGuidedStepPlanKey,
  resolveGuidedResumeIndex,
  resolveGuidedOpening,
  getGuidedSkipTargetIndex,
  getGuidedBackTargetIndex,
  getGuidedSessionTitle,
  formatGuidedCountdown,
  formatGuidedTarget,
  findGuidedLibraryIndex,
  isGuidedExerciseOut,
  getGuidedStepAnchor,
  findGuidedStepIndexByAnchor,
  dialHoldIntervalMs,
  buildGuidedRunSheet,
  restRoundCorrections,
  loggedSetsOf,
  GUIDED_POSITION_SECONDS,
  guidedBlockLastSlotId,
} = require('../../src/lib/guidedPlayer');

const WARMUP = [
  { name: 'Rowing machine', seconds: 180 },
  { name: 'Band pull-aparts', seconds: 75 },
];
const COOLDOWN = [{ name: 'Chest doorway stretch', seconds: 90 }];
const EXERCISES = [
  { slotId: 'a', name: 'Bench Press', restSeconds: 120, setCount: 3, skipped: false },
  { slotId: 'b', name: 'Overhead Press', restSeconds: 90, setCount: 2, skipped: false },
];

function buildPlan() {
  return buildGuidedSteps({ warmup: WARMUP, exercises: EXERCISES, cooldown: COOLDOWN });
}

module.exports = [
  /**
   * "Treenin aikana ei ole mitään keinoa nähdä seuraavaa liikettä" (#bugs
   * 2026-08-27). The player is one step at a time by design and the rail under
   * it is dots; between them the session had no readable form.
   */
  {
    name: 'the run sheet lists the session once, in the order it will be done',
    run() {
      const plan = buildPlan();
      const sheet = buildGuidedRunSheet(plan, 0);
      assert.deepEqual(
        sheet.map((item) => item.name),
        ['Rowing machine', 'Band pull-aparts', 'Bench Press', 'Overhead Press', 'Chest doorway stretch'],
      );
      // A lift is measured in sets, a drill in seconds — so only lifts carry one.
      assert.deepEqual(
        sheet.map((item) => item.setCount),
        [null, null, 3, 2, null],
      );
      assert.deepEqual(
        sheet.map((item) => item.phase),
        ['warmup', 'warmup', 'work', 'work', 'cooldown'],
      );
      // A lift carries its slot, so the sheet can say what was logged in it.
      assert.deepEqual(
        sheet.map((item) => item.slotId),
        [null, null, 'a', 'b', null],
      );
    },
  },
  {
    /**
     * A superset rests once per round, and the rest step names the lift that
     * closed it. The corrections were gated on THAT lift having logged
     * something, so a round with only its first lift logged offered none
     * (review, 2026-09-16).
     */
    name: 'a rest offers a correction for every lift of the round that has a logged set',
    run() {
      const lift = (slotId, statuses) => ({ slotId, sets: statuses.map((status) => ({ status })) });
      const liftBySlot = new Map([
        ['a', lift('a', ['completed', 'completed', 'pending'])],
        ['b', lift('b', ['pending', 'pending'])],
        ['c', lift('c', ['completed', 'skipped', 'completed', 'pending'])],
      ]);

      // Only the first lift of the pair is logged: it still gets its way back.
      assert.deepEqual(
        restRoundCorrections([{ slotId: 'a', name: 'Bench' }, { slotId: 'b', name: 'Row' }], liftBySlot).map(
          ({ name, lift: { slotId }, setIndex }) => ({ name, slotId, setIndex }),
        ),
        [{ name: 'Bench', slotId: 'a', setIndex: 1 }],
      );
      // The last COMPLETED set, not the last touched one.
      assert.deepEqual(
        restRoundCorrections([{ slotId: 'c', name: 'Squat' }], liftBySlot).map((entry) => entry.setIndex),
        [2],
      );
      // Nothing logged, no slot, or a slot the session does not know: nothing.
      assert.deepEqual(restRoundCorrections([{ slotId: 'b', name: 'Row' }], liftBySlot), []);
      assert.deepEqual(restRoundCorrections([{ slotId: null, name: 'Drill' }, { name: 'Walk' }], liftBySlot), []);
      assert.deepEqual(restRoundCorrections([{ slotId: 'zz', name: 'Gone' }], liftBySlot), []);
      // Every logged lift of the round, in the round's order.
      assert.deepEqual(
        restRoundCorrections(
          [{ slotId: 'c', name: 'Squat' }, { slotId: 'b', name: 'Row' }, { slotId: 'a', name: 'Bench' }],
          liftBySlot,
        ).map((entry) => entry.name),
        ['Squat', 'Bench'],
      );
    },
  },
  {
    /**
     * The rest screen's correction sheet used to open on one set with no way
     * back to any other (#bugs 2026-09-29, "näkyis kaikki tehdyt sarjat").
     * This is the list it reads instead: every completed set, oldest first,
     * whatever position they sit at in the array.
     */
    name: 'logged sets of a lift are every completed set, oldest first, by their own setIndex',
    run() {
      const lift = {
        exerciseName: 'Back Squat',
        trackingMode: 'load_and_reps',
        sets: [
          { setIndex: 0, status: 'completed', actualReps: 8, actualLoadKg: 60 },
          { setIndex: 1, status: 'skipped' },
          { setIndex: 2, status: 'completed', actualReps: 6, actualLoadKg: 65 },
          { setIndex: 3, status: 'pending' },
        ],
      };
      assert.deepEqual(loggedSetsOf(lift), [
        { setIndex: 0, reps: 8, loadKg: 60, trackingMode: 'load_and_reps' },
        { setIndex: 2, reps: 6, loadKg: 65, trackingMode: 'load_and_reps' },
      ]);

      // Read by the field the reducer and findSetByIndex both key off —
      // never array position — so a list out of setIndex order still comes
      // back sorted, and a set logged with no weight (bodyweight) reads as
      // null rather than as a number.
      const outOfOrder = {
        exerciseName: 'Goblet Squat',
        trackingMode: 'bodyweight',
        sets: [
          { setIndex: 2, status: 'completed', actualReps: 10 },
          { setIndex: 0, status: 'completed', actualReps: 12 },
        ],
      };
      assert.deepEqual(loggedSetsOf(outOfOrder), [
        { setIndex: 0, reps: 12, loadKg: null, trackingMode: 'bodyweight' },
        { setIndex: 2, reps: 10, loadKg: null, trackingMode: 'bodyweight' },
      ]);

      // No lift, or nothing logged yet: no rows, not a throw.
      assert.deepEqual(loggedSetsOf(null), []);
      assert.deepEqual(
        loggedSetsOf({ exerciseName: 'Row', trackingMode: 'load_and_reps', sets: [{ setIndex: 0, status: 'pending' }] }),
        [],
      );
    },
  },
  {
    /**
     * A mid-exercise swap between a loaded lift and an unloaded/timed one
     * leaves sets on either side of the line logged as different lifts
     * (`loggedAs` stamps, liftSegments.ts `liftOfSet`). The correction
     * sheet used to read ONE mode — the currently selected row's — and
     * apply it to every row, so a 100 kg squat set was shown as bare reps
     * once a bodyweight row was selected (break round 2026-09-29). Each
     * row must answer for its own set, via the same `liftOfSet` the reducer
     * and the single-set editor both trust — not a mode borrowed from
     * whichever row happens to be selected.
     */
    name: 'logged sets of a lift after a swap: each row keeps the tracking mode it was logged under',
    run() {
      // Back Squat (loaded) for two sets, swapped to Plank Hold (timed,
      // unloaded) for the third — the shape liftOfSet reads: the swapped-to
      // lift is the exercise's CURRENT identity, and the pre-swap sets carry
      // their own `loggedAs` stamp.
      const exercise = {
        exerciseName: 'Plank Hold',
        trackingMode: 'hold',
        sourceExerciseName: 'Back Squat',
        swappedAfterSetIndex: 1,
        sets: [
          {
            setIndex: 0,
            status: 'completed',
            actualReps: 8,
            actualLoadKg: 100,
            loggedAs: { exerciseName: 'Back Squat', trackingMode: 'load_and_reps' },
          },
          {
            setIndex: 1,
            status: 'completed',
            actualReps: 5,
            actualLoadKg: 100,
            loggedAs: { exerciseName: 'Back Squat', trackingMode: 'load_and_reps' },
          },
          { setIndex: 2, status: 'completed', actualReps: 30 },
        ],
      };
      assert.deepEqual(loggedSetsOf(exercise), [
        { setIndex: 0, reps: 8, loadKg: 100, trackingMode: 'load_and_reps' },
        { setIndex: 1, reps: 5, loadKg: 100, trackingMode: 'load_and_reps' },
        { setIndex: 2, reps: 30, loadKg: null, trackingMode: 'hold' },
      ]);
    },
  },
  {
    name: 'where you are splits the sheet into done, current and upcoming',
    run() {
      const plan = buildPlan();
      // A set of the second lift: everything before it is behind you.
      const at = plan.steps.findIndex(
        (step) => step.type === 'set' && step.exerciseName === 'Overhead Press',
      );
      const sheet = buildGuidedRunSheet(plan, at);
      assert.deepEqual(
        sheet.map((item) => item.status),
        ['done', 'done', 'done', 'current', 'upcoming'],
      );
    },
  },
  {
    /**
     * Rests belong to the exercise they follow, so resting inside an exercise
     * must not read as having finished it.
     */
    name: 'a rest between sets still counts as being on that exercise',
    run() {
      const plan = buildPlan();
      const at = plan.steps.findIndex((step) => step.type === 'rest');
      const sheet = buildGuidedRunSheet(plan, at);
      const bench = sheet.find((item) => item.name === 'Bench Press');
      assert.equal(bench.status, 'current');
    },
  },
  {
    /**
     * The finish step belongs to no group. Reading it as "group 0" would mark
     * the whole session upcoming on the one screen where it is all behind you.
     */
    name: 'on the finish step every line reads as upcoming rather than as restarted',
    run() {
      const plan = buildPlan();
      const at = plan.steps.findIndex((step) => step.type === 'finish');
      const sheet = buildGuidedRunSheet(plan, at);
      assert.ok(sheet.every((item) => item.status === 'upcoming'));
      assert.equal(sheet.length, 5);
    },
  },
  {
    name: 'parseSchemeLabelSeconds handles min, timed sets, plain seconds and rep sets',
    run() {
      assert.equal(parseSchemeLabelSeconds('3 min'), 180);
      assert.equal(parseSchemeLabelSeconds('2 × 45s'), 90);
      assert.equal(parseSchemeLabelSeconds('2 x 30s'), 60);
      assert.equal(parseSchemeLabelSeconds('45s'), 45);
      // 2 × 8 reps → 48s of work → rounded up to 50.
      assert.equal(parseSchemeLabelSeconds('2 × 8'), 50);
      // Floor for tiny rep schemes.
      assert.equal(parseSchemeLabelSeconds('2 × 3'), 30);
      // Unparseable → 40s default, never zero.
      assert.equal(parseSchemeLabelSeconds('to failure'), 40);
    },
  },
  {
    name: 'buildGuidedDrillsFromBlock converts a home-hero block to timed drills',
    run() {
      const drills = buildGuidedDrillsFromBlock({
        minutes: 6,
        drills: [
          { name: 'Rowing machine', schemeLabel: '3 min' },
          { name: 'Hip openers', schemeLabel: '2 × 8' },
        ],
      });
      assert.deepEqual(drills, [
        { name: 'Rowing machine', seconds: 180 },
        { name: 'Hip openers', seconds: 50 },
      ]);
    },
  },
  {
    name: 'skipping a block leaves the block, not the session',
    run() {
      const { steps } = buildPlan();
      const phaseOf = (index) => ('phase' in steps[index] ? steps[index].phase : null);

      // From the warmup splash, past every drill in it, to the first thing that
      // is not warmup. Five drills used to be five taps to the bar.
      const warmupStart = steps.findIndex((step) => 'phase' in step && step.phase === 'warmup');
      const afterWarmup = getGuidedPhaseSkipTargetIndex(steps, warmupStart);
      assert.notEqual(phaseOf(afterWarmup), 'warmup');
      assert.equal(phaseOf(afterWarmup), 'work');

      // Mid-block does the same thing: the escape is from the block.
      const midWarmup = steps.findIndex((step) => step.type === 'drill' && step.phase === 'warmup');
      assert.equal(getGuidedPhaseSkipTargetIndex(steps, midWarmup), afterWarmup);

      // The cooldown lands on the finish card, which has no phase at all.
      const cooldownStart = steps.findIndex((step) => 'phase' in step && step.phase === 'cooldown');
      const afterCooldown = getGuidedPhaseSkipTargetIndex(steps, cooldownStart);
      assert.equal(steps[afterCooldown].type, 'finish');

      // The work block is the session. It does not answer to this.
      const work = steps.findIndex((step) => step.type === 'set');
      assert.equal(getGuidedPhaseSkipTargetIndex(steps, work), work);
      // Nor does anything off the end of the plan.
      assert.equal(getGuidedPhaseSkipTargetIndex(steps, steps.length - 1), steps.length - 1);
      assert.equal(getGuidedPhaseSkipTargetIndex(steps, 999), 999);
    },
  },
  {
    name: 'buildGuidedSteps produces splash/ready/drill/position/set/rest/finish in order',
    run() {
      const { steps, groups } = buildPlan();
      const kinds = steps.map((step) => step.type);
      assert.deepEqual(kinds, [
        'splash',
        'ready',
        'drill',
        'ready',
        'drill',
        'splash',
        'position',
        'set',
        'rest',
        'set',
        'rest',
        'set',
        'position',
        'set',
        'rest',
        'set',
        'splash',
        'ready',
        'drill',
        'finish',
      ]);
      // No rest after an exercise's LAST set — what follows is the next
      // exercise, and its own "get into position" step is the transition. A
      // rest ring there counted down to a screen that was going to change
      // anyway. Reported 2026-08-21.
      assert.equal(steps[11].type, 'set');
      assert.equal(steps[11].setIndex, 2);
      assert.equal(steps[12].type, 'position');
      // And none after the final set of the final exercise either.
      assert.equal(steps[15].type, 'set');
      assert.equal(steps[15].setIndex, 1);
      assert.equal(steps[16].type, 'splash');
      assert.equal(steps[16].doneLabel, 'Workout complete');
      // Groups: 2 warmup + 2 work (with set counts) + 1 cooldown.
      assert.equal(groups.length, 5);
      assert.deepEqual(groups[2], { phase: 'work', setCount: 3 });
      // Work splash reports totals.
      assert.equal(steps[5].sub, '2 exercises · 5 sets');
      assert.equal(steps[5].doneLabel, 'Warm-up complete');
    },
  },
  {
    name: 'buildGuidedSteps skips skipped exercises and empty blocks',
    run() {
      const { steps } = buildGuidedSteps({
        warmup: [],
        exercises: [
          { slotId: 'a', name: 'Bench Press', restSeconds: 120, setCount: 2, skipped: true },
          { slotId: 'b', name: 'Row', restSeconds: 90, setCount: 1, skipped: false },
        ],
        cooldown: [],
      });
      assert.deepEqual(
        steps.map((step) => step.type),
        ['splash', 'position', 'set', 'finish'],
      );
      // No warmup → the work splash has no "complete" chip.
      assert.equal(steps[0].doneLabel, null);
    },
  },
  {
    name: 'a skipped exercise keeps its place in the session numbering',
    run() {
      // Seen on a phone: skip two of six and the third read "EXERCISE 1 OF 4",
      // the last "1 OF 1". The plan is rebuilt after every skip and numbered
      // the survivors from one. Skipped lifts get no steps, but the count is
      // over the whole session and the position is the lift's real place.
      // (The top bar no longer prints it — #bugs 2026-09-30 — but the steps
      // still carry the lift's real place.)
      const { steps } = buildGuidedSteps({
        warmup: [],
        exercises: [
          { slotId: 'a', name: 'Squat', restSeconds: 120, setCount: 1, skipped: true },
          { slotId: 'b', name: 'Bench', restSeconds: 120, setCount: 1, skipped: true },
          { slotId: 'c', name: 'Row', restSeconds: 90, setCount: 1, skipped: false },
          { slotId: 'd', name: 'Curl', restSeconds: 60, setCount: 1, skipped: false },
        ],
        cooldown: [],
      });
      const setSteps = steps.filter((step) => step.type === 'set');
      assert.deepEqual(
        setSteps.map((step) => `${step.exerciseIndex + 1}/${step.exerciseCount}`),
        ['3/4', '4/4'],
      );
      // The work splash still counts what is left to do.
      assert.equal(steps[0].sub, '2 exercises · 2 sets');
      // And the last surviving set is still the last set of the session — no
      // rest step after it.
      assert.equal(steps[steps.length - 2].type, 'set');
      assert.equal(steps[steps.length - 1].type, 'finish');
    },
  },
  {
    name: 'an exercise leaves the plan when nothing is left and something was skipped',
    run() {
      // The plan and the save answer different questions with the same word.
      // A lift with one logged set and the rest skipped is completed for the
      // save (the set counts) and out of the plan (nothing left to do).
      const set = (status) => ({ status });
      assert.equal(isGuidedExerciseOut({ status: 'skipped', sets: [set('skipped'), set('skipped')] }), true);
      assert.equal(isGuidedExerciseOut({ status: 'completed', sets: [set('completed'), set('skipped')] }), true);
      // Cleanly finished: stays, so the walk back through it still works.
      assert.equal(isGuidedExerciseOut({ status: 'completed', sets: [set('completed'), set('completed')] }), false);
      // Still in progress: stays.
      assert.equal(isGuidedExerciseOut({ status: 'active', sets: [set('completed'), set('pending')] }), false);
      assert.equal(isGuidedExerciseOut({ status: 'active', sets: [set('skipped'), set('pending')] }), false);
    },
  },
  {
    name: 'step labels are localized, lift names included',
    run() {
      const { steps } = buildPlan();
      // No top-bar label any more: the phase word went and then the "1/6"
      // with it, leaving the clock alone (#bugs 2026-09-30).
      assert.equal(require('../../src/lib/guidedPlayer').getGuidedPhaseLabel, undefined);
      assert.equal(getGuidedStepLabel(steps[9]), 'Bench Press set 2');
      // Every label this module returns is localized, including the lift's
      // name. The resume chip used to offer "Front Squat sarja 3" for a screen
      // that then said "Etukyykky".
      assert.equal(getGuidedStepLabel(steps[9], 'fi'), 'Penkkipunnerrus sarja 2');
      assert.equal(getGuidedNextName(steps, 8, 'fi'), 'Penkkipunnerrus');
      assert.equal(
        getGuidedNextPreview(steps, 8, () => ({ reps: 8, loadKg: 60 }), 'fi').line,
        'Penkkipunnerrus · 8 × 60 kg',
      );
    },
  },
  {
    name: 'next preview skips ready/rest/position and resolves set targets',
    run() {
      const { steps } = buildPlan();
      const resolve = () => ({ reps: 8, loadKg: 60 });
      // From warmup splash → first drill.
      assert.deepEqual(getGuidedNextPreview(steps, 0, resolve), {
        title: 'Rowing machine',
        sub: '180s',
        line: 'Rowing machine · 180s',
      });
      // From last warmup drill → Workout splash.
      assert.equal(getGuidedNextPreview(steps, 4, resolve).line, 'Workout');
      // From a set's rest → next set with target.
      assert.equal(getGuidedNextPreview(steps, 8, resolve).line, 'Bench Press · 8 × 60 kg');
      assert.equal(getGuidedNextPreview(steps, 8, resolve).title, 'Bench Press — Set 2 of 3');
      // Bodyweight target renders without kg.
      assert.equal(
        getGuidedNextPreview(steps, 8, () => ({ reps: 12, loadKg: null })).line,
        'Bench Press · 12 reps',
      );
      // Final drill previews the finish.
      assert.equal(getGuidedNextPreview(steps, 18, resolve).line, 'Finish');
      assert.equal(getGuidedNextPreview(steps, 19, resolve), null);
    },
  },
  {
    name: 'next name reports the bare drill/exercise/block ahead (set screen v4)',
    run() {
      const { steps } = buildPlan();
      // Warmup splash → first drill; last warmup drill → the Workout block.
      assert.equal(getGuidedNextName(steps, 0), 'Rowing machine');
      assert.equal(getGuidedNextName(steps, 4), 'Workout');
      // From a set's rest → the next set's exercise, with no target appended.
      assert.equal(getGuidedNextName(steps, 8), 'Bench Press');
      // Nothing but the finish step remains.
      assert.equal(getGuidedNextName(steps, 18), null);
      assert.equal(getGuidedNextName(steps, 19), null);
    },
  },
  {
    name: 'resolveGuidedSetTarget: own prefill, then plan, then the previous set, while the previous set stayed on plan',
    run() {
      const sets = [
        {
          setIndex: 0,
          status: 'completed',
          plannedLoadKg: 60,
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          draftLoadText: '60',
          draftRepsText: '',
          actualLoadKg: 60,
          actualReps: 7,
        },
        {
          setIndex: 1,
          status: 'pending',
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          draftLoadText: '62,5',
          draftRepsText: '',
        },
        {
          setIndex: 2,
          status: 'pending',
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          draftLoadText: '',
          draftRepsText: '',
        },
      ];
      // Set 1 was lifted as planned, so set 2's own draft (comma decimal)
      // stands; reps follow the previous completed set.
      assert.deepEqual(resolveGuidedSetTarget(sets, 1, 'load_and_reps'), {
        reps: 7,
        loadKg: 62.5,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });
      // No draft, no plan: the previous set's actual load.
      assert.deepEqual(resolveGuidedSetTarget(sets, 2, 'load_and_reps'), {
        reps: 7,
        loadKg: 60,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });
      // First set, no history: planned max reps, null load.
      const fresh = [
        { setIndex: 0, status: 'pending', plannedRepsMin: 6, plannedRepsMax: 10, draftLoadText: '', draftRepsText: '' },
      ];
      assert.deepEqual(resolveGuidedSetTarget(fresh, 0, 'load_and_reps'), {
        reps: 10,
        loadKg: null,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });
      // Bodyweight never carries a load.
      assert.deepEqual(resolveGuidedSetTarget(sets, 1, 'bodyweight'), {
        reps: 7,
        loadKg: null,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });
      assert.equal(resolveGuidedSetTarget(sets, 9, 'load_and_reps'), null);
      assert.equal(formatGuidedTarget({ reps: 8, loadKg: 62.5 }), '8 × 62.5 kg');
      assert.equal(formatGuidedTarget({ reps: 12, loadKg: null }), '12 reps');
    },
  },
  {
    /**
     * #bugs 2026-09-09, from the gym: "Paino ei päivity", "Tavoite paino osio
     * ei muutu ainoastaan toisto". Every set had been prefilled from history,
     * the reader logged set 1 heavier, and set 2 still opened on the prefill:
     * reps followed the logged set, the weight did not. The rule that fixes
     * it has to leave a ramp alone — sets prefilled 60/70/80 from last time
     * are three different plans, and lifting the 60 is no reason to flatten
     * the 70.
     */
    name: 'a set logged off its plan carries its load to the next set; logged on plan, the next set keeps its own prefill',
    run() {
      const ramp = (firstSet = {}) => [
        {
          setIndex: 0,
          status: 'completed',
          plannedLoadKg: 60,
          plannedRepsMin: 8,
          plannedRepsMax: 10,
          draftLoadText: '60',
          draftRepsText: '',
          actualLoadKg: 60,
          actualReps: 10,
          ...firstSet,
        },
        {
          setIndex: 1,
          status: 'pending',
          plannedLoadKg: 70,
          autoProgressedFromKg: 67.5,
          prefilledFromPerformedAt: '2026-08-27T09:00:00.000Z',
          plannedRepsMin: 8,
          plannedRepsMax: 10,
          draftLoadText: '70',
          draftRepsText: '',
        },
        {
          setIndex: 2,
          status: 'pending',
          plannedLoadKg: 80,
          plannedRepsMin: 8,
          plannedRepsMax: 10,
          draftLoadText: '80',
          draftRepsText: '',
        },
      ];

      // On plan: the ramp stands, and the prefill's badges with it.
      const onPlan = resolveGuidedSetTarget(ramp(), 1, 'load_and_reps');
      assert.equal(onPlan.loadKg, 70);
      assert.equal(onPlan.autoProgressedFromKg, 67.5);
      assert.equal(onPlan.prefilledFromPerformedAt, '2026-08-27T09:00:00.000Z');

      // Off plan: the change follows, and no badge may claim a weight the
      // reader chose. The set's own record is not rewritten to get there.
      const offPlan = ramp({ actualLoadKg: 65 });
      const carried = resolveGuidedSetTarget(offPlan, 1, 'load_and_reps');
      assert.equal(carried.loadKg, 65);
      assert.equal(carried.autoProgressedFromKg, null);
      assert.equal(carried.prefilledFromPerformedAt, null);
      assert.equal(offPlan[1].draftLoadText, '70');
      assert.equal(offPlan[1].plannedLoadKg, 70);

      // The carry chains while the reader keeps departing from the plan...
      const chained = ramp({ actualLoadKg: 65 });
      chained[1] = { ...chained[1], status: 'completed', actualLoadKg: 65, actualReps: 10 };
      assert.equal(resolveGuidedSetTarget(chained, 2, 'load_and_reps').loadKg, 65);

      // ...and stops the moment they are back on it.
      const backOnPlan = ramp({ actualLoadKg: 65 });
      backOnPlan[1] = { ...backOnPlan[1], status: 'completed', actualLoadKg: 70, actualReps: 10 };
      assert.equal(resolveGuidedSetTarget(backOnPlan, 2, 'load_and_reps').loadKg, 80);

      // A slot with no plan at all: any logged load is the reader's call.
      const fresh = [
        {
          setIndex: 0,
          status: 'completed',
          plannedRepsMin: 8,
          plannedRepsMax: 10,
          draftLoadText: '',
          draftRepsText: '',
          actualLoadKg: 40,
          actualReps: 10,
        },
        { setIndex: 1, status: 'pending', plannedRepsMin: 8, plannedRepsMax: 10, draftLoadText: '', draftRepsText: '' },
      ];
      assert.equal(resolveGuidedSetTarget(fresh, 1, 'load_and_reps').loadKg, 40);

      // The swap fence still holds: a set logged as another lift carries nothing.
      assert.equal(resolveGuidedSetTarget(ramp({ actualLoadKg: 65 }), 1, 'load_and_reps', 0).loadKg, 70);
    },
  },
  {
    name: 'the step-plan key notices a swap, because the steps carry the name',
    run() {
      const before = getGuidedStepPlanKey(EXERCISES);

      // A swap changes nothing else: same slot, same set count, not skipped.
      // If this key does not move, the player never rebuilds its steps and the
      // swapped exercise stays on screen under its old name.
      const swapped = EXERCISES.map((exercise, index) =>
        index === 0 ? { ...exercise, name: 'Dumbbell Bench Press' } : exercise,
      );
      assert.notEqual(getGuidedStepPlanKey(swapped), before);

      // And the steps it guards really do bake the name in, which is why.
      const steps = buildGuidedSteps({ warmup: [], exercises: swapped, cooldown: [] }).steps;
      const firstSet = steps.find((step) => step.type === 'set');
      assert.equal(firstSet.exerciseName, 'Dumbbell Bench Press');

      // The things it already tracked still move it.
      assert.notEqual(getGuidedStepPlanKey(EXERCISES.map((e, i) => (i === 0 ? { ...e, setCount: 4 } : e))), before);
      assert.notEqual(getGuidedStepPlanKey(EXERCISES.map((e, i) => (i === 0 ? { ...e, skipped: true } : e))), before);
      // Rest length is not baked into a set step, so it is not identity.
      assert.equal(getGuidedStepPlanKey(EXERCISES.map((e) => ({ ...e, restSeconds: 999 }))), before);
    },
  },
  {
    name: 'carry-forward does not reach back over a mid-exercise swap',
    run() {
      // Two sets of leg press are in the book, then the rack frees up and you
      // swap to front squat for the rest. Set 3 must not open on the leg press
      // weight — which is exactly what the device did before this: 2.5 kg of
      // one lift shown as the target for another.
      const sets = [
        {
          setIndex: 0,
          status: 'completed',
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          draftLoadText: '150',
          draftRepsText: '',
          actualLoadKg: 150,
          actualReps: 10,
        },
        {
          setIndex: 1,
          status: 'completed',
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          draftLoadText: '150',
          draftRepsText: '',
          actualLoadKg: 150,
          actualReps: 10,
        },
        { setIndex: 2, status: 'pending', plannedRepsMin: 6, plannedRepsMax: 8, draftLoadText: '', draftRepsText: '' },
      ];

      // Without the boundary this is the old behaviour, kept for every set
      // that was NOT swapped across.
      assert.deepEqual(resolveGuidedSetTarget(sets, 2, 'load_and_reps'), {
        reps: 10,
        loadKg: 150,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });

      // Swapped after set 2 (index 1): neither the load nor the reps of the
      // old lift may cross the line. Reps fall back to the planned ceiling.
      assert.deepEqual(resolveGuidedSetTarget(sets, 2, 'load_and_reps', 1), {
        reps: 8,
        loadKg: null,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });

      // A set logged AFTER the swap carries forward normally again.
      const afterSwap = [
        ...sets.slice(0, 2),
        { ...sets[2], status: 'completed', actualLoadKg: 60, actualReps: 6 },
        { setIndex: 3, status: 'pending', plannedRepsMin: 6, plannedRepsMax: 8, draftLoadText: '', draftRepsText: '' },
      ];
      assert.equal(resolveGuidedSetTarget(afterSwap, 3, 'load_and_reps', 1).loadKg, 60);
      assert.equal(resolveGuidedSetTarget(afterSwap, 3, 'load_and_reps', 1).reps, 6);
    },
  },
  {
    name: 'a flagged-area hold is named only while the load is still the one the gate kept',
    run() {
      const held = (draftLoadText) => ({
        setIndex: 0,
        status: 'pending',
        plannedLoadKg: 80,
        heldForCautionArea: 'knees',
        plannedRepsMin: 5,
        plannedRepsMax: 8,
        draftLoadText,
        draftRepsText: '',
      });

      assert.equal(resolveGuidedSetTarget([held('80')], 0, 'load_and_reps').heldForCautionArea, 'knees');
      // Moved by the reader: their number, no claim from the app.
      assert.equal(resolveGuidedSetTarget([held('85')], 0, 'load_and_reps').heldForCautionArea, null);
      // Bodyweight: the reps were held, named until the day has its own set.
      assert.equal(resolveGuidedSetTarget([held('')], 0, 'bodyweight').heldForCautionArea, 'knees');
      const afterOne = [
        { ...held(''), status: 'completed', actualReps: 10 },
        { ...held(''), setIndex: 1 },
      ];
      assert.equal(resolveGuidedSetTarget(afterOne, 1, 'bodyweight').heldForCautionArea, null);
      // A timed hold's seconds are nobody's to hold.
      assert.equal(resolveGuidedSetTarget([held('')], 0, 'hold').heldForCautionArea, null);
    },
  },
  {
    name: 'an automated-progression load is flagged only while it is untouched',
    run() {
      const progressed = (draftLoadText) => ({
        setIndex: 0,
        status: 'pending',
        plannedLoadKg: 62.5,
        autoProgressedFromKg: 60,
        plannedRepsMin: 6,
        plannedRepsMax: 8,
        draftLoadText,
        draftRepsText: '',
      });

      // The prefill the gate wrote: badge-worthy, and it knows the step it took.
      assert.deepEqual(resolveGuidedSetTarget([progressed('62.5')], 0, 'load_and_reps'), {
        reps: 8,
        loadKg: 62.5,
        autoProgressedFromKg: 60,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });

      // Typed over in the list logger — this is the user's weight now, and
      // claiming the app chose it would be a lie about a Pro feature.
      assert.deepEqual(resolveGuidedSetTarget([progressed('65')], 0, 'load_and_reps'), {
        reps: 8,
        loadKg: 65,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        heldForFatigue: false,
        heldForCautionArea: null,
        autoProgressedFromReps: null,
      });

      // Bodyweight never carries a load, so it never carries the badge either.
      assert.equal(
        resolveGuidedSetTarget([progressed('62.5')], 0, 'bodyweight').autoProgressedFromKg,
        null,
      );

      // Automated progression off (or free): no origin recorded, no badge.
      const plain = {
        setIndex: 0,
        status: 'pending',
        plannedLoadKg: 60,
        plannedRepsMin: 6,
        plannedRepsMax: 8,
        draftLoadText: '60',
        draftRepsText: '',
      };
      assert.equal(resolveGuidedSetTarget([plain], 0, 'load_and_reps').autoProgressedFromKg, null);
    },
  },
  {
    name: 'a rep-progressed bodyweight target opens the dial on the raised number',
    run() {
      const suggested = (overrides = {}) => ({
        setIndex: 0,
        status: 'pending',
        plannedRepsMin: 12,
        plannedRepsMax: 12,
        plannedTargetReps: 13,
        autoProgressedFromReps: 12,
        draftLoadText: '',
        draftRepsText: '',
        ...overrides,
      });

      // The gate's target replaces the template fallback, and the badge knows
      // the floor it was raised from.
      assert.deepEqual(resolveGuidedSetTarget([suggested()], 0, 'bodyweight'), {
        reps: 13,
        loadKg: null,
        autoProgressedFromKg: null,
        prefilledFromPerformedAt: null,
        autoProgressedFromReps: 12,
        heldForFatigue: false,
        heldForCautionArea: null,
      });

      // A previous completed set wins, and takes the badge with it: the shown
      // number is the day's own, not the gate's.
      const sets = [
        { ...suggested(), status: 'completed', actualReps: 11 },
        suggested({ setIndex: 1 }),
      ];
      const second = resolveGuidedSetTarget(sets, 1, 'bodyweight');
      assert.equal(second.reps, 11);
      assert.equal(second.autoProgressedFromReps, null);

      // No suggestion recorded (free tier, progression off, not earned):
      // exactly the old behaviour, template ceiling and no badge.
      const plain = resolveGuidedSetTarget(
        [suggested({ plannedTargetReps: undefined, autoProgressedFromReps: undefined })],
        0,
        'bodyweight',
      );
      assert.equal(plain.reps, 12);
      assert.equal(plain.autoProgressedFromReps, null);

      // Loaded lifts never carry the rep badge — they have the load gate.
      assert.equal(
        resolveGuidedSetTarget([suggested({ plannedLoadKg: 60, draftLoadText: '60' })], 0, 'load_and_reps')
          .autoProgressedFromReps,
        null,
      );

      // A hold's numbers are seconds; the rep suggestion does not apply.
      const hold = resolveGuidedSetTarget([suggested()], 0, 'hold');
      assert.equal(hold.reps, 12);
      assert.equal(hold.timed, true);
      assert.equal(hold.autoProgressedFromReps, null);
    },
  },
  {
    name: 'resume: stored index rolls past sets completed in list view',
    run() {
      const { steps } = buildPlan();
      const completed = new Set(['a:0', 'a:1']);
      const isDone = (slotId, setIndex) => completed.has(`${slotId}:${setIndex}`);
      // Stored on set a:0 (index 7) → both a:0 and a:1 done → lands on a:2 (index 11).
      assert.equal(resolveGuidedResumeIndex(steps, 7, isDone), 11);
      // Stored mid-warmup stays put.
      assert.equal(resolveGuidedResumeIndex(steps, 3, isDone), 3);
      // Clamps overshoot.
      assert.equal(resolveGuidedResumeIndex(steps, 99, isDone), steps.length - 1);
    },
  },
  {
    /**
     * #bugs 2026-08-29: "menin vahingossa home, sitte jatka treeniä, ja en
     * tajunnut että minun piti sen jälkeen painaa ylhäältä jatka treeniä
     * mutta painoin alhaalla olevaa aloita treeni niin aloitin sitten uuden".
     *
     * Home's button said continue, the screen behind it opened on the
     * overview, and the biggest button there offered to start.
     */
    name: 'opening: asking to resume skips the overview, and the pinned button follows',
    run() {
      const { steps } = buildPlan();
      const aDone = (slotId) => slotId === 'a';
      const fresh = () => false;

      // Pressed "resume" with progress: straight onto the step, no overview.
      const resumed = resolveGuidedOpening({
        steps,
        storedIndex: null,
        isSetCompleted: aDone,
        autoResume: true,
      });
      assert.equal(resumed.mode, 'player');
      assert.equal(resumed.stepIndex, 12);
      assert.equal(resumed.resumeIndex, 12);
      assert.equal(resumed.primaryAction, 'resume');

      // Opened the session any other way: the overview, with its pinned
      // button pointing at the resume rather than at step 0.
      const browsed = resolveGuidedOpening({
        steps,
        storedIndex: null,
        isSetCompleted: aDone,
        autoResume: false,
      });
      assert.equal(browsed.mode, 'entry');
      assert.equal(browsed.stepIndex, 0);
      assert.equal(browsed.resumeIndex, 12);
      assert.equal(browsed.primaryAction, 'resume');

      // Nothing logged yet: there is nothing to continue, so "start" is the
      // honest label and the overview is the right screen — even when the
      // caller asked to resume.
      const untouched = resolveGuidedOpening({
        steps,
        storedIndex: null,
        isSetCompleted: fresh,
        autoResume: true,
      });
      assert.equal(untouched.mode, 'entry');
      assert.equal(untouched.stepIndex, 0);
      assert.equal(untouched.primaryAction, 'start');
    },
  },
  {
    name: 'opening: a finished session is not something to resume into',
    run() {
      const { steps } = buildPlan();
      const allDone = () => true;
      // Everything logged lands on the cooldown splash, which is a real step —
      // still a resume. The finish screen is not.
      const cooldown = resolveGuidedOpening({
        steps,
        storedIndex: null,
        isSetCompleted: allDone,
        autoResume: true,
      });
      assert.equal(cooldown.resumeIndex, 16);
      assert.equal(cooldown.primaryAction, 'resume');

      const atFinish = resolveGuidedOpening({
        steps,
        storedIndex: steps.length - 1,
        isSetCompleted: allDone,
        autoResume: true,
      });
      assert.equal(steps[steps.length - 1].type, 'finish');
      assert.equal(atFinish.primaryAction, 'start');
      assert.equal(atFinish.mode, 'entry');
      assert.equal(atFinish.stepIndex, 0);
    },
  },
  {
    name: 'resume without a stored index derives position from logged sets',
    run() {
      const { steps } = buildPlan();
      const none = () => false;
      assert.equal(resolveGuidedResumeIndex(steps, null, none), 0);
      // First incomplete is b:0 → land on exercise b's position step. One
      // lower than it used to be: the rest that stood after exercise a's
      // last set is gone.
      const aDone = (slotId) => slotId === 'a';
      assert.equal(resolveGuidedResumeIndex(steps, null, aDone), 12);
      assert.equal(steps[12].type, 'position');
      // Everything logged → cooldown splash.
      const allDone = () => true;
      assert.equal(resolveGuidedResumeIndex(steps, null, allDone), 16);
      assert.equal(steps[16].type, 'splash');
      assert.equal(findGuidedPhaseStart(steps, 'cooldown'), 16);
    },
  },
  {
    name: 'resume: the anchor finds the same step after the plan changes shape',
    run() {
      // Seen on a phone: a session left on Takakyykky set 2, then Takakyykky
      // skipped and the app relaunched. The plan was rebuilt without it, the
      // stored index now pointed inside the next lift, and the entry screen
      // offered "Jatka treeniä · Penkkipunnerrus sarja 2" for a session that
      // had never touched the bench. The anchor names the step, not its seat.
      const before = buildPlan().steps;
      const bSet1 = before.findIndex((s) => s.type === 'set' && s.slotId === 'b' && s.setIndex === 1);
      const anchor = getGuidedStepAnchor(before[bSet1]);
      assert.deepEqual(anchor, { type: 'set', phase: 'work', slotId: 'b', setIndex: 1 });

      // Now lift a is skipped: the plan is shorter and every later index shifts.
      const after = buildGuidedSteps({
        warmup: WARMUP,
        exercises: [{ ...EXERCISES[0], skipped: true }, EXERCISES[1]],
        cooldown: COOLDOWN,
      }).steps;
      const none = () => false;
      const resumed = resolveGuidedResumeIndex(after, bSet1, none, anchor);
      assert.equal(after[resumed].type, 'set');
      assert.equal(after[resumed].slotId, 'b');
      assert.equal(after[resumed].setIndex, 1);
      // The bare index would have landed somewhere else entirely.
      assert.notEqual(resumed, bSet1);

      // Anchored to a step that left the plan → neither the anchor nor the
      // stale index is trusted; land from the sets like a fresh resume.
      const aSet2 = before.findIndex((s) => s.type === 'set' && s.slotId === 'a' && s.setIndex === 2);
      const goneAnchor = getGuidedStepAnchor(before[aSet2]);
      assert.equal(findGuidedStepIndexByAnchor(after, goneAnchor), null);
      assert.equal(resolveGuidedResumeIndex(after, aSet2, none, goneAnchor), 0);
      // With b:0 done it lands on b's next set instead.
      const bDone0 = (slotId, setIndex) => slotId === 'b' && setIndex === 0;
      const landed = resolveGuidedResumeIndex(after, aSet2, bDone0, goneAnchor);
      assert.equal(after[landed].type, 'set');
      assert.equal(after[landed].setIndex, 1);

      // Drills anchor by name, and survive an exercise leaving too.
      const drill = before.findIndex((s) => s.type === 'drill');
      const drillAnchor = getGuidedStepAnchor(before[drill]);
      assert.equal(after[findGuidedStepIndexByAnchor(after, drillAnchor)].drillName, before[drill].drillName);

      // No anchor at all (a session persisted before this existed): the index
      // still works as before.
      assert.equal(resolveGuidedResumeIndex(before, 3, none, null), 3);
    },
  },
  {
    name: 'a held dial button speeds up but never stops slowing enough to land on a number',
    run() {
      // Slow at first, so a short hold can stop on the number wanted; fast
      // later, because 100 kg from zero is forty ticks and forty ticks at the
      // opening pace is a long hold. Monotone: it never speeds up and then
      // slows down again mid-hold, which would feel like a stutter.
      const schedule = Array.from({ length: 40 }, (_, tick) => dialHoldIntervalMs(tick));
      for (let index = 1; index < schedule.length; index += 1) {
        assert.ok(schedule[index] <= schedule[index - 1], `interval rose at tick ${index}`);
      }
      assert.ok(schedule[0] >= 120, 'the first repeats are too fast to stop on a number');
      assert.ok(schedule[schedule.length - 1] <= 60, 'a long hold never gets quick');
      // Zero to 100 kg in 2.5 kg steps, held: under 4 seconds all told.
      const totalMs = schedule.reduce((sum, ms) => sum + ms, 0);
      assert.ok(totalMs < 4000, `forty ticks take ${totalMs} ms`);
    },
  },
  {
    name: 'skip jumps over the rest after a set; back skips rest/ready backwards',
    run() {
      const { steps } = buildPlan();
      // Skipping set a:0 (index 7) jumps over its rest to set a:1 (index 9).
      assert.equal(getGuidedSkipTargetIndex(steps, 7), 9);
      // Skipping a drill just advances one.
      assert.equal(getGuidedSkipTargetIndex(steps, 2), 3);
      // Back from set a:1 (index 9) skips the rest to set a:0 (index 7).
      assert.equal(getGuidedBackTargetIndex(steps, 9), 7);
      // Back from first drill (index 2) skips ready → warmup splash.
      assert.equal(getGuidedBackTargetIndex(steps, 2), 0);
      assert.equal(getGuidedBackTargetIndex(steps, 0), 0);
    },
  },
  {
    name: 'session title',
    run() {
      // The duration estimate moved to lib/sessionDuration, which Home and the
      // player share — see sessionDuration.test.cjs.
      assert.equal(getGuidedSessionTitle('STRONG Elite - Day 1: Upper (Heavy)'), 'Upper (Heavy)');
      assert.equal(getGuidedSessionTitle('Push Day A'), 'Push Day A');
      assert.equal(getGuidedSessionTitle(''), 'Workout');
      // The walk-up step keeps a nominal length for the duration estimate
      // even though it no longer counts down (2026-09-04).
      assert.equal(GUIDED_POSITION_SECONDS, 15);
    },
  },
  {
    name: 'countdown formatting matches the mock (plain under 60s, m:ss above)',
    run() {
      assert.equal(formatGuidedCountdown(45.2), '46');
      assert.equal(formatGuidedCountdown(90), '1:30');
      assert.equal(formatGuidedCountdown(0), '0');
      assert.equal(formatGuidedCountdown(-2), '0');
    },
  },
  {
    name: 'library matching: exact, alias, containment — no wild guesses',
    run() {
      const names = [
        'Barbell Bench Press - Medium Grip',
        'Standing Military Press',
        'Side Lateral Raise',
        'Front Barbell Squat',
        'Pushups',
      ];
      assert.equal(findGuidedLibraryIndex('Standing Military Press', names), 1);
      assert.equal(findGuidedLibraryIndex('Bench Press', names), 0);
      assert.equal(findGuidedLibraryIndex('Overhead Press', names), 1);
      assert.equal(findGuidedLibraryIndex('Lateral Raise', names), 2);
      assert.equal(findGuidedLibraryIndex('Front Squat', names), 3);
      assert.equal(findGuidedLibraryIndex('Push-ups', names), 4);
      assert.equal(findGuidedLibraryIndex('Cable Woodchopper', names), null);
      // The initials moved to lib/exerciseInitials (tests/lib/exerciseInitials.test.cjs).
    },
  },
  {
    name: 'skipping an exercise lands on the next one, never back at the warm-up',
    run() {
      // The guided player used to ask resolveGuidedResumeIndex where to go
      // after a skip, and that resolver answers 0 when no set has been
      // completed yet. So skipping the very first exercise before logging
      // anything — the rack is taken, you move on — threw the user back to the
      // start of the warm-up. This pins the arithmetic the screen now uses.
      const before = buildGuidedSteps({ warmup: WARMUP, exercises: EXERCISES, cooldown: COOLDOWN }).steps;
      const blockStart = before.findIndex(
        (step) => (step.type === 'position' || step.type === 'set') && step.slotId === 'a',
      );
      assert.ok(blockStart > 0, 'the first exercise should start after the warm-up');

      const after = buildGuidedSteps({
        warmup: WARMUP,
        exercises: [
          { ...EXERCISES[0], skipped: true },
          EXERCISES[1],
        ],
        cooldown: COOLDOWN,
      }).steps;

      // Everything that followed the skipped block slides down into the index
      // that block started at, so that index IS the next exercise.
      const landing = after[Math.min(blockStart, after.length - 1)];
      assert.ok(landing, 'the landing index must exist in the rebuilt plan');
      assert.ok(
        landing.type !== 'drill' && landing.type !== 'ready',
        `skipping landed back in the warm-up (${landing.type})`,
      );
      assert.equal(
        landing.type === 'position' || landing.type === 'set' ? landing.slotId : 'b',
        'b',
        'skipping the first exercise should land on the second',
      );

      // And the resolver alone would have sent us to 0 — the bug this replaces.
      assert.equal(resolveGuidedResumeIndex(after, null, () => false), 0);
    },
  },

  {
    name: 'the progress rail shows the phase you are in, not the whole session',
    run() {
      // Three warmup drills, five exercises, two stretches: ten groups that
      // used to be drawn as one ten-segment bar mixing two kinds of thing.
      const groups = [
        { phase: 'warmup' },
        { phase: 'warmup' },
        { phase: 'warmup' },
        { phase: 'work', setCount: 4 },
        { phase: 'work', setCount: 3 },
        { phase: 'work', setCount: 3 },
        { phase: 'work', setCount: 3 },
        { phase: 'work', setCount: 2 },
        { phase: 'cooldown' },
        { phase: 'cooldown' },
      ];

      const warmup = getGuidedPhaseRail(groups, 1);
      assert.equal(warmup.groups.length, 3);
      assert.equal(warmup.current, 1);

      // The second exercise is 2 of 5, not 5 of 10.
      const work = getGuidedPhaseRail(groups, 4);
      assert.equal(work.groups.length, 5);
      assert.equal(work.current, 1);
      assert.equal(work.groups[0].setCount, 4);

      const cooldown = getGuidedPhaseRail(groups, 9);
      assert.equal(cooldown.groups.length, 2);
      assert.equal(cooldown.current, 1);

      // A session with no warmup still starts its work rail at zero.
      const workOnly = getGuidedPhaseRail([{ phase: 'work', setCount: 3 }, { phase: 'work', setCount: 3 }], 0);
      assert.equal(workOnly.groups.length, 2);
      assert.equal(workOnly.current, 0);

      // Out-of-range and empty inputs clamp rather than throw — the rail is
      // drawn on every step, including ones that have no group of their own.
      assert.deepEqual(getGuidedPhaseRail([], 3), { groups: [], current: 0 });
      const clamped = getGuidedPhaseRail(groups, 99);
      assert.equal(clamped.groups.length, 2);
      assert.equal(clamped.current, 1);
      const negative = getGuidedPhaseRail(groups, -1);
      assert.equal(negative.groups.length, 3);
      assert.equal(negative.current, 0);
    },
  },
  {
    /**
     * After a lift leaves a superset the player lands where its block began —
     * the other lift's round, already logged. Log there was refused, and the
     * set the reader really did was lost.
     */
    name: 'rollPastLoggedWork: lands past logged sets and the lead-ins to them',
    run() {
      const { rollPastLoggedWork } = require('../../src/lib/guidedPlayer');
      const done = new Set(['a:0', 'b:0', 'a:1']);
      const isDone = (slotId, setIndex) => done.has(`${slotId}:${setIndex}`);
      // Round 1 done, A's round-2 set done, then B skipped: the plan is A alone.
      const { steps } = buildGuidedSteps({
        warmup: [],
        exercises: [
          { slotId: 'a', name: 'Bench Press', restSeconds: 90, setCount: 3, skipped: false, supersetGroup: 'ss' },
          { slotId: 'b', name: 'Barbell Row', restSeconds: 90, setCount: 3, skipped: true, supersetGroup: 'ss' },
        ],
        cooldown: [],
      });
      const blockStart = steps.findIndex((step) => step.type === 'position' || step.type === 'set');
      const landed = rollPastLoggedWork(steps, blockStart, isDone);
      assert.equal(steps[landed].type, 'set');
      assert.equal(steps[landed].slotId, 'a');
      assert.equal(steps[landed].setIndex, 2);
      // Nothing logged: it stays put. Everything logged: it runs past every set.
      assert.equal(rollPastLoggedWork(steps, blockStart, () => false), blockStart);
      assert.notEqual(steps[rollPastLoggedWork(steps, blockStart, () => true)].type, 'set');
    },
  },
  {
    // "Lisää liike" on a superset's intro must follow the pair, not split it.
    name: 'guidedBlockLastSlotId: the last lift of the block, a superset included',
    run() {
      const { steps } = buildGuidedSteps({
        warmup: [],
        exercises: [
          { slotId: 'a', name: 'Bench Press', restSeconds: 90, setCount: 3, skipped: false, supersetGroup: 'ss' },
          { slotId: 'b', name: 'Barbell Row', restSeconds: 90, setCount: 3, skipped: false, supersetGroup: 'ss' },
          { slotId: 'c', name: 'Squat', restSeconds: 90, setCount: 3, skipped: false },
        ],
        cooldown: [],
      });
      const order = ['a', 'b', 'c'];
      const pairIntro = steps.find((step) => step.type === 'position' && step.slotId === 'a');
      assert.ok(pairIntro, 'the superset has an intro named for its first lift');
      assert.equal(guidedBlockLastSlotId(steps, pairIntro.groupIndex, order), 'b');
      const soloIntro = steps.find((step) => step.type === 'position' && step.slotId === 'c');
      assert.equal(guidedBlockLastSlotId(steps, soloIntro.groupIndex, order), 'c');
      assert.equal(guidedBlockLastSlotId(steps, 999, order), null);
    },
  },
  {
    // #bugs 2026-10-02: two adds from one walk-up intro both anchored on the
    // block's last lift, so the second landed before the first.
    name: 'resolveWalkAddAnchor: a later add goes after the last lift already added from the intro',
    run() {
      const { resolveWalkAddAnchor } = require('../../src/lib/guidedPlayer');
      const order = ['bench', 'curl', 'pushdown', 'row'];
      // First add: the block on screen.
      assert.equal(resolveWalkAddAnchor('bench', 'bench', undefined, order), 'bench');
      assert.equal(resolveWalkAddAnchor('bench', 'bench', { names: [], slotIds: [] }, order), 'bench');
      // Second add: behind the first added, whichever order they were recorded in.
      assert.equal(resolveWalkAddAnchor('bench', 'bench', { names: ['Curl'], slotIds: ['curl'] }, order), 'curl');
      assert.equal(
        resolveWalkAddAnchor('bench', 'bench', { names: ['Curl', 'Pushdown'], slotIds: ['curl', 'pushdown'] }, order),
        'pushdown',
      );
      // An added lift that has since left the plan no longer anchors anything.
      assert.equal(resolveWalkAddAnchor('bench', 'bench', { names: ['Gone'], slotIds: ['gone'] }, order), 'bench');
      // No block found: the intro's own slot, as before.
      assert.equal(resolveWalkAddAnchor(null, 'bench', undefined, order), 'bench');
    },
  },
  {
    name: 'recordWalkAddedSlot: the inserted slot is kept against its intro, in order, and feeds the next anchor',
    run() {
      const { recordWalkAddedSlot, resolveWalkAddAnchor } = require('../../src/lib/guidedPlayer');
      const order = ['bench', 'curl', 'pushdown', 'row'];
      const start = { bench: { names: ['Curl'], slotIds: [] } };
      const one = recordWalkAddedSlot(start, 'bench', 'curl');
      assert.deepEqual(one.bench, { names: ['Curl'], slotIds: ['curl'] });
      assert.deepEqual(start.bench.slotIds, [], 'the previous map is not mutated');
      // The names written by the add are kept, the slots follow in order.
      const two = recordWalkAddedSlot(one, 'bench', 'pushdown');
      assert.deepEqual(two.bench.slotIds, ['curl', 'pushdown']);
      assert.equal(resolveWalkAddAnchor('bench', 'bench', two.bench, order), 'pushdown');
      // The same slot is not recorded twice; another intro is its own entry.
      assert.equal(recordWalkAddedSlot(two, 'bench', 'pushdown'), two);
      assert.deepEqual(recordWalkAddedSlot({}, 'row', 'x').row, { names: [], slotIds: ['x'] });
    },
  },
  // ── Duplicate sweep 13 ───────────────────────────────────────────────────
  {
    name: 'dup13 D1-8: one set count for the live session — skipped lifts and skipped sets are out',
    run() {
      const { liveSetProgress } = require('../../src/lib/guidedPlayer');
      const sets = (...statuses) => statuses.map((status) => ({ status }));
      const exercises = [
        { status: 'completed', sets: sets('completed', 'completed', 'completed') },
        { status: 'skipped', sets: sets('skipped', 'skipped', 'skipped') },
        { status: 'completed', sets: sets('completed', 'skipped', 'skipped') },
        { status: 'pending', sets: [] },
      ];
      assert.deepEqual(liveSetProgress(exercises), { done: 4, total: 4 });
      assert.deepEqual(
        liveSetProgress([{ status: 'in_progress', sets: sets('completed', 'pending', 'pending') }]),
        { done: 1, total: 3 },
      );
      // The lock-screen card and the run sheet both read it.
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = readGuidedPlayerSource();
      assert.match(screen, /const \{ done, total \} = liveSetProgress\(session\.exercises\)/);
      assert.match(screen, /guided\.runSheet\.progress', \{ done: setProgress\.done, count: totalSets \}/);
      assert.match(screen, /const totalSets = setProgress\.total;/);
    },
  },
  {
    name: 'dup13 D3-3: the player titles a session the way Home and the day rows do, Finnish-saved names included',
    run() {
      assert.equal(getGuidedSessionTitle('Oma ohjelma - Päivä 1: Rinta', 'fi'), 'Rinta');
      assert.equal(getGuidedSessionTitle('Päivä 2: Selkä', 'en'), 'Selkä');
      assert.equal(getGuidedSessionTitle('Day 3:', 'fi'), 'Päivä 3');
      assert.equal(getGuidedSessionTitle('Day 3:', 'en'), 'Day 3');
      assert.equal(getGuidedSessionTitle('STRONG Elite - Day 1: Upper (Heavy)', 'fi'), 'Ylävartalo (raskas)');
      assert.equal(getGuidedSessionTitle('STRONG Elite - Day 1: Upper (Heavy)', 'en'), 'Upper (Heavy)');
      assert.equal(getGuidedSessionTitle('', 'fi'), getGuidedSessionTitle('   ', 'fi'));
    },
  },
];
