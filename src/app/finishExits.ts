import { startTransition } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Platform } from 'react-native';

import { getLifetimeWorkoutCount } from '../lib/lifetimeSummary';
import { decideRatingPrompt, recordRatingAsked } from '../lib/ratingPrompt';
import { storePlatformOf, usesSystemReviewPrompt } from '../lib/storeLinks';
import { requestSystemReview } from '../utils/systemReview';
import type { AppRoute } from '../navigation/routes';
import type { AppDatabase, AppPreferences } from '../types/models';
import type { CompletionSummaryState } from './workoutCompletionState';
import type { FinishSaveState } from './useFinishState';

/**
 * The way out of a finished workout: leaving the summary in one transition,
 * and the rating ask that leaving may raise.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01),
 * each function with its doc. A per-render factory, not a hook: it holds no
 * state and calls no hook. VinhaApp calls it on every render exactly where the
 * declarations stood (after resetToRoute, ahead of resolveTabRoute), so each
 * is still a fresh closure over that render's values; its one use in App.tsx,
 * the summary's onDone, sits below the call.
 *
 * In the moved doc, "every navigation helper here" means VinhaApp's navigate,
 * replaceRoute and resetToRoute in App.tsx, and "the summary branch" is the
 * summary screen's render there.
 */
export interface FinishExitsDeps {
  /** The reader's preferences: the rating prompt's own record. */
  preferences: AppPreferences;
  /** The whole database, for the count of sessions logged. */
  database: AppDatabase;
  /** AppProvider's preferences writer; the rating ask records itself with a function patch. */
  updatePreferences: (patch: (current: AppPreferences) => Partial<AppPreferences>) => Promise<void>;
  setCompletionSummary: Dispatch<SetStateAction<CompletionSummaryState | null>>;
  setFinishSaveState: Dispatch<SetStateAction<FinishSaveState>>;
  /** VinhaApp's navigation state setter, set directly so the move is one update with the clears. */
  setNavigationState: (next: { route: AppRoute; history: AppRoute[] }) => void;
  setRatingSheetVisible: Dispatch<SetStateAction<boolean>>;
}

export function createFinishExits(deps: FinishExitsDeps) {
  const {
    preferences,
    database,
    updatePreferences,
    setCompletionSummary,
    setFinishSaveState,
    setNavigationState,
    setRatingSheetVisible,
  } = deps;

  /**
   * Leave a finished-workout screen: clear its data and move, in one commit.
   *
   * The single transition is the whole point. Every navigation helper here
   * wraps setNavigationState in startTransition, which makes route changes
   * non-urgent — so a plain `setCompletionSummary(null)` alongside them is
   * urgent and lands *first*. That commits a frame where the route is still
   * {workout, summary} while the summary data is already gone.
   *
   * The summary branch is guarded on `&& completionSummary`, so that frame
   * matches no named workout screen and falls through to the tab's catch-all,
   * which renders the exercise browser. Reported from the phone as "Ohjelmat
   * flashes for a beat between the summary and Home".
   *
   * Clearing after navigating does not fix it: the clear would still be the
   * urgent half. They have to be the same update.
   */
  function leaveFinishedScreen(nextRoute: AppRoute) {
    startTransition(() => {
      setCompletionSummary(null);
      setFinishSaveState({ status: 'idle', sessionId: null });
      setNavigationState({ route: nextRoute, history: [] });
    });
  }

  /**
   * The Done button's way out: the single transition above, then the rating
   * ask. The hardware Back key on the summary takes `leaveFinishedScreen`
   * alone — the same exit, without the ask: Back is the reader leaving, not
   * the moment they tapped "done" on how it went.
   */
  function leaveFinishedWorkout(nextRoute: AppRoute) {
    leaveFinishedScreen(nextRoute);
    maybeAskForRating();
  }

  /**
   * The rating ask, at the one moment the reader has just finished something.
   *
   * Fired on the way out of the finish screen rather than on it: the finish
   * screen already asks how the session felt, and two sheets stacked on one
   * tap is how a reader learns to dismiss sheets without reading them.
   *
   * The ask is recorded when the sheet is SHOWN, not when it is answered. A
   * reader who closes it has still been asked, and counting only the answers
   * would let the app ask forever.
   *
   * Counted as Profile counts: a workout saved twice, or a row with no set
   * done, is not a workout the reader has logged (duplicate sweep 13,
   * 2026-10-12).
   */
  function maybeAskForRating() {
    const decision = decideRatingPrompt({
      state: preferences.ratingPrompt,
      sessionsLogged: getLifetimeWorkoutCount(database),
      atPeakMoment: true,
      nowMs: Date.now(),
    });
    if (!decision.ask) {
      return;
    }
    // iPhone: Apple's own prompt, with no sheet of ours in front of it. Same
    // cadence either way; Apple caps its prompt again on top.
    if (usesSystemReviewPrompt(storePlatformOf(Platform.OS))) {
      void requestSystemReview();
    } else {
      setRatingSheetVisible(true);
    }
    void updatePreferences((current) => ({ ratingPrompt: recordRatingAsked(current.ratingPrompt, Date.now()) }));
  }

  return { leaveFinishedWorkout, leaveFinishedScreen };
}
