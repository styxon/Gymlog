import { AppLanguage } from '../types/models';
import { t } from './i18n';

/**
 * Copy that counts repetitions, with the singular form where the count is 1.
 * The app has no plural engine ("1 toistoa" is not Finnish, "1 reps" is not
 * English), so each count-carrying line picks its own key here.
 */

export function repsDeltaLabel(delta: number, language: AppLanguage): string {
  return delta === 1 ? t(language, 'pr.delta.repsOne') : t(language, 'pr.delta.reps', { delta });
}

export function prMoreRepsLabel(delta: number, weight: string | number, language: AppLanguage): string {
  return delta === 1
    ? t(language, 'complete.pr.moreRepsOne', { weight })
    : t(language, 'complete.pr.moreReps', { delta, weight });
}

export function unloadedSetRowLabel(reps: number, language: AppLanguage): string {
  return reps === 1 ? t(language, 'guided.rest.setRowUnloadedOne') : t(language, 'guided.rest.setRowUnloaded', { reps });
}

/** The walk-up card's ramp line: "10/8/6 reps · 90 s rest", or "1 rep" when that is all the ramp holds. */
export function walkRampLabel(reps: readonly number[], rest: number, language: AppLanguage): string {
  const joined = reps.join('/');
  return joined === '1'
    ? t(language, 'guided.walk.planRampOne', { rest })
    : t(language, 'guided.walk.planRamp', { reps: joined, rest });
}

export function walkSupersetRampLabel(reps: readonly number[], name: string, language: AppLanguage): string {
  const joined = reps.join('/');
  return joined === '1'
    ? t(language, 'guided.walk.planSupersetRampOne', { name })
    : t(language, 'guided.walk.planSupersetRamp', { reps: joined, name });
}

export function milestoneRepsTitle(target: number, formatted: string, language: AppLanguage): string {
  return target === 1
    ? t(language, 'profile.milestone.reps.titleOne')
    : t(language, 'profile.milestone.reps.title', { target: formatted });
}

export function milestoneRepsMeta(current: string, target: number, formattedTarget: string, language: AppLanguage): string {
  return target === 1
    ? t(language, 'profile.milestone.reps.metaOne', { current })
    : t(language, 'profile.milestone.reps.meta', { current, target: formattedTarget });
}

/** "3 sets · 8–12 reps"; the rep text is already formatted ("1" is one rep). */
export function templateSetsRepsLabel(sets: number, repsText: string, language: AppLanguage): string {
  return repsText === '1'
    ? t(language, 'tpl.setsRepsOne', { sets })
    : t(language, 'tpl.setsReps', { sets, reps: repsText });
}
