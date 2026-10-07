import { getComparableLogSets, isMinutesLog } from './exerciseLog';
// i18n imports nothing from here, so this cannot close a cycle.
import { t } from './i18n';
import { isMinutesTrackingMode, isTimedTrackingMode, WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { AppLanguage, ExerciseLog, UnitPreference } from '../types/models';

// The app is kg-only. The unit-preference params are kept on these signatures
// for call-site compatibility, but weights are never converted or shown in lb.

export function formatDate(dateString: string, language?: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString));
}

/**
 * Dates follow the app's language, not the device's. A Finnish user on an
 * English phone should still read "15.3.", so callers pass the setting through;
 * omitting it keeps the device locale, which is what the untranslated screens
 * still do.
 */
export function localeFor(language?: AppLanguage) {
  if (language === 'fi') {
    return 'fi-FI';
  }
  if (language === 'en') {
    return 'en-US';
  }
  return undefined;
}

/**
 * A day and month in figures, in the app's language: "25.8." in Finnish, "8/25"
 * in English — en-US, as `localeFor` has it, and as the session analysis already
 * wrote its bars. Chart axes built the Finnish form for both languages, so an
 * English reader got "19.7. 28.7." under their weight (2026-09-14).
 *
 * Written out rather than through Intl so a test can pin the exact string.
 */
export function formatDayMonthNumeric(date: Date, language: AppLanguage) {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return language === 'fi' ? `${day}.${month}.` : `${month}/${day}`;
}

/**
 * The same with its year: "12.9.2026" / "9/12/2026". English used to put the
 * day first ("12/9/2026"), which an en-US reader takes for December 9th.
 */
export function formatDateNumeric(date: Date, language: AppLanguage) {
  return language === 'fi'
    ? `${formatDayMonthNumeric(date, language)}${date.getFullYear()}`
    : `${formatDayMonthNumeric(date, language)}/${date.getFullYear()}`;
}

export function formatShortDate(dateString: string, language?: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: 'numeric',
    month: 'short',
  }).format(new Date(dateString));
}

export function formatSessionDate(dateString: string, language?: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

/**
 * `undefined` means the DEVICE locale, which on an en-US phone gives "6:06 PM"
 * even when the app is in Finnish. Finland writes 18:06.
 */
export function formatTime(dateString: string, language: AppLanguage = 'en') {
  return new Intl.DateTimeFormat(language === 'fi' ? 'fi-FI' : undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

export function convertWeightFromKg(value: number, _unitPreference?: UnitPreference) {
  return value;
}

export function convertWeightToKg(value: number, _unitPreference?: UnitPreference) {
  return value;
}

export function formatWeight(value: number | null | undefined, _unitPreference: UnitPreference = 'kg') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  return `${removeTrailingZeros(value)} kg`;
}

export function formatWeightInputValue(value: number | null | undefined, _unitPreference?: UnitPreference) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }

  return removeTrailingZeros(value);
}

export function formatVolume(value: number, _unitPreference: UnitPreference = 'kg') {
  if (!value) {
    return '0 kg';
  }

  return `${removeTrailingZeros(value)} kg`;
}

/** Compact lifetime/monthly volume: "412 kg", "4.5 t". */
export function formatCompactVolume(totalKg: number, _unitPreference: UnitPreference = 'kg') {
  if (totalKg >= 1000) {
    const tonnes = totalKg / 1000;
    return `${removeTrailingZeros(Number(tonnes.toFixed(tonnes >= 100 ? 0 : 1)))} t`;
  }
  return `${removeTrailingZeros(Math.round(totalKg))} kg`;
}

