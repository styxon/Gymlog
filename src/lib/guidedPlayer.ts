/**
 * Guided Player step machine (design_handoff_guided_player).
 *
 * A session runs as a flat ordered list of steps:
 * splash → (ready → drill)* → splash → (position → (set → rest)*)* → splash →
 * (ready → drill)* → finish. Rests are generated after every set except the
 * last set of the last exercise. Pure functions only — the screen owns timers
 * and dispatches; this module owns the step list and its derived labels.
 */

import { exerciseNameLabel } from './exerciseNameLabel';
import { parseNumberInput, removeTrailingZeros } from './format';
// Type-only on purpose: homeSessionHero reaches the catalog pools, which reach
// back here for the library matcher. Keeping this erased at build time means
// that loop stays a type relationship and never becomes a module cycle.
import type { SessionRoutineBlock } from './homeSessionHero';
import { t } from './i18n';
import { IntervalRecoveryKind, IntervalScheme, parseIntervalScheme } from './intervalScheme';
import { liftOfSet } from './liftSegments';
import { buildSupersetRuns, normalizeSupersetGroups, supersetRoundOrder } from './supersetGrouping';
import type {
  GuidedResumeAnchor,
  WorkoutLiftIdentity,
  WorkoutSetStatus,
  WorkoutTrackingMode,
} from '../features/workout/workoutTypes';
import { AppLanguage, SetupCautionArea } from '../types/models';

export type GuidedPhase = 'warmup' | 'work' | 'cooldown';

export const GUIDED_READY_SECONDS = 3;
/**
 * The walk-up step's nominal length.
 *
 * It stopped being a countdown on 2026-09-04 — walking to another machine is
 * not time-bound, so that screen has no clock. The number stays because the
 * step still carries a duration for the session-length estimate: a session
 * with five exercises really does spend about a minute of itself walking
 * between them, and dropping it to zero would make the app promise a workout
 * shorter than any workout is.
 */
export const GUIDED_POSITION_SECONDS = 15;

export interface GuidedDrill {
  name: string;
  seconds: number;
}

export interface GuidedExerciseInput {
  slotId: string;
  name: string;
  restSeconds: number;
  setCount: number;
  skipped: boolean;
  /**
   * The superset this lift is part of. Adjacent lifts sharing one id are
   * performed as one block — see src/lib/supersetGrouping.ts — and the step
   * list below is where that becomes an order of play rather than a label.
   */
  supersetGroup?: string | null;
}

export type GuidedStep =
  | { type: 'splash'; phase: GuidedPhase; title: string; sub: string; doneLabel: string | null }
  | { type: 'ready'; phase: GuidedPhase; drillName: string; seconds: number; groupIndex: number }
  | {
      type: 'drill';
      phase: GuidedPhase;
      drillName: string;
      seconds: number;
      groupIndex: number;
      drillIndex: number;
      drillCount: number;
    }
  | {
      type: 'position';
      phase: 'work';
      slotId: string;
      exerciseName: string;
      seconds: number;
      groupIndex: number;
      exerciseIndex: number;
      exerciseCount: number;
    }
  | {
      type: 'set';
      phase: 'work';
      slotId: string;
      exerciseName: string;
      setIndex: number;
      setCount: number;
      groupIndex: number;
      exerciseIndex: number;
      exerciseCount: number;
      /**
       * Present when the exercise names an interval scheme. The set is then a
       * timed work bout rather than a number to dial in: the screen counts it
       * down, logs it and runs on into the recovery without a tap, because
       * nobody taps a phone mid-sprint.
       */
      interval?: IntervalScheme;
      /**
       * Which round of the superset this set belongs to, and how many there
       * are. Present only inside a superset, so it doubles as the answer to
       * "is this one" — which is what tells the reader why no rest ring came
       * up after the set they just logged.
       */
      supersetRound?: { round: number; rounds: number };
    }
  | {
      type: 'rest';
      phase: 'work';
      slotId: string;
      exerciseName: string;
      setIndex: number;
      seconds: number;
      groupIndex: number;
      /** The recovery half of an interval — a walk, not a rest. */
      recoveryKind?: IntervalRecoveryKind;
    }
  | { type: 'finish' };

export interface GuidedGroup {
  phase: GuidedPhase;
  /**
   * Sets for a lift; ROUNDS for a superset, which is the unit a superset is
   * counted in — three rounds of A1 + A2 is three, not six. The rail draws one
   * dot per entry here, and a rail that counted six would be counting halves
   * of a thing nobody calls a set.
   */
  setCount?: number;
  /** How many lifts share this block. 1 for an ordinary exercise. */
  supersetSize?: number;
}

export interface GuidedStepPlan {
  steps: GuidedStep[];
  groups: GuidedGroup[];
}

/**
 * "3 min" → 180, "2 × 45s" → 90, "45s" → 45, "2 × 8" (reps) → paced estimate.
 * Accepts both '×' and 'x'. Unparseable labels get a 40s default so a drill
 * never renders with a zero timer.
 */
export function parseSchemeLabelSeconds(schemeLabel: string): number {
  const label = schemeLabel.trim().toLowerCase().replace(/×/g, 'x');

  const minutes = label.match(/^(\d+(?:\.\d+)?)\s*min/);
  if (minutes) {
    return Math.round(Number(minutes[1]) * 60);
  }

  const timedSets = label.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*s/);
  if (timedSets) {
    return Math.round(Number(timedSets[1]) * Number(timedSets[2]));
  }

  const timed = label.match(/^(\d+(?:\.\d+)?)\s*s/);
  if (timed) {
    return Math.round(Number(timed[1]));
  }

  const repSets = label.match(/^(\d+)\s*x\s*(\d+)$/);
  if (repSets) {
    // ~3s per rep, rounded up to the nearest 5s, floored at 30s.
    const estimate = Number(repSets[1]) * Number(repSets[2]) * 3;
    return Math.max(30, Math.ceil(estimate / 5) * 5);
  }

  return 40;
}

/** Home-hero warmup/cooldown block → timed guided drills. */
export function buildGuidedDrillsFromBlock(block: SessionRoutineBlock): GuidedDrill[] {
  return block.drills.map((drill) => ({
    name: drill.name,
    seconds: parseSchemeLabelSeconds(drill.schemeLabel),
  }));
}

/**
 * Seconds a warm-up or cool-down block actually costs, ready-countdowns
 * included. Shared so Home and the player feed the same number into the
 * session estimate instead of each summing the block their own way.
 */
export function estimateRoutineBlockSeconds(block: SessionRoutineBlock): number {
  return buildGuidedDrillsFromBlock(block).reduce(
    (sum, drill) => sum + drill.seconds + GUIDED_READY_SECONDS,
    0,
  );
}

/**
 * How long to wait before the next step while a dial button is held, given
 * how many steps the hold has already produced. Slow enough at first to stop
 * on a number, then quick — 100 kg from zero in 2.5 kg steps is forty ticks,
 * and forty ticks at 140 ms is a long time to hold a button.
 */
export function dialHoldIntervalMs(ticksSoFar: number): number {
  if (ticksSoFar < 6) {
    return 140;
  }
  if (ticksSoFar < 16) {
    return 80;
  }
  return 45;
}

/**
 * Whether the guided plan should leave an exercise out — no steps, no dots.
 *
 * Two different questions share the word "skipped". The session's status
 * answers "did anything get done here", and drives what is saved: an
 * exercise with one logged set and the rest skipped is *completed* there, so
 * the set survives into volume and records. The plan asks "is there anything
 * left to do here that the user did not walk away from" — and for that same
 * exercise the answer is no: the user pressed skip. So it leaves the plan,
 * exactly as it did when the status alone said so, while its logged set
 * stays a set.
 */
export function isGuidedExerciseOut(exercise: {
  status: string;
  sets: ReadonlyArray<{ status: string }>;
}): boolean {
  if (exercise.status === 'skipped') {
    return true;
  }
  const nothingPending = exercise.sets.every((set) => set.status !== 'pending');
  const somethingSkipped = exercise.sets.some((set) => set.status === 'skipped');
  return exercise.sets.length > 0 && nothingPending && somethingSkipped;
}

function formatBlockLength(totalSeconds: number): string {
  if (totalSeconds < 90) {
    return `~${Math.max(5, Math.round(totalSeconds / 5) * 5)} sec`;
  }
  return `~${Math.round(totalSeconds / 60)} min`;
}

