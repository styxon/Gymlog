import { getComparableLogSets, isMinutesLog } from './exerciseLog';
// i18n imports nothing from here, so this cannot close a cycle.
import { t } from './i18n';
import { isMinutesTrackingMode, isTimedTrackingMode, WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { AppLanguage, ExerciseLog, UnitPreference } from '../types/models';

// The app is kg-only. The unit-preference params are kept on these signatures
// for call-site compatibility, but weights are never converted or shown in lb.

/**
 * One Intl.DateTimeFormat per (locale, options) instead of one per call.
 *
 * Building a formatter goes through the platform's locale data and costs about
 * 40 microseconds here and several times that on Hermes; formatting with a
 * built one costs about 1. The date helpers below sat in per-row render loops
 * (a History row, a chart point per log, a sheet row per session), so a long
 * history paid the construction a thousand times per render.
 *
 * A formatter fixes the device's time zone when it is built, so the cache is
 * dropped whenever the zone's offset at this moment differs from the one it
 * was filled under. Travelling across zones with the app alive therefore still
 * reads the new zone, as a fresh formatter per call always did.
 */
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
let dateTimeFormatCacheOffset = Number.NaN;

export function getDateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const offset = new Date().getTimezoneOffset();
  if (offset !== dateTimeFormatCacheOffset) {
    dateTimeFormatCache.clear();
    dateTimeFormatCacheOffset = offset;
  }
  const key = `${locale ?? 'device'}|${JSON.stringify(options)}`;
  let formatter = dateTimeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

export function formatDate(dateString: string, language?: AppLanguage) {
  return getDateTimeFormat(localeFor(language), {
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

const LIST_WEEKDAYS: Record<AppLanguage, readonly string[]> = {
  fi: ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const LIST_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * THE date of a list row (owner-approved, 2026-10-19): "19.10." in Finnish,
 * "Oct 19" in English; with `weekday`, "su 19.10." / "Sun, Oct 19". The year
 * joins only when it is not the current one ("19.10.2025" / "Oct 19, 2025"),
 * so a list that spans New Year says which one it means and the rest stay
 * short. Local calendar day, written out rather than through Intl so a test
 * can pin it and so Hermes without Intl data reads the same.
 *
 * An unparseable date is an empty string, not "NaN.NaN.".
 */
export function formatListDate(
  value: string | Date,
  language: AppLanguage,
  options: { weekday?: boolean; now?: Date } = {},
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = options.now ?? new Date();
  const withYear = date.getFullYear() !== now.getFullYear();
  const day = date.getDate();
  const month = date.getMonth();
  const weekday = options.weekday ? LIST_WEEKDAYS[language][date.getDay()] : null;

  if (language === 'fi') {
    const core = `${day}.${month + 1}.${withYear ? date.getFullYear() : ''}`;
    return weekday ? `${weekday} ${core}` : core;
  }
  const core = `${LIST_MONTHS_EN[month]} ${day}${withYear ? `, ${date.getFullYear()}` : ''}`;
  return weekday ? `${weekday}, ${core}` : core;
}

export function formatShortDate(dateString: string, language?: AppLanguage) {
  return getDateTimeFormat(localeFor(language), {
    day: 'numeric',
    month: 'short',
  }).format(new Date(dateString));
}

/**
 * A session's day and clock: "ma 12.10. klo 18:06" / "Mon, Oct 12, 18:06".
 * The day is Intl's; the clock is formatClockTime's HH:mm (owner, 2026-10-12,
 * D3-2). Intl wrote "klo 18.06" and "06:06 PM" here while the Progress
 * tooltip beside the same weigh-in read "18:06" (dup sweep 13 review, R2).
 */
export function formatSessionDate(dateString: string, language: AppLanguage) {
  const date = new Date(dateString);
  const day = getDateTimeFormat(localeFor(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  return language === 'fi' ? `${day} klo ${formatClockTime(date)}` : `${day}, ${formatClockTime(date)}`;
}

/**
 * A clock time, "18:06": 24 hours, two digits each side, a colon — in BOTH
 * languages (owner, 2026-10-12).
 *
 * Written out rather than through Intl so a test can pin it. Intl answered
 * "18.06" for Finnish (CLDR's H.mm) and "06:06 PM" for English on an en-US
 * phone, while the rest bar, the lock-screen card, the backup row and the
 * reminder picker each wrote "18:06" by hand — one rest read "Ends 18:06"
 * under a header that said "Tänään · 18.06".
 */
export function formatClockTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * `formatClockTime` for a stored instant. `language` is required although
 * both languages write the same: while it was optional it fell to the device
 * locale, and two callers forgot it — a Finnish reader on an English phone
 * got "6:06 PM" on the Progress tooltip and the active-workout card.
 */
export function formatTime(dateString: string, _language: AppLanguage) {
  return formatClockTime(new Date(dateString));
}

/**
 * "Today" / "Yesterday" / "3 days ago", then the date itself: "Aug 16" /
 * "16.8.". Calendar days, so a session at 23:50 last night is "Yesterday"
 * at 08:00, not "0 days ago".
 *
 * From the seventh day on it is the date, never "Last week" (owner,
 * 2026-10-12): from a Monday, thirteen days back is the Tuesday of the week
 * before last. Profile records, the Home stat cards and the exercise page
 * each kept their own copy of this ladder, and a lift trained ten days ago
 * read "Last week" on two of them and "2 Oct" on the third.
 */
export function formatRelativeDay(
  at: Date | string | number,
  now: Date | number,
  language: AppLanguage,
): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const days = calendarDaysApart(date, new Date(now));
  if (days <= 0) {
    return t(language, 'common.today');
  }
  if (days === 1) {
    return t(language, 'common.yesterday');
  }
  if (days < 7) {
    return t(language, 'common.daysAgo', { count: days });
  }
  return formatShortDate(date.toISOString(), language);
}

/**
 * Whole calendar days from `from` to `to` in local time — the answer
 * completedSessions.calendarDaysBetween gives (a test holds the two equal
 * across both clock changes). Not imported from there: completedSessions
 * reaches back into this module through progression and the weight dial.
 */
function calendarDaysApart(from: Date, to: Date) {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
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

/**
 * A volume total: whole kilograms, thousands grouped — "18 400 kg" /
 * "18,400 kg". A session's History card printed "306,25 kg" and its analysis
 * "306 kg"; totals are whole kilograms on both (owner, 2026-10-12). One
 * lift's weight is `formatWeight`, never this: it keeps its hundredths.
 */
export function formatVolume(value: number, _unitPreference: UnitPreference = 'kg') {
  if (!value) {
    return '0 kg';
  }

  return `${groupThousands(value)} kg`;
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
  const raw =
    value % 1 === 0 ? `${value}` : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  // -0.004 rounds to "-0.00" and lost its zeros down to "-0": a sign in front
  // of nothing.
  const text = raw === '-0' ? '0' : raw;
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

/**
 * A whole number with its thousands grouped the way the reader's language
 * groups them: "18 400" in Finnish — a no-break space, so a narrow row cannot
 * wrap inside the number — and "18,400" in English (owner, 2026-10-12).
 * Rounded to whole first: a total in kilograms is not read to the gram.
 *
 * The language is the one the decimal mark follows (`setNumberLanguage`), so
 * the two marks can never both come out as commas. One tonnage read
 * "18400 kg", "18 400 kg" (with two different spaces) and "18,400" across
 * five screens before this.
 */
export function groupThousands(value: number) {
  const whole = Math.round(value);
  const digits = String(Math.abs(whole)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    decimalSeparator === '.' ? ',' : ' ',
  );
  return whole < 0 ? `-${digits}` : digits;
}

/**
 * One decimal in the app's mark, a trailing zero dropped: "4,7", "3". For
 * figures that need no weight-dial hundredths — hours, kilometres, sessions
 * a week. Rounds half away from zero.
 */
export function formatDecimalTenths(value: number) {
  const tenths = Math.sign(value) * (Math.round(Math.abs(value) * 10) / 10);
  return applyDecimalSeparator(Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1));
}

/**
 * A number and its unit read as one word: "47 min" must not wrap as "47" /
 * "min". Swaps the space between a figure and a short unit for a no-break
 * space; every other space is left alone.
 */
export function keepUnitsTogether(text: string) {
  return text.replace(/(\d) (min|h|s|kg|lb|lbs|g|km|m|cm|mm|kcal|t|kpl|pcs|reps|sets)(?![\p{L}\d])/gu, '$1 $2');
}
