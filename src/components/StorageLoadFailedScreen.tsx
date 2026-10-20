import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import * as SplashScreen from 'expo-splash-screen';

import { t } from '../lib/i18n';
import { resolveDeviceLanguage } from '../storage/deviceLocale';
import { colors, radii, spacing, typography } from '../theme';

/**
 * Shown when the phone's storage refused to hand back what the app saved.
 *
 * The alternative was opening as a new install. That app then wrote its empty
 * database and default preferences over the stored ones on the first save,
 * so a read that failed once — a locked database, an I/O error — cost the
 * reader everything they had logged, with nothing set aside. Here nothing has
 * been written, and trying again reads the same bytes.
 *
 * It renders above the theme and the preferences, both of which live in the
 * data that did not load, so it uses the fixed palette and the phone's language.
 */
export function StorageLoadFailedScreen({ onRetry }: { onRetry: () => void }) {
  const language = resolveDeviceLanguage();

  useEffect(() => {
    // The native splash is hidden by the app once its data has loaded, which
    // is exactly what did not happen.
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(language, 'storageLoadFailed.title')}</Text>
      <Text style={styles.body}>{t(language, 'storageLoadFailed.body')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text style={styles.buttonText}>{t(language, 'storageLoadFailed.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    fontFamily: typography.fontFamily,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontFamily: typography.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  buttonPressed: {
    backgroundColor: colors.accentPressed,
  },
  buttonText: {
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: colors.background,
  },
});