export function buildGuidedSteps(
  input: {
    warmup: GuidedDrill[];
    exercises: GuidedExerciseInput[];
    cooldown: GuidedDrill[];
  },
  language: AppLanguage = 'en',
): GuidedStepPlan {
  const steps: GuidedStep[] = [];
  const groups: GuidedGroup[] = [];
  // Every lift the session had, skipped ones included: this is what the
  // header counts over. Skipped lifts get no steps, but they keep their place
  // in the numbering — otherwise skipping two of six turned the third into
  // "EXERCISE 1 OF 4", and the last one into "1 OF 1", because the plan is
  // rebuilt after every skip and used to number the survivors from one.
  const roster = input.exercises.filter((exercise) => exercise.setCount > 0);
  const exercises = roster.filter((exercise) => !exercise.skipped);
  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.setCount, 0);

  if (input.warmup.length > 0) {
    const warmupSeconds = input.warmup.reduce((sum, drill) => sum + drill.seconds + GUIDED_READY_SECONDS, 0);
    const drillCount =
      input.warmup.length === 1
        ? t(language, 'guided.count.drillOne')
        : t(language, 'guided.count.drillMany', { count: input.warmup.length });
    steps.push({
      type: 'splash',
      phase: 'warmup',
      title: t(language, 'guided.phase.warmup'),
      sub: `${drillCount} · ${formatBlockLength(warmupSeconds)}`,
      doneLabel: null,
    });
    input.warmup.forEach((drill, drillIndex) => {
      const groupIndex = groups.length;
      groups.push({ phase: 'warmup' });
      steps.push({ type: 'ready', phase: 'warmup', drillName: drill.name, seconds: drill.seconds, groupIndex });
      steps.push({
        type: 'drill',
        phase: 'warmup',
        drillName: drill.name,
        seconds: drill.seconds,
        groupIndex,
        drillIndex,
        drillCount: input.warmup.length,
      });
    });
  }

  if (exercises.length > 0) {
    const exerciseCount =
      exercises.length === 1
        ? t(language, 'guided.count.exerciseOne')
        : t(language, 'guided.count.exerciseMany', { count: exercises.length });
    steps.push({
      type: 'splash',
      phase: 'work',
      title: t(language, 'guided.phase.workout'),
      sub: `${exerciseCount} · ${t(language, 'guided.count.sets', { count: totalSets })}`,
      doneLabel: input.warmup.length > 0 ? t(language, 'guided.done.warmup') : null,
    });
    // A superset is one block of work, so the runs — not the exercises — are
    // what the work phase is made of. A lift on its own is a run of one, and
    // everything below then reads the same for both cases.
    buildSupersetRuns(normalizeSupersetGroups(exercises)).forEach((run) => {
      const members = run.indexes.map((index) => exercises[index]);
      const groupIndex = groups.length;
      const rounds = Math.max(...members.map((member) => member.setCount));
      groups.push({
        phase: 'work',
        setCount: rounds,
        ...(members.length > 1 ? { supersetSize: members.length } : {}),
      });
      // Where the block starts, named for the lift you walk up to first. The
      // lifts inside a superset get no countdown between them — not having one
      // is the whole point of pairing them.
      steps.push({
        type: 'position',
        phase: 'work',
        slotId: members[0].slotId,
        exerciseName: members[0].name,
        seconds: GUIDED_POSITION_SECONDS,
        groupIndex,
        // Position in the full roster, not among the survivors.
        exerciseIndex: roster.indexOf(members[0]),
        exerciseCount: roster.length,
      });
      // One set of every lift, then the next set of every lift. The rest goes
      // after the round, which is the one thing that makes this a superset and
      // not two exercises listed next to each other.
      const order = supersetRoundOrder(members.map((member) => member.setCount));
      order.forEach((entry, orderIndex) => {
        const exercise = members[entry.memberIndex];
        // An interval states its own two halves; everything else is a set with
        // a number to dial in and a rest after it.
        const interval = parseIntervalScheme(exercise.name);
        steps.push({
          type: 'set',
          phase: 'work',
          slotId: exercise.slotId,
          exerciseName: exercise.name,
          setIndex: entry.setIndex,
          setCount: exercise.setCount,
          groupIndex,
          exerciseIndex: roster.indexOf(exercise),
          exerciseCount: roster.length,
          ...(interval ? { interval } : {}),
          ...(members.length > 1 ? { supersetRound: { round: entry.setIndex + 1, rounds } } : {}),
        });

        const next = order[orderIndex + 1];
        // Rest when the round is over and another round follows. Not between
        // the lifts of one round, and not after the last one: what follows
        // there is the next block, which gets its own countdown — a rest ring
        // in front of a screen that was going to change anyway was reported
        // 2026-08-21 ("vikan sarjan jälkeen tulee rest").
        const roundEnds = !next || next.setIndex !== entry.setIndex;
        if (!next || !roundEnds) {
          return;
        }
        steps.push({
          type: 'rest',
          phase: 'work',
          slotId: exercise.slotId,
          exerciseName: exercise.name,
          setIndex: entry.setIndex,
          // An interval's recovery is exactly what its name says — including a
          // tabata's ten seconds, which the fifteen-second floor for ordinary
          // rests would have stretched to fifteen. A superset rests as long as
          // the most demanding lift in it asks for: a squat paired with a curl
          // is still a squat.
          seconds: interval
            ? interval.recoverySeconds
            : Math.max(15, ...members.map((member) => member.restSeconds)),
          groupIndex,
          ...(interval ? { recoveryKind: interval.recoveryKind } : {}),
        });
      });
    });
  }

  if (input.cooldown.length > 0) {
    const cooldownSeconds = input.cooldown.reduce((sum, drill) => sum + drill.seconds + GUIDED_READY_SECONDS, 0);
    const stretchCount =
      input.cooldown.length === 1
        ? t(language, 'guided.count.stretchOne')
        : t(language, 'guided.count.stretchMany', { count: input.cooldown.length });
    steps.push({
      type: 'splash',
      phase: 'cooldown',
      title: t(language, 'guided.phase.cooldown'),
      sub: `${stretchCount} · ${formatBlockLength(cooldownSeconds)}`,
      doneLabel:
        exercises.length > 0
          ? t(language, 'guided.done.workout')
          : input.warmup.length > 0
            ? t(language, 'guided.done.warmup')
            : null,
    });
    input.cooldown.forEach((drill, drillIndex) => {
      const groupIndex = groups.length;
      groups.push({ phase: 'cooldown' });
      steps.push({ type: 'ready', phase: 'cooldown', drillName: drill.name, seconds: drill.seconds, groupIndex });
      steps.push({
        type: 'drill',
        phase: 'cooldown',
        drillName: drill.name,
        seconds: drill.seconds,
        groupIndex,
        drillIndex,
        drillCount: input.cooldown.length,
      });
    });
  }

  steps.push({ type: 'finish' });
  return { steps, groups };
}

/**
 * Identity of a built step list — the memo key the player rebuilds its steps on.
 *
 * The exercise NAME is in here for a reason. Every set and position step bakes
 * in the name it was built with, and the set screen reads the name off the
 * step, not off the session. Leaving the name out of this key (which is how
 * this shipped) meant swapping an exercise changed the state and nothing else:
 * same slots, same set counts, same key, so the steps were never rebuilt and
 * the player kept showing — and cueing the photo of — the lift you had just
 * swapped away. The swap looked completely dead from the outside.
 */
export function getGuidedStepPlanKey(exercises: GuidedExerciseInput[]): string {
  return exercises
    .map(
      (exercise) =>
        // The pairing is in the key for the same reason the name is: the steps
        // bake it in, so a superset made or broken without it in here would
        // leave the player running yesterday's order of play.
        `${exercise.slotId}:${exercise.name}:${exercise.setCount}:${exercise.skipped ? 's' : ''}:${exercise.supersetGroup ?? ''}`,
    )
    .join('|');
}

export interface GuidedPhaseRail {
  groups: GuidedGroup[];
  /** Where the reader is inside `groups`, not inside the whole session. */
  current: number;
}

/**
 * The progress bar's segments for the phase the reader is actually in.
 *
 * The rail used to draw the whole session as one strip — three warmup drills,
 * five exercises and two stretches, ten segments of two different kinds of
 * thing. A bar that mixes units answers no question: "two of ten" is not how
 * anybody counts a workout, and the five that matter were squeezed to a third
 * of the width by drills that take forty seconds each.
 *
 * One phase at a time, so the segment count is the thing it tracks: three
 * during the warmup, five during the workout, two during the recovery. Which
 * phase of the session that is, the block's own splash and screens say.
 *
 * The run is taken as a contiguous slice rather than by filtering on `phase`,
 * so a plan that ever interleaves phases still draws the block the reader is
 * standing in rather than every block that shares its name.
 */
