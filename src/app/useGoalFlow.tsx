import { useCallback, useMemo } from 'react';
import { getWorkoutTemplateById, WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import { WorkoutRuntimeTemplate } from '../features/workout/workoutTypes';
import { calendarDaysBetween } from '../lib/completedSessions';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { t } from '../lib/i18n';
import {
  describeGoalCoverage,
  GoalProgrammeSuggestionView,
  isSameLift,
  isSameLiftAsLibraryRow,
  rankProgrammesForLift,
} from '../lib/goalProgramme';
import { RecordSource } from '../lib/personalRecords';
import {
  ExerciseProgressSummary,
  getLiftProgress,
  SameLiftMatcher,
} from '../lib/progression';
import { getReadyProgramBlockWeeks } from '../lib/readyProgramDuration';
import { resolveObservedRate } from '../lib/strengthGoalPlan';
import { STRENGTH_GOAL_PRESETS } from '../lib/strengthGoalPresets';
import { resolveGoalProgress, upsertStrengthGoal } from '../lib/strengthGoals';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { LiftHistory } from '../lib/trainingHistory';
import { programmeCardMinutes } from '../lib/programDetails';
import type { ComposedProgramWeek } from '../lib/programDayComposer';
import { resolveAvailableEquipment } from '../lib/equipmentExerciseFilter';
import { AppRoute } from '../navigation/routes';
import type { ProgramsExploreItem } from '../screens/ProgramsHomeScreen';
import type { GoalFlowLift, GoalFlowProposal } from '../screens/StrengthGoalFlowScreen';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppDatabase, AppPreferences } from '../types/models';

/**
 * Strength targets, end to end: the lifts the target flow offers and what
 * the log says about each, the Progress tab's target rows and the sets they
 * open, the programme the flow proposes for a lift, accepting that proposal,
 * the Programs tab's goal bars, and the programme behind each goal lift.
 *
 * Moved out of App.tsx in the phase-B split (2026-09-30), verbatim and in the
 * order it stood there, docs and comments with it. A hook because every value
 * here is a memo or a callback; handleAcceptTargetProposal stays a plain
 * function declaration, rebuilt every render as it was, and its only reader
 * (the renderWorkoutTab arguments) sits below the call. .tsx because the
 * flow's own types come from src/screens and PreferencesPatch from
 * AppProvider, as in phase A.
 *
 * libraryNames and sameLift stay inside the hook. libraryNames is still ONE
 * memoised array: the goal-programme resolver keys a WeakMap cache on it,
 * which is what the orphaned "One array per library" note above
 * goalProgrammeSuggestions is about.
 */
export interface GoalFlowDeps {
  /** The library every "is this that lift?" question is asked against. */
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  /** Local midnight of today: "logged 2 days ago" counts calendar days from it. */
  todayStartMs: number;
  preferences: AppPreferences;
  /** Every logged lift's history: the flow reads its bests and rates from these. */
  proLiftHistories: LiftHistory[];
  trackedProgress: ExerciseProgressSummary[];
  /** The records' set-log builder, so a target row's sheet reads its sets as Records does. */
  toSetLogSource: (summary: ExerciseProgressSummary) => RecordSource;
  /** Adoption owns the programme cap, and resolves false when it refused. */
  handleAdoptReadyProgram: (workoutTemplateId: string, options?: { lead?: boolean }) => Promise<boolean>;
  /** Written with a functional patch: the target is stored from the stored goals. */
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
  navigate: (route: AppRoute) => void;
  activeProgramTemplateIds: string[];
  /** The reader's own programmes by template id, for goal coverage and titles. */
  customWorkoutRuntimeMap: Record<string, WorkoutRuntimeTemplate>;
  /** Only the ids are read: the order a suggested programme is preferred in. */
  programsRecommendations: ProgramsExploreItem[];
  /** VinhaApp's showToast: a failed write is said, not swallowed. */
  showToast: (message: string) => void;
  /** The reader's composed week of their own programme (useProgramsCatalog), for its minutes. */
  readerComposedWeek: ComposedProgramWeek | null;
}

