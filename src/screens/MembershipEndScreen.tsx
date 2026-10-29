import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '../components/BackButton';
import { formatDate } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import {
  MembershipSource,
  PRO_UNLOCK_CARDS,
  PRO_UNLOCK_LIMIT_VARS,
  resolveMembershipEndPlan,
} from '../lib/proBenefits';
import {
  MembershipEndCard,
  resolveMembershipEndCard,
  resolveMembershipEndView,
} from '../lib/membershipEndView';
import { CANCEL_REASON_KEYS, CancelReasonKey } from '../lib/cancelSurvey';
import { layout, radii } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';

interface MembershipEndScreenProps {
  source: MembershipSource;
  /** ISO date a promo runs out on; null when Pro is not promo-based. */
  promoUntil: string | null;
  /**
   * When the current billing period ends. Used for the lead sentence when Pro
   * is not promo-based — a cancelled subscription keeps working until then.
   */
  periodEndsAt?: string | null;
  /** A cancellation is on record: the screen offers only a way back. */
  cancelled?: boolean;
  /** The cancellation stamp is a failed payment the store is retrying, not the reader's choice. */
  billingIssue?: boolean;
  language?: AppLanguage;
  onBack: () => void;
  /** Keeps Pro — goes back where the reader came from. */
  onKeep: () => void;
  /** Ends Pro. Only offered when the app can actually do it. */
  onEndNow: () => void;
  /**
   * A store subscription: ending it happens in the store, so the end line
   * opens it there and the splash and survey do not run — the splash says the
   * membership ended, and at this tap it has not.
   */
  onEndInStore?: () => void;
  /** Stores the cancel reasons. Local only — there is no server to send to. */
  onSurveyDone: (reasons: CancelReasonKey[], note: string) => void;
}

/**
 * The moment before Pro goes away: everything it does, and what it turns back
 * into (design: "Vinha Tilaus - hallinta", the Lopeta jäsenyys page).
 *
 * It used to be a list of crosses — the nine things that stop. This states the
 * *difference*, in the same shape the unlock screen uses on the way in and for
 * the same reason: "Unlimited → 3 questions a week" is a specific, checkable
 * loss, where "AI coach ✕" is only a threat. The pairs come from
 * PRO_UNLOCK_CARDS with the arrow reversed, and the numbers from
 * PRO_UNLOCK_LIMIT_VARS, so the page that sells Pro and the page that takes it
 * away cannot describe different products.
 *
 * Three steps, all here rather than as three routes, because the back button
 * means something different at each one and a route stack would have to be
 * unwound after the last: the page, a splash while it lands, and a survey that
 * can be skipped.
 *
 * What it still refuses to do is offer a cancel button with nothing behind it.
 * Pro from a promo cannot be cancelled — it lapses, and the page says when.
 */
