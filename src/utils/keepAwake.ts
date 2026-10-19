import { useEffect } from 'react';
import { startKeepAwake } from '../lib/keepAwakeLifecycle';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Keeps the screen on while a training surface is mounted and the
 * keepScreenAwakeDuringWorkout preference is enabled. Failure-tolerant like
 * the sound/haptics utils — a missing native module must never crash a
 * workout.
 */
export function useKeepScreenAwake(enabled: boolean, tag: string) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handle = startKeepAwake(
      () => activateKeepAwakeAsync(tag),
      () => deactivateKeepAwake(tag),
    );
    return () => handle.release();
  }, [enabled, tag]);
}
