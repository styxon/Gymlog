import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ScreenHeaderTitle } from '../components/ScreenHeaderTitle';
import { CARD_SHADOW, ChevronIcon, SectionLabel, makeSettingsStyles } from '../components/SettingsUi';
import { getSetupEquipmentTitle, getSetupGoalTitle } from '../lib/firstRunSetup';
import { I18nKey, t } from '../lib/i18n';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { formatWeight, parseNumberInput } from '../lib/format';
import {
  AppLanguage,
  AppPreferences,
  SetupAgeRange,
  SetupCautionArea,
  SetupCautionFlag,
  SetupGender,
} from '../types/models';

interface MyDataScreenProps {
  preferences: AppPreferences;
  language?: AppLanguage;
  onBack: () => void;
  /**
   * Basics edit in place — writes straight to preferences. Resolves with
   * whether the write landed; the sheet closes only when it did.
   */
  onSaveBasics: (patch: Partial<AppPreferences>) => Promise<boolean>;
  /**
   * The newest weigh-in, in kg — the weight Home and Progress show. Null when
   * the log is empty.
   */
  latestWeighInKg: number | null;
  /** Weight is not a setting: the row opens the weigh-in log, where it is kept. */
  onOpenWeighIns: () => void;
  /** Opens the questionnaire directly at the avoid step. */
  onEditLimitations: () => void;
  /** Runs the full questionnaire again → two fresh programs to pick from. */
  onCreateNewPlan: () => void;
}

// Mirrors AVOID_AREA_OPTIONS + AVOID_EXTRA_AREA_OPTIONS in OnboardingScreen —
// keep in sync if the questionnaire renames a body part.
const CAUTION_AREA_KEYS: Record<SetupCautionArea, I18nKey> = {
  neck: 'onb.area.neck',
  shoulders: 'onb.area.shoulders',
  elbows: 'onb.area.elbows',
  wrists: 'onb.area.wrists',
  lower_back: 'onb.area.lower_back',
  hips: 'onb.area.hips',
  knees: 'onb.area.knees',
  ankles: 'onb.area.ankles',
};

/** Every band the picker offers, in the order it offers them. 'unspecified' is
 *  not one of them: it is what a reader who never answered has, not a choice. */
const AGE_RANGE_KEYS: Record<Exclude<SetupAgeRange, 'unspecified'>, I18nKey> = {
  '18': 'myData.age.under19',
  '19_25': 'myData.age.19to25',
  '26_30': 'myData.age.26to30',
  '31_40': 'myData.age.31to40',
  '41_plus': 'myData.age.41plus',
};

type BasicField = 'gender' | 'age' | 'height';

const BASIC_FIELD_META: Record<
  Exclude<BasicField, 'gender'>,
  { titleKey: I18nKey; unitKey: I18nKey; min: number; max: number }
> = {
  age: { titleKey: 'myData.ageField', unitKey: 'myData.unit.years', min: 13, max: 100 },
  height: { titleKey: 'myData.height', unitKey: 'myData.unit.cm', min: 120, max: 230 },
};

function genderLabel(preferences: AppPreferences, language: AppLanguage) {
  switch (preferences.setupGender) {
    case 'male':
      return t(language, 'myData.gender.male');
    case 'female':
      return t(language, 'myData.gender.female');
    default:
      return null;
  }
}

function ageLabel(preferences: AppPreferences, language: AppLanguage) {
  if (preferences.setupAge !== null) {
    return t(language, 'myData.years', { count: preferences.setupAge });
  }
  if (preferences.setupAgeRange && preferences.setupAgeRange !== 'unspecified') {
    const key = AGE_RANGE_KEYS[preferences.setupAgeRange];
    return key ? t(language, key) : null;
  }
  return null;
}

function levelLabel(preferences: AppPreferences, language: AppLanguage) {
  switch (preferences.setupLevel) {
    case 'beginner':
      return t(language, 'myData.level.beginner');
    case 'advanced':
      return t(language, 'myData.level.advanced');
    case 'pro':
      return t(language, 'myData.level.pro');
    default:
      return null;
  }
}

function limitationLabel(flag: SetupCautionFlag, language: AppLanguage) {
  const area = t(language, CAUTION_AREA_KEYS[flag.area]);
  return `${area} — ${t(language, flag.level === 'avoid' ? 'myData.leftOut' : 'myData.beCareful')}`;
}

