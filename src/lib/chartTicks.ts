/**
 * Rounded Y-axis ticks for a line chart. A chart that pads its range by a
 * percentage prints values like 77.38 / 74.54 on the axis; a person reads
 * 70 / 75 / 80. Pure: the caller draws.
 *
 * Returns ascending ticks that cover [min, max], on a "nice" step
 * (1, 2, 2.5 or 5 times a power of ten), at most `maxTicks` of them.
 */
export function niceTicks(min: number, max: number, maxTicks = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const intervals = Math.max(1, Math.floor(maxTicks) - 1);
  const spread = high - low;
  if (spread === 0) {
    const step = low === 0 ? 1 : niceStep(Math.abs(low) * 0.1);
    return [roundTick(low - step), roundTick(low), roundTick(low + step)];
  }
  let step = niceStep(spread / intervals);
  // The covering range can need one interval more than the raw spread
  // suggests; widen the step until it fits the cap.
  for (let guard = 0; guard < 8; guard += 1) {
    const first = Math.floor(low / step + 1e-9) * step;
    const last = Math.ceil(high / step - 1e-9) * step;
    if (Math.round((last - first) / step) <= intervals) {
      break;
    }
    step = niceStep(step * 1.01);
  }
  const first = Math.floor(low / step + 1e-9) * step;
  const last = Math.ceil(high / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = first; value <= last + step * 1e-6; value += step) {
    ticks.push(roundTick(value));
  }
  return ticks;
}

/** The smallest 1/2/2.5/5/10 x 10^n step that is at least `raw`. */
function niceStep(raw: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * magnitude >= raw - 1e-12) {
      return factor * magnitude;
    }
  }
  return 10 * magnitude;
}

function roundTick(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
