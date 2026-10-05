import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { FirstRunTour } from '../components/FirstRunTour';
import { LegalConsentSheet } from '../components/LegalConsentSheet';
import { createTourTargetRegistry } from '../features/tour/tourTargets';
import { isWorkoutInProgress } from '../lib/activeWorkout';
import { isTourDue, markTourSeen, resolveTourBeats, resolveTourSurface, TourSurface } from '../lib/firstRunTour';
import { resolveHomePrompt } from '../lib/homePrompts';
import { acceptLegal, legalAcceptanceDue } from '../lib/legalAcceptance';
import { formatLegalDate, LEGAL_VERSION, type LegalDocumentId } from '../lib/legalDocuments';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { rememberServerNotice } from '../lib/serverNotice';
import { planSetupHandoff } from '../lib/setupHandoff';
import { AppRoute } from '../navigation/routes';
import { LegalDocumentScreen } from '../screens/LegalDocumentScreen';
import { AppDatabase, AppPreferences } from '../types/models';

/**
 * What is drawn over the app once onboarding is done, and in what order: the
 * setup hand-off and its plan, the terms sheet when they are owed, the
 * first-run tour and Home's one-card prompt queue behind it, when the update
 * prompt may show, and the server notice's "seen" write.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01), in the
 * order it stood there: the hand-off's state and plan, the terms, the tour,
 * handleServerNoticeSeen, appUpdateHeld, renderLegalConsent and the effect
 * that closes a hand-off with nothing to offer. A hook because the moved code
 * is state, memos, a callback and an effect: VinhaApp calls it at the slot
 * they stood in — after useHomeWidgetPinState, before the account-name
 * effect — so React's hook order is unchanged. The two render-phase ref
 * writes the route-level back reads (`setupHandoffActiveRef`,
 * `legalConsentDueRef`) run here, in the same render and the same order as
 * before. renderLegalConsent is still a plain function made on every render,
 * as it was in VinhaApp; the shell calls it below its early return.
 */
export interface SetupHandoffOverlaysDeps {
  /** Passed whole, so the deps arrays read as they did in App.tsx. */
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
  appHydrated: boolean;
  brandSplashDone: boolean;
  onboardingActive: boolean;
  route: AppRoute;
  /** null until Android has answered whether it can pin a widget. */
  homeWidgetState: { supported: boolean; added: boolean } | null;
  homePinnedStatCardKeys: string[];
  homeSuggestedStatCardKeys: string[];
  accountBackup: { available: boolean; state: { status: string } };
  database: Pick<AppDatabase, 'workoutSessions' | 'cardioSessions'>;
  /** Only whether the running plan has any sessions is read. */
  homeActivePlanCard: { sessions: readonly unknown[] } | null;
  workout: { activeSession: { status: string } | null };
  tourRegistry: ReturnType<typeof createTourTargetRegistry>;
  setTourSweep: React.ComponentProps<typeof FirstRunTour>['onSweep'];
  setTourFocus: React.ComponentProps<typeof FirstRunTour>['onBeatChange'];
  setupHandoffActiveRef: { current: boolean };
  legalConsentDueRef: { current: boolean };
  legalSheetHeld: 'first' | 'changed' | null;
  setLegalSheetHeld: (held: 'first' | 'changed' | null) => void;
  handoffLegalDocument: LegalDocumentId | null;
  setHandoffLegalDocument: (document: LegalDocumentId | null) => void;
  /** The style that lays a document over the consent sheet; App.tsx owns it. */
  LEGAL_OVER_CONSENT: React.ComponentProps<typeof View>['style'];
}

