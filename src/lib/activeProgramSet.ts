/**
 * How many programmes a reader may run at once.
 *
 * The app used to hold exactly one: `preferences.activePlanId` was a single id,
 * and the only writers were the two onboarding finishes. That made joining a
 * season destructive — the season programme could only arrive by evicting
 * whatever the reader had built their week around.
 *
 * A season is a separate commitment, not a replacement for one, so programmes
 * became a set. The cap is what keeps that set from turning Home into a list
 * nobody reads, and it is the first real programme cap in the app: the pricing
 * decision existed on paper but nothing in the code had ever enforced it.
 */

export const FREE_ACTIVE_PROGRAM_CAP = 2;
export const PRO_ACTIVE_PROGRAM_CAP = 5;

export function resolveActiveProgramCap(proUnlocked: boolean): number {
  return proUnlocked ? PRO_ACTIVE_PROGRAM_CAP : FREE_ACTIVE_PROGRAM_CAP;
}

/**
 * How many places to give up before one more can be taken.
 *
 * A reader whose Pro lapsed keeps every programme they were running (only the
 * reader removes one), so the set can stand ABOVE the cap: five running
 * against two. "Stop one to start another" was true only at exactly the cap;
 * at 5/2 it sent them to stop one and refused again at 4/2 (hunt 9,
 * 2026-10-09). The answer is the whole distance plus the one place wanted:
 * 1 at the cap, 4 at 5/2.
 */
export function placesToFree(used: number, cap: number): number {
  return Math.max(1, used - cap + 1);
}

export type ProgramAdoptionDecision =
  /** Already running it — the button should offer to train, not to join. */
  | { kind: 'already_active' }
  /** There is room; adopting adds it alongside what is already there. */
  | { kind: 'adopt'; used: number; cap: number }
  /**
   * The set is full. A free reader is one upgrade away; a Pro reader at five is
   * not, and must drop a programme first — telling them to buy something they
   * already own would be the paywall lying.
   */
  | { kind: 'blocked'; used: number; cap: number; canUpgrade: boolean };

export interface ProgramAdoptionInput {
  /** Ids of the programmes already running. */
  activePlanIds: readonly string[];
  /** The plan id the reader is trying to add. */
  targetPlanId: string;
  proUnlocked: boolean;
}

export function evaluateProgramAdoption(input: ProgramAdoptionInput): ProgramAdoptionDecision {
  const cap = resolveActiveProgramCap(input.proUnlocked);
  // Duplicates would let a reader spend cap on the same programme twice.
  const unique = Array.from(new Set(input.activePlanIds));

  if (unique.includes(input.targetPlanId)) {
    return { kind: 'already_active' };
  }

  if (unique.length >= cap) {
    return { kind: 'blocked', used: unique.length, cap, canUpgrade: !input.proUnlocked };
  }

  return { kind: 'adopt', used: unique.length, cap };
}

/**
 * Adding a programme to the set.
 *
 * Returns the set unchanged when it is already there, so a double tap cannot
 * produce two entries pointing at one programme.
 */
export function addActiveProgram(activePlanIds: readonly string[], planId: string): string[] {
  const unique = Array.from(new Set(activePlanIds));
  return unique.includes(planId) ? unique : [...unique, planId];
}

/**
 * Dropping a programme.
 *
 * A cap without a way out of it is a trap: two programmes in, every further
 * choice is a paywall the reader cannot dismiss by changing their mind.
 */
export function removeActiveProgram(activePlanIds: readonly string[], planId: string): string[] {
  return Array.from(new Set(activePlanIds)).filter((id) => id !== planId);
}

/** Every plan onboarding writes is named this, followed by its template id. */
export const ONBOARDING_PLAN_PREFIX = 'onboarding_plan_';

/** The only part of a plan the running-set rules read. */
type StoredPlan = { id: string; entries: ReadonlyArray<unknown> };

/**
 * Whether a plan id names a programme that can run: a stored plan with at
 * least one day. A plan that is gone, or one that deleting its template
 * emptied, is not a programme anyone is running. The one test behind the
 * running set's repair and the lead's (runningProgrammes.resolveLeadPlanId).
 */
export function planCanRun(plans: ReadonlyArray<StoredPlan>, planId: string | null | undefined): planId is string {
  return Boolean(planId) && plans.some((plan) => plan.id === planId && plan.entries.length > 0);
}

/**
 * The lead counted in the running set, for installs whose set left it out.
 *
 * Every install that finished guided onboarding before activateOnboardingPlan
 * existed has its programme as the lead and nowhere in the set, and nothing
 * rewrites stored preferences on its own, so the cap would keep undercounting
 * there by one. A lead whose plan is gone, or has no days left, is not a
 * programme anyone is running and is not given a slot. Part of
 * reconcileRunningSet, which is what the load applies.
 */
export function includeLeadInRunningSet<T extends { activePlanId: string | null; activePlanIds: string[] }>(
  preferences: T,
  plans: ReadonlyArray<StoredPlan>,
): T {
  const lead = preferences.activePlanId;
  if (!lead || preferences.activePlanIds.includes(lead) || !planCanRun(plans, lead)) {
    return preferences;
  }
  return { ...preferences, activePlanIds: addActiveProgram(preferences.activePlanIds, lead) };
}