export function formatDurationMinutes(totalMinutes: number) {
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatRepRange(repMin: number, repMax: number) {
  return repMin === repMax ? `${repMin}` : `${repMin}-${repMax}`;
}

/**
 * "4 × 8-10" for reps, "3 × 30-60 s" for a hold.
 *
 * The unit is the whole point: the catalogs have always written a plank as
 * "3x30-60", and every screen rendered that as sixty repetitions.
 */
export function formatSetScheme(
  sets: number,
  repMin: number,
  repMax: number,
  trackingMode: WorkoutTrackingMode,
) {
  const range = formatRepRange(repMin, repMax);
  return `${sets} × ${range}${doseUnitSuffix({
    timed: isTimedTrackingMode(trackingMode),
    minutes: isMinutesTrackingMode(trackingMode),
  })}`;
}

/**
 * The unit a dose's number is written with: " s" for a hold, " min" for a
 * bout of minutes, nothing for repetitions — "1 × 20 min", "3 × 45 s",
 * "4 × 8". The same in both languages.
 */
export function doseUnitSuffix(unit: { timed?: boolean; minutes?: boolean }): string {
  return unit.minutes ? ' min' : unit.timed ? ' s' : '';
}

export function formatReps(repsPerSet: number[]) {
  return repsPerSet.length ? repsPerSet.join(',') : '-';
}

export function formatLogSetSummary(
  log?: (Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'> & Pick<Partial<ExerciseLog>, 'repsUnit'>) | null,
  unitPreference: UnitPreference = 'kg',
) {
  if (!log || log.skipped) {
    return '-';
  }

  const sets = getComparableLogSets(log);
  if (sets.length === 0) {
    return '-';
  }

  // Minutes carry no weight: "20 min", or "5, 5, 5, 5 min" for blocks. A
  // "0 kg - 20" here read as twenty reps of nothing.
  if (isMinutesLog(log)) {
    return `${sets.map((set) => set.reps).join(', ')} min`;
  }

  const usesSingleWeight = sets.every((set) => Math.abs(set.weight - sets[0].weight) < 0.0001);
  if (usesSingleWeight) {
    return `${formatWeight(sets[0].weight, unitPreference)} - ${sets.map((set) => set.reps).join(',')}`;
  }

  return sets
    .map((set) => `${removeTrailingZeros(convertWeightFromKg(set.weight, unitPreference))}x${set.reps}`)
    .join(', ');
}

/**
 * @param language the reader's. It was missing, so a saved workout read
 *   "Skipped" in the middle of a Finnish list that already said "OHITETTU"
 *   two lines below it — the English one being the line, the Finnish one the
 *   chip.
 */
export function formatLogResult(
  log?: (Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'> & Pick<Partial<ExerciseLog>, 'repsUnit'>) | null,
  unitPreference: UnitPreference = 'kg',
  language: AppLanguage = 'en',
) {
  if (!log) {
    return t(language, 'history.noPreviousResult');
  }

  if (log.skipped) {
    return t(language, 'history.badge.skipped');
  }

  return formatLogSetSummary(log, unitPreference);
}


export function parseNumberInput(value: string) {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The decimal mark every number in the UI is written with.
 *
 * Finnish writes 92,5 and English writes 92.5, and the app shipped dots to
 * both — "92.5 kg" on every screen that states a weight, in an app whose first
 * language is Finnish. Reported from the phone on the Pro page, but the Pro
 * page was only where it was noticed.
 *
 * This is a module setting rather than a parameter because removeTrailingZeros
 * has 41 call sites and most of them are nowhere near a `language`: pure lib
 * functions, chart tick formatters, components that never took a language prop.
 * Threading it through all of them to change one character would be a large
 * mechanical diff across the whole app for a cross-cutting concern that every
 * i18n library models as exactly this — a current locale.
 *
 * Finnish is the default, so forgetting to call the setter fails toward the
 * app's own first language rather than toward English.
 *
 * NOT used by the CSV exports. They write raw numbers (workoutLogCsvExport
 * passes `row.weight` straight to csvField), which is what keeps a decimal
 * comma from turning a comma-separated file into nonsense. Keep it that way.
 */
let decimalSeparator = ',';

export function setNumberLanguage(language: AppLanguage) {
  decimalSeparator = language === 'en' ? '.' : ',';
}

/**
 * `build`, with numbers written for `language`, and the separator put back
 * after. For text built for someone other than the app's own reader — the
 * coach endpoint builds its offline answer in Node, where nothing ever set
 * the separator, so an English answer read "ACWR 3,02" (#bugs, 2026-09-30).
 */
export function withNumberLanguage<T>(language: AppLanguage, build: () => T): T {
  const saved = decimalSeparator;
  setNumberLanguage(language);
  try {
    return build();
  } finally {
    decimalSeparator = saved;
  }
}

/**
 * The active decimal mark applied to a string the caller has already rounded.
 *
 * `removeTrailingZeros` rounds to one decimal, which is right for weights and
 * wrong for anything that is legitimately finer: a 1.25 kg plate becomes "1,3"
 * and an ACWR of 1.32 becomes "1,3". Those callers do their own rounding and
 * only need the separator swapped.
 */
export function applyDecimalSeparator(text: string) {
  return decimalSeparator === '.' ? text : text.replace('.', decimalSeparator);
}

export function removeTrailingZeros(value: number) {
  // Two decimals, not one. The weight dial steps 1.25 kg — the smallest real
  // plate pair — and a single decimal rendered that as "1,3": a number the
  // app never stored and the reader never dialled, which then walked up the
  // bar as 1,3 · 2,5 · 3,8 · 5 (#bugs 2026-08-26). Trailing zeros still go,
  // so 2.5 stays "2,5" and 60 stays "60".
  const text =
    value % 1 === 0 ? `${value}` : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return decimalSeparator === '.' ? text : text.replace('.', decimalSeparator);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A percentage, spaced the way the reader's language spaces it.
 *
 * Finnish puts a space before the sign and English does not, and the app had
 * five places writing one by hand with two opinions between them: the
 * programme page and the emphasis sheet wrote "36 %", the plan-ready card and
 * the building screen wrote "97%". Every one of them was therefore wrong in
 * one of the two languages the app ships.
 *
 * The Finnish space is non-breaking. The number and its sign are one word, and
 * a plain space lets a narrow legend row wrap between them.
 */
export function formatPercent(value: number, language: AppLanguage = 'en') {
  return language === 'fi' ? `${value} %` : `${value}%`;
}
