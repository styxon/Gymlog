import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingBackButton } from '../components/OnboardingBackButton';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { RulerPicker } from '../components/RulerPicker';
import { TypedRulerValue } from '../components/TypedRulerValue';
import { canContinueAboutYou } from '../lib/aboutYouRules';
import { I18nKey, t } from '../lib/i18n';
import { darkTheme, Theme, useThemedStyles } from '../theming';
import { HG_DARK } from '../darkTheme';
import { HG } from '../lightTheme';
import { AppLanguage, SetupAgeRange } from '../types/models';

/**
 * This screen's own tokens, in two — the fourth onboarding screen to get
 * them, and the one that proved why the sweep had to be finished.
 *
 * It was missed on 2026-08-23: the theme had already been chosen by the time
 * the reader arrived, so the shell painted a near-black ground while every
 * card here stayed white and the title rendered near-black on it — invisible.
 * Reported from the phone the same morning ("liian valkoinen ja otsikkoa ei
 * näy"). Light values are the originals to the digit.
 */
interface AboutPalette {
  surface: string;
  ink: string;
  muted: string;
  faint: string;
  border: string;
  purple: string;
  purpleLight: string;
}

const ABOUT_LIGHT: AboutPalette = {
  surface: '#FFFFFF',
  ink: '#101828',
  muted: '#667085',
  // The theme's faint ink; a fixed #9A93AC was 2.94:1 on white
  // (accessibility audit, 2026-09-21).
  faint: HG.faint,
  border: '#E4D8FF',
  purple: '#7C3AED',
  purpleLight: '#EFE7FF',
};

const ABOUT_DARK: AboutPalette = {
  surface: HG_DARK.surface,
  ink: HG_DARK.ink,
  muted: HG_DARK.muted,
  faint: HG_DARK.faint,
  border: HG_DARK.border,
  purple: HG_DARK.purple,
  purpleLight: HG_DARK.purpleLight,
};

const paletteFor = (theme: Theme): AboutPalette => (theme === darkTheme ? ABOUT_DARK : ABOUT_LIGHT);

export type AboutYouGender = 'male' | 'female' | null;

/**
 * Three answers, and each one is read by something.
 *
 * The name and the exact height are gone (2026-09-09). Neither reached the
 * recommendation: `buildRecommendationInput` never passes a height, and the
 * name only ever filled a greeting. The height now belongs to the weight card,
 * which already draws a dash without one and already collects it through the
 * measuring sheet; the name arrives from Google for readers who sign in for
 * backup, and Profile has a field for everyone else.
 *
 * The age is a band rather than a year for the same reason, not a smaller one:
 * `scorePreferenceFit` reads one thing from it — whether the reader is 41 or
 * over, and only when the programme is joint-friendly. A birth year answers a
 * question nobody asks.
 */
export interface AboutYouValues {
  gender: AboutYouGender;
  ageRange: SetupAgeRange;
  /** Null when the reader skipped it: nothing downstream stores a default. */
  weightKg: number | null;
}

interface AboutYouScreenProps {
  language?: AppLanguage;
  initialValues?: Partial<AboutYouValues> | null;
  onContinue: (values: AboutYouValues) => void;
  onBack: () => void;
}

/**
 * Oldest first would read as a ladder to decline; youngest first is the form's order.
 *
 * The lowest band starts at 16, not at "under 19" (user, 2026-09-09). The old
 * label covered thirteen-year-olds, and sixteen is the age at which no EU
 * member state asks for a guardian's consent — so the band the reader picks is
 * also the sentence the app is making about who it is for. The id stays '18':
 * renaming it would orphan every answer already stored.
 */
const AGE_RANGES: { id: SetupAgeRange; labelKey: I18nKey }[] = [
  { id: '18', labelKey: 'myData.age.under19' },
  { id: '19_25', labelKey: 'myData.age.19to25' },
  { id: '26_30', labelKey: 'myData.age.26to30' },
  { id: '31_40', labelKey: 'myData.age.31to40' },
  { id: '41_plus', labelKey: 'myData.age.41plus' },
];

const WEIGHT_LIMITS = { min: 35, max: 220 };

/** The ruler moves in tenths, so the seed is held to a tenth rather than rounded. */
function clamp(value: number, limits: { min: number; max: number }) {
  return Math.min(Math.max(Math.round(value * 10) / 10, limits.min), limits.max);
}

