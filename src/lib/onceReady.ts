/**
 * Runs an async setup once and hands every caller the same promise.
 *
 * The cue sounds need the audio session configured (mix with the user's music)
 * BEFORE the first sound starts: a fire-and-forget setup let iOS activate its
 * default session for the first cue, which cut the user's music for a moment
 * (#to-do, G1-8). Callers await this, then play.
 *
 * The returned promise never rejects: a setup that throws is best-effort, and
 * the cue still plays rather than the workout going quiet. A setup that is
 * still pending after `maxWaitMs` also lets the cue through, so a stuck native
 * call cannot silence a session. `wait` is injected so the lib stays free of
 * timers and the rule is testable.
 */
export function createOnceReady(
  setup: () => Promise<unknown>,
  wait?: (ms: number) => Promise<void>,
  maxWaitMs = 1500,
): () => Promise<void> {
  let ready: Promise<void> | null = null;
  return () => {
    if (!ready) {
      const done: Promise<void> = Promise.resolve()
        .then(setup)
        .then(
          () => undefined,
          () => undefined,
        );
      ready = wait ? Promise.race([done, wait(maxWaitMs)]) : done;
    }
    return ready;
  };
}

/** A cue still waiting for the audio mode after this long is dropped. */
const CUE_STALE_MS = 500;

/**
 * Runs a cue once the audio mode is ready, unless the cue's moment has passed.
 *
 * A countdown beep that arrives a second late is worse than none, and when the
 * setup is slow every waiting cue is released at the same instant and they all
 * fire together. So a cue records when it was asked for and, on release, is
 * dropped if it waited longer than `staleMs`. The clock is injected.
 */
export function createCueGate(
  ready: () => Promise<void>,
  now: () => number,
  staleMs = CUE_STALE_MS,
): (play: () => void) => void {
  return (play) => {
    const askedAt = now();
    void ready().then(() => {
      if (now() - askedAt > staleMs) {
        return;
      }
      play();
    });
  };
}
