import type { TourSurface } from '../lib/firstRunTour';
import {
  AppDatabase,
  AppLanguage,
  ExerciseLibraryItem,
  SetupCautionFlag,
  SetupFocusArea,
  SetupGoal,
  SetupSecondaryOutcome,
  WorkoutPlan,
} from '../types/models';
import { OwnBlockStats } from '../lib/ownBlockHistory';
import { GENERATED_EXERCISE_LIBRARY } from './generatedExerciseLibrary';
import { EXTRA_EXERCISE_LIBRARY } from './extraExerciseLibrary';
import { withLibraryCorrections } from '../lib/exerciseClassification';

const DEFAULT_PREFERENCES = {
  // 'en' is the STRUCTURAL fallback, not the answer. A first install resolves
  // the language from the device — see storage/deviceLocale — and passes it to
  // createEmptyDatabase. Tests and fixtures call that with no argument and get
  // this, which is what keeps their expectations stable.
  appLanguage: 'en' as const,
  unitPreference: 'kg' as const,
  defaultRestSeconds: 120,
  autoFocusNextInput: true,
  keepScreenAwakeDuringWorkout: true,
  soundCuesEnabled: true,
  darkThemeEnabled: false,
  usageStatisticsEnabled: true,
  hapticsEnabled: true,
  ownBlockStats: {} as OwnBlockStats,
  homeStatCardKeys: null as string[] | null,
  notificationPrefs: {
    pushEnabled: false,
    level: 'normal' as const,
    personalRecords: true,
    weeklySummary: true,
    comebackNudge: true,
    sessionReminders: false,
    reminderTime: '17:30',
    weighInReminder: false,
    measurementReminderKind: null as Exclude<import('../types/models').MeasurementKind, 'bodyfat'> | null,
    measurementReminderDay: 'sun' as const,
    restAlerts: true,
    restWarning: true,
    sessionOngoing: true,
    idleNudge: true,
    restAlertsAsked: false,
  },
  trainingBreak: null as import('../types/models').TrainingBreak | null,
  legalAcceptance: null as import('../lib/legalAcceptance').LegalAcceptance | null,
  restDayStarts: [] as number[],
  lightNextSession: null as import('../lib/recoverySheet').LightNextSession | null,
  aiLogId: null as string | null,
  aiLogChatConsent: false,
  aiLogComposerConsent: false,
  aiLogPhotoConsent: false,
  pendingAiLogDeletions: [] as string[],
  promoProUntil: null as string | null,
  proTrialUntil: null as string | null,
  proTrialStartedAt: null as string | null,
  // Demo-build only; see AppPreferences. Yearly is the paywall's own default,
  // so the management screen opens describing the package most readers pick.
  mockSubscriptionTerm: 'yearly' as import('../lib/subscriptionView').SubscriptionTermKey,
  mockSubscriptionCancelledAt: null as string | null,
  mockSubscriptionPurchasedAt: null as string | null,
  cancelSurveyAnswer: null as import('../lib/cancelSurvey').CancelSurveyAnswer | null,
  featureVotedIds: [] as string[],
  aiCoachProQuota: null as { monthStart: string; used: number } | null,
  firstLaunchAt: null as string | null,
  coachDemoMomentsUsed: [] as string[],
  seenServerNoticeIds: [] as string[],
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
  firstRunToursSeen: [] as TourSurface[],
  firstRunToursReplayed: false,
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
  setupEquipmentItems: [] as string[],
  setupGoal: null,
  setupGoals: [] as SetupGoal[],
  setupLevel: null,
  setupDaysPerWeek: null,
  setupEquipment: null,
  setupTrainingEnvironment: null,
  setupSecondaryOutcomes: [] as SetupSecondaryOutcome[],
  setupFocusAreas: [] as SetupFocusArea[],
  setupCautionFlags: [] as SetupCautionFlag[],
  setupGuidanceMode: null,
  setupScheduleMode: null,
  setupWeeklyMinutes: null,
  setupAvailableDays: [],
  trainingCycle: null,
  ratingPrompt: { lastAskedAt: null, askCount: 0, rated: false },
  todaySession: null,
  setupTrainingFeel: 'challenging' as const,
  setupWorkoutVariety: 'balanced' as const,
  setupFreeWeightsPreference: 'neutral' as const,
  setupBodyweightPreference: 'neutral' as const,
  setupMachinesPreference: 'neutral' as const,
  setupShoulderFriendlySwaps: 'neutral' as const,
  setupElbowFriendlySwaps: 'neutral' as const,
  setupKneeFriendlySwaps: 'neutral' as const,
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
  lastInsightSessionId: null,
  lastInsightType: null,
  recommendedProgramId: null,
  learnedExerciseLibraryItemIds: [] as string[],
  exerciseTechniqueChecks: {} as Record<string, number[]>,
  dismissedTipIds: [] as string[],
  dismissedCompletionPlanIds: [] as string[],
  dismissedCardSuggestionKeys: [] as string[],
  dismissedPlateauEpisodes: [] as string[],
  activePlanId: 'plan_push_pull_legs',
  activePlanIds: ['plan_push_pull_legs'],
  programsTabEnabled: true,
  strengthGoals: [],
  seasonEnrolments: [],
  routineDrillOverrides: {} as Record<string, string>,
  readerSessionNames: {} as Record<string, string>,
};

