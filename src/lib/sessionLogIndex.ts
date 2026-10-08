import type { ExerciseLog } from '../types/models';

/**
 * Every session's logs in one pass, each session's in `orderIndex` order.
 *
 * Asking "the logs of this session" by filtering the whole table is one scan
 * of every log per question, so a screen that asks it for each of its sessions
 * (History does, and so does the Home recent list) scanned the table once per
 * session — sessions times logs, which is the part of a long history that grows
 * fastest. The answer per session is the same as `exerciseLogRepository
 * .listBySessionId`: the session's logs in table order, then a stable sort on
 * `orderIndex`.
 */
export function indexLogsBySession(logs: readonly ExerciseLog[]): Map<string, ExerciseLog[]> {
  const bySession = new Map<string, ExerciseLog[]>();
  for (const log of logs) {
    const bucket = bySession.get(log.sessionId);
    if (bucket) {
      bucket.push(log);
    } else {
      bySession.set(log.sessionId, [log]);
    }
  }
  for (const bucket of bySession.values()) {
    bucket.sort((left, right) => left.orderIndex - right.orderIndex);
  }
  return bySession;
}
