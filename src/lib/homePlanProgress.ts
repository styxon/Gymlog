import { t } from './i18n';
import { countSessionsSince } from './programCompletion';
import { AppLanguage, WorkoutSession } from '../types/models';

const DEFAULT_HOME_PLAN_TOTAL_WEEKS = 8;

export interface HomePlanProgressInput {
  completedSessions: number;
  sessionsPerWeek: number;
  totalWeeks?: number;
  language?: AppLanguage;
}

export interface HomePlanProgress {
  weekLabel: string;
  progressPercent: number;
  weekProgressLabel: string;
  weekProgressPercent: number;
  currentWeek: number;
  totalWeeks: number;
  sessionsDone: number;
  sessionsTotal: number;
}

/**
 * Where the reader is in the programme's block: "week N of M", the hero's
 * progress and "X of Y sessions".
 *
 * A block week is SESSION-COUNTED: one week is one pass through the
 * programme's days (`sessionsPerWeek` logged sessions), not a calendar week.
 * The block tracks the programme, not the calendar, so a missed week does not
 * advance it and a reader on an on/off cycle (2 on, 1 off: about 4.7 sessions
 * a calendar week) moves to week 2 after three sessions, about four days in.
 * Kept on purpose (owner decision 2026-10-12, duplicate sweep 13 D5-9). The
 * calendar answer — planned sessions per calendar week — is
 * trainingSchedule.cycleSessionsPerWeek, which the coach is told; the two
 * numbers answer different questions and are not meant to agree.
 */
export function buildHomePlanProgress({
  completedSessions,
  sessionsPerWeek,
  totalWeeks = DEFAULT_HOME_PLAN_TOTAL_WEEKS,
  language = 'en',
}: HomePlanProgressInput): HomePlanProgress {
  const safeSessionsPerWeek = Math.max(1, Math.round(sessionsPerWeek));
  const safeTotalWeeks = Math.max(1, Math.round(totalWeeks));
  const completedCount = Math.max(0, completedSessions);
  const totalPlannedSessions = safeSessionsPerWeek * safeTotalWeeks;
  const currentWeek = Math.min(safeTotalWeeks, Math.floor(completedCount / safeSessionsPerWeek) + 1);
  const rawProgressPercent = Math.round((completedCount / totalPlannedSessions) * 100);
  const progressPercent = Math.min(100, Math.max(1, rawProgressPercent));
  // Sessions done within the current week; a fully completed plan shows the
  // final week as full rather than rolling over to 0.
  const doneThisWeek =
    completedCount >= totalPlannedSessions ? safeSessionsPerWeek : completedCount % safeSessionsPerWeek;
  const weekProgressPercent = Math.round((doneThisWeek / safeSessionsPerWeek) * 100);

  return {
    weekLabel: t(language, 'plan.weekOf', { week: currentWeek, total: safeTotalWeeks }),
    progressPercent,
    weekProgressLabel: t(language, 'plan.weekProgress', {
      week: currentWeek,
      done: doneThisWeek,
      total: safeSessionsPerWeek,
    }),
    weekProgressPercent,
    currentWeek,
    totalWeeks: safeTotalWeeks,
    // Plan-wide session counts for the Home v4 hero ("0 of 24 sessions").
    sessionsDone: Math.min(completedCount, totalPlannedSessions),
    sessionsTotal: totalPlannedSessions,
  };
}

/**
 * The week the session that was just logged belongs to.
 *
 * `currentWeek` is the week the reader is IN, and the moment the last session
 * of a week is saved that is already the next one — so the summary for the
 * third session of week 1 read "WEEK 2 · 3/3", a week label over a count that
 * belongs to the week before it. The summary is about the session that was
 * logged, so it names the week that session filled. The finish view, which
 * renders before the save, asks with the session in hand counted — the same
 * week `currentWeek` names, reached by the same rule.
 *
 * Module-private: screens read it through `blockWeekTally` and
 * `blockWeekOfSession`, so a week label and the count beside it cannot come
 * from two different rules again.
 */
