/**
 * The stored default rest, made usable.
 *
 * This lives here rather than inline in `normalizeDatabase` because of how its
 * first version failed. The rule was written as a ternary in the preferences
 * literal and guarded by a test that read the FILE:
 *
 *     assert.match(branch, /input\.preferences\.defaultRestSeconds > 0/);
 *
 * That test passes whether or not the rule is right — it pins the shape of the
 * code, not what the code decides — and it duly went green over a hole. The
 * positivity check ran on the raw value while the rounding happened after it,
 * so a stored `0.3` cleared `> 0` and then `Math.round` turned it into exactly
 * the `0` the guard existed to reject. Found by the PR reviewer on #32.
 *
 * A pure function can be required in Node and asked what it returns, so the
 * test below asserts decisions instead of syntax. Round first, then judge.
 */

/** Ten minutes. Longer than any rest between sets, short of a stored absurdity. */
export const MAX_DEFAULT_REST_SECONDS = 600;

/**
 * @param value  whatever the stored preferences held — any type, from an
 *               install several versions old or from a corrupted write.
 * @param fallback the app default, used whenever `value` cannot be a rest.
 */
export function normalizeDefaultRestSeconds(value: unknown, fallback: number): number {
  // `typeof NaN === 'number'`, and NaN survives Math.min, Math.round and the
  // countdown arithmetic to reach the reader as a bar frozen at 0:00 that
  // never ends. Infinity does the same in the other direction.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  if (rounded <= 0) {
    return fallback;
  }

  return Math.min(rounded, MAX_DEFAULT_REST_SECONDS);
}

/**
 * The longest stored rest read back as written: an hour. Wider than the
 * editor's 480 s on purpose — the frozen CSV/Hevy import stores whatever its
 * file said (a 15-minute rest between heavy singles is real), and a cap the
 * loader applied would be saved back over it. Past an hour is a damaged row.
 */
export const MAX_STORED_REST_SECONDS = 3600;

/**
 * A stored exercise's own rest, made usable: null when it is not a number,
 * else rounded, at least 0 and at most MAX_STORED_REST_SECONDS.
 *
 * The one rule the template loader, the template writer (singleRepTarget
 * savedRestSeconds) and the workout adapter read (duplicate sweep 13, D6-4).
 * The loader kept any number — a damaged row loaded a -30 s rest, which only
 * the adapter's own guard hid, or a 27-hour one nothing hid.
 *
 * It differs from the default rest above on purpose, in one place: 0 is a
 * real rest here (a stretch is written with none) while a default rest of 0
 * is unusable. A negative number is unset (null), as the writer always read
 * it; past the ceiling is capped, as the default is, but at a wider one.
 */
export function normalizeStoredRestSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.min(Math.round(value), MAX_STORED_REST_SECONDS);
}
