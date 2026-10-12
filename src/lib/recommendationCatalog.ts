import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { Vinha_PROGRAM_RECOMMENDATIONS } from '../features/workout/gainerProgramCatalog';
import type { SetupAgeRange, SetupEquipment, SetupFocusArea, SetupGoal, SetupLevel, SetupSecondaryOutcome } from '../types/models';
import type { RecommendationProgramDefinition, TemplateFamilyId } from '../types/recommendation';
import { readyTemplateCardMinutes } from './programmeMinutes';

function defineProgram(
  programId: string,
  config: {
    familyId: TemplateFamilyId;
    supportedGoals: SetupGoal[];
    backupGoals?: SetupGoal[];
    supportedLevels: SetupLevel[];
    equipmentTier: RecommendationProgramDefinition['equipmentTier'];
    recoveryDemand: RecommendationProgramDefinition['recoveryDemand'];
    styleTags: RecommendationProgramDefinition['styleTags'];
    secondaryOutcomeTags?: SetupSecondaryOutcome[];
    focusAreaTags?: SetupFocusArea[];
    lowFriction?: boolean;
    jointFriendly?: boolean;
    targetGender?: RecommendationProgramDefinition['targetGender'];
  },
): RecommendationProgramDefinition {
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    throw new Error(`Unknown recommendation program: ${programId}`);
  }
  let minutes: number | undefined;

  return {
    programId,
    familyId: config.familyId,
    supportedGoals: config.supportedGoals,
    backupGoals: config.backupGoals ?? [],
    supportedLevels: config.supportedLevels,
    equipmentTier: config.equipmentTier,
    recoveryDemand: config.recoveryDemand,
    styleTags: config.styleTags,
    secondaryOutcomeTags: config.secondaryOutcomeTags ?? [],
    focusAreaTags: config.focusAreaTags ?? [],
    lowFriction: config.lowFriction ?? false,
    jointFriendly: config.jointFriendly ?? false,
    targetGender: config.targetGender ?? 'unisex',
    daysPerWeek: template.daysPerWeek,
    // The minutes the cards and Home show, estimated from the sessions. The
    // hand-written figure is what was scored, and it differed from the card's
    // by 10 minutes or more on 39 of 51 programmes (catalog audit, 2026-10-05).
    // Worked out on first read, not when the catalog loads: estimating all of
    // them up front cost every app start tens of milliseconds (review).
    get estimatedSessionMinutes() {
      minutes ??= readyTemplateCardMinutes(template);
      return minutes;
    },
  };
}

