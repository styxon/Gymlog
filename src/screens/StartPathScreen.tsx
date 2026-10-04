import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { OnboardingBackButton } from '../components/OnboardingBackButton';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { t } from '../lib/i18n';
import { darkTheme, Theme, useTheme, useThemedStyles } from '../theming';
import { HG_DARK } from '../darkTheme';
import { AppLanguage } from '../types/models';

/**
 * This screen's own tokens, in two.
 *
 * Light is the original HG set to the digit; dark exists because the theme is
 * chosen one screen earlier (2026-08-23) and this is the first screen after
 * that choice — a white one here contradicts the tap the reader just made.
 * Kept local rather than mapped onto the app `Theme`, whose values are close
 * but not identical, so the light flow is pixel-for-pixel unchanged.
 */
interface PathPalette {
  surface: string;
  ink: string;
  muted: string;
  border: string;
  purple: string;
  purpleDark: string;
  purpleSoft: string;
  /** Secondary copy, a notch darker than `muted` in light. */
  soft: string;
  /** The chosen card's border. */
  chosen: string;
}

const PATH_LIGHT: PathPalette = {
  surface: '#FFFFFF',
  ink: '#101828',
  muted: '#667085',
  border: '#E4D8FF',
  purple: '#7C3AED',
  purpleDark: '#5B21B6',
  purpleSoft: '#EEE7FC',
  soft: '#475467',
  chosen: '#C9B6FF',
};

const PATH_DARK: PathPalette = {
  surface: HG_DARK.surface,
  ink: HG_DARK.ink,
  muted: HG_DARK.muted,
  border: HG_DARK.border,
  purple: HG_DARK.purple,
  purpleDark: HG_DARK.purpleBright,
  purpleSoft: HG_DARK.purpleSoft,
  soft: HG_DARK.muted,
  chosen: HG_DARK.purple,
};

const paletteFor = (theme: Theme): PathPalette => (theme === darkTheme ? PATH_DARK : PATH_LIGHT);

type StartPath = 'build' | 'ready' | 'empty';

interface StartPathScreenProps {
  language?: AppLanguage;
  onGuidedOnboarding: () => void;
  onBrowsePrograms: () => void;
  /**
   * Into the app with no programme at all.
   *
   * Undefined hides the row entirely — it is an escape hatch from the front
   * door, not a mode every caller of this screen should offer.
   */
  onStartEmpty?: () => void | Promise<void>;
  onBack: () => void;
}

