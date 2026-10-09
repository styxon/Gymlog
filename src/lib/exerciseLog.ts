import { ExerciseLog, ExerciseLogDraft, ExerciseLogSet } from '../types/models';
import { isLiftableWeight } from './weightLimits';
import { normalizeLoggedSetPlan } from './loggedSetPlan';

function normalizeNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRepsPerSet(repsPerSet: number[] | null | undefined) {
  return Array.isArray(repsPerSet)
    ? repsPerSet.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : [];
}

function normalizeSetKind(value: ExerciseLogSet['kind'] | null | undefined): ExerciseLogSet['kind'] {
  return value === 'warmup' || value === 'drop' ? value : 'working';
}

function normalizeSetOutcome(value: ExerciseLogSet['outcome'] | null | undefined): ExerciseLogSet['outcome'] {
  if (value === 'failed' || value === 'skipped') {
    return value;
  }

  return value === null ? null : 'completed';
}

function normalizeSetStatus(value: ExerciseLogSet['status'] | null | undefined): ExerciseLogSet['status'] {
  if (value === 'pending' || value === 'skipped') {
    return value;
  }

  return 'completed';
}

function normalizeSetEffort(value: ExerciseLogSet['effort'] | null | undefined): ExerciseLogSet['effort'] {
  if (value === 'easy' || value === 'good' || value === 'hard') {
    return value;
  }

  return null;
}

export function sortExerciseSets<T extends Pick<ExerciseLogSet, 'orderIndex'>>(sets: T[]) {
  return [...sets].sort((left, right) => left.orderIndex - right.orderIndex);
}

export function synthesizeSetsFromLegacy(weight: number | null | undefined, repsPerSet: number[] | null | undefined) {
  const normalizedWeight = normalizeNumber(weight, 0);

  // The same rule as the set list below, because this is the other way in. A
  // log whose rows were all dropped as impossible falls back to here, and
  // rebuilding them from the legacy pair would hand back the very number that
  // was just discarded.
  if (!isLiftableWeight(normalizedWeight)) {
    return [];
  }

  return normalizeRepsPerSet(repsPerSet).map<ExerciseLogSet>((reps, orderIndex) => ({
    orderIndex,
    weight: normalizedWeight,
    reps,
    kind: 'working',
    outcome: 'completed',
    status: 'completed',
  }));
}

function plannedOf(value: unknown): { planned?: ExerciseLogSet['planned'] } {
  const planned = normalizeLoggedSetPlan(value);
  return planned ? { planned } : {};
}

export function normalizeExerciseSets(
  sets: ExerciseLogSet[] | null | undefined,
  legacyWeight?: number | null,
  legacyRepsPerSet?: number[] | null,
) {
  const normalizedSets = Array.isArray(sets)
    ? sortExerciseSets(
        sets
          .filter((set): set is ExerciseLogSet => Boolean(set))
          .map((set, index) => ({
            orderIndex:
              typeof set.orderIndex === 'number' && Number.isFinite(set.orderIndex) ? set.orderIndex : index,
            weight: normalizeNumber(set.weight, 0),
            reps: normalizeNumber(set.reps, 0),
            kind: normalizeSetKind(set.kind),
            outcome: normalizeSetOutcome(set.outcome),
            status: normalizeSetStatus(set.status),
            effort: normalizeSetEffort(set.effort),
            completedAt: typeof set.completedAt === 'string' ? set.completedAt : null,
            skippedReason: typeof set.skippedReason === 'string' ? set.skippedReason : null,
            // Kept only when it reads cleanly; absent on older saves.
            ...plannedOf(set.planned),
          }))
          /*
           * A weight nobody could have lifted is not a set (#bugs 2026-09-05).
           *
           * The dial grew a 500 kg ceiling on 2026-08-27, but only on the way
           * in. One install already held a sumo deadlift of 5122,5 kg — the
           * +5000 kg stuck button from the morning before the fix — and every
           * layer downstream believed it: 123 340 kg in records, 41 tonnes of
           * volume, and a strength target the app then refused to accept
           * because the only reachable numbers were all above its own 1000 kg
           * limit. The button looked broken; the data was.
           *
           * The set goes rather than its weight. Clamping to 500 would mint a
           * personal record that is just as false and far more believable, and
           * zeroing it would write a bodyweight sumo deadlift into the history.
           * We know the reps happened; we do not know what was on the bar, and
           * an honest log says so by not carrying the row. When that empties a
           * log, `logRecordedWork` already reads it as a session in which
           * nothing was lifted, which is the state it deserves.
           */
          .filter((set) => isLiftableWeight(set.weight))
          .filter(
            (set) =>
              set.status !== 'completed' ||
              Boolean(set.completedAt) ||
              set.reps > 0 ||
              set.weight > 0,
          ),
      )
    : [];

  if (normalizedSets.length > 0) {
    return normalizedSets;
  }

  return synthesizeSetsFromLegacy(legacyWeight, legacyRepsPerSet);
}