/*
 * The twenty hand-written `lib_*` rows are gone (2026-09-01).
 *
 * They predated the generated library and every one was a second copy of a row
 * it already has, carrying a FINNISH name in the field that is an English id
 * everywhere else. Their Finnish names were never lost by removing them:
 * `EXERCISE_NAME_FI` already answers "Takakyykky" for `Barbell Squat`.
 *
 * They were also actively harmful. `lib_rdl` shipped as "Romanian Deadlift"
 * until someone noticed the case-insensitive matcher was resolving four ready
 * programmes' RDL to a row with no instructions instead of to the generated
 * entry — and the fix at the time was to rename that row to Finnish, which
 * hid the class rather than ending it.
 *
 * A stored id from an old install is remapped on load — see
 * lib/legacyLibraryIds, which carries the evidence that nothing else reached
 * them and the table that keeps those logs linked.
 */

export function createSeedExerciseLibrary(): ExerciseLibraryItem[] {
  // The extras last: they exist because the generated library lacks them, so
  // they can never shadow it, and `exercise:sync` cannot wipe them.
  // The source's muscle errors are corrected here, once, so every chip and
  // card reads the same muscles (lib/exerciseClassification).
  return withLibraryCorrections([...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]);
}

function sessionRecord(id: string, name: string, orderIndex: number, exerciseIds: string[]) {
  return { id, name, orderIndex, exerciseIds };
}

function createSeedWorkoutPlans(): WorkoutPlan[] {
  return [
    {
      id: 'plan_push_pull_legs',
      name: 'Push / Pull / Legs',
      mode: 'weekday',
      isActive: true,
      createdAt: '2026-02-27T08:00:00+02:00',
      updatedAt: '2026-03-15T08:00:00+02:00',
      entries: [
        { id: 'plan_entry_push', workoutTemplateId: 'workout_push', label: 'Monday', orderIndex: 0 },
        { id: 'plan_entry_upper', workoutTemplateId: 'workout_upper', label: 'Wednesday', orderIndex: 1 },
        { id: 'plan_entry_lower', workoutTemplateId: 'workout_lower', label: 'Friday', orderIndex: 2 },
      ],
    },
  ];
}

export function createEmptyDatabase(appLanguage: AppLanguage = DEFAULT_PREFERENCES.appLanguage): AppDatabase {
  return {
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    exerciseLibrary: createSeedExerciseLibrary(),
    workoutSessions: [],
    cardioSessions: [],
    exerciseLogs: [],
    bodyweightEntries: [],
    measurementEntries: [],
    exerciseNameBook: [],
    preferences: {
      ...DEFAULT_PREFERENCES,
      // The argument, actually used. Spreading DEFAULT_PREFERENCES after it
      // would put 'en' back — which is precisely what this function did on the
      // first attempt: it took the language and ignored it.
      appLanguage,
      // Nothing runs, because nothing is here: DEFAULT_PREFERENCES is the demo
      // seed's, and its running set names the seed's plan. Only the lead was
      // cleared, so every new install ran a programme it did not have — one of
      // the two free slots gone before the reader chose anything, and the cap
      // sheet at their first ready programme after onboarding (2026-09-21).
      activePlanId: null,
      activePlanIds: [],
    },
  };
}