function PathIcon({ name, color }: { name: 'sparkle' | 'grid' | 'blank'; color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      {/* An empty sheet: the third answer is starting with nothing on Home. */}
      {name === 'blank' ? (
        <Path
          d="M6 3h8l4 4v14H6V3zm8 0v4h4"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {name === 'sparkle' ? (
        <Path
          d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'grid' ? (
        <Path
          d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  );
}

function CheckCircle({ selected }: { selected: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const C = paletteFor(useTheme());

  if (!selected) {
    return <View style={styles.checkRing} />;
  }
  return (
    <View style={styles.checkCircle}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path d="M5 12l5 5L19 7" stroke={C.purple} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

interface PathCardProps {
  icon: 'sparkle' | 'grid' | 'blank';
  title: string;
  body: string;
  recommendedLabel?: string | null;
  selected: boolean;
  fontFamily?: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function PathCard({ icon, title, body, recommendedLabel, selected, fontFamily, accessibilityLabel, onPress }: PathCardProps) {
  const styles = useThemedStyles(makeStyles);
  const C = paletteFor(useTheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && styles.cardPressed]}
    >
      <View style={[styles.cardIconTile, selected && styles.cardIconTileSelected]}>
        <PathIcon name={icon} color={selected ? '#FFFFFF' : C.purple} />
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, selected && styles.cardTitleSelected, { fontFamily }]}>{title}</Text>
          {recommendedLabel ? (
            <View style={[styles.recommendedPill, selected && styles.recommendedPillSelected]}>
              <Text
                style={[styles.recommendedPillText, selected && styles.recommendedPillTextSelected, { fontFamily }]}
              >
                {recommendedLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.cardBody, selected && styles.cardBodySelected, { fontFamily }]}>{body}</Text>
      </View>
      <CheckCircle selected={selected} />
    </Pressable>
  );
}

export function StartPathScreen({
  language = 'en',
  onGuidedOnboarding,
  onBrowsePrograms,
  onStartEmpty,
  onBack,
}: StartPathScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [manropeLoaded] = useFonts({ Manrope: require('../../assets/fonts/Manrope.ttf') });
  const fontFamily = manropeLoaded ? 'Manrope' : undefined;
  const [selected, setSelected] = useState<StartPath>('build');
  // A ref, not state: two taps in one frame both see the same render. Held
  // until the start-empty write settles, released on failure so the retry the
  // toast invites works (bug hunt, 2026-10-04).
  const startingEmptyRef = useRef(false);
  // The key goes where the chevron goes: back to Welcome, the one screen
  // where leaving the app is what back should do.
  useHardwareBack(onBack);

  return (
    // Top padding = inset + the back chevron (10 + 40) + a gap, so the title
    // starts under the button instead of behind it.
    <View style={[styles.screen, { paddingTop: insets.top + 10 + 40 + 22, paddingBottom: insets.bottom + 14 }]}>
      <Text style={[styles.heading, { fontFamily }]}>{t(language, 'startPath.heading')}</Text>
      {/* "You can change your mind later" is gone (user, 2026-08-19): it
          hedged a choice that the app already lets you revisit. */}

      <View style={styles.cardStack}>
        <PathCard
          icon="sparkle"
          title={t(language, 'startPath.build.title')}
          body={t(language, 'startPath.build.body')}
          recommendedLabel={t(language, 'common.recommended')}
          selected={selected === 'build'}
          fontFamily={fontFamily}
          accessibilityLabel={t(language, 'startPath.build.a11y')}
          onPress={() => setSelected('build')}
        />
        {/* The two real answers are alternatives, not a list — the big OR
            says so (user 2026-08-31). Stacked without it they read as steps,
            and the second card looked like something you do after the first. */}
        <View style={styles.orRow}>
          <View style={styles.orRule} />
          <Text style={[styles.orLabel, { fontFamily }]}>{t(language, 'startPath.or')}</Text>
          <View style={styles.orRule} />
        </View>
        <PathCard
          icon="grid"
          title={t(language, 'startPath.ready.title')}
          body={t(language, 'startPath.ready.body')}
          selected={selected === 'ready'}
          fontFamily={fontFamily}
          accessibilityLabel={t(language, 'startPath.ready.a11y')}
          onPress={() => setSelected('ready')}
        />
        {/* The way out (user 2026-08-31). A reader who wants to look around
            before committing to anything had to answer a questionnaire or
            adopt a programme first — the app's front door had no handle for
            "not yet".

            It was a dashed note below the stack, quieter than the two cards
            because it was the lesser answer, and it fired the moment it was
            touched while the two above it waited for Continue. Two shapes and
            two rules on one screen: the user asked for one of each
            (2026-09-08). It is the third card now, and Continue answers for
            it like the others. */}
        {onStartEmpty ? (
          <PathCard
            icon="blank"
            title={t(language, 'startPath.empty.title')}
            body={t(language, 'startPath.empty.body')}
            selected={selected === 'empty'}
            fontFamily={fontFamily}
            accessibilityLabel={t(language, 'startPath.empty.a11y')}
            onPress={() => setSelected('empty')}
          />
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.continue')}
          onPress={() => {
            if (selected === 'build') {
              onGuidedOnboarding();
              return;
            }
            if (selected === 'empty') {
              // Only reachable when the card is on screen, which is the same
              // condition that renders it.
              if (startingEmptyRef.current) {
                return;
              }
              startingEmptyRef.current = true;
              void Promise.resolve(onStartEmpty?.()).finally(() => {
                startingEmptyRef.current = false;
              });
              return;
            }
            onBrowsePrograms();
          }}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={[styles.ctaLabel, { fontFamily }]}>{t(language, 'common.continue')}</Text>
        </Pressable>
      </View>
      <OnboardingBackButton language={language} onPress={onBack} />
    </View>
  );
}

const makeStyles = (theme: Theme) => {
  const C = paletteFor(theme);
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 24,
  },
  // A separator that says these are alternatives, not steps.
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 4,
  },
  orRule: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  orLabel: {
    color: C.soft,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  heading: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subheading: {
    color: C.soft,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  cardStack: {
    marginTop: 28,
    gap: 14,
    flex: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
    padding: 20,
  },
  cardSelected: {
    backgroundColor: C.purple,
    borderWidth: 2,
    borderColor: C.purpleDark,
    shadowColor: C.purple,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  cardIconTile: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: C.purpleSoft,
    borderWidth: 1.5,
    borderColor: C.chosen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconTileSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.7)',
  },
  cardCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardTitle: {
    color: C.ink,
    fontSize: 18.5,
    lineHeight: 23,
    fontWeight: '800',
  },
  cardTitleSelected: {
    color: '#FFFFFF',
  },
  cardBody: {
    color: C.soft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  cardBodySelected: {
    color: 'rgba(255,255,255,0.95)',
  },
  recommendedPill: {
    borderRadius: 999,
    backgroundColor: C.purpleSoft,
    borderWidth: 1.5,
    borderColor: C.chosen,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  recommendedPillSelected: {
    // White, not theme.surface. The chosen card is purple in both themes, so
    // the pill on top of it does not belong to the page's surface colour —
    // following it turned the badge into a black hole punched in the card as
    // soon as the dark theme was picked (user 2026-08-27).
    backgroundColor: '#FFFFFF',
    borderColor: C.purpleDark,
  },
  recommendedPillText: {
    color: C.purple,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  recommendedPillTextSelected: {
    // Fixed, like the white pill it sits on: C.purpleDark is a light violet in
    // dark, 2.7:1 on white (#bugs 2026-10-01 audit).
    color: '#5B21B6',
  },
  checkRing: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: C.chosen,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 999,
    // Same reason as recommendedPillSelected: this tick only ever sits on the
    // chosen purple card, so it is white there whatever the page behind is.
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: C.purpleDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingTop: 8,
  },
  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: C.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.purple,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  ctaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.17,
  },
  backLink: {
    alignSelf: 'center',
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  backText: {
    color: C.muted,
    fontSize: 14.5,
    fontWeight: '700',
  },
});
};
