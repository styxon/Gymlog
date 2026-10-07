import React, { useMemo, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Barbell } from 'phosphor-react-native/lib/commonjs/icons/Barbell';
import { CalendarBlank } from 'phosphor-react-native/lib/commonjs/icons/CalendarBlank';
import { Clock } from 'phosphor-react-native/lib/commonjs/icons/Clock';
import { Fire } from 'phosphor-react-native/lib/commonjs/icons/Fire';
import { Heartbeat } from 'phosphor-react-native/lib/commonjs/icons/Heartbeat';
import { Lightning } from 'phosphor-react-native/lib/commonjs/icons/Lightning';
import { MagnifyingGlass } from 'phosphor-react-native/lib/commonjs/icons/MagnifyingGlass';
import { SlidersHorizontal } from 'phosphor-react-native/lib/commonjs/icons/SlidersHorizontal';
import { Target } from 'phosphor-react-native/lib/commonjs/icons/Target';
import { ScreenHeader } from '../components/ScreenHeader';
import { CORE_WORKOUT_TEMPLATE_ID } from '../features/workout/workoutCatalog';
import { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { WorkoutExerciseInstance, WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { pluralize, removeTrailingZeros } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { getReadyProgramContent } from '../lib/readyProgramContent';
import { getCustomTemplatePresentation } from '../lib/templatePresentation';
import { getRecommendationProgramDefinition } from '../lib/recommendationCatalog';
import {
  buildReadyDiscoveryItem,
  filterAndSortReadyDiscoveryItems,
  ReadyDiscoveryItem,
  ReadyEquipmentFilter,
  ReadyLevelFilter,
  ReadyTimeFilter,
} from '../lib/workoutDiscovery';
import { ProgramInsightSummary } from '../lib/programInsights';
import { TailoringPreferencesInput } from '../lib/tailoringFit';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { AppLanguage } from '../types/models';
import { layout, spacing } from '../theme';

interface CustomWorkoutListItem {
  id: string;
  name: string;
  sessionCount: number;
  exerciseCount: number;
  updatedAt: string;
}

interface WorkoutsScreenProps {
  customWorkouts: CustomWorkoutListItem[];
  programInsightsByTemplateId: Record<string, ProgramInsightSummary>;
  onOpenWorkout: (workoutTemplateId: string) => void;
  onOpenReadyProgram: (workoutTemplateId: string) => void;
  onStartReadyProgram: (workoutTemplateId: string) => void;
  onOpenCustomProgram: (workoutTemplateId: string) => void;
  onStartCustomWorkout: (workoutTemplateId: string) => void;
  onCreateWorkout: () => void;
  recommendedReadyProgramId?: string | null;
  tailoringPreferences?: TailoringPreferencesInput | null;
  /**
   * The reader's gear and drill swaps, which the Programs cards cost sessions
   * with. The same options here, or this screen quotes a second number for
   * the same programme.
   */
  programAvailableEquipment?: string[] | null;
  programDrillOverrides?: Record<string, string> | null;
  language?: AppLanguage;
}

type ReadyGoalFilter = 'all' | 'fat_loss' | 'strength' | 'hypertrophy' | 'general';
type TodayFlowItem = {
  label: 'Next' | 'Then' | 'Finish';
  title: string;
  meta: string;
};

const READY_GOAL_FILTERS: Array<{ key: ReadyGoalFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'facet.all' },
  { key: 'fat_loss', labelKey: 'ready.goal.fatLoss' },
  { key: 'strength', labelKey: 'ready.goal.strength' },
  { key: 'hypertrophy', labelKey: 'ready.goal.hypertrophy' },
  { key: 'general', labelKey: 'ready.goal.general' },
];

// Family-sectioned browse: every ready template lands in exactly one section
// (first match wins), mirroring the goal-named program families.
const READY_FAMILY_SECTIONS: Array<{ key: string; titleKey: I18nKey; match: (item: ReadyDiscoveryItem) => boolean }> = [
  {
    key: 'women',
    titleKey: 'ready.section.women',
    match: (item) => getRecommendationProgramDefinition(item.template.id)?.targetGender === 'female',
  },
  {
    key: 'focus',
    titleKey: 'ready.section.focus',
    match: (item) => item.template.id.startsWith('tpl_focus_'),
  },
  {
    key: 'recovery',
    titleKey: 'ready.section.recovery',
    match: (item) => getRecommendationProgramDefinition(item.template.id)?.familyId === 'joint_friendly',
  },
  {
    key: 'running',
    titleKey: 'ready.section.running',
    match: (item) => Boolean(getRecommendationProgramDefinition(item.template.id)?.supportedGoals.includes('run_mobility')),
  },
  {
    key: 'fatloss',
    titleKey: 'ready.goal.fatLoss',
    match: (item) => {
      const definition = getRecommendationProgramDefinition(item.template.id);
      return definition?.familyId === 'athletic_recomp' && definition.styleTags.includes('conditioning');
    },
  },
  {
    key: 'strength',
    titleKey: 'ready.goal.strength',
    match: (item) => {
      const definition = getRecommendationProgramDefinition(item.template.id);
      return definition?.familyId === 'strength_base' || definition?.familyId === 'powerbuilding' || item.template.goalType === 'strength';
    },
  },
  {
    key: 'muscle',
    titleKey: 'ready.section.muscle',
    match: (item) =>
      getRecommendationProgramDefinition(item.template.id)?.familyId === 'mass_hypertrophy'
      || item.template.goalType === 'hypertrophy',
  },
  {
    key: 'home',
    titleKey: 'ready.section.home',
    match: (item) => {
      const definition = getRecommendationProgramDefinition(item.template.id);
      return definition?.equipmentTier === 'low_equipment' || definition?.familyId === 'low_equipment';
    },
  },
  { key: 'balanced', titleKey: 'ready.section.balanced', match: () => true },
];

const READY_FILTER_SECTION_KEYS: Record<Exclude<ReadyGoalFilter, 'all'>, string[]> = {
  fat_loss: ['fatloss'],
  strength: ['strength'],
  hypertrophy: ['muscle', 'focus', 'women'],
  general: ['balanced', 'home', 'running', 'recovery'],
};

const READY_TEMPLATE_CARD_IMAGE = require('../../assets/fitness/selected/ready-template-card.jpg');

const READY_TIME_FILTERS: Array<{ key: ReadyTimeFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'ready.time.any' },
  { key: 'short', labelKey: 'ready.time.short' },
  { key: 'balanced', labelKey: 'ready.time.balanced' },
  { key: 'long', labelKey: 'ready.time.long' },
];

