import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFonts } from 'expo-font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { marqueeRowsHeight, ProgramMarquee } from '../components/ProgramMarquee';
import { VinhaWordmark } from '../components/VinhaWordmark';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import { getFitnessPhotoVariant } from '../assets/fitnessPhotos';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { buildWelcomeMarqueeRows } from '../lib/welcomeMarquee';
import { EASE_SETTLE, MARK_CENTER_WELCOME, MARK_SIZE, markSlotTop } from '../components/vinhaMotion';
import Svg, { Path } from 'react-native-svg';

import { SUPPORTED_LANGUAGES, t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';

/** Two rows when the gap fits them, one on a phone too short for that. */
const MARQUEE_MAX_ROWS = 2;

/** Measurements the band is centred against — the same numbers the styles use. */
const START_BUTTON_HEIGHT = 54;
const TAGLINE_GAP = 22;
const TAGLINE_HEIGHT = 16;
/** The flags below the tagline: their top margin plus the line they sit on. */
const LANG_ROW_HEIGHT = 14 + 26;
// Light design tokens (HG palette from the redesign handoff). SURFACE, INK and
// BORDER left with the language chips they dressed, and FAINT — a fixed
// #9A93AC, 2.94:1 on white — gave way to the theme's own `faint`
// (accessibility audit, 2026-09-21). The screen reads its colours from the
// theme.

interface WelcomeScreenProps {
  language: AppLanguage;
  onChangeLanguage?: (language: AppLanguage) => void;
  onContinue: () => void;
}

export function WelcomeScreen({ language, onChangeLanguage, onContinue }: WelcomeScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [manropeLoaded] = useFonts({ Manrope: require('../../assets/fonts/Manrope.ttf') });
  const fontFamily = manropeLoaded ? 'Manrope' : undefined;
  const actionOpacity = useRef(new Animated.Value(0)).current;
  // The spec rises the sign-in block 26 px over 620 ms — it is the third beat
  // of the hand-off, and it starts as this screen takes over from the splash.
  const actionTranslateY = useRef(new Animated.Value(26)).current;
  // Undefined until the preference is known, so the marquee does not start
  // moving and then stop for a reader who asked for less motion.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  /**
   * The band sits in the middle of what is left, not at a fixed offset.
   *
   * "Yhtä paljon ylhäällä ja alhaalla" (user 2026-08-27): measure the gap
   * between the bottom of the wordmark and the top of the start button, and
   * centre the tiles in it. The box is exactly as tall as its rows (the band is
   * level, so there is no tilt to allow for) so centring the box centres the
   * tiles, and a phone whose gap cannot hold two rows gets one rather than a
   * second row under the button (user 2026-10-12: titles hidden by the button).
   */
  const marqueeBand = useMemo(() => {
    const markBottom = markSlotTop(windowHeight, MARK_CENTER_WELCOME) + MARK_SIZE;
    // What the actions block occupies: button, the tagline and its gap, and the
    // padding that clears the system bar.
    const actionsHeight =
      START_BUTTON_HEIGHT + TAGLINE_GAP + TAGLINE_HEIGHT + LANG_ROW_HEIGHT + insets.bottom + 22;
    const gap = Math.max(0, windowHeight - actionsHeight - markBottom);
    const rows = gap >= marqueeRowsHeight(MARQUEE_MAX_ROWS) ? MARQUEE_MAX_ROWS : 1;
    const height = Math.min(marqueeRowsHeight(rows), gap);
    return { top: markBottom + (gap - height) / 2, height, rows };
  }, [insets.bottom, windowHeight]);

  /**
   * The catalog, as the catalog names it.
   *
   * getReadyTemplatePresentation rather than template.name: the curated title
   * is what every other surface shows, and the first screen of the app is the
   * last place to invent a second name for the same programme.
   */
  const marqueeRows = useMemo(
    () =>
      buildWelcomeMarqueeRows(
        WORKOUT_TEMPLATES_V1.map((template) => {
          const presentation = getReadyTemplatePresentation(template, language);
          return {
            id: template.id,
            title: presentation.title,
            // The tags the programme already carries, joined. Two of them: the
            // third is the day count, which belongs on a card you can open.
            meta: presentation.tags.slice(0, 2).join(' · '),
            // The app already ships four photos and a picker that reads the
            // programme's name — running, hiit, recovery, strength. Nothing new
            // to source to see whether photos belong here at all.
            photoKey: getFitnessPhotoVariant({ title: presentation.title }),
          };
        }),
        // One. Three filled the band and read as a wall; two still did, just a
        // shorter one (user 2026-08-27, "vähän liikaa"). A single strip of real
        // programmes says the same thing without competing with the button.
        marqueeBand.rows,
      ),
    [language, marqueeBand.rows],
  );

  useEffect(() => {
    let cancelled = false;
    queryReduceMotion().then((reduceMotion) => {
      if (cancelled) {
        return;
      }
      setReduceMotion(reduceMotion);
      if (reduceMotion) {
        actionOpacity.setValue(1);
        actionTranslateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(actionOpacity, {
          toValue: 1,
          duration: 620,
          easing: EASE_SETTLE,
          useNativeDriver: true,
        }),
        Animated.timing(actionTranslateY, {
          toValue: 0,
          duration: 620,
          easing: EASE_SETTLE,
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [actionOpacity, actionTranslateY]);

  return (
    <View style={styles.screen}>
      {/* What is actually in here, drifting past — the catalog rather than a
          decoration. An ambient drift layer held this space and was switched off
          by a bisect on 2026-08-19 that shipped; the middle has been empty
          since. Tiles say "28 programmes" before a word is read. */}
      {reduceMotion === null ? null : (
        <View
          style={[
            styles.marquee,
            { top: marqueeBand.top, height: marqueeBand.height },
          ]}
        >
          <ProgramMarquee
            rows={marqueeRows}
            reduceMotion={reduceMotion}
            fontFamily={fontFamily}
          />
        </View>
      )}
      {/* The splash's anchor and this one are both CENTRES. Measuring one from
          the top and the other from the centre is what made the mark jump
          between the two screens. */}
      <View style={[styles.markSlot, { top: markSlotTop(windowHeight, MARK_CENTER_WELCOME), height: MARK_SIZE }]}>
        {/* Same lockup the splash arrived with — the name in full, once. */}
        <VinhaWordmark size={MARK_SIZE} fitness fontFamily={fontFamily} />
      </View>

      <Animated.View
        style={[
          styles.actions,
          {
            paddingBottom: insets.bottom + 22,
            opacity: actionOpacity,
            transform: [{ translateY: actionTranslateY }],
          },
        ]}
      >
        {/* One button, and it does what it says.

            This screen used to offer "Continue with Google" and "Continue
            with Apple", both wired to this same handler. There is no OAuth,
            no account and nothing created — the buttons only moved you into
            onboarding, under two companies' trademarks, for a feature that
            does not exist. Unlike the paywall's demo copy this was behind no
            guard at all, and it is the first screen of the app.

            When sign-in ships, the providers come back as buttons that sign
            you in. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'welcome.start')}
          onPress={onContinue}
          style={({ pressed }) => [styles.startButton, pressed && styles.providerButtonPressed]}
        >
          <Text style={[styles.startLabel, { fontFamily }]}>{t(language, 'welcome.start')}</Text>
        </Pressable>

        {/* The "no account needed" reassurance is gone. It answered a worry
            nobody has yet on the first screen — there is no sign-in form in
            sight to be worried about — and the privacy promise it made is
            stated properly in Settings, where it can be read in full. */}
        <Text style={[styles.tagline, { fontFamily }]}>{t(language, 'brand.tagline')}</Text>

        {/* Down here, and flags only.

            The app already opens in the phone's language (lib/deviceLanguage),
            so this is not a question anybody has to answer — it is the way out
            when the guess is wrong, and that is the one failure you cannot
            recover from inside the app: everything, including the language
            setting, would be in a language you cannot read. Worth keeping,
            not worth the first line of the first screen (user 2026-08-27). */}
        {onChangeLanguage ? (
          <View style={styles.langRow}>
            {SUPPORTED_LANGUAGES.map((option) => (
              <React.Fragment key={option.key}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.key === language }}
                  accessibilityLabel={t(language, 'welcome.a11y.language', { name: option.name })}
                  hitSlop={10}
                  onPress={() => onChangeLanguage(option.key)}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.langFlag, option.key !== language && styles.langFlagIdle]}>
                    {option.flag}
                  </Text>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  langRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  langFlag: {
    fontSize: 19,
  },
  // The language you are NOT in, dimmed rather than hidden: a single flag
  // reads as decoration, two read as a choice.
  langFlagIdle: {
    opacity: 0.38,
  },
  // No padding on the screen itself: an absolutely positioned child is laid out
  // inside the parent's padding box, so a paddingTop here would push the mark
  // down by the status-bar inset — and the splash, which has no padding, hands
  // it over at the unpadded coordinate. That mismatch was the jump.
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  markSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Absolute like the mark, and for the same reason: the mark's position is
  // measured from the unpadded screen, so anything that hangs off it has to be
  // too or the two drift apart by the status-bar inset.
  //
  // The height and the clip are not decoration. A tilted band is taller than
  // its rows and wider than the screen, and without a box to live in its
  // corners run over the language chips at the top and the start button at the
  // bottom — the overflow escapees that the cut-corner work kept meeting.
  marquee: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 500,
    overflow: 'hidden',
  },
  actions: {
    marginTop: 'auto',
    paddingHorizontal: 24,
  },
  // The design's tagline is a quiet footer, not a headline: small, tracked
  // out, and the last thing you read rather than the second.
  tagline: {
    color: theme.faint,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 2.7,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 22,
  },
  startButton: {
    height: 54,
    borderRadius: 15,
    // Orange, as the onboarding Continue: orange is what can be pressed
    // (user 2026-10-17).
    backgroundColor: theme.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startLabel: {
    color: theme.onHighlight,
    fontSize: 15.5,
    fontWeight: '800',
    // Uppercased here rather than in the string, so the translation stays
    // readable and the accessibility label reads as a sentence.
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  providerButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
