import { I18nKey, t } from './i18n';
import { AiPlannerExperience, AiPlannerGoal, AppLanguage, AppPreferences } from '../types/models';

/**
 * "Tekoälyn avulla" from the new-programme sheet: the coach asks the frame of
 * the week itself, one tap per question, and hands the answers to the
 * composer as a brief.
 *
 * It used to open an empty chat and leave the reader to describe a programme
 * in their own words — which is how a brief ends up as "3 päivää" with the
 * goal, the length and the equipment left to whatever onboarding stored. The
 * questions are local: nothing here reaches the model and none of it touches
 * the question quota. Only the composition the last button asks for is
 * billed, the same as a brief the coach offered in conversation.
 *
 * The brief is written so parseProgrammeBrief reads every answer back — the
 * offline composer builds from those signals, and the live one gets the same
 * sentence as text. tests/lib/programIntake.test.cjs holds that round trip.
 */

export type ProgramIntakeStep = 'goal' | 'days' | 'minutes' | 'equipment' | 'experience' | 'extra';
export type ProgramIntakeEquipment = 'gym' | 'home_dumbbells' | 'bodyweight';

export interface ProgramIntakeAnswers {
  goal: AiPlannerGoal | null;
  days: number | null;
  minutes: number | null;
  equipment: ProgramIntakeEquipment | null;
  experience: AiPlannerExperience | null;
  /** What else the reader wrote. '' once skipped; null while unasked. */
  extra: string | null;
}

export interface ProgramIntakeState {
  answers: ProgramIntakeAnswers;
  /**
   * What the app already knows, offered as the choice to confirm. Never an
   * answer by itself: the reader still taps, so a stale onboarding value
   * cannot slip into the brief unseen.
   */
  preset: Pick<ProgramIntakeAnswers, 'goal' | 'days' | 'equipment' | 'experience'>;
}

export interface ProgramIntakeOption {
  value: string;
  labelKey: I18nKey;
}

export const PROGRAM_INTAKE_STEPS: readonly ProgramIntakeStep[] = [
  'goal',
  'days',
  'minutes',
  'equipment',
  'experience',
  'extra',
];

export const PROGRAM_INTAKE_QUESTION_KEYS: Record<ProgramIntakeStep, I18nKey> = {
  goal: 'programIntake.q.goal',
  days: 'programIntake.q.days',
  minutes: 'programIntake.q.minutes',
  equipment: 'programIntake.q.equipment',
  experience: 'programIntake.q.experience',
  extra: 'programIntake.q.extra',
};

/** The free-text answer's ceiling: a sentence or two, not a second brief. */
export const PROGRAM_INTAKE_EXTRA_MAX_CHARS = 240;

const OPTIONS: Record<Exclude<ProgramIntakeStep, 'extra'>, readonly ProgramIntakeOption[]> = {
  goal: [
    { value: 'muscle', labelKey: 'programIntake.goal.muscle' },
    { value: 'strength', labelKey: 'programIntake.goal.strength' },
    { value: 'fat_loss', labelKey: 'programIntake.goal.fat_loss' },
    { value: 'fitness', labelKey: 'programIntake.goal.fitness' },
  ],
  days: [
    { value: '2', labelKey: 'programIntake.days.2' },
    { value: '3', labelKey: 'programIntake.days.3' },
    { value: '4', labelKey: 'programIntake.days.4' },
    { value: '5', labelKey: 'programIntake.days.5' },
    { value: '6', labelKey: 'programIntake.days.6' },
  ],
  minutes: [
    { value: '30', labelKey: 'programIntake.minutes.30' },
    { value: '45', labelKey: 'programIntake.minutes.45' },
    { value: '60', labelKey: 'programIntake.minutes.60' },
    { value: '75', labelKey: 'programIntake.minutes.75' },
  ],
  equipment: [
    { value: 'gym', labelKey: 'programIntake.equipment.gym' },
    { value: 'home_dumbbells', labelKey: 'programIntake.equipment.home_dumbbells' },
    { value: 'bodyweight', labelKey: 'programIntake.equipment.bodyweight' },
  ],
  experience: [
    { value: 'beginner', labelKey: 'programIntake.experience.beginner' },
    { value: 'intermediate', labelKey: 'programIntake.experience.intermediate' },
    { value: 'advanced', labelKey: 'programIntake.experience.advanced' },
  ],
};

/** The taps a step offers. The last step is free text and offers none. */
export function programIntakeOptions(step: ProgramIntakeStep): readonly ProgramIntakeOption[] {
  return step === 'extra' ? [] : OPTIONS[step];
}

