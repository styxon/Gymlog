import type { SignInProvider } from '../features/account/accountAuth';
import { t } from '../lib/i18n';
import { acceptLegal } from '../lib/legalAcceptance';
import { LEGAL_VERSION } from '../lib/legalDocuments';
import { AppRoute } from '../navigation/routes';
import { SetupHandoffChoices } from '../screens/SetupHandoffScreen';
import { AppPreferences } from '../types/models';

/**
 * What the hand-off's Done writes, and what it opens after the write lands:
 * the widget's pin dialog, the sign-in sheet, the Pro page.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01). A
 * per-render factory, not a hook: the moved code is one plain handler, made
 * on every render as it was in VinhaApp, which calls this at the slot it
 * stood in. `.tsx` only because SetupHandoffChoices lives in the screen.
 * requestPinHomeWidget is passed in rather than imported, so nothing in
 * src/app reaches for ./modules directly.
 */
export interface SetupHandoffDoneDeps {
  /** Only whether the page offered the widget is read. */
  setupHandoffPlan: { offerWidget: boolean } | null;
  homePinnedStatCardKeys: string[];
  /** The hand-off's write guard and hold, from useSetupHandoffOverlays. */
  setupHandoffHeldRef: { current: boolean };
  setSetupHandoffHeld: (held: boolean) => void;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
  showToast: (message: string) => void;
  preferences: AppPreferences;
  /** From ./modules/home-widget. */
  requestPinHomeWidget: () => Promise<boolean>;
  handleAccountSignIn: (provider?: SignInProvider) => Promise<unknown>;
  navigate: (route: AppRoute) => void;
}

export function createSetupHandoffDone(deps: SetupHandoffDoneDeps) {
  const {
    setupHandoffPlan,
    homePinnedStatCardKeys,
    setupHandoffHeldRef,
    setSetupHandoffHeld,
    updatePreferences,
    showToast,
    preferences,
    requestPinHomeWidget,
    handleAccountSignIn,
    navigate,
  } = deps;

  const handleSetupHandoffDone = async (choices: SetupHandoffChoices) => {
    const patch: Partial<AppPreferences> = { setupHandoffCompleted: true };
    // Asked here, so Home's one-time card must not ask again. Settings keeps its
    // permanent row either way.
    if (setupHandoffPlan?.offerWidget) {
      patch.homeWidgetPromptDismissed = true;
    }
    // In the same write as the page closing, so the sheet over the app never
    // opens for a reader who has just ticked the box.
    if (choices.legalAccepted) {
      patch.legalAcceptance = acceptLegal(LEGAL_VERSION, new Date());
    }
    const pinned = [...homePinnedStatCardKeys];
    // The site's name IS its card key, so the dialog's answer goes straight to
    // Home. Only what is not already there: pinning a card twice would draw it
    // twice.
    for (const site of choices.trackedSites) {
      if (!pinned.includes(site)) {
        pinned.push(site);
      }
    }
    if (pinned.length !== homePinnedStatCardKeys.length) {
      patch.homeStatCardKeys = pinned;
    }
    // One write at a time: a second Done during the first was a second patch.
    if (setupHandoffHeldRef.current) {
      return;
    }
    setupHandoffHeldRef.current = true;
    setSetupHandoffHeld(true);
    try {
      await updatePreferences(patch);
    } catch (error) {
      // The page stays as the reader left it — their answers, their tick —
      // and says so; nothing below runs on a write that did not happen.
      console.error('Failed to finish the setup hand-off', error);
      showToast(t(preferences.appLanguage, 'toast.setupHandoffFailed'));
      return;
    } finally {
      setupHandoffHeldRef.current = false;
      setSetupHandoffHeld(false);
    }
    // The system dialog last, so it is not racing a state write.
    if (choices.addWidget) {
      await requestPinHomeWidget();
    }
    // And sign-in after that: it opens its own sheet, and the reader asked for
    // it — a cancel there is a change of mind, not an error.
    if (choices.signInForBackup) {
      await handleAccountSignIn(choices.signInProvider ?? undefined);
    }
    // Pro last, and only if it was asked for. It is a page, not a sheet: it
    // takes the screen, so anything that had to happen first has happened.
    if (choices.showPro) {
      navigate({ tab: 'profile', screen: 'premium' });
    }
  };

  return { handleSetupHandoffDone };
}
