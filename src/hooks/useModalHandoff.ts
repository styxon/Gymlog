import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * How long to wait for a sheet's dismissal before opening the next modal
 * anyway. A fade dismissal takes about 300 ms and normally reports itself
 * through onDismiss; this only covers a dismissal that is never reported, so
 * it is long enough that it cannot beat a slow one.
 */
export const MODAL_HANDOFF_FALLBACK_MS = 1500;

/**
 * Closing one modal and opening the next, on iOS.
 *
 * React Native presents every Modal from the root view controller
 * (RCTModalHostViewComponentView, `[self reactViewController]`). While that
 * controller is still presenting a sheet, or still animating one away, UIKit
 * refuses to present a second one, but React Native records it as presented.
 * Nothing appears and touches stop reaching the app. "Skip this exercise"
 * opened its confirmation over the open actions sheet, and the whole app froze
 * (#bugs 2026-10-17, iOS build 4).
 *
 * So the next modal waits until the sheet has gone: `handOff` closes the
 * sheet, and the sheet's `onDismissed` (Modal onDismiss, iOS only) opens the
 * next one, with a timer in case the dismissal is never reported. Android
 * stacks modals without complaint, so there it opens at once, as before.
 */
export function useModalHandoff(): {
  handOff: (close: () => void, open: () => void) => void;
  onSheetDismissed: () => void;
} {
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSheetDismissed = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    next?.();
  }, []);

  const handOff = useCallback(
    (close: () => void, open: () => void) => {
      if (Platform.OS !== 'ios') {
        close();
        open();
        return;
      }
      pending.current = open;
      close();
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(onSheetDismissed, MODAL_HANDOFF_FALLBACK_MS);
    },
    [onSheetDismissed],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      pending.current = null;
    },
    [],
  );

  return { handOff, onSheetDismissed };
}