export function getGuidedPhaseRail(groups: GuidedGroup[], currentGroupIndex: number): GuidedPhaseRail {
  if (groups.length === 0) {
    return { groups: [], current: 0 };
  }

  const index = Math.min(Math.max(currentGroupIndex, 0), groups.length - 1);
  const phase = groups[index].phase;

  let start = index;
  while (start > 0 && groups[start - 1].phase === phase) {
    start -= 1;
  }
  let end = index;
  while (end < groups.length - 1 && groups[end + 1].phase === phase) {
    end += 1;
  }

  return { groups: groups.slice(start, end + 1), current: index - start };
}

/** Index of the first step of a phase, or null when the phase has no steps. */
export function findGuidedPhaseStart(steps: GuidedStep[], phase: GuidedPhase): number | null {
  const index = steps.findIndex((step) => step.type !== 'finish' && step.phase === phase);
  return index >= 0 ? index : null;
}

/**
 * Short human label for the resume chip ("Bench Press set 2").
 *
 * The exercise name goes through the same translation the player itself uses.
 * Without it the entry screen offered to resume "Front Squat sarja 3" while
 * the screen it resumes into says "Etukyykky" — one lift with two names, and
 * the English one on the surface that is meant to be reassuring.
 */
export function getGuidedStepLabel(step: GuidedStep, language: AppLanguage = 'en'): string {
  switch (step.type) {
    case 'set':
      return t(language, 'guided.step.set', {
        name: exerciseNameLabel(language, step.exerciseName),
        index: step.setIndex + 1,
      });
    case 'position':
      return t(language, 'guided.step.setup', { name: exerciseNameLabel(language, step.exerciseName) });
    case 'rest':
      return t(language, 'guided.step.rest', { name: exerciseNameLabel(language, step.exerciseName) });
    case 'drill':
    case 'ready':
      return step.drillName;
    case 'splash':
      return step.title;
    case 'finish':
      return t(language, 'guided.step.complete');
  }
}

export interface GuidedSetTarget {
  reps: number;
  /** `reps` is seconds held, not repetitions — carried so every label agrees. */
  timed?: boolean;
  /** `reps` is minutes of steady work (trackingMode 'duration_minutes'). */
  minutes?: boolean;
  loadKg: number | null;
  /**
   * Load this set carried before automated progression raised it, when the
   * shown weight is still that untouched machine-picked one. Null whenever the
   * user has a hand in the number — the badge must never claim credit for a
   * weight the user typed.
   */
  autoProgressedFromKg: number | null;
  /**
   * When this weight came from the same lift in another slot — another
   * program, another day, an empty workout — the date it was performed. Same
   * "only while untouched" rule as the badge above.
   */
  prefilledFromPerformedAt: string | null;
  /**
   * The load had earned a jump and recovery held it (Pro). Same
   * "only while untouched" rule as the two above: once the user moves the
   * number themselves, the app has no claim on it either way.
   */
  heldForFatigue: boolean;
  /**
   * The load had earned a jump and an area the reader flagged held it (Pro).
   * Same "only while untouched" rule as the recovery hold.
   */
  heldForCautionArea: SetupCautionArea | null;
  /**
   * The rep floor this target was raised from, for exercises that progress by
   * reps instead of load (bodyweight — the load gate is silent there). Null on
   * loaded lifts and whenever `reps` is not the gate's own number.
   */
  autoProgressedFromReps: number | null;
}

export interface GuidedNextPreview {
  title: string;
  sub: string;
  line: string;
}

function formatKg(value: number): string {
  return removeTrailingZeros(value);
}

export function formatGuidedTarget(target: GuidedSetTarget, language: AppLanguage = 'en'): string {
  if (target.loadKg === null) {
    return t(
      language,
      target.minutes ? 'guided.target.minutes' : target.timed ? 'guided.target.seconds' : 'guided.target.reps',
      { reps: target.reps },
    );
  }
  return `${target.reps} × ${formatKg(target.loadKg)} kg`;
}

/**
 * "Next ·" preview: the next drill/set/splash after `index`, skipping
 * ready/rest/position steps.
 */
export function getGuidedNextPreview(
  steps: GuidedStep[],
  index: number,
  resolveTarget: (slotId: string, setIndex: number) => GuidedSetTarget | null,
  language: AppLanguage = 'en',
): GuidedNextPreview | null {
  // Whether a rest stands between here and the step this preview describes.
  // The scan below walks over rests to find the next thing WORTH previewing,
  // which is right — but the superset line claims no rest is coming, and
  // between two rounds of the same superset one is.
  let restsBetween = false;

  for (let cursor = index + 1; cursor < steps.length; cursor += 1) {
    const step = steps[cursor];
    if (step.type === 'rest') {
      restsBetween = true;
      continue;
    }
    if (step.type === 'drill') {
      return {
        title: step.drillName,
        sub: `${step.seconds}s`,
        line: `${step.drillName} · ${step.seconds}s`,
      };
    }
    if (step.type === 'set') {
      const target = resolveTarget(step.slotId, step.setIndex);
      const targetLabel = target ? formatGuidedTarget(target, language) : null;
      const name = exerciseNameLabel(language, step.exerciseName);
      // Running straight into the next lift is the one thing about a superset
      // the reader has to know BEFORE they finish the set — it is the
      // difference between racking the bar and walking to the next station.
      const current = steps[index];
      const runsStraightOn =
        !restsBetween &&
        current?.type === 'set' &&
        Boolean(current.supersetRound) &&
        current.groupIndex === step.groupIndex;
      const headline = runsStraightOn ? t(language, 'guided.superset.next', { name }) : name;
      return {
        title: t(language, 'guided.next.setTitle', {
          name,
          index: step.setIndex + 1,
          count: step.setCount,
        }),
        sub: targetLabel ?? '',
        line: targetLabel ? `${headline} · ${targetLabel}` : headline,
      };
    }
    if (step.type === 'splash') {
      return { title: step.title, sub: step.sub, line: step.title };
    }
    if (step.type === 'finish') {
      return { title: t(language, 'guided.step.complete'), sub: '', line: t(language, 'guided.next.finish') };
    }
  }
  return null;
}

/**
 * Name of the next drill/exercise/block after `index` — the set screen's
 * "Next ·" line names what is coming without repeating its target.
 *
 * Translated here, like every other label this module returns. It used to hand
 * back the raw English name and rely on the caller to localize it, which is
 * the arrangement that let the resume chip ship in the wrong language.
 */
export function getGuidedNextName(
  steps: GuidedStep[],
  index: number,
  language: AppLanguage = 'en',
): string | null {
  for (let cursor = index + 1; cursor < steps.length; cursor += 1) {
    const step = steps[cursor];
    if (step.type === 'drill') {
      return step.drillName;
    }
    if (step.type === 'set') {
      return exerciseNameLabel(language, step.exerciseName);
    }
    if (step.type === 'splash') {
      return step.title;
    }
    if (step.type === 'finish') {
      return null;
    }
  }
  return null;
}

/**
 * A completed set was the reader's own call when its load is not the one
 * materialisation planned for it. No plan at all (a fresh slot, a scrubbed
 * draft) makes any logged load their call.
 */
function loggedOffPlan(set: { plannedLoadKg?: number; actualLoadKg?: number }): boolean {
  if (typeof set.actualLoadKg !== 'number') {
    return false;
  }
  if (typeof set.plannedLoadKg !== 'number') {
    return true;
  }
  return Math.abs(set.actualLoadKg - set.plannedLoadKg) >= 0.001;
}

/**
 * Default target the set screen opens with. Weight: the previous completed
 * set's actual when the reader logged it off its plan; else the set's own
 * draft prefill, then the planned load, then the previous set. Reps: previous
 * completed set's actual, else the planned max.
 */
