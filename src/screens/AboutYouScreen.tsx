import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingBackButton } from '../components/OnboardingBackButton';
import { PrimaryCTAButton } from '../components/PrimaryCTAButton';
import { KitSheet } from '../components/sheetKit';
import { queryReduceMotion } from '../utils/reduceMotion';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { RulerPicker } from '../components/RulerPicker';
import { TypedRulerValue } from '../components/TypedRulerValue';
import { canContinueAboutYou, firstMissingAboutYou } from '../lib/aboutYouRules';
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

/** 'unspecified' is the gender sheet's Skip: an answer, stored as such. */
export type AboutYouGender = 'male' | 'female' | 'unspecified' | null;

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
   * The ruler has to be somewhere, so it cannot say "unanswered" the way an
   * empty row can. The readout above it does that instead: a dash until the
   * first drag or Done, the number after it.
   */
  const [rulerKg, setRulerKg] = useState(() => clamp(initialValues?.weightKg ?? 75, WEIGHT_LIMITS));

  /**
   * Weight is optional (user, 2026-10-12). Skipping is an answer of its own:
   * `weightKg` goes on as null, and touching the ruler or typing a number
   * again takes the skip back.
   */
  const [weightSkipped, setWeightSkipped] = useState(false);

  /**
   * One sheet at a time (vc5, 2026-10-16). The rows never write; only a sheet
   * commits, and a pick moves on to the next row still empty.
   */
  const [openSheet, setOpenSheet] = useState<AboutYouSheet | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void queryReduceMotion().then((value) => {
      if (alive) setReduceMotion(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const answered = canContinueAboutYou({ gender, ageRange });
  const missing = firstMissingAboutYou({ gender, ageRange });
  const hint = missing === 'gender'
    ? t(language, 'aboutYou.missing.gender')
    : missing === 'age'
      ? t(language, 'aboutYou.missing.age')
      : null;

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

  /** The next row after `from` still empty, in the rows' order; null closes. */
  function nextEmptyAfter(
    from: AboutYouSheet,
    state: { gender: AboutYouGender; ageRange: SetupAgeRange | null },
  ): AboutYouSheet | null {
    if (from === 'gender' && state.ageRange === null) return 'age';
    if (from !== 'weight' && weightKg === null && !weightSkipped) return 'weight';
    return null;
  }

  function pickGender(next: Exclude<AboutYouGender, null>) {
    setGender(next);
    setOpenSheet(nextEmptyAfter('gender', { gender: next, ageRange }));
  }

  function pickAge(next: SetupAgeRange) {
    setAgeRange(next);
    setOpenSheet(nextEmptyAfter('age', { gender, ageRange: next }));
  }

  /** Done takes the ruler's number as the answer when none was given yet. */
  function commitWeight() {
    if (weightKg === null || weightSkipped) {
      setWeight(rulerKg);
    }
    setOpenSheet(null);
  }

  function skipWeight() {
    setWeightSkipped(true);
    setOpenSheet(null);
  }

  const ageLabelKey = AGE_RANGES.find((range) => range.id === ageRange)?.labelKey;
  const weightChosen = weightKg !== null && !weightSkipped;
  const rows: {
    key: AboutYouSheet;
    label: string;
    value: string;
    chosen: boolean;
  }[] = [
    {
      key: 'gender',
      label: t(language, 'aboutYou.row.gender'),
      value: gender === 'male'
        ? t(language, 'aboutYou.gender.male')
        : gender === 'female'
          ? t(language, 'aboutYou.gender.female')
          : gender === 'unspecified'
            ? t(language, 'aboutYou.value.skipped')
            : t(language, 'aboutYou.value.choose'),
      // A skipped gender is answered, but it is not a value to colour.
      chosen: gender === 'male' || gender === 'female',
    },
    {
      key: 'age',
      label: t(language, 'aboutYou.row.age'),
      value: ageLabelKey ? t(language, ageLabelKey) : t(language, 'aboutYou.value.choose'),
      chosen: ageLabelKey !== undefined,
    },
    {
      key: 'weight',
      label: t(language, 'aboutYou.row.weight'),
      value: weightChosen
        ? `${weightKg} kg`
        : weightSkipped
          ? t(language, 'aboutYou.value.skipped')
          : t(language, 'aboutYou.value.optional'),
      chosen: weightChosen,
    },
  ];

  const sheetTitle = openSheet ? rows.find((row) => row.key === openSheet)?.label : undefined;

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
        <Text style={[styles.subtitle, { fontFamily }]}>{t(language, 'aboutYou.subtitle')}</Text>

        {/* Rows that open a sheet, not chips and a ruler on the page (vc5,
            2026-10-16): the age chips wrapped 3 + 2, and the weight readout
            said "— kg" while the ruler under it sat on 75. */}
        <View style={styles.rows}>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}, ${row.value}`}
              onPress={() => setOpenSheet(row.key)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={[styles.rowLabel, { fontFamily }]}>{row.label}</Text>
              <Text
                style={[styles.rowValue, row.chosen ? styles.rowValueChosen : styles.rowValueEmpty, { fontFamily }]}
                numberOfLines={1}
              >
                {row.value}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.footNote, { fontFamily }]}>{t(language, 'aboutYou.footNote')}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryCTAButton
          title={t(language, 'common.continue')}
          disabled={!answered}
          hint={hint}
          onPress={handleContinue}
        />
      </View>
      <OnboardingBackButton language={language} onPress={onBack} />

      <KitSheet
        visible={openSheet !== null}
        onClose={() => setOpenSheet(null)}
        title={sheetTitle}
        bottomInset={insets.bottom}
        closeLabel={t(language, 'common.close')}
        reduceMotion={reduceMotion}
      >
        {openSheet === 'gender' ? (
          <View style={styles.sheetList}>
            {(['male', 'female'] as const).map((option) => (
              <SheetOption
                key={option}
                label={t(language, option === 'male' ? 'aboutYou.gender.male' : 'aboutYou.gender.female')}
                selected={gender === option}
                fontFamily={fontFamily}
                onPress={() => pickGender(option)}
              />
            ))}
            <View style={styles.divider} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: gender === 'unspecified' }}
              accessibilityLabel={t(language, 'aboutYou.gender.skip')}
              onPress={() => pickGender('unspecified')}
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            >
              <Text style={[styles.skipText, { fontFamily }]}>{t(language, 'aboutYou.gender.skip')}</Text>
            </Pressable>
          </View>
        ) : null}

        {openSheet === 'age' ? (
          <View style={styles.sheetList}>
            {AGE_RANGES.map((range) => (
              <SheetOption
                key={range.id}
                label={t(language, range.labelKey)}
                selected={ageRange === range.id}
                fontFamily={fontFamily}
                onPress={() => pickAge(range.id)}
              />
            ))}
          </View>
        ) : null}

        {openSheet === 'weight' ? (
          <View style={styles.sheetList}>
            {/* Number and dial on one violet panel. On a pale ground the grey
                ticks were nearly invisible (user, 2026-09-09); white marks on
                brand violet separate by opacity. */}
            <View style={styles.weightPanel}>
              <View style={styles.weightValueRow}>
                <TypedRulerValue
                  language={language}
                  value={weightSkipped ? null : weightKg}
                  bounds={{ min: WEIGHT_LIMITS.min, max: WEIGHT_LIMITS.max, step: 0.1 }}
                  decimals={1}
                  onCommit={setWeight}
                  label={t(language, 'weightLog.title')}
                  textStyle={[styles.weightValue, !weightChosen && styles.weightValueEmpty, { fontFamily }]}
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
            </View>
            <PrimaryCTAButton title={t(language, 'aboutYou.weight.done')} onPress={commitWeight} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'aboutYou.weight.skipA11y')}
              accessibilityState={{ selected: weightSkipped }}
              hitSlop={8}
              onPress={skipWeight}
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            >
              <Text style={[styles.skipText, { fontFamily }]}>{t(language, 'aboutYou.weight.skip')}</Text>
            </Pressable>
          </View>
        ) : null}
      </KitSheet>
    </View>
  );
}

type AboutYouSheet = 'gender' | 'age' | 'weight';

/** A sheet row: one tap picks. Selected is violet — violet is selection. */
function SheetOption({
  label,
  selected,
  fontFamily,
  onPress,
}: {
  label: string;
  selected: boolean;
  fontFamily: string | undefined;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected, { fontFamily }]}>{label}</Text>
    </Pressable>
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
      color: C.muted,
      fontSize: 14.5,
      lineHeight: 20,
      fontWeight: '600',
      marginTop: 6,
    },
    rows: {
      marginTop: 26,
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 56,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.surface,
    },
    rowLabel: {
      flex: 1,
      color: C.ink,
      fontSize: 15.5,
      fontWeight: '700',
    },
    rowValue: {
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    rowValueChosen: {
      color: C.purple,
      fontWeight: '800',
    },
    rowValueEmpty: {
      color: C.muted,
    },
    chevron: {
      color: C.faint,
      fontSize: 22,
      fontWeight: '600',
      marginTop: -2,
    },
    pressed: {
      opacity: 0.85,
    },
    sheetList: {
      paddingHorizontal: 18,
      paddingBottom: 6,
      gap: 8,
    },
    option: {
      minHeight: 52,
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.surface,
    },
    optionSelected: {
      backgroundColor: C.purpleLight,
      borderColor: C.purple,
    },
    optionText: {
      color: C.ink,
      fontSize: 15.5,
      fontWeight: '700',
    },
    optionTextSelected: {
      color: C.purple,
      fontWeight: '800',
    },
    divider: {
      height: 1,
      backgroundColor: C.border,
      marginVertical: 4,
    },
    /** Skip is an answer, but a quieter one than the rows above it. */
    skipButton: {
      alignSelf: 'center',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    skipText: {
      color: C.muted,
      fontSize: 15,
      fontWeight: '700',
    },
    weightPanel: {
      backgroundColor: C.purple,
      borderRadius: 20,
      paddingTop: 14,
      paddingBottom: 8,
      marginBottom: 6,
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
  });
};
