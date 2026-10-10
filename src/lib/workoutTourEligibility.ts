/**
 * Who the workout tour is for: a reader who has not trained in the app yet.
 *
 * It shipped on 2026-10-10 into installs that already hold months of workouts.
 * Their stored seen-list names only Home, so on the next workout they would be
 * walked through a screen they have used a hundred times. The tour belongs to
 * a reader who has never finished a programme workout - and to anyone who
 * asked for it by name.
 *
 * Decided when the tour is due, from what the app already stores, rather than
 * by rewriting the seen-list on load: a load that writes was the cost of the
 * first attempt (the preferences key is laid over the blob and wins, so the
 * rewrite had to be made twice and persisted at once), and "Show the tour
 * again" empties the list on purpose. That replay sets a flag instead
 * (AppPreferences.firstRunToursReplayed), and the flag is what lets a reader
 * with history see the tour.
 *
 * Pure: the caller hands over the stored sessions and templates.
 */

/**
 * Sessions the guided player did not run, by the template id they carry. Free
 * logging has its own template (flagged 'freestyle'); an imported history
 * (Hevy and the like) is written under one shared id, with no template behind
 * it. Neither has met the screen the tour is about.
 */
export const IMPORTED_HISTORY_TEMPLATE_ID = 'hevy_import';

/**
 * Does the database hold a finished programme workout? Every stored session
 * was saved at its end, so a session existing is the proof. Freestyle logging
 * is not the guided player - its template is flagged 'freestyle' - and does
 * not count: a reader who has only ever logged free workouts has not met the
 * screen the tour is about. Nor does an import: someone who brought their
 * history from another app has never opened the player.
 *
 * A session whose template is gone (deleted since) counts: it was a programme
 * workout when it was done, and nothing says otherwise. A ready programme has
 * no stored template at all, and counts for the same reason.
 */
export function hasCompletedProgrammeWorkout(
  sessions: ReadonlyArray<{ workoutTemplateId?: unknown }>,
  templates: ReadonlyArray<{ id: string; origin?: string }>,
): boolean {
  const freestyle = new Set<string>();
  for (const template of templates) {
    if (template.origin === 'freestyle') {
      freestyle.add(template.id);
    }
  }
  return sessions.some(
    (session) =>
      typeof session.workoutTemplateId === 'string' &&
      session.workoutTemplateId !== IMPORTED_HISTORY_TEMPLATE_ID &&
      !freestyle.has(session.workoutTemplateId),
  );
}

/**
 * May the workout tour be shown? To a reader with no programme workout behind
 * them, or to one who pressed "Show the tour again".
 */
export function isWorkoutTourEligible(input: {
  replayed: boolean;
  sessions: ReadonlyArray<{ workoutTemplateId?: unknown }>;
  templates: ReadonlyArray<{ id: string; origin?: string }>;
}): boolean {
  return input.replayed || !hasCompletedProgrammeWorkout(input.sessions, input.templates);
}