/**
 * The stored running set, made to agree with the plans that are stored.
 *
 * The cap counts `activePlanIds` as it finds them, and nothing checked them
 * against the plans. Every new install carried the demo seed's
 * `plan_push_pull_legs` there with no plan behind it, so one of a free
 * reader's two slots was taken before they chose anything, and the first
 * ready programme after onboarding met the cap sheet (2026-09-21). An id
 * naming no plan that can run is dropped; the lead is counted in the set
 * when it can run, and gives way to the first programme still running when
 * it cannot — as it does when the lead is stopped.
 *
 * Applied wherever preferences meet the plans they describe: on load, after
 * the preferences key is laid over the blob, and on a restore. Nothing writes
 * a running id before its plan (adoption and onboarding store the plan first
 * or in the same commit), so nothing legitimate is dropped. The same object
 * comes back when nothing changes.
 */
export function reconcileRunningSet<T extends { activePlanId: string | null; activePlanIds: string[] }>(
  preferences: T,
  plans: ReadonlyArray<StoredPlan>,
): T {
  const running = Array.from(new Set(preferences.activePlanIds)).filter((planId) => planCanRun(plans, planId));
  const counted = includeLeadInRunningSet({ ...preferences, activePlanIds: running }, plans);
  const lead = planCanRun(plans, counted.activePlanId) ? counted.activePlanId : counted.activePlanIds[0] ?? null;
  const unchanged =
    lead === preferences.activePlanId &&
    counted.activePlanIds.length === preferences.activePlanIds.length &&
    counted.activePlanIds.every((planId, index) => planId === preferences.activePlanIds[index]);
  return unchanged ? preferences : { ...preferences, activePlanId: lead, activePlanIds: counted.activePlanIds };
}

/**
 * The running set once onboarding hands the reader a programme.
 *
 * The new plan leads, and it joins the set like every other programme. It used
 * to become the lead only, outside the set the cap counts: a free reader
 * finished onboarding, adopted two ready programmes on top, and ran three
 * against a cap of two while the cap notice read 2 of 2.
 *
 * A plan onboarding wrote before is replaced, not kept beside the new one:
 * running the questionnaire again is answering it again. Anything the reader
 * adopted themselves — a ready programme, a season — stays.
 *
 * Unless there is no room. Setup can be run again from Profile at any time,
 * and a free reader already running two programmes they adopted by hand would
 * otherwise come out of it with three (PR review, 2026-09-14). The answers are
 * a new version of the programme the reader leads with, so at the cap the new
 * plan takes the lead's place instead of a slot of its own. No paywall at the
 * end of a questionnaire — that seam had one removed on purpose.
 */
export function activateOnboardingPlan(
  current: { activePlanId: string | null; activePlanIds: readonly string[] },
  planId: string,
  cap: number,
): { activePlanId: string; activePlanIds: string[] } {
  let kept = Array.from(new Set(current.activePlanIds)).filter(
    (id) => !id.startsWith(ONBOARDING_PLAN_PREFIX) || id === planId,
  );
  const lead = current.activePlanId;
  if (!kept.includes(planId) && kept.length >= cap && lead && kept.includes(lead)) {
    kept = kept.filter((id) => id !== lead);
  }
  return { activePlanId: planId, activePlanIds: addActiveProgram(kept, planId) };
}

/**
 * The programme a new run of onboarding writes over, or null to write a new one.
 *
 * Answering setup again used to add a programme every time, and the one it
 * answered for stayed in "your programmes" — three runs filled the free
 * limit with near-copies nobody built (user decision 2026-09-14: replace it).
 * Only the running programme onboarding itself wrote qualifies, and only while
 * the reader has done nothing with it: a template's `updatedAt` moves with
 * every save and rename, so equal timestamps mean it was never edited — and
 * no completed session may name it, because writing over a trained programme
 * regenerates its exercise rows under new ids, and every "last time" weight,
 * progression lookup and record check for it would then find nothing (PR
 * review, 2026-09-14). An edited or trained one is the reader's; it stays, and
 * the new run is a new programme that counts like any other. The lead is asked
 * first.
 */
export function findReplaceableOnboardingTemplateId(input: {
  activePlanId: string | null;
  activePlanIds: readonly string[];
  templates: ReadonlyArray<{ id: string; createdAt: string; updatedAt: string }>;
  sessions: ReadonlyArray<{ workoutTemplateId: string }>;
}): string | null {
  const running = [input.activePlanId, ...input.activePlanIds].filter(
    (planId): planId is string => typeof planId === 'string' && planId.startsWith(ONBOARDING_PLAN_PREFIX),
  );
  const trained = new Set(input.sessions.map((session) => session.workoutTemplateId));
  for (const planId of running) {
    const templateId = planId.slice(ONBOARDING_PLAN_PREFIX.length);
    const template = input.templates.find((candidate) => candidate.id === templateId);
    if (template && template.createdAt === template.updatedAt && !trained.has(templateId)) {
      return templateId;
    }
  }
  return null;
}
