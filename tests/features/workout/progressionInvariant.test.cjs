const assert = require('node:assert/strict');
const { withHelsinkiClocks } = require('../../helpers/clockChange.cjs');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const D = '../../../.test-dist/';
const { workoutReducer, workoutInitialState } = require(D + 'features/workout/workoutState.js');
const { normalizeWorkoutBundle } = require(D + 'features/workout/workoutPersistence.js');
const { adaptCompletedWorkoutSessionForAppDatabase } = require(D + 'features/workout/workoutAppAdapter.js');
const { buildCompletedWorkoutRecord } = require(D + 'state/completedWorkoutPersistence.js');
const { resolveGuidedSetTarget, resolveGuidedSetPlan } = require(D + 'lib/guidedPlayer.js');
const { resolveLastTimeEntry } = require(D + 'lib/exerciseHistoryLookup.js');
const { resolveInstanceBorrowRepWindow } = require(D + 'features/workout/workoutState.js');
const { toWorkingHistoryEntry, programmeSetCount, warmupOffer } = require(D + 'lib/warmupSets.js');
const { buildNextSessionAdvice } = require(D + 'lib/nextSessionAdvice.js');
const { lightenRuntimeTemplate, lightenedFatigueSignal } = require(D + 'lib/recoverySheet.js');
const { cautionAreaLoadedBy } = require(D + 'lib/cautionAreaMatching.js');
const { formatLoadOrRange } = require(D + 'lib/guidedSetWeightSummary.js');

/**
 * Automatic progression, as one seeded random walk (hunt 12, phase 0).
 *
 * A simulated lifter trains one programme day for a few weeks: on plan, short,
 * heavier, a pyramid, warm-ups logged as sets or with the button, a skip, an
 * added set, a swap, an undo, Free weeks between Pro ones, recovery holds, a
 * flagged area, a lighter session, breaks across the 25.10. clock change. Each
 * session runs the real reducer from start to finish and is saved through the
 * real adapter, so the slot history the gate reads and the logs the advice
 * reads come from the same sets. After every start, log and save, P1–P9 are
 * checked against oracles written here, independently of the code under test:
 *
 *   P1 Free: no set moves off last time, and nothing claims a decision.
 *   P2 A borrowed prefill carries no AUTO/hold badge and keeps the borrowed load.
 *   P3 A warm-up (button or inferred) never climbs and never opens set 1.
 *   P4 A set logged as opened: saved planned.basis = the badge the dial showed;
 *      a touched set shows no AUTO/hold.
 *   P5 TODAY chips, the walk-up line and the dial open on the same numbers.
 *   P6 A raise is one step, from the set's own load, earned, with no hold
 *      reason (recovery, flagged area, break, too few sets); never below.
 *   P7 The "Last time" panel and the prefill read the same session.
 *   P8 The bundle saved and loaded again materialises the same session.
 *   P9 Advice never names a weight the gate would not open the next session at.
 *
 * Every invariant counts the cases it actually checked, and the last suites
 * feed each checker a doctored session it must reject (a guard that cannot
 * fail proves nothing). A failure prints the seed and the step log.
 */

// mulberry32: small, seeded, the same sequence on every machine.
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIFTS = [
  { key: 'bench', name: 'Bench Press', mode: 'load_and_reps', alt: 'Dumbbell Bench Press', base: 60 },
  { key: 'squat', name: 'Back Squat', mode: 'load_and_reps', alt: 'Leg Press', base: 80 },
  { key: 'row', name: 'Chest-Supported Row', mode: 'load_and_reps', alt: 'Seated Cable Row', base: 40 },
  { key: 'rdl', name: 'Romanian Deadlift', mode: 'load_and_reps', alt: 'Good Morning', base: 70 },
  { key: 'pullup', name: 'Pull-Up', mode: 'bodyweight', alt: 'Chin-Up', base: 0 },
];
const SCHEMES = [[8, 8], [5, 5], [8, 12], [10, 10], [6, 10]];
const GAPS = [2, 3, 4, 6, 7, 7, 7, 8, 9, 10, 11, 14];
const LEVELS = [null, 'beginner', 'beginner', 'intermediate', 'advanced'];
const STEP_KG = 2.5;
const EPS = 0.001;

const clean = (name) => String(name ?? '').trim().toLowerCase();
const isUnloaded = (mode) => mode === 'bodyweight' || mode === 'hold' || mode === 'duration_minutes';
const tierOf = (level) => (level === 'beginner' || level == null ? 'beginner' : 'intermediate');
const round = (kg) => Math.round(kg / STEP_KG) * STEP_KG;

// ── independent oracles (not the code under test) ───────────────────────────

/** Local calendar days back at the same clock time, as the gate counts a break. */
function daysBack(laterMs, days) {
  const l = new Date(laterMs);
  return new Date(l.getFullYear(), l.getMonth(), l.getDate() - days, l.getHours(), l.getMinutes(), l.getSeconds(), l.getMilliseconds()).getTime();
}
const isBreak = (earlierMs, laterMs) => earlierMs <= daysBack(laterMs, 10);
/**
 * Where the gap before a session ends: when it started (filed startedAt), else
 * its first set, else its finish; a time after the finish is not a start.
 */
function startOf(entry) {
  const finish = Date.parse(entry.performedAt);
  const ok = (ms) => Number.isFinite(ms) && (!Number.isFinite(finish) || ms <= finish);
  const started = typeof entry.startedAt === 'string' ? Date.parse(entry.startedAt) : NaN;
  if (ok(started)) return started;
  const first = entry.sets.map((set) => Date.parse(set.completedAt)).filter(ok).sort((a, b) => a - b)[0];
  return first ?? finish;
}

/**
 * Working sets: light sets before the first heaviest, < 70 %, only when the
 * session ran past the programme. A set filed as added mid-session is not one
 * of the programme's: the rule reads the programme's sets alone and the added
 * ones follow them as work (V1 A4-1, with its pinned trade-off: 30/60/60 + 60
 * added on 3 stays 30/60/60/60).
 */
function oracleWorking(entry, programmeSets) {
  if (!entry) return null;
  const byIndex = (a, b) => a.setIndex - b.setIndex;
  const added = entry.sets.filter((set) => set.addedMidSession === true).sort(byIndex);
  const ordered = entry.sets.filter((set) => set.addedMidSession !== true).sort(byIndex);
  const all = [...ordered, ...added];
  const renumber = (sets) => (added.length ? sets.map((set, i) => ({ ...set, setIndex: i })) : sets);
  if (ordered.length <= programmeSets) return { ...entry, sets: renumber(all), inferred: [] };
  const heaviest = Math.max(0, ...ordered.map((set) => set.loadKg));
  if (!(heaviest > 0)) return { ...entry, sets: renumber(all), inferred: [] };
  const firstHeavy = ordered.findIndex((set) => Math.abs(set.loadKg - heaviest) < EPS);
  const inferred = ordered.filter((set, i) => i < firstHeavy && set.loadKg > 0 && set.loadKg * 10 < heaviest * 7 - 1e-9);
  return { ...entry, sets: all.filter((set) => !inferred.includes(set)).map((set, i) => ({ ...set, setIndex: i })), inferred };
}
const setAt = (entry, index) => (entry ? entry.sets.find((set) => set.setIndex === index) ?? entry.sets[index] ?? null : null);

