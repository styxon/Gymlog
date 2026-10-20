import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../lib/i18n';
import { spacing } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { LegalConsentCheck } from './LegalConsentCheck';

interface LegalConsentSheetProps {
  /**
   * The shell's SafeAreaView already stops above the navigation bar on most
   * screens. Adding the inset again there doubled it (#bugs 2026-09-26).
   */
  shellPadsBottom: boolean;
  language: AppLanguage;
  /** 'first' never accepted; 'changed' accepted an earlier version. */
  reason: 'first' | 'changed';
  /** The documents' date, already formatted for the reader. */
  updatedLabel: string;
  onOpenLegal: (document: 'privacy' | 'terms') => void;
  /** Resolves once the acceptance is stored; the shell hides the sheet then. */
  onAccept: () => Promise<void>;
}

/**
 * The terms question, over whatever the app was showing.
 *
 * It cannot be closed (user, 2026-09-26): no ✕, no backdrop tap, and the back
 * key leaves the app rather than the sheet. It is asked once per version of
 * the documents, so the cost is a tick and a tap — and an acceptance that
 * could be swiped away would be no record of anything.
 *
 * Drawn as a plain overlay rather than a Modal, so the documents it links to
 * can open ON TOP of it the way they open over the onboarding hand-off. And it
 * does not hide itself: it disappears when the stored acceptance says it is no
 * longer owed, which is after the write — never on the tap.
 */
export function LegalConsentSheet({
  shellPadsBottom,
  language,
  reason,
  updatedLabel,
  onOpenLegal,
  onAccept,
}: LegalConsentSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // Back leaves the app, as it would from any first screen: there is nothing
  // behind this to go back to until it is answered. The document overlay
  // registers its own listener when it opens, later and so first in line.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const canContinue = checked && !saving;

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.scrim} />
      <View
        style={[
          styles.sheet,
          { paddingBottom: (shellPadsBottom ? 0 : Math.max(insets.bottom, GESTURE_BAR_FLOOR)) + spacing.lg },
        ]}
      >
        <Text style={styles.title} accessibilityRole="header">
          {t(language, 'legal.consent.title')}
        </Text>
        <Text style={styles.body}>
          {reason === 'changed'
            ? t(language, 'legal.consent.bodyChanged', { date: updatedLabel })
            : t(language, 'legal.consent.bodyFirst')}
        </Text>
        <LegalConsentCheck
          language={language}
          checked={checked}
          onToggle={() => {
            setFailed(false);
            setChecked((current) => !current);
          }}
          onOpenLegal={onOpenLegal}
        />
        {failed ? <Text style={styles.error}>{t(language, 'legal.consent.saveFailed')}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue, busy: saving }}
          disabled={!canContinue}
          onPress={() => {
            setSaving(true);
            setFailed(false);
            onAccept().then(
              // Unmounted by the shell on success; nothing to reset.
              () => undefined,
              () => {
                setSaving(false);
                setFailed(true);
              },
            );
          }}
          style={({ pressed }) => [
            styles.cta,
            !canContinue && styles.ctaDisabled,
            pressed && canContinue && styles.pressed,
          ]}
        >
          <Text style={[styles.ctaText, !canContinue && { color: theme.faint }]}>
            {t(language, 'common.continue')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Android's gesture bar when the inset reads 0 — see SetupHandoffScreen. */
const GESTURE_BAR_FLOOR = 24;

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      zIndex: 40,
      elevation: 40,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(6, 4, 16, 0.62)',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderTopWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: spacing.lg,
      paddingTop: 24,
      gap: 14,
    },
    title: {
      color: theme.ink,
      fontSize: 21,
      lineHeight: 26,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    body: {
      color: theme.muted,
      fontSize: 14.5,
      lineHeight: 21,
      fontWeight: '600',
    },
    error: {
      color: theme.danger,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    cta: {
      minHeight: 56,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
      marginTop: 4,
    },
    ctaDisabled: {
      backgroundColor: theme.surfaceSoft,
    },
    ctaText: {
      color: theme.onHighlight,
      fontSize: 17,
      fontWeight: '900',
      letterSpacing: -0.2,
    },
    pressed: {
      opacity: 0.85,
    },
  });
