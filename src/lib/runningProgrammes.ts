/**
 * Which programmes are RUNNING, and which plans belong to each.
 *
 * "Running" and "leading" are two different questions, and the Programs tab
 * used to answer only the second: an adopted ready programme has no row in
 * `workoutTemplates` — adoption points a plan at the catalog rather than
 * copying it — so it appeared in "your programmes" only while Home led with
 * it. Making a second programme lead dropped it out of the list while it kept
 * running and kept holding a slot against the programme cap (user 2026-09-07).
 *
 * The rules live here rather than in App.tsx because they are neither React
 * nor presentation: one programme can be held under SEVERAL plan ids —
 * onboarding writes `onboarding_plan_<id>` and adoption writes
 * `ready_plan_<id>` — and both questions below turn on that fact.
 */

import { planCanRun, removeActiveProgram } from './activeProgramSet';

/** The only part of a plan these rules read. */
export interface RunningPlan {
  id: string;
  name: string;
  entries: Array<{ workoutTemplateId: string }>;
}

export interface RunningProgramme {
  /** The programme, which is what a reader means by "a programme". */
  templateId: string;
  /** The plan the row was resolved from, for anything that writes by plan. */
  planId: string;
  /** The plan's own name, the last resort when a template is unknown. */
  planName: string;
  /** Is this the one Home leads with? */
  leading: boolean;
}

/**
 * Every running programme, once each, leader first.
 *
 * Deduped by TEMPLATE and not by plan: two plan ids pointing at one programme
 * would otherwise produce two rows for it, under one key. The leader is
 * resolved first so that when a programme is held twice, the plan the row
 * carries is the one Home is actually leading with.
 *
 * `authoredTemplateIds` are the reader's own templates, which the caller lists
 * from its own source — they are excluded here so a programme cannot appear
 * both as authored and as running.
 */
export function listRunningProgrammes(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  authoredTemplateIds?: readonly string[];
}): RunningProgramme[] {
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const seen = new Set<string>(input.authoredTemplateIds ?? []);
  const rows: RunningProgramme[] = [];

  for (const planId of [input.activePlanId, ...input.activePlanIds]) {
    if (!planId) {
      continue;
    }
    const plan = planById.get(planId);
    const templateId = plan?.entries[0]?.workoutTemplateId;
    if (!plan || !templateId || seen.has(templateId)) {
      continue;
    }
    seen.add(templateId);
    rows.push({
      templateId,
      planId,
      planName: plan.name,
      leading: planId === input.activePlanId,
    });
  }

  return rows;
}

/**
 * Every plan pointing at one programme.
 *
 * Stopping a programme has to take all of them. Removing only the leading plan
 * left the programme running under its other id — and the switch that reported
 * it stopped would have been lying.
 */
export function planIdsForTemplate(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  templateId: string;
}): string[] {
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  return [...new Set([input.activePlanId, ...input.activePlanIds])]
    .filter((planId): planId is string => Boolean(planId))
    .filter((planId) => planById.get(planId)?.entries[0]?.workoutTemplateId === input.templateId);
}

/**
 * The running set once one programme stops, under every plan id it was held by.
 *
 * The lead passes to the next programme still running, or to nobody. Null when
 * the programme was not running, so a caller can skip a write that would
 * change nothing.
 */
export function stopProgramme(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  templateId: string;
}): { activePlanId: string | null; activePlanIds: string[] } | null {
  const planIds = planIdsForTemplate(input);
  if (planIds.length === 0) {
    return null;
  }
  const activePlanIds = [...new Set(input.activePlanIds)].filter((planId) => !planIds.includes(planId));
  return {
    activePlanIds,
    activePlanId: planIds.includes(input.activePlanId ?? '') ? activePlanIds[0] ?? null : input.activePlanId,
  };
}

/**
 * How a programme is taken on (handleAdoptReadyProgram and what it calls).
 */
export interface AdoptReadyOptions {
  /** Home leads with it from now on. */
  lead?: boolean;
  /**
   * The plan it takes the place of: that programme's running slot goes in the
   * same write that starts this one (runningSetWithout). Taking the finished
   * programme's place is taking its lead too, so this implies `lead`.
   */
  replacingPlanId?: string;
}

/**
 * The running set once a finished programme gives its place to the next one.
 *
 * "Start next" on the completion card used to ADD: the finished programme kept
 * running beside its successor, kept a slot against the cap, and a free reader
 * at 2/2 who stepped up once met the "places full, unlock Pro" sheet for it
 * (#bugs 2026-10-09; owner: the next programme REPLACES the finished one).
 * The caller measures the cap against this set and writes the new programme
 * into it in the same preferences write, so the finished one is never half
 * stopped. Only its running slot goes: its plan record and every session it
 * logged stay, which is what makes it a stopped programme and not a deleted one.
 *
 * Stopped by programme and not by plan id (stopProgramme), for the same reason
 * stopping is: a programme held under two plan ids would keep running under the
 * other. The same set, de-duplicated, when nothing is being replaced.
 */
