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

/** "1 set", "3 sets" / "1 sarja", "3 sarjaa". */
export function setCountLabel(sets: number, language: AppLanguage): string {
  return sets === 1 ? t(language, 'count.setOne') : t(language, 'count.setMany', { count: sets });
}

/** "3 sets · 8–12 reps"; the rep text is already formatted ("1" is one rep). */
export function templateSetsRepsLabel(sets: number, repsText: string, language: AppLanguage): string {
  const reps = repsText === '1' ? t(language, 'count.repOne') : t(language, 'count.repMany', { count: repsText });
  return `${setCountLabel(sets, language)} · ${reps}`;
}

/** A plan day's line: "5 exercises · 15 sets", "1 exercise · 3 sets". */
export function planSessionMetaLabel(exercises: number, sets: number, language: AppLanguage): string {
  const exerciseText =
    exercises === 1 ? t(language, 'tpl.exerciseOne', { count: 1 }) : t(language, 'tpl.exerciseMany', { count: exercises });
  return `${exerciseText} · ${setCountLabel(sets, language)}`;
}

/** The workout log export's line: "12 sessions · 140 sets", "1 session · 3 sets". */
export function exportLogMetaLabel(sessions: number, sets: number, language: AppLanguage): string {
  const sessionText =
    sessions === 1 ? t(language, 'count.sessionOne') : t(language, 'count.sessionMany', { count: sessions });
  return `${sessionText} · ${setCountLabel(sets, language)}`;
}
