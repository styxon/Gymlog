import React, { useMemo, useState } from 'react';
import { readyTemplateCardMinutes } from '../lib/programmeMinutes';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Pattern as SvgPattern,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { PrimaryCTAButton } from '../components/PrimaryCTAButton';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { I18nKey, t } from '../lib/i18n';
import { AppLanguage } from '../types/models';
import { CATALOG_FOCUS_OPTIONS, CatalogFocusKey, matchesCatalogFocus } from '../lib/programCatalogFocus';
import { programFamilyIdentity } from '../lib/programFamilyIdentity';
import { getReadyProgramCollectionCopy, READY_PROGRAM_COLLECTIONS } from '../lib/readyProgramCollections';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { darkTheme, Theme, useTheme, useThemedStyles } from '../theming';
import { HG_DARK } from '../darkTheme';
import { HG } from '../lightTheme';

/**
 * This screen's own tokens, in two — same arrangement as StartPathScreen.
 *
 * Light is the original set to the digit; dark exists because the theme is
 * picked before the reader ever gets here (2026-08-23), and the "browse ready
 * programmes" path would otherwise be the one branch of onboarding that
 * ignored the choice.
 */
interface CatalogPalette {
  surface: string;
  ink: string;
  muted: string;
  faint: string;
  border: string;
  purple: string;
  purpleDark: string;
  segmentTrack: string;
}

const CATALOG_LIGHT: CatalogPalette = {
  surface: '#FFFFFF',
  ink: '#101828',
  muted: '#667085',
  // The theme's faint ink; a fixed #9A93AC was 2.94:1 on white
  // (accessibility audit, 2026-09-21).
  faint: HG.faint,
  border: '#E4D8FF',
  purple: '#7C3AED',
  purpleDark: '#5B21B6',
  segmentTrack: '#EBE3FA',
};

const CATALOG_DARK: CatalogPalette = {
  surface: HG_DARK.surface,
  ink: HG_DARK.ink,
  muted: HG_DARK.muted,
  faint: HG_DARK.faint,
  border: HG_DARK.border,
  purple: HG_DARK.purple,
  purpleDark: HG_DARK.purpleBright,
  segmentTrack: HG_DARK.surfaceSoft,
};

const paletteFor = (theme: Theme): CatalogPalette =>
  theme === darkTheme ? CATALOG_DARK : CATALOG_LIGHT;

/** Cover height from the design. Tall enough for the name to sit on the scrim. */
const COVER_HEIGHT = 132;
/** The 24-unit motif drawn at 116px, per the design. */
const MOTIF_SCALE = 116 / 24;

// Template difficulty -> the same tier wording the questionnaire uses.
const LEVEL_TIERS: Array<{ key: WorkoutTemplateV1['level'] | 'all'; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'catalog.level.all' },
  { key: 'beginner', labelKey: 'catalog.level.beginner' },
  { key: 'intermediate', labelKey: 'catalog.level.intermediate' },
  { key: 'advanced', labelKey: 'catalog.level.advanced' },
];

const DAY_FILTERS: Array<{ key: number | 'all'; label: string | null }> = [
  { key: 'all', label: null },
  { key: 2, label: '2' },
  { key: 3, label: '3' },
  { key: 4, label: '4' },
  { key: 5, label: '5' },
  { key: 6, label: '6' },
];

function tierLabelFor(level: WorkoutTemplateV1['level'], language: AppLanguage) {
  const tier = LEVEL_TIERS.find((entry) => entry.key === level);
  return t(language, tier?.labelKey ?? 'catalog.level.all');
}

interface OnboardingReadyCatalogScreenProps {
  language?: AppLanguage;
  onPick: (programId: string) => void;
  onBack: () => void;
  busy?: boolean;
}