export function runningSetWithout(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  replacingPlanId: string | null | undefined;
}): { activePlanId: string | null; activePlanIds: string[] } {
  const replacing = input.replacingPlanId;
  const templateId = replacing
    ? input.plans.find((plan) => plan.id === replacing)?.entries[0]?.workoutTemplateId
    : undefined;
  const stopped = templateId
    ? stopProgramme({
        activePlanId: input.activePlanId,
        activePlanIds: input.activePlanIds,
        plans: input.plans,
        templateId,
      })
    : null;
  if (stopped) {
    return stopped;
  }
  // No plan record to read the programme from, or none of it running: the id alone.
  const activePlanIds = replacing
    ? removeActiveProgram(input.activePlanIds, replacing)
    : [...new Set(input.activePlanIds)];
  return {
    activePlanIds,
    activePlanId: replacing && input.activePlanId === replacing ? activePlanIds[0] ?? null : input.activePlanId,
  };
}

/** A programme the reader holds, and whether it is running right now. */
export interface HeldProgramme extends RunningProgramme {
  running: boolean;
}

/**
 * Every programme the reader holds — the running ones first, in the order
 * listRunningProgrammes gives them, then the ones they switched off but kept.
 *
 * "Active" and "mine" are two questions (device, 2026-09-16). The Active
 * switch answered both: switching a ready programme off took it out of the
 * running set, and since an adopted ready programme has no template of its
 * own, nothing listed it any more — to the reader, the switch had deleted it.
 * A programme is held while a plan for it exists; running is the smaller set.
 */
export function listHeldProgrammes(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  authoredTemplateIds?: readonly string[];
}): HeldProgramme[] {
  const running = listRunningProgrammes(input).map((row) => ({ ...row, running: true }));
  const seen = new Set<string>([...(input.authoredTemplateIds ?? []), ...running.map((row) => row.templateId)]);
  const stopped: HeldProgramme[] = [];

  for (const plan of input.plans) {
    const templateId = plan.entries[0]?.workoutTemplateId;
    if (!templateId || seen.has(templateId)) {
      continue;
    }
    seen.add(templateId);
    stopped.push({ templateId, planId: plan.id, planName: plan.name, leading: false, running: false });
  }

  return [...running, ...stopped];
}

/**
 * The running set once a held programme is switched back on.
 *
 * It rejoins under the plan it already has — the block it was in, its day
 * labels, its place in the rotation — rather than being adopted afresh, which
 * would stamp a new block over the old one. Null when the reader holds no plan
 * for it.
 *
 * And it leads. It used to lead only when nothing else did, and to the reader
 * the switch is called Active and so is the tag Home's programme carries:
 * switching a programme off handed the lead to another, switching it back on
 * did not take it back, and the tag never returned to the programme they had
 * just made active (device, 2026-09-16). The others keep running beside it.
 */
export function resumeProgramme(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  templateId: string;
}): { activePlanId: string | null; activePlanIds: string[]; planId: string } | null {
  // A plan it is already running under, if any, so a programme held under two
  // ids does not start running under the second.
  const running = new Set([input.activePlanId, ...input.activePlanIds]);
  const holding = input.plans.filter((candidate) => candidate.entries[0]?.workoutTemplateId === input.templateId);
  const plan = holding.find((candidate) => running.has(candidate.id)) ?? holding[0];
  if (!plan) {
    return null;
  }
  const activePlanIds = [...new Set([...input.activePlanIds, plan.id])];
  return {
    planId: plan.id,
    activePlanIds,
    activePlanId: plan.id,
  };
}

/**
 * The plan Home leads with, repaired.
 *
 * The stored lead is kept while it names a plan that exists. Otherwise the
 * first running plan that exists leads, or nothing does. A lead naming a plan
 * that is gone rendered no programme on Home and no Active tag anywhere, and
 * nothing put it right: the repair only ever looked for an empty lead.
 */
export function resolveLeadPlanId(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
}): string | null {
  // The same test the loader's running-set repair uses (reconcileRunningSet).
  const exists = (planId: string | null | undefined): planId is string => planCanRun(input.plans, planId);
  if (exists(input.activePlanId)) {
    return input.activePlanId;
  }
  return input.activePlanIds.find(exists) ?? null;
}

/** The programme Home leads with, or null. */
export function leadTemplateId(input: {
  activePlanId: string | null;
  plans: readonly RunningPlan[];
}): string | null {
  if (!input.activePlanId) {
    return null;
  }
  return input.plans.find((plan) => plan.id === input.activePlanId)?.entries[0]?.workoutTemplateId ?? null;
}

