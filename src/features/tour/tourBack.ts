/**
 * Who answers Android's back key while a tour callout is up.
 *
 * The page under a beat is shielded from touches, but the hardware key is not
 * a touch: it reaches whichever screen listens, and the guided player's
 * listener opens its End-workout sheet. BackHandler calls the newest listener
 * first, and which of the tour's, the player's and the route's is newest
 * depends on effect order - which moves whenever one of them re-subscribes.
 * So precedence is not left to order. The tour layer holds the key here while
 * a callout is on screen, and the two listeners that could answer under it ask
 * first (consumeBackForTour) and stand down when it was taken.
 *
 * Module state, because it is shared by three files that have nothing else in
 * common, and there is only ever one tour on screen.
 */

let heldBy: (() => void) | null = null;

/**
 * The tour takes the back key until it calls the returned release. The release
 * only lets go of its own hold: a layer that is replaced (Home's tour giving
 * way to the player's) must not clear the hold of the one that took over.
 */
export function holdBackForTour(onBack: () => void): () => void {
  heldBy = onBack;
  return () => {
    if (heldBy === onBack) {
      heldBy = null;
    }
  };
}

/** Is a tour callout holding the key? */
export function isBackHeldByTour(): boolean {
  return heldBy !== null;
}

/**
 * For a back listener to call first: true when a tour callout took the key
 * (and has answered it, by skipping the tour), so the listener returns true
 * without doing its own thing.
 */
export function consumeBackForTour(): boolean {
  const onBack = heldBy;
  if (!onBack) {
    return false;
  }
  onBack();
  return true;
}
