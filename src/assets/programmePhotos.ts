import { ImageSourcePropType } from 'react-native';

/**
 * One photo per programme, for the welcome screen's tiles.
 *
 * Keyed by template id rather than by title: the title is translated, and the
 * catalog's curated titles have been reworded twice already. A programme with
 * no entry here draws its swatch alone, which is a finished tile — see
 * ProgramMarquee — so this map never has to be complete.
 *
 * Provenance and the rule the photos were chosen by (no identifiable face, and
 * why that is a legal matter rather than a taste one) are in
 * assets/fitness/programmes/README.md.
 */
const PROGRAMME_PHOTOS: Record<string, ImageSourcePropType> = {
  tpl_gainer_dream_body_female_v1: require('../../assets/fitness/programmes/dream-body-female.jpg'),
  tpl_gainer_dream_body_man_v1: require('../../assets/fitness/programmes/dream-body-man.jpg'),
  tpl_gainer_hourglass_shape_v1: require('../../assets/fitness/programmes/hourglass-shape.jpg'),
  tpl_shred_v1: require('../../assets/fitness/programmes/shred.jpg'),
  tpl_gainer_strong_lean_female_v1: require('../../assets/fitness/programmes/strong-lean-female.jpg'),
  tpl_6_day_ppl_v1: require('../../assets/fitness/programmes/huge-elite.jpg'),
  tpl_gainer_advanced_glutes_v1: require('../../assets/fitness/programmes/advanced-glutes.jpg'),
  tpl_gainer_lean_shred_v1: require('../../assets/fitness/programmes/lean-shred-cut.jpg'),
  tpl_gainer_athlete_conditioning_v1: require('../../assets/fitness/programmes/athlete-conditioning.jpg'),
  tpl_gainer_glute_foundations_v1: require('../../assets/fitness/programmes/glute-foundations.jpg'),
  tpl_gainer_expert_powerbuilding_v1: require('../../assets/fitness/programmes/expert-powerbuilding.jpg'),
  tpl_gainer_fat_burn_hiit_v1: require('../../assets/fitness/programmes/fat-burn-hiit.jpg'),
  tpl_gainer_calisthenics_mastery_v1: require('../../assets/fitness/programmes/calisthenics-mastery.jpg'),
  tpl_4_day_powerbuilding_v1: require('../../assets/fitness/programmes/powerbuild.jpg'),
  tpl_gainer_runners_strength_v1: require('../../assets/fitness/programmes/runners-strength.jpg'),
  tpl_season_summer_v1: require('../../assets/fitness/programmes/summer-conditioning.jpg'),
};

export function getProgrammePhoto(templateId: string): ImageSourcePropType | undefined {
  return PROGRAMME_PHOTOS[templateId];
}
