import { WorkoutPlan } from '../types/models';

/**
 * Adopting a ready program as the reader's active plan.
 *
 * Until now the only code that ever set `preferences.activePlanId` lived in the
 * two onboarding finishes. Everything after onboarding could start a *session*
 * from a ready program, but nothing could make that program the plan Home reads
 * — so "Start season" on SeasonScreen opened the season's programme page and
 * stopped there, and a reader who had not happened to pick that exact programme
 * during onboarding could never join a season at all. Since season points only
 * count sessions from the season programme, the whole scoreboard was
 * unreachable.
 *
 * This module is the missing step, kept pure so the rule is testable: it builds
 * the plan record that makes adoption true. Whether adoption is allowed at all
 * is activeProgramSet's question.
 *
 * The same gap existed on the other side and outlived the fix here: a program
 * the reader had built or imported themselves could be opened and its sessions
 * could be started, but nothing made it the plan Home reads. Reported by a
 * reader who imported their own six-day program and could not get it onto the
 * home screen by any route. Nothing here was ever ready-specific except the id,
 * so both sources now build their plan the same way.
 */

export interface ProgramPlanInput {
  /** `buildReadyProgramPlanId` or `buildCustomProgramPlanId`. */
  planId: string;
  workoutTemplateId: string;
  /** Shown on Home as the active plan's name. */
  programName: string;
  /** Session ids in the order they should be trained. */
  sessionIds: string[];
  /**
   * Weekday labels to hang the sessions on. When empty the entries fall back to
   * "Day N" rather than inventing a weekday the reader never chose.
   */
  dayLabels: string[];
  /** ISO timestamp, injected so this stays pure and testable. */
  now: string;
}

/**
 * The plan id is derived from the template, not from the moment of adoption, so
 * re-joining the same programme updates one record instead of leaving a trail of
 * orphaned plans behind it.
 */
export function buildReadyProgramPlanId(workoutTemplateId: string): string {
  return `ready_plan_${workoutTemplateId}`;
}

/**
 * Kept apart from the ready ids, and not merged with them: these strings are
 * already written into stored databases, and a program of the reader's own can
 * share a template id with nothing.
 */
export function buildCustomProgramPlanId(workoutTemplateId: string): string {
  return `custom_plan_${workoutTemplateId}`;
}

/**
 * A copy of a held programme takes the weekday labels of the plan it replaces,
 * entry for entry.
 *
 * The labels used to be rebuilt from the reader's availability and rotated as
 * if session 1 were next, so the next workout of a swapped-in programme landed
 * on the wrong day. The copy has the same sessions in the same order, so the
 * original's labels are the right ones. Only when the two have the same number
 * of entries — otherwise there is no entry-for-entry answer and the plan is
 * left as built.
 */
export function carryPlanLabels(
  plan: WorkoutPlan,
  replacedPlan: Pick<WorkoutPlan, 'entries'> | null | undefined,
): WorkoutPlan {
  if (!replacedPlan) {
    return plan;
  }
  const original = replacedPlan.entries.slice().sort((left, right) => left.orderIndex - right.orderIndex);
  if (original.length === 0 || original.length !== plan.entries.length) {
    return plan;
  }
  const ordered = plan.entries.slice().sort((left, right) => left.orderIndex - right.orderIndex);
  const labelByEntryId = new Map(ordered.map((entry, index) => [entry.id, original[index].label] as const));
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({ ...entry, label: labelByEntryId.get(entry.id) ?? entry.label })),
  };
}

export function buildProgramWorkoutPlan(input: ProgramPlanInput): WorkoutPlan {
  const planId = input.planId;
  const entryCount = Math.max(1, input.sessionIds.length);

  return {
    id: planId,
    name: input.programName,
    mode: 'rotation',
    entries: Array.from({ length: entryCount }, (_, index) => ({
      id: `${planId}_entry_${index + 1}`,
      workoutTemplateId: input.workoutTemplateId,
      workoutTemplateSessionId: input.sessionIds[index] ?? null,
      label: input.dayLabels.length > 0
        ? input.dayLabels[index % input.dayLabels.length]
        : `Day ${index + 1}`,
      orderIndex: index,
    })),
    isActive: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
