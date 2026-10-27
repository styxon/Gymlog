/**
 * Reading a training programme out of a photo.
 *
 * The reader keeps their programme in a Google spreadsheet and photographs it
 * or screenshots it. On-device OCR was the obvious route and is the wrong one:
 * it reads characters, not meaning, and a spreadsheet with merged cells, a
 * header row and a "day" column that only fills on the first row of each block
 * defeats it. The model already behind AI Coach reads the *table*.
 *
 * The trick that makes this small: the model returns the same four columns the
 * CSV importer already parses, so a photo becomes CSV text and everything
 * downstream — the preview, the unmatched-row correction, the name book — is
 * the code that already exists. Nothing here imports anything; it produces the
 * text the existing parser eats.
 *
 * Shared by the app and `api/ai-coach.ts`, so the schema the model is held to
 * and the validation the answer passes through cannot drift apart.
 */

import { collapseCellWhitespace } from './csvRecords';

export interface ProgramTableRow {
  day: string;
  exercise: string;
  sets: number;
  /**
   * Kept as the sheet wrote it ("8", "6-10", "6–10", "AMRAP"), not parsed to
   * numbers here. The CSV parser already knows every form it accepts and
   * rejects the rest with a row number the reader can act on — parsing twice,
   * in two places, is how the two start disagreeing.
   */
  reps: string;
}

/**
 * What the model is forced to return. A tool schema rather than a request for
 * JSON in prose, same as the coach's other two modes.
 */
export const PROGRAM_TABLE_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      description:
        'One entry per exercise row in the image, in the order they appear. Repeat the day for every row belonging to it, even when the image only writes it once.',
      items: {
        type: 'object',
        properties: {
          day: {
            type: 'string',
            description: 'The day or session label this row belongs to, exactly as written in the image.',
          },
          exercise: {
            type: 'string',
            description: 'The exercise name exactly as written in the image. Do not translate it or correct its spelling.',
          },
          sets: { type: 'integer', minimum: 1, maximum: 20 },
          reps: {
            type: 'string',
            description: 'The rep target as written: a number ("8") or a range ("6-10").',
          },
        },
        required: ['day', 'exercise', 'sets', 'reps'],
        additionalProperties: false,
      },
    },
  },
  required: ['rows'],
  additionalProperties: false,
} as const;

export const PROGRAM_TABLE_TOOL_NAME = 'report_program_table';

/**
 * The rules the model reads before the image.
 *
 * Two of these are load-bearing. Copying names verbatim is what lets the name
 * book do its job — a model that helpfully translates "alatalja" to "Seated
 * Cable Row" has made a guess nobody can see or correct, and taught the book
 * nothing. And filling the day down is the single most common shape of a real
 * sheet: the day is written once against a block of rows.
 */
export const PROGRAM_TABLE_RULES = [
  'You read training programmes out of photographs and screenshots of spreadsheets.',
  'Return one row per exercise, in the order they appear in the image.',
  'Copy exercise names EXACTLY as written, in the original language. Never translate, expand an abbreviation, or correct a spelling — the reader has their own names for lifts and the app resolves them separately.',
  'A day label written once against a block of rows belongs to every row in that block: repeat it.',
  'A tag beside an exercise that names its role (ANCHOR, SUPPORT, EXTRA, ANKKURI, TUKI, LISÄ, or similar) is not a day label. If the image shows no day label at all, use "Day 1" for every row.',
  'If a row has no sets or no reps, leave it out rather than inventing a number.',
  'Ignore columns you were not asked for (rest time, weight, last time, notes) and any row that is a heading or a total.',
  'If the image is not a training programme, return an empty rows array.',
].join('\n');

/** True when the value is a usable row; used to drop junk rather than repair it. */
function isUsableRow(value: unknown): value is ProgramTableRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Partial<ProgramTableRow>;
  return (
    typeof row.day === 'string' &&
    row.day.trim().length > 0 &&
    typeof row.exercise === 'string' &&
    row.exercise.trim().length > 0 &&
    typeof row.sets === 'number' &&
    Number.isFinite(row.sets) &&
    row.sets > 0 &&
    typeof row.reps === 'string' &&
    row.reps.trim().length > 0
  );
}

/**
 * The model's answer, or null when it is not one.
 *
 * An empty table is a valid answer — "this photo is not a programme" is a
 * thing the rules explicitly ask for — so it comes back as `[]` rather than as
 * a failure. Individual malformed rows are dropped: one unreadable line out of
 * forty should not cost the reader the other thirty-nine.
 */
export function validateProgramTable(payload: unknown): ProgramTableRow[] | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return null;
  }
  return rows.filter(isUsableRow).map((row) => ({
    // Collapsed, not just trimmed: a wrapped spreadsheet cell the model
    // copied verbatim is one name with a line break in it, not two lines of
    // one — and an uncollapsed break, once quoted into CSV, is exactly the
    // kind of embedded newline the CSV parser now has to treat as one row
    // (#bugs). Handled here so it never reaches the CSV text at all.
    day: collapseCellWhitespace(row.day),
    exercise: collapseCellWhitespace(row.exercise),
    sets: Math.round(row.sets),
    reps: row.reps.trim(),
  }));
}

/** Quotes a cell only when it would otherwise break the row. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The table as the CSV the existing importer reads.
 *
 * This is the whole reason the feature is small: a photo does not get its own
 * preview, its own correction UI or its own importer. It gets turned into the
 * text a paste would have produced, and joins the flow there.
 */
export function programTableToCsv(rows: readonly ProgramTableRow[]): string {
  return [
    'Day,Exercise,Sets,Reps',
    ...rows.map((row) => [csvCell(row.day), csvCell(row.exercise), String(row.sets), csvCell(row.reps)].join(',')),
  ].join('\n');
}

/**
 * The largest image the endpoint will accept, in base64 characters.
 *
 * A phone photo is easily 4 MB, which is ~5.5 MB of base64 and more than the
 * function's request body allows — and a 4 MB photo of a spreadsheet is not
 * more readable than a 1 MB one, only more expensive. The client downscales
 * before sending; this is the backstop that keeps an oversized body from
 * being charged for before it is refused.
 */
export const PROGRAM_IMAGE_MAX_BASE64_CHARS = 2_800_000;

const PROGRAM_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ProgramImageMediaType = (typeof PROGRAM_IMAGE_MEDIA_TYPES)[number];

export function isProgramImageMediaType(value: unknown): value is ProgramImageMediaType {
  return typeof value === 'string' && (PROGRAM_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}
