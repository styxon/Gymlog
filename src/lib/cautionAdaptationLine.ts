import { exerciseNameLabel } from './exerciseNameLabel';
import { I18nKey, t } from './i18n';
import type { ComposedProgramWeek } from './programDayComposer';
import type { AppLanguage } from '../types/models';

/**
 * What the reader's caution flags did to the week they were handed, in one
 * plain line: "Knees: Back Squat, Leg Press left out. Shoulders: Arnold Press
 * swapped."
 *
 * The composer removes and swaps lifts for a flagged joint and said nothing:
 * a reader who marked their knees found a different week than the catalogue's
 * and no word of why (persona hunt, 2026-10-08). Only the exception is named,
 * so a reader with no flags, or with a flag that changed nothing, gets no line.
 * Gear is not named: a home reader's whole week is gear-shaped, and a line on
 * every one of them would label the normal.
 *
 * Each lift is named once however many days it was on: the composer records a
 * removal per day. A lift the week still has somewhere (a day that could not
 * take its replacement keeps the movement) is not claimed as gone.
 */

type CautionAdaptationWeek = Pick<ComposedProgramWeek, 'cautionRemoved' | 'cautionSwapped' | 'sessions'>;

const NAMES_SHOWN = 2;

function distinct(names: string[]) {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatNames(names: string[], language: AppLanguage) {
  const labels = names.map((name) => exerciseNameLabel(language, name));
  const shown = labels.slice(0, NAMES_SHOWN);
  const joined = shown.length === 2 ? t(language, 'recExp.list.two', { first: shown[0], second: shown[1] }) : shown[0];
  return labels.length > NAMES_SHOWN
    ? t(language, 'caution.line.more', { names: shown.join(', '), count: labels.length - NAMES_SHOWN })
    : joined;
}

export function buildCautionAdaptationLine(
  week: CautionAdaptationWeek | null | undefined,
  language: AppLanguage = 'en',
): string | null {
  if (!week || (week.cautionRemoved.length === 0 && week.cautionSwapped.length === 0)) {
    return null;
  }

  const stillInWeek = new Set(
    week.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName.trim().toLowerCase())),
  );
  const gone = (name: string) => !stillInWeek.has(name.trim().toLowerCase());

  const areas: string[] = [];
  const remember = (area: string) => {
    if (!areas.includes(area)) {
      areas.push(area);
    }
  };
  week.cautionRemoved.forEach((entry) => remember(entry.area));
  week.cautionSwapped.forEach((entry) => remember(entry.area));

  const lines: string[] = [];
  for (const area of areas) {
    const removed = distinct(
      week.cautionRemoved.filter((entry) => entry.area === area && gone(entry.name)).map((entry) => entry.name),
    );
    const swapped = distinct(
      week.cautionSwapped.filter((entry) => entry.area === area && gone(entry.from)).map((entry) => entry.from),
    );
    if (removed.length === 0 && swapped.length === 0) {
      continue;
    }
    const areaLabel = t(language, `onb.area.${area}` as I18nKey);
    if (removed.length > 0 && swapped.length > 0) {
      lines.push(
        t(language, 'caution.line.both', {
          area: areaLabel,
          removed: formatNames(removed, language),
          swapped: formatNames(swapped, language),
        }),
      );
    } else if (removed.length > 0) {
      lines.push(t(language, 'caution.line.removed', { area: areaLabel, names: formatNames(removed, language) }));
    } else {
      lines.push(t(language, 'caution.line.swapped', { area: areaLabel, names: formatNames(swapped, language) }));
    }
  }

  return lines.length > 0 ? lines.join(' ') : null;
}
