/**
 * Level tiers for the onboarding level step's motion field.
 *
 * Data, so it lives here rather than beside the launch machinery: the motion
 * module imports react-native for its easings, which puts it out of reach of
 * the plain-Node test runner. The `MotionBar` shape comes across as a type-only
 * import, which compiles away entirely.
 */

import type { MotionBar } from '../components/vinhaMotion';

/**
 * The onboarding level step's field, in the same bar language as the launch.
 *
 * This replaced a ring of flame emoji around the wordmark. The bars say the
 * same thing the app's name does — *vinha* means fast — and they can say it in
 * degrees, which a flame cannot: the tiers below get denser AND quicker as the
 * level rises (2 bars at ~1.5 s, 4 at ~1.1 s, 7 at ~0.75 s over the same
 * distance), so the difference is legible at a glance and again in the
 * tempo.
 *
 * Coordinates are inside the 280 × 140 logo box, not the screen canvas, so `y`
 * is used raw here rather than through `scaleY`. Delays stay negative so every
 * bar is already mid-flight on the first paint, and switching level never
 * shows an empty box filling in.
 */
export const LEVEL_STREAKS: MotionBar[][] = [
  [
    { y: 34, width: 74, height: 5, ms: 1520, delay: -600, accent: true, opacity: 0.22 },
    { y: 104, width: 52, height: 4, ms: 1740, delay: -1200, accent: false, opacity: 0.12 },
  ],
  [
    { y: 22, width: 62, height: 4, ms: 1180, delay: -300, accent: false, opacity: 0.14 },
    { y: 48, width: 96, height: 6, ms: 1020, delay: -700, accent: true, opacity: 0.26 },
    { y: 96, width: 80, height: 5, ms: 1240, delay: -200, accent: true, opacity: 0.2 },
    { y: 118, width: 46, height: 4, ms: 1400, delay: -900, accent: false, opacity: 0.11 },
  ],
  [
    { y: 12, width: 54, height: 4, ms: 840, delay: -400, accent: false, opacity: 0.14 },
    { y: 30, width: 104, height: 6, ms: 700, delay: -150, accent: true, opacity: 0.3 },
    { y: 52, width: 78, height: 5, ms: 780, delay: -520, accent: true, opacity: 0.24 },
    { y: 74, width: 122, height: 7, ms: 620, delay: -260, accent: true, opacity: 0.34 },
    { y: 98, width: 66, height: 4, ms: 900, delay: -640, accent: false, opacity: 0.16 },
    { y: 116, width: 92, height: 5, ms: 740, delay: -80, accent: true, opacity: 0.22 },
    { y: 132, width: 44, height: 3, ms: 960, delay: -800, accent: false, opacity: 0.12 },
  ],
];
