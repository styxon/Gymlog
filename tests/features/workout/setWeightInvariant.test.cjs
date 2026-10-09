const assert = require('node:assert/strict');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const {
  workoutReducer,
  workoutInitialState,
  resolveInstanceBorrowRepWindow,
  getHistoryEntriesForExercise,
} = require('../../../.test-dist/features/workout/workoutState.js');
const { normalizeWorkoutBundle } = require('../../../.test-dist/features/workout/workoutPersistence.js');
const { isUnloadedTrackingMode } = require('../../../.test-dist/features/workout/workoutTypes.js');
const {
  resolveLastTimeEntry,
  findLatestEntryForExerciseName,
  selectLatestUsableEntry,
} = require('../../../.test-dist/lib/exerciseHistoryLookup.js');
const { resolveGuidedSetTarget, loggedSetsOf } = require('../../../.test-dist/lib/guidedPlayer.js');
const { liftOfSet } = require('../../../.test-dist/lib/liftSegments.js');
const { summarizeHistoricalSetChips, formatLoadOrRange } = require('../../../.test-dist/lib/guidedSetWeightSummary.js');
const { removeTrailingZeros } = require('../../../.test-dist/lib/format.js');

/**
 * A seeded random-sequence invariant for how the app chooses, shows and
 * records a set's weight.
 *
 * One mechanism — "what did you lift for THIS set, last time" — is read by
 * eight different call sites (see the module doc at the top of this file's
 * companion sources: workoutState.ts's resolveHistoricalSetDraft, guidedPlayer's
 * resolveGuidedSetTarget/loggedSetsOf, guidedSetWeightSummary's chip/range
 * formatters, exerciseHistoryLookup's resolveLastTimeEntry, and liftSegments'
 * liftOfSet). Each has its own test elsewhere for the bug it was written
 * against; this walks a long random sequence of ordinary actions — start,
 * log on and off plan, edit a logged set, swap mid-exercise, add/remove a
 * set, insert an exercise, finish, forget, log freestyle, restart the app —
 * and checks the same handful of rules after (almost) every step, the way
 * `tests/features/account/accountBackupHook.test.cjs`'s last suite does for
 * account switching.
 *
 * A failure prints the seed and the step list, which replay exactly (the
 * only non-determinism, `createId`'s random suffixes, never affects which
 * branch any check takes — ids are used as opaque keys, never compared to a
 * fixed string).
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

const NAME_POOL = {
  loaded: ['Back Squat', 'Bench Press', 'Leg Press'],
  bodyweight: ['Pull-Up'],
  hold: ['Plank', 'Glute Bridge Hold'],
};
const MODE_OF = { loaded: 'load_and_reps', bodyweight: 'bodyweight', hold: 'hold' };
const SWAP_TARGETS = {
  loaded: ['Leg Press', 'Lat Pulldown (Wide Grip)', 'Barbell Hip Thrust', 'Back Squat'],
  bodyweight: ['Pull-Up'],
  hold: ['Plank', 'Glute Bridge Hold'],
};
const REP_WINDOWS = {
  loaded: [[5, 8], [8, 12], [15, 20]],
  bodyweight: [[8, 12], [15, 20]],
  hold: [[30, 60], [45, 90]],
};
const CATEGORIES = ['loaded', 'bodyweight', 'hold'];

function roundKg(value) {
  const clamped = Math.max(0, Math.min(500, value));
  return Math.round(clamped / 2.5) * 2.5;
}

/**
 * The set at this index within ONE entry, as `findHistoricalSetForIndex`
 * (exerciseHistoryLookup.ts) documents itself: exact index match, else the
 * set sitting at that array position, else nothing. Reimplemented here,
 * independent of the module under test, so a mutation to that function (or
 * to its caller reaching past this one entry into another session) shows up
 * as a disagreement rather than being invisible to a check that calls the
 * same code.
 */
function localMatchedSet(entry, setIndex) {
  if (!entry) {
    return null;
  }
  return entry.sets.find((item) => item.setIndex === setIndex) ?? entry.sets[setIndex] ?? null;
}

/** Independent of guidedSetWeightSummary.ts: the oracle for I7. */
function localUniform(loads) {
  if (loads.length <= 1) {
    return true;
  }
  return loads.every((load) => Math.abs(load - loads[0]) <= 0.01);
}

