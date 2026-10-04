import { useMemo } from 'react';

import { t } from '../lib/i18n';
import type { AppRoute } from '../navigation/routes';
import type { AppDatabase, AppPreferences, WorkoutTemplateDraft, WorkoutTemplateSessionWithExercises } from '../types/models';

/**
 * The draft the programme builder opens on: blank days in the reader's
 * language, or the custom programme the template route names.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because the moved code is a memo. VinhaApp calls this exactly where
 * the memo stood — after programsCustomItems, the last hook above the early
 * return — so every hook keeps its slot.
 */
export interface TemplateBuilderDraftDeps {
  /** VinhaApp's current route: the template route names the programme. */
  route: AppRoute;
  /** The reader's preferences: the app language, for the blank day names. */
  preferences: AppPreferences;
  /** The custom programmes, to find the one the route names. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** AppProvider's session reader, for the programme's days and lifts. */
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
}

export function useTemplateBuilderDraft(deps: TemplateBuilderDraftDeps) {
  const { route, preferences, workoutTemplates, getWorkoutTemplateSessions } = deps;

  const templateBuilderDraft = useMemo<WorkoutTemplateDraft>(() => {
    // In the reader's language: the builder keeps any non-empty name it is
    // given, so "Day 1" here skipped its own Finnish default and was saved as
    // the day's name (2026-09-14).
    const dayWord = t(preferences.appLanguage, 'tpl.dayWord');
    const blankBuilderDays = [1, 2, 3].map((day) => ({ name: `${dayWord} ${day}`, exercises: [] }));
    if (route.tab !== 'workout' || route.screen !== 'template') {
      return {
        name: '',
        sessions: blankBuilderDays,
      };
    }

    if (!route.workoutTemplateId) {
      return {
        name: '',
        sessions: blankBuilderDays,
      };
    }

    const template = workoutTemplates.find((item) => item.id === route.workoutTemplateId);
    if (!template) {
      return {
        name: '',
        sessions: blankBuilderDays,
      };
    }

    return {
      id: template.id,
      name: template.name,
      sessions: getWorkoutTemplateSessions(template.id).map((session) => ({
        id: session.id,
        name: session.name,
        exercises: session.exercises.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          targetSets: exercise.targetSets,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          restSeconds: exercise.restSeconds,
          trackedDefault: exercise.trackedDefault,
          libraryItemId: exercise.libraryItemId ?? null,
          trackingMode: exercise.trackingMode ?? null,
          // Carried rather than shown: the editor has no superset controls, and
          // a draft that dropped the field would quietly unpair every superset
          // in the programme the first time somebody renamed a day here.
          supersetGroup: exercise.supersetGroup ?? null,
        })),
      })),
    };
  }, [getWorkoutTemplateSessions, preferences.appLanguage, route, workoutTemplates]);

  return templateBuilderDraft;
}
