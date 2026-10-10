// Type-only, and explicitly so: this module now exports runtime predicates, and
// format.ts imports them. Erasing these keeps workoutTypes a leaf at build time
// instead of a node in a cycle through progressionGate and cardio.
import type { SetupCautionArea, SetupCautionFlag, SetupLevel, UnitPreference } from '../../types/models';
import type { FreestyleDraftSnapshot } from '../../lib/emptyWorkoutSession';
import type { ProgressionFatigueSignal } from '../../lib/progressionGate';
import type { ActiveCardioSession } from '../../lib/cardio';
import type { SessionMinutesClock } from '../../lib/minutesExercises';

export type WorkoutGoalType = 'strength' | 'hypertrophy' | 'general';
export type WorkoutLevel = 'beginner' | 'intermediate' | 'advanced';
export type WorkoutSplitType = 'full_body' | 'upper_lower' | 'hybrid';
export type WorkoutProgressionModel = 'double_progression';
export type DefaultScheduleMode = 'rolling_sequence';
export type WorkoutRole = 'primary' | 'secondary' | 'accessory';
export type WorkoutProgressionPriority = 'high' | 'medium' | 'low';
/**
 * `hold` is a timed position: the rep numbers are SECONDS, not repetitions.
 *
 * The catalogs have prescribed holds this way from the start — "Plank 3x30-60",
 * "Legs Up the Wall 1x180-300" — with nothing in the data to say so, so every
 * screen read those numbers as reps and the app asked users for 300 repetitions
 * of lying with their legs up a wall. The mode records what was already true;
 * it does not introduce a new kind of set.
 */
export type WorkoutTrackingMode = 'load_and_reps' | 'reps_first' | 'bodyweight' | 'hold' | 'duration_minutes';

/**
 * `duration_minutes` is steady work done for a time: the rep numbers are
 * MINUTES (user 2026-10-06, "Tuodaan minuuttiyksikkö appiin").
 *
 * Same story as the hold. "Stairmaster (Moderate) 1×20" and "Stationary Bike
 * (Easy Pace) 1×15" were always twenty and fifteen minutes, and the app asked
 * for twenty repetitions of a stair machine, timed them at 3.5 s apiece and
 * offered a "20 reps" record for them. Seconds would have fitted the hold's
 * mode, but nobody dials 1 200 seconds on a bike — so it is its own unit.
 */
export const WORKOUT_TRACKING_MODES: readonly WorkoutTrackingMode[] = [
  'load_and_reps',
  'reps_first',
  'bodyweight',
  'hold',
  'duration_minutes',
];

/**
 * A stored mode, checked: a value this build does not know is null, never
 * passed on. Every reader of a persisted mode goes through here, so a mode
 * added later cannot reach a switch that has no case for it.
 */
/**
 * The slot a custom programme's row runs under. Today's held swaps and drops
 * are keyed by it, so whatever moves them to a copy needs the same spelling.
 */
export function customSlotId(exerciseId: string): string {
  return `custom_slot_${exerciseId}`;
}

export function readStoredTrackingMode(value: unknown): WorkoutTrackingMode | null {
  return WORKOUT_TRACKING_MODES.includes(value as WorkoutTrackingMode) ? (value as WorkoutTrackingMode) : null;
}

/**
 * No external load to log. A hold is bodyweight by definition, so every rule
 * that used to ask `!== 'bodyweight'` before requiring a weight means this —
 * and a bike's minutes carry no load either.
 */
export function isUnloadedTrackingMode(trackingMode: WorkoutTrackingMode) {
  return trackingMode === 'bodyweight' || trackingMode === 'hold' || trackingMode === 'duration_minutes';
}

/** Whether this exercise's rep numbers are seconds. */
export function isTimedTrackingMode(trackingMode: WorkoutTrackingMode) {
  return trackingMode === 'hold';
}

/** Whether this exercise's rep numbers are minutes. */
export function isMinutesTrackingMode(trackingMode: WorkoutTrackingMode | null | undefined) {
  return trackingMode === 'duration_minutes';
}

/** What the rep numbers of a mode count. */
export type PrescriptionUnit = 'reps' | 'seconds' | 'minutes';

export function prescriptionUnitOf(trackingMode: WorkoutTrackingMode): PrescriptionUnit {
  return isMinutesTrackingMode(trackingMode) ? 'minutes' : isTimedTrackingMode(trackingMode) ? 'seconds' : 'reps';
}
export type WorkoutStatus = 'active' | 'paused' | 'completed';
export type WorkoutExerciseStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'swapped';
export type WorkoutSetStatus = 'pending' | 'completed' | 'skipped';
export type WorkoutSetEffort = 'easy' | 'good' | 'hard';
export type RestTimerStatus = 'idle' | 'running' | 'paused';
export type WorkoutInputField = 'load' | 'reps' | 'notes' | null;

