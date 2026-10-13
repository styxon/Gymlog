import { Easing } from 'react-native';

/**
 * Shared geometry and timing for the Vinha launch sequence.
 *
 * The spec is written against a 392 × 812 reference canvas, so every position
 * here is scaled to the real screen rather than used raw — otherwise the
 * composition drifts up the taller the device is.
 *
 * The one that matters most: MARK_CENTER_SPLASH and MARK_CENTER_WELCOME are
 * both *centres*. Measuring one from the top and the other from the centre is
 * exactly what made the wordmark jump between the two screens.
 */
export const CANVAS_WIDTH = 392;
export const CANVAS_HEIGHT = 812;

/** Vertical centre of the lockup, on the reference canvas. */
export const MARK_CENTER_SPLASH = 247;
export const MARK_CENTER_WELCOME = 118;

/**
 * Wordmark base size.
 *
 * Was 74 for the short "Vinha" mark. The brand package (2026-08-19) puts the
 * full lockup — "Vinha Fitness" — on the splash and the welcome screen, and at
 * 74 that runs past a 360dp phone. 52 is the largest size at which the lockup
 * (≈6.4 em wide at −0,045 em tracking) clears the canvas with the same side
 * margins the short mark had. Every other distance here scales from it.
 */
export const MARK_SIZE = 52;

/**
 * How far the mark slides right during the hand-off.
 *
 * This existed for the "app" tag that used to fly off the splash and leave the
 * mark off-centre. The tag is gone — "Fitness" is part of the name now and
 * stays — so the lockup is already centred where Welcome draws it. Kept at
 * zero rather than removed so the hand-off maths stays one expression.
 */
export const HANDOFF_NUDGE = 0;

export function scaleY(height: number, value: number) {
  return (value / CANVAS_HEIGHT) * height;
}

/** Top edge for a centre-anchored slot of `size` height. */
export function markSlotTop(height: number, center: number, size = MARK_SIZE) {
  return scaleY(height, center) - size / 2;
}

/** cubic-bezier(0.12, 0.8, 0.2, 1) — arriving and settling. */
export const EASE_ARRIVE = Easing.bezier(0.12, 0.8, 0.2, 1);
/** cubic-bezier(0.35, 0, 0.25, 1) — the streaks. */
export const EASE_STREAK = Easing.bezier(0.35, 0, 0.25, 1);
/** cubic-bezier(0.35, 0, 0.2, 1) — the light sweep. */
export const EASE_SWEEP = Easing.bezier(0.35, 0, 0.2, 1);
/** cubic-bezier(0.16, 0.9, 0.2, 1) — the hand-off settle. */
export const EASE_SETTLE = Easing.bezier(0.16, 0.9, 0.2, 1);
/**
 * cubic-bezier(0.5, 0, 0.75, 0) — accelerating, never decelerating.
 *
 * This is the whole trick of the hand-off: the same 700 ms reads as *leaving
 * at speed* for the "app" tag and as *arriving* for the mark, purely because
 * one curve accelerates out and the other decelerates in.
 */
export const EASE_LEAVE = Easing.bezier(0.5, 0, 0.75, 1);
/**
 * Home's entrance stagger and everything that rides on it: the sections'
 * 16 px rise, and the first-run tour's callout, which lands on that page.
 */
export const EASE_RISE = Easing.bezier(0.22, 1, 0.36, 1);

export interface MotionBar {
  y: number;
  width: number;
  height: number;
  ms: number;
  delay: number;
  accent: boolean;
  opacity: number;
}

/** Splash streaks — 560 ms fastest to 1180 ms slowest over the same distance. */
export const STREAKS: MotionBar[] = [
  { y: 214, width: 116, height: 6, ms: 700, delay: 60, accent: true, opacity: 0.2 },
  { y: 266, width: 62, height: 4, ms: 1020, delay: 0, accent: false, opacity: 0.13 },
  { y: 318, width: 178, height: 9, ms: 560, delay: 180, accent: true, opacity: 0.32 },
  { y: 470, width: 90, height: 5, ms: 880, delay: 120, accent: false, opacity: 0.1 },
  { y: 512, width: 148, height: 7, ms: 640, delay: 300, accent: true, opacity: 0.24 },
  { y: 566, width: 46, height: 4, ms: 1180, delay: 220, accent: false, opacity: 0.12 },
  { y: 612, width: 124, height: 5, ms: 760, delay: 420, accent: true, opacity: 0.16 },
  { y: 668, width: 74, height: 3, ms: 980, delay: 500, accent: false, opacity: 0.09 },
];

/** Splash timings, in ms from mount. */
export const T = {
  markDelay: 900,
  markDuration: 900,
  ghostStagger: 55,
  sweepDelay: 940,
  sweepDuration: 640,
  sloganDelay: 1700,
  sloganDuration: 700,
  handoffAt: 2500,
  handoffDuration: 700,
  sloganFadeOut: 200,
} as const;