/**
 * Demo fixture — invented sessions, logs and bodyweight entries.
 *
 * NEVER hand this to a real install. It exists for tests and for demoing a
 * populated app; loadDatabase() starts a first launch from
 * createEmptyDatabase() so nobody sees records they did not lift.
 */
export function createSeedDatabase(): AppDatabase {
  const upperSessionId = 'workout_upper_session_1';
  const lowerSessionId = 'workout_lower_session_1';
  const pushSessionId = 'workout_push_session_1';

  return {
    workoutTemplates: [
      {
        id: 'workout_upper',
        name: 'Yläkroppa',
        exerciseIds: [
          'exercise_upper_bench',
          'exercise_upper_row',
          'exercise_upper_ohp',
          'exercise_upper_curl',
        ],
        sessions: [
          sessionRecord(upperSessionId, 'Yläkroppa', 0, [
            'exercise_upper_bench',
            'exercise_upper_row',
            'exercise_upper_ohp',
            'exercise_upper_curl',
          ]),
        ],
        createdAt: '2026-02-25T18:00:00+02:00',
        updatedAt: '2026-03-15T18:20:00+02:00',
        origin: 'authored' as const,
      },
      {
        id: 'workout_lower',
        name: 'Alakroppa',
        exerciseIds: [
          'exercise_lower_squat',
          'exercise_lower_rdl',
          'exercise_lower_extension',
          'exercise_lower_calves',
        ],
        sessions: [
          sessionRecord(lowerSessionId, 'Alakroppa', 0, [
            'exercise_lower_squat',
            'exercise_lower_rdl',
            'exercise_lower_extension',
            'exercise_lower_calves',
          ]),
        ],
        createdAt: '2026-02-25T18:00:00+02:00',
        updatedAt: '2026-03-11T18:25:00+02:00',
        origin: 'authored' as const,
      },
      {
        id: 'workout_push',
        name: 'Push',
        exerciseIds: [
          'exercise_push_incline',
          'exercise_push_ohp',
          'exercise_push_dips',
          'exercise_push_triceps',
        ],
        sessions: [
          sessionRecord(pushSessionId, 'Push', 0, [
            'exercise_push_incline',
            'exercise_push_ohp',
            'exercise_push_dips',
            'exercise_push_triceps',
          ]),
        ],
        createdAt: '2026-02-27T18:00:00+02:00',
        updatedAt: '2026-03-13T18:18:00+02:00',
        origin: 'authored' as const,
      },
    ],
    exerciseTemplates: [
      {
        id: 'exercise_upper_bench',
        workoutTemplateId: 'workout_upper',
        workoutTemplateSessionId: upperSessionId,
        name: 'Penkki',
        targetSets: 3,
        repMin: 6,
        repMax: 8,
        restSeconds: 150,
        trackedDefault: true,
        orderIndex: 0,
        libraryItemId: 'lib_bench_press',
      },
      {
        id: 'exercise_upper_row',
        workoutTemplateId: 'workout_upper',
        workoutTemplateSessionId: upperSessionId,
        name: 'Kulmasoutu',
        targetSets: 3,
        repMin: 8,
        repMax: 10,
        restSeconds: 120,
        trackedDefault: true,
        orderIndex: 1,
        libraryItemId: 'lib_barbell_row',
      },
      {
        id: 'exercise_upper_ohp',
        workoutTemplateId: 'workout_upper',
        workoutTemplateSessionId: upperSessionId,
        name: 'Pystypunnerrus',
        targetSets: 3,
        repMin: 6,
        repMax: 8,
        restSeconds: 120,
        trackedDefault: true,
        orderIndex: 2,
        libraryItemId: 'lib_ohp',
      },
      {
        id: 'exercise_upper_curl',
        workoutTemplateId: 'workout_upper',
        workoutTemplateSessionId: upperSessionId,
        name: 'Hauiskääntö',
        targetSets: 2,
        repMin: 10,
        repMax: 12,
        restSeconds: 75,
        trackedDefault: false,
        orderIndex: 3,
        libraryItemId: 'lib_biceps_curl',
      },
      {
        id: 'exercise_lower_squat',
        workoutTemplateId: 'workout_lower',
        workoutTemplateSessionId: lowerSessionId,
        name: 'Takakyykky',
        targetSets: 3,
        repMin: 6,
        repMax: 8,
        restSeconds: 180,
        trackedDefault: true,
        orderIndex: 0,
        libraryItemId: 'lib_back_squat',
      },
      {
        id: 'exercise_lower_rdl',
        workoutTemplateId: 'workout_lower',
        workoutTemplateSessionId: lowerSessionId,
        name: 'Romanian deadlift',
        targetSets: 3,
        repMin: 8,
        repMax: 10,
        restSeconds: 150,
        trackedDefault: true,
        orderIndex: 1,
        libraryItemId: 'lib_rdl',
      },
      {
        id: 'exercise_lower_extension',
        workoutTemplateId: 'workout_lower',
        workoutTemplateSessionId: lowerSessionId,
        name: 'Reiden ojennus',
        targetSets: 3,
        repMin: 12,
        repMax: 15,
        restSeconds: 75,
        trackedDefault: false,
        orderIndex: 2,
        libraryItemId: 'lib_leg_extension',
      },
      {
        id: 'exercise_lower_calves',
        workoutTemplateId: 'workout_lower',
        workoutTemplateSessionId: lowerSessionId,
        name: 'Pohkeet',
        targetSets: 3,
        repMin: 12,
        repMax: 15,
        restSeconds: 60,
        trackedDefault: false,
        orderIndex: 3,
        libraryItemId: 'lib_calf_raise',
      },
      {
        id: 'exercise_push_incline',
        workoutTemplateId: 'workout_push',
        workoutTemplateSessionId: pushSessionId,
        name: 'Vinopenkki',
        targetSets: 3,
        repMin: 8,
        repMax: 10,
        restSeconds: 120,
        trackedDefault: true,
        orderIndex: 0,
        libraryItemId: 'lib_incline_bench',
      },
      {
        id: 'exercise_push_ohp',
        workoutTemplateId: 'workout_push',
        workoutTemplateSessionId: pushSessionId,
        name: 'Pystypunnerrus',
        targetSets: 3,
        repMin: 6,
        repMax: 8,
        restSeconds: 120,
        trackedDefault: true,
        orderIndex: 1,
        libraryItemId: 'lib_ohp',
      },
      {
        id: 'exercise_push_dips',
        workoutTemplateId: 'workout_push',
        workoutTemplateSessionId: pushSessionId,
        name: 'Dipit',
        targetSets: 3,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
        trackedDefault: true,
        orderIndex: 2,
        libraryItemId: 'lib_dips',
      },
      {
        id: 'exercise_push_triceps',
        workoutTemplateId: 'workout_push',
        workoutTemplateSessionId: pushSessionId,
        name: 'Ojentajapunnerrus',
        targetSets: 3,
        repMin: 10,
        repMax: 12,
        restSeconds: 75,
        trackedDefault: false,
        orderIndex: 3,
        libraryItemId: 'lib_triceps_pushdown',
      },
    ],
    workoutPlans: createSeedWorkoutPlans(),
    exerciseLibrary: createSeedExerciseLibrary(),
    workoutSessions: [
      { id: 'session_upper_1', workoutTemplateId: 'workout_upper', workoutNameSnapshot: 'Yläkroppa', performedAt: '2026-03-02T18:10:00+02:00' },
      { id: 'session_lower_1', workoutTemplateId: 'workout_lower', workoutNameSnapshot: 'Alakroppa', performedAt: '2026-03-04T18:20:00+02:00' },
      { id: 'session_upper_2', workoutTemplateId: 'workout_upper', workoutNameSnapshot: 'Yläkroppa', performedAt: '2026-03-09T18:05:00+02:00' },
      { id: 'session_lower_2', workoutTemplateId: 'workout_lower', workoutNameSnapshot: 'Alakroppa', performedAt: '2026-03-11T18:15:00+02:00' },
      { id: 'session_push_1', workoutTemplateId: 'workout_push', workoutNameSnapshot: 'Push', performedAt: '2026-03-13T18:12:00+02:00' },
      { id: 'session_upper_3', workoutTemplateId: 'workout_upper', workoutNameSnapshot: 'Yläkroppa', performedAt: '2026-03-15T18:18:00+02:00' },
    ],
    cardioSessions: [],
    exerciseLogs: [
      { id: 'log_upper_1_bench', sessionId: 'session_upper_1', exerciseTemplateId: 'exercise_upper_bench', exerciseNameSnapshot: 'Penkki', weight: 80, repsPerSet: [8, 8, 7], tracked: true, orderIndex: 0 },
      { id: 'log_upper_1_row', sessionId: 'session_upper_1', exerciseTemplateId: 'exercise_upper_row', exerciseNameSnapshot: 'Kulmasoutu', weight: 70, repsPerSet: [10, 10, 9], tracked: true, orderIndex: 1 },
      { id: 'log_upper_1_ohp', sessionId: 'session_upper_1', exerciseTemplateId: 'exercise_upper_ohp', exerciseNameSnapshot: 'Pystypunnerrus', weight: 45, repsPerSet: [8, 7, 7], tracked: true, orderIndex: 2 },
      { id: 'log_upper_1_curl', sessionId: 'session_upper_1', exerciseTemplateId: 'exercise_upper_curl', exerciseNameSnapshot: 'Hauiskääntö', weight: 15, repsPerSet: [12, 12], tracked: false, orderIndex: 3 },
      { id: 'log_lower_1_squat', sessionId: 'session_lower_1', exerciseTemplateId: 'exercise_lower_squat', exerciseNameSnapshot: 'Takakyykky', weight: 100, repsPerSet: [8, 8, 7], tracked: true, orderIndex: 0 },
      { id: 'log_lower_1_rdl', sessionId: 'session_lower_1', exerciseTemplateId: 'exercise_lower_rdl', exerciseNameSnapshot: 'Romanian deadlift', weight: 90, repsPerSet: [10, 9, 8], tracked: true, orderIndex: 1 },
      { id: 'log_lower_1_extension', sessionId: 'session_lower_1', exerciseTemplateId: 'exercise_lower_extension', exerciseNameSnapshot: 'Reiden ojennus', weight: 45, repsPerSet: [15, 14, 12], tracked: false, orderIndex: 2 },
      { id: 'log_lower_1_calves', sessionId: 'session_lower_1', exerciseTemplateId: 'exercise_lower_calves', exerciseNameSnapshot: 'Pohkeet', weight: 60, repsPerSet: [15, 15, 14], tracked: false, orderIndex: 3 },
      { id: 'log_upper_2_bench', sessionId: 'session_upper_2', exerciseTemplateId: 'exercise_upper_bench', exerciseNameSnapshot: 'Penkki', weight: 82.5, repsPerSet: [8, 7, 7], tracked: true, orderIndex: 0 },
      { id: 'log_upper_2_row', sessionId: 'session_upper_2', exerciseTemplateId: 'exercise_upper_row', exerciseNameSnapshot: 'Kulmasoutu', weight: 72.5, repsPerSet: [10, 9, 9], tracked: true, orderIndex: 1 },
      { id: 'log_upper_2_ohp', sessionId: 'session_upper_2', exerciseTemplateId: 'exercise_upper_ohp', exerciseNameSnapshot: 'Pystypunnerrus', weight: 47.5, repsPerSet: [7, 7, 6], tracked: true, orderIndex: 2 },
      { id: 'log_upper_2_curl', sessionId: 'session_upper_2', exerciseTemplateId: 'exercise_upper_curl', exerciseNameSnapshot: 'Hauiskääntö', weight: 16, repsPerSet: [12, 11], tracked: false, orderIndex: 3 },
      { id: 'log_lower_2_squat', sessionId: 'session_lower_2', exerciseTemplateId: 'exercise_lower_squat', exerciseNameSnapshot: 'Takakyykky', weight: 105, repsPerSet: [7, 7, 6], tracked: true, orderIndex: 0 },
      { id: 'log_lower_2_rdl', sessionId: 'session_lower_2', exerciseTemplateId: 'exercise_lower_rdl', exerciseNameSnapshot: 'Romanian deadlift', weight: 95, repsPerSet: [9, 8, 8], tracked: true, orderIndex: 1 },
      { id: 'log_lower_2_extension', sessionId: 'session_lower_2', exerciseTemplateId: 'exercise_lower_extension', exerciseNameSnapshot: 'Reiden ojennus', weight: 47.5, repsPerSet: [15, 13, 12], tracked: false, orderIndex: 2 },
      { id: 'log_lower_2_calves', sessionId: 'session_lower_2', exerciseTemplateId: 'exercise_lower_calves', exerciseNameSnapshot: 'Pohkeet', weight: 62.5, repsPerSet: [15, 15, 15], tracked: false, orderIndex: 3 },
      { id: 'log_push_1_incline', sessionId: 'session_push_1', exerciseTemplateId: 'exercise_push_incline', exerciseNameSnapshot: 'Vinopenkki', weight: 65, repsPerSet: [10, 9, 8], tracked: true, orderIndex: 0 },
      { id: 'log_push_1_ohp', sessionId: 'session_push_1', exerciseTemplateId: 'exercise_push_ohp', exerciseNameSnapshot: 'Pystypunnerrus', weight: 47.5, repsPerSet: [7, 6, 6], tracked: true, orderIndex: 1 },
      { id: 'log_push_1_dips', sessionId: 'session_push_1', exerciseTemplateId: 'exercise_push_dips', exerciseNameSnapshot: 'Dipit', weight: 10, repsPerSet: [10, 9, 8], tracked: true, orderIndex: 2 },
      { id: 'log_push_1_triceps', sessionId: 'session_push_1', exerciseTemplateId: 'exercise_push_triceps', exerciseNameSnapshot: 'Ojentajapunnerrus', weight: 30, repsPerSet: [12, 12, 11], tracked: false, orderIndex: 3 },
      { id: 'log_upper_3_bench', sessionId: 'session_upper_3', exerciseTemplateId: 'exercise_upper_bench', exerciseNameSnapshot: 'Penkki', weight: 85, repsPerSet: [7, 7, 6], tracked: true, orderIndex: 0 },
      { id: 'log_upper_3_row', sessionId: 'session_upper_3', exerciseTemplateId: 'exercise_upper_row', exerciseNameSnapshot: 'Kulmasoutu', weight: 75, repsPerSet: [9, 8, 8], tracked: true, orderIndex: 1 },
      { id: 'log_upper_3_ohp', sessionId: 'session_upper_3', exerciseTemplateId: 'exercise_upper_ohp', exerciseNameSnapshot: 'Pystypunnerrus', weight: 50, repsPerSet: [6, 6, 6], tracked: true, orderIndex: 2 },
      { id: 'log_upper_3_curl', sessionId: 'session_upper_3', exerciseTemplateId: 'exercise_upper_curl', exerciseNameSnapshot: 'Hauiskääntö', weight: 16, repsPerSet: [12, 12], tracked: false, orderIndex: 3 },
    ],
    bodyweightEntries: [
      { id: 'bodyweight_1', recordedAt: '2026-03-01T08:10:00+02:00', weight: 82.4 },
      { id: 'bodyweight_2', recordedAt: '2026-03-08T08:05:00+02:00', weight: 82.1 },
      { id: 'bodyweight_3', recordedAt: '2026-03-15T08:08:00+02:00', weight: 81.8 },
    ],
    measurementEntries: [],
    exerciseNameBook: [],
    preferences: DEFAULT_PREFERENCES,
  };
}