export function useSetupHandoffOverlays(deps: SetupHandoffOverlaysDeps) {
  const {
    preferences,
    updatePreferences,
    appHydrated,
    brandSplashDone,
    onboardingActive,
    route,
    homeWidgetState,
    homePinnedStatCardKeys,
    homeSuggestedStatCardKeys,
    accountBackup,
    database,
    homeActivePlanCard,
    workout,
    tourRegistry,
    setTourSweep,
    setTourFocus,
    setupHandoffActiveRef,
    legalConsentDueRef,
    legalSheetHeld,
    setLegalSheetHeld,
    handoffLegalDocument,
    setHandoffLegalDocument,
    LEGAL_OVER_CONSENT,
  } = deps;

  // ── The hand-off after onboarding ────────────────────────────────────────
  // Onboarding used to end by dropping the reader on Home with the widget
  // unplaced and nothing being tracked. This offers both, once, while the app
  // still remembers which body part they just named.
  //
  // It waits for `homeWidgetState`: until Android has answered whether it can
  // pin a widget, showing the step would either hide an offer that was
  // available or make one that is not.
  //
  // Held while its own closing write is in flight, the way the terms sheet is:
  // `updatePreferences` shows the write before the disk has it, so the page
  // left on the optimistic half, and a refused write brought a fresh one back
  // at page one, tick cleared, nothing said (audit 8, 2026-09-26).
  const [setupHandoffHeld, setSetupHandoffHeld] = useState(false);
  const setupHandoffHeldRef = useRef(false);
  const setupHandoffReady =
    preferences.onboardingCompleted &&
    (!preferences.setupHandoffCompleted || setupHandoffHeld) &&
    homeWidgetState !== null;
  // Read once and depended on by value: the whole preferences object as a
  // dependency made a fresh plan on every unrelated write.
  const proUnlockedForHandoff = resolveProEntitlement(preferences).unlocked;
  const liveSetupHandoffPlan = useMemo(
    () =>
      setupHandoffReady
        ? planSetupHandoff({
            canOfferWidget: Boolean(homeWidgetState?.supported) && !homeWidgetState?.added,
            pinnedCardKeys: homePinnedStatCardKeys,
            focusAreas: preferences.setupFocusAreas,
            canOfferAccountBackup: accountBackup.available && accountBackup.state.status === 'signed_out',
            // A reader who already bought Pro is not offered the page that
            // sells it.
            canOfferPro: !proUnlockedForHandoff,
          })
        : null,
    [
      accountBackup.available,
      accountBackup.state.status,
      homePinnedStatCardKeys,
      homeWidgetState,
      preferences.setupFocusAreas,
      proUnlockedForHandoff,
      setupHandoffReady,
    ],
  );
  // Frozen while its closing write is held: that write pins the tracked
  // sites and marks the widget asked, which re-plans the page — and a plan
  // with nothing left to offer unmounted the page mid-write anyway.
  const heldSetupHandoffPlanRef = useRef(liveSetupHandoffPlan);
  if (!setupHandoffHeld) {
    heldSetupHandoffPlanRef.current = liveSetupHandoffPlan;
  }
  const setupHandoffPlan = setupHandoffHeld ? heldSetupHandoffPlanRef.current : liveSetupHandoffPlan;
  const setupHandoffActive = setupHandoffPlan?.shouldShow ?? false;
  setupHandoffActiveRef.current = setupHandoffActive;

  /**
   * The terms, owed (#bugs 2026-09-22; decided 2026-09-26): never accepted, or
   * accepted before the documents last changed. Asked over the app once the
   * questions and the hand-off are behind the reader — the hand-off asks it
   * itself, and this catches whoever skipped that page, everyone who was here
   * before the question existed, and every change to the documents after.
   * Not before hydration: the stored answer is not known until then, and a
   * reader who had accepted would see the sheet flash.
   */
  const legalConsentOwed =
    appHydrated && brandSplashDone && !onboardingActive && !setupHandoffActive
      ? legalAcceptanceDue(preferences.legalAcceptance, LEGAL_VERSION)
      : null;
  const legalConsentDue = legalConsentOwed ?? legalSheetHeld;
  legalConsentDueRef.current = legalConsentDue !== null;

  /**
   * The first-run tour: once per surface, only on a tab's root, only after
   * onboarding and its hand-off have finished. It goes in front of Home's
   * one-card prompt queue — the widget offer and the card suggestion wait
   * until the surface is marked seen. See lib/firstRunTour.ts.
   */
  const tourSurface = resolveTourSurface(route);
  const tourActive =
    brandSplashDone &&
    !onboardingActive &&
    !setupHandoffActive &&
    // The tour waits for the terms: it points at a screen the sheet covers.
    legalConsentDue === null &&
    tourSurface !== null &&
    isTourDue(preferences.firstRunToursSeen, tourSurface);
  const homeTourActive = tourActive && tourSurface === 'home';
  // The queue decides with the tour in it, so it is computed here, after
  // the tour, rather than up with the suggester.
  const homePrompt = resolveHomePrompt({
    signInAvailable: accountBackup.available && accountBackup.state.status === 'signed_out',
    signInDismissed: preferences.accountBackupPromptDismissed,
    loggedSessionCount: database.workoutSessions.length + database.cardioSessions.length,
    suggestionKey: homeSuggestedStatCardKeys[0] ?? null,
    tourActive: homeTourActive,
  });
  const tourHasProgram = Boolean(homeActivePlanCard && homeActivePlanCard.sessions.length > 0);
  const tourBeats = useMemo(
    () => (tourSurface ? resolveTourBeats(tourSurface, { hasProgram: tourHasProgram }) : []),
    [tourHasProgram, tourSurface],
  );
  const firstRunToursSeenRef = useRef(preferences.firstRunToursSeen);
  firstRunToursSeenRef.current = preferences.firstRunToursSeen;
  // Stable: the layer calls this from its unmount, and a fresh closure per
  // render would be a fresh reason to fire it.
  const handleTourFinish = useCallback(
    (surface: TourSurface) => {
      const seen = firstRunToursSeenRef.current;
      if (!isTourDue(seen, surface)) {
        return;
      }
      void updatePreferences({ firstRunToursSeen: markTourSeen(seen, surface) });
    },
    [updatePreferences],
  );
  const tourElement =
    tourActive && tourSurface ? (
      <FirstRunTour
        key={tourSurface}
        surface={tourSurface}
        beats={tourBeats}
        registry={tourRegistry}
        language={preferences.appLanguage}
        onSweep={setTourSweep}
        onBeatChange={setTourFocus}
        onFinish={handleTourFinish}
      />
    ) : null;

  /**
   * The terms sheet, when owed, in the shell's overlay slot — above the tab
   * bar, where the tour draws. The two never meet: the tour waits for it.
   *
   * Told whether the shell already pads the bottom edge: it usually does, and
   * the sheet adding the navigation bar's height on top of that left a band
   * of empty sheet under Continue (#bugs 2026-09-26, "jatka buttoni
   * alemmas"). On the screens that drop the edge it pads for itself.
   */
  /**
   * The update prompt waits for a calm moment. A refusal can arrive at any
   * time — the statistics flush runs in the background — and the prompt is a
   * modal of its own, which must not land on the terms sheet, the tour or a
   * workout in progress (review, 2026-09-28).
   */
  /**
   * A server notice the reader closed is not shown again. A refused write
   * leaves it unmarked, so it comes back next launch rather than being lost.
   */
  const handleServerNoticeSeen = useCallback(
    (id: string) => {
      void updatePreferences({
        seenServerNoticeIds: rememberServerNotice(preferences.seenServerNoticeIds, id),
      }).catch(() => undefined);
    },
    [preferences.seenServerNoticeIds, updatePreferences],
  );
  const appUpdateHeld =
    !appHydrated ||
    !brandSplashDone ||
    onboardingActive ||
    setupHandoffActive ||
    legalConsentDue !== null ||
    Boolean(tourElement) ||
    isWorkoutInProgress(workout.activeSession);

  const renderLegalConsent = (shellPadsBottom: boolean) => (
    <>
      <LegalConsentSheet
        shellPadsBottom={shellPadsBottom}
        language={preferences.appLanguage}
        reason={legalConsentDue ?? 'first'}
        updatedLabel={formatLegalDate(preferences.appLanguage)}
        onOpenLegal={(document) => setHandoffLegalDocument(document)}
        // The sheet goes when the stored answer says it is no longer owed —
        // after this write, never on the tap.
        onAccept={async () => {
          setLegalSheetHeld(legalConsentDue);
          try {
            await updatePreferences({ legalAcceptance: acceptLegal(LEGAL_VERSION, new Date()) });
          } finally {
            // Refused, the preferences are already rolled back and the sheet
            // stays owed; accepted, it goes now — after the write.
            setLegalSheetHeld(null);
          }
        }}
      />
      {/* Over the sheet, the way the documents open over the hand-off:
          reading them is not an answer, and the box keeps its tick. */}
      {handoffLegalDocument ? (
        <View style={LEGAL_OVER_CONSENT}>
          <LegalDocumentScreen
            document={handoffLegalDocument}
            language={preferences.appLanguage}
            onBack={() => setHandoffLegalDocument(null)}
          />
        </View>
      ) : null}
    </>
  );

  // Nothing left to offer — a reader running onboarding a second time. Close the
  // door rather than leave it to open on some later launch.
  useEffect(() => {
    if (setupHandoffReady && setupHandoffPlan && !setupHandoffPlan.shouldShow) {
      void updatePreferences({ setupHandoffCompleted: true });
    }
  }, [setupHandoffPlan, setupHandoffReady, updatePreferences]);

  return {
    setupHandoffHeldRef,
    setSetupHandoffHeld,
    setupHandoffPlan,
    setupHandoffActive,
    legalConsentDue,
    homeTourActive,
    homePrompt,
    tourElement,
    handleServerNoticeSeen,
    appUpdateHeld,
    renderLegalConsent,
  };
}
