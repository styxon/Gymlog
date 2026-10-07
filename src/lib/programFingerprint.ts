/**
 * A program's week, drawn as bars.
 *
 * The browse design put generated covers on every card and called the bars a
 * "fingerprint" of the program's time distribution — which is the best idea in
 * that file, because it solves 55 programs with no photography and never looks
 * like stock. Its implementation did not do it: the bar heights came from
 * `0.32 + 0.62 * |sin(t * 3.1 + split[0] / 100 * 2.4)|`, a sine wave whose
 * phase one number nudged. Two programs with the same first number drew the
 * same cover, and the number itself encoded nothing.
 *
 * This encodes the one thing a program really is: how the work is spread
 * across the week. One bar per session, height proportional to that session's
 * working sets. So a 2-day full-body program is two tall bars, a 6-day split is
 * six shorter ones, and a program with one heavy day and four light ones looks
 * like that — before you read a word of it.
 *
 * Bar COUNT is information too, which is why the count is not fixed: it is the
 * days per week, visible at a glance.
 */

/**
 * Heights in 0..1, one per session, in program order. Any week will do: a
 * card draws the reader's composed week when its page shows that one.
 */
export function buildProgramFingerprint(
  template: { sessions: ReadonlyArray<{ exercises: ReadonlyArray<{ sets: number }> }> },
): number[] {
  const sets = template.sessions.map((session) =>
    session.exercises.reduce((total, exercise) => total + Math.max(0, exercise.sets), 0),
  );

  const peak = Math.max(...sets, 0);
  if (!(peak > 0)) {
    // Nothing prescribed — a flat, quiet cover rather than a division by zero.
    return sets.map(() => 0.5);
  }

  return sets.map((value) => {
    // Floor at 0.25 so a light day is still a bar. A day that renders as a
    // hairline reads as a rendering fault, not as a light day.
    const ratio = value / peak;
    return Math.max(0.25, Math.min(1, ratio));
  });
}

/**
 * True when two programs would draw the same cover.
 *
 * Exposed for the test that keeps this honest: the point of a fingerprint is
 * that different programs differ, and a version that collapses everything to
 * one shape is worse than no bars at all — it looks like data and is not.
 */
export function fingerprintsMatch(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => Math.abs(value - right[index]) < 0.001);
}