export function MembershipEndScreen({
  source,
  promoUntil,
  periodEndsAt = null,
  cancelled = false,
  billingIssue = false,
  language = 'en',
  onBack,
  onKeep,
  onEndNow,
  onEndInStore,
  onSurveyDone,
}: MembershipEndScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // The period the reader already paid for is what a cancelled purchase runs
  // to, so the plan has to be told about it — otherwise "You keep all of it
  // until then" names no day.
  const plan = resolveMembershipEndPlan(source, promoUntil, periodEndsAt ?? null);
  const [step, setStep] = useState<'page' | 'splash' | 'survey'>('page');

  const endsAt = plan.lapsesOn ?? periodEndsAt;
  const view = resolveMembershipEndView({ canEndNow: plan.canEndNow, cancelled, billingIssue });
  const card = resolveMembershipEndCard(view, plan.lapsesOn);
  const copy = membershipEndCopy(language, card.notice, endsAt, plan.lapsesOn);

  return step === 'splash' ? (
    <EndSplash
      language={language}
      endsAt={endsAt}
      onDone={() => {
        onEndNow();
        setStep('survey');
      }}
    />
  ) : step === 'survey' ? (
    <CancelSurvey
      language={language}
      onDone={(reasons, note) => {
        onSurveyDone(reasons, note);
        onBack();
      }}
    />
  ) : (
    <View style={styles.screen}>
      <PageHeader
        style={styles.header}
        title={t(language, 'membership.end.header')}
        onBack={onBack}
        backLabel={t(language, 'common.back')}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
      >
        {/* One card, one filled action (design: "Jäsenyyden päättymisruutu",
            2026-10-29). Ending is a quiet red line under the card, so the
            destructive choice never sits where the thumb lands. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{copy.title}</Text>
          <Text style={styles.cardBody}>{copy.body}</Text>

          {card.showLosses ? (
            <View style={styles.list}>
              {/* The same change rows as the unlock screen, run backwards: what
                  you have (violet, a state) → what it becomes (grey, also a
                  state — losing a feature is not an alarm). */}
              {PRO_UNLOCK_CARDS.map((unlock, index) => (
                <View
                  key={unlock.titleKey}
                  style={[styles.lossRow, index === PRO_UNLOCK_CARDS.length - 1 && styles.lossRowLast]}
                >
                  <Text style={styles.lossTitle}>
                    {t(language, unlock.titleKey, vars(unlock.titleKey))}
                  </Text>
                  <View style={styles.lossDelta}>
                    {/* Now → was. The unlock screen runs this pair the other way. */}
                    <View style={styles.haveChip}>
                      <Text style={styles.haveChipText}>{t(language, unlock.nowKey, vars(unlock.nowKey))}</Text>
                    </View>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M5 12h13M13 7l5 5-5 5"
                        stroke={theme.faint}
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                    <View style={styles.becomesChip}>
                      <Text style={styles.becomesChipText}>{t(language, unlock.wasKey, vars(unlock.wasKey))}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {card.showKeeps ? <Text style={styles.keeps}>{t(language, 'subs.end.keeps')}</Text> : null}

          {/* Nothing to decide outside a renewing purchase, so the one action
              is back: a cancelled or promo membership is never asked to be
              kept or ended again. */}
          <Pressable
            accessibilityRole="button"
            onPress={view.mode === 'decide' ? onKeep : onBack}
            style={({ pressed }) => [styles.keepButton, styles.cardAction, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.keepButtonText}>
              {t(language, view.mode === 'decide' ? 'subs.end.keep' : 'common.back')}
            </Text>
          </Pressable>
        </View>

        {view.mode === 'decide' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onEndInStore ?? (() => setStep('splash'))}
            style={({ pressed }) => [styles.endLink, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.endLinkText}>{t(language, 'subs.end.cta')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The card's title and line for each notice. */
function membershipEndCopy(
  language: AppLanguage,
  notice: MembershipEndCard['notice'],
  endsAt: string | null,
  lapsesOn: string | null,
): { title: string; body: string } {
  const date = (iso: string) => ({ date: formatDate(iso, language) });
  switch (notice) {
    case 'renewing':
      return {
        title: endsAt ? t(language, 'subs.end.paidUntil', date(endsAt)) : t(language, 'subs.end.active'),
        body: t(language, 'subs.end.ifEnd'),
      };
    case 'cancelled':
      return {
        title: t(language, 'subs.end.cancelledTitle'),
        body: endsAt ? t(language, 'subs.end.cancelledBody', date(endsAt)) : t(language, 'subs.cancelledNote'),
      };
    case 'billing':
      return {
        title: t(language, 'subs.end.billingTitle'),
        body: endsAt ? t(language, 'subs.end.billingBody', date(endsAt)) : t(language, 'subs.end.billingBodyNoDate'),
      };
    case 'promo':
      return {
        title: t(language, 'membership.end.nothingTitle'),
        body: lapsesOn ? t(language, 'membership.end.promoBody', date(lapsesOn)) : t(language, 'membership.end.nothingBody'),
      };
    default:
      return { title: t(language, 'membership.end.nothingTitle'), body: t(language, 'membership.end.nothingBody') };
  }
}

function vars(key: I18nKey) {
  return PRO_UNLOCK_LIMIT_VARS[key as string];
}

/**
 * The shield comes apart.
 *
 * A cancel that happens silently reads as a form submission; this is a second
 * and a half that says something left. It is skipped entirely under reduced
 * motion — the timer still runs, so the flow cannot strand anyone on it.
 */
function EndSplash({
  language,
  endsAt,
  onDone,
}: {
  language: AppLanguage;
  endsAt: string | null;
  onDone: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const fade = useRef(new Animated.Value(0)).current;
  const shield = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    void queryReduceMotion().then((reduce) => {
      if (cancelled) {
        return;
      }
      if (reduce) {
        fade.setValue(1);
        shield.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 320,
          delay: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shield, {
          toValue: 1,
          duration: 1100,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ]).start();
    });
    // The handoff is on a timer rather than on the animation finishing, so a
    // reduce-motion reader and an animated one leave at the same moment.
    const id = setTimeout(onDone, 2100);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, []);

  return (
    <View style={styles.splash}>
      <Animated.View
        style={{
          opacity: shield.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 1, 0.25] }),
          transform: [
            { scale: shield.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 1.06, 0.82] }) },
          ],
        }}
      >
        <Svg width={74} height={74} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 3l8 3v6c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6z"
            stroke={theme.faint}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5 19L19 5"
            stroke={theme.danger}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        <Text style={styles.splashTitle}>{t(language, 'subs.end.splashTitle')}</Text>
        {endsAt ? (
          <Text style={styles.splashBody}>
            {t(language, 'subs.end.splashBody', { date: formatDate(endsAt, language) })}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * Why they left — optional, and honest about where the answer goes.
 *
 * The design's button says "Lähetä". There is nothing to send it to, so the
 * fine print says so and the answer is stored on the device. That keeps the
 * word without making it a lie, and the stored reasons are already in the shape
 * an upload would want.
 */
function CancelSurvey({
  language,
  onDone,
}: {
  language: AppLanguage;
  onDone: (reasons: CancelReasonKey[], note: string) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<CancelReasonKey[]>([]);
  const [note, setNote] = useState('');

  const toggle = (key: CancelReasonKey) =>
    setPicked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  const any = picked.length > 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.surveyBody}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.surveyTitle}>{t(language, 'subs.survey.title')}</Text>
        <Text style={styles.surveySub}>{t(language, 'subs.survey.sub')}</Text>

        <View style={styles.surveyList}>
          {CANCEL_REASON_KEYS.map((key) => {
            const on = picked.includes(key);
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => toggle(key)}
                // The kit's own picker row: orange tick, tap again to unpick
                // (design: GAINER Pro screens, 03). The state colour is the
                // accent, because picking is the one thing the row does.
                style={[styles.surveyRow, on && styles.surveyRowOn]}
              >
                <Text style={styles.surveyRowText}>{t(language, key)}</Text>
                {on ? (
                  <View style={styles.surveyCheck}>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M5 13l4 4L19 7"
                        stroke={theme.onHighlight}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                ) : (
                  <View style={styles.surveyEmpty} />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* The box appears once anything is picked, not only for "something
            else": whichever reason it was, the words are worth having. */}
        {any ? (
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t(language, 'subs.survey.other')}
            placeholderTextColor={theme.faint}
            multiline
            style={styles.surveyInput}
          />
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.surveyLocal}>{t(language, 'subs.survey.local')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDone(picked, note.trim())}
          // Send is the single orange action on the screen; Skip below is the
          // quiet link the bar always uses. Nothing picked yet: Send is quiet
          // too, so the screen never has two things asking to be pressed.
          style={({ pressed }) => [
            styles.keepButton,
            any ? styles.surveySendOn : styles.surveySendQuiet,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.keepButtonText, !any && styles.surveySendQuietText]}>
            {t(language, 'subs.survey.send')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDone([], '')}
          style={({ pressed }) => [styles.surveySkip, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.surveySkipText}>{t(language, 'subs.survey.skip')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      paddingHorizontal: layout.screenGutter,
      paddingTop: layout.pageHeaderTop,
      paddingBottom: 6,
    },
    body: {
      paddingTop: 6,
      paddingHorizontal: layout.screenGutter,
      paddingBottom: 24,
    },
    card: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radii.lg,
      paddingTop: 22,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    cardTitle: {
      color: theme.ink,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.8,
      lineHeight: 30,
    },
    cardBody: {
      color: theme.muted,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 21,
      marginTop: 8,
    },
    list: {
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    lossRow: {
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    lossRowLast: {
      borderBottomWidth: 0,
    },
    lossTitle: {
      color: theme.ink,
      fontSize: 15.5,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    lossDelta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    // What you have: a violet state chip, the same one the unlock screen
    // gives the new value. What it becomes: a grey chip, not red.
    haveChip: {
      backgroundColor: theme.purpleLight,
      borderRadius: 6,
      paddingVertical: 3,
      paddingHorizontal: 8,
    },
    haveChipText: {
      color: theme.purpleDark,
      fontSize: 12.5,
      fontWeight: '800',
    },
    becomesChip: {
      backgroundColor: theme.surfaceSoft,
      borderRadius: 6,
      paddingVertical: 3,
      paddingHorizontal: 8,
    },
    becomesChipText: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '800',
    },
    endLink: {
      alignSelf: 'center',
      minHeight: 44,
      paddingHorizontal: 16,
      marginTop: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    endLinkText: {
      // The theme's danger TEXT token, not a fixed red: the old fixed fill-red
      // as text on the dark surface falls under 4:1. theme.danger stays
      // readable on both.
      color: theme.danger,
      fontSize: 15,
      fontWeight: '800',
    },
    keeps: {
      color: theme.faint,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 12,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 13,
      gap: 10,
    },
    cardAction: {
      marginTop: 18,
    },
    keepButton: {
      height: 54,
      borderRadius: 16,
      backgroundColor: theme.highlight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keepButtonText: {
      color: theme.onHighlight,
      fontSize: 16.5,
      fontWeight: '800',
    },
    splash: {
      flex: 1,
      backgroundColor: theme.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 26,
      padding: 28,
    },
    splashTitle: {
      color: theme.ink,
      fontSize: 24,
      fontWeight: '800',
      letterSpacing: -0.72,
      textAlign: 'center',
    },
    splashBody: {
      color: theme.muted,
      fontSize: 15.5,
      fontWeight: '700',
      marginTop: 8,
      textAlign: 'center',
    },
    surveyBody: {
      paddingTop: 24,
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    surveyTitle: {
      color: theme.ink,
      fontSize: 30,
      fontWeight: '800',
      letterSpacing: -1.05,
      lineHeight: 33,
    },
    surveySub: {
      color: theme.muted,
      fontSize: 15.5,
      fontWeight: '600',
      lineHeight: 22.5,
      marginTop: 11,
    },
    surveyList: {
      gap: 9,
      marginTop: 20,
    },
    surveyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 16,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    surveyRowOn: {
      backgroundColor: theme.surfaceSoft,
      borderColor: theme.highlight,
    },
    surveyRowText: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: -0.24,
    },
    surveyCheck: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.highlight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    surveyEmpty: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    surveyInput: {
      minHeight: 96,
      marginTop: 11,
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1.5,
      borderColor: theme.border,
      borderRadius: 16,
      paddingVertical: 13,
      paddingHorizontal: 14,
      color: theme.ink,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 22,
      textAlignVertical: 'top',
    },
    surveyLocal: {
      color: theme.faint,
      fontSize: 11.5,
      fontWeight: '600',
      textAlign: 'center',
      lineHeight: 17,
    },
    surveySendOn: {
      backgroundColor: theme.highlight,
    },
    surveySendQuiet: {
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.border,
    },
    surveySendQuietText: {
      color: theme.faint,
    },
    surveySkip: {
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    surveySkipText: {
      color: theme.muted,
      fontSize: 15,
      fontWeight: '800',
    },
  });
