import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export interface KeyboardOpenState {
  open: boolean;
  /** The keyboard's measured height, 0 while it is down. */
  height: number;
}

/**
 * Whether the keyboard is up, and how tall it is.
 *
 * iOS listens to the will-events, the ones the AppShell's KeyboardAvoidingView
 * lifts the screen on: a screen that dropped its tab-bar reserve on the
 * did-events jumped a third of a second after the lift. Android has only the
 * did-events. A screen opened with the keyboard already up starts from its
 * current state, not from "down". A keyboard reported with no height (a
 * floating one, a hardware keyboard's bar) lifted nothing, and counts as down:
 * the screen keeps its tab-bar reserve.
 */
export function useKeyboardOpen(): KeyboardOpenState {
  const [state, setState] = useState<KeyboardOpenState>(() =>
    stateFor(Keyboard.isVisible() ? Keyboard.metrics()?.height : 0),
  );

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setState(stateFor(event.endCoordinates?.height)),
    );
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setState(stateFor(0)));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return state;
}

function stateFor(height: number | undefined): KeyboardOpenState {
  return height !== undefined && height > 0 ? { open: true, height } : { open: false, height: 0 };
}
