import { ONBOARDING_PLAN_PREFIX } from '../lib/activeProgramSet';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import {
  buildFirstRunCustomProgramName,
  DEFAULT_FIRST_RUN_SELECTION,
  DEFAULT_RHYTHM_BY_DAYS,
  FirstRunSetupSelection,
} from '../lib/firstRunSetup';
import { composeProgramWeekForSelection } from '../lib/programDayComposer';
import { resolveCycleAnchor } from '../lib/trainingSchedule';
import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import { WorkoutRuntimeTemplate } from '../features/workout/workoutTypes';
import {
  AppLanguage,
  AppPreferences,
  SetupEquipment,
  SetupTrainingEnvironment,
  TrainingCycle,
  WorkoutTemplateDraft,
} from '../types/models';

/**
 * How a finished questionnaire becomes preferences, a saved programme and a
 * plan — and how stored preferences become a questionnaire again when the
 * reader re-opens setup. Moved out of App.tsx in the phase-A split
 * (2026-08-26): these are pure builders, not wiring.
 */

function getDefaultTrainingEnvironment(equipment: SetupEquipment): SetupTrainingEnvironment {
  switch (equipment) {
    case 'gym':
      return 'full_gym';
    case 'home':
      return 'home_gym';
    case 'minimal':
    default:
      return 'minimal_equipment';
  }
}

/**
 * What the reader has told the app about themselves, whether or not they ever
 * answered the questionnaire.
 *
 * A reader who started empty or picked from the catalogue has no answers —
 * `setupCompleted` is false — but can still have a weight, a height, a rhythm
 * and limitations, entered in My Data or on the plan screen. Setup opened for
 * them from the questionnaire's defaults, and finishing it wrote those
 * defaults over all of it: gender "unspecified", 19–25, no height, no weight,
 * no cycle (2026-09-17). These are the fields the questionnaire carries
 * through without asking, so they are seeded from what is stored — and a
 * missing age band stays missing rather than becoming 19–25.
 *
 * The week is here for the same reason the rhythm is. Profile's weekday picker
 * and dragging a day on the plan screen both write `setupAvailableDays`,
 * `setupDaysPerWeek` and `setupScheduleMode` without finishing setup, so a
 * reader who never answered the questions can still have named their training
 * days — and seeding only the cycle left the other half of the same week to be
 * overwritten by the defaults on the next re-run (review of this change).
 *
 * The weight is the newest weigh-in when there is one. `setupCurrentWeightKg`
 * is what the questionnaire was last told, and nothing else writes it — My
 * Data shows the log instead (audit 7, 2026-09-26) — so a re-run seeded from
 * it opened on a months-old number and read a goal weight against it.
 */
export function buildSetupBasicsFromPreferences(
  preferences: AppPreferences,
  latestWeighInKg: number | null = null,
  // The lead programme's rhythm (WorkoutPlan.trainingCycle): the one the
  // questionnaire last set, and the one the reader's calendar follows.
  leadCycle: TrainingCycle | null = null,
): Partial<FirstRunSetupSelection> {
  return {
    gender: preferences.setupGender ?? DEFAULT_FIRST_RUN_SELECTION.gender,
    age: preferences.setupAge,
    ageRange: preferences.setupAgeRange ?? undefined,
    heightCm: preferences.setupHeightCm,
    currentWeightKg: latestWeighInKg ?? preferences.setupCurrentWeightKg,
    targetWeightKg: preferences.bodyweightGoalKg,
    daysPerWeek: preferences.setupDaysPerWeek ?? DEFAULT_FIRST_RUN_SELECTION.daysPerWeek,
    scheduleMode: preferences.setupScheduleMode ?? DEFAULT_FIRST_RUN_SELECTION.scheduleMode,
    availableDays:
      preferences.setupAvailableDays.length > 0
        ? preferences.setupAvailableDays
        : DEFAULT_FIRST_RUN_SELECTION.availableDays,
    trainingCyclePattern: leadCycle?.pattern ?? null,
    automatedProgression: preferences.automatedProgressionEnabled,
    cautionFlags: preferences.setupCautionFlags,
  };
}

/**
 * Every preference the two builders above and below read — the memo key the
 * shell rebuilds the setup selection on — and the lead programme's rhythm,
 * which they are handed beside the preferences.
 *
 * The key used to be a hand-kept list beside the memo, and it had dropped the
 * rhythm: a rhythm set or removed on the plan screen left setup seeded with
 * the old one, and the next run of the questions wrote the old one back
 * (2026-09-17). A test reads which fields the builders touch and holds this
 * list to them.
 */
