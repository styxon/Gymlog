/**
 * The "build it yourself" path: its steps, and the layouts it offers to start from.
 *
 * The editor was one long page — name, a row of day chips, two quick layouts
 * and the days — and read as the old UI (user, 2026-10-04). It is a guided
 * path now: name, days a week, a base, the days themselves, and save. What
 * that path is — which step follows which, where Back goes, which layouts a
 * day count offers — is data and arithmetic, so it lives here and is tested
 * here; the screen only draws it.
 */
import type { I18nKey } from './i18n';

export type TemplateBuilderStep = 'name' | 'days' | 'base' | 'build' | 'review';

export const TEMPLATE_BUILDER_STEPS: readonly TemplateBuilderStep[] = ['name', 'days', 'base', 'build', 'review'];

export type TemplateDayCount = 1 | 2 | 3 | 4 | 5 | 6;

export const TEMPLATE_DAY_OPTIONS: readonly TemplateDayCount[] = [1, 2, 3, 4, 5, 6];

export const MAX_TEMPLATE_DAYS: TemplateDayCount = 6;

/**
 * A layout to start from. `names` become the days' names and pick their
 * lifts (quickLayoutExercises), so they are English tokens every one of which
 * that module recognises; only the card's label and description translate.
 */
export interface SplitPreset {
  id: string;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  names: string[];
  previewKeywords: string[];
}

