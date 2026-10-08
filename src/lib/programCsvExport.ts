import { prescriptionUnitOf, type PrescriptionUnit, type WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { CSV_DAY_NUMBER_HEADER, csvDayNameKey, isRoleWord } from './csvProgramImport';
import { isHoldExerciseName } from './holdExercises';
import { readsAsMinutesByName } from './minutesExercises';

/**
 * Program export, the mirror of `csvProgramImport`.
 *
 * Same four columns the importer reads — Day, Exercise, Sets, Reps — so an
 * exported plan can be pasted straight back in, or opened in Sheets or Excel.
 * `tests/lib/programCsvExport.test.cjs` and `programCsvRoundTrip.test.cjs`
 * round-trip the output through `parseCsvProgram`, which is what keeps the two
 * ends from drifting apart.
 *
 * There is no file to download: the app has no storage the user can reach and
 * no share-file dependency, so the caller hands the text to the system share
 * sheet. The Settings row says that rather than promising a download.
 */

export interface CsvExportExercise {
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /**
   * What the numbers count, when the caller knows: minutes are written
   * "20 min" and seconds "30-45 s", which the importer reads back as a bout
   * and a hold. A count is written "30 reps" only where the name alone would
   * read it as seconds or minutes. Absent: bare numbers, the name decides.
   */
  unit?: PrescriptionUnit;
}

export interface CsvExportSession {
  name: string;
  exercises: CsvExportExercise[];
}

export const CSV_EXPORT_HEADER = 'Day,Exercise,Sets,Reps';

/**
 * A saved programme row, in the unit it is run in: the stored mode when the
 * writer knew it, the name when it did not — the order customWorkoutAdapter
 * runs it in. The Export plan list wrote only minutes, so a hold saved under
 * the barbell bridge came back as reps with a weight (round 2, 2026-10-08).
 */
export function csvExportRowOfSaved(exercise: {
  name: string;
  targetSets: number;
  repMin: number;
  repMax: number;
  trackingMode?: WorkoutTrackingMode | null;
}): CsvExportExercise {
  const unit: PrescriptionUnit | undefined = exercise.trackingMode
    ? prescriptionUnitOf(exercise.trackingMode)
    : readsAsMinutesByName(exercise.name, [exercise.repMin, exercise.repMax])
      ? 'minutes'
      : undefined;
  return {
    name: exercise.name,
    sets: exercise.targetSets,
    repMin: exercise.repMin,
    repMax: exercise.repMax,
    ...(unit ? { unit } : {}),
  };
}

/** A ready programme's row: the catalogue always knows its mode. */
export function csvExportRowOfCatalogue(exercise: {
  exerciseName: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  trackingMode: WorkoutTrackingMode;
}): CsvExportExercise {
  return {
    name: exercise.exerciseName,
    sets: exercise.sets,
    repMin: exercise.repsMin,
    repMax: exercise.repsMax,
    unit: prescriptionUnitOf(exercise.trackingMode),
  };
}

/** "8" for a fixed target, "6-10" for a range — both forms the importer reads. */
export function formatCsvReps(repMin: number, repMax: number) {
  // Sorted rather than clamped, mirroring the importer's own Math.min/max, so a
  // reversed pair survives the trip instead of quietly losing its lower bound.
  const first = Math.max(1, Math.round(repMin));
  const second = Math.max(1, Math.round(repMax));
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  return low === high ? String(low) : `${low}-${high}`;
}

function formatRepsCell(exercise: CsvExportExercise) {
  const reps = formatCsvReps(exercise.repMin, exercise.repMax);
  if (exercise.unit === 'minutes') {
    return `${reps} min`;
  }
  if (exercise.unit === 'seconds') {
    return `${reps} s`;
  }
  // A hold's name or a cardio machine's reads bare numbers as seconds or
  // minutes; a count on one says it is a count.
  if (
    exercise.unit === 'reps'
    && (isHoldExerciseName(exercise.name) || readsAsMinutesByName(exercise.name, [exercise.repMin, exercise.repMax]))
  ) {
    return `${reps} reps`;
  }
  return reps;
}

function escapeCell(value: string) {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  // Quoted the RFC way, a quote inside doubled. The importer used to drop
  // every quote character, so a name could not carry one and this stripped
  // them; it reads `""` as one quote since 2026-08-24, and an inch mark in
  // an unquoted cell as text since 2026-10-08.
  return /[,;\t"]/.test(cleaned) ? `"${cleaned.replace(/"/g, '""')}"` : cleaned;
}

/**
 * Renders sessions as CSV. Sessions without exercises are dropped: a day with
 * no rows would disappear on re-import anyway, so writing it would promise a
 * round trip the format cannot keep.
 *
 * When the names alone cannot keep the days apart — two the importer reads as
 * one (Workout A, B, A), or a day named like the role tags a photo import
 * folds into the day above ("Extra") — a fifth column numbers them, and the
 * importer groups by it. Without it the 5×5 programme came back as two days,
 * Workout A holding all six lifts (round 2, 2026-10-08). Every other plan
 * keeps the four columns.
 */
export function buildProgramCsv(sessions: CsvExportSession[]): string {
  const days = sessions
    .map((session) => {
      const day = escapeCell(session.name);
      const rows = session.exercises.flatMap((exercise) => {
        const name = escapeCell(exercise.name);
        const sets = Math.max(1, Math.round(exercise.sets));
        if (!name || !Number.isFinite(sets)) {
          return [];
        }
        return [[day, name, String(sets), formatRepsCell(exercise)].join(',')];
      });
      return { name: session.name.trim().replace(/\s+/g, ' '), day, rows };
    })
    .filter((entry) => entry.day && entry.rows.length > 0);

  const keys = days.map((entry) => csvDayNameKey(entry.name));
  const numbered = new Set(keys).size < keys.length || days.some((entry) => isRoleWord(entry.name));

  const lines = [numbered ? `${CSV_EXPORT_HEADER},${CSV_DAY_NUMBER_HEADER}` : CSV_EXPORT_HEADER];
  days.forEach((entry, index) => {
    entry.rows.forEach((row) => {
      lines.push(numbered ? `${row},${index + 1}` : row);
    });
  });

  return lines.join('\n');
}

/** Day and exercise counts for the export list, straight from the same rows. */
export function summarizeExportSessions(sessions: CsvExportSession[]) {
  const usable = sessions.filter((session) => session.name.trim() && session.exercises.length > 0);
  return {
    dayCount: usable.length,
    exerciseCount: usable.reduce((total, session) => total + session.exercises.length, 0),
  };
}