export function getOrderedLogSets(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> | null | undefined,
) {
  if (!log) {
    return [];
  }

  return normalizeExerciseSets(log.sets, log.weight, log.repsPerSet);
}

export function getComparableLogSets(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> | null | undefined,
) {
  if (!log || log.skipped) {
    return [];
  }

  const orderedSets = getOrderedLogSets(log);
  const completedSets = orderedSets.filter((set) => set.status !== 'pending' && set.status !== 'skipped');
  /*
   * Only what was done. This used to fall back to every row when none was
   * completed, so a lift put on the board and never performed — three
   * pending plan targets, or a freestyle row typed and never ticked —
   * counted as work: sets and kilos on the History row, the weekly volume,
   * the milestone ladders, and a personal record nobody lifted, which then
   * withheld every real record below it (audit round 4, 2026-09-20). A
   * legacy log with no statuses at all still counts every row: its rows
   * are not pending, they are simply older than the field.
   */
  const comparableSets = completedSets;
  const workingSets = comparableSets.filter((set) => set.kind === 'working');
  // The fallback (a log of drop sets only, say) never hands back a warm-up as
  // work: a log whose only done sets were warm-ups did no work (2026-10-05).
  return workingSets.length > 0 ? workingSets : comparableSets.filter((set) => set.kind !== 'warmup');
}

/**
 * Every set that was lifted for work: the working sets and the drop sets, not
 * the warm-ups and not what was never done.
 *
 * getComparableLogSets answers "which sets stand for this lift" — the working
 * ones when there are any — and that is right for a top set, a record or a
 * trend, which compare one lift against the next. It is wrong for a COUNT: a
 * Hevy import of 2 × 100 × 5 and two drop sets (80 × 8, 60 × 10) read as 2
 * sets and 1000 kg, where 4 sets and 2240 kg were lifted. Sets done and
 * kilograms moved read this; a top set or a record keeps the comparable ones.
 */
export function getWorkedLogSets(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> | null | undefined,
) {
  if (!log || log.skipped) {
    return [];
  }

  return getOrderedLogSets(log).filter(
    (set) => set.status !== 'pending' && set.status !== 'skipped' && set.kind !== 'warmup',
  );
}

/**
 * Did this log record any work at all?
 *
 * An exercise that was put on the board and never performed still leaves a
 * log: the rows exist, every set sits at zero, and the log's status stays
 * `active`. Nothing removes it when the session is saved, so the progress
 * layer used to read it as a session in which you lifted nothing — which
 * turned a bench that had gone 80 kg into "0 kg × 0, below previous, −80 kg
 * from the start", on the first screen of Progress.
 *
 * The test is REPS, not weight. A bodyweight set is genuinely zero kilos and
 * has to keep counting; a set nobody did has no reps.
 */
