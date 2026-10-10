import { useCallback, useRef } from 'react';

import { attemptOnce } from '../lib/attemptOnce';

/**
 * `attemptOnce` with its memory kept for the life of the screen that calls it.
 * The returned function is stable, so it can sit in an effect's deps.
 */
export function useAttemptOnce(): (key: string, attempt: () => Promise<unknown>) => void {
  const tried = useRef<Set<string>>(new Set());
  return useCallback((key, attempt) => attemptOnce(tried.current, key, attempt), []);
}