const EMPTY_ANSWERS: ProgramIntakeAnswers = {
  goal: null,
  days: null,
  minutes: null,
  equipment: null,
  experience: null,
  extra: null,
};

export type ProgramIntakePreferences = Pick<
  AppPreferences,
  | 'aiPlannerGoal'
  | 'aiPlannerDaysPerWeek'
  | 'aiPlannerExperience'
  | 'aiPlannerEquipment'
  | 'setupGoal'
  | 'setupDaysPerWeek'
  | 'setupLevel'
  | 'setupTrainingEnvironment'
  | 'setupEquipment'
>;

function presetGoal(preferences: ProgramIntakePreferences): AiPlannerGoal | null {
  if (preferences.aiPlannerGoal) {
    return preferences.aiPlannerGoal;
  }
  switch (preferences.setupGoal) {
    case 'strength':
      return 'strength';
    case 'muscle':
      return 'muscle';
    // The same reading the planner context makes (aiCoachPlan): the other
    // onboarding goals are all general fitness to the composer.
    case 'general':
    case 'general_fitness':
    case 'lean_athletic':
    case 'run_mobility':
      return 'fitness';
    default:
      return null;
  }
}

function presetDays(preferences: ProgramIntakePreferences): number | null {
  // The planner's own value first, as everywhere else. One day is a value the
  // planner stores but this question does not offer, so it presets nothing.
  const days = preferences.aiPlannerDaysPerWeek ?? preferences.setupDaysPerWeek ?? null;
  return days !== null && days >= 2 && days <= 6 ? days : null;
}

function presetEquipment(preferences: ProgramIntakePreferences): ProgramIntakeEquipment | null {
  switch (preferences.aiPlannerEquipment) {
    case 'full_gym':
      return 'gym';
    case 'home_gym':
    case 'minimal':
      return 'home_dumbbells';
    case 'bodyweight':
      return 'bodyweight';
    default:
      break;
  }
  switch (preferences.setupTrainingEnvironment) {
    case 'full_gym':
      return 'gym';
    case 'home_gym':
    case 'minimal_equipment':
      return 'home_dumbbells';
    case 'bodyweight_only':
      return 'bodyweight';
    default:
      break;
  }
  switch (preferences.setupEquipment) {
    case 'gym':
      return 'gym';
    case 'home':
    case 'minimal':
      return 'home_dumbbells';
    default:
      return null;
  }
}

function presetExperience(preferences: ProgramIntakePreferences): AiPlannerExperience | null {
  if (preferences.aiPlannerExperience) {
    return preferences.aiPlannerExperience;
  }
  // Onboarding's levels carry their years on the card: Amateur 0–1, Advanced
  // 1–3, Pro 3+. Those are the three answers here.
  switch (preferences.setupLevel) {
    case 'beginner':
      return 'beginner';
    case 'advanced':
      return 'intermediate';
    case 'pro':
      return 'advanced';
    default:
      return null;
  }
}

export function startProgramIntake(preferences: ProgramIntakePreferences): ProgramIntakeState {
  return {
    answers: { ...EMPTY_ANSWERS },
    preset: {
      goal: presetGoal(preferences),
      days: presetDays(preferences),
      equipment: presetEquipment(preferences),
      experience: presetExperience(preferences),
    },
  };
}

/** The question still open, or null once every one is answered. */
export function currentProgramIntakeStep(state: ProgramIntakeState): ProgramIntakeStep | null {
  return PROGRAM_INTAKE_STEPS.find((step) => state.answers[step] === null) ?? null;
}

/** The option the app already knows for a step, if it offers one. */
export function programIntakePresetValue(state: ProgramIntakeState, step: ProgramIntakeStep): string | null {
  if (step === 'goal' || step === 'days' || step === 'equipment' || step === 'experience') {
    const value = state.preset[step];
    return value === null || value === undefined ? null : String(value);
  }
  return null;
}

/**
 * Answer the open question. A value the step does not offer leaves the state
 * as it was, so a stale tap on an old bubble cannot write the wrong field.
 * The free-text step takes any text; blank is the skip.
 */
export function answerProgramIntake(state: ProgramIntakeState, value: string): ProgramIntakeState {
  const step = currentProgramIntakeStep(state);
  if (step === null) {
    return state;
  }
  if (step === 'extra') {
    const extra = value.replace(/\s+/g, ' ').trim().slice(0, PROGRAM_INTAKE_EXTRA_MAX_CHARS);
    return { ...state, answers: { ...state.answers, extra } };
  }
  if (!OPTIONS[step].some((option) => option.value === value)) {
    return state;
  }
  const answers: ProgramIntakeAnswers = { ...state.answers };
  if (step === 'goal') {
    answers.goal = value as AiPlannerGoal;
  } else if (step === 'days') {
    answers.days = Number(value);
  } else if (step === 'minutes') {
    answers.minutes = Number(value);
  } else if (step === 'equipment') {
    answers.equipment = value as ProgramIntakeEquipment;
  } else {
    answers.experience = value as AiPlannerExperience;
  }
  return { ...state, answers };
}

