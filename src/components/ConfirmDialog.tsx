import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { radii, spacing } from '../theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  language: AppLanguage;
  cancelLabel?: string;
  destructive?: boolean;
  /** Long-press copies the message: for one that holds an address to type elsewhere. */
  selectableMessage?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** The Modal's onDismiss, for useModalHandoff (iOS only; see TrackChangeDialog). */
  onDismissed?: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  language,
  cancelLabel,
  destructive,
  selectableMessage = false,
  onCancel,
  onConfirm,
  onDismissed,
}: ConfirmDialogProps) {
  const styles = useThemedStyles(makeStyles);
  // Back is the reflexive "no" on Android, and a dialog that asks before
  // something destructive has to accept it: without onRequestClose the
  // hardware back button did nothing at all here (audit 3, 2026-09-19).
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onDismiss={onDismissed}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message} selectable={selectableMessage}>
            {message}
          </Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{cancelLabel ?? t(language, 'common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              style={[styles.primaryButton, destructive && styles.destructiveButton]}
            >
              <Text style={styles.primaryText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(16, 24, 40, 0.45)',
  },
  dialog: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: spacing.xl,
    gap: spacing.md,
    shadowColor: theme.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  title: {
    color: theme.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  message: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  // Wraps. At the large font sizes "Peruuta" and a long confirm label did
  // not fit one row, and a row that cannot wrap pushed the confirm button
  // past the dialog's edge (accessibility audit, 2026-09-21). With wrap the
  // confirm drops under Cancel, still right-aligned, and each button may
  // shrink so its own label wraps before it clips.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  secondaryButton: {
    flexShrink: 1,
    maxWidth: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryText: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryButton: {
    flexShrink: 1,
    maxWidth: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    // The white-label violet: white on the dark theme's `purple` was 3.49:1
    // (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
  },
  destructiveButton: {
    backgroundColor: '#DC2626',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});
