import {
  AppDatabase,
  AppLanguage,
  BodyweightEntry,
  ExerciseLog,
  ExerciseTemplate,
  WorkoutPlan,
  WorkoutSession,
  WorkoutTemplate,
} from '../types/models';
import { getComparableLogSets, isMinutesLog, logRecordedWork } from './exerciseLog';
import { t } from './i18n';

export interface ExerciseLogWithSession extends ExerciseLog {
  performedAt: string;
  workoutNameSnapshot: string;
}

export interface ExerciseProgressSummary {
  key: string;
  name: string;
  /** The logs the row's story (latest, previous, signal) is told from. */
  logs: ExerciseLogWithSession[];
  /**
   * Every performed log of the lift, tracked or not, newest first. The bests
   * and the Records tab read this one, so a number the finish screen calls a
   * PR is the number Records shows.
   */
  allLogs: ExerciseLogWithSession[];
  latestLog?: ExerciseLogWithSession;
  previousLog?: ExerciseLogWithSession;
  latestWeight: number | null;
  previousWeight: number | null;
  latestReps: string;
  bestWeight: number | null;
  bestReps: number;
  /**
   * The one number this lift is judged on, per session.
   *
   * Kilos for a loaded lift; total reps for a lift that is never loaded,
   * because that one does not progress in kilos and reading its weight gives
   * 0 every time. `bestValueBefore` excludes the latest session on purpose —
   * see getExerciseProgressSignal.
   */
  latestValue: number | null;
  previousValue: number | null;
  bestValueBefore: number | null;
}

export interface BodyweightProgressSummary {
  latest?: BodyweightEntry;
  previous?: BodyweightEntry;
  entries: BodyweightEntry[];
}

export interface ExerciseProgressSignal {
  kind: 'new_best' | 'moving_up' | 'below_last' | 'building' | 'starting';
  label: string;
}

export interface SessionSummary {
  session: WorkoutSession;
  logs: ExerciseLog[];
  setsCompleted: number;
  totalVolume: number;
}

