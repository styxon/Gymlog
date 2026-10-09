import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildRetiredLibraryIdRemap } from '../lib/legacyLibraryIds';
import { withLibraryCorrections } from '../lib/exerciseClassification';
import {
  normalizeAppliedMigrations,
  restoreTrackingAfterCategoryCorrection,
  TRACKING_CATEGORY_MIGRATION_ID,
} from '../lib/trackingCategoryMigration';
import {
  IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID,
  MINUTES_MODE_MIGRATION_ID,
  moveOldCopiesToMinutesMode,
  undoImplausibleMinutesMode,
} from '../lib/minutesModeMigration';
import { HOLD_SECONDS_MIGRATION_ID, moveOldStretchesToHoldSeconds } from '../lib/holdSecondsMigration';
import { normalizeSeasonEnrolments } from '../lib/seasonEnrolment';
import { normalizeStrengthGoals } from '../lib/strengthGoals';
import { normalizeCancelSurveyAnswer } from '../lib/cancelSurvey';
import { isMeasurementKind, measurementUnitForKind } from '../lib/measurementKinds';
import { normalizeMeasurementReminder } from '../lib/measurementReminder';
import { normalizeOwnBlockStats } from '../lib/ownBlockHistory';
import { normalizeFirstRunToursSeen } from '../lib/firstRunTour';
import { normalizeLegalAcceptance } from '../lib/legalAcceptance';
import { normalizeLightNextSession, normalizeRestDayStarts } from '../lib/recoverySheet';
import type { NotificationPrefs } from '../types/models';
import { normalizeDefaultRestSeconds } from '../lib/restPreference';
import { normalizePurchaseRecord } from '../lib/purchaseRecord';
import { DEVICE_ONLY_PREFERENCE_FIELDS, keepDeviceEntitlement } from '../lib/proEntitlement';
import { normalizePendingAiLogDeletions, withPendingAiLogDeletion } from '../lib/aiLogDeletion';
import { isSubscriptionTermKey } from '../lib/subscriptionView';
import { createEmptyDatabase } from '../data/seed';
import { resolveDeviceLanguage } from './deviceLocale';
import { clearCoachAdviceMemory } from './coachAdviceMemoryStore';
import { getLargeItem, MissingPartsError, removeLargeItem, setLargeItem } from './largeItem';
import { removeCorruptCopies, setAsideCorruptCopy } from './corruptCopies';
import { normalizeExerciseLog } from '../lib/exerciseLog';
import { readStoredTrackingMode } from '../features/workout/workoutTypes';
import { withLoggedSessionTotals } from '../lib/sessionTotals';
import {
  normalizeLearnedExerciseIds,
  normalizeTechniqueChecks,
} from '../lib/exerciseLearning';
import { normalizeSupersetGroups } from '../lib/supersetGrouping';
import { savedPrescription } from '../lib/singleRepTarget';
import { reconcileRunningSet } from '../lib/activeProgramSet';
import { reconcileCompletionDismissals } from '../lib/programCompletion';
import { moveTrainingCycleToLeadPlan } from '../lib/planTrainingCycle';
import { buildLegacyTemplateSessions, getLegacyTemplateSessionId } from '../lib/workoutTemplateSessions';
import {
  AppDatabase,
  AppPreferences,
  ExerciseTemplate,
  MeasurementEntry,
  RatingPromptState,
  SetupCautionFlag,
  WorkoutTemplate,
  WorkoutTemplateSessionRecord,
} from '../types/models';
import { normalizeSeenNoticeIds } from '../lib/serverNotice';

const CAUTION_AREAS = ['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'hips', 'knees', 'ankles'] as const;
const CAUTION_LEVELS = ['info', 'careful', 'avoid'] as const;

function normalizeSetupCautionFlags(value: unknown, fallback: SetupCautionFlag[]): SetupCautionFlag[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const flags: SetupCautionFlag[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const area = (entry as { area?: unknown }).area;
    const level = (entry as { level?: unknown }).level;
    if (!CAUTION_AREAS.includes(area as (typeof CAUTION_AREAS)[number])) {
      continue;
    }
    if (!CAUTION_LEVELS.includes(level as (typeof CAUTION_LEVELS)[number])) {
      continue;
    }
    if (flags.some((flag) => flag.area === area)) {
      continue;
    }
    const refinements = (entry as { refinements?: unknown }).refinements;
    flags.push({
      area: area as SetupCautionFlag['area'],
      level: level as SetupCautionFlag['level'],
      refinements: Array.isArray(refinements)
        ? refinements
            .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 6)
        : [],
    });
  }

  return flags.slice(0, CAUTION_AREAS.length);
}

const STORAGE_KEY = '@vinha/database/v1';
/**
 * The key this app used before the rename. Read once, on a first load that
 * finds nothing under the new one, and then written forward.
 *
 * Nobody has shipped, so in principle this is dead code. It is here because
 * the cost of being wrong about that is every workout somebody ever logged,
 * and the cost of being right is four lines.
 */
const LEGACY_STORAGE_KEY = '@gymlog/database/v1';
/**
 * Where an unreadable database is put before an empty one takes its place.
 *
 * Overwriting is not optional — the app cannot open without a database — but
 * throwing the old bytes away is. Whatever could not be parsed is still every
 * workout that person logged, and a support mail can only ever be answered from
 * the copy. One slot: a second corruption after the first is not a longer
 * history to recover, and an unbounded pile of them is a storage leak.
 */
const CORRUPT_STORAGE_KEY = '@vinha/database/corrupt';
/**
 * Preferences, on their own key.
 *
 * Everything used to live in one blob, so changing the theme or the language —
 * one field — serialized every logged session, set and measurement the reader
 * owned, on the JS thread, before the toggle could settle. The cost grew with
 * the training history, which is why the app felt fine at first and slow later.
 *
 * The blob still carries a copy: a full save writes the whole database and the
 * preferences it holds are current, so nothing there goes stale. This key is
 * simply the newer one, and the load overlays it on top.
 */
const PREFERENCES_STORAGE_KEY = '@vinha/preferences/v1';

function normalizeJointSwapPreference(rawValue: unknown, fallbackValue: 'neutral' | 'prefer' | 'prioritize') {
  if (rawValue === 'neutral' || rawValue === 'prefer' || rawValue === 'prioritize') {
    return rawValue;
  }

  if (rawValue === true) {
    return 'prefer';
  }

  if (rawValue === false) {
    return 'neutral';
  }

  return fallbackValue;
}

/**
 * The reader's set of running programmes, migrated forward.
 *
 * Databases written before programmes became a set have no `activePlanIds` at
 * all — only the single `activePlanId`. Seeding the list from it means an
 * existing reader opens the new build already running exactly the programme
 * they were running before, with one slot of the cap used rather than zero.
 */
function normalizeActivePlanIds(rawValue: unknown, legacyActivePlanId: unknown): string[] {
  if (Array.isArray(rawValue)) {
    const ids = rawValue.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
    // Stored duplicates would silently eat a cap slot.
    return Array.from(new Set(ids));
  }

  return typeof legacyActivePlanId === 'string' && legacyActivePlanId.length > 0 ? [legacyActivePlanId] : [];
}

/**
 * The least a stored list entry has to be to be anything: an object with the
 * id everything else hangs from. Each list decides what else it needs.
 */
function hasStoredId(value: unknown): value is Record<string, unknown> & { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.trim().length > 0
  );
}

function normalizeTemplateSessions(
  template: any,
  templateExercises: ExerciseTemplate[],
): WorkoutTemplateSessionRecord[] {
  const rawSessions = Array.isArray(template?.sessions) ? template.sessions : [];
  const fallbackSessions = buildLegacyTemplateSessions(
    { id: String(template?.id ?? ''), name: String(template?.name ?? 'Workout') },
    templateExercises,
  );

  const sessions = rawSessions.length ? rawSessions : fallbackSessions;

  return sessions
    .map((session: any, index: number) => ({
      id: typeof session?.id === 'string' && session.id.trim().length ? session.id : `${template.id}_session_${index + 1}`,
      name: typeof session?.name === 'string' && session.name.trim().length ? session.name.trim() : index === 0 ? String(template?.name ?? 'Workout') : `Session ${index + 1}`,
      orderIndex: typeof session?.orderIndex === 'number' ? session.orderIndex : index,
      exerciseIds: Array.isArray(session?.exerciseIds)
        ? session.exerciseIds.filter((value: unknown): value is string => typeof value === 'string')
        : [],
    }))
    .sort((left: WorkoutTemplateSessionRecord, right: WorkoutTemplateSessionRecord) => left.orderIndex - right.orderIndex);
}

/**
 * The seeded library, with any stored row laid over it — and the source
 * corrections read in again afterwards. A blob written before the library was
 * stripped on save (April 2026) still carries whole rows, and the overlay put
 * their stored `category: 'compound'` back over the corrected leg extension.
 *
 * Those whole rows also carry `imageUrls`, the CDN addresses the pictures
 * were fetched from until 2026-10-09. The pictures are bundled now, keyed by
 * the seed's `imageKey`; the old field is dropped so it can never be read as
 * somewhere to fetch from.
 */
function mergeExerciseLibrary(
  inputLibrary: AppDatabase['exerciseLibrary'] | null | undefined,
  fallbackLibrary: AppDatabase['exerciseLibrary'],
) {
  const merged = new Map<string, AppDatabase['exerciseLibrary'][number]>();

  fallbackLibrary.forEach((item) => {
    merged.set(item.id, item);
  });

  if (Array.isArray(inputLibrary)) {
    inputLibrary.forEach((item) => {
      if (!item || typeof item.id !== 'string' || !item.id.trim().length) {
        return;
      }

      const { imageUrls: _retiredImageUrls, ...stored } = item as typeof item & { imageUrls?: unknown };
      merged.set(item.id, {
        ...merged.get(item.id),
        ...stored,
      });
    });
  }

  return withLibraryCorrections(Array.from(merged.values()));
}

