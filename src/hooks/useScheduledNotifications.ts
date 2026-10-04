/**
 * Keeps the OS's pending notifications in step with the app's data.
 *
 * Re-plans whenever anything the plan depends on moves — a preference, a saved
 * session, a language switch — and again whenever the app comes back to the
 * foreground, which rolls the reminder horizon forward and drops anything the
 * user has since trained through.
 *
 * Syncs are serialised through a promise chain: two overlapping runs would both
 * read the pending list before either had written, and the loser would leave
 * duplicates behind.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  getLastActivityTimestamp,
  getLastWorkoutTimestamp,
  getSessionsThisWeek,
  getVolumeThisWeekKg,
} from '../lib/completedSessions';
import { templateSessionsReader } from '../app/planTemplateSessions';
import { livePlanEntries } from '../lib/planResolvableEntries';
import { buildNotificationPlan } from '../lib/notificationPlan';
import { resolveReminderSchedule } from '../lib/reminderSchedule';
import { findLatestSessionPr } from '../lib/workoutCompletionSummary';
import { AppDatabase } from '../types/models';
import { syncPlannedNotifications } from '../utils/appNotifications';

export function useScheduledNotifications(database: AppDatabase) {
  const { notificationPrefs, appLanguage, setupAvailableDays, trainingBreak } = database.preferences;
  const [foregroundTick, setForegroundTick] = useState(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setForegroundTick((tick) => tick + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const signals = useMemo(
    () => ({
      lastSessionAtMs: getLastActivityTimestamp(database),
      // Workouts only: a run does not do the day's planned training.
      lastWorkoutAtMs: getLastWorkoutTimestamp(database),
      weekSessionCount: getSessionsThisWeek(database),
      weekVolumeKg: getVolumeThisWeekKg(database),
      latestPr: findLatestSessionPr({
        workoutSessions: database.workoutSessions,
        exerciseLogs: database.exerciseLogs,
        exerciseTemplates: database.exerciseTemplates,
      }),
      // So this morning's nudge disappears once the scale has been used.
      lastBodyweightAtMs: database.bodyweightEntries.reduce<number | null>((latest, entry) => {
        const at = new Date(entry.recordedAt).getTime();
        return Number.isFinite(at) && (latest === null || at > latest) ? at : latest;
      }, null),
      // Per kind, because the weekly reminder names one kind and only that
      // kind's measurement retires it.
      latestMeasurementAtMsByKind: database.measurementEntries.reduce<Partial<Record<string, number>>>(
        (latest, entry) => {
          const at = new Date(entry.recordedAt).getTime();
          const current = latest[entry.kind];
          if (Number.isFinite(at) && (current === undefined || at > current)) {
            latest[entry.kind] = at;
          }
          return latest;
        },
        {},
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      database.workoutSessions,
      database.cardioSessions,
      database.exerciseLogs,
      database.exerciseTemplates,
      database.bodyweightEntries,
      database.measurementEntries,
      foregroundTick,
    ],
  );

  const measurementKind = notificationPrefs.measurementReminderKind;
  const lastMeasurementAtMs = measurementKind
    ? signals.latestMeasurementAtMsByKind[measurementKind] ?? null
    : null;

  /**
   * The rhythm the reminders follow: the reader's cycle when they have set
   * one, otherwise the days their own plan names, otherwise what setup said
   * they had free.
   *
   * Reminders used to read `setupAvailableDays` alone, which is availability
   * rather than a plan — and for a reader on a 3-on-1-off cycle it is not
   * even the right kind of answer: their training days move through the week
   * (2026-09-16). The rule is `resolveReminderSchedule`, because the screens
   * that say whether reminders have days to fire on must read the same one.
   */
  const schedule = useMemo(() => {
    const activePlan =
      database.workoutPlans.find((plan) => plan.id === database.preferences.activePlanId) ?? null;
    return resolveReminderSchedule({
      trainingCycle: database.preferences.trainingCycle,
      planEntries: livePlanEntries(activePlan?.entries ?? [], templateSessionsReader(database)),
      availableDays: setupAvailableDays,
      restDayStarts: database.preferences.restDayStarts,
    });
  }, [
    database.preferences.activePlanId,
    database.preferences.trainingCycle,
    database.preferences.restDayStarts,
    database.workoutPlans,
    database.workoutTemplates,
    database.exerciseTemplates,
    setupAvailableDays,
  ]);
  const scheduleKey = JSON.stringify(schedule);
  const onTrainingBreak = trainingBreak !== null;
  const prKey = signals.latestPr
    ? `${signals.latestPr.exerciseName}|${signals.latestPr.weightKg}|${signals.latestPr.reps}|${signals.latestPr.achievedAtMs}`
    : '';

  const trialEndsAtMs = useMemo(() => {
    const until = database.preferences.proTrialUntil;
    if (!until) {
      return null;
    }
    const parsed = new Date(until).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [database.preferences.proTrialUntil]);

  useEffect(() => {
    const plan = buildNotificationPlan({
      nowMs: Date.now(),
      prefs: notificationPrefs,
      language: appLanguage,
      schedule,
      onTrainingBreak,
      lastSessionAtMs: signals.lastSessionAtMs,
      lastWorkoutAtMs: signals.lastWorkoutAtMs,
      weekSessionCount: signals.weekSessionCount,
      weekVolumeKg: signals.weekVolumeKg,
      latestPr: signals.latestPr,
      lastBodyweightAtMs: signals.lastBodyweightAtMs,
      lastMeasurementAtMs,
      // The warning the hand-off row promised. Read from the trial's own field
      // rather than from the promo grant, so a redeemed code never triggers a
      // notice about a trial nobody started.
      proTrialEndsAtMs: trialEndsAtMs,
    });

    queueRef.current = queueRef.current
      .then(() => syncPlannedNotifications(plan, appLanguage))
      .catch(() => undefined);
    // Primitive deps only: the preference object is rebuilt on every save, and
    // depending on its identity would re-arm the alarms for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    notificationPrefs.pushEnabled,
    notificationPrefs.level,
    notificationPrefs.personalRecords,
    notificationPrefs.weeklySummary,
    notificationPrefs.comebackNudge,
    notificationPrefs.sessionReminders,
    notificationPrefs.reminderTime,
    notificationPrefs.weighInReminder,
    notificationPrefs.measurementReminderKind,
    notificationPrefs.measurementReminderDay,
    lastMeasurementAtMs,
    trialEndsAtMs,
    appLanguage,
    scheduleKey,
    onTrainingBreak,
    signals.lastSessionAtMs,
    signals.lastWorkoutAtMs,
    signals.lastBodyweightAtMs,
    signals.weekSessionCount,
    signals.weekVolumeKg,
    prKey,
    foregroundTick,
  ]);
}
