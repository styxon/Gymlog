import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, { Path } from 'react-native-svg';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppleSignInButton } from '../components/AppleSignInButton';
import { GoogleGlyph, GoogleSignInButton } from '../components/GoogleSignInButton';
import { VinhaIcon } from '../components/VinhaIcon';
import { LegalConsentCheck } from '../components/LegalConsentCheck';
import { ThemeChoiceDialog } from '../components/ThemeChoiceDialog';
import { TrackChangeDialog } from '../components/TrackChangeDialog';
import type { SignInProvider } from '../features/account/accountAuth';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { useModalHandoff } from '../hooks/useModalHandoff';
import { t } from '../lib/i18n';
import { type SetupHandoffPlan } from '../lib/setupHandoff';
import { radii, spacing } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { AppLanguage, MeasurementKind } from '../types/models';

export interface SetupHandoffChoices {
  addWidget: boolean;
  /** Start sign-in after the other choices land. Free and Pro alike. */
  signInForBackup: boolean;
  /** Which sign-in the button pressed was; null when none was. */
  signInProvider: SignInProvider | null;
  /**
   * Open the Pro page once everything else has landed.
   *
   * Not a row and not a page of its own any more (user, 2026-09-10). A page in
   * the middle of onboarding that described Pro was a summary of the page that
   * describes Pro; the reader now simply arrives at the real one, once, on the
   * way to Home. False for anybody who already has Pro.
   */
  showPro: boolean;
  /**
   * The measured sites the reader wants on Home, at most four.
   *
   * Replaces the two card rows (user, 2026-09-10): "track your chest" and
   * "track your weight" were two switches out of nine possible sites, chosen
   * for the reader by the questionnaire. The dialog asks the question once and
   * lets them answer it themselves — the card key IS the site's name, so this
   * list goes straight to Home's pinned keys.
   */
  trackedSites: MeasurementKind[];
  /**
   * The terms box was ticked when the reader went on (#bugs 2026-09-22). False
   * when the page was skipped or left by the back key — the sheet over the app
   * asks then, so nobody gets past without an answer.
   */
  legalAccepted: boolean;
}

interface SetupHandoffScreenProps {
  language: AppLanguage;
  plan: SetupHandoffPlan;
  /**
   * What the reader called it, already localised — "Glutes", not "hips". The tape
   * is how it gets measured; the focus is what they said they were training, and
   * that is the thing to repeat back to them.
   */
  focusLabel: string | null;
  /** Settles once the answers are written, or refused (the page then stays). */
  onDone: (choices: SetupHandoffChoices) => void | Promise<void>;
  onSkip: () => void;
  /**
   * Opens the system's widget dialog and resolves once it has closed. Used
   * when the tracking sheet follows the widget page, so the sheet comes up
   * after the dialog rather than under it.
   */
  onPinWidget: () => Promise<boolean>;
  /**
   * Opens one of the two documents without leaving onboarding. The legal screen
   * lives on the Profile tab, and navigating there mid-flow would end the flow;
   * the shell renders it over this screen instead and comes back here.
   */
  onOpenLegal: (document: 'privacy' | 'terms') => void;
  /**
   * This version of the documents is already accepted — a reader running the
   * questions again from Profile. Then there is nothing to ask: no box, and
   * nothing waits for one.
   */
  legalAlreadyAccepted: boolean;
  /** The sign-ins this build offers (accountAuth): Apple on iPhone, Google where configured. */
  signInProviders: SignInProvider[];
  /** The live theme, so the theme page shows what is actually on. */
  darkEnabled: boolean;
  onThemeChange: (dark: boolean) => void;
}

/**
 * The last step of onboarding, and the only one that is not a question.
 *
 * Onboarding used to end by dropping the reader on Home with everything switched
 * off. Two things they would otherwise have to go and find are offered here
 * instead — the widget, and a card that tracks the body part they just named.
 *
 * Both are pre-selected, and both are one tap to turn off. That is the honest
 * shape for an offer the reader did not ask for: opt-out, visible, and reversible
 * from Settings afterwards, which the copy says out loud.
 */
