import type { TourSurface } from '../lib/firstRunTour';
import type { LegalAcceptance } from '../lib/legalAcceptance';
import type { LightNextSession } from '../lib/recoverySheet';
import { CancelSurveyAnswer } from '../lib/cancelSurvey';
import { CoachSuggestionState } from '../lib/coachSuggestions';
import { OwnBlockStats } from '../lib/ownBlockHistory';
import { SeasonEnrolment } from '../lib/seasonEnrolment';
import { StrengthGoal } from '../lib/strengthGoals';
import { SubscriptionTermKey } from '../lib/subscriptionView';
export type UnitPreference = 'kg' | 'lb';
export type AppLanguage = 'en' | 'fi';
export type SignInMethod = 'apple' | 'email' | 'local' | 'google';
export type AccessTier = 'free' | 'premium';
export type SetupGender = 'male' | 'female' | 'unspecified';
export type SetupAgeRange = 'unspecified' | '18' | '19_25' | '26_30' | '31_40' | '41_plus';
export type SetupGoal =
  | 'strength'
  | 'muscle'
  | 'general'
  | 'run_mobility'
  | 'lean_athletic'
  | 'general_fitness';
export type SetupLevel = 'beginner' | 'advanced' | 'pro';
export type SetupDaysPerWeek = 2 | 3 | 4 | 5 | 6;
export type SetupEquipment = 'gym' | 'minimal' | 'home';
export type SetupTrainingEnvironment =
  | 'full_gym'
  | 'home_gym'
  | 'minimal_equipment'
  | 'bodyweight_only'
  | 'running_hybrid';
export type SetupSecondaryOutcome = 'consistency' | 'mobility' | 'conditioning' | 'muscle' | 'strength';
export type SetupFocusArea =
  | 'bodyweight'
  | 'glutes'
  | 'legs'
  | 'quads'
  | 'hamstrings'
  | 'calves'
  | 'chest'
  | 'shoulders'
  | 'back'
  | 'arms'
  | 'core'
  | 'mobility'
  | 'conditioning';
export type SetupCautionArea =
  | 'neck'
  | 'shoulders'
  | 'elbows'
  | 'wrists'
  | 'lower_back'
  | 'hips'
  | 'knees'
  | 'ankles';
export type SetupCautionLevel = 'info' | 'careful' | 'avoid';
export type NotificationLevel = 'quiet' | 'normal' | 'motivating';

export interface NotificationPrefs {
  pushEnabled: boolean;
  level: NotificationLevel;
  personalRecords: boolean;
  weeklySummary: boolean;
  comebackNudge: boolean;
  sessionReminders: boolean;
  /** Local time of day for session reminders, 24h "HH:MM". */
  reminderTime: string;
  /**
   * A morning nudge to step on the scale, offered by the coach when a goal
   * needs weight tracked and it is not on. Off until someone asks for it —
   * this is the one notification a reader opts into by name.
   */
  weighInReminder: boolean;
  /**
   * A weekly nudge to take one tape measurement — "kerran viikossa esim
   * lantion mittaus tai sen mitä itse haluaa" (#bugs 2026-08-29). The kind
   * the reader picks, on the morning they pick, at the weigh-in hour: a tape
   * wants the same conditions a scale does. `null` is off; there is no
   * separate flag, because "on" with nothing to measure is a reminder that
   * cannot say what it is for.
   */
  measurementReminderKind: Exclude<MeasurementKind, 'bodyfat'> | null;
  measurementReminderDay: SetupWeekday;
  /**
   * Rest & alerts (design: Background Timer). Defaults assume a noisy gym —
   * each is defeatable here, none is a marketing push.
   */
  /** The alert ladder when a rest ends: end tone + one repeat 30 s later. */
  restAlerts: boolean;
  /** The haptic-only tick 10 s before a rest ends. */
  restWarning: boolean;
  /** The ongoing lock-screen card while a workout is live. */
  sessionOngoing: boolean;
  /** One nudge after 25 minutes without a logged set. */
  idleNudge: boolean;
  /** The in-app permission sheet has been shown once; asked in context, never twice. */
  restAlertsAsked: boolean;
}

export type TrainingBreakReason = 'injury' | 'holiday' | 'other';

export interface TrainingBreak {
  reason: TrainingBreakReason;
  note: string | null;
  startedAt: string;
}

export interface SetupCautionFlag {
  area: SetupCautionArea;
  level: SetupCautionLevel;
  refinements: string[];
}
export type SetupGuidanceMode = 'done_for_me' | 'guided_editable' | 'self_directed';
export type SetupScheduleMode = 'app_managed' | 'self_managed';
export type SetupWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type TrainingFeelPreference = 'easy' | 'steady' | 'challenging' | 'intense';
export type WorkoutVarietyPreference = 'stable' | 'balanced' | 'varied' | 'fresh';
export type ExerciseModalityPreference = 'avoid' | 'neutral' | 'prefer' | 'love';
export type JointSwapBias = 'shoulders' | 'elbows' | 'knees';
export type JointSwapPreference = 'neutral' | 'prefer' | 'prioritize';
export type WorkoutPlanMode = 'weekday' | 'rotation';
export type ExerciseCategory = 'compound' | 'isolation' | 'cardio' | 'core';
export type ExerciseBodyPart =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'legs'
  | 'biceps'
  | 'triceps'
  | 'core'
  | 'glutes'
  | 'full body';
