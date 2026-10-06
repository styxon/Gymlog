/**
 * How much of the workout's contents fits on the walk-up screen.
 *
 * "Jos mahtuu, olisi hyvä tässäkin ruudussa olla koko ohjelman sisältö
 * luettavissa" (#bugs 2026-10-06). The walk-up ("SEURAAVAKSI …") has room
 * between its cards and its buttons on most phones, and the reader wanted the
 * contents sheet's rows there. On a short phone there is less room, or none,
 * and the buttons are never what gives way: this answers how many rows the
 * leftover space holds and which ones.
 *
 * The rows are a contiguous run of the session, in order. The lift being
 * walked up to comes first, then what follows it; done rows fill in from
 * above only when the end of the session leaves room. When not every row
 * fits, the last line of the space says how many are left out (the caller
 * draws it, and the full sheet is one tap away), so that line takes a row.
 */
export interface RunPreviewFitInput {
  /** Rows in the session (the contents sheet's items). */
  count: number;
  /** The row being walked up to; -1 when none is current. */
  currentIndex: number;
  /** Height left over for the whole block, heading included. */
  availableHeight: number;
  /** The block's heading, with its gap to the first row. */
  headHeight: number;
  /** One row, fixed: the caller draws rows at exactly this height. */
  rowHeight: number;
}

export interface RunPreviewWindow {
  /** First row shown (inclusive). */
  start: number;
  /** One past the last row shown. */
  end: number;
  /** Rows after the window — the "+N" line, 0 when nothing is left to come. */
  hidden: number;
}

export function fitRunPreview({
  count,
  currentIndex,
  availableHeight,
  headHeight,
  rowHeight,
}: RunPreviewFitInput): RunPreviewWindow | null {
  if (count <= 0 || rowHeight <= 0 || !Number.isFinite(availableHeight)) {
    return null;
  }
  const rows = Math.floor((availableHeight - Math.max(0, headHeight)) / rowHeight);
  if (rows >= count) {
    return { start: 0, end: count, hidden: 0 };
  }
  // One row goes to the "+N" line; a heading over a lone "+N" says nothing
  // the rail does not, so less than one real row is no block at all.
  const visible = rows - 1;
  if (visible < 1) {
    return null;
  }
  const anchor = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  if (anchor + rows >= count) {
    // Nothing left after the window, so no "+N" line: its row goes to one
    // more done row above, and the last rows of the session fill the space.
    return { start: count - rows, end: count, hidden: 0 };
  }
  // "+N muuta" counts what is still to come. The done rows above the window
  // are not "more": on lift 7 of 9 it said "+6" for six lifts already done
  // (review, 2026-10-06).
  const start = anchor;
  const end = anchor + visible;
  return { start, end, hidden: count - end };
}
