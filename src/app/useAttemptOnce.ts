import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { attemptOnce, releaseRefused } from '../lib/attemptOnce';

/**
 * `attemptOnce` with its memory kept for the life of the screen that calls it.
 *
 * A refused write is logged and left until the app next comes to the front,
 * when it gets one more try: the returned function changes then, which re-runs
 * the effects that list it. Between foregrounds it is stable.
 */
export function useAttemptOnce(): (key: string, attempt: () => Promise<unknown>) => void {
  const tried = useRef<Set<string>>(new Set());
  const refused = useRef<Set<string>>(new Set());
  const [round, setRound] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && releaseRefused(tried.current, refused.current)) {
        setRound((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);
  return useCallback(
    (key, attempt) =>
      attemptOnce(tried.current, key, attempt, (error) => {
        refused.current.add(key);
        console.warn(`Preference write "${key}" was refused; tried again when the app returns to the front`, error);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round],
  );
}