/** The slot's own sessions for this lift, newest first by time (a date ahead of now ranks last). */
function oracleOwnSessions(slotHistory, slotId, liftName, nowMs, requireLoaded = false) {
  const target = clean(liftName);
  return (slotHistory[slotId] ?? [])
    .filter((entry) => entry && (!clean(entry.exerciseName) || clean(entry.exerciseName) === target))
    .filter((entry) => !entry.skipped && entry.sets.length > 0)
    // An all-zero session is no weight for a loaded lift: the start passes over
    // it to the session before (answersLoadedLift).
    .filter((entry) => !requireLoaded || entry.sets.some((set) => set.loadKg > 0))
    .map((entry, index) => {
      const time = Date.parse(entry.performedAt);
      return { entry, index, rank: Number.isFinite(time) ? (time > nowMs ? -1 : time) : 0 };
    })
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * The sets an entry had to log: the programme's, or fewer when the app asked
 * for fewer (a lighter session files plannedSets; owner Q3: one held session
 * is enough, the next normal one progresses as if it had been a full one).
 */
const needOf = (entry, targetSets) =>
  Number.isInteger(entry && entry.plannedSets) && entry.plannedSets > 0 && entry.plannedSets < targetSets ? entry.plannedSets : targetSets;

/** Every programmed set up to the last heaviest at the ceiling, and enough of them. */
function oracleReady(working, repsMax, targetSets) {
  if (!working || working.sets.length < needOf(working, targetSets)) return false;
  const programmed = working.sets.slice(0, targetSets);
  const heaviest = Math.max(...programmed.map((set) => set.loadKg));
  let last = programmed.length - 1;
  while (last > 0 && Math.abs(programmed[last].loadKg - heaviest) >= EPS) last -= 1;
  return programmed.slice(0, last + 1).every((set) => set.reps >= repsMax);
}
const topOf = (working, targetSets) => Math.max(0, ...working.sets.slice(0, targetSets).map((set) => set.loadKg));

/**
 * Whether the last sessions earned a jump, recovery and flagged areas aside.
 * `against`: every reason it was not (empty when it may have been). `clear`: a
 * case no reading of the rules could hold — the ordinary weekly beginner or the
 * intermediate's confirmed load — so a hold there has to be named.
 */
function oracleEarned(own, latest, { nowMs, repsMax, targetSets, programmeSets, level }) {
  const against = [];
  if (!latest) return { against: ['no session of its own'], clear: false };
  if (latest.sets.length < needOf(latest, targetSets)) against.push(`too few sets (${latest.sets.length} < ${needOf(latest, targetSets)})`);
  const latestMs = Date.parse(own[0].performedAt);
  if (isBreak(latestMs, nowMs)) against.push('break since the last session');
  if (own[1] && isBreak(Date.parse(own[1].performedAt), startOf(own[0]))) against.push('first session back from a break');
  if (!oracleReady(latest, repsMax, targetSets)) against.push('ceiling not reached');
  let clear = false;
  if (tierOf(level) === 'intermediate') {
    const before = own[1] ? oracleWorking(own[1], programmeSets) : null;
    const confirmed = before && oracleReady(before, repsMax, targetSets);
    // Over the positions both logged: a lighter session dropped its last set (owner Q3).
    const positions = before ? Math.min(targetSets, before.sets.length, latest.sets.length) : 0;
    const gap = before ? Math.abs(topOf(before, positions) - topOf(latest, positions)) : Infinity;
    if (!confirmed || gap > 1.25 + EPS) against.push('intermediate without a confirming session');
    clear = against.length === 0 && own.length >= 3 && gap < EPS;
  } else {
    clear = against.length === 0 && own.length >= 2;
  }
  return { against, clear };
}

// ── the walk ────────────────────────────────────────────────────────────────

function makeCounters() {
  return { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0, P8: 0, P9: 0, P4touched: 0, P3inferred: 0, P3button: 0, P2swap: 0, P6held: 0 };
}

/** Thrown by a checker: carries the invariant's name for the doctored-fixture suites. */
function violation(name, message, shape) {
  const error = new Error(`${name}: ${message}`);
  error.invariant = name;
  // A named shape lets KNOWN pass over one recorded bug and nothing else.
  error.shape = shape;
  return error;
}

// Each checker takes a context of what the screen and the store hold at that
// moment and throws violation(Pn, …) or adds to counters. They are exported for
// the self-checks at the bottom.

/** P1 / P2 / P3 / P6 / P7 at a session start, for one exercise. */
function checkStart(ctx, counters) {
  const { exercise, slotHistory, nowMs, options, programmeSets } = ctx;
  const own = oracleOwnSessions(slotHistory, exercise.slotId, exercise.exerciseName, nowMs, !isUnloaded(exercise.trackingMode));
  // Last time's button warm-ups ride on the slot's own entry (completeWorkoutSession).
  const lastWarmups = ctx.lastWarmups ?? (own[0] && own[0].warmups) ?? null;
  const latest = own[0] ? oracleWorking(own[0], programmeSets) : null;
  const targetSets = ctx.targetSets;
  const repsMax = exercise.sets[0].plannedRepsMax;
  const unloaded = isUnloaded(exercise.trackingMode);
  const flaggedArea = cautionAreaLoadedBy(exercise.exerciseName, options.cautionFlags);
  const recoveryHolds = options.fatigueSignal === 'high' || options.fatigueSignal === 'elevated';
  const earned = oracleEarned(own, latest, { nowMs, repsMax, targetSets, programmeSets, level: options.setupLevel });

  exercise.sets.forEach((set) => {
    const ownSet = latest ? setAt(latest, set.setIndex) : null;
    const tag = `set ${set.setIndex} of ${exercise.exerciseName}`;

    // P2 — a borrowed prefill.
    if (set.prefilledFromPerformedAt !== undefined) {
      counters.P2 += 1;
      if (set.autoProgressedFromKg !== undefined || set.autoProgressedFromReps !== undefined) {
        throw violation('P2', `${tag}: borrowed prefill carries AUTO (from ${set.autoProgressedFromKg ?? set.autoProgressedFromReps})`);
      }
      if (set.heldForFatigue || set.heldForCautionArea !== undefined) {
        throw violation('P2', `${tag}: borrowed prefill carries a hold badge`);
      }
      const source = Object.values(slotHistory)
        .flat()
        .find((entry) => entry && entry.performedAt === set.prefilledFromPerformedAt && clean(entry.exerciseName) === clean(exercise.exerciseName));
      if (!source) throw violation('P2', `${tag}: names a borrowed session (${set.prefilledFromPerformedAt}) the store does not hold`);
      const borrowedSet = setAt(oracleWorking(source, programmeSets), set.setIndex);
      if (!borrowedSet || Math.abs(borrowedSet.loadKg - set.plannedLoadKg) >= EPS) {
        throw violation('P2', `${tag}: borrowed load ${set.plannedLoadKg} is not the borrowed set's ${borrowedSet && borrowedSet.loadKg}`);
      }
      const shown = resolveGuidedSetTarget(exercise.sets, set.setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise);
      if (shown && (shown.autoProgressedFromKg !== null || shown.heldForFatigue || shown.heldForCautionArea !== null)) {
        throw violation('P2', `${tag}: the dial shows a badge on a borrowed weight`);
      }
    }

    // P1 — Free.
    if (!options.automatedProgressionEnabled) {
      counters.P1 += 1;
      for (const field of ['autoProgressedFromKg', 'autoProgressedFromReps', 'plannedTargetReps', 'rampTargetReps', 'heldForCautionArea']) {
        if (set[field] !== undefined) throw violation('P1', `${tag}: Free session sets ${field}=${set[field]}`);
      }
      if (set.heldForFatigue) throw violation('P1', `${tag}: Free session sets heldForFatigue`);
      if (ownSet && !unloaded && Math.abs((set.plannedLoadKg ?? NaN) - ownSet.loadKg) >= EPS) {
        throw violation('P1', `${tag}: Free session opens ${set.plannedLoadKg}, last time's own set was ${ownSet.loadKg}`);
      }
    }

    // P3 — inferred warm-ups (logged as ordinary sets) never open a set nor climb.
    if (latest && latest.inferred.length > 0 && ownSet && !unloaded && set.plannedLoadKg !== undefined) {
      counters.P3 += 1;
      counters.P3inferred += 1;
      const allowed = [ownSet.loadKg, ownSet.loadKg + STEP_KG];
      latest.inferred.forEach((warm) => {
        [warm.loadKg, warm.loadKg + STEP_KG].forEach((bad) => {
          if (Math.abs(set.plannedLoadKg - bad) < EPS && !allowed.some((ok) => Math.abs(ok - bad) < EPS)) {
            throw violation('P3', `${tag}: opens ${set.plannedLoadKg} off last time's warm-up ${warm.loadKg} (the work was ${ownSet.loadKg})`);
          }
        });
      });
    }

    // P6 — the raise.
    if (options.automatedProgressionEnabled && ownSet && set.prefilledFromPerformedAt === undefined) {
      counters.P6 += 1;
      const planned = set.plannedLoadKg;
      if (unloaded) {
        if (planned !== undefined && Math.abs(planned - ownSet.loadKg) >= EPS) {
          throw violation('P6', `${tag}: an unloaded lift's load moved ${ownSet.loadKg} -> ${planned}`);
        }
        return;
      }
      if (!(planned >= ownSet.loadKg - EPS)) throw violation('P6', `${tag}: opens ${planned}, below last time's own ${ownSet.loadKg}`);
      if (planned > ownSet.loadKg + STEP_KG + EPS) {
        throw violation('P6', `${tag}: opens ${planned}, more than one step over last time's own ${ownSet.loadKg}`);
      }
      const raised = planned > ownSet.loadKg + EPS;
      if (raised !== (set.autoProgressedFromKg !== undefined)) {
        throw violation('P6', `${tag}: load ${ownSet.loadKg} -> ${planned} but autoProgressedFromKg=${set.autoProgressedFromKg}`);
      }
      if (raised) {
        if (Math.abs(set.autoProgressedFromKg - ownSet.loadKg) >= EPS) {
          throw violation('P6', `${tag}: AUTO from ${set.autoProgressedFromKg}, the set's own load was ${ownSet.loadKg}`);
        }
        const reasons = [...earned.against];
        if (recoveryHolds) reasons.push(`recovery ${options.fatigueSignal}`);
        if (flaggedArea) reasons.push(`flagged area ${flaggedArea}`);
        if (reasons.length > 0) throw violation('P6', `${tag}: raised ${ownSet.loadKg} -> ${planned} despite ${reasons.join(', ')}`);
      }
      // The hold badges: named only for a jump that was earned, and named whenever one was.
      if (set.heldForFatigue && (!recoveryHolds || earned.against.length > 0 || flaggedArea)) {
        throw violation('P6', `${tag}: badged "held for recovery" (signal ${options.fatigueSignal}) but no jump was earned: ${earned.against.join(', ') || (flaggedArea ? `flagged area ${flaggedArea} outranks it` : 'recovery is normal')}`);
      }
      if (set.heldForCautionArea !== undefined && (set.heldForCautionArea !== flaggedArea || earned.against.length > 0)) {
        throw violation('P6', `${tag}: badged "held for ${set.heldForCautionArea}" (flagged ${flaggedArea}) but no jump was earned: ${earned.against.join(', ')}`);
      }
      if (earned.clear && !raised) {
        counters.P6held += 1;
        if (flaggedArea && set.heldForCautionArea !== flaggedArea) {
          throw violation('P6', `${tag}: an earned jump held for the flagged ${flaggedArea} without saying so (heldForCautionArea=${set.heldForCautionArea})`);
        }
        if (!flaggedArea && recoveryHolds && set.heldForFatigue !== true) {
          throw violation('P6', `${tag}: an earned jump held for recovery (${options.fatigueSignal}) without saying so (heldForFatigue=${set.heldForFatigue})`);
        }
      }
    }
  });

  // P3 — button warm-ups: never part of the work, never offered heavier than repeated.
  if (lastWarmups && lastWarmups.length > 0 && !unloaded) {
    const opening = resolveGuidedSetTarget(exercise.sets, exercise.sets[0].setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise);
    const work = opening && opening.loadKg;
    if (latest && setAt(latest, 0) && work != null) {
      counters.P3 += 1;
      counters.P3button += 1;
      lastWarmups.forEach((warm, index) => {
        if (Math.abs(work - warm.loadKg) < EPS && Math.abs(setAt(latest, 0).loadKg - warm.loadKg) >= EPS) {
          throw violation('P3', `set 1 of ${exercise.exerciseName} opens on last time's warm-up ${warm.loadKg}`);
        }
        const offer = warmupOffer(lastWarmups, index, work);
        if (offer.loadKg !== null && offer.loadKg > work - EPS) {
          throw violation('P3', `warm-up ${index + 1} offered at ${offer.loadKg}, not below the work ${work}`);
        }
        if (offer.loadKg !== null && Math.abs(offer.loadKg - (warm.loadKg + STEP_KG)) < EPS) {
          throw violation('P3', `warm-up ${index + 1} climbed ${warm.loadKg} -> ${offer.loadKg}`);
        }
      });
    }
  }

  // P7 — the "Last time" panel reads the session the prefill read.
  const panel = resolveLastTimeEntry({
    slotHistory,
    slotId: exercise.slotId,
    templateSlotId: exercise.templateSlotId ?? null,
    exerciseName: exercise.exerciseName,
    requireLoaded: !unloaded,
    repWindow: resolveInstanceBorrowRepWindow(exercise),
    nowMs,
  });
  const borrowedAt = exercise.sets.map((set) => set.prefilledFromPerformedAt).find((value) => value !== undefined);
  counters.P7 += 1;
  if (own[0]) {
    if (!panel || panel.borrowed || panel.entry.sessionId !== own[0].sessionId) {
      throw violation('P7', `${exercise.exerciseName}: panel shows ${panel ? `${panel.borrowed ? 'borrowed ' : ''}${panel.entry.performedAt}` : 'nothing'}, prefill read ${own[0].performedAt}`);
    }
    const panelWorking = toWorkingHistoryEntry(panel.entry, programmeSetCount(exercise.sets));
    exercise.sets.forEach((set) => {
      const shown = setAt(panelWorking, set.setIndex);
      const base = set.autoProgressedFromKg ?? set.plannedLoadKg;
      if (!unloaded && shown && base !== undefined && Math.abs(shown.loadKg - base) >= EPS) {
        throw violation('P7', `set ${set.setIndex} of ${exercise.exerciseName}: panel lists ${shown.loadKg}, prefill came from ${base}`);
      }
    });
  } else if (borrowedAt !== undefined) {
    if (!panel || !panel.borrowed || panel.entry.performedAt !== borrowedAt) {
      throw violation('P7', `${exercise.exerciseName}: prefill borrowed ${borrowedAt}, panel shows ${panel ? `${panel.borrowed ? 'borrowed ' : 'own '}${panel.entry.performedAt}` : 'nothing'}`);
    }
  } else if (panel && !unloaded && exercise.sets.every((set) => set.plannedLoadKg === undefined)) {
    throw violation('P7', `${exercise.exerciseName}: panel shows ${panel.entry.performedAt} but nothing was prefilled`);
  }
}

/** P5 at a start: chips and walk-up line against what the dial opens on when the sets go as planned. */
function checkSurfaces(ctx, counters) {
  const { exercise, asPlanned } = ctx;
  if (!asPlanned || exercise.sets.some((set) => set.status !== 'pending')) return;
  const sets = exercise.sets;
  const chips = resolveGuidedSetPlan(sets, sets[0].setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise);
  const resolve = (index) => resolveGuidedSetTarget(sets, index, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise);
  const first = resolve(sets[0].setIndex);
  // GuidedPlayerScreen walkNext, its numbers.
  const ramp = sets.some((set) => set.rampTargetReps !== undefined);
  const walkReps = ramp
    ? sets.reduce((shown, set, index) => {
        const own = set.rampTargetReps ?? (index > 0 ? shown[index - 1] : undefined);
        shown.push(own ?? resolve(set.setIndex)?.reps ?? set.plannedRepsMax);
        return shown;
      }, [])
    : sets.map(() => first.reps);
  // The card prints one weight or a range off the sets it can resolve now.
  const walkLoad = formatLoadOrRange(sets.map((set) => resolve(set.setIndex)?.loadKg ?? null).filter((kg) => kg != null));
  const plannedLoad = formatLoadOrRange(asPlanned.map((opened) => opened.loadKg).filter((kg) => kg != null));
  counters.P5 += 1;
  asPlanned.forEach((opened, index) => {
    const tag = `set ${index} of ${exercise.exerciseName}`;
    if (chips[index].reps !== opened.reps) {
      const own = sets[index];
      const unplanned = own.plannedLoadKg === undefined && own.plannedTargetReps === undefined && own.rampTargetReps === undefined;
      throw violation('P5', `${tag}: TODAY chip says ${chips[index].reps}, the dial opens on ${opened.reps} when the sets before go as planned (chips ${chips.map((c) => c.reps).join('/')}, dial ${asPlanned.map((o) => o.reps).join('/')})`, unplanned ? 'unplanned-set' : undefined);
    }
    if (walkReps[index] !== opened.reps) {
      throw violation('P5', `${tag}: walk-up line says ${walkReps.join('/')}, the dial opens on ${asPlanned.map((o) => o.reps).join('/')}`);
    }
    if (index === 0 && !isUnloaded(exercise.trackingMode) && walkLoad !== plannedLoad) {
      throw violation('P5', `${exercise.exerciseName}: walk-up weight ${walkLoad}, the dial opens on ${plannedLoad} (${asPlanned.map((o) => o.loadKg).join('/')})`);
    }
  });
}

/** P4 at a log: what the dial showed before the reader touched it, and what is saved. */
function badgeOf(shown) {
  if (shown.autoProgressedFromKg !== null || shown.autoProgressedFromReps !== null) return 'progressed';
  if (shown.heldForCautionArea) return 'held_caution';
  if (shown.heldForFatigue) return 'held_recovery';
  if (shown.prefilledFromPerformedAt) return 'borrowed';
  return 'plain';
}
const BASIS_OF_BADGE = { progressed: ['progressed'], held_caution: ['held_caution'], held_recovery: ['held_recovery'], borrowed: ['borrowed'], plain: ['repeat', 'none', 'added'] };

function checkSaved(ctx, counters) {
  const { opened, savedSet, tag } = ctx;
  if (!savedSet || !savedSet.planned) throw violation('P4', `${tag}: saved without a plan`);
  counters.P4 += 1;
  const badge = badgeOf(opened);
  if (!BASIS_OF_BADGE[badge].includes(savedSet.planned.basis)) {
    const shape = badge === 'plain' && savedSet.planned.basis === 'borrowed' && opened.loadKg === null ? 'unloaded-borrowed' : undefined;
    throw violation('P4', `${tag}: the dial showed ${badge}, the saved plan says ${savedSet.planned.basis}`, shape);
  }
}

function checkTouched(ctx, counters) {
  const { shown, tag } = ctx;
  counters.P4touched += 1;
  if (shown.autoProgressedFromKg !== null || shown.heldForFatigue || shown.heldForCautionArea !== null || shown.prefilledFromPerformedAt !== null) {
    throw violation('P4', `${tag}: a weight the reader changed still shows ${badgeOf(shown)}`);
  }
}

/** P8: the same history, saved and loaded, materialises the same sets. */
function checkReload(ctx, counters) {
  counters.P8 += 1;
  if (JSON.stringify(ctx.before) !== JSON.stringify(ctx.after)) {
    throw violation('P8', `reload changed the session:\n    before ${JSON.stringify(ctx.before)}\n    after  ${JSON.stringify(ctx.after)}`);
  }
}

/** P9: a weight the advice named, against the next session's opening. */
function checkAdvice(ctx, counters) {
  const { advice, exercise, tag } = ctx;
  if (advice.kind === 'none') return;
  counters.P9 += 1;
  const loads = exercise.sets.map((set) => set.plannedLoadKg).filter((kg) => typeof kg === 'number');
  const top = loads.length ? Math.max(...loads) : null;
  const named = advice.kind === 'raise' ? advice.toKg : advice.kg;
  if (top === null || Math.abs(top - named) >= EPS) {
    throw violation('P9', `${tag}: advice ${advice.kind} names ${named} kg, the next session opens the top set at ${top} (${loads.join('/')})`);
  }
  if (advice.kind === 'raise' && !exercise.sets.some((set) => set.autoProgressedFromKg !== undefined)) {
    throw violation('P9', `${tag}: advice says raise to ${named} kg, the next session raised nothing`);
  }
}

function viewOf(session) {
  return session.exercises.map((exercise) => ({
    slot: exercise.slotId,
    name: exercise.exerciseName,
    sets: exercise.sets.map((set) => [
      set.setIndex, set.draftLoadText, set.plannedLoadKg ?? null, set.autoProgressedFromKg ?? null, set.heldForFatigue ?? null,
      set.heldForCautionArea ?? null, set.prefilledFromPerformedAt ?? null, set.plannedTargetReps ?? null,
      set.autoProgressedFromReps ?? null, set.rampTargetReps ?? null,
    ]),
  }));
}

/** Logs every pending set of one exercise on plan (on a copy) and returns the dial's opening per set. */
function dialAsPlanned(state, slotId, startMs) {
  let s = state;
  const out = [];
  let clock = startMs;
  const exercise = s.activeSession.exercises.find((item) => item.slotId === slotId);
  for (const set of exercise.sets.filter((item) => item.status === 'pending')) {
    const current = s.activeSession.exercises.find((item) => item.slotId === slotId);
    const target = resolveGuidedSetTarget(current.sets, set.setIndex, current.trackingMode, current.swappedAfterSetIndex, current);
    if (!target || (!isUnloaded(current.trackingMode) && target.loadKg === null)) return null;
    out.push({ loadKg: target.loadKg, reps: target.reps });
    clock += 60000;
    s = workoutReducer(s, { type: 'set/updateDraft', payload: { slotId, setIndex: set.setIndex, patch: { loadText: target.loadKg === null ? '' : String(target.loadKg), repsText: String(target.reps) } } });
    const next = workoutReducer(s, { type: 'set/complete', payload: { slotId, setIndex: set.setIndex, nowMs: clock, unitPreference: 'kg' } });
    if (next.activeSession.exercises.find((item) => item.slotId === slotId).sets.find((item) => item.setIndex === set.setIndex).status !== 'completed') return null;
    s = next;
  }
  return out;
}

function runSequence(seed, sessionsPerRun, counters, notes) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  const log = [];
  const fail = (error) => {
    // A failure already on record (KNOWN) is counted, not thrown: the walk
    // goes on checking every other invariant.
    const known = error.invariant && KNOWN[error.invariant];
    if (known && known.matches(error)) {
      notes.known[error.invariant] = (notes.known[error.invariant] ?? 0) + 1;
      if (!notes.firstKnown[error.invariant]) notes.firstKnown[error.invariant] = `seed ${seed}: ${error.message}`;
      return;
    }
    // PROGRESSION_INVARIANT_COLLECT=1: count every violation instead of stopping (hunting aid).
    if (error.invariant && process.env.PROGRESSION_INVARIANT_COLLECT) {
      const list = (notes.collected[error.invariant] = notes.collected[error.invariant] ?? []);
      list.push(`seed ${seed}: ${error.message}${list.length < 3 ? `\n  ${log.slice(-12).join('\n  ')}` : ''}`);
      return;
    }
    error.message = `seed ${seed}: ${error.message}\n  ${log.join('\n  ')}`;
    throw error;
  };
  const guard = (fn) => {
    try {
      fn();
    } catch (error) {
      fail(error);
    }
  };

  const level = pick(LEVELS);
  const chosen = [...LIFTS].sort(() => random() - 0.5).slice(0, 2 + Math.floor(random() * 2));
  const programme = {
    id: `tpl_inv_${seed}`,
    name: 'Invariant programme',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'day_a',
        name: 'Day A',
        orderIndex: 0,
        exercises: chosen.map((lift) => {
          const [repsMin, repsMax] = lift.mode === 'bodyweight' ? [8, 8] : pick(SCHEMES);
          return {
            id: `ex_${lift.key}`, exerciseName: lift.name, slotId: lift.key, role: 'primary', progressionPriority: 'high',
            trackingMode: lift.mode, sets: 2 + Math.floor(random() * 3), repsMin, repsMax,
            restSecondsMin: 90, restSecondsMax: 120, substitutionGroup: `grp_${lift.key}`,
          };
        }),
      },
    ],
  };
  const lookupTemplate = (id) => (id === programme.id ? programme : null);
  log.push(`level=${level} lifts=${programme.sessions[0].exercises.map((e) => `${e.exerciseName} ${e.sets}x${e.repsMin}-${e.repsMax}`).join(', ')}`);

  let state = { ...workoutInitialState, hydrated: true, isRestoring: false };
  let db = { workoutSessions: [], exerciseLogs: [] };
  let clock = new Date(2026, 8, 1 + Math.floor(random() * 50), 6 + Math.floor(random() * 16), Math.floor(random() * 60)).getTime();
  let ids = 0;
  const createId = (prefix) => `${prefix}_${seed}_${++ids}`;

  // A lift done before in a free workout: the first session may borrow it.
  if (chance(0.35)) {
    const lift = pick(chosen.filter((item) => item.mode !== 'bodyweight').concat(chosen[0]));
    const row = programme.sessions[0].exercises.find((e) => e.exerciseName === lift.name);
    const reps = row.repsMin + Math.floor(random() * (row.repsMax - row.repsMin + 3));
    const performedAt = new Date(clock - 3 * 86400000).toISOString();
    state = workoutReducer(state, {
      type: 'history/recordLogged',
      payload: {
        performedAt, sessionId: `free_${seed}`, templateName: 'Free',
        exercises: [{ exerciseName: lift.name, sets: [0, 1, 2].map((i) => ({ setIndex: i, loadKg: lift.base ? lift.base - 10 + 5 * i : 0, reps })) }],
      },
    });
    log.push(`free workout ${lift.name} ${reps} reps at ${performedAt}`);
  }

  let pendingAdvice = []; // from the last save, checked at the next start
  let lastStartMs = null;

  for (let session = 0; session < sessionsPerRun; session += 1) {
    if (session > 0) {
      const gap = pick(GAPS);
      const d = new Date(clock);
      clock = new Date(d.getFullYear(), d.getMonth(), d.getDate() + gap, 6 + Math.floor(random() * 16), Math.floor(random() * 60)).getTime();
    }
    const pro = chance(0.85);
    const lighten = pro && chance(0.08);
    const fatigue = lighten ? lightenedFatigueSignal(pick(['normal', 'high'])) : pick([undefined, 'normal', 'normal', 'normal', 'elevated', 'high']);
    const cautionFlags = chance(0.15) ? [{ area: pick(['knees', 'lower_back', 'shoulders']), level: 'careful', refinements: [] }] : [];
    const tpl = lighten ? lightenRuntimeTemplate(programme) : programme;
    const options = { automatedProgressionEnabled: pro, setupLevel: level, fatigueSignal: fatigue, nowMs: clock, cautionFlags };
    log.push(`start ${new Date(clock).toISOString()} pro=${pro} fatigue=${fatigue} lighten=${lighten} caution=${cautionFlags.map((f) => f.area).join(',')}`);
    const historyBefore = state.history;
    state = workoutReducer({ ...state, activeSession: null, completionSummary: null }, {
      type: 'session/startFromRuntimeTemplate',
      payload: { template: tpl, sessionOrderIndex: session, unitPreference: 'kg', progression: options },
    });
    const startedAt = new Date(clock).toISOString();
    state = { ...state, activeSession: { ...state.activeSession, startedAt, updatedAt: startedAt } };

    {
      // P1 P2 P3 P6 P7, P5, P9.
      state.activeSession.exercises.forEach((exercise) => {
        const row = tpl.sessions[0].exercises.find((e) => e.slotId === exercise.templateSlotId);
        const programmeSets = row.programmeSets ?? row.sets;
        guard(() => checkStart({
          exercise, slotHistory: state.history.slotHistory, nowMs: clock, options, programmeSets, targetSets: row.sets,
        }, counters));
        guard(() => checkSurfaces({ exercise, asPlanned: dialAsPlanned(state, exercise.slotId, clock) }, counters));
        const advice = pendingAdvice.find((item) => item.slotId === exercise.slotId);
        const comparable =
          advice && pro && !lighten && (fatigue === undefined || fatigue === 'normal') &&
          !cautionAreaLoadedBy(exercise.exerciseName, cautionFlags) && lastStartMs !== null &&
          !isBreak(Date.parse(advice.performedAt), clock) && clean(advice.liftName) === clean(exercise.exerciseName);
        if (comparable) {
          guard(() => checkAdvice({ advice: advice.advice, exercise, tag: `${exercise.exerciseName} after ${advice.performedAt}` }, counters));
        } else if (advice && advice.advice.kind !== 'none') {
          notes.p9NotComparable += 1;
        }
      });

      // P8: the bundle round trip.
      const reloaded = normalizeWorkoutBundle(JSON.parse(JSON.stringify({ activeSession: null, history: historyBefore, activeCardio: null, freestyleDraft: null })));
      const again = workoutReducer({ ...workoutInitialState, hydrated: true, isRestoring: false, history: reloaded.history }, {
        type: 'session/startFromRuntimeTemplate',
        payload: { template: tpl, sessionOrderIndex: session, unitPreference: 'kg', progression: options },
      });
      guard(() => checkReload({ before: viewOf(state.activeSession), after: viewOf(again.activeSession) }, counters));
    }
    lastStartMs = clock;

    // ── the session ──
    const opened = new Map(); // `${slot}#${setIndex}` -> dial before logging, when logged as opened
    const tick = () => (clock += 60000 + Math.floor(random() * 180000));
    const slots = state.activeSession.exercises.map((exercise) => exercise.slotId);
    // Slots whose warm-up rows are filed as an install from before the added
    // set was marked (2026-10-11) would file them: no addedMidSession, no saved
    // plan. Only there does the 70 % rule still infer a warm-up from sets
    // (V1 A4-1: a marked added set leaves the programme's sets as work).
    const legacySlots = new Set();
    for (const slotId of slots) {
      const lift = chosen.find((item) => item.key === state.activeSession.exercises.find((e) => e.slotId === slotId).templateSlotId);
      const behaviour = pick(['ceiling', 'ceiling', 'ceiling', 'ceiling', 'over', 'short', 'short', 'heavier', 'ramp', 'warmRows', 'button', 'skip', 'skipMid', 'addSet', 'swap', 'undo', 'pending', 'repeat']);
      const legacy = behaviour === 'warmRows' && chance(0.5);
      if (legacy) legacySlots.add(slotId);
      log.push(`  ${lift.name}: ${behaviour}${legacy ? ' (filed as legacy)' : ''}`);
      const current = () => state.activeSession.exercises.find((e) => e.slotId === slotId);
      if (behaviour === 'pending') continue;
      if (behaviour === 'skip') {
        state = workoutReducer(state, { type: 'exercise/skip', payload: { slotId } });
        continue;
      }
      if (behaviour === 'button' && !isUnloaded(current().trackingMode)) {
        const first = resolveGuidedSetTarget(current().sets, 0, current().trackingMode, current().swappedAfterSetIndex, current());
        const work = first && first.loadKg ? first.loadKg : lift.base;
        const count = 1 + Math.floor(random() * 2);
        for (let index = 0; index < count; index += 1) {
          const ownLatest = oracleOwnSessions(state.history.slotHistory, slotId, current().exerciseName, clock, true)[0];
          const offer = warmupOffer(ownLatest && ownLatest.warmups, index, work);
          const loadKg = offer.loadKg ?? round(work * 0.5);
          if (loadKg > 0) state = workoutReducer(state, { type: 'exercise/logWarmup', payload: { slotId, loadKg, reps: offer.reps, completedAt: new Date(tick()).toISOString() } });
        }
      }
      const setCount = current().sets.length;
      let undone = false;
      for (let index = 0; index < setCount; index += 1) {
        let exercise = current();
        const set = exercise.sets[index];
        if (!set || set.status !== 'pending') continue;
        if (behaviour === 'swap' && index === Math.min(1, setCount - 1) && exercise.exerciseName === lift.name) {
          state = workoutReducer(state, { type: 'exercise/swap', payload: { slotId, exerciseName: lift.alt, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' } });
          exercise = current();
          // P2 after the swap: the replanned sets carry no badge, and a borrowed weight is the borrowed set's.
          exercise.sets.filter((item) => item.status === 'pending').forEach((item) => {
            counters.P2swap += 1;
            if (item.autoProgressedFromKg !== undefined || item.heldForFatigue || item.heldForCautionArea !== undefined || item.plannedTargetReps !== undefined || item.rampTargetReps !== undefined) {
              guard(() => {
                throw violation('P2', `set ${item.setIndex}: swapped to ${lift.alt} and still carries the gate's badge or target`);
              });
            }
          });
        }
        if (behaviour === 'repeat' && index > 0 && exercise.sets[index - 1].status === 'completed') {
          state = workoutReducer(state, { type: 'set/repeatLast', payload: { slotId, setIndex: set.setIndex, nowMs: tick(), unitPreference: 'kg' } });
          continue;
        }
        if (behaviour === 'skipMid' && index === 1) {
          state = workoutReducer(state, { type: 'exercise/skip', payload: { slotId } });
          break;
        }
        const shown = resolveGuidedSetTarget(exercise.sets, set.setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise);
        const unloaded = isUnloaded(exercise.trackingMode);
        let load = unloaded ? null : shown.loadKg ?? (lift.base || 20);
        let reps = shown.reps;
        const max = set.plannedRepsMax;
        if (behaviour === 'ceiling' || behaviour === 'button' || behaviour === 'addSet' || behaviour === 'repeat' || behaviour === 'undo' || behaviour === 'swap') reps = Math.max(reps, max);
        if (behaviour === 'over') reps = max + 2;
        if (behaviour === 'short' && index === setCount - 1) reps = Math.max(1, Math.min(reps, max) - 2);
        if (behaviour === 'heavier' && index === 0 && !unloaded) load += pick([2.5, 5, -5]);
        // A ramp and a warm-up row are dialled off the plan, set by set: the dial
        // itself would carry the light first set onto the rest.
        const planBase = set.plannedLoadKg ?? load;
        if (behaviour === 'ramp' && !unloaded) load = round(planBase * [0.75, 0.85, 1, 1, 1][index]);
        if (behaviour === 'warmRows' && !unloaded) load = index === 0 ? round(planBase * 0.5) : planBase;
        reps = Math.min(reps, 30);
        const tag = `set ${set.setIndex} of ${exercise.exerciseName} (session ${session})`;
        const asOpened = unloaded ? reps === shown.reps : load === shown.loadKg && shown.loadKg === set.plannedLoadKg;
        state = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId, setIndex: set.setIndex, patch: { loadText: load === null ? '' : String(load), repsText: String(reps) } } });
        if (!unloaded && load !== shown.loadKg) {
          const after = current();
          guard(() => checkTouched({ shown: resolveGuidedSetTarget(after.sets, set.setIndex, after.trackingMode, after.swappedAfterSetIndex, after), tag }, counters));
        }
        state = workoutReducer(state, { type: 'set/complete', payload: { slotId, setIndex: set.setIndex, nowMs: tick(), unitPreference: 'kg' } });
        const unloadedFirstOnly = unloaded && exercise.sets.some((item) => item.status === 'completed');
        // Keyed by the moment it was logged: a saved log numbers each lift's sets from 0 (liftSegments).
        const loggedAt = current().sets.find((item) => item.setIndex === set.setIndex).completedAt;
        if (asOpened && !unloadedFirstOnly && loggedAt) opened.set(`${slotId}#${loggedAt}#${exercise.exerciseName}#${set.setIndex}`, shown);
        if (behaviour === 'undo' && index === 0 && !undone) {
          undone = true;
          state = workoutReducer(state, { type: 'set/undo', payload: { slotId, setIndex: set.setIndex, unitPreference: 'kg' } });
          opened.delete(`${slotId}#${loggedAt}#${exercise.exerciseName}#${set.setIndex}`);
          index -= 1;
        }
      }
      if ((behaviour === 'addSet' || behaviour === 'warmRows') && current().sets.every((item) => item.status !== 'pending')) {
        state = workoutReducer(state, { type: 'exercise/addSet', payload: { slotId } });
        const added = current().sets[current().sets.length - 1];
        const shown = resolveGuidedSetTarget(current().sets, added.setIndex, current().trackingMode, current().swappedAfterSetIndex, current());
        const load = isUnloaded(current().trackingMode) ? '' : String(shown.loadKg ?? lift.base + (behaviour === 'addSet' && chance(0.5) ? 5 : 0));
        state = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId, setIndex: added.setIndex, patch: { loadText: load, repsText: String(Math.max(1, shown.reps - 2)) } } });
        state = workoutReducer(state, { type: 'set/complete', payload: { slotId, setIndex: added.setIndex, nowMs: tick(), unitPreference: 'kg' } });
      }
    }

    // ── finish and save ──
    const performedAt = new Date(tick()).toISOString();
    let finished = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt } });
    const done = finished.activeSession;
    const adapted = adaptCompletedWorkoutSessionForAppDatabase(done, Date.parse(performedAt));
    const record = buildCompletedWorkoutRecord(adapted, createId);
    if (record) {
      db = { workoutSessions: [...db.workoutSessions, record.session], exerciseLogs: [...db.exerciseLogs, ...record.logs] };
      // P4: every set logged as opened, against its saved plan.
      opened.forEach((shown, key) => {
        const [slotId, loggedAt, liftName, setIndex] = key.split('#');
        const savedLog = record.logs.find((item) => item.slotId === slotId && clean(item.exerciseNameSnapshot) === clean(liftName));
        const savedSet = savedLog && (savedLog.sets ?? []).find((item) => item.completedAt === loggedAt && item.kind !== 'warmup');
        const where = record.logs.filter((item) => item.slotId === slotId).map((item) => `${item.exerciseNameSnapshot}[${(item.sets ?? []).map((set) => `${set.orderIndex}:${set.status}:${set.planned ? set.planned.basis : '-'}`).join(' ')}]`).join(' + ');
        guard(() => checkSaved({ opened: shown, savedSet, tag: `set ${setIndex} of ${liftName} (session ${session}; saved ${where})` }, counters));
      });
    }
    if (legacySlots.size > 0) {
      const slotHistory = { ...finished.history.slotHistory };
      legacySlots.forEach((slotId) => {
        slotHistory[slotId] = (slotHistory[slotId] ?? []).map((entry) =>
          entry.sessionId !== done.sessionId
            ? entry
            : { ...entry, sets: entry.sets.map(({ addedMidSession, ...set }) => set) });
      });
      finished = { ...finished, history: { ...finished.history, slotHistory } };
      if (record) {
        const own = new Set(record.logs.filter((item) => legacySlots.has(item.slotId)).map((item) => item.id));
        db = {
          ...db,
          exerciseLogs: db.exerciseLogs.map((item) =>
            own.has(item.id) ? { ...item, sets: (item.sets ?? []).map(({ planned, ...set }) => set) } : item),
        };
      }
    }
    pendingAdvice = [];
    done.exercises.forEach((exercise) => {
      if (!record || exercise.status === 'swapped' || exercise.sourceExerciseName || isUnloaded(exercise.trackingMode)) return;
      const advice = buildNextSessionAdvice({
        liftName: exercise.exerciseName, sessionId: done.sessionId, sessions: db.workoutSessions, logs: db.exerciseLogs, lookupTemplate, level,
      });
      pendingAdvice.push({ slotId: exercise.slotId, liftName: exercise.exerciseName, performedAt, advice });
    });
    state = workoutReducer(finished, { type: 'session/clearCompletedSession' });
  }
}

