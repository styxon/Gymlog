/**
 * The profile name's limits, shared by every place that writes or draws it.
 *
 * Cut on characters as the reader sees them, not on UTF-16 units or code
 * points: `slice` through the middle of an emoji leaves a lone surrogate, and
 * a cut between code points splits a flag, a family or a skin tone into half
 * of one (a dangling joiner, a letter pair with no country). Both draw as
 * replacement glyphs and survive the backup round trip. Adoption from the
 * account (32) and the Edit profile field (30) also disagreed on the limit, so
 * an adopted 31-character name read "31/30" there and lost a character on the
 * first edit.
 */
export const MAX_PROFILE_NAME_LENGTH = 32;

/**
 * Longest run of code points kept as one character. A run of combining marks
 * has no end, and one "character" must not be a way round the name's limit.
 */
const MAX_CLUSTER_CODE_POINTS = 24;

const EXTENDS = /^[\p{M}\u200C\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]$/u;
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
const ZERO_WIDTH_JOINER = '\u200D';

const isRegionalIndicator = (point: string): boolean => {
  const code = point.codePointAt(0) ?? 0;
  return code >= 0x1f1e6 && code <= 0x1f1ff;
};

/**
 * `text` split into the characters a reader counts: a letter with its
 * accents, a flag (two regional indicators), an emoji with its variation
 * selector, skin tone and tag characters, and a joined sequence (family,
 * profession) as one. Hermes ships no Intl.Segmenter, so this is the part of
 * UAX #29 a name needs, written out; the same split runs on the phone and in
 * the tests.
 */
export function splitCharacters(text: string): string[] {
  const points = Array.from(text);
  const characters: string[] = [];
  let index = 0;
  while (index < points.length) {
    let character = points[index];
    let size = 1;
    index += 1;
    if (character === '\r' && points[index] === '\n') {
      character += '\n';
      index += 1;
    } else if (isRegionalIndicator(character) && index < points.length && isRegionalIndicator(points[index])) {
      character += points[index];
      size += 1;
      index += 1;
    }
    while (index < points.length && size < MAX_CLUSTER_CODE_POINTS) {
      const next = points[index];
      if (EXTENDS.test(next)) {
        character += next;
      } else if (next === ZERO_WIDTH_JOINER) {
        character += next;
        size += 1;
        index += 1;
        // The joiner binds the picture after it; before a letter it is only a joiner.
        if (index < points.length && PICTOGRAPH.test(points[index])) {
          character += points[index];
        } else {
          continue;
        }
      } else {
        break;
      }
      size += 1;
      index += 1;
    }
    characters.push(character);
  }
  return characters;
}

/** The first `max` characters of `text`, never splitting a character. */
export function clipToCharacters(text: string, max: number): string {
  const characters = splitCharacters(text);
  return characters.length <= max ? text : characters.slice(0, max).join('');
}

/** How many characters `text` shows, an emoji or a flag counting once. */
export function characterCount(text: string): number {
  return splitCharacters(text).length;
}

export function clampProfileName(name: string): string {
  return clipToCharacters(name, MAX_PROFILE_NAME_LENGTH);
}

/**
 * The name as stored: trimmed, cut, and trimmed again, since the cut can leave
 * a space at the end. Normalising twice gives the same name (the backup round
 * trip loads a stored name through this again).
 */
export function storedProfileName(name: string): string {
  return clampProfileName(name.trim()).trimEnd();
}

/**
 * One or two letters for the avatar: the first character of the first and, with
 * more than one word, of the last. A name that opens with an emoji gives the
 * whole emoji rather than half of it, and a letter that upper-cases to two
 * (German sharp s to "SS") still gives one.
 */
export function profileInitials(name: string | null | undefined, fallback = 'V'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return fallback;
  }
  const initialOf = (word: string): string => {
    const first = splitCharacters(word)[0] ?? '';
    return splitCharacters(first.toUpperCase())[0] ?? first;
  };
  const first = initialOf(parts[0]) || fallback;
  const second = parts.length > 1 ? initialOf(parts[parts.length - 1]) : '';
  return first + second;
}
