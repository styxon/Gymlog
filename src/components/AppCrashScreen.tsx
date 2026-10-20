import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import * as SplashScreen from 'expo-splash-screen';

import { t } from '../lib/i18n';
import { resolveDeviceLanguage } from '../storage/deviceLocale';
import { colors, radii, spacing, typography } from '../theme';

/**
 * Shown when the app hit a bug it could not draw past (AppErrorBoundary).
 *
 * Calm on purpose, and honest about the one thing a reader needs to know:
 * nothing was deleted. A render error does not touch what is stored, so the
 * sentence is true; "Try again" remounts the app, which reads it back.
 *
 * It renders above the theme and the preferences — the boundary sits outside
 * both, since either could be what failed — so it uses the fixed palette and
 * the phone's language, like StorageLoadFailedScreen.
 *
 * After a "Try again" that failed again (`aside` given by the boundary), and
 * only when a stored workout exists, a second, quieter action offers to put the
 * workout in progress aside — the way out when the bundle is what the app
 * cannot draw. The screen goes on to remount only once the copy has been
 * written; a copy that fails says so and leaves everything as it was.
 */
export interface CrashAsideAction {
  /** Whether there is a stored workout to put aside; the action shows only if so. */
  isAvailable: () => Promise<boolean>;
  /** Copies it aside and removes it from where the app reads it; rejects if the copy failed. */
  run: () => Promise<unknown>;
}

export function AppCrashScreen({ onRetry, aside }: { onRetry: () => void; aside?: CrashAsideAction }) {
  const language = resolveDeviceLanguage();
  const [asideAvailable, setAsideAvailable] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveFailed, setMoveFailed] = useState(false);

  useEffect(() => {
    // If the failure came before the app hid it, the splash would cover this.
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!aside) {
      return undefined;
    }
    let mounted = true;
    aside.isAvailable().then(
      (available) => mounted && setAsideAvailable(available),
      () => undefined,
    );
    return () => {
      mounted = false;
    };
  }, [aside]);

  const putAside = () => {
    if (!aside || moving) {
      return;
    }
    setMoving(true);
    setMoveFailed(false);
    // Nothing is shown as done before the write resolves: the success is the
    // remount that follows it.
    aside.run().then(
      () => onRetry(),
      () => {
        setMoving(false);
        setMoveFailed(true);
      },
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t(language, 'appCrash.title')}</Text>
      <Text style={styles.body}>{t(language, 'appCrash.body')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text style={styles.buttonText}>{t(language, 'appCrash.retry')}</Text>
      </Pressable>
      {aside && asideAvailable ? (
        <View style={styles.asideBlock}>
          <Text style={styles.asideHint}>{t(language, 'appCrash.asideHint')}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={moving}
            onPress={putAside}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>
              {t(language, moving ? 'appCrash.asideWorking' : 'appCrash.aside')}
            </Text>
          </Pressable>
          {moveFailed ? <Text style={styles.asideFailed}>{t(language, 'appCrash.asideFailed')}</Text> : null}
        </View>
      ) : null}
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
  asideBlock: {
    marginTop: spacing.xl,
  },
  asideHint: {
    fontFamily: typography.fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonPressed: {
    opacity: 0.7,
  },
  secondaryButtonText: {
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  asideFailed: {
    fontFamily: typography.fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});
