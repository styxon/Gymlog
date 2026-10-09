import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { I18nKey } from './i18n';
import { meetsCardioFocus } from './programCatalogFocus';
import { resolveProgramEquipmentBucket } from './programEquipment';

/**
 * Nine ways into 55 programs.
 *
 * The catalog is currently one flat rail plus a search field, which is fine at
 * eight programs and unusable at fifty-five. Every category here is derived
 * from what a template actually declares — goal, level, split, and the family
 * its id belongs to — rather than a hand-kept list per category, so a new
 * program lands in the right places the day it is added and cannot be quietly
 * missing from all of them.
 *
 * Derivation has one cost worth naming: a program can appear under more than
 * one category, and that is correct. "Strength Foundations 5x5" is both
 * strength and beginner, and hiding it from one of them to keep the sets
 * disjoint would make both rows worse.
 */

export type ProgramCategoryKey =
  | 'strength'
  | 'balanced'
  | 'muscle'
  | 'fatloss'
  | 'conditioning'
  | 'home'
  | 'mobility'
  | 'focus'
  | 'beginner';

export interface ProgramCategory {
  key: ProgramCategoryKey;
  labelKey: I18nKey;
  /** Drives the tile tint — one hue per category, as in the browse design. */
  hue: number;
  /**
   * The tile's three colours, pre-converted from the design's oklch.
   *
   * React Native has no oklch, and eyeballing nine hues into hex by hand drifts
   * — two neighbouring categories end up the same colour and the tiles stop
   * being distinguishable at a glance, which is the only reason they are
   * coloured at all. These came out of an actual oklch→sRGB conversion of
   * `0.94/0.045`, `0.88/0.05` and `0.48/0.16` at the hue above.
   */
  tint: { bg: string; border: string; ink: string };
  /**
   * 24-unit stroke path, drawn in white and knocked out of a solid `ink` disc.
   *
   * Every mark sits inside an 18–19 unit optical box so a row of nine carries one
   * weight, and each is one idea: no dumbbell tucked inside the house, because at
   * 30px that turns to mush. There is exactly one circle and one arc in the whole
   * set — a silhouette that repeats inside a row stops being a silhouette.
   */
  icon: string;
  /**
   * What the category is actually about, for the sheet header.
   *
   * "Voima · 8 ohjelmaa" says how many but not what kind, and the label alone
   * cannot: "Yleiskunto" and "Rasvanpoltto" both sound like a cut until one of
   * them says it keeps the lifting in.
   */
  focusKey: I18nKey;
}

export const PROGRAM_CATEGORIES: readonly ProgramCategory[] = [
  {
    key: 'strength',
    labelKey: 'programs.cat.strength',
    focusKey: 'programs.catFocus.strength',
    hue: 268,
    tint: { bg: '#DEEBFF', border: '#C9D7FA', ink: '#3853B6' },
    icon: 'M2.6 9.6v4.8M6.6 6.8v10.4M17.4 6.8v10.4M21.4 9.6v4.8M6.6 12h10.8',
  },
  {
    key: 'balanced',
    labelKey: 'programs.cat.balanced',
    focusKey: 'programs.catFocus.balanced',
    hue: 96,
    tint: { bg: '#F4ECCA', border: '#E1D8B3', ink: '#795900' },
    icon: 'M12 4.8v14.7M8 19.5h8M3.8 8.6h16.4M1.4 8.6q3 4.6 6 0M15.2 8.6q3 4.6 6 0',
  },
  {
    key: 'muscle',
    labelKey: 'programs.cat.muscle',
    focusKey: 'programs.catFocus.muscle',
    hue: 222,
    tint: { bg: '#CBF3FF', border: '#B4E0EF', ink: '#006D9D' },
    icon: 'M4.8 19.5v-5.6M12 19.5v-8.6M19.2 19.5v-11.6',
  },
  {
    key: 'fatloss',
    labelKey: 'programs.cat.fatloss',
    focusKey: 'programs.catFocus.fatloss',
    hue: 28,
    tint: { bg: '#FFE1DB', border: '#F7CCC5', ink: '#A52A24' },
    icon: 'M12.8 3c.4 3.4 5.4 5.6 5.4 9.4a6.2 6.2 0 0 1-12.4 0c0-2.8 1.8-4.7 3.2-6.2-.2 2.6 1.2 3.4 2.2 2.7 1.6-1.1 2.3-3.4 1.6-5.9z',
  },
  {
    key: 'conditioning',
    labelKey: 'programs.cat.conditioning',
    focusKey: 'programs.catFocus.conditioning',
    hue: 156,
    tint: { bg: '#D4F5DF', border: '#BEE2CA', ink: '#007633' },
    icon: 'M2.6 12.6h4l2-6.4 3.2 12.2 2.2-5.8h7.4',
  },
  {
    key: 'home',
    labelKey: 'programs.cat.home',
    focusKey: 'programs.catFocus.home',
    hue: 62,
    tint: { bg: '#FFE5CD', border: '#F0D1B7', ink: '#994000' },
    icon: 'M3.4 10.9 12 3.7l8.6 7.2M5.6 9.7V20h12.8V9.7',
  },
  {
    key: 'mobility',
    labelKey: 'programs.cat.mobility',
    focusKey: 'programs.catFocus.mobility',
    hue: 300,
    tint: { bg: '#EFE5FF', border: '#DCD1F4', ink: '#6D41A9' },
    icon: 'M6.6 16V4.8M8 17.4 18.6 12.2M6.6 12.6A5.4 5.4 0 0 1 11.4 15.6M8 17.9a1.4 1.4 0 1 0-2.8 0 1.4 1.4 0 0 0 2.8 0',
  },
  {
    key: 'focus',
    labelKey: 'programs.cat.focus',
    focusKey: 'programs.catFocus.focus',
    hue: 200,
    tint: { bg: '#C9F5F7', border: '#B2E2E4', ink: '#007581' },
    icon: 'M12 19.3a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6M12 2.8v1.9M12 19.3v1.9M2.8 12h1.9M19.3 12h1.9M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
  },
  {
    key: 'beginner',
    labelKey: 'programs.cat.beginner',
    focusKey: 'programs.catFocus.beginner',
    hue: 12,
    tint: { bg: '#FFE0E3', border: '#F7CBCF', ink: '#A32745' },
    icon: 'M6.2 3.4v17.2M6.2 4.6h11.4l-2.3 4 2.3 4H6.2',
  },
];

