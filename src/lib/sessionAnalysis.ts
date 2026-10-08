import { exerciseNameLabel } from './exerciseNameLabel';
import { I18nKey, t } from './i18n';
import { localizeSessionName } from './sessionNameLabel';
import {
  buildLiftHistories,
  comparableSessions,
  completedReps,
  normalizedName,
  sessionTime,
  sessionVolumeKg,
  topSetOf,
} from './trainingHistory';
import { AppLanguage, ExerciseLog, ExerciseLogSetEffort, WorkoutSession } from '../types/models';
import { getDateTimeFormat, removeTrailingZeros } from './format';

/**
 * The written-out post-workout analysis behind the coach sheet's
 * "See full analysis" button.
 *
 * Same rule as aiCoachModules: every figure comes from a logged set, and a
 * block that cannot be filled honestly comes back null so the screen can leave
 * it out. Two specific abstentions worth knowing about:
 *
 * - There is no RPE. The app stores a coarse per-set effort (easy/good/hard)
 *   and only the list logger writes it, so this reports the efforts that exist
 *   and omits the row entirely when none were recorded. It never prints a
 *   number on a scale the user was never asked about.
 * - The verdict is a phrase, never a score. No grade out of ten, no stars.
 */

export type SessionTrend = 'up' | 'flat' | 'down';

export interface AnalysisText {
  text: string;
  highlights: string[];
}

export interface AnalysisMetric {
  labelKey: I18nKey;
  value: string;
  sub: string | null;
  /**
   * Share of the row this cell takes. Equal thirds broke the heaviest set's
   * exercise name across a word ("Penkkipunner|rus"), so the cells are sized
   * to what they hold: a lift name needs room, a set count does not.
   */
  grow: number;
}

export interface AnalysisVolumeBar {
  sessionId: string;
  /** Short date for the axis. */
  label: string;
  volumeKg: number;
  isCurrent: boolean;
}

export interface AnalysisExerciseRow {
  key: string;
  name: string;
  /** "3 × 8 · 60 kg" — always from logged sets. */
  detail: string;
  topSet: string | null;
  /** Null when this lift has no earlier logged session to compare against. */
  trend: SessionTrend | null;
  trendLabel: string | null;
}

export interface AnalysisObservation {
  trend: SessionTrend;
  body: AnalysisText;
}

export interface SessionAnalysis {
  sessionId: string;
  /** "KOKO KEHO · VIIKKO 1" style eyebrow. */
  eyebrow: string;
  title: string;
  /** Duration · sets · volume, plus effort only when efforts were logged. */
  metaParts: string[];
  verdictTagKey: I18nKey;
  verdict: AnalysisText | null;
  keyNumbers: AnalysisMetric[];
  volumeBars: AnalysisVolumeBar[];
  volumeChangePercent: number | null;
  exercises: AnalysisExerciseRow[];
  observations: AnalysisObservation[];
  nextActions: AnalysisText[];
}

export type VolumeChangeKind = 'up' | 'down' | 'flat';

export interface VolumeChangeWording {
  kind: VolumeChangeKind;
  /** What to print. A percentage only when something actually changed. */
  text: string;
}

/**
 * How a volume change is written, in one place.
 *
 * Zero is never printed as a percentage. "Volyymi 0 %" next to a "0 %" badge
 * reads as missing data — three zeros on a screen whose whole job is to prove
 * the numbers are real. The percentage is reserved for change; no change is
 * written as a word (design: "0 % ei ole tulos").
 */
export function describeVolumeChange(
  percent: number | null,
  language: AppLanguage,
): VolumeChangeWording | null {
  if (percent === null || !Number.isFinite(percent)) {
    return null;
  }
  if (percent === 0) {
    return { kind: 'flat', text: t(language, 'analysis.change.flat') };
  }
  return { kind: percent > 0 ? 'up' : 'down', text: `${percent > 0 ? '+' : ''}${percent}%` };
}

export interface SessionAnalysisInput {
  sessionId: string;
  sessions: WorkoutSession[];
  logs: ExerciseLog[];
  language: AppLanguage;
  /** Week number of the plan, when one is running. */
  weekNumber?: number | null;
}

const MAX_VOLUME_BARS = 6;

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function collectEfforts(logs: ExerciseLog[]) {
  const efforts: ExerciseLogSetEffort[] = [];
  for (const log of logs) {
    for (const set of log.sets ?? []) {
      if (set.effort) {
        efforts.push(set.effort);
      }
    }
  }
  return efforts;
}

function shortDate(iso: string, language: AppLanguage) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  return getDateTimeFormat(language === 'fi' ? 'fi-FI' : 'en-US', {
    day: 'numeric',
    month: 'numeric',
  }).format(date);
}