const SETUP_SEED_PREFERENCE_KEYS = [
  'automatedProgressionEnabled',
  'bodyweightGoalKg',
  'profileName',
  'setupAge',
  'setupAgeRange',
  'setupAvailableDays',
  'setupCautionFlags',
  'setupCompleted',
  'setupCurrentWeightKg',
  'setupDaysPerWeek',
  'setupEquipment',
  'setupEquipmentItems',
  'setupFocusAreas',
  'setupGender',
  'setupGoal',
  'setupGoals',
  'setupGuidanceMode',
  'setupHeightCm',
  'setupLevel',
  'setupScheduleMode',
  'setupSecondaryOutcomes',
  'setupTrainingEnvironment',
  'setupWeeklyMinutes',
  'unitPreference',
] as const satisfies readonly (keyof AppPreferences)[];

export function buildSetupSeedKey(preferences: AppPreferences, leadCycle: TrainingCycle | null = null): string {
  return JSON.stringify([...SETUP_SEED_PREFERENCE_KEYS.map((key) => preferences[key]), leadCycle]);
}

export function buildSetupSelectionFromPreferences(
  preferences: AppPreferences,
  latestWeighInKg: number | null = null,
  leadCycle: TrainingCycle | null = null,
): FirstRunSetupSelection | null {
  if (
    !preferences.setupCompleted ||
    !preferences.setupGoal ||
    !preferences.setupDaysPerWeek ||
    !preferences.setupEquipment
  ) {
    return null;
  }

  const basics = buildSetupBasicsFromPreferences(preferences, latestWeighInKg, leadCycle);

  return {
    ...basics,
    profileName: preferences.profileName,
    // Required here, optional in the basics — so these four say again what the
    // basics already worked out, rather than working it out a second time and
    // drifting from it.
    gender: basics.gender ?? DEFAULT_FIRST_RUN_SELECTION.gender,
    daysPerWeek: basics.daysPerWeek ?? DEFAULT_FIRST_RUN_SELECTION.daysPerWeek,
    scheduleMode: basics.scheduleMode ?? DEFAULT_FIRST_RUN_SELECTION.scheduleMode,
    availableDays: basics.availableDays ?? DEFAULT_FIRST_RUN_SELECTION.availableDays,
    goal: preferences.setupGoal,
    goals:
      preferences.setupGoals.length > 0
        ? preferences.setupGoals
        : [preferences.setupGoal],
    level: preferences.setupLevel ?? DEFAULT_FIRST_RUN_SELECTION.level,
    equipment: preferences.setupEquipment,
    trainingEnvironment:
      preferences.setupTrainingEnvironment ?? getDefaultTrainingEnvironment(preferences.setupEquipment),
    equipmentItems: preferences.setupEquipmentItems,
    secondaryOutcomes:
      preferences.setupSecondaryOutcomes.length > 0
        ? preferences.setupSecondaryOutcomes
        : DEFAULT_FIRST_RUN_SELECTION.secondaryOutcomes,
    focusAreas: preferences.setupFocusAreas.length > 0 ? preferences.setupFocusAreas : DEFAULT_FIRST_RUN_SELECTION.focusAreas,
    guidanceMode: preferences.setupGuidanceMode ?? DEFAULT_FIRST_RUN_SELECTION.guidanceMode,
    weeklyMinutes: preferences.setupWeeklyMinutes,
    unitPreference: preferences.unitPreference,
  };
}

export function buildSetupPreferencePatch(
  selection: FirstRunSetupSelection,
  recommendedProgramId: string | null,
): Partial<AppPreferences> {
  // No rhythm here: it goes on the programme the questions build
  // (buildSavedOnboardingWorkoutPlan), not on every programme the reader has.
  return {
    onboardingCompleted: true,
    setupCompleted: true,
    // Only a name the questionnaire carries is written. It has not asked for
    // one since 2026-09-09, so a re-run whose seed had none wrote null over
    // the reader's own name — and over the account's, which is taken once and
    // not again (2026-09-16).
    ...(selection.profileName?.trim() ? { profileName: selection.profileName.trim().slice(0, 32) } : {}),
    setupGender: selection.gender,
    setupAge: selection.age ?? null,
    setupAgeRange: selection.ageRange ?? null,
    setupHeightCm: selection.heightCm ?? null,
    setupGoal: selection.goal,
    setupGoals: selection.goals?.length ? selection.goals : [selection.goal],
    setupLevel: selection.level,
    setupDaysPerWeek: selection.daysPerWeek,
    setupEquipment: selection.equipment,
    setupTrainingEnvironment: selection.trainingEnvironment,
    setupEquipmentItems: selection.equipmentItems ?? [],
    setupSecondaryOutcomes: selection.secondaryOutcomes,
    setupFocusAreas: selection.focusAreas,
    setupCautionFlags: selection.cautionFlags ?? [],
    setupGuidanceMode: selection.guidanceMode,
    setupScheduleMode: selection.scheduleMode,
    automatedProgressionEnabled: selection.automatedProgression ?? true,
    setupWeeklyMinutes: selection.weeklyMinutes ?? null,
    setupAvailableDays: selection.scheduleMode === 'self_managed' ? selection.availableDays : [],
    setupCurrentWeightKg: selection.currentWeightKg ?? null,
    bodyweightGoalKg: selection.targetWeightKg ?? null,
    recommendedProgramId,
    activePlanId: null,
    unitPreference: selection.unitPreference,
  };
}

