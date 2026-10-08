import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { StorageLoadFailedScreen } from '../components/StorageLoadFailedScreen';
import { resolveDeviceLanguage } from '../storage/deviceLocale';
import { findSavedCardioRun, mergeContinuedCardioRun } from '../lib/cardio';
import { createId } from '../lib/ids';
import { groupLogsBySession, logsOfSession } from '../lib/sessionLogIndex';
import { preferencesForRestore } from '../lib/accountBackup';
import { moveTrainingCycleToLeadPlan, withPlanTrainingCycle } from '../lib/planTrainingCycle';
import { withPendingAiLogDeletion, withoutAiLogDeletions } from '../lib/aiLogDeletion';
import { isProUnlocked } from '../lib/proEntitlement';
import {
  countAuthoredPrograms,
  FREE_CUSTOM_PROGRAM_LIMIT,
  ProgramLimitReachedError,
  ProgramSlots,
  resolveProgramSlots,
} from '../lib/programSlots';
import { rememberName } from '../lib/exerciseNameBook';
import { normalizeSupersetGroups } from '../lib/supersetGrouping';
import { savedPrescription, savedRestSeconds } from '../lib/singleRepTarget';
import { findReadyProgrammeCopyId } from '../lib/programmeCopyLink';
import { plansChanged, renamePlansForTemplate } from '../lib/programRename';
import { createSerialTaskQueue, RunExclusive } from '../lib/serialTaskQueue';
import { buildWorkoutTemplateSessions } from '../lib/workoutTemplateSessions';
import {
  persistCompletedWorkoutSessionsToDatabase,
  persistCompletedWorkoutSessionToDatabase,
  PersistCompletedWorkoutInput,
  SessionSaveSummary,
} from './completedWorkoutPersistence';
import type { HevyImportedWorkout } from '../lib/hevyImport';
import { planIdsHoldingTemplate, stopProgramme } from '../lib/runningProgrammes';
import {
  getBodyweightProgress,
  getLatestLogForTemplateExercise,
  getTrackedExerciseProgress,
} from '../lib/progression';
import { loadDatabase, normalizeDatabase, resetDatabase, saveDatabase, savePreferences } from '../storage/database';
import { reportOperationFailed } from '../features/errorReporting/errorReporter';
import { loadWithRetry } from '../storage/loadWithRetry';
import {
  bodyweightRepository,
  exerciseTemplateRepository,
  workoutPlanRepository,
  workoutSessionRepository,
  workoutTemplateRepository,
} from '../storage/repositories';
import {
  AppDatabase,
  AppPreferences,
  BodyweightEntry,
  CardioActivityType,
  CardioFeel,
  CardioSession,
  ExerciseLogDraft,
  ExerciseTemplate,
  MeasurementEntry,
  MeasurementKind,
  MeasurementUnit,
  SessionFeel,
  TrainingCycle,
  UnitPreference,
  WorkoutPlan,
  WorkoutTemplateDraft,
  WorkoutTemplateSessionDraft,
  WorkoutTemplateSessionWithExercises,
} from '../types/models';

/**
 * What one edit decided to do with a template's days: write them, or stop
 * without writing and say why, so the screen can explain itself.
 */
export type WorkoutTemplateSessionsEdit =
  | { kind: 'save'; sessions: WorkoutTemplateSessionDraft[] }
  | { kind: 'skip'; reason: string };

export interface WorkoutTemplateSessionsEditResult {
  saved: boolean;
  /** 'templateMissing' when the programme was gone, otherwise the edit's own. */
  reason?: string;
}

/**
 * A patch, or a patch computed from the preferences as stored when the write
 * runs. Use the function form for any toggle of a list or map: a handler that
 * builds its patch from render-time preferences drops the first of two quick
 * taps, because both start from the same snapshot and the second replaces the
 * first (technique checklist, audit 7, 2026-09-26).
 */
export type PreferencesPatch =
  | Partial<AppPreferences>
  | ((current: AppPreferences) => Partial<AppPreferences>);