export function resolveGuidedSetTarget(
  sets: Array<{
    setIndex: number;
    status: string;
    plannedLoadKg?: number;
    plannedRepsMin: number;
    plannedRepsMax: number;
    draftLoadText: string;
    draftRepsText: string;
    autoProgressedFromKg?: number;
    heldForFatigue?: boolean;
    heldForCautionArea?: SetupCautionArea;
    prefilledFromPerformedAt?: string;
    plannedTargetReps?: number;
    autoProgressedFromReps?: number;
    rampTargetReps?: number;
    actualLoadKg?: number;
    actualReps?: number;
  }>,
  setIndex: number,
  trackingMode: string,
  /**
   * Sets at or below this index were logged as a different lift (the exercise
   * was swapped mid-way). Carry-forward stops here — see
   * `WorkoutExerciseInstance.swappedAfterSetIndex`.
   */
  swappedAfterSetIndex?: number | null,
): GuidedSetTarget | null {
  const set = sets.find((item) => item.setIndex === setIndex);
  if (!set) {
    return null;
  }

  const carryForwardFloor = typeof swappedAfterSetIndex === 'number' ? swappedAfterSetIndex : -1;
  const previous = [...sets]
    .filter(
      (item) => item.setIndex < setIndex && item.setIndex > carryForwardFloor && item.status === 'completed',
    )
    .sort((left, right) => right.setIndex - left.setIndex)[0];

  // A hold logs no weight either — its "reps" are seconds. Nor does a bout of
  // minutes on a bike.
  if (trackingMode === 'bodyweight' || trackingMode === 'hold' || trackingMode === 'duration_minutes') {
    // Bodyweight progresses by reps: the gate's target replaces the template
    // fallback, and the previous completed set still wins — mid-session the
    // day's own numbers are the better prescription.
    const suggestedReps = trackingMode === 'bodyweight' ? set.plannedTargetReps : undefined;
    const reps = previous?.actualReps ?? suggestedReps ?? set.plannedRepsMax;
    // Same rule as the load badges below: the claim follows the number. Once
    // the shown reps are not the ones the gate picked, it has nothing to
    // point at.
    const untouchedReps = suggestedReps !== undefined && reps === suggestedReps;
    return {
      reps,
      // Set only when true, so a bodyweight target keeps the shape it had.
      ...(trackingMode === 'hold' ? { timed: true } : {}),
      ...(trackingMode === 'duration_minutes' ? { minutes: true } : {}),
      loadKg: null,
      autoProgressedFromKg: null,
      prefilledFromPerformedAt: null,
      autoProgressedFromReps:
        untouchedReps && set.autoProgressedFromReps !== undefined ? set.autoProgressedFromReps : null,
      // The hold is reported while today is still untouched; after the first
      // logged set the day has its own numbers to answer for.
      heldForFatigue: trackingMode === 'bodyweight' && previous == null && set.heldForFatigue === true,
      // A rep target a flagged area held, on the same terms as recovery's.
      heldForCautionArea:
        trackingMode === 'bodyweight' && previous == null ? set.heldForCautionArea ?? null : null,
    };
  }

  // A lowered target (the reps fell short of the programme last time) opens
  // the dial where the reader can meet it; the programme's reps otherwise.
  // The previous set still wins mid-session, as for bodyweight.
  //
  const draftLoad = parseNumberInput(set.draftLoadText);
  // Lift what was planned and the plan stands for the next set — a ramp
  // prefilled set by set (60/70/80) stays a ramp. Change the weight and the
  // change follows: set 2 opens on what set 1 actually lifted, not on a
  // prefill from last week or another day (#bugs 2026-09-09, "Paino ei
  // päivity"). Reps have worked this way all along, one line up.
  const carriedLoadKg = previous && loggedOffPlan(previous) ? previous.actualLoadKg ?? null : null;
  const loadKg = carriedLoadKg ?? draftLoad ?? set.plannedLoadKg ?? previous?.actualLoadKg ?? null;
  // Both badges follow the number, not the set: once the shown load drifts off
  // the plan (user edit, carry-forward from a set they logged heavier), it is
  // no longer the weight the app put there, and neither badge may claim it.
  const untouched =
    loadKg !== null && set.plannedLoadKg !== undefined && Math.abs(loadKg - set.plannedLoadKg) < 0.001;
  // A ramp's own per-set target comes first while the set is on its planned
  // weight: in 40×10, 50×8, 60×5 the set before was lifted lighter, and
  // carrying its 10 onto the 60 kg set asked for twice what that set did
  // (user 2026-10-01). Off the plan — warm-ups skipped, 60 kg from set 1 —
  // the set before is the better guide, as it always was.
  const reps =
    (untouched ? set.rampTargetReps : undefined) ?? previous?.actualReps ?? set.plannedTargetReps ?? set.plannedRepsMax;
  return {
    reps,
    loadKg,
    autoProgressedFromKg: untouched && set.autoProgressedFromKg !== undefined ? set.autoProgressedFromKg : null,
    prefilledFromPerformedAt: untouched ? set.prefilledFromPerformedAt ?? null : null,
    heldForFatigue: untouched && set.heldForFatigue === true,
    heldForCautionArea: untouched ? set.heldForCautionArea ?? null : null,
    autoProgressedFromReps: null,
  };
}

/**
 * A step in terms that survive the plan being rebuilt — the thing to persist
 * instead of (as well as) its index. See GuidedResumeAnchor.
 */
export function getGuidedStepAnchor(step: GuidedStep): GuidedResumeAnchor {
  switch (step.type) {
    case 'finish':
      return { type: 'finish', phase: null };
    case 'splash':
      return { type: 'splash', phase: step.phase };
    case 'ready':
    case 'drill':
      return { type: step.type, phase: step.phase, drillName: step.drillName };
    case 'position':
      return { type: 'position', phase: 'work', slotId: step.slotId };
    case 'set':
    case 'rest':
      return { type: step.type, phase: 'work', slotId: step.slotId, setIndex: step.setIndex };
  }
}

/** The index of the step an anchor names in *this* list, or null if it is gone. */
export function findGuidedStepIndexByAnchor(steps: GuidedStep[], anchor: GuidedResumeAnchor): number | null {
  const index = steps.findIndex((step) => {
    if (step.type !== anchor.type) {
      return false;
    }
    switch (step.type) {
      case 'finish':
        return true;
      case 'splash':
        return step.phase === anchor.phase;
      case 'ready':
      case 'drill':
        return step.phase === anchor.phase && step.drillName === anchor.drillName;
      case 'position':
        return step.slotId === anchor.slotId;
      case 'set':
      case 'rest':
        return step.slotId === anchor.slotId && step.setIndex === anchor.setIndex;
    }
  });
  return index >= 0 ? index : null;
}

/**
 * Where to resume. An anchor wins when its step still exists (rolled forward
 * past sets completed meanwhile). Failing that a stored index (clamped, rolled
 * forward). With neither: the first incomplete set when some sets are already
 * logged, else the start.
 *
 * The anchor is what makes this survive a rebuilt plan. Skipping a lift, or
 * updating the app, changes the step list's shape; an index into the old list
 * then names a different step, and the entry screen offered to resume
 * "Penkkipunnerrus sarja 2" in a session that had never touched the bench.
 * When the anchored step is gone — the lift it belonged to left the plan —
 * the index is not trusted either: it points into a list that no longer
 * exists. The first incomplete set is the honest place to land.
 */
export function resolveGuidedResumeIndex(
  steps: GuidedStep[],
  storedIndex: number | null | undefined,
  isSetCompleted: (slotId: string, setIndex: number) => boolean,
  anchor?: GuidedResumeAnchor | null,
): number {
  const lastIndex = steps.length - 1;
  const rollForward = (from: number) => {
    let cursor = Math.min(Math.max(0, from), lastIndex);
    while (cursor < lastIndex) {
      const step = steps[cursor];
      if (step.type === 'set' && isSetCompleted(step.slotId, step.setIndex)) {
        cursor += 1;
        // The rest right after a completed set belongs to it — skip that too.
        if (steps[cursor]?.type === 'rest') {
          cursor += 1;
        }
        continue;
      }
      break;
    }
    return cursor;
  };

  if (anchor) {
    const anchored = findGuidedStepIndexByAnchor(steps, anchor);
    if (anchored !== null) {
      return rollForward(anchored);
    }
    // Anchored step gone → the index is stale too. Fall through to the
    // set-based landing below.
  } else if (typeof storedIndex === 'number' && Number.isFinite(storedIndex) && storedIndex > 0) {
    return rollForward(storedIndex);
  }

  const anyCompleted = steps.some(
    (step) => step.type === 'set' && isSetCompleted(step.slotId, step.setIndex),
  );
  if (!anyCompleted) {
    return 0;
  }

  const firstIncomplete = steps.findIndex(
    (step) => step.type === 'set' && !isSetCompleted(step.slotId, step.setIndex),
  );
  if (firstIncomplete < 0) {
    // Everything logged — resume at the cooldown splash if one exists,
    // otherwise land on finish.
    const cooldownStart = findGuidedPhaseStart(steps, 'cooldown');
    return cooldownStart ?? lastIndex;
  }

  // Land on the exercise's position step when resuming at its first set.
  const step = steps[firstIncomplete];
  if (step.type === 'set' && step.setIndex === 0 && steps[firstIncomplete - 1]?.type === 'position') {
    return firstIncomplete - 1;
  }
  return firstIncomplete;
}