function ShieldIcon({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function DataRow({
  label,
  value,
  editLabel,
  isLast = false,
  onPress,
}: {
  label: string;
  value: string;
  editLabel?: string;
  isLast?: boolean;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const inner = (
    <View style={[styles.dataRow, !isLast && styles.dataRowDivider]}>
      <View style={styles.dataCopy}>
        <Text style={styles.dataLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.dataValue}>{value}</Text>
      </View>
      {onPress ? <ChevronIcon /> : null}
    </View>
  );

  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={editLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.65 }}
    >
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

/**
 * Screen 4 of the profile suite. Basics edit in place through a small sheet;
 * limitations jump straight into the questionnaire's avoid step; training
 * preferences are read-only context for the "create a new plan" action, which
 * re-runs the questionnaire and ends at the two-program picker.
 */
export function MyDataScreen({
  preferences,
  language = 'en',
  onBack,
  onSaveBasics,
  latestWeighInKg,
  onOpenWeighIns,
  onEditLimitations,
  onCreateNewPlan,
}: MyDataScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const settingsStyles = useThemedStyles(makeSettingsStyles);
  const [editing, setEditing] = useState<BasicField | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftGender, setDraftGender] = useState<SetupGender>('unspecified');
  const [draftAgeRange, setDraftAgeRange] = useState<SetupAgeRange>('19_25');

  // `edits`: the row opens an editor here. Weight opens the log instead, and
  // is not announced as "Edit weight".
  const basics: Array<{ key: string; label: string; value: string | null; edits: boolean; onPress: () => void }> = [
    {
      key: 'gender',
      label: t(language, 'myData.gender'),
      value: genderLabel(preferences, language),
      edits: true,
      onPress: () => openEditor('gender'),
    },
    {
      key: 'age',
      label: t(language, 'myData.ageField'),
      value: ageLabel(preferences, language),
      edits: true,
      onPress: () => openEditor('age'),
    },
    {
      key: 'height',
      label: t(language, 'myData.height'),
      value: preferences.setupHeightCm !== null ? `${preferences.setupHeightCm} cm` : null,
      edits: true,
      onPress: () => openEditor('height'),
    },
    // The weigh-in log, not the questionnaire's answer. This row used to show
    // and edit `setupCurrentWeightKg`, a number Home and Progress never read:
    // changing 75 to 82 here left both saying 75 (audit 7, 2026-09-26).
    {
      key: 'weight',
      label: t(language, 'myData.weight'),
      value: latestWeighInKg !== null ? formatWeight(latestWeighInKg) : null,
      edits: false,
      onPress: onOpenWeighIns,
    },
  ];

  const training: Array<{ label: string; value: string | null }> = [
    {
      label: t(language, 'myData.goal'),
      value: preferences.setupGoal ? getSetupGoalTitle(preferences.setupGoal, language) : null,
    },
    { label: t(language, 'myData.experience'), value: levelLabel(preferences, language) },
    {
      label: t(language, 'myData.sessionsPerWeek'),
      value:
        preferences.setupDaysPerWeek !== null
          ? t(language, 'myData.perWeek', { count: preferences.setupDaysPerWeek })
          : null,
    },
    {
      label: t(language, 'myData.weeklyTime'),
      value: preferences.setupWeeklyMinutes !== null ? `~${preferences.setupWeeklyMinutes} min` : null,
    },
    {
      label: t(language, 'myData.equipment'),
      value: preferences.setupEquipment ? getSetupEquipmentTitle(preferences.setupEquipment, language) : null,
    },
  ];

  const limitations = preferences.setupCautionFlags.filter((flag) => flag.level !== 'info');

  const openEditor = (field: BasicField) => {
    if (field === 'gender') {
      setDraftGender(preferences.setupGender ?? 'unspecified');
    } else if (field === 'age') {
      setDraftAgeRange(
        preferences.setupAgeRange && preferences.setupAgeRange !== 'unspecified'
          ? preferences.setupAgeRange
          : '19_25',
      );
    } else {
      setDraftValue(preferences.setupHeightCm !== null ? `${preferences.setupHeightCm}` : '');
    }
    setEditing(field);
  };

  const numericDraftValid = (() => {
    if (editing === null || editing === 'gender' || editing === 'age') {
      return true;
    }
    const meta = BASIC_FIELD_META[editing];
    const parsed = parseNumberInput(draftValue);
    return parsed !== null && parsed >= meta.min && parsed <= meta.max;
  })();

  const savingRef = useRef(false);
  const saveEditor = async () => {
    if (editing === null || savingRef.current) {
      return;
    }
    let patch: Partial<AppPreferences>;
    if (editing === 'gender') {
      patch = { setupGender: draftGender };
    } else if (editing === 'age') {
      // The band replaces the year rather than sitting beside it: `ageLabel`
      // prefers a stored year, so leaving one behind would show the old number
      // over the band the reader just chose.
      patch = { setupAgeRange: draftAgeRange, setupAge: null };
    } else {
      const parsed = parseNumberInput(draftValue);
      if (!numericDraftValid || parsed === null) {
        return;
      }
      patch = { setupHeightCm: Math.round(parsed) };
    }
    // The sheet closes once the write has landed; a refused one leaves it open
    // with the draft, and the parent has said why.
    savingRef.current = true;
    try {
      if (await onSaveBasics(patch)) {
        setEditing(null);
      }
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.back')}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.75 }]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M15 5l-7 7 7 7" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <ScreenHeaderTitle title={t(language, 'myData.title')} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'myData.basics')} />
          <View style={styles.card}>
            {basics.map((row, index) => (
              <DataRow
                key={row.key}
                label={row.label}
                value={row.value ?? t(language, 'myData.notSet')}
                editLabel={row.edits ? t(language, 'myData.edit', { field: row.label }) : undefined}
                isLast={index === basics.length - 1}
                onPress={row.onPress}
              />
            ))}
          </View>
        </View>

        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'myData.trainingPrefs')} />
          <View style={styles.card}>
            {training.map((row, index) => (
              <DataRow
                key={row.label}
                label={row.label}
                value={row.value ?? t(language, 'myData.notSet')}
                isLast={index === training.length - 1}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onCreateNewPlan}
            style={({ pressed }) => [styles.newPlanButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.newPlanButtonText}>{t(language, 'myData.createPlan')}</Text>
          </Pressable>
          <Text style={styles.newPlanCaption}>
            {t(language, 'myData.createPlanCaption')}
          </Text>
        </View>

        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'myData.additional')} />
          <View style={styles.card}>
            {limitations.length > 0 ? (
              limitations.map((flag, index) => (
                <Pressable
                  key={flag.area}
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'myData.editLimitation', {
                    area: t(language, CAUTION_AREA_KEYS[flag.area]),
                  })}
                  onPress={onEditLimitations}
                  style={({ pressed }) => [
                    styles.limitRow,
                    index !== limitations.length - 1 && styles.dataRowDivider,
                    pressed && { opacity: 0.65 },
                  ]}
                >
                  <View style={[styles.limitTile, flag.level === 'avoid' ? styles.limitTileAvoid : styles.limitTileCareful]}>
                    <ShieldIcon color={flag.level === 'avoid' ? '#C0392B' : '#B45309'} />
                  </View>
                  <Text style={[styles.limitText, flag.level === 'avoid' && styles.limitTextAvoid]}>
                    {limitationLabel(flag, language)}
                  </Text>
                  <ChevronIcon />
                </Pressable>
              ))
            ) : (
              <DataRow
                label={t(language, 'myData.limitations')}
                value={t(language, 'myData.nothingNoted')}
                editLabel={t(language, 'myData.edit', { field: t(language, 'myData.limitations') })}
                isLast
                onPress={onEditLimitations}
              />
            )}
          </View>
        </View>

        <Text style={styles.footerText}>
          {t(language, 'myData.footer')}
        </Text>
      </ScrollView>

      {/* basics edit sheet */}
      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.sheetScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditing(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editing === 'gender'
                ? t(language, 'myData.gender')
                : editing === 'age'
                  ? t(language, 'myData.ageField')
                : editing !== null
                  ? t(language, BASIC_FIELD_META[editing].titleKey)
                  : ''}
            </Text>

            {editing === 'age' ? (
              <View style={styles.genderRow}>
                {(Object.keys(AGE_RANGE_KEYS) as Exclude<SetupAgeRange, 'unspecified'>[]).map((option) => {
                  const active = draftAgeRange === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setDraftAgeRange(option)}
                      style={[styles.genderChip, active && styles.genderChipActive]}
                    >
                      <Text style={[styles.genderChipText, active && styles.genderChipTextActive]}>
                        {t(language, AGE_RANGE_KEYS[option])}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : editing === 'gender' ? (
              <View style={styles.genderRow}>
                {(
                  [
                    { key: 'male', label: t(language, 'myData.gender.male') },
                    { key: 'female', label: t(language, 'myData.gender.female') },
                    { key: 'unspecified', label: t(language, 'myData.gender.unspecified') },
                  ] as Array<{ key: SetupGender; label: string }>
                ).map((option) => {
                  const active = draftGender === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setDraftGender(option.key)}
                      style={[styles.genderChip, active && styles.genderChipActive]}
                    >
                      <Text style={[styles.genderChipText, active && styles.genderChipTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : editing !== null ? (
              <View style={styles.numericRow}>
                <TextInput
                  value={draftValue}
                  onChangeText={setDraftValue}
                  keyboardType="numeric"
                  autoFocus
                  placeholder="0"
                  placeholderTextColor={theme.faint}
                  style={styles.numericInput}
                />
                <Text style={styles.numericUnit}>{t(language, BASIC_FIELD_META[editing].unitKey)}</Text>
              </View>
            ) : null}

            {editing !== null && editing !== 'gender' && editing !== 'age' && draftValue.length > 0 && !numericDraftValid ? (
              <Text style={styles.sheetError}>
                {BASIC_FIELD_META[editing].min}–{BASIC_FIELD_META[editing].max}{' '}
                {t(language, BASIC_FIELD_META[editing].unitKey)}
              </Text>
            ) : null}

            <View style={styles.sheetActions}>
              <Pressable accessibilityRole="button" onPress={() => setEditing(null)} style={styles.sheetCancel}>
                <Text style={styles.sheetCancelText}>{t(language, 'common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !numericDraftValid }}
                onPress={saveEditor}
                style={({ pressed }) => [
                  styles.sheetSave,
                  !numericDraftValid && styles.sheetSaveDisabled,
                  pressed && numericDraftValid && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.sheetSaveText}>{t(language, 'common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingTop: 4,
    paddingHorizontal: 18,
    paddingBottom: layout.bottomTabBarReserve,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    ...CARD_SHADOW,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  dataRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  dataCopy: {
    flex: 1,
    minWidth: 0,
  },
  dataLabel: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  dataValue: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 3,
  },
  // The white-label violet here and on the sheet's Save (accessibility
  // audit, 2026-09-21).
  newPlanButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.purpleFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  newPlanButtonText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
  newPlanCaption: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  limitTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitTileCareful: {
    backgroundColor: '#FBF0DD',
  },
  limitTileAvoid: {
    backgroundColor: '#FBEAE7',
  },
  limitText: {
    flex: 1,
    color: '#B45309',
    fontSize: 15,
    fontWeight: '800',
  },
  // theme.danger rather than a fixed #C0392B, which was 3.23:1 on the dark
  // card (accessibility audit, 2026-09-21).
  limitTextAvoid: {
    color: theme.danger,
  },
  footerText: {
    color: theme.faint,
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 22,
    paddingHorizontal: 10,
  },
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(16,10,32,0.42)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  sheet: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 20,
  },
  sheetTitle: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  genderRow: {
    gap: 8,
    marginTop: 14,
  },
  genderChip: {
    height: 46,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipActive: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  genderChipText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  genderChipTextActive: {
    color: theme.purpleDark,
  },
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  numericInput: {
    flex: 1,
    height: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.border,
    // A theme field, not a fixed lavender: theme.ink on #F4F0FC was white
    // on near-white in dark (#bugs 2026-10-01 audit).
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 15,
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  numericUnit: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  sheetError: {
    color: theme.danger,
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 8,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  sheetCancel: {
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  sheetCancelText: {
    color: theme.muted,
    fontSize: 14.5,
    fontWeight: '800',
  },
  sheetSave: {
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: theme.purpleFill,
  },
  sheetSaveDisabled: {
    backgroundColor: '#D8D2E6',
  },
  sheetSaveText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
});
