import {
  AiPlannerEquipment,
  AppPreferences,
  ExerciseBodyPart,
  ExerciseCategory,
  ExerciseLibraryItem,
} from '../types/models';
import { AICoachPlanSchema, AICoachPlannedExercise, AICoachPlannedSession } from '../types/aiCoachPlan';
import { isSpecialtyExercise } from './exerciseClassification';
import { isBrowsableExercise } from './exerciseBrowseFilter';
import { DisplayEquipmentValue, displayEquipmentValue } from './libraryLabel';

type PlannedExerciseVariant = 'warmup' | 'primary' | 'secondary' | 'accessory';

interface SlotBlueprint {
  key: string;
  variant: PlannedExerciseVariant;
  name?: string;
  search?: string[];
  bodyParts?: ExerciseBodyPart[];
  categories?: ExerciseCategory[];
}

interface SessionBlueprint {
  key: string;
  name: string;
  focus: string;
  slots: SlotBlueprint[];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function slugify(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAiGoalLabel(goal: ReturnType<typeof mapSetupGoalToAiGoal>) {
  switch (goal) {
    case 'fat_loss':
      return 'Fat Loss';
    case 'muscle':
      return 'Muscle';
    case 'strength':
      return 'Strength';
    default:
      return 'Fitness';
  }
}

function mapSetupGoalToAiGoal(preferences: AppPreferences) {
  if (preferences.aiPlannerGoal) {
    return preferences.aiPlannerGoal;
  }

  switch (preferences.setupGoal) {
    case 'strength':
      return 'strength';
    case 'muscle':
      return 'muscle';
    case 'run_mobility':
    case 'lean_athletic':
    case 'general_fitness':
      return 'fitness';
    default:
      return 'fitness';
  }
}

function mapSetupDays(preferences: AppPreferences) {
  const rawDays = preferences.aiPlannerDaysPerWeek ?? preferences.setupDaysPerWeek ?? 3;
  if (rawDays <= 1) {
    return 1;
  }

  if (rawDays >= 4) {
    return 4;
  }

  return rawDays as 2 | 3;
}

function mapSetupExperience(preferences: AppPreferences) {
  if (preferences.aiPlannerExperience) {
    return preferences.aiPlannerExperience;
  }

  if (preferences.setupLevel === 'pro') {
    return 'advanced';
  }

  if (preferences.setupLevel === 'advanced') {
    return 'intermediate';
  }

  return 'beginner';
}

/**
 * The gear a plan for these preferences is built for. Exported so the catalog
 * shortcut (briefProgrammeMatch) reads a reader's gear the way the composer
 * it stands in for does.
 *
 * Onboarding's "Bodyweight only" card stores the 'minimal' bucket beside the
 * bodyweight_only environment, and read off the bucket alone that reader was
 * handed dumbbells: the catalog shortcut opened a dumbbell programme for
 * "6 days a week, muscle" (hunt, 2026-10-08). The environment says what the
 * bucket cannot, as the intake's own preset reads it (programIntake).
 */
export function mapSetupEquipment(
  preferences: Pick<AppPreferences, 'aiPlannerEquipment' | 'setupEquipment'> &
    Partial<Pick<AppPreferences, 'setupTrainingEnvironment'>>,
): AiPlannerEquipment {
  if (preferences.aiPlannerEquipment) {
    return preferences.aiPlannerEquipment;
  }

  if (preferences.setupTrainingEnvironment === 'bodyweight_only') {
    return 'bodyweight';
  }

  switch (preferences.setupEquipment) {
    case 'gym':
      return 'full_gym';
    case 'home':
      return 'home_gym';
    case 'minimal':
      return 'minimal';
    default:
      return 'full_gym';
  }
}

function mapSetupSessionMinutes(preferences: AppPreferences, daysPerWeek: number) {
  if (preferences.aiPlannerSessionMinutes) {
    return preferences.aiPlannerSessionMinutes;
  }

  if (preferences.setupWeeklyMinutes && preferences.setupWeeklyMinutes > 0) {
    const inferred = Math.round(preferences.setupWeeklyMinutes / daysPerWeek / 5) * 5;
    return Math.max(30, Math.min(90, inferred));
  }

  return 60;
}

function mapSetupRecovery(preferences: AppPreferences) {
  return preferences.aiPlannerRecovery ?? 'moderate';
}

/**
 * The gear each planner answer means, in the buckets a row prints
 * (displayEquipmentValue). Read off the stored bucket, "bodyweight" — "ilman
 * välineitä" — handed a reader with nothing a band pull-apart or a medicine
 * ball throw, which the library files as bodyweight (#bugs 2026-10-06).
 * Kettlebells travel with dumbbells, as they always did through the stored
 * bucket. A band and a foam roller are a corner of a room, so they come with
 * any equipment at all; the medicine and exercise balls are gym-floor gear,
 * as the composer's equipment rules treat them.
 */
function resolveAllowedEquipment(equipment: AppPreferences['aiPlannerEquipment']) {
  const allowed = new Set<DisplayEquipmentValue>();
  switch (equipment) {
    case 'bodyweight':
      allowed.add('bodyweight');
      break;
    case 'minimal':
      allowed.add('dumbbell');
      allowed.add('kettlebells');
      allowed.add('band');
      allowed.add('foam roll');
      allowed.add('bodyweight');
      break;
    case 'home_gym':
      allowed.add('barbell');
      allowed.add('dumbbell');
      allowed.add('kettlebells');
      allowed.add('band');
      allowed.add('foam roll');
      allowed.add('bodyweight');
      break;
    case 'full_gym':
    default:
      allowed.add('barbell');
      allowed.add('dumbbell');
      allowed.add('kettlebells');
      allowed.add('machine');
      allowed.add('cable');
      allowed.add('band');
      allowed.add('ball');
      allowed.add('foam roll');
      allowed.add('bodyweight');
      break;
  }
  return allowed;
}

function buildSessionBlueprints(goal: ReturnType<typeof mapSetupGoalToAiGoal>, daysPerWeek: number): SessionBlueprint[] {
  const templates: Record<string, SessionBlueprint[]> = {
    1: [
      {
        key: 'full_body',
        name: 'Vinha AI Full Body',
        focus: 'Full-body strength and hypertrophy in one slot.',
        slots: [
          { key: 'warmup', variant: 'warmup', name: 'Warm-up flow' },
          { key: 'squat', variant: 'primary', search: ['back squat', 'goblet squat', 'leg press'], bodyParts: ['legs'] },
          { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'cable chest press'], bodyParts: ['chest'] },
          { key: 'row', variant: 'secondary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
          { key: 'hinge', variant: 'secondary', search: ['romanian deadlift', 'hip thrust', 'deadlift'], bodyParts: ['legs', 'glutes', 'back'] },
          { key: 'focus', variant: 'accessory', search: ['cable crunch', 'lateral raise', 'hammer curls'], bodyParts: ['core', 'shoulders', 'biceps'] },
        ],
      },
    ],
    2:
      goal === 'muscle'
        ? [
            {
              key: 'upper',
              name: 'Upper A',
              focus: 'Upper push and pull base.',
              slots: [
                { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
                { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'cable chest press'], bodyParts: ['chest'] },
                { key: 'row', variant: 'primary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
                { key: 'press', variant: 'secondary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
                { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
                { key: 'arms', variant: 'accessory', search: ['triceps pushdown', 'hammer curls', 'alternate hammer curl'], bodyParts: ['triceps', 'biceps'] },
              ],
            },
            {
              key: 'lower',
              name: 'Lower A',
              focus: 'Lower-body compound work and support.',
              slots: [
                { key: 'warmup_lower', variant: 'warmup', name: 'Lower-body warm-up' },
                { key: 'squat', variant: 'primary', search: ['back squat', 'front squat', 'leg press'], bodyParts: ['legs'] },
                { key: 'hinge', variant: 'primary', search: ['romanian deadlift', 'deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
                { key: 'single_leg', variant: 'secondary', search: ['walking lunge', 'split squat', 'bulgarian split squat'], bodyParts: ['legs', 'glutes'] },
                { key: 'hamstrings', variant: 'accessory', search: ['lying leg curl', 'leg curl'], bodyParts: ['legs'] },
                { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
              ],
            },
          ]
        : [
            {
              key: 'full_body_a',
              name: 'Full Body A',
              focus: 'Squat, press, and row emphasis.',
              slots: [
                { key: 'warmup_lower', variant: 'warmup', name: 'Lower-body warm-up' },
                { key: 'squat', variant: 'primary', search: ['back squat', 'goblet squat', 'leg press'], bodyParts: ['legs'] },
                { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'push-up'], bodyParts: ['chest'] },
                { key: 'row', variant: 'secondary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
                { key: 'split_squat', variant: 'secondary', search: ['walking lunge', 'split squat', 'leg extension'], bodyParts: ['legs', 'glutes'] },
                { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
              ],
            },
            {
              key: 'full_body_b',
              name: 'Full Body B',
              focus: 'Hinge, vertical press, and pull emphasis.',
              slots: [
                { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
                { key: 'hinge', variant: 'primary', search: ['romanian deadlift', 'deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
                { key: 'press', variant: 'primary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
                { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
                { key: 'chest', variant: 'secondary', search: ['incline dumbbell bench press', 'barbell incline bench press', 'cable chest press'], bodyParts: ['chest'] },
                { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
              ],
            },
          ],
    3:
      goal === 'muscle'
        ? [
            {
              key: 'push',
              name: 'Push',
              focus: 'Chest, shoulders, and triceps.',
              slots: [
                { key: 'warmup_upper', variant: 'warmup', name: 'Push warm-up' },
                { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'cable chest press'], bodyParts: ['chest'] },
                { key: 'press', variant: 'primary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
                { key: 'incline', variant: 'secondary', search: ['barbell incline bench press', 'incline dumbbell bench press'], bodyParts: ['chest'] },
                { key: 'fly', variant: 'accessory', search: ['cable crossover', 'cable chest press', 'pec deck'], bodyParts: ['chest'] },
                { key: 'laterals', variant: 'accessory', search: ['lateral raise', 'cable seated lateral raise'], bodyParts: ['shoulders'] },
                { key: 'triceps', variant: 'accessory', search: ['triceps pushdown', 'lying triceps press', 'close-grip barbell bench press'], bodyParts: ['triceps', 'chest'] },
              ],
            },
            {
              key: 'pull',
              name: 'Pull',
              focus: 'Lats, upper back, and biceps.',
              slots: [
                { key: 'warmup_upper', variant: 'warmup', name: 'Pull warm-up' },
                { key: 'pulldown', variant: 'primary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
                { key: 'row', variant: 'primary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
                { key: 'rear_delt', variant: 'secondary', search: ['rear lateral raise', 'rear delt row', 'face pull'], bodyParts: ['shoulders', 'back'] },
                { key: 'curl', variant: 'accessory', search: ['barbell curl', 'hammer curls', 'alternating dumbbell curl'], bodyParts: ['biceps'] },
                { key: 'back', variant: 'accessory', search: ['back extension', 'hyperextension'], bodyParts: ['back'] },
                { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
              ],
            },
            {
              key: 'legs',
              name: 'Legs',
              focus: 'Quads, hinge strength, and lower-body support.',
              slots: [
                { key: 'warmup_lower', variant: 'warmup', name: 'Legs warm-up' },
                { key: 'squat', variant: 'primary', search: ['back squat', 'front squat', 'leg press'], bodyParts: ['legs'] },
                { key: 'hinge', variant: 'primary', search: ['romanian deadlift', 'deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
                { key: 'single_leg', variant: 'secondary', search: ['walking lunge', 'split squat', 'bulgarian split squat'], bodyParts: ['legs', 'glutes'] },
                { key: 'hamstrings', variant: 'accessory', search: ['lying leg curl', 'leg curl'], bodyParts: ['legs'] },
                { key: 'calves', variant: 'accessory', search: ['calf press', 'standing calf raises', 'seated calf raise'], bodyParts: ['legs'] },
                { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
              ],
            },
          ]
        : goal === 'strength'
          ? [
              {
                key: 'strength_a',
                name: 'Strength A',
                focus: 'Heavy squat and bench base.',
                slots: [
                  { key: 'warmup_lower', variant: 'warmup', name: 'Strength warm-up' },
                  { key: 'squat', variant: 'primary', search: ['back squat', 'front squat', 'leg press'], bodyParts: ['legs'] },
                  { key: 'bench', variant: 'primary', search: ['barbell bench press', 'bench press - powerlifting', 'dumbbell bench press'], bodyParts: ['chest'] },
                  { key: 'row', variant: 'secondary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
                  { key: 'split_squat', variant: 'secondary', search: ['walking lunge', 'split squat'], bodyParts: ['legs', 'glutes'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
              {
                key: 'strength_b',
                name: 'Strength B',
                focus: 'Deadlift and vertical press base.',
                slots: [
                  { key: 'warmup_upper', variant: 'warmup', name: 'Strength warm-up' },
                  { key: 'hinge', variant: 'primary', search: ['deadlift', 'romanian deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
                  { key: 'press', variant: 'primary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
                  { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
                  { key: 'single_leg', variant: 'secondary', search: ['walking lunge', 'split squat', 'leg press'], bodyParts: ['legs'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
              {
                key: 'strength_c',
                name: 'Strength C',
                focus: 'Front squat and incline press support.',
                slots: [
                  { key: 'warmup_lower', variant: 'warmup', name: 'Strength warm-up' },
                  { key: 'front_squat', variant: 'primary', search: ['front squat', 'back squat', 'goblet squat'], bodyParts: ['legs'] },
                  { key: 'incline', variant: 'primary', search: ['barbell incline bench press', 'incline dumbbell bench press'], bodyParts: ['chest'] },
                  { key: 'row', variant: 'secondary', search: ['seated cable row', 'bent over barbell row', 'dumbbell row'], bodyParts: ['back'] },
                  { key: 'hinge', variant: 'secondary', search: ['hip thrust', 'romanian deadlift', 'leg curl'], bodyParts: ['glutes', 'legs', 'back'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
            ]
          : [
              {
                key: 'full_body_a',
                name: 'Full Body A',
                focus: 'Squat, press, and row.',
                slots: [
                  { key: 'warmup_lower', variant: 'warmup', name: 'Warm-up flow' },
                  { key: 'squat', variant: 'primary', search: ['back squat', 'goblet squat', 'leg press'], bodyParts: ['legs'] },
                  { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'push-up'], bodyParts: ['chest'] },
                  { key: 'row', variant: 'secondary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
                  { key: 'laterals', variant: 'accessory', search: ['lateral raise', 'cable seated lateral raise'], bodyParts: ['shoulders'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
              {
                key: 'full_body_b',
                name: 'Full Body B',
                focus: 'Hinge, vertical press, and pull.',
                slots: [
                  { key: 'warmup_upper', variant: 'warmup', name: 'Warm-up flow' },
                  { key: 'hinge', variant: 'primary', search: ['romanian deadlift', 'deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
                  { key: 'press', variant: 'primary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
                  { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
                  { key: 'legs', variant: 'secondary', search: ['walking lunge', 'split squat', 'leg press'], bodyParts: ['legs'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
              {
                key: 'full_body_c',
                name: 'Full Body C',
                focus: 'Lower-body support and chest/back top-up.',
                slots: [
                  { key: 'warmup_lower', variant: 'warmup', name: 'Warm-up flow' },
                  { key: 'front_squat', variant: 'primary', search: ['front squat', 'back squat', 'goblet squat'], bodyParts: ['legs'] },
                  { key: 'incline', variant: 'secondary', search: ['barbell incline bench press', 'incline dumbbell bench press'], bodyParts: ['chest'] },
                  { key: 'row', variant: 'secondary', search: ['seated cable row', 'bent over barbell row', 'dumbbell row'], bodyParts: ['back'] },
                  { key: 'glutes', variant: 'accessory', search: ['hip thrust', 'glute bridge'], bodyParts: ['glutes', 'legs'] },
                  { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
                ],
              },
            ],
    4: [
      {
        key: 'upper_a',
        name: 'Upper A',
        focus: 'Heavy upper press and row.',
        slots: [
          { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
          { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'cable chest press'], bodyParts: ['chest'] },
          { key: 'row', variant: 'primary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
          { key: 'press', variant: 'secondary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
          { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
          { key: 'arms', variant: 'accessory', search: ['triceps pushdown', 'hammer curls', 'barbell curl'], bodyParts: ['triceps', 'biceps'] },
        ],
      },
      {
        key: 'lower_a',
        name: 'Lower A',
        focus: 'Squat-led lower day.',
        slots: [
          { key: 'warmup_lower', variant: 'warmup', name: 'Lower-body warm-up' },
          { key: 'squat', variant: 'primary', search: ['back squat', 'front squat', 'leg press'], bodyParts: ['legs'] },
          { key: 'hinge', variant: 'primary', search: ['romanian deadlift', 'deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
          { key: 'single_leg', variant: 'secondary', search: ['walking lunge', 'split squat', 'bulgarian split squat'], bodyParts: ['legs', 'glutes'] },
          { key: 'hamstrings', variant: 'accessory', search: ['lying leg curl', 'leg curl'], bodyParts: ['legs'] },
          { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
        ],
      },
      {
        key: 'upper_b',
        name: 'Upper B',
        focus: 'Upper volume and shoulder support.',
        slots: [
          { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
          { key: 'incline', variant: 'primary', search: ['barbell incline bench press', 'incline dumbbell bench press'], bodyParts: ['chest'] },
          { key: 'pull', variant: 'primary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
          { key: 'row', variant: 'secondary', search: ['seated cable row', 'dumbbell row', 'bent over barbell row'], bodyParts: ['back'] },
          { key: 'laterals', variant: 'accessory', search: ['lateral raise', 'cable seated lateral raise'], bodyParts: ['shoulders'] },
          { key: 'arms', variant: 'accessory', search: ['barbell curl', 'hammer curls', 'triceps pushdown'], bodyParts: ['biceps', 'triceps'] },
        ],
      },
      {
        key: 'lower_b',
        name: 'Lower B',
        focus: 'Hinge and lower-body support.',
        slots: [
          { key: 'warmup_lower', variant: 'warmup', name: 'Lower-body warm-up' },
          { key: 'hinge', variant: 'primary', search: ['deadlift', 'romanian deadlift', 'hip thrust'], bodyParts: ['legs', 'glutes', 'back'] },
          { key: 'quad', variant: 'primary', search: ['leg press', 'hack squat', 'back squat'], bodyParts: ['legs'] },
          { key: 'single_leg', variant: 'secondary', search: ['walking lunge', 'split squat'], bodyParts: ['legs', 'glutes'] },
          { key: 'glutes', variant: 'accessory', search: ['hip thrust', 'glute bridge'], bodyParts: ['glutes', 'legs'] },
          { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] },
        ],
      },
    ],
  };

  return templates[String(daysPerWeek)] ?? templates[3];
}

/**
 * The week for a brief that refused the leg day ("no leg day", "ei
 * jalkapäivää"). The split blueprints above still laid out a Legs or Lower
 * day, and with every squat, deadlift and lunge avoided its slots filled with
 * whatever was left: Alternate Leg Diagonal Bound, Balance Board, Alternating
 * Hang Clean, and bench jumps and depth leaps for a reader with no gear
 * (hunt, 2026-10-08). The days go to the upper body and the core instead, as
 * many as were asked for.
 */
function buildNoLegDayBlueprints(goal: ReturnType<typeof mapSetupGoalToAiGoal>, daysPerWeek: number): SessionBlueprint[] {
  const core: SlotBlueprint = { key: 'core', variant: 'accessory', search: ['cable crunch', 'ab crunch machine', 'crunch'], bodyParts: ['core'] };
  const upperA: SessionBlueprint = {
    key: 'upper_a',
    name: 'Upper A',
    focus: 'Heavy upper press and row.',
    slots: [
      { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
      { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'push-up'], bodyParts: ['chest'] },
      { key: 'row', variant: 'primary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
      { key: 'press', variant: 'secondary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
      { key: 'pull', variant: 'secondary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
      { key: 'focus', variant: 'accessory', search: ['triceps pushdown', 'hammer curls', 'barbell curl'], bodyParts: ['triceps', 'biceps'] },
      core,
    ],
  };
  const upperB: SessionBlueprint = {
    key: 'upper_b',
    name: 'Upper B',
    focus: 'Upper volume and shoulder support.',
    slots: [
      { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
      { key: 'incline', variant: 'primary', search: ['barbell incline bench press', 'incline dumbbell bench press', 'decline push-up'], bodyParts: ['chest'] },
      { key: 'pull', variant: 'primary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
      { key: 'row', variant: 'secondary', search: ['seated cable row', 'dumbbell row', 'bent over barbell row'], bodyParts: ['back'] },
      { key: 'laterals', variant: 'accessory', search: ['lateral raise', 'cable seated lateral raise'], bodyParts: ['shoulders'] },
      { key: 'arms', variant: 'accessory', search: ['barbell curl', 'hammer curls', 'triceps pushdown'], bodyParts: ['biceps', 'triceps'] },
      core,
    ],
  };
  const upperC: SessionBlueprint = {
    key: 'upper_c',
    name: 'Upper C',
    focus: 'Shoulders, back and arms.',
    slots: [
      { key: 'warmup_upper', variant: 'warmup', name: 'Upper-body warm-up' },
      { key: 'press', variant: 'primary', search: ['dumbbell shoulder press', 'barbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
      { key: 'chin', variant: 'primary', search: ['chin-up', 'pull-up', 'lat pulldown'], bodyParts: ['back'] },
      { key: 'chest', variant: 'secondary', search: ['dumbbell bench press', 'cable chest press', 'push-up'], bodyParts: ['chest'] },
      { key: 'rear_delt', variant: 'secondary', search: ['rear lateral raise', 'face pull', 'rear delt row'], bodyParts: ['shoulders', 'back'] },
      { key: 'arms', variant: 'accessory', search: ['lying triceps press', 'alternating dumbbell curl', 'hammer curls'], bodyParts: ['triceps', 'biceps'] },
      core,
    ],
  };
  const push: SessionBlueprint = {
    key: 'push',
    name: 'Push',
    focus: 'Chest, shoulders, and triceps.',
    slots: [
      { key: 'warmup_upper', variant: 'warmup', name: 'Push warm-up' },
      { key: 'bench', variant: 'primary', search: ['barbell bench press', 'dumbbell bench press', 'push-up'], bodyParts: ['chest'] },
      { key: 'press', variant: 'primary', search: ['barbell shoulder press', 'dumbbell shoulder press', 'arnold press'], bodyParts: ['shoulders'] },
      { key: 'incline', variant: 'secondary', search: ['barbell incline bench press', 'incline dumbbell bench press', 'decline push-up'], bodyParts: ['chest'] },
      { key: 'laterals', variant: 'accessory', search: ['lateral raise', 'cable seated lateral raise'], bodyParts: ['shoulders'] },
      { key: 'triceps', variant: 'accessory', search: ['triceps pushdown', 'lying triceps press', 'bench dips'], bodyParts: ['triceps'] },
      core,
    ],
  };
  const pull: SessionBlueprint = {
    key: 'pull',
    name: 'Pull',
    focus: 'Lats, upper back, and biceps.',
    slots: [
      { key: 'warmup_upper', variant: 'warmup', name: 'Pull warm-up' },
      { key: 'pulldown', variant: 'primary', search: ['lat pulldown', 'pull-up', 'chin-up'], bodyParts: ['back'] },
      { key: 'row', variant: 'primary', search: ['bent over barbell row', 'seated cable row', 'dumbbell row'], bodyParts: ['back'] },
      { key: 'rear_delt', variant: 'secondary', search: ['rear lateral raise', 'rear delt row', 'face pull'], bodyParts: ['shoulders', 'back'] },
      { key: 'curl', variant: 'accessory', search: ['barbell curl', 'hammer curls', 'alternating dumbbell curl'], bodyParts: ['biceps'] },
      core,
    ],
  };
  switch (daysPerWeek) {
    case 1:
      return [{ ...upperA, key: 'upper_body', name: 'Vinha AI Upper Body', focus: 'Upper body and core in one slot.' }];
    case 2:
      return [upperA, upperB];
    case 3:
      return goal === 'muscle' ? [push, pull, { ...upperB, key: 'upper', name: 'Upper' }] : [upperA, upperB, upperC];
    default:
      return [upperA, push, upperB, pull];
  }
}

function getWarmupExercise(sessionName: string): AICoachPlannedExercise {
  const lower = sessionName.toLowerCase().includes('lower') || sessionName.toLowerCase().includes('leg') || sessionName.toLowerCase().includes('strength');
  return {
    key: `${slugify(sessionName)}_warmup`,
    name: lower ? 'Dynamic lower-body warm-up' : 'Dynamic upper-body warm-up',
    sets: 1,
    repsMin: 8,
    repsMax: 10,
    restSeconds: 30,
    tracked: false,
    libraryItemId: null,
  };
}

function getPrescribedSets(variant: PlannedExerciseVariant, goal: ReturnType<typeof mapSetupGoalToAiGoal>, recovery: ReturnType<typeof mapSetupRecovery>, experience: ReturnType<typeof mapSetupExperience>) {
  if (variant === 'warmup') {
    return 1;
  }

  const base =
    variant === 'primary'
      ? goal === 'strength'
        ? 4
        : 3
      : variant === 'secondary'
        ? 3
        : 2;

  const recoveryDelta = recovery === 'low' ? -1 : recovery === 'high' && variant !== 'accessory' ? 1 : 0;
  const experienceDelta = experience === 'advanced' && variant === 'primary' ? 1 : 0;
  return Math.max(1, base + recoveryDelta + experienceDelta);
}

/**
 * One rep number per exercise, not a range.
 *
 * The catalogs dropped their ranges on 2026-08-25 and saved programmes
 * followed on the 26th — a single target is what lets automated progression
 * say "hit it, next time +2.5 kg" without the range making the claim mushy.
 * The composer kept writing "4 × 6–8" into programmes that sit next to
 * catalog ones reading "4 × 8" (user 2026-08-26). The ceiling wins here for
 * the same reason it won there: the progression gate always measured
 * readiness against repsMax.
 */
function getRepRange(variant: PlannedExerciseVariant, goal: ReturnType<typeof mapSetupGoalToAiGoal>) {
  const single = (reps: number) => ({ repsMin: reps, repsMax: reps });

  if (variant === 'warmup') {
    return single(10);
  }

  if (variant === 'primary') {
    return goal === 'strength' ? single(6) : single(8);
  }

  if (variant === 'secondary') {
    return goal === 'strength' ? single(8) : single(10);
  }

  return goal === 'muscle' ? single(15) : single(12);
}

function getRestSeconds(variant: PlannedExerciseVariant, goal: ReturnType<typeof mapSetupGoalToAiGoal>) {
  if (variant === 'warmup') {
    return 30;
  }

  if (variant === 'primary') {
    return goal === 'strength' ? 180 : 120;
  }

  if (variant === 'secondary') {
    return goal === 'strength' ? 120 : 90;
  }

  return 60;
}

function getFocusBodyPart(preferences: AppPreferences): ExerciseBodyPart | null {
  const focus = preferences.setupFocusAreas[0];
  switch (focus) {
    case 'glutes':
      return 'glutes';
    case 'legs':
    case 'quads':
    case 'hamstrings':
    case 'calves':
      return 'legs';
    case 'chest':
      return 'chest';
    case 'shoulders':
      return 'shoulders';
    case 'back':
      return 'back';
    case 'arms':
      return 'biceps';
    case 'core':
      return 'core';
    case 'mobility':
      return 'full body';
    default:
      return null;
  }
}

/**
 * What a plan for these preferences is held to: the gear the reader has and
 * the words their brief refuses, matched inside a library name. One reading
 * for the composer below and for a week the live coach wrote
 * (programmeBrief.resolveLiveProposal), so the two cannot disagree about what
 * "no deadlifts" or "bodyweight only" keeps out.
 */
export interface PlannerLimits {
  allowedEquipment: Set<DisplayEquipmentValue>;
  avoidTerms: string[];
}

export function plannerLimits(
  preferences: Pick<AppPreferences, 'aiPlannerEquipment' | 'setupEquipment' | 'aiPlannerAvoid'> &
    Partial<Pick<AppPreferences, 'setupTrainingEnvironment'>>,
): PlannerLimits {
  return {
    allowedEquipment: resolveAllowedEquipment(mapSetupEquipment(preferences)),
    avoidTerms: splitList(preferences.aiPlannerAvoid).map(normalize),
  };
}

/** Whether a name carries a term the limits avoid. */
export function isAvoidedByPlannerLimits(item: Pick<ExerciseLibraryItem, 'name'>, limits: PlannerLimits): boolean {
  const normalizedName = normalize(item.name);
  return limits.avoidTerms.some((term) => normalizedName.includes(term));
}

/** Whether the gear the limits allow covers this row. */
export function fitsPlannerEquipment(
  item: Pick<ExerciseLibraryItem, 'name' | 'equipment' | 'sourceEquipment'>,
  limits: PlannerLimits,
): boolean {
  return limits.allowedEquipment.has(displayEquipmentValue(item));
}

function findLibraryItemForQuery(
  items: ExerciseLibraryItem[],
  query: string,
  allowedEquipment: Set<DisplayEquipmentValue>,
  avoidTerms: string[],
) {
  const normalizedQuery = normalize(query);
  return items.find((item) => {
    if (!allowedEquipment.has(displayEquipmentValue(item))) {
      return false;
    }

    const normalizedName = normalize(item.name);
    if (avoidTerms.some((term) => normalizedName.includes(term))) {
      return false;
    }

    return normalizedName.includes(normalizedQuery);
  });
}

function chooseLibraryExercise(args: {
  items: ExerciseLibraryItem[];
  slot: SlotBlueprint;
  allowedEquipment: Set<DisplayEquipmentValue>;
  avoidTerms: string[];
  usedIds: Set<string>;
  mustIncludeTerms: string[];
  usedMustIncludeTerms: Set<string>;
}) {
  const { items, slot, allowedEquipment, avoidTerms, usedIds, mustIncludeTerms, usedMustIncludeTerms } = args;
  const prioritizedMustTerms = mustIncludeTerms.filter((term) => {
    if (usedMustIncludeTerms.has(term)) {
      return false;
    }

    const match = findLibraryItemForQuery(items, term, allowedEquipment, avoidTerms);
    if (!match) {
      return false;
    }

    if (slot.bodyParts?.length && !slot.bodyParts.includes(match.bodyPart)) {
      return false;
    }

    return !(slot.categories?.length && !slot.categories.includes(match.category));
  });

  const candidates = [...prioritizedMustTerms, ...(slot.search ?? [])];

  for (const query of candidates) {
    const normalizedQuery = normalize(query);
    // A lift the reader named is theirs to have, specialty or not. A slot's
    // own search word is not a name: "deadlift" must not land on Car Deadlift
    // or Axle Deadlift (#bugs 2026-10-06, specialty movements).
    const named = prioritizedMustTerms.includes(query);
    // Nor must "hamstring" land on a hamstring stretch: a stretch or drill
    // fills a slot only when the slot's own word says so ("world's greatest
    // stretch" in the mobility focus) — the pickers' rule, read off the word.
    const namesANonSet = named || !isBrowsableExercise({ name: query });
    const match = items.find((item) => {
      if (usedIds.has(item.id) || !allowedEquipment.has(displayEquipmentValue(item))) {
        return false;
      }
      if (!named && isSpecialtyExercise(item)) {
        return false;
      }
      if (!namesANonSet && !isBrowsableExercise(item)) {
        return false;
      }

      const normalizedName = normalize(item.name);
      if (avoidTerms.some((term) => normalizedName.includes(term))) {
        return false;
      }

      if (!normalizedName.includes(normalizedQuery)) {
        return false;
      }

      if (slot.bodyParts?.length && !slot.bodyParts.includes(item.bodyPart)) {
        return false;
      }

      if (slot.categories?.length && !slot.categories.includes(item.category)) {
        return false;
      }

      return true;
    });

    if (match) {
      const matchedMustTerm = prioritizedMustTerms.find((term) => normalize(term) === normalizedQuery);
      if (matchedMustTerm) {
        usedMustIncludeTerms.add(matchedMustTerm);
      }
      usedIds.add(match.id);
      return match;
    }
  }

  // The app choosing with no word to go on: a set among normal exercises,
  // never a stretch or a strongman implement. The mobility focus fell through
  // to here on every one-day plan and handed out Chin To Chest Stretch
  // (#bugs 2026-10-06, 45 of 2,025 plans).
  const fallback = items.find((item) => {
    if (
      usedIds.has(item.id) ||
      !allowedEquipment.has(displayEquipmentValue(item)) ||
      isSpecialtyExercise(item) ||
      !isBrowsableExercise(item)
    ) {
      return false;
    }

    const normalizedName = normalize(item.name);
    if (avoidTerms.some((term) => normalizedName.includes(term))) {
      return false;
    }

    if (slot.bodyParts?.length && !slot.bodyParts.includes(item.bodyPart)) {
      return false;
    }

    return !(slot.categories?.length && !slot.categories.includes(item.category));
  });

  if (fallback) {
    usedIds.add(fallback.id);
  }

  return fallback ?? null;
}

function buildPlannedExercise(
  item: ExerciseLibraryItem | null,
  slot: SlotBlueprint,
  goal: ReturnType<typeof mapSetupGoalToAiGoal>,
  recovery: ReturnType<typeof mapSetupRecovery>,
  experience: ReturnType<typeof mapSetupExperience>,
): AICoachPlannedExercise {
  const sets = getPrescribedSets(slot.variant, goal, recovery, experience);
  const repRange = getRepRange(slot.variant, goal);
  return {
    key: slot.key,
    name: item?.name ?? slot.name ?? 'Custom exercise',
    sets,
    repsMin: repRange.repsMin,
    repsMax: repRange.repsMax,
    restSeconds: getRestSeconds(slot.variant, goal),
    tracked: slot.variant !== 'warmup' && slot.variant !== 'accessory',
    libraryItemId: item?.id ?? null,
  };
}

function appendUnplacedMustIncludes(args: {
  sessions: AICoachPlannedSession[];
  items: ExerciseLibraryItem[];
  mustIncludeTerms: string[];
  usedMustIncludeTerms: Set<string>;
  allowedEquipment: Set<DisplayEquipmentValue>;
  avoidTerms: string[];
  usedIds: Set<string>;
  goal: ReturnType<typeof mapSetupGoalToAiGoal>;
  recovery: ReturnType<typeof mapSetupRecovery>;
  experience: ReturnType<typeof mapSetupExperience>;
  sessionMinutes: number;
}) {
  const {
    sessions,
    items,
    mustIncludeTerms,
    usedMustIncludeTerms,
    allowedEquipment,
    avoidTerms,
    usedIds,
    goal,
    recovery,
    experience,
    sessionMinutes,
  } = args;
  const maxExercises = sessionMinutes <= 45 ? 5 : sessionMinutes >= 75 ? 7 : 6;

  for (const term of mustIncludeTerms) {
    if (usedMustIncludeTerms.has(term)) {
      continue;
    }

    const item = findLibraryItemForQuery(items, term, allowedEquipment, avoidTerms);
    if (!item || usedIds.has(item.id)) {
      continue;
    }

    const preferredSession =
      sessions.find((session) =>
        session.name.toLowerCase().includes('upper') &&
        (item.bodyPart === 'chest' || item.bodyPart === 'back' || item.bodyPart === 'shoulders' || item.bodyPart === 'biceps' || item.bodyPart === 'triceps'),
      ) ??
      sessions.find((session) =>
        session.name.toLowerCase().includes('lower') &&
        (item.bodyPart === 'legs' || item.bodyPart === 'glutes'),
      ) ??
      sessions.find((session) => session.name.toLowerCase().includes('push') && (item.bodyPart === 'chest' || item.bodyPart === 'shoulders' || item.bodyPart === 'triceps')) ??
      sessions.find((session) => session.name.toLowerCase().includes('pull') && (item.bodyPart === 'back' || item.bodyPart === 'biceps')) ??
      sessions.find((session) => session.name.toLowerCase().includes('leg') && (item.bodyPart === 'legs' || item.bodyPart === 'glutes')) ??
      sessions[0];

    if (!preferredSession) {
      continue;
    }

    const extra = buildPlannedExercise(
      item,
      { key: `must_${slugify(term)}`, variant: 'accessory' },
      goal,
      recovery,
      experience,
    );

    if (preferredSession.exercises.length >= maxExercises) {
      preferredSession.exercises[preferredSession.exercises.length - 1] = extra;
    } else {
      preferredSession.exercises.push(extra);
    }

    usedIds.add(item.id);
    usedMustIncludeTerms.add(term);
  }
}

/** What the brief says beyond the stored preferences: a refused leg day (buildNoLegDayBlueprints). */
export interface AiCoachPlanOptions {
  noLegDay?: boolean;
}

export function buildAiCoachPlanSchema(
  preferences: AppPreferences,
  exerciseLibrary: ExerciseLibraryItem[],
  options: AiCoachPlanOptions = {},
): AICoachPlanSchema {
  const goal = mapSetupGoalToAiGoal(preferences);
  const daysPerWeek = mapSetupDays(preferences);
  const experience = mapSetupExperience(preferences);
  const equipment = mapSetupEquipment(preferences);
  const recovery = mapSetupRecovery(preferences);
  const sessionMinutes = mapSetupSessionMinutes(preferences, daysPerWeek);
  const { allowedEquipment, avoidTerms } = plannerLimits(preferences);
  // Was filtering the legacy `lib_*` tier, which stopped shipping 2026-09-01.
  const importedLibrary = exerciseLibrary;
  const mustIncludeTerms = uniqueStrings(splitList(preferences.aiPlannerMustInclude));
  const usedMustIncludeTerms = new Set<string>();
  const usedIds = new Set<string>();
  const focusBodyPart = getFocusBodyPart(preferences);
  const blueprints = options.noLegDay ? buildNoLegDayBlueprints(goal, daysPerWeek) : buildSessionBlueprints(goal, daysPerWeek);
  const maxExercises = sessionMinutes <= 45 ? 5 : sessionMinutes >= 75 ? 7 : 6;

  const sessions: AICoachPlannedSession[] = blueprints.map((blueprint, sessionIndex) => {
    const exercises = blueprint.slots
      .map((slot) => {
        if (slot.variant === 'warmup') {
          return getWarmupExercise(blueprint.name);
        }

        const nextSlot = slot.key === 'focus' && focusBodyPart
          ? {
              ...slot,
              // Mobility reads as "full body", which none of its own words
              // is filed under (World's Greatest Stretch is a legs row), so
              // the slot fell through to the first full-body lift — an
              // isometric neck exercise. Its words decide where it lands.
              bodyParts: focusBodyPart === 'full body' ? undefined : [focusBodyPart],
              search:
                focusBodyPart === 'chest'
                  ? ['barbell incline bench press', 'incline dumbbell bench press', 'cable crossover']
                  : focusBodyPart === 'back'
                    ? ['lat pulldown', 'seated cable row', 'dumbbell row']
                    : focusBodyPart === 'shoulders'
                      ? ['lateral raise', 'barbell shoulder press', 'cable shoulder press']
                      : focusBodyPart === 'legs'
                        ? ['leg press', 'walking lunge', 'split squat']
                        : focusBodyPart === 'full body'
                          ? ["world's greatest stretch", 'walking lunge', 'plank']
                        : focusBodyPart === 'glutes'
                          ? ['hip thrust', 'glute bridge', 'walking lunge']
                          : focusBodyPart === 'biceps'
                            ? ['barbell curl', 'hammer curls', 'alternating dumbbell curl']
                            : focusBodyPart === 'core'
                              ? ['cable crunch', 'ab crunch machine', 'crunch']
                              : slot.search,
            }
          : slot;

        const item = chooseLibraryExercise({
          items: importedLibrary,
          slot: nextSlot,
          allowedEquipment,
          avoidTerms,
          usedIds,
          mustIncludeTerms,
          usedMustIncludeTerms,
        });
        return buildPlannedExercise(item, nextSlot, goal, recovery, experience);
      })
      .slice(0, maxExercises);

    return {
      key: blueprint.key,
      name: blueprint.name,
      orderIndex: sessionIndex,
      focus: blueprint.focus,
      exercises,
    };
  });

  appendUnplacedMustIncludes({
    sessions,
    items: importedLibrary,
    mustIncludeTerms,
    usedMustIncludeTerms,
    allowedEquipment,
    avoidTerms,
    usedIds,
    goal,
    recovery,
    experience,
    sessionMinutes,
  });

  return {
    title: `Vinha AI - ${daysPerWeek} Day ${formatAiGoalLabel(goal)}`,
    summary: `${daysPerWeek} sessions built around ${goal.replace('_', ' ')} with ${sessionMinutes}-minute sessions.`,
    goal,
    daysPerWeek,
    experience,
    equipment,
    recovery,
    sessionMinutes,
    sessions,
  };
}
