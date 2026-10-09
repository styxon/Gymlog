import type { AppLanguage, ExerciseNameBookEntry, WorkoutTemplateDraft } from '../types/models';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import { isMinutesTrackingMode, prescriptionUnitOf, WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { collapseCellWhitespace, splitCsvRecords, unguardCsvFormula } from './csvRecords';
import { isBrowsableExercise } from './exerciseBrowseFilter';
import { isSpecialtyExercise } from './exerciseClassification';
import { lookupNameBook } from './exerciseNameBook';
import { PLAIN_EXERCISE_NAMES, TRANSLATED_EXERCISE_NAMES } from './exerciseNameLabel';
import { findFiledLibraryIndex, findFiledLibraryIndexAsWritten } from './guidedPlayer';
import { t } from './i18n';
import { isHoldExerciseName } from './holdExercises';
import { intervalOffSeconds, parseIntervalScheme } from './intervalScheme';
import { MINUTES_DIAL } from './weightDial';
import { readsAsMinutesByName } from './minutesExercises';
import { PROGRAM_SETS_RANGE } from './programSessionEdit';

/**
 * CSV program import (design_handoff_programs_redesign):
 * columns Day, Exercise, Sets, Reps — lenient on header casing, delimiter
 * (comma / semicolon / tab) and rep formats ("8", "6-10", "6–10").
 * Exercise names are fuzzy-matched against the exercise library; unmatched
 * rows are flagged (with a suggestion when one is close) so the user can
 * fix or skip them before importing.
 */

export interface CsvLibraryEntry {
  id: string;
  name: string;
  /** The library row's source category, so a guess can tell a strongman implement apart. */
  sourceCategory?: string | null;
}

/**
 * Whether a guess may land on this entry — the pickers' unsearched rule. A
 * guess is the app choosing, and it offered "Conventional Deadlift" as Axle
 * Deadlift and "Quad Extension" as Quad Stretch (#bugs 2026-10-06). The name
 * written out, the app's own label or the reader's name book still reach
 * every row; so does a written name that itself says stretch.
 */
function mayGuess(entry: IndexedLibraryEntry, writtenNamesANonSet: boolean): boolean {
  return !entry.specialty && (writtenNamesANonSet || entry.browsable);
}

/**
 * A library row with everything the matcher derives from its name, worked out
 * once. A row that matches nothing used to re-fold every one of the library's
 * rows and build a RegExp for each, about 3 ms in Node, and the programme
 * sheet parses again on every keystroke in the paste box.
 */
interface IndexedLibraryEntry {
  entry: CsvLibraryEntry;
  normalized: string;
  compact: string;
  folded: string;
  foldedCompact: string;
  /** ` normalized ` — a whole-word test is a plain substring test on these. */
  padded: string;
  tokens: ReadonlySet<string>;
  specialty: boolean;
  browsable: boolean;
}

const LIBRARY_INDEXES = new WeakMap<CsvLibraryEntry[], IndexedLibraryEntry[]>();

function indexLibrary(library: CsvLibraryEntry[]): IndexedLibraryEntry[] {
  const known = LIBRARY_INDEXES.get(library);
  if (known && known.length === library.length) {
    return known;
  }
  const indexed = library.map((entry): IndexedLibraryEntry => {
    const normalized = normalizeName(entry.name);
    const folded = foldPlural(normalized);
    return {
      entry,
      normalized,
      compact: normalized.replace(/ /g, ''),
      folded,
      foldedCompact: folded.replace(/ /g, ''),
      padded: ` ${normalized} `,
      tokens: new Set(normalized.split(' ').filter(Boolean)),
      specialty: isSpecialtyExercise({ name: entry.name, sourceCategory: entry.sourceCategory ?? undefined }),
      browsable: isBrowsableExercise(entry),
    };
  });
  LIBRARY_INDEXES.set(library, indexed);
  return indexed;
}

export interface CsvProgramRow {
  day: string;
  exerciseName: string;
  sets: number;
  repMin: number;
  repMax: number;
  /**
   * The file's "Day no" for this row. The app's export numbers its days when
   * two share a name (Workout A, B, A), and grouping by name alone made them
   * one day with every lift twice (round 2, 2026-10-08). Absent when the file
   * has no numbers; the name groups the rows then, as it always did.
   */
  dayNumber?: number;
  /** The Reps cell said minutes ("20 min"). Absent for every other row. */
  minutes?: boolean;
  /**
   * How the row is logged, where the name it links to might say otherwise:
   * any hold, which was read in seconds, and a ready programme's row filed
   * under a library row of another name — "Glute Bridge Hold" under the
   * barbell bridge, "Rowing Machine HIIT" under the rower the library logs in
   * minutes. Absent for every other row; the unit is read off the name where
   * the programme runs.
   */
  trackingMode?: WorkoutTrackingMode;
  matchedName: string | null;
  libraryItemId: string | null;
  suggestion: string | null;
  /**
   * Matched because the reader taught this spelling, not because the fuzzy
   * match found it. Worth showing: it is the difference between the app
   * guessing and the app remembering.
   */
  viaNameBook: boolean;
}

export interface CsvProgramPreview {
  rows: CsvProgramRow[];
  matchedCount: number;
  unmatchedCount: number;
  dayCount: number;
  errors: string[];
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A day name as the importer groups it: two names with one key are one day. */
export function csvDayNameKey(value: string) {
  // A name with no a-z or digit in it ("Пн", "💪", "Ä") folds to nothing, and
  // every such day would share the one empty key and merge into a single day.
  return normalizeName(value) || value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fi');
}

/** The optional column that numbers the days, and the key its header folds to. */
export const CSV_DAY_NUMBER_HEADER = 'Day no';
const CSV_DAY_NUMBER_KEY = normalizeName(CSV_DAY_NUMBER_HEADER);

/**
 * Every name the ready programmes prescribe, with how its first row logs it —
 * null when two rows of the same name log it in different units.
 *
 * The app's own export writes these names, and the catalogue is what they
 * mean: it alone knows "Glute Bridge Hold" is held for seconds although its
 * history is filed under the barbell bridge (bug hunt, 2026-10-08).
 */
const READY_PROGRAMME_MODES: ReadonlyMap<string, WorkoutTrackingMode | null> = (() => {
  const modes = new Map<string, WorkoutTrackingMode | null>();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        const key = exercise.exerciseName.trim().toLowerCase();
        const known = modes.get(key);
        if (known === undefined) {
          modes.set(key, exercise.trackingMode);
        } else if (known !== null && prescriptionUnitOf(known) !== prescriptionUnitOf(exercise.trackingMode)) {
          modes.set(key, null);
        }
      }
    }
  }
  return modes;
})();

