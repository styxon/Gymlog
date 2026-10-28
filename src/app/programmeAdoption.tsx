import type { Dispatch, SetStateAction } from 'react';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { findReadyProgrammeCopyId } from '../lib/programmeCopyLink';
import { buildCustomProgramPlanId, buildProgramWorkoutPlan, buildReadyProgramPlanId } from '../lib/programAdoption';
import { runningSetWithout } from '../lib/runningProgrammes';
import { addActiveProgram, evaluateProgramAdoption } from '../lib/activeProgramSet';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { programCapFullMessage, runningCapRefusal, runningCapRefusalMessage } from '../lib/programCapNotice';
import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { trackEvent } from '../features/analytics/analyticsClient';
import { t } from '../lib/i18n';
import { applySessionAdaptation, sessionHasNoExercises, spendHeldAdaptation } from '../lib/sessionAdaptation';
import { buildCustomSessionRuntimeTemplate } from '../lib/programDetails';
import { reportPlanSaveFailed } from './planSaveFailure';
import { programmeStartSessionId } from '../lib/programSessionList';
import { liveSessionBlocksProgrammeDelete } from '../lib/programmeDeletion';
import { haptics } from '../utils/haptics';
import type { AdoptReadyOptions } from '../lib/runningProgrammes';
import type { AdaptedSessionRef, HeldSessionAdaptations, SessionAdaptation } from '../lib/sessionAdaptation';
import type { RunningCapRefusal } from '../lib/programCapNotice';
import type { AppRoute } from '../navigation/routes';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import type { useAppContext } from '../state/AppProvider';
import type { createProgrammeStarts } from './programmeStarts';
import type { createProgrammeSwitches } from './programmeSwitches';
import type { createCustomProgrammePlanBuilder } from './customProgrammePlan';
import type { useAppNavigation } from './useAppNavigation';
import type { useCustomProgramViews } from './useCustomProgramViews';
import type { useHomeActivePlan } from './useHomeActivePlan';
import type { useRunningProgrammeViews } from './useRunningProgrammeViews';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * Taking a programme into use, starting one of the reader's own, deleting one,
 * and picking today's session: the adoption of a ready programme and of a
 * custom one, a custom programme's first or chosen day, deleting a custom
 * programme, and the Home pick for today.
 *
 * Moved verbatim from VinhaApp in App.tsx (app split, round 2), each handler
 * with its doc. A per-render factory, not a hook: it holds no state and calls
 * no hook, and the handlers it returns are plain functions, fresh every
 * render, as the declarations were. VinhaApp calls it after
 * createProgrammeSwitches, because adoption needs promoteHeldProgramToLead and
 * the switches need the plan builder (customProgrammePlan.ts), and before
 * createProgrammePlanEdits and useGoalFlow, which take handleAdoptReadyProgram.
 * The handlers read the deps only when they run on a press, so what they close
 * over is this render's values.
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx and
 * src/features/workout/WorkoutProvider.tsx; no .ts module imports this file,
 * and the test build does not compile it.
 */