interface AppContextValue {
  database: AppDatabase;
  hydrated: boolean;
  preferences: AppPreferences;
  /** Free-tier program budget, so a screen can show it rather than hit it. */
  programSlots: ProgramSlots;
  unitPreference: UnitPreference;
  workoutTemplates: AppDatabase['workoutTemplates'];
  workoutPlans: AppDatabase['workoutPlans'];
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  workoutSessions: AppDatabase['workoutSessions'];
  cardioSessions: AppDatabase['cardioSessions'];
  bodyweightEntries: AppDatabase['bodyweightEntries'];
  measurementEntries: AppDatabase['measurementEntries'];
  trackedProgress: ReturnType<typeof getTrackedExerciseProgress>;
  bodyweightProgress: ReturnType<typeof getBodyweightProgress>;
  getWorkoutExercises: (workoutTemplateId: string) => ExerciseTemplate[];
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
  getWorkoutLastCompletedAt: (workoutTemplateId: string) => string | undefined;
  getLatestTemplateLog: (exerciseTemplateId: string) => ReturnType<typeof getLatestLogForTemplateExercise>;
  getSessionLogs: (sessionId: string) => AppDatabase['exerciseLogs'];
  setUnitPreference: (nextUnit: UnitPreference) => Promise<void>;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  completeOnboarding: (patch?: Partial<AppPreferences>) => Promise<void>;
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  upsertWorkoutPlan: (plan: WorkoutPlan) => Promise<void>;
  /**
   * One programme's rhythm set or cleared (null = its own week). Only that
   * plan moves: no other programme's rhythm, and not which one is active.
   */
  setPlanTrainingCycle: (planId: string, cycle: TrainingCycle | null) => Promise<void>;
  /**
   * A held programme gone for good: it stops running and every plan that
   * holds it is removed. Logged sessions stay. The programme itself is
   * catalog data and is not touched — this is "remove it from mine".
   */
  forgetHeldProgramme: (workoutTemplateId: string) => Promise<void>;
  /** Onboarding's whole result — preferences, template and plan — in one save. */
  saveOnboardingResult: (input: {
    preferences: Partial<AppPreferences>;
    templateDraft: WorkoutTemplateDraft;
    buildPlan: (workoutTemplateId: string, sessionIds: string[]) => WorkoutPlan;
    /** Given the preferences as they stand inside the lock, not as the caller last saw them. */
    activate: (planId: string, current: AppPreferences) => Partial<AppPreferences>;
  }) => Promise<{ workoutTemplateId: string; planId: string }>;
  renameWorkoutTemplate: (workoutTemplateId: string, nextName: string) => Promise<void>;
  /**
   * The only safe way to change what a template's days hold: the days are read
   * inside the same write slot, so an edit can never be built on a snapshot an
   * earlier edit has already moved past.
   */
  editWorkoutTemplateSessions: (
    workoutTemplateId: string,
    edit: (sessions: WorkoutTemplateSessionWithExercises[]) => WorkoutTemplateSessionsEdit,
  ) => Promise<WorkoutTemplateSessionsEditResult>;
  findWorkoutTemplateIdBySource: (sourceTemplateId: string) => Promise<string | null>;
  getWorkoutTemplateSessionsFresh: (
    workoutTemplateId: string,
  ) => Promise<WorkoutTemplateSessionWithExercises[]>;
  deleteWorkoutTemplate: (workoutTemplateId: string) => Promise<void>;
  saveWorkoutSession: (
    workoutTemplateId: string,
    logs: ExerciseLogDraft[],
    startedAt?: string,
  ) => Promise<SessionSaveSummary>;
  saveCompletedWorkoutSession: (input: PersistCompletedWorkoutInput) => Promise<SessionSaveSummary>;
  /** The database as it stands this instant (the write queue's own copy), for a decision that must not read a stale render. */
  getDatabase: () => AppDatabase;
  updateCompletedWorkoutSession: (
    sessionId: string,
    patch: {
      workoutNameSnapshot?: string;
      sessionNotes?: string | null;
      feel?: SessionFeel | null;
    },
  ) => Promise<void>;
  /** Removes a saved workout and the sets logged in it. */
  deleteCompletedWorkoutSession: (sessionId: string) => Promise<void>;
  /** Entry has a second half: what you typed in, you can take back. */
  deleteMeasurementEntry: (entryId: string) => Promise<void>;
  deleteBodyweightEntry: (entryId: string) => Promise<void>;
  deleteCardioSession: (sessionId: string) => Promise<void>;
  /**
   * Replaces local data with a cloud backup, through the same normalizer a
   * stored database goes through on load — an old backup gets defaults, not a
   * crash, and the exercise library is reseeded exactly like on load.
   */
  restoreDatabaseFromBackup: (input: Partial<AppDatabase>, options?: { rollback?: boolean }) => Promise<AppDatabase>;
  /**
   * Writes a parsed Hevy export into the history, through the same
   * persistence path a finished live workout takes. Session ids are
   * derived from the Hevy start time, so importing the same file twice
   * reports duplicates instead of doubling the history.
   */
  importWorkoutHistory: (
    workouts: HevyImportedWorkout[],
  ) => Promise<{ imported: number; duplicates: number }>;
  saveCardioSession: (input: {
    activityType: CardioActivityType;
    startedAt: string;
    /** When the run's clock stopped; the row is dated by it. */
    endedAt?: string | null;
    durationSec: number;
    distanceKm?: number | null;
    feel?: CardioFeel | null;
  }) => Promise<CardioSession>;
  /** The reader's own lift names, learned one import correction at a time. */
  exerciseNameBook: AppDatabase['exerciseNameBook'];
  /** Teach the book one spelling. Re-teaching replaces the previous answer. */
  teachExerciseName: (
    wrote: string,
    exercise: { name: string; libraryItemId: string | null },
  ) => Promise<void>;
  addBodyweightEntry: (weightKg: number, recordedAt?: string) => Promise<void>;
  addMeasurementEntry: (kind: MeasurementKind, value: number, unit: MeasurementUnit, recordedAt?: string) => Promise<void>;
  resetAllData: () => Promise<void>;
  /** Drops labels the server has confirmed deleting from the list still owed. */
  clearPendingAiLogDeletions: (deleted: readonly string[]) => Promise<void>;
  /**
   * Retire the coach's label, filing its delete as owed when `owed`. Resolves
   * with whether it ended up owed: a line switched back on under this label in
   * the meantime leaves it in use, and nothing is filed or said.
   */
  retireAiLogLabel: (logId: string, owed: boolean) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

function normalizeDraftSessions(draft: WorkoutTemplateDraft): WorkoutTemplateSessionDraft[] {
  if (Array.isArray(draft.sessions) && draft.sessions.length > 0) {
    return draft.sessions;
  }

  return [
    {
      name: draft.name.trim() || 'Session 1',
      exercises: Array.isArray(draft.exercises) ? draft.exercises : [],
    },
  ];
}

export function AppProvider({ children }: React.PropsWithChildren) {
  const [database, setDatabase] = useState<AppDatabase>({
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    exerciseLibrary: [],
    workoutSessions: [],
    cardioSessions: [],
    exerciseLogs: [],
    bodyweightEntries: [],
    measurementEntries: [],
    exerciseNameBook: [],
    preferences: {
      appLanguage: resolveDeviceLanguage(),
      unitPreference: 'kg',
      defaultRestSeconds: 120,
      autoFocusNextInput: true,
      keepScreenAwakeDuringWorkout: true,
      soundCuesEnabled: true,
      darkThemeEnabled: false,
      usageStatisticsEnabled: true,
      ratingPrompt: { lastAskedAt: null, askCount: 0, rated: false },
      hapticsEnabled: true,
      ownBlockStats: {},
      homeStatCardKeys: null,
      notificationPrefs: {
        pushEnabled: false,
        level: 'normal',
        personalRecords: true,
        weeklySummary: true,
        comebackNudge: true,
        sessionReminders: false,
        reminderTime: '17:30',
        weighInReminder: false,
        measurementReminderKind: null,
        measurementReminderDay: 'sun',
        restAlerts: true,
        restWarning: true,
        sessionOngoing: true,
        idleNudge: true,
        restAlertsAsked: false,
      },
      trainingBreak: null,
      legalAcceptance: null,
      restDayStarts: [],
      lightNextSession: null,
      aiLogId: null,
      aiLogChatConsent: false,
      aiLogComposerConsent: false,
      aiLogPhotoConsent: false,
      pendingAiLogDeletions: [],
      promoProUntil: null,
      proTrialUntil: null,
      proTrialStartedAt: null,
      mockSubscriptionTerm: 'yearly',
      mockSubscriptionCancelledAt: null,
      mockSubscriptionPurchasedAt: null,
      cancelSurveyAnswer: null,
      featureVotedIds: [],
      aiCoachProQuota: null,
      firstLaunchAt: null,
      coachDemoMomentsUsed: [],
      seenServerNoticeIds: [],
      automatedProgressionEnabled: true,
      aiSetupCompleted: false,
      hasOpenedAppBefore: false,
  setupWeightSeeded: false,
      accountNameAdopted: false,
      homeWidgetPromptDismissed: false,
      accountBackupPromptDismissed: false,
      aiOnlineNoticeAcknowledged: false,
      aiPhotoNoticeAcknowledged: false,
      coachGoals: [],
      primaryGoalId: null,
      coachSuggestionState: {},
      setupHandoffCompleted: false,
      firstRunToursSeen: [],
      entryFlowCompleted: false,
      trainingFirstRunDismissed: false,
      selectedSignInMethod: null,
      selectedAccessTier: null,
      profileName: null,
      setupCurrentWeightKg: null,
      bodyweightGoalKg: null,
      onboardingCompleted: false,
      setupCompleted: false,
      setupGender: null,
      setupAge: null,
      setupAgeRange: null,
      setupHeightCm: null,
      setupGoal: null,
      setupGoals: [],
      setupLevel: null,
      setupDaysPerWeek: null,
      setupEquipment: null,
      setupTrainingEnvironment: null,
      setupEquipmentItems: [],
      setupSecondaryOutcomes: [],
      setupFocusAreas: [],
      setupCautionFlags: [],
      setupGuidanceMode: null,
      setupScheduleMode: null,
      setupWeeklyMinutes: null,
      setupAvailableDays: [],
      trainingCycle: null,
      routineDrillOverrides: {},
      readerSessionNames: {},
      todaySession: null,
      setupTrainingFeel: 'challenging',
      setupWorkoutVariety: 'balanced',
      setupFreeWeightsPreference: 'neutral',
      setupBodyweightPreference: 'neutral',
      setupMachinesPreference: 'neutral',
      setupShoulderFriendlySwaps: 'neutral',
      setupElbowFriendlySwaps: 'neutral',
      setupKneeFriendlySwaps: 'neutral',
      aiPlannerGoal: null,
      aiPlannerDaysPerWeek: null,
      aiPlannerExperience: null,
      aiPlannerSessionMinutes: null,
      aiPlannerEquipment: null,
      aiPlannerRecovery: null,
      aiPlannerMustInclude: '',
      aiPlannerAvoid: '',
      aiPlannerLimitations: '',
      aiCoachTemplateId: null,
      aiCoachSetupHash: null,
      aiCoachPlanGeneratedAt: null,
      recommendedProgramId: null,
      learnedExerciseLibraryItemIds: [],
      exerciseTechniqueChecks: {},
      strengthGoals: [],
    seasonEnrolments: [],
      dismissedTipIds: [],
      dismissedCompletionPlanIds: [],
      dismissedCardSuggestionKeys: [],
      dismissedPlateauEpisodes: [],
      lastInsightSessionId: null,
      lastInsightType: null,
      activePlanId: null,
      activePlanIds: [],
      programsTabEnabled: true,
    },
  });
  const [hydrated, setHydrated] = useState(false);
  // The single source of truth for WRITERS. Only commit(), hydrate() and
  // resetAllData assign it — never an effect. A [database] effect used to sync
  // it from render state, and that was the onboarding data-loss bug: an
  // earlier render's effect could run right after commit() had advanced the
  // ref and shove it back to a stale snapshot, so the next queued write
  // rebuilt the whole database from a state where the template (or plan) had
  // never existed.
  const databaseRef = useRef(database);

  /**
   * Opens once the stored database is in memory. It is the first task in the
   * write queue below, so every write made before the load has finished waits
   * for it and then applies on top of what was stored.
   *
   * Without it a write that ran early built on the defaults this provider
   * starts with: the Google-name effect did exactly that on every cold start,
   * wrote the default preferences to their key, and the load laid them over
   * the reader's real ones.
   */
  const hydrationGateRef = useRef<{ promise: Promise<void>; open: () => void } | null>(null);
  if (hydrationGateRef.current === null) {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    hydrationGateRef.current = { promise, open };
  }

  /**
   * A load the phone refused, after retries. The app does not open on it.
   *
   * The fallback used to be an empty database marked hydrated: the app opened
   * as a new install and its first save wrote nothing over everything, with
   * no copy set aside — the quarantine only covers bytes that were read.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const result = await loadWithRetry(loadDatabase, {
        isCancelled: () => cancelled,
        onError: (error) => console.error('Failed to hydrate database', error),
      });
      if (result.kind === 'cancelled') {
        return;
      }
      if (result.kind === 'failed') {
        reportOperationFailed('database_load', result.error);
        setLoadFailed(true);
        return;
      }
      const nextDatabase = result.value;
      databaseRef.current = nextDatabase;
      setDatabase(nextDatabase);
      setLoadFailed(false);
      setHydrated(true);
      hydrationGateRef.current?.open();
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  /**
   * The one write. Memory moves first so the screen answers at once, and
   * moves back if the disk refuses.
   *
   * It used to move only forward: a save that failed (storage full, most
   * likely) left the new state in memory with nothing behind it. The finish
   * screen then showed its error, the reader pressed Finish again, and the
   * retry found the session already "saved" in memory — a duplicate id — so
   * it reported success and wrote nothing. The workout survived only if some
   * later full save happened to go through. The same shape lost a Hevy
   * import ("0 imported · N already existed") and let onboarding walk into
   * Home on a save that had not landed. Rolling back makes the retry a real
   * retry, and every caller's error state truthful.
   *
   * Every caller holds the serial queue, so nothing else has moved the ref in
   * between and putting the previous snapshot back cannot undo a newer write.
   */
  async function commit(nextDatabase: AppDatabase) {
    const previous = databaseRef.current;
    databaseRef.current = nextDatabase;
    setDatabase(nextDatabase);
    try {
      // Loading reads the preferences key OVER the blob (loadStoredPreferences),
      // so a commit that changed a preference and wrote only the blob was undone
      // by the next launch. Onboarding's result is such a commit: finish the
      // questions, close the app before touching anything that writes the key,
      // and onboarding started again with the answers gone (2026-09-14). The
      // backup restore had patched this for itself; every commit needs it.
      //
      // In one transaction with the blob, not after it: a kill between the
      // two writes kept the new programme in the blob under the old key, and
      // the next launch opened onboarding over a stranded programme (break
      // round, 2026-09-28). One write lands whole or not at all, so a refusal
      // leaves nothing on disk to take back.
      await saveDatabase(nextDatabase, { withPreferences: nextDatabase.preferences !== previous.preferences });
    } catch (error) {
      databaseRef.current = previous;
      setDatabase(previous);
      throw error;
    }
  }

  /**
   * Every mutation below is a read-modify-write of the whole database blob.
   * Two of them in flight at once both snapshot the same state, and whichever
   * commits last erases the other's work — the onboarding save chain lost its
   * freshly created programme exactly this way. The queue makes each
   * read-modify-write atomic: a mutation only reads databaseRef.current after
   * the previous mutation has finished writing it.
   *
   * Composite helpers (setUnitPreference, completeOnboarding,
   * saveWorkoutSession) intentionally stay unwrapped: they mutate only through
   * these primitives, and wrapping them too would deadlock the queue.
   */
  const runExclusiveRef = useRef<RunExclusive | null>(null);
  if (runExclusiveRef.current === null) {
    runExclusiveRef.current = createSerialTaskQueue();
    // Held until the load lands (hydrationGateRef above).
    const gate = hydrationGateRef.current;
    void runExclusiveRef.current(() => gate.promise);
  }
  const runExclusive = runExclusiveRef.current;

  /**
   * Preferences are the one mutation that does not pay for the whole database.
   *
   * This used to go through commit, which serializes every session, set and
   * measurement the reader owns before the write lands — so changing the theme
   * or the language cost the price of the entire training history, on the JS
   * thread, and got slower with every workout logged. They have their own key
   * now; the in-memory database stays the single source of truth, and the next
   * full save carries the same values into the blob.
   */
  function updatePreferences(patch: PreferencesPatch) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const next = {
        ...current,
        preferences: {
          ...current.preferences,
          ...(typeof patch === 'function' ? patch(current.preferences) : patch),
        },
      };
      databaseRef.current = next;
      setDatabase(next);
      try {
        await savePreferences(next.preferences);
      } catch (error) {
        // Same rule as commit: a toggle the disk refused is not on.
        databaseRef.current = current;
        setDatabase(current);
        throw error;
      }
    });
  }

  async function setUnitPreference(nextUnit: UnitPreference) {
    const current = databaseRef.current;
    if (current.preferences.unitPreference === nextUnit) {
      return;
    }

    await updatePreferences({ unitPreference: nextUnit });
  }

  async function completeOnboarding(patch: Partial<AppPreferences> = {}) {
    await updatePreferences({
      onboardingCompleted: true,
      ...patch,
    });
  }

  function upsertWorkoutTemplate(draft: WorkoutTemplateDraft) {
    return runExclusive(() => upsertWorkoutTemplateExclusive(draft));
  }

  async function upsertWorkoutTemplateExclusive(draft: WorkoutTemplateDraft) {
    const built = buildTemplateUpsert(draft);
    await commit(built.database);
    return built.workoutTemplateId;
  }

  /**
   * The template write with no commit of its own, so a caller writing more than
   * one thing can carry the result forward and land it all in a single save.
   */
  function buildTemplateUpsert(draft: WorkoutTemplateDraft) {
    const trimmedName = draft.name.trim();
    const nextName = trimmedName || 'Untitled workout';
    const current = databaseRef.current;
    const existingTemplate = draft.id ? workoutTemplateRepository.findById(current, draft.id) : undefined;

    // The cap is checked here, at the one place a program of your own comes
    // into existence, rather than at the five screens that can ask for one. A
    // screen that forgets the check would quietly hand out a paid slot; this
    // cannot be forgotten. Editing is never blocked — only a NEW program past
    // the limit, so a user who is already over it keeps everything they built.
    // Freestyle logging is exempt: it is not authoring, and throwing here
    // would mean a user at the cap could not save a workout they had already
    // performed.
    //
    // A copy that replaces a running ready programme is NOT exempt, though it
    // was. The reasoning was that it leaves the reader with as many
    // programmes as before — but the cap counts programmes of your own, and
    // the ready one it replaced was never one. Edit a running ready
    // programme, adopt the next, edit that: every round added a copy past the
    // limit, so a free reader could hold four, five, six (audit 2026-09-16).
    // Under the limit the copy is made as any new programme is; at the limit
    // the edit meets the same sheet. Editing the copy afterwards is an edit,
    // and never blocked.
    if (!existingTemplate && draft.origin !== 'freestyle') {
      const slots = resolveProgramSlots(
        countAuthoredPrograms(current.workoutTemplates),
        isProUnlocked(current.preferences),
      );
      if (!slots.canCreate) {
        throw new ProgramLimitReachedError(slots.limit ?? FREE_CUSTOM_PROGRAM_LIMIT);
      }
    }
    const workoutTemplateId = existingTemplate?.id ?? createId('workout');
    const timestamp = new Date().toISOString();
    const draftSessions = normalizeDraftSessions(draft);

    const sessions = draftSessions.map((session, sessionIndex) => {
      const workoutTemplateSessionId = session.id ?? createId('workout_template_session');
      // The superset ids ride along exactly as written, and are then run
      // through the adjacency rule: a save that moved one half of a pair away
      // from the other has ended that pair, whether or not the screen that
      // made the edit knew supersets existed.
      const exercises = normalizeSupersetGroups(
        session.exercises.map((exercise, exerciseIndex) => {
          const name = exercise.name.trim() || `Exercise ${exerciseIndex + 1}`;
          // Through the rule the loader applies (one rep number, an
          // interval resting its named off-phase), or the screen shows what
          // was typed until the next launch shows something else.
          const prescription = savedPrescription({
            name,
            repMin: Math.max(1, exercise.repMin),
            repMax: Math.max(Math.max(1, exercise.repMin), exercise.repMax),
            restSeconds: savedRestSeconds(exercise.restSeconds),
            trackingMode: exercise.trackingMode ?? null,
          });
          return {
            id: exercise.id ?? createId('exercise'),
            workoutTemplateId,
            workoutTemplateSessionId,
            name,
            targetSets: Math.max(1, exercise.targetSets),
            repMin: prescription.repMin,
            repMax: prescription.repMax,
            restSeconds: prescription.restSeconds,
            trackedDefault: exercise.trackedDefault,
            orderIndex: exerciseIndex,
            libraryItemId: exercise.libraryItemId ?? null,
            trackingMode: exercise.trackingMode ?? null,
            supersetGroup: exercise.supersetGroup ?? null,
          };
        }),
      );

      return {
        id: workoutTemplateSessionId,
        name: session.name.trim() || (sessionIndex === 0 ? nextName : `Session ${sessionIndex + 1}`),
        orderIndex: sessionIndex,
        exerciseIds: exercises.map((exercise) => exercise.id),
        exercises,
      };
    });

    const exercises = sessions.flatMap((session) => session.exercises);

    const nextTemplate = {
      id: workoutTemplateId,
      name: nextName,
      exerciseIds: exercises.map((exercise) => exercise.id),
      sessions: sessions.map(({ exercises: _, ...session }) => session),
      createdAt: existingTemplate?.createdAt ?? timestamp,
      updatedAt: timestamp,
      // An edit never changes what a template is: a freestyle log opened in the
      // editor stays freestyle, and vice versa.
      origin: existingTemplate?.origin ?? draft.origin ?? 'authored',
      // Nor does it change where it came from: an edit names no source, so
      // the stored link carries through every later edit — otherwise the
      // second edit would look for a copy and not find the one it is editing.
      //
      // A draft that DOES name one is the newest truth, and this read the
      // stored link first. Answering the questionnaire again writes a new
      // programme over the untouched one from the last run (see
      // withReplaceableOnboardingId), so a second run with a different
      // recommendation left a template full of programme B's days still
      // linked to programme A — A's page hiding its own week, adoption of A
      // resuming B, and A's history counting B's sessions (review of the
      // onboarding link, 2026-09-20).
      sourceTemplateId: draft.sourceTemplateId ?? existingTemplate?.sourceTemplateId ?? null,
    };

    let nextDatabase = workoutTemplateRepository.upsert(current, nextTemplate);
    nextDatabase = exerciseTemplateRepository.replaceForWorkoutTemplate(
      nextDatabase,
      workoutTemplateId,
      exercises,
    );
    nextDatabase = {
      ...nextDatabase,
      preferences: {
        ...nextDatabase.preferences,
        trainingFirstRunDismissed: true,
      },
    };
    return { database: nextDatabase, workoutTemplateId, sessions };
  }

  /**
   * Everything onboarding produces, written once.
   *
   * The finish used to be four awaited mutations in a row — preferences, the
   * template, the plan, then preferences again for the active plan id — and
   * each one is a read-modify-write of the whole database through the same
   * serial queue. Four full serializations for one moment, at the end of the
   * flow where a new reader is least willing to wait.
   *
   * The template id is why this cannot simply be reordered: the plan needs the
   * id the template upsert generates. So the whole thing happens inside one
   * lock, the plan is built from the id once it exists, and a single commit
   * carries preferences, template, exercises and plan together.
   */
  function saveOnboardingResult(input: {
    preferences: Partial<AppPreferences>;
    templateDraft: WorkoutTemplateDraft;
    buildPlan: (workoutTemplateId: string, sessionIds: string[]) => WorkoutPlan;
    /** Given the preferences as they stand inside the lock, not as the caller last saw them. */
    activate: (planId: string, current: AppPreferences) => Partial<AppPreferences>;
  }) {
    return runExclusive(async () => {
      const built = buildTemplateUpsert(input.templateDraft);
      const plan = input.buildPlan(
        built.workoutTemplateId,
        built.sessions.map((session) => session.id),
      );

      // What onboarding writes is a new programme even when it lands on the id
      // of the one it replaces, so it is dated as one. An edit keeps createdAt
      // and moves updatedAt; carried over here, a replaced programme would
      // look edited, and the next run of setup would stop replacing it (see
      // findReplaceableOnboardingTemplateId).
      const templates = built.database.workoutTemplates.map((template) =>
        template.id === built.workoutTemplateId ? { ...template, createdAt: template.updatedAt } : template,
      );
      // Replaced whole for the same reason: the rhythm the questions chose, or
      // none, is this programme's, where an edit would keep the old one.
      const withPlan = workoutPlanRepository.replace(
        {
          ...built.database,
          workoutTemplates: templates,
          workoutPlans: built.database.workoutPlans.map((item) => ({ ...item, isActive: false })),
        },
        { ...plan, isActive: true },
      );

      await commit({
        ...withPlan,
        preferences: {
          ...withPlan.preferences,
          ...input.preferences,
          ...input.activate(plan.id, withPlan.preferences),
        },
      });
      return { workoutTemplateId: built.workoutTemplateId, planId: plan.id };
    });
  }

  function upsertWorkoutPlan(plan: WorkoutPlan) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const currentWithoutActivePlans = {
        ...current,
        workoutPlans: current.workoutPlans.map((item) => ({ ...item, isActive: false })),
      };

      await commit(
        workoutPlanRepository.upsert(currentWithoutActivePlans, {
          ...plan,
          isActive: true,
        }),
      );
    });
  }

  function setPlanTrainingCycle(planId: string, cycle: TrainingCycle | null) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      if (!current.workoutPlans.some((plan) => plan.id === planId)) {
        throw new Error(`No plan ${planId} to set a rhythm on`);
      }
      await commit({ ...current, workoutPlans: withPlanTrainingCycle(current.workoutPlans, planId, cycle) });
    });
  }

  function renameWorkoutTemplate(workoutTemplateId: string, nextName: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const template = workoutTemplateRepository.findById(current, workoutTemplateId);

      if (!template) {
        return;
      }

      const trimmedName = nextName.trim();
      if (!trimmedName) {
        return;
      }

      const now = new Date().toISOString();
      const withTemplate = workoutTemplateRepository.upsert(current, {
        ...template,
        name: trimmedName,
        updatedAt: now,
      });
      // A plan keeps its own copy of the programme's name, taken when it was
      // made, and Home reads that copy first. Renaming the template alone
      // changed the programme page and left Home on the old name (user
      // 2026-09-08). Both records move together, in one commit, so no screen
      // can disagree with another about what was just typed.
      //
      // The plan's own `updatedAt` stays where it is: on a plan that field is
      // the block boundary Home counts the week from, not a modification time.
      const nextPlans = renamePlansForTemplate(withTemplate.workoutPlans, workoutTemplateId, trimmedName);
      await commit(
        plansChanged(withTemplate.workoutPlans, nextPlans)
          ? { ...withTemplate, workoutPlans: nextPlans }
          : withTemplate,
      );
    });
  }

  /**
   * Change what a template's days hold, reading and writing in one queue slot.
   *
   * The read half matters as much as the write half, and this is the lesson
   * that cost a morning. Callers used to rebuild the whole template from
   * `getWorkoutTemplateSessions` — which reads the RENDERED database — and
   * hand the result to `upsertWorkoutTemplate`, whose queue then made the
   * *write* atomic against a snapshot that was already stale. Two edits closer
   * together than a render (add a lift, add another before React had painted,
   * which on a laggy screen is easy) both started from the same days, and the
   * second wrote the first one out of existence. The reader was sure they had
   * added lifts and the lifts were gone — and they were right (#bugs
   * 2026-08-27, "mielestäni lisäsin nämä jo" / "liikkeet olivat hävinneet").
   *
   * Here the read happens inside the same exclusive slot as the write, from
   * databaseRef.current, so every edit builds on the one before it. Note the
   * call to `upsertWorkoutTemplateExclusive` rather than `upsertWorkoutTemplate`:
   * queueing from inside the queue would deadlock.
   */
  /**
   * The days of a stored programme, read from stored data.
   *
   * `getWorkoutTemplateSessions` reads the RENDERED database, which is the
   * right thing for a screen and the wrong thing immediately after a write:
   * the closure that just awaited an upsert still holds the render from
   * before it, so a template created a moment ago is not there yet. Copying a
   * ready programme did exactly that — read the copy's days back to build its
   * plan, got nothing, and `buildProgramWorkoutPlan` floors the count at one.
   * Every reader who edited a lift in a three-day programme was handed a
   * one-day plan pointing at no session (verified in stored data on the
   * emulator 2026-08-27: FIT's copy, three days, one entry).
   */
  function getWorkoutTemplateSessionsFresh(
    workoutTemplateId: string,
  ): Promise<WorkoutTemplateSessionWithExercises[]> {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const template = workoutTemplateRepository.findById(current, workoutTemplateId);
      return template ? buildWorkoutTemplateSessions(template, current.exerciseTemplates) : [];
    });
  }

  /**
   * "Do I already have a copy of this catalog programme?" — asked of stored
   * data, not of the screen.
   *
   * The caller used to answer this from the rendered `workoutTemplates` array,
   * which is one render behind the database. That was survivable while an edit
   * was a deliberate press every few seconds. It stopped being survivable when
   * the day screen grew a stepper: three quick taps on "+" are three edits
   * inside one render, all three see no copy, and all three make one — which
   * is the copy-accumulation bug back again, from the other end (verified on
   * the emulator 2026-08-27, two "HOME Starter" rows from a single adjustment).
   */
  function findWorkoutTemplateIdBySource(sourceTemplateId: string): Promise<string | null> {
    // The link is the answer where there is one. Where there is not — a
    // copy onboarding made before it wrote the link — the composed week's
    // own day ids say the same thing, so those installs are not left with
    // a programme nothing can find. See lib/programmeCopyLink.
    return runExclusive(async () => {
      const current = databaseRef.current;
      // Running first when there is more than one copy: an install from
      // before the link can hold an onboarding copy and a later fork of the
      // same programme, and the edit belongs to the one being trained.
      const running = current.workoutPlans
        .filter((plan) => current.preferences.activePlanIds.includes(plan.id))
        .map((plan) => plan.entries[0]?.workoutTemplateId)
        .filter((id): id is string => typeof id === 'string');
      return findReadyProgrammeCopyId(sourceTemplateId, current.workoutTemplates, running);
    });
  }

  function editWorkoutTemplateSessions(
    workoutTemplateId: string,
    edit: (sessions: WorkoutTemplateSessionWithExercises[]) => WorkoutTemplateSessionsEdit,
  ): Promise<WorkoutTemplateSessionsEditResult> {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const template = workoutTemplateRepository.findById(current, workoutTemplateId);
      if (!template) {
        return { saved: false, reason: 'templateMissing' as const };
      }

      const outcome = edit(buildWorkoutTemplateSessions(template, current.exerciseTemplates));
      if (outcome.kind === 'skip') {
        return { saved: false, reason: outcome.reason };
      }

      await upsertWorkoutTemplateExclusive({
        id: template.id,
        name: template.name,
        sessions: outcome.sessions,
      });
      return { saved: true };
    });
  }

  function forgetHeldProgramme(workoutTemplateId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      // Stopped first, while the plans still name it — the same order the
      // template delete below uses, for the same reason: a removed plan left
      // in the running set holds a slot against the cap for nothing.
      const stopped = stopProgramme({
        activePlanId: current.preferences.activePlanId,
        activePlanIds: current.preferences.activePlanIds,
        plans: current.workoutPlans,
        templateId: workoutTemplateId,
      });
      const nextDatabase = workoutPlanRepository.removeMany(
        current,
        planIdsHoldingTemplate(current.workoutPlans, workoutTemplateId),
      );
      await commit({
        ...nextDatabase,
        preferences: stopped ? { ...nextDatabase.preferences, ...stopped } : nextDatabase.preferences,
      });
    });
  }

  function deleteWorkoutTemplate(workoutTemplateId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      // A deleted programme stops running first, while its plans still name
      // it. Removing the template empties those plans, and an empty plan left
      // in the running set held a slot against the cap for a programme that no
      // longer existed.
      const stopped = stopProgramme({
        activePlanId: current.preferences.activePlanId,
        activePlanIds: current.preferences.activePlanIds,
        plans: current.workoutPlans,
        templateId: workoutTemplateId,
      });
      const nextDatabase = workoutTemplateRepository.remove(current, workoutTemplateId);
      const preferences = stopped ? { ...nextDatabase.preferences, ...stopped } : nextDatabase.preferences;
      const nextActivePlanId = preferences.activePlanId
        ? workoutPlanRepository.findById(nextDatabase, preferences.activePlanId)?.id ?? null
        : null;

      await commit({
        ...nextDatabase,
        preferences: {
          ...preferences,
          activePlanId: nextActivePlanId,
        },
      });
    });
  }

  function persistCompletedWorkoutSession(input: PersistCompletedWorkoutInput) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const result = persistCompletedWorkoutSessionToDatabase(current, input, createId);

      if (result.didPersist) {
        await commit(result.database);
      }

      return result.wasStored ? { ...result.summary, wasStored: true } : result.summary;
    });
  }

  function updateCompletedWorkoutSession(
    sessionId: string,
    patch: {
      workoutNameSnapshot?: string;
      sessionNotes?: string | null;
      /** The post-workout verdict, written after the save (feel sheet). */
      feel?: SessionFeel | null;
    },
  ) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const nextDatabase = workoutSessionRepository.update(current, sessionId, patch);
      await commit(nextDatabase);
    });
  }

  function teachExerciseName(
    wrote: string,
    exercise: { name: string; libraryItemId: string | null },
  ) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      await commit({
        ...current,
        exerciseNameBook: rememberName(current.exerciseNameBook, wrote, exercise),
      });
    });
  }

  function deleteCompletedWorkoutSession(sessionId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      await commit(workoutSessionRepository.remove(current, sessionId));
    });
  }

  async function saveWorkoutSession(
    workoutTemplateId: string,
    logs: ExerciseLogDraft[],
    startedAt?: string,
  ) {
    const current = databaseRef.current;
    const template = workoutTemplateRepository.findById(current, workoutTemplateId);

    if (!template) {
      return {
        sessionId: null,
        performedAt: null,
        exercisesLogged: 0,
        trackedExercisesUpdated: 0,
        exercisesSwapped: 0,
        notesSaved: 0,
        sessionInsertedExercises: 0,
        entriesSaved: 0,
        setsCompleted: 0,
        totalVolume: 0,
        exercisesCompleted: 0,
        durationMinutes: 0,
      };
    }

    return persistCompletedWorkoutSession({
      sessionId: createId('session'),
      workoutTemplateId,
      workoutNameSnapshot: template.name,
      logs,
      startedAt,
    });
  }

  function addBodyweightEntry(weightKg: number, recordedAt = new Date().toISOString()) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      if (weightKg <= 0) {
        return;
      }

      const entry: BodyweightEntry = {
        id: createId('bodyweight'),
        recordedAt,
        weight: weightKg,
      };

      await commit(bodyweightRepository.append(current, entry));
    });
  }

  function addMeasurementEntry(
    kind: MeasurementKind,
    value: number,
    unit: MeasurementUnit,
    recordedAt = new Date().toISOString(),
  ) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      if (value <= 0) {
        return;
      }

      const entry: MeasurementEntry = {
        id: createId('measurement'),
        kind,
        recordedAt,
        value,
        unit,
      };

      await commit({
        ...current,
        measurementEntries: [...current.measurementEntries, entry].sort(
          (left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
        ),
      });
    });
  }

  /**
   * The three things the reader could enter and then not take back.
   *
   * The app could delete a programme and a logged workout, and nothing else —
   * so a mistyped measurement, a stray weigh-in and a run that was really a
   * walk all became permanent the moment they were saved, and stayed in every
   * chart and every calendar that reads them (#bugs 2026-08-26: "mittaa ei saa
   * poistettua", "sama kalenteri moka", "juoksuja ei voi poistaa mutta treenit
   * voi"). Delete is not a feature here; it is the other half of entry.
   *
   * Same queue as every other write, so a delete cannot race the save that
   * put the entry there.
   */
  function deleteMeasurementEntry(entryId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const next = current.measurementEntries.filter((entry) => entry.id !== entryId);
      if (next.length === current.measurementEntries.length) {
        return;
      }
      await commit({ ...current, measurementEntries: next });
    });
  }

  function deleteBodyweightEntry(entryId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const next = bodyweightRepository.list(current).filter((entry) => entry.id !== entryId);
      if (next.length === bodyweightRepository.list(current).length) {
        return;
      }
      await commit({ ...current, bodyweightEntries: next });
    });
  }

  function deleteCardioSession(sessionId: string) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const sessions = current.cardioSessions ?? [];
      const next = sessions.filter((session) => session.id !== sessionId);
      if (next.length === sessions.length) {
        return;
      }
      await commit({ ...current, cardioSessions: next });
    });
  }

  function saveCardioSession(input: {
    activityType: CardioActivityType;
    startedAt: string;
    endedAt?: string | null;
    durationSec: number;
    distanceKm?: number | null;
    feel?: CardioFeel | null;
  }): Promise<CardioSession> {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const session: CardioSession = {
        id: createId('cardio_session'),
        activityType: input.activityType,
        startedAt: input.startedAt,
        // Dated when the run ended, not when "Complete" was pressed: the
        // finish screen can sit open, or the app sit killed, past midnight.
        performedAt:
          input.endedAt && Number.isFinite(Date.parse(input.endedAt))
            ? input.endedAt
            : new Date().toISOString(),
        durationSec: Math.max(0, Math.round(input.durationSec)),
        distanceKm: input.distanceKm && input.distanceKm > 0 ? input.distanceKm : null,
        feel: input.feel ?? null,
      };

      // A run already stored is this save landing again (its clear was lost and the run came back
      // on relaunch): one run, one row. Landing again as it was, nothing is written; run further
      // before Complete, the stored row takes the longer finish under its own id, and a run is
      // never shortened by it.
      const stored = findSavedCardioRun(current.cardioSessions ?? [], input);
      if (stored) {
        const merged = mergeContinuedCardioRun(stored, session);
        if (merged === stored) {
          return stored;
        }
        await commit({
          ...current,
          cardioSessions: (current.cardioSessions ?? []).map((row) => (row.id === stored.id ? merged : row)),
        });
        return merged;
      }

      await commit({
        ...current,
        cardioSessions: [session, ...(current.cardioSessions ?? [])],
      });
      return session;
    });
  }

  /**
   * Take labels off the coach-log deletes still owed, once the server has
   * confirmed them.
   *
   * Read and written inside the queue rather than as an updatePreferences
   * patch: a retry started before a reset would otherwise write back the list
   * it read, and drop the label that reset had just filed.
   */
  function clearPendingAiLogDeletions(deleted: readonly string[]) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const pending = current.preferences.pendingAiLogDeletions;
      const remaining = withoutAiLogDeletions(pending, deleted);
      if (remaining.length === pending.length) {
        return;
      }
      const next = { ...current, preferences: { ...current.preferences, pendingAiLogDeletions: remaining } };
      databaseRef.current = next;
      setDatabase(next);
      try {
        await savePreferences(next.preferences);
      } catch (error) {
        databaseRef.current = current;
        setDatabase(current);
        throw error;
      }
    });
  }

  /**
   * Retire the coach's label, and file its delete as still owed when the
   * server did not confirm it — in one write, inside the queue.
   *
   * The caller cannot build this patch itself. It has just awaited a delete
   * that may have taken the full request timeout, so the `pendingAiLogDeletions`
   * it read before that await is stale, and `updatePreferences` would lay the
   * old array straight over the current one: a retry that confirmed a label in
   * the meantime would find it back on the list, and a label a reset filed in
   * the meantime would be gone, with its copies left under a name nothing can
   * look up (CI review of #143). Read here, at write time, like the clear
   * beside it.
   *
   * Whose consent counts is read here too, and that is the whole of it. The
   * caller decided "every line is off" before a delete that can take forty
   * seconds, and a line switched back on inside that window does NOT mint a
   * new label — the withdrawal handler mints one only when there is none, and
   * this one is still here until this runs. So the app goes on writing copies
   * under it, and retiring it on the caller's word would file a delete for
   * copies the reader has just said yes to (CI review of #143).
   *
   * Three answers, then:
   * - consent is back on under this very label: nothing. It is in use.
   * - a different label is current: leave it alone, but the copies under the
   *   old one are owed a delete that nothing else will ask for.
   * - every line still off, same label: retire it, owed if the delete failed.
   */
  function retireAiLogLabel(logId: string, owed: boolean) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      const live = current.preferences;
      const consented =
        live.aiLogChatConsent || live.aiLogComposerConsent || live.aiLogPhotoConsent;
      if (consented && live.aiLogId === logId) {
        return false;
      }
      const retiring = live.aiLogId === logId;
      const pending = owed ? withPendingAiLogDeletion(live.pendingAiLogDeletions, logId) : live.pendingAiLogDeletions;
      if (!retiring && pending === live.pendingAiLogDeletions) {
        return false;
      }
      const next = {
        ...current,
        preferences: {
          ...live,
          aiLogId: retiring ? null : live.aiLogId,
          pendingAiLogDeletions: pending,
        },
      };
      databaseRef.current = next;
      setDatabase(next);
      try {
        await savePreferences(next.preferences);
      } catch (error) {
        databaseRef.current = current;
        setDatabase(current);
        throw error;
      }
      return owed;
    });
  }

  function resetAllData() {
    return runExclusive(async () => {
      // The live preferences, not a reload: they carry what this install has
      // been granted, and resetDatabase keeps exactly that.
      const cleared = await resetDatabase(databaseRef.current.preferences);
      databaseRef.current = cleared;
      setDatabase(cleared);
    });
  }

  function importWorkoutHistory(workouts: HevyImportedWorkout[]) {
    return runExclusive(async () => {
      const current = databaseRef.current;
      // Every workout's input, built before touching the database at all —
      // see persistCompletedWorkoutSessionsToDatabase for why one pass and
      // one write replaced a call per workout (a multi-year Hevy history was
      // quadratic and froze the app, #bugs). Duplicate counting, the "already
      // existed" number and every field below are unchanged.
      const inputs: PersistCompletedWorkoutInput[] = workouts.map((workout) => {
        const startedMs = Date.parse(workout.startedAt);
        return {
          sessionId: `hevy_${startedMs}`,
          // Not a template that exists, and does not need to be: ready
          // programme sessions reference ids outside the database too, and
          // every history surface reads the snapshots.
          workoutTemplateId: 'hevy_import',
          workoutTemplateSessionId: null,
          workoutNameSnapshot: workout.name,
          startedAt: workout.startedAt,
          performedAt: workout.endedAt ?? workout.startedAt,
          logs: workout.exercises.map((exercise, orderIndex) => ({
            exerciseTemplateId: null,
            exerciseNameSnapshot: exercise.name,
            weight: Math.max(0, ...exercise.sets.map((set) => set.weightKg)),
            repsPerSet: exercise.sets.map((set) => set.reps),
            sets: exercise.sets.map((set, setIndex) => ({
              orderIndex: setIndex,
              weight: set.weightKg,
              reps: set.reps,
              kind: set.kind,
              outcome: 'completed' as const,
              status: 'completed' as const,
            })),
            // Tracked like a logged lift. Untracked, the whole imported history
            // was missing from Records, the Progress rows and target rows,
            // while the finish screen's record check did count it — so the two
            // disagreed about what the reader's best was.
            tracked: true,
            orderIndex,
          })),
        };
      });

      const result = persistCompletedWorkoutSessionsToDatabase(current, inputs, createId);
      if (result.imported > 0) {
        await commit(result.database);
      }
      return { imported: result.imported, duplicates: result.duplicates };
    });
  }

  function restoreDatabaseFromBackup(input: Partial<AppDatabase>, options: { rollback?: boolean } = {}) {
    return runExclusive(async () => {
      if (options.rollback) {
        // The phone's own database from before a restore that failed, put
        // back as it was. Through the merge below, its privacy answers and
        // terms acceptance were merged a second time with the ones the
        // failed restore had just written.
        const exact = input as AppDatabase;
        await commit(exact);
        return exact;
      }
      const restored = normalizeDatabase(input);
      // Pro is not restored: the server stores whatever a signed-in caller
      // uploads, so a backup with a far-off promo date was a permanent Pro for
      // the price of one PUT (security review, 2026-09-14). The device keeps
      // what it had, and its own privacy answers; the lead programme is
      // counted in the running set as a load counts it. commit writes the
      // preferences key too: the split-key would otherwise override the
      // restored preferences on the next load.
      // A backup from before rhythms moved onto the programme carries the old
      // app-wide one; it goes onto the lead the way a load moves it.
      const next: AppDatabase = moveTrainingCycleToLeadPlan({
        ...restored,
        preferences: preferencesForRestore(restored.preferences, databaseRef.current.preferences, restored.workoutPlans),
      });
      await commit(next);
      return next;
    });
  }

  // Keyed on the log list alone, so a preference toggle does not rebuild it.
  const sessionLogIndex = useMemo(() => groupLogsBySession(database.exerciseLogs), [database.exerciseLogs]);

  const value = useMemo<AppContextValue>(
    () => ({
      database,
      hydrated,
      preferences: database.preferences,
      unitPreference: database.preferences.unitPreference,
      workoutTemplates: workoutTemplateRepository.list(database),
      workoutPlans: workoutPlanRepository.list(database),
      exerciseLibrary: database.exerciseLibrary,
      workoutSessions: workoutSessionRepository.list(database),
      cardioSessions: database.cardioSessions ?? [],
      bodyweightEntries: bodyweightRepository.list(database),
      measurementEntries: database.measurementEntries,
      exerciseNameBook: database.exerciseNameBook,
      trackedProgress: getTrackedExerciseProgress(database),
      bodyweightProgress: getBodyweightProgress(database),
      getWorkoutExercises(workoutTemplateId: string) {
        return exerciseTemplateRepository.listByWorkoutTemplateId(database, workoutTemplateId);
      },
      getWorkoutTemplateSessions(workoutTemplateId: string) {
        const template = workoutTemplateRepository.findById(database, workoutTemplateId);
        if (!template) {
          return [];
        }

        return buildWorkoutTemplateSessions(template, database.exerciseTemplates);
      },
      getWorkoutLastCompletedAt(workoutTemplateId: string) {
        return workoutSessionRepository
          .list(database)
          .find((session) => session.workoutTemplateId === workoutTemplateId)?.performedAt;
      },
      getLatestTemplateLog(exerciseTemplateId: string) {
        return getLatestLogForTemplateExercise(database, exerciseTemplateId);
      },
      getSessionLogs(sessionId: string) {
        return logsOfSession(sessionLogIndex, sessionId);
      },
      setUnitPreference,
      updatePreferences,
      completeOnboarding,
      programSlots: resolveProgramSlots(
        countAuthoredPrograms(database.workoutTemplates),
        isProUnlocked(database.preferences),
      ),
      upsertWorkoutTemplate,
      upsertWorkoutPlan,
      setPlanTrainingCycle,
      forgetHeldProgramme,
      saveOnboardingResult,
      renameWorkoutTemplate,
      editWorkoutTemplateSessions,
      findWorkoutTemplateIdBySource,
      getWorkoutTemplateSessionsFresh,
      deleteWorkoutTemplate,
      saveWorkoutSession,
      saveCompletedWorkoutSession: persistCompletedWorkoutSession,
      getDatabase: () => databaseRef.current,
      updateCompletedWorkoutSession,
      deleteCompletedWorkoutSession,
      deleteMeasurementEntry,
      deleteBodyweightEntry,
      deleteCardioSession,
      saveCardioSession,
      addBodyweightEntry,
      teachExerciseName,
      addMeasurementEntry,
      resetAllData,
      clearPendingAiLogDeletions,
      retireAiLogLabel,
      restoreDatabaseFromBackup,
      importWorkoutHistory,
    }),
    [database, hydrated],
  );

  if (loadFailed) {
    return (
      <StorageLoadFailedScreen
        onRetry={() => {
          setLoadFailed(false);
          setLoadAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }

  return context;
}
