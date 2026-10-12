/**
 * Is this stored value a date the app can sort and print?
 *
 * A string `Date.parse` reads. That is the whole rule, and every loader of a
 * stored date asks it here (duplicate sweep 13, D6-7). Most of them asked
 * `typeof value === 'string'` alone, so a saved workout dated "garbage" loaded,
 * and the history list, the recent-sessions card and the coach then threw a
 * RangeError formatting it. What a loader does with a date that fails is its
 * own decision — a session or a weigh-in without one is dropped, a preference
 * falls back to its default — but the question is one.
 *
 * Leaf module: no imports, so any loader can use it.
 */
export function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