export type ExerciseEquipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';
export type ExerciseSetKind = 'working' | 'warmup' | 'drop';
export type ExerciseSetOutcome = 'completed' | 'failed' | 'skipped';
export type ExerciseLogSetStatus = 'pending' | 'completed' | 'skipped';
export type ExerciseLogSetEffort = 'easy' | 'good' | 'hard';
export type ExerciseLogStatus = 'active' | 'completed' | 'skipped' | 'swapped';
/**
 * Arms and calves were missing, so the two tape readings a growth trainee
 * takes most often could not be logged at all — and picking "arms" as a focus
 * area could never be answered with a card.
 */
export type MeasurementKind =
  | 'bodyfat'
  | 'shoulders'
  | 'chest'
  /**
   * Across the lats at their widest, arms down.
   *
   * Added 2026-08-31: back was already a focus area onboarding let a reader
   * pick, and nothing downstream could act on it — no measurement, so no card
   * and no suggestion. An answer collected and then silently dropped.
   */
  | 'back'
  | 'arms'
  | 'waist'
  | 'hips'
  | 'thighs'
  | 'calves';
export type MeasurementUnit = 'cm' | 'in' | '%';
export type AiPlannerGoal = 'strength' | 'muscle' | 'fat_loss' | 'fitness';
export type AiPlannerDaysPerWeek = 1 | 2 | 3 | 4;
export type AiPlannerExperience = 'beginner' | 'intermediate' | 'advanced';
export type AiPlannerEquipment = 'full_gym' | 'home_gym' | 'minimal' | 'bodyweight';
export type AiPlannerRecovery = 'low' | 'moderate' | 'high';
export type PostSessionInsightType =
  | 'personal_record'
  | 'plateau_detected'
  | 'session_volume_peak'
  | 'return_after_gap';

export interface WorkoutTemplateSessionRecord {
  id: string;
  name: string;
  orderIndex: number;
  exerciseIds: string[];
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exerciseIds: string[];
  sessions: WorkoutTemplateSessionRecord[];
  createdAt: string;
  updatedAt: string;
  /**
   * How this template came to exist.
   *
   * A freestyle session has to be stored against something, so logging one
   * leaves a template behind — but the user did not author a program, and the
   * free cap counts authoring. See `countAuthoredPrograms`.
   */
  origin: WorkoutTemplateOrigin;
  /**
   * The catalog programme this one was copied from, if any.
   *
   * Identity already lived in the id on the catalog side — a ready programme
   * keeps `tpl_gainer_advanced_glutes_v1` forever and is never written to.
   * What was missing is the link back: nothing recorded "this is MY version of
   * Advanced Glutes", so editing that programme a second time could not find
   * the copy the first edit made and built another one. Three edits, three
   * programmes, and the third arrived named "(kopio 2)" (#bugs 2026-08-26).
   */
  sourceTemplateId?: string | null;
}

export type WorkoutTemplateOrigin = 'authored' | 'freestyle';

export interface ExerciseTemplate {
  id: string;
  workoutTemplateId: string;
  workoutTemplateSessionId: string;
  name: string;
  targetSets: number;
  repMin: number;
  repMax: number;
  /** Seconds between sets. null = not set (the default applies); 0 = no rest, as stretches are written. */
  restSeconds: number | null;
  trackedDefault: boolean;
  orderIndex: number;
  libraryItemId?: string | null;
  /**
   * How the lift is logged, when the writer knew. Onboarding and the ready
   * programmes know it per row; the library only knows names it spells its
   * own way, so a saved push-up became a weight dial. Absent or null = derive
   * it from the library, as before. `normalizeDatabase` validates it on load.
   */
  trackingMode?: 'load_and_reps' | 'reps_first' | 'bodyweight' | 'hold' | 'duration_minutes' | null;
  persistedExerciseTemplateId?: string | null;
  /**
   * Shared by the adjacent exercises done back to back as one superset, and
   * null for a lift done on its own. See src/lib/supersetGrouping.ts for the
   * rule; `normalizeDatabase` applies it on load, because an install written
   * before this field existed knows nothing about it.
   */
  supersetGroup?: string | null;
}

export interface WorkoutTemplateSessionWithExercises extends WorkoutTemplateSessionRecord {
  exercises: ExerciseTemplate[];
}

export interface WorkoutPlanEntry {
  id: string;
  workoutTemplateId: string;
  workoutTemplateSessionId?: string | null;
  label: string;
  orderIndex: number;
}