export function buildSessionAnalysis({
  sessionId,
  sessions,
  logs,
  language,
  weekNumber = null,
}: SessionAnalysisInput): SessionAnalysis | null {
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return null;
  }

  const sessionLogs = logs.filter((log) => log.sessionId === session.id && !log.skipped);
  if (sessionLogs.length === 0) {
    return null;
  }

  const localizedName = localizeSessionName(session.workoutNameSnapshot, language);
  const eyebrow = weekNumber
    ? `${localizedName.toUpperCase()} · ${t(language, 'analysis.week', { count: weekNumber })}`
    : localizedName.toUpperCase();

  // ── meta row ────────────────────────────────────────────────────────────
  const setCount = sessionLogs.reduce((sum, log) => sum + completedReps(log).length, 0);
  const volume = sessionVolumeKg(session, logs);
  const metaParts: string[] = [];

  if (typeof session.durationMinutes === 'number' && session.durationMinutes > 0) {
    metaParts.push(`${session.durationMinutes} min`);
  }
  if (setCount > 0) {
    metaParts.push(
      setCount === 1
        ? t(language, 'analysis.setCountOne')
        : t(language, 'analysis.setCount', { count: setCount }),
    );
  }
  if (volume !== null) {
    metaParts.push(`${Math.round(volume)} kg`);
  }

  // Effort only appears when the user actually recorded it.
  const efforts = collectEfforts(sessionLogs);
  if (efforts.length > 0) {
    const good = efforts.filter((effort) => effort === 'good').length;
    metaParts.push(
      t(language, 'analysis.effortRatio', { good, total: efforts.length }),
    );
  }

  // ── volume trend over comparable sessions ───────────────────────────────
  const comparable = comparableSessions(session, sessions).slice(-MAX_VOLUME_BARS);

  const volumeBars: AnalysisVolumeBar[] = [];
  for (const entry of comparable) {
    const entryVolume = sessionVolumeKg(entry, logs);
    if (entryVolume === null) {
      continue;
    }
    volumeBars.push({
      sessionId: entry.id,
      label: shortDate(entry.performedAt, language),
      volumeKg: Math.round(entryVolume),
      isCurrent: entry.id === session.id,
    });
  }

  const previous = comparable.filter((entry) => entry.id !== session.id).slice(-1)[0] ?? null;
  const previousVolume = previous ? sessionVolumeKg(previous, logs) : null;
  const volumeChangePercent =
    volume !== null && previousVolume !== null && previousVolume > 0
      ? Math.round(((volume - previousVolume) / previousVolume) * 100)
      : null;

  const volumeChange = describeVolumeChange(volumeChangePercent, language);

  // ── key numbers ─────────────────────────────────────────────────────────
  const keyNumbers: AnalysisMetric[] = [];

  if (volume !== null) {
    keyNumbers.push({
      labelKey: 'analysis.key.volume',
      value: `${Math.round(volume)} kg`,
      sub: volumeChange ? volumeChange.text : null,
      grow: 1,
    });
  }

  let heaviest: { log: ExerciseLog; weight: number; reps: number } | null = null;
  for (const log of sessionLogs) {
    const top = topSetOf(log);
    if (top && (!heaviest || top.weight > heaviest.weight)) {
      heaviest = { log, weight: top.weight, reps: top.reps };
    }
  }

  if (heaviest) {
    keyNumbers.push({
      labelKey: 'analysis.key.topSet',
      value: `${removeTrailingZeros(round(heaviest.weight))} kg × ${heaviest.reps}`,
      sub: exerciseNameLabel(language, heaviest.log.exerciseNameSnapshot),
      grow: 1.35,
    });
  }

  if (setCount > 0) {
    keyNumbers.push({
      labelKey: 'analysis.key.sets',
      value: `${setCount}`,
      sub: t(language, 'analysis.key.setsSub', { count: sessionLogs.length }),
      grow: 0.85,
    });
  }

  // ── per-exercise breakdown ──────────────────────────────────────────────
  const currentTime = sessionTime(session);
  const liftsByKey = new Map(
    buildLiftHistories(sessions, logs).map((lift) => [lift.key, lift] as const),
  );

  const exercises: AnalysisExerciseRow[] = [];
  for (const log of sessionLogs) {
    const top = topSetOf(log);
    if (!top) {
      continue;
    }

    const reps = completedReps(log);
    const repLabel = reps.every((count) => count === reps[0]) ? `${reps[0]}` : reps.join('/');
    const detail = `${reps.length} × ${repLabel} · ${removeTrailingZeros(round(log.weight))} kg`;

    // Compare against the most recent earlier session of the same lift.
    const earlier =
      liftsByKey
        .get(normalizedName(log.exerciseNameSnapshot))
        ?.points.filter((point) => point.time < currentTime) ?? [];
    const previousTop = earlier.length > 0 ? earlier[earlier.length - 1].topSetWeightKg : null;
    const delta = previousTop === null ? null : round(top.weight - previousTop);
    exercises.push({
      key: log.id,
      name: exerciseNameLabel(language, log.exerciseNameSnapshot),
      detail,
      // With a single set the detail line already is the top set; repeating it
      // reads as "1 × 5 · 102.5 kg · 102.5 kg × 5".
      topSet: reps.length > 1 ? `${removeTrailingZeros(round(top.weight))} kg × ${top.reps}` : null,
      trend: delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      // Held the same: the marker already says "=", so repeating it as the
      // label printed "= =". The word carries it, like every other unchanged
      // reading on this screen.
      trendLabel:
        delta === null
          ? null
          : delta === 0
            ? t(language, 'analysis.change.flat')
            : `${delta > 0 ? '+' : ''}${removeTrailingZeros(delta)} kg`,
    });
  }

  // ── observations ────────────────────────────────────────────────────────
  const observations: AnalysisObservation[] = [];

  if (volumeChange) {
    observations.push({
      trend: volumeChange.kind,
      body:
        volumeChange.kind === 'flat'
          ? { text: t(language, 'analysis.obs.volumeFlat'), highlights: [] }
          : {
              text: t(language, 'analysis.obs.volume', { change: volumeChange.text }),
              highlights: [volumeChange.text],
            },
    });
  }

  const improved = exercises.filter((row) => row.trend === 'up');
  if (improved.length > 0) {
    const names = improved.slice(0, 2).map((row) => row.name).join(', ');
    observations.push({
      trend: 'up',
      body: { text: t(language, 'analysis.obs.up', { lifts: names }), highlights: [names] },
    });
  }

  const dropped = exercises.filter((row) => row.trend === 'down');
  if (dropped.length > 0) {
    const names = dropped.slice(0, 2).map((row) => row.name).join(', ');
    observations.push({
      trend: 'down',
      body: { text: t(language, 'analysis.obs.down', { lifts: names }), highlights: [names] },
    });
  }

  // ── next session ────────────────────────────────────────────────────────
  const nextActions: AnalysisText[] = [];

  if (heaviest) {
    const liftName = exerciseNameLabel(language, heaviest.log.exerciseNameSnapshot);
    const nextWeight = `${removeTrailingZeros(round(heaviest.weight + 2.5))} kg`;
    nextActions.push({
      text: t(language, 'analysis.next.progress', { lift: liftName, weight: nextWeight }),
      highlights: [nextWeight],
    });
  }

  if (dropped.length > 0) {
    const name = dropped[0].name;
    nextActions.push({
      text: t(language, 'analysis.next.recover', { lift: name }),
      highlights: [name],
    });
  }

  if (volumeBars.length < 2) {
    nextActions.push({ text: t(language, 'analysis.next.logAnother'), highlights: [] });
  }

  // ── verdict ─────────────────────────────────────────────────────────────
  let verdictTagKey: I18nKey = 'analysis.verdict.logged';
  let verdict: AnalysisText | null = null;

  if (volumeChange && volume !== null) {
    if (volumeChange.kind === 'up') {
      verdictTagKey = 'analysis.verdict.progress';
    } else if (volumeChange.kind === 'down') {
      verdictTagKey = 'analysis.verdict.lighter';
    } else {
      verdictTagKey = 'analysis.verdict.steady';
    }
    const volumeText = `${Math.round(volume)} kg`;
    verdict =
      volumeChange.kind === 'flat'
        ? {
            // Not "volume unchanged against the previous session" — the number
            // itself is the reassurance, so the sentence names it.
            text: t(language, 'analysis.verdictBodyFlat', { volume: volumeText }),
            highlights: [volumeText],
          }
        : {
            text: t(language, 'analysis.verdictBody', { change: volumeChange.text }),
            highlights: [volumeChange.text],
          };
  } else if (volume !== null) {
    verdict = {
      text: t(language, 'analysis.verdictFirst', { volume: `${Math.round(volume)} kg` }),
      highlights: [`${Math.round(volume)} kg`],
    };
  }

  return {
    sessionId: session.id,
    eyebrow,
    title: localizedName,
    metaParts,
    verdictTagKey,
    verdict,
    keyNumbers,
    volumeBars,
    volumeChangePercent,
    exercises,
    observations,
    nextActions,
  };
}