function isReadyProgrammeName(name: string) {
  return READY_PROGRAMME_MODES.has(name.trim().toLowerCase());
}

/** The catalogue's own spelling of a ready programme's name, whatever the case it was written in. */
const READY_PROGRAMME_SPELLINGS: ReadonlyMap<string, string> = new Map(
  WORKOUT_TEMPLATES_V1.flatMap((template) =>
    template.sessions.flatMap((session) =>
      session.exercises.map((exercise) => [exercise.exerciseName.trim().toLowerCase(), exercise.exerciseName] as const),
    ),
  ),
);

/**
 * A programme's rhythm is one weekday mask (ProgramDetailScreen's week strip
 * is seven chips, `getTrainingDayIndexes` clamps to `Math.min(dayCount, 7)`).
 * An 8-day CSV used to import 8 sessions while the title, the chips and the
 * rhythm editor could only ever show seven of them — the reader saw "8 days"
 * on a plan the app could never schedule past day 7 (2026-09-26). Capping
 * here, with a visible reason, keeps the title, the chips and the rhythm
 * editor telling the same number.
 */
const MAX_TRAINING_DAYS = 7;

function detectDelimiter(headerLine: string) {
  if (headerLine.includes('\t')) {
    return '\t';
  }
  if (headerLine.includes(';')) {
    return ';';
  }
  return ',';
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  // A quote opens a quoted cell only where a cell starts (leading spaces
  // allowed), the rule splitCsvRecords splits the records by. Opening one on
  // every quote let the inch mark in `Box Jump (24")` swallow the Sets and
  // Reps cells, and the row was refused as "sets must be a whole number"
  // (round 2, 2026-10-08).
  let atCellStart = true;
  let openQuoteIndex = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is one literal quote — the CSV
        // escape. This dropped every quote character instead, so a lift called
        // Bench ("close grip") arrived with its quotes silently removed. Found
        // when the photo importer, which writes this format itself, round
        // -tripped a name through it (2026-08-24).
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' && atCellStart) {
      inQuotes = true;
      openQuoteIndex = index;
      continue;
    }
    if (char === delimiter) {
      cells.push(current.trim());
      current = '';
      atCellStart = true;
      continue;
    }
    current += char;
    atCellStart = atCellStart && (char === ' ' || char === '\t');
  }
  if (inQuotes) {
    // A quote that never closes is a plain character, as splitCsvRecords
    // reads it, and that splitter has already named the row. Read as an open
    // cell, it took the rest of the line along and the row got a second,
    // wrong error about its sets.
    const head = splitCsvLine(line.slice(0, openQuoteIndex), delimiter);
    const tail = line.slice(openQuoteIndex).split(delimiter).map((cell) => cell.trim());
    return [...head.slice(0, -1), `${head[head.length - 1]}${tail[0]}`.trim(), ...tail.slice(1)];
  }
  cells.push(current.trim());
  return cells;
}