/**
 * The reader's hand-picked session for one day.
 *
 * No fallback: this is deliberately not carried forward from defaults. It
 * describes one calendar day, and a value that cannot be read is a value that
 * has no day — so it becomes "no override" and the rotation answers, which is
 * what it does on every other day anyway.
 */
function normalizeTodaySession(
  value: unknown,
): { dayStart: number; sessionId: string; pickedAt: number; workoutTemplateId: string | null } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = value as { dayStart?: unknown; sessionId?: unknown; pickedAt?: unknown; workoutTemplateId?: unknown };
  if (typeof raw.dayStart !== 'number' || !Number.isFinite(raw.dayStart) || typeof raw.sessionId !== 'string') {
    return null;
  }
  return raw.sessionId
    ? {
        dayStart: raw.dayStart,
        sessionId: raw.sessionId,
        // A pick stored before the programme was recorded has none: it applies
        // to whichever programme leads, as it always did.
        workoutTemplateId:
          typeof raw.workoutTemplateId === 'string' && raw.workoutTemplateId ? raw.workoutTemplateId : null,
        // A pick stored before pickedAt existed is treated as made at the
        // start of its day: any completion that day is then later than the
        // pick, which is exactly how those picks already behaved.
        pickedAt:
          typeof raw.pickedAt === 'number' && Number.isFinite(raw.pickedAt) ? raw.pickedAt : raw.dayStart,
      }
    : null;
}

/**
 * A stored training cycle, or the fallback when the stored value cannot be one.
 *
 * A cycle with no training day in it would stop the app dead — every day a rest
 * day, forever — so an all-false pattern is read as "no cycle" rather than
 * honoured. The length cap is a sanity bound, not a product rule: nothing can
 * write a 400-day rhythm through the editor, but a corrupt file could.
 */
/**
 * A corrupt or absent rating record must never read as "already asked three
 * times" (the sheet would be silently dead forever) nor as "already rated".
 * Anything unreadable falls back to the fresh state, which is the only value
 * that cannot cost the reader something they did not choose.
 */
function normalizeRatingPrompt(value: unknown): RatingPromptState {
  const fresh: RatingPromptState = { lastAskedAt: null, askCount: 0, rated: false };
  if (typeof value !== 'object' || value === null) {
    return fresh;
  }
  const raw = value as { lastAskedAt?: unknown; askCount?: unknown; rated?: unknown };
  const askCount =
    typeof raw.askCount === 'number' && Number.isFinite(raw.askCount) && raw.askCount >= 0
      ? Math.floor(raw.askCount)
      : 0;
  return {
    lastAskedAt: typeof raw.lastAskedAt === 'string' && raw.lastAskedAt.length > 0 ? raw.lastAskedAt : null,
    askCount,
    rated: raw.rated === true,
  };
}

function normalizeTrainingCycle(
  value: unknown,
  fallbackValue: { pattern: boolean[]; anchorDayStart: number } | null,
): { pattern: boolean[]; anchorDayStart: number } | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || value === undefined) {
    return fallbackValue;
  }
  const raw = value as { pattern?: unknown; anchorDayStart?: unknown };
  if (!Array.isArray(raw.pattern) || typeof raw.anchorDayStart !== 'number' || !Number.isFinite(raw.anchorDayStart)) {
    return fallbackValue;
  }
  const pattern = raw.pattern.slice(0, 60).map((day) => day === true);
  if (!pattern.some(Boolean)) {
    return null;
  }
  return { pattern, anchorDayStart: raw.anchorDayStart };
}

/**
 * The weekly measurement reminder's two fields, through the one rule that
 * Node can test (src/lib/measurementReminder.ts). Spread into the prefs
 * literal so the field names are written exactly once.
 */
function measurementReminderPrefs(
  stored: unknown,
  fallback: Pick<NotificationPrefs, 'measurementReminderKind' | 'measurementReminderDay'>,
): Pick<NotificationPrefs, 'measurementReminderKind' | 'measurementReminderDay'> {
  const raw = stored as { measurementReminderKind?: unknown; measurementReminderDay?: unknown } | null | undefined;
  const value = normalizeMeasurementReminder(raw?.measurementReminderKind, raw?.measurementReminderDay, {
    kind: fallback.measurementReminderKind,
    day: fallback.measurementReminderDay,
  });
  return { measurementReminderKind: value.kind, measurementReminderDay: value.day };
}

function boolOr(value: unknown, fallbackValue: boolean): boolean {
  return typeof value === 'boolean' ? value : fallbackValue;
}

/**
 * A stored map of strings, kept only where both halves are non-empty strings:
 * the drill choices and the reader's own day names.
 *
 * The drill values are i18n keys for drills this build may no longer ship;
 * that is resolved where the block is built (homeSessionHero falls back to the
 * slot's default), so the loader's job here is only to guarantee the SHAPE.
 */
function normalizeStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.length > 0 && typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeDatabase(input: Partial<AppDatabase> | null | undefined): AppDatabase {
  // Defaults for missing fields only. The empty database is the right source:
  // the demo seed's fabricated plan id would otherwise become the fallback for
  // a stored database that had no activePlanId of its own.
  const fallback = createEmptyDatabase();
  /**
   * The twenty hand-written `lib_*` rows stopped shipping on 2026-09-01. An
   * install old enough to have logged against one keeps the link by having the
   * id read as the row it was always a copy of — see lib/legacyLibraryIds.
   */
  const retiredIds = buildRetiredLibraryIdRemap(fallback.exerciseLibrary);
  const liveLibraryItemId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }
    return retiredIds[value.trim()] ?? value;
  };

  const exerciseLibrary = mergeExerciseLibrary(input?.exerciseLibrary, fallback.exerciseLibrary);
  const storedMigrations = normalizeAppliedMigrations(input?.appliedMigrations);

  const storedExerciseTemplates: ExerciseTemplate[] = Array.isArray(input?.exerciseTemplates)
    ? input.exerciseTemplates.map((exercise: any) => {
        const name = typeof exercise?.name === 'string' ? exercise.name : 'Exercise';
        // Programmes saved before 2026-08-25 still carry rep ranges; the
        // catalogs collapsed theirs that day, and stored programmes follow
        // the same rule on load (holds excepted — their numbers are seconds),
        // as does an interval's rest. The writer in AppProvider applies the
        // same function, so this only ever changes rows saved before it did.
        const prescription = savedPrescription({
          name,
          repMin: typeof exercise?.repMin === 'number' ? exercise.repMin : 6,
          repMax: typeof exercise?.repMax === 'number' ? exercise.repMax : 8,
          restSeconds: typeof exercise?.restSeconds === 'number' ? exercise.restSeconds : null,
          trackingMode: readStoredTrackingMode(exercise?.trackingMode),
        });
        return {
          id: String(exercise?.id ?? ''),
          workoutTemplateId: String(exercise?.workoutTemplateId ?? ''),
          workoutTemplateSessionId:
            typeof exercise?.workoutTemplateSessionId === 'string' ? exercise.workoutTemplateSessionId : '',
          name,
          targetSets: typeof exercise?.targetSets === 'number' ? exercise.targetSets : 3,
          repMin: prescription.repMin,
          repMax: prescription.repMax,
          restSeconds: prescription.restSeconds,
          trackedDefault: typeof exercise?.trackedDefault === 'boolean' ? exercise.trackedDefault : true,
          orderIndex: typeof exercise?.orderIndex === 'number' ? exercise.orderIndex : 0,
          libraryItemId: liveLibraryItemId(exercise?.libraryItemId),
          // A mode this build does not know (one written by a newer build, or
          // a damaged row) is no mode: null derives it from the name, as an
          // install that never stored one does.
          trackingMode: readStoredTrackingMode(exercise?.trackingMode),
          persistedExerciseTemplateId:
            typeof exercise?.persistedExerciseTemplateId === 'string' || exercise?.persistedExerciseTemplateId === null
              ? exercise.persistedExerciseTemplateId
              : undefined,
          supersetGroup:
            typeof exercise?.supersetGroup === 'string' && exercise.supersetGroup.trim().length
              ? exercise.supersetGroup.trim()
              : null,
        };
      })
    : [];

  // Once per database each, in this order: a programme saved before the
  // library's category correction keeps the progression it had
  // (lib/trackingCategoryMigration), and a copy made before steady cardio was
  // logged in minutes gets the minutes mode the ready programme runs on
  // (lib/minutesModeMigration). Not on every load — a value a writer stores
  // today on purpose is meant.
  let rawExerciseTemplates = storedExerciseTemplates;
  const appliedMigrations = [...storedMigrations];
  if (!appliedMigrations.includes(TRACKING_CATEGORY_MIGRATION_ID)) {
    rawExerciseTemplates = restoreTrackingAfterCategoryCorrection(rawExerciseTemplates, exerciseLibrary);
    appliedMigrations.push(TRACKING_CATEGORY_MIGRATION_ID);
  }
  if (!appliedMigrations.includes(MINUTES_MODE_MIGRATION_ID)) {
    rawExerciseTemplates = moveOldCopiesToMinutesMode(rawExerciseTemplates);
    appliedMigrations.push(MINUTES_MODE_MIGRATION_ID);
  }
  // A row the first minutes run moved by name alone, whose numbers are no
  // bout of minutes (lib/minutesModeMigration undoImplausibleMinutesMode).
  if (!appliedMigrations.includes(IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID)) {
    rawExerciseTemplates = undoImplausibleMinutesMode(rawExerciseTemplates);
    appliedMigrations.push(IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID);
  }
  // A stretch stored at a reps count before its name became a hold is
  // prescribed the editor's hold default (lib/holdSecondsMigration).
  if (!appliedMigrations.includes(HOLD_SECONDS_MIGRATION_ID)) {
    rawExerciseTemplates = moveOldStretchesToHoldSeconds(rawExerciseTemplates, exerciseLibrary);
    appliedMigrations.push(HOLD_SECONDS_MIGRATION_ID);
  }

  // A stored programme with no id is not a programme. Mapped through the
  // defaults below, a null in the list became one called "Workout" with an
  // empty id, and it took a slot of the free limit (loader probe, 2026-09-20).
  const rawTemplates: WorkoutTemplate[] = Array.isArray(input?.workoutTemplates)
    ? input.workoutTemplates.filter(hasStoredId).map((template: any) => {
        const templateId = String(template?.id ?? '');
        const templateExercises = rawExerciseTemplates.filter((exercise) => exercise.workoutTemplateId === templateId);
        const sessions = normalizeTemplateSessions(template, templateExercises);

        return {
          id: templateId,
          name: typeof template?.name === 'string' && template.name.trim().length ? template.name.trim() : 'Workout',
          exerciseIds: Array.isArray(template?.exerciseIds)
            ? template.exerciseIds.filter((value: unknown): value is string => typeof value === 'string')
            : templateExercises.map((exercise) => exercise.id),
          sessions,
          createdAt: typeof template?.createdAt === 'string' ? template.createdAt : new Date().toISOString(),
          updatedAt: typeof template?.updatedAt === 'string' ? template.updatedAt : new Date().toISOString(),
          // Anything stored before this field existed was written by the
          // editor or by freestyle logging, and there is no way to tell which
          // after the fact. 'authored' is the safe default: it counts, which
          // is how those rows already behaved.
          origin: template?.origin === 'freestyle' ? 'freestyle' : 'authored',
          // Null for anything stored before the link existed. Guessing it from
          // the name would re-attach copies to catalog programmes they may no
          // longer resemble; an unlinked copy simply behaves as it does today.
          sourceTemplateId:
            typeof template?.sourceTemplateId === 'string' && template.sourceTemplateId.trim().length
              ? template.sourceTemplateId
              : null,
        };
      })
    : [];

  const normalizedExerciseTemplates = rawExerciseTemplates.map((exercise) => {
    const template = rawTemplates.find((item) => item.id === exercise.workoutTemplateId);
    const resolvedSessionId =
      template?.sessions.find((session) => session.id === exercise.workoutTemplateSessionId)?.id ??
      template?.sessions.find((session) => session.exerciseIds.includes(exercise.id))?.id ??
      template?.sessions[0]?.id ??
      getLegacyTemplateSessionId(exercise.workoutTemplateId);

    return {
      ...exercise,
      workoutTemplateSessionId: resolvedSessionId,
    };
  });

  // A superset is a run of ADJACENT lifts, and nothing in the stored shape
  // enforces that: the rows are a flat list with an orderIndex, and an edit
  // made before this field existed — or by any code that does not know about
  // it — can leave one half of a pair alone or move the two apart. The rule
  // is applied here, per day, so no screen has to ask whether what it is
  // holding is still a superset. See src/lib/supersetGrouping.ts.
  const supersetNormalizedExerciseTemplates = (() => {
    const byDay = new Map<string, ExerciseTemplate[]>();
    normalizedExerciseTemplates.forEach((exercise) => {
      const key = `${exercise.workoutTemplateId}::${exercise.workoutTemplateSessionId}`;
      const day = byDay.get(key);
      if (day) {
        day.push(exercise);
      } else {
        byDay.set(key, [exercise]);
      }
    });

    // Keyed by the row object, not by its id. An id is normalized to
    // `String(exercise?.id ?? '')` above, so every stored row that lost its id
    // collapses to the same empty string — and two of those, from different
    // days, would have overwritten each other here, substituting one day's
    // exercise into another's list (PR #93 review). Object identity cannot
    // collide, and this map is only ever read with the very objects that
    // built it.
    const repaired = new Map<ExerciseTemplate, ExerciseTemplate>();
    byDay.forEach((day) => {
      const ordered = day.slice().sort((left, right) => left.orderIndex - right.orderIndex);
      normalizeSupersetGroups(ordered).forEach((exercise, position) => {
        repaired.set(ordered[position], exercise);
      });
    });

    return normalizedExerciseTemplates.map((exercise) => repaired.get(exercise) ?? exercise);
  })();

  const normalizedTemplates = rawTemplates.map((template) => {
    const templateExercises = supersetNormalizedExerciseTemplates.filter((exercise) => exercise.workoutTemplateId === template.id);
    const sessions = template.sessions.map((session) => ({
      ...session,
      exerciseIds: templateExercises
        .filter((exercise) => exercise.workoutTemplateSessionId === session.id)
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((exercise) => exercise.id),
    }));

    return {
      ...template,
      sessions,
      exerciseIds: sessions.flatMap((session) => session.exerciseIds),
    };
  });

  // Before the sessions: each session's totals are read off these.
  const normalizedExerciseLogs = Array.isArray(input?.exerciseLogs)
    ? input.exerciseLogs
        .map((log) => normalizeExerciseLog(log))
        .filter((log): log is NonNullable<typeof log> => Boolean(log))
    : [];

  return {
    workoutTemplates: normalizedTemplates,
    exerciseTemplates: supersetNormalizedExerciseTemplates,
    // A plan is found by its id, and its entries are only the programmes they
    // name, so neither can be repaired without them. A null plan loaded as
    // `{ entries: [] }` with no id, and the sign-in restore decision threw on
    // it (loader probe, 2026-09-20).
    workoutPlans: Array.isArray(input?.workoutPlans)
      ? input.workoutPlans.filter(hasStoredId).map((plan: any) => ({
          ...plan,
          // Missing on every plan written before rhythms moved onto the
          // programme (2026-10-07): that reads as the programme's own week.
          trainingCycle: normalizeTrainingCycle(plan.trainingCycle, null),
          entries: Array.isArray(plan.entries)
            ? plan.entries
                .filter(
                  (entry: any) =>
                    entry !== null &&
                    typeof entry === 'object' &&
                    typeof entry.workoutTemplateId === 'string' &&
                    entry.workoutTemplateId.length > 0,
                )
                .map((entry: any) => ({
                  ...entry,
                  // Home reads it with label.trim() for a weekday plan, so a
                  // stored null or number was a crash on every launch with
                  // nothing set aside (bug hunt, 2026-10-05).
                  label: typeof entry.label === 'string' ? entry.label : '',
                  workoutTemplateSessionId:
                    typeof entry.workoutTemplateSessionId === 'string' && entry.workoutTemplateSessionId.trim().length
                      ? entry.workoutTemplateSessionId
                      : null,
                }))
            : [],
        }))
      : [],
    exerciseLibrary,
    // The one-time rewrites this database has had. Absent on every install
    // written before the first of them, which is what lets that one run.
    appliedMigrations,
    // An entry that is not an object with an id is not a session. Mapped
    // through the defaults below it became one — "Workout", dated now —
    // so a null or a stray number in a stored array put a workout on
    // today's calendar (loader probe, 2026-09-20). Cardio below already
    // drops such entries; sessions follow.
    //
    // Sets, volume and exercises done are not taken as stored: they are read
    // again from the session's logs, so a total written by an older build's
    // arithmetic cannot outlive the fix to it. See lib/sessionTotals.
    workoutSessions: withLoggedSessionTotals(
      Array.isArray(input?.workoutSessions)
      ? input.workoutSessions
          .filter((session: any) => session !== null && typeof session === 'object' && String(session.id ?? '').length > 0)
          .map((session: any) => ({
          id: String(session?.id ?? ''),
          workoutTemplateId: String(session?.workoutTemplateId ?? ''),
          workoutTemplateSessionId:
            typeof session?.workoutTemplateSessionId === 'string' && session.workoutTemplateSessionId.trim().length
              ? session.workoutTemplateSessionId
              : null,
          workoutNameSnapshot:
            typeof session?.workoutNameSnapshot === 'string' && session.workoutNameSnapshot.trim().length
              ? session.workoutNameSnapshot.trim()
              : 'Workout',
          sessionNotes:
            typeof session?.sessionNotes === 'string' && session.sessionNotes.trim().length
              ? session.sessionNotes.trim()
              : null,
          feel:
            session?.feel === 'easy' || session?.feel === 'right' || session?.feel === 'hard' || session?.feel === 'too_hard'
              ? session.feel
              : null,
          performedAt: typeof session?.performedAt === 'string' ? session.performedAt : new Date().toISOString(),
          startedAt: typeof session?.startedAt === 'string' ? session.startedAt : undefined,
          durationMinutes:
            typeof session?.durationMinutes === 'number' && Number.isFinite(session.durationMinutes)
              ? session.durationMinutes
              : undefined,
          exercisesSkipped:
            typeof session?.exercisesSkipped === 'number' && Number.isFinite(session.exercisesSkipped)
              ? session.exercisesSkipped
              : undefined,
          exercisesSwapped:
            typeof session?.exercisesSwapped === 'number' && Number.isFinite(session.exercisesSwapped)
              ? session.exercisesSwapped
              : undefined,
          trackedExercisesUpdated:
            typeof session?.trackedExercisesUpdated === 'number' && Number.isFinite(session.trackedExercisesUpdated)
              ? session.trackedExercisesUpdated
              : undefined,
          noteCount:
            typeof session?.noteCount === 'number' && Number.isFinite(session.noteCount)
              ? session.noteCount
              : undefined,
          sessionInsertedCount:
            typeof session?.sessionInsertedCount === 'number' && Number.isFinite(session.sessionInsertedCount)
              ? session.sessionInsertedCount
              : undefined,
          legacyShapeMismatches: Array.isArray(session?.legacyShapeMismatches)
            ? session.legacyShapeMismatches.filter((value: unknown): value is string => typeof value === 'string')
            : undefined,
        }))
      : [],
      normalizedExerciseLogs,
    ),
    cardioSessions: Array.isArray(input?.cardioSessions)
      ? input.cardioSessions
          .map((session: any) => {
            if (typeof session?.id !== 'string' || !session.id) {
              return null;
            }
            const performedAt = typeof session?.performedAt === 'string' ? session.performedAt : null;
            const durationSec =
              typeof session?.durationSec === 'number' && Number.isFinite(session.durationSec)
                ? Math.max(0, Math.round(session.durationSec))
                : null;
            if (!performedAt || durationSec === null) {
              return null;
            }
            const activityType = ['run', 'tread-run', 'tread-walk', 'cycle-in', 'cycle-out', 'row'].includes(
              session?.activityType,
            )
              ? session.activityType
              : 'run';
            return {
              id: session.id,
              activityType,
              startedAt: typeof session?.startedAt === 'string' ? session.startedAt : performedAt,
              performedAt,
              durationSec,
              distanceKm:
                typeof session?.distanceKm === 'number' && Number.isFinite(session.distanceKm) && session.distanceKm > 0
                  ? session.distanceKm
                  : null,
              feel: ['easy', 'steady', 'hard', 'max'].includes(session?.feel) ? session.feel : null,
            };
          })
          .filter((session): session is NonNullable<typeof session> => session !== null)
      : [],
    exerciseLogs: normalizedExerciseLogs,
    // Passed through untouched until 2026-09-21, so one null weigh-in crashed
    // every launch: the provider sorts this list on `recordedAt` while it
    // renders, and nothing above it catches. A weigh-in is its three fields
    // or nothing, the way a measurement is below, and a weight the writer
    // refuses (zero or less) is not one.
    bodyweightEntries: Array.isArray(input?.bodyweightEntries)
      ? input.bodyweightEntries.filter(
          (entry: unknown) =>
            hasStoredId(entry) &&
            typeof entry.recordedAt === 'string' &&
            typeof entry.weight === 'number' &&
            Number.isFinite(entry.weight) &&
            entry.weight > 0,
        )
      : [],
    // Every field is required for an entry to be usable, and a half-written
    // one would resolve a name to nothing — so a malformed row is dropped
    // rather than repaired. Absent entirely (any database written before
    // 2026-08-24) is simply an empty book.
    exerciseNameBook: Array.isArray(input?.exerciseNameBook)
      ? input.exerciseNameBook
          .filter(
            (entry: any) =>
              typeof entry?.alias === 'string' &&
              entry.alias.trim().length > 0 &&
              typeof entry?.exerciseName === 'string' &&
              entry.exerciseName.trim().length > 0,
          )
          .map((entry: any) => ({
            alias: entry.alias,
            wrote: typeof entry?.wrote === 'string' && entry.wrote.trim() ? entry.wrote : entry.alias,
            exerciseName: entry.exerciseName,
            libraryItemId: liveLibraryItemId(entry?.libraryItemId),
            learnedAt:
              typeof entry?.learnedAt === 'string' ? entry.learnedAt : new Date().toISOString(),
          }))
      : [],
    measurementEntries: Array.isArray(input?.measurementEntries)
      ? input.measurementEntries
          .map((entry: any) => {
            // One list, in src/lib/measurementKinds. This was a hand-written
            // chain that had drifted: arms and calves reached the model and
            // the measurement screen and never this line, so those entries
            // were written, read back, and dropped in silence.
            const kind = isMeasurementKind(entry?.kind) ? entry.kind : null;
            const unit = entry?.unit === 'cm' || entry?.unit === 'in' || entry?.unit === '%' ? entry.unit : null;
            const value = typeof entry?.value === 'number' && Number.isFinite(entry.value) ? entry.value : null;
            const recordedAt = typeof entry?.recordedAt === 'string' ? entry.recordedAt : null;
            const id = typeof entry?.id === 'string' && entry.id.trim().length ? entry.id : null;

            if (!kind || !unit || value === null || !recordedAt || !id) {
              return null;
            }

            return {
              id,
              kind,
              // Body fat is a percentage whatever the stored row says. Every
              // reading the Progress tab wrote before 2026-09-19 carries `cm`,
              // because that writer sent "always centimetres" — so the coach
              // was handed "bodyfat, 20 cm" from a row nothing else would ever
              // correct. The kind decides the unit; a length keeps whichever
              // of cm and in it was stored with.
              unit: kind === 'bodyfat' ? measurementUnitForKind(kind) : unit,
              value,
              recordedAt,
            } satisfies MeasurementEntry;
          })
          .filter((entry): entry is MeasurementEntry => Boolean(entry))
      : [],
    preferences: {
      appLanguage:
        input?.preferences?.appLanguage === 'fi' || input?.preferences?.appLanguage === 'en'
          ? input.preferences.appLanguage
          : fallback.preferences.appLanguage,
      // App is kg-only: any legacy 'lb' preference normalizes to kg on load.
      unitPreference: 'kg',
      // Every way a stored rest can be unusable, decided in one pure place
      // that a test can actually run — see normalizeDefaultRestSeconds.
      defaultRestSeconds: normalizeDefaultRestSeconds(
        input?.preferences?.defaultRestSeconds,
        fallback.preferences.defaultRestSeconds,
      ),
      autoFocusNextInput:
        typeof input?.preferences?.autoFocusNextInput === 'boolean'
          ? input.preferences.autoFocusNextInput
          : fallback.preferences.autoFocusNextInput,
      keepScreenAwakeDuringWorkout:
        typeof input?.preferences?.keepScreenAwakeDuringWorkout === 'boolean'
          ? input.preferences.keepScreenAwakeDuringWorkout
          : fallback.preferences.keepScreenAwakeDuringWorkout,
      soundCuesEnabled:
        typeof input?.preferences?.soundCuesEnabled === 'boolean'
          ? input.preferences.soundCuesEnabled
          : fallback.preferences.soundCuesEnabled,
      darkThemeEnabled:
        typeof input?.preferences?.darkThemeEnabled === 'boolean'
          ? input.preferences.darkThemeEnabled
          : fallback.preferences.darkThemeEnabled,
      usageStatisticsEnabled:
        typeof input?.preferences?.usageStatisticsEnabled === 'boolean'
          ? input.preferences.usageStatisticsEnabled
          : fallback.preferences.usageStatisticsEnabled,
      hapticsEnabled:
        typeof input?.preferences?.hapticsEnabled === 'boolean'
          ? input.preferences.hapticsEnabled
          : fallback.preferences.hapticsEnabled,
      ownBlockStats: normalizeOwnBlockStats(input?.preferences?.ownBlockStats),
      // null and [] are distinct: null = never customized, [] = cleared by the user.
      homeStatCardKeys: Array.isArray(input?.preferences?.homeStatCardKeys)
        ? input.preferences.homeStatCardKeys.filter(
            (key: unknown): key is string => typeof key === 'string' && key.length > 0,
          )
        : fallback.preferences.homeStatCardKeys,
      notificationPrefs: {
        pushEnabled:
          typeof input?.preferences?.notificationPrefs?.pushEnabled === 'boolean'
            ? input.preferences.notificationPrefs.pushEnabled
            : fallback.preferences.notificationPrefs.pushEnabled,
        level: ['quiet', 'normal', 'motivating'].includes(input?.preferences?.notificationPrefs?.level as string)
          ? (input!.preferences!.notificationPrefs!.level as 'quiet' | 'normal' | 'motivating')
          : fallback.preferences.notificationPrefs.level,
        personalRecords:
          typeof input?.preferences?.notificationPrefs?.personalRecords === 'boolean'
            ? input.preferences.notificationPrefs.personalRecords
            : fallback.preferences.notificationPrefs.personalRecords,
        weeklySummary:
          typeof input?.preferences?.notificationPrefs?.weeklySummary === 'boolean'
            ? input.preferences.notificationPrefs.weeklySummary
            : fallback.preferences.notificationPrefs.weeklySummary,
        comebackNudge:
          typeof input?.preferences?.notificationPrefs?.comebackNudge === 'boolean'
            ? input.preferences.notificationPrefs.comebackNudge
            : fallback.preferences.notificationPrefs.comebackNudge,
        sessionReminders:
          typeof input?.preferences?.notificationPrefs?.sessionReminders === 'boolean'
            ? input.preferences.notificationPrefs.sessionReminders
            : fallback.preferences.notificationPrefs.sessionReminders,
        // "HH:MM" 24h. A malformed value would silently move every reminder, so
        // anything that is not a real clock time falls back to the default.
        reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(
          input?.preferences?.notificationPrefs?.reminderTime as string,
        )
          ? (input!.preferences!.notificationPrefs!.reminderTime as string)
          : fallback.preferences.notificationPrefs.reminderTime,
        weighInReminder: boolOr(
          input?.preferences?.notificationPrefs?.weighInReminder,
          fallback.preferences.notificationPrefs.weighInReminder,
        ),
        ...measurementReminderPrefs(input?.preferences?.notificationPrefs, fallback.preferences.notificationPrefs),
        restAlerts: boolOr(input?.preferences?.notificationPrefs?.restAlerts, fallback.preferences.notificationPrefs.restAlerts),
        restWarning: boolOr(input?.preferences?.notificationPrefs?.restWarning, fallback.preferences.notificationPrefs.restWarning),
        sessionOngoing: boolOr(input?.preferences?.notificationPrefs?.sessionOngoing, fallback.preferences.notificationPrefs.sessionOngoing),
        idleNudge: boolOr(input?.preferences?.notificationPrefs?.idleNudge, fallback.preferences.notificationPrefs.idleNudge),
        restAlertsAsked: boolOr(input?.preferences?.notificationPrefs?.restAlertsAsked, fallback.preferences.notificationPrefs.restAlertsAsked),
      },
      trainingBreak:
        input?.preferences?.trainingBreak &&
        ['injury', 'holiday', 'other'].includes(input.preferences.trainingBreak.reason as string) &&
        typeof input.preferences.trainingBreak.startedAt === 'string'
          ? {
              reason: input.preferences.trainingBreak.reason as 'injury' | 'holiday' | 'other',
              note:
                typeof input.preferences.trainingBreak.note === 'string' ? input.preferences.trainingBreak.note : null,
              startedAt: input.preferences.trainingBreak.startedAt,
            }
          : fallback.preferences.trainingBreak,
      // Malformed reads as not accepted, which asks again — never the reverse.
      legalAcceptance: normalizeLegalAcceptance(input?.preferences?.legalAcceptance),
      restDayStarts: normalizeRestDayStarts(input?.preferences?.restDayStarts),
      lightNextSession: normalizeLightNextSession(input?.preferences?.lightNextSession),
      // Consent is `true` or it is not consent. A stored string, a null or a
      // missing field all mean no — the one direction it is safe to be wrong in.
      aiLogId:
        typeof input?.preferences?.aiLogId === 'string' && input.preferences.aiLogId
          ? input.preferences.aiLogId
          : fallback.preferences.aiLogId,
      aiLogChatConsent: input?.preferences?.aiLogChatConsent === true,
      aiLogComposerConsent: input?.preferences?.aiLogComposerConsent === true,
      aiLogPhotoConsent: input?.preferences?.aiLogPhotoConsent === true,
      // Absent on every install from before the retry existed: nothing owed.
      pendingAiLogDeletions: normalizePendingAiLogDeletions(input?.preferences?.pendingAiLogDeletions),
      promoProUntil:
        typeof input?.preferences?.promoProUntil === 'string'
          ? input.preferences.promoProUntil
          : fallback.preferences.promoProUntil,
      proTrialUntil:
        typeof input?.preferences?.proTrialUntil === 'string'
          ? input.preferences.proTrialUntil
          : fallback.preferences.proTrialUntil,
      // Absent on every install from before the trial was once-only: those
      // may have used it, and there is no way to tell, so they get the one.
      proTrialStartedAt:
        typeof input?.preferences?.proTrialStartedAt === 'string'
          ? input.preferences.proTrialStartedAt
          : fallback.preferences.proTrialStartedAt,
      mockSubscriptionTerm: isSubscriptionTermKey(input?.preferences?.mockSubscriptionTerm)
        ? input.preferences.mockSubscriptionTerm
        : fallback.preferences.mockSubscriptionTerm,
      // The purchase record, with its migration — see lib/purchaseRecord for
      // why a purchase stored beside the old preview switch is not one.
      ...normalizePurchaseRecord(input?.preferences as Record<string, unknown> | undefined, {
        mockSubscriptionPurchasedAt: fallback.preferences.mockSubscriptionPurchasedAt,
        mockSubscriptionCancelledAt: fallback.preferences.mockSubscriptionCancelledAt,
      }),
      cancelSurveyAnswer: normalizeCancelSurveyAnswer(input?.preferences?.cancelSurveyAnswer),
      featureVotedIds: Array.isArray(input?.preferences?.featureVotedIds)
        ? input.preferences.featureVotedIds.filter(
            (id: unknown): id is string => typeof id === 'string' && id.length > 0,
          )
        : fallback.preferences.featureVotedIds,
      // The free weekly counter was removed 2026-08-29 along with the free
      // tier it metered; a stored one is simply not read any more.
      aiCoachProQuota:
        input?.preferences?.aiCoachProQuota &&
        typeof input.preferences.aiCoachProQuota.monthStart === 'string' &&
        typeof input.preferences.aiCoachProQuota.used === 'number' &&
        Number.isFinite(input.preferences.aiCoachProQuota.used)
          ? {
              monthStart: input.preferences.aiCoachProQuota.monthStart,
              used: Math.max(0, Math.round(input.preferences.aiCoachProQuota.used)),
            }
          : fallback.preferences.aiCoachProQuota,
      firstLaunchAt:
        typeof input?.preferences?.firstLaunchAt === 'string' &&
        !Number.isNaN(Date.parse(input.preferences.firstLaunchAt))
          ? input.preferences.firstLaunchAt
          : fallback.preferences.firstLaunchAt,
      coachDemoMomentsUsed: Array.isArray(input?.preferences?.coachDemoMomentsUsed)
        ? input.preferences.coachDemoMomentsUsed.filter(
            (key: unknown): key is string => typeof key === 'string' && key.length > 0,
          )
        : fallback.preferences.coachDemoMomentsUsed,
      seenServerNoticeIds: Array.isArray(input?.preferences?.seenServerNoticeIds)
        ? normalizeSeenNoticeIds(input.preferences.seenServerNoticeIds)
        : fallback.preferences.seenServerNoticeIds,
      // adaptiveCoachPremiumUnlocked was the demo build's free Pro switch. It
      // is not read any more and is not carried forward: an install that has
      // it stored simply stops having Pro from it, which is the point (user
      // 2026-09-03). Promo codes and purchases are unaffected — they live in
      // their own fields.
      automatedProgressionEnabled:
        typeof input?.preferences?.automatedProgressionEnabled === 'boolean'
          ? input.preferences.automatedProgressionEnabled
          : fallback.preferences.automatedProgressionEnabled,
      aiSetupCompleted:
        typeof input?.preferences?.aiSetupCompleted === 'boolean'
          ? input.preferences.aiSetupCompleted
          : fallback.preferences.aiSetupCompleted,
      hasOpenedAppBefore:
        typeof input?.preferences?.hasOpenedAppBefore === 'boolean'
          ? input.preferences.hasOpenedAppBefore
          : fallback.preferences.hasOpenedAppBefore,
      // An install from before the flag existed has whatever weigh-ins it
      // has: treat a log with something in it as already seeded, so the old
      // rule's one-off write is not repeated on the first load.
      setupWeightSeeded:
        typeof input?.preferences?.setupWeightSeeded === 'boolean'
          ? input.preferences.setupWeightSeeded
          : Array.isArray(input?.bodyweightEntries) && input.bodyweightEntries.length > 0,
      // An install from before the flag existed that has a name has had it
      // from the account or from the reader, and either way the account's
      // turn is over. One without a name may simply never have signed in, so
      // it keeps its chance.
      accountNameAdopted:
        typeof input?.preferences?.accountNameAdopted === 'boolean'
          ? input.preferences.accountNameAdopted
          : typeof input?.preferences?.profileName === 'string' && input.preferences.profileName.trim().length > 0,
      homeWidgetPromptDismissed:
        typeof input?.preferences?.homeWidgetPromptDismissed === 'boolean'
          ? input.preferences.homeWidgetPromptDismissed
          : fallback.preferences.homeWidgetPromptDismissed,
      accountBackupPromptDismissed:
        typeof input?.preferences?.accountBackupPromptDismissed === 'boolean'
          ? input.preferences.accountBackupPromptDismissed
          : fallback.preferences.accountBackupPromptDismissed,
      // The rule lives in lib (which surfaces exist, no duplicates); the
      // loader only hands over whatever was stored.
      firstRunToursSeen: normalizeFirstRunToursSeen(input?.preferences?.firstRunToursSeen),
      aiOnlineNoticeAcknowledged:
        typeof input?.preferences?.aiOnlineNoticeAcknowledged === 'boolean'
          ? input.preferences.aiOnlineNoticeAcknowledged
          : fallback.preferences.aiOnlineNoticeAcknowledged,
      // A consent-shaped field, so the identity check: anything that is not
      // exactly `true` reads as "not yet shown", which is the safe direction.
      aiPhotoNoticeAcknowledged: input?.preferences?.aiPhotoNoticeAcknowledged === true,
      coachGoals: Array.isArray(input?.preferences?.coachGoals)
        ? input.preferences.coachGoals.filter(
            (goal): goal is NonNullable<typeof goal> =>
              Boolean(goal) && typeof goal === 'object' && typeof goal.id === 'string' && typeof goal.text === 'string',
          )
        : fallback.preferences.coachGoals,
      primaryGoalId:
        typeof input?.preferences?.primaryGoalId === 'string' ? input.preferences.primaryGoalId : null,
      coachSuggestionState:
        input?.preferences?.coachSuggestionState && typeof input.preferences.coachSuggestionState === 'object'
          ? input.preferences.coachSuggestionState
          : {},
      // A stored install that predates this flag has already been through
      // onboarding, so the hand-off has had its turn — without this, the flag
      // reads false on the next launch and an old install gets ambushed by a
      // step meant for a first run.
      setupHandoffCompleted:
        typeof input?.preferences?.setupHandoffCompleted === 'boolean'
          ? input.preferences.setupHandoffCompleted
          : input?.preferences?.onboardingCompleted === true
            ? true
            : fallback.preferences.setupHandoffCompleted,
      entryFlowCompleted:
        typeof input?.preferences?.entryFlowCompleted === 'boolean'
          ? input.preferences.entryFlowCompleted
          : fallback.preferences.entryFlowCompleted,
      trainingFirstRunDismissed:
        typeof input?.preferences?.trainingFirstRunDismissed === 'boolean'
          ? input.preferences.trainingFirstRunDismissed
          : fallback.preferences.trainingFirstRunDismissed,
      selectedSignInMethod:
        input?.preferences?.selectedSignInMethod === 'apple' ||
        input?.preferences?.selectedSignInMethod === 'email' ||
        // 'local' and 'google' are in the type and 'local' is written by the
        // onboarding finish; dropping them here reset the reader's choice on
        // every load (bug hunt, 2026-10-04).
        input?.preferences?.selectedSignInMethod === 'local' ||
        input?.preferences?.selectedSignInMethod === 'google' ||
        input?.preferences?.selectedSignInMethod === null
          ? input.preferences.selectedSignInMethod
          : fallback.preferences.selectedSignInMethod,
      selectedAccessTier:
        input?.preferences?.selectedAccessTier === 'free' ||
        input?.preferences?.selectedAccessTier === 'premium' ||
        input?.preferences?.selectedAccessTier === null
          ? input.preferences.selectedAccessTier
          : fallback.preferences.selectedAccessTier,
      profileName:
        typeof input?.preferences?.profileName === 'string' && input.preferences.profileName.trim().length
          ? input.preferences.profileName.trim().slice(0, 32)
          : input?.preferences?.profileName === null
            ? null
            : fallback.preferences.profileName,
      setupCurrentWeightKg:
        typeof input?.preferences?.setupCurrentWeightKg === 'number' || input?.preferences?.setupCurrentWeightKg === null
          ? input.preferences.setupCurrentWeightKg
          : fallback.preferences.setupCurrentWeightKg,
      bodyweightGoalKg:
        typeof input?.preferences?.bodyweightGoalKg === 'number' || input?.preferences?.bodyweightGoalKg === null
          ? input.preferences.bodyweightGoalKg
          : fallback.preferences.bodyweightGoalKg,
      onboardingCompleted:
        typeof input?.preferences?.onboardingCompleted === 'boolean'
          ? input.preferences.onboardingCompleted
          : fallback.preferences.onboardingCompleted,
      setupCompleted:
        typeof input?.preferences?.setupCompleted === 'boolean'
          ? input.preferences.setupCompleted
          : fallback.preferences.setupCompleted,
      setupGender:
        input?.preferences?.setupGender === 'male' ||
        input?.preferences?.setupGender === 'female' ||
        input?.preferences?.setupGender === 'unspecified' ||
        input?.preferences?.setupGender === null
          ? input.preferences.setupGender
          : fallback.preferences.setupGender,
      setupAge:
        typeof input?.preferences?.setupAge === 'number' && Number.isFinite(input.preferences.setupAge)
          ? Math.max(0, Math.min(100, Math.round(input.preferences.setupAge)))
          : fallback.preferences.setupAge,
      setupHeightCm:
        // The UI allows 120..230. Outside 100..250 is not a height: it is a
        // stray 0 or a clamped 300 that would print "0 cm" and feed BMI a
        // nonsense divisor, so it loads as "not set" (bug hunt, 2026-10-04).
        typeof input?.preferences?.setupHeightCm === 'number' &&
        Number.isFinite(input.preferences.setupHeightCm) &&
        Math.round(input.preferences.setupHeightCm) >= 100 &&
        Math.round(input.preferences.setupHeightCm) <= 250
          ? Math.round(input.preferences.setupHeightCm)
          : typeof input?.preferences?.setupHeightCm === 'number'
            ? null
            : fallback.preferences.setupHeightCm,
      setupAgeRange:
        input?.preferences?.setupAgeRange === 'unspecified' ||
        input?.preferences?.setupAgeRange === '18' ||
        input?.preferences?.setupAgeRange === '19_25' ||
        input?.preferences?.setupAgeRange === '26_30' ||
        input?.preferences?.setupAgeRange === '31_40' ||
        input?.preferences?.setupAgeRange === '41_plus' ||
        input?.preferences?.setupAgeRange === null
          ? input.preferences.setupAgeRange
          : fallback.preferences.setupAgeRange,
      setupGoal:
        input?.preferences?.setupGoal === 'strength' ||
        input?.preferences?.setupGoal === 'muscle' ||
        input?.preferences?.setupGoal === 'general' ||
        input?.preferences?.setupGoal === 'run_mobility' ||
        input?.preferences?.setupGoal === 'lean_athletic' ||
        input?.preferences?.setupGoal === 'general_fitness'
          ? input.preferences.setupGoal
          : fallback.preferences.setupGoal,
      setupGoals:
        Array.isArray(input?.preferences?.setupGoals) &&
        input.preferences.setupGoals.length > 0
          ? input.preferences.setupGoals.filter(
              (value: unknown): value is 'strength' | 'muscle' | 'general' | 'run_mobility' | 'lean_athletic' | 'general_fitness' =>
                value === 'strength' ||
                value === 'muscle' ||
                value === 'general' ||
                value === 'run_mobility' ||
                value === 'lean_athletic' ||
                value === 'general_fitness',
            )
          : input?.preferences?.setupGoal === 'strength' ||
              input?.preferences?.setupGoal === 'muscle' ||
              input?.preferences?.setupGoal === 'general' ||
              input?.preferences?.setupGoal === 'run_mobility' ||
              input?.preferences?.setupGoal === 'lean_athletic' ||
              input?.preferences?.setupGoal === 'general_fitness'
            ? [input.preferences.setupGoal]
            : fallback.preferences.setupGoals,
      setupLevel:
        input?.preferences?.setupLevel === 'beginner' ||
        input?.preferences?.setupLevel === 'advanced' ||
        input?.preferences?.setupLevel === 'pro'
          ? input.preferences.setupLevel
          : // Legacy tier name from before the beginner/advanced/pro rename;
            // the old middle tier maps onto the new middle tier.
            (input?.preferences?.setupLevel as string | null | undefined) === 'intermediate'
            ? 'advanced'
            : fallback.preferences.setupLevel,
      setupDaysPerWeek:
        input?.preferences?.setupDaysPerWeek === 2 ||
        input?.preferences?.setupDaysPerWeek === 3 ||
        input?.preferences?.setupDaysPerWeek === 4 ||
        input?.preferences?.setupDaysPerWeek === 5 ||
        input?.preferences?.setupDaysPerWeek === 6
          ? input.preferences.setupDaysPerWeek
          : fallback.preferences.setupDaysPerWeek,
      setupEquipment:
        input?.preferences?.setupEquipment === 'gym' ||
        input?.preferences?.setupEquipment === 'minimal' ||
        input?.preferences?.setupEquipment === 'home'
          ? input.preferences.setupEquipment
          : fallback.preferences.setupEquipment,
      setupTrainingEnvironment:
        input?.preferences?.setupTrainingEnvironment === 'full_gym' ||
        input?.preferences?.setupTrainingEnvironment === 'home_gym' ||
        input?.preferences?.setupTrainingEnvironment === 'minimal_equipment' ||
        input?.preferences?.setupTrainingEnvironment === 'bodyweight_only' ||
        input?.preferences?.setupTrainingEnvironment === 'running_hybrid'
          ? input.preferences.setupTrainingEnvironment
          : fallback.preferences.setupTrainingEnvironment,
      setupSecondaryOutcomes:
        Array.isArray(input?.preferences?.setupSecondaryOutcomes)
          ? input.preferences.setupSecondaryOutcomes.filter(
              (value: unknown): value is 'consistency' | 'mobility' | 'conditioning' | 'muscle' | 'strength' =>
                value === 'consistency' ||
                value === 'mobility' ||
                value === 'conditioning' ||
                value === 'muscle' ||
                value === 'strength',
            )
          : fallback.preferences.setupSecondaryOutcomes,
      setupEquipmentItems:
        Array.isArray(input?.preferences?.setupEquipmentItems)
          ? input.preferences.setupEquipmentItems
              .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
              .slice(0, 24)
          : fallback.preferences.setupEquipmentItems,
      setupFocusAreas:
        Array.isArray(input?.preferences?.setupFocusAreas)
          ? input.preferences.setupFocusAreas.filter(
              (
                value: unknown,
              ): value is
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
                | 'conditioning' =>
                value === 'bodyweight' ||
                value === 'glutes' ||
                value === 'legs' ||
                value === 'quads' ||
                value === 'hamstrings' ||
                value === 'calves' ||
                value === 'chest' ||
                value === 'shoulders' ||
                value === 'back' ||
                value === 'arms' ||
                value === 'core' ||
                value === 'mobility' ||
                value === 'conditioning',
            )
          : fallback.preferences.setupFocusAreas,
      setupCautionFlags: normalizeSetupCautionFlags(
        input?.preferences?.setupCautionFlags,
        fallback.preferences.setupCautionFlags,
      ),
      setupGuidanceMode:
        input?.preferences?.setupGuidanceMode === 'done_for_me' ||
        input?.preferences?.setupGuidanceMode === 'guided_editable' ||
        input?.preferences?.setupGuidanceMode === 'self_directed'
          ? input.preferences.setupGuidanceMode
          : fallback.preferences.setupGuidanceMode,
      setupScheduleMode:
        input?.preferences?.setupScheduleMode === 'app_managed' ||
        input?.preferences?.setupScheduleMode === 'self_managed'
          ? input.preferences.setupScheduleMode
          : fallback.preferences.setupScheduleMode,
      setupWeeklyMinutes:
        typeof input?.preferences?.setupWeeklyMinutes === 'number' || input?.preferences?.setupWeeklyMinutes === null
          ? input.preferences.setupWeeklyMinutes
          : fallback.preferences.setupWeeklyMinutes,
      setupAvailableDays:
        Array.isArray(input?.preferences?.setupAvailableDays)
          ? input.preferences.setupAvailableDays.filter(
              (value: unknown): value is 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' =>
                value === 'mon' ||
                value === 'tue' ||
                value === 'wed' ||
                value === 'thu' ||
                value === 'fri' ||
                value === 'sat' ||
                value === 'sun',
            )
          : fallback.preferences.setupAvailableDays,
      trainingCycle: normalizeTrainingCycle(input?.preferences?.trainingCycle, fallback.preferences.trainingCycle),
      routineDrillOverrides: normalizeStringRecord(input?.preferences?.routineDrillOverrides),
      readerSessionNames: normalizeStringRecord(input?.preferences?.readerSessionNames),
      ratingPrompt: normalizeRatingPrompt(input?.preferences?.ratingPrompt),
      todaySession: normalizeTodaySession(input?.preferences?.todaySession),
      setupTrainingFeel:
        input?.preferences?.setupTrainingFeel === 'easy' ||
        input?.preferences?.setupTrainingFeel === 'steady' ||
        input?.preferences?.setupTrainingFeel === 'challenging' ||
        input?.preferences?.setupTrainingFeel === 'intense'
          ? input.preferences.setupTrainingFeel
          : fallback.preferences.setupTrainingFeel,
      setupWorkoutVariety:
        input?.preferences?.setupWorkoutVariety === 'stable' ||
        input?.preferences?.setupWorkoutVariety === 'balanced' ||
        input?.preferences?.setupWorkoutVariety === 'varied' ||
        input?.preferences?.setupWorkoutVariety === 'fresh'
          ? input.preferences.setupWorkoutVariety
          : fallback.preferences.setupWorkoutVariety,
      setupFreeWeightsPreference:
        input?.preferences?.setupFreeWeightsPreference === 'avoid' ||
        input?.preferences?.setupFreeWeightsPreference === 'neutral' ||
        input?.preferences?.setupFreeWeightsPreference === 'prefer' ||
        input?.preferences?.setupFreeWeightsPreference === 'love'
          ? input.preferences.setupFreeWeightsPreference
          : fallback.preferences.setupFreeWeightsPreference,
      setupBodyweightPreference:
        input?.preferences?.setupBodyweightPreference === 'avoid' ||
        input?.preferences?.setupBodyweightPreference === 'neutral' ||
        input?.preferences?.setupBodyweightPreference === 'prefer' ||
        input?.preferences?.setupBodyweightPreference === 'love'
          ? input.preferences.setupBodyweightPreference
          : fallback.preferences.setupBodyweightPreference,
      setupMachinesPreference:
        input?.preferences?.setupMachinesPreference === 'avoid' ||
        input?.preferences?.setupMachinesPreference === 'neutral' ||
        input?.preferences?.setupMachinesPreference === 'prefer' ||
        input?.preferences?.setupMachinesPreference === 'love'
          ? input.preferences.setupMachinesPreference
          : fallback.preferences.setupMachinesPreference,
      setupShoulderFriendlySwaps: normalizeJointSwapPreference(
        input?.preferences?.setupShoulderFriendlySwaps,
        fallback.preferences.setupShoulderFriendlySwaps,
      ),
      setupElbowFriendlySwaps: normalizeJointSwapPreference(
        input?.preferences?.setupElbowFriendlySwaps,
        fallback.preferences.setupElbowFriendlySwaps,
      ),
      setupKneeFriendlySwaps: normalizeJointSwapPreference(
        input?.preferences?.setupKneeFriendlySwaps,
        fallback.preferences.setupKneeFriendlySwaps,
      ),
      aiPlannerGoal:
        input?.preferences?.aiPlannerGoal === 'strength' ||
        input?.preferences?.aiPlannerGoal === 'muscle' ||
        input?.preferences?.aiPlannerGoal === 'fat_loss' ||
        input?.preferences?.aiPlannerGoal === 'fitness'
          ? input.preferences.aiPlannerGoal
          : fallback.preferences.aiPlannerGoal,
      aiPlannerDaysPerWeek:
        input?.preferences?.aiPlannerDaysPerWeek === 1 ||
        input?.preferences?.aiPlannerDaysPerWeek === 2 ||
        input?.preferences?.aiPlannerDaysPerWeek === 3 ||
        input?.preferences?.aiPlannerDaysPerWeek === 4
          ? input.preferences.aiPlannerDaysPerWeek
          : fallback.preferences.aiPlannerDaysPerWeek,
      aiPlannerExperience:
        input?.preferences?.aiPlannerExperience === 'beginner' ||
        input?.preferences?.aiPlannerExperience === 'intermediate' ||
        input?.preferences?.aiPlannerExperience === 'advanced'
          ? input.preferences.aiPlannerExperience
          : fallback.preferences.aiPlannerExperience,
      aiPlannerSessionMinutes:
        input?.preferences?.aiPlannerSessionMinutes === 30 ||
        input?.preferences?.aiPlannerSessionMinutes === 45 ||
        input?.preferences?.aiPlannerSessionMinutes === 60 ||
        input?.preferences?.aiPlannerSessionMinutes === 75 ||
        input?.preferences?.aiPlannerSessionMinutes === 90
          ? input.preferences.aiPlannerSessionMinutes
          : fallback.preferences.aiPlannerSessionMinutes,
      aiPlannerEquipment:
        input?.preferences?.aiPlannerEquipment === 'full_gym' ||
        input?.preferences?.aiPlannerEquipment === 'home_gym' ||
        input?.preferences?.aiPlannerEquipment === 'minimal' ||
        input?.preferences?.aiPlannerEquipment === 'bodyweight'
          ? input.preferences.aiPlannerEquipment
          : fallback.preferences.aiPlannerEquipment,
      aiPlannerRecovery:
        input?.preferences?.aiPlannerRecovery === 'low' ||
        input?.preferences?.aiPlannerRecovery === 'moderate' ||
        input?.preferences?.aiPlannerRecovery === 'high'
          ? input.preferences.aiPlannerRecovery
          : fallback.preferences.aiPlannerRecovery,
      aiPlannerMustInclude:
        typeof input?.preferences?.aiPlannerMustInclude === 'string'
          ? input.preferences.aiPlannerMustInclude
          : fallback.preferences.aiPlannerMustInclude,
      aiPlannerAvoid:
        typeof input?.preferences?.aiPlannerAvoid === 'string'
          ? input.preferences.aiPlannerAvoid
          : fallback.preferences.aiPlannerAvoid,
      aiPlannerLimitations:
        typeof input?.preferences?.aiPlannerLimitations === 'string'
          ? input.preferences.aiPlannerLimitations
          : fallback.preferences.aiPlannerLimitations,
      aiCoachTemplateId:
        typeof input?.preferences?.aiCoachTemplateId === 'string' || input?.preferences?.aiCoachTemplateId === null
          ? input.preferences.aiCoachTemplateId
          : fallback.preferences.aiCoachTemplateId,
      aiCoachSetupHash:
        typeof input?.preferences?.aiCoachSetupHash === 'string' || input?.preferences?.aiCoachSetupHash === null
          ? input.preferences.aiCoachSetupHash
          : fallback.preferences.aiCoachSetupHash,
      aiCoachPlanGeneratedAt:
        typeof input?.preferences?.aiCoachPlanGeneratedAt === 'string' || input?.preferences?.aiCoachPlanGeneratedAt === null
          ? input.preferences.aiCoachPlanGeneratedAt
          : fallback.preferences.aiCoachPlanGeneratedAt,
      lastInsightSessionId:
        typeof input?.preferences?.lastInsightSessionId === 'string' || input?.preferences?.lastInsightSessionId === null
          ? input.preferences.lastInsightSessionId
          : fallback.preferences.lastInsightSessionId,
      lastInsightType:
        input?.preferences?.lastInsightType === 'personal_record' ||
        input?.preferences?.lastInsightType === 'plateau_detected' ||
        input?.preferences?.lastInsightType === 'session_volume_peak' ||
        input?.preferences?.lastInsightType === 'return_after_gap' ||
        input?.preferences?.lastInsightType === null
          ? input.preferences.lastInsightType
          : fallback.preferences.lastInsightType,
      recommendedProgramId:
        typeof input?.preferences?.recommendedProgramId === 'string' || input?.preferences?.recommendedProgramId === null
          ? input.preferences.recommendedProgramId
          : fallback.preferences.recommendedProgramId,
      // Both rules live in src/lib so a test can call them: this file reaches
      // AsyncStorage, and AsyncStorage reaches React Native.
      learnedExerciseLibraryItemIds: normalizeLearnedExerciseIds(
        input?.preferences?.learnedExerciseLibraryItemIds,
      ),
      exerciseTechniqueChecks: normalizeTechniqueChecks(input?.preferences?.exerciseTechniqueChecks),
      // Hand-typed numbers in stored JSON: normalised rather than trusted,
      // so a corrupt entry cannot make a progress bar draw past its box.
      strengthGoals: normalizeStrengthGoals(input?.preferences?.strengthGoals),
      seasonEnrolments: normalizeSeasonEnrolments(input?.preferences?.seasonEnrolments),
      dismissedTipIds:
        Array.isArray(input?.preferences?.dismissedTipIds)
          ? input.preferences.dismissedTipIds.filter((value: unknown): value is string => typeof value === 'string')
          : fallback.preferences.dismissedTipIds,
      activePlanId:
        typeof input?.preferences?.activePlanId === 'string' || input?.preferences?.activePlanId === null
          ? input.preferences.activePlanId
          : fallback.preferences.activePlanId,
      dismissedCompletionPlanIds:
        Array.isArray(input?.preferences?.dismissedCompletionPlanIds)
          ? input.preferences.dismissedCompletionPlanIds.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : fallback.preferences.dismissedCompletionPlanIds,
      dismissedCardSuggestionKeys:
        Array.isArray(input?.preferences?.dismissedCardSuggestionKeys)
          ? input.preferences.dismissedCardSuggestionKeys.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : fallback.preferences.dismissedCardSuggestionKeys,
      // Missing on every install from before the plateau card could be
      // dismissed; a bad entry is dropped rather than trusted (#bugs 2026-09-29).
      // De-duplicated the same way normalizeActivePlanIds is: a stored repeat
      // (an old install written before the double-tap guard, break round
      // 2026-09-29) must not cost more than one entry.
      dismissedPlateauEpisodes:
        Array.isArray(input?.preferences?.dismissedPlateauEpisodes)
          ? [
              ...new Set(
                input.preferences.dismissedPlateauEpisodes.filter(
                  (value: unknown): value is string => typeof value === 'string',
                ),
              ),
            ]
          : fallback.preferences.dismissedPlateauEpisodes,
      activePlanIds: normalizeActivePlanIds(
        input?.preferences?.activePlanIds,
        input?.preferences?.activePlanId,
      ),
      programsTabEnabled:
        typeof input?.preferences?.programsTabEnabled === 'boolean'
          ? input.preferences.programsTabEnabled
          : fallback.preferences.programsTabEnabled,
    },
  };
}