function runAll(sequences, sessionsPerRun) {
  const counters = makeCounters();
  const notes = { p9NotComparable: 0, known: {}, firstKnown: {}, collected: {} };
  withHelsinkiClocks(() => {
    for (let seed = 1; seed <= sequences; seed += 1) {
      runSequence(seed, sessionsPerRun, counters, notes);
    }
  });
  return { counters, notes };
}

// One run shared by the per-invariant suites: each reports its own name and
// count, and a failure names the invariant it broke.
let shared = null;
function sharedRun() {
  if (!shared) {
    try {
      shared = { result: runAll(SEQUENCES, SESSIONS) };
    } catch (error) {
      shared = { error };
    }
  }
  return shared;
}
const SEQUENCES = 160;
const SESSIONS = 7;

/** Known, recorded failures: the suite prints SKIP rather than go red (tests/hunt/run12/progression/findings.json). */
const KNOWN = {};

function invariantSuite(name, title, minimum) {
  return {
    name: `progression invariant ${name}: ${title}`,
    run() {
      const { result, error } = sharedRun();
      if (error) {
        if (error.invariant === name) throw error;
        throw new Error(`the walk stopped at ${error.invariant ?? 'an error'} before ${name} was done: ${error.message.split('\n')[0]}`);
      }
      if (KNOWN[name]) {
        // Recorded, not hidden: the one shape on record is counted and printed;
        // every other violation of this invariant still fails the walk.
        console.log(`SKIP ${name} (one shape only, finding ${KNOWN[name].finding}): ${KNOWN[name].reason} — ${result.notes.known[name] ?? 0} hits; first: ${(result.notes.firstKnown[name] ?? 'none').split('\n')[0]}`);
      }
      const count = result.counters[name];
      assert.ok(count >= minimum, `${name} checked only ${count} cases (want >= ${minimum}): the walk no longer reaches it`);
    },
  };
}