interface ProgrammeAdoptionDeps {
  database: AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  unitPreference: AppContextValue['unitPreference'];
  updatePreferences: AppContextValue['updatePreferences'];
  upsertWorkoutPlan: AppContextValue['upsertWorkoutPlan'];
  deleteWorkoutTemplate: AppContextValue['deleteWorkoutTemplate'];
  workout: ReturnType<typeof useWorkoutContext>;
  customWorkoutRuntimeMap: ReturnType<typeof useCustomProgramViews>['customWorkoutRuntimeMap'];
  homeActivePlanCard: ReturnType<typeof useHomeActivePlan>['homeActivePlanCard'];
  activeProgramTemplateIds: ReturnType<typeof useRunningProgrammeViews>['activeProgramTemplateIds'];
  promoteHeldProgramToLead: ReturnType<typeof createProgrammeSwitches>['promoteHeldProgramToLead'];
  resumeHeldProgramme: ReturnType<typeof createProgrammeStarts>['resumeHeldProgramme'];
  guardStrengthStartOverCardio: ReturnType<typeof createProgrammeStarts>['guardStrengthStartOverCardio'];
  startProgrammeWorkout: ReturnType<typeof createProgrammeStarts>['startProgrammeWorkout'];
  /** The plan builder for a programme of the reader's own. */
  buildCustomProgrammePlan: ReturnType<typeof createCustomProgrammePlanBuilder>;
  leaveDeletedProgramme: ReturnType<typeof useAppNavigation>['leaveDeletedProgramme'];
  /** VinhaApp's reader of what is held for a session today. */
  sessionAdaptationFor: (ref: AdaptedSessionRef | null | undefined) => SessionAdaptation;
  setHeldSessionAdaptations: Dispatch<SetStateAction<HeldSessionAdaptations>>;
  /** Opens the running-programmes limit sheet. */
  setRunningCapSheet: Dispatch<SetStateAction<{ visible: boolean } & RunningCapRefusal>>;
  /** VinhaApp's hoisted navigate. */
  navigate: (nextRoute: AppRoute) => void;
  /** VinhaApp's hoisted navigateToGuidedWorkout. */
  navigateToGuidedWorkout: (workoutTemplateId: string, options?: { resume?: boolean }) => void;
  /** VinhaApp's hoisted navigateToActiveWorkout. */
  navigateToActiveWorkout: (options?: { message?: string; resume?: boolean }) => boolean;
  /** VinhaApp's hoisted isActiveSessionFor. */
  isActiveSessionFor: (workoutTemplateId: string, sessionId: string) => boolean;
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
}

