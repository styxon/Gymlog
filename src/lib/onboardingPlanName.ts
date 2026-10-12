import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { AppLanguage } from '../types/models';
import { buildFirstRunCustomProgramName, FirstRunSetupSelection } from './firstRunSetup';
import { getReadyTemplatePresentation } from './templatePresentation';

/**
 * What the plan onboarding creates is called.
 *
 * A reader who picked a ready programme ("FIT Lite") got a plan named
 * "Etureisikunto · Amateur", composed from the first focus area, the goal and
 * the tier (owner walkthrough, 2026-10-12). A programme the reader chose is
 * called what its own page calls it: the presentation title, which overrides
 * the template's raw name. The composed name stays for plans the app builds
 * itself, where no catalogue title exists.
 */
export function resolveOnboardingPlanName(
  selection: FirstRunSetupSelection,
  pickedTemplate: WorkoutTemplateV1 | null | undefined,
  language: AppLanguage,
): string {
  if (pickedTemplate) {
    return getReadyTemplatePresentation(pickedTemplate, language).title;
  }
  return buildFirstRunCustomProgramName(selection, language);
}
