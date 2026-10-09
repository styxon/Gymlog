import { SetupCautionArea, SetupCautionLevel, SetupWeekday, UnitPreference } from './models';
import { FatigueSignal } from '../lib/fatigueModel';
import type { CoachAdviceMemoryLine } from '../lib/coachAdviceMemory';

export interface AICoachLiftHighlight {
  key: string;
  name: string;
  latestWeight: number | null;
  bestWeight: number | null;
  latestReps: string;
}

export interface AICoachActiveSessionSummary {
  title: string;
  nextExercise: string | null;
  meta: string;
}

export interface AICoachRecentCompletedSession {
  sessionId: string;
  title: string;
  performedAt: string;
  /**
   * The local calendar date, YYYY-MM-DD, resolved on the phone. The context is
   * rendered on the endpoint, whose clock is UTC, and a session after midnight
   * in Helsinki is still yesterday there. Absent from older clients.
   */
  day?: string;
  durationMinutes: number | null;
  setsCompleted: number | null;
  swappedExercises: number;
  noteCount: number;
}

export interface AICoachLatestTopSet {
  exerciseName: string;
  weight: number | null;
  reps: string;
  performedAt: string | null;
}

export interface AICoachRhythmDay {
  dayStart: number;
  dayNumber: number;
  weekdayLabel: string;
  active: boolean;
  isToday: boolean;
}

export interface AICoachPlateauSummary {
  exerciseKey: string;
  name: string;
  stagnantSessions: number;
  topWeightKg: number | null;
}

export interface AICoachFatigueSummary {
  acwr: number;
  recoveryScore: number;
  signal: FatigueSignal;
  sessionCount7d: number;
  /** False when there is too little history to read the signal as fact. */
  confident: boolean;
}

export interface AICoachPlannerSetupSummary {
  goal: string | null;
  daysPerWeek: number | null;
  experience: string | null;
  sessionMinutes: number | null;
  equipment: string | null;
  recovery: string | null;
  mustInclude: string[];
  avoid: string[];
  limitations: string[];
}

export interface AICoachHistorySession {
  sessionId: string;
  /** Session name as stored, in English — an identifier, not a label. */
  name: string;
  performedAt: string;
  /**
   * The local calendar date, YYYY-MM-DD, resolved on the phone. The context is
   * rendered on the endpoint, whose clock is UTC, and a session after midnight
   * in Helsinki is still yesterday there. Absent from older clients.
   */
  day?: string;
  durationMinutes: number | null;
  volumeKg: number | null;
  setCount: number;
  exerciseCount: number;
}

/**
 * The newest logged session, set by set — what "my last workout" means.
 *
 * The history block holds one line per session, and the model had to pick the
 * newest out of it: asked to analyse the last workout on 2026-09-27, it
 * analysed the one before (a different day, a third of the volume) in both
 * languages, and in Finnish put the newest one's date on it.
 */
export interface AICoachLastSession {
  /** Local YYYY-MM-DD, resolved on the phone like every other `day`. */
  day: string;
  /** Session name as stored, in English — an identifier, not a label. */
  name: string;
  exercises: AICoachLastSessionExercise[];
  /** True when exercises or sets were dropped to keep the payload small. */
  truncated: boolean;
  /**
   * The newest earlier session of the same name: the only fair comparison.
   * The coach opened with "14 031 kg, a little under 22.9. Day 2" — a
   * different day's volume (2026-09-27). Optional: absent from older apps.
   */
  previousSameName?: { day: string; volumeKg: number | null } | null;
}

export interface AICoachLastSessionSet {
  weightKg: number;
  reps: number;
}

