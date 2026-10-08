import { useMemo } from 'react';

export interface ActiveWorkoutSummary {
  title: string;
  nextExercise: string | null;
  meta: string;
}

/**
 * The running workout's Home/coach summary as a value that holds still.
 *
 * The shell builds the summary from the running session, and that session is
 * replaced on every set logged, rest ended and step moved. A summary built
 * from it each time is a new object each time, and the coach context lists
 * the summary among its memo's inputs, so the whole training context was
 * rebuilt on every Log tap though title, next exercise and meta were the same
 * strings. Keyed on those strings, it changes when they do.
 */
export function useStableActiveWorkoutSummary(parts: ActiveWorkoutSummary | null): ActiveWorkoutSummary | null {
  const running = parts !== null;
  const title = parts?.title ?? '';
  const nextExercise = parts?.nextExercise ?? null;
  const meta = parts?.meta ?? '';
  return useMemo(
    () => (running ? { title, nextExercise, meta } : null),
    [running, title, nextExercise, meta],
  );
}
