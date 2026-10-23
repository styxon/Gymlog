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
 * the unit written after it if any. A clock time with a colon is not a number
 * here at all. Imperial units are read only to be refused: "180 lb" logged as
 * 180 kg would be a wrong reading, not a missed one (hunt 1.1.1).
 */
const NUMBER_TOKEN = /(?<![\d.,:])(\d+(?:[.,]\d+)*)(\.?)(?![\d:])\s*(cm|kg|%|lbs?\b|pounds?\b|inch(?:es)?\b|in(?=\s*(?:$|[.,!;)]))|")?/gi;
/** A reading as a person types one: up to three digits, at most two decimals. */
const READING = /^\d{1,3}(?:[.,]\d{1,2})?$/;
/** Said just before a clock time: "klo 22.30", "at 7.15". */
const CLOCK_BEFORE = /(?:\bklo|\bkello|\bat|@)\s*$/i;

interface NumberToken {
  raw: string;
  unit: string | null;
  /** "30.10." or "30.10.2026", or a time after "klo": a date or a clock, never a reading. */
  dateOrTime: boolean;
}

function numberTokens(message: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const match of message.matchAll(NUMBER_TOKEN)) {
    const raw = match[1];
    const parts = raw.split(/[.,]/);
    const dayMonth =
      parts.length === 2 &&
      raw.includes('.') &&
      match[2] === '.' &&
      Number(parts[0]) >= 1 &&
      Number(parts[0]) <= 31 &&
      Number(parts[1]) >= 1 &&
      Number(parts[1]) <= 12;
    const before = message.slice(0, match.index ?? 0);
    tokens.push({
      raw,
      unit: match[3] ? match[3].toLowerCase() : null,
      dateOrTime: parts.length > 2 || dayMonth || CLOCK_BEFORE.test(before),
    });
  }
  return tokens;
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

  // The number with a unit written after it is the reading; without one, the
  // first number that is not a date or a clock time. A unit names the reading
  // even when its number is not one: "1000 kg" is refused, never cut to 100.
  const tokens = numberTokens(message);
  const number = tokens.find((token) => token.unit !== null) ?? tokens.find((token) => !token.dateOrTime);
  if (!number || !READING.test(number.raw)) {
    return null;
  }
  const value = Number(number.raw.replace(',', '.'));
  const unit = (number.unit as MeasurementIntent['unit'] | null) ?? unitFor(match.kind);
  if (unit !== unitFor(match.kind)) {
    // Also "180 lb" and "82 in": not this app's units, so not offered.
    // "rinta 80 kg" is a bench press, not a chest measurement.
    return null;
  }
  return validMeasurementIntent(match.kind, value, unit);
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