export interface AICoachLastSessionExercise {
  /** As stored, in English. */
  name: string;
  /** Completed sets in the order done; working sets only when there are any. */
  sets: AICoachLastSessionSet[];
  /**
   * The same lift the time before, set by set. Read off three sets of
   * 155 × 6, the model said 155 kg was "the third session in a row" and
   * told the reader to add weight — it was the first (2026-09-27). What
   * happened before is stated, never inferred. Optional for older apps.
   */
  previous?: { day: string; sets: AICoachLastSessionSet[] } | null;
  /** Sessions of this name in a row, this one included, at this top-set weight. */
  sessionsAtThisWeight?: number;
  /**
   * What the set screen will open on next time, set by set — the app's own
   * prescription (workoutState previewNextSession). The coach's example quotes
   * it. Null or absent when the lift is not in a programme the app can start.
   */
  next?: { loadKg: number | null; reps: number[] } | null;
  /**
   * 'minutes' when the sets' reps are minutes of steady work (a bike, a run
   * block) — read as reps, "20 with no added load" was twenty of something.
   * Absent for repetitions, and from an app older than the unit.
   */
  unit?: 'minutes';
}

export interface AICoachHistoryLift {
  name: string;
  sessions: number;
  firstWeightKg: number;
  latestWeightKg: number;
  latestReps: number;
  bestWeightKg: number;
  changeKg: number;
  spanDays: number;
  /** Consecutive most-recent sessions at the current top-set weight. */
  stalledSessions: number;
  /** Top-set weight per logged session, oldest first. */
  weightSeriesKg: number[];
}

export interface AICoachHistoryRepsLift {
  name: string;
  sessions: number;
  spanDays: number;
  /** Reps per set in the first session of the window. */
  firstReps: number[];
  /** Reps per set in the latest session. */
  latestReps: number[];
  /** Most reps in one set per session, oldest first. */
  bestSetRepsSeries: number[];
  /** Consecutive most-recent sessions at the latest best-set reps. */
  unchangedSessions: number;
}

export interface AICoachHistoryWeek {
  /** Monday of the week, local YYYY-MM-DD. */
  weekStart: string;
  sessions: number;
  volumeKg: number;
  /** Null when the plan places the week itself, so nothing was promised. */
  plannedSessions: number | null;
}

export interface AICoachHistorySchedule {
  /** Weekday plans only; empty for a cycle. */
  trainingDays: SetupWeekday[];
  /**
   * A rolling rhythm ("2 on, 1 off") the weekday list cannot express. The
   * coach used to read the questionnaire's availability instead and told a
   * 2-on-1-off reader their schedule was mon-wed-thu (transcript, 2026-08-23).
   */
  cycle?: { onDays: number; offDays: number; length: number } | null;
  /** ISO date of the next day the schedule trains on, from today. */
  nextTrainingDate?: string | null;
  plannedPerWeek: number;
  plannedSessions: number;
  completedSessions: number;
}

/**
 * Enough of the training log for a reader to reconstruct the window: every
 * session with its volume, every lift's trajectory, and week-by-week planned
 * versus actual. Figures only — the wording is the model's job.
 */
export interface AICoachHistory {
  windowDays: number;
  /** Sessions inside the window, before the list below was capped. */
  sessionCount: number;
  totalVolumeKg: number;
  /** Newest last. Capped; check `truncated`. */
  sessions: AICoachHistorySession[];
  /** Most-trained lift first. Capped. */
  lifts: AICoachHistoryLift[];
  /**
   * Lifts logged with no added load, whose progress is reps. Absent from
   * clients older than 2026-09-28, so the endpoint reads it as optional.
   */
  repsLifts?: AICoachHistoryRepsLift[];
  /**
   * The names of lifts logged in the window whose trajectory was left out for
   * size. Without them the coach read a missing row as a lift nobody tracks:
   * "Bench Press doesn't appear in your tracked lift trajectories" to a
   * reader with weeks of bench in the log (emulator, 2026-09-30). Absent from
   * older clients.
   */
  liftsNotShown?: string[];
  weeks: AICoachHistoryWeek[];
  schedule: AICoachHistorySchedule | null;
  /** True when older sessions were dropped to keep the payload small. */
  truncated: boolean;
  /**
   * How much record the reading rests on — counted here, never judged by the
   * model. A model asked to rate its own confidence hedges everything; a
   * number of sessions and a span of days cannot.
   */
  confidence: AICoachHistoryConfidence;
}

