/**
 * "Yritän kasvattaa rinnanympärystä" typed into the coach chat is a goal the
 * user is stating, not a question. This reads that intent out of a message so
 * the chat can offer to save it — the coach then ties every later answer to
 * it. Offer only: nothing is saved without a tap.
 *
 * Same narrowness as measurementIntent: a goal word, a body-part word, and no
 * question mark. A missed goal costs one repeat; a false positive would nag
 * about saving a goal the reader never meant.
 */
import type { AppLanguage } from '../types/models';
import { KIND_WORDS, MeasurementIntentKind } from './measurementIntent';

export interface GoalIntent {
  /** The goal in the user's own words, trimmed. */
  text: string;
  kind: MeasurementIntentKind;
  targetValue: number | null;
  unit: 'cm' | 'kg' | '%' | null;
}

const GOAL_WORDS = /tavoit|haluan|haluaisin|yritän|aion|\bgoal\b|\btarget\b|i want|aim to|trying to|want to/i;

/**
 * Growth/change verbs — "haluan kasvattaa rinnanympärystä" is a goal, but
 * "haluan tietää rinnanympärykseni" is a question in statement's clothing.
 */
const DIRECTION_WORDS =
  /kasvat|isomma|nosta|lisä|pienen|pudott|laske|polt|kiinte|grow|bigger|increase|build|gain|lose|drop|cut|reach|tavoite?paino|tavoitteeni on|tavoite on|goal is|target is/i;

// "kilo\w*" alongside the literal unit: "90 kiloon", "80 kiloihin" name kg
// through the noun's own case ending rather than the abbreviation. Captured
// unit is normalised to 'kg' below before it is compared against the kind's.
const NUMBER = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(cm|kg|%|kilo\w*)/i;

/**
 * A number is a destination the sentence names, not a change from wherever
 * the reader is now, when it carries a case ending or preposition that says
 * so — and only when that marker sits on the number the sentence actually
 * matched, not merely somewhere in it. Checked against the whole message,
 * "asti" ("kesäkuuhun asti", until June — a date, not a weight) and English
 * "to" ("on a scale of 1 to 10, I want to lose 5 kg") both said "destination"
 * for a number they have nothing to do with, overriding RELATIVE_WORDS on a
 * sentence that never named one (found in recheck, 2026-09-29). So this is
 * checked by `numberNamesOwnDestination` below against the text immediately
 * touching the matched number, not the sentence at large — and "asti" is
 * left out of it entirely: every case it was meant to catch ("kiloon",
 * "kg:aan") already carries its own case ending, so "asti" added only the
 * false positive above and never a case the ending alone missed.
 *
 * Finnish illative/allative on the unit ("90 kg:aan") or on "kilo" itself
 * ("90 kiloon", "80 kiloihin" — the doubled vowel + n of illative case), or
 * English "to 90 kg", still override RELATIVE_WORDS: "nosta"/"nostaa"/
 * "laske"/"laskea" name a destination as often as a change ("nosta painoni
 * 90 kg:aan" vs "nosta painoa 5 kg").
 */
function numberNamesOwnDestination(message: string, match: RegExpMatchArray, rawUnit: string): boolean {
  // "90 kiloon", "80 kiloihin": the illative ending is already part of the
  // captured unit itself.
  if (rawUnit.startsWith('kilo') && /^(on|ihin)$/i.test(rawUnit.slice(4))) {
    return true;
  }
  const index = match.index;
  if (index === undefined) {
    return false;
  }
  const before = message.slice(0, index);
  const after = message.slice(index + match[0].length);
  // "90 kg:aan" / "90 kg:ään" — the allative suffix immediately follows the
  // matched "kg".
  if (/^\s*:\s*(?:aan|ään)\b/i.test(after)) {
    return true;
  }
  // English "to 90 kg" — "to" immediately precedes the matched number, not
  // just anywhere earlier in the sentence.
  if (/\bto\s*$/i.test(before)) {
    return true;
  }
  return false;
}

/**
 * A number phrased as a change from wherever the reader is now — "lisää
 * painoa 10 kg", "gain 10 kg" — rather than as the goal's own number. Saved
 * as a target, "nosta painoa 5 kg" from an 85 kg reader became a goal of
 * 5 kg. The goal is still worth keeping; the number just is not one, the
 * same conservative call already made for a unit that does not match the
 * kind.
 *
 * "kasvat" (kasvattaa/kasvaa) is deliberately left out even though it also
 * reads as a change verb ("kasvattaa painoa 10 kg"): unlike lisää/nosta/
 * pudottaa/laske, it is also the ordinary way to state a body-measurement
 * target itself — "haluan kasvattaa rinnanympärystä 104 cm" names the
 * destination size, the same absolute pattern "rinnanympärys 104 cm" and
 * "tavoite 95 kg" get. Matching "kasvat" here silently dropped that number
 * (regression caught in review, 2026-09-29) with no way to tell the two
 * readings apart from the words alone, so the narrower, previously-tested
 * reading wins instead.
 */
