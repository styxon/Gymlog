import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { I18nKey } from './i18n';

/**
 * Recommendations that follow the program you actually chose.
 *
 * The old "For you" row had one source: the onboarding questionnaire. Skip the
 * questionnaire, or pick a ready program straight off the catalog, and the row
 * was empty forever — which is most people, because the reader had already told
 * us what they want by choosing a program. Choosing STRONG Starter is a
 * statement of intent every bit as strong as answering "strength" in a form,
 * and it is more recent.
 *
 * So this reads the active program and finds neighbours in the catalog. Every
 * suggestion carries the reason it is a neighbour, and the reason is derived
 * from fields the template really declares — goal, level, days per week — not
 * written per program by hand. A recommendation that cannot say why it is here
 * does not belong in the row.
 *
 * Deliberately NOT labelled AI. The model is never used to pick a programme,
 * and it is not: this is four comparisons and a sort.
 */

type AffinityReason =
  /** Same goal, one level up — the obvious next block. */
  | 'nextLevel'
  /** Same goal, same level, a different split. */
  | 'sameGoalOtherSplit'
  /** Same days per week, different goal — fits the week you already train. */
  | 'sameDays'
  /** Same goal, fewer days — for a week that got busier. */
  | 'lighterWeek';

interface AffinityMatch {
  templateId: string;
  reason: AffinityReason;
}

export const AFFINITY_REASON_KEYS: Record<AffinityReason, I18nKey> = {
  nextLevel: 'programs.affinity.nextLevel',
  sameGoalOtherSplit: 'programs.affinity.sameGoalOtherSplit',
  sameDays: 'programs.affinity.sameDays',
  lighterWeek: 'programs.affinity.lighterWeek',
};

/**
 * The key to say a reason with: its own singular sentence when the candidate
 * trains one day ("Lighter week: 1 day"), the plain key otherwise.
 */
export function affinityReasonKey(reason: AffinityReason, days: number): I18nKey {
  return singularAffinityKey(AFFINITY_REASON_KEYS[reason], days);
}

/** The same, for a key already chosen (the browse row carries keys, not reasons). */
export function singularAffinityKey(key: I18nKey, days: number): I18nKey {
  const carriesDays =
    key === AFFINITY_REASON_KEYS.sameGoalOtherSplit ||
    key === AFFINITY_REASON_KEYS.sameDays ||
    key === AFFINITY_REASON_KEYS.lighterWeek;
  return days === 1 && carriesDays ? (`${key}One` as I18nKey) : key;
}

const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced'] as const;

function levelIndex(level: string | undefined): number {
  const index = LEVEL_ORDER.indexOf((level ?? '') as (typeof LEVEL_ORDER)[number]);
  return index === -1 ? 1 : index;
}

/**
 * Neighbours of the active program, best reason first.
 *
 * Reasons are ranked, not the programs: "the same goal one level up" is a
 * better thing to say than "this also runs three days a week", so every
 * nextLevel match is offered before any sameDays one. Within a reason the
 * catalog order stands — there is no score here to pretend otherwise.
 */
export function resolveProgramAffinity(
  activeTemplate: WorkoutTemplateV1 | null | undefined,
  catalog: readonly WorkoutTemplateV1[],
  limit = 4,
): AffinityMatch[] {
  if (!activeTemplate) {
    return [];
  }

  const activeLevel = levelIndex(activeTemplate.level);
  const buckets: Record<AffinityReason, string[]> = {
    nextLevel: [],
    sameGoalOtherSplit: [],
    sameDays: [],
    lighterWeek: [],
  };

  for (const template of catalog) {
    if (template.id === activeTemplate.id) {
      continue;
    }
    const sameGoal = template.goalType === activeTemplate.goalType;
    const level = levelIndex(template.level);

    if (sameGoal && level === activeLevel + 1) {
      buckets.nextLevel.push(template.id);
    } else if (sameGoal && level === activeLevel && template.daysPerWeek !== activeTemplate.daysPerWeek) {
      buckets.sameGoalOtherSplit.push(template.id);
    } else if (sameGoal && template.daysPerWeek < activeTemplate.daysPerWeek) {
      buckets.lighterWeek.push(template.id);
    } else if (!sameGoal && template.daysPerWeek === activeTemplate.daysPerWeek) {
      buckets.sameDays.push(template.id);
    }
  }

  const order: AffinityReason[] = ['nextLevel', 'sameGoalOtherSplit', 'lighterWeek', 'sameDays'];
  const matches: AffinityMatch[] = [];
  const seen = new Set<string>();

  // No two cards may carry the IDENTICAL sentence. That is the device-found
  // fault this row once shipped ("Sama tavoite, taso ylöspäin" twice, side by
  // side, reading as a rendering bug) — but the rule lives on the rendered
  // sentence, not on the reason: three of the four sentences interpolate the
  // candidate's days, so "Sama tavoite, 3 päivää viikossa" next to "Sama
  // tavoite, 5 päivää viikossa" says two different things. nextLevel's
  // sentence is static, so it can appear once, ever.
  //
  // Round-robin: every reason speaks once, in quality order, before any
  // reason gets a second card — a catalog with 21 hypertrophy programs must
  // not spend the whole row on "same goal, different split" before the
  // level-up card has had its turn. (Row size raised from four on user
  // request, 2026-08-25.)
  const daysById = new Map(catalog.map((template) => [template.id, template.daysPerWeek]));
  const sentencesSaid = new Set<string>();
  const cursors: Record<AffinityReason, number> = {
    nextLevel: 0,
    sameGoalOtherSplit: 0,
    lighterWeek: 0,
    sameDays: 0,
  };

  let progressed = true;
  while (matches.length < limit && progressed) {
    progressed = false;
    for (const reason of order) {
      const bucket = buckets[reason];
      while (cursors[reason] < bucket.length) {
        const templateId = bucket[cursors[reason]];
        cursors[reason] += 1;
        if (seen.has(templateId)) {
          continue;
        }
        const sentence = reason === 'nextLevel' ? reason : `${reason}:${daysById.get(templateId)}`;
        if (sentencesSaid.has(sentence)) {
          continue;
        }
        seen.add(templateId);
        sentencesSaid.add(sentence);
        matches.push({ templateId, reason });
        progressed = true;
        break;
      }
      if (matches.length >= limit) {
        break;
      }
    }
  }

  return matches;
}
