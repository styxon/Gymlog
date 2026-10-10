import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { CutButton } from './CutButton';
import { CutSurface } from './CutSurface';
import { t } from '../lib/i18n';
import { programLimitSheetCopy } from '../lib/programCapNotice';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The free-tier program cap, shown where the user pressed.
 *
 * Not a route. They were part-way into making something, and navigating away
 * would lose that to a limit they may well dismiss — which is also why the
 * secondary action is a plain "got it" rather than a back arrow.
 *
 * The copy says three things in this order (user 2026-09-14): the wall and its
 * count in the title, the two ways past it (delete one, or Pro), and what the
 * limit never touches — ready-made programmes and the training history. On
 * its own "three programmes" reads as a limit on training, and this app does
 * not hold a log hostage.
 *
 * A3: the card is the cut surface and the CTA is the cut button, the same
 * shapes Home is built from, so the paywall moment reads as part of the app
 * and not as a dialog dropped on top of it.
 */
export function ProgramLimitSheet({
  visible,
  kind = 'own',
  used,
  limit,
  replacingStop = null,
  language,
  onClose,
  onSeePro,
}: {
  visible: boolean;
  /**
   * Which of the two free limits was met: programmes of your own (three,
   * built), or programmes running at once (two). Same sheet, same two
   * buttons, so the reader meets one wall rather than two dialects of it.
   */
  kind?: 'own' | 'running';
  used: number;
  limit: number;
  /** A refused Start next: how many others to stop (RunningCapRefusal). */
  replacingStop?: number | null;
  language: AppLanguage;
  onClose: () => void;
  onSeePro: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const copy = programLimitSheetCopy(kind, used, limit, replacingStop);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Stops a tap inside the card from closing it. */}
        <Pressable style={styles.cardWrap} onPress={() => {}}>
          <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
            {/* The count sits in the title ("· 3/3"). It used to be a pill of
                its own under the body, the same number said twice. */}
            <Text style={styles.title}>{t(language, copy.titleKey, copy.vars)}</Text>
            <Text style={styles.body}>{t(language, copy.bodyKey, copy.vars)}</Text>
            <View style={styles.actions}>
              <CutButton size="lg" label={t(language, 'programLimit.cta')} onPress={onSeePro} />
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.later}>
                <Text style={styles.laterText}>{t(language, 'programLimit.later')}</Text>
              </Pressable>
            </View>
          </CutSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  cardWrap: {
    width: '100%',
  },
  card: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: theme.ink,
  },
  body: {
    marginTop: 10,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
    color: theme.muted,
  },
  actions: {
    marginTop: 20,
    gap: 6,
  },
  later: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.muted,
  },
});
