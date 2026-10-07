import {
  AICoachCardioSession,
  AICoachHistoryRepsLift,
  AICoachHistorySession,
  AICoachLastSession,
  AICoachRecentCompletedSession,
  AICoachTrainingContext,
} from '../types/aiCoach';
import { AppLanguage } from '../types/models';
import { renderAiCoachProgramme, singleLine } from './aiCoachProgramme';
import { cautionAreaLoadedBy } from './cautionAreaMatching';
import { CARDIO_ACTIVITIES } from './cardio';
import { exerciseNameLabel } from './exerciseNameLabel';
import { localizeSessionName } from './sessionNameLabel';

/**
 * A session's date as the reader lived it.
 *
 * This runs on the endpoint, where the timezone is UTC, so the local day has to
 * come from the phone (`day`). An older client sends none, and a malformed one
 * is not text to put in front of the model, so both fall back to the UTC date
 * the context always printed.
 */
function sessionDay(entry: { day?: unknown; performedAt: string }) {
  return typeof entry.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.day)
    ? entry.day
    : entry.performedAt.slice(0, 10);
}

function line(label: string, value: string) {
  return `${label}: ${value}`;
}

function section(heading: string, lines: string[]) {
  if (lines.length === 0) return null;
  return [`## ${heading}`, ...lines].join('\n');
}

function kg(value: number) {
  return `${Math.round(value)} kg`;
}

// Two decimals, not one: a 1.25 kg plate step makes 58.75 kg, and one decimal
// turned it into 58.8 — a weight no bar holds, which the coach then quoted as
// the reader's record (eval matrix, 2026-09-28).
function trim(value: number) {
  return `${Math.round(value * 100) / 100}`;
}

/**
 * This week's lifting load against the reader's own last four weeks, said the
 * way a reader would be told it. It is a comparison, not a verdict: a heavy
 * week held steady reads "in line", which is why the line says so.
 */
function loadInWords(
  signal: AICoachTrainingContext['fatigue']['signal'],
  acwr: number,
  sessionCount7d: number,
): string {
  const relative = 'compared with the reader\'s own last four weeks, not a measure of how much is too much';
  if (!(acwr > 0)) {
    // A ratio of 0 is either no lifting this week, or sessions that carried
    // no kilos — pull-ups, push-ups. The second read "undertrained", which
    // says nothing about a week of bodyweight training.
    return sessionCount7d > 0
      ? 'no loaded lifting to compare: this week\'s sessions carried no added kilos'
      : `no lifting this week (${relative})`;
  }
  switch (signal) {
    case 'undertrained':
      return `lifting load well below usual (${relative})`;
    case 'optimal':
      return `lifting load in line with usual (${relative})`;
    case 'elevated':
      return `lifting load above usual (${relative})`;
    case 'high':
      return `lifting load sharply above usual — a spike (${relative})`;
    default:
      return `lifting load not readable (${relative})`;
  }
}

const isRepList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

/**
 * The client's rep trajectories, kept only where every field has the shape
 * the lines below read. Older clients send none, and a payload is the phone's
 * word, not a checked record.
 */
function readRepsLifts(value: unknown): AICoachHistoryRepsLift[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (lift): lift is AICoachHistoryRepsLift =>
      typeof lift === 'object' &&
      lift !== null &&
      typeof lift.name === 'string' &&
      Number.isFinite(lift.spanDays) &&
      Number.isFinite(lift.unchangedSessions) &&
      isRepList(lift.firstReps) &&
      isRepList(lift.latestReps) &&
      isRepList(lift.bestSetRepsSeries),
  );
}