/**
 * The active programme a reader would move off by making `templateId` active.
 *
 * The reader may hold several programmes and one of them is active: the one
 * Home leads with and the list tags (user 2026-09-21). Making another one
 * active is a switch, and the page asks first — the advice is to finish one
 * programme before starting the next. Read off the list's own rows, so the
 * question names the programme exactly as the tag beside it does.
 *
 * Null when there is nothing to move off: this programme is the active one
 * already, or none is.
 */
export function programmeSwitchedFrom<T extends { id: string; active?: boolean }>(
  rows: readonly T[],
  templateId: string,
): T | null {
  const active = rows.find((row) => row.active) ?? null;
  return active && active.id !== templateId ? active : null;
}

/**
 * The programme that becomes active when the active one is switched off.
 *
 * Stopping the lead hands it on — Home never goes without a programme while
 * one is running (resolveLeadPlanId) — so switching one programme off can
 * make another active, and the page says which before the switch is pressed.
 * The same two steps the app takes: stopProgramme, then the lead repair.
 *
 * Null when `templateId` is not the active programme, since stopping it moves
 * nothing, and when no other programme would take over.
 */
export function leadAfterStopping(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  templateId: string;
}): string | null {
  if (leadTemplateId({ activePlanId: input.activePlanId, plans: input.plans }) !== input.templateId) {
    return null;
  }
  const stopped = stopProgramme(input);
  if (!stopped) {
    return null;
  }
  const next = leadTemplateId({
    activePlanId: resolveLeadPlanId({ ...stopped, plans: input.plans }),
    plans: input.plans,
  });
  return next && next !== input.templateId ? next : null;
}

/**
 * The programme a reader switching the active one off is offered in its place.
 *
 * Switching the active programme off asks first (user 2026-09-22): "do you
 * want X to be your active programme?" X is the one the app would lead with
 * anyway — the next programme still running (leadAfterStopping) — and when
 * nothing else runs, the first programme the reader holds but switched off,
 * which switching takes back into use. Null when this is not the active
 * programme, or the reader holds nothing else: then the page offers the
 * catalogue instead.
 *
 * `shown` is the programmes the reader's list shows, when the caller has it:
 * a plan whose programme the list cannot open (a deleted one of their own) is
 * not something to be offered by name.
 *
 * `unstarted` is the reader's own programmes in that list with no plan yet —
 * built, never taken into use, and with a lift to train. They are last, and
 * come back with a null `planId`: the caller builds the plan. Without them a
 * reader whose only other programme was one they had written but not started
 * was told they had no other programmes (CI review of #179).
 */
export function programmeToSwitchTo(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  templateId: string;
  shown?: readonly string[];
  unstarted?: readonly string[];
}): { templateId: string; planId: string | null } | null {
  if (leadTemplateId({ activePlanId: input.activePlanId, plans: input.plans }) !== input.templateId) {
    return null;
  }
  const next = leadAfterStopping(input);
  const planFor = (templateId: string) => {
    const running = new Set(input.activePlanIds);
    const holding = input.plans.filter(
      (plan) => plan.entries[0]?.workoutTemplateId === templateId && planCanRun(input.plans, plan.id),
    );
    return (holding.find((plan) => running.has(plan.id)) ?? holding[0])?.id ?? null;
  };
  const offered = (templateId: string) => !input.shown || input.shown.includes(templateId);
  if (next && offered(next)) {
    const planId = planFor(next);
    return planId ? { templateId: next, planId } : null;
  }
  for (const plan of input.plans) {
    const templateId = plan.entries[0]?.workoutTemplateId;
    if (templateId && templateId !== input.templateId && offered(templateId) && planCanRun(input.plans, plan.id)) {
      return { templateId, planId: plan.id };
    }
  }
  const unstarted = (input.unstarted ?? []).find((templateId) => templateId !== input.templateId && offered(templateId));
  return unstarted ? { templateId: unstarted, planId: null } : null;
}

/**
 * The running set once the active programme is switched off in favour of
 * another: every plan of the old one stops, and the new one leads — joining
 * the running set if the reader had switched it off. The count cannot grow:
 * the old programme gives up at least one place for the one it hands over.
 */
export function switchActiveProgramme(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  plans: readonly RunningPlan[];
  fromTemplateId: string;
  toPlanId: string;
}): { activePlanId: string; activePlanIds: string[] } {
  const stopped = stopProgramme({ ...input, templateId: input.fromTemplateId }) ?? {
    activePlanId: input.activePlanId,
    activePlanIds: [...input.activePlanIds],
  };
  return {
    activePlanId: input.toPlanId,
    activePlanIds: stopped.activePlanIds.includes(input.toPlanId)
      ? stopped.activePlanIds
      : [...stopped.activePlanIds, input.toPlanId],
  };
}

/** Every plan that holds one programme, for a reader who wants it gone. */
export function planIdsHoldingTemplate(plans: readonly RunningPlan[], templateId: string): string[] {
  return plans
    .filter((plan) => plan.entries[0]?.workoutTemplateId === templateId)
    .map((plan) => plan.id);
}