export interface WorkoutSubstitutionGroup {
  id: string;
  allowedExerciseNames: string[];
}

export interface WorkoutTemplateExercise {
  id: string;
  persistedExerciseTemplateId?: string | null;
  exerciseName: string;
  slotId: string;
  role: WorkoutRole;
  progressionPriority: WorkoutProgressionPriority;
  trackingMode: WorkoutTrackingMode;
  sets: number;
  /**
   * The programme's own set count, when today's session was lightened and
   * `sets` is one fewer. Which of last time's sets were warm-ups is read
   * against what the programme asks, not against today's lighter dose.
   */
  programmeSets?: number;
  repsMin: number;
  repsMax: number;
  restSecondsMin: number;
  restSecondsMax: number;
  substitutionGroup: string;
  /**
   * Shared by adjacent exercises performed as one superset — A1 straight into
   * A2, rest only after the last of them. Null, or absent, for a lift done on
   * its own, which is every catalog exercise today.
   *
   * Not to be confused with `substitutionGroup`, which says what this lift can
   * be SWAPPED for. This one says what it is performed WITH.
   */
  supersetGroup?: string | null;
  /**
   * The lift the programme prescribes here, when today's session swapped it
   * out before starting (Home's "just today" swap). Carried onto the live
   * exercise as `sourceExerciseName`, so a swap made before the start is saved
   * the same way as one made in the player — as the lift that was done, with
   * the swap on record. Absent on every template the programme itself wrote.
   */
  sourceExerciseName?: string;
  /** With `sourceExerciseName`: the slot as the programme wrote it (ProgrammedDose). */
  programmedDose?: ProgrammedDose;
}

/**
 * The mode and numbers the programme writes for a slot, kept once a swap has
 * converted them into another lift's unit. Picking the programme's lift back
 * restores them; without them it opened on the programmes' median for that
 * lift — Back Squat 3×8 through a plank came back at 7 (final hunt,
 * 2026-10-08).
 */
export interface ProgrammedDose {
  trackingMode: WorkoutTrackingMode;
  repsMin: number;
  repsMax: number;
}

export interface WorkoutTemplateSession {
  id: string;
  name: string;
  orderIndex: number;
  exercises: WorkoutTemplateExercise[];
}

export interface WorkoutProgressionRules {
  primary: string;
  secondary: string;
  accessory: string;
  failureHandling: string;
}

export interface WorkoutTemplateV1 {
  id: string;
  name: string;
  goalType: WorkoutGoalType;
  level: WorkoutLevel;
  splitType: WorkoutSplitType;
  daysPerWeek: number;
  /**
   * Program block length. Optional override — when absent the catalog rule
   * applies: beginner 4 wk, intermediate (UI "Advanced") 8 wk, advanced
   * (UI "Pro") 12 wk. See src/lib/readyProgramDuration.ts.
   */
  blockLengthWeeks?: number;
  estimatedSessionDuration: number;
  progressionModel: WorkoutProgressionModel;
  defaultScheduleMode: DefaultScheduleMode;
  sessions: WorkoutTemplateSession[];
  progressionRules: WorkoutProgressionRules;
}

export interface WorkoutRuntimeTemplate {
  id: string;
  name: string;
  defaultScheduleMode: DefaultScheduleMode;
  sessions: WorkoutTemplateSession[];
}

