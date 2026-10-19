import type { WorkoutRuntimeTemplate } from '../features/workout/workoutTypes';
import type { FatigueResult } from './fatigueModel';
import { applyDecimalSeparator, groupThousands } from './format';
import { t } from './i18n';
import { isProUnlocked } from './proEntitlement';
import { progressionFatigueSignalAt, type ProgressionFatigueSignal } from './progressionGate';
import type { FatigueModelInput } from './fatigueModel';
import type { AppLanguage } from '../types/models';
import { localizeSessionName } from './sessionNameLabel';
import { nearestDayStart } from './trainingSchedule';

/**
 * The recovery sheet (design: "GAINER Palautuminen Sheet", 2026-09-26).
 *
 * The recovery row on Progress said "Koholla" and stopped there. The sheet
 * behind it says why — this week's load against the usual week, where that
 * sits on the zones the fatigue model already uses — and what to do about it,
 * with the two things the app can actually do for the reader: make the next
 * session lighter, and make tomorrow a rest day.
 *
 * Every number comes from `buildFatigueModel`; nothing here estimates. And
 * every sentence has to be true of what the app does: the design's "about 30 %
 * lighter" became "one set fewer", because one set fewer is what the button
 * does.
 */

export type RecoveryTone = 'green' | 'amber' | 'red';

export type RecoveryActionKind = 'close' | 'lighten' | 'restTomorrow';

export interface RecoveryAction {
  kind: RecoveryActionKind;
  label: string;
}

export interface RecoveryWeekDay {
  /** Local midnight. */
  dayStart: number;
  label: string;
  trained: boolean;
  today: boolean;
}

export interface RecoverySheetModel {
  tone: RecoveryTone;
  status: string;
  /**
   * The model's recovery score, or null on a light week. The score measures
   * how well this week's load fits the usual one, so a rested reader scores
   * low — "Kunnossa 20/100" said two opposite things at once (probe run,
   * 2026-09-26). The status and the lead say it; the number is left out.
   */
  score: number | null;
  lead: string;
  /**
   * The load ratio as a number, or null when it would mean nothing: with no
   * usual week to compare to, or a week with nothing in it, the model's 0 is
   * "no ratio", not "0,00" (#bugs 2026-10-18).
   */
  acwrLabel: string | null;
  /** Where the "you" marker sits on the zone bar, 2..98 (percent); null with no ratio to place. */
  markerPercent: number | null;
  acuteLabel: string;
  chronicLabel: string;
  week: RecoveryWeekDay[];
  todos: string[];
  /** The advice and the actions are Pro's; green is free in full. */
  locked: boolean;
  primary: RecoveryAction;
  secondary: RecoveryAction | null;
  /** Already done, with a way to take it back. */
  lightenQueued: boolean;
  restTomorrowMarked: boolean;
}

export interface RecoverySheetInput {
  fatigue: FatigueResult;
  /** performedAt of every logged strength session. */
  sessionDates: ReadonlyArray<string>;
  now: Date;
  /** The session Home offers next, already named for the reader. */
  nextSessionTitle: string | null;
  automatedProgression: boolean;
  proUnlocked: boolean;
  /** The reader's rhythm says tomorrow is a training day. */
  tomorrowTrains: boolean;
  restTomorrowMarked: boolean;
  lightenQueued: boolean;
  language: AppLanguage;
}

/** The zone bar's range, as drawn: 0.5 at the left edge, 2.0 at the right. */
const ZONE_MIN = 0.5;
const ZONE_SPAN = 1.5;

/** Sunday first, as Date#getDay counts — the short labels the app already has. */
const WEEKDAY_KEYS = [
  'setup.day.sun',
  'setup.day.mon',
  'setup.day.tue',
  'setup.day.wed',
  'setup.day.thu',
  'setup.day.fri',
  'setup.day.sat',
] as const;

function dayStartOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight `offset` calendar days from `date` — not `+ offset * DAY_MS`. */
export function dayStartPlus(date: Date, offset: number): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

/** Whole kilograms, thousands grouped as everywhere else: "18 400 kg" / "18,400 kg". */
export function formatLoadKg(kg: number): string {
  return `${groupThousands(Math.max(0, kg))} kg`;
}

