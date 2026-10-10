/**
 * Runs `attempt` unless this key has been tried, remembering the key in `tried`.
 *
 * For effects that write a stamp or repair when a stored value is missing. The
 * write is applied optimistically and rolled back when the disk refuses it
 * (AppProvider.updatePreferences), so the value the effect watches flips
 * back and the effect runs again - a refused write was retried for as long as
 * the app stayed open, each try another failed write and another unhandled
 * rejection. Tried once per key: a refusal is left for the next launch, and a
 * write that landed forgets the key, so the same repair can be owed again.
 */
export function attemptOnce(tried: Set<string>, key: string, attempt: () => Promise<unknown>): void {
  if (tried.has(key)) {
    return;
  }
  tried.add(key);
  let running: Promise<unknown>;
  try {
    running = Promise.resolve(attempt());
  } catch {
    return;
  }
  running.then(
    () => {
      tried.delete(key);
    },
    () => undefined,
  );
}
