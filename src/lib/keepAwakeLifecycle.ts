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

/**
 * The newest handle per tag. A late release from an old handle (its activation
 * settled after the view was gone) must not switch off a tag a newer handle
 * has taken since: the screen went to sleep mid-workout.
 */
const latestGeneration = new Map<string, number>();

export function startKeepAwake(
  activate: () => Promise<unknown>,
  deactivate: () => unknown,
  tag?: string,
): KeepAwakeHandle {
  let generation = 0;
  if (tag !== undefined) {
    generation = (latestGeneration.get(tag) ?? 0) + 1;
    latestGeneration.set(tag, generation);
  }
  let released = false;
  let activated = false;
  let deactivated = false;

  const safeDeactivate = () => {
    if (deactivated) {
      return;
    }
    deactivated = true;
    if (tag !== undefined) {
      if (latestGeneration.get(tag) !== generation) {
        return;
      }
      latestGeneration.delete(tag);
    }
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
