import { useMemo } from 'react';

import type { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import type { FirstRunSetupSelection, resolveFirstRunRecommendationWithTailoring } from '../lib/firstRunSetup';
import { t, type I18nKey } from '../lib/i18n';
import {
  countByCategory,
  filterByCategory,
  PROGRAM_CATEGORIES,
  type ProgramCategoryKey,
} from '../lib/programCategories';
import { expandRunningIdsWithSources } from '../lib/programmeCopyLink';
import { programCoverStyle } from '../lib/programVisualIdentity';
import { programmeCardWeek, resolveReaderComposedWeek } from '../lib/programDetails';
import { resolveAvailableEquipment } from '../lib/equipmentExerciseFilter';
import { getReadyProgramContent } from '../lib/readyProgramContent';
import { getReadyProgramBlockWeeks } from '../lib/readyProgramDuration';
import { backfillRecommendations } from '../lib/recommendationBackfill';
import type { CatalogScreenItem } from '../screens/CatalogScreen';
import type { ProgramsExploreItem } from '../screens/ProgramsHomeScreen';
import type { AppDatabase, AppPreferences } from '../types/models';
import { formatGoalLabel } from './homeSessionTitle';
import type { useHomeActivePlan } from './useHomeActivePlan';

/**
 * The Programs tab's catalog: every ready programme as a browse card, the
 * counts and members of each category tile, the catalog screen's rows, and
 * the "Sinulle" row of reasoned recommendations — plus the tips the reader
 * has dismissed.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: these are memos, and VinhaApp calls this exactly
 * where the lines stood — after useRecentSessions, before
 * useRecordsAndMilestones — so every hook keeps its slot. dismissedTipIds is
 * a plain read and moved with the block it opened. .tsx because the item
 * types come from src/screens, as in phase A.
 */
export interface ProgramsCatalogDeps {
  /** The reader's preferences: the language and the dismissed tips. */
  preferences: AppPreferences;
  /** The workout context's catalog. */
  workout: { templates: typeof WORKOUT_TEMPLATES_V1 };
  /** The questionnaire's recommendation, whose waterfall leads the row. */
  setupRecommendation: ReturnType<typeof resolveFirstRunRecommendationWithTailoring> | null;
  /** Home's hero card, as useHomeActivePlan builds it. */
  homeActivePlanCard: ReturnType<typeof useHomeActivePlan>['homeActivePlanCard'];
  /** The recommended ready programme, the affinity anchor when the lead is not in the catalog. */
  recommendedReadyTemplate: (typeof WORKOUT_TEMPLATES_V1)[number] | null;
  /** The templates of every running programme. */
  activeProgramTemplateIds: string[];
  /** The whole database: which catalog programmes the running ones are copies of. */
  database: AppDatabase;
  /** The questionnaire's answers, which compose the reader's own programme's week. */
  setupSelection: FirstRunSetupSelection | null;
}

export function useProgramsCatalog(deps: ProgramsCatalogDeps) {
  const {
    preferences,
    workout,
    setupRecommendation,
    homeActivePlanCard,
    recommendedReadyTemplate,
    activeProgramTemplateIds,
    database,
    setupSelection,
  } = deps;

  const dismissedTipIds = preferences.dismissedTipIds ?? [];
  // The cards quote Home's number for a session, warm-up and cool-down for
  // the reader's own gear included (bug hunt, 2026-10-04).
  const minutesOptions = useMemo(
    () => ({
      availableEquipment: resolveAvailableEquipment({
        trainingEnvironment: preferences.setupTrainingEnvironment,
        equipmentItems: preferences.setupEquipmentItems,
      }),
      overrides: preferences.routineDrillOverrides,
      cautionFlags: preferences.setupCautionFlags,
    }),
    [
      preferences.setupTrainingEnvironment,
      preferences.setupEquipmentItems,
      preferences.routineDrillOverrides,
      preferences.setupCautionFlags,
    ],
  );
  /**
   * The week the reader runs of the programme the questionnaire gave them,
   * the one its page draws. Its card costs that week — caution swaps, focus
   * additions and all — not the catalog's: with the knees avoided the card
   * read 40 min and the page 30 (bug hunt, 2026-10-07, #37). Composed once,
   * for that one programme.
   */
  const readerComposedWeek = useMemo(
    () =>
      preferences.recommendedProgramId
        ? resolveReaderComposedWeek(preferences.recommendedProgramId, {
            recommendedProgramId: preferences.recommendedProgramId,
            setupSelection,
            workoutTemplates: database.workoutTemplates,
            workoutPlans: database.workoutPlans,
          })
        : null,
    [preferences.recommendedProgramId, setupSelection, database.workoutTemplates, database.workoutPlans],
  );
  /**
   * The full catalog as browse cards, plus the counts each category tile
   * shows.
   *
   * Explore used to be eight hand-picked ids — a curated row that could not
   * grow and that no filter could reach past. With categories on the screen
   * the rail has to be the whole catalog, or a tile saying "Voima 8" would
   * open a list of three.
   */
  const programsCatalogItems = useMemo<ProgramsExploreItem[]>(
    () =>
      workout.templates.map((template) => {
        // Days, minutes and bars from one week, the page's (bug hunt, 2026-10-08).
        const week = programmeCardWeek(template, readerComposedWeek, minutesOptions);
        return {
          id: template.id,
          name: formatWorkoutDisplayLabel(template.name),
          goal: formatGoalLabel(template.goalType, preferences.appLanguage),
          blurb: getReadyProgramContent(template.id, preferences.appLanguage)?.summary ?? '',
          days: week.days,
          minutes: week.minutes,
          cover: programCoverStyle(template.id, template.name),
          fingerprint: week.fingerprint,
          level: template.level,
          weeks: getReadyProgramBlockWeeks(template),
        };
      }),
    [minutesOptions, preferences.appLanguage, readerComposedWeek, workout.templates],
  );
  const programsCategoryCounts = useMemo(
    () => countByCategory(workout.templates),
    [workout.templates],
  );
  /**
   * The catalog screen's rows: the explore items plus every category each
   * programme belongs to, because the goal chips narrow on that and a
   * programme in two categories has to be findable under both.
   */
  const catalogScreenItems = useMemo<CatalogScreenItem[]>(() => {
    const memberships = new Map<string, ProgramCategoryKey[]>();
    for (const category of PROGRAM_CATEGORIES) {
      for (const template of filterByCategory(workout.templates, category.key)) {
        const keys = memberships.get(template.id);
        if (keys) {
          keys.push(category.key);
        } else {
          memberships.set(template.id, [category.key]);
        }
      }
    }
    return programsCatalogItems.map((item) => ({
      ...item,
      categories: memberships.get(item.id) ?? [],
    }));
  }, [programsCatalogItems, workout.templates]);
  const programsCategoryMembers = useMemo(
    () =>
      Object.fromEntries(
        PROGRAM_CATEGORIES.map((category) => [
          category.key,
          filterByCategory(workout.templates, category.key).map((template) => template.id),
        ]),
      ) as Record<ProgramCategoryKey, string[]>,
    [workout.templates],
  );
  /**
   * "For you" — the programs the recommendation engine actually picked, each
   * with the reason it picked them.
   *
   * Every card carries a "why": the waterfall's picks bring their own, and the
   * affinity backfill names its reason per match (same goal one level up, a
   * different split, ...). That is the rule that used to cap this row at two —
   * a recommendation without a reason is the thing this app has repeatedly
   * refused to ship — and it still holds at six (user asked for more cards,
   * #bugs 2026-08-25): the row grows only as far as reasoned matches exist.
   *
   * NOT labelled AI, deliberately. The model is never used to pick a
   * programme — that is a scored, testable decision: recommendationScoring
   * plus a waterfall, covered by tests. An AI badge here would claim
   * otherwise.
   */
  /**
   * "Sinulle" — and nothing in it is something you already run.
   *
   * The questionnaire's two picks lead, but adopting one used to leave it in
   * the row, so the tab kept recommending a programme the reader was already
   * training. A taken programme drops out and the row is filled from the
   * catalog, measured from what is being trained NOW — see
   * lib/recommendationBackfill. The first reason the ranker reaches for is
   * "same goal, one level up", so the fill is usually a step harder.
   */
  const programsRecommendations = useMemo(
    () => {
      const byId = new Map(workout.templates.map((template) => [template.id, template]));
      const waterfall = setupRecommendation?.waterfall;
      // A custom programme is not in the catalog, so it cannot anchor the
      // affinity read directly — but it was composed from the same answers
      // the questionnaire's featured ready pick matches (goal, level, days),
      // so that pick stands in. Without the fallback a custom-programme user
      // saw the row collapse to the two questionnaire cards forever.
      const anchor =
        (homeActivePlanCard?.programId ? byId.get(homeActivePlanCard.programId) ?? null : null)
        ?? recommendedReadyTemplate
        ?? null;
      const picks = waterfall
        ? [
            { templateId: waterfall.primaryProgramId, whyKey: waterfall.whyPrimary },
            { templateId: waterfall.alternativeProgramId, whyKey: waterfall.whyAlternative },
          ].filter(
            (entry): entry is { templateId: string; whyKey: I18nKey } =>
              Boolean(entry.templateId && entry.whyKey),
          )
        : [];

      return backfillRecommendations({
        picks,
        // A programme you run under your own copy of it is a programme you
        // run. The row dropped what was adopted by template id, and a copy
        // carries a new one — so the card the questionnaire had just handed
        // over went on being recommended, under the catalog name, to the
        // reader already training it (audit round 4, 2026-09-20).
        adoptedIds: expandRunningIdsWithSources(
          activeProgramTemplateIds,
          database.workoutTemplates,
          workout.templates.map((template) => template.id),
        ),
        anchor,
        catalog: workout.templates,
        // Six either way: the questionnaire's picks lead when they exist, and
        // affinity neighbours of the active programme fill the rest. With no
        // active programme there is nothing to measure affinity from, so the
        // row honestly shrinks to the picks instead of padding.
        limit: 6,
      })
        .map((slot) => {
          const template = byId.get(slot.templateId);
          if (!template) {
            return null;
          }
          const week = programmeCardWeek(template, readerComposedWeek, minutesOptions);
          return {
            id: template.id,
            name: formatWorkoutDisplayLabel(template.name),
            goal: formatGoalLabel(template.goalType, preferences.appLanguage),
            blurb: getReadyProgramContent(template.id, preferences.appLanguage)?.summary ?? '',
            why: t(preferences.appLanguage, slot.whyKey, { days: week.days }),
            days: week.days,
            minutes: week.minutes,
            cover: programCoverStyle(template.id, template.name),
            fingerprint: week.fingerprint,
            level: template.level,
            weeks: getReadyProgramBlockWeeks(template),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    },
    [
      activeProgramTemplateIds,
      // The row asks which catalog programmes the running ones are copies
      // of, so a copy made without the running set changing — a fork made
      // while browsing — has to reach it (review, 2026-09-20).
      database.workoutTemplates,
      homeActivePlanCard?.programId,
      minutesOptions,
      preferences.appLanguage,
      readerComposedWeek,
      recommendedReadyTemplate,
      setupRecommendation?.waterfall,
      workout.templates,
    ],
  );

  return {
    dismissedTipIds,
    programsCatalogItems,
    programsCategoryCounts,
    catalogScreenItems,
    programsCategoryMembers,
    programsRecommendations,
    readerComposedWeek,
  };
}
