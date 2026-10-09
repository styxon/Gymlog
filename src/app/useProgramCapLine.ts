import { useMemo } from 'react';
import { placesToFree } from '../lib/activeProgramSet';
import { I18nKey, t } from '../lib/i18n';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { describeProgramCap, programCapLineKey } from '../lib/programCapNotice';
import type { AppPreferences } from '../types/models';

/**
 * The line the Programs tab shows about how full the programme set is.
 *
 * Moved verbatim from VinhaApp in App.tsx in phase C of the split
 * (2026-10-01), with its doc and its deps. VinhaApp calls it exactly where
 * the memo stood (after the programme day edits), so the hook order is
 * unchanged.
 */
export interface ProgramCapLineDeps {
  preferences: AppPreferences;
}

export function useProgramCapLine(deps: ProgramCapLineDeps) {
  const {
    preferences,
  } = deps;

  /**
   * How full the programme set is, for the line the Programs tab shows.
   *
   * This was a toast on every adoption for about an hour. It was the wrong
   * shape twice over: a popup that says what the screen behind it already
   * shows is the thing the reader keeps asking to be rid of ("otit ohjelman
   * käyttöön", #bugs 2026-08-26), and a count nobody is near is a sign about
   * nothing. So it sits on the list it describes, and only once there is one
   * place left — the point of it was never to report, it was to stop the cap
   * arriving as news.
   *
   * Counted from the set as it stands, which is what that list is showing.
   */
  const programCapLine = useMemo(() => {
    const state = describeProgramCap({
      activePlanIds: preferences.activePlanIds,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });
    const key = programCapLineKey(state);
    return key
      ? t(preferences.appLanguage, `programs.cap.${key}` as I18nKey, {
          used: state.used,
          cap: state.cap,
          count: placesToFree(state.used, state.cap),
        })
      : null;
  }, [preferences]);

  return {
    programCapLine,
  };
}
