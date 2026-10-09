/**
 * Hevy CSV export → importable workout history.
 *
 * Hevy's "Export data" mails one CSV where every row is a single set:
 * `title, start_time, end_time, description, exercise_title, superset_id,
 * exercise_notes, set_index, set_type, weight_kg (or weight_lbs), reps,
 * distance_km, duration_seconds, rpe`. Timestamps come as ISO in some exports
 * and as `"10 Jun 2024, 08:15"` in others; weight arrives in whichever unit
 * the account used. All of it is handled here, header-driven — column order
 * is never assumed.
 *
 * This module only parses and summarises. Writing the workouts into the
 * database goes through the same persistence path a finished live workout
 * uses, with a deterministic session id per Hevy start time, so importing the
 * same file twice cannot duplicate a single workout.
 */

import { splitCsvRecords } from './csvRecords';
import { isLiftableWeight } from './weightLimits';

export interface HevyImportedSet {
  weightKg: number;
  reps: number;
  kind: 'working' | 'warmup' | 'drop';
}

export interface HevyImportedExercise {
  name: string;
  sets: HevyImportedSet[];
}

export interface HevyImportedWorkout {
  name: string;
  /** ISO — also the identity: one Hevy workout is one start time. */
  startedAt: string;
  endedAt: string | null;
  exercises: HevyImportedExercise[];
}

export interface HevyImportPreview {
  workouts: HevyImportedWorkout[];
  setCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Rows with no countable set — duration-only cardio, empty lines. */
  skippedRowCount: number;
  /**
   * Sets heavier than the app holds (weightLimits). The loader refuses such a
   * set for good, so it is left out here, where it can be said — counted in
   * `setCount` it promised a set the history would never show, and a workout
   * of nothing else was later reported as one that "already existed".
   */
  overweightSetCount: number;
  errors: string[];
}

const LBS_TO_KG = 0.45359237;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Whether pasted text is a Hevy history export rather than a programme CSV.
 * The two columns no programme file carries, together, are proof enough.
 */
export function isHevyHistoryCsv(text: string): boolean {
  const firstLine = text.trimStart().split(/\r?\n/, 1)[0] ?? '';
  const header = firstLine.toLowerCase();
  return header.includes('exercise_title') && header.includes('start_time');
}

/**
 * One CSV line → fields, honouring quotes, embedded delimiters and "" escapes.
 * As above, only a quote that starts a field opens one; a quote inside an
 * unquoted field is part of its text.
 */
function splitCsvLine(line: string, delimiter: CsvDelimiter = ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
      atFieldStart = true;
    } else {
      current += char;
      atFieldStart = atFieldStart && isCsvBlank(char);
    }
  }
  fields.push(current);
  return fields;
}

type CsvDelimiter = ',' | ';' | '\t';

/**
 * The separator the file was written with, read off its header.
 *
 * Hevy writes commas. The same file opened and saved by a spreadsheet set to
 * Finnish comes back with semicolons (the comma is the decimal mark there),
 * or with tabs when it is pasted out of one. Split on commas alone, its header
 * was one column: isHevyHistoryCsv said yes and the import said it found
 * no sets (decimal audit, 2026-09-21). The weights in such a file are
 * written 82,5, which toNumber already reads.
 */
