/**
 * The programme builder's answer to an exit that does not go through its Back
 * (a tab, the AI button, a widget or notification tap, the lock screen).
 *
 * Pure: the screen hands in what it knows and what to do about it, so the rule
 * can be run without a screen.
 *
 * - Mid-save the exit is held, not dropped: it goes on when the save lands, or
 *   asks the leave question if the programme was not saved.
 * - A clean draft lets the exit through (false).
 * - Unsaved work asks the question, and the exit waits on the answer.
 */
export interface TemplateLeaveGuardState {
  isSaving: () => boolean;
  hasUnsavedWork: () => boolean;
  /** Keep the exit until the running save ends. */
  hold: (leave: () => void) => void;
  /** Open the leave question; its answer runs or drops the exit. */
  ask: (leave: () => void) => void;
}

/** True when the guard took the exit over, false when it may go straight on. */
export function createTemplateLeaveGuard(state: TemplateLeaveGuardState): (leave: () => void) => boolean {
  return (leave) => {
    if (state.isSaving()) {
      state.hold(leave);
      return true;
    }
    if (!state.hasUnsavedWork()) {
      return false;
    }
    state.ask(leave);
    return true;
  };
}

/**
 * An exit held through a save: it goes on once the programme was saved, and
 * otherwise waits on the leave question.
 */
export function releaseHeldLeave(
  held: () => void,
  saved: boolean,
  ask: (leave: () => void) => void,
): void {
  if (saved) {
    held();
    return;
  }
  ask(held);
}