export function logRecordedWork(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> | null | undefined,
): boolean {
  return getComparableLogSets(log).some((set) => set.reps > 0);
}

/**
 * Did this workout record any work at all — one set with reps, in any log?
 *
 * The finish kept a session whenever it had logs, and a log survives for a
 * skipped exercise, a swap or a note with no set done, so a workout where
 * nothing was lifted went into History as a finished one ("ei tallenneta
 * enää tyhjiä treenejä", #bugs 2026-10-01).
 */
export function sessionRecordedWork(
  logs: ReadonlyArray<Pick<ExerciseLog, 'sets' | 'skipped'> & { weight?: number; repsPerSet?: number[] }>,
): boolean {
  // A draft may carry no flat weight or reps; its sets carry their own.
  return logs.some((log) =>
    logRecordedWork({ ...log, weight: log.weight ?? 0, repsPerSet: log.repsPerSet ?? [] }),
  );
}

export function getLogSetStatusCounts(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> | null | undefined,
) {
  return getOrderedLogSets(log).reduce(
    (counts, set) => {
      counts[set.status ?? 'completed'] += 1;
      return counts;
    },
    {
      completed: 0,
      skipped: 0,
      pending: 0,
    },
  );
}

export function deriveLegacyLogFieldsFromSets(sets: ExerciseLogSet[]) {
  const comparableSets = getComparableLogSets({
    sets,
    weight: 0,
    repsPerSet: [],
    skipped: false,
  });

  return {
    weight: comparableSets.reduce((best, set) => Math.max(best, set.weight), 0),
    repsPerSet: comparableSets.map((set) => set.reps),
  };
}

/**
 * The lift a log was swapped in for — none, when it was not a swap
 * (logRecordsSwap). Settled here, on the way in and on every load, so the
 * History badge, the swap counts, Progress and the insight all read one
 * answer: a log "swapped from" the lift it names is the programmed lift.
 */
function normalizeSwappedFrom(log: { swappedFrom?: unknown; exerciseNameSnapshot?: unknown }): string | null {
  return logRecordsSwap(log) ? (log.swappedFrom as string).trim() : null;
}

/**
 * The programme exercise a log is filed under — none, when the log records a
 * swap.
 *
 * A programme's own exercise names its logs: Progress groups a log by its
 * template's name before its own. A swapped-in lift is not that exercise, and
 * the save used to keep the programmed lift's template on it, so a leg press
 * at 200 kg in the reader's own programme went into Progress as "back squat"
 * (swap audit, 2026-09-21). Every log is normalized through here on its way
 * in and on every load, so a new one cannot be filed wrong and the ones
 * already stored are filed under the lift they name.
 */
function normalizeLogTemplateId(exerciseTemplateId: unknown, swappedFrom: string | null): string | null {
  if (swappedFrom) {
    return null;
  }
  return typeof exerciseTemplateId === 'string' ? exerciseTemplateId : null;
}

/**
 * Whether a log is a lift swapped in for another.
 *
 * A log that names the lift it says it was swapped from is not: an older build
 * saved a slot swapped away and back (A → B → A) as A "swapped from A". That
 * is the programmed lift — it keeps its template and its place in the
 * post-session insight, and loads with no swap on it, so History does not
 * badge a bench press as swapped from the bench press (review of #170).
 */
export function logRecordsSwap(log: { swappedFrom?: unknown; exerciseNameSnapshot?: unknown }): boolean {
  const from = typeof log.swappedFrom === 'string' ? log.swappedFrom.trim().toLowerCase() : '';
  const named = typeof log.exerciseNameSnapshot === 'string' ? log.exerciseNameSnapshot.trim().toLowerCase() : '';
  return from !== '' && from !== named;
}

/**
 * The unit a log's reps are in, when it is not repetitions — checked, and
 * carried only when present. A log saved before 2026-10-06, or one carrying a
 * unit this build does not know, has none and reads as repetitions, which is
 * how it was saved. Spread rather than set, so a log of reps stays the exact
 * shape it was stored in.
 */
