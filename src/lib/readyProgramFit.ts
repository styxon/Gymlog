import type { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { buildCautionAdaptationLine } from './cautionAdaptationLine';
import {
  buildFirstRunRecommendationReasons,
  FirstRunSetupSelection,
  resolveMismatchNoteForWeek,
} from './firstRunSetup';
import type { ComposedProgramWeek } from './programDayComposer';
import { readyProgramSessionMinutes, readyProgramWeek } from './programDetails';
import type { ProgrammeMinutesOptions } from './programmeMinutes';
import type { TailoringPreferencesInput } from './tailoringFit';
import type { AppLanguage } from '../types/models';

/**
 * "Why it fits" on a ready programme's page: the reasons, joined, for the week
 * the page draws.
 *
 * Every number in it comes from that week. The line quoted the catalogue
 * programme's days and the note was written before the week was fitted to the
 * reader's days, so a reader who asked for three days read "4 days" and "keeps
 * this start at 4 days" over a three-day week, and one who asked for four read
 * "lighter than your target" over four (persona hunt, 2026-10-08). Null when
 * the programme is not the one the questionnaire handed the reader.
 */
export function buildReadyProgramFitExplanation(input: {
  selection: FirstRunSetupSelection;
  recommendation: {
    featuredProgramId?: string | null;
    secondaryProgramId?: string | null;
    mismatchNote?: string | null;
  };
  template: WorkoutTemplateV1;
  /** The composed week the page draws, or null when it draws the catalogue's. */
  composedWeek: ComposedProgramWeek | null;
  minutesOptions?: ProgrammeMinutesOptions;
  tailoringPreferences?: TailoringPreferencesInput | null;
  language: AppLanguage;
}): string | null {
  const { selection, recommendation, template, composedWeek, language } = input;
  if (recommendation.featuredProgramId !== template.id) {
    return null;
  }
  const composed = composedWeek && composedWeek.sessions.length > 0 ? composedWeek : null;

  return buildFirstRunRecommendationReasons(
    selection,
    {
      projectedDaysPerWeek: readyProgramWeek(template, composed).days,
      // The page's own minutes, not the catalog's hand-written number:
      // the badge said 35 and this line summed 50 (bug hunt, B14).
      estimatedSessionDuration: readyProgramSessionMinutes(template, composed, input.minutesOptions),
      mismatchNote: resolveMismatchNoteForWeek(
        selection,
        {
          featuredProgramId: template.id,
          secondaryProgramId: recommendation.secondaryProgramId,
          mismatchNote: recommendation.mismatchNote,
        },
        composed ? composed.days : null,
        input.tailoringPreferences,
        language,
      ),
      // What the reader's flags took out of this week, when they did.
      cautionLine: buildCautionAdaptationLine(composed, language),
      language,
      programId: template.id,
    },
    input.tailoringPreferences,
  ).join(' ');
}
