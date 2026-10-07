/**
 * Which of the guided player's overlays stop its step clock.
 *
 * A timed step (a rest, a drill, a get-ready count) runs off a wall-clock
 * deadline. While the clock is held the deadline is dropped, the leftover time
 * is kept, and the rest's OS alert is withdrawn; when the hold ends the
 * deadline is re-derived from what was left. So anything listed here is a
 * pause, whether or not the reader asked for one.
 *
 * Every overlay that asks the reader to decide or type something holds the
 * clock: a rest that ran out behind a half-made correction would move the
 * session on underneath it.
 *
 * The contents sheet ("Treenin sisältö") does NOT. It is a list to read —
 * what is done, where you are, what is left — and reading it is what a rest
 * is for. It held the clock from 2026-09-16 (a rest that expired under it moved
 * the lift the reader was about to correct), and the reader found the rest
 * standing still every time they looked ahead (#bugs 2026-10-06, "rest timer
 * ei saa pysähtyä kun selaa mitä on jäljellä"). Every lift with a logged set
 * now carries its own pencil in the sheet, so a rest that ends under it no
 * longer takes anything away from under the thumb, and the pencil itself
 * opens the correction sheet, which does hold.
 */
export interface GuidedOverlayState {
  /** The reader's own Pause. */
  paused: boolean;
  howToOpen: boolean;
  exitOpen: boolean;
  pauseSheetOpen: boolean;
  swapOpen: boolean;
  addExerciseOpen: boolean;
  /** The rest screen's correction of a logged set. */
  restEditOpen: boolean;
  /** The contents sheet. Listed so that leaving it out is a decision, not an oversight. */
  runSheetOpen: boolean;
  /** "I'll do the warm-up / cool-down myself" — the waiting room. */
  ownBlockActive: boolean;
  /** The one-time rest-alert permission ask. */
  restAlertsAskOpen: boolean;
}

export function guidedClockHeld(state: GuidedOverlayState): boolean {
  return (
    state.paused ||
    state.howToOpen ||
    state.exitOpen ||
    state.pauseSheetOpen ||
    state.swapOpen ||
    state.addExerciseOpen ||
    state.restEditOpen ||
    state.ownBlockActive ||
    state.restAlertsAskOpen
  );
}