function repsUnitOf(log: { repsUnit?: unknown }): { repsUnit?: 'minutes' } {
  return log.repsUnit === 'minutes' ? { repsUnit: 'minutes' } : {};
}

/** Whether a log's reps are minutes (see ExerciseLog.repsUnit). */
export function isMinutesLog(log: { repsUnit?: unknown } | null | undefined): boolean {
  return log?.repsUnit === 'minutes';
}

export function normalizeExerciseLog(log: Partial<ExerciseLog> | null | undefined): ExerciseLog | null {
  if (
    !log ||
    typeof log.id !== 'string' ||
    typeof log.sessionId !== 'string' ||
    typeof log.exerciseNameSnapshot !== 'string' ||
    typeof log.orderIndex !== 'number' ||
    !Number.isFinite(log.orderIndex)
  ) {
    return null;
  }

  const skipped = log.skipped === true;
  const normalizedSets = normalizeExerciseSets(log.sets, log.weight, log.repsPerSet);
  const derived = deriveLegacyLogFieldsFromSets(normalizedSets);
  const swappedFrom = normalizeSwappedFrom(log);

  return {
    id: log.id,
    sessionId: log.sessionId,
    exerciseTemplateId: normalizeLogTemplateId(log.exerciseTemplateId, swappedFrom),
    exerciseNameSnapshot: log.exerciseNameSnapshot,
    weight: skipped ? 0 : derived.weight,
    repsPerSet: skipped ? [] : derived.repsPerSet,
    sets: normalizedSets,
    tracked: log.tracked === true,
    orderIndex: log.orderIndex,
    skipped,
    sessionInserted: log.sessionInserted === true,
    status:
      log.status === 'completed' || log.status === 'skipped' || log.status === 'swapped' || log.status === 'active'
        ? log.status
        : skipped
          ? 'skipped'
          : 'completed',
    slotId: typeof log.slotId === 'string' || log.slotId === null ? log.slotId : null,
    templateSlotId:
      typeof log.templateSlotId === 'string' || log.templateSlotId === null ? log.templateSlotId : null,
    templateExerciseId:
      typeof log.templateExerciseId === 'string' || log.templateExerciseId === null ? log.templateExerciseId : null,
    notes: typeof log.notes === 'string' ? log.notes.trim() || null : null,
    swappedFrom,
    ...repsUnitOf(log),
  };
}

export function normalizeExerciseLogDraft(log: ExerciseLogDraft) {
  const skipped = log.skipped === true;
  const normalizedSets = normalizeExerciseSets(log.sets, log.weight, log.repsPerSet);
  const derived = deriveLegacyLogFieldsFromSets(normalizedSets);
  const swappedFrom = normalizeSwappedFrom(log);

  return {
    ...log,
    exerciseTemplateId: normalizeLogTemplateId(log.exerciseTemplateId, swappedFrom),
    weight: skipped ? 0 : derived.weight,
    repsPerSet: skipped ? [] : derived.repsPerSet,
    sets: normalizedSets,
    skipped,
    sessionInserted: log.sessionInserted === true,
    status:
      log.status === 'completed' || log.status === 'skipped' || log.status === 'swapped' || log.status === 'active'
        ? log.status
        : skipped
          ? 'skipped'
          : 'completed',
    slotId: typeof log.slotId === 'string' || log.slotId === null ? log.slotId : null,
    templateSlotId:
      typeof log.templateSlotId === 'string' || log.templateSlotId === null ? log.templateSlotId : null,
    templateExerciseId:
      typeof log.templateExerciseId === 'string' || log.templateExerciseId === null ? log.templateExerciseId : null,
    notes: typeof log.notes === 'string' ? log.notes.trim() || null : null,
    swappedFrom,
    ...repsUnitOf(log),
  };
}