export interface WorkoutSetInstance {
  setIndex: number;
  plannedLoadKg?: number;
  plannedRepsMin: number;
  plannedRepsMax: number;
  draftLoadText: string;
  draftRepsText: string;
  /**
   * Load this set was carrying before automated progression moved it up (Pro).
   * Undefined when the prefill simply repeats last session — the loggers use it
   * to mark a weight the user did not pick themselves.
   */
  autoProgressedFromKg?: number;
  /**
   * The load would have moved up, and recovery said not today (Pro).
   *
   * The counterpart to autoProgressedFromKg: that one explains a weight the
   * user did not choose, this one explains a weight that did not change when
   * it had been earned. Without it the hold is silent, and a feature nobody
   * can perceive is not one they can knowingly pay for.
   */
  heldForFatigue?: boolean;
  /**
   * The load had earned a jump and a flagged body area held it (Pro).
   *
   * The reader flagged this area careful or avoid in setup, and onboarding
   * told them the app would not raise the weight on lifts that load it. Like
   * heldForFatigue, set only when a jump was actually earned.
   */
  heldForCautionArea?: SetupCautionArea;
  /**
   * The reader added this set mid-session. Its opening weight is copied from
   * the set before it — usually what the reader just lifted — so the saved
   * plan must not present it as the app's suggestion.
   *
   * Also the one record of which sets are past the programme's count, which
   * is what tells last time's warm-ups from its work (lib/warmupSets
   * programmeSetCount) — so a swap keeps it. It used to clear it, and a
   * session with a set added and the lift swapped read last time's warm-up
   * as set 1 (bug hunt W11, 2026-10-05).
   */
  addedMidSession?: boolean;
  /**
   * The programme's own set count for this lift, on every set of a lightened
   * session whose `sets` is one fewer (lib/recoverySheet lightenRuntimeTemplate).
   * What programmeSetCount reads first, so the prefill, a swap and the "Last
   * time" panel all tell last time's warm-ups from its work against the same
   * number. Absent on every ordinary session and on any saved before it.
   */
  programmeSets?: number;
  /**
   * An added set whose opening weight a swap re-resolved from the new lift's
   * own history: the number is the app's now (`borrowed` or `none` in
   * lib/loggedSetPlan), not the reader's carried-over one. Absent: untouched
   * by a swap, or added after it.
   */
  plannedBySwap?: boolean;
  /**
   * When the prefill came from the same lift in a DIFFERENT slot — another
   * program, another day, an empty workout — this is when that session was
   * performed. The guided player shows it, because a weight that did not come
   * from this slot should say where it did come from. (The list logger does
   * not surface it yet.) Undefined for the ordinary case — this slot's own
   * history — and for a blank set.
   */
  prefilledFromPerformedAt?: string;
  /**
   * The reps this set should open at when automated progression moved the
   * target (bodyweight work, where the load gate stays silent). Undefined
   * whenever the template target stands — the dial falls back to
   * plannedRepsMax, which is what it always did.
   */
  plannedTargetReps?: number;
  /**
   * The rep floor the user proved before progression raised it — the reps
   * counterpart to autoProgressedFromKg, and set only alongside
   * plannedTargetReps.
   */
  autoProgressedFromReps?: number;
  /**
   * This set's own rep target when last time climbed in weight (40×10,
   * 50×8, 60×5 → 10, 8, 6): the set's reps, the heaviest one more. It wins
   * over the set before it, which in a ramp was lifted lighter.
   */
  rampTargetReps?: number;
  actualLoadKg?: number;
  actualReps?: number;
  status: WorkoutSetStatus;
  effort?: WorkoutSetEffort | null;
  completedAt?: string;
  edited: boolean;
  skippedReason?: string;
  /**
   * The lift this set was logged as, and how that lift is logged — a swap
   * changes the exercise's mode too. Stamped when the set is logged, cleared
   * when it is taken back. The save reads it to put each set under the lift
   * that did it (lib/liftSegments); `swappedAfterSetIndex` only says where the
   * latest swap was, which cannot tell two earlier lifts apart.
   */
  loggedAs?: WorkoutLiftIdentity;
}

/** A lift as a logged set knows it: its name, and how it is logged. */
export interface WorkoutLiftIdentity {
  exerciseName: string;
  trackingMode: WorkoutTrackingMode;
}

/**
 * A warm-up set the reader logged with "+ Warm-up set" (user, 2026-10-05).
 *
 * Kept apart from `sets`: the working sets are what the programme counts, the
 * guided steps walk, the rest timer follows and progression reads. A warm-up
 * is none of those — it is logged, saved (kind 'warmup') and offered again
 * next time at its own load, and it never progresses.
 */
export interface WorkoutWarmupSet {
  loadKg: number;
  reps: number;
  completedAt: string;
}