export type AICoachHistoryConfidence = 'low' | 'medium' | 'high';

export interface AICoachBodyMeasurementTrend {
  kind: string;
  unit: string;
  latestValue: number;
  latestAt: string;
  previousValue: number | null;
  previousAt: string | null;
}

export interface AICoachBodyChange {
  deltaKg: number;
  spanDays: number;
}

/**
 * What the body record says: latest weight with its short trends, and the
 * latest + previous reading of every measured site. Without this block the
 * coach knows nothing about the body it is coaching — a chest-growth or
 * nutrition question got a training summary (transcript review, 23.8.).
 */
export interface AICoachBody {
  weightKg: number | null;
  weightAt: string | null;
  weightChange30d: AICoachBodyChange | null;
  weightChange90d: AICoachBodyChange | null;
  measurements: AICoachBodyMeasurementTrend[];
}

export interface AICoachGoal {
  text: string;
  kind: string | null;
  targetValue: number | null;
  unit: string | null;
  startValue: number | null;
  currentValue: number | null;
  setAt: string | null;
  /**
   * The one goal the answer is measured against. Exactly one goal carries it
   * whenever there is any goal at all — a list where everything is equally
   * important reads as a list where nothing is.
   */
  isPrimary: boolean;
}

/**
 * What the app already has switched on, so the coach can offer only what is
 * missing. Offering to pin a card that is already on Home is the sign that
 * explains a sign.
 */
export interface AICoachHomeState {
  /** Measurement cards currently on Home. */
  pinnedStatCardKeys: string[];
  /** Whether the morning weigh-in nudge is already switched on. */
  weighInReminderEnabled: boolean;
  /**
   * Offer kinds that must not be proposed at all right now — already taken up,
   * or turned down recently enough that asking again would be nagging.
   */
  silencedSuggestions: string[];
}

export interface AICoachProfile {
  heightCm: number | null;
  /**
   * A year, only for readers whose install predates 2026-09-09. Onboarding
   * asks a band now, so this is null for everyone who set up after it.
   */
  age: number | null;
  /** The band the reader picked. Sent instead of a year, never as well as one. */
  ageRange?: string | null;
  gender: string | null;
}

/**
 * One day of the programme the reader is actually running, exactly as their
 * own plan page lists it.
 *
 * Without this the coach knew a title and nothing else, so "what does my
 * programme contain" was answered "I cannot see your programme's exercises in
 * this data" — true of the payload, and absurd to a reader looking at the
 * exercises on the next screen (user 2026-08-25).
 */
export interface AICoachProgrammeDay {
  name: string;
  /** The weekday the plan puts it on, when the plan fixes one. */
  dayLabel: string | null;
  estimatedMinutes: number | null;
  /** `4 x 8` or `3 x 30 s` — whatever the reader's own row says. */
  exercises: { name: string; scheme: string }[];
}

export interface AICoachProgramme {
  title: string;
  /** Ready-made from the catalog, or one the reader authored. */
  source: 'ready' | 'custom';
  daysPerWeek: number;
  days: AICoachProgrammeDay[];
  /** True when longer days were shortened to keep the payload small. */
  truncated: boolean;
}

/** One cardio session as the coach reads it. */
export interface AICoachCardioSession {
  /** The reader's local day, resolved on the phone. */
  day: string;
  /** The activity id: run, tread-run, tread-walk, cycle-in, cycle-out, row. */
  activity: string;
  minutes: number;
  distanceKm: number | null;
}

/**
 * Cardio in the history window. The session counts above include it (Home
 * counts a run as a session), while every strength block leaves it out — so
 * without this the context said "Last 30 days: 3 sessions" and "No sessions
 * logged" about the same reader, and the model had no way to know the three
 * were runs.
 */
