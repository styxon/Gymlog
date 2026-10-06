/**
 * Program export, the mirror of `csvProgramImport`.
 *
 * Same four columns the importer reads — Day, Exercise, Sets, Reps — so an
 * exported plan can be pasted straight back in, or opened in Sheets or Excel.
 * `tests/lib/programCsvExport.test.cjs` round-trips the output through
 * `parseCsvProgram`, which is what keeps the two ends from drifting apart.
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
   * The numbers are minutes (trackingMode 'duration_minutes'): written
   * "20 min", which the importer reads back as minutes.
   */
  minutes?: boolean;
}

export interface CsvExportSession {
  name: string;
  exercises: CsvExportExercise[];
}

export const CSV_EXPORT_HEADER = 'Day,Exercise,Sets,Reps';

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

function escapeCell(value: string) {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  // The importer strips quote characters while splitting, so a cell may be
  // wrapped in them to protect a delimiter but cannot carry one of its own.
  const withoutQuotes = cleaned.replace(/"/g, '');
  return /[,;\t]/.test(withoutQuotes) ? `"${withoutQuotes}"` : withoutQuotes;
}

/**
 * Renders sessions as CSV. Sessions without exercises are dropped: a day with
 * no rows would disappear on re-import anyway, so writing it would promise a
 * round trip the format cannot keep.
 */
export function buildProgramCsv(sessions: CsvExportSession[]): string {
  const lines = [CSV_EXPORT_HEADER];

  sessions.forEach((session) => {
    const day = escapeCell(session.name);
    if (!day) {
      return;
    }
    session.exercises.forEach((exercise) => {
      const name = escapeCell(exercise.name);
      const sets = Math.max(1, Math.round(exercise.sets));
      if (!name || !Number.isFinite(sets)) {
        return;
      }
      const reps = formatCsvReps(exercise.repMin, exercise.repMax);
      lines.push([day, name, String(sets), exercise.minutes ? `${reps} min` : reps].join(','));
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