export interface WorkoutExerciseInstance {
  /**
   * The highest set index that was already logged when this exercise was
   * swapped. Those sets were performed as a DIFFERENT lift, so nothing may
   * carry forward across this line — the sheet promises "your logged sets stay
   * on the exercise you did them on", and a prefill that reaches back over the
   * swap quietly breaks that promise. Undefined when no swap happened, or when
   * the swap happened before anything was logged.
   */
  swappedAfterSetIndex?: number;
  templateExerciseId: string;
  persistedExerciseTemplateId?: string | null;
  slotId: string;
  templateSlotId: string;
  exerciseName: string;
  role: WorkoutRole;
  progressionPriority: WorkoutProgressionPriority;
  trackingMode: WorkoutTrackingMode;
  restSecondsMin: number;
  restSecondsMax: number;
  substitutionGroup: string;
  /** The superset this lift belongs to in the live session — see WorkoutTemplateExercise. */
  supersetGroup?: string | null;
  orderIndex: number;
  sets: WorkoutSetInstance[];
  /** Warm-ups logged before the working sets, in order. Absent: none. */
  warmups?: WorkoutWarmupSet[];
  status: WorkoutExerciseStatus;
  libraryItemId?: string | null;
  sessionInserted?: boolean;
  sourceExerciseName?: string;
  /**
   * The programme's dose for this slot, recorded at its first swap (or carried
   * from Home's held swap). Absent before any swap, and on sessions from older
   * builds — a swap back then takes the one swap rule.
   */
  programmedDose?: ProgrammedDose;
  notes?: string;
  isExpanded: boolean;
}

export interface WorkoutRestTimerState {
  status: RestTimerStatus;
  exerciseSlotId: string | null;
  setIndex: number | null;
  startedAtMs: number | null;
  endsAtMs: number | null;
  durationSeconds: number;
}

/**
 * What the guided player was showing, in terms that survive the plan being
 * rebuilt. The step list changes shape whenever a lift is skipped or the app
 * updates, and an index into the old list then points at a different step —
 * "Jatka treeniä · Penkkipunnerrus sarja 2" for a session that had never
 * touched the bench. A set is identified by its slot and index, a drill by
 * its phase and name; the resume looks the step up again in whatever list
 * exists now.
 */
export interface GuidedResumeAnchor {
  type: 'splash' | 'ready' | 'drill' | 'position' | 'set' | 'rest' | 'finish';
  phase: 'warmup' | 'work' | 'cooldown' | null;
  slotId?: string;
  setIndex?: number;
  drillName?: string;
  /**
   * A running rest only: the wall-clock time it ends. Without it a reopened
   * rest could only start over at its full length (lib/guidedPlayer
   * guidedRestOpeningMs).
   */
  restEndsAtMs?: number;
  /**
   * A paused rest only: what it had left. The pause has no deadline to keep,
   * and without this the rest reopens at its full length.
   */
  restLeftMs?: number;
}

export interface WorkoutUiState {
  activeSlotId: string | null;
  activeSetIndex: number;
  focusedField: WorkoutInputField;
  noteEditorSlotId: string | null;
  swapSheetSlotId: string | null;
  expandedSlotIds: string[];
  finishSummaryOpen: boolean;
  /**
   * Guided-player resume position (index into the built step list). Kept for
   * sessions persisted before the anchor existed; the anchor wins when both
   * are present.
   */
  guidedStepIndex?: number;
  guidedResumeAnchor?: GuidedResumeAnchor;
}

export interface WorkoutSessionRuntime {
  sessionId: string;
  templateId: string;
  templateSessionId: string | null;
  templateName: string;
  status: WorkoutStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  elapsedSeconds: number;
  /**
   * How long this session has spent paused, in milliseconds.
   *
   * The workout clock used to be plain wall time from `startedAt`, so pausing
   * froze the countdown on screen and the session clock kept running behind it
   * — "eikö tauko tarkoita että tauko treenistä", reported 2026-08-21. Both the
   * clock on screen and the duration written to history subtract this, so there
   * is one answer to how long the workout took.
   *
   * It also holds every stretch of over two hours with nothing done in it:
   * time away comes off the same way a pause does (settleSessionClock).
   */
  pausedMs: number;
  /** When the current pause began, or null while running. */
  pausedAt: string | null;
  /**
   * The pause time that had run by the latest logged set, open pause included.
   *
   * A workout that ends at its last set (left open, reopened days later) must
   * take off only the pauses before that set: `pausedMs` by then also holds
   * the days it sat paused, and subtracting that saved it as one minute.
   * Absent on sessions started before this was kept.
   */
  pausedMsAtLastSet?: number;
  /**
   * The moments of the sets taken back (set/undo), each as it was logged. A session whose save landed
   * and whose clear was lost comes back active and can be finished again, merged with the stored
   * workout (lib/emptyWorkoutSession mergeStoredWorkoutLogs): a stored set this session lacks stays,
   * unless its moment is here, which says the reader took it back. Absent: none taken back.
   */
  takenBackAt?: string[];
  /**
   * The stopwatch of the bout of minutes in progress, with the set it belongs
   * to (lib/minutesExercises SessionMinutesClock). On the session, not the set
   * screen, so a screen mounted again — the app killed mid-ride — picks the
   * clock up where it was. Absent or null: no bout on the clock.
   */
  minutesClock?: SessionMinutesClock | null;
  activePlanMode: DefaultScheduleMode;
  exercises: WorkoutExerciseInstance[];
  restTimer: WorkoutRestTimerState;
  ui: WorkoutUiState;
  sessionOrderIndex: number;
}

