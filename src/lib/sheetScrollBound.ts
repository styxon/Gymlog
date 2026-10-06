/**
 * How tall a bottom sheet's scrolling list may be, from measured numbers.
 *
 * The guided player's contents sheet ("Treenin sisältö") sized its list from
 * the window — 78 % of `useWindowDimensions().height`, less a guessed 160 for
 * everything around the list. Inside a Modal the window is not the space the
 * sheet stands in, and the 160 did not count the phone's own button bar, so
 * with nine lifts and more the end of the list sat past the bottom of the
 * sheet and could not be scrolled to (#bugs 2026-10-06, "pitää tehdä
 * scrollattava"; the same report as 2026-09-16, fixed then with the guess).
 *
 * Now every term is measured: the area the sheet's scrim actually covers, the
 * height of the sheet's own head (grip and title), and the bottom padding,
 * which carries the safe-area inset read on the screen (a Modal reads 0).
 */
export interface SheetScrollBoundInput {
  /** Height of the area the sheet stands in (its scrim), measured. */
  areaHeight: number;
  /** The sheet's height cap as a share of that area, e.g. 0.78. */
  capFraction: number;
  /** Everything above the list inside the sheet, measured: padding, grip, title. */
  headHeight: number;
  /** Everything below the list inside the sheet: its padding, safe-area inset included. */
  bottomPadding: number;
  /** Never less than this, so a tiny or not-yet-measured area cannot collapse the list. */
  minHeight?: number;
}

export function sheetScrollMaxHeight({
  areaHeight,
  capFraction,
  headHeight,
  bottomPadding,
  minHeight = 120,
}: SheetScrollBoundInput): number {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  const room = safe(areaHeight) * Math.min(Math.max(capFraction, 0), 1) - safe(headHeight) - safe(bottomPadding);
  return Math.max(minHeight, Math.floor(room));
}