const READY_EQUIPMENT_FILTERS: Array<{ key: ReadyEquipmentFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'ready.equip.any' },
  { key: 'full_gym', labelKey: 'setup.equip.gym' },
  { key: 'low_equipment', labelKey: 'ready.equip.low' },
];

const READY_LEVEL_FILTERS: Array<{ key: ReadyLevelFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'ready.level.any' },
  { key: 'beginner', labelKey: 'myData.level.beginner' },
  { key: 'intermediate', labelKey: 'ready.level.intermediate' },
];

function ReadyGoalIcon({ filter, active }: { filter: ReadyGoalFilter; active: boolean }) {
  const color = active ? '#FFFFFF' : '#667085';
  const size = 18;

  if (filter === 'fat_loss') {
    return <Fire size={size} color={color} weight="bold" />;
  }

  if (filter === 'strength') {
    return <Barbell size={size} color={color} weight="bold" />;
  }

  if (filter === 'hypertrophy') {
    return <Target size={size} color={color} weight="bold" />;
  }

  if (filter === 'general') {
    return <Heartbeat size={size} color={color} weight="bold" />;
  }

  return null;
}

function formatGoal(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function formatLevel(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function formatTemplateHeroLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatReps(min: number, max: number) {
  return min === max ? `${max}` : `${min}-${max}`;
}

function formatFlowExerciseMeta(exercise: WorkoutTemplateExercise | WorkoutExerciseInstance) {
  if (Array.isArray(exercise.sets)) {
    const firstSet = exercise.sets[0];
    if (!firstSet) {
      return '';
    }
    if (typeof firstSet.plannedLoadKg === 'number') {
      return `${removeTrailingZeros(firstSet.plannedLoadKg)} kg x ${formatReps(firstSet.plannedRepsMin, firstSet.plannedRepsMax)}`;
    }
    return `${exercise.sets.length} ${exercise.sets.length === 1 ? 'set' : 'sets'}`;
  }

  const templateExercise = exercise as WorkoutTemplateExercise;

  if (templateExercise.trackingMode === 'load_and_reps') {
    return `${templateExercise.sets} ${templateExercise.sets === 1 ? 'set' : 'sets'} - ${formatReps(templateExercise.repsMin, templateExercise.repsMax)} reps`;
  }

  return `${templateExercise.sets} ${templateExercise.sets === 1 ? 'set' : 'sets'}`;
}

function buildTodayFlowItems(exercises: Array<WorkoutTemplateExercise | WorkoutExerciseInstance>): TodayFlowItem[] {
  if (!exercises.length) {
    return [];
  }

  const picks =
    exercises.length <= 3
      ? exercises
      : [exercises[0], exercises[1], exercises[exercises.length - 1]].filter(Boolean);

  return picks.map((exercise, index) => {
    const isLast = index === picks.length - 1;
    return {
      label: index === 0 ? 'Next' : isLast ? 'Finish' : 'Then',
      title: exercise.exerciseName,
      meta: formatFlowExerciseMeta(exercise),
    };
  });
}

function buildCustomTodayFlowItems(workout: CustomWorkoutListItem): TodayFlowItem[] {
  return [
    {
      label: 'Next',
      title: formatWorkoutDisplayLabel(workout.name, 'Workout'),
      meta: pluralize(workout.exerciseCount, 'exercise'),
    },
    {
      label: 'Then',
      title: 'Log the first lift',
      meta: workout.sessionCount <= 1 ? 'Single-session split' : `${workout.sessionCount} sessions ready`,
    },
    {
      label: 'Finish',
      title: 'Save the session',
      meta: 'Keep the week moving',
    },
  ];
}

export function WorkoutsScreen({
  customWorkouts,
  programInsightsByTemplateId,
  onOpenWorkout,
  onOpenReadyProgram,
  onStartReadyProgram,
  onOpenCustomProgram,
  onStartCustomWorkout,
  onCreateWorkout,
  recommendedReadyProgramId,
  tailoringPreferences = null,
  programAvailableEquipment = null,
  programDrillOverrides = null,
  language = 'en',
}: WorkoutsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { activeSession, history, templates } = useWorkoutContext();
  const activeTemplateId = activeSession?.templateId ?? history.lastSelectedTemplateId ?? CORE_WORKOUT_TEMPLATE_ID;
  const [menuTemplateId, setMenuTemplateId] = useState<string | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [readyGoalFilter, setReadyGoalFilter] = useState<ReadyGoalFilter>('all');
  const [readyTimeFilter, setReadyTimeFilter] = useState<ReadyTimeFilter>('all');
  const [readyEquipmentFilter, setReadyEquipmentFilter] = useState<ReadyEquipmentFilter>('all');
  const [readyLevelFilter, setReadyLevelFilter] = useState<ReadyLevelFilter>('all');
  const [showAdvancedReadyFilters, setShowAdvancedReadyFilters] = useState(false);
  const [compareTemplateIds, setCompareTemplateIds] = useState<string[]>([]);
  const [showReadyLibrary, setShowReadyLibrary] = useState(true);
  const [showAllCustomWorkouts, setShowAllCustomWorkouts] = useState(false);
  const [showBrowseWorkouts, setShowBrowseWorkouts] = useState(true);

  const menuTemplate = customWorkouts.find((template) => template.id === menuTemplateId) ?? null;
  const confirmDeleteTemplate = customWorkouts.find((template) => template.id === confirmDeleteTemplateId) ?? null;
  const recommendedReadyTemplate = recommendedReadyProgramId
    ? templates.find((template) => template.id === recommendedReadyProgramId) ?? null
    : null;
  const recommendedKickoffSession = recommendedReadyTemplate?.sessions[0] ?? null;
  const primaryCustomWorkout =
    customWorkouts.find((template) => template.id === activeTemplateId) ??
    customWorkouts[0] ??
    null;
  const todayFlowItems = useMemo(() => {
    if (activeSession?.exercises?.length) {
      const activeIndex = activeSession.ui.activeSlotId
        ? activeSession.exercises.findIndex((exercise) => exercise.slotId === activeSession.ui.activeSlotId)
        : 0;
      const remainingExercises =
        activeIndex >= 0 ? activeSession.exercises.slice(activeIndex) : activeSession.exercises.slice(0, 3);
      return buildTodayFlowItems(remainingExercises);
    }

    if (recommendedKickoffSession?.exercises?.length) {
      return buildTodayFlowItems(recommendedKickoffSession.exercises);
    }

    if (primaryCustomWorkout) {
      return buildCustomTodayFlowItems(primaryCustomWorkout);
    }

    return [];
  }, [activeSession, primaryCustomWorkout, recommendedKickoffSession]);
  const readyDiscoveryItems = useMemo(() => {
    return templates.map((template) =>
      buildReadyDiscoveryItem(template, getReadyProgramContent(template.id), {
        availableEquipment: programAvailableEquipment,
        overrides: programDrillOverrides,
      }),
    );
  }, [programAvailableEquipment, programDrillOverrides, templates]);
  const filteredReadyItems = useMemo(
    () => {
      return filterAndSortReadyDiscoveryItems(
        readyDiscoveryItems,
        {
          query: searchQuery,
          goal: 'all',
          level: readyLevelFilter,
          time: readyTimeFilter,
          equipment: readyEquipmentFilter,
        },
        tailoringPreferences,
      );
    },
    [
      readyDiscoveryItems,
      readyEquipmentFilter,
      readyLevelFilter,
      readyTimeFilter,
      searchQuery,
      tailoringPreferences,
    ],
  );
  const filteredCustomWorkouts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return customWorkouts;
    }

    return customWorkouts.filter((template) => {
      const presentation = getCustomTemplatePresentation(template);

      return (
        formatWorkoutDisplayLabel(template.name, 'Workout').toLowerCase().includes(normalizedQuery) ||
        presentation.title.toLowerCase().includes(normalizedQuery) ||
        presentation.subtitle.toLowerCase().includes(normalizedQuery) ||
        presentation.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [customWorkouts, searchQuery]);
  const compareItems = useMemo(
    () =>
      compareTemplateIds
        .map((templateId) => templates.find((template) => template.id === templateId) ?? null)
        .filter((template): template is NonNullable<typeof template> => Boolean(template))
        .map((template) => ({
          template,
          content: getReadyProgramContent(template.id),
        })),
    [compareTemplateIds, templates],
  );
  const readySectionItems = new Map<string, ReadyDiscoveryItem[]>();
  for (const item of filteredReadyItems) {
    const section = READY_FAMILY_SECTIONS.find((candidate) => candidate.match(item));
    if (!section) {
      continue;
    }
    const bucket = readySectionItems.get(section.key) ?? [];
    bucket.push(item);
    readySectionItems.set(section.key, bucket);
  }
  const readyCategorySections = READY_FAMILY_SECTIONS
    .filter((section) => readyGoalFilter === 'all' || READY_FILTER_SECTION_KEYS[readyGoalFilter].includes(section.key))
    .map((section) => ({
      key: section.key,
      title: t(language, section.titleKey),
      items: readySectionItems.get(section.key) ?? [],
    }))
    .filter((section) => section.items.length > 0);
  const visibleCustomWorkouts = showAllCustomWorkouts ? filteredCustomWorkouts : filteredCustomWorkouts.slice(0, 2);
  const hiddenCustomWorkoutCount = Math.max(filteredCustomWorkouts.length - visibleCustomWorkouts.length, 0);
  const shouldShowFeaturedReady = !recommendedReadyTemplate || showReadyLibrary;
  const collapsedWorkoutShortcuts = customWorkouts.slice(0, 3);

  function toggleCompareTemplate(templateId: string) {
    setCompareTemplateIds((current) => {
      if (current.includes(templateId)) {
        return current.filter((id) => id !== templateId);
      }

      if (current.length >= 2) {
        return [current[1], templateId];
      }

      return [...current, templateId];
    });
  }

  return (
    <>
      <ScreenHeader
        language={language}
        title={t(language, 'tabs.programs')}
        subtitle={t(language, 'ready.subtitle', { count: readyDiscoveryItems.length })}
      />
      <ScrollView
        contentContainerStyle={styles.readyTemplateContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.readyTemplateSearchCard}>
          <MagnifyingGlass size={18} color="#98A2B3" weight="bold" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t(language, 'ready.searchPlaceholder')}
            placeholderTextColor={theme.faint}
            selectionColor="#7C3AED"
            style={styles.readyTemplateSearchInput}
          />
          <Pressable
            onPress={() => setShowAdvancedReadyFilters((visible) => !visible)}
            hitSlop={10}
            style={[styles.readyTemplateFilterButton, showAdvancedReadyFilters && styles.readyTemplateFilterButtonActive]}
            accessibilityRole="button"
            accessibilityLabel={t(language, 'ready.openFilters')}
          >
            <SlidersHorizontal size={18} color={showAdvancedReadyFilters ? '#FFFFFF' : '#7C3AED'} weight="bold" />
          </Pressable>
        </View>

        <View style={styles.readyTemplateFilterBlock}>
          <Text style={styles.readyTemplateFilterLabel}>{t(language, 'ready.filterTemplates')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.readyTemplateFilterRow}
            snapToInterval={116}
            decelerationRate="fast"
          >
            {READY_GOAL_FILTERS.map((filter) => {
              const active = readyGoalFilter === filter.key;

              return (
                <Pressable
                  key={filter.key}
                  onPress={() => setReadyGoalFilter(filter.key)}
                  style={[styles.readyTemplateFilterChip, active && styles.readyTemplateFilterChipActive]}
                >
                  <ReadyGoalIcon filter={filter.key} active={active} />
                  <Text style={[styles.readyTemplateFilterText, active && styles.readyTemplateFilterTextActive]}>
                    {t(language, filter.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {showAdvancedReadyFilters ? (
        <View style={styles.readyTemplateRefinePanel}>
          <View style={styles.readyTemplateRefineGroup}>
            <Text style={styles.readyTemplateFilterLabel}>{t(language, 'progress.metric.duration')}</Text>
            <View style={styles.readyTemplateMiniChipRow}>
              {READY_TIME_FILTERS.map((filter) => {
                const active = readyTimeFilter === filter.key;

                return (
                  <Pressable
                    key={filter.key}
                    onPress={() => setReadyTimeFilter(filter.key)}
                    style={[styles.readyTemplateMiniChip, active && styles.readyTemplateMiniChipActive]}
                  >
                    <Text style={[styles.readyTemplateMiniChipText, active && styles.readyTemplateMiniChipTextActive]}>
                      {t(language, filter.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.readyTemplateRefineGroup}>
            <Text style={styles.readyTemplateFilterLabel}>{t(language, 'myData.equipment')}</Text>
            <View style={styles.readyTemplateMiniChipRow}>
              {READY_EQUIPMENT_FILTERS.map((filter) => {
                const active = readyEquipmentFilter === filter.key;

                return (
                  <Pressable
                    key={filter.key}
                    onPress={() => setReadyEquipmentFilter(filter.key)}
                    style={[styles.readyTemplateMiniChip, active && styles.readyTemplateMiniChipActive]}
                  >
                    <Text style={[styles.readyTemplateMiniChipText, active && styles.readyTemplateMiniChipTextActive]}>
                      {t(language, filter.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.readyTemplateRefineGroup}>
            <Text style={styles.readyTemplateFilterLabel}>{t(language, 'myData.experience')}</Text>
            <View style={styles.readyTemplateMiniChipRow}>
              {READY_LEVEL_FILTERS.map((filter) => {
                const active = readyLevelFilter === filter.key;

                return (
                  <Pressable
                    key={filter.key}
                    onPress={() => setReadyLevelFilter(filter.key)}
                    style={[styles.readyTemplateMiniChip, active && styles.readyTemplateMiniChipActive]}
                  >
                    <Text style={[styles.readyTemplateMiniChipText, active && styles.readyTemplateMiniChipTextActive]}>
                      {t(language, filter.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        ) : null}

        {readyCategorySections.length ? (
          <View style={styles.readyTemplateCategoryList}>
            {readyCategorySections.map((section) => (
              <View key={`ready-section:${section.key}`} style={styles.readyTemplateCategorySection}>
                <View style={styles.readyTemplateSectionHeader}>
                  <Text style={styles.readyTemplateSectionTitle}>{section.title}</Text>
                  <View style={styles.readyTemplateScrollHint}>
                    <View style={styles.readyTemplateScrollDotActive} />
                    <View style={styles.readyTemplateScrollDot} />
                  </View>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.readyTemplateCarousel}
                  decelerationRate="fast"
                  snapToInterval={232}
                >
                  {section.items.map((item, index) => {
                    const { template } = item;
                    const current = template.id === activeTemplateId;
                    const heroStyle =
                      section.key === 'balanced' || section.key === 'fatloss'
                        ? styles.readyTemplateHeroGreen
                        : index % 2 === 0
                          ? styles.readyTemplateHeroPurple
                          : styles.readyTemplateHeroGreen;

                    return (
                      <View key={`ready-template:${template.id}`} style={[styles.readyTemplateCard, current && styles.readyTemplateCardCurrent]}>
                        <Pressable onPress={() => onOpenReadyProgram(template.id)} style={styles.readyTemplateCardMain}>
                          <ImageBackground
                            source={READY_TEMPLATE_CARD_IMAGE}
                            resizeMode="cover"
                            style={styles.readyTemplateHero}
                            imageStyle={styles.readyTemplateHeroImage}
                          >
                            <View style={styles.readyTemplateHeroShade} />
                            <View style={[styles.readyTemplateHeroTone, heroStyle]} />
                            <View style={[styles.readyTemplateHeroBadge, heroStyle]}>
                              <Lightning size={14} color="#FFFFFF" weight="fill" />
                              <Text style={styles.readyTemplateHeroDays}>{template.daysPerWeek} DAY</Text>
                            </View>
                            <Text style={styles.readyTemplateHeroTitle} numberOfLines={2} adjustsFontSizeToFit>
                              {formatTemplateHeroLabel(template.splitType)}
                            </Text>
                          </ImageBackground>

                          <View style={styles.readyTemplateCopy}>
                            <Text style={styles.readyTemplateName} numberOfLines={2}>
                              {formatWorkoutDisplayLabel(template.name, 'Template')}
                            </Text>
                            <Text style={styles.readyTemplateMeta} numberOfLines={1}>
                              <Text style={styles.readyTemplateMetaStrong}>{template.daysPerWeek} days</Text>
                              <Text> | {formatGoal(template.goalType)}</Text>
                            </Text>
                            <View style={styles.readyTemplateFooterRow}>
                              <CalendarBlank size={14} color="#7B7196" weight="bold" />
                              <Text style={styles.readyTemplateDuration}>{template.sessions.length} sessions</Text>
                              <Clock size={14} color="#7B7196" weight="bold" />
                              <Text style={styles.readyTemplateDuration}>{item.minutes} min</Text>
                            </View>
                          </View>
                        </Pressable>

                        <Pressable
                          onPress={() => onStartReadyProgram(template.id)}
                          style={[styles.readyTemplateStartButton, current && styles.readyTemplateStartButtonCurrent]}
                        >
                          <Text style={styles.readyTemplateStartText}>
                    {t(language, current ? 'subs.current' : 'ready.startPlan')}
                  </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.readyTemplateEmptyCard}>
            <Text style={styles.readyTemplateEmptyTitle}>{t(language, 'ready.noMatch')}</Text>
            <Text style={styles.readyTemplateEmptyBody}>{t(language, 'ready.noMatchBody')}</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}


const makeStyles = (theme: Theme) => StyleSheet.create({
  readyTemplateContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: layout.bottomTabBarReserve,
    gap: spacing.md,
    backgroundColor: theme.bg,
  },
  readyTemplateSearchCard: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E7D9FF',
    backgroundColor: theme.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    position: 'relative',
    shadowColor: '#BDA5F4',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 3,
  },
  readyTemplateSearchInput: {
    flex: 1,
    minHeight: 42,
    color: theme.ink,
    fontSize: 13,
    fontWeight: '800',
    paddingVertical: 0,
    paddingRight: 48,
  },
  readyTemplateFilterButton: {
    width: 44,
    height: 38,
    borderRadius: 19,
    position: 'absolute',
    right: 4,
    top: 3,
    zIndex: 3,
    elevation: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.purpleLight,
  },
  readyTemplateFilterButtonActive: {
    backgroundColor: theme.purpleFill,
  },
  readyTemplateFilterBlock: {
    gap: 6,
  },
  readyTemplateFilterLabel: {
    color: theme.purpleBright,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  readyTemplateFilterRow: {
    gap: spacing.sm,
    paddingRight: spacing.xl,
  },
  readyTemplateFilterChip: {
    minWidth: 104,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2D3FF',
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  // The white-label violet: white on the dark theme's purpleBright is 2.7:1
  // (accessibility audit, 2026-09-21).
  readyTemplateFilterChipActive: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  readyTemplateFilterText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  readyTemplateFilterTextActive: {
    color: '#FFFFFF',
  },
  readyTemplateRefinePanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7D9FF',
    backgroundColor: theme.surface,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  readyTemplateRefineGroup: {
    gap: 3,
  },
  readyTemplateMiniChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  readyTemplateMiniChip: {
    minHeight: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2D3FF',
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  readyTemplateMiniChipActive: {
    backgroundColor: theme.purpleLight,
    borderColor: '#B994FF',
  },
  readyTemplateMiniChipText: {
    color: theme.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  readyTemplateMiniChipTextActive: {
    color: theme.purpleBright,
  },
  readyTemplateSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  readyTemplateSectionTitle: {
    // Was a fixed #050817: near-black on the dark page (#bugs 2026-10-01 audit).
    color: theme.ink,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  readyTemplateCategoryList: {
    gap: spacing.lg,
  },
  readyTemplateCategorySection: {
    gap: spacing.sm,
  },
  readyTemplateCarousel: {
    gap: spacing.sm,
    paddingRight: 42,
  },
  readyTemplateScrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  readyTemplateScrollDotActive: {
    width: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.purpleBright,
  },
  readyTemplateScrollDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D8C7FF',
  },
  readyTemplateCard: {
    overflow: 'hidden',
    width: 220,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E7D9FF',
    backgroundColor: theme.surface,
    shadowColor: '#BDA5F4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 5,
  },
  readyTemplateCardCurrent: {
    borderColor: theme.purpleBright,
  },
  readyTemplateCardMain: {
    gap: 0,
  },
  readyTemplateHero: {
    height: 222,
    padding: spacing.md,
    justifyContent: 'flex-end',
  },
  readyTemplateHeroImage: {
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
  },
  readyTemplateHeroPurple: {
    backgroundColor: 'rgba(74, 22, 158, 0.72)',
  },
  readyTemplateHeroGreen: {
    backgroundColor: 'rgba(5, 92, 57, 0.70)',
  },
  readyTemplateHeroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.30)',
  },
  readyTemplateHeroTone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 112,
    opacity: 0.72,
  },
  readyTemplateHeroBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    minHeight: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  readyTemplateHeroDays: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  readyTemplateHeroTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.5,
    textTransform: 'uppercase',
  },
  readyTemplateCopy: {
    minHeight: 142,
    padding: spacing.md,
    gap: spacing.xs,
  },
  readyTemplateName: {
    color: theme.ink,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  readyTemplateMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  readyTemplateMetaStrong: {
    color: theme.purpleBright,
    fontWeight: '900',
  },
  readyTemplateFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  readyTemplateDuration: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  readyTemplateStartButton: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    minHeight: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.purpleLight,
  },
  readyTemplateStartButtonCurrent: {
    backgroundColor: theme.greenSoft,
  },
  readyTemplateStartText: {
    color: theme.purpleBright,
    fontSize: 13,
    fontWeight: '900',
  },
  readyTemplateEmptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7D9FF',
    backgroundColor: theme.surface,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  readyTemplateEmptyTitle: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  readyTemplateEmptyBody: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});

