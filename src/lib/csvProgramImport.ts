import type { AppLanguage, ExerciseNameBookEntry, WorkoutTemplateDraft } from '../types/models';
import { collapseCellWhitespace, splitCsvRecords } from './csvRecords';
import { isBrowsableExercise } from './exerciseBrowseFilter';
import { isSpecialtyExercise } from './exerciseClassification';
import { lookupNameBook } from './exerciseNameBook';
import { PLAIN_EXERCISE_NAMES, TRANSLATED_EXERCISE_NAMES } from './exerciseNameLabel';
import { findFiledLibraryIndex } from './guidedPlayer';
import { t } from './i18n';
import { isHoldExerciseName } from './holdExercises';
import { MINUTES_DIAL } from './weightDial';
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
function mayGuess(entry: CsvLibraryEntry, writtenNamesANonSet: boolean): boolean {
  if (isSpecialtyExercise({ name: entry.name, sourceCategory: entry.sourceCategory ?? undefined })) {
    return false;
  }
  return writtenNamesANonSet || isBrowsableExercise(entry);
}

export interface CsvProgramRow {
  day: string;
  exerciseName: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** The Reps cell said minutes ("20 min"). Absent for every other row. */
  minutes?: boolean;
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

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      // A doubled quote inside a quoted cell is one literal quote — the CSV
      // escape. This dropped every quote character instead, so a lift called
      // Bench ("close grip") arrived with its quotes silently removed. Found
      // when the photo importer, which writes this format itself, round
      // -tripped a name through it (2026-08-24).
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
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

function parseReps(value: string): { repMin: number; repMax: number; minutes: boolean } | null {
  // "20 min" is minutes — the app's own export writes a bout of steady
  // cardio that way, and a reader may too. Any other unit is not a number.
  const minutesMatch = value.match(/^(.*?)\s*min(?:s|utes?|uuttia|uutti)?\.?$/i);
  const minutes = minutesMatch !== null;
  const numbers = (minutes ? minutesMatch[1] : value).replace(/\s+/g, '');
  const match = numbers.match(/^(\d+)(?:[-–—x/](\d+))?$/);
  if (!match) {
    return null;
  }
  const first = Number.parseInt(match[1], 10);
  const second = match[2] ? Number.parseInt(match[2], 10) : first;
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(second) || second <= 0) {
    return null;
  }
  return { repMin: Math.min(first, second), repMax: Math.max(first, second), minutes };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `needle` occurs in `haystack` as whole words, not merely as a run of
 * characters — "up" inside "ups" is not "up". Both sides have already been
 * through `normalizeName`, which leaves tokens separated by single spaces, so
 * a boundary is simply the string's edge or a space.
 */
function containsWholeWords(haystack: string, needle: string): boolean {
  if (!needle) {
    return false;
  }
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`).test(haystack);
}

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
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

function matchAppLabel(rawName: string, library: CsvLibraryEntry[]): CsvLibraryEntry | null {
  const storedNames = LABEL_TO_STORED_NAMES.get(foldLabel(rawName));
  if (!storedNames) {
    return null;
  }
  // The first stored name the library actually has, in the order the label
  // table lists them — the table puts the canonical lift first.
  for (const stored of storedNames) {
    const key = normalizeName(stored);
    const entry = library.find((candidate) => normalizeName(candidate.name) === key);
    if (entry) {
      return entry;
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

function isRoleWord(value: string) {
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
  const filedIndex = findFiledLibraryIndex(rawName, libraryNames);
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
  const exact = library.some((entry) => {
    const entryNormalized = normalizeName(entry.name);
    return entryNormalized === normalized || entryNormalized.replace(/ /g, '') === compact;
  });
  const labelled = exact ? null : matchAppLabel(rawName, library);
  if (labelled) {
    return { matchedName: labelled.name, libraryItemId: labelled.id, suggestion: null, viaNameBook: false };
  }

  const containsMatches: CsvLibraryEntry[] = [];
  let pluralMatch: CsvLibraryEntry | null = null;
  let bestOverlap: { entry: CsvLibraryEntry; score: number } | null = null;
  const writtenNamesANonSet = !isBrowsableExercise({ name: rawName });

  for (const entry of library) {
    const entryNormalized = normalizeName(entry.name);
    // Exact match, tolerant of spacing/punctuation ("Dead Lift" === "Deadlift").
    if (entryNormalized === normalized || entryNormalized.replace(/ /g, '') === compact) {
      return { matchedName: entry.name, libraryItemId: entry.id, suggestion: null, viaNameBook: false };
    }
    // The same name but for a plural. Kept until the loop ends, so an exact
    // match further down still wins.
    if (!pluralMatch) {
      const entryFolded = foldPlural(entryNormalized);
      if (entryFolded === folded || entryFolded.replace(/ /g, '') === foldedCompact) {
        pluralMatch = entry;
      }
    }
    if (!mayGuess(entry, writtenNamesANonSet)) {
      continue;
    }
    if (
      normalized.length >= 5
      && (containsWholeWords(entryNormalized, normalized) || containsWholeWords(normalized, entryNormalized))
    ) {
      containsMatches.push(entry);
    }
    const score = tokenOverlapScore(normalized, entryNormalized);
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
  for (let index = 1; index < lineEntries.length; index += 1) {
    const row = lineEntries[index].row;
    const cells = splitCsvLine(lineEntries[index].text, delimiter);
    // Collapsed, not just trimmed: a quoted cell can carry the line break it
    // was wrapped with (Alt+Enter, or a photographed cell copied verbatim),
    // and that wrap is not part of the name.
    const writtenDay = collapseCellWhitespace(cells[dayIndex] ?? '');
    const day: string = isRoleWord(writtenDay) ? lastDay ?? t(language, 'tpl.day', { index: 1 }) : writtenDay;
    const exerciseName = collapseCellWhitespace(cells[exerciseIndex] ?? '');
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
    const isHold = isHoldExerciseName(exerciseName) || (match.matchedName !== null && isHoldExerciseName(match.matchedName));
    // Checked before the minutes: "Plank, 3, 1 min" is a 60 s hold, not a
    // minutes bout (bug hunt, 2026-10-07).
    const reps = isHold && parsedReps.minutes
      ? { repMin: parsedReps.repMin * 60, repMax: parsedReps.repMax * 60, minutes: false }
      : parsedReps;
    const repsMax = reps.minutes ? CSV_MINUTES_MAX : isHold ? CSV_HOLD_SECONDS_MAX : CSV_REPS_MAX;
    if (reps.repMax > repsMax) {
      errors.push(t(language, 'csv.error.repsMax', { row, max: repsMax }));
      continue;
    }

    const dayKey = normalizeName(day);
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

    rows.push({
      day,
      exerciseName,
      sets,
      repMin: reps.repMin,
      repMax: reps.repMax,
      // Only when the cell said so. A bike written "1,20" with no unit is
      // still minutes by its name, decided where the programme is run.
      ...(reps.minutes ? { minutes: true } : {}),
      ...match,
    });
  }

  const matchedCount = rows.filter((row) => row.matchedName).length;
  return {
    rows,
    matchedCount,
    unmatchedCount: rows.length - matchedCount,
    dayCount: new Set(rows.map((row) => normalizeName(row.day))).size,
    errors,
  };
}

/** Builds a custom-template draft from the matched rows; unmatched rows are skipped. */
export function buildDraftFromCsvPreview(preview: CsvProgramPreview, programName: string): WorkoutTemplateDraft {
  const sessionsByDay = new Map<string, { name: string; exercises: WorkoutTemplateDraft['sessions'][number]['exercises'] }>();

  for (const row of preview.rows) {
    if (!row.matchedName) {
      continue;
    }
    const key = normalizeName(row.day);
    const session = sessionsByDay.get(key) ?? { name: row.day, exercises: [] };
    session.exercises.push({
      name: row.matchedName,
      targetSets: row.sets,
      repMin: row.repMin,
      repMax: row.repMax,
      // One bout of minutes has no rest to speak of; several are blocks, and
      // rest like the catalogue's own.
      restSeconds: row.minutes ? (row.sets > 1 ? CSV_MINUTES_BLOCK_REST_SECONDS : 0) : 90,
      trackedDefault: true,
      libraryItemId: row.libraryItemId,
      ...(row.minutes ? { trackingMode: 'duration_minutes' as const } : {}),
    });
    sessionsByDay.set(key, session);
  }

  return {
    name: programName,
    sessions: [...sessionsByDay.values()],
  };
}