export function recoveryTone(fatigue: Pick<FatigueResult, 'signal'>): RecoveryTone {
  return fatigue.signal === 'high' ? 'red' : fatigue.signal === 'elevated' ? 'amber' : 'green';
}

/** The last seven calendar days, today last, and whether each was trained. */
export function recoveryWeek(sessionDates: ReadonlyArray<string>, now: Date, language: AppLanguage): RecoveryWeekDay[] {
  const trainedDays = new Set(
    sessionDates
      .map((iso) => new Date(iso))
      .filter((date) => Number.isFinite(date.getTime()))
      .map(dayStartOf),
  );
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    const dayStart = date.getTime();
    return {
      dayStart,
      label: t(language, WEEKDAY_KEYS[date.getDay()]),
      trained: trainedDays.has(dayStart),
      today: index === 6,
    };
  });
}

/** The ratio to print, or null while there is no usual week to divide by. */
export function acwrLabelOf(fatigue: Pick<FatigueResult, 'acwr' | 'chronicLoadKg' | 'confident'>): string | null {
  if (!fatigue.confident || !(fatigue.chronicLoadKg > 0) || !Number.isFinite(fatigue.acwr) || !(fatigue.acwr > 0)) {
    return null;
  }
  return applyDecimalSeparator(fatigue.acwr.toFixed(2));
}

/**
 * A session title as a sentence may carry it: a name saved with its number
 * glued on ("Legs1") reads as a typo, so the number is set apart before the
 * name is translated ("Jalat 1"). Only that case: one plain word with the
 * number glued on, as the whole title; "Squat 5x5" and "HIIT 20" stay as written. Blank titles are no title.
 */
export function tidySessionTitle(title: string | null | undefined, language: AppLanguage): string | null {
  const spaced = (title ?? '').trim().replace(/\s+/g, ' ').replace(/^(\p{L}+)(\d+)$/u, '$1 $2');
  if (!spaced) {
    return null;
  }
  // "Legs 1" is not a dictionary phrase; "Legs" is. Translate the name and
  // keep the number beside it.
  // The whole title goes first: "Day 2" is a phrase of its own ("Päivä 2").
  const whole = localizeSessionName(spaced, language);
  if (whole !== spaced) {
    return whole;
  }
  const numbered = spaced.match(/^(.*\S)\s+(\d+)$/u);
  return numbered ? `${localizeSessionName(numbered[1], language)} ${numbered[2]}` : localizeSessionName(spaced, language);
}

export function buildRecoverySheet(input: RecoverySheetInput): RecoverySheetModel | null {
  const { fatigue, language } = input;
  // Same gate as the row: without a confident model there is no row to open.
  if (!fatigue.confident) {
    return null;
  }
  const tone = recoveryTone(fatigue);
  const over = Math.round((fatigue.acwr - 1) * 100);
  const under = Math.round((1 - fatigue.acwr) * 100);

  const status = t(
    language,
    tone === 'red' ? 'pro.read.recoveryLow' : tone === 'amber' ? 'pro.read.recoveryElevated' : 'pro.read.recoveryOk',
  );

  // A light week is green too — the model's "undertrained" is not a warning —
  // but "your load is in line with your usual week" would be false of it. A
  // week with nothing in it is not "100 % lighter"; it is a week off. And a
  // load past double the usual reads as a multiple: a reader who trained
  // after a near-empty month was told their load was 15 900 % over.
  const lead =
    tone === 'red'
      ? fatigue.acwr >= 2
        ? t(language, 'recovery.lead.redTimes', { times: applyDecimalSeparator(fatigue.acwr.toFixed(1)) })
        : t(language, 'recovery.lead.red', { pct: over })
      : tone === 'amber'
        ? t(language, 'recovery.lead.amber', { pct: over })
        : fatigue.signal === 'undertrained'
          ? fatigue.sessionCount7d === 0
            ? t(language, 'recovery.lead.rested')
            : fatigue.acuteLoadKg === 0
              ? // Sessions with no weight on the bar (bodyweight, holds, cardio) are
                // not a rested week, and 0 against a loaded month is not "100% lighter".
                t(language, 'recovery.lead.noLoad')
              : t(language, 'recovery.lead.light', { pct: under })
          : t(language, 'recovery.lead.green');

  const nextTitle = tidySessionTitle(input.nextSessionTitle, language);

  const todos =
    tone === 'red'
      ? [
          // "Take tomorrow off" only while there is still something to do
          // about it. Once marked — or when the rhythm had it off anyway —
          // the line says to keep it, and no button offers it again.
          t(
            language,
            input.tomorrowTrains && !input.restTomorrowMarked ? 'recovery.todo.red.rest' : 'recovery.todo.red.restAlready',
          ),
          t(language, 'recovery.todo.red.lighter'),
          t(language, 'recovery.todo.red.hold'),
        ]
      : tone === 'amber'
        ? [t(language, 'recovery.todo.amber.hold'), t(language, 'recovery.todo.amber.lastSet'), t(language, 'recovery.todo.amber.rest')]
        : [
            nextTitle
              ? t(language, 'recovery.todo.green.next', { session: nextTitle })
              : t(language, 'recovery.todo.green.plan'),
            // Only when it is on: "progression stays on" for a reader who
            // switched it off would be the app describing a different app.
            // And only with Pro, the gate's other half: green is free in full,
            // and a Free or lapsed-trial reader was told progression stays on
            // while every start opened without it (bug hunt 12, 2026-10-11).
            ...(input.automatedProgression && input.proUnlocked ? [t(language, 'recovery.todo.green.progression')] : []),
            t(language, 'recovery.todo.green.sleep'),
          ];

  const close: RecoveryAction = { kind: 'close', label: t(language, 'recovery.cta.ok') };
  const lighten: RecoveryAction = { kind: 'lighten', label: t(language, 'recovery.cta.lighten') };
  const rest: RecoveryAction = { kind: 'restTomorrow', label: t(language, 'recovery.cta.restTomorrow') };
  const keepPlan: RecoveryAction = { kind: 'close', label: t(language, 'recovery.cta.keepPlan') };

  let primary: RecoveryAction = close;
  let secondary: RecoveryAction | null = null;
  if (tone === 'amber') {
    primary = input.lightenQueued ? close : lighten;
    secondary = input.lightenQueued ? null : keepPlan;
  } else if (tone === 'red') {
    // A rest day is offered only for a day the rhythm would have trained;
    // marking a day that was rest anyway would be a button that does nothing.
    const canRest = input.tomorrowTrains && !input.restTomorrowMarked;
    const canLighten = !input.lightenQueued;
    const actions = [canRest ? rest : null, canLighten ? lighten : null].filter(
      (action): action is RecoveryAction => action !== null,
    );
    primary = actions[0] ?? close;
    secondary = actions[1] ?? null;
  }

  return {
    tone,
    status,
    score: fatigue.signal === 'undertrained' ? null : fatigue.recoveryScore,
    lead,
    acwrLabel: acwrLabelOf(fatigue),
    // No ratio, no marker: a "you" pinned at 2% with no number beside it says nothing.
    markerPercent:
      acwrLabelOf(fatigue) === null
        ? null
        : Math.max(2, Math.min(98, ((fatigue.acwr - ZONE_MIN) / ZONE_SPAN) * 100)),
    acuteLabel: formatLoadKg(fatigue.acuteLoadKg),
    chronicLabel: formatLoadKg(fatigue.chronicLoadKg),
    week: recoveryWeek(input.sessionDates, input.now, language),
    todos,
    locked: tone !== 'green' && !input.proUnlocked,
    primary,
    secondary,
    lightenQueued: input.lightenQueued,
    restTomorrowMarked: input.restTomorrowMarked,
  };
}

// ── "Kevennä seuraava treeni" ──────────────────────────────────────────────

/** Asked for, and not yet spent on a session. */
export interface LightNextSession {
  /** ISO timestamp of the tap. */
  requestedAt: string;
}

/**
 * A lighter session asked for a week ago is not an answer about the next one.
 * Seven calendar days, so the reader who asks on Monday and trains on Sunday
 * still gets it, and one who forgets does not find a light session in a month.
 */
const LIGHT_SESSION_DAYS = 7;

export function isLightenPending(request: LightNextSession | null | undefined, now: Date): boolean {
  if (!request) {
    return false;
  }
  const at = new Date(request.requestedAt);
  if (!Number.isFinite(at.getTime())) {
    return false;
  }
  return dayStartOf(at) > dayStartPlus(now, -LIGHT_SESSION_DAYS) && at.getTime() <= now.getTime() + 60_000;
}

/**
 * A pending lighter session the start will honour: asked for, still fresh, and
 * the reader has Pro at `now`. The request can only be made from the Pro sheet,
 * and a trial that ended between the tap and the start left a Free reader with
 * a shorter session and its Undo behind the lock (bug hunt 12, 2026-10-11).
 * The start still spends the request either way.
 */
export function isLightenDue(
  preferences: Parameters<typeof isProUnlocked>[0] & { lightNextSession: LightNextSession | null | undefined },
  now: Date,
): boolean {
  return isLightenPending(preferences.lightNextSession, now) && isProUnlocked(preferences, now);
}

export function normalizeLightNextSession(raw: unknown): LightNextSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const { requestedAt } = raw as Record<string, unknown>;
  return typeof requestedAt === 'string' && Number.isFinite(Date.parse(requestedAt)) ? { requestedAt } : null;
}

/**
 * The next session, one set lighter on every lift that has a set to spare.
 *
 * The same lifts in the same order — the reader trains the programme, just
 * less of it. A one-set lift stays at one: taking it to none would be leaving
 * it out, which is the Home card's drop and a different decision.
 */
export function lightenRuntimeTemplate(template: WorkoutRuntimeTemplate): WorkoutRuntimeTemplate {
  return {
    ...template,
    sessions: template.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) =>
        exercise.sets >= 2
          ? { ...exercise, sets: exercise.sets - 1, programmeSets: exercise.programmeSets ?? exercise.sets }
          : exercise,
      ),
    })),
  };
}

/**
 * A lighter session also holds its loads: at least 'elevated' to the
 * progression gate, whatever the model reads today.
 */
export function lightenedFatigueSignal(signal: ProgressionFatigueSignal): ProgressionFatigueSignal {
  return signal === 'high' ? 'high' : 'elevated';
}

/**
 * The template and recovery signal a programme session starts with.
 *
 * Recovery is read as of `now`, the moment of the start: a signal kept from the
 * last save still counted a heavy week as this one days after it ended. A
 * pending lighter session shortens the template and holds its loads.
 */
export function resolveProgrammeStart(
  template: WorkoutRuntimeTemplate,
  lighten: boolean,
  fatigueInput: FatigueModelInput,
  now: Date,
): { template: WorkoutRuntimeTemplate; fatigueSignal: ProgressionFatigueSignal } {
  const fatigueSignal = progressionFatigueSignalAt(fatigueInput, now);
  return lighten
    ? { template: lightenRuntimeTemplate(template), fatigueSignal: lightenedFatigueSignal(fatigueSignal) }
    : { template, fatigueSignal };
}

// ── "Lisää lepopäivä huomiselle" ───────────────────────────────────────────

/**
 * How long a rest day is kept after it has passed. Not zero: Progress marks a
 * past training day with no session as missed, and a rest day dropped the day
 * after would turn into a missed day on the calendar in hindsight. Sixty days
 * covers every calendar the app draws.
 */
const REST_DAY_MEMORY_DAYS = 60;

export function pruneRestDays(restDayStarts: ReadonlyArray<number>, now: Date): number[] {
  const oldest = dayStartPlus(now, -REST_DAY_MEMORY_DAYS);
  return [...new Set(restDayStarts.filter((day) => Number.isFinite(day) && day >= oldest))].sort((a, b) => a - b);
}

export function withRestDay(restDayStarts: ReadonlyArray<number>, dayStart: number, now: Date): number[] {
  return pruneRestDays([...restDayStarts, dayStart], now);
}

export function withoutRestDay(restDayStarts: ReadonlyArray<number>, dayStart: number, now: Date): number[] {
  return pruneRestDays(
    restDayStarts.filter((day) => nearestDayStart(day) !== nearestDayStart(dayStart)),
    now,
  );
}

export function normalizeRestDayStarts(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return [...new Set(raw.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))].sort(
    (a, b) => a - b,
  );
}
