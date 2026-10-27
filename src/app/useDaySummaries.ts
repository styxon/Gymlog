import { useMemo } from 'react';

import { getHomeSummary } from '../lib/dashboard';
import { getLifetimeTrainingSummary } from '../lib/lifetimeSummary';
import { getTrainingRhythm } from '../lib/trainingRhythm';
import type { AppDatabase, UnitPreference } from '../types/models';

/**
 * The shell's calendar summaries: Home's, the lifetime one, and Progress's
 * training rhythm — each read off the clock, so each keyed on the day.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30).
 * A hook, not a helper: these are memos, and the identity they keep between
 * renders is what the dependency lists downstream in App.tsx rely on.
 * VinhaApp calls this exactly where the lines stood — after the hand-off's
 * legal-page back effect, just ahead of useProInsights — so every hook keeps
 * its slot and every reader in App.tsx still sits below the values it reads.
 *
 * In the moved comment below, "here" means these memos, as it did in App.tsx.
 */
interface DaySummariesDeps {
  /** The whole database, as the summaries read it. */
  database: AppDatabase;
  /** The reader's kg/lb setting, for Home's summary. */
  unitPreference: UnitPreference;
  /** VinhaApp's day clock: in every dependency list, so the memos re-run when the day turns. */
  todayKey: string;
}

export function useDaySummaries(deps: DaySummariesDeps) {
  const { database, unitPreference, todayKey } = deps;

  /*
   * Keyed on the day as well as the data. All three read "this week" or "this
   * month" off the clock, and keyed on the data alone they kept the day they
   * were last computed: an app left open from Sunday night into Monday had the
   * coach open with last week's "3 sessions this week", and on the 1st
   * Progress drew last month's calendar and totals beside a widget already on
   * the new one — until the next workout was logged (audit, 2026-09-20).
   *
   * The clock is read here, where the day key makes the memo re-run, rather
   * than defaulted inside each function where no dependency list can see it.
   * The moment, not the key's midnight: the thirty-day count ends at `now`,
   * and midnight would leave out everything logged today.
   */
  const homeSummary = useMemo(
    () => getHomeSummary(database, unitPreference, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database, unitPreference, todayKey],
  );
  const lifetimeSummary = useMemo(
    () => getLifetimeTrainingSummary(database, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database, todayKey],
  );
  const progressTrainingRhythm = useMemo(
    () => getTrainingRhythm(database, { now: new Date() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database, todayKey],
  );

  return { homeSummary, lifetimeSummary, progressTrainingRhythm };
}
