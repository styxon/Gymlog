interface CoachTextPart {
  value: string;
  highlighted: boolean;
}

/**
 * Splits a coach sentence into plain and emphasised parts.
 *
 * The module builder hands over the finished sentence plus the exact
 * substrings it interpolated, so emphasis follows the real figures in either
 * language — a hand-placed bold tag would land on the wrong word the moment
 * Finnish reorders the sentence.
 */
export function splitOnHighlights(text: string, highlights: string[]): CoachTextPart[] {
  const wanted = highlights.filter((value) => value.trim().length > 0);
  if (wanted.length === 0) {
    return [{ value: text, highlighted: false }];
  }

  // Longest first, so "92.5 kg" wins over the bare "92.5" nested inside it.
  const ordered = [...new Set(wanted)].sort((left, right) => right.length - left.length);
  let parts: CoachTextPart[] = [{ value: text, highlighted: false }];

  for (const needle of ordered) {
    const next: CoachTextPart[] = [];
    for (const part of parts) {
      if (part.highlighted || !part.value.includes(needle)) {
        next.push(part);
        continue;
      }

      const pieces = part.value.split(needle);
      pieces.forEach((piece, index) => {
        if (piece.length > 0) {
          next.push({ value: piece, highlighted: false });
        }
        if (index < pieces.length - 1) {
          next.push({ value: needle, highlighted: true });
        }
      });
    }
    parts = next;
  }

  return parts;
}
