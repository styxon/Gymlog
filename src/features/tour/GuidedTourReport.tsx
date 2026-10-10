import { useEffect } from 'react';

import type { WorkoutTourStep } from '../../lib/firstRunTour';

/**
 * The guided player's way of saying "this plain set / rest is on screen".
 *
 * Renders nothing. While it is mounted and `plain`, it reports the step to the
 * shell (App.tsx keeps it, useSetupHandoffOverlays decides whether the workout
 * tour is due); when the step goes away, or the player is held (`report` is
 * left undefined while a sheet is open or the workout is paused), it takes the
 * report back, so the tour closes with the step it was about.
 *
 * Lives here rather than in the player so the player carries one line per
 * step instead of an effect and its dependencies.
 */
export function GuidedTourReport({
  report,
  kind,
  plain,
  canWarmUp = false,
  loaded = true,
  hasHistory = false,
}: {
  /** Undefined = hold: nothing is reported, and anything reported is withdrawn. */
  report: ((step: WorkoutTourStep | null) => void) | undefined;
  kind: WorkoutTourStep['kind'];
  /**
   * An interval bout, a superset round, a hold and a clock are not plain: the
   * dials and the rest buttons the tour describes are not all there.
   */
  plain: boolean;
  canWarmUp?: boolean;
  loaded?: boolean;
  hasHistory?: boolean;
}) {
  useEffect(() => {
    if (!report || !plain) {
      return undefined;
    }
    report({ kind, canWarmUp, loaded, hasHistory });
    return () => report(null);
  }, [report, plain, kind, canWarmUp, loaded, hasHistory]);
  return null;
}