export const RECOMMENDATION_PROGRAMS: RecommendationProgramDefinition[] = [
  defineProgram('tpl_2_day_minimal_full_body_v1', {
    familyId: 'full_body_minimal',
    supportedGoals: ['general', 'general_fitness'],
    backupGoals: ['muscle', 'strength'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'low',
    // Not 'express' since 2026-10-12: each day closes on twelve minutes of
    // run blocks, and the session is about fifty minutes.
    styleTags: ['balanced'],
    secondaryOutcomeTags: ['consistency'],
    focusAreaTags: ['core', 'legs'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_2_day_beginner_strength_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['general', 'general_fitness'],
    supportedLevels: ['beginner'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'express'],
    secondaryOutcomeTags: ['consistency', 'strength'],
    // Chest went (user, 2026-10-06: a promised area gets six sets a week).
    // Four sets of bench were all it had, and both days sit at the top of the
    // card's 40 minutes, so there was no room for more.
    focusAreaTags: ['legs', 'back'],
    lowFriction: true,
  }),
  defineProgram('tpl_3_day_strength_base_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['muscle', 'general', 'lean_athletic'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'balanced'],
    secondaryOutcomeTags: ['strength', 'consistency'],
    focusAreaTags: ['legs', 'chest', 'back'],
  }),
  defineProgram('tpl_4_day_strength_size_v1', {
    familyId: 'powerbuilding',
    supportedGoals: ['strength'],
    backupGoals: ['general', 'lean_athletic'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'balanced'],
    secondaryOutcomeTags: ['strength', 'muscle'],
    focusAreaTags: ['legs', 'chest', 'back', 'shoulders'],
  }),
  defineProgram('tpl_4_day_powerbuilding_v1', {
    familyId: 'powerbuilding',
    supportedGoals: ['strength', 'muscle'],
    backupGoals: ['general', 'lean_athletic'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['heavy', 'pump'],
    secondaryOutcomeTags: ['strength', 'muscle'],
    focusAreaTags: ['legs', 'chest', 'back', 'arms'],
  }),
  // FIT is defined before FIT Lite on purpose: waterfall ties resolve to the
  // family flagship, and Lite stays the low-recovery variant.
  defineProgram('tpl_3_day_full_body_v1', {
    familyId: 'full_body_minimal',
    supportedGoals: ['general', 'general_fitness'],
    backupGoals: ['muscle'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    // Not 'express' since 2026-10-12: a conditioning block follows the lifts
    // every day (about a third of the week), and the session is about fifty
    // minutes. FIT Lite is the shorter one.
    styleTags: ['balanced'],
    secondaryOutcomeTags: ['consistency'],
    focusAreaTags: ['legs', 'chest', 'back'],
    lowFriction: true,
  }),
  defineProgram('tpl_3_day_upper_lower_lite_v1', {
    familyId: 'athletic_recomp',
    supportedGoals: ['general', 'general_fitness'],
    backupGoals: ['strength', 'muscle', 'lean_athletic'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'low',
    styleTags: ['balanced', 'express', 'machine_guided'],
    secondaryOutcomeTags: ['consistency'],
    // Arms went on 2026-10-12, when the week became lighter lifting and close
    // to half conditioning: it no longer trains them. Conditioning came in.
    focusAreaTags: ['conditioning', 'back', 'chest', 'legs'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_push_pull_legs_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'back', 'arms', 'legs'],
  }),
  defineProgram('tpl_4_day_muscle_builder_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general', 'lean_athletic'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced', 'machine_guided'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['glutes', 'legs', 'chest', 'back'],
    jointFriendly: true,
  }),
  defineProgram('tpl_4_day_upper_lower_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general', 'lean_athletic', 'strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['balanced', 'pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['legs', 'chest', 'back'],
  }),
  defineProgram('tpl_5_day_hybrid_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['balanced', 'pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'back', 'arms', 'legs'],
  }),
  defineProgram('tpl_6_day_ppl_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle', 'general_fitness'],
    backupGoals: ['strength', 'general', 'lean_athletic'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle', 'strength'],
    focusAreaTags: ['chest', 'back', 'arms', 'legs', 'shoulders'],
  }),
  defineProgram('tpl_2_day_mobility_reset_v1', {
    familyId: 'joint_friendly',
    supportedGoals: ['general', 'general_fitness', 'run_mobility'],
    backupGoals: [],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'low',
    styleTags: ['recovery', 'express'],
    secondaryOutcomeTags: ['mobility', 'consistency'],
    focusAreaTags: ['mobility'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_2_day_yoga_recovery_v1', {
    familyId: 'joint_friendly',
    supportedGoals: ['run_mobility'],
    backupGoals: ['general', 'general_fitness'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'low',
    styleTags: ['recovery'],
    secondaryOutcomeTags: ['mobility', 'consistency'],
    focusAreaTags: ['mobility'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_run_mobility_v1', {
    familyId: 'athletic_recomp',
    supportedGoals: ['run_mobility', 'general'],
    backupGoals: [],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['conditioning', 'balanced'],
    secondaryOutcomeTags: ['conditioning', 'mobility'],
    focusAreaTags: ['conditioning'],
    // Not joint-friendly since 2026-10-12 (owner): running is about 72 % of
    // the week's time. A reader whose knees or ankles are flagged still gets
    // its runs as walks or rides (cautionExerciseFilter, RUN_STAND_INS).
  }),
  defineProgram('tpl_shred_v1', {
    familyId: 'athletic_recomp',
    supportedGoals: ['lean_athletic', 'general'],
    backupGoals: ['general_fitness', 'muscle'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['conditioning', 'balanced'],
    secondaryOutcomeTags: ['conditioning', 'consistency'],
    focusAreaTags: ['conditioning', 'legs'],
    lowFriction: true,
  }),
  defineProgram('tpl_huge_starter_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general', 'general_fitness'],
    supportedLevels: ['beginner'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'low',
    styleTags: ['pump', 'express', 'machine_guided'],
    secondaryOutcomeTags: ['muscle', 'consistency'],
    focusAreaTags: ['chest', 'back', 'legs'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_focus_chest_program_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'shoulders', 'arms'],
  }),
  defineProgram('tpl_focus_back_program_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['back', 'arms'],
  }),
  defineProgram('tpl_focus_arms_program_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['arms', 'shoulders'],
  }),
  defineProgram('tpl_focus_legs_program_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness', 'strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['legs', 'quads', 'hamstrings', 'calves'],
  }),
  defineProgram('tpl_focus_glutes_program_v1', {
    familyId: 'glute_priority',
    supportedGoals: ['muscle'],
    backupGoals: ['lean_athletic', 'general_fitness'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['glutes', 'hamstrings', 'legs'],
  }),
  // ── The top of each family ──────────────────────────────────────────────
  // These existed in the catalog with written copy and were reachable only by
  // browsing: nothing registered them here, so no set of onboarding answers
  // could ever produce them. That left the "pro" level with nothing above the
  // intermediate tier to hand out — it behaved exactly like "advanced".
  defineProgram('tpl_strong_elite_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['muscle', 'general_fitness'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['heavy'],
    secondaryOutcomeTags: ['strength'],
    focusAreaTags: ['back', 'legs', 'chest'],
  }),
  defineProgram('tpl_fit_elite_v1', {
    familyId: 'athletic_recomp',
    supportedGoals: ['general', 'general_fitness'],
    backupGoals: ['lean_athletic', 'muscle'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['balanced', 'conditioning'],
    secondaryOutcomeTags: ['conditioning', 'strength'],
    // Core went (user, 2026-10-06: a promised area gets six sets a week). It
    // had three sets of plank, and three more would have taken the short day
    // over the card's 35 minutes.
    focusAreaTags: ['legs', 'back'],
  }),
  defineProgram('tpl_shred_elite_v1', {
    familyId: 'athletic_recomp',
    // Lean and athletic is a backup since 2026-10-08, as on Athlete Conditioning
    // below: Athletic Performance is the five-day week written for the goal at
    // advanced and pro, and a pro-only listing outbid it by the one point the
    // pro level adds to a programme that lists both levels.
    supportedGoals: ['general_fitness'],
    backupGoals: ['lean_athletic', 'general', 'muscle'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['conditioning', 'balanced'],
    secondaryOutcomeTags: ['conditioning'],
    focusAreaTags: ['core', 'legs'],
  }),
  defineProgram('tpl_6_day_arnold_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'back', 'arms', 'shoulders'],
  }),
  defineProgram('tpl_gainer_expert_powerbuilding_v1', {
    familyId: 'powerbuilding',
    supportedGoals: ['strength', 'muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['heavy', 'pump'],
    secondaryOutcomeTags: ['strength', 'muscle'],
    focusAreaTags: ['back', 'legs', 'chest'],
  }),
  defineProgram('tpl_gainer_athlete_conditioning_v1', {
    familyId: 'athletic_recomp',
    // Speed, agility and sprint work for an athlete: a backup for lean and
    // athletic since 2026-10-08, when the unisex four- and five-day weeks took
    // the goal (see tpl_shred_elite_v1 above).
    supportedGoals: ['general_fitness'],
    backupGoals: ['lean_athletic', 'general', 'run_mobility'],
    supportedLevels: ['pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['conditioning', 'balanced'],
    secondaryOutcomeTags: ['conditioning'],
    focusAreaTags: ['core', 'legs'],
  }),
  defineProgram('tpl_gainer_calisthenics_mastery_v1', {
    familyId: 'low_equipment',
    supportedGoals: ['muscle', 'general_fitness'],
    backupGoals: ['lean_athletic', 'general'],
    supportedLevels: ['pro'],
    // The one advanced program that needs no gym: without it a home lifter
    // past the beginner tier had nothing but beginner content.
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['balanced', 'pump'],
    secondaryOutcomeTags: ['muscle', 'consistency'],
    // Arms went (user, 2026-10-06: a promised area gets six sets a week).
    // Four sets of weighted dips were the only arm work, and every day already
    // runs at or over the card's 55 minutes.
    focusAreaTags: ['core', 'chest', 'back'],
  }),

  // ── The high-frequency middle of HUGE ───────────────────────────────────
  // Four, five and six sessions a week existed with nothing registered to
  // serve them, so asking for five days got a four-day program every time.
  defineProgram('tpl_4_day_ppl_plus_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness', 'strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'back', 'legs'],
  }),
  defineProgram('tpl_5_day_ppl_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump'],
    secondaryOutcomeTags: ['muscle'],
    focusAreaTags: ['chest', 'back', 'legs', 'arms'],
  }),
  defineProgram('tpl_5_day_upper_lower_full_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['general_fitness', 'strength'],
    supportedLevels: ['advanced', 'pro'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'high',
    styleTags: ['pump'],
    secondaryOutcomeTags: ['muscle', 'strength'],
    focusAreaTags: ['back', 'legs', 'chest'],
  }),

  // ── Joint-friendly, for the mobility branch that asks for this family ────
  defineProgram('tpl_gainer_joint_friendly_v1', {
    familyId: 'joint_friendly',
    supportedGoals: ['general', 'general_fitness'],
    // Strength as a backup since 2026-10-12 (owner): supported machine lifts
    // are strength work, and without it a beginner over 41 who wants strength
    // had no lower-impact card that listed the goal.
    backupGoals: ['muscle', 'run_mobility', 'strength'],
    supportedLevels: ['beginner'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'low',
    styleTags: ['balanced', 'recovery', 'machine_guided'],
    secondaryOutcomeTags: ['mobility', 'consistency'],
    focusAreaTags: ['legs', 'back'],
    lowFriction: true,
    jointFriendly: true,
  }),

  ...Vinha_PROGRAM_RECOMMENDATIONS.map((program) => defineProgram(program.programId, program)),

  // ── The age gaps (owner, 2026-10-12) ────────────────────────────────────
  // Last on purpose: a waterfall tie keeps the programme defined first, so
  // these never take a pick the rest of the catalog already rated equal for
  // a reader the age rule is not about. WALK and HOME Easy are offered only
  // to a reader over 41, STRONG Guided only at 16-18 and over 41
  // (ageGateAllows).
  defineProgram('tpl_3_day_walk_mobility_v1', {
    familyId: 'low_impact',
    supportedGoals: ['general_fitness', 'general'],
    backupGoals: ['lean_athletic', 'run_mobility'],
    supportedLevels: ['beginner', 'advanced', 'pro'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'low',
    styleTags: ['balanced', 'conditioning'],
    secondaryOutcomeTags: ['conditioning', 'mobility', 'consistency'],
    focusAreaTags: ['conditioning', 'mobility'],
    lowFriction: true,
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_guided_strength_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['muscle', 'general'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'balanced', 'machine_guided'],
    secondaryOutcomeTags: ['strength', 'consistency'],
    focusAreaTags: ['legs', 'back', 'chest'],
    // Since 2026-10-12 (owner): the six-rep sets are on guided machines and
    // cables, no barbell.
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_home_easy_strength_v1', {
    familyId: 'low_impact',
    // Muscle a backup since 2026-10-12 (owner): close to half of the week is
    // walking, and listed as written for muscle it led the cards of a reader
    // over 41 who asked for muscle at home. HUGE Home is that week now.
    supportedGoals: ['general_fitness'],
    backupGoals: ['muscle', 'strength'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'low',
    styleTags: ['balanced'],
    secondaryOutcomeTags: ['consistency', 'strength'],
    focusAreaTags: ['legs', 'chest', 'back'],
    lowFriction: true,
    jointFriendly: true,
  }),
  // STRONG Home and HUGE Bodyweight (owner, 2026-10-12): the two gear lanes the
  // age rule still had no week for over 41, from an audit of 26,460 answers.
  // Both go to a reader over 41 only (ageGateAllows). STRONG Home is STRONG
  // Guided's week for a pair of dumbbells: sets of six on the anchor lifts, no
  // barbell, no jumps. HUGE Bodyweight is HUGE Home's week with nothing to
  // hold. Neither lists general fitness: no minute of either is cardio.
  defineProgram('tpl_3_day_strong_home_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['muscle'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'balanced'],
    secondaryOutcomeTags: ['strength', 'consistency'],
    focusAreaTags: ['legs', 'back', 'chest'],
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_huge_bodyweight_v1', {
    familyId: 'low_equipment',
    supportedGoals: ['muscle'],
    backupGoals: ['strength'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle', 'consistency'],
    focusAreaTags: ['legs', 'chest', 'back'],
    jointFriendly: true,
  }),
  // STRONG Bodyweight (owner, 2026-10-12): strength with no equipment, the last
  // gap in the audit of 26,460 answers over 41 (1,260 answers, no card fitting).
  // Over 41 only (ageGateAllows). Sets of six on hard versions of bodyweight
  // lifts (rear-foot-elevated split squat, one-leg hinge, feet-up push-up,
  // table row), no jumps, no weights. Muscle as the backup; not general
  // fitness: no minute of it is cardio.
  defineProgram('tpl_3_day_strong_bodyweight_v1', {
    familyId: 'strength_base',
    supportedGoals: ['strength'],
    backupGoals: ['muscle'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['heavy', 'balanced'],
    secondaryOutcomeTags: ['strength', 'consistency'],
    focusAreaTags: ['legs', 'back', 'chest'],
    jointFriendly: true,
  }),
  // The muscle weeks over 41 (owner, 2026-10-12): three full-body days at 10
  // to 15 reps, at the gym on machines and cables, at home on dumbbells alone.
  // HUGE Guided goes to the two bands the age rule is about, as STRONG Guided
  // does; HUGE Home over 41 only (ageGateAllows). Strength as a backup (ten
  // to fifteen reps build some); not general fitness: a week without cardio
  // is outside the 30-50 % the owner set for that goal.
  defineProgram('tpl_3_day_huge_guided_v1', {
    familyId: 'mass_hypertrophy',
    supportedGoals: ['muscle'],
    backupGoals: ['strength'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'full_gym',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced', 'machine_guided'],
    secondaryOutcomeTags: ['muscle', 'consistency'],
    focusAreaTags: ['legs', 'chest', 'back', 'shoulders'],
    jointFriendly: true,
  }),
  defineProgram('tpl_3_day_huge_home_v1', {
    familyId: 'low_equipment',
    supportedGoals: ['muscle'],
    backupGoals: ['strength'],
    supportedLevels: ['beginner', 'advanced'],
    equipmentTier: 'low_equipment',
    recoveryDemand: 'moderate',
    styleTags: ['pump', 'balanced'],
    secondaryOutcomeTags: ['muscle', 'consistency'],
    focusAreaTags: ['legs', 'chest', 'back', 'shoulders'],
    jointFriendly: true,
  }),
];

export function getRecommendationProgramDefinition(programId: string) {
  return RECOMMENDATION_PROGRAMS.find((entry) => entry.programId === programId) ?? null;
}

/**
 * A week of stretching and nothing else: the joint-friendly family's mobility
 * and yoga programmes. The supported joint-friendly programme lifts, and its
 * 'balanced' tag says so.
 */
export function isRecoveryOnlyProgram(definition: Pick<RecommendationProgramDefinition, 'familyId' | 'styleTags'>) {
  return definition.familyId === 'joint_friendly' && !definition.styleTags.includes('balanced');
}

/**
 * Whether the reader asked for a recovery week: running and mobility as the
 * goal, or mobility as an outcome or a focus. Nobody else is handed one as
 * their programme. "Lose weight" at five days at a gym was given five days of
 * stretching under "a balanced week that covers strength, condition, and
 * energy", because the mobility flow fitted the day count (bug hunt,
 * 2026-10-07).
 */
export function readerAskedForRecovery(
  input: { goal: SetupGoal; secondaryOutcomes: readonly SetupSecondaryOutcome[]; focusAreas: readonly SetupFocusArea[] },
) {
  return input.goal === 'run_mobility' || input.secondaryOutcomes.includes('mobility') || input.focusAreas.includes('mobility');
}

export const WALK_PROGRAM_ID = 'tpl_3_day_walk_mobility_v1';
export const GUIDED_STRENGTH_PROGRAM_ID = 'tpl_3_day_guided_strength_v1';
export const HOME_EASY_PROGRAM_ID = 'tpl_3_day_home_easy_strength_v1';
export const STRONG_HOME_PROGRAM_ID = 'tpl_3_day_strong_home_v1';
export const HUGE_BODYWEIGHT_PROGRAM_ID = 'tpl_3_day_huge_bodyweight_v1';
export const STRONG_BODYWEIGHT_PROGRAM_ID = 'tpl_3_day_strong_bodyweight_v1';
export const HUGE_GUIDED_PROGRAM_ID = 'tpl_3_day_huge_guided_v1';
export const HUGE_HOME_PROGRAM_ID = 'tpl_3_day_huge_home_v1';

/** The answers the age rule reads. */
interface AgeRuleReader {
  ageRange: SetupAgeRange | null;
  equipment: SetupEquipment;
  level: SetupLevel;
  goal: SetupGoal;
  secondaryOutcomes: readonly SetupSecondaryOutcome[];
  focusAreas: readonly SetupFocusArea[];
  availableEquipment?: readonly string[] | null;
}

/** The chips that put a weight in the reader's hands. */
const LOAD_CHIPS = ['Dumbbells', 'Kettlebells', 'Barbells', 'Barbell & plates'];

/**
 * Whether the reader can lift a weight: the gym card, or a dumbbell,
 * kettlebell or barbell among their own chips.
 */
export function readerOwnsLoad(input: Pick<AgeRuleReader, 'equipment' | 'availableEquipment'>): boolean {
  return input.equipment === 'gym' || (input.availableEquipment ?? []).some((item) => LOAD_CHIPS.includes(item));
}

/**
 * A walking week (WALK, HOME Easy: 42-45 % of the time walking) is never the
 * answer to a lifting goal for a reader who can lift (owner, 2026-10-12).
 * HOME Easy as muscle's own week led the cards of a reader over 41 with
 * dumbbells, and a walking week was the age rule's second card for one who
 * asked for strength. Without a weight it may still be the second card,
 * which over 41 must be a lower-impact one (ageRuleGuaranteesCard); beside
 * HOME Starter it is the only one that lists the goal. Never the featured
 * one: HOME Easy lists muscle and strength only as backups, so the answers
 * never lead with it.
 */
function walkingWeekAnswersLiftingGoal(input: Pick<AgeRuleReader, 'goal' | 'equipment' | 'availableEquipment'>): boolean {
  return (input.goal === 'muscle' || input.goal === 'strength') && readerOwnsLoad(input);
}

/**
 * Whether a programme suits the reader's age band (owner, 2026-10-12): over
 * 41, a joint-friendly or lower-impact week; 16-18 with the gym card, a week
 * lifted mostly on guided machines. Every other band, and a reader who left
 * the age out, has no age-fitting programme: the rule only ever adds a card,
 * it never marks one down for being young or old.
 */
export function programFitsReaderAge(
  definition: Pick<RecommendationProgramDefinition, 'familyId' | 'jointFriendly' | 'styleTags'>,
  input: Pick<AgeRuleReader, 'ageRange' | 'equipment'>,
): boolean {
  if (input.ageRange === '41_plus') {
    return definition.jointFriendly || definition.familyId === 'low_impact';
  }
  if (input.ageRange === '18' && input.equipment === 'gym') {
    return definition.styleTags.includes('machine_guided');
  }
  return false;
}

/**
 * Whether the second card must be an age-fitting one when neither card is:
 * every reader over 41, and a 16-18-year-old with the gym card at the
 * beginner or advanced level. At pro the stated level decides (owner,
 * 2026-10-12): the machine weeks are beginner and intermediate content.
 */
export function ageRuleGuaranteesCard(input: Pick<AgeRuleReader, 'ageRange' | 'equipment' | 'level'>): boolean {
  if (input.ageRange === '41_plus') {
    return true;
  }
  return input.ageRange === '18' && input.equipment === 'gym' && input.level !== 'pro';
}

/**
 * Whether the setup may offer this programme to the reader at all.
 *
 * The lower-impact weeks (WALK, HOME Easy) go to a reader over 41, the way a
 * week of stretching goes only to a reader who asked for one
 * (readerAskedForRecovery). The owner's rule also let a reader who asked for
 * mobility or recovery have them at any age; that moved the two cards of
 * 5,229 of 79,380 answers at 19-40 (run and mobility at home: RUN + Fat Burn
 * HIIT became RUN + WALK), against the same day's acceptance that those
 * bands do not move. The acceptance won; widening this is one line.
 *
 * STRONG Guided goes to the two bands the age rule is about. It is a sound
 * week for anyone and the Programs tab lists it for everyone; offered to the
 * other bands it only took the second card from the strength or muscle week
 * their answers had chosen (owner's acceptance, 2026-10-12: the offers of
 * 19-40 do not move). HUGE Guided, its muscle counterpart, the same.
 *
 * HUGE Home goes to a reader over 41 only. At 16-18 the age rule asks for
 * machines, which a dumbbell week at home has none of.
 *
 * Over 41, the walking weeks also stay away from a lifting goal when the
 * reader can lift (walkingWeekAnswersLiftingGoal).
 */
export function ageGateAllows(
  definition: Pick<RecommendationProgramDefinition, 'programId' | 'familyId'>,
  input: AgeRuleReader,
): boolean {
  if (definition.familyId === 'low_impact') {
    return input.ageRange === '41_plus' && !walkingWeekAnswersLiftingGoal(input);
  }
  if (definition.programId === GUIDED_STRENGTH_PROGRAM_ID || definition.programId === HUGE_GUIDED_PROGRAM_ID) {
    return input.ageRange === '41_plus' || input.ageRange === '18';
  }
  if (
    definition.programId === HUGE_HOME_PROGRAM_ID
    || definition.programId === STRONG_HOME_PROGRAM_ID
    || definition.programId === HUGE_BODYWEIGHT_PROGRAM_ID
    || definition.programId === STRONG_BODYWEIGHT_PROGRAM_ID
  ) {
    return input.ageRange === '41_plus';
  }
  return true;
}
