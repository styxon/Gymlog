/**
 * Which ONE prompt card Home may show (design: Sheets & Pickers, frame 15).
 *
 * Home had grown a stack: the sign-in card, the measurement suggestion and
 * the card grid could all render at once — three asks piled on the screen
 * whose job is running today's session (seen stacked on a device,
 * 2026-08-30). The rule is now one card at a time, and the queue is decided
 * here so the order is testable rather than an accident of JSX order.
 *
 * Two decisions carried from the design's own notes:
 *
 * - The sign-in card waits until the THIRD logged session. A fresh install
 *   has nothing worth backing up, and asking for an account before the app
 *   has proven anything is the ask most likely to be both refused and
 *   remembered. Three sessions is also when a lost phone starts costing
 *   something real.
 * - Sign-in outranks the suggestion when both are due: it guards data that
 *   already exists, and it leaves the queue for good once answered, so the
 *   suggestion's turn always comes.
 */

/** Sessions in the log before the sign-in card may appear. */
export const SIGN_IN_AFTER_SESSIONS = 3;

interface HomePromptInput {
  /** Backup is configured in this build and the reader is signed out. */
  signInAvailable: boolean;
  /** The reader already said no thanks — that answer is final. */
  signInDismissed: boolean;
  /** Strength and cardio sessions logged, together. */
  loggedSessionCount: number;
  /** The suggester's top pick, or null when it has nothing to offer. */
  suggestionKey: string | null;
  /**
   * The first-run tour is on this screen. It is a third asker, and it goes
   * first: both cards wait until the surface is marked seen.
   */
  tourActive?: boolean;
}

export type HomePrompt = 'signIn' | 'suggestion' | null;

export function resolveHomePrompt(input: HomePromptInput): HomePrompt {
  if (input.tourActive) {
    return null;
  }
  const signInDue =
    input.signInAvailable &&
    !input.signInDismissed &&
    input.loggedSessionCount >= SIGN_IN_AFTER_SESSIONS;
  if (signInDue) {
    return 'signIn';
  }
  return input.suggestionKey !== null ? 'suggestion' : null;
}
