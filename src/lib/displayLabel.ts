import { t } from './i18n';
import { AppLanguage } from '../types/models';

function collapseWhitespace(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Both suffix words, because a stored name can be either: English names were
 * written before the suffix was translated, and both keep arriving from
 * duplication. The matched word is carried out so canonicalising a Finnish
 * name does not rewrite it into English.
 *
 * Regex literals rather than `new RegExp` on a template string: in a template
 * literal `\s` is not an escape, so it collapses to a plain "s" and the pattern
 * silently stops matching whitespace. Written that way this function returned
 * null for every input and the suffix logic quietly did nothing.
 */
function parseCopySuffix(value: string) {
  const modernMatch = value.match(/^(.*?)(?:\s*\((copy|kopio)(?:\s+(\d+))?\))$/i);
  if (modernMatch) {
    return {
      core: collapseWhitespace(modernMatch[1]),
      word: modernMatch[2].toLowerCase(),
      copyIndex: modernMatch[3] ? Number(modernMatch[3]) : 1,
    };
  }

  const legacyMatch = value.match(/^(.*?)(?:\s+(copy|kopio)(?:\s+(\d+))?)$/i);
  if (legacyMatch) {
    return {
      core: collapseWhitespace(legacyMatch[1]),
      word: legacyMatch[2].toLowerCase(),
      copyIndex: legacyMatch[3] ? Number(legacyMatch[3]) : 1,
    };
  }

  return null;
}

function normalizeDisplayKey(value: string) {
  const normalized = collapseWhitespace(value).toLowerCase();
  if (!normalized) {
    return '';
  }

  const copy = parseCopySuffix(normalized);
  if (!copy) {
    return normalized;
  }

  return `${copy.core} (${copy.word}${copy.copyIndex > 1 ? ` ${copy.copyIndex}` : ''})`;
}

export function formatDisplayLabel(
  value: string | null | undefined,
  {
    fallback,
    minimumCoreLength = 2,
  }: {
    fallback: string;
    minimumCoreLength?: number;
  },
) {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return fallback;
  }

  const copy = parseCopySuffix(normalized);
  const core = copy ? copy.core : normalized;
  if (core.length < minimumCoreLength) {
    return fallback;
  }

  return copy
    ? `${core} (${copy.word}${copy.copyIndex > 1 ? ` ${copy.copyIndex}` : ''})`
    : normalized;
}

/**
 * A programme's or a day's name. One character is a name: "A", "B", "5" were
 * shown as "Custom workout" (English, on a Finnish phone) because the two-
 * character floor meant for a lift name mangled by an import applied to the
 * names the reader types, and the builder accepts any non-blank one (hunt
 * 2026-10-09). Only a name that is nothing once the copy suffix is taken off
 * still falls back.
 */
export function formatWorkoutDisplayLabel(value: string | null | undefined, fallback = 'Custom workout') {
  return formatDisplayLabel(value, { fallback, minimumCoreLength: 1 });
}

export function formatLiftDisplayLabel(value: string | null | undefined, fallback = 'Unnamed lift') {
  return formatDisplayLabel(value, { fallback });
}

/**
 * The name a duplicated program gets.
 *
 * `language` is not optional. The suffix and the fallback were English
 * literals, so a Finnish user duplicating a program got "Rintavoima (copy)"
 * written into their own data — visible on every screen that shows the name,
 * and permanent, because the name is stored rather than derived.
 */
export function buildDisplayCopyName(
  baseName: string,
  language: AppLanguage,
  existingNames: string[] = [],
  fallback?: string,
) {
  const suffix = t(language, 'common.copySuffix');
  const baseLabel = formatWorkoutDisplayLabel(baseName, fallback ?? t(language, 'common.customWorkout'));
  const taken = new Set(existingNames.map(normalizeDisplayKey));
  const initialCandidate = `${baseLabel} (${suffix})`;

  if (!taken.has(normalizeDisplayKey(initialCandidate))) {
    return initialCandidate;
  }

  let index = 2;
  while (taken.has(normalizeDisplayKey(`${baseLabel} (${suffix} ${index})`))) {
    index += 1;
  }

  return `${baseLabel} (${suffix} ${index})`;
}