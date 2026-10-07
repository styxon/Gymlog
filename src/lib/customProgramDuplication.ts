import { AppLanguage, WorkoutTemplateDraft, WorkoutTemplateSessionWithExercises } from '../types/models';

import { buildDisplayCopyName } from './displayLabel';
import { localizeSessionName } from './sessionNameLabel';

/**
 * Duplication is where catalog English enters the user's own database.
 *
 * Session names are translated here rather than on the way out, because this
 * is the one moment the string stops being catalog data and becomes the user's
 * program. Every viewer already localises, so leaving it English only showed
 * through in the template editor — the one screen that must display the stored
 * name verbatim, since that is the name it will save.
 */
/**
 * A copy keeps the programme's own name.
 *
 * There is only one way to get here now: the reader changed a lift in a ready
 * programme, so the app made them their own version of it. They never asked
 * for a duplicate — they asked to change an exercise — and the whole point is
 * that the catalog original stays untouched behind them and comes back whole
 * if they take it up again (user 2026-08-26 and again 2026-09-08: "ei ole
 * tarkoitus olla kopiota ... alkuperäiset säilyy koskemattomina mutta tätä
 * sinun omaa ohjelmaasi voit muokata miten haluat").
 *
 * The "(kopio)" suffix survives for one case only, and it is not a feature:
 * when the plain name is already taken. Two rows reading the same is worse
 * than one reading "(kopio)" — and the reader can now type over either
 * (ProgramDetailScreen's rename).
 */
export function buildDuplicatedCustomProgramDraft(
  name: string,
  sessions: WorkoutTemplateSessionWithExercises[],
  existingNames: string[] = [],
  language: AppLanguage = 'en',
): WorkoutTemplateDraft {
  const taken = existingNames.some((existing) => existing.trim() === name.trim());
  return {
    name: taken ? buildDisplayCopyName(name, language, existingNames) : name,
    sessions: sessions
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((session) => ({
        name: localizeSessionName(session.name, language),
        exercises: session.exercises
          .slice()
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((exercise) => ({
            name: exercise.name,
            targetSets: exercise.targetSets,
            repMin: exercise.repMin,
            repMax: exercise.repMax,
            restSeconds: exercise.restSeconds,
            trackedDefault: exercise.trackedDefault,
            libraryItemId: exercise.libraryItemId ?? null,
            trackingMode: exercise.trackingMode ?? null,
            // The copy trains the same way the original did, supersets
            // included. Dropping this would unpair every superset in a
            // programme the moment the reader edited one lift in it.
            supersetGroup: exercise.supersetGroup ?? null,
          })),
      })),
  };
}