/**
 * The largest number a Reps cell may hold.
 *
 * The editor's stepper stops at PROGRAM_REPS_RANGE (50), but that ceiling is
 * for a thumb, and the programmes the app itself ships go past it: a 60 s
 * plank, a 300 s wall sit, a 200 m sprint, a 500 m row. Exporting those and
 * importing them again has to work, so the importer's ceiling is the largest
 * thing the catalog prescribes — 500 for a count or a distance, and 600
 * seconds for a hold. A typo of 100000 is past both and is refused, like a
 * sets count over the editor's 12.
 */
export const CSV_REPS_MAX = 500;
export const CSV_HOLD_SECONDS_MAX = 600;
/** Five hours: the player's minutes dial (MINUTES_DIAL) stops there too. */
export const CSV_MINUTES_MAX = MINUTES_DIAL.max;
/**
 * The rest between minutes blocks ("Easy Run Blocks, 4, 5 min"): the middle
 * of the 45–75 s the ready catalogue prescribes for its own. The importer gave
 * every minutes row 0, which only fits a single steady bout (bug hunt,
 * 2026-10-07).
 */
export const CSV_MINUTES_BLOCK_REST_SECONDS = 60;

/**
 * The unit a Reps cell wrote out, when it wrote one: "20 min", "30-45 s",
 * "30 reps". The app's own export writes one wherever the name alone would
 * read the numbers in another unit — a hold filed under the barbell bridge,
 * 30 s on a rower the library logs in minutes (round 2, 2026-10-08) — and a
 * reader may write one too. No unit leaves the name to decide, as before.
 */
type CsvRepsUnit = 'minutes' | 'seconds' | 'reps';

const REPS_UNIT_PATTERNS: ReadonlyArray<[CsvRepsUnit, RegExp]> = [
  // In this order: "reps" and "mins" both end in an s.
  ['minutes', /^(.*?)\s*min(?:s|utes?|uuttia|uutti)?\.?$/i],
  ['reps', /^(.*?)\s*(?:reps?|toistoa|toisto)\.?$/i],
  ['seconds', /^(.*?)\s*(?:s|secs?|seconds?|sek|sekuntia|sekunti)\.?$/i],
];

function parseReps(value: string): { repMin: number; repMax: number; unit: CsvRepsUnit | null } | null {
  let unit: CsvRepsUnit | null = null;
  let numbers = value;
  for (const [candidate, pattern] of REPS_UNIT_PATTERNS) {
    const unitMatch = value.match(pattern);
    if (unitMatch) {
      unit = candidate;
      numbers = unitMatch[1];
      break;
    }
  }
  // Space is allowed around a separator ("8 - 10", "3 x 10") and nowhere else:
  // stripped everywhere, "6 8" joined into 68.
  const match = numbers.trim().replace(/\s*([-–—x/])\s*/g, '$1').match(/^(\d+)(?:[-–—x/](\d+))?$/);
  if (!match) {
    return null;
  }
  const first = Number.parseInt(match[1], 10);
  const second = match[2] ? Number.parseInt(match[2], 10) : first;
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(second) || second <= 0) {
    return null;
  }
  return { repMin: Math.min(first, second), repMax: Math.max(first, second), unit };
}

/**
 * Whether one name occurs in the other as whole words, not merely as a run of
 * characters — "up" inside "ups" is not "up". Both sides are `normalizeName`
 * output padded with a space each end (tokens are single-space separated), so
 * a boundary is a space and the test is a plain substring one. An empty name
 * pads to two spaces, which no single-spaced text holds.
 */