export interface AICoachCardio {
  windowDays: number;
  sessionCount: number;
  totalMinutes: number;
  /** Rolling 7 and 30 days, the same windows as the Load lines. */
  sessionsLast7Days: number;
  sessionsLast30Days: number;
  /** Oldest first, newest kept when capped. */
  sessions: AICoachCardioSession[];
  truncated: boolean;
}

/**
 * A body area the reader flagged in setup, and how firmly: `info` is for the
 * coach to keep in mind, `careful` means the app prefers joint-friendly lifts
 * and never adds weight or reps on lifts that load the area, `avoid` means the
 * plan leaves the area out.
 */
export interface AICoachCautionArea {
  area: SetupCautionArea;
  level: SetupCautionLevel;
}

export interface AICoachTrainingContext {
  unitPreference: UnitPreference;
  activeSession: AICoachActiveSessionSummary | null;
  recentCompletedSessions: AICoachRecentCompletedSession[];
  trackedLifts: AICoachLiftHighlight[];
  latestTopSets: AICoachLatestTopSet[];
  sessionsThisWeek: number;
  sessionsLast30Days: number;
  rhythm: AICoachRhythmDay[];
  readyProgramCount: number;
  recommendedProgramId: string | null;
  recommendedProgramTitle: string | null;
  customProgramTitle: string | null;
  /** The running programme's actual week. Null when no plan is active. */
  programme?: AICoachProgramme | null;
  plateaus: AICoachPlateauSummary[];
  fatigue: AICoachFatigueSummary;
  history: AICoachHistory;
  /** Optional so an older client's payload still parses; null = none logged. */
  lastSession?: AICoachLastSession | null;
  /** Optional so an older client's payload still parses; null = no cardio. */
  cardio?: AICoachCardio | null;
  plannerSetup?: AICoachPlannerSetupSummary | null;
  /**
   * The body areas the reader flagged in setup. Optional: an older client
   * sends none, and so does a reader who flagged nothing.
   */
  cautionAreas?: AICoachCautionArea[];
  /** Optional so an older client's payload still parses. */
  body?: AICoachBody | null;
  goals?: AICoachGoal[];
  profile?: AICoachProfile | null;
  homeState?: AICoachHomeState | null;
  /**
   * What the coach itself said in the last three weeks, oldest first — see
   * lib/coachAdviceMemory. Optional: an older client sends none, and a reader
   * who has never asked a question has none to send.
   */
  coachMemory?: CoachAdviceMemoryLine[];
}

export interface AICoachAdvice {
  takeaway: string;
  why: string[];
  nextSteps: string[];
  plan: string[];
  assumptions: string[];
  /**
   * True when the coach could not answer and asked for a clearer question.
   *
   * The free tier is three questions a week, and one of those used to be spent
   * on "ask one clear question" — including when the user had tapped a chip
   * the app itself offered. An answer that answers nothing does not cost one.
   */
  unanswered?: boolean;
  /**
   * The answer's shape, as the user set it on 2026-09-27 for "analyse my last
   * workout": an observation (the takeaway), what I would do next, a heads-up
   * when something needs one, and one concrete example for next time. Set only
   * for that kind of answer; every other answer keeps its own shape.
   */
  topic?: 'last_session';
  /**
   * "Huomio": a warning, only when a set dropped clearly more than before or
   * something else needs care, with one thing that could fix it ("+30 s
   * rest"). Absent when there is nothing to warn about — the heading is shown
   * only when it has something under it.
   */
  attention?: string;
  /**
   * "Kehitysesimerkki": one concrete line for next time ("Pidä 50 kg ja
   * tavoittele 7/7/7"), its numbers copied from the context's prescription
   * for that lift — never the model's own arithmetic, or the coach and the
   * set screen would prescribe two different things.
   */
  example?: string;
  /**
   * One thing the coach offers to do, drawn as a button by the chat. At most
   * one per answer: a reply that ends in three offers is a menu, not advice.
   */
  suggestion?: AICoachSuggestion | null;
}

