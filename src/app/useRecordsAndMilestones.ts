import { useMemo } from 'react';
import { LifetimeTrainingSummary } from '../lib/lifetimeSummary';
import { buildMilestoneLedger, getMilestoneFacts } from '../lib/milestoneFacts';
import { firstRecordDates, RecordSource, recordEntriesOfLogs, resolveRecords } from '../lib/personalRecords';
import { findPlateauDetection } from '../lib/proInsights';
import { ExerciseProgressSummary, getLiftHistoryByName } from '../lib/progression';
import { LiftHistory } from '../lib/trainingHistory';
import { AppDatabase, AppPreferences, UnitPreference } from '../types/models';

/**
 * The reader's records and milestones: each tracked lift's bests, the guided
 * player's lookups by lift name, and the milestone ledger the Profile card
 * and the milestones page read.
 *
 * Moved out of App.tsx in the phase-B split (2026-09-30), verbatim and in the
 * order it stood there, docs and eslint-disable lines with it. A hook because
 * every value here is a memo. recordDates and milestoneFacts stay inside it;
 * toSetLogSource goes back out because useGoalFlow maps the goal lifts through
 * it as well. exercisePrLookup, which liftHistory's doc compares itself to, is
 * in useCustomProgramViews.
 */
export interface RecordsAndMilestonesDeps {
  exerciseBrowserItems: AppDatabase['exerciseLibrary'];
  trackedProgress: ExerciseProgressSummary[];
  database: AppDatabase;
  proLiftHistories: LiftHistory[];
  preferences: AppPreferences;
  lifetimeSummary: LifetimeTrainingSummary;
  unitPreference: UnitPreference;
}

export function useRecordsAndMilestones(deps: RecordsAndMilestonesDeps) {
  const {
    exerciseBrowserItems,
    trackedProgress,
    database,
    proLiftHistories,
    preferences,
    lifetimeSummary,
    unitPreference,
  } = deps;

  /**
   * Your bests, from the tracked lifts' own logs.
   *
   * Built through getComparableLogSets so the records agree with every other
   * number the app derives from a set — a second reader would drift the first
   * time the legacy shape came up.
   */
  const toSetLogSource = useMemo(() => {
    const bodyPartByName = new Map(
      exerciseBrowserItems.map((item) => [item.name.trim().toLowerCase(), item.bodyPart]),
    );
    return (summary: ExerciseProgressSummary): RecordSource => ({
      key: summary.key,
      name: summary.name,
      bodyPart: bodyPartByName.get(summary.name.trim().toLowerCase()) ?? null,
      // One entry per session; minutes never hold a record (recordSetsOfLog).
      entries: recordEntriesOfLogs(summary.allLogs),
    });
  }, [exerciseBrowserItems]);
  const recordSources = useMemo(
    () => trackedProgress.map(toSetLogSource),
    [toSetLogSource, trackedProgress],
  );
  /**
   * The lift's history by name, for the player's sheet. Every log, not the
   * tracked summaries the records read: tracking is a per-programme mark,
   * and a lift untracked here has still been lifted (CI review of #154).
   * Keyed on the three tables it reads, like exercisePrLookup.
   */
  const liftHistory = useMemo(() => {
    const byName = getLiftHistoryByName(database);
    return (exerciseName: string) => byName.get(exerciseName.trim().toLowerCase()) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database.exerciseLogs, database.exerciseTemplates, database.workoutSessions]);
  /**
   * The plateau reminder for whichever lift the guided player is walking to
   * next — the same detection Home shows, found by name rather than picked
   * as the single best, and never filtered by Home's dismiss list: putting
   * that card away must not silence the in-workout nudge too (user
   * 2026-09-29, "muistutus kun seuraavalla kerralla on sumo").
   */
  const plateauNotice = useMemo(
    () => (exerciseName: string) =>
      findPlateauDetection(proLiftHistories, exerciseName, preferences.appLanguage, preferences.setupCautionFlags),
    [proLiftHistories, preferences.appLanguage, preferences.setupCautionFlags],
  );
  const personalRecords = useMemo(
    () => ({
      weight: resolveRecords(recordSources, 'weight'),
      reps: resolveRecords(recordSources, 'reps'),
      volume: resolveRecords(recordSources, 'volume'),
    }),
    [recordSources],
  );

  /** Lifts holding a record, counted once no matter how many kinds. */
  const distinctRecordCount = useMemo(
    () =>
      new Set([
        ...personalRecords.weight.map((record) => record.key),
        ...personalRecords.reps.map((record) => record.key),
        ...personalRecords.volume.map((record) => record.key),
      ]).size,
    [personalRecords],
  );

  /** The day each lift first held a record — the same lifts distinctRecordCount counts. */
  const recordDates = useMemo(() => firstRecordDates(personalRecords), [personalRecords]);
  // Keyed on the four tables the facts read, not the whole database: a theme
  // or language toggle replaces the database object without touching a log,
  // and this is a full pass over every set. `lifetimeSummary` is itself keyed
  // on the whole database, so depending on the object would have undone the
  // narrowing — only the one field this reads is a dependency.
  const milestoneFacts = useMemo(
    () => getMilestoneFacts(database, lifetimeSummary, recordDates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      database.workoutSessions,
      database.exerciseLogs,
      database.cardioSessions,
      database.bodyweightEntries,
      lifetimeSummary.currentWeekStreak,
      recordDates,
    ],
  );
  const milestoneLedger = useMemo(() => buildMilestoneLedger(milestoneFacts, unitPreference), [milestoneFacts, unitPreference]);

  return {
    toSetLogSource,
    recordSources,
    liftHistory,
    plateauNotice,
    personalRecords,
    distinctRecordCount,
    milestoneLedger,
  };
}
