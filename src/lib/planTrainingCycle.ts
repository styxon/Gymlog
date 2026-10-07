import type { TrainingCycle } from '../types/models';

/**
 * Whose rhythm a calendar day follows.
 *
 * A cycle ("3 on, 1 off") used to be one preference for the whole app, and
 * every programme read it: a six-day ready programme opened showing the
 * reader's own 3-on-1-off rhythm, and setting a rhythm on one programme set
 * it on all of them (user 2026-10-07). It belongs to the programme now — its
 * plan record — and everything that draws the reader's own calendar (Home,
 * the widget, reminders, the plan screen) reads the lead programme's.
 *
 * A programme with no plan has not been started and has no rhythm of its own
 * yet: it shows its own week, and its rhythm can be set once it is in use
 * (user 2026-10-07).
 */

interface CyclePlan {
  id: string;
  entries: ReadonlyArray<{ workoutTemplateId: string }>;
  trainingCycle?: TrainingCycle | null;
}

/** The plan's own rhythm, or null for its own week. */
export function planTrainingCycle(plan: { trainingCycle?: TrainingCycle | null } | null | undefined): TrainingCycle | null {
  return plan?.trainingCycle ?? null;
}

/** The rhythm of the programme Home leads with — the reader's own calendar. */
export function leadPlanTrainingCycle(plans: readonly CyclePlan[], activePlanId: string | null): TrainingCycle | null {
  if (!activePlanId) {
    return null;
  }
  return planTrainingCycle(plans.find((plan) => plan.id === activePlanId));
}

/**
 * The plan a programme page reads and writes its rhythm on.
 *
 * Several plans can hold one programme (a stopped one beside a running one),
 * so the one the reader is on wins: the lead, then a running one in the order
 * they took them on, then any. Null when the programme has never been started.
 */
export function planForTemplate<P extends CyclePlan>(
  input: { plans: readonly P[]; activePlanId: string | null; activePlanIds: readonly string[] },
  templateId: string,
): P | null {
  const holding = input.plans.filter((plan) => plan.entries[0]?.workoutTemplateId === templateId);
  if (holding.length === 0) {
    return null;
  }
  const byId = (planId: string | null) => holding.find((plan) => plan.id === planId) ?? null;
  return byId(input.activePlanId) ?? input.activePlanIds.map(byId).find((plan) => plan !== null) ?? holding[0];
}

/** The plans with one plan's rhythm replaced; the rest untouched. */
export function withPlanTrainingCycle<P extends CyclePlan>(
  plans: readonly P[],
  planId: string,
  cycle: TrainingCycle | null,
): P[] {
  return plans.map((plan) => (plan.id === planId ? { ...plan, trainingCycle: cycle } : plan));
}

/**
 * A plan written over one with the same id, keeping that one's rhythm.
 *
 * Most writes rebuild a plan record from its parts (new days, a new week) and
 * name no rhythm at all. Read as "none", every such write would quietly put the
 * programme back on its own week. Only a record that says `null` clears it.
 */
export function keepPlanTrainingCycle<P extends { trainingCycle?: TrainingCycle | null }>(
  next: P,
  previous: { trainingCycle?: TrainingCycle | null } | null | undefined,
): P {
  if (next.trainingCycle !== undefined || !previous?.trainingCycle) {
    return next;
  }
  return { ...next, trainingCycle: previous.trainingCycle };
}

/**
 * The one-time move of the old app-wide rhythm onto the programme it was set for.
 *
 * It goes to the lead programme only (user 2026-10-07): that is the one whose
 * calendar the reader was looking at when they set it. Every other programme
 * goes back to its own week. A lead that already has a rhythm of its own keeps
 * it, and with no lead there is nowhere for it to go and it is dropped. Either
 * way the preference is emptied, so this runs once.
 *
 * Run after the running set is reconciled, so the lead it reads exists. The
 * same object comes back when there is nothing to move.
 */
export function moveTrainingCycleToLeadPlan<
  P extends CyclePlan,
  D extends {
    preferences: { trainingCycle: TrainingCycle | null; activePlanId: string | null };
    workoutPlans: P[];
  },
>(database: D): D {
  const legacy = database.preferences.trainingCycle;
  if (!legacy) {
    return database;
  }
  const lead = database.workoutPlans.find((plan) => plan.id === database.preferences.activePlanId) ?? null;
  const workoutPlans =
    lead && !lead.trainingCycle ? withPlanTrainingCycle(database.workoutPlans, lead.id, legacy) : database.workoutPlans;
  return {
    ...database,
    workoutPlans,
    preferences: { ...database.preferences, trainingCycle: null },
  };
}