export function useGoalFlow(deps: GoalFlowDeps) {
  const {
    exerciseLibrary,
    todayStartMs,
    preferences,
    proLiftHistories,
    trackedProgress,
    toSetLogSource,
    handleAdoptReadyProgram,
    updatePreferences,
    navigate,
    activeProgramTemplateIds,
    customWorkoutRuntimeMap,
    programsRecommendations,
    showToast,
    readerComposedWeek,
  } = deps;

  const libraryNames = useMemo(() => exerciseLibrary.map((item) => item.name), [exerciseLibrary]);
  /**
   * "Is this log that lift?" — bound to the library once, for every lookup
   * that asks it about a target: the target bars and the Progress target rows.
   * The rows used to compare names instead, so the flow quoted a 110 kg squat
   * best while the squat's own row said nothing was logged.
   */
  const sameLift = useCallback<SameLiftMatcher>(
    (loggedName, liftName) => isSameLift(loggedName, liftName, libraryNames),
    [libraryNames],
  );
  /**
   * The same question about one library row, for the exercise page's history.
   * Narrower than a target on purpose — see isSameLiftAsLibraryRow: the sumo
   * deadlift's page is not the deadlift target.
   */
  const sameLibraryRow = useCallback<SameLiftMatcher>(
    (loggedName, rowName) => isSameLiftAsLibraryRow(loggedName, rowName, libraryNames),
    [libraryNames],
  );

  /**
   * The lifts the target flow can aim at, and what the log says about each.
   *
   * The named eight, not the library. Nobody says "I want to cable-crossover
   * 30 kg" — see STRENGTH_GOAL_PRESETS for the list and why sumo is not on it.
   * Offering all 876 also broke the promise behind every target: step 3 shows
   * the programme that trains the lift, and for most of the library there is
   * none.
   *
   * The log is read through `isSameLift`, not by name, so a "Barbell Bench
   * Press" in the log finds the row for "Barbell Bench Press - Medium Grip".
   * Matching on the name is how the target row once read 70 kg of 200 while
   * the picker behind it said "not logged yet" for the same lift.
   */
  const goalFlowLifts = useMemo<GoalFlowLift[]>(() => {
    // Today from the day key: "logged 2 days ago" is a count of calendar
    // days, and read off the clock it stayed a day behind in an app left open.
    const now = todayStartMs;
    return STRENGTH_GOAL_PRESETS.map((preset) => {
      // The target already set for this lift, so the flow can say so instead
      // of replacing it in silence.
      const targetKg =
        preferences.strengthGoals.find((goal) =>
          isSameLift(goal.exerciseName, preset.exerciseName, libraryNames),
        )?.targetKg ?? null;
      // Every spelling of the lift, not the first one found. Trap bar at 150
      // over six sessions and sumo at 170 over two made the flow's best 150,
      // while the Programs goal row took the max — so a "+20" target of 170
      // read as reached the moment it was saved.
      const histories = proLiftHistories.filter((entry) =>
        isSameLift(entry.name, preset.exerciseName, libraryNames),
      );
      const bestKg = histories.reduce((best, entry) => Math.max(best, entry.bestWeightKg), 0);
      if (histories.length === 0 || !(bestKg > 0)) {
        return {
          exerciseName: preset.exerciseName,
          targetKg,
          bestKg: null,
          rate: null,
          lastLoggedAt: null,
          daysSinceLogged: null,
        };
      }
      const lastLoggedAt = histories.reduce((latest, entry) => Math.max(latest, entry.latest.time), 0);
      return {
        exerciseName: preset.exerciseName,
        targetKg,
        bestKg,
        rate: resolveObservedRate(histories.flatMap((entry) => entry.points)),
        lastLoggedAt,
        daysSinceLogged: Math.max(0, calendarDaysBetween(lastLoggedAt, now)),
      };
    });
  }, [libraryNames, preferences.strengthGoals, proLiftHistories, todayStartMs]);

  /**
   * The Progress tab's target rows: each target lift under every name it was
   * logged as.
   *
   * The rows used to join the tracked summaries on the lift's own name. A
   * target on "Barbell Squat" seeds an empty summary under that name, and the
   * squats an onboarding programme logs are "Back Squat" — so the row read
   * "Alkuvaihe –" and opened "No logged sets" beside a flow that had just
   * quoted the 110 kg best.
   *
   * The sheet a row opens is built from the same merged summary, and kept
   * apart from the Records sources: a record is one spelling's best, and
   * tapping it must not open a sheet whose best disagrees with it.
   */
  const targetLiftProgress = useMemo(
    () =>
      goalFlowLifts
        .map((lift) => getLiftProgress(lift.exerciseName, trackedProgress, sameLift))
        .filter((summary): summary is ExerciseProgressSummary => summary !== null),
    [goalFlowLifts, sameLift, trackedProgress],
  );
  const targetLiftSources = useMemo(
    () => targetLiftProgress.map(toSetLogSource),
    [targetLiftProgress, toSetLogSource],
  );

  /**
   * The programme the flow would put the reader on, for one lift.
   *
   * A real catalog programme, ranked by how central the lift is in it and how
   * well it fits the reader's week — not a generated one. The composer that
   * writes weeks from scratch has invented exercise names in this app before,
   * and a target's programme is the last place that should happen.
   *
   * PRIMARY only. A programme that touches the lift as an accessory is not a
   * programme that goes where the target goes, and offering one would be the
   * "any answer beats no answer" failure the goal coverage layer already
   * refuses.
   */
  const getGoalProposal = useCallback(
    (exerciseName: string): GoalFlowProposal | null => {
      const ranked = rankProgrammesForLift(WORKOUT_TEMPLATES_V1, exerciseName, {
        libraryNames,
        reader: { level: preferences.setupLevel, daysPerWeek: preferences.setupDaysPerWeek },
      });
      /*
       * A strength target wants a strength programme.
       *
       * rankProgrammesForLift orders by how central the lift is and then by
       * how well the week fits the reader — which it should, it serves the
       * browse surfaces too. It knows nothing about goalType, so "squat 140
       * kg" came back as SHRED Elite: a five-day conditioning block that
       * happens to squat on day one and happens to match a five-day reader.
       * Six programmes were tied at one squat day and the fat-loss one won on
       * calendar fit alone.
       *
       * Among the primary matches, the ones built for strength go first. Order
       * within each group is the ranker's, so the reader's week still decides
       * between two strength programmes.
       */
      const primary = ranked.filter((match) => match.primary);
      const best =
        primary.find((match) => getWorkoutTemplateById(match.id)?.goalType === 'strength') ??
        primary[0];
      const template = best ? getWorkoutTemplateById(best.id) : null;
      if (!best || !template) {
        return null;
      }

      const days = template.sessions.map((session) => ({
        sessionId: session.id,
        name: formatWorkoutDisplayLabel(session.name),
        // The first three lifts, which is what the reader is deciding on. The
        // screen joins nothing: a card that composes its own sentence is a
        // card that can compose one the programme does not contain.
        lead: session.exercises
          .slice(0, 3)
          .map(
            (exercise) =>
              `${exerciseNameLabel(preferences.appLanguage, exercise.exerciseName)} ${exercise.sets}×${exercise.repsMin}`,
          )
          .join(' · '),
        trainsTarget: session.exercises.some((exercise) =>
          isSameLift(exercise.exerciseName, exerciseName, libraryNames),
        ),
      }));

      return {
        templateId: template.id,
        programmeName: getReadyTemplatePresentation(template, preferences.appLanguage).title,
        daysPerWeek: template.daysPerWeek,
        // The programme page's number, the reader's own week included (#37).
        minutes: programmeCardMinutes(template, readerComposedWeek, {
          availableEquipment: resolveAvailableEquipment({
            trainingEnvironment: preferences.setupTrainingEnvironment,
            equipmentItems: preferences.setupEquipmentItems,
          }),
          overrides: preferences.routineDrillOverrides,
          cautionFlags: preferences.setupCautionFlags,
        }),
        blockWeeks: getReadyProgramBlockWeeks(template),
        days,
        targetDays: days.filter((day) => day.trainsTarget).length,
      };
    },
    [
      libraryNames,
      preferences.appLanguage,
      preferences.setupDaysPerWeek,
      preferences.setupLevel,
      preferences.setupTrainingEnvironment,
      preferences.setupEquipmentItems,
      preferences.routineDrillOverrides,
      preferences.setupCautionFlags,
      readerComposedWeek,
    ],
  );

  /**
   * Accepting the proposal: the target is stored and the programme is taken on.
   *
   * Both, in that order, and the adoption is what the reader watches for — a
   * target with no programme behind it was the thing feedback round 2 asked to
   * end. Adoption owns the cap: full on the free tier routes to the paywall,
   * full on Pro says so, and neither is this screen's business.
   */
  async function handleAcceptTargetProposal(input: {
    exerciseName: string;
    targetKg: number;
    /**
     * The programme to take up alongside the target, or null for the target
     * alone.
     *
     * A target and a programme are two decisions, and this flow used to make
     * them one: the only way to aim at a number was to accept a new week
     * ("en aina halua etta se vaikuttaa koko ohjelmaan", 2026-09-07). Null
     * writes the target and leaves the reader's programme untouched.
     */
    templateId: string | null;
  }) {
    // The programme FIRST, and the target only if it landed.
    //
    // Stored first, a refused adoption left the reader with exactly the thing
    // this flow exists to end: a target and nothing going towards it. The cap
    // refuses for real — three programmes on the free tier sends them to the
    // paywall — and that is not a moment to have quietly written a goal.
    let adopted = false;
    try {
      if (input.templateId !== null) {
        adopted = await handleAdoptReadyProgram(input.templateId, { lead: true });
        if (!adopted) {
          return;
        }
      }
      // From the stored goals: the programme was written above, awaited, and
      // this render's snapshot predates it.
      await updatePreferences((current) => ({
        strengthGoals: upsertStrengthGoal(current.strengthGoals, {
          exerciseName: input.exerciseName,
          targetKg: input.targetKg,
          createdAt: new Date().toISOString(),
        }),
      }));
    } catch (error) {
      // A failed write stayed silent: no message, no navigation, and — when
      // the programme had landed — a programme on with no target behind it
      // (#bugs 2026-10-01, from the phase-B split). Said, and the reader stays
      // on the sheet to try again; the toast names which half is in.
      console.error('Failed to save the target', error);
      showToast(
        t(preferences.appLanguage, adopted ? 'toast.goalSaveFailedProgramOn' : 'toast.goalSaveFailed'),
      );
      return;
    }

    // And say so — by ARRIVING. Both writes have resolved by here, the
    // programme then the target, which is the order CLAUDE.md asks for: a
    // success state follows the write, never precedes it.
    //
    // The success state used to be a toast as well. It was raised over the
    // page that already showed both halves of what it announced — the
    // programme at the top of Omat ohjelmasi, the target under Tavoitteesi —
    // so it named nothing the reader could not see ("valkoinen ilmoitus
    // poista", #bugs 2026-09-05). The navigation is the feedback; the toast
    // was the same news a second time, in a white box over it.
    navigate({ tab: 'workout', screen: 'programs_home' });
  }

  /**
   * Goals with a bar that can move.
   *
   * Measured against the user's own best set for that lift — never an
   * estimate. A goal on a lift they have not logged shows as not started
   * rather than 0%: those are different states, and a bar alone cannot tell
   * them apart.
   */
  const programsGoals = useMemo(
    () =>
      resolveGoalProgress(
        preferences.strengthGoals,
        new Map(trackedProgress.map((summary) => [summary.name, summary.bestWeight])),
        // Same rule the coverage row uses, so "your program trains this" and
        // "you have lifted this" can never disagree about what the lift is.
        sameLift,
      ),
    [preferences.strengthGoals, sameLift, trackedProgress],
  );
  /**
   * The programme behind each goal lift (feedback round 2, #1: a target always
   * has a programme that goes towards it).
   *
   * Computed for every preset lift, not only the goals set, so the picker can
   * answer the moment a target is tapped. "Covered" means one of the ACTIVE
   * programmes — ready or the reader's own — trains the lift; otherwise the
   * best ready programme that does is suggested, ordered by how central the
   * lift is there and then by the setup recommendation. No fit is invented:
   * a lift no ready programme trains says so and points at the editor.
   */
  // One array per library, so the goal-programme resolver's cache can key on it
  // instead of being defeated by a fresh `.map` every render.
  const goalProgrammeSuggestions = useMemo(() => {
    const activeCandidates = activeProgramTemplateIds
      .map((id) => getWorkoutTemplateById(id) ?? customWorkoutRuntimeMap[id] ?? null)
      .filter((template): template is NonNullable<typeof template> => Boolean(template));
    const activeIds = new Set(activeProgramTemplateIds);
    const preferredOrder = programsRecommendations.map((item) => item.id);
    const titleOf = (id: string) => {
      const ready = getWorkoutTemplateById(id);
      if (ready) {
        return getReadyTemplatePresentation(ready, preferences.appLanguage).title;
      }
      const custom = customWorkoutRuntimeMap[id];
      return custom ? formatWorkoutDisplayLabel(custom.name) : id;
    };
    const result: Record<string, GoalProgrammeSuggestionView> = {};
    for (const preset of STRENGTH_GOAL_PRESETS) {
      const lift = preset.exerciseName;
      const coverage = describeGoalCoverage(
        { exerciseName: lift, targetKg: 1, createdAt: '' },
        activeCandidates,
        libraryNames,
      );
      if (coverage.status === 'covered' && coverage.coveredBy) {
        const active = activeCandidates.find((template) => template.id === coverage.coveredBy);
        const match = rankProgrammesForLift(active ? [active] : [], lift, { libraryNames })[0];
        result[lift] = {
          status: 'covered',
          programme: {
            id: coverage.coveredBy,
            title: titleOf(coverage.coveredBy),
            sessionCount: match?.sessionCount ?? 0,
            totalSessions: active?.sessions.length ?? 0,
          },
        };
        continue;
      }
      const ranked = rankProgrammesForLift(WORKOUT_TEMPLATES_V1, lift, {
        preferredOrder,
        libraryNames,
        // The suggestion has to be a programme this reader can actually run.
        reader: { level: preferences.setupLevel, daysPerWeek: preferences.setupDaysPerWeek },
      }).filter(
        (match) => !activeIds.has(match.id),
      );
      const best = ranked[0];
      const template = best ? getWorkoutTemplateById(best.id) : null;
      result[lift] =
        best && template
          ? {
              status: 'suggest',
              programme: {
                id: best.id,
                title: getReadyTemplatePresentation(template, preferences.appLanguage).title,
                sessionCount: best.sessionCount,
                totalSessions: template.sessions.length,
              },
            }
          : { status: 'none', programme: null };
    }
    return result;
  }, [
    activeProgramTemplateIds,
    customWorkoutRuntimeMap,
    libraryNames,
    preferences.appLanguage,
    preferences.setupDaysPerWeek,
    preferences.setupLevel,
    programsRecommendations,
  ]);

  return {
    sameLibraryRow,
    goalFlowLifts,
    targetLiftProgress,
    targetLiftSources,
    getGoalProposal,
    handleAcceptTargetProposal,
    programsGoals,
    goalProgrammeSuggestions,
  };
}