function optionLabel(step: Exclude<ProgramIntakeStep, 'extra'>, value: string, language: AppLanguage): string {
  const option = OPTIONS[step].find((entry) => entry.value === value);
  return option ? t(language, option.labelKey) : value;
}

/** The reader's side of the thread for one answer, as their own bubble says it. */
export function programIntakeAnswerText(
  step: ProgramIntakeStep,
  value: string,
  language: AppLanguage,
): string {
  if (step === 'extra') {
    const extra = value.replace(/\s+/g, ' ').trim();
    return extra || t(language, 'programIntake.skip');
  }
  if (step === 'days') {
    return t(language, 'programIntake.daysAnswer', { count: value });
  }
  return optionLabel(step, value, language);
}

const BRIEF_GOAL_KEYS: Record<AiPlannerGoal, I18nKey> = {
  muscle: 'programIntake.brief.goal.muscle',
  strength: 'programIntake.brief.goal.strength',
  fat_loss: 'programIntake.brief.goal.fat_loss',
  fitness: 'programIntake.brief.goal.fitness',
};

const BRIEF_EQUIPMENT_KEYS: Record<ProgramIntakeEquipment, I18nKey> = {
  gym: 'programIntake.brief.equipment.gym',
  home_dumbbells: 'programIntake.brief.equipment.home_dumbbells',
  bodyweight: 'programIntake.brief.equipment.bodyweight',
};

const BRIEF_EXPERIENCE_KEYS: Record<AiPlannerExperience, I18nKey> = {
  beginner: 'programIntake.brief.experience.beginner',
  intermediate: 'programIntake.brief.experience.intermediate',
  advanced: 'programIntake.brief.experience.advanced',
};

/** A sentence that ends, so the brief parser reads it as its own. */
function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The brief the composer gets, in the reader's language.
 *
 * Each answer is worded so the brief parser reads it back: the goal word, "N
 * päivää", "N min", the place. 75+ is written as "75 min" and more, since the
 * parser takes the number and a "+" would hide it. The free text goes last,
 * as written, so an injury or a lift in it is read with the same rules as a
 * brief typed in conversation — and the days the parser finds first are the
 * days that were tapped.
 */
export function buildProgramIntakeBrief(answers: ProgramIntakeAnswers, language: AppLanguage): string {
  const sentences: string[] = [];
  if (answers.goal) {
    sentences.push(t(language, BRIEF_GOAL_KEYS[answers.goal]));
  }
  if (answers.days !== null && answers.minutes !== null) {
    sentences.push(
      t(language, answers.minutes >= 75 ? 'programIntake.brief.scheduleLong' : 'programIntake.brief.schedule', {
        days: answers.days,
        minutes: answers.minutes,
      }),
    );
  } else if (answers.days !== null) {
    sentences.push(t(language, 'programIntake.brief.days', { days: answers.days }));
  }
  if (answers.equipment) {
    sentences.push(t(language, BRIEF_EQUIPMENT_KEYS[answers.equipment]));
  }
  if (answers.experience) {
    sentences.push(t(language, BRIEF_EXPERIENCE_KEYS[answers.experience]));
  }
  if (answers.extra) {
    sentences.push(asSentence(answers.extra));
  }
  return sentences.join(' ');
}

/** The answers on one line, over the build button: "Lihasmassa · 3 pv/vko · 60 min · Sali · 1–3 v". */
export function buildProgramIntakeFrame(answers: ProgramIntakeAnswers, language: AppLanguage): string {
  const parts: string[] = [];
  if (answers.goal) {
    parts.push(optionLabel('goal', answers.goal, language));
  }
  if (answers.days !== null) {
    parts.push(t(language, 'programIntake.frame.days', { count: answers.days }));
  }
  if (answers.minutes !== null) {
    parts.push(optionLabel('minutes', String(answers.minutes), language));
  }
  if (answers.equipment) {
    parts.push(optionLabel('equipment', answers.equipment, language));
  }
  if (answers.experience) {
    parts.push(optionLabel('experience', answers.experience, language));
  }
  if (answers.extra) {
    parts.push(answers.extra);
  }
  return parts.join(' · ');
}
