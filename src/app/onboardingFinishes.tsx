import { Alert } from 'react-native';
import { trackEvent } from '../features/analytics/analyticsClient';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import {
  activateOnboardingPlan,
  findReplaceableOnboardingTemplateId,
  resolveActiveProgramCap,
} from '../lib/activeProgramSet';
import { isAiCoachLiveConfigured, requestProgramTableFromImage } from '../lib/aiCoachClient';
import { joinedRunningSet } from '../lib/analyticsMoments';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { FirstRunSetupSelection, isSetupDaysPerWeek } from '../lib/firstRunSetup';
import { leadPlanTrainingCycle } from '../lib/planTrainingCycle';
import { t } from '../lib/i18n';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { buildProgramWorkoutPlan, buildReadyProgramPlanId } from '../lib/programAdoption';
import { programTableToCsv } from '../lib/programImageImport';
import { ProgramLimitReachedError } from '../lib/programSlots';
import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import { type AppRoute, ROOT_ROUTES } from '../navigation/routes';
import type { AboutYouValues } from '../screens/AboutYouScreen';
import type { useAppContext } from '../state/AppProvider';
import { SetupCautionFlag, WorkoutTemplateDraft } from '../types/models';
import { haptics } from '../utils/haptics';
import { pickProgramImage, type ProgramImageImportResult } from '../utils/programImagePicker';
import { buildSavedOnboardingPlan, buildSavedOnboardingWorkoutPlan, buildSetupPreferencePatch } from './onboardingHandoff';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * The ways onboarding ends and the photo import: the catalogue pick, the
 * entry flow's two steps, the guided finish and Profile's re-run of it, the
 * limitations saved from My Data, and a programme read from a photo behind
 * the notice the policy promises.
 *
 * Moved verbatim from VinhaApp in App.tsx in phase C of the split
 * (2026-10-01), each function with its doc. A per-render factory, not a hook:
 * it holds no state and calls no hook. VinhaApp calls it on every render,
 * exactly where the declarations stood (after leaveDeletedProgramme), so each
 * handler is still a fresh closure over that render's values, and
 * handlePickProgramImage is still decided on every render, at the same point;
 * every use of them in App.tsx sits below the call. handleOpenPremium, which
 * nothing read, is gone (#bugs 2026-10-01).
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx and
 * the About form's from src/screens/AboutYouScreen.tsx; no .ts module imports
 * this file, and the test build does not compile it.
 */
export interface OnboardingFinishesDeps {
  database: AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  updatePreferences: AppContextValue['updatePreferences'];
  completeOnboarding: AppContextValue['completeOnboarding'];
  upsertWorkoutPlan: AppContextValue['upsertWorkoutPlan'];
  saveOnboardingResult: AppContextValue['saveOnboardingResult'];
  /** The About form, as the reader left it. */
  aboutYouValues: AboutYouValues | null;
  busySavingReadyPick: boolean;
  setBusySavingReadyPick: (busy: boolean) => void;
  /** Opens the theme question. */
  setThemeChoiceVisible: (visible: boolean) => void;
  /** Opens the programme-limit sheet. */
  setProgramLimitVisible: (visible: boolean) => void;
  /** VinhaApp's hoisted navigateBack. */
  navigateBack: (fallback?: AppRoute | null) => void;
  /** VinhaApp's hoisted resetToRoute. */
  resetToRoute: (nextRoute: AppRoute) => void;
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
}

export function createOnboardingFinishes(deps: OnboardingFinishesDeps) {
  const {
    database,
    preferences,
    updatePreferences,
    completeOnboarding,
    upsertWorkoutPlan,
    saveOnboardingResult,
    aboutYouValues,
    busySavingReadyPick,
    setBusySavingReadyPick,
    setThemeChoiceVisible,
    setProgramLimitVisible,
    navigateBack,
    resetToRoute,
    showToast,
  } = deps;

  async function handleOnboardingPickReadyProgram(programId: string) {
    if (busySavingReadyPick) {
      return;
    }
    setBusySavingReadyPick(true);
    try {
      // Actually ADOPT the programme, don't just remember that it was suggested.
      //
      // This wrote `recommendedProgramId: programId, activePlanId: null`, and a
      // recommendation is not a plan: Home reads the active plan, so a reader
      // who picked a programme here landed on a Home that showed no programme
      // at all and a Profile that said "no programme selected". The pick was
      // stored, and invisible. Every other way into a ready programme —
      // joining a season, stepping up after a completion — goes through
      // handleAdoptReadyProgram and builds this plan record; onboarding was the
      // one door that skipped it.
      const template = getWorkoutTemplateById(programId);
      // A template's day count is a plain number; the preference is a union of
      // the five the questionnaire offers. Narrow rather than cast, so a
      // catalog entry outside that range stores null instead of a value the
      // rest of the app has no branch for.
      const templateDaysPerWeek =
        template && isSetupDaysPerWeek(template.daysPerWeek) ? template.daysPerWeek : null;
      let adoptedPlanId: string | null = null;
      if (template) {
        // No questionnaire ran on this path, so there are no chosen weekdays to
        // hang the sessions on. The programme's own session count is a fact
        // about the thing the reader just picked, so the rhythm for THAT count
        // beats a global fallback — placed the way every other adoption places
        // it, with day 1 on the first training day still ahead. The unrotated
        // rhythm put day 1 on Monday whatever day the pick was made, while
        // Home offered it today (2026-09-17; the guided path was fixed in #125).
        const dayLabels = planLabelsForProgramme(template.sessions.length, [], new Date());
        const plan = buildProgramWorkoutPlan({
          planId: buildReadyProgramPlanId(programId),
          workoutTemplateId: programId,
          programName: formatWorkoutDisplayLabel(template.name),
          sessionIds: template.sessions.map((session) => session.id),
          dayLabels,
          now: new Date().toISOString(),
        });
        // upsertWorkoutPlan and completeOnboarding both run through the
        // provider's serial queue, so awaiting in order is enough — the plan
        // exists before any preference points at it.
        await upsertWorkoutPlan(plan);
        adoptedPlanId = plan.id;
      }
      // The same rule as the guided finishes: onboarding's earlier plan is
      // replaced, and a season or a programme adopted by hand keeps running.
      // No template, no plan — and nothing that was running is stopped. Held
      // in a name because the adoption below is read off it.
      const activation = adoptedPlanId
        ? activateOnboardingPlan(
            preferences,
            adoptedPlanId,
            resolveActiveProgramCap(resolveProEntitlement(preferences).unlocked),
          )
        : null;

      // Finished, by the catalogue rather than by the questionnaire (fixed
      // 2026-09-10). Four paths complete onboarding and only one of them used
      // to say so, so the funnel's last row read 0 % while people plainly got
      // through it — plans adopted and workouts logged under a step nobody had
      // reached. `path` is what tells the four apart. Sent below, once the
      // write has landed.
      // The ready path skips the About form, so every basic here is normally
      // null — that is fine and deliberate. Guided onboarding is the path that
      // fills them. No questionnaire ran either, so setup stays incomplete.
      await completeOnboarding({
        onboardingCompleted: true,
        setupCompleted: false,
        trainingFirstRunDismissed: false,
        setupGender: aboutYouValues?.gender ?? null,
        setupAgeRange: aboutYouValues?.ageRange ?? null,
        setupCurrentWeightKg: aboutYouValues?.weightKg ?? null,
        // Kept as well as the plan: the recommendation is what the catalog
        // highlights on a later visit, the plan is what Home trains from.
        recommendedProgramId: programId,
        setupDaysPerWeek: templateDaysPerWeek,
        ...(activation ?? {}),
      });
      trackEvent('onboarding_completed', { path: 'ready_catalog' });
      // The pick is a programme taken into use, and this door sent only the
      // completion: the funnel's "programme in use" row missed every reader
      // who started from the catalogue (analytics audit, 2026-09-21).
      if (activation && joinedRunningSet(preferences.activePlanIds, activation.activePlanIds)) {
        trackEvent('plan_adopted');
      }
      // No weigh-in written here: the setup weight is logged once, by the
      // flagged seeding effect, which this and the effect both writing used to
      // turn into two identical entries.
      resetToRoute(ROOT_ROUTES.home);
    } catch (error) {
      // The reader tapped a programme and nothing happened: the button came
      // back and no reason was given (2026-09-17). Said out loud now, the
      // same way the guided finish says it.
      console.error('Failed to save the onboarding catalogue pick', error);
      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
    } finally {
      setBusySavingReadyPick(false);
    }
  }

  /**
   * A photo of a programme, as the CSV text the paste box would have held.
   *
   * Every failure returns null on purpose: no network, no permission, an
   * unreadable photo and a photo of something else all leave the reader with
   * nothing to import, and the sheet says so in one sentence rather than
   * teaching them the difference.
   */
  /**
   * Import a programme from a photo — the live coach's path, and only its.
   *
   * `requestProgramTableFromImage` returns null before it makes a request
   * when there is no endpoint, so in a preview build the button opened the
   * gallery, took a photo the reader had to choose, and produced nothing at
   * all. The button is offered only when there is something behind it
   * (2026-09-16).
   */
  /**
   * The notice, before the photo leaves — the one the policy promises.
   *
   * The policy: the AI coach's online mode is sent "when you read a notice
   * and then send a question, ask for a programme, or import one from a
   * photo" — docs/legal/privacy, both languages. The notice existed in
   * exactly one place, the chat screen, and
   * `aiOnlineNoticeAcknowledged` was read only there. The photo import is
   * reached from the Programs tab, the training plan and Settings, none of
   * which touches the chat, so a reader who had never opened the coach could
   * send a photo of their programme with nothing said at all (audit 3,
   * 2026-09-19).
   *
   * Here rather than in the sheet, because the sheet is rendered from three
   * screens and a fourth entry point would miss a gate placed in it. This is
   * the one function every path goes through.
   */
  function askPhotoOnlineNotice(): Promise<boolean> {
    // Its own flag, and the chat's as well — one way only. The chat's notice
    // covers everything this one does and a great deal more (the workouts, the
    // programme, the goals, the weight and measurements, height, age, gender,
    // the conversation so far), so a reader who has read THAT has been told
    // about a photo too. Answering this one cannot stand in for that: sharing
    // the flag would have let a reader who only ever saw "one photo, and
    // nothing else about you" send all of it later with no notice at all
    // (CI review of #146).
    if (preferences.aiPhotoNoticeAcknowledged || preferences.aiOnlineNoticeAcknowledged) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      Alert.alert(
        t(preferences.appLanguage, 'csv.photo.notice.title'),
        t(preferences.appLanguage, 'csv.photo.notice.body'),
        [
          { text: t(preferences.appLanguage, 'csv.photo.notice.cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t(preferences.appLanguage, 'csv.photo.notice.continue'),
            onPress: () => {
              // This notice only. The chat asks its own, because it discloses
              // its own.
              void updatePreferences({ aiPhotoNoticeAcknowledged: true });
              resolve(true);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  async function pickProgramImageForImport(): Promise<ProgramImageImportResult> {
    // Pro only (user 2026-09-29): each photo is a paid model call. The sheet
    // locks its link, but a sheet whose caller forgot proUnlocked defaults to
    // unlocked, so the paid call itself checks too.
    if (!resolveProEntitlement(preferences).unlocked) {
      return { status: 'cancelled' };
    }
    if (!(await askPhotoOnlineNotice())) {
      return { status: 'cancelled' };
    }
    const picked = await pickProgramImage();
    if (picked.status === 'cancelled') {
      // Backing out of the picker is an answer, not a failure. It used to come
      // back as the same null every other ending did, so the sheet told a
      // reader who had chosen nothing that their photo could not be read.
      return { status: 'cancelled' };
    }
    if (picked.status !== 'picked') {
      return { status: 'failed' };
    }
    const rows = await requestProgramTableFromImage({
      ...picked.image,
      // The photo line of the consent sheet, read at the moment the photo is
      // sent rather than remembered from when the screen opened.
      keepConsent: preferences.aiLogPhotoConsent,
      logId: preferences.aiLogId,
    });
    return rows && rows.length > 0 ? { status: 'read', csv: programTableToCsv(rows) } : { status: 'failed' };
  }

  const handlePickProgramImage = isAiCoachLiveConfigured() ? pickProgramImageForImport : undefined;

  async function handleContinueEntry() {
    await updatePreferences({
      selectedSignInMethod: 'local',
      entryFlowCompleted: true,
      selectedAccessTier: 'free',
    });
    // "Let's begin" opens the theme question (user 2026-08-23). It sits here
    // rather than anywhere later because the answer decides what the rest of
    // onboarding looks like — asking afterwards would repaint a flow the
    // reader has already been through.
    setThemeChoiceVisible(true);
  }

  async function handleBackToEntry() {
    await updatePreferences({
      entryFlowCompleted: false,
    });
  }

  /**
   * Onboarding's save, with both ways it can fail said out loud.
   *
   * Setup can be answered again from Profile at any time, and every run writes
   * a new programme of the reader's own. A free reader who already keeps three
   * had the provider refuse the fourth — and nothing caught the refusal: the
   * button came back, nothing happened, and no reason was given. The limit
   * sheet is the reason, the same one shown everywhere else a programme is
   * made. Anything else is a failed save, and says so.
   */
  /** The draft, carrying the id of the untouched onboarding programme it replaces, if any. */
  function withReplaceableOnboardingId(draft: WorkoutTemplateDraft): WorkoutTemplateDraft {
    const replaceableId = findReplaceableOnboardingTemplateId({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      templates: database.workoutTemplates,
      sessions: database.workoutSessions,
    });
    return replaceableId ? { ...draft, id: replaceableId } : draft;
  }

  async function saveOnboardingOrExplain(input: Parameters<typeof saveOnboardingResult>[0]): Promise<boolean> {
    try {
      await saveOnboardingResult(input);
      return true;
    } catch (error) {
      if (error instanceof ProgramLimitReachedError) {
        setProgramLimitVisible(true);
        return false;
      }
      console.error('Failed to save the onboarding result', error);
      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
      return false;
    }
  }

  async function handleOnboardingCompleteToTraining(
    selection: FirstRunSetupSelection,
    recommendedProgramId: string,
  ) {
    // Was three seconds of setTimeout before any of this ran, so finishing
    // onboarding took the real work plus a flat 3s of nothing — reported from
    // the phone as a five-second freeze on "Kysy myöhemmin" and "Hanki Pro".
    // The saving state is shown for as long as saving actually takes, which is
    // the same rule the workout save already follows.
    const savedPlan = buildSavedOnboardingPlan(
      selection,
      recommendedProgramId,
      preferences.appLanguage,
    );
    // One save, not four. Preferences, the template, its exercises and the plan
    // used to be four awaited mutations in a row, each one serializing the whole
    // database through the same queue — at the end of onboarding, where the wait
    // is least affordable. The plan is built inside that single lock because it
    // needs the id the template upsert generates.
    let joined = false;
    const saved = await saveOnboardingOrExplain({
      preferences: {
        onboardingCompleted: true,
        ...buildSetupPreferencePatch(selection, recommendedProgramId),
      },
      // A new run of the questionnaire writes over the programme the last run
      // made, unless the reader has changed it since.
      templateDraft: withReplaceableOnboardingId(savedPlan.draft),
      // Session ids come from the template that was actually written, not from
      // the in-memory draft it was built from.
      buildPlan: (workoutTemplateId, sessionIds) =>
        buildSavedOnboardingWorkoutPlan(
          selection,
          workoutTemplateId,
          sessionIds,
          preferences.appLanguage,
          leadPlanTrainingCycle(database.workoutPlans, preferences.activePlanId),
        ),
      activate: (planId, current) => {
        const next = activateOnboardingPlan(current, planId, resolveActiveProgramCap(resolveProEntitlement(current).unlocked));
        // Read inside the lock, against the set as it stands there.
        joined = joinedRunningSet(current.activePlanIds, next.activePlanIds);
        return next;
      },
    });
    if (!saved) {
      return;
    }
    // The questionnaire's finish, counted. The only call for this path sat in
    // a finish handler nothing on screen reached, so the funnel's last row
    // missed the path most readers take (2026-09-17).
    trackEvent('onboarding_completed', { path: 'build' });
    // And the programme it built, which is running now. This path sent only
    // the completion, so "programme in use" missed most first runs
    // (analytics audit, 2026-09-21).
    if (joined) {
      trackEvent('plan_adopted');
    }
    // The About form's weight reaches the log through the flagged seeding
    // effect, once. Writing it here as well gave a first run two identical
    // weigh-ins: the effect fires as soon as onboarding is marked done, and
    // this check read a `database` from before the save, always empty.
    // Onboarding ends here, on the app itself.
    //
    // Two paywalls have been removed from this seam. First the hop to the
    // standalone pro_offer screen, when the sale moved inside onboarding as
    // its last step; then that last step too (user 2026-08-24) — the reader
    // has just been handed a programme, and asking for money in the same
    // breath is the wrong moment. Both orphaned screens were deleted on
    // 2026-08-25; the Pro page in Profile is where the sale lives.
    // The success buzz, now that there is a success: the review screen's
    // button used to buzz on press, before the save had even started.
    void haptics.success();
    resetToRoute(ROOT_ROUTES.home);
  }

  /**
   * My Data's "Edit limitations", saved as what it is: a preference.
   *
   * The step used to walk on into a whole new programme, so a limitation
   * counted only if the reader rebuilt their training behind it, and backing
   * out dropped it (2026-09-17). Back to My Data once the write has landed;
   * a refused write keeps the step open and says so.
   */
  async function handleSaveSetupLimitations(cautionFlags: SetupCautionFlag[]) {
    try {
      await updatePreferences({ setupCautionFlags: cautionFlags });
    } catch (error) {
      console.error('Failed to save the limitations', error);
      showToast(t(preferences.appLanguage, 'toast.limitationsSaveFailed'));
      return;
    }
    void haptics.success();
    navigateBack(ROOT_ROUTES.profile);
  }

  async function handleSetupCompleteToTraining(selection: FirstRunSetupSelection, recommendedProgramId: string) {
    // Was three seconds of setTimeout before any of this ran, so finishing
    // onboarding took the real work plus a flat 3s of nothing — reported from
    // the phone as a five-second freeze on "Kysy myöhemmin" and "Hanki Pro".
    // The saving state is shown for as long as saving actually takes, which is
    // the same rule the workout save already follows.
    const savedPlan = buildSavedOnboardingPlan(
      selection,
      recommendedProgramId,
      preferences.appLanguage,
    );
    // One save, not four. Preferences, the template, its exercises and the plan
    // used to be four awaited mutations in a row, each one serializing the whole
    // database through the same queue — at the end of onboarding, where the wait
    // is least affordable. The plan is built inside that single lock because it
    // needs the id the template upsert generates.
    let joined = false;
    const saved = await saveOnboardingOrExplain({
      preferences: {
        onboardingCompleted: true,
        ...buildSetupPreferencePatch(selection, recommendedProgramId),
      },
      // A new run of the questionnaire writes over the programme the last run
      // made, unless the reader has changed it since.
      templateDraft: withReplaceableOnboardingId(savedPlan.draft),
      // Session ids come from the template that was actually written, not from
      // the in-memory draft it was built from.
      buildPlan: (workoutTemplateId, sessionIds) =>
        buildSavedOnboardingWorkoutPlan(
          selection,
          workoutTemplateId,
          sessionIds,
          preferences.appLanguage,
          leadPlanTrainingCycle(database.workoutPlans, preferences.activePlanId),
        ),
      activate: (planId, current) => {
        const next = activateOnboardingPlan(current, planId, resolveActiveProgramCap(resolveProEntitlement(current).unlocked));
        joined = joinedRunningSet(current.activePlanIds, next.activePlanIds);
        return next;
      },
    });
    if (!saved) {
      return;
    }
    // A re-run that wrote over its own untouched programme adds nothing; one
    // that built a new programme beside it took that one into use
    // (analytics audit, 2026-09-21).
    if (joined) {
      trackEvent('plan_adopted');
    }
    // No weigh-in on a re-run. The questions carry the stored setup weight
    // through without asking for a new one, so there is nothing new to log —
    // and an empty log here is usually one the reader emptied: this put their
    // deleted weigh-in straight back (2026-09-17). The first one is the
    // seeding effect's, once.
    void haptics.success();
    resetToRoute(ROOT_ROUTES.home);
  }

  return {
    handleOnboardingPickReadyProgram,
    handlePickProgramImage,
    handleContinueEntry,
    handleBackToEntry,
    handleOnboardingCompleteToTraining,
    handleSaveSetupLimitations,
    handleSetupCompleteToTraining,
  };
}