/**
 * Ids whose family cannot be read off goalType or the sessions.
 *
 * Kept small and explicit. Cutting programs are `general` like a dozen others,
 * and the catalog simply does not encode "this is a cut", so that category
 * names its members.
 */
const FAT_LOSS_IDS = new Set([
  'tpl_shred_v1',
  'tpl_shred_elite_v1',
  'tpl_gainer_lean_shred_v1',
  'tpl_gainer_fat_burn_hiit_v1',
]);

/**
 * Conditioning is read off the sessions (meetsCardioFocus) — except for a
 * runner's gym week, which holds no running because the reader brings their
 * own. Its card says it is for runners, and a runner browsing "Running &
 * conditioning" is who it is for.
 */
const BUILT_FOR_RUNNERS_IDS = new Set(['tpl_gainer_runners_strength_v1']);

const MOBILITY_IDS = new Set([
  'tpl_2_day_mobility_reset_v1',
  'tpl_2_day_yoga_recovery_v1',
  'tpl_gainer_mobility_flow_v1',
  'tpl_gainer_joint_friendly_v1',
]);

/**
 * The two categories read off a template's content, worked out once per
 * template: the tiles, their counts and the catalog chips each ask about every
 * programme, and the answer never changes.
 *
 * Both used to be hand-kept id lists, and they drifted from what the
 * programmes hold. "Running & conditioning" listed Calisthenics Mastery at 4%
 * conditioning and left out SHRED, Fat Burn HIIT, Summer Conditioning and four
 * more at 25% or over; "Home" left out Fat Burn HIIT, which the recommender
 * hands to home readers as needing no gym, and RUN and Mobility Flow (bug
 * hunt, 2026-10-09).
 */
const contentCategories = new WeakMap<WorkoutTemplateV1, { conditioning: boolean; home: boolean }>();

function readContentCategories(template: WorkoutTemplateV1) {
  let entry = contentCategories.get(template);
  if (!entry) {
    const exerciseNames = template.sessions.flatMap((session) =>
      session.exercises.map((exercise) => exercise.exerciseName),
    );
    entry = {
      // The Cardio chip's threshold, so the tile and the chip agree.
      conditioning: meetsCardioFocus(template) || BUILT_FOR_RUNNERS_IDS.has(template.id),
      // The bucket the recommender's equipment tier and the low-equipment chip
      // read: a programme whose gear a reader can own at home.
      home: resolveProgramEquipmentBucket(exerciseNames) === 'low_equipment',
    };
    contentCategories.set(template, entry);
  }
  return entry;
}

export function isInCategory(template: WorkoutTemplateV1, key: ProgramCategoryKey): boolean {
  switch (key) {
    case 'strength':
      return template.goalType === 'strength';
    case 'balanced':
      // The FIT family and everything else built for general fitness rather
      // than one outcome. Added after a test found FIT Elite in no category
      // at all: FIT and FIT Lite were only reachable through "beginner", so
      // the moment the family had an advanced entry it fell off the screen.
      // Overlap with fat loss and mobility is correct — SHRED really is both
      // a general-fitness program and a cut.
      return template.goalType === 'general' && !template.id.startsWith('tpl_focus_');
    case 'muscle':
      // The single-muscle days are hypertrophy too, but they belong under
      // "muscle group" — a one-day add-on is not a growth program.
      return template.goalType === 'hypertrophy' && !template.id.startsWith('tpl_focus_');
    case 'fatloss':
      return FAT_LOSS_IDS.has(template.id);
    case 'conditioning':
      return readContentCategories(template).conditioning;
    case 'home':
      return readContentCategories(template).home;
    case 'mobility':
      return MOBILITY_IDS.has(template.id);
    case 'focus':
      return template.id.startsWith('tpl_focus_');
    case 'beginner':
      return template.level === 'beginner';
    default:
      return false;
  }
}

export function filterByCategory(
  templates: readonly WorkoutTemplateV1[],
  key: ProgramCategoryKey | null,
): WorkoutTemplateV1[] {
  if (!key) {
    return [...templates];
  }
  return templates.filter((template) => isInCategory(template, key));
}

/** How many programs each category would show — the tile can say so. */
export function countByCategory(
  templates: readonly WorkoutTemplateV1[],
): Record<ProgramCategoryKey, number> {
  const counts = {} as Record<ProgramCategoryKey, number>;
  for (const category of PROGRAM_CATEGORIES) {
    counts[category.key] = templates.filter((template) => isInCategory(template, category.key)).length;
  }
  return counts;
}