function cardioActivityName(id: string) {
  return CARDIO_ACTIVITIES.find((activity) => activity.id === id)?.name ?? id;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A YYYY-MM-DD day the way the reader's language writes it: "26.9." or
 * "26 Sep". The rules said so and the model still wrote "24.9." in English
 * (2026-09-27); an example it can copy is harder to get wrong than a rule.
 */
function readerDate(day: string, language: AppLanguage) {
  const match = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return day;
  const month = Number(match[1]);
  const date = Number(match[2]);
  return language === 'fi' ? `${date}.${month}.` : `${date} ${MONTHS_EN[month - 1] ?? match[1]}`;
}

function newestCardioSession(sessions: AICoachCardioSession[]) {
  let newest: AICoachCardioSession | null = null;
  for (const entry of sessions) {
    if (!newest || entry.day >= newest.day) newest = entry;
  }
  return newest;
}

function newestHistorySession(sessions: AICoachHistorySession[]) {
  let newest: AICoachHistorySession | null = null;
  for (const entry of sessions) {
    if (!newest || sessionDay(entry) >= sessionDay(newest)) newest = entry;
  }
  return newest;
}

/**
 * The context block exactly as the endpoint sends it, heading included: what
 * its size cap measures, and so what a client measures itself against
 * (fitAiCoachContextToCap). One function, so the two cannot count differently.
 */
export function buildAiCoachContextText(context: AICoachTrainingContext, language: AppLanguage | null = null): string {
  return `# Training context\n\n${buildAiCoachSystemContext(context, language)}`;
}

/**
 * The context as the model reads it. Names are rendered in the reader's
 * language: the context carries the stored English ids, and the model copied
 * them into a Finnish answer ("Overhead Press", "Day 3: Upper Body") where
 * every screen of the app says "Pystypunnerrus" and "Ylävartalo" (2026-09-27).
 * No language (the default) keeps the ids exactly as stored: the programme
 * composer answers in library names the app resolves back to rows, and even
 * English labels rename some ("Triceps Pushdown - Rope Attachment" reads as
 * "Rope Pushdown"). The phone's cap is measured on this form too.
 */
export function buildAiCoachSystemContext(context: AICoachTrainingContext, language: AppLanguage | null = null): string {
  const u = context.unitPreference;
  const blocks: string[] = [];
  // Tolerant: on the endpoint a posted history row may carry no name at all.
  // singleLine here is what keeps every name this resolves to — a custom
  // exercise, a custom session, a custom programme's own day name — to one
  // line wherever it is used below (see singleLine's own comment).
  const liftName = (name: unknown) =>
    typeof name !== 'string' ? '' : singleLine(language ? exerciseNameLabel(language, name) : name);
  const sessionName = (name: unknown) =>
    typeof name !== 'string' ? '' : singleLine(language ? localizeSessionName(name, language) : name);
  // Cardio counts as a session on Home and in the 30-day figure, and nowhere
  // in the strength blocks. With runs on record, every count says which kind
  // it is — unqualified, "3 sessions" beside "No sessions logged" read as a
  // contradiction, and the model had no way to know the three were runs.
  const cardio = context.cardio ?? null;
  const strength = cardio ? 'strength session' : 'session';

  // Load & fatigue — always present, first so LLM sees it immediately
  const { signal, acwr, sessionCount7d, confident } = context.fatigue;
  const weekCount = cardio
    ? `${plural(sessionCount7d, strength)} + ${cardio.sessionsLast7Days} cardio`
    : plural(sessionCount7d, strength);
  blocks.push(
    section('Load', [
      // ACWR off four weeks of data is a ratio, not a reading. Stating the
      // signal as fact is how one logged session becomes "you are overtrained".
      //
      // In words, and without the numbers: the ratio and the recovery score
      // (which is computed from the ratio alone) were quoted back as "ACWR
      // 1,03 on optimaalinen" and "palautuminen 98/100", and six days a week
      // at 95 minutes was called "not too much" on their strength. A rule
      // against quoting them did not hold; a number that is not here cannot
      // be quoted (eval matrix, 2026-09-28).
      line(
        'This week',
        confident
          ? `${weekCount} | ${loadInWords(signal, acwr, sessionCount7d)}${cardio ? ' (lifting load only)' : ''}`
          : `${weekCount} | too little history to read load or recovery — do not comment on fatigue`,
      ),
      line(
        'Last 30 days',
        cardio
          ? `${context.sessionsLast30Days} sessions, ${cardio.sessionsLast30Days} of them cardio`
          : `${context.sessionsLast30Days} sessions`,
      ),
    ])!,
  );

  // Active session
  if (context.activeSession) {
    const next = context.activeSession.nextExercise ? ` → ${singleLine(context.activeSession.nextExercise)} next` : '';
    blocks.push(section('Active session', [`${singleLine(context.activeSession.title)}${next}`])!);
  }

  const lastSession = context.lastSession ?? null;
  const newestSession = newestHistorySession(context.history.sessions);
  const newestCardio = newestCardioSession(context.cardio?.sessions ?? []);
  // An older app, back after a break: no last session, an empty window, and
  // the lifting it did is only in the unwindowed recent rows. The newest of
  // them is the last session — "No lifting logged" above a list of lifts
  // would tell a returning lifter they never lifted (PR review, 2026-09-27).
  const fallbackRecent =
    !lastSession && !newestSession
      ? context.recentCompletedSessions.reduce<AICoachRecentCompletedSession | null>(
          (newest, s) => (!newest || sessionDay(s) > sessionDay(newest) ? s : newest),
          null,
        )
      : null;
  const lastBlock = renderLastSession(
    lastSession,
    newestSession,
    fallbackRecent,
    context.history.sessionCount === 0,
    newestCardio,
    language,
    liftName,
    sessionName,
    // The progression gate's own first hold (progressionGate
    // toProgressionFatigueSignal + evaluateProgression), read off the same
    // fatigue the app sends: a confident "above usual" or higher holds every
    // earned load.
    context.fatigue.confident && (context.fatigue.signal === 'elevated' || context.fatigue.signal === 'high'),
  );
  if (lastBlock) blocks.push(lastBlock);
  // The same session appears again in the history list below. Marked there —
  // one row, the newest that matches — because a session listed twice is one
  // a model can count twice, and two rows marked as it would be the same
  // mistake the other way round.
  const markedSession = lastSession
    ? newestHistorySession(
        context.history.sessions.filter(
          (entry) =>
            sessionDay(entry) === lastSession.day &&
            typeof entry.name === 'string' &&
            entry.name.trim().slice(0, 120) === lastSession.name,
        ),
      )
    : newestSession;
  const isLastSession = (entry: AICoachHistorySession) => entry === markedSession;

  // Recent sessions — only when the history block below is empty, which means
  // the user is returning after a long break. Otherwise this is the same list
  // twice, and a model that sees a session in two places may count it twice.
  if (context.history.sessionCount === 0) {
    // The last session is unwindowed, so after a long break it is the newest
    // of these rows too (PR review, 2026-09-27): marked, like its history row.
    // Newest first here, so the first match is the one.
    const markedRecent = lastSession
      ? context.recentCompletedSessions.find(
          (s) =>
            sessionDay(s) === lastSession.day &&
            typeof s.title === 'string' &&
            s.title.trim().slice(0, 120) === lastSession.name,
        ) ?? null
      : fallbackRecent;
    const recentLines = context.recentCompletedSessions.map((s) => {
      const parts: string[] = [sessionName(s.title)];
      if (s.durationMinutes) parts.push(`${s.durationMinutes} min`);
      if (s.setsCompleted) parts.push(`${s.setsCompleted} sets`);
      parts.push(sessionDay(s));
      if (s === markedRecent) parts.push('the Last session above, not another one');
      return `- ${parts.join(' | ')}`;
    });
    const recentBlock = section('Recent sessions (before this window)', recentLines);
    if (recentBlock) blocks.push(recentBlock);
  }

  // Tracked lifts
  const liftLines = context.trackedLifts.map((lift) => {
    const weight = lift.latestWeight !== null ? `${lift.latestWeight} ${u}` : '—';
    const best = lift.bestWeight !== null ? ` (best: ${lift.bestWeight} ${u})` : '';
    return `- ${liftName(lift.name)}: ${weight} x ${lift.latestReps}${best}`;
  });
  const liftBlock = section('Tracked lifts', liftLines);
  if (liftBlock) blocks.push(liftBlock);

  // Training history — the block a reader can reconstruct the window from.
  const history = context.history;

  const weekLines = history.weeks.map((week) => {
    const done =
      week.plannedSessions === null
        ? `${week.sessions} session${week.sessions === 1 ? '' : 's'}`
        : `${week.sessions}/${week.plannedSessions} planned`;
    // "0 kg" on a week of pull-ups read as a week of nothing.
    // In the reader's date format: "Viikolla 2026-07-20 tehtiin 1/2" was the
    // week label copied into a Finnish answer (eval, 2026-09-28).
    const weekOf = language ? readerDate(week.weekStart, language) : week.weekStart;
    return `- week of ${weekOf}: ${done}${week.volumeKg > 0 ? ` | ${kg(week.volumeKg)}` : ''}`;
  });
  const weekBlock = section(`Weeks (last ${history.windowDays} days)`, weekLines);
  if (weekBlock) blocks.push(weekBlock);

  const sessionLines = history.sessions.map((entry) => {
    const parts: string[] = [sessionDay(entry), sessionName(entry.name)];
    if (entry.durationMinutes) parts.push(`${entry.durationMinutes} min`);
    parts.push(`${entry.setCount} sets across ${entry.exerciseCount} exercises`);
    if (entry.volumeKg !== null) parts.push(kg(entry.volumeKg));
    if (isLastSession(entry)) parts.push('the Last session above, not another one');
    return `- ${parts.join(' | ')}`;
  });
  if (sessionLines.length > 0) {
    const heading = history.truncated
      ? `Sessions (oldest first, ${sessionLines.length} of ${history.sessionCount} shown)`
      : 'Sessions (oldest first)';
    blocks.push(section(heading, sessionLines)!);
  }

  if (cardio && cardio.sessions.length > 0) {
    const cardioLines = cardio.sessions.map((entry) => {
      const parts: string[] = [sessionDay({ day: entry.day, performedAt: '' }), cardioActivityName(entry.activity)];
      parts.push(`${entry.minutes} min`);
      if (entry.distanceKm !== null) parts.push(`${trim(entry.distanceKm)} km`);
      return `- ${parts.join(' | ')}`;
    });
    const shown = cardio.truncated ? `, ${cardioLines.length} shown` : '';
    blocks.push(
      section(
        `Cardio (last ${cardio.windowDays} days: ${plural(cardio.sessionCount, 'session')}, ${cardio.totalMinutes} min; oldest first${shown}) — not part of the strength history or load above`,
        cardioLines,
      )!,
    );
  }

  // A lift that loads an area the reader flagged careful or avoid is held on
  // purpose: the app never adds weight or reps there. Calling its flat line a
  // stall made the coach tell a knees-careful reader "no rep gain for N
  // sessions" about a squat the plan holds (2026-10-02). Same name rule as the
  // progression hold and the plateau card.
  const heldFlags = (context.cautionAreas ?? []).map((row) => ({ area: row.area, level: row.level, refinements: [] }));
  const heldArea = (name: unknown) => (typeof name === 'string' ? cautionAreaLoadedBy(name, heldFlags) : null);

  const trajectoryLines = history.lifts.map((lift) => {
    const series = lift.weightSeriesKg.map(trim).join(' → ');
    // stalledSessions counts from the last rep best at this weight (#bugs
    // 2026-10-01), not from when the weight last changed. Under two it says
    // nothing either way — one session at a weight, or a new best — so the
    // line claims no trend in reps at all.
    const flat =
      lift.stalledSessions >= 2
        ? `no rep gain at ${trim(lift.latestWeightKg)} kg for ${lift.stalledSessions} sessions`
        : `held at ${trim(lift.latestWeightKg)} kg`;
    const moved = `${lift.changeKg > 0 ? '+' : ''}${trim(lift.changeKg)} kg over ${lift.spanDays} day${lift.spanDays === 1 ? '' : 's'}`;
    // A lift can be up over the window and stuck right now. Reporting only the
    // window change hides the stall, which is the part worth acting on.
    const held = heldArea(lift.name);
    const heldText = held
      ? `held at ${trim(lift.latestWeightKg)} kg on purpose for the flagged ${held.replace('_', ' ')} area (the app adds no weight or reps there, so this is not a stall)`
      : null;
    const move = heldText
      ? lift.changeKg === 0
        ? heldText
        : `${moved}, ${heldText}`
      : lift.changeKg === 0
        ? flat
        : lift.stalledSessions >= 3
          ? `${moved}, but ${flat}`
          : moved;
    const best =
      lift.bestWeightKg > lift.latestWeightKg ? `, best ${trim(lift.bestWeightKg)} kg` : '';
    return `- ${liftName(lift.name)}: ${move}${best} | top sets ${series} | latest ${trim(lift.latestWeightKg)} kg x ${lift.latestReps}`;
  });
  // Bodyweight lifts progress in reps. Without these lines the coach saw only
  // "8, 8, 7 — same as the time before" and told a reader whose pull-ups rose
  // from 5 to 8 a set that they had stalled.
  const repsLiftLines = readRepsLifts(history.repsLifts).map((lift) => {
    const series = lift.bestSetRepsSeries.join(' → ');
    // From the first session, not the series' first point: shedding a heavy
    // context keeps only the last eight points, while the span and the first
    // session still describe the whole window.
    const change = Math.max(...lift.latestReps) - Math.max(...lift.firstReps);
    const moved = `best set ${change > 0 ? '+' : ''}${change} reps over ${lift.spanDays} day${lift.spanDays === 1 ? '' : 's'}`;
    const same = `the same ${lift.bestSetRepsSeries[lift.bestSetRepsSeries.length - 1]} reps for ${lift.unchangedSessions} session${lift.unchangedSessions === 1 ? '' : 's'}`;
    // The same hold as the kg lifts above: a flagged area's reps are not added.
    const held = heldArea(lift.name);
    const heldText = held
      ? `held at ${lift.bestSetRepsSeries[lift.bestSetRepsSeries.length - 1]} reps on purpose for the flagged ${held.replace('_', ' ')} area (the app adds no reps there, so this is not a stall)`
      : null;
    const move = heldText
      ? change === 0
        ? heldText
        : `${moved}, ${heldText}`
      : change === 0
        ? same
        : lift.unchangedSessions >= 3
          ? `${moved}, but ${same}`
          : moved;
    return `- ${liftName(lift.name)} (no added load): ${move} | best set per session ${series} | first ${lift.firstReps.join(', ')} | latest ${lift.latestReps.join(', ')}`;
  });
  trajectoryLines.push(...repsLiftLines);
  // Named, so a lift without its row is still one the reader logs: bench
  // press cut by the cap came back as "not in your tracked lifts"
  // (emulator, 2026-09-30).
  const notShown = (history.liftsNotShown ?? []).map((name) => liftName(name));
  if (notShown.length > 0) {
    trajectoryLines.push(
      `- Also logged in this window, trajectory left out for size: ${notShown.join(', ')}. The reader does train these — never say one is not tracked; answer from the sessions above, or say its trajectory is not in view.`,
    );
  }
  const liftHistoryBlock = section('Lift trajectories (top set per session)', trajectoryLines);
  if (liftHistoryBlock) blocks.push(liftHistoryBlock);

  if (history.schedule) {
    const s = history.schedule;
    const planned = s.cycle
      ? `${s.cycle.onDays} days on, ${s.cycle.offDays} off, repeating every ${s.cycle.length} days (~${s.plannedPerWeek}x/week). Not tied to weekdays.`
      : `${s.plannedPerWeek}x/week on ${s.trainingDays.join(', ')}`;
    blocks.push(
      section(
        'Schedule',
        [
          line('Planned', planned),
          s.nextTrainingDate
            ? line(
                'Next training day',
                // An ISO day in the context came back verbatim in an English
                // answer ("2026-09-28 is upper body", 2026-09-27).
                language ? `${s.nextTrainingDate} (write it as ${readerDate(s.nextTrainingDate, language)})` : s.nextTrainingDate,
              )
            : null,
          line('Adherence', `${s.completedSessions} done of ${s.plannedSessions} planned in this window`),
        ].filter((entry): entry is string => entry !== null),
      )!,
    );
  }

  if (history.sessionCount === 0) {
    blocks.push(
      section('Training history', [
        cardio
          ? 'No strength sessions logged in this window (cardio is listed separately). Do not describe lifting trends, volume, or progress.'
          : 'No sessions logged in this window. Do not describe trends, volume, or progress.',
      ])!,
    );
  } else if (history.confidence === 'low') {
    // The live eval caught "progress" and "consistent" written over one
    // logged session. A single data point is a fact, not a direction.
    blocks.push(
      section('Reading note', [
        `Only ${plural(history.sessionCount, strength)} in this window: not a trend. Do not describe progress, consistency, or momentum.`,
      ])!,
    );
  } else if (history.confidence === 'medium') {
    // How sure the record allows the answer to sound. Counted from the log,
    // never asked of the model — a model rating its own confidence hedges
    // everything and the hedge stops carrying information.
    blocks.push(
      section('Reading note', [
        `${plural(history.sessionCount, strength)} in the last ${history.windowDays} days: enough to read a direction, not enough to call it settled. Qualify the reading once, in the sentence it belongs to — not in front of every claim.`,
      ])!,
    );
  } else {
    blocks.push(
      section('Reading note', [
        `${plural(history.sessionCount, strength)} across the last ${history.windowDays} days: a long enough record to state findings plainly. Do not hedge.`,
      ])!,
    );
  }

  // Body record — weight trend and measured sites. Dates stay ISO here; the
  // rules tell the model to rewrite them for the reader's language.
  if (context.body) {
    const b = context.body;
    const bodyLines: string[] = [];
    if (b.weightKg !== null) {
      const parts = [`${trim(b.weightKg)} kg (${b.weightAt})`];
      if (b.weightChange30d) {
        parts.push(`${b.weightChange30d.deltaKg > 0 ? '+' : ''}${trim(b.weightChange30d.deltaKg)} kg over last ${b.weightChange30d.spanDays} days`);
      }
      if (b.weightChange90d && (!b.weightChange30d || b.weightChange90d.spanDays > b.weightChange30d.spanDays)) {
        parts.push(`90d: ${b.weightChange90d.deltaKg > 0 ? '+' : ''}${trim(b.weightChange90d.deltaKg)} kg over ${b.weightChange90d.spanDays} days`);
      }
      bodyLines.push(line('Weight', parts.join(' | ')));
    }
    for (const m of b.measurements) {
      const prev = m.previousValue !== null ? ` | previous ${trim(m.previousValue)} ${m.unit} (${m.previousAt})` : ' | only one reading — not a trend';
      bodyLines.push(line(m.kind, `${trim(m.latestValue)} ${m.unit} (${m.latestAt})${prev}`));
    }
    const bodyBlock = section('Body record', bodyLines);
    if (bodyBlock) blocks.push(bodyBlock);
  }

  const goalLines = (context.goals ?? []).map((goal) => {
    const parts: string[] = [];
    if (goal.startValue !== null) parts.push(`start ${trim(goal.startValue)} ${goal.unit ?? ''}`.trim());
    if (goal.currentValue !== null) parts.push(`now ${trim(goal.currentValue)} ${goal.unit ?? ''}`.trim());
    if (goal.targetValue !== null) parts.push(`target ${trim(goal.targetValue)} ${goal.unit ?? ''}`.trim());
    const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
    const setAt = goal.setAt ? ` (set ${goal.setAt})` : '';
    // The flag has to reach the text or it does not exist: the model reads
    // this rendering, not the object.
    const lead = goal.isPrimary ? '[primary] ' : '';
    return `- ${lead}"${singleLine(goal.text)}"${setAt}${detail}`;
  });
  const goalBlock = section(
    'Goals — stated by the user; tie advice to these. [primary] is the one a general question is answered against',
    goalLines,
  );
  if (goalBlock) blocks.push(goalBlock);

  if (context.homeState) {
    // What is already on, so an offer is only ever made for what is missing.
    const home = context.homeState;
    const homeLines = [
      line(
        'Cards on Home',
        home.pinnedStatCardKeys.length > 0 ? home.pinnedStatCardKeys.join(', ') : 'none',
      ),
      line('Morning weigh-in reminder', home.weighInReminderEnabled ? 'on' : 'off'),
      home.silencedSuggestions.length > 0
        ? line('Do not offer', `${home.silencedSuggestions.join(', ')} — already handled or declined`)
        : null,
    ].filter((entry): entry is string => entry !== null);
    const homeBlock = section('App state — offer only what is missing here', homeLines);
    if (homeBlock) blocks.push(homeBlock);
  }

  if (context.profile) {
    const p = context.profile;
    const profileParts: string[] = [];
    if (p.gender) profileParts.push(p.gender);
    // A year when an older install recorded one, otherwise the band the reader
    // picked, written as a range so the model reads it as one: "31-40 y", never
    // a single number the reader never gave.
    if (p.age !== null && p.age !== undefined) {
      profileParts.push(`${p.age} y`);
    } else if (p.ageRange && p.ageRange !== 'unspecified') {
      profileParts.push(`${p.ageRange.replace('_plus', '+').replace('_', '-')} y`);
    }
    if (p.heightCm !== null) profileParts.push(`${p.heightCm} cm`);
    if (profileParts.length > 0) blocks.push(section('Profile', [profileParts.join(' | ')])!);
  }

  // Plateaus — prominent, with actionable phrasing
  const plateauLines = context.plateaus.filter((p) => !heldArea(p.name)).map((p) => {
    const weight = p.topWeightKg !== null ? `${p.topWeightKg} ${u}` : '—';
    return `- ${liftName(p.name)}: ${p.stagnantSessions} sessions at ${weight} without improvement`;
  });
  const plateauBlock = section('Plateaus detected', plateauLines);
  if (plateauBlock) blocks.push(plateauBlock);

  // Plans
  const planParts: string[] = [];
  if (context.recommendedProgramTitle) planParts.push(`recommended: ${singleLine(context.recommendedProgramTitle)}`);
  if (context.customProgramTitle) planParts.push(`custom: ${singleLine(context.customProgramTitle)}`);
  planParts.push(`${context.readyProgramCount} ready programs available`);
  blocks.push(section('Plans', [planParts.join(' | ')])!);

  // The running programme's actual week. Titles alone made "what does my
  // programme contain" unanswerable and "does it suit my goal" a guess.
  if (context.programme) {
    blocks.push(section('Current programme (the reader can see this on their plan page)', renderAiCoachProgramme(context.programme, liftName, sessionName))!);
  }

  // Planner setup — only if configured
  if (context.plannerSetup) {
    const s = context.plannerSetup;
    const setupParts: string[] = [];
    if (s.goal) setupParts.push(`goal: ${singleLine(s.goal)}`);
    if (s.daysPerWeek) setupParts.push(`${s.daysPerWeek}d/week`);
    if (s.experience) setupParts.push(singleLine(s.experience));
    if (s.equipment) setupParts.push(singleLine(s.equipment));
    if (s.recovery) setupParts.push(`recovery: ${singleLine(s.recovery)}`);

    const setupLines: string[] = [];
    if (setupParts.length > 0) setupLines.push(setupParts.join(' | '));
    if (s.mustInclude.length > 0) setupLines.push(`must include: ${s.mustInclude.map(singleLine).join(', ')}`);
    if (s.avoid.length > 0) setupLines.push(`avoid: ${s.avoid.map(singleLine).join(', ')}`);
    if (s.limitations.length > 0) setupLines.push(`limitations: ${s.limitations.map(singleLine).join(', ')}`);

    const setupBlock = section('Athlete profile', setupLines);
    if (setupBlock) blocks.push(setupBlock);
  }

  // The body areas the reader flagged in setup. Not under the planner block:
  // that one only exists for a setup nothing completes, and this answer is
  // real for everyone who gave it (2026-09-30).
  const cautionAreas = context.cautionAreas ?? [];
  if (cautionAreas.length > 0) {
    const levelWords: Record<string, string> = {
      info: 'info only, keep in mind',
      careful: 'careful: the app prefers joint-friendly lifts and never adds weight or reps on lifts that load it',
      avoid: 'avoid: the plan leaves this area out',
    };
    blocks.push(
      section(
        'Flagged body areas (the reader\'s own setup answer, not a diagnosis)',
        cautionAreas.map((row) => `- ${row.area.replace('_', ' ')}: ${levelWords[row.level] ?? row.level}`),
      )!,
    );
  }

  // What the coach itself said before, so it stops repeating advice the reader
  // has already had — see lib/coachAdviceMemory. Last, and headed the way it
  // is, because the one thing that must not happen is the model reading these
  // as facts about training that is happening now. They are dated on purpose:
  // a cue from three weeks ago may already have been outgrown.
  const memoryLines = (context.coachMemory ?? []).map(
    (entry) => `- ${entry.day}: ${entry.takeaway}`,
  );
  const memoryBlock = section(
    'Advice you have already given this reader (your own past answers, not current facts — do not repeat them, build on them, and say so when you change your mind)',
    memoryLines,
  );
  if (memoryBlock) blocks.push(memoryBlock);

  return blocks.join('\n\n');
}

/**
 * Which way the app's next prescription moves from this session, said beside
 * it. Without it the model saw every rep made, took that as "time to move
 * up", and wrote so above an example that held the weight — the gate had held
 * it for recovery, and nothing in the line said so ("kaikki toistot menivät,
 * joten on aika edetä painossa" over "Tavoittele 155 kg x 6/6/6", store shots
 * 2026-09-30). Null when there is nothing to compare against.
 */
export function nextTimeDirection(
  sets: readonly { weightKg: number; reps: number }[],
  next: { loadKg: number | null; reps: readonly number[] },
  recoveryHold: boolean,
): string | null {
  if (sets.length === 0 || next.reps.length === 0) {
    return null;
  }
  const top = Math.max(...sets.map((entry) => entry.weightKg));
  if (next.loadKg !== null && next.loadKg > top) {
    return top > 0 ? `up from ${trim(top)} kg: moving on` : 'adds load: moving on';
  }
  if (next.loadKg !== null && next.loadKg < top) {
    return `lighter than this session's ${trim(top)} kg`;
  }
  // Same weight: the reps say the rest. Compared set by set, over the sets
  // both have, at this session's top weight.
  const atTop = sets.filter((entry) => entry.weightKg === top).map((entry) => entry.reps);
  const count = Math.min(atTop.length, next.reps.length);
  let up = 0;
  let down = 0;
  for (let index = 0; index < count; index += 1) {
    if (next.reps[index] > atTop[index]) up += 1;
    if (next.reps[index] < atTop[index]) down += 1;
  }
  if (down > 0) {
    return null;
  }
  // Every set asked for more is a step. Only the short sets asked for again
  // (6, 6, 4 → 6, 6, 6) is the same target repeated, not a step up.
  if (up === count && atTop.length >= next.reps.length) {
    return 'more reps at the same weight: moving on';
  }
  if (up > 0 || atTop.length < next.reps.length) {
    return 'the same weight again, to make up the reps or sets that fell short: a repeat, not a step up';
  }
  // A hold with nothing short. The gate's first rule stops every load while a
  // confident reading is above usual; stated as the rule, which holds whatever
  // else the gate saw, rather than as the only reason (progressionGate's
  // heldForFatigue will not claim more than that either).
  return recoveryHold
    ? 'the same as this session: a hold. While this week\'s lifting load is above usual the app adds no weight — say that is why, never that it is time to move up'
    : 'the same as this session: a hold. Say to repeat it — never that it is time to move up';
}

/**
 * What "my last workout" means, set by set, headed so the model cannot take
 * another session for it — see AICoachLastSession. An older app sends no
 * sets; the newest line of the history stands in, so every reader with
 * anything logged gets the block. The reader's date and number format ride
 * along, with the reader's own date as the example; with no language (the
 * composer, an older app) there is no format to state.
 *
 * A run newer than the last lift is named here too: the reader who lifted on
 * Monday and ran on Wednesday means the run, and the block's own "no other"
 * would otherwise forbid it.
 */
function renderLastSession(
  last: AICoachLastSession | null,
  newest: AICoachHistorySession | null,
  recent: AICoachRecentCompletedSession | null,
  recentBeforeWindow: boolean,
  newestCardio: AICoachCardioSession | null,
  language: AppLanguage | null,
  liftName: (name: string) => string,
  sessionName: (name: string) => string,
  recoveryHold: boolean,
) {
  const writes = (day: string) =>
    language === null
      ? null
      : line(
          'Reader writes',
          language === 'fi'
            ? `Finnish — dates like ${readerDate(day, language)}, decimals like 82,5 kg`
            : `English — dates like ${readerDate(day, language)}, decimals like 82.5 kg`,
        );
  const dated = (day: string) => line('Date', language === null ? day : `${day} (write it as ${readerDate(day, language)})`);
  const set = (entry: { weightKg: number; reps: number }) =>
    entry.weightKg > 0 ? `${trim(entry.weightKg)} kg x ${entry.reps}` : `${entry.reps} with no added load`;
  const strengthDay = last ? last.day : newest ? sessionDay(newest) : recent ? sessionDay(recent) : null;
  const cardioLine =
    newestCardio && (strengthDay === null || newestCardio.day > strengthDay)
      ? `- Newer than any lifting: ${cardioActivityName(newestCardio.activity)}, ${newestCardio.day}, ${newestCardio.minutes} min (in the Cardio block). If the reader means that, answer about it instead`
      : null;
  const heading =
    'Last session — what "my last workout" / "viime treeni" means. Answer about this session, under this date, and no other';
  const lines: (string | null)[] = [];
  if (last) {
    // Each lift states its own before-and-after, so nothing about earlier
    // sessions has to be read off this one's sets: three sets of 155 × 6 were
    // taken for "155 kg three sessions in a row" (2026-09-27).
    const exerciseLine = (exercise: AICoachLastSession['exercises'][number]) => {
      // Steady cardio logs minutes in the reps column; it is said in minutes,
      // with no load and no weight streak to read into it.
      if (exercise.unit === 'minutes') {
        const minutes = (entry: { reps: number }) => `${entry.reps} min`;
        const timed = [`${plural(exercise.sets.length, 'bout')} this session: ${exercise.sets.map(minutes).join(', ')} (minutes, not reps)`];
        if (exercise.previous) {
          timed.push(`time before (${exercise.previous.day}): ${exercise.previous.sets.map(minutes).join(', ')}`);
        } else if (exercise.previous === null) {
          timed.push('no earlier log under this name');
        }
        if (exercise.next) {
          timed.push(`next time (the app's own prescription): ${exercise.next.reps.join(', ')} min`);
        }
        return `- ${liftName(exercise.name)} — ${timed.join(' | ')}`;
      }
      const parts = [`${plural(exercise.sets.length, 'set')} this session: ${exercise.sets.map(set).join(', ')}`];
      if (exercise.previous) {
        parts.push(`time before (${exercise.previous.day}): ${exercise.previous.sets.map(set).join(', ')}`);
      } else if (exercise.previous === null) {
        // What the log shows, not a claim about the reader's past: a lift
        // logged before under another row's name is still "no earlier log".
        parts.push('no earlier log under this name');
      }
      const top = Math.max(...exercise.sets.map((entry) => entry.weightKg));
      const streak = exercise.sessionsAtThisWeight;
      // Counted within this session's name — see buildAiCoachLastSession.
      if (typeof streak === 'number' && exercise.previous && top > 0) {
        const previousTop = Math.max(0, ...exercise.previous.sets.map((entry) => entry.weightKg));
        // "The time before" can be another day that trains the lift heavier,
        // while the streak is this day's. Only when it is this same session
        // does a lower weight mean the reader came down.
        const previousIsThisSession = last.previousSameName?.day === exercise.previous.day;
        parts.push(
          streak > 1
            ? `${streak} of this session in a row at ${trim(top)} kg, this one included`
            : // A drop is not a first: after a break "first time at 60 kg" read
              // as a new level when the reader had come down from 70.
              previousIsThisSession && top < previousTop
              ? `lighter than the time before (${trim(previousTop)} kg)`
              : `first time at ${trim(top)} kg in this session`,
        );
      }
      // The app's own next prescription, which the answer's example quotes.
      if (exercise.next) {
        const reps = exercise.next.reps.join(', ');
        const direction = nextTimeDirection(exercise.sets, exercise.next, recoveryHold);
        parts.push(
          (exercise.next.loadKg !== null
            ? `next time (the app's own prescription): ${trim(exercise.next.loadKg)} kg x ${reps}`
            : `next time (the app's own prescription): ${reps} reps`) + (direction ? ` — ${direction}` : ''),
        );
      }
      return `- ${liftName(exercise.name)} — ${parts.join(' | ')}`;
    };
    const before = last.previousSameName;
    lines.push(
      dated(last.day),
      line('Name', sessionName(last.name)),
      before
        ? line(
            'Same session the time before',
            `${before.day}${before.volumeKg !== null ? ` | ${kg(before.volumeKg)}` : ''} — compare with this, not with another day`,
          )
        : null,
      ...last.exercises.map(exerciseLine),
      last.truncated ? '- (some exercises or sets were left out for this payload)' : null,
      cardioLine,
      writes(last.day),
    );
  } else if (newest) {
    const day = sessionDay(newest);
    const volume = newest.volumeKg !== null ? ` | ${kg(newest.volumeKg)}` : '';
    lines.push(
      dated(day),
      line('Name', sessionName(newest.name)),
      line('Logged', `${newest.setCount} sets across ${newest.exerciseCount} exercises${volume}`),
      '- (this app version sends no set-by-set detail)',
      cardioLine,
      writes(day),
    );
  } else if (recent) {
    const day = sessionDay(recent);
    lines.push(
      dated(day),
      line('Name', sessionName(recent.title)),
      recent.setsCompleted ? line('Logged', `${recent.setsCompleted} sets`) : null,
      // Two ways to get here, and only one is "before the window": a context
      // trimmed to fit empties the history rows but keeps their count, and
      // then this session may be yesterday's (PR review, 2026-09-27).
      recentBeforeWindow
        ? '- (before the history window; this app version sends no set-by-set detail)'
        : '- (history rows were left out for this payload; this app version sends no set-by-set detail)',
      cardioLine,
      writes(day),
    );
  } else if (cardioLine) {
    lines.push('- No lifting logged.', cardioLine, writes(newestCardio!.day));
  } else {
    // Nothing logged: only the format, shown on the rules' own example day.
    return section('Reader', [writes(RULES_EXAMPLE_DAY)].filter((entry): entry is string => entry !== null));
  }
  return section(heading, lines.filter((entry): entry is string => entry !== null));
}

/** The day the endpoint's rules use for their own date example ("3.8.", "3 Aug"). */
const RULES_EXAMPLE_DAY = '2026-08-03';