function normalizeExerciseKey(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Whether a logged exercise name is the lift being asked about.
 *
 * The answer lives in the programme layer — `isSameLift` for a target,
 * `isSameLiftAsLibraryRow` (the same rule, narrowed to one library row) for an
 * exercise page — and is passed in rather than imported so this module stays
 * below that layer, the same way `resolveGoalProgress` takes its matcher.
 */
export type SameLiftMatcher = (loggedName: string, liftName: string) => boolean;

function isSameName(loggedName: string, liftName: string) {
  return normalizeExerciseKey(loggedName) === normalizeExerciseKey(liftName);
}

function resolveCanonicalExerciseName(log: ExerciseLog, exercisesById: Record<string, ExerciseTemplate>) {
  if (log.exerciseTemplateId) {
    const template = exercisesById[log.exerciseTemplateId];
    if (template?.name) {
      return template.name.trim();
    }
  }

  return log.exerciseNameSnapshot.trim();
}

function attachSession(
  log: ExerciseLog,
  sessionsById: Record<string, WorkoutSession>,
): ExerciseLogWithSession | null {
  const session = sessionsById[log.sessionId];
  if (!session) {
    return null;
  }

  return {
    ...log,
    performedAt: session.performedAt,
    workoutNameSnapshot: session.workoutNameSnapshot,
  };
}

function getTopComparableWeight(log: Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'>) {
  const sets = getComparableLogSets(log);
  if (sets.length === 0) {
    return null;
  }

  return sets.reduce((best, set) => Math.max(best, set.weight), 0);
}

function getComparableReps(log: Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'>) {
  return getComparableLogSets(log).map((set) => set.reps);
}

export function getTotalReps(repsPerSet: number[]) {
  return repsPerSet.reduce((sum, reps) => sum + reps, 0);
}

export function getCompletedSetCount(logs: readonly Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'>[]) {
  return logs.reduce((sum, log) => sum + (log.skipped ? 0 : getComparableLogSets(log).length), 0);
}

/**
 * Kilograms moved: weight × reps. A log of minutes has none — twenty minutes
 * is not twenty reps of anything, and whatever stands in its weight column
 * (nothing, from the player) is not a load that was lifted twenty times.
 */
export function getTotalVolume(
  log: Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'> & Pick<Partial<ExerciseLog>, 'repsUnit'>,
) {
  if (isMinutesLog(log)) {
    return 0;
  }
  return getComparableLogSets(log).reduce((sum, set) => sum + set.weight * set.reps, 0);
}

export function getSessionTotalVolume(
  logs: readonly (Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'> & Pick<Partial<ExerciseLog>, 'repsUnit'>)[],
) {
  return logs.reduce((sum, log) => sum + (log.skipped ? 0 : getTotalVolume(log)), 0);
}

export function getLatestLogForTemplateExercise(database: AppDatabase, exerciseTemplateId: string) {
  const sessionsById = Object.fromEntries(
    database.workoutSessions.map((session) => [session.id, session] as const),
  );

  return database.exerciseLogs
    // Unperformed logs (every set skipped, a note-only row, a swap never lifted)
    // are not sessions of the lift: they read as "Vs –" on Home and a null
    // latest on the exercise page (bug hunt, 2026-10-04).
    .filter((log) => log.exerciseTemplateId === exerciseTemplateId && !log.skipped && logRecordedWork(log))
    .map((log) => attachSession(log, sessionsById))
    .filter((log): log is ExerciseLogWithSession => Boolean(log))
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())[0];
}

export function getRecentLogsForExercise(database: AppDatabase, exerciseName: string, limit = 2) {
  const sessionsById = Object.fromEntries(
    database.workoutSessions.map((session) => [session.id, session] as const),
  );
  const normalizedName = normalizeExerciseKey(exerciseName);
  const exercisesById = Object.fromEntries(
    database.exerciseTemplates.map((exercise) => [exercise.id, exercise] as const),
  );

  return database.exerciseLogs
    .filter((log) => {
      // Same rule as getTrackedExerciseProgress: a log with no performed reps
      // is not a session (bug hunt, 2026-10-04).
      if (log.skipped || !logRecordedWork(log)) {
        return false;
      }

      return normalizeExerciseKey(resolveCanonicalExerciseName(log, exercisesById)) === normalizedName;
    })
    .map((log) => attachSession(log, sessionsById))
    .filter((log): log is ExerciseLogWithSession => Boolean(log))
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())
    .slice(0, limit);
}
function finalizeExerciseSummary(
  key: string,
  name: string,
  logs: ExerciseLogWithSession[],
): ExerciseProgressSummary {
  const sortedLogs = [...logs].sort(
    (left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime(),
  );
  const latestLog = sortedLogs[0];
  const previousLog = sortedLogs[1];
  const bestWeight = sortedLogs.reduce<number | null>((best, log) => {
    const topWeight = getTopComparableWeight(log);
    if (topWeight === null) {
      return best;
    }

    if (best === null || topWeight > best) {
      return topWeight;
    }

    return best;
  }, null);
  const bestReps = sortedLogs.reduce((best, log) => Math.max(best, getTotalReps(getComparableReps(log))), 0);

  /**
   * A lift that is never loaded is measured in reps.
   *
   * Its weight reads 0 every session, so "the latest equals the best" is true
   * from the second session onward and stays true — which is how a treadmill
   * HIIT at 0 kg wore "Uusi ennätys" permanently while the lift beside it,
   * which had genuinely done something, wore "Alkuvaihe" (#bugs 2026-08-26).
   * Reps are what the progression rules already raise on a bodyweight lift.
   */
  const byReps = bestWeight === null || bestWeight <= 0;
  const valueOf = (log: ExerciseLogWithSession | undefined): number | null => {
    if (!log) {
      return null;
    }
    if (!byReps) {
      return getTopComparableWeight(log);
    }
    const reps = getTotalReps(getComparableReps(log));
    return reps > 0 ? reps : null;
  };

  return {
    key,
    name,
    logs: sortedLogs,
    allLogs: sortedLogs,
    latestLog,
    previousLog,
    latestWeight: latestLog ? getTopComparableWeight(latestLog) : null,
    previousWeight: previousLog ? getTopComparableWeight(previousLog) : null,
    latestReps: latestLog ? getComparableReps(latestLog).join(',') : '-',
    bestWeight,
    bestReps,
    latestValue: valueOf(latestLog),
    previousValue: valueOf(previousLog),
    // Newest first, so the history is everything after the first entry.
    bestValueBefore: sortedLogs.slice(1).reduce<number | null>((best, log) => {
      const value = valueOf(log);
      if (value === null) {
        return best;
      }
      return best === null || value > best ? value : best;
    }, null),
  };
}

/** The three tables a lift's progress is read from. */
export type ProgressDatabase = Pick<AppDatabase, 'exerciseLogs' | 'exerciseTemplates' | 'workoutSessions'>;

/**
 * `getExerciseProgressForName` for one database and matcher, remembering the
 * last answer. The exercise page asks on every shell render, and a render that
 * changed nothing it reads (a technique tick, a preference) used to rebuild the
 * whole summary and every chart label from it; the same name now returns the
 * same summary object, so what hangs off it stays memoised.
 */
export function createExerciseProgressLookup(database: ProgressDatabase, sameLift: SameLiftMatcher = isSameName) {
  let lastName: string | null = null;
  let lastSummary: ExerciseProgressSummary | null = null;
  return (exerciseName: string): ExerciseProgressSummary => {
    if (lastSummary === null || lastName !== exerciseName) {
      lastSummary = getExerciseProgressForName(database, exerciseName, sameLift);
      lastName = exerciseName;
    }
    return lastSummary;
  };
}

/**
 * Build a progress summary for a single exercise by name, regardless of whether
 * the user has tracked it. Used by the Exercise Detail screen to show this lift's
 * real history. Returns an empty-logs summary when nothing has been logged yet.
 *
 * `sameLift` decides which logs are this lift. Without it only the exact name
 * counts — and the library's row is "Barbell Bench Press - Medium Grip" while
 * a programme built by onboarding logs "Bench Press", so six bench sessions
 * read "No history yet" on the bench press's own page (emulator, 2026-09-13).
 */
export function getExerciseProgressForName(
  database: ProgressDatabase,
  exerciseName: string,
  sameLift: SameLiftMatcher = isSameName,
): ExerciseProgressSummary {
  const exercisesById = Object.fromEntries(
    database.exerciseTemplates.map((exercise) => [exercise.id, exercise] as const),
  );
  const sessionsById = Object.fromEntries(
    database.workoutSessions.map((session) => [session.id, session] as const),
  );
  const normalizedName = normalizeExerciseKey(exerciseName);
  // A log is asked about once per spelling, not once per log: a long history
  // is the same handful of names repeated.
  const verdicts = new Map<string, boolean>();

  const logs = database.exerciseLogs
    .filter((log) => {
      // An unperformed log would become the "latest" with no top weight
      // (bug hunt, 2026-10-04).
      if (log.skipped || !logRecordedWork(log)) {
        return false;
      }

      const name = resolveCanonicalExerciseName(log, exercisesById);
      const key = normalizeExerciseKey(name);
      let verdict = verdicts.get(key);
      if (verdict === undefined) {
        verdict = sameLift(name, exerciseName);
        verdicts.set(key, verdict);
      }
      return verdict;
    })
    .map((log) => attachSession(log, sessionsById))
    .filter((log): log is ExerciseLogWithSession => Boolean(log));

  return finalizeExerciseSummary(normalizedName, exerciseName.trim(), logs);
}

/**
 * One lift's progress under every name it was logged as, from the tracked
 * summaries.
 *
 * The tracked summaries group by the logged name, which is right for Records
 * and for a Home card pinned to that name. A target lift is not a logged name:
 * the target row for "Barbell Squat" joined on its own name found the empty
 * summary its target seeds, while every squat sat under "Back Squat" — so the
 * row read "Alkuvaihe –" and its sheet "No logged sets" beside a goal flow
 * quoting a 110 kg best (emulator, 2026-09-14).
 *
 * Keyed and named by the lift asked about, so the row and its sheet keep the
 * lift's identity. Null when no summary is this lift: nothing logged under any
 * spelling, and no target seeding one.
 */
export function getLiftProgress(
  liftName: string,
  summaries: readonly ExerciseProgressSummary[],
  sameLift: SameLiftMatcher,
): ExerciseProgressSummary | null {
  const name = liftName.trim();
  if (!name) {
    return null;
  }
  const matching = summaries.filter((summary) => sameLift(summary.name, name));
  if (matching.length === 0) {
    return null;
  }
  // Each log sits in exactly one tracked summary, so the union has no repeats.
  return finalizeExerciseSummary(
    normalizeExerciseKey(name),
    name,
    matching.flatMap((summary) => summary.logs),
  );
}

export interface LiftHistoryEntry {
  performedAt: string;
  sets: Array<{ weight: number; reps: number }>;
}

/**
 * Every session of every lift, by name — tracked or not.
 *
 * The tracked summaries above are the Records' view: a lift is judged only
 * where its programme marked it `tracked`, and "Leg Curl" is tracked in one
 * programme and an accessory in another. A history tab under the lift's own
 * name is not that view. It was built from the tracked summaries once, and an
 * untracked slot's own sessions vanished from its own tab (CI review of #154).
 *
 * Keyed by the canonical name, lowercased, the way the summaries group.
 * Skipped logs and logs that recorded no work are not sessions of the lift.
 */
export function getLiftHistoryByName(database: AppDatabase): Map<string, LiftHistoryEntry[]> {
  const exercisesById = Object.fromEntries(
    database.exerciseTemplates.map((exercise) => [exercise.id, exercise] as const),
  );
  const sessionsById = Object.fromEntries(
    database.workoutSessions.map((session) => [session.id, session] as const),
  );
  const byName = new Map<string, LiftHistoryEntry[]>();
  for (const log of database.exerciseLogs) {
    if (log.skipped || !logRecordedWork(log)) {
      continue;
    }
    const session = sessionsById[log.sessionId];
    if (!session) {
      continue;
    }
    const key = normalizeExerciseKey(resolveCanonicalExerciseName(log, exercisesById));
    const entry: LiftHistoryEntry = {
      performedAt: session.performedAt,
      sets: getComparableLogSets(log).map((set) => ({ weight: set.weight, reps: set.reps })),
    };
    const list = byName.get(key);
    if (list) {
      list.push(entry);
    } else {
      byName.set(key, [entry]);
    }
  }
  return byName;
}

export function getTrackedExerciseProgress(database: AppDatabase): ExerciseProgressSummary[] {
  const exercisesById = Object.fromEntries(
    database.exerciseTemplates.map((exercise) => [exercise.id, exercise] as const),
  );
  const sessionsById = Object.fromEntries(
    database.workoutSessions.map((session) => [session.id, session] as const),
  );
  const grouped = new Map<
    string,
    { name: string; logs: ExerciseLogWithSession[]; trackedLogs: ExerciseLogWithSession[]; anyTracked: boolean }
  >();

  database.exerciseLogs.forEach((log) => {
    // An exercise that was listed but never performed is not a session on that
    // lift. Without this, a workout you opened and abandoned reads as a day you
    // lifted zero, and the lift's whole trend follows it down.
    if (log.skipped || !logRecordedWork(log)) {
      return;
    }

    const attachedLog = attachSession(log, sessionsById);
    if (!attachedLog) {
      return;
    }

    const name = resolveCanonicalExerciseName(log, exercisesById);
    const key = normalizeExerciseKey(name);
    const existing = grouped.get(key);

    if (existing) {
      existing.logs.push(attachedLog);
      if (log.tracked) {
        existing.trackedLogs.push(attachedLog);
      }
      existing.name = name;
      existing.anyTracked = existing.anyTracked || log.tracked;
      return;
    }

    grouped.set(key, { name, logs: [attachedLog], trackedLogs: log.tracked ? [attachedLog] : [], anyTracked: log.tracked });
  });

  // Tracking decides which lifts get a row, not which sets count for it. A
  // heavier performed set is a record whatever the slot's progression
  // priority was; buildExercisePrLookup (the completion screen's PR badge)
  // already counts every log, so Records read 100 where the badge read 110
  // (bug hunt, 2026-10-04). A lift never tracked anywhere still gets no row.
  const goalKeys = new Set(
    (database.preferences.strengthGoals ?? []).map((goal) => normalizeExerciseKey(goal.exerciseName.trim())),
  );
  for (const [key, group] of [...grouped.entries()]) {
    if (!group.anyTracked && !goalKeys.has(key)) {
      grouped.delete(key);
    }
  }

  /**
   * A lift you have set a TARGET on shows here before you have logged it.
   *
   * This used to be the library's star — "track this" — whose only job was
   * exactly this line. Two ways to say "I care about this lift" is one too
   * many, and the star was the one that asked for nothing back: it put an
   * empty row on Progress and never said what it was for. A target names a
   * number, so the row has something to move towards from the first session
   * (user, 2026-09-01).
   *
   * Keyed by name rather than by library id, because that is what a goal
   * carries and what the logs group on.
   */
  (database.preferences.strengthGoals ?? []).forEach((goal) => {
    const name = goal.exerciseName.trim();
    if (!name) {
      return;
    }
    const key = normalizeExerciseKey(name);
    if (grouped.has(key)) {
      return;
    }
    grouped.set(key, { name, logs: [], trackedLogs: [], anyTracked: false });
  });

  return Array.from(grouped.entries())
    .map(([key, value]) => {
      // The row's story — latest, previous, the signal, the sort — is the
      // tracked lift's, as before: an untracked accessory set of the same
      // name done lighter on another day must not flip it to "below last".
      // Only the bests read every performed set (review, 2026-10-04).
      const trend = finalizeExerciseSummary(key, value.name, value.trackedLogs.length > 0 ? value.trackedLogs : value.logs);
      const everything = finalizeExerciseSummary(key, value.name, value.logs);
      return withBestsFrom(trend, everything);
    })
    .sort((left, right) => {
      const leftDate = left.latestLog ? new Date(left.latestLog.performedAt).getTime() : 0;
      const rightDate = right.latestLog ? new Date(right.latestLog.performedAt).getTime() : 0;
      return rightDate - leftDate;
    });
}

/** The trend summary, with its bests and its "best before" read from every performed set. */
function withBestsFrom(trend: ExerciseProgressSummary, everything: ExerciseProgressSummary): ExerciseProgressSummary {
  const byReps = trend.bestWeight === null || trend.bestWeight <= 0;
  const latestId = trend.latestLog?.id ?? null;
  const latestTime = trend.latestLog ? new Date(trend.latestLog.performedAt).getTime() : null;
  // "Before" means before: a lighter set logged AFTER the latest session
  // must not make the latest look like a new best.
  const bestValueBefore = everything.logs
    .filter((log) => log.id !== latestId && (latestTime === null || new Date(log.performedAt).getTime() <= latestTime))
    .reduce<number | null>((best, log) => {
      const value = byReps
        ? getTotalReps(getComparableReps(log)) || null
        : getTopComparableWeight(log);
      if (value === null) {
        return best;
      }
      return best === null || value > best ? value : best;
    }, null);
  return {
    ...trend,
    allLogs: everything.logs,
    // The same mode as the rest of the row: a lift the trend reads in reps
    // does not get a kilo best from a stray weighted set.
    bestWeight: byReps ? trend.bestWeight : everything.bestWeight,
    bestReps: everything.bestReps,
    bestValueBefore,
  };
}

export function getBodyweightProgress(database: Pick<AppDatabase, 'bodyweightEntries'>): BodyweightProgressSummary {
  const entries = [...database.bodyweightEntries].sort(
    (left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime(),
  );

  return {
    latest: entries[0],
    previous: entries[1],
    entries,
  };
}

export function getExerciseProgressSignal(
  summary: ExerciseProgressSummary,
  language: AppLanguage = 'en',
): ExerciseProgressSignal {
  /**
   * Beaten, not matched.
   *
   * This used to compare the latest session against a best that already
   * contained it — "the latest IS the best" — which is also true of every
   * session that merely repeats it. Combined with an unloaded lift reading 0
   * kg forever, that made the chip permanent, and a chip that is always on
   * says nothing. Mark the exception, not the normal.
   */
  if (
    summary.latestValue !== null &&
    summary.bestValueBefore !== null &&
    summary.latestValue - summary.bestValueBefore > 0.0001
  ) {
    return {
      kind: 'new_best',
      label: t(language, 'signal.newBest'),
    };
  }

  if (
    summary.latestValue !== null &&
    summary.previousValue !== null &&
    summary.latestValue - summary.previousValue > 0.0001
  ) {
    return {
      kind: 'moving_up',
      label: t(language, 'signal.movingUp'),
    };
  }

  if (
    summary.latestValue !== null &&
    summary.previousValue !== null &&
    summary.previousValue - summary.latestValue > 0.0001
  ) {
    return {
      kind: 'below_last',
      label: t(language, 'signal.belowLast'),
    };
  }

  if (summary.logs.length >= 3) {
    return {
      kind: 'building',
      label: t(language, 'signal.building'),
    };
  }

  return {
    kind: 'starting',
    label: t(language, 'signal.starting'),
  };
}

export function getSessionSummary(database: AppDatabase, sessionId: string): SessionSummary | null {
  const session = database.workoutSessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const logs = database.exerciseLogs
    .filter((log) => log.sessionId === sessionId)
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    session,
    logs,
    setsCompleted: getCompletedSetCount(logs),
    totalVolume: getSessionTotalVolume(logs),
  };
}

export function getMostRecentSessionSummary(database: AppDatabase): SessionSummary | null {
  const latestSession = [...database.workoutSessions].sort(
    (left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime(),
  )[0];

  if (!latestSession) {
    return null;
  }

  return getSessionSummary(database, latestSession.id);
}

export function getActivePlan(database: AppDatabase): WorkoutPlan | null {
  const activePlanId = database.preferences.activePlanId;
  if (activePlanId) {
    const match = database.workoutPlans.find((plan) => plan.id === activePlanId);
    if (match) {
      return match;
    }
  }

  return null;
}

