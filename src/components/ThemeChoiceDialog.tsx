import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { t } from '../lib/i18n';
import { Theme, darkTheme, lightTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

interface ThemeChoiceDialogProps {
  visible: boolean;
  language: AppLanguage;
  /** The live value, so the picker shows what is actually on. */
  darkEnabled: boolean;
  /** Applied immediately — the dialog repaints itself as the preview. */
  onChange: (dark: boolean) => void;
  onDone: () => void;
  /** The Modal's onDismiss, for useModalHandoff (iOS only; see TrackChangeDialog). */
  onDismissed?: () => void;
}

/**
 * "Light or dark?"
 *
 * The hand-off's last page, after the Pro page, the widget and the tracking
 * sheet (user 2026-10-17). It was asked right after "Let's begin" from
 * 2026-08-23, which put this box in front of the orange welcome before a
 * single question; the flow is dark until here now. Before that it was offered
 * on the way out of the Pro unlock screen, back when dark was a perk.
 *
 * The choice applies on tap rather than on a confirm button, and the dialog is
 * themed, so tapping Dark repaints the dialog under the reader's finger. That
 * is the whole preview — no swatch can say what the app looks like as well as
 * the app looking like it.
 *
 * Both previews are drawn from the palettes directly rather than from the
 * active theme, so each tile shows its own theme whichever one is on.
 */
export function ThemeChoiceDialog({
  visible,
  language,
  darkEnabled,
  onChange,
  onDone,
  onDismissed,
}: ThemeChoiceDialogProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone} onDismiss={onDismissed}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          {/* No explanatory line under the title (user 2026-08-24). It said
              the tap was instant and that this is what the app looks like —
              both of which the two live previews say by being live previews.
              A caption that narrates the control below it is the caption the
              control did not need. */}
          <Text style={styles.title}>{t(language, 'themeChoice.title')}</Text>

          <View style={styles.options}>
            <ThemeOption
              label={t(language, 'themeChoice.light')}
              palette={lightTheme}
              selected={!darkEnabled}
              onPress={() => onChange(false)}
            />
            <ThemeOption
              label={t(language, 'themeChoice.dark')}
              palette={darkTheme}
              selected={darkEnabled}
              onPress={() => onChange(true)}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ctaText}>{t(language, 'themeChoice.done')}</Text>
          </Pressable>
          <Text style={styles.foot}>{t(language, 'themeChoice.foot')}</Text>
        </View>
      </View>
    </Modal>
  );
}

/** One tile: a miniature of the app painted in that theme's own colours. */
function ThemeOption({
  label,
  palette,
  selected,
  onPress,
}: {
  label: string;
  palette: Theme;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <View style={[styles.preview, { backgroundColor: palette.bg }]}>
        <View style={[styles.previewBar, { backgroundColor: palette.purple }]} />
        <View style={[styles.previewCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.previewLine, { backgroundColor: palette.ink }]} />
          <View style={[styles.previewLineShort, { backgroundColor: palette.faint }]} />
        </View>
        <View style={[styles.previewCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.previewLine, { backgroundColor: palette.ink }]} />
        </View>
      </View>
      <View style={styles.optionFoot}>
        <Text style={styles.optionLabel}>{label}</Text>
        {selected ? (
          <View style={styles.check}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 13l4 4L19 7"
                stroke="#FFFFFF"
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        ) : (
          <View style={styles.checkEmpty} />
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: 'rgba(6,4,14,0.62)',
    },
    dialog: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 24,
      paddingVertical: 22,
      paddingHorizontal: 20,
    },
    title: {
      color: theme.ink,
      fontSize: 21,
      fontWeight: '800',
      letterSpacing: -0.6,
      lineHeight: 26,
    },
    options: {
      flexDirection: 'row',
      gap: 11,
      marginTop: 18,
    },
    option: {
      flex: 1,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      padding: 9,
    },
    optionSelected: {
      borderColor: theme.purple,
      backgroundColor: theme.purpleSoft,
    },
    preview: {
      height: 96,
      borderRadius: 10,
      padding: 8,
      gap: 6,
      overflow: 'hidden',
    },
    previewBar: {
      height: 8,
      width: '46%',
      borderRadius: 999,
    },
    previewCard: {
      borderRadius: 7,
      borderWidth: 1,
      paddingVertical: 7,
      paddingHorizontal: 7,
      gap: 4,
    },
    previewLine: {
      height: 4,
      width: '72%',
      borderRadius: 999,
      opacity: 0.85,
    },
    previewLineShort: {
      height: 4,
      width: '44%',
      borderRadius: 999,
      opacity: 0.7,
    },
    optionFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 9,
      paddingHorizontal: 2,
    },
    optionLabel: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
    check: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: theme.purple,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkEmpty: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    cta: {
      height: 50,
      borderRadius: 15,
      // Orange, as every Done in the flow; the tiles' choice stays violet.
      backgroundColor: theme.orange,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
    },
    ctaText: {
      color: theme.onHighlight,
      fontSize: 15.5,
      fontWeight: '800',
    },
    foot: {
      color: theme.faint,
      fontSize: 11.5,
      fontWeight: '600',
      textAlign: 'center',
      lineHeight: 17,
      marginTop: 11,
    },
  });