export function SetupHandoffScreen({
  language,
  plan,
  focusLabel,
  onDone,
  onSkip,
  onPinWidget,
  onOpenLegal,
  legalAlreadyAccepted,
  signInProviders,
  darkEnabled,
  onThemeChange,
}: SetupHandoffScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [addWidget, setAddWidget] = useState(true);
  const [trackedSites, setTrackedSites] = useState<MeasurementKind[]>([]);
  // Also off by default, and for a stronger reason: an account is a bigger
  // ask than a widget, and the decision (2026-08-22) is that sign-in stands
  // beside the door, never in it.
  const [signInForBackup, setSignInForBackup] = useState(false);
  // A ref, not state: the press that sets it finishes in the same handler,
  // before state would be read back (the double-tap audit below).
  const signInProviderRef = useRef<SignInProvider | null>(null);
  // One box for both pages that carry it: ticked on the sign-in page, it is
  // still ticked on the last one.
  const [legalChecked, setLegalChecked] = useState(false);
  const legalReady = legalAlreadyAccepted || legalChecked;

  const trackingBody = useMemo(() => {
    if (!plan.tracking) {
      return '';
    }
    if (!plan.tracking.focus || !focusLabel) {
      return t(language, 'handoff.track.bodyweight');
    }
    return t(language, 'handoff.track.body', { focus: focusLabel });
  }, [focusLabel, language, plan.tracking]);

  // The heading counts what is on the screen. With the widget already placed
  // (any phone that has had the app before) only the card is offered, and
  // "Two things · both take one tap" was a promise the screen did not keep.
  /*
   * One, always, because this page holds one row.
   *
   * The heading used to count the plan's offers, which stopped being what the
   * page showed the moment sign-in, Pro and the sites moved to pages of their
   * own: four offers, one switch, and a title claiming the other three
   * (2026-09-10). This page renders only when the widget can be pinned, and
   * the widget is the only thing on it.
   */
  const titleKey = 'handoff.titleOne' as const;

  /**
   * Three pages where there used to be one list (user, 2026-09-10).
   *
   * Sign-in and Pro were rows among five, and both are decisions rather than
   * switches: one asks for an account, the other opens a price list. A row in
   * a list is the wrong shape for either, so each got the screen it needs and
   * the remaining switches keep the list.
   *
   * Built from the plan rather than fixed, so a reader who is already signed
   * in never sees a sign-in page and a reader who bought Pro never sees a Pro
   * page — the same rule the rows already followed. Every page is there only
   * when it has something on it: the widget page on a launcher that cannot
   * pin one was a title, a terms line and nothing between them (user,
   * 2026-09-10), and the tracking dialog asked for sites already on Home
   * (backfill review of #92, 2026-09-16). See SetupHandoffPlan.pages.
   */
  const pages = plan.pages;
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[Math.min(pageIndex, pages.length - 1)];

  // The answers are passed in where a press has just given one: state set in
  // the same handler is not read back until the next render, so the sign-in
  // button on the last page finished with the old "no" and the sign-in was
  // silently skipped (double-tap audit, 2026-09-21).
  const finish = (widget = addWidget, signIn = signInForBackup) =>
    onDone({
      // Not twice: a widget asked for on its own page was pinned there.
      addWidget: plan.offerWidget && widget && !widgetRequested.current,
      trackedSites,
      signInForBackup: plan.offerAccountBackup && signIn,
      signInProvider: plan.offerAccountBackup && signIn ? signInProviderRef.current : null,
      showPro: plan.offerPro,
      legalAccepted: legalChecked,
    });

  /**
   * Next page, or out — and the second half is the point.
   *
   * `advance` used to clamp to the last index, so on the last page it moved to
   * the page it was already on and nothing happened. With the widget row gone
   * from most phones, the tracking dialog IS the last page, and its Done
   * button was dead: tapped, nothing, no way forward (user, 2026-09-10).
   */
  /**
   * The widget page's Done, and its back key with `widget` false.
   *
   * Last page: out, and setupHandoffDone opens the pin dialog after the write.
   * Otherwise the tracking sheet follows, and it waits for the pin dialog to
   * close — Done, the system's dialog, then the sheet, one at a time (user
   * 2026-10-16). Before this the sheet came first and the widget dialog after.
   */
  const widgetRequested = useRef(false);
  const [pinning, setPinning] = useState(false);
  const leaveOffers = async (widget: boolean) => {
    if (pinning) {
      return;
    }
    if (pageIndex >= pages.length - 1) {
      finish(widget);
      return;
    }
    if (plan.offerWidget && widget) {
      setPinning(true);
      try {
        await onPinWidget();
      } finally {
        setPinning(false);
      }
      widgetRequested.current = true;
    }
    setPageIndex((current) => current + 1);
  };

  const advance = (signIn = signInForBackup) => {
    if (pageIndex >= pages.length - 1) {
      finish(addWidget, signIn);
      return;
    }
    setPageIndex((current) => current + 1);
  };

  /**
   * The sign-in buttons. On the last page the press is the hand-off's Done,
   * and the shell holds this page up until the account sheet has answered and
   * the first backup has been read (#bugs 2026-10-30) — up to two network
   * round trips after the sheet closes. The page says it is working in that
   * time; before, its buttons stayed lit and every tap was dropped.
   */
  const [signingIn, setSigningIn] = useState(false);
  const signInWith = (provider: SignInProvider) => {
    if (signingIn) {
      return;
    }
    signInProviderRef.current = provider;
    setSignInForBackup(true);
    if (pageIndex < pages.length - 1) {
      advance(true);
      return;
    }
    setSigningIn(true);
    void Promise.resolve(finish(addWidget, true)).finally(() => setSigningIn(false));
  };

  /**
   * Done on the tracking or the theme dialog: close it, and only then move on.
   *
   * Both are Modals beside each other, and moving to the next page in the same
   * render closed one and opened the other at once. iOS presents every Modal
   * from the root view controller and refuses a second while the first is
   * still fading out; React Native records it as shown anyway, so on an iPhone
   * the theme question never appeared and the page under it is empty there
   * (no widget page): a new reader was left on a blank screen, every time and
   * again after a restart (iOS hunt, 2026-10-17). The last page waits too, so
   * the sign-in sheet or the Pro page that finish opens comes after the dialog
   * has gone. Android moves on at once, as before.
   *
   * On the last page the dialog stays down while the answers are written: the
   * shell holds this screen up for the write, and a dialog shown again there
   * would be taken away by the unmount, mid-presentation. It comes back only
   * if the write was refused and the page is still here to be answered again.
   *
   * Each dialog reports its dismissal only while its own page is up: one that
   * was moved past on the hook's fallback timer and reports late must not
   * run the next dialog's step while that one is still leaving.
   */
  const { handOff, onSheetDismissed } = useModalHandoff();
  const [dialogLeaving, setDialogLeaving] = useState(false);
  const leaveDialog = () => {
    if (dialogLeaving) {
      return;
    }
    const lastPage = pageIndex >= pages.length - 1;
    handOff(
      () => setDialogLeaving(true),
      () => {
        if (!lastPage) {
          setDialogLeaving(false);
          advance();
          return;
        }
        void Promise.resolve(finish()).finally(() => setDialogLeaving(false));
      },
    );
  };

  /**
   * Android's back key: "not now" to the page in front of the reader.
   *
   * Nothing answered it on the sign-in and widget pages, so the key reached
   * the route behind the hand-off — popping a screen nobody could see, or
   * closing the app with the offers still waiting (2026-09-17). There is no
   * page to go back to: the questions behind this are saved. So the key
   * declines, which is what it already did on the tracking page, whose
   * dialog closes through Done. Declining the widget means declining it —
   * the row is on by default, and back is not a yes.
   */
  useHardwareBack(() => {
    if (pages.length === 0) {
      return;
    }
    if (page === 'offers') {
      void leaveOffers(false);
      return;
    }
    advance();
  });

  // Nothing to ask, only the Pro page to open: go straight there rather than
  // draw a title over an empty page. Once — a second call would open the Pro
  // page twice.
  const finishedEmpty = useRef(false);
  useEffect(() => {
    if (pages.length === 0 && !finishedEmpty.current) {
      finishedEmpty.current = true;
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length]);
  if (pages.length === 0) {
    return <View style={styles.screen} />;
  }

  if (page === 'signin') {
    return (
      <View style={styles.screen}>
        <View style={[styles.pageBody, styles.pageBodyCentred]}>
          <View style={styles.pageGlyph}>
            {/* The G only where Google is the one sign-in; beside Apple's it would pick a side. */}
            {signInProviders.includes('apple') ? <ShieldGlyph size={34} color={theme.green} /> : <GoogleGlyph size={34} />}
          </View>
          {/* No heading (user, 2026-09-10). The G says which sign-in this is
              and the sentence says what it buys; a title between them was a
              third way of saying the same thing. */}
          <Text style={[styles.pageText, styles.pageTextCentred]}>{t(language, 'handoff.signin.body')}</Text>
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, GESTURE_BAR_FLOOR) + spacing.md }]}>
          {/* The one page in onboarding where an account is asked for, so the
              terms live here too. Sign-in waits for the box: it is the first
              thing that would leave the phone. "Not now" does not — the next
              page, or the sheet over the app, asks. */}
          {legalAlreadyAccepted ? null : (
            <LegalConsentCheck
              language={language}
              checked={legalChecked}
              onToggle={() => setLegalChecked((current) => !current)}
              onOpenLegal={onOpenLegal}
            />
          )}
          {signInProviders.includes('apple') ? (
            <AppleSignInButton
              variant="whiteOutline"
              height={54}
              disabled={!legalReady || signingIn}
              style={!legalAlreadyAccepted && styles.afterConsent}
              onPress={() => signInWith('apple')}
            />
          ) : null}
          {signInProviders.includes('google') ? (
            <GoogleSignInButton
              label={t(language, 'handoff.signin.cta')}
              height={54}
              disabled={!legalReady || signingIn}
              style={!legalAlreadyAccepted && styles.afterConsent}
              onPress={() => signInWith('google')}
            />
          ) : null}
          {signingIn ? (
            <ActivityIndicator color={theme.muted} style={styles.signingIn} />
          ) : (
            <Pressable accessibilityRole="button" onPress={() => advance()} style={({ pressed }) => pressed && styles.pressed}>
              <Text style={styles.pageSkip}>{t(language, 'handoff.signin.skip')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Over the page rather than instead of it: the tracking and theme
          questions are dialogs on top of the screen behind them. */}
      <TrackChangeDialog
        visible={page === 'tracking' && !dialogLeaving}
        language={language}
        selected={trackedSites}
        offered={plan.trackedSiteOptions}
        onChange={setTrackedSites}
        onDone={leaveDialog}
        onDismissed={page === 'tracking' ? onSheetDismissed : undefined}
        topInset={insets.top}
        bottomInset={insets.bottom}
        maxHeight={windowHeight}
      />
      {/* The last page (user 2026-10-17): after the Pro page, the widget and
          the tracking sheet, rather than in front of the questions. */}
      <ThemeChoiceDialog
        visible={page === 'theme' && !dialogLeaving}
        language={language}
        darkEnabled={darkEnabled}
        onChange={onThemeChange}
        onDone={leaveDialog}
        onDismissed={page === 'theme' ? onSheetDismissed : undefined}
      />
      {/* The widget page's own body only when it is a page: on a phone that
          cannot pin one (every iPhone) the sites and theme dialogs stood
          over a widget heading, a terms box and a Done for nothing. */}
      {plan.offerWidget ? (
      <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t(language, titleKey)}</Text>

      {plan.offerWidget ? (
        <OfferRow
          icon="clock"
          title={t(language, 'handoff.widget.title')}
          body={t(language, 'handoff.widget.body')}
          selected={addWidget}
          onToggle={() => setAddWidget((current) => !current)}
        />
      ) : null}


      </ScrollView>

      {/* Out of the scroll and against the foot of the screen, where every
          other done/proceed button in this app sits (user 2026-08-31). Inside
          the list it followed the last row, so with two offers it stopped
          halfway up the screen and the thumb had to go looking.

          No "Not now" (user, 2026-08-19): every row is its own on/off, so
          Done with everything off already is "not now", and a second exit
          under the first was a choice that did not exist. */}
      {/* The inset, read here rather than assumed: a footer pinned to the
          bottom of the screen sits under the gesture bar without it, and the
          button came out with its label sliced in half.

          With a floor under it, because reading it is not the same as getting
          it: on this screen it comes back 0, and the gesture pill was drawn
          on its bottom edge. Measured on the emulator 2026-09-08: the button
          ended at y=2368 of 2400 with 31px under it, and the pill is drawn at
          y=2364..2372. An inset that can be zero is not a clearance, so the
          larger of the two wins — 164px under the button now. */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, GESTURE_BAR_FLOOR) + spacing.md },
        ]}
      >
        {/* The terms, at the till rather than the door: the last screen
            before the app. A tick box since 2026-09-26 (#bugs 2026-09-22) —
            it was a line, "by continuing you accept", which recorded nothing
            and which a skipped page never showed at all. Done waits for the
            box. */}
        {legalAlreadyAccepted ? null : (
          <LegalConsentCheck
            language={language}
            checked={legalChecked}
            onToggle={() => setLegalChecked((current) => !current)}
            onOpenLegal={onOpenLegal}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !legalReady || pinning }}
          disabled={!legalReady || pinning}
          onPress={() => void leaveOffers(addWidget)}
          style={({ pressed }) => [
            styles.done,
            !legalAlreadyAccepted && styles.afterConsent,
            !legalReady && styles.ctaWaiting,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.doneText}>{t(language, 'handoff.done')}</Text>
        </Pressable>
      </View>
      </>
      ) : null}
    </View>
  );
}

