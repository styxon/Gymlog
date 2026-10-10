import type { Dispatch, SetStateAction } from 'react';
import { trackEvent } from '../features/analytics/analyticsClient';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { evaluateProgramAdoption, removeActiveProgram } from '../lib/activeProgramSet';
import { programCapFullMessage, RunningCapRefusal } from '../lib/programCapNotice';
import { joinedRunningSet } from '../lib/analyticsMoments';
import { t } from '../lib/i18n';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { liveSessionBlocksProgrammeDelete } from '../lib/programmeDeletion';
import { resumeProgramme, runningSetWithout, stopProgramme, switchActiveProgramme } from '../lib/runningProgrammes';
import type { useAppContext } from '../state/AppProvider';
import type { WorkoutPlan } from '../types/models';
import { haptics } from '../utils/haptics';
import type { createProgrammeStarts } from './programmeStarts';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * The programmes the reader holds, switched: leading with one, stopping and
 * resuming one, switching the active one for another, forgetting a held one,
 * removing one from the running set, and starting a ready programme's first
 * day.
 *
 * Moved verbatim from VinhaApp in App.tsx in phase C of the split
 * (2026-10-01), each handler with its doc. A per-render factory, not a hook:
 * it holds no state and calls no hook. VinhaApp calls it on every render,
 * exactly where the declarations stood (after the homeOtherPrograms memo), so
 * each handler is still a fresh closure over that render's values. Every use
 * of them in App.tsx sits below the call, or inside a function that runs only
 * on a press (the adoptions, which stay in App.tsx, call
 * promoteHeldProgramToLead). buildCustomProgrammePlan and leaveDeletedProgramme
 * stay in App.tsx: the first reads customWorkoutRuntimeMap, declared below,
 * and both are hoisted declarations, so they exist when this is called.
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx and
 * src/features/workout/WorkoutProvider.tsx; no .ts module imports this file,
 * and the test build does not compile it.
 */
export interface ProgrammeSwitchesDeps {
  database: AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  updatePreferences: AppContextValue['updatePreferences'];
  upsertWorkoutPlan: AppContextValue['upsertWorkoutPlan'];
  forgetHeldProgramme: AppContextValue['forgetHeldProgramme'];
  workout: ReturnType<typeof useWorkoutContext>;
  /** Opens the running-programmes limit sheet. */
  setRunningCapSheet: Dispatch<SetStateAction<{ visible: boolean } & RunningCapRefusal>>;
  /** VinhaApp's hoisted plan builder for a programme of the reader's own. */
  buildCustomProgrammePlan: (workoutTemplateId: string) => WorkoutPlan | null;
  /** VinhaApp's hoisted leave from a programme's pages. */
  leaveDeletedProgramme: (workoutTemplateId: string) => void;
  handleStartReadyProgramSession: ReturnType<typeof createProgrammeStarts>['handleStartReadyProgramSession'];
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
}

