/**
 * The session overview's rows (design: workout session flow, screen 1).
 *
 * The overview listed what a session contains — names and set counts — which
 * is the one thing the reader already knows by the time they are standing in
 * the gym holding the phone. What was missing is the thing that is actually
 * new every week: what the app changed since last time.
 *
 * It also carried an amber warning on any lift touching a body part flagged in
 * setup, until 2026-09-04. That warning fired on the same lift every session
 * forever, which is furniture — and it was second-guessing a decision already
 * taken: the programme composer removes `avoid` lifts outright and swaps
 * `careful` ones for kinder variants before a session is ever built. What
 * survives that is a lift the app has judged fine, and warning about it every
 * week is the app disagreeing with itself.
 *
 * Decided here rather than in the player so it can be tested without mounting
 * a 4000-line screen. Nothing in this file reaches storage, React or the clock.
 */
import { doseUnitSuffix, formatWeight } from './format';
import { t } from './i18n';
import { AppLanguage, UnitPreference } from '../types/models';

export interface OverviewExerciseInput {
  /**
   * The library name, untranslated. The caution matcher reads English
   * patterns, so a localized label here would silently flag nothing.
   */
  exerciseName: string;
  setCount: number;
  /** Already formatted: "7", "6–8", or the seconds of a hold. */
  repsLabel: string;
  /** A hold logs seconds, so its scheme carries the unit and never a weight. */
  timed: boolean;
  /** Steady cardio logs minutes: the same, in minutes. */
  minutes?: boolean;
  loadKg: number | null;
}

/**
 * The right-hand half of an overview row: "4 × 7 · 62,5 kg".
 *
 * The weight is the half that changes week to week, and it was the half the
 * row did not show — so the screen that promises automated progression proved
 * it nowhere until the reader was already mid-set.
 */
export function buildOverviewScheme(
  input: OverviewExerciseInput,
  language: AppLanguage,
  unitPreference: UnitPreference = 'kg',
): string {
  const plan = `${input.setCount} × ${input.repsLabel}${doseUnitSuffix(input)}`;
  if (input.timed || input.minutes || input.loadKg === null || !Number.isFinite(input.loadKg) || input.loadKg <= 0) {
    return plan;
  }
  return `${plan} · ${formatWeight(input.loadKg, unitPreference)}`;
}

export interface OverviewColumns {
  /** The set count as text; '' for a drill, which has none. */
  sets: string;
  /** Reps; '' for a drill, and for a hold, whose seconds sit under `load`. */
  reps: string;
  /** The weight, or the seconds of a hold, or '' when there is nothing to lift. */
  load: string;
}

/**
 * The same facts as `buildOverviewScheme`, in columns. "4 × 7 · 62,5 kg" as
 * one string put the weight wherever the reps ended, and on a lift with no
 * weight two words earlier; the reader called the numbers "pomppii" and asked
 * for name, sets, reps and kg/time in the same place on every row (user
 * 2026-09-09). Empty is honest: a cell with nothing to lift stays blank rather
 * than wearing a dash.
 */
export function buildOverviewColumns(
  input: OverviewExerciseInput,
  unitPreference: UnitPreference = 'kg',
): OverviewColumns {
  const hasLoad = input.loadKg !== null && Number.isFinite(input.loadKg) && input.loadKg > 0;
  const timeUnit = input.minutes || input.timed;
  return {
    sets: String(input.setCount),
    reps: timeUnit ? '' : input.repsLabel,
    load: timeUnit
      ? `${input.repsLabel}${doseUnitSuffix(input)}`
      : hasLoad
        ? formatWeight(input.loadKg as number, unitPreference)
        : '',
  };
}

export interface ProgressionMove {
  /** Today's number, and the one the gate raised it from. */
  loadKg: number | null;
  autoProgressedFromKg: number | null;
  reps: number;
  autoProgressedFromReps: number | null;
}

/**
 * The pill that says the app moved something today, or null when it did not.
 *
 * Deliberately one pill for the whole session rather than a delta per row: the
 * overview is read in three seconds on the way to the rack, and the per-lift
 * breakdown already exists twice — on the set screen's AUTO badge and on the
 * finish screen's WHAT MOVED.
 *
 * Loads win over reps when both moved. A kilo on the bar is the headline; the
 * rep gate is what runs on the lifts that have no bar.
 */
export function buildProgressionPill(
  moves: ReadonlyArray<ProgressionMove>,
  language: AppLanguage,
  unitPreference: UnitPreference = 'kg',
): string | null {
  const loadDeltas = moves
    .filter(
      (move) =>
        move.autoProgressedFromKg !== null
        && move.loadKg !== null
        && move.loadKg > move.autoProgressedFromKg,
    )
    .map((move) => (move.loadKg as number) - (move.autoProgressedFromKg as number));

  if (loadDeltas.length > 0) {
    const biggest = Math.max(...loadDeltas);
    return t(
      language,
      loadDeltas.length === 1 ? 'guided.entry.progressed.one' : 'guided.entry.progressed.many',
      { delta: formatWeight(biggest, unitPreference), count: loadDeltas.length },
    );
  }

  const repDeltas = moves
    .filter((move) => move.autoProgressedFromReps !== null && move.reps > (move.autoProgressedFromReps as number))
    .map((move) => move.reps - (move.autoProgressedFromReps as number));

  if (repDeltas.length > 0) {
    // Separate singular key rather than a plural rule — the app has no
    // pluralization engine, and "+1 toistoa" is the kind of wrong that a
    // reader notices on the one screen they read before every session.
    const biggest = Math.max(...repDeltas);
    return biggest === 1
      ? t(language, 'guided.entry.progressed.repOne')
      : t(language, 'guided.entry.progressed.reps', { delta: biggest });
  }

  return null;
}
