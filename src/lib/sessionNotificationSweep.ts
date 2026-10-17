/**
 * Whether the session's notifications (the rest ladder, the ongoing card, the
 * idle nudge) should all be cleared now.
 *
 * Only once the workout store has loaded. Before that "no session" means
 * "not read yet", and a cold start during a rest cleared the rest-end alert
 * the dying process had handed to the OS: a reader who opened the app and
 * stayed on Home was never told the rest had ended (iOS hunt 2026-10-17,
 * S6-3; Android too). A store that never loads clears nothing, the safe way
 * round.
 */
export function shouldSweepSessionNotifications(input: {
  hydrated: boolean;
  activeSessionId: string | null;
  status: string | null;
}): boolean {
  return input.hydrated && (!input.activeSessionId || input.status !== 'active');
}