export function createProgrammeSwitches(deps: ProgrammeSwitchesDeps) {
  const {
    database,
    preferences,
    updatePreferences,
    upsertWorkoutPlan,
    forgetHeldProgramme,
    workout,
    setRunningCapSheet,
    buildCustomProgrammePlan,
    leaveDeletedProgramme,
    handleStartReadyProgramSession,
    showToast,
  } = deps;

  /**
   * A switch write the disk refused. Each press below is wired as `void`, and
   * a rejection there was the switch springing back with no word about it
   * (hunt 10, #37).
   */
  function saveRefused(error: unknown) {
    console.error('Failed to save the programme switch', error);
    void haptics.error();
    showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
  }

  /** The reader dropping a programme — the only path that removes one. */
  /**
   * Make a programme you already hold the one Home leads with.
   *
   * Matched on the template rather than the plan id, because the same programme
   * can be held under a plan id minted by onboarding, by adoption, or by a
   * season — and all three are equally "this programme".
   */
  async function promoteHeldProgramToLead(workoutTemplateId: string, replacingPlanId?: string) {
    const plan = database.workoutPlans.find(
      (entry) =>
        preferences.activePlanIds.includes(entry.id) &&
        entry.entries[0]?.workoutTemplateId === workoutTemplateId,
    );
    if (!plan) {
      return;
    }
    // A finished programme this one replaces gives up its running slot in the
    // same write (runningSetWithout).
    const running = replacingPlanId
      ? runningSetWithout({
          activePlanId: preferences.activePlanId,
          activePlanIds: preferences.activePlanIds,
          plans: database.workoutPlans,
          replacingPlanId,
        })
      : null;
    if (!running && preferences.activePlanId === plan.id) {
      return;
    }
    await updatePreferences({
      ...(running ? { activePlanIds: running.activePlanIds } : {}),
      activePlanId: plan.id,
    });
  }

  /**
   * Stop a programme from its own page, by programme rather than by plan.
   *
   * The detail screen knows a template id; `handleRemoveActiveProgram` wants a
   * plan id, and one programme can be held under more than one — onboarding
   * writes `onboarding_plan_<id>` and adoption writes `ready_plan_<id>`. Every
   * plan pointing at this programme goes, or the switch would read off while
   * the programme was still running under the other id.
   */
  /** Resolves false when the write was refused, so a caller can stay put. */
  async function handleStopProgram(workoutTemplateId: string): Promise<boolean> {
    const stopped = stopProgramme({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      templateId: workoutTemplateId,
    });
    if (!stopped) {
      return true;
    }
    try {
      await updatePreferences(stopped);
    } catch (error) {
      saveRefused(error);
      return false;
    }
    return true;
  }

  /**
   * The Active switch, turned on: this programme becomes THE active one.
   *
   * One programme is active and the others the reader holds stay theirs
   * (user 2026-09-21), so this makes it the lead and leaves the rest where
   * they are. One the reader switched off comes back under the plan it
   * already has, so its block and its place in the rotation come back with
   * it — and through the same cap the adoption path answers to, because
   * running is what the cap counts (device, 2026-09-16: the switch used to be
   * a one-way door). The page has already asked whether to move off the
   * programme that was active.
   */
  async function handleResumeProgram(workoutTemplateId: string) {
    const resumed = resumeProgramme({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      templateId: workoutTemplateId,
    });
    if (!resumed) {
      return;
    }
    const decision = evaluateProgramAdoption({
      activePlanIds: preferences.activePlanIds,
      targetPlanId: resumed.planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });
    if (decision.kind === 'blocked') {
      if (decision.canUpgrade) {
        setRunningCapSheet({ visible: true, used: decision.used, cap: decision.cap, replacingStop: null });
        return;
      }
      showToast(programCapFullMessage(preferences.appLanguage, decision.used, decision.cap));
      return;
    }
    try {
      await updatePreferences({ activePlanIds: resumed.activePlanIds, activePlanId: resumed.activePlanId });
    } catch (error) {
      saveRefused(error);
      return;
    }
    // A programme switched back on is a programme taken into use; one that
    // was running already and only became the lead is not (analytics audit,
    // 2026-09-21).
    if (joinedRunningSet(preferences.activePlanIds, resumed.activePlanIds)) {
      trackEvent('plan_adopted');
    }
  }

  /**
   * The active programme switched off, and the reader said yes to making
   * another one active instead (user 2026-09-22).
   *
   * One write: every plan of the old programme stops and the chosen one leads,
   * joining the running set if the reader had switched it off. Stopping and
   * then resuming in two writes would read the running set from the render
   * before the first. The count cannot grow, so the cap has nothing to refuse.
   */
  async function handleSwitchActiveProgram(fromTemplateId: string, to: { templateId: string; planId: string | null }) {
    // One of the reader's own programmes never started has no plan yet: it
    // gets the week adoption would give it, stored first, and the switch
    // below counts it among the plans (CI review of #179).
    let plans = database.workoutPlans;
    let toPlanId = to.planId;
    try {
      if (!toPlanId) {
        const plan = buildCustomProgrammePlan(to.templateId);
        if (!plan) {
          return;
        }
        await upsertWorkoutPlan(plan);
        plans = [...plans.filter((entry) => entry.id !== plan.id), plan];
        toPlanId = plan.id;
      }
    } catch (error) {
      saveRefused(error);
      return;
    }
    const next = switchActiveProgramme({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans,
      fromTemplateId,
      toPlanId,
    });
    try {
      await updatePreferences(next);
    } catch (error) {
      saveRefused(error);
      return;
    }
    // A programme switched back on is a programme taken into use.
    if (joinedRunningSet(preferences.activePlanIds, next.activePlanIds)) {
      trackEvent('plan_adopted');
    }
  }

  /**
   * "Remove from my programmes", for a programme with no template of its own.
   *
   * Deleting a custom programme deletes its template; a ready programme's
   * template is catalog data, so what goes is every plan that holds it. The
   * page the reader deleted it from goes with it, the same way a deleted
   * custom programme's pages do.
   */
  async function handleForgetHeldProgram(workoutTemplateId: string) {
    // The same rule as deleting your own programme: not mid-workout on it.
    // A ready programme's session still saves, but the running slot went
    // mid-workout and the player's week line with it (break round,
    // 2026-09-28).
    if (liveSessionBlocksProgrammeDelete(workout.activeSession, workoutTemplateId)) {
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteWorkoutRunning'));
      return;
    }
    try {
      await forgetHeldProgramme(workoutTemplateId);
    } catch (error) {
      console.error('Failed to remove the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteFailed'));
      return;
    }
    void haptics.success();
    leaveDeletedProgramme(workoutTemplateId);
  }

  async function handleRemoveActiveProgram(planId: string) {
    try {
      await updatePreferences({
        activePlanIds: removeActiveProgram(preferences.activePlanIds, planId),
        activePlanId:
          preferences.activePlanId === planId
            ? removeActiveProgram(preferences.activePlanIds, planId)[0] ?? null
            : preferences.activePlanId,
      });
    } catch (error) {
      saveRefused(error);
    }
  }

  function handleStartReadyProgram(workoutTemplateId: string) {
    const template = getWorkoutTemplateById(workoutTemplateId);
    const firstSessionId = template?.sessions[0]?.id;
    if (!firstSessionId) {
      return;
    }

    handleStartReadyProgramSession(workoutTemplateId, firstSessionId);
  }

  return {
    promoteHeldProgramToLead,
    handleStopProgram,
    handleResumeProgram,
    handleSwitchActiveProgram,
    handleForgetHeldProgram,
    handleRemoveActiveProgram,
    handleStartReadyProgram,
  };
}
