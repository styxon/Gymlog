/**
 * A stored read, tried again when the phone refuses it.
 *
 * A locked or busy database is usually free a moment later, so a failed load
 * waits and tries again — three attempts, 400 ms and then 800 ms apart — and
 * only then reports failure, which the providers show as the storage error
 * screen rather than opening on an empty store. Both providers wrote this loop
 * out in full; a change to the policy had to be made twice and would not have
 * been.
 *
 * `isCancelled` is asked after every await: a provider that unmounted, or
 * started another attempt, must not have this one land.
 */
type LoadWithRetryResult<T> =
  | { kind: 'loaded'; value: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'cancelled' };

export const LOAD_ATTEMPTS = 3;
const LOAD_BACKOFF_MS = 400;

export async function loadWithRetry<T>(
  load: () => Promise<T>,
  options: {
    isCancelled: () => boolean;
    onError?: (error: unknown, attempt: number) => void;
    /** Injected in tests; the app waits on a real timer. */
    wait?: (ms: number) => Promise<void>;
  },
): Promise<LoadWithRetryResult<T>> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      const value = await load();
      return options.isCancelled() ? { kind: 'cancelled' } : { kind: 'loaded', value };
    } catch (error) {
      options.onError?.(error, attempt);
      if (options.isCancelled()) {
        return { kind: 'cancelled' };
      }
      if (attempt >= LOAD_ATTEMPTS) {
        return { kind: 'failed', error };
      }
      await wait(LOAD_BACKOFF_MS * attempt);
      if (options.isCancelled()) {
        return { kind: 'cancelled' };
      }
    }
  }
}
