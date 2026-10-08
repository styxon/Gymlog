import { WorkoutSessionRuntime, WorkoutTemplateSession } from '../features/workout/workoutTypes';
import {
  getCanonicalCompletedSessions,
  getCalendarWeekStartTimestamp,
  getRollingWindowStart,
} from './completedSessions';
import { getComparableLogSets } from './exerciseLog';
import { formatLogSetSummary, formatShortDate, pluralize } from './format';
import { AppDatabase, ExerciseLog, UnitPreference, WorkoutSession } from '../types/models';

export interface ProgramInsightHighlight {
  label: string;
  value: string;
  detail?: string | null;
}

export interface ProgramInsightSummary {
  cardPrimary: string | null;
  cardSecondary: string | null;
  highlights: ProgramInsightHighlight[];
  sessionStatusById: Record<string, string>;
}

interface ProgramInsightInput {
  id: string;
  name: string;
  sessions: WorkoutTemplateSession[];
  weeklyTarget?: number | null;
}

interface ComparableSet {
  weight: number;
  reps: number;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function inferSessionIdFromSnapshot(programName: string, sessions: WorkoutTemplateSession[], snapshotName: string | null | undefined) {
  if (!snapshotName) {
    return null;
  }

  const normalizedSnapshot = normalize(snapshotName);
  const exactMatch = sessions.find((session) => normalize(session.name) === normalizedSnapshot);
  if (exactMatch) {
    return exactMatch.id;
  }

  const programPrefixedMatch = sessions.find(
    (session) => normalizedSnapshot === normalize(`${programName} - ${session.name}`),
  );
  if (programPrefixedMatch) {
    return programPrefixedMatch.id;
  }

  const suffixMatch = sessions.find((session) => normalizedSnapshot.endsWith(normalize(` - ${session.name}`)));
  return suffixMatch?.id ?? null;
}

function getNextSessionName(sessions: WorkoutTemplateSession[], sessionId: string | null) {
  if (!sessions.length) {
    return null;
  }

  const ordered = [...sessions].sort((left, right) => left.orderIndex - right.orderIndex);
  if (!sessionId) {
    return ordered[0].name;
  }

  const index = ordered.findIndex((session) => session.id === sessionId);
  if (index === -1) {
    return ordered[0].name;
  }

  return ordered[(index + 1) % ordered.length]?.name ?? ordered[0].name;
}

function getBestComparableSet(log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'>): ComparableSet | null {
  const sets = getComparableLogSets(log);
  if (!sets.length) {
    return null;
  }

  return sets.reduce((best, current) => {
    if (!best) {
      return current;
    }

    if (current.weight > best.weight) {
      return current;
    }

    if (Math.abs(current.weight - best.weight) < 0.0001 && current.reps > best.reps) {
      return current;
    }

    return best;
  }, null as ComparableSet | null);
}

function compareComparableSets(left: ComparableSet | null, right: ComparableSet | null) {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  if (Math.abs(left.weight - right.weight) > 0.0001) {
    return left.weight > right.weight ? 1 : -1;
  }

  if (left.reps !== right.reps) {
    return left.reps > right.reps ? 1 : -1;
  }

  return 0;
}

function getLatestTrackedLog(
  database: AppDatabase,
  completedSessions: WorkoutSession[],
): { exerciseName: string; log: ExerciseLog; performedAt: string } | null {
  const completedSessionIds = new Set(completedSessions.map((session) => session.id));
  const sessionsById = Object.fromEntries(database.workoutSessions.map((session) => [session.id, session] as const));

  const latest = database.exerciseLogs
    .filter(
      (log) =>
        completedSessionIds.has(log.sessionId) &&
        log.tracked &&
        !log.skipped &&
        getComparableLogSets(log).length > 0,
    )
    .map((log) => ({
      log,
      exerciseName: log.exerciseNameSnapshot.trim(),
      performedAt: sessionsById[log.sessionId]?.performedAt ?? '',
    }))
    .filter((entry) => entry.performedAt)
    .sort(
      (left, right) =>
        new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime() || left.log.orderIndex - right.log.orderIndex,
    )[0];

  return latest ?? null;
}

function getProgramPrSignal(
  database: AppDatabase,
  completedSessions: WorkoutSession[],
  latestTrackedLog: { exerciseName: string; log: ExerciseLog; performedAt: string } | null,
) {
  if (!latestTrackedLog) {
    return null;
  }

  const completedSessionIds = new Set(completedSessions.map((session) => session.id));
  const latestBestSet = getBestComparableSet(latestTrackedLog.log);
  if (!latestBestSet) {
    return null;
  }

  const previousBestSet = database.exerciseLogs
    .filter(
      (log) =>
        completedSessionIds.has(log.sessionId) &&
        log.sessionId !== latestTrackedLog.log.sessionId &&
        !log.skipped &&
        normalize(log.exerciseNameSnapshot) === normalize(latestTrackedLog.exerciseName),
    )
    .map((log) => getBestComparableSet(log))
    .reduce((best, current) => (compareComparableSets(current, best) > 0 ? current : best), null as ComparableSet | null);

  if (!previousBestSet || compareComparableSets(latestBestSet, previousBestSet) <= 0) {
    return null;
  }

  return {
    exerciseName: latestTrackedLog.exerciseName,
    summary: formatLogSetSummary(latestTrackedLog.log, database.preferences.unitPreference),
  };
}

function buildSessionStatusMap(
  sessions: WorkoutTemplateSession[],
  lastCompletedBySessionId: Record<string, string>,
  activeSessionId: string | null,
  nextSessionName: string | null,
) {
  return Object.fromEntries(
    [...sessions]
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((session) => {
        const statusParts: string[] = [];

        if (activeSessionId === session.id) {
          statusParts.push('Live now');
        } else if (!activeSessionId && nextSessionName === session.name) {
          statusParts.push('Next up');
        }

        if (lastCompletedBySessionId[session.id]) {
          statusParts.push(`Last done ${formatShortDate(lastCompletedBySessionId[session.id])}`);
        } else {
          statusParts.push('Not logged yet');
        }

        return [session.id, statusParts.join(' | ')] as const;
      }),
  );
}

function getRhythmDetail(last30DaysSessions: number, targetSessions: number | null) {
  if (!targetSessions) {
    return null;
  }

  if (last30DaysSessions === 0) {
    return 'No momentum yet';
  }

  const ratio = last30DaysSessions / targetSessions;
  if (ratio >= 0.95) {
    return 'On pace';
  }

  if (ratio >= 0.65) {
    return 'Building back';
  }

  return 'Behind target';
}

export function buildProgramInsightMap({
  database,
  programs,
  unitPreference,
  activeSession,
  now = new Date(),
}: {
  database: AppDatabase;
  programs: ProgramInsightInput[];
  unitPreference: UnitPreference;
  /** Only which template is running, and under what name, is read. */
  activeSession: Pick<WorkoutSessionRuntime, 'templateId' | 'templateName'> | null;
  now?: Date;
}) {
  const canonicalSessions = getCanonicalCompletedSessions(database);
  const currentWeekStart = getCalendarWeekStartTimestamp(now);
  const nowTimestamp = new Date(now).getTime();
  // The same window the Home tile's own 30-day figure uses. Computed here once
  // meant the two numbers agreed only until a clock change moved one of them.
  const last30DaysStart = getRollingWindowStart(now, 30);

  return Object.fromEntries(
    programs.map((program) => {
      const completedSessions = canonicalSessions.filter((session) => session.workoutTemplateId === program.id);
      const sessionsThisWeek = completedSessions.filter(
        (session) => getCalendarWeekStartTimestamp(session.performedAt) === currentWeekStart,
      ).length;
      const sessionsLast30Days = completedSessions.filter((session) => {
        const performedAt = new Date(session.performedAt).getTime();
        return performedAt >= last30DaysStart && performedAt <= nowTimestamp;
      }).length;
      const lastCompleted = completedSessions[0] ?? null;
      const activeSessionId =
        activeSession?.templateId === program.id
          ? inferSessionIdFromSnapshot(program.name, program.sessions, activeSession.templateName)
          : null;
      const lastCompletedSessionId = inferSessionIdFromSnapshot(
        program.name,
        program.sessions,
        lastCompleted?.workoutNameSnapshot,
      );
      const nextSessionName = activeSessionId
        ? program.sessions.find((session) => session.id === activeSessionId)?.name ?? null
        : getNextSessionName(program.sessions, lastCompletedSessionId);

      const lastCompletedBySessionId = Object.fromEntries(
        completedSessions
          .map((session) => [
            inferSessionIdFromSnapshot(program.name, program.sessions, session.workoutNameSnapshot),
            session.performedAt,
          ] as const)
          .filter((entry): entry is [string, string] => Boolean(entry[0]))
          .filter((entry, index, array) => array.findIndex((candidate) => candidate[0] === entry[0]) === index),
      );

      const latestTrackedLog = getLatestTrackedLog(database, completedSessions);
      const latestTopSet = latestTrackedLog
        ? `${latestTrackedLog.exerciseName} ${formatLogSetSummary(latestTrackedLog.log, unitPreference)}`
        : null;
      const prSignal = getProgramPrSignal(database, completedSessions, latestTrackedLog);
      const targetSessionsLast30Days = program.weeklyTarget
        ? Math.max(1, Math.round((program.weeklyTarget * 30) / 7))
        : null;
      const rhythmValue = targetSessionsLast30Days
        ? `${sessionsLast30Days}/${targetSessionsLast30Days}`
        : `${sessionsLast30Days} in 30 days`;
      const cardPrimary = nextSessionName
        ? `${activeSessionId ? 'Live now' : 'Next'}: ${nextSessionName}`
        : null;
      const cardSecondary = prSignal
        ? `PR: ${prSignal.exerciseName} ${prSignal.summary}`
        : latestTopSet
          ? `Top set: ${latestTopSet}`
          : lastCompleted
            ? `Last completed ${formatShortDate(lastCompleted.performedAt)}`
            : 'No sessions logged yet';
      const highlights: ProgramInsightHighlight[] = [
        {
          label: 'This week',
          value: pluralize(sessionsThisWeek, 'session'),
        },
        {
          label: 'Rhythm',
          value: rhythmValue,
          detail: getRhythmDetail(sessionsLast30Days, targetSessionsLast30Days),
        },
      ];

      if (nextSessionName) {
        highlights.push({
          label: activeSessionId ? 'Live now' : 'Next up',
          value: nextSessionName,
        });
      }

      if (prSignal) {
        highlights.push({
          label: 'PR signal',
          value: 'New PR',
          detail: `${prSignal.exerciseName} - ${prSignal.summary}`,
        });
      } else if (latestTrackedLog) {
        highlights.push({
          label: 'Top set',
          value: latestTrackedLog.exerciseName,
          detail: formatLogSetSummary(latestTrackedLog.log, unitPreference),
        });
      } else if (lastCompleted) {
        highlights.push({
          label: 'Last completed',
          value: formatShortDate(lastCompleted.performedAt),
        });
      }

      return [
        program.id,
        {
          cardPrimary,
          cardSecondary,
          highlights,
          sessionStatusById: buildSessionStatusMap(program.sessions, lastCompletedBySessionId, activeSessionId, nextSessionName),
        } satisfies ProgramInsightSummary,
      ] as const;
    }),
  );
}