/** The four-colour Google G, for the sign-in offer row. */
function ShieldGlyph({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l7 3v6c0 4-3 6.6-7 8-4-1.4-7-4-7-8V6z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M9 12l2 2 4-4" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function OfferRow({
  icon,
  title,
  body,
  selected,
  onToggle,
}: {
  icon: 'clock' | 'progress' | 'scale' | 'google';
  title: string;
  body: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        {icon === 'google' ? (
          <GoogleGlyph size={20} />
        ) : (
          <VinhaIcon name={icon} size={20} color={theme.purpleBright} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <VinhaIcon name="check" size={14} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

/**
 * What the gesture bar needs when the inset says nothing.
 *
 * Android reports 24dp for the gesture area on the devices that have one, and
 * this screen gets 0 — so the floor is that 24, not a number picked to make a
 * screenshot look right.
 */
const GESTURE_BAR_FLOOR = 24;

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    // The scroll view carries the background too: its content is shorter than
    // the screen, and without this the card ended in a visible seam.
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: 72,
      paddingBottom: spacing.xl,
      gap: spacing.md,
      backgroundColor: theme.surface,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.ink,
      letterSpacing: -0.4,
    },
    body: {
      fontSize: 14.5,
      lineHeight: 21,
      color: theme.muted,
      marginBottom: spacing.sm,
    },
    // Each row is a decision, not a list item: the reader is meant to read
    // it and answer it. At 15.5/13 in medium padding they read as settings
    // someone had already dealt with (user 2026-08-31).
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      paddingHorizontal: 18,
      paddingVertical: 20,
    },
    rowSelected: {
      borderColor: theme.purpleBright,
    },
    rowIcon: {
      width: 48,
      height: 48,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      fontSize: 18,
      lineHeight: 23,
      fontWeight: '800',
      color: theme.ink,
      letterSpacing: -0.2,
    },
    rowBody: {
      fontSize: 15,
      lineHeight: 20,
      color: theme.muted,
    },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: {
      borderColor: theme.purpleFill,
      backgroundColor: theme.purpleFill,
    },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      backgroundColor: theme.surface,
    },
    /**
     * A page, not a row: one idea centred in the space a list would have used.
     * Both new pages share it, so the sign-in and the Pro page are the same
     * shape and only their words differ.
     */
    pageBody: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    pageGlyph: {
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pageText: {
      color: theme.muted,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    /** The sign-in page centres on its mark: one logo, one promise under it. */
    pageBodyCentred: {
      alignItems: 'center',
    },
    pageTextCentred: {
      textAlign: 'center',
    },
    /** The way past a page without taking what it offers. */
    pageSkip: {
      color: theme.muted,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      paddingVertical: spacing.sm,
    },
    // In Skip's place while the sign-in runs, at about its height.
    signingIn: {
      paddingVertical: spacing.sm,
    },
    /** Room between the terms box and the button under it. */
    afterConsent: {
      marginTop: spacing.sm,
    },
    /** A button waiting for the terms box: there, but visibly not yet. */
    ctaWaiting: {
      opacity: 0.4,
    },
    /**
     * The shape every other screen in this flow ends on.
     *
     * This one was the A3 cut button at 50dp — a cut corner and a diagonal
     * sheen, on the last screen of a flow whose five previous footers are all
     * plain rounded rectangles at 56–62dp. It read as a different app arriving
     * for the final step (user 2026-09-08, "eri mallinen kuin muualla").
     *
     * Orange, as every footer before it in the flow (user 2026-10-17): orange
     * is what can be pressed. The chosen rows, the box and the links stay
     * violet, the brand colour beside it.
     */
    done: {
      minHeight: 62,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.orange,
    },
    doneText: {
      color: theme.onHighlight,
      fontSize: 19,
      fontWeight: '900',
      letterSpacing: -0.3,
    },
    pressed: {
      opacity: 0.85,
    },
  });