// ── doctored fixtures: each checker must reject the shape it guards ─────────

function baseSet(overrides = {}) {
  return { setIndex: 0, status: 'pending', plannedRepsMin: 8, plannedRepsMax: 8, draftLoadText: '60', draftRepsText: '', plannedLoadKg: 60, edited: false, ...overrides };
}
function baseExercise(sets, overrides = {}) {
  return { slotId: 'tpl:day:bench', templateSlotId: 'bench', exerciseName: 'Bench Press', trackingMode: 'load_and_reps', sets, ...overrides };
}
const hEntry = (iso, reps, loads, extra = {}) => ({
  slotId: 'tpl:day:bench', templateId: 'tpl', templateName: 'T', exerciseName: 'Bench Press', substitutionGroup: '', performedAt: iso,
  sessionId: `s_${iso}`, skipped: false, sets: reps.map((r, i) => ({ setIndex: i, loadKg: Array.isArray(loads) ? loads[i] : loads, reps: r, completedAt: iso, effort: null })), ...extra,
});
const expectViolation = (name, fn) => {
  assert.throws(fn, (error) => error.invariant === name, `${name}: the checker accepted a doctored session`);
};
const expectPass = (fn) => {
  const counters = makeCounters();
  fn(counters);
  return counters;
};

module.exports = [
  invariantSuite('P1', 'Free sessions open on last time and claim no decision', 100),
  invariantSuite('P2', 'a borrowed prefill carries no AUTO or hold badge and keeps the borrowed load', 20),
  invariantSuite('P3', 'a warm-up (button or inferred) never climbs and never opens set 1', 20),
  invariantSuite('P4', 'a set logged as opened saves the basis its badge showed; a touched set shows no badge', 500),
  invariantSuite('P5', 'TODAY chips, the walk-up line and the dial open on the same numbers', 300),
  invariantSuite('P6', 'a raise is one step from the set\'s own load, earned, never with a hold reason', 500),
  invariantSuite('P7', 'the Last time panel and the prefill read the same session', 300),
  invariantSuite('P8', 'a saved and reloaded bundle materialises the same session', 300),
  invariantSuite('P9', 'advice never names a weight the next session would not open at', 30),
  {
    name: 'progression invariant walk: reaches every shape the guards were written for',
    run() {
      const { result, error } = sharedRun();
      if (error) throw error;
      const c = result.counters;
      // The shapes each guard does not expect, counted: a guard never fed one passes by default.
      assert.ok(c.P3inferred > 0, `no session ever inferred a warm-up row (P3inferred=${c.P3inferred})`);
      assert.ok(c.P3button > 0, `no session ever repeated button warm-ups (P3button=${c.P3button})`);
      assert.ok(c.P2swap > 0, `no swap ever replanned a set (P2swap=${c.P2swap})`);
      assert.ok(c.P4touched > 0, `no set was ever logged off its opening (P4touched=${c.P4touched})`);
      assert.ok(c.P6held > 0, `no earned jump was ever held (P6held=${c.P6held})`);
    },
  },
  {
    name: 'progression invariant self-check: each checker rejects a doctored session (P1-P4, P6-P9)',
    run() {
      withHelsinkiClocks(() => {
        const now = new Date(2026, 9, 8, 18).getTime();
        const last = hEntry(new Date(2026, 9, 1, 18).toISOString(), [8, 8, 8], 60);
        const prev = hEntry(new Date(2026, 8, 24, 18).toISOString(), [8, 8, 8], 60);
        const slotHistory = { 'tpl:day:bench': [last, prev] };
        const pro = { automatedProgressionEnabled: true, setupLevel: 'beginner', fatigueSignal: 'normal', cautionFlags: [] };
        const ctx = (sets, extra = {}) => ({ exercise: baseExercise(sets), slotHistory, nowMs: now, options: pro, programmeSets: 3, targetSets: 3, ...extra });
        const raised = [0, 1, 2].map((i) => baseSet({ setIndex: i, plannedLoadKg: 62.5, draftLoadText: '62.5', autoProgressedFromKg: 60 }));

        // The honest session passes and is counted.
        assert.ok(expectPass((c) => checkStart(ctx(raised), c)).P6 === 3);
        // P6: a raise on a day recovery holds.
        expectViolation('P6', () => checkStart(ctx(raised, { options: { ...pro, fatigueSignal: 'high' } }), makeCounters()));
        // P6: recovery held an earned jump and the badge was dropped — the planted "drop heldForFatigue" shape.
        const held = [0, 1, 2].map((i) => baseSet({ setIndex: i, heldForFatigue: true }));
        assert.ok(expectPass((c) => checkStart(ctx(held, { options: { ...pro, fatigueSignal: 'high' } }), c)).P6held === 3);
        expectViolation('P6', () => checkStart(ctx(held.map((s) => ({ ...s, heldForFatigue: undefined })), { options: { ...pro, fatigueSignal: 'high' } }), makeCounters()));
        // P6: "held for recovery" on a jump never earned, and "held for knees" on a lift no flag names.
        expectViolation('P6', () => checkStart(ctx(held, { options: { ...pro, fatigueSignal: 'high' }, slotHistory: { 'tpl:day:bench': [hEntry(last.performedAt, [8, 8, 6], 60), prev] } }), makeCounters()));
        expectViolation('P6', () => checkStart(ctx([baseSet({ heldForCautionArea: 'knees' })]), makeCounters()));
        // P6: two steps, and a raise off a session short of the ceiling.
        expectViolation('P6', () => checkStart(ctx(raised.map((s) => ({ ...s, plannedLoadKg: 65 }))), makeCounters()));
        const shortHistory = { 'tpl:day:bench': [hEntry(last.performedAt, [8, 8, 6], 60), prev] };
        expectViolation('P6', () => checkStart(ctx(raised, { slotHistory: shortHistory }), makeCounters()));
        // P6: a pyramid raised off its heaviest load on every set (the 72.5 x 3 bug).
        const pyramid = { 'tpl:day:bench': [hEntry(last.performedAt, [8, 8, 8], [50, 60, 70]), hEntry(prev.performedAt, [8, 8, 8], [50, 60, 70])] };
        expectViolation('P6', () => checkStart(ctx(raised.map((s) => ({ ...s, plannedLoadKg: 72.5, autoProgressedFromKg: 70 })), { slotHistory: pyramid }), makeCounters()));
        assert.ok(expectPass((c) => checkStart(ctx([50, 60, 70].map((kg, i) => baseSet({ setIndex: i, plannedLoadKg: kg + 2.5, autoProgressedFromKg: kg })), { slotHistory: pyramid }), c)).P6 === 3);

        // P1: Free with an AUTO badge or a lowered target.
        const free = { ...pro, automatedProgressionEnabled: false };
        expectViolation('P1', () => checkStart(ctx(raised, { options: free }), makeCounters()));
        expectViolation('P1', () => checkStart(ctx([baseSet({ plannedTargetReps: 6 })], { options: free }), makeCounters()));

        // P2: a borrowed weight with an AUTO badge (the planted "AUTO on a borrowed prefill" shape).
        const borrowedFrom = hEntry(new Date(2026, 9, 3, 18).toISOString(), [8, 8, 8], 55, { slotId: 'logged:bench press', templateId: '' });
        const borrowCtx = (sets) => ({ ...ctx(sets), slotHistory: { 'logged:bench press': [borrowedFrom] } });
        const borrowedSet = baseSet({ plannedLoadKg: 55, draftLoadText: '55', prefilledFromPerformedAt: borrowedFrom.performedAt });
        assert.ok(expectPass((c) => checkStart(borrowCtx([borrowedSet]), c)).P2 === 1);
        expectViolation('P2', () => checkStart(borrowCtx([{ ...borrowedSet, autoProgressedFromKg: 52.5 }]), makeCounters()));
        expectViolation('P2', () => checkStart(borrowCtx([{ ...borrowedSet, plannedLoadKg: 57.5, draftLoadText: '57.5' }]), makeCounters()));

        // P3: last time logged a 30 kg warm-up as set 1 of four; set 1 must not open on it, nor on 32.5.
        const warmRows = { 'tpl:day:bench': [hEntry(last.performedAt, [10, 8, 8, 8], [30, 60, 60, 60]), hEntry(prev.performedAt, [8, 8, 8], 60)] };
        expectViolation('P3', () => checkStart(ctx([baseSet({ plannedLoadKg: 30, draftLoadText: '30' })], { slotHistory: warmRows }), makeCounters()));
        expectViolation('P3', () => checkStart(ctx([baseSet({ plannedLoadKg: 32.5, draftLoadText: '32.5', autoProgressedFromKg: 30 })], { slotHistory: warmRows }), makeCounters()));
        assert.ok(expectPass((c) => checkStart(ctx([baseSet({ plannedLoadKg: 62.5, draftLoadText: '62.5', autoProgressedFromKg: 60 })], { slotHistory: warmRows }), c)).P3inferred === 1);
        // Button warm-ups: set 1 opening on last time's 40 kg warm-up.
        expectViolation('P3', () => checkStart(ctx([baseSet({ plannedLoadKg: 60, draftLoadText: '40' })], { lastWarmups: [{ loadKg: 40, reps: 10 }], options: free }), makeCounters()));

        // P4: a set opened with AUTO saved as 'repeat'; a changed weight still badged.
        const autoShown = { reps: 8, loadKg: 62.5, autoProgressedFromKg: 60, prefilledFromPerformedAt: null, heldForFatigue: false, heldForCautionArea: null, autoProgressedFromReps: null };
        expectViolation('P4', () => checkSaved({ opened: autoShown, savedSet: { planned: { basis: 'repeat' } }, tag: 't' }, makeCounters()));
        expectViolation('P4', () => checkSaved({ opened: { ...autoShown, autoProgressedFromKg: null, heldForFatigue: true }, savedSet: { planned: { basis: 'repeat' } }, tag: 't' }, makeCounters()));
        expectViolation('P4', () => checkTouched({ shown: autoShown, tag: 't' }, makeCounters()));
        assert.ok(expectPass((c) => checkSaved({ opened: autoShown, savedSet: { planned: { basis: 'progressed' } }, tag: 't' }, c)).P4 === 1);

        // P5: a ramp whose walk-up line skips a set's own target.
        const rampSets = [baseSet({ plannedLoadKg: 40, draftLoadText: '40', rampTargetReps: 10 }), baseSet({ setIndex: 1, plannedLoadKg: 50, draftLoadText: '50', rampTargetReps: 8 }), baseSet({ setIndex: 2, plannedLoadKg: 60, draftLoadText: '60', rampTargetReps: 6 })];
        assert.ok(expectPass((c) => checkSurfaces({ exercise: baseExercise(rampSets), asPlanned: [{ loadKg: 40, reps: 10 }, { loadKg: 50, reps: 8 }, { loadKg: 60, reps: 6 }] }, c)).P5 === 1);
        expectViolation('P5', () => checkSurfaces({ exercise: baseExercise(rampSets), asPlanned: [{ loadKg: 40, reps: 10 }, { loadKg: 50, reps: 10 }, { loadKg: 60, reps: 6 }] }, makeCounters()));

        // P7: the prefill borrowed one session, the panel reads a newer one.
        const olderBorrow = hEntry(new Date(2026, 9, 3, 18).toISOString(), [8, 8, 8], 55, { slotId: 'logged:bench press', templateId: '' });
        const newerBorrow = hEntry(new Date(2026, 9, 5, 18).toISOString(), [8, 8, 8], 100, { slotId: 'other:day:bench', templateId: 'other' });
        expectViolation('P7', () => checkStart({
          ...ctx([baseSet({ plannedLoadKg: 55, draftLoadText: '55', prefilledFromPerformedAt: olderBorrow.performedAt })], { options: free }),
          slotHistory: { 'logged:bench press': [olderBorrow], 'other:day:bench': [newerBorrow] },
        }, makeCounters()));

        // P8 and P9.
        expectViolation('P8', () => checkReload({ before: [{ a: 1 }], after: [{ a: 2 }] }, makeCounters()));
        expectViolation('P9', () => checkAdvice({ advice: { kind: 'raise', fromKg: 60, toKg: 62.5 }, exercise: baseExercise([baseSet()]), tag: 't' }, makeCounters()));
        assert.ok(expectPass((c) => checkAdvice({ advice: { kind: 'raise', fromKg: 60, toKg: 62.5 }, exercise: baseExercise([baseSet({ plannedLoadKg: 62.5, autoProgressedFromKg: 60 })]), tag: 't' }, c)).P9 === 1);
      });
    },
  },
];

module.exports.runAll = runAll;
module.exports.checkers = { checkStart, checkSurfaces, checkSaved, checkTouched, checkReload, checkAdvice };