function localChips(sets) {
  const loads = sets.map((set) => set.loadKg);
  const uniform = localUniform(loads);
  return {
    uniform,
    chips: sets.map((set) => (uniform ? `${set.reps}` : `${removeTrailingZeros(set.loadKg)}×${set.reps}`)),
  };
}

function localFormatted(loads) {
  const loaded = loads.filter((load) => load > 0);
  if (loaded.length === 0) {
    return null;
  }
  if (localUniform(loaded)) {
    return `${removeTrailingZeros(loaded[loaded.length - 1])} kg`;
  }
  return `${removeTrailingZeros(Math.min(...loaded))}-${removeTrailingZeros(Math.max(...loaded))} kg`;
}

function runSequence(seed, steps) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const log = [];

  function invariant(condition, message) {
    if (!condition) {
      throw new Error(`seed ${seed}: ${message}\n  ${log.join('\n  ')}`);
    }
  }

  let state = { ...workoutInitialState, hydrated: true, isRestoring: false };
  let clockMs = Date.parse('2026-01-01T08:00:00.000Z');
  const advanceClock = () => {
    clockMs += 60000 + Math.floor(random() * 300000);
    return clockMs;
  };
  let orderIndex = 0;
  let freestyleCounter = 0;
  let completedSessionIds = [];
  const forgotten = new Set();

  const poolSize = 1 + Math.floor(random() * 3);
  const pool = Array.from({ length: poolSize }, (_, index) => {
    const category = pick(CATEGORIES);
    const name = pick(NAME_POOL[category]);
    const [repsMin, repsMax] = pick(REP_WINDOWS[category]);
    return { slotKey: `slot_${index}`, name, trackingMode: MODE_OF[category], repsMin, repsMax };
  });

  function buildTemplate() {
    return {
      id: 'tpl_fuzz',
      name: 'Fuzz programme',
      defaultScheduleMode: 'weekly',
      sessions: [
        {
          id: 'day_fuzz',
          name: 'Fuzz day',
          orderIndex: 0,
          exercises: pool.map((p) => ({
            id: `ex_${p.slotKey}`,
            exerciseName: p.name,
            slotId: p.slotKey,
            role: 'primary',
            progressionPriority: 'medium',
            trackingMode: p.trackingMode,
            // 2-5 sets, re-rolled every start: models a programme whose set
            // count changed between sessions (I3's "a template that added a
            // set").
            sets: 2 + Math.floor(random() * 4),
            repsMin: p.repsMin,
            repsMax: p.repsMax,
            restSecondsMin: 60,
            restSecondsMax: 90,
            substitutionGroup: `grp_${p.slotKey}`,
          })),
        },
      ],
    };
  }

  // ---- I2 / I3: checked right after materialization, using the SAME
  // history the reducer just read (start does not mutate slotHistory). ----
  function checkMaterialization(afterState) {
    afterState.activeSession.exercises.forEach((exercise) => {
      log.push(`  check materialization ${exercise.slotId} (${exercise.exerciseName}/${exercise.trackingMode})`);
      const requireLoaded = !isUnloadedTrackingMode(exercise.trackingMode);
      const repWindow = resolveInstanceBorrowRepWindow(exercise);
      const header = resolveLastTimeEntry({
        slotHistory: afterState.history.slotHistory,
        slotId: exercise.slotId,
        templateSlotId: exercise.templateSlotId,
        exerciseName: exercise.exerciseName,
        requireLoaded,
        repWindow,
      });

      const scopedOrLegacy = getHistoryEntriesForExercise(afterState.history, exercise);
      const ownLatest = selectLatestUsableEntry(scopedOrLegacy);
      let prefillEntry = ownLatest;
      let prefillBorrowed = false;
      if (!ownLatest) {
        const named = findLatestEntryForExerciseName(afterState.history.slotHistory, exercise.exerciseName, {
          requireLoaded,
          repWindow,
        });
        prefillEntry = named;
        prefillBorrowed = Boolean(named);
      }

      // I2
      invariant(
        Boolean(header) === Boolean(prefillEntry),
        `I2: header present=${Boolean(header)} but prefill present=${Boolean(prefillEntry)} for ${exercise.slotId}`,
      );
      if (header && prefillEntry) {
        invariant(
          header.entry.sessionId === prefillEntry.sessionId && header.entry.performedAt === prefillEntry.performedAt,
          `I2: header entry (${header.entry.sessionId}/${header.entry.performedAt}) != prefill entry (${prefillEntry.sessionId}/${prefillEntry.performedAt})`,
        );
        invariant(
          header.borrowed === prefillBorrowed,
          `I2: borrowed flag disagreement header=${header.borrowed} prefill=${prefillBorrowed}`,
        );
      }

      // I3 (own-slot/legacy replay only — the named-borrow branch has no set
      // index to replay, and is covered by I2 instead).
      if (requireLoaded && ownLatest) {
        exercise.sets.forEach((set) => {
          const matched = localMatchedSet(ownLatest, set.setIndex);
          if (matched) {
            invariant(
              set.plannedLoadKg === matched.loadKg,
              `I3: set ${set.setIndex} of ${exercise.slotId} planned ${set.plannedLoadKg}, own latest entry says ${matched.loadKg}`,
            );
            invariant(
              set.prefilledFromPerformedAt === undefined,
              `I3: own-slot replay for set ${set.setIndex} incorrectly badged borrowed (${set.prefilledFromPerformedAt})`,
            );
          } else {
            invariant(
              set.plannedLoadKg === undefined && set.draftLoadText === '',
              `I3: latest entry lacks set ${set.setIndex} but draft is not blank (plannedLoadKg=${set.plannedLoadKg}, draftLoadText="${set.draftLoadText}")`,
            );
          }
        });
      }
    });
  }

  // ---- I4 (global) + I6b + I7: cheap enough to run after every step. ----
  function checkGeneric(current) {
    if (forgotten.size > 0) {
      Object.entries(current.history.slotHistory).forEach(([slotId, entries]) => {
        (entries ?? []).forEach((entry) => {
          invariant(!forgotten.has(entry.sessionId), `I4: slotHistory[${slotId}] still holds forgotten session ${entry.sessionId}`);
        });
      });
    }
    if (!current.activeSession) {
      return;
    }
    current.activeSession.exercises.forEach((exercise) => {
      // I6b
      const rows = loggedSetsOf(exercise);
      rows.forEach((row) => {
        const set = exercise.sets.find((item) => item.setIndex === row.setIndex && item.status === 'completed');
        invariant(Boolean(set), `I6b: loggedSetsOf row ${row.setIndex} has no matching completed set on ${exercise.slotId}`);
        const expectedMode = liftOfSet(exercise, set).trackingMode;
        invariant(
          row.trackingMode === expectedMode,
          `I6b: row ${row.setIndex} of ${exercise.slotId} trackingMode ${row.trackingMode} != liftOfSet's ${expectedMode}`,
        );
      });

      // I7
      const requireLoaded = !isUnloadedTrackingMode(exercise.trackingMode);
      const repWindow = resolveInstanceBorrowRepWindow(exercise);
      const header = resolveLastTimeEntry({
        slotHistory: current.history.slotHistory,
        slotId: exercise.slotId,
        templateSlotId: exercise.templateSlotId,
        exerciseName: exercise.exerciseName,
        requireLoaded,
        repWindow,
      });
      if (header) {
        const loads = header.entry.sets.map((set) => set.loadKg);
        const expectedChips = localChips(header.entry.sets);
        const actualChips = summarizeHistoricalSetChips(header.entry.sets);
        invariant(
          actualChips.uniform === expectedChips.uniform,
          `I7: uniform flag ${actualChips.uniform} != expected ${expectedChips.uniform} for ${exercise.slotId}`,
        );
        invariant(
          JSON.stringify(actualChips.chips) === JSON.stringify(expectedChips.chips),
          `I7: chips ${JSON.stringify(actualChips.chips)} != expected ${JSON.stringify(expectedChips.chips)}`,
        );
        const actualFormatted = formatLoadOrRange(loads);
        const expectedFormattedStr = localFormatted(loads);
        invariant(
          actualFormatted === expectedFormattedStr,
          `I7: formatLoadOrRange ${actualFormatted} != expected ${expectedFormattedStr}`,
        );
      }
    });
  }

  function snapshotDerived(current) {
    return current.activeSession.exercises.map((exercise) => {
      const requireLoaded = !isUnloadedTrackingMode(exercise.trackingMode);
      const repWindow = resolveInstanceBorrowRepWindow(exercise);
      const header = resolveLastTimeEntry({
        slotHistory: current.history.slotHistory,
        slotId: exercise.slotId,
        templateSlotId: exercise.templateSlotId,
        exerciseName: exercise.exerciseName,
        requireLoaded,
        repWindow,
      });
      return {
        slotId: exercise.slotId,
        header: header ? { sessionId: header.entry.sessionId, performedAt: header.entry.performedAt, borrowed: header.borrowed, sets: header.entry.sets } : null,
        pendingTargets: exercise.sets
          .filter((set) => set.status === 'pending')
          .map((set) => resolveGuidedSetTarget(exercise.sets, set.setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex)),
        loggedRows: loggedSetsOf(exercise),
        plannedLoadKgs: exercise.sets.map((set) => set.plannedLoadKg ?? null),
      };
    });
  }

  function doStart(current) {
    const template = buildTemplate();
    log.push(`start (sets=${template.sessions[0].exercises.map((e) => e.sets).join(',')})`);
    const next = workoutReducer(current, {
      type: 'session/startFromRuntimeTemplate',
      payload: { template, sessionOrderIndex: orderIndex++, unitPreference: 'kg' },
    });
    checkMaterialization(next);
    return next;
  }

  function pendingByExercise(session) {
    return session.exercises
      .map((exercise) => ({ exercise, pending: exercise.sets.filter((set) => set.status === 'pending').sort((a, b) => a.setIndex - b.setIndex) }))
      .filter((entry) => entry.pending.length > 0);
  }

  function doLog(current) {
    const candidates = pendingByExercise(current.activeSession);
    if (candidates.length === 0) {
      return current;
    }
    const { exercise, pending } = pick(candidates);
    const set = pending[0]; // sequential, like the guided player presents them
    const target = resolveGuidedSetTarget(exercise.sets, set.setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex);
    invariant(Boolean(target), `resolveGuidedSetTarget returned null for pending set ${set.setIndex} of ${exercise.slotId}`);

    const unloaded = exercise.trackingMode === 'bodyweight' || exercise.trackingMode === 'hold';
    const canGoOnPlan = unloaded || target.loadKg !== null;
    const onPlan = canGoOnPlan && random() < 0.5;

    let loadKg;
    let reps;
    if (unloaded) {
      loadKg = null;
      reps = onPlan ? target.reps : Math.max(1, target.reps + pick([-3, -2, -1, 1, 2, 3]));
    } else if (onPlan) {
      loadKg = target.loadKg;
      reps = target.reps;
    } else {
      const base = target.loadKg ?? 20;
      loadKg = roundKg(base + pick([-15, -10, -5, 5, 10, 15, 20]));
      reps = Math.max(1, target.reps + pick([-3, -2, -1, 1, 2, 3]));
    }

    log.push(`log ${exercise.slotId}#${set.setIndex} ${onPlan ? 'on-plan' : 'off-plan'} load=${loadKg} reps=${reps}`);

    const draftLoadText = loadKg === null ? '' : String(loadKg);
    const nowMs = advanceClock();
    let next = workoutReducer(current, {
      type: 'set/updateDraft',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { loadText: draftLoadText, repsText: String(reps) } },
    });
    next = workoutReducer(next, {
      type: 'set/complete',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs, unitPreference: 'kg' },
    });

    const loggedExercise = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId);
    const loggedSet = loggedExercise.sets.find((item) => item.setIndex === set.setIndex);
    invariant(loggedSet.status === 'completed', `set ${set.setIndex} of ${exercise.slotId} did not complete (dial rejected the draft)`);

    // I1
    const expectedLoad = loadKg === null ? 0 : loadKg;
    invariant(loggedSet.actualReps === reps, `I1: reps recorded ${loggedSet.actualReps} != dispatched ${reps}`);
    invariant(loggedSet.actualLoadKg === expectedLoad, `I1: load recorded ${loggedSet.actualLoadKg} != dispatched ${expectedLoad}`);
    if (onPlan) {
      invariant(loggedSet.actualReps === target.reps, `I1: on-plan reps ${loggedSet.actualReps} != target ${target.reps}`);
      invariant(loggedSet.actualLoadKg === (target.loadKg ?? 0), `I1: on-plan load ${loggedSet.actualLoadKg} != target ${target.loadKg}`);
    }

    // I5: carry-forward, when off-plan and loaded, straight to the next
    // pending set of the SAME exercise (no swap could have happened between
    // this log and the check — they are the same step).
    if (!onPlan && !unloaded) {
      const nextPending = loggedExercise.sets.find((item) => item.setIndex === set.setIndex + 1 && item.status === 'pending');
      if (nextPending) {
        const carryTarget = resolveGuidedSetTarget(
          loggedExercise.sets,
          nextPending.setIndex,
          loggedExercise.trackingMode,
          loggedExercise.swappedAfterSetIndex,
        );
        invariant(
          carryTarget.loadKg === expectedLoad,
          `I5: set ${nextPending.setIndex} opened at ${carryTarget.loadKg}, expected the carried weight ${expectedLoad}`,
        );
      }
    }

    return next;
  }

  function doEdit(current) {
    const completed = [];
    current.activeSession.exercises.forEach((exercise) => {
      exercise.sets.forEach((set) => {
        if (set.status === 'completed') {
          completed.push({ exercise, set });
        }
      });
    });
    if (completed.length === 0) {
      return current;
    }
    const { exercise, set } = pick(completed);
    const lift = liftOfSet(exercise, set);
    const unloaded = lift.trackingMode === 'bodyweight' || lift.trackingMode === 'hold';
    const reps = 1 + Math.floor(random() * 15);
    const loadKg = unloaded ? null : roundKg(20 + Math.floor(random() * 20) * 5);
    log.push(`editLogged ${exercise.slotId}#${set.setIndex} reps=${reps} loadKg=${loadKg}`);
    const next = workoutReducer(current, {
      type: 'set/editLogged',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, reps, loadKg },
    });
    const updated = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId).sets.find((item) => item.setIndex === set.setIndex);
    invariant(updated.actualReps === reps, `editLogged did not record reps (${updated.actualReps} != ${reps})`);
    if (!unloaded) {
      invariant(updated.actualLoadKg === loadKg, `editLogged did not record load (${updated.actualLoadKg} != ${loadKg})`);
    }
    return next;
  }

  function doSwap(current) {
    const exercise = pick(current.activeSession.exercises);
    const category = pick(CATEGORIES);
    const newName = pick(SWAP_TARGETS[category]);
    log.push(`swap ${exercise.slotId} (${exercise.exerciseName}) -> ${newName}`);
    const lastOldCompleted = [...exercise.sets].filter((set) => set.status === 'completed').sort((a, b) => b.setIndex - a.setIndex)[0];

    const next = workoutReducer(current, {
      type: 'exercise/swap',
      payload: { slotId: exercise.slotId, exerciseName: newName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
    });
    const swapped = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId);

    // I5's exception: a swap breaks carry-forward across the boundary.
    if (lastOldCompleted && typeof lastOldCompleted.actualLoadKg === 'number' && lastOldCompleted.actualLoadKg > 0) {
      const firstPending = swapped.sets.filter((set) => set.status === 'pending').sort((a, b) => a.setIndex - b.setIndex)[0];
      if (firstPending && !isUnloadedTrackingMode(swapped.trackingMode)) {
        const target = resolveGuidedSetTarget(swapped.sets, firstPending.setIndex, swapped.trackingMode, swapped.swappedAfterSetIndex);
        invariant(
          target.loadKg !== lastOldCompleted.actualLoadKg,
          `I5 exception: swap on ${exercise.slotId} did not stop carry-forward — set ${firstPending.setIndex} still opened at the pre-swap weight ${target.loadKg}`,
        );
      }
    }
    return next;
  }

  function doAddSet(current) {
    const exercise = pick(current.activeSession.exercises);
    log.push(`addSet ${exercise.slotId}`);
    return workoutReducer(current, { type: 'exercise/addSet', payload: { slotId: exercise.slotId } });
  }

  function doRemoveSet(current) {
    const exercise = pick(current.activeSession.exercises);
    log.push(`removeSet ${exercise.slotId}`);
    return workoutReducer(current, { type: 'exercise/removeSet', payload: { slotId: exercise.slotId } });
  }

  function doInsertAfter(current) {
    const after = pick(current.activeSession.exercises);
    const category = pick(CATEGORIES);
    const name = pick(NAME_POOL[category]);
    const [repsMin, repsMax] = pick(REP_WINDOWS[category]);
    const setsCount = 1 + Math.floor(random() * 3);
    log.push(`insertAfter ${after.slotId} -> ${name} (${category}, ${setsCount} sets)`);
    const before = current.activeSession.exercises.length;
    const next = workoutReducer(current, {
      type: 'exercise/insertAfter',
      payload: {
        afterSlotId: after.slotId,
        exercise: {
          exerciseName: name,
          role: 'secondary',
          progressionPriority: 'medium',
          trackingMode: MODE_OF[category],
          restSecondsMin: 60,
          restSecondsMax: 90,
          substitutionGroup: 'grp_inserted',
          sets: setsCount,
          repsMin,
          repsMax,
          libraryItemId: null,
        },
      },
    });
    invariant(next.activeSession.exercises.length === before + 1, 'insertAfter did not add an exercise');
    return next;
  }

  function doComplete(current) {
    const performedAt = new Date(advanceClock()).toISOString();
    log.push(`complete session at ${performedAt}`);
    const preExercises = current.activeSession.exercises;
    const { splitExerciseByLift } = require('../../../.test-dist/lib/liftSegments.js');
    // A segment is filed when it has something to say: a completed set, an
    // explicit skip (the slot's current lift only), or the slot's warm-ups on
    // its first lift. A lift left pending files nothing (hunt, 2026-10-09).
    const expectedSegments = preExercises.map((exercise) => ({
      slotId: exercise.slotId,
      segments: splitExerciseByLift(exercise).filter(
        (segment, segmentIndex) =>
          segment.sets.some((set) => set.status === 'completed' && typeof set.actualLoadKg === 'number' && typeof set.actualReps === 'number') ||
          (segment.current && exercise.status === 'skipped') ||
          (segmentIndex === 0 && (exercise.warmups ?? []).length > 0),
      ),
    }));

    const finished = workoutReducer(current, { type: 'session/finishWorkout', payload: { performedAt } });
    const sessionId = finished.activeSession.sessionId;

    // I6a
    expectedSegments.forEach(({ slotId, segments }) => {
      const entries = (finished.history.slotHistory[slotId] ?? []).filter((entry) => entry.sessionId === sessionId);
      const nonEmptySegments = segments.filter((segment) =>
        segment.sets.some((set) => set.status === 'completed' && typeof set.actualLoadKg === 'number' && typeof set.actualReps === 'number'),
      );
      invariant(
        entries.length === segments.length,
        `I6a: slot ${slotId} filed ${entries.length} entries for ${segments.length} lift segments`,
      );
      nonEmptySegments.forEach((segment) => {
        const completedSets = segment.sets.filter(
          (set) => set.status === 'completed' && typeof set.actualLoadKg === 'number' && typeof set.actualReps === 'number',
        );
        const match = entries.find((entry) => entry.exerciseName === segment.exerciseName);
        invariant(Boolean(match), `I6a: no entry filed for segment lift "${segment.exerciseName}" of slot ${slotId}`);
        invariant(
          match.sets.length === completedSets.length,
          `I6a: entry for "${segment.exerciseName}" has ${match.sets.length} sets, expected ${completedSets.length}`,
        );
        completedSets.forEach((set, index) => {
          invariant(match.sets[index].loadKg === (set.actualLoadKg ?? 0), `I6a: set ${index} load mismatch for "${segment.exerciseName}"`);
          invariant(match.sets[index].reps === (set.actualReps ?? 0), `I6a: set ${index} reps mismatch for "${segment.exerciseName}"`);
        });
      });
    });

    completedSessionIds.push({ id: sessionId, performedAt });
    return workoutReducer(finished, { type: 'session/clearCompletedSession' });
  }

  function doForget(current) {
    if (completedSessionIds.length === 0) {
      return current;
    }
    const victim = pick(completedSessionIds);
    log.push(`forget session ${victim.id}`);
    const next = workoutReducer(current, { type: 'history/forgetSession', payload: { sessionId: victim.id } });
    forgotten.add(victim.id);
    completedSessionIds = completedSessionIds.filter((entry) => entry.id !== victim.id);

    Object.values(next.history.slotHistory).forEach((entries) =>
      (entries ?? []).forEach((entry) =>
        invariant(entry.sessionId !== victim.id, `I4: forgot ${victim.id} but slotHistory still holds it`),
      ),
    );
    pool.forEach((p) => {
      const found = findLatestEntryForExerciseName(next.history.slotHistory, p.name, {});
      invariant(!found || found.sessionId !== victim.id, `I4: named lookup for "${p.name}" still returns the forgotten session`);
    });
    return next;
  }

  function doFreestyle(current) {
    const p = pick(pool);
    const performedAt = new Date(advanceClock()).toISOString();
    const sessionId = `freestyle_${seed}_${++freestyleCounter}`;
    const setsCount = 1 + Math.floor(random() * 4);
    const loaded = p.trackingMode === 'load_and_reps';
    const sets = Array.from({ length: setsCount }, (_, index) => ({
      setIndex: index,
      loadKg: loaded ? roundKg(20 + random() * 80) : 0,
      reps: 5 + Math.floor(random() * 10),
    }));
    log.push(`freestyleLog ${p.name} (${setsCount} sets) session=${sessionId}`);
    const next = workoutReducer(current, {
      type: 'history/recordLogged',
      payload: { performedAt, sessionId, templateName: 'Freestyle', exercises: [{ exerciseName: p.name, sets }] },
    });
    completedSessionIds.push({ id: sessionId, performedAt });
    return next;
  }

  function doRestart(current) {
    const before = current.activeSession ? snapshotDerived(current) : null;
    log.push('restart the app (persist -> JSON round-trip -> normalize -> hydrate)');
    const bundle = { activeSession: current.activeSession, history: current.history, activeCardio: null, freestyleDraft: null };
    const roundTripped = normalizeWorkoutBundle(JSON.parse(JSON.stringify(bundle)));
    const next = workoutReducer(current, { type: 'session/hydrate', payload: roundTripped });
    if (before) {
      invariant(Boolean(next.activeSession), 'I8: restart lost the active session');
      const after = snapshotDerived(next);
      invariant(
        JSON.stringify(before) === JSON.stringify(after),
        `I8: restart changed a derived answer\n    before=${JSON.stringify(before)}\n    after=${JSON.stringify(after)}`,
      );
    }
    return next;
  }

  for (let step = 0; step < steps; step += 1) {
    const actions = [];
    if (!state.activeSession) {
      actions.push('start');
    } else {
      const hasPending = pendingByExercise(state.activeSession).length > 0;
      const hasCompleted = state.activeSession.exercises.some((exercise) => exercise.sets.some((set) => set.status === 'completed'));
      if (hasPending) {
        actions.push('log', 'log', 'log');
      }
      if (hasCompleted) {
        actions.push('edit');
      }
      actions.push('swap', 'addSet', 'removeSet', 'insertAfter', 'complete');
    }
    actions.push('freestyle');
    if (completedSessionIds.length > 0) {
      actions.push('forget');
    }
    actions.push('restart');

    const action = pick(actions);
    switch (action) {
      case 'start':
        state = doStart(state);
        break;
      case 'log':
        state = doLog(state);
        break;
      case 'edit':
        state = doEdit(state);
        break;
      case 'swap':
        state = doSwap(state);
        break;
      case 'addSet':
        state = doAddSet(state);
        break;
      case 'removeSet':
        state = doRemoveSet(state);
        break;
      case 'insertAfter':
        state = doInsertAfter(state);
        break;
      case 'complete':
        state = doComplete(state);
        break;
      case 'forget':
        state = doForget(state);
        break;
      case 'freestyle':
        state = doFreestyle(state);
        break;
      case 'restart':
        state = doRestart(state);
        break;
      default:
        throw new Error(`unhandled action ${action}`);
    }
    checkGeneric(state);
  }
}

function runAll(sequences, stepsPerSequence) {
  for (let seed = 1; seed <= sequences; seed += 1) {
    runSequence(seed, stepsPerSequence);
  }
}

module.exports = [
  {
    /**
     * The default, committed run: fast enough for `npm run test:unit`.
     * `node -e` a longer run locally when in doubt — see the PR description
     * for the 3000x30 result this shipped with.
     */
    name: 'set weight invariant: 200 seeded random sequences of 30 events each keep every rule (I1-I8) true',
    run() {
      runAll(200, 30);
    },
  },
];

module.exports.runAll = runAll;
