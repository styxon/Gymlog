/**
 * The lifecycle of one keep-awake request, apart from the native module.
 *
 * Activation is asynchronous. A workout view left right after it opened
 * unmounted while activation was still pending, the cleanup saw "not active
 * yet" and never deactivated, and the screen stayed awake after the workout
 * was gone. The release is therefore remembered: whichever of the two finishes
 * last (the activation, the release) makes sure the tag ends deactivated.
 */
interface KeepAwakeHandle {
  /** Ends the request now, or as soon as a pending activation settles. */
  release(): void;
}

/**
 * Live holders per tag. A tag is switched off only when the last holder has
 * left, whichever handle that is:
 * - a late release or late activation of an old handle must not switch off a
 *   tag a newer handle holds (the screen went to sleep mid-workout);
 * - a newer handle whose activation failed holds nothing, so the older
 *   activated handle's release still switches the tag off;
 * - handle ids come from one counter that never restarts, so a stale pending
 *   activation can never be mistaken for a newer handle.
 */
interface TagState {
  /** Handles that are neither released nor failed. */
  holders: Set<number>;
  /** An activation has succeeded and the tag has not been deactivated since. */
  maybeOn: boolean;
}

const tagStates = new Map<string, TagState>();
let nextHandleId = 1;

function runDeactivate(deactivate: () => unknown) {
  try {
    void Promise.resolve(deactivate()).catch(() => {
      // Same rule on the way out: comfort feature, never a crash.
    });
  } catch {
    // Same rule on the way out.
  }
}

export function startKeepAwake(
  activate: () => Promise<unknown>,
  deactivate: () => unknown,
  tag?: string,
): KeepAwakeHandle {
  const id = nextHandleId++;
  let state: TagState | undefined;
  if (tag !== undefined) {
    state = tagStates.get(tag);
    if (!state) {
      state = { holders: new Set(), maybeOn: false };
      tagStates.set(tag, state);
    }
    state.holders.add(id);
  }
  let released = false;
  let activated = false;
  let deactivated = false;

  /** Switches the tag off if nobody holds it any more. */
  const settle = () => {
    if (tag === undefined || !state) {
      if (!deactivated && released && activated) {
        deactivated = true;
        runDeactivate(deactivate);
      }
      return;
    }
    if (state.holders.size > 0) {
      return;
    }
    if (state.maybeOn) {
      state.maybeOn = false;
      runDeactivate(deactivate);
    }
    // The state stays in the map: a pending activation may still settle into
    // it, and a handle started meanwhile must share it. Tags are few.
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
      if (state) {
        state.maybeOn = true;
      }
      if (released) {
        settle();
      }
    },
    () => {
      // Keep-awake is a comfort feature; ignore activation failures. A failed
      // handle holds nothing: if it was the last one, an older activation
      // that is still on must now be switched off.
      if (state) {
        state.holders.delete(id);
        settle();
      }
    },
  );

  return {
    release() {
      released = true;
      if (state) {
        state.holders.delete(id);
        settle();
      } else if (activated) {
        settle();
      }
    },
  };
}