export const SPLIT_PRESETS: Record<TemplateDayCount, SplitPreset[]> = {
  1: [
    {
      id: 'single_full_body',
      labelKey: 'tpl.fullBody',
      descriptionKey: 'tpl.fullBodyDesc',
      names: ['Full Body'],
      previewKeywords: ['squat', 'bench', 'row'],
    },
    {
      id: 'single_upper',
      labelKey: 'tpl.upperFocus',
      descriptionKey: 'tpl.upperFocusDesc',
      names: ['Upper Focus'],
      previewKeywords: ['bench', 'pulldown', 'row'],
    },
    {
      id: 'single_lower',
      labelKey: 'tpl.lowerFocus',
      descriptionKey: 'tpl.lowerFocusDesc',
      names: ['Lower Focus'],
      previewKeywords: ['squat', 'deadlift', 'leg'],
    },
  ],
  2: [
    {
      id: 'upper_lower',
      labelKey: 'tpl.upperLower',
      descriptionKey: 'tpl.upperLowerDesc',
      names: ['Upper', 'Lower'],
      previewKeywords: ['bench', 'squat'],
    },
    {
      id: 'push_pull',
      labelKey: 'tpl.pushPull',
      descriptionKey: 'tpl.pushPullDesc',
      names: ['Push', 'Pull'],
      previewKeywords: ['press', 'row', 'pulldown'],
    },
    {
      id: 'full_body_ab',
      labelKey: 'tpl.fullBodyAb',
      descriptionKey: 'tpl.fullBodyAbDesc',
      names: ['Full Body A', 'Full Body B'],
      previewKeywords: ['squat', 'deadlift', 'press'],
    },
  ],
  3: [
    {
      id: 'push_pull_legs',
      labelKey: 'tpl.ppl',
      descriptionKey: 'tpl.pplDesc',
      names: ['Push', 'Pull', 'Legs'],
      previewKeywords: ['bench', 'row', 'leg'],
    },
    {
      id: 'full_body_abc',
      labelKey: 'tpl.fullBodyAbc',
      descriptionKey: 'tpl.fullBodyAbcDesc',
      names: ['Full Body A', 'Full Body B', 'Full Body C'],
      previewKeywords: ['squat', 'bench', 'deadlift'],
    },
    {
      id: 'upper_lower_full',
      labelKey: 'tpl.upperLowerFull',
      descriptionKey: 'tpl.upperLowerFullDesc',
      names: ['Upper', 'Lower', 'Full Body'],
      previewKeywords: ['bench', 'squat', 'row'],
    },
    {
      id: 'body_part_3',
      labelKey: 'tpl.bodyPartSplit',
      descriptionKey: 'tpl.bodyPartSplitThree',
      names: ['Chest / Back', 'Legs', 'Shoulders / Arms'],
      previewKeywords: ['chest', 'leg', 'shoulder'],
    },
  ],
  4: [
    {
      id: 'upper_lower_heavy_pump',
      labelKey: 'tpl.upperLowerX2',
      descriptionKey: 'tpl.upperLowerX2Desc',
      names: ['Upper Heavy', 'Lower Heavy', 'Upper Pump', 'Lower Pump'],
      previewKeywords: ['bench', 'squat', 'curl', 'lunge'],
    },
    {
      id: 'body_part_4',
      labelKey: 'tpl.bodyPartSplit',
      descriptionKey: 'tpl.bodyPartSplitFour',
      names: ['Chest / Triceps', 'Back / Biceps', 'Legs / Glutes', 'Shoulders / Arms'],
      previewKeywords: ['chest', 'back', 'leg', 'shoulder'],
    },
    {
      id: 'ppl_full_body',
      labelKey: 'tpl.pplFullBody',
      descriptionKey: 'tpl.pplFullBodyDesc',
      names: ['Push', 'Pull', 'Legs', 'Full Body'],
      previewKeywords: ['press', 'row', 'squat'],
    },
  ],
  5: [
    {
      id: 'body_part_5',
      labelKey: 'tpl.bodyPartSplit',
      descriptionKey: 'tpl.bodyPartSplitFive',
      names: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms'],
      previewKeywords: ['chest', 'back', 'leg', 'shoulder', 'curl'],
    },
    {
      id: 'strength_5',
      labelKey: 'tpl.strengthMix',
      descriptionKey: 'tpl.strengthMixDesc',
      names: ['Upper Strength', 'Lower Strength', 'Push Volume', 'Pull Volume', 'Legs Volume'],
      previewKeywords: ['bench', 'squat', 'press', 'row'],
    },
    {
      id: 'ppl_upper_lower',
      labelKey: 'tpl.pplUpperLower',
      descriptionKey: 'tpl.pplUpperLowerDesc',
      names: ['Push', 'Pull', 'Legs', 'Upper', 'Lower'],
      previewKeywords: ['press', 'row', 'squat'],
    },
  ],
  6: [
    {
      id: 'ppl_x2',
      labelKey: 'tpl.pplX2',
      descriptionKey: 'tpl.pplX2Desc',
      names: ['Push', 'Pull', 'Legs', 'Push Volume', 'Pull Volume', 'Legs Volume'],
      previewKeywords: ['bench', 'row', 'squat'],
    },
    {
      id: 'upper_lower_x3',
      labelKey: 'tpl.upperLowerX3',
      descriptionKey: 'tpl.upperLowerX3Desc',
      names: ['Upper Strength', 'Lower Strength', 'Upper Heavy', 'Lower Heavy', 'Upper Pump', 'Lower Pump'],
      previewKeywords: ['bench', 'squat', 'row'],
    },
    {
      id: 'body_part_6',
      labelKey: 'tpl.bodyPartSplit',
      descriptionKey: 'tpl.bodyPartSplitSix',
      names: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Glutes'],
      previewKeywords: ['chest', 'back', 'leg', 'shoulder'],
    },
  ],
};

export function clampDayCount(value: number): TemplateDayCount {
  if (!Number.isFinite(value) || value <= 1) {
    return 1;
  }
  if (value >= MAX_TEMPLATE_DAYS) {
    return MAX_TEMPLATE_DAYS;
  }
  return Math.round(value) as TemplateDayCount;
}

/** The layouts offered for a week of `dayCount` days. */
export function presetsForDayCount(dayCount: number): SplitPreset[] {
  return SPLIT_PRESETS[clampDayCount(dayCount)];
}

/**
 * Where the path opens. A programme being edited already has its name, its
 * days and its lifts, so it opens on the days — walking someone through
 * "name it" for a programme they named last week is a step that asks nothing.
 */
