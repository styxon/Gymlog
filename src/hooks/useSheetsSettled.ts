import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { MODAL_HANDOFF_FALLBACK_MS } from './useModalHandoff';

/**
 * Whether a screen's own modals are all gone, for a modal that opens on its
 * own (a timer, an effect) rather than from a touch.
 *
 * `up` is true while any of the screen's other modals is visible. `settled`
 * turns true only after the last of them has left: on iOS that is when its
 * Modal reports onDismiss (pass `onDismissed` to it), with a timer in case the
 * dismissal is never reported. A modal presented before that is refused by
 * UIKit and leaves an invisible layer that takes every touch (see
 * useModalHandoff). Android stacks modals, so there `settled` is `!up`.
 *
 * The state is derived while rendering, not in an effect, so the render that
 * closes the sheet already says "not settled": an effect that opens the next
 * modal when `settled` is true cannot see a stale `true` for one commit.
 */
export function useSheetsSettled(up: boolean): { settled: boolean; onDismissed: () => void } {
  const [previousUp, setPreviousUp] = useState(up);
  const [leaving, setLeaving] = useState(false);
  if (up !== previousUp) {
    setPreviousUp(up);
    setLeaving(!up && Platform.OS === 'ios');
  }

  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const timer = setTimeout(() => setLeaving(false), MODAL_HANDOFF_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const onDismissed = useCallback(() => setLeaving(false), []);
  return { settled: !up && !leaving, onDismissed };
}