/**
 * A first launch starts empty.
 *
 * This used to write createSeedDatabase(), which carries six invented sessions,
 * their logs, and a bodyweight trend. A brand-new user opened the app to
 * personal records they had never lifted and a history they had never trained —
 * the app lied about the one thing it exists to record. The seed stays as a
 * fixture for tests and demos; it must never reach a real install.
 */
export async function loadDatabase() {
  const raw = await readStoredDatabase();

  if (!raw) {
    // Nothing stored means nobody has chosen a language yet, so the phone
    // decides. A Finnish device used to open a Finnish-first app in English
    // and the reader's first act was correcting it.
    const empty = normalizeDatabase(createEmptyDatabase(resolveDeviceLanguage()));
    await saveDatabase(empty);
    return empty;
  }

  try {
    const database = normalizeDatabase(JSON.parse(raw) as Partial<AppDatabase>);
    const preferences = await loadStoredPreferences(database.preferences);
    // After the overlay, not inside normalizeDatabase: the preferences key is
    // normalized without the plans, and it is the copy that wins. This is
    // where an install carrying a running id with no plan behind it heals,
    // and a completion dismissal for a plan that is gone (hunt 10, #19).
    const reconciled = { ...database, preferences: reconcileWithPlans(preferences, database.workoutPlans) };
    return await withTrainingCycleMoved(reconciled);
  } catch {
    // Unreadable storage is a corrupt install, not a new one — but inventing
    // history to paper over it would be the same lie.
    //
    // The bytes are kept first. This branch used to write the empty database
    // straight over the only copy of everything the reader had logged, so a
    // half-written blob or one bad field cost them the lot with nothing left to
    // read afterwards. Set the key aside and the loss is recoverable by hand;
    // the app still opens either way, which is what the overwrite was for.
    //
    // Unless the copy could not be written. Out of space, most likely — the
    // same condition that truncated the blob — and opening anyway meant the
    // empty save below swept the only copy there was. The failure goes up
    // instead: the rows stay as they are, and the load fails the way an
    // unreadable disk does (loadWithRetry, then the storage error screen).
    await setAsideCorruptCopy(CORRUPT_STORAGE_KEY, raw);
    // The preferences are a row of their own and the blob's corruption is
    // not in them. Opened on defaults instead, the app lost the theme, the
    // notification choices, the trial's start and the coach's counters, and
    // the first preference it saved (the install date, stamped straight
    // away) wrote those defaults over the intact copy (persistence audit,
    // 2026-09-20).
    //
    // Except the running set: which programmes run is a fact about the
    // database, and the programmes went with it. Kept, its ids would count
    // against the cap with nothing behind them — the rule every load applies,
    // here against no plans at all, and again on the next launch against the
    // key's copy, so the key itself is left as it was.
    const blank = normalizeDatabase(createEmptyDatabase(resolveDeviceLanguage()));
    const stored = await loadStoredPreferences(blank.preferences);
    const empty = { ...blank, preferences: reconcileWithPlans(stored, blank.workoutPlans) };
    await saveDatabase(empty);
    return empty;
  }
}

