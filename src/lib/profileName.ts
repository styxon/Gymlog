/**
 * The profile name's limits, shared by every place that writes or draws it.
 *
 * Cut on code points, not UTF-16 units: `slice` through the middle of an emoji
 * leaves a lone surrogate, which draws as a replacement glyph and survives the
 * backup round trip. Adoption from the account (32) and the Edit profile field
 * (30) also disagreed on the limit, so an adopted 31-character name read
 * "31/30" there and lost a character on the first edit.
 */
export const MAX_PROFILE_NAME_LENGTH = 32;

/** The first `max` characters of `text`, never splitting a character. */
export function clipToCodePoints(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : characters.slice(0, max).join('');
}

/** How many characters `text` shows, an emoji counting once. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function clampProfileName(name: string): string {
  return clipToCodePoints(name, MAX_PROFILE_NAME_LENGTH);
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
 * whole emoji rather than half of it.
 */
export function profileInitials(name: string | null | undefined, fallback = 'V'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return fallback;
  }
  const first = Array.from(parts[0])[0] ?? fallback;
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + second).toUpperCase();
}