function containsWholeWords(haystackPadded: string, needlePadded: string): boolean {
  return needlePadded.length > 2 && haystackPadded.includes(needlePadded);
}

function tokenOverlapScore(leftTokens: ReadonlySet<string>, rightTokens: ReadonlySet<string>) {
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

/**
 * A name as the app itself shows it, folded for lookup. `normalizeName` keeps
 * only a-z, so "Hauiskääntö" and "Hauiskaanto" would both lose letters there;
 * the app's own labels are matched on their exact spelling instead.
 */
function foldLabel(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('fi').replace(/\s+/g, ' ').trim();
}

/**
 * Every label the app displays for a lift, back to the stored English names
 * it stands for. A reader who writes, or photographs, the programme the way
 * the app shows it — "Istuen taljasoutu" — got "0 recognised" for names the
 * app had printed itself (#bugs 2026-09-29). Several stored names can share
 * one label ("Seated Cable Row" and "Seated Cable Rows"), so each keeps all.
 */
const LABEL_TO_STORED_NAMES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const labels of [TRANSLATED_EXERCISE_NAMES, PLAIN_EXERCISE_NAMES]) {
    for (const [stored, label] of Object.entries(labels)) {
      const key = foldLabel(label);
      const names = map.get(key) ?? [];
      if (!names.includes(stored)) {
        names.push(stored);
      }
      map.set(key, names);
    }
  }
  return map;
})();

function matchAppLabel(rawName: string, library: readonly IndexedLibraryEntry[]): CsvLibraryEntry | null {
  const storedNames = LABEL_TO_STORED_NAMES.get(foldLabel(rawName));
  if (!storedNames) {
    return null;
  }
  // The first stored name the library actually has, in the order the label
  // table lists them — the table puts the canonical lift first.
  for (const stored of storedNames) {
    const key = normalizeName(stored);
    const entry = library.find((candidate) => candidate.normalized === key);
    if (entry) {
      return entry.entry;
    }
  }
  return null;
}

/**
 * The words the app prints beside a lift for its role in the day. A photo of
 * the app's own programme screen put "TUKI" in the day column of every row,
 * and the import made a day called TUKI (#bugs 2026-09-29). A role is not a
 * day: the row keeps the day above it, or the first day when there is none.
 */
const ROLE_WORDS = new Set(['anchor', 'support', 'extra', 'accessory', 'ankkuri', 'tuki', 'lisä', 'lisa']);

export function isRoleWord(value: string) {
  return ROLE_WORDS.has(foldLabel(value));
}

/**
 * One word's singular, so "Leg Extension" is the library's "Leg Extensions"
 * and "Seated Cable Row" its "Seated Cable Rows". Applied to both sides, so a
 * fold that is not quite English ("abs" -> "ab") still compares like with like.
 */
