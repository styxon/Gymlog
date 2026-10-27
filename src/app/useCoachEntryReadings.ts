import { useMemo } from 'react';

import { buildCoachModules } from '../lib/aiCoachModules';
import type { AppRoute } from '../navigation/routes';
import type { AppDatabase, AppPreferences } from '../types/models';

/**
 * What the coach and paywall screens are opened with: the demo trial's end
 * date, the session the analysis route names, and the last session the chat
 * can analyse.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because two of the three are memos. VinhaApp calls this exactly
 * where the lines stood — after useCoachAdviceMemory, just ahead of
 * useRoutineBlockCosts — so every hook keeps its slot and every reader in
 * App.tsx still sits below the values it reads.
 */
interface CoachEntryReadingsDeps {
  /** VinhaApp's current route: the analysis and chat screens are read off it. */
  route: AppRoute;
  /** The completed workout sessions the chat's analysis entry looks through. */
  workoutSessions: AppDatabase['workoutSessions'];
  /** The whole database: the exercise logs are read. */
  database: AppDatabase;
  /** The reader's preferences: the app language. */
  preferences: AppPreferences;
}

export function useCoachEntryReadings(deps: CoachEntryReadingsDeps) {
  const { route, workoutSessions, database, preferences } = deps;

  const analysisSessionId = route.tab === 'home' && route.screen === 'analysis' ? route.sessionId : null;
  // The AI tab's written-analysis entry needs the most recent session that has
  // enough logged sets to analyse. Only built while the chat is open.
  // On the chat or not, rather than the whole route: keyed on the route
  // object, this rebuilt the modules on every navigation inside the chat
  // (#bugs 2026-10-01, phase C).
  const onCoachChat = route.tab === 'home' && route.screen === 'ai_chat';
  const coachLastSession = useMemo(() => {
    if (!onCoachChat) {
      return null;
    }
    const modules = buildCoachModules({
      sessions: workoutSessions,
      logs: database.exerciseLogs,
      language: preferences.appLanguage,
      cautionFlags: preferences.setupCautionFlags,
    });
    return modules.analysis
      ? { id: modules.analysis.sessionId, name: modules.analysis.caption }
      : null;
  }, [database.exerciseLogs, preferences.appLanguage, preferences.setupCautionFlags, onCoachChat, workoutSessions]);

  return { analysisSessionId, coachLastSession };
}
