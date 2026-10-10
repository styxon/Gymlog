/**
 * Runs `attempt` unless this key has been tried, remembering the key in `tried`.
 *
 * For effects that write a stamp or repair when a stored value is missing. The
 * write is applied optimistically and rolled back when the disk refuses it
 * (AppProvider.updatePreferences), so the value the effect watches flips
 * back and the effect runs again - a refused write was retried for as long as
 * the app stayed open, each try another failed write and another unhandled
 * rejection. Tried once per key; a write that landed forgets the key, so the
 * same repair can be owed again. A refusal is handed to `onRefused`, and the
 * key stays until releaseRefused.
 */
export function attemptOnce(
  tried: Set<string>,
  key: string,
  attempt: () => Promise<unknown>,
  onRefused?: (error: unknown) => void,
): void {
  if (tried.has(key)) {
    return;
  }
  tried.add(key);
  let running: Promise<unknown>;
  try {
    running = Promise.resolve(attempt());
  } catch (error) {
    onRefused?.(error);
    return;
  }
  running.then(
    () => {
      tried.delete(key);
    },
    (error) => onRefused?.(error),
  );
}

/**
 * Forgets the keys whose write was refused, so each gets one more try. True
 * when there was any: the caller then re-runs its effects. Called when the app
 * returns to the foreground, so a refusal costs one retry per foreground, not a loop.
 */
export function releaseRefused(tried: Set<string>, refused: Set<string>): boolean {
  if (refused.size === 0) {
    return false;
  }
  for (const key of refused) {
    tried.delete(key);
  }
  refused.clear();
  return true;
}
