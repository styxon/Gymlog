import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { Theme, useThemedStyles } from '../theming';

interface SubscriptionSheetProps {
  visible: boolean;
  title: string;
  /** One line under the title. Omitted when the list explains itself. */
  sub?: string | null;
  /**
   * The navigation bar's height, read on the screen and passed down: inside a
   * Modal this app measures the safe-area inset as zero, and the sheet's own
   * Close button sat under the phone's navigation keys (#bugs 2026-09-23).
   */
  bottomInset: number;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The bottom sheet the three subscription panels share.
 *
 * One component rather than three, because the only thing that differs between
 * "change billing period", "payment method" and "past payments" is the list in
 * the middle — and three copies of a grabber, a veil and a title block is three
 * places for the corner radius to drift.
 *
 * The bottom corners are rounder than the top (38 vs 24), which is the design's
 * own shape: the sheet reads as something that rose out of the screen edge
 * rather than a card that happens to be at the bottom.
 */
export function SubscriptionSheet({
  visible,
  title,
  sub = null,
  bottomInset,
  onClose,
  children,
}: SubscriptionSheetProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" style={styles.veil} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: 20 + bottomInset }]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    veil: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(6,4,14,0.62)',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderBottomLeftRadius: 38,
      borderBottomRightRadius: 38,
      paddingHorizontal: 18,
      paddingTop: 16,
      maxHeight: '86%',
    },
    grabber: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      alignSelf: 'center',
      marginBottom: 15,
    },
    title: {
      color: theme.ink,
      fontSize: 19.5,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    sub: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 19.5,
      marginTop: 7,
    },
    body: {
      paddingBottom: 4,
    },
  });