/**
 * The old app-wide rhythm, moved onto the lead programme and written down.
 *
 * Here for the same reason as the running set's repair: the rhythm can sit in
 * the preferences key, the plans sit in the blob, and only after the overlay
 * are both in hand. Written at once, both keys in one write (one transaction
 * on Android; on iOS the blob lands first, and a kill before the key only
 * runs the move again) — left for the next commit, a preferences-only write
 * (a theme switch) would land the emptied preference while the blob still
 * held the plan without its rhythm, and the next launch would have lost it. If the
 * write is refused the move is not made at all: this launch shows the
 * programme's own week and the next one tries again, with nothing lost.
 */
async function withTrainingCycleMoved(database: AppDatabase): Promise<AppDatabase> {
  const moved = moveTrainingCycleToLeadPlan(database);
  if (moved === database) {
    return database;
  }
  try {
    await saveDatabase(moved, { withPreferences: true });
    return moved;
  } catch {
    return database;
  }
}

/**
 * The stored blob, or what is left of it.
 *
 * A split blob with a part missing is the same corrupt install as one that
 * will not parse, and gets the same treatment: its remains start with the
 * manifest line, so the parse below fails and they are set aside. Thrown
 * instead, the provider opened on an empty database in memory, and its first
 * save swept the parts that were left with no copy kept.
 */
