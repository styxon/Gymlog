import { AccessibilityInfo } from 'react-native';

/**
 * Ask the OS whether animations should be reduced, and always answer.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a native round trip, and a
 * native round trip can reject or simply never come back. Every call site in
 * this app used to be `.then(setReduceMotion)` with nothing on the other side,
 * which is fine right up until it is not:
 *
 * VinhaSplashScreen kept `reduceMotion` as `boolean | null` and rendered an
 * empty field while it was null — and the effect that starts the animation, and
 * therefore the one that eventually calls `onDone`, bailed on null too. App.tsx
 * holds the whole app on that screen until `onDone` fires. So one unanswered
 * promise on a Galaxy A54 turned into an app that launches to a blank lavender
 * screen and never leaves it, with no error in logcat because nothing threw.
 * Found on a real phone (2026-08-15); the emulator always answered.
 *
 * This helper removes the third state. It resolves false on rejection, and
 * false again if the query has not answered within the timeout — "assume
 * animation is fine" is the safe default, because guessing wrong costs a
 * reduce-motion user one animation, while hanging costs everyone the app.
 */

/**
 * How long to wait before assuming the OS is not going to answer. Long enough
 * that a slow-but-working device still gets its real setting, short enough that
 * a screen gated on the answer does not look broken.
 */
const REDUCE_MOTION_TIMEOUT_MS = 1200;

export function queryReduceMotion(timeoutMs: number = REDUCE_MOTION_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        clearTimeout(timer);
        finish(Boolean(enabled));
      })
      .catch(() => {
        clearTimeout(timer);
        finish(false);
      });
  });
}
