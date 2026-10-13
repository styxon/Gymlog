/**
 * How tall the exercise picture may be on a timed drill in the guided player.
 *
 * It was a fixed 270 dp. On a 720x1280 phone (640 dp tall) that left the
 * countdown — the one number the step is for — cut through the middle, with
 * "SECONDS LEFT" under the buttons, already at the default font size
 * (small-screen sweep, 2026-10-13). The rest of the step needs about
 * DRILL_RESERVED_DP: the top bar, the name, the countdown and its label, the
 * three buttons and the next line. The picture takes what is left, up to the
 * 270 it always had, so a tall phone looks exactly as before.
 *
 * A larger font grows the name and the labels (the countdown itself does not
 * scale), so the reserve grows with the font scale.
 */
export const DRILL_MEDIA_MAX_DP = 270;
export const DRILL_MEDIA_MIN_DP = 140;
const DRILL_RESERVED_DP = 470;
const RESERVED_PER_FONT_SCALE_DP = 120;

export function guidedDrillMediaHeight(windowHeight: number, fontScale = 1): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const reserved = DRILL_RESERVED_DP + (scale - 1) * RESERVED_PER_FONT_SCALE_DP;
  const room = Number.isFinite(windowHeight) ? windowHeight - reserved : DRILL_MEDIA_MAX_DP;
  return Math.round(Math.min(DRILL_MEDIA_MAX_DP, Math.max(DRILL_MEDIA_MIN_DP, room)));
}

/**
 * The same for the walk-up ("Next up") step's picture, a fixed 210 dp before.
 *
 * Under it sit the two stat cards (last time, today), and under those the
 * swap / add row and Start, which never scroll. On a 640 dp phone at a 1.3
 * font the picture pushed the stat cards under that row, where their tops
 * showed at the scroll edge as if the buttons sat on them (small-screen sweep,
 * 2026-10-13). They were reachable by scrolling, but a walk-up is read in one
 * glance or not at all. The floor is 90: at 110 a 640 dp phone at a 1.3 font
 * still left the cards 13 dp under the row (emulator check, 2026-10-13).
 */
export const WALK_MEDIA_MAX_DP = 210;
export const WALK_MEDIA_MIN_DP = 90;
const WALK_RESERVED_DP = 500;
const WALK_RESERVED_PER_FONT_SCALE_DP = 160;

export function guidedWalkMediaHeight(windowHeight: number, fontScale = 1): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const reserved = WALK_RESERVED_DP + (scale - 1) * WALK_RESERVED_PER_FONT_SCALE_DP;
  const room = Number.isFinite(windowHeight) ? windowHeight - reserved : WALK_MEDIA_MAX_DP;
  return Math.round(Math.min(WALK_MEDIA_MAX_DP, Math.max(WALK_MEDIA_MIN_DP, room)));
}