/**
 * A rhythm that does not fit inside a week, e.g. two days on and one off.
 *
 * `pattern` is read cyclically from `anchorDayStart` (a local midnight):
 * `[true, true, false]` is two on, one off.
 */
export interface TrainingCycle {
  pattern: boolean[];
  anchorDayStart: number;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  mode: WorkoutPlanMode;
  entries: WorkoutPlanEntry[];
  isActive: boolean;
  /**
   * This programme's own rhythm, when the reader set one on it.
   *
   * When set, it OVERRIDES the weekday list everywhere this programme's
   * calendar days are marked as training or rest: the weekday list cannot
   * express a period other than seven, so the two would disagree on most days.
   * Null or missing = the programme's own week.
   *
   * Per programme, not per reader (user 2026-10-07): a single preference made
   * every programme in the app show the reader's own 3-on-1-off rhythm, a
   * six-day ready programme included, and changing it on one changed them all.
   * Missing on every plan written before 2026-10-07; see planTrainingCycle.
   */
  trainingCycle?: TrainingCycle | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseLibraryItem {
  id: string;
  name: string;
  category: ExerciseCategory;
  bodyPart: ExerciseBodyPart;
  equipment: ExerciseEquipment;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  /** Key of the bundled picture (assets/exercises); see src/lib/exerciseImageKey.ts. */
  imageKey?: string;
  sourceCategory?: string | null;
  sourceEquipment?: string | null;
  sourceMechanic?: string | null;
  sourceLevel?: string | null;
}

/**
 * Why the app opened a set at the number it did (lib/loggedSetPlan):
 * - progressed: the gate raised load or reps after an earned session
 * - held_caution / held_recovery: a raise was earned and a flagged body area
 *   or the recovery read held it
 * - borrowed: the same lift's weight from another programme or day
 * - repeat: last time's number in this slot
 * - added: a set the reader added mid-session, opened on the set before it —
 *   the reader's own number, not a suggestion
 * - none: the set opened empty
 */
export type ExerciseLogSetPlanBasis =
  | 'added'
  | 'progressed'
  | 'held_caution'
  | 'held_recovery'
  | 'borrowed'
  | 'repeat'
  | 'none';

/** What the app opened a set at, kept beside what was done. See lib/loggedSetPlan. */
export interface ExerciseLogSetPlan {
  /** The prefilled load; null when the app opened the set without one. */
  loadKg: number | null;
  repsMin: number;
  repsMax: number;
  /** The reps the dial opened at, when the gate or a missed-reps target set them. */
  targetReps: number | null;
  basis: ExerciseLogSetPlanBasis;
  /** For `progressed`: what the load or reps were before the raise. */
  fromKg: number | null;
  fromReps: number | null;
  /** For `held_caution`: the flagged area. */
  cautionArea: SetupCautionArea | null;
}

export interface ExerciseLogSet {
  orderIndex: number;
  weight: number;
  reps: number;
  kind: ExerciseSetKind;
  outcome: ExerciseSetOutcome | null;
  status?: ExerciseLogSetStatus;
  effort?: ExerciseLogSetEffort | null;
  completedAt?: string | null;
  skippedReason?: string | null;
  /**
   * What the app suggested for this set. Absent on sets saved before
   * 2026-09-30 and on sets the app never planned (an empty workout).
   */
  planned?: ExerciseLogSetPlan;
}

/**
 * The reader's one-word verdict on a finished session, asked right after
 * Done (user 2026-08-23: "hei miltä treeni tuntui? Raskas kevyt tms").
 * Absent = never asked or skipped — not "felt fine".
 */
export type SessionFeel = 'easy' | 'right' | 'hard' | 'too_hard';

/**
 * What the app remembers about asking for a store rating.
 *
 * Lives here rather than beside the rules in src/lib/ratingPrompt.ts because
 * it is persisted state: AppPreferences holds it, and storage normalizes it on
 * every load.
 */
export interface RatingPromptState {
  /** ISO timestamp of the last time the sheet was shown, null if never. */
  lastAskedAt: string | null;
  /** How many times the sheet has been shown. */
  askCount: number;
  /** The reader went through to the store. We never ask again. */
  rated: boolean;
}

export interface WorkoutSession {
  id: string;
  workoutTemplateId: string;
  workoutTemplateSessionId?: string | null;
  workoutNameSnapshot: string;
  sessionNotes?: string | null;
  feel?: SessionFeel | null;
  performedAt: string;
  startedAt?: string;
  durationMinutes?: number;
  /**
   * setsCompleted, exercisesCompleted and totalVolumeKg are a reading of this
   * session's logs (lib/sessionTotals), taken at save and again on every
   * load — never trusted as stored.
   */
  setsCompleted?: number;
  exercisesCompleted?: number;
  exercisesSkipped?: number;
  exercisesSwapped?: number;
  totalVolumeKg?: number;
  trackedExercisesUpdated?: number;
  noteCount?: number;
  sessionInsertedCount?: number;
  legacyShapeMismatches?: string[];
}

export interface ExerciseLog {
  id: string;
  sessionId: string;
  exerciseTemplateId: string | null;
  exerciseNameSnapshot: string;
  weight: number;
  repsPerSet: number[];
  sets?: ExerciseLogSet[];
  tracked: boolean;
  orderIndex: number;
  skipped?: boolean;
  sessionInserted?: boolean;
  status?: ExerciseLogStatus;
  slotId?: string | null;
  templateSlotId?: string | null;
  templateExerciseId?: string | null;
  notes?: string | null;
  swappedFrom?: string | null;
  /**
   * What the sets' `reps` count, when it is not repetitions: 'minutes' for a
   * lift logged by time (trackingMode 'duration_minutes' — a bike, a stair
   * machine, a run block). Absent on every other log and on every log saved
   * before 2026-10-06, which were all saved as repetitions and stay that way.
   * Written from the slot's own mode at save, so the record says what was
   * logged rather than leaving a reader to guess from the name.
   */
  repsUnit?: 'minutes';
}

export interface BodyweightEntry {
  id: string;
  recordedAt: string;
  weight: number;
}

export interface MeasurementEntry {
  id: string;
  kind: MeasurementKind;
  recordedAt: string;
  value: number;
  unit: MeasurementUnit;
}

/**
 * A goal the user stated to the coach in their own words ("kasvatan
 * rinnanympärystä"). One goal per kind; setting a new one replaces it.
 * The coach ties its answers to these — a chest question from someone
 * growing their chest is a different question than from someone cutting.
 */
export interface CoachGoal {
  id: string;
  /** The goal in the user's own words. */
  text: string;
  kind: MeasurementKind | 'bodyweight' | null;
  targetValue: number | null;
  unit: 'cm' | 'kg' | '%' | null;
  /** The measurement's value when the goal was set, for progress-since. */
  startValue: number | null;
  createdAt: string;
}

export interface AppPreferences {
  appLanguage: AppLanguage;
  unitPreference: UnitPreference;
  defaultRestSeconds: number;
  autoFocusNextInput: boolean;
  keepScreenAwakeDuringWorkout: boolean;
  /** Workout cue sounds (countdown ticks, set logged, rest over, session done). */
  soundCuesEnabled: boolean;
  /** Vibration feedback for the same moments. */
  hapticsEnabled: boolean;
  /**
   * How long the reader's last own warm-up and recovery took, so the free
   * timer can say "last time you took 4:20". See lib/ownBlockHistory.ts.
   */
  ownBlockStats: OwnBlockStats;
  /**
   * The dark-theme choice, kept exactly as the user set it even when Pro
   * lapses — resolveThemeName decides what actually gets served.
   */
  darkThemeEnabled: boolean;
  /**
   * Whether the anonymous usage events may leave the phone. On by default and
   * disclosed in the privacy policy; off means the analytics client sends
   * nothing and forgets its queue and install id (2026-09-04, the user's
   * decision so the Play Data Safety answer can be "optional").
   */
  usageStatisticsEnabled: boolean;
  /**
   * Whether the store-rating sheet may be shown, and how often it already has.
   *
   * A preference rather than a derived value: "we already asked twice and they
   * said no" is a promise, and a promise that lives only in memory is broken
   * by the next restart. See src/lib/ratingPrompt.ts for the rules.
   */
  ratingPrompt: RatingPromptState;
  /**
   * "Your cards" pins on Home. null = never customized (defaults apply);
   * [] = the user removed every card and that choice sticks.
   */
  homeStatCardKeys: string[] | null;
  /**
   * Notification settings. Stored ahead of the delivery engine — nothing is
   * sent yet; the master defaults to off per product principle.
   */
  notificationPrefs: NotificationPrefs;
  /** Active training break, or null when training normally. */
  trainingBreak: TrainingBreak | null;
  /**
   * The terms and privacy policy the reader ticked, and when. Null until they
   * have; an older version than the app's asks again. See lib/legalAcceptance.
   */
  legalAcceptance: LegalAcceptance | null;
  /**
   * Days the reader took off from the recovery sheet ("Lisää lepopäivä
   * huomiselle"), as local midnights. Every calendar reads them through the
   * schedule (trainingSchedule.withRestDays).
   */
  restDayStarts: number[];
  /** "Kevennä seuraava treeni", asked for and not yet spent. See recoverySheet. */
  lightNextSession: LightNextSession | null;
  /**
   * Permission to KEEP a copy of what the coach was asked, one thing at a time.
   *
   * Not permission to send it — sending is what the online coach is, and the
   * notice above these says so. This is the separate question of whether the
   * server may write the text down afterwards, and the answer is no until the
   * reader says otherwise. Three of them rather than one, because "keep my
   * conversations" and "keep the photos I import" are not the same offer.
   */
  /**
   * A random label the kept copies carry, so they can be deleted again.
   *
   * The uncomfortable part of a delete promise: to remove what is yours, the
   * store has to be able to recognise it as yours. Without an id the log is
   * more anonymous and less withdrawable, and a promise of withdrawal beats a
   * shade of anonymity in a store the reader chose to allow. Minted the first
   * time a line is switched on, never sent to Anthropic, and tied to nothing —
   * not the account, not the phone, not the analytics install id.
   */
  aiLogId: string | null;
  aiLogChatConsent: boolean;
  aiLogComposerConsent: boolean;
  aiLogPhotoConsent: boolean;
  /**
   * Labels whose kept coach copies this install still owes a delete for.
   *
   * Reset clears `aiLogId`, and the label is the only way back to the copies
   * filed under it — so it is moved here first, and stays until the server
   * confirms the delete. Retried when the app starts and when it comes back
   * to the foreground (lib/aiLogDeletion). This phone's errand, not the
   * reader's data: a reset keeps it and a backup neither carries nor
   * restores it (DEVICE_ONLY_PREFERENCE_FIELDS).
   */
  pendingAiLogDeletions: string[];
  /**
   * ISO date until which a promo grant keeps Pro unlocked; null = none.
   *
   * Read-only since 2026-09-15: the in-app redemption is gone (the codes lived
   * in the bundle), so this only ever holds a grant made before that, and it
   * runs out on its own. Play's promo codes will replace it, verified by Play.
   */
  promoProUntil: string | null;
  /**
   * When the Pro trial runs out, separate from a promo code's grant.
   *
   * Both unlock Pro for a stretch of days, but only one of them is a trial:
   * warning "your trial ends soon" to somebody who redeemed a code would name
   * a thing they never started.
   */
  proTrialUntil: string | null;
  /**
   * When the trial was started on this install, or null while it never was.
   *
   * The trial used to be minted afresh on every press of the CTA, so one
   * reader could run fourteen free days forever (security review,
   * 2026-09-14). One per install until Play Billing, which grants one per
   * account; a restore does not carry it, so a new phone gets its own.
   */
  proTrialStartedAt: string | null;
  /**
   * Demo-build only: which term the subscription screen pretends the reader is
   * on, and whether they have pretended to cancel it.
   *
   * Named `mock` on purpose, in the persisted database, where anyone reading a
   * dump can see what they are. There is no billing — these exist so the
   * management screen can be walked end to end before there is a store to walk
   * it against, and they come out with MOCK_BILLING when billing lands.
   */
  mockSubscriptionTerm: SubscriptionTermKey;
  /**
   * When the reader cancelled, or null while it renews. An instant rather
   * than a boolean because a cancelled subscription runs to the end of the
   * period it was cancelled in — from a boolean alone that period keeps
   * rolling forward, which is a subscription renewing itself after it was
   * cancelled.
   */
  mockSubscriptionCancelledAt: string | null;
  /**
   * When Pro was turned on, ISO. The renewal date is COUNTED from this plus the
   * term's length — never written into copy, which is the requirement #bugs
   * locked after the unlock receipt shipped a hardcoded "15.9.2026".
   *
   * The one field real billing has to fill. Everything downstream already reads
   * it through resolveSubscriptionView, so the store replaces this and nothing
   * else changes.
   */
  mockSubscriptionPurchasedAt: string | null;
  /**
   * Why the reader ended their membership, kept on the device. Null when the
   * survey was never answered or was skipped — a skip is not an empty answer.
   */
  cancelSurveyAnswer: CancelSurveyAnswer | null;
  /** Feature-request ids this device has upvoted (local demo board). */
  featureVotedIds: string[];
  /**
   * Pro's coach allowance for the current calendar month. Null = nothing
   * used yet this month. Free has no counter at all: it asks nothing of its
   * own accord, and its three sample answers are tracked by
   * coachDemoMomentsUsed instead. See lib/aiCoachQuota.
   */
  aiCoachProQuota: { monthStart: string; used: number } | null;
  /**
   * When this install first ran, which is what the coach demo moments
   * count their 7 / 30 / 90 days from. Null only until the first load
   * stamps it — an install that predates the field gets stamped then, so
   * its moments start from the upgrade rather than never firing.
   */
  firstLaunchAt: string | null;
  /**
   * Which coach demo moments have been spent. Append-only and never reset:
   * three per install, ever, which is what bounds the free tier cost.
   */
  coachDemoMomentsUsed: string[];
  /**
   * Ids of the server notices this reader has closed (lib/serverNotice), so
   * each is shown once. Newest last, capped.
   */
  seenServerNoticeIds: string[];
  /** Plan-review toggle: Vinha adjusts weekly load/progression automatically. */
  automatedProgressionEnabled: boolean;
  aiSetupCompleted: boolean;
  hasOpenedAppBefore: boolean;
  /**
   * Whether setup's weight has already been written as a weigh-in.
   *
   * Without it the seeding rule is "the log is empty", which is also true the
   * moment the reader deletes their only weigh-in — so the app put it
   * straight back and the delete looked broken (2026-09-16).
   */
  setupWeightSeeded: boolean;
  /**
   * Whether a signed-in account has had its one chance to name the profile.
   *
   * Without it the rule is "the profile has no name", which is also true the
   * moment the reader clears theirs — so the account's name came straight
   * back (2026-09-16). See src/lib/accountNameAdoption.ts.
   */
  accountNameAdopted: boolean;
  /**
   * True once the home-screen widget offer has been answered either way. The
   * offer is shown once; Settings keeps a permanent entry for later.
   */
  homeWidgetPromptDismissed: boolean;
  /** The Home sign-in offer asked once and was declined; it never returns. */
  accountBackupPromptDismissed: boolean;
  /**
   * The reader has seen the online-mode disclosure in the coach chat. The
   * privacy policy promises it before the first question leaves the device.
   */
  aiOnlineNoticeAcknowledged: boolean;
  /**
   * The reader has seen the notice the PHOTO import shows, which is its own
   * because what it discloses is its own: one photo, and expressly nothing
   * else about them.
   *
   * Kept apart from the chat's flag on purpose. The chat sends the recent
   * workouts, the programme, the goals and setup answers, the latest weight
   * and measurements, height, age, gender and the conversation so far — so
   * answering the photo notice must not stand in for a disclosure that covers
   * all of that, which is what a shared flag did (CI review of #146). The
   * chat's own notice is broader, so it satisfies this one; not the reverse.
   */
  aiPhotoNoticeAcknowledged: boolean;
  coachGoals: CoachGoal[];
  /**
   * Which goal is the one the coach answers against right now.
   *
   * Ranking every goal 1..n was considered and dropped: it is a field nobody
   * maintains, and it cannot resolve the conflict that matters anyway — fat
   * loss and chest growth do not settle by weighting, because the calorie
   * answer is either a surplus or a deficit. One goal leads; the rest stay on
   * the list as background. Null falls back to the most recently stated goal.
   */
  primaryGoalId: string | null;
  /**
   * What the coach has already offered and how that went, per suggestion
   * kind. A refusal is an answer rather than a "later": see coachSuggestions.
   */
  coachSuggestionState: CoachSuggestionState;
  /**
   * Whether the hand-off step after onboarding has had its turn. It offers the
   * widget and a tracking card once; a reader who ran onboarding again has
   * already been asked.
   */
  setupHandoffCompleted: boolean;
  /**
   * Which surfaces have run their first-run tour. Home, Progress and Profile
   * each get exactly one first time; Settings can hand them all back.
   * See lib/firstRunTour.ts.
   */
  firstRunToursSeen: TourSurface[];
  entryFlowCompleted: boolean;
  trainingFirstRunDismissed: boolean;
  selectedSignInMethod: SignInMethod | null;
  selectedAccessTier: AccessTier | null;
  profileName: string | null;
  setupCurrentWeightKg: number | null;
  bodyweightGoalKg: number | null;
  onboardingCompleted: boolean;
  setupCompleted: boolean;
  setupGender: SetupGender | null;
  setupAge: number | null;
  setupAgeRange: SetupAgeRange | null;
  setupHeightCm: number | null;
  setupGoal: SetupGoal | null;
  setupGoals: SetupGoal[];
  setupLevel: SetupLevel | null;
  setupDaysPerWeek: SetupDaysPerWeek | null;
  setupEquipment: SetupEquipment | null;
  setupTrainingEnvironment: SetupTrainingEnvironment | null;
  setupEquipmentItems: string[];
  setupSecondaryOutcomes: SetupSecondaryOutcome[];
  setupFocusAreas: SetupFocusArea[];
  setupCautionFlags: SetupCautionFlag[];
  setupGuidanceMode: SetupGuidanceMode | null;
  setupScheduleMode: SetupScheduleMode | null;
  setupWeeklyMinutes: number | null;
  setupAvailableDays: SetupWeekday[];
  /**
   * Where the reader's rhythm used to live, for every programme at once.
   *
   * @deprecated Moved to the plan it belongs to (WorkoutPlan.trainingCycle).
   * Kept only so an old install or an old backup can be read: the load and
   * the restore move it onto the lead programme and write null here
   * (moveTrainingCycleToLeadPlan). Nothing reads it after that.
   */
  trainingCycle: TrainingCycle | null;
  /**
   * Which drill the reader put in which warm-up / cool-down slot.
   *
   * Keyed `${'warmup' | 'cooldown'}:${focus}:${index}` — see
   * routineDrillSlotKey. Empty until they swap one.
   */
  routineDrillOverrides: Record<string, string>;
  /**
   * Programme days the reader named with the pen, by session id, holding the
   * name exactly as it was saved.
   *
   * The display rule rewrites names the app wrote itself — "Workout B" and
   * "Päivä 2" become a positional "Treeni N", "Day 3: Legs" drops its number —
   * and could not tell those from a reader who typed the same words (break
   * round 2026-09-28). A day whose stored name still equals the entry here is
   * shown as typed; once anything else renames it, the entry no longer matches
   * and the usual rule applies again.
   */
  readerSessionNames: Record<string, string>;
  /**
   * Today's session, when the reader has picked one by hand.
   *
   * The rotation decides which session comes next, and it is right nearly
   * always — but "today is legs, not upper" is a fact about the reader's day
   * that no rotation can know. This overrides it for one day only: `dayStart`
   * is a local midnight, and an override for a day that is no longer today is
   * simply ignored rather than needing to be cleared.
   */
  /**
   * The session the reader chose for today, and when they chose it.
   *
   * `pickedAt` is what tells a stale pick from a deliberate repeat: a pick
   * made before the session was finished is answered, a pick made after it
   * means "again" (2026-08-26).
   */
  todaySession: { dayStart: number; sessionId: string; pickedAt: number; workoutTemplateId?: string | null } | null;
  setupTrainingFeel: TrainingFeelPreference;
  setupWorkoutVariety: WorkoutVarietyPreference;
  setupFreeWeightsPreference: ExerciseModalityPreference;
  setupBodyweightPreference: ExerciseModalityPreference;
  setupMachinesPreference: ExerciseModalityPreference;
  setupShoulderFriendlySwaps: JointSwapPreference;
  setupElbowFriendlySwaps: JointSwapPreference;
  setupKneeFriendlySwaps: JointSwapPreference;
  aiPlannerGoal: AiPlannerGoal | null;
  aiPlannerDaysPerWeek: AiPlannerDaysPerWeek | null;
  aiPlannerExperience: AiPlannerExperience | null;
  aiPlannerSessionMinutes: number | null;
  aiPlannerEquipment: AiPlannerEquipment | null;
  aiPlannerRecovery: AiPlannerRecovery | null;
  aiPlannerMustInclude: string;
  aiPlannerAvoid: string;
  aiPlannerLimitations: string;
  aiCoachTemplateId: string | null;
  aiCoachSetupHash: string | null;
  aiCoachPlanGeneratedAt: string | null;
  lastInsightSessionId: string | null;
  lastInsightType: PostSessionInsightType | null;
  recommendedProgramId: string | null;
  /**
   * Lifts the reader has said they know, by library item id.
   *
   * A declaration, not a score: nothing in the app computes it, and nothing
   * takes it away. The Learn collections count it, and that is all it is for.
   */
  learnedExerciseLibraryItemIds: string[];
  /**
   * Which of a lift's technique-check statements the reader has ticked, by
   * library item id → statement index.
   *
   * Kept separate from `learned` on purpose. The check is a self-audit — the
   * statements you cannot tick are the ones to film — and ticking all four is
   * not the same claim as saying you know the lift. Deriving one from the
   * other would put words in the reader's mouth.
   */
  exerciseTechniqueChecks: Record<string, number[]>;
  /**
   * "Bench 100 kg" targets. Empty until the user sets one — the onboarding
   * goal is a category ('strength'), not a number, and a progress bar needs
   * a number.
   */
  strengthGoals: StrengthGoal[];
  /**
   * Seasons the reader has signed up for, one row per season and year.
   *
   * Kept instead of reading "is the season programme my active plan?", which
   * could not tell a pre-registration from a programme swap and un-joined you
   * the moment you trained something else. See lib/seasonEnrolment.
   */
  seasonEnrolments: SeasonEnrolment[];
  dismissedTipIds: string[];
  /**
   * Plans whose completion card the reader has answered. Keyed by plan id, not
   * template id, so restarting the same programme (a new plan round) earns a
   * new card. The card stays until answered — no timer — because completion is
   * the biggest moment the app has, and it must not be missable by opening the
   * app on the wrong day.
   */
  dismissedCompletionPlanIds: string[];
  /**
   * Card suggestions the reader has answered, accepted or put away. Keyed by
   * card key, so an offer declined once never returns.
   */
  dismissedCardSuggestionKeys: string[];
  /**
   * Plateau episodes — one lift, stuck at one weight — the reader has said
   * "selvä" to on Home. Keyed `${liftKey}::${topSetKg}` (lib/proInsights
   * plateauEpisodeKey) so the card returns the moment that weight changes:
   * the plateau resolved, or the same lift stalled again somewhere new.
   * Missing on every install from before this card could be dismissed
   * (#bugs 2026-09-29).
   */
  dismissedPlateauEpisodes: string[];
  /**
   * The programme Home leads with. Kept as the primary while `activePlanIds`
   * carries the full set, so every screen that only ever wanted one still has
   * one to read.
   */
  activePlanId: string | null;
  /**
   * Every programme the reader is running, in the order they took them on.
   *
   * The app held exactly one programme until a season needed to arrive without
   * evicting the reader's own. This is deliberately its own list rather than
   * `workoutPlans.filter(isActive)`: onboarding never deactivated the plan it
   * replaced, so old runs leave `isActive` plans lying in storage, and deriving
   * the set would resurrect them all at once. Migrated from `activePlanId` on
   * load — see normalizeDatabase.
   */
  activePlanIds: string[];
  /**
   * Feature flag for the Programs-tab redesign: when true the second tab lands
   * on ProgramsHomeScreen; when false it keeps the legacy exercise list.
   * Defaults to true (phase 4); flip to false for a data-free rollback.
   */
  programsTabEnabled: boolean;
}

export type CardioActivityType = 'run' | 'tread-run' | 'tread-walk' | 'cycle-in' | 'cycle-out' | 'row';

export type CardioFeel = 'easy' | 'steady' | 'hard' | 'max';

/**
 * A completed cardio session (Cardio v1). Timer-based, no GPS — distance is
 * optional manual entry at finish. Avg pace is always DERIVED
 * (durationSec/distanceKm), never stored.
 */
export interface CardioSession {
  id: string;
  activityType: CardioActivityType;
  startedAt: string;
  /** Completion timestamp — the week/streak counters key off this. */
  performedAt: string;
  durationSec: number;
  distanceKm?: number | null;
  feel?: CardioFeel | null;
}

/**
 * One of the reader's own names for a lift, and what it means.
 *
 * Learned when they correct an unmatched import row — see lib/exerciseNameBook.
 * Theirs rather than the app's, so it lives in the database and travels with
 * their backup.
 */
export interface ExerciseNameBookEntry {
  /** Normalised lookup key (normalizeAlias). */
  alias: string;
  /** The spelling as they typed it, for showing back to them. */
  wrote: string;
  /** The library exercise it resolves to. */
  exerciseName: string;
  libraryItemId: string | null;
  learnedAt: string;
}

export interface AppDatabase {
  workoutTemplates: WorkoutTemplate[];
  exerciseTemplates: ExerciseTemplate[];
  workoutPlans: WorkoutPlan[];
  exerciseLibrary: ExerciseLibraryItem[];
  workoutSessions: WorkoutSession[];
  cardioSessions: CardioSession[];
  exerciseLogs: ExerciseLog[];
  bodyweightEntries: BodyweightEntry[];
  measurementEntries: MeasurementEntry[];
  /** The reader's own exercise vocabulary, learned one correction at a time. */
  exerciseNameBook: ExerciseNameBookEntry[];
  preferences: AppPreferences;
  /**
   * The one-time data migrations already applied to this database, by id.
   * Written by `normalizeDatabase`, which runs each one an install has not
   * had; optional because a database built in memory (a seed, a test) has
   * had none until it is loaded. See lib/trackingCategoryMigration.
   */
  appliedMigrations?: string[];
}

export interface WorkoutTemplateDraft {
  id?: string;
  name: string;
  sessions: WorkoutTemplateSessionDraft[];
  exercises?: ExerciseTemplateDraft[];
  /** Defaults to 'authored'; only freestyle logging passes 'freestyle'. */
  origin?: WorkoutTemplateOrigin;
  /** Set when this draft is a copy of a catalog programme. */
  sourceTemplateId?: string | null;
}

export interface WorkoutTemplateSessionDraft {
  id?: string;
  name: string;
  /**
   * The reader typed this name into the builder's day field. The store ignores
   * it; the caller reads it to remember the name as the reader's own
   * (typedSessionNames).
   */
  nameTyped?: boolean;
  exercises: ExerciseTemplateDraft[];
}

export interface ExerciseTemplateDraft {
  id?: string;
  name: string;
  targetSets: number;
  repMin: number;
  repMax: number;
  restSeconds: number | null;
  trackedDefault: boolean;
  libraryItemId?: string | null;
  /** See ExerciseTemplate.trackingMode. */
  trackingMode?: 'load_and_reps' | 'reps_first' | 'bodyweight' | 'hold' | 'duration_minutes' | null;
  /** Carried through the save so a superset survives an edit to the day. */
  supersetGroup?: string | null;
}

export interface ExerciseLogDraft {
  exerciseTemplateId: string | null;
  exerciseNameSnapshot: string;
  weight?: number;
  repsPerSet?: number[];
  sets: ExerciseLogSet[];
  tracked: boolean;
  orderIndex: number;
  skipped?: boolean;
  sessionInserted?: boolean;
  status?: ExerciseLogStatus;
  slotId?: string | null;
  templateSlotId?: string | null;
  templateExerciseId?: string | null;
  notes?: string | null;
  swappedFrom?: string | null;
  /** See ExerciseLog.repsUnit. */
  repsUnit?: 'minutes';
}