const RELATIVE_WORDS =
  /lisä|nosta|pudot|laske|vähemmän|enemmän|[+-]\s*\d|\badd\b|\bgain\b|\blose\b|\bdrop\b|\braise\b|\blower\b|\bmore\b|\bless\b/i;

/**
 * Goal sentences inflect: "kasvattaa rintaa", "laskea painoa". The reading
 * parser's KIND_WORDS match nominative forms only, so goals add the
 * partitives on top rather than loosening the logger's matching.
 */
const EXTRA_KIND_WORDS: Array<{ kind: MeasurementIntentKind; pattern: RegExp }> = [
  // "haluisin painaa 80 kg" is the commonest way to state a weight goal in
  // Finnish, and none of these forms was here — see `declared` below.
  // "painon" (genitive/total object — "nostaa painon 90 kiloon", raise the
  // weight to 90 kilos) alongside the partitive and illative forms already
  // here.
  { kind: 'bodyweight', pattern: /\bpainoa\b|\bpainoani\b|\bpainaa\b|\bpainaisin\b|\bpainoon\b|\bpainon\b/i },
  { kind: 'chest', pattern: /\brintaa\b|\brintaani\b/i },
  { kind: 'arms', pattern: /\bhauista\b|käsivarsia/i },
  { kind: 'thighs', pattern: /\breisiä\b/i },
  { kind: 'hips', pattern: /lantiota/i },
  { kind: 'calves', pattern: /pohkeita/i },
  { kind: 'shoulders', pattern: /hartioita/i },
];

function unitFor(kind: MeasurementIntentKind): 'cm' | 'kg' | '%' {
  if (kind === 'bodyweight') return 'kg';
  if (kind === 'bodyfat') return '%';
  return 'cm';
}

interface ParseGoalIntentOptions {
  /**
   * The caller already knows this is a goal — the coach attached a `set_goal`
   * suggestion — so only the body part and the number are still in question.
   *
   * Without this the two jobs shared one rule. Sniffing an unprompted message
   * must be strict, because a false positive nags about a goal nobody stated;
   * validating a declared one must not be, because the coach paraphrases. It
   * answered the reader's "haluisin painaa 80kg" by offering to save "painaa
   * 80 kg" — its own trim dropped the word the sniffer required, the offer was
   * silently discarded, and the answer went on telling the reader to press a
   * button that was never drawn ("En nää nappia", log 2026-08-25).
   */
  declared?: boolean;
}

export function parseGoalIntent(
  text: string,
  _language: AppLanguage = 'fi',
  { declared = false }: ParseGoalIntentOptions = {},
): GoalIntent | null {
  const message = text.trim();
  if (!message || message.includes('?')) {
    return null;
  }
  // A number with a unit implies the direction: "tavoite rinnanympärys 104 cm"
  // needs no verb to be a goal.
  if (!declared && (!GOAL_WORDS.test(message) || !(DIRECTION_WORDS.test(message) || NUMBER.test(message)))) {
    return null;
  }
  const match =
    KIND_WORDS.find((entry) => entry.pattern.test(message)) ?? EXTRA_KIND_WORDS.find((entry) => entry.pattern.test(message));
  if (!match) {
    return null;
  }

  // A target number is optional, and only counts with an explicit matching
  // unit: "tavoite rinta 104 cm" carries a target, "tavoite rinta 104 kg" is
  // a bench press dream and keeps the goal without the number. A relative
  // phrasing ("nosta painoa 5 kg") keeps the number out too — unless the
  // number itself names its own destination (numberNamesOwnDestination),
  // which reads the same growth/shrink verb the other way.
  const number = message.match(NUMBER);
  let targetValue: number | null = null;
  if (number) {
    const rawUnit = number[2].toLowerCase();
    const isRelative = RELATIVE_WORDS.test(message) && !numberNamesOwnDestination(message, number, rawUnit);
    if (!isRelative) {
      const value = Number(number[1].replace(',', '.'));
      const normalizedUnit = rawUnit.startsWith('kilo') ? 'kg' : rawUnit;
      if (Number.isFinite(value) && normalizedUnit === unitFor(match.kind)) {
        targetValue = Math.round(value * 10) / 10;
      }
    }
  }

  return {
    text: message,
    kind: match.kind,
    targetValue,
    unit: targetValue !== null ? unitFor(match.kind) : null,
  };
}
