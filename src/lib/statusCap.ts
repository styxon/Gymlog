/**
 * How a full-screen page's cap over the status bar fades in as it scrolls.
 *
 * The workout summary and the saved workout run their hero under the clock
 * (the shell drops its top edge for them), and once they scrolled, the
 * record card and the stats went under the clock and the battery with
 * nothing between (owner's #5, iOS hunt 2026-10-17). The status bar's own
 * background colour cannot help: it is Android-only, and a no-op under
 * edge-to-edge. So the page draws the cap: clear at rest, where the hero
 * belongs under the clock, and solid once the page has moved by the height
 * of the bar.
 */
export function statusCapInterpolation(topInset: number): {
  inputRange: [number, number];
  outputRange: [number, number];
  extrapolate: 'clamp';
} {
  // One point at least: a phone with no inset (the cap is 0 tall there) must
  // still get a range that rises, or the interpolation divides by zero.
  const reach = Number.isFinite(topInset) && topInset > 1 ? topInset : 1;
  return { inputRange: [0, reach], outputRange: [0, 1], extrapolate: 'clamp' };
}