function singularWord(word: string) {
  if (word.length <= 2 || /(ss|us|is)$/.test(word)) {
    return word;
  }
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(ch|sh|x|ss)es$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

function foldPlural(normalized: string) {
  return normalized.split(' ').map(singularWord).join(' ');
}

function matchExercise(
  rawName: string,
  library: CsvLibraryEntry[],
  libraryNames: readonly string[],
  nameBook: readonly ExerciseNameBookEntry[],
) {
  const normalized = normalizeName(rawName);
  if (!normalized) {
    return { matchedName: null, libraryItemId: null, suggestion: null, viaNameBook: false };
  }

  // The reader's own vocabulary wins outright, before any guessing.
  //
  // It has to come first, not last: "alatalja" shares no letters with "Seated
  // Cable Row", but it might well overlap 50 % of the tokens in some unrelated
  // lift, and a fuzzy guess that beats a taught answer would make the teaching
  // pointless. Being told is better evidence than being clever.
  const learned = lookupNameBook(nameBook, rawName);
  if (learned) {
    return {
      matchedName: learned.exerciseName,
      libraryItemId: learned.libraryItemId,
      suggestion: null,
      viaNameBook: true,
    };
  }

  // The row the player files this name under: the library's own name or the
  // alias table's hand-checked answer, never a substring. The app's own
  // export writes catalogue names such as "Air Bike (30s sprint)", and only
  // this table knows that is the fan bike, not the library's ab exercise.
  //
  // The player also drops a trailing bracket to find a row, which is only
  // safe on the ready programmes' own names: their brackets are cues checked
  // by hand, "(Wide)", "(Light)". Another app writes the variant there, and
  // "Bench Press (Dumbbell)" was linked as the barbell bench (bug hunt,
  // 2026-10-08); it goes on to the guesses below for the reader to confirm.
  const filedIndex = findFiledLibraryIndexAsWritten(rawName, libraryNames)
    ?? (isReadyProgrammeName(rawName) ? findFiledLibraryIndex(rawName, libraryNames) : null);
  const filed = filedIndex === null ? null : library[filedIndex];
  if (filed) {
    return { matchedName: filed.name, libraryItemId: filed.id, suggestion: null, viaNameBook: false };
  }

  const compact = normalized.replace(/ /g, '');
  const folded = foldPlural(normalized);
  const foldedCompact = folded.replace(/ /g, '');

  // The app's own name for the lift, in either language, before guessing —
  // but after a library name written out exactly, which is never a label for
  // some other lift.
  const indexed = indexLibrary(library);
  const exact = indexed.some((entry) => entry.normalized === normalized || entry.compact === compact);
  const labelled = exact ? null : matchAppLabel(rawName, indexed);
  if (labelled) {
    return { matchedName: labelled.name, libraryItemId: labelled.id, suggestion: null, viaNameBook: false };
  }

  const containsMatches: CsvLibraryEntry[] = [];
  let pluralMatch: CsvLibraryEntry | null = null;
  let bestOverlap: { entry: CsvLibraryEntry; score: number } | null = null;
  const writtenNamesANonSet = !isBrowsableExercise({ name: rawName });
  const padded = ` ${normalized} `;
  const tokens = new Set(normalized.split(' ').filter(Boolean));

  for (const indexedEntry of indexed) {
    const { entry } = indexedEntry;
    // Exact match, tolerant of spacing/punctuation ("Dead Lift" === "Deadlift").
    if (indexedEntry.normalized === normalized || indexedEntry.compact === compact) {
      return { matchedName: entry.name, libraryItemId: entry.id, suggestion: null, viaNameBook: false };
    }
    // The same name but for a plural. Kept until the loop ends, so an exact
    // match further down still wins.
    if (!pluralMatch && (indexedEntry.folded === folded || indexedEntry.foldedCompact === foldedCompact)) {
      pluralMatch = entry;
    }
    if (!mayGuess(indexedEntry, writtenNamesANonSet)) {
      continue;
    }
    if (
      normalized.length >= 5
      && (containsWholeWords(indexedEntry.padded, padded) || containsWholeWords(padded, indexedEntry.padded))
    ) {
      containsMatches.push(entry);
    }
    const score = tokenOverlapScore(tokens, indexedEntry.tokens);
    if (score > (bestOverlap?.score ?? 0)) {
      bestOverlap = { entry, score };
    }
  }

  if (pluralMatch) {
    return { matchedName: pluralMatch.name, libraryItemId: pluralMatch.id, suggestion: null, viaNameBook: false };
  }

  // A generic name — "Deadlift", "Pull Up", "Press" — is a whole-word
  // substring of dozens of more specific library entries. Taking the first
  // one found used to turn a photographed or CSV "Deadlift" into e.g.
  // "Romanian Deadlift" or a machine variant with no way for the reader to
  // notice (#bugs). Even exactly one is a guess: "Cable Row" is only inside
  // "Upright Cable Row", a shoulder lift, and "Plank Jack" only contains
  // "Plank" (bug hunt, 2026-10-07). It is offered for the reader to confirm,
  // like any other near-miss; an ambiguous one falls through to the overlap.
  if (containsMatches.length === 1) {
    return { matchedName: null, libraryItemId: null, suggestion: containsMatches[0].name, viaNameBook: false };
  }
  if (bestOverlap && bestOverlap.score >= 0.5) {
    return { matchedName: null, libraryItemId: null, suggestion: bestOverlap.entry.name, viaNameBook: false };
  }
  return { matchedName: null, libraryItemId: null, suggestion: null, viaNameBook: false };
}

export function parseCsvProgram(
  text: string,
  library: CsvLibraryEntry[],
  nameBook: readonly ExerciseNameBookEntry[] = [],
  // The errors are shown to the reader as they are, so they are written in
  // the app's language; English was the only one until 2026-09-26.
  language: AppLanguage = 'en',
): CsvProgramPreview {
  // The separator off the first line, before any quote-aware splitting: the
  // record splitter needs it to know where a quoted field can open, and the
  // header itself is never quoted or wrapped across lines. The whole text is
  // trimmed first, not just the extracted substring — a pasted/uploaded CSV
  // can start with a blank (or whitespace-only) line, and slicing that raw
  // first line off an untrimmed string reads it as empty, falling back to the
  // comma default and failing every header cell for an otherwise valid
  // semicolon or tab file (#bugs). hevyImport.ts's detectCsvDelimiter call
  // avoids this the same way, off `text.trim()`.
  const delimiter = detectDelimiter(text.trim().split(/\r?\n/, 1)[0] ?? '');
  // A record ends at a line break OUTSIDE an open quote. Splitting on every
  // raw line break instead tore a quoted cell that itself held one — an Excel
  // cell wrapped with Alt+Enter, or a model-returned name that copied a
  // spreadsheet's own wrap — into two rows: the exercise vanished and the
  // error below named a row the reader's sheet does not have (#bugs).
  const split = splitCsvRecords(text, delimiter);
  // Each surviving line keeps the 1-based row number it had in
  // `split.records` — the SAME numbering `unterminatedQuoteRow` already
  // uses — so that filtering out blank lines here never desyncs the two.
  // A pasted/uploaded CSV can start with a blank line, and `index + 1` into
  // this filtered array pointed at the wrong physical row for every error
  // from there on whenever a blank line preceded the row in question
  // (recheck round 2026-09-29).
  const lineEntries = split.records
    .map((line, index) => ({ text: line.trim(), row: index + 1 }))
    .filter((entry) => entry.text.length > 0);
  const errors: string[] = [];

  if (!lineEntries.length) {
    return { rows: [], matchedCount: 0, unmatchedCount: 0, dayCount: 0, errors: [t(language, 'csv.error.empty')] };
  }

  // Named before the header/row errors below, so the reader sees the actual
  // cause — a stray quote in their sheet — rather than a wall of "missing
  // name" errors for rows that were merely misread as a consequence of it.
  // Pushed onto `errors`, never dropped by a later early return, so a
  // header that is also unusable still shows both causes.
  if (split.unterminatedQuoteRow !== null) {
    errors.push(t(language, 'csv.error.unclosedQuote', { row: split.unterminatedQuoteRow }));
  }

  const header = splitCsvLine(lineEntries[0].text, delimiter).map((cell) => normalizeName(cell));
  const dayIndex = header.findIndex((cell) => cell === 'day' || cell === 'session');
  const exerciseIndex = header.findIndex((cell) => cell === 'exercise' || cell === 'exercise name' || cell === 'lift');
  const setsIndex = header.findIndex((cell) => cell === 'sets');
  const repsIndex = header.findIndex((cell) => cell === 'reps' || cell === 'rep range');
  const dayNumberIndex = header.findIndex((cell) => cell === CSV_DAY_NUMBER_KEY || cell === 'day number');

  if (dayIndex < 0 || exerciseIndex < 0 || setsIndex < 0 || repsIndex < 0) {
    errors.push(t(language, 'csv.error.header'));
    return {
      rows: [],
      matchedCount: 0,
      unmatchedCount: 0,
      dayCount: 0,
      errors,
    };
  }

  const libraryNames = library.map((entry) => entry.name);
  const rows: CsvProgramRow[] = [];
  const seenDayKeys = new Set<string>();
  const skippedDayKeys = new Set<string>();
  let lastDay: string | null = null;
  let lastDayNumber: number | null = null;
  for (let index = 1; index < lineEntries.length; index += 1) {
    const row = lineEntries[index].row;
    const cells = splitCsvLine(lineEntries[index].text, delimiter);
    // Collapsed, not just trimmed: a quoted cell can carry the line break it
    // was wrapped with (Alt+Enter, or a photographed cell copied verbatim),
    // and that wrap is not part of the name.
    const writtenDay = unguardCsvFormula(collapseCellWhitespace(cells[dayIndex] ?? ''));
    const dayNumberText = dayNumberIndex >= 0 ? (cells[dayNumberIndex] ?? '').trim() : '';
    const writtenDayNumber = /^\d+$/.test(dayNumberText) && Number(dayNumberText) > 0 ? Number(dayNumberText) : null;
    // A numbered day is the day its cell names, whatever the word: the app
    // numbers its export when a name alone cannot tell the days apart.
    const roleTagged = writtenDayNumber === null && isRoleWord(writtenDay);
    const day: string = roleTagged ? lastDay ?? t(language, 'tpl.day', { index: 1 }) : writtenDay;
    const dayNumber: number | null = writtenDayNumber ?? (roleTagged ? lastDayNumber : null);
    const exerciseName = unguardCsvFormula(collapseCellWhitespace(cells[exerciseIndex] ?? ''));
    // A whole number, all of it. parseInt read "2,5" as 2 and "3-4" as 3 and
    // reported nothing (decimal audit, 2026-09-21); a count of sets that is
    // not one is the reader's to fix, like a missing name.
    const setsText = (cells[setsIndex] ?? '').trim();
    const sets = /^\d+$/.test(setsText) ? Number(setsText) : Number.NaN;
    const parsedReps = parseReps((cells[repsIndex] ?? '').trim());

    if (!day || !exerciseName) {
      errors.push(t(language, 'csv.error.missing', { row }));
      continue;
    }
    if (!Number.isFinite(sets) || sets <= 0) {
      errors.push(t(language, 'csv.error.sets', { row }));
      continue;
    }
    // The editor's own ceiling. A typo of 100000 imported as a programme that
    // built 100 000 sets on every start (bug hunt, 2026-10-05); refused like
    // any other count the reader has to fix, not quietly cut to 12.
    if (sets > PROGRAM_SETS_RANGE.max) {
      errors.push(t(language, 'csv.error.setsMax', { row, max: PROGRAM_SETS_RANGE.max }));
      continue;
    }
    if (!parsedReps) {
      errors.push(t(language, 'csv.error.reps', { row }));
      continue;
    }
    // A hold is written in seconds, so it gets the seconds ceiling — read off
    // the name the row resolves to as well as the one written, so "Lankku"
    // is a plank like "Plank" is.
    const match = matchExercise(exerciseName, library, libraryNames, nameBook);
    // A ready programme's row linked under another name keeps the catalogue's
    // own unit; the library name would read 30 s of rowing as 30 minutes.
    // Minutes are the cell's to say ("20 min"), as the export writes them.
    const catalogueMode = match.matchedName !== null && normalizeName(match.matchedName) !== normalizeName(exerciseName)
      ? READY_PROGRAMME_MODES.get(exerciseName.trim().toLowerCase()) ?? null
      : null;
    const linkedMode = catalogueMode !== null && !isMinutesTrackingMode(catalogueMode) ? catalogueMode : null;
    const namedHold = isHoldExerciseName(exerciseName)
      || (match.matchedName !== null && isHoldExerciseName(match.matchedName));
    // Seconds are a hold's unit, the only mode counted in them; a count
    // written out is not one, whatever the name.
    const isHold = parsedReps.unit === 'seconds'
      || (parsedReps.unit !== 'reps' && (namedHold || linkedMode === 'hold'));
    // Checked before the minutes: "Plank, 3, 1 min" is a 60 s hold, not a
    // minutes bout (bug hunt, 2026-10-07).
    const minutes = parsedReps.unit === 'minutes' && !isHold;
    const reps = isHold && parsedReps.unit === 'minutes'
      ? { repMin: parsedReps.repMin * 60, repMax: parsedReps.repMax * 60 }
      : { repMin: parsedReps.repMin, repMax: parsedReps.repMax };
    const repsMax = minutes ? CSV_MINUTES_MAX : isHold ? CSV_HOLD_SECONDS_MAX : CSV_REPS_MAX;
    if (reps.repMax > repsMax) {
      errors.push(t(language, 'csv.error.repsMax', { row, max: repsMax }));
      continue;
    }
    // "30 reps" on a name that would read its numbers as seconds or minutes:
    // counted, in the counted mode that name has elsewhere.
    const countedMode: WorkoutTrackingMode | null = parsedReps.unit !== 'reps'
      ? null
      : linkedMode !== null && prescriptionUnitOf(linkedMode) === 'reps'
        ? linkedMode
        : namedHold || linkedMode === 'hold'
          ? 'bodyweight'
          : readsAsMinutesByName(exerciseName, [reps.repMin, reps.repMax])
              || readsAsMinutesByName(match.matchedName, [reps.repMin, reps.repMax])
            ? 'reps_first'
            : null;
    const trackingMode = minutes ? null : isHold ? 'hold' as const : parsedReps.unit === 'reps' ? countedMode : linkedMode;

    const dayKey = dayNumber !== null ? numberedDayKey(dayNumber) : csvDayNameKey(day);
    if (!seenDayKeys.has(dayKey)) {
      if (seenDayKeys.size >= MAX_TRAINING_DAYS) {
        if (!skippedDayKeys.has(dayKey)) {
          skippedDayKeys.add(dayKey);
          errors.push(t(language, 'csv.error.dayCap', { row, day, max: MAX_TRAINING_DAYS }));
        }
        continue;
      }
      seenDayKeys.add(dayKey);
    }
    lastDay = day;
    lastDayNumber = dayNumber;

    rows.push({
      day,
      ...(dayNumber !== null ? { dayNumber } : {}),
      exerciseName,
      sets,
      repMin: reps.repMin,
      repMax: reps.repMax,
      // Only when the cell said so. A bike written "1,20" with no unit is
      // still minutes by its name, decided where the programme is run.
      ...(minutes ? { minutes: true } : {}),
      // A hold says so outright: linked under "Barbell Glute Bridge", the
      // seconds just read would be run as repetitions with a weight.
      ...(trackingMode ? { trackingMode } : {}),
      ...match,
    });
  }

  const matchedCount = rows.filter((row) => row.matchedName).length;
  return {
    rows,
    matchedCount,
    unmatchedCount: rows.length - matchedCount,
    dayCount: new Set(rows.map(csvRowDayKey)).size,
    errors,
  };
}

function numberedDayKey(dayNumber: number) {
  return `#${dayNumber}`;
}

/** Which day a row belongs to: its number when the file numbered its days, else its name. */
export function csvRowDayKey(row: Pick<CsvProgramRow, 'day' | 'dayNumber'>) {
  return row.dayNumber !== undefined ? numberedDayKey(row.dayNumber) : csvDayNameKey(row.day);
}

/** Builds a custom-template draft from the matched rows; unmatched rows are skipped. */
export function buildDraftFromCsvPreview(preview: CsvProgramPreview, programName: string): WorkoutTemplateDraft {
  const sessionsByDay = new Map<string, { name: string; exercises: WorkoutTemplateDraft['sessions'][number]['exercises'] }>();

  for (const row of preview.rows) {
    if (!row.matchedName) {
      continue;
    }
    const key = csvRowDayKey(row);
    const session = sessionsByDay.get(key) ?? { name: row.day, exercises: [] };
    // An interval's rhythm lives in its name, and the player reads it there:
    // "Push-Up (20s on / 10s off)" saved as the library's "Pushups" was 20
    // push-ups with 90 s rest (bug hunt, 2026-10-08). The written name stays,
    // linked to the same library row, and rests the off-phase it states.
    //
    // So does every ready programme's own name, as duplicating the programme
    // keeps it: the catalogue's name is what says "Sprint Interval (200m)" is
    // metres and "Glute Bridge Hold" a hold, and saved as the library's
    // "Sprint" or barbell bridge the next export lost both (round 2,
    // 2026-10-08). A name the reader taught the app is theirs to decide.
    const catalogueName = row.viaNameBook ? undefined : READY_PROGRAMME_SPELLINGS.get(row.exerciseName.trim().toLowerCase());
    const name = catalogueName
      ?? (parseIntervalScheme(row.exerciseName) && !parseIntervalScheme(row.matchedName) ? row.exerciseName : row.matchedName);
    const intervalRest = intervalOffSeconds(name);
    const trackingMode = row.minutes ? 'duration_minutes' as const : row.trackingMode;
    session.exercises.push({
      name,
      targetSets: row.sets,
      repMin: row.repMin,
      repMax: row.repMax,
      // One bout of minutes has no rest to speak of; several are blocks, and
      // rest like the catalogue's own.
      restSeconds: intervalRest ?? (row.minutes ? (row.sets > 1 ? CSV_MINUTES_BLOCK_REST_SECONDS : 0) : 90),
      trackedDefault: true,
      libraryItemId: row.libraryItemId,
      ...(trackingMode ? { trackingMode } : {}),
    });
    sessionsByDay.set(key, session);
  }

  return {
    name: programName,
    sessions: [...sessionsByDay.values()],
  };
}