export function createProgrammeAdoption(deps: ProgrammeAdoptionDeps) {
  const {
    database,
    preferences,
    unitPreference,
    updatePreferences,
    upsertWorkoutPlan,
    deleteWorkoutTemplate,
    workout,
    customWorkoutRuntimeMap,
    homeActivePlanCard,
    activeProgramTemplateIds,
    promoteHeldProgramToLead,
    resumeHeldProgramme,
    guardStrengthStartOverCardio,
    startProgrammeWorkout,
    buildCustomProgrammePlan,
    leaveDeletedProgramme,
    sessionAdaptationFor,
    setHeldSessionAdaptations,
    setRunningCapSheet,
    navigate,
    navigateToGuidedWorkout,
    navigateToActiveWorkout,
    isActiveSessionFor,
    showToast,
  } = deps;

  /**
   * Take on a ready programme.
   *
   * It ADDS. Nothing here ever drops a programme the reader already has: a
   * new programme is another commitment, not a replacement for the week they
   * built.
   * The only thing standing between them and a fourth is the cap, and the only
   * thing that removes a programme is the reader asking for it.
   *
   * Before this existed, `activePlanId` was written by the two onboarding
   * finishes and nowhere else, so a ready programme could be opened but never
   * taken on.
   *
   * Returns whether the programme is running when this resolves.
   *
   * The target flow is the caller that needs to know: it stores a target only
   * if the programme behind it actually landed, and the cap can refuse. Every
   * other caller ignores the value, which is why this can be added without
   * touching them.
   */
  async function handleAdoptReadyProgram(
    workoutTemplateId: string,
    adoption?: AdoptReadyOptions,
  ): Promise<boolean> {
    const template = getWorkoutTemplateById(workoutTemplateId);
    if (!template) {
      return false;
    }
    // Taking a finished programme's place is taking its lead.
    const options: AdoptReadyOptions = {
      lead: Boolean(adoption?.lead || adoption?.replacingPlanId),
      replacingPlanId: adoption?.replacingPlanId,
    };

    // Already running this programme under some other plan id (an onboarding
    // pick, say) — joining again would spend a cap slot on a duplicate. But
    // "already held" is not "already the one Home leads with", and this used to
    // return on both: the only way to change the lead was to REMOVE the other
    // programme, which is a destructive answer to a question about ordering.
    if (activeProgramTemplateIds.includes(workoutTemplateId)) {
      if (options.lead) {
        await promoteHeldProgramToLead(workoutTemplateId, options.replacingPlanId);
      }
      // Already held is already running, which is what the caller asked for.
      return true;
    }

    /*
     * The reader's own version of this programme IS this programme.
     *
     * Onboarding hands most readers a copy of the recommended programme,
     * fitted to their answers, and that copy is what they train. Adopting the
     * catalog original beside it gave one programme two rows in the list, two
     * plans, two slots of the running cap — and a Home offering a week the
     * reader had never been shown (audit round 4, 2026-09-20). The copy is
     * the answer: running already, or resumed through its own plan with its
     * block intact. Only if it has no plan at all does the catalog version
     * get built below.
     */
    const copyTemplateId = findReadyProgrammeCopyId(
      workoutTemplateId,
      database.workoutTemplates,
      // Running first, then merely held: with two copies of one programme
      // — possible on an install from before the link — resuming the one
      // nothing points at would leave both running.
      [
        ...activeProgramTemplateIds,
        ...database.workoutPlans
          .map((plan) => plan.entries[0]?.workoutTemplateId)
          .filter((id): id is string => typeof id === 'string'),
      ],
    );
    if (copyTemplateId) {
      if (activeProgramTemplateIds.includes(copyTemplateId)) {
        if (options.lead) {
          await promoteHeldProgramToLead(copyTemplateId, options.replacingPlanId);
        }
        return true;
      }
      // resumeHeldProgramme counts the adoption itself, once its write lands.
      const resumedCopy = await resumeHeldProgramme(copyTemplateId, options);
      if (resumedCopy !== null) {
        return resumedCopy;
      }
    }

    // Held but switched off: resumed, not rebuilt. Falling through here
    // built a fresh plan over the same id, and its updatedAt is the block
    // boundary — a programme at week 5, 12 of 24, came back from the goal
    // flow or the completion card as week 1, 0 of 24, with its week dealt
    // again while the rotation carried on (audit round 4, 2026-09-20).
    // The Active switch already keeps the plan; this is the same path, and
    // it is the same path the reader's own copy comes back through above.
    const resumedHeld = await resumeHeldProgramme(workoutTemplateId, options);
    if (resumedHeld !== null) {
      return resumedHeld;
    }
    const planId = buildReadyProgramPlanId(workoutTemplateId);
    // The cap counts what will be running: a finished programme this one
    // replaces has already given up its slot (runningSetWithout).
    const running = runningSetWithout({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      replacingPlanId: options.replacingPlanId,
    });
    const decision = evaluateProgramAdoption({
      activePlanIds: running.activePlanIds,
      targetPlanId: planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });

    if (decision.kind === 'already_active') {
      return true;
    }

    if (decision.kind === 'blocked') {
      // In the count running now, not the one without the finished programme
      // it replaces (runningCapRefusal).
      const refusal = runningCapRefusal(preferences.activePlanIds, decision);
      // Full on the free tier is a sale; full on Pro is not, and sending a
      // paying reader to the paywall would be selling them what they own.
      if (decision.canUpgrade) {
        // The wall first, on this screen, then Pro only if the reader asks —
        // it used to jump straight to the paywall (user 2026-09-14).
        setRunningCapSheet({ visible: true, ...refusal });
        return false;
      }
      showToast(runningCapRefusalMessage(preferences.appLanguage, refusal));
      return false;
    }

    // The programme's own week leads. This read availability alone and fell
    // back to a three-day default, and the plan then dealt sessions round-robin
    // across whatever labels it got — so a six-session programme ran on three
    // days, twice over, and every programme became a three-day programme.
    const dayLabels = planLabelsForProgramme(
      template.sessions.length,
      preferences.setupAvailableDays,
      // Adopting is a moment, and the cycle starts from it.
      new Date(),
    );

    const plan = buildProgramWorkoutPlan({
      planId,
      workoutTemplateId,
      programName: formatWorkoutDisplayLabel(template.name),
      sessionIds: template.sessions.map((session) => session.id),
      dayLabels,
      now: new Date().toISOString(),
    });

    await upsertWorkoutPlan(plan);
    // One write: the finished programme leaves the running set as this one
    // joins it, so the reader never holds both.
    const nextActivePlanIds = addActiveProgram(running.activePlanIds, plan.id);
    await updatePreferences({
      activePlanIds: nextActivePlanIds,
      // Adopting a programme must not quietly demote the one already at the
      // top of Home — but stepping up FROM a finished programme is the reader
      // explicitly choosing a new lead, so the completion flow passes `lead`.
      activePlanId: options.lead ? plan.id : running.activePlanId ?? plan.id,
    });
    /*
     * Counted where a programme has started running: after the write.
     *
     * This fired at the top of the handler, before every early return, and
     * then (2026-09-20) above the cap check — "an attempt at one", so a free
     * reader at the cap who looked at the sheet and said no was counted as
     * having adopted a programme, and so was a write that failed. The row
     * says a programme is in use; the cap sheet is not that (analytics
     * audit, 2026-09-21).
     */
    trackEvent('plan_adopted');
    return true;
  }

  function handleStartCustomProgramSession(workoutTemplateId: string, sessionId: string) {
    const customTemplate = customWorkoutRuntimeMap[workoutTemplateId];
    if (!customTemplate) {
      return;
    }

    const selectedSession = customTemplate.sessions.find((session) => session.id === sessionId) ?? null;
    if (!selectedSession?.exercises.length) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesSession'));
      // To the day itself, where "Lisää liike" is. It went to the template
      // editor, which a programme page no longer opens — and a day can be
      // empty now on purpose, named first and filled after (2026-09-26).
      if (selectedSession) {
        navigate({ tab: 'workout', screen: 'programDay', programType: 'custom', workoutTemplateId, sessionId });
      }
      return;
    }

    // Same rule as the ready-programme start above.
    if (navigateToActiveWorkout({ resume: isActiveSessionFor(workoutTemplateId, sessionId) })) {
      return;
    }

    const sessionRef = { programId: workoutTemplateId, sessionId };
    const runtimeTemplate = applySessionAdaptation(
      buildCustomSessionRuntimeTemplate(customTemplate, sessionId),
      sessionAdaptationFor(sessionRef),
    );
    // Every row left out for today: the same refusal as the ready start.
    if (sessionHasNoExercises(runtimeTemplate)) {
      showToast(t(preferences.appLanguage, 'toast.everyLiftDropped'));
      return;
    }

    guardStrengthStartOverCardio(() => {
      // Nor here: training leaves the active programme where it is, as on the
      // ready path above.
      void updatePreferences({ trainingFirstRunDismissed: true });
      startProgrammeWorkout(runtimeTemplate, unitPreference);
      setHeldSessionAdaptations((held) => spendHeldAdaptation(held, sessionRef));
      navigateToGuidedWorkout(workoutTemplateId);
    });
  }

  /**
   * "Today is legs, not upper."
   *
   * The rotation decides what comes next in the programme and is right nearly
   * every day; what it cannot know is that the reader's day went differently.
   * The pick is dated, so it answers for today and the rotation answers again
   * tomorrow — nothing has to remember to clear it.
   */
  async function handlePickTodaySession(sessionId: string) {
    const now = new Date();
    try {
      await updatePreferences({
        todaySession: {
          dayStart: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
          sessionId,
          // Session ids repeat across programmes; this says which one's day.
          workoutTemplateId: homeActivePlanCard?.programId ?? null,
          // The instant matters, not just the day: picking a session you already
          // trained today is how you say "again", and without a timestamp it was
          // indistinguishable from the stale pick left over from this morning.
          pickedAt: now.getTime(),
        },
      });
    } catch (error) {
      // Wired as `void`: a refused write was a pick that sprang back unsaid.
      reportPlanSaveFailed('Failed to save the picked session', error, preferences.appLanguage, showToast);
    }
  }

  /** Resolves true once the programme is running, false when it was not taken on. */
  /**
   * "Ota ohjelma käyttöön" on a program of the reader's own.
   *
   * The ready-program half of this was fixed and the custom half was not, which
   * left a program the reader built or imported reachable only as a list of
   * sessions to start one at a time. Reported by a reader who imported their own
   * six-day program and could not get it onto the home screen by any route —
   * Home offered the catalog and onboarding, and neither of those knows about a
   * program that came from a spreadsheet.
   *
   * Adoption is the same act whatever the program's source, so this is
   * `handleAdoptReadyProgram` with the template read from the reader's own
   * templates and the plan id from the custom namespace.
   */
  async function handleAdoptCustomProgram(workoutTemplateId: string, options?: { lead?: boolean }): Promise<boolean> {
    const template = customWorkoutRuntimeMap[workoutTemplateId];
    // An empty program is not a plan. Home would draw a card with no session
    // behind it, so the editor is the honest destination.
    const sessionIds = (template?.sessions ?? [])
      .filter((session) => session.exercises.length > 0)
      .map((session) => session.id);
    if (sessionIds.length === 0) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesTemplate'));
      navigate({ tab: 'workout', screen: 'template', workoutTemplateId });
      return false;
    }

    if (activeProgramTemplateIds.includes(workoutTemplateId)) {
      if (options?.lead) {
        await promoteHeldProgramToLead(workoutTemplateId);
      }
      return true;
    }

    const planId = buildCustomProgramPlanId(workoutTemplateId);
    const decision = evaluateProgramAdoption({
      activePlanIds: preferences.activePlanIds,
      targetPlanId: planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });

    if (decision.kind === 'already_active') {
      return true;
    }

    if (decision.kind === 'blocked') {
      if (decision.canUpgrade) {
        setRunningCapSheet({ visible: true, used: decision.used, cap: decision.cap, replacingStop: null });
        return false;
      }
      showToast(programCapFullMessage(preferences.appLanguage, decision.used, decision.cap));
      return false;
    }

    const plan = buildCustomProgrammePlan(workoutTemplateId);
    if (!plan) {
      return false;
    }

    await upsertWorkoutPlan(plan);
    await updatePreferences({
      activePlanIds: addActiveProgram(preferences.activePlanIds, plan.id),
      activePlanId: options?.lead ? plan.id : preferences.activePlanId ?? plan.id,
    });
    // The reader's own programme taken into use is an adoption like a ready
    // one, and was never counted as one (analytics audit, 2026-09-21).
    trackEvent('plan_adopted');
    return true;
  }

  function handleStartCustomProgram(workoutTemplateId: string) {
    const customTemplate = customWorkoutRuntimeMap[workoutTemplateId];
    // The day Home offers when this programme leads, else its first day with
    // lifts in it.
    const firstSessionId = programmeStartSessionId(
      (customTemplate?.sessions ?? []).map((session) => ({ id: session.id, exerciseCount: session.exercises.length })),
      workoutTemplateId,
      homeActivePlanCard,
    );
    if (!firstSessionId) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesTemplate'));
      navigate({ tab: 'workout', screen: 'template', workoutTemplateId });
      return;
    }

    handleStartCustomProgramSession(workoutTemplateId, firstSessionId);
  }


  async function handleDeleteCustomWorkout(workoutTemplateId: string) {
    // Not while one of its days is running: the player would be routed to a
    // programme that is gone, and the sets in it could never be saved.
    if (liveSessionBlocksProgrammeDelete(workout.activeSession, workoutTemplateId)) {
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteWorkoutRunning'));
      return;
    }
    // A refused write rolls the delete back and rejects; the press is wired
    // as `void`, so uncaught it was a programme that vanished and came back
    // with no word (hunt 10, #37).
    try {
      await deleteWorkoutTemplate(workoutTemplateId);
    } catch (error) {
      console.error('Failed to delete the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteFailed'));
      return;
    }
    void haptics.success();
    leaveDeletedProgramme(workoutTemplateId);
  }

  return {
    handleAdoptReadyProgram,
    handleAdoptCustomProgram,
    handleStartCustomProgramSession,
    handleStartCustomProgram,
    handleDeleteCustomWorkout,
    handlePickTodaySession,
  };
}