async function readStoredDatabase(): Promise<string | null> {
  try {
    return (await getLargeItem(STORAGE_KEY)) ?? (await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
  } catch (error) {
    if (error instanceof MissingPartsError) {
      return error.readable;
    }
    throw error;
  }
}

/**
 * The preferences key, when it has been written, over the ones the blob holds.
 *
 * A missing key is the normal case for an install that predates the split, and
 * an unreadable one is not worth losing a whole database over — both fall back
 * to the blob's own copy, which a full save keeps current.
 */
/** The preferences that describe plans, made to agree with the stored plans. */
function reconcileWithPlans(preferences: AppPreferences, plans: AppDatabase['workoutPlans']): AppPreferences {
  return reconcileCompletionDismissals(reconcileRunningSet(preferences, plans), plans);
}

async function loadStoredPreferences(fallback: AppPreferences): Promise<AppPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    // Reuses the one normalizer rather than a second copy of the same field
    // defaults: an empty database carrying these preferences comes back with
    // every missing field filled the same way a stored one would.
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return normalizeDatabase({ preferences: { ...fallback, ...parsed } }).preferences;
  } catch {
    return fallback;
  }
}

/**
 * One field's worth of writing, for the changes that are one field.
 *
 * The caller keeps the in-memory database as the single source of truth; this
 * only makes the small write cheap. Anything that touches sessions, logs or
 * templates still goes through saveDatabase.
 */