function detectCsvDelimiter(headerLine: string): CsvDelimiter {
  if (headerLine.includes('\t')) {
    return '\t';
  }
  const count = (mark: string) => headerLine.split(mark).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

function isCsvBlank(char: string): boolean {
  return char === ' ' || char === '\t';
}

/** `"10 Jun 2024, 08:15"` or ISO → ISO string, or null. */
function parseHevyTimestamp(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const named = value.match(/^(\d{1,2}) ([A-Za-z]{3,}) (\d{4}),? (\d{1,2}):(\d{2})/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const date = new Date(
        Number(named[3]),
        month,
        Number(named[1]),
        Number(named[4]),
        Number(named[5]),
      );
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function setKind(rawType: string | undefined): HevyImportedSet['kind'] {
  const value = (rawType ?? '').trim().toLowerCase();
  if (value === 'warmup' || value === '2') {
    return 'warmup';
  }
  if (value === 'dropset' || value === '3') {
    return 'drop';
  }
  return 'working';
}

export function parseHevyCsv(text: string): HevyImportPreview {
  const empty: HevyImportPreview = {
    workouts: [],
    setCount: 0,
    firstDate: null,
    lastDate: null,
    skippedRowCount: 0,
    overweightSetCount: 0,
    errors: [],
  };
  // The separator first, off the header line: the record splitter needs it
  // too, to know where a quoted field can open. With a comma hard-wired there,
  // a quoted note holding a line break in a semicolon file split its row in
  // two (CI review of #174). The header has neither quotes nor line breaks.
  const trimmed = text.trim();
  const delimiter = detectCsvDelimiter(trimmed.split(/\r?\n/, 1)[0] ?? '');
  const split = splitCsvRecords(trimmed, delimiter);
  const lines = split.records;
  if (lines.length < 2) {
    return { ...empty, errors: ['EMPTY'] };
  }
  // A stray quote with no close swallowed every row after it into one record
  // before recovery below confined the damage — the offending row itself is
  // still unreliable, so it is counted out like any other unusable row
  // rather than surfaced as its own error (#228 regression, recheck round
  // 2026-09-29).
  const unterminatedQuoteRowIndex = split.unterminatedQuoteRow !== null ? split.unterminatedQuoteRow - 1 : -1;

  const header = splitCsvLine(lines[0], delimiter).map((column) => column.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const columns = {
    title: col('title'),
    startTime: col('start_time'),
    endTime: col('end_time'),
    exercise: col('exercise_title'),
    setType: col('set_type'),
    weightKg: col('weight_kg'),
    weightLbs: col('weight_lbs'),
    reps: col('reps'),
    duration: col('duration_seconds'),
  };
  if (columns.startTime < 0 || columns.exercise < 0) {
    return { ...empty, errors: ['NOT_HEVY'] };
  }

  // File order everywhere: workouts in the order the export lists them,
  // exercises in the order they were performed.
  const workoutsByKey = new Map<string, HevyImportedWorkout>();
  let setCount = 0;
  let skippedRowCount = 0;
  let overweightSetCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) {
      continue;
    }
    if (i === unterminatedQuoteRowIndex) {
      skippedRowCount += 1;
      continue;
    }
    const fields = splitCsvLine(lines[i], delimiter);
    const startedAt = parseHevyTimestamp(fields[columns.startTime] ?? '');
    const exerciseName = (fields[columns.exercise] ?? '').trim();
    if (!startedAt || !exerciseName) {
      skippedRowCount += 1;
      continue;
    }

    const reps = toNumber(fields[columns.reps]);
    const weightKgRaw = columns.weightKg >= 0 ? toNumber(fields[columns.weightKg]) : null;
    const weightLbs = columns.weightLbs >= 0 ? toNumber(fields[columns.weightLbs]) : null;
    const weightKg = weightKgRaw ?? (weightLbs !== null ? weightLbs * LBS_TO_KG : null);

    // A row with no reps is duration- or distance-only work (cardio blocks);
    // v1 imports the lifting history and counts the rest out loud.
    if (!reps || reps <= 0) {
      skippedRowCount += 1;
      continue;
    }

    // Before the workout is opened: one with only such sets must not exist.
    const setWeightKg = Math.max(0, Math.round((weightKg ?? 0) * 100) / 100);
    if (!isLiftableWeight(setWeightKg)) {
      overweightSetCount += 1;
      continue;
    }

    const key = startedAt;
    let workout = workoutsByKey.get(key);
    if (!workout) {
      workout = {
        name: (columns.title >= 0 ? (fields[columns.title] ?? '').trim() : '') || 'Hevy workout',
        startedAt,
        endedAt: columns.endTime >= 0 ? parseHevyTimestamp(fields[columns.endTime] ?? '') : null,
        exercises: [],
      };
      workoutsByKey.set(key, workout);
    }

    // Hevy writes an assisted set (a band or a machine doing part of the
    // work) as a NEGATIVE weight_kg — sometimes under its own "Assisted ..."
    // title, sometimes under the reader's ordinary title for the lift if
    // that is the exercise entry they logged it against. Below, the negative
    // weight is clamped to 0, which then reads exactly like a real bodyweight
    // set of the unassisted lift; grouping it under a name that SAYS assisted
    // is what keeps a 20 kg assisted pull-up from becoming a reps record or
    // history entry of plain Pull Up (#bugs). Every downstream grouping keys
    // on this name (getTrackedExerciseProgress and friends), so a different
    // name is enough to keep the two apart — nothing else needs to change.
    const assisted = weightKg !== null && weightKg < 0;
    const exerciseGroupName =
      assisted && !/assist/i.test(exerciseName) ? `${exerciseName} (assisted)` : exerciseName;

    let exercise = workout.exercises[workout.exercises.length - 1];
    if (!exercise || exercise.name !== exerciseGroupName) {
      // Non-consecutive repeats (straight sets split around a superset) still
      // belong to one entry — find the existing group before opening another.
      exercise = workout.exercises.find((candidate) => candidate.name === exerciseGroupName) ?? {
        name: exerciseGroupName,
        sets: [],
      };
      if (!workout.exercises.includes(exercise)) {
        workout.exercises.push(exercise);
      }
    }
    exercise.sets.push({
      weightKg: setWeightKg,
      reps: Math.max(1, Math.round(reps)),
      kind: setKind(columns.setType >= 0 ? fields[columns.setType] : undefined),
    });
    setCount += 1;
  }

  const workouts = [...workoutsByKey.values()].filter((workout) => workout.exercises.length > 0);
  const dates = workouts.map((workout) => workout.startedAt).sort();
  return {
    workouts,
    setCount,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    skippedRowCount,
    overweightSetCount,
    errors: workouts.length === 0 ? ['NO_WORKOUTS'] : [],
  };
}

/**
 * The session id one Hevy workout is saved under: its start time, so the same
 * file imported twice finds its own workouts instead of doubling them.
 */
export function hevySessionId(workout: Pick<HevyImportedWorkout, 'startedAt'>): string {
  return `hevy_${Date.parse(workout.startedAt)}`;
}

/** One imported workout as "last time" files it: the shape of a logged session. */
export interface HevyLoggedSession {
  performedAt: string;
  sessionId: string;
  templateName: string;
  exercises: Array<{
    exerciseName: string;
    sets: Array<{ setIndex: number; loadKg: number; reps: number; completedAt: string }>;
  }>;
}

/**
 * Imported workouts, as the weight a set opens on and the "Last time" card
 * read them.
 *
 * The import wrote the database only, and those two read the workout store's
 * slot history — so a reader who brought years of Hevy history in opened every
 * lift at nothing, under a Progress page that showed the same history (hunt,
 * 2026-10-09). The work only, as a finished empty workout files it: a warm-up
 * is neither a weight to open on nor one to progress from, and a load nobody
 * could lift is dropped as the database loader drops it. Only the workouts in
 * `filed` — the ones the database holds — so "last time" never names a
 * session History does not have.
 */
export function hevyWorkoutsToLoggedSessions(
  workouts: readonly HevyImportedWorkout[],
  filed: ReadonlySet<string>,
): HevyLoggedSession[] {
  return workouts
    .filter((workout) => filed.has(hevySessionId(workout)))
    .map((workout) => {
      const performedAt = workout.endedAt ?? workout.startedAt;
      return {
        performedAt,
        sessionId: hevySessionId(workout),
        templateName: workout.name,
        exercises: workout.exercises.map((exercise) => ({
          exerciseName: exercise.name,
          sets: exercise.sets
            .filter((set) => set.kind !== 'warmup' && set.reps > 0 && isLiftableWeight(set.weightKg))
            .map((set, setIndex) => ({ setIndex, loadKg: set.weightKg, reps: set.reps, completedAt: performedAt })),
        })),
      };
    });
}