export function AboutYouScreen({
  language = 'en',
  initialValues,
  onContinue,
  onBack,
}: AboutYouScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [manropeLoaded] = useFonts({ Manrope: require('../../assets/fonts/Manrope.ttf') });
  const fontFamily = manropeLoaded ? 'Manrope' : undefined;
  // The key does what the chevron does: back to the start path.
  useHardwareBack(onBack);

  /**
   * Nothing is answered until the reader answers it (user, 2026-09-09).
   *
   * Every field used to open on a value — 19-25 highlighted, 75 kg on the
   * stepper — and Continue was live from the first frame. A reader who tapped
   * straight through shipped three answers they never gave, and the programme
   * was built from them. A pre-selected chip is not a default, it is an answer
   * put in someone's mouth.
   */
  const [gender, setGender] = useState<AboutYouGender>(initialValues?.gender ?? null);
  const [ageRange, setAgeRange] = useState<SetupAgeRange | null>(initialValues?.ageRange ?? null);
  const [weightKg, setWeightKg] = useState<number | null>(
    typeof initialValues?.weightKg === 'number' ? clamp(initialValues.weightKg, WEIGHT_LIMITS) : null,
  );
  /**
   * Where the ruler sits before it has been touched.
   *
   * The ruler has to be somewhere, so it cannot express "unanswered" the way an
   * unselected chip can. The readout above it does that instead: a dash until
   * the first drag, and the number after it.
   */
  const [rulerKg, setRulerKg] = useState(() => clamp(initialValues?.weightKg ?? 75, WEIGHT_LIMITS));

  /**
   * Weight is optional (user, 2026-10-12). Skipping is an answer of its own:
   * the dash stays, `weightKg` goes on as null, and touching the ruler or
   * typing a number again takes the skip back.
   */
  const [weightSkipped, setWeightSkipped] = useState(false);

  const answered = canContinueAboutYou({ gender, ageRange });

  function handleContinue() {
    if (!answered || gender === null || ageRange === null) {
      return;
    }
    onContinue({ gender, ageRange, weightKg: weightSkipped ? null : weightKg });
  }

  function setWeight(next: number) {
    setRulerKg(next);
    setWeightKg(next);
    setWeightSkipped(false);
  }

  return (
    // Top padding = inset + the back chevron (10 + 40) + a gap, so the title
    // starts under the button instead of behind it.
    <View style={[styles.screen, { paddingTop: insets.top + 10 + 40 + 22, paddingBottom: insets.bottom + 14 }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { fontFamily }]}>{t(language, 'aboutYou.title')}</Text>
        {/* The sub-line ("add your details… change everything later"), the
            "?" avatar and the three zero counters are gone (user, 2026-08-19).
            A profile card that says 0 · 0 · 0 and "fresh profile" before the
            reader has typed a letter is a receipt for nothing; the step is a
            form, and the form is enough. */}

        <View style={styles.section}>
          <Text style={[styles.fieldLabel, { fontFamily }]}>{t(language, 'aboutYou.label.gender')}</Text>
          <View style={styles.genderRow}>
            {(['male', 'female'] as const).map((option) => {
              const selected = gender === option;
              const label = t(language, option === 'male' ? 'aboutYou.gender.male' : 'aboutYou.gender.female');
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  onPress={() => setGender(option)}
                  style={({ pressed }) => [
                    styles.genderTile,
                    selected && styles.genderTileSelected,
                    pressed && styles.genderTilePressed,
                  ]}
                >
                  <Text style={[styles.genderTileText, selected && styles.genderTileTextSelected, { fontFamily }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.fieldLabel, { fontFamily }]}>{t(language, 'aboutYou.label.age')}</Text>
          <View style={styles.ageRow}>
            {AGE_RANGES.map((range) => {
              const selected = ageRange === range.id;
              const label = t(language, range.labelKey);
              return (
                <Pressable
                  key={range.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  onPress={() => setAgeRange(range.id)}
                  style={({ pressed }) => [
                    styles.ageTile,
                    selected && styles.genderTileSelected,
                    pressed && styles.genderTilePressed,
                  ]}
                >
                  <Text style={[styles.genderTileText, selected && styles.genderTileTextSelected, { fontFamily }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.fieldLabel, { fontFamily }]}>{t(language, 'aboutYou.label.weight')}</Text>
          {/* The same dialled ruler the weight card and the measures use, not a
              stepper. Two instruments for one number taught the reader two
              habits, and the ruler is the one the rest of the app already
              teaches (user, 2026-09-09). */}
          {/* Number and dial on one violet panel. On the page's pale ground
              the grey ticks were nearly invisible (user, 2026-09-09), and a
              panel fixes that without turning the ticks into a second accent
              colour: white marks on brand violet separate by opacity. */}
          <View style={styles.weightPanel}>
            <View style={styles.weightValueRow}>
              <TypedRulerValue
                language={language}
                value={weightSkipped ? null : weightKg}
                bounds={{ min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max, step: 0.1 }}
                decimals={1}
                onCommit={setWeight}
                label={t(language, 'weightLog.title')}
                textStyle={[styles.weightValue, (weightKg === null || weightSkipped) && styles.weightValueEmpty, { fontFamily }]}
              />
              <Text style={[styles.weightUnit, { fontFamily }]}>kg</Text>
            </View>
            <RulerPicker
              min={WEIGHT_LIMITS.min}
              max={WEIGHT_LIMITS.max}
              step={0.1}
              majorEvery={10}
              value={rulerKg}
              tone="inverse"
              accessibilityLabel={t(language, 'weightLog.title')}
              unit="kg"
              onChange={setWeight}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'aboutYou.weight.skipA11y')}
              accessibilityState={{ selected: weightSkipped }}
              hitSlop={8}
              onPress={() => setWeightSkipped(true)}
              style={({ pressed }) => [styles.skipButton, pressed && styles.genderTilePressed]}
            >
              <Text style={[styles.skipText, weightSkipped && styles.skipTextActive, { fontFamily }]}>
                {t(language, 'aboutYou.weight.skip')}
              </Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.footNote, { fontFamily }]}>{t(language, 'aboutYou.footNote')}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.continue')}
          accessibilityState={{ disabled: !answered }}
          disabled={!answered}
          onPress={handleContinue}
          style={({ pressed }) => [styles.cta, !answered && styles.ctaDisabled, pressed && answered && styles.ctaPressed]}
        >
          <Text style={[styles.ctaLabel, !answered && styles.ctaLabelDisabled, { fontFamily }]}>
            {t(language, 'common.continue')}
          </Text>
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
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  title: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#475467',
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileStatsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  profileStat: {
    alignItems: 'center',
    gap: 1,
  },
  profileStatValue: {
    color: C.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  profileStatLabel: {
    color: C.faint,
    fontSize: 11.5,
    fontWeight: '700',
  },
  profileName: {
    color: C.ink,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 14,
  },
  profileHint: {
    color: C.faint,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1EAFD',
    marginVertical: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmpty: {
    borderWidth: 2,
    borderColor: '#C9B6FF',
    borderStyle: 'dashed',
    backgroundColor: theme.bg,
  },
  avatarFilled: {
    borderWidth: 2,
    borderColor: C.purple,
    backgroundColor: C.purpleLight,
  },
  avatarPlaceholder: {
    color: C.faint,
    fontSize: 22,
    fontWeight: '800',
  },
  avatarInitials: {
    color: C.purple,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  fieldLabel: {
    color: C.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  /**
   * A label and its controls, on the page's own ground.
   *
   * Each group used to sit in a bordered card, and the tiles inside it were
   * bordered too — a box drawn inside a box, three times down one screen
   * (user, 2026-09-09). The label already separates the groups; the card was
   * saying the same thing a second time, in ink.
   */
  section: {
    marginTop: 26,
    gap: 12,
  },
  weightPanel: {
    backgroundColor: C.purple,
    borderRadius: 20,
    paddingTop: 14,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  weightValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  weightValue: {
    color: '#FFFFFF',
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
    letterSpacing: -1,
  },
  weightUnit: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 16,
    fontWeight: '800',
    paddingBottom: 7,
  },
  /** The dash before the first drag, dimmer than an answered number. */
  weightValueEmpty: {
    color: 'rgba(255,255,255,0.55)',
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginTop: 2,
  },
  skipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14.5,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  skipTextActive: {
    color: '#FFFFFF',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  /**
   * Five bands, wrapped rather than squeezed. `flex: 1` across five tiles in
   * one row gives "41+" the same width as "19-25" and clips the longer label;
   * a wrap lets each tile be its own label's width and puts the overflow on a
   * second line, which is what a chip group is for.
   */
  ageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  ageTile: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C9B6FF',
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderTile: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C9B6FF',
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderTileSelected: {
    backgroundColor: C.purple,
    borderColor: C.purple,
  },
  genderTilePressed: {
    opacity: 0.85,
  },
  genderTileText: {
    color: C.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  genderTileTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  footNote: {
    color: C.faint,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 18,
  },
  footer: {
    paddingHorizontal: 24,
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
  /**
   * Flat and pale, and the glow goes with it. A button that keeps its shadow
   * while refusing the tap still looks like the way forward.
   */
  ctaDisabled: {
    backgroundColor: C.purpleLight,
    shadowOpacity: 0,
    elevation: 0,
  },
  /** White on the pale ground would be a label nobody can read. */
  ctaLabelDisabled: {
    color: C.faint,
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
