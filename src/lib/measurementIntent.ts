/**
 * "Rinnanympärys on 90 cm" typed into the coach chat is a measurement the
 * reader wants logged, not a question (user, 2026-08-23). This reads that
 * intent out of a message so the chat can offer to log it — offer, because
 * the coach never writes anything without a tap.
 *
 * Deliberately narrow: a body-part word, a number, and no question mark.
 * "Should my chest be 100 cm?" is a question and parses to nothing; a
 * missed statement costs one manual entry, a false positive would offer to
 * log a number the reader never meant.
 */
import type { AppLanguage, MeasurementKind } from '../types/models';
import { measurementUnitForKind } from './measurementKinds';

export type MeasurementIntentKind = MeasurementKind | 'bodyweight';

export interface MeasurementIntent {
  kind: MeasurementIntentKind;
  value: number;
  unit: 'cm' | 'kg' | '%';
}

export const KIND_WORDS: Array<{ kind: MeasurementIntentKind; pattern: RegExp }> = [
  { kind: 'bodyfat', pattern: /rasvaprosent|rasva-?%|body ?fat/i },
  { kind: 'bodyweight', pattern: /\bpaino(ni)?\b|\bpainan\b|\bweigh(t|s)?\b|\bbodyweight\b/i },
  { kind: 'chest', pattern: /rinna(n|t)?\s*ympär|\brinta\b|\bchest\b/i },
  { kind: 'waist', pattern: /vyötärö|\bwaist\b/i },
  { kind: 'hips', pattern: /lantio|\bhips?\b/i },
  { kind: 'thighs', pattern: /\breisi|\breiden|\breidet|\bthighs?\b/i },
  { kind: 'calves', pattern: /\bpohje|\bpohkee|\bcalf\b|\bcalves\b/i },
  { kind: 'arms', pattern: /\bhauis|käsivar|olkavar|\barms?\b|\bbiceps?\b/i },
  { kind: 'shoulders', pattern: /\bhartia|\bolkapä|\bshoulders?\b/i },
];

/**
 * Every number in the message, whole ("1000" is one token, never "100"), with
 * where it stands and the unit written after it, if any. A clock time with a
 * colon ("7:15") is not a number here at all. Imperial units are read only to
 * be refused: "180 lb" logged as 180 kg would be a wrong reading, not a missed
 * one (hunt 1.1.1).
 */
const NUMBER_TOKEN = /(?<![\d.,])(?<!\d:)(\d+(?:[.,]\d+)*)(\.?)(?!\d|:\d)\s*(cm|kg|%|lbs?\b|pounds?\b|inch(?:es)?\b|in(?=\s*(?:$|[.,!;)]))|")?/gi;
/** A reading as a person types one: up to three digits, at most two decimals. */
const READING = /^\d{1,3}(?:[.,]\d{1,2})?$/;
/** Said just before a clock time: "klo 22.30", "kello 7". */
const CLOCK_BEFORE = /(?:\bklo|\bkello|@)\s*$/i;

interface NumberToken {
  raw: string;
  index: number;
  /** Where the token, its unit and the spaces after it end. */
  end: number;
  unit: string | null;
  /** A clock time after "klo", or a full date "30.10.2026": never a reading. */
  notReading: boolean;
  /** "30.10." — a date when it comes before the measurement word. */
  dayMonth: boolean;
  /** "30 päivää sitten", "30 days ago", "30 Oct": a count of time, not a reading. */
  timeCount: boolean;
}

/**
 * A word that makes the unitless number before it a duration, a count or a
 * date ("painoni 30 päivää sitten oli 85", "weight 30 Oct 82"). "may" is left
 * out on purpose: "weight 82 may vary" is a reading.
 */
const TIME_WORD_AFTER = new RegExp(
  '^(?:päiv(?:ä|än|ää|ien|iä|ina|inä)?|pv|vk|vko|viikko(?:a|n|lla)?|viikon|viikolla|kk|kuukau(?:si|den|tta|sia|sina)?|' +
    'vuo(?:si|den|tta|sia|sina|teen)?|tunti(?:a|in|na)?|tunnin|kertaa|krt|sitten|aikana|' +
    'days?|weeks?|wks?|months?|years?|yrs?|hours?|times|ago|' +
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|' +
    '(?:tammi|helmi|maalis|huhti|touko|kesä|heinä|elo|syys|loka|marras|joulu)(?:kuu[a-zäöå]*)?)(?![a-zäöå])',
  'i',
);

function numberTokens(message: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const match of message.matchAll(NUMBER_TOKEN)) {
    const raw = match[1];
    const index = match.index ?? 0;
    const parts = raw.split(/[.,]/);
    const before = message.slice(0, index);
    // A closing quote is not inches when an opening one came before: painoni "82".
    const unit = match[3] === '"' && before.includes('"') ? null : match[3] ? match[3].toLowerCase() : null;
    tokens.push({
      raw,
      index,
      end: index + match[0].length,
      unit,
      notReading: parts.length > 2 || CLOCK_BEFORE.test(before),
      timeCount: unit === null && TIME_WORD_AFTER.test(message.slice(index + match[0].length)),
      dayMonth:
        parts.length === 2 &&
        raw.includes('.') &&
        match[2] === '.' &&
        Number(parts[0]) >= 1 &&
        Number(parts[0]) <= 31 &&
        Number(parts[1]) >= 1 &&
        Number(parts[1]) <= 12,
    });
  }
  return tokens;
}

