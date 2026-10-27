/**
 * Where the diagonal seam runs on "Your programme is ready".
 *
 * Two programmes share the screen, split by a slanted seam; the chosen one
 * swells and the other collapses to its name. The seam used to sit at fixed
 * fractions of the height, and the chosen card grew: the week strip moved
 * into it (2026-09-07/09), so a chosen LOWER card — bottom-anchored in a box
 * that fraction had sized — overflowed upward past the seam, and its name
 * ended up behind the upper half (device, 2026-09-16). On a shorter screen the
 * collapsed half's name had the same problem from the other side.
 *
 * So the fractions are where the seam would like to be, and the measured
 * content decides where it can be. The collapsed programme's name is kept
 * first — it is two lines at most, and a programme you cannot read is a
 * programme you cannot choose — and the chosen card gets what it needs, plus
 * up to PICK_MAX_SLACK; the collapsed card gets the rest.
 */

/** Where the seam sits with nothing measured: [left edge, right edge]. */
export const PICK_SEAM_TOP_SELECTED: readonly [number, number] = [0.64, 0.58];
export const PICK_SEAM_BOTTOM_SELECTED: readonly [number, number] = [0.44, 0.36];

/** The clear band either side of the slant, as fractions of the height. */
export const PICK_TOP_CLEARANCE = 0.03;
export const PICK_BOTTOM_CLEARANCE = 0.04;
/** The top half's own padding above its content, in points. */
export const PICK_TOP_PADDING = 18;
/**
 * The most empty room the chosen card's box keeps under (or over) its
 * content, in points. The rest goes to the collapsed card. Without it the
 * chosen box grew with the phone and its content did not: on a tall iPhone a
 * fifth of the screen was empty purple under the week strip (owner's #3, iOS
 * hunt 2026-10-17).
 */
export const PICK_MAX_SLACK = 48;

interface PickSeamInput {
  /** The split area's height, in points. Zero before it is measured. */
  height: number;
  topSelected: boolean;
  /** The chosen card's natural height, in points; zero when not yet measured. */
  selectedContentHeight: number;
  /** The collapsed card's natural height, in points; zero when not yet measured. */
  collapsedContentHeight: number;
  /** The room the pinned button takes at the foot of the screen. */
  ctaRoom: number;
}

/**
 * The seam's two ends, as fractions of the height.
 *
 * Top chosen: the top box runs from the top to the seam's HIGHER end, less the
 * clearance; the bottom box from the seam's LOWER end, plus the clearance, to
 * the button. Bottom chosen: the same boxes, with the chosen card below.
 * Moving the whole seam keeps its slant.
 */
export function resolvePickSeam(input: PickSeamInput): [number, number] {
  const { height, topSelected, selectedContentHeight, collapsedContentHeight, ctaRoom } = input;
  const base = topSelected ? PICK_SEAM_TOP_SELECTED : PICK_SEAM_BOTTOM_SELECTED;
  if (!(height > 0)) {
    return [base[0], base[1]];
  }

  const low = Math.min(base[0], base[1]);
  const high = Math.max(base[0], base[1]);
  // The highest the seam's lower end may sit and the lowest its higher end
  // may sit, each from what one box has to hold. `shift` moves the whole seam
  // down (positive) or up (negative).
  let shift = 0;

  if (topSelected) {
    // The chosen top card wants the seam low enough.
    const topNeeds = (selectedContentHeight + PICK_TOP_PADDING) / height + PICK_TOP_CLEARANCE;
    const down = selectedContentHeight > 0 ? Math.max(0, topNeeds - low) : 0;
    // The collapsed bottom name wants it high enough.
    const bottomRoom = 1 - PICK_BOTTOM_CLEARANCE - (collapsedContentHeight + ctaRoom) / height;
    const up = collapsedContentHeight > 0 ? Math.max(0, high - bottomRoom) : 0;
    // The collapsed name first; the chosen card gets what is left.
    shift = up > 0 ? -up : Math.min(down, Math.max(0, bottomRoom - high));
    // And no more than it can fill: the seam rises to the chosen card.
    if (selectedContentHeight > 0 && collapsedContentHeight > 0) {
      const slack = (low + shift - PICK_TOP_CLEARANCE) * height - (selectedContentHeight + PICK_TOP_PADDING);
      if (slack > PICK_MAX_SLACK) {
        shift -= (slack - PICK_MAX_SLACK) / height;
      }
    }
  } else {
    // The chosen bottom card wants the seam high enough.
    const bottomRoom = 1 - PICK_BOTTOM_CLEARANCE - (selectedContentHeight + ctaRoom) / height;
    const up = selectedContentHeight > 0 ? Math.max(0, high - bottomRoom) : 0;
    // The collapsed top name wants it low enough.
    const topNeeds = (collapsedContentHeight + PICK_TOP_PADDING) / height + PICK_TOP_CLEARANCE;
    const down = collapsedContentHeight > 0 ? Math.max(0, topNeeds - low) : 0;
    shift = down > 0 ? down : -Math.min(up, Math.max(0, low - topNeeds));
    // The same bound from below: the seam drops to the chosen card.
    if (selectedContentHeight > 0 && collapsedContentHeight > 0) {
      const slack = height - ctaRoom - (high + shift + PICK_BOTTOM_CLEARANCE) * height - selectedContentHeight;
      if (slack > PICK_MAX_SLACK) {
        shift += (slack - PICK_MAX_SLACK) / height;
      }
    }
  }

  // Never off the screen, whatever was measured.
  const clamp = (value: number) => Math.min(0.92, Math.max(0.08, value));
  return [clamp(base[0] + shift), clamp(base[1] + shift)];
}
