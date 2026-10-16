import { AppState } from 'react-native';

/**
 * Opens the system's "add widget" dialog and resolves once it has closed —
 * Add or Cancel, Android does not say which.
 *
 * `requestPin` resolves the moment the request is made, with the dialog still
 * opening. The hand-off asks one more thing after the widget (which sites to
 * track), and drawn on that promise alone the sheet came up under the system
 * dialog: two questions on screen at once (user 2026-10-16). The dialog is
 * another app's activity, so ours leaves `active` while it is up and comes back
 * when it closes; that return is the signal.
 *
 * A launcher that answers without taking the screen never sends us away, so
 * after `settleMs` with no departure there is no dialog to wait for.
 */
export async function pinWidgetAndWaitForDialog(
  requestPin: () => Promise<boolean>,
  settleMs = 1500,
): Promise<boolean> {
  let left = false;
  let onReturn: () => void = () => {};
  const returned = new Promise<void>((resolve) => {
    onReturn = resolve;
  });
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      left = true;
    } else if (left) {
      onReturn();
    }
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const shown = await requestPin();
    if (!shown) {
      return false;
    }
    const settled = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!left) {
          resolve();
        }
      }, settleMs);
    });
    await Promise.race([returned, settled]);
    return true;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    subscription.remove();
  }
}
