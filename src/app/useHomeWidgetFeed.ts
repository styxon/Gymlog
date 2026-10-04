import { useEffect, useMemo } from 'react';

import { getMonthTrainingTotals } from '../lib/dashboard';
import { getLifetimeWorkoutCount } from '../lib/lifetimeSummary';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { resolveThemeName } from '../lib/themePreference';
import { buildHomeWidgetPayload } from '../lib/widgetPayload';
import {
  getCalendarDayStartTimestamp,
  getCanonicalCompletedSessions,
  getRecentActivityStrip,
} from '../lib/completedSessions';
import { AppDatabase, AppPreferences } from '../types/models';
import { writeHomeWidgetPayload } from '../utils/homeWidget';

type WidgetInput = Parameters<typeof buildHomeWidgetPayload>[0];

/**
 * Feeds the home-screen widget: the programme it suggests when none is
 * running, the trained days and month totals it draws, and the effect that
 * writes its file and asks it to redraw.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01). A hook
 * because the moved code is memos and an effect: VinhaApp calls it at the
 * slot they stood in — after createSetupHandoffDone, before useWidgetTaps —
 * so React's hook order and the order the effects run in are unchanged.
 * refreshHomeWidget is passed in rather than imported, so nothing in src/app
 * reaches for ./modules directly. The workout-only day list is returned:
 * the widget taps resolve against the same one.
 */
export interface HomeWidgetFeedDeps {
  appHydrated: boolean;
  /** Passed whole, so the deps arrays read as they did in App.tsx. */
  preferences: AppPreferences;
  database: AppDatabase;
  /** A dependency as well as an input: the calendar and totals read "today". */
  todayStartMs: number;
  recommendedReadyTemplate: Parameters<typeof getReadyTemplatePresentation>[0] | null;
  homeActivePlanCard: {
    title: string;
    todayPickSessionId?: string | null;
    sessions: WidgetInput['sessions'];
    sessionForecast?: WidgetInput['sessionForecast'];
  } | null;
  homeTrainingSchedule: WidgetInput['schedule'];
  /** From ./modules/home-widget. */
  refreshHomeWidget: () => Promise<boolean>;
}

export function useHomeWidgetFeed(deps: HomeWidgetFeedDeps) {
  const {
    appHydrated,
    preferences,
    database,
    todayStartMs,
    recommendedReadyTemplate,
    homeActivePlanCard,
    homeTrainingSchedule,
    refreshHomeWidget,
  } = deps;

  // The programme the widget offers when there is none running: the app's own
  // recommendation, under its curated title.
  const widgetSuggestion = useMemo(() => {
    if (!recommendedReadyTemplate) {
      return null;
    }
    const presentation = getReadyTemplatePresentation(recommendedReadyTemplate, preferences.appLanguage);
    return { title: presentation.title };
  }, [preferences.appLanguage, recommendedReadyTemplate]);
  // The widget's calendar is a whole month, and a Monday-first grid drags in up
  // to six days of the month before it — so 45 days back covers the longest
  // grid whatever today's date is. (21 was right for the four-week strip this
  // replaced, and would have left the first fortnight of every month blank.)
  //
  // Both of these read "today", so both are keyed on the day as well as the
  // data: keyed on the data alone, an app left open over the last night of a
  // month drew the new month's calendar beside last month's totals until the
  // next workout was logged.
  const widgetCompletedDayStarts = useMemo(
    () =>
      getRecentActivityStrip(database, new Date(todayStartMs), 45)
        .filter((day) => day.active)
        .map((day) => day.dayStart),
    [database, todayStartMs],
  );
  // This month's totals, for the three figures the 4x2 draws beside the
  // calendar, and the streak the 2x1 counts.
  const widgetMonthTotals = useMemo(
    () => getMonthTrainingTotals(database, new Date(todayStartMs)),
    [database, todayStartMs],
  );

  // The narrower set, for the one question the strip cannot answer: is today's
  // session behind you. The strip counts cardio, and a run leaves the planned
  // workout undone — fed to the skip, it would have the widget name tomorrow
  // while Home still offers today.
  const widgetCompletedWorkoutDayStarts = useMemo(
    () =>
      getCanonicalCompletedSessions(database).map((session) =>
        getCalendarDayStartTimestamp(session.performedAt),
      ),
    [database],
  );
  useEffect(() => {
    if (!appHydrated) {
      return;
    }

    const written = writeHomeWidgetPayload(
      buildHomeWidgetPayload({
        nowMs: Date.now(),
        language: preferences.appLanguage,
        // The widget shows whatever the app resolved, Pro gate included — it
        // cannot re-derive this, it is drawn in the launcher's process.
        theme: resolveThemeName(preferences),
        planName: homeActivePlanCard?.title ?? null,
        // With no programme the widget names the one the app would recommend
        // rather than asking an empty question. Presented here, because the
        // catalog's curated titles live on this side of the bridge.
        suggestion: widgetSuggestion,
        schedule: homeTrainingSchedule,
        // The session the reader picked for today, and only that. Home's next
        // session is always set — it is the rotation's answer for whenever the
        // reader trains next — and passed here it made every rest day read
        // "Treeni" on the 2x1.
        todaySessionId: homeActivePlanCard?.todayPickSessionId ?? null,
        completedDayStarts: widgetCompletedDayStarts,
        completedWorkoutDayStarts: widgetCompletedWorkoutDayStarts,
        sessions: homeActivePlanCard?.sessions ?? [],
        sessionForecast: homeActivePlanCard?.sessionForecast ?? null,
        monthTotals: widgetMonthTotals,
        // Every workout ever, not a week streak: the 2x1 counts what you have
        // done, asked for on the home screen 2026-08-20.
        // Lifting plus cardio, like the month figures beside it (bug hunt,
        // 2026-10-04: a runner saw Workouts 12 this month and Total 0).
        totalWorkouts: getLifetimeWorkoutCount(database),
      }),
    );

    // Ask the widget to read it now rather than within the next half hour. The
    // delay used to be invisible because the content was day-granular; it stops
    // being invisible the moment the file's shape changes, and the widget falls
    // back to "create your first program" while the real file sits on disk.
    if (written) {
      void refreshHomeWidget();
    }
  }, [
    appHydrated,
    preferences,
    homeActivePlanCard,
    homeTrainingSchedule,
    widgetCompletedDayStarts,
    widgetCompletedWorkoutDayStarts,
    widgetMonthTotals,
    widgetSuggestion,
    database,
  ]);

  return { widgetCompletedWorkoutDayStarts };
}
