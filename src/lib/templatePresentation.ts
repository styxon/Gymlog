import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { AppLanguage } from '../types/models';
import { formatWorkoutDisplayLabel } from './displayLabel';
import { I18nKey, t } from './i18n';
import { getReadyProgramContent } from './readyProgramContent';

export interface CustomTemplatePresentationInput {
  name: string;
  sessionCount: number;
  exerciseCount: number;
}

export interface TemplatePresentation {
  title: string;
  subtitle: string;
  tags: string[];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function dedupeTags(tags: string[]) {
  return [...new Set(tags)].slice(0, 3);
}

/**
 * Custom programs are named by the user, so the shape of the week is inferred
 * from that name. Titles and blurbs come from the dictionary; the user's own
 * name is only replaced when the inference is confident enough to name a shape.
 */
export function getCustomTemplatePresentation(
  template: CustomTemplatePresentationInput,
  language: AppLanguage = 'en',
): TemplatePresentation {
  const normalized = normalize(template.name);

  const isUpper = includesAny(normalized, ['upper', 'ylä', 'yla', 'push', 'chest', 'back', 'shoulder', 'arms']);
  const isLower = includesAny(normalized, ['lower', 'ala', 'legs', 'leg', 'glute', 'quad', 'hamstring']);
  const isFullBody = includesAny(normalized, ['full body', 'fullbody', 'koko', 'body']);
  const isHeavy = includesAny(normalized, ['heavy', 'strength', 'voima', 'power']);
  const isPump = includesAny(normalized, ['pump', 'volume', 'mass', 'hypertrophy', 'growth']);
  const isRun = includesAny(normalized, ['run', 'running', 'tempo', 'cardio', 'conditioning']);
  const isGlutes = includesAny(normalized, ['glute', 'glutes', 'pakara']);
  const isChest = includesAny(normalized, ['chest', 'rinta', 'bench', 'penk']);
  const isBack = includesAny(normalized, ['back', 'row', 'pull', 'selkä', 'selka']);

  let title = formatWorkoutDisplayLabel(template.name, t(language, 'prog.custom.fallbackName'));
  let subtitle = t(language, 'prog.custom.counts', {
    sessions: template.sessionCount,
    exercises: template.exerciseCount,
  });
  const tagKeys: I18nKey[] = [];

  if (isUpper) {
    tagKeys.push('prog.tag.upper');
  } else if (isLower) {
    tagKeys.push('prog.tag.lower');
  } else if (isFullBody) {
    tagKeys.push('prog.tag.fullBody');
  }

  if (isGlutes) {
    tagKeys.push('prog.tag.glutes');
  } else if (isChest) {
    tagKeys.push('prog.tag.chest');
  } else if (isBack) {
    tagKeys.push('prog.tag.back');
  } else if (isRun) {
    tagKeys.push('prog.tag.conditioning');
  }

  if (isHeavy) {
    tagKeys.push('prog.tag.heavy');
  } else if (isPump) {
    tagKeys.push('prog.tag.mass');
  }

  /** Named shapes, most specific first — the first match wins. */
  const shape =
    [
      { when: isUpper && isHeavy, slug: 'upperHeavy' },
      { when: isUpper && isPump, slug: 'upperPump' },
      { when: isLower && isHeavy, slug: 'lowerHeavy' },
      { when: isLower && isPump, slug: 'lowerPump' },
      { when: isGlutes && isPump, slug: 'gluteGrowth' },
      { when: isChest && isPump, slug: 'chestBuilder' },
      { when: isChest && isHeavy, slug: 'pressFocus' },
      { when: isBack && isPump, slug: 'backDensity' },
      { when: isRun, slug: 'conditioning' },
      { when: isFullBody && isHeavy, slug: 'fullBodyStrength' },
      { when: isFullBody && isPump, slug: 'fullBodyVolume' },
    ].find((entry) => entry.when) ?? null;

  if (shape) {
    title = t(language, `prog.custom.${shape.slug}.title` as I18nKey);
    subtitle = t(language, `prog.custom.${shape.slug}.sub` as I18nKey);
  } else if (template.sessionCount >= 4) {
    subtitle = t(language, 'prog.custom.sub.fourPlus');
  } else if (template.sessionCount === 3) {
    subtitle = t(language, 'prog.custom.sub.three');
  }

  return {
    title,
    subtitle,
    tags: dedupeTags(tagKeys.map((key) => t(language, key))),
  };
}

/**
 * Curated presentation for the ready programs. The family name (STRONG, HUGE,
 * FIT…) is the product's own, so only the blurb and tags are translated.
 */
const READY_TEMPLATE_PRESENTATION: Record<string, { title: string; tagKeys: I18nKey[] }> = {
  tpl_2_day_beginner_strength_v1: {
    title: 'STRONG Starter',
    tagKeys: ['prog.tag.strength', 'prog.tag.beginner'],
  },
  tpl_2_day_minimal_full_body_v1: {
    title: 'HOME Starter',
    tagKeys: ['prog.tag.fullBody', 'prog.tag.minimal'],
  },
  tpl_2_day_mobility_reset_v1: {
    title: 'RESET',
    tagKeys: ['prog.tag.recovery', 'prog.tag.mobility'],
  },
  tpl_2_day_yoga_recovery_v1: {
    title: 'RESET Yoga',
    tagKeys: ['prog.tag.recovery', 'prog.tag.yoga'],
  },
  tpl_3_day_full_body_v1: {
    title: 'FIT',
    tagKeys: ['prog.tag.fullBody', 'prog.tag.balanced'],
  },
  tpl_3_day_strength_base_v1: {
    title: 'STRONG',
    tagKeys: ['prog.tag.strength', 'prog.tag.heavy'],
  },
  tpl_3_day_upper_lower_lite_v1: {
    title: 'FIT Lite',
    tagKeys: ['prog.tag.upperLower', 'prog.tag.balanced'],
  },
  tpl_3_day_push_pull_legs_v1: {
    title: 'HUGE',
    tagKeys: ['prog.tag.ppl', 'prog.tag.mass'],
  },
  tpl_3_day_run_mobility_v1: {
    title: 'RUN',
    tagKeys: ['prog.tag.conditioning', 'prog.tag.recovery'],
  },
  tpl_4_day_upper_lower_v1: {
    title: 'HUGE Pro',
    tagKeys: ['prog.tag.upperLower', 'prog.tag.mass'],
  },
  tpl_4_day_muscle_builder_v1: {
    title: 'HUGE Builder',
    tagKeys: ['prog.tag.mass', 'prog.tag.growth'],
  },
  tpl_4_day_powerbuilding_v1: {
    title: 'POWERBUILD',
    tagKeys: ['prog.tag.strength', 'prog.tag.mass'],
  },
  tpl_4_day_strength_size_v1: {
    title: 'STRONG Pro',
    tagKeys: ['prog.tag.strength', 'prog.tag.size'],
  },
  tpl_5_day_hybrid_v1: {
    title: 'HUGE Advanced',
    tagKeys: ['prog.tag.hybrid', 'prog.tag.mass'],
  },
  tpl_season_summer_v1: {
    title: 'Summer Conditioning',
    tagKeys: ['prog.tag.season', 'prog.tag.running'],
  },
  tpl_season_winter_v1: {
    title: 'Winter Build',
    tagKeys: ['prog.tag.season', 'prog.tag.strength'],
  },
  tpl_4_day_ppl_plus_v1: {
    title: 'HUGE Pro+',
    tagKeys: ['prog.tag.ppl', 'prog.tag.mass'],
  },
  tpl_5_day_ppl_v1: {
    title: 'HUGE Volume',
    tagKeys: ['prog.tag.ppl', 'prog.tag.mass'],
  },
  tpl_5_day_upper_lower_full_v1: {
    title: 'HUGE Hybrid',
    tagKeys: ['prog.tag.upperLower', 'prog.tag.mass'],
  },
  tpl_6_day_ppl_v1: {
    title: 'HUGE Elite',
    tagKeys: ['prog.tag.ppl', 'prog.tag.mass'],
  },
  tpl_6_day_arnold_v1: {
    title: 'HUGE Classic',
    tagKeys: ['prog.tag.mass', 'prog.tag.advanced'],
  },
  tpl_focus_chest_v1: {
    title: 'Chest Day',
    tagKeys: ['prog.tag.chest', 'prog.tag.singleSession'],
  },
  tpl_focus_back_v1: {
    title: 'Back Day',
    tagKeys: ['prog.tag.back', 'prog.tag.singleSession'],
  },
  tpl_focus_shoulders_v1: {
    title: 'Shoulder Day',
    tagKeys: ['prog.tag.shoulders', 'prog.tag.singleSession'],
  },
  tpl_focus_arms_v1: {
    title: 'Arm Day',
    tagKeys: ['prog.tag.arms', 'prog.tag.singleSession'],
  },
  tpl_focus_legs_v1: {
    title: 'Leg Day',
    tagKeys: ['prog.tag.legs', 'prog.tag.singleSession'],
  },
  tpl_focus_glutes_v1: {
    title: 'Glute Day',
    tagKeys: ['prog.tag.glutes', 'prog.tag.singleSession'],
  },
  tpl_shred_v1: {
    title: 'SHRED',
    tagKeys: ['prog.tag.fatLoss', 'prog.tag.conditioning'],
  },
  tpl_huge_starter_v1: {
    title: 'HUGE Starter',
    tagKeys: ['prog.tag.fullBody', 'prog.tag.beginner'],
  },
  tpl_focus_chest_program_v1: {
    title: 'FOCUS Chest',
    tagKeys: ['prog.tag.chest', 'prog.tag.specialisation'],
  },
  tpl_focus_back_program_v1: {
    title: 'FOCUS Back',
    tagKeys: ['prog.tag.back', 'prog.tag.specialisation'],
  },
  tpl_focus_arms_program_v1: {
    title: 'FOCUS Arms',
    tagKeys: ['prog.tag.arms', 'prog.tag.specialisation'],
  },
  tpl_focus_legs_program_v1: {
    title: 'FOCUS Legs',
    tagKeys: ['prog.tag.legs', 'prog.tag.specialisation'],
  },
  tpl_focus_glutes_program_v1: {
    title: 'FOCUS Glutes',
    tagKeys: ['prog.tag.glutes', 'prog.tag.specialisation'],
  },
  tpl_strong_elite_v1: {
    title: 'STRONG Elite',
    tagKeys: ['prog.tag.strength', 'prog.tag.twelveWeeks'],
  },
  tpl_fit_elite_v1: {
    title: 'FIT Elite',
    tagKeys: ['prog.tag.conditioning', 'prog.tag.twelveWeeks'],
  },
  tpl_shred_elite_v1: {
    title: 'SHRED Elite',
    tagKeys: ['prog.tag.fatLoss', 'prog.tag.hiit'],
  },
  tpl_gainer_dream_body_man_v1: {
    title: 'Dream Body Man',
    tagKeys: ['prog.tag.mass', 'prog.tag.size'],
  },
  tpl_gainer_beginner_bro_split_v1: {
    title: 'Bro Split',
    tagKeys: ['prog.tag.mass', 'prog.tag.beginner'],
  },
  tpl_gainer_advanced_ppl_v1: {
    title: 'Advanced Push Pull Legs',
    tagKeys: ['prog.tag.ppl', 'prog.tag.advanced'],
  },
  tpl_gainer_expert_powerbuilding_v1: {
    title: 'Expert Powerbuilding',
    tagKeys: ['prog.tag.strength', 'prog.tag.mass'],
  },
  tpl_gainer_lean_shred_v1: {
    title: 'Lean Shred Cut',
    tagKeys: ['prog.tag.fatLoss', 'prog.tag.hiit'],
  },
  tpl_gainer_dream_body_female_v1: {
    title: 'Dream Body Female',
    tagKeys: ['prog.tag.glutes', 'prog.tag.mass'],
  },
  tpl_gainer_glute_foundations_v1: {
    title: 'Glute Foundations',
    tagKeys: ['prog.tag.glutes', 'prog.tag.beginner'],
  },
  tpl_gainer_advanced_glutes_v1: {
    title: 'Advanced Glutes',
    tagKeys: ['prog.tag.glutes', 'prog.tag.advanced'],
  },
  tpl_gainer_hourglass_shape_v1: {
    title: 'Hourglass Shape',
    tagKeys: ['prog.tag.glutes', 'prog.tag.core'],
  },
  tpl_gainer_fat_burn_hiit_v1: {
    title: 'Fat Burn HIIT',
    tagKeys: ['prog.tag.hiit', 'prog.tag.fatLoss'],
  },
  tpl_gainer_mobility_flow_v1: {
    title: 'Mobility Flow',
    tagKeys: ['prog.tag.mobility', 'prog.tag.recovery'],
  },
  tpl_gainer_at_home_beginner_v1: {
    title: 'At Home - No Equipment',
    tagKeys: ['prog.tag.home', 'prog.tag.bodyweight'],
  },
  tpl_home_dumbbell_upper_lower_v1: {
    title: 'Home Dumbbell Upper/Lower',
    tagKeys: ['prog.tag.home', 'prog.tag.upperLower'],
  },
  tpl_home_dumbbell_ppl_v1: {
    title: 'Home Dumbbell Push/Pull/Legs',
    tagKeys: ['prog.tag.home', 'prog.tag.ppl'],
  },
  tpl_home_dumbbell_strength_v1: {
    title: 'Home Dumbbell Strength',
    tagKeys: ['prog.tag.home', 'prog.tag.strength'],
  },
  tpl_home_dumbbell_strength_split_v1: {
    title: 'Home Dumbbell Strength Split',
    tagKeys: ['prog.tag.home', 'prog.tag.strength'],
  },
  tpl_home_bodyweight_upper_lower_v1: {
    title: 'Bodyweight Upper/Lower',
    tagKeys: ['prog.tag.bodyweight', 'prog.tag.upperLower'],
  },
  tpl_home_bodyweight_full_body_v1: {
    title: 'Bodyweight Full Body',
    tagKeys: ['prog.tag.bodyweight', 'prog.tag.fullBody'],
  },
  tpl_home_bodyweight_ppl_v1: {
    title: 'Bodyweight Push/Pull/Legs',
    tagKeys: ['prog.tag.bodyweight', 'prog.tag.ppl'],
  },
  tpl_athletic_starter_v1: {
    title: 'Athletic Starter',
    tagKeys: ['prog.tag.athletic', 'prog.tag.fullBody'],
  },
  tpl_home_athletic_5_day_v1: {
    title: 'Home Athletic',
    tagKeys: ['prog.tag.home', 'prog.tag.athletic'],
  },
  tpl_athletic_upper_lower_4_day_v1: {
    title: 'Athletic Upper/Lower',
    tagKeys: ['prog.tag.athletic', 'prog.tag.upperLower'],
  },
  tpl_athletic_performance_5_day_v1: {
    title: 'Athletic Performance',
    tagKeys: ['prog.tag.athletic', 'prog.tag.conditioning'],
  },
  tpl_home_dumbbell_athletic_5_day_v1: {
    title: 'Home Dumbbell Athletic',
    tagKeys: ['prog.tag.home', 'prog.tag.athletic'],
  },
  tpl_home_bodyweight_strength_3_day_v1: {
    title: 'Bodyweight Strength',
    tagKeys: ['prog.tag.home', 'prog.tag.strength'],
  },
  tpl_home_calisthenics_strength_5_day_v1: {
    title: 'Calisthenics Strength',
    tagKeys: ['prog.tag.bodyweight', 'prog.tag.strength'],
  },
  tpl_gainer_calisthenics_mastery_v1: {
    title: 'Calisthenics Mastery',
    tagKeys: ['prog.tag.bodyweight', 'prog.tag.advanced'],
  },
  tpl_gainer_strength_5x5_v1: {
    title: 'Strength Foundations 5x5',
    tagKeys: ['prog.tag.strength', 'prog.tag.heavy'],
  },
  tpl_gainer_athlete_conditioning_v1: {
    title: 'Athlete Conditioning',
    tagKeys: ['prog.tag.athletic', 'prog.tag.conditioning'],
  },
  tpl_gainer_strong_lean_female_v1: {
    title: 'Strong & Lean Female',
    tagKeys: ['prog.tag.strength', 'prog.tag.size'],
  },
  tpl_gainer_joint_friendly_v1: {
    title: 'Joint-Friendly Strength',
    tagKeys: ['prog.tag.jointFriendly', 'prog.tag.fullBody'],
  },
  tpl_gainer_prenatal_fitness_v1: {
    title: 'Prenatal Fitness',
    tagKeys: ['prog.tag.prenatal', 'prog.tag.mobility'],
  },
  tpl_gainer_postpartum_recovery_v1: {
    title: 'Postpartum Recovery',
    tagKeys: ['prog.tag.postpartum', 'prog.tag.core'],
  },
  tpl_gainer_runners_strength_v1: {
    title: "Runner's Strength",
    tagKeys: ['prog.tag.running', 'prog.tag.strength'],
  },
};

/** Day counts on the curated cards, e.g. "3 Days" / "3 pv". */
const CURATED_DAYS: Record<string, number> = {
  tpl_2_day_beginner_strength_v1: 2,
  tpl_2_day_minimal_full_body_v1: 2,
  tpl_2_day_mobility_reset_v1: 2,
  tpl_2_day_yoga_recovery_v1: 2,
  tpl_3_day_full_body_v1: 3,
  tpl_3_day_strength_base_v1: 3,
  tpl_3_day_upper_lower_lite_v1: 3,
  tpl_3_day_push_pull_legs_v1: 3,
  tpl_3_day_run_mobility_v1: 3,
  tpl_4_day_upper_lower_v1: 4,
  tpl_4_day_muscle_builder_v1: 4,
  tpl_4_day_powerbuilding_v1: 4,
  tpl_4_day_strength_size_v1: 4,
  tpl_5_day_hybrid_v1: 5,
};

/**
 * The day chip. English needs the singular: the one-session focus workouts read
 * "1 Days" without it, and they are the only programs in the catalog that run
 * for a single day.
 */
function daysTagKey(days: number): I18nKey {
  return days === 1 ? 'prog.tag.day' : 'prog.tag.days';
}

function formatSplitTagKey(template: WorkoutTemplateV1): I18nKey {
  if (template.splitType === 'upper_lower') {
    return 'prog.tag.upperLower';
  }

  if (template.splitType === 'full_body') {
    return 'prog.tag.fullBody';
  }

  return 'prog.tag.hybrid';
}

function formatGoalTagKey(template: WorkoutTemplateV1): I18nKey {
  if (template.goalType === 'strength') {
    return 'prog.tag.strength';
  }

  if (template.goalType === 'hypertrophy') {
    return 'prog.tag.mass';
  }

  return 'prog.tag.balanced';
}

export function getReadyTemplatePresentation(
  template: WorkoutTemplateV1,
  language: AppLanguage = 'en',
  /**
   * Days the user actually runs, when the caller knows it.
   *
   * The catalog template's own day count is not what gets saved — a 2-day
   * base composed up to the user's 3 days is a 3-day week. Callers that hold
   * the composed week pass its count here so the tag agrees with every other
   * surface. Passing the rendered tag through a regex afterwards only worked
   * in English, which is how "3 treeniä viikossa" ended up beside a "2 pv"
   * chip on the same card.
   */
  daysPerWeekOverride?: number,
): TemplatePresentation {
  const curated = READY_TEMPLATE_PRESENTATION[template.id];
  if (curated) {
    return {
      title: curated.title,
      subtitle: t(language, `prog.sub.${template.id}` as I18nKey),
      tags: dedupeTags([
        ...curated.tagKeys.map((key) => t(language, key)),
        t(language, daysTagKey(daysPerWeekOverride ?? CURATED_DAYS[template.id] ?? template.daysPerWeek), {
          count: daysPerWeekOverride ?? CURATED_DAYS[template.id] ?? template.daysPerWeek,
        }),
      ]),
    };
  }

  const content = getReadyProgramContent(template.id, language);
  const days = daysPerWeekOverride ?? template.daysPerWeek;

  return {
    title: formatWorkoutDisplayLabel(template.name, t(language, 'prog.custom.fallbackName')),
    subtitle: content?.summary ?? t(language, 'prog.sub.fallback', { days, goal: template.goalType }),
    tags: dedupeTags([
      t(language, formatSplitTagKey(template)),
      t(language, formatGoalTagKey(template)),
      t(language, daysTagKey(days), { count: days }),
    ]),
  };
}
