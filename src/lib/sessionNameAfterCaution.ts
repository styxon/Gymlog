import { classifySessionFocus, SessionFocusKind } from './homeSessionHero';

/**
 * A day named for a lift it no longer has: "Day 1: Squat & Bench" over a day
 * whose squats the reader's knees took out (persona hunt, 2026-10-08).
 *
 * The lift words a catalogue day name carries, each with the exercises that
 * still honour it. A leg press or a lunge keeps "Squat" true; a pulldown keeps
 * "Row". Whole words only, and a name that carries none of these (a day called
 * "Lower (Pressure)") is never touched.
 */
const LIFT_WORDS: ReadonlyArray<{ word: RegExp; kept: RegExp }> = [
  { word: /^squats?(?:\s+day)?$/i, kept: /squat|leg press|lunge|step-?up|hack/i },
  { word: /^deadlifts?(?:\s+day)?$/i, kept: /deadlift/i },
  { word: /^bench(?:\s+day)?$/i, kept: /bench|chest press|push-?up|dip\b/i },
  { word: /^press(?:\s+day)?$/i, kept: /press|push-?up|dip\b/i },
  { word: /^row(?:\s+day)?$/i, kept: /row|pulldown|pull-?up|chin-?up/i },
];

const FOCUS_WORD: Record<SessionFocusKind, string> = {
  lower: 'Lower',
  upper: 'Upper',
  push: 'Push',
  pull: 'Pull',
  general: 'Full Body',
};

/**
 * The day's name with the lift words nothing on the day honours any more taken
 * out. When that leaves nothing, the day is named for what it is now.
 *
 * Only the words are touched, so the "Day 1: " lead stays and the Finnish
 * lookup (sessionNameLabel) keeps working on what is left.
 */
export function sessionNameAfterLiftsLeft(name: string, exerciseNames: readonly string[]): string {
  const lead = name.match(/^(\s*Day\s+\d+\s*:\s*)(.*)$/i);
  const prefix = lead ? lead[1] : '';
  const body = lead ? lead[2] : name;

  // Words and the separators between them: ["Squat", " & ", "Bench"].
  const tokens = body.split(/(\s*[&+]\s*)/);
  const stays: string[] = [];
  const separators: string[] = [];
  let dropped = false;
  for (let index = 0; index < tokens.length; index += 2) {
    const word = tokens[index].trim();
    const lift = LIFT_WORDS.find((entry) => entry.word.test(word));
    if (lift && !exerciseNames.some((exercise) => lift.kept.test(exercise))) {
      dropped = true;
      continue;
    }
    if (stays.length > 0) {
      // The separator that stood in front of this word.
      separators.push(tokens[index - 1] ?? ' & ');
    }
    stays.push(word);
  }

  if (!dropped) {
    return name;
  }
  if (stays.length === 0) {
    return `${prefix}${FOCUS_WORD[classifySessionFocus([...exerciseNames])]}`;
  }
  return `${prefix}${stays.map((word, index) => (index === 0 ? word : `${separators[index - 1]}${word}`)).join('')}`;
}
