import { WorkoutGoalType, WorkoutLevel, WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { TailoringPreferencesInput, getPreferredReadyEquipmentFilter, sortReadyDiscoveryItemsByTailoring } from './tailoringFit';
import { resolveProgramEquipmentBucket } from './programEquipment';
import { ProgrammeMinutesOptions, readyTemplateCardMinutes } from './programmeMinutes';
import { ReadyProgramContent } from './readyProgramContent';

export type ReadyTimeFilter = 'all' | 'short' | 'balanced' | 'long';
export type ReadyEquipmentFilter = 'all' | 'full_gym' | 'low_equipment';
export type ReadyLevelFilter = 'all' | WorkoutLevel;

export interface ReadyDiscoveryFilters {
  query: string;
  goal: 'all' | WorkoutGoalType;
  level: ReadyLevelFilter;
  time: ReadyTimeFilter;
  equipment: ReadyEquipmentFilter;
}

export interface ReadyDiscoveryItem {
  template: WorkoutTemplateV1;
  content: ReadyProgramContent | null;
  /**
   * The session length the Programs card quotes for this programme
   * (`readyTemplateCardMinutes`). The plans screen prints it and the time
   * filter buckets by it, so the two cannot disagree; neither reads the
   * catalog's hand-written `estimatedSessionDuration`, which was 10+ minutes
   * off the card on 43 of 68 programmes (bug hunt, 2026-10-05, B14).
   */
  minutes: number;
}

export function buildReadyDiscoveryItem(
  template: WorkoutTemplateV1,
  content: ReadyProgramContent | null,
  minutesOptions: ProgrammeMinutesOptions = {},
): ReadyDiscoveryItem {
  return { template, content, minutes: readyTemplateCardMinutes(template, minutesOptions) };
}

const READY_PROGRAM_TRADEOFFS: Record<string, string> = {
  tpl_3_day_full_body_v1: 'Tradeoff: less body-part specialization than an upper/lower or hybrid split.',
  tpl_4_day_upper_lower_v1: 'Tradeoff: needs four reliable training slots to feel worth it.',
  tpl_5_day_hybrid_v1: 'Tradeoff: highest weekly commitment and the most recovery demand in the library.',
  tpl_2_day_minimal_full_body_v1: 'Tradeoff: simplest weekly dose, so progress is steadier than aggressive.',
  tpl_3_day_strength_base_v1: 'Tradeoff: more repeated heavy practice, less novelty across the week.',
  tpl_4_day_powerbuilding_v1: 'Tradeoff: asks for both barbell performance and enough recovery for higher volume days.',
  tpl_2_day_beginner_strength_v1: 'Tradeoff: lower weekly frequency than 3-day strength templates.',
  tpl_3_day_upper_lower_lite_v1: 'Tradeoff: balanced and approachable, but less aggressive than a full 4-day split.',
  tpl_3_day_push_pull_legs_v1: 'Tradeoff: each movement family gets one main day per week.',
  tpl_4_day_muscle_builder_v1: 'Tradeoff: more gym time and less strength emphasis than simpler starter plans.',
  tpl_4_day_strength_size_v1: 'Tradeoff: heavier first-half sessions need a steadier recovery week.',
  tpl_2_day_mobility_reset_v1: 'Tradeoff: recovery-first, so it will not drive classic lifting progression.',
  tpl_2_day_yoga_recovery_v1: 'Tradeoff: calm movement work first, minimal pure strength carryover.',
  tpl_3_day_run_mobility_v1: 'Tradeoff: run-and-reset focus, not a full lifting split.',
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function getReadyProgramTimeBucket(durationMinutes: number): Exclude<ReadyTimeFilter, 'all'> {
  if (durationMinutes <= 45) {
    return 'short';
  }

  if (durationMinutes <= 60) {
    return 'balanced';
  }

  return 'long';
}

export function getReadyProgramEquipmentBucket(item: ReadyDiscoveryItem): Exclude<ReadyEquipmentFilter, 'all'> {
  return resolveProgramEquipmentBucket(
    item.template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName)),
  );
}

export function getReadyProgramTradeoff(templateId: string) {
  return READY_PROGRAM_TRADEOFFS[templateId] ?? 'Tradeoff: this plan works best when your week matches the template closely.';
}

export function buildReadyProgramSearchText(item: ReadyDiscoveryItem) {
  return normalizeText(
    [
      item.template.name,
      item.template.goalType,
      item.template.level,
      item.content?.summary,
      item.content?.audience,
      item.content?.whyItWorks,
      item.content?.equipmentProfile,
      getReadyProgramTradeoff(item.template.id),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function filterReadyDiscoveryItems(items: ReadyDiscoveryItem[], filters: ReadyDiscoveryFilters) {
  const normalizedQuery = normalizeText(filters.query);

  return items.filter((item) => {
    if (filters.goal !== 'all' && item.template.goalType !== filters.goal) {
      return false;
    }

    if (filters.level !== 'all' && item.template.level !== filters.level) {
      return false;
    }

    if (filters.time !== 'all' && getReadyProgramTimeBucket(item.minutes) !== filters.time) {
      return false;
    }

    if (filters.equipment !== 'all' && getReadyProgramEquipmentBucket(item) !== filters.equipment) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return buildReadyProgramSearchText(item).includes(normalizedQuery);
  });
}

export function filterAndSortReadyDiscoveryItems(
  items: ReadyDiscoveryItem[],
  filters: ReadyDiscoveryFilters,
  preferences?: TailoringPreferencesInput | null,
) {
  return sortReadyDiscoveryItemsByTailoring(filterReadyDiscoveryItems(items, filters), preferences);
}