export function initialTemplateBuilderStep(editing: boolean): TemplateBuilderStep {
  return editing ? 'build' : 'name';
}

export function templateBuilderStepIndex(step: TemplateBuilderStep): number {
  return TEMPLATE_BUILDER_STEPS.indexOf(step);
}

export function nextTemplateBuilderStep(step: TemplateBuilderStep): TemplateBuilderStep | null {
  const index = templateBuilderStepIndex(step);
  return index >= 0 && index < TEMPLATE_BUILDER_STEPS.length - 1 ? TEMPLATE_BUILDER_STEPS[index + 1] : null;
}

/**
 * Where Back goes from a step: the step before it, or null when Back should
 * leave the screen. It leaves from the step the path opened on — an edit opens
 * on the days, and Back from there is back to the programme, not into a
 * "choose a base" page that would replace the days it came to edit. An edit
 * that jumped back to rename it or change its day count returns to the days
 * it opened on, rather than leaving from a step it never walked through.
 */
export function previousTemplateBuilderStep(step: TemplateBuilderStep, editing: boolean): TemplateBuilderStep | null {
  const index = templateBuilderStepIndex(step);
  const opened = initialTemplateBuilderStep(editing);
  const floor = templateBuilderStepIndex(opened);
  if (index < floor) {
    return opened;
  }
  return index > floor ? TEMPLATE_BUILDER_STEPS[index - 1] : null;
}

/**
 * Whether a tap on the indicator may jump to `target`. Only to a step already
 * reached: the steps ahead depend on the answers before them (the layouts
 * follow the day count), so skipping forward would land on a page built from
 * answers not yet given.
 */
export function canJumpToTemplateBuilderStep(target: TemplateBuilderStep, furthest: TemplateBuilderStep): boolean {
  return templateBuilderStepIndex(target) <= templateBuilderStepIndex(furthest);
}

/** The later of two steps — what "furthest reached" becomes after a move. */
export function laterTemplateBuilderStep(left: TemplateBuilderStep, right: TemplateBuilderStep): TemplateBuilderStep {
  return templateBuilderStepIndex(left) >= templateBuilderStepIndex(right) ? left : right;
}

interface SignatureSession {
  name: string;
  exercises: Array<{
    name: string;
    targetSets?: number | null;
    repMin?: number | null;
    repMax?: number | null;
    restSeconds?: number | null;
  }>;
}

/**
 * What a draft holds, as one comparable string: the name, and each day's name
 * and lifts with their prescription. Two drafts with the same signature would
 * save the same programme, which is what "unsaved changes" and "untouched
 * since the base was applied" both ask.
 */
export function templateDraftSignature(name: string, sessions: SignatureSession[]): string {
  return JSON.stringify([
    name.trim(),
    sessions.map((session) => [
      session.name.trim(),
      session.exercises.map((exercise) => [
        exercise.name,
        exercise.targetSets ?? null,
        exercise.repMin ?? null,
        exercise.repMax ?? null,
        exercise.restSeconds ?? null,
      ]),
    ]),
  ]);
}

/**
 * The days a base made, for baseChoiceDiscardsWork to compare against. Only
 * the days with lifts in them: an empty day added on the Days step afterwards
 * holds nothing a new base could take.
 */
export function baseSignature(sessions: SignatureSession[]): string {
  return templateDraftSignature(
    '',
    sessions.filter((session) => session.exercises.length > 0),
  );
}

/**
 * Whether choosing a base would throw work away.
 *
 * A base replaces the days. Days nobody has put a lift into lose nothing, and
 * days that are exactly what the last base made lose nothing either — trying
 * Push / Pull / Legs and then Full Body A/B/C is browsing, not editing. Any
 * other lift in any day is the reader's own, and replacing it is asked first.
 */
export function baseChoiceDiscardsWork(sessions: SignatureSession[], lastBaseSignature: string | null): boolean {
  if (sessions.every((session) => session.exercises.length === 0)) {
    return false;
  }
  return lastBaseSignature === null || baseSignature(sessions) !== lastBaseSignature;
}