/**
 * From an index, past work that is already done: a logged set, and a rest or
 * walk-up whose set is logged.
 *
 * After a lift leaves the plan the player lands where that block started, and
 * inside a superset that is the other lift's round — already logged. Skip A
 * in round 2 and the screen showed B's first set, done; skip B and it showed
 * A's rest, then A's logged set. Pressing Log there changed nothing but the
 * draft, and the player moved on, so the set the reader really did was lost.
 */
export function rollPastLoggedWork(
  steps: GuidedStep[],
  from: number,
  isSetCompleted: (slotId: string, setIndex: number) => boolean,
): number {
  const lastIndex = steps.length - 1;
  let cursor = Math.min(Math.max(0, from), Math.max(0, lastIndex));
  while (cursor < lastIndex) {
    const step = steps[cursor];
    if (step.type === 'set') {
      if (!isSetCompleted(step.slotId, step.setIndex)) {
        break;
      }
      cursor += 1;
      // The rest right after a logged set belongs to it, as on resume.
      if (steps[cursor]?.type === 'rest') {
        cursor += 1;
      }
      continue;
    }
    if (step.type === 'rest' || step.type === 'position') {
      // A lead-in leads to the next set. When that set is logged, it leads nowhere.
      let next = cursor + 1;
      while (next <= lastIndex && (steps[next].type === 'rest' || steps[next].type === 'position')) {
        next += 1;
      }
      const target = steps[next];
      if (target?.type === 'set' && isSetCompleted(target.slotId, target.setIndex)) {
        cursor = next;
        continue;
      }
    }
    break;
  }
  return cursor;
}

/** Skip target: next step, jumping over the rest that follows a skipped set. */
export function getGuidedSkipTargetIndex(steps: GuidedStep[], index: number): number {
  const lastIndex = steps.length - 1;
  let target = index + 1;
  if (steps[index]?.type === 'set' && steps[target]?.type === 'rest') {
    target += 1;
  }
  return Math.min(target, lastIndex);
}

/**
 * Where a reader lands when they skip a whole warmup or cooldown.
 *
 * Skipping drill by drill already worked, and on a five-drill warmup that is
 * five taps to get to the bar. Asked for from a gym floor (user, 2026-08-20).
 *
 * The work block is not skippable and never will be: it is the session. Only
 * the two blocks around it answer to this, and a step with no phase at all —
 * the finish card — answers to nothing.
 */
export function getGuidedPhaseSkipTargetIndex(steps: GuidedStep[], index: number): number {
  const current = steps[index];
  const phase = current && 'phase' in current ? current.phase : null;
  if (!phase || phase === 'work') {
    return index;
  }

  for (let next = index + 1; next < steps.length; next += 1) {
    const step = steps[next];
    const nextPhase = 'phase' in step ? step.phase : null;
    if (nextPhase !== phase) {
      return next;
    }
  }

  return Math.max(0, steps.length - 1);
}

/** Back target: previous drill/set/position/splash, skipping rest/ready steps. */
export function getGuidedBackTargetIndex(steps: GuidedStep[], index: number): number {
  let cursor = index - 1;
  while (cursor > 0) {
    const step = steps[cursor];
    if (step.type === 'rest' || step.type === 'ready') {
      cursor -= 1;
      continue;
    }
    break;
  }
  return Math.max(0, cursor);
}

/*
 * The entry screen's duration estimate used to live here, adding up the step
 * list at a flat 35 s per set. It is gone: a set of five and a set of fifteen
 * do not take the same time, and this was one of four different answers the
 * app gave to "how long is this session". See `lib/sessionDuration.ts`, which
 * Home and the player now share.
 */

/**
 * "STRONG Elite - Day 1: Upper (Heavy)" → "Upper (Heavy)". Runtime session
 * templates are named `<plan> - <day>`; entry wants just the day focus.
 */
export function getGuidedSessionTitle(templateName: string, language: AppLanguage = 'en'): string {
  const raw = templateName.trim();
  const separatorIndex = raw.lastIndexOf(' - ');
  const dayPart = separatorIndex >= 0 ? raw.slice(separatorIndex + 3).trim() : raw;
  const [head, ...rest] = dayPart.split(':');
  const afterColon = rest.join(':').trim();
  if (/^day\s*\d+$/i.test(head.trim()) && afterColon) {
    return afterColon;
  }
  return dayPart || t(language, 'guided.sessionFallback');
}

