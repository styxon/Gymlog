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