function BackChevron() {
  const C = paletteFor(useTheme());
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={C.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * The designed cover: family tone gradient, top-left highlight, hairline
 * stripes, oversized signature motif, and a scrim the name sits on.
 *
 * Everything paintable lives in ONE Svg with a measured pixel width. `<Svg
 * width="100%">` has broken gradients on Android in this codebase twice
 * already (the season hero, then the records screen), and a cover whose
 * gradient silently collapses to a flat block is exactly the failure the
 * reader would read as "unfinished".
 */
function ProgramCover({ title, width }: { title: string; width: number }) {
  const identity = programFamilyIdentity(title);
  // Gradient ids must be unique per card: two <Defs> sharing an id resolve to
  // whichever mounted first, so every cover would wear the first one's colour.
  const uid = `cover_${identity.family}`;

  return (
    <Svg width={width} height={COVER_HEIGHT} style={StyleSheet.absoluteFill}>
      <Defs>
        {/* CSS 145deg, expressed as the equivalent corner-to-corner vector. */}
        <SvgLinearGradient id={`${uid}_tone`} x1="0" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor={identity.cover[0]} />
          <Stop offset="1" stopColor={identity.cover[1]} />
        </SvgLinearGradient>
        <SvgRadialGradient id={`${uid}_glow`} cx="0.12" cy="0" r="0.78">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgRadialGradient>
        <SvgPattern id={`${uid}_lines`} patternUnits="userSpaceOnUse" width={23} height={23} patternTransform="rotate(28)">
          <Rect x={0} y={0} width={1} height={23} fill="#FFFFFF" fillOpacity={0.06} />
        </SvgPattern>
        <SvgLinearGradient id={`${uid}_scrim`} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#0C081A" stopOpacity={0.46} />
          <Stop offset="1" stopColor="#0C081A" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>

      <Rect x={0} y={0} width={width} height={COVER_HEIGHT} fill={`url(#${uid}_tone)`} />
      <Rect x={0} y={0} width={width} height={COVER_HEIGHT} fill={`url(#${uid}_glow)`} />
      <Rect x={0} y={0} width={width} height={COVER_HEIGHT} fill={`url(#${uid}_lines)`} />
      {/* Signature glyph, oversized and hanging off the bottom-right corner.
          Placed with an explicit transform rather than a nested <Svg x= y=>:
          on device the nested form ignored both offsets and painted the glyph
          at the origin, centred on the left half of the cover. The stroke is
          scaled back down so the line stays hairline at 4.8x. */}
      <G transform={`translate(${width - 102}, ${COVER_HEIGHT - 98}) scale(${MOTIF_SCALE})`}>
        <Path
          d={identity.motif}
          stroke="#FFFFFF"
          strokeOpacity={0.16}
          strokeWidth={1.4 / MOTIF_SCALE}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>
      <Rect x={0} y={COVER_HEIGHT - 72} width={width} height={72} fill={`url(#${uid}_scrim)`} />
    </Svg>
  );
}

function SelectionCircle({ selected }: { selected: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const C = paletteFor(useTheme());

  if (!selected) {
    return <View style={styles.selectRing} />;
  }
  return (
    <View style={styles.selectCircle}>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M5 12l5 5L19 7" stroke={C.purple} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

function MetaDot() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.metaDot} />;
}

export function OnboardingReadyCatalogScreen({
  language = 'en',
  onPick,
  onBack,
  busy = false,
}: OnboardingReadyCatalogScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [manropeLoaded] = useFonts({ Manrope: require('../../assets/fonts/Manrope.ttf') });
  const fontFamily = manropeLoaded ? 'Manrope' : undefined;

  const [dayFilter, setDayFilter] = useState<number | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<WorkoutTemplateV1['level'] | 'all'>('all');
  const [focusFilter, setFocusFilter] = useState<CatalogFocusKey>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The key does what the chevron does, and like the chevron it waits while
  // the pick is being saved: the save ends on Home either way.
  useHardwareBack(() => {
    if (!busy) {
      onBack();
    }
  });
  // One measurement for the whole list: every card is the same full width.
  const [cardWidth, setCardWidth] = useState(0);

  const filtersActive = dayFilter !== 'all' || levelFilter !== 'all' || focusFilter !== 'all';

  const onMeasure = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setCardWidth((current) => (Math.abs(current - next) < 1 ? current : next));
  };

  // Same section titles the Programs catalog already uses; a template renders
  // under its first matching collection only, so the list stays scannable.
  const sections = useMemo(() => {
    const seen = new Set<string>();

    return READY_PROGRAM_COLLECTIONS.map((collection) => {
      const programs = collection.templateIds
        .filter((templateId) => !seen.has(templateId))
        .map((templateId) => getWorkoutTemplateById(templateId))
        .filter((template): template is WorkoutTemplateV1 => Boolean(template))
        .filter((template) => (dayFilter === 'all' ? true : template.daysPerWeek === dayFilter))
        .filter((template) => (levelFilter === 'all' ? true : template.level === levelFilter))
        .filter((template) => matchesCatalogFocus(template, focusFilter))
        .map((template) => {
          seen.add(template.id);
          return { template, presentation: getReadyTemplatePresentation(template, language) };
        });

      return { collection, programs };
    }).filter((section) => section.programs.length > 0);
  }, [dayFilter, levelFilter, focusFilter, language]);

  const resultCount = sections.reduce((sum, section) => sum + section.programs.length, 0);
  const selectedProgram = selectedId
    ? sections.flatMap((section) => section.programs).find((entry) => entry.template.id === selectedId) ?? null
    : null;
  const ctaTitle = busy
    ? t(language, 'catalog.saving')
    : selectedProgram
      ? t(language, 'catalog.ctaWith', { program: selectedProgram.presentation.title.toUpperCase() })
      : t(language, 'catalog.cta');

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.back')}
          onPress={onBack}
          disabled={busy}
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
        >
          <BackChevron />
        </Pressable>

        <Text style={[styles.title, { fontFamily }]}>{t(language, 'catalog.title')}</Text>

        <Text style={[styles.overline, { fontFamily }]}>{t(language, 'catalog.daysPerWeek')}</Text>
        <View style={styles.chipRow}>
          {DAY_FILTERS.map((filter) => {
            const active = dayFilter === filter.key;
            const label = filter.label ?? t(language, 'catalog.days.any');
            return (
              <Pressable
                key={String(filter.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  filter.key === 'all'
                    ? t(language, 'catalog.a11y.anyDays')
                    : t(language, 'catalog.a11y.days', { count: label })
                }
                onPress={() => setDayFilter(filter.key)}
                style={[styles.chip, filter.key !== 'all' && styles.chipNumeric, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive, { fontFamily }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.overline, { fontFamily }]}>{t(language, 'catalog.level')}</Text>
        <View style={styles.segmentTrack}>
          {LEVEL_TIERS.map((tier) => {
            const active = levelFilter === tier.key;
            const label = t(language, tier.labelKey);
            return (
              <Pressable
                key={String(tier.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(language, 'catalog.a11y.level', { label })}
                onPress={() => setLevelFilter(tier.key)}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive, { fontFamily }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.overline, { fontFamily }]}>{t(language, 'catalog.focusArea')}</Text>
        <View style={styles.chipRow}>
          {CATALOG_FOCUS_OPTIONS.map((option) => {
            const active = focusFilter === option.key;
            const label = t(language, option.labelKey);
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
                onPress={() => setFocusFilter(option.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive, { fontFamily }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.resultRow}>
          <Text style={[styles.resultCount, { fontFamily }]}>
            {resultCount === 1
              ? t(language, 'catalog.countOne')
              : t(language, 'catalog.countMany', { count: resultCount })}
          </Text>
          {filtersActive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'catalog.clearFilters')}
              onPress={() => {
                setDayFilter('all');
                setLevelFilter('all');
                setFocusFilter('all');
              }}
              hitSlop={8}
            >
              <Text style={[styles.clearFilters, { fontFamily }]}>{t(language, 'catalog.clearFilters')}</Text>
            </Pressable>
          ) : null}
        </View>

        {sections.map(({ collection, programs }) => (
          <View key={collection.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, { fontFamily }]}>
                {getReadyProgramCollectionCopy(collection.key, language).label.toUpperCase()}
              </Text>
              <Text style={[styles.sectionCount, { fontFamily }]}>{programs.length}</Text>
            </View>
            <View style={styles.cardList} onLayout={onMeasure}>
              {programs.map(({ template, presentation }) => {
                const selected = selectedId === template.id;
                const identity = programFamilyIdentity(presentation.title);

                return (
                  <Pressable
                    key={template.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(language, 'catalog.a11y.card', {
                      program: presentation.title,
                      days: template.daysPerWeek,
                      minutes: readyTemplateCardMinutes(template),
                      level: tierLabelFor(template.level, language),
                    })}
                    onPress={() => setSelectedId((current) => (current === template.id ? null : template.id))}
                    style={[styles.card, selected && styles.cardSelected]}
                  >
                    <View style={styles.cover}>
                      {cardWidth > 0 ? <ProgramCover title={presentation.title} width={cardWidth} /> : null}

                      <View style={styles.daysPill}>
                        <Text style={[styles.daysPillText, { fontFamily }]}>
                          {t(language, 'catalog.daysPill', { days: template.daysPerWeek })}
                        </Text>
                      </View>
                      <View style={styles.selectSlot}>
                        <SelectionCircle selected={selected} />
                      </View>

                      <View style={styles.coverCopy}>
                        <Text numberOfLines={2} style={[styles.coverTitle, { fontFamily }]}>
                          {presentation.title}
                        </Text>
                        <Text numberOfLines={1} style={[styles.coverGoal, { fontFamily }]}>
                          {t(language, identity.goalKey)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={[styles.metaText, { fontFamily }]}>
                        {t(language, 'catalog.metaDays', { days: template.daysPerWeek })}
                      </Text>
                      <MetaDot />
                      <Text style={[styles.metaText, { fontFamily }]}>
                        {t(language, 'catalog.metaMinutes', { minutes: readyTemplateCardMinutes(template) })}
                      </Text>
                      <MetaDot />
                      <Text style={[styles.metaText, { fontFamily }]}>{tierLabelFor(template.level, language)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {sections.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { fontFamily }]}>{t(language, 'catalog.empty.title')}</Text>
            <Text style={[styles.emptyBody, { fontFamily }]}>{t(language, 'catalog.empty.body')}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryCTAButton
          title={ctaTitle}
          disabled={!selectedId || busy}
          onPress={() => {
            if (selectedId) {
              onPick(selectedId);
            }
          }}
        />
      </View>
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
  scrollContent: {
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  overline: {
    color: C.faint,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginTop: 16,
    marginBottom: 7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipNumeric: {
    minWidth: 40,
    paddingHorizontal: 8,
  },
  chipActive: {
    backgroundColor: C.purple,
    borderColor: C.purpleDark,
  },
  chipText: {
    color: C.ink,
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: C.segmentTrack,
    borderRadius: 12,
    padding: 3,
  },
  segment: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: C.surface,
    shadowColor: '#1E1246',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    color: C.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: C.purpleDark,
    fontWeight: '800',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    minHeight: 18,
  },
  resultCount: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '700',
  },
  clearFilters: {
    color: C.purple,
    fontSize: 12,
    fontWeight: '800',
  },
  section: {
    marginTop: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 11,
  },
  sectionLabel: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  sectionCount: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '700',
  },
  cardList: {
    gap: 12,
  },
  card: {
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    shadowColor: '#7850C8',
    shadowOpacity: 0.09,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: C.purple,
    shadowColor: C.purple,
    shadowOpacity: 0.24,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  cover: {
    height: COVER_HEIGHT,
    overflow: 'hidden',
  },
  daysPill: {
    position: 'absolute',
    top: 11,
    left: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  daysPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  selectSlot: {
    position: 'absolute',
    top: 10,
    right: 11,
  },
  selectRing: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  selectCircle: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0C081A',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  coverCopy: {
    position: 'absolute',
    left: 14,
    right: 46,
    bottom: 11,
  },
  coverTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  coverGoal: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 13,
  },
  metaText: {
    color: C.purpleDark,
    fontSize: 11.5,
    fontWeight: '800',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: C.faint,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 44,
    gap: 4,
  },
  emptyTitle: {
    color: C.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  emptyBody: {
    color: C.muted,
    fontSize: 12.5,
    fontWeight: '600',
  },
  footer: {
    paddingTop: 10,
  },
});
};
