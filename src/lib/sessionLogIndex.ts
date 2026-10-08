import type { ExerciseLog } from '../types/models';

/** One shared empty answer, so a session with no logs does not allocate. */
const NO_LOGS: ExerciseLog[] = [];

/**
 * Every session's logs in one pass: `sessionId` to its logs, each group in
 * `orderIndex` order, exactly what `exerciseLogRepository.listBySessionId`
 * answers for that session.
 *
 * History asks for the logs of every session it lists, so asking per session
 * meant a pass over the whole log list each time: sessions times logs, about
 * 100 ms under an interpreter at 800 sessions. Built once per change to the
 * log list, each ask is a lookup.
 *
 * The groups are shared between askers. Copy before reordering or editing.
 */
export function groupLogsBySession(logs: ReadonlyArray<ExerciseLog>): Map<string, ExerciseLog[]> {
  const groups = new Map<string, ExerciseLog[]>();
  for (const log of logs) {
    const group = groups.get(log.sessionId);
    if (group) {
      group.push(log);
    } else {
      groups.set(log.sessionId, [log]);
    }
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      group.sort((left, right) => left.orderIndex - right.orderIndex);
    }
  }
  return groups;
}

/** The logs of one session from `groupLogsBySession`, empty when it has none. */
export function logsOfSession(index: ReadonlyMap<string, ExerciseLog[]>, sessionId: string): ExerciseLog[] {
  return index.get(sessionId) ?? NO_LOGS;
}