export interface AICoachSuggestion {
  kind: 'pin_stat_card' | 'set_goal' | 'weigh_in_reminder' | 'log_measurement' | 'compose_programme';
  /** For pin_stat_card and log_measurement: which measurement. */
  statKey?: string | null;
  /**
   * For compose_programme: the brief, written from the conversation and in the
   * reader's own words. The coach used to gather days, focus and cautions
   * across five turns and then answer "I cannot build a programme" — throwing
   * away exactly what the composer takes (log 2026-08-26). The button hands
   * this over, and the composer opens with the week already built.
   *
   * Quoted back before the tap: the reader is about to spend a programme slot,
   * and an offer they cannot check is not an offer.
   */
  brief?: string | null;
  /**
   * For set_goal: the goal in the reader's own words. The chat parses it with
   * the same reader the typed path uses, and drops the offer when it will not
   * parse — a button that cannot carry out what it says is worse than none.
   */
  goalText?: string | null;
  /**
   * For log_measurement: the value the reader stated, so the button can write
   * it in one tap. "Painan 69,2 kg — pystytkö lisäämään sen?" used to get the
   * answer "I cannot log it for you", from a coach whose reply could have
   * carried the button that does (user, 2026-08-25). Without a value the
   * button opens the recording page instead.
   */
  value?: number | null;
  unit?: 'cm' | 'kg' | '%' | null;
}

/**
 * One earlier exchange in the conversation that is open right now: what was
 * asked, and the takeaway that came back.
 *
 * Without these, "entä sitten?" and "miksi?" arrive with no antecedent and the
 * coach answers a question nobody asked. Nothing is stored — the list dies
 * with the screen, which is why there is no memory across devices or sessions.
 */
export interface AICoachConversationTurn {
  question: string;
  takeaway: string;
}

export interface AICoachAdviceRequest {
  prompt: string;
  /**
   * Permission for the server to keep a copy of this question and its answer.
   *
   * Carried on every request rather than remembered server-side: the answer
   * lives on the reader's phone and can be withdrawn between two questions, so
   * a remembered yes would outlive the yes. Optional, and absent means no —
   * an older client that has never seen the consent sheet sends nothing.
   */
  keepConsent?: boolean;
  /**
   * The random label a kept copy is filed under, so withdrawing can find it
   * again. Sent only when `keepConsent` is true — there is nothing to label
   * when nothing is being written.
   */
  logId?: string;
  context: AICoachTrainingContext;
  /** Oldest first. The server keeps the most recent few and drops the rest. */
  history?: AICoachConversationTurn[];
  /**
   * The language the answer must come back in. The live coach is told to
   * answer in the language the user wrote in; the offline preview has no
   * model to infer that, so it is passed explicitly. Defaults to English when
   * absent, which is what an older client sends.
   */
  language?: 'fi' | 'en';
}

export interface AICoachAdviceSuccess {
  ok: true;
  source: 'live' | 'preview';
  answer: AICoachAdvice;
  note?: string;
  /**
   * The answer is the crisis answer: the server's filter read the question as
   * a crisis. Absent on every other answer, and from a server older than the
   * field — a phone then knows it by the answer's words.
   */
  crisis?: true;
}

export interface AICoachAdviceError {
  ok: false;
  source: 'live' | 'preview';
  error: {
    code: 'BAD_REQUEST' | 'METHOD_NOT_ALLOWED' | 'RATE_LIMIT' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE' | 'MISSING_API_KEY'
    | 'UNAUTHORIZED';
    message: string;
  };
  fallback?: AICoachAdvice;
  note?: string;
}

export type AICoachAdviceResponse = AICoachAdviceSuccess | AICoachAdviceError;