function weekOfLastLoggedSession({
  sessionsDone,
  sessionsTotal,
  totalWeeks,
}: {
  sessionsDone: number;
  sessionsTotal: number;
  totalWeeks: number;
}): number {
  const weeks = Math.max(1, Math.round(totalWeeks));
  const perWeek = Math.max(1, Math.round(sessionsTotal / weeks));
  const done = Math.max(0, Math.round(sessionsDone));
  if (done === 0) {
    return 1;
  }

  return Math.min(weeks, Math.floor((done - 1) / perWeek) + 1);
}

/**
 * One block week as a tally: which week, how many of its sessions are done,
 * and out of how many — the "WEEK 2 · 1/3" pill.
 *
 * The pill took its week from the block and its count from the calendar:
 * plan sessions logged Monday to Sunday. Home counts both from the block, and
 * a block only starts on a Monday when the plan did. A plan taken up on a
 * Thursday, three days a week: Monday's session — the third, which finished
 * week 1 — read "WEEK 1 · 1/3" while Home said week 1 was done, and Friday's
 * read "WEEK 2 · 3/3" with week 2 two sessions in (audit, 2026-09-20). Every
 * plan not started on a Monday. Both numbers are the block's now, the same
 * arithmetic as Home's hero.
 *
 * `sessionsDone` includes the session the pill is about. Before the save that
 * is one more than the log holds; after it, the log already has it — so the
 * finish view and the summary ask with different counts and get the same
 * week for the same session. A finished block holds its last week full
 * rather than counting past it.
 */
export function blockWeekTally({
  sessionsDone,
  sessionsTotal,
  totalWeeks,
}: {
  sessionsDone: number;
  sessionsTotal: number;
  totalWeeks: number;
}): { week: number; done: number; target: number } {
  const weeks = Math.max(1, Math.round(totalWeeks));
  const target = Math.max(1, Math.round(sessionsTotal / weeks));
  const week = weekOfLastLoggedSession({ sessionsDone, sessionsTotal, totalWeeks });
  const done = Math.min(target, Math.max(0, Math.round(sessionsDone) - (week - 1) * target));
  return { week, done, target };
}

/**
 * The block week a logged session filled, or null when it is not one of the
 * block's sessions.
 *
 * The session analysis named whatever it showed with the week the reader is
 * IN, and the moment a week's last session is saved that is already the next
 * one — so the third session of a three-day week read "WEEK 2" beside a
 * summary that had just called it week 1 (audit, 2026-09-20). Nor is the
 * analysis always of the newest plan session: the coach opens the latest
 * session of any kind, which can be a freestyle one or one from before the
 * block began, and "the current week" is no answer for either.
 *
 * So the week is the session's own: its place among the block's sessions,
 * counted from the same list and the same boundary as Home's hero.
 */
export function blockWeekOfSession({
  sessionId,
  sessions,
  templateIds,
  blockStartedAt,
  sessionsTotal,
  totalWeeks,
}: {
  sessionId: string;
  /** The list Home counts the block from. */
  sessions: readonly WorkoutSession[];
  /** The plan's templates, lineage included. */
  templateIds: ReadonlySet<string>;
  /** The plan record's boundary — see countSessionsSince. */
  blockStartedAt: string;
  sessionsTotal: number;
  totalWeeks: number;
}): number | null {
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session?.workoutTemplateId || !templateIds.has(session.workoutTemplateId)) {
    return null;
  }
  const at = Date.parse(session.performedAt);
  const since = Date.parse(blockStartedAt);
  if (!Number.isFinite(at) || !Number.isFinite(since) || at < since) {
    return null;
  }
  const ordinal = countSessionsSince(
    sessions.filter((entry) => Date.parse(entry.performedAt) <= at),
    templateIds,
    blockStartedAt,
  );
  return weekOfLastLoggedSession({ sessionsDone: ordinal, sessionsTotal, totalWeeks });
}
