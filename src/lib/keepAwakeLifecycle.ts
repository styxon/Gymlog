/**
 * The lifecycle of one keep-awake request, apart from the native module.
 *
 * Activation is asynchronous. A workout view left right after it opened
 * unmounted while activation was still pending, the cleanup saw "not active
 * yet" and never deactivated, and the screen stayed awake after the workout
 * was gone. The release is therefore remembered: whichever of the two finishes
 * last (the activation, the release) makes sure the tag ends deactivated.
 */
export interface KeepAwakeHandle {
  /** Ends the request now, or as soon as a pending activation settles. */
  release(): void;
}

export function startKeepAwake(
  activate: () => Promise<unknown>,
  deactivate: () => unknown,
): KeepAwakeHandle {
  let released = false;
  let activated = false;
  let deactivated = false;

  const safeDeactivate = () => {
    if (deactivated) {
      return;
    }
    deactivated = true;
    try {
      void Promise.resolve(deactivate()).catch(() => {
        // Same rule on the way out: comfort feature, never a crash.
      });
    } catch {
      // Same rule on the way out.
    }
  };

  let pending: Promise<unknown>;
  try {
    pending = activate();
  } catch {
    pending = Promise.reject(new Error('activation failed'));
  }
  pending.then(
    () => {
      activated = true;
      if (released) {
        safeDeactivate();
      }
    },
    () => {
      // Keep-awake is a comfort feature; ignore activation failures.
    },
  );

  return {
    release() {
      released = true;
      if (activated) {
        safeDeactivate();
      }
    },
  };
}