export async function savePreferences(preferences: AppPreferences) {
  await AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

/**
 * `withPreferences` writes the preferences key in the same transaction as the
 * blob. A commit that changed a preference must, because the load lays that
 * key over the blob's copy: written one after the other, a kill in between
 * kept the new blob under the old preferences.
 */
export async function saveDatabase(database: AppDatabase, options: { withPreferences?: boolean } = {}) {
  // Through the splitting writer: the blob grows with every logged session and
  // Android cannot read back a row past 2 MB (see lib/storageChunks).
  await setLargeItem(
    STORAGE_KEY,
    JSON.stringify({
      ...database,
      exerciseLibrary: [],
    }),
    options.withPreferences ? [[PREFERENCES_STORAGE_KEY, JSON.stringify(database.preferences)]] : [],
  );
}

/**
 * Erase the reader's data, and only theirs.
 *
 * `device` is the preferences in memory at the moment of the reset. Two
 * things come out of the new database differently from a blank one:
 *
 * - The language is the phone's, as on a first launch. `createEmptyDatabase()`
 *   with no argument is English, so a reset turned a Finnish phone's app
 *   English. The chosen language is not kept — the note below the save says
 *   why a reset leaves no old preference behind — but the default it falls
 *   back to is the same one a new install gets.
 * - The entitlement and the meters are kept (DEVICE_ONLY_PREFERENCE_FIELDS,
 *   the list a restore keeps too). They are not the reader's data, they are
 *   what this install has already been given: writing defaults over them made
 *   Reset a way to start the fourteen-day trial again and to refill the free
 *   coach answers, as often as wanted — and it dropped a paid membership. The
 *   privacy answers are NOT in that list and go with everything else — but
 *   for one: a "no" to usage statistics stays a "no". Reset clears what the
 *   reader logged, not what they said about being measured, and a restore
 *   keeps that "no" the same way (keepDevicePrivacyChoices: a no on either
 *   side wins). A yes goes back to the default, as it always did.
 * - The coach-log label goes with the consents, but not before it is filed as
 *   a delete still owed (lib/aiLogDeletion). It is the only way back to the
 *   copies kept under it, so it moves in the same write that clears it: no
 *   moment exists where the label is gone and the delete not yet recorded.
 *   The caller asks the server, and the label leaves the list only when the
 *   server confirms.
 */
export async function resetDatabase(
  device: Pick<AppPreferences, (typeof DEVICE_ONLY_PREFERENCE_FIELDS)[number] | 'aiLogId' | 'usageStatisticsEnabled'>,
) {
  const blank = createEmptyDatabase(resolveDeviceLanguage());
  const kept = {
    ...keepDeviceEntitlement(blank.preferences, device),
    usageStatisticsEnabled: blank.preferences.usageStatisticsEnabled && device.usageStatisticsEnabled !== false,
  };
  const empty = normalizeDatabase({
    ...blank,
    preferences: {
      ...kept,
      pendingAiLogDeletions: withPendingAiLogDeletion(kept.pendingAiLogDeletions, device.aiLogId),
    },
  });
  // The erasing goes first, the reset write last. Once that write lands the
  // app opens as reset, so anything still to erase after it was left behind
  // by a kill in between: the coach remembered a reader whose data was gone
  // (third break round, 2026-09-28). In this order a kill leaves the old data
  // standing and the reset simply not done yet — asked for again, it runs
  // again.
  //
  // Reset has to mean reset: leaving the pre-rename blob behind would let it
  // come back if the new key were ever cleared on its own. The quarantined copy
  // goes for a second reason — somebody who asks for their data to be erased is
  // not asking for a copy of it to survive under another name.
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  await removeCorruptCopies(CORRUPT_STORAGE_KEY);
  // And the coach's memory, on its own key for backup reasons but erased by
  // the same request: "delete my data" cannot leave behind what the coach was
  // told to remember about the person asking.
  await clearCoachAdviceMemory();
  // The preferences key goes in the blob's own transaction. It used to be
  // removed four writes later, and a kill in between left the old language,
  // theme and "setup done" laid over the reset data by the next load
  // (recheck of #221, 2026-09-28). Overwritten with the reset preferences
  // instead, in the same write, so there is no gap to land in.
  await saveDatabase(empty, { withPreferences: true });
  return empty;
}
