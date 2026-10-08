import { AppLanguage } from '../types/models';
import { I18nKey, t } from './i18n';

export interface ReadyProgramCollection {
  key: string;
  label: string;
  templateIds: string[];
}

/**
 * Copy for a collection, resolved in the reader's language. The heading is all
 * a collection says: a description and a "recommended for" line were written
 * and translated, and no screen ever showed them (i18n sweep, 2026-10-07).
 */
export function getReadyProgramCollectionCopy(collectionKey: string, language: AppLanguage = 'en') {
  return {
    label: t(language, `catalog.collection.${collectionKey}.label` as I18nKey),
  };
}

export const READY_PROGRAM_COLLECTIONS: ReadyProgramCollection[] = [
  {
    key: 'starter',
    label: 'Starter picks',
    templateIds: [
      'tpl_2_day_minimal_full_body_v1',
      'tpl_2_day_beginner_strength_v1',
      'tpl_huge_starter_v1',
      'tpl_2_day_mobility_reset_v1',
      'tpl_2_day_yoga_recovery_v1',
      'tpl_3_day_full_body_v1',
      'tpl_3_day_upper_lower_lite_v1',
      'tpl_3_day_strength_base_v1',
      'tpl_4_day_muscle_builder_v1',
      'tpl_gainer_at_home_beginner_v1',
      'tpl_gainer_strength_5x5_v1',
      'tpl_athletic_starter_v1',
      // "Joint-friendly" describes how it trains, not a condition it treats.
      // That is the line this app holds wherever it touches health: a
      // description of the training passes, a claim about a complaint does not.
      'tpl_gainer_joint_friendly_v1',
    ],
  },
  {
    key: 'strength',
    label: 'Build strength',
    templateIds: [
      'tpl_2_day_beginner_strength_v1',
      'tpl_3_day_strength_base_v1',
      'tpl_4_day_powerbuilding_v1',
      'tpl_4_day_strength_size_v1',
      'tpl_home_bodyweight_strength_3_day_v1',
      'tpl_home_calisthenics_strength_5_day_v1',
      'tpl_strong_elite_v1',
      'tpl_home_dumbbell_strength_v1',
      'tpl_home_dumbbell_strength_split_v1',
    ],
  },
  {
    key: 'muscle',
    label: 'Build muscle',
    templateIds: [
      'tpl_home_dumbbell_upper_lower_v1',
      'tpl_home_dumbbell_ppl_v1',
      'tpl_home_bodyweight_upper_lower_v1',
      'tpl_huge_starter_v1',
      'tpl_home_bodyweight_full_body_v1',
      'tpl_home_bodyweight_ppl_v1',
      'tpl_3_day_push_pull_legs_v1',
      'tpl_4_day_upper_lower_v1',
      'tpl_4_day_muscle_builder_v1',
      'tpl_4_day_ppl_plus_v1',
      'tpl_5_day_hybrid_v1',
      'tpl_5_day_ppl_v1',
      'tpl_5_day_upper_lower_full_v1',
      'tpl_6_day_ppl_v1',
      'tpl_6_day_arnold_v1',
      'tpl_gainer_dream_body_man_v1',
      'tpl_gainer_dream_body_female_v1',
      'tpl_gainer_beginner_bro_split_v1',
      'tpl_gainer_hourglass_shape_v1',
      'tpl_gainer_strong_lean_female_v1',
    ],
  },
  {
    key: 'balanced',
    label: 'Balanced weekly rhythm',
    templateIds: [
      'tpl_home_athletic_5_day_v1',
      'tpl_home_dumbbell_athletic_5_day_v1',
      'tpl_athletic_upper_lower_4_day_v1',
      'tpl_athletic_performance_5_day_v1',
      'tpl_2_day_minimal_full_body_v1',
      'tpl_2_day_mobility_reset_v1',
      'tpl_2_day_yoga_recovery_v1',
      'tpl_3_day_full_body_v1',
      'tpl_3_day_run_mobility_v1',
      'tpl_3_day_upper_lower_lite_v1',
      'tpl_4_day_upper_lower_v1',
      'tpl_fit_elite_v1',
      'tpl_gainer_athlete_conditioning_v1',
      'tpl_gainer_runners_strength_v1',
      'tpl_gainer_mobility_flow_v1',
    ],
  },
  {
    key: 'advanced',
    label: 'Advanced splits',
    templateIds: [
      'tpl_4_day_ppl_plus_v1',
      'tpl_5_day_ppl_v1',
      'tpl_5_day_upper_lower_full_v1',
      'tpl_5_day_hybrid_v1',
      'tpl_6_day_ppl_v1',
      'tpl_6_day_arnold_v1',
      'tpl_strong_elite_v1',
      'tpl_fit_elite_v1',
      'tpl_gainer_advanced_ppl_v1',
      'tpl_gainer_expert_powerbuilding_v1',
      'tpl_gainer_calisthenics_mastery_v1',
    ],
  },
  {
    key: 'fatloss',
    label: 'Lose fat',
    templateIds: [
      'tpl_shred_v1',
      'tpl_gainer_lean_shred_v1',
      'tpl_gainer_fat_burn_hiit_v1',
      'tpl_shred_elite_v1',
      'tpl_3_day_full_body_v1',
    ],
  },
  {
    key: 'focus',
    label: 'Muscle group focus',
    templateIds: [
      'tpl_focus_chest_program_v1',
      'tpl_focus_back_program_v1',
      'tpl_focus_arms_program_v1',
      'tpl_focus_legs_program_v1',
      'tpl_focus_glutes_program_v1',
      'tpl_focus_chest_v1',
      'tpl_focus_back_v1',
      'tpl_focus_shoulders_v1',
      'tpl_focus_arms_v1',
      'tpl_focus_legs_v1',
      'tpl_focus_glutes_v1',
      'tpl_gainer_glute_foundations_v1',
      'tpl_gainer_advanced_glutes_v1',
    ],
  },
];

/**
 * In the catalogue on purpose, out of the browse collections on purpose.
 *
 * Every id here needs a reason, and the suite fails on a template that is
 * in neither a collection nor this list. That is the whole point: eighteen
 * programmes went missing from the picker without anything going red,
 * including eleven of the sixteen the welcome screen was curated to show.
 */
export const UNLISTED_READY_PROGRAMS: readonly string[] = [
  // Seasons are joined from SeasonScreen, not picked as a plan. A dated
  // competition in the "pick a programme" list would be a different promise.
  'tpl_season_summer_v1',
  'tpl_season_winter_v1',
  // Decided 2026-08-29: these stay out of onboarding for good. They remain on
  // the Programs tab, where a reader goes looking for them on purpose, and are
  // not offered to every new user while they are choosing a first programme.
  // Naming a collection around them is the point where a training catalogue
  // starts making claims about a health condition rather than about training.
  'tpl_gainer_prenatal_fitness_v1',
  'tpl_gainer_postpartum_recovery_v1',
];