export function buildSavedOnboardingPlan(
  selection: FirstRunSetupSelection,
  recommendedProgramId: string,
  // The name is written into the template at creation time, so it has to be
  // written in the reader's language. Omitting this defaulted to English and
  // put "Strong Chest Advanced" on a Finnish Home screen.
  language: AppLanguage,
  savedTemplateId?: string,
) {
  // Single source of truth with the onboarding previews (days-per-week truth):
  // the same composed week the picker and plan overview showed is what saves.
  const composedWeek = composeProgramWeekForSelection(selection, recommendedProgramId);
  const sessions = (composedWeek?.sessions ?? []).map((session) => ({
    id: session.id,
    name: formatWorkoutDisplayLabel(session.name, 'Workout'),
    orderIndex: session.orderIndex,
    exercises: session.exercises,
  }));
  const draft: WorkoutTemplateDraft = {
    name: buildFirstRunCustomProgramName(selection, language),
    /*
     * Which catalog programme this is the reader's version of.
     *
     * Editing a lift in a ready programme has recorded this since the
     * copies started piling up (#bugs 2026-08-26); onboarding, which makes
     * the same kind of copy for most readers, recorded nothing. So the
     * programme being trained and the catalog page it came from were two
     * unrelated things: the page went on showing the composed week while
     * its day editor could not find the copy and built a second one, and
     * "Take this programme" adopted the untouched original beside it
     * (audit round 4, 2026-09-20). One line, and every reader of the link
     * — the editor, the catalog page, the lineage counters — agrees.
     */
    sourceTemplateId: recommendedProgramId,
    sessions: sessions.map((session) => ({
      id: session.id,
      name: session.name,
      exercises: session.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.exerciseName,
        targetSets: exercise.sets,
        repMin: exercise.repsMin,
        repMax: exercise.repsMax,
        restSeconds: exercise.restSecondsMax,
        trackedDefault: true,
        // How the composed week logs this row. The saved copy is read back by
        // library name, and the library spells push-ups, bird dogs and skater
        // jumps its own way, so they came back with a weight dial.
        trackingMode: exercise.trackingMode,
        // The composed week pairs lifts the way the catalogue prescribes
        // them; the saved programme dropped the id, so a programme built by
        // onboarding — most programmes — never ran a superset (2026-09-14).
        supersetGroup: exercise.supersetGroup ?? null,
      })),
    })),
  };
  const runtimeTemplate: WorkoutRuntimeTemplate = {
    id: savedTemplateId ?? recommendedProgramId,
    name: draft.name,
    defaultScheduleMode: 'rolling_sequence',
    sessions,
  };

  return { draft, runtimeTemplate, firstSessionId: sessions[0]?.id ?? null };
}

export function buildSavedOnboardingWorkoutPlan(
  selection: FirstRunSetupSelection,
  workoutTemplateId: string,
  sessionIds: string[],
  language: AppLanguage,
  // The lead programme's rhythm before this run, so an unchanged pattern
  // keeps its anchor: re-anchoring "2 on, 1 off" to today would silently
  // shift which day of the rhythm today is for a reader who only re-ran the
  // questions.
  previousCycle: TrainingCycle | null = null,
) {
  /**
   * The same weekdays adoption would give, placed the same way.
   *
   * This dealt the reader's days out from the first one, always: day 1 was
   * Monday whatever day the questionnaire was finished on. Home offers the
   * session that comes next — today — and the calendar reads the plan's own
   * labels, so a reader who finished on Thursday was offered day 1 today and
   * shown it on Monday. planLabelsForProgramme is what adoption uses, and
   * with a date it rotates the week so the next session takes the first
   * training day that has not gone.
   */
  const labels = planLabelsForProgramme(
    Math.max(1, sessionIds.length),
    selection.scheduleMode === 'self_managed' && selection.availableDays.length > 0
      ? selection.availableDays
      : DEFAULT_RHYTHM_BY_DAYS[selection.daysPerWeek] ?? DEFAULT_RHYTHM_BY_DAYS[3],
    new Date(),
  );
  const timestamp = new Date().toISOString();
  const planId = `${ONBOARDING_PLAN_PREFIX}${workoutTemplateId}`;

  return {
    id: planId,
    name: buildFirstRunCustomProgramName(selection, language),
    mode: 'rotation' as const,
    entries: Array.from({ length: Math.max(1, sessionIds.length) }, (_, index) => ({
      id: `${planId}_entry_${index + 1}`,
      workoutTemplateId,
      workoutTemplateSessionId: sessionIds[index] ?? null,
      label: labels[index % labels.length] ?? `Day ${index + 1}`,
      orderIndex: index,
    })),
    isActive: true,
    // The rhythm the questions chose is this programme's, and only its.
    trainingCycle: resolveCycleAnchor(selection.trainingCyclePattern, previousCycle, new Date()),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