/**
 * The reading is the number that follows the measurement's own word: "paino
 * 82 ja vyötärö 90 cm" is 82 kg, "painoni 82 (viime viikolla 84 kg)" is 82.
 * Taking the first number in the message read a date or clock before it, and
 * taking any number with a unit read another measurement's (re-check of hunt
 * 1.1.1). A number right before the word, nothing between them, comes first
 * when it carries a unit or no reading follows the word: "82 kg paino,
 * treenasin 3 kertaa" is 82, "18 % rasvaprosentti 3 kk sitten" is 18, "82
 * paino 3 kertaa" is 82 (second re-check), but "viikolla 43 painoni oli 82 kg"
 * is 82, not the week (round 2). After the word, a "30.10." with another
 * number behind it is a date: "painoni 30.10. oli 82" is 82. With nothing
 * after the word, the last number before it that is not a date.
 */
function readingToken(
  tokens: readonly NumberToken[],
  message: string,
  wordAt: number,
  plausible: (token: NumberToken) => boolean,
): NumberToken | undefined {
  const usable = tokens.filter((token) => !token.notReading);
  const before = usable.filter((token) => token.index < wordAt && !token.dayMonth);
  const after = usable.filter((token) => token.index > wordAt);
  const leading = before[before.length - 1];
  // A duration or date ("30 päivää sitten", "30 Oct") is skipped; if nothing
  // else follows, the number before the word is the fallback as ever.
  const readings = after.filter((token) => !token.timeCount);
  const following = readings.find((token, at) => !(token.dayMonth && at < readings.length - 1));
  const adjacent = leading !== undefined && message.slice(leading.end, wordAt).trim() === '';
  if (adjacent && (leading.unit !== null || !following || !plausible(following))) {
    return leading;
  }
  return following ?? leading;
}

const RANGE: Record<MeasurementIntent['unit'], [number, number]> = {
  cm: [15, 250],
  kg: [25, 300],
  '%': [2, 70],
};

/**
 * Whether a string names a measurement this app can actually show a card for.
 * The coach may propose one by name, and a name the app does not know would
 * become a button that does nothing.
 */
export function isMeasurementIntentKind(value: string): value is MeasurementIntentKind {
  return KIND_WORDS.some((entry) => entry.kind === value);
}

function unitFor(kind: MeasurementIntentKind): MeasurementIntent['unit'] {
  // Bodyweight is this module's own extra kind; every other answer is the one
  // shared rule, so the two writers cannot drift apart again. The narrowing is
  // the parser's: it never reads a measurement in inches.
  if (kind === 'bodyweight') {
    return 'kg';
  }
  const unit = measurementUnitForKind(kind);
  return unit === 'in' ? 'cm' : unit;
}

export function parseMeasurementIntent(text: string, _language: AppLanguage = 'fi'): MeasurementIntent | null {
  const message = text.trim();
  if (!message || message.includes('?')) {
    return null;
  }
  // A goal is not a reading: "tavoite 100 cm" must not be logged as today's chest.
  if (/tavoit|goal|target|pitäisi|should|haluaisin|haluan|yritän|aion|want|aim|trying/i.test(message)) {
    return null;
  }

  const match = KIND_WORDS.find((entry) => entry.pattern.test(message));
  if (!match) {
    return null;
  }

  const read = (token: NumberToken): MeasurementIntent | null => {
    // A number that is not a reading shape is refused, never cut short: "1000 kg".
    if (!READING.test(token.raw)) {
      return null;
    }
    const value = Number(token.raw.replace(',', '.'));
    const unit = (token.unit as MeasurementIntent['unit'] | null) ?? unitFor(match.kind);
    if (unit !== unitFor(match.kind)) {
      // Also "180 lb" and "82 in": not this app's units, so not offered.
      // "rinta 80 kg" is a bench press, not a chest measurement.
      return null;
    }
    return validMeasurementIntent(match.kind, value, unit);
  };
  const number = readingToken(numberTokens(message), message, message.search(match.pattern), (token) => read(token) !== null);
  return number ? read(number) : null;
}

/**
 * The one rule for a reading to be offered for logging, whoever proposed it:
 * the typed message above, or a value the coach's reply carried. The unit has
 * to be the kind's own (kilograms for bodyweight, percent for body fat, cm for
 * the tape) and the value inside that unit's plausible window; anything else
 * is null, and the caller drops the offer.
 */
export function validMeasurementIntent(kind: MeasurementIntentKind, value: unknown, unit: unknown): MeasurementIntent | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const expected = unitFor(kind);
  if (unit !== expected) {
    return null;
  }
  const [min, max] = RANGE[expected];
  if (value < min || value > max) {
    return null;
  }
  return { kind, value: Math.round(value * 10) / 10, unit: expected };
}
