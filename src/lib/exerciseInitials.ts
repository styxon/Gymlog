/**
 * The letters drawn where a lift has no picture: the first letter of each of
 * its first two words, from the name the reader reads.
 *
 * Four screens had four answers for the same missing picture (owner's #10,
 * iOS hunt 2026-10-17): the set card took the first two letters of the
 * Finnish name ("Lantionnosto laitteessa" -> "LA"), the walk-up the English
 * initials ("MH"), the exercise picker one letter. And words starting with Ä
 * or Ö were dropped, so a Finnish name could lose its initial.
 */
export function exerciseInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}
