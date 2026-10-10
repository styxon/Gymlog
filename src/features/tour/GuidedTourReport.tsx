import { useCallback, useEffect } from 'react';

import type { WorkoutTourStep } from '../../lib/firstRunTour';
import type { TourTargetRegistry } from './tourTargets';

/**
 * A screen's ref callback for one tour target, made once.
 *
 * An inline `ref={(node) => register(id, node)}` is a new function on every
 * render, and React answers a new ref callback by calling the old one with
 * null and the new one with the node: the player re-renders every second, so
 * a target would be unregistered and registered sixty times a minute for the
 * sake of a tour that is almost never up. Memoised, it is attached once.
 */
export function useTourTarget(tourTargets: TourTargetRegistry | undefined, id: Parameters<TourTargetRegistry['register']>[0]) {
  return useCallback((node: unknown) => tourTargets?.register(id, node), [tourTargets, id]);
}

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
  canRemove = true,
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
  canRemove?: boolean;
  loaded?: boolean;
  hasHistory?: boolean;
}) {
  useEffect(() => {
    if (!report || !plain) {
      return undefined;
    }
    report({ kind, canWarmUp, canRemove, loaded, hasHistory });
    return () => report(null);
  }, [report, plain, kind, canWarmUp, canRemove, loaded, hasHistory]);
  return null;
}