export interface WorkoutSlotHistorySet {
  setIndex: number;
  loadKg: number;
  reps: number;
  completedAt: string;
  effort?: WorkoutSetEffort | null;
}

export interface WorkoutSlotHistoryEntry {
  slotId: string;
  templateId: string;
  templateName: string;
  exerciseName: string;
  substitutionGroup: string;
  performedAt: string;
  sessionId: string;
  sets: WorkoutSlotHistorySet[];
  skipped: boolean;
  swappedFrom?: string;
  /**
   * The reps every set was asked for, when the app lowered them below the
   * programme's floor after a short session (lib/progressionGate
   * resolveMissedRepsTarget). Kept so the next session can ask one more.
   * Absent on every ordinary entry and on entries saved before 2026-09-28.
   */
  targetReps?: number;
  /**
   * The warm-ups logged with "+ Warm-up set", in order: what the button offers
   * next time. Never in `sets`, so progression never reads them. Absent on
   * entries with none and on entries saved before 2026-10-05.
   */
  warmups?: { loadKg: number; reps: number }[];
}

export interface WorkoutSessionSummary {
  sessionId: string;
  templateId: string;
  templateSessionId: string | null;
  templateName: string;
  performedAt: string;
  durationMinutes: number;
  setsCompleted: number;
  exercisesCompleted: number;
  exercisesSkipped: number;
  exercisesSwapped: number;
  totalVolumeKg: number;
}

export interface WorkoutHistoryStore {
  sessions: WorkoutSessionSummary[];
  slotHistory: Record<string, WorkoutSlotHistoryEntry[]>;
  lastSelectedTemplateId: string | null;
}

export interface WorkoutPersistenceBundle {
  activeSession: WorkoutSessionRuntime | null;
  history: WorkoutHistoryStore;
  /** Live cardio session (Cardio v1) — same offline persistence as strength. */
  activeCardio?: ActiveCardioSession | null;
  /** A freestyle session in flight — same offline persistence as the guided one. */
  freestyleDraft?: FreestyleDraftSnapshot | null;
}

export interface WorkoutSetDraftInput {
  loadText?: string;
  repsText?: string;
}

export interface WorkoutExerciseInsertInput {
  exerciseName: string;
  role?: WorkoutRole;
  progressionPriority?: WorkoutProgressionPriority;
  trackingMode: WorkoutTrackingMode;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSecondsMin: number;
  restSecondsMax: number;
  substitutionGroup: string;
  libraryItemId?: string | null;
}

export interface WorkoutSwapOption {
  exerciseName: string;
  substitutionGroup: string;
}

/** What the logger needs to decide whether a prefill may move up. */
export interface WorkoutProgressionOptions {
  automatedProgressionEnabled: boolean;
  setupLevel?: SetupLevel | null;
  /**
   * Recovery at the moment the session starts, from the ACWR model.
   *
   * Read once when the session materializes rather than per set: the model
   * looks at 28 days, so it cannot change during a workout, and re-reading it
   * mid-session would only let a load move for a reason the user never sees.
   */
  fatigueSignal?: ProgressionFatigueSignal;
  /** When the session starts; the clock when absent. Tests pin it. */
  nowMs?: number;
  /**
   * The reader's setup flags. A lift that loads a careful or avoid area never
   * has its load raised by the gate.
   */
  cautionFlags?: SetupCautionFlag[];
}

export interface WorkoutSessionMaterializeOptions {
  unitPreference: UnitPreference;
  history: WorkoutHistoryStore;
  sessionOrderIndex: number;
  /**
   * When true, an earned rep-ceiling clears the load for the next session
   * (ADR-004). Off repeats what was logged. Defaults to off so a caller that
   * has not been updated cannot silently start moving a user's weights.
   */
  automatedProgressionEnabled?: boolean;
  /** Drives the beginner/intermediate progression parameters. */
  setupLevel?: SetupLevel | null;
  /** Recovery at session start; holds an earned progression when high. */
  fatigueSignal?: ProgressionFatigueSignal;
  /** When the session is being built; defaults to the clock. Tests pin it. */
  nowMs?: number;
  /** Setup flags; a lift loading a careful or avoid area keeps its load. */
  cautionFlags?: SetupCautionFlag[];
}