/** mm:ss over 60s, plain seconds under it — matches the mock's gpFmt. */
export function formatGuidedCountdown(secondsLeft: number): string {
  const seconds = Math.max(0, Math.ceil(secondsLeft));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${seconds}`;
}

/**
 * Media/instructions match: exact name first, then a curated alias map for
 * classic plan names, then a containment heuristic (library name contains the
 * plan name, shortest wins). Returns the library index or null — never guesses
 * across ambiguous containment in both directions.
 */
export const GUIDED_LIBRARY_ALIASES: Record<string, string> = {
  'bench press': 'barbell bench press - medium grip',
  'incline bench press': 'barbell incline bench press - medium grip',
  'overhead press': 'standing military press',
  'military press': 'standing military press',
  'lateral raise': 'side lateral raise',
  'back squat': 'barbell full squat',
  'front squat': 'front barbell squat',
  'deadlift': 'barbell deadlift',
  'romanian deadlift': 'romanian deadlift',
  'barbell row': 'bent over barbell row',
  'hip thrust': 'barbell hip thrust',
  // The floor bridge. By containment it landed on the barbell bridge, whose
  // steps begin with a loaded bar over the legs (bug hunt, 2026-10-04).
  'glute bridge': 'butt lift (bridge)',
  // The equipment filter allows these with no gear (the name says bodyweight),
  // so the demo must be the floor bridge, not the barbell hip thrust that
  // "hip thrust" reaches by containment.
  'hip thrust (bodyweight)': 'butt lift (bridge)',
  'hip thrust (bodyweight or light bar)': 'butt lift (bridge)',
  // The catalogue's plain calf raises are prescribed to readers with and
  // without a gym. By containment they opened the seated and standing calf
  // MACHINES (36 rows): a machine demo under a bodyweight programme. The extra
  // entry's steps hold for a loaded row too. Where the extras are absent the
  // target is absent and lookup falls through as before (bug hunt, 2026-10-04).
  'calf raise': 'bodyweight calf raise',
  'standing calf raise': 'bodyweight calf raise',
  // Named single-leg in brackets, it is the single-leg raise, not the two-leg one.
  'calf raise (single-leg)': 'single-leg calf raise',
  'calf raise (each leg)': 'single-leg calf raise',
  'lat pulldown': 'wide-grip lat pulldown',
  'pull-up': 'pullups',
  'pull-ups': 'pullups',
  'chin-up': 'chin-up',
  'push-up': 'pushups',
  'push-ups': 'pushups',
  'plank': 'plank',

  // Names the catalogs qualify with a coaching cue. Each pair was checked
  // against the library by hand: the containment heuristic reached "Seated
  // Cable Rows" for a ring row and "Push Up to Side Plank" for a side plank,
  // which is why stripped names are not allowed to use it.
  'rows (bar or rings)': 'inverted row',
  'seated cable row': 'seated cable rows',
  'step-up': 'step-up with knee raise',
  vacuum: 'stomach vacuum',

  // ── Names the library has under a different spelling ──────────────────
  //
  // Each pair was checked by hand against the library, on one rule: the
  // entry must be the SAME MOVEMENT, so the photo and the instructions are
  // right. Different gear for the same movement is fine and already the norm
  // here ("Hip Thrust" has always resolved to the barbell version) — the
  // position is what a user reads off a photo. A different movement is not
  // fine, however close the name: "Plank-Up", "Plank to Pike" and "Skater
  // Jump" are left unresolved rather than pointed at "Plank" and "Star Jump".
  'chest-supported row': 'dumbbell incline row',
  'chest-supported t-bar row': 'lying t-bar row',
  // The app opens its own "Bulgarian Split Squat" (extraExerciseLibrary): an
  // exact name wins over this alias. Against the generated list alone — where
  // "Split Squats", a jumping move, would win by containment — the dumbbell
  // split squat is the closest real lift (bug hunt, 2026-10-04).
  'bulgarian split squat': 'split squat with dumbbells',
  // "Arnold Press" matched "Kettlebell Arnold Press" by containment.
  'arnold press': 'arnold dumbbell press',
  'machine chest press': 'leverage chest press',
  'machine high row': 'leverage high row',
  'hanging knee raise': 'hanging leg raise',
  'weighted pull-up': 'weighted pull ups',
  'weighted dips': 'parallel bar dip',
  'standing overhead press': 'standing military press',
  'incline barbell press': 'barbell incline bench press - medium grip',
  'competition bench press': 'bench press - powerlifting',
  'paused bench press': 'bench press - powerlifting',
  'cable lateral raise': 'cable seated lateral raise',
  'dumbbell lateral raise': 'side lateral raise',
  'lateral raise superset': 'side lateral raise',
  'cable front raise': 'front cable raise',
  'dumbbell rear delt fly': 'reverse flyes',
  'reverse pec deck': 'reverse machine flyes',
  'single-arm dumbbell row': 'one-arm dumbbell row',
  'dumbbell renegade row': 'alternating renegade row',
  'cable triceps pushdown': 'triceps pushdown',
  'rope pushdown': 'triceps pushdown - rope attachment',
  'cable triceps kickback': 'tricep dumbbell kickback',
  'reverse wrist curl': 'palms-down wrist curl over a bench',
  'cable pullover': 'straight-arm dumbbell pullover',
  'cable pull-through': 'pull through',
  'dumbbell thruster': 'kettlebell thruster',
  'battle rope slam': 'battling ropes',
  'banded lateral walk': 'monster walk',
  'wall push-up': 'incline push-up',
  'cat-cow': 'cat stretch',
  // A curtsy lunge is a crossover reverse lunge — same movement, and the
  // library files that entry under 'back', which is its mistake, not ours.
  'curtsy lunge': 'crossover reverse lunge',
  // "Reverse Lunge" used to reach 'Crossover Reverse Lunge' by containment,
  // which is a different movement AND filed under 'back' — so every leg day
  // running one picked up a pull vote.
  'reverse lunge': 'dumbbell rear lunge',
  'bodyweight reverse lunge': 'dumbbell rear lunge',
  'banded hip thrust': 'barbell hip thrust',
  'single-leg hip thrust': 'single leg glute bridge',
  'banded glute bridge': 'barbell glute bridge',
  // The hold is a floor bridge with no load; the demo is the bodyweight one.
  // Its history is still filed under the barbell bridge (DEMO_ONLY_ALIASES).
  'glute bridge hold': 'butt lift (bridge)',
  // The unloaded walking lunge opens the bodyweight lunge's steps, not the
  // barbell one that containment used to land on.
  'walking lunge': 'bodyweight walking lunge',
  'cable glute kickback': 'one-legged cable kickback',
  'inchworm to push-up': 'inchworm',
  // "each side" is a prescription, so the qualifier strip refuses this one.
  // Same stand-in drillMedia already uses for the couch stretch.
  'couch stretch (each side)': 'intermediate hip flexor and quad stretch',
  // ── The catalogs' own names for lifts the library files differently ────
  //
  // Found by walking every exercise the ready catalogs prescribe against the
  // library: 113 of 274 names resolved to nothing, so they reached the reader
  // with no photo, no demo and no instructions in any language. These are the
  // ones the library does hold under another name. Each pair was checked by
  // hand on the same rule as the block above — SAME MOVEMENT, gear may differ.
  //
  // What is deliberately not here: the movements the generated library
  // genuinely lacks (Burpee, Bird Dog, the run blocks). A near miss is worse
  // than a blank; they have rows of their own in extraExerciseLibrary now.
  'competition back squat': 'barbell full squat',
  'pause squat': 'barbell full squat',
  'competition deadlift': 'barbell deadlift',
  'conventional deadlift': 'barbell deadlift',
  'pendlay row': 'bent over barbell row',
  'seated machine row': 'seated cable rows',
  'machine shoulder press': 'machine shoulder (military) press',
  'standing dumbbell shoulder press': 'standing dumbbell press',
  'cable bicep curl': 'standing biceps cable curl',
  'triceps kickback': 'tricep dumbbell kickback',
  'triceps dip (chair)': 'bench dips',
  'explosive pull-up': 'pullups',
  'muscle-up progression (negative)': 'muscle up',
  'band pull-apart': 'band pull apart',
  'battle rope wave': 'battling ropes',
  'standing side bend': 'dumbbell side bend',
  'broad jump': 'standing long jump',
  // A sumo squat is a wide-stance squat; the library files that movement as a
  // plie, and holding a dumbbell is gear, not a different lift.
  'sumo squat': 'plie dumbbell squat',
  // The library's pistol is counterbalanced with a kettlebell. Same position.
  'pistol squat (each leg)': 'kettlebell pistol squat',
  // The library's "Air Bike" is the bicycle crunch, not the fan bike — which is
  // exactly why the qualifier strip refuses "Air Bike (30s sprint)" above.
  'bicycle crunch': 'air bike',
  "child's pose with reach": "child's pose",
  'lying quad stretch': 'quad stretch',
  'hip flexor stretch': 'kneeling hip flexor',
  // Prescriptions the strip refuses on purpose, named one by one instead.
  'push-up (20s on / 10s off)': 'pushups',
  'squat jump (20s on / 10s off)': 'freehand jump squat',
  'mountain climber (20s on / 10s off)': 'mountain climbers',
  'rowing machine hiit': 'rowing, stationary',
  'rowing machine (500m intervals)': 'rowing, stationary',
  'stationary bike (easy pace)': 'bicycling, stationary',

  // ── The ready programmes' names that only containment placed ───────────
  //
  // Walking every slot of every ready programme (catalog audit, 2026-10-06):
  // 180 slots reached their photo by "the shortest library name containing
  // this one", and on about half of them that was another lift — "Barbell Bench
  // Press" opened the DECLINE bench, "Leg Curl" the stability-ball curl,
  // "Overhead Triceps Extension" a sled, "Close-Grip Bench Press" the Smith
  // machine, "Bent-Over Row" the reverse grip. Each pair below is the same
  // movement, checked by hand on the rule of the blocks above; the generic
  // names whose row is one variant of several are in DEMO_ONLY_ALIASES, so
  // the photo improves and what a log is filed under does not move.
  // tests/lib/readyProgrammeAudit.test.cjs holds every slot to exact-or-alias.
  'barbell bench press': 'barbell bench press - medium grip',
  'bent-over row': 'bent over barbell row',
  'bicep curl': 'dumbbell bicep curl',
  'dumbbell curl': 'dumbbell bicep curl',
  'box jump': 'front box jump',
  'cable curl': 'standing biceps cable curl',
  'cable fly': 'cable crossover',
  'cable hammer curl': 'cable hammer curls - rope attachment',
  'cable kickback': 'one-legged cable kickback',
  'cable row': 'seated cable rows',
  'cable triceps extension': 'low cable triceps extension',
  'close-grip bench press': 'close-grip barbell bench press',
  'dumbbell fly': 'dumbbell flyes',
  'dumbbell row': 'one-arm dumbbell row',
  'hammer curl': 'hammer curls',
  // The prone drill lies face down; the programmes' morning opener stands.
  'hip circles': 'standing hip circles',
  'jump squat': 'freehand jump squat',
  'leg curl': 'lying leg curls',
  'lying leg curl': 'lying leg curls',
  'leg extension': 'leg extensions',
  'medicine ball slam': 'one-arm medicine ball slam',
  'mountain climber': 'mountain climbers',
  'overhead triceps extension': 'standing dumbbell triceps extension',
  'rear delt fly': 'reverse flyes',
  'renegade row': 'alternating renegade row',
  'sissy squat': 'weighted sissy squat',
  'skull crusher': 'ez-bar skullcrusher',
  't-bar row': 't-bar row with handle',
  'wrist curl': 'cable wrist curl',
  // Names the library held under another spelling, unresolved until now.
  // A diamond push-up is the close-hands push-up; the library's natural
  // glute-ham raise is the Nordic curl (kneeling, lowered by the hamstrings).
  // Not the single-leg RDL: the library's one is a kettlebell lift, and the
  // programmes prescribe it with no weight to a reader who may own none.
  'diamond push-up': 'push-ups - close triceps position',
  'nordic hamstring curl': 'natural glute ham raise',

  // ── Dosages of the app's own rows (extraExerciseLibrary) ───────────────
  //
  // The last 79 names of the ready programmes had no row at all (catalog
  // audit, 2026-10-06). Each got one, except these: the same movement with
  // the same equipment, whose name carries a dose the strip refuses to drop
  // (a time, a distance, "each side") or a variant the row's steps already
  // teach. The burpee row's steps include the push-up.
  'burpee (20s on / 10s off)': 'burpee',
  'burpee with push-up': 'burpee',
  'pigeon pose (each side)': 'pigeon pose',
  'treadmill hiit (30s on / 30s off)': 'treadmill hiit',
  'bike hiit (45s sprint / 15s rest)': 'bike hiit',
  // A fan bike sprint. Named here because the strip would have reached the
  // library's "Air Bike", which is the bicycle crunch.
  'air bike (30s sprint)': 'bike hiit',
  'sprint 40m': 'sprint',
  'sprint interval (200m)': 'sprint',
  // Loaded in one programme and not in the others; the row's steps make the
  // dumbbell optional, and it is never the library's kettlebell lift.
  'single-leg romanian deadlift': 'single-leg rdl',
};

/**
 * A trailing parenthetical carrying a PRESCRIPTION, not a cue.
 *
 * These must never be stripped. "Air Bike (30s sprint)" is a fan bike; drop
 * the qualifier and it resolves to the library's "Air Bike", which in this
 * catalog is the ab exercise (see catalogExercisePools). A confidently wrong
 * photo is worse than no photo.
 */
const PRESCRIPTION_QUALIFIER = /\d|each (side|leg|arm)|per side/i;

/**
 * "Seated Cable Row (Wide)" -> "seated cable row".
 *
 * The catalogs qualify names with coaching cues the library never spells:
 * (Wide), (Light), (Banded), (Bodyweight), (or Knee Push-Up). Every one of
 * them resolved to nothing, so 16 prescribed exercises reached the user with
 * no photo, no demo and no swap pool. The qualifier stays on screen — this
 * only affects what the name is matched against.
 */
function stripCoachingQualifier(normalized: string): string | null {
  const match = normalized.match(/^(.*?)\s*\(([^)]*)\)$/);
  if (!match || PRESCRIPTION_QUALIFIER.test(match[2])) {
    return null;
  }
  const head = match[1].trim();
  return head && head !== normalized ? head : null;
}

function resolveExactOrAlias(candidate: string, lowerNames: readonly string[]): number | null {
  const exact = lowerNames.indexOf(candidate);
  if (exact >= 0) {
    return exact;
  }

  const alias = GUIDED_LIBRARY_ALIASES[candidate];
  const aliasIndex = alias ? lowerNames.indexOf(alias) : -1;
  return aliasIndex >= 0 ? aliasIndex : null;
}

/**
 * The library row a name is FILED under: its own name, or the alias table's
 * hand-checked answer — never a substring match.
 *
 * `findGuidedLibraryIndex` goes on to containment, which is right for finding
 * a photo and wrong for deciding that two lifts are one: the catalogue's
 * "Barbell Bench Press" is contained in "Decline Barbell Bench Press", and
 * "Squat" in "Box Squat". Null when only a substring would place the name.
 */
/**
 * Aliases that pick a demo, not a library row to file a lift's history under.
 * The catalogue's plain calf raise opens the bodyweight raise's steps, but a
 * gym's loaded calf raise is not that lift: filed under it, the bodyweight
 * page listed 80 kg sets as its own (review, 2026-10-04).
 */
export const DEMO_ONLY_ALIASES = new Map<string, string | null>([
  ['calf raise', null],
  ['standing calf raise', null],
  ['walking lunge', null],
  // Filed where it always was, so its history does not move when the demo does.
  ['glute bridge hold', 'barbell glute bridge'],
  // A generic name, or a lift done without the row's implement: the row shows
  // the movement, but it is one variant of several (catalog audit, 2026-10-06).
  ['leg curl', null],
  ['rear delt fly', null],
  ['medicine ball slam', null],
  ['sissy squat', null],
]);

export function findFiledLibraryIndex(exerciseName: string, libraryNames: readonly string[]): number | null {
  const normalized = exerciseName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const lowerNames = libraryNames.map((name) => name.trim().toLowerCase());
  const filedOnly = (candidate: string) => {
    if (DEMO_ONLY_ALIASES.has(candidate)) {
      const exact = lowerNames.indexOf(candidate);
      if (exact >= 0) {
        return exact;
      }
      const filedAs = DEMO_ONLY_ALIASES.get(candidate);
      const filedIndex = filedAs ? lowerNames.indexOf(filedAs) : -1;
      return filedIndex >= 0 ? filedIndex : null;
    }
    return resolveExactOrAlias(candidate, lowerNames);
  };
  const direct = filedOnly(normalized);
  if (direct !== null) {
    return direct;
  }
  const stripped = stripCoachingQualifier(normalized);
  return stripped ? filedOnly(stripped) : null;
}

export function findGuidedLibraryIndex(
  exerciseName: string,
  libraryNames: string[],
): number | null {
  const normalized = exerciseName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const lowerNames = libraryNames.map((name) => name.trim().toLowerCase());

  const direct = resolveExactOrAlias(normalized, lowerNames);
  if (direct !== null) {
    return direct;
  }

  let bestIndex: number | null = null;
  let bestLength = Infinity;
  lowerNames.forEach((name, index) => {
    if (name.includes(normalized) && name.length < bestLength) {
      bestIndex = index;
      bestLength = name.length;
    }
  });
  if (bestIndex !== null) {
    return bestIndex;
  }

  // The stripped name gets exact and alias lookups but NOT containment.
  // Dropping the qualifier makes a name shorter and more generic, and
  // containment on a generic name is where it goes wrong: "rows" is inside
  // "seated cable rows", "side plank" is inside "push up to side plank".
  // Anything the strip should reach is worth naming in the alias table.
  const stripped = stripCoachingQualifier(normalized);
  return stripped ? resolveExactOrAlias(stripped, lowerNames) : null;
}

/** Oversized 2-letter initials for the brand-panel media fallback. */
export function getGuidedInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** One line of the run sheet: a warm-up drill, a lift, or a cool-down drill. */
/**
 * One lift inside a run-sheet row. A superset row has several.
 *
 * No badge here: the row itself is drawn as one framed box labelled once, so
 * an A1 and an A2 inside it would state the same fact a second time. The
 * badges live where the lifts are listed WITHOUT a box around them — the
 * programme's day view.
 */
export interface GuidedRunMember {
  name: string;
  /** The lift's slot, so the sheet can say what was logged in it. Null for a drill. */
  slotId: string | null;
}

export interface GuidedRunItem {
  groupIndex: number;
  phase: GuidedPhase;
  name: string;
  /**
   * Sets, for a lift; rounds, for a superset. Null for a drill, which is
   * measured in seconds.
   */
  setCount: number | null;
  /** The lift's slot, so the sheet can say what was logged in it. Null for a drill. */
  slotId: string | null;
  /**
   * Every lift in this row, in the order it is performed.
   *
   * One entry for an ordinary lift or a drill, where it repeats `name` and
   * `slotId`. Two or more for a superset — and the sheet has to list them all,
   * because a superset drawn as its first lift is a row that hides the lift
   * the reader is about to be asked for.
   */
  members: GuidedRunMember[];
  status: 'done' | 'current' | 'upcoming';
}

/**
 * The corrections a rest offers: each lift of the round that has a logged set,
 * with the index of its last one.
 *
 * The block was shown only when the lift the rest belongs to had logged
 * something. A superset rests once per round and the rest step names the lift
 * that closed it, so a round where only the first lift was logged offered no
 * way back to that lift's numbers at all (review, 2026-09-16). Each lift
 * answers for itself now.
 */
export function restRoundCorrections<
  L extends { slotId: string; sets: ReadonlyArray<{ status: string }> },
>(
  members: ReadonlyArray<{ slotId?: string | null; name: string }>,
  liftBySlot: ReadonlyMap<string, L>,
): Array<{ name: string; lift: L; setIndex: number }> {
  const corrections: Array<{ name: string; lift: L; setIndex: number }> = [];
  for (const member of members) {
    const lift = member.slotId ? liftBySlot.get(member.slotId) : undefined;
    if (!lift) {
      continue;
    }
    const setIndex = lift.sets.reduce(
      (latest, set, index) => (set.status === 'completed' ? index : latest),
      -1,
    );
    if (setIndex >= 0) {
      corrections.push({ name: member.name, lift, setIndex });
    }
  }
  return corrections;
}

/** One logged set, as the rest screen's correction sheet lists it. */
export interface LoggedSetRow {
  setIndex: number;
  reps: number;
  loadKg: number | null;
  /**
   * The lift THIS set was logged as, not the exercise's current mode.
   *
   * A mid-exercise swap between a loaded and an unloaded/timed lift leaves
   * earlier rows logged as one lift and later rows as another
   * (`loggedAs` stamps, see liftSegments.ts). The sheet used to read a
   * single mode off the row the reader had selected and apply it to every
   * row, so a 100 kg squat set showed as bare reps once a bodyweight lift
   * was selected, and vice versa (break round 2026-09-29). Each row carries
   * its own answer to `liftOfSet` instead, so the screen never has to borrow
   * one row's mode for another's text.
   */
  trackingMode: WorkoutTrackingMode;
}

/**
 * Every set already logged for a lift, oldest first.
 *
 * The rest screen's correction sheet used to open on the just-logged set
 * alone — the only one its "Fix the set you just logged" title admitted to.
 * A reader who mis-typed set 1 while resting after set 3 had no way back to
 * it from here (#bugs 2026-09-29, "Olisiko järkevä jos näkyis kaikki tehdyt
 * sarjat"). This reads the same field `findSetByIndex` does — `setIndex`,
 * not array position — so a set removed from the middle some day cannot make
 * this list disagree with what Save writes to.
 */
export function loggedSetsOf<
  S extends {
    setIndex: number;
    status: WorkoutSetStatus;
    actualReps?: number;
    actualLoadKg?: number;
    loggedAs?: WorkoutLiftIdentity;
  },
>(
  lift:
    | {
        exerciseName: string;
        trackingMode: WorkoutTrackingMode;
        sourceExerciseName?: string;
        swappedAfterSetIndex?: number;
        sets: ReadonlyArray<S>;
      }
    | null
    | undefined,
): LoggedSetRow[] {
  if (!lift) {
    return [];
  }
  return lift.sets
    .filter((set) => set.status === 'completed')
    .map((set) => ({
      setIndex: set.setIndex,
      reps: set.actualReps ?? 0,
      loadKg: set.actualLoadKg ?? null,
      // liftOfSet, not lift.trackingMode: a set logged before a swap answers
      // for the lift it was done as, whatever the exercise holds now.
      trackingMode: liftOfSet(lift, set).trackingMode,
    }))
    .sort((a, b) => a.setIndex - b.setIndex);
}

/**
 * The whole session as a list, with where you are in it.
 *
 * "Treenin aikana ei ole mitään keinoa nähdä seuraavaa liikettä" (#bugs
 * 2026-08-27). The player shows one step at a time on purpose — you are
 * lifting, not reading — and the rail under it is dots, which say how far
 * along you are and nothing about what they stand for. So the session existed
 * only as the step you were on: to find out whether the last lift was coming
 * you had to reach it.
 *
 * Built from the steps rather than from the groups because the groups carry no
 * names: a group is a shape on a rail, and this is the same session read out
 * loud. The order is the order it will be done in, which is why the first step
 * of each group wins — it names the group before any of its sets do.
 */
export function buildGuidedRunSheet(plan: GuidedStepPlan, stepIndex: number): GuidedRunItem[] {
  const currentGroup = groupIndexOfStep(plan.steps[stepIndex]);
  const items: GuidedRunItem[] = [];
  const byGroup = new Map<number, GuidedRunItem>();

  for (const step of plan.steps) {
    const groupIndex = groupIndexOfStep(step);
    if (groupIndex === null || step.type === 'splash' || step.type === 'finish') {
      continue;
    }
    const isDrill = step.type === 'ready' || step.type === 'drill';
    const name = isDrill ? step.drillName : step.exerciseName;
    const slotId = isDrill ? null : step.slotId;
    const existing = byGroup.get(groupIndex);

    if (existing) {
      // A superset comes back through here once per lift. Its members are
      // collected in the order their first step appears, which is the order
      // they will be performed in.
      if (!existing.members.some((member) => member.name === name && member.slotId === slotId)) {
        existing.members.push({ name, slotId });
      }
      continue;
    }

    const item: GuidedRunItem = {
      groupIndex,
      phase: step.phase,
      name,
      setCount: plan.groups[groupIndex]?.setCount ?? null,
      slotId,
      members: [{ name, slotId }],
      status:
        currentGroup === null || groupIndex > currentGroup
          ? 'upcoming'
          : groupIndex === currentGroup
            ? 'current'
            : 'done',
    };
    byGroup.set(groupIndex, item);
    items.push(item);
  }

  return items;
}

function groupIndexOfStep(step: GuidedStep | undefined): number | null {
  if (!step || step.type === 'splash' || step.type === 'finish') {
    return null;
  }
  return step.groupIndex;
}

export interface GuidedOpening {
  /** Where the resume card and the pinned button point. */
  resumeIndex: number;
  /** The step the screen opens on. */
  stepIndex: number;
  /** Overview, or straight into the session. */
  mode: 'entry' | 'player';
  /**
   * What the entry screen's pinned button does. It always said "start" and
   * always jumped to step 0 — including for a session with half its sets
   * logged, where it sat below the fold as the biggest thing on the screen
   * while the real resume was a quiet card at the top (#bugs 2026-08-29).
   */
  primaryAction: 'resume' | 'start';
}

/**
 * How the guided player opens: which step, which screen, which button.
 *
 * `autoResume` is the reader's own intent, carried in from whatever they
 * pressed. Home's hero says "Jatka treeniä" and the screen behind it used to
 * open on the overview, which is the app asking a question that was already
 * answered — so an arrival that asked to continue skips the overview, and
 * every other arrival still gets it.
 */
export function resolveGuidedOpening(input: {
  steps: GuidedStep[];
  storedIndex: number | null | undefined;
  anchor?: GuidedResumeAnchor | null;
  isSetCompleted: (slotId: string, setIndex: number) => boolean;
  autoResume: boolean;
}): GuidedOpening {
  const resumeIndex = resolveGuidedResumeIndex(
    input.steps,
    input.storedIndex,
    input.isSetCompleted,
    input.anchor ?? null,
  );
  // Step 0 is not a resume, and neither is the finish screen — there is
  // nothing left to continue to there.
  const hasResume = resumeIndex > 0 && input.steps[resumeIndex]?.type !== 'finish';
  const straightIn = input.autoResume && hasResume;

  return {
    resumeIndex,
    stepIndex: straightIn ? resumeIndex : 0,
    mode: straightIn ? 'player' : 'entry',
    primaryAction: hasResume ? 'resume' : 'start',
  };
}

/**
 * The last lift of the work block a step belongs to, in session order.
 *
 * A superset's intro is named for its first lift, so "add after this one"
 * anchored on the intro's slot put the new lift between the pair and broke
 * it in two (review of #bugs 2026-10-01). The block is everything the steps
 * file under the same group; a lift on its own is a block of one.
 */
export function guidedBlockLastSlotId(
  steps: readonly GuidedStep[],
  groupIndex: number,
  slotOrder: readonly string[],
): string | null {
  let last: string | null = null;
  let lastAt = -1;
  for (const step of steps) {
    if ((step.type !== 'position' && step.type !== 'set') || step.groupIndex !== groupIndex) {
      continue;
    }
    const at = slotOrder.indexOf(step.slotId);
    if (last === null || at > lastAt) {
      last = step.slotId;
      lastAt = at;
    }
  }
  return last;
}

/** What a walk-up intro has had added to it so far, in the order they went in. */
export interface WalkAddedLifts {
  /** The names as shown, for the note under the intro's buttons. */
  names: string[];
  /** The slots they got. A lift's slot is known a render after it is dispatched. */
  slotIds: string[];
}

/**
 * The slot the next lift added from a walk-up intro goes after.
 *
 * The first add anchors on the block on screen (`blockLastSlotId`) and the
 * reducer splices right behind it. Every add anchored there again put the
 * second lift BEFORE the first — Bench, Pushdown, Curl, Row with the curl
 * added first (#bugs 2026-10-02) — so a later add goes after the last lift
 * already added from this intro. A lift added earlier that has since left the
 * list no longer counts.
 */
export function resolveWalkAddAnchor(
  blockLastSlotId: string | null,
  introSlotId: string,
  added: WalkAddedLifts | undefined,
  slotOrder: readonly string[],
): string {
  let anchor: string | null = null;
  let anchorAt = -1;
  for (const slotId of added?.slotIds ?? []) {
    const at = slotOrder.indexOf(slotId);
    if (at > anchorAt) {
      anchor = slotId;
      anchorAt = at;
    }
  }
  return anchor ?? blockLastSlotId ?? introSlotId;
}

/**
 * Records the slot a walk-up add got against the intro it was added from, so
 * `resolveWalkAddAnchor` has something to anchor the next add on. Returns a
 * new map; a slot already recorded is not recorded twice.
 */
export function recordWalkAddedSlot(
  current: Record<string, WalkAddedLifts>,
  introSlotId: string,
  insertedSlotId: string,
): Record<string, WalkAddedLifts> {
  const entry = current[introSlotId] ?? { names: [], slotIds: [] };
  if (entry.slotIds.includes(insertedSlotId)) {
    return current;
  }
  return {
    ...current,
    [introSlotId]: { ...entry, slotIds: [...entry.slotIds, insertedSlotId] },
  };
}
