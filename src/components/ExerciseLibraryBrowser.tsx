import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { VinhaIcon, VinhaIconName } from './VinhaIcon';
import { getExerciseImageSource } from '../assets/exerciseImages';
import { getPopularExerciseLibraryOrder } from '../lib/exerciseSuggestions';
import { exerciseCardLabel, exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { I18nKey, t } from '../lib/i18n';
import type { LibraryCollectionState } from '../lib/exerciseCollections';
import { libraryLabel } from '../lib/libraryLabel';
import {
  BODY_PART_FILTERS,
  BodyPartFilter,
  EQUIPMENT_FILTERS,
  EXERCISE_TYPE_FILTERS,
  EquipmentFilter,
  ExerciseTypeFilter,
} from '../lib/exerciseBrowseFilter';
import { exercisePickerChipLabel, exercisePickerRowMeta, listPickerExercises } from '../lib/exercisePicker';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

// Card is 180 wide with a 1px border → 178 content width for the photo.
const CARD_IMAGE_WIDTH = 178;

interface ExerciseLibraryBrowserProps {
  items: ExerciseLibraryItem[];
  language?: AppLanguage;
  onOpenItem?: (item: ExerciseLibraryItem) => void;
  /**
   * The course this reader has begun and not finished, if there is one.
   *
   * The library's own way back into it — a different thing from browsing them
   * all, which lives on its own screen. Absent when nothing is started: a card
   * pointing at a course never opened would be an advertisement wearing the
   * words "pick up where you left off".
   */
  learnCollection?:
    | { id: string; title: string; done: number; total: number; percent: number; state: LibraryCollectionState }
    | null;
  onOpenCollection?: (collectionId: string) => void;
  onOpenLearnIndex?: () => void;
}

function formatCompactBodyPartLabel(raw: string, language: AppLanguage = 'en') {
  return libraryLabel(raw, language);
}

function getBodyPartIcon(bodyPart: BodyPartFilter): VinhaIconName {
  switch (bodyPart) {
    case 'quadriceps':
    case 'hamstrings':
    case 'calves':
      return 'legs';
    case 'chest':
      return 'chest';
    case 'back':
      return 'back';
    case 'shoulders':
      return 'shoulders';
    case 'legs':
      return 'legs';
    case 'biceps':
    case 'triceps':
      return 'arms';
    case 'core':
      return 'core';
    case 'glutes':
      return 'glutes';
    case 'full body':
      return 'strength';
    default:
      return 'strength';
  }
}

export function getItemImageKey(item: ExerciseLibraryItem) {
  return item.imageKey ?? null;
}

/**
 * "Rinta · Tanko · Moninivel" — the line under a library row's name, the same
 * words as every picker's (exercisePickerRowMeta).
 */
export function exerciseLibraryRowMeta(item: ExerciseLibraryItem, language: AppLanguage): string {
  return exercisePickerRowMeta(item, language);
}

function useOrderedExercises(items: ExerciseLibraryItem[], filteredItems: ExerciseLibraryItem[], keepOrder = false) {
  const commonOrder = useMemo(() => getPopularExerciseLibraryOrder(items), [items]);

  const orderedItems = useMemo(() => {
    if (keepOrder) {
      // A query already ranked these best-answer-first; popularity and the
      // alphabet would put the variants back above the lift itself.
      return filteredItems;
    }
    return [...filteredItems].sort((left, right) => {
      const leftCommon = commonOrder.get(left.id);
      const rightCommon = commonOrder.get(right.id);

      if (leftCommon !== undefined && rightCommon !== undefined) {
        return leftCommon - rightCommon;
      }
      if (leftCommon !== undefined) {
        return -1;
      }
      if (rightCommon !== undefined) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });
  }, [commonOrder, filteredItems, keepOrder]);

  return { commonOrder, orderedItems };
}

function SearchIcon({ color: colorProp, size = 18 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.faint;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={2} />
      <Path d="M21 21l-4-4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function FilterIcon({ color: colorProp, size = 19 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.purpleDark;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M6 12h12M10 18h4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ListIcon({ color: colorProp, size = 14 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.muted;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M4 12h16M4 17h10" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function DumbbellIcon({ color: colorProp, size = 22 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.faint;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function CategoryIcon({ option, color }: { option: string; color: string }) {
  if (option === 'all') {
    return <ListIcon color={color} size={14} />;
  }
  return <VinhaIcon name={getBodyPartIcon(option as BodyPartFilter)} color={color} size={14} />;
}

// Explicit numeric width/height (not '%' or absoluteFill): images nested in the
// horizontal rail ScrollViews inside the FlatList header never get an initial
// layout pass on Android, so a size-inheriting <Image> stays at zero and never
// fires onLoad until a scroll forces re-layout. Intrinsic pixel dimensions let
// the image request fire immediately at mount.
function Thumb({
  imageKey,
  width,
  height,
  radius = 12,
}: {
  imageKey: string | null;
  width: number;
  height: number;
  radius?: number;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const source = useMemo(() => getExerciseImageSource(imageKey), [imageKey]);
  const [state, setState] = useState<'load' | 'ok' | 'err'>(source ? 'load' : 'err');

  useEffect(() => {
    setState(source ? 'load' : 'err');
  }, [source]);

  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: theme.surfaceSoft }}>
      {source ? (
        <Image
          source={source}
          resizeMode="cover"
          style={{ width, height }}
          onLoad={() => setState('ok')}
          onError={() => setState('err')}
        />
      ) : null}
      {state !== 'ok' ? (
        <View style={[StyleSheet.absoluteFill, styles.thumbSkeleton]}>
          {state === 'err' ? <DumbbellIcon /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The circle is an eye, and it opens the exercise.
 *
 * It used to be a "+" that dropped the lift straight into a workout. A row
 * here is a name and three words, so adding from it was adding blind, and the
 * whole affordance came out (#38). What the library is actually for is looking
 * something up — so the circle came back doing that, in the app's own
 * "pressable" orange, and it marks the row as something that opens.
 *
 * It does the same thing as tapping the row, deliberately. Two controls that
 * agree are a bigger target; two that disagreed is what the "+" was.
 */
function LookButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={styles.lookButton}
    >
      {/* The ink the orange was paired with, not white: on the light theme's
          orange a white glyph is the lower-contrast of the two.

          The shared eye, not a local copy. This file already imports
          VinhaIcon for the body-part glyphs, and it had a second almond with
          a filled pupil sitting next to the set's stroked one — the eye this
          card IS should be the eye the app draws everywhere else. */}
      <VinhaIcon name="eye" color={theme.onHighlight} size={17} />
    </Pressable>
  );
}

function ExCard({
  item,
  language,
  onOpen,
}: {
  item: ExerciseLibraryItem;
  language: AppLanguage;
  onOpen?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={styles.card}>
      <View style={styles.cardImageWrap}>
        <Thumb imageKey={getItemImageKey(item)} radius={0} width={CARD_IMAGE_WIDTH} height={104} />
        <View style={styles.cardStar}>
        </View>
      </View>
      <View style={styles.cardBody}>
        {/* On its syllables, as the add sheet's cards (#bugs 2026-10-08). */}
        <Text
          numberOfLines={2}
          style={styles.cardTitle}
          accessibilityLabel={exerciseNameLabel(language, item.name)}
          android_hyphenationFrequency="normal"
        >
          {exerciseCardLabel(language, item.name)}
        </Text>
        <View style={styles.cardFooter}>
          <Text numberOfLines={1} style={styles.cardMeta}>
            {libraryLabel(item.bodyPart, language)}
          </Text>
          {/* No action, no button — the rule #38 established. A filled accent
              circle that ignores the tap reads as broken, not as absent. */}
          {onOpen ? (
            <LookButton
              label={t(language, 'library.a11y.look', { name: exerciseNameLabel(language, item.name) })}
              onPress={onOpen}
            />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * One library row: the photo, the name in two lines, and what it trains with
 * what. The library's own list, and — since #bugs 2026-09-30 ("saisiko sen
 * saman liikekirjaston missä on ne kuvat niin tuotua tähän") — the guided
 * player's swap sheet, so a lift is recognised by its picture in both places
 * rather than by its name in one of them.
 *
 * Presentational: the caller says what the row is called, what it shows and
 * what a tap does. `meta` is null for a name the library has no row for — a
 * programme alternative can be one — and the thumb then shows the dumbbell.
 */
export function ExerciseLibraryRow({
  title,
  accessibilityLabel,
  meta,
  imageKey,
  onPress,
  trailing,
}: {
  title: string;
  accessibilityLabel: string;
  meta: string | null;
  imageKey: string | null;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    // A button when it does something: the swap sheet's rows were announced
    // as buttons before they became library rows (review, 2026-09-30).
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={styles.row}
    >
      <Thumb imageKey={imageKey} radius={11} width={52} height={52} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={2} style={styles.rowTitle} accessibilityLabel={accessibilityLabel}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={styles.rowMeta}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

function ExRow({
  item,
  language,
  onOpen,
}: {
  item: ExerciseLibraryItem;
  language: AppLanguage;
  onOpen?: () => void;
}) {
  return (
    <ExerciseLibraryRow
      title={exerciseListLabel(language, item.name)}
      accessibilityLabel={exerciseNameLabel(language, item.name)}
      meta={exerciseLibraryRowMeta(item, language)}
      imageKey={getItemImageKey(item)}
      onPress={onOpen}
      trailing={
        onOpen ? (
          <LookButton
            label={t(language, 'library.a11y.look', { name: exerciseNameLabel(language, item.name) })}
            onPress={onOpen}
          />
        ) : null
      }
    />
  );
}

function SectionHead({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadLabel}>{label}</Text>
      {action ? (
        <Text onPress={onAction} style={styles.sectionHeadAction}>
          {action}
        </Text>
      ) : null}
    </View>
  );
}

export function ExerciseLibraryBrowser({
  items,
  language = 'en',
  onOpenItem,
  learnCollection = null,
  onOpenCollection,
  onOpenLearnIndex,
}: ExerciseLibraryBrowserProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bodyPartFilter, setBodyPartFilter] = useState<BodyPartFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<ExerciseTypeFilter>('all');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all');
  /**
   * Tapping the chip you already picked clears it.
   *
   * Every row carries an "All" chip, so a way back always existed — but the
   * gesture a reader reaches for first is tapping the highlighted chip again,
   * and that set the same value it already held. Nothing moved, so the filter
   * read as stuck: "jos vahingossa valitsee jotain filtteristä niitä ei saa
   * pois valittua" (user, 2026-09-01, with two chips lit and the badge
   * showing 2).
   *
   * 'all' IS the cleared state rather than a fourth value, which is why this
   * toggles to it instead of to null — the three filters read `!== 'all'`
   * everywhere, and a null would have to be taught to all of them.
   */
  function toggleFilter<T extends string>(current: T, option: T): T | 'all' {
    return current === option ? 'all' : option;
  }
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<TextInput>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  const flash = (message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), 1700);
  };

  // Every picker's chips (lib/exerciseBrowseFilter). These were derived from
  // the stored values, so the body parts had no "Etureidet" — the leg
  // extension sat somewhere in 276 "Jalat" rows (#bugs 2026-10-06) — and the
  // order was the alphabet of the English keys. The equipment chips select
  // by the value the rows print, kettlebells included (displayEquipmentValue).
  const bodyPartOptions = BODY_PART_FILTERS;
  const categoryOptions = EXERCISE_TYPE_FILTERS;
  const equipmentOptions = EQUIPMENT_FILTERS;

  const query = search.trim().toLowerCase();
  const popularOrder = useMemo(() => getPopularExerciseLibraryOrder(items), [items]);
  // Every picker's one list (lib/exercisePicker), best answer first under a
  // query. This screen alone lists the stretches unasked — it is where you
  // learn them — and the strongman implements still only under a query or
  // their own chip.
  const filteredItems = useMemo(
    () =>
      listPickerExercises(items, {
        query,
        filters: { category: categoryFilter, bodyPart: bodyPartFilter, equipment: equipmentFilter },
        language,
        popularity: (item) => popularOrder.get(item.id),
        listsStretches: true,
      }),
    [items, language, query, popularOrder, bodyPartFilter, categoryFilter, equipmentFilter],
  );

  const { commonOrder, orderedItems } = useOrderedExercises(items, filteredItems, query.length > 0);
  const hasModalFilters = categoryFilter !== 'all' || equipmentFilter !== 'all';
  const showDashboardSections = search.trim().length === 0 && bodyPartFilter === 'all' && !hasModalFilters;

  const activeFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (equipmentFilter !== 'all' ? 1 : 0);

  const popularItems = useMemo(
    () => orderedItems.filter((item) => commonOrder.has(item.id)).slice(0, 8),
    [commonOrder, orderedItems],
  );
  const suggestedItems = useMemo(() => {
    const excluded = new Set(popularItems.map((item) => item.id));
    return orderedItems.filter((item) => !excluded.has(item.id)).slice(0, 8);
  }, [orderedItems, popularItems]);

  const listItems = useMemo(
    () => orderedItems.slice(0, showDashboardSections ? 36 : undefined),
    [orderedItems, showDashboardSections],
  );

  // Keyed, both of them: "RESULTS" sat over a Finnish list of Finnish names.
  const resultsLabel = showDashboardSections
    ? t(language, 'library.allExercises')
    : search.trim().length
      ? t(language, 'library.results')
      : bodyPartFilter !== 'all'
        ? formatCompactBodyPartLabel(bodyPartFilter, language).toUpperCase()
        : t(language, 'library.results');

  function handleOpen(item: ExerciseLibraryItem) {
    onOpenItem?.(item);
  }

  function renderRail(sectionItems: ExerciseLibraryItem[]) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.rail}
      >
        {sectionItems.map((item) => (
          <ExCard language={language}
            key={item.id}
            item={item}
            onOpen={onOpenItem ? () => handleOpen(item) : undefined}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={listItems}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>{t(language, 'library.title')}</Text>
                <Text style={styles.subtitle}>{t(language, 'library.subtitle')}</Text>
              </View>
              <View style={styles.headerActions}>
                {/* Named: two icon-only buttons with no label were invisible to
                    a screen reader — and to the walkthrough that could not
                    find the filter panel. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'library.a11y.search')}
                  onPress={() => searchRef.current?.focus()}
                  style={styles.iconButton}
                >
                  <SearchIcon color={theme.purpleDark} size={19} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'library.a11y.filters')}
                  accessibilityState={{ expanded: filtersOpen }}
                  onPress={() => setFiltersOpen((current) => !current)}
                  style={styles.iconButton}
                >
                  <FilterIcon />
                  {activeFilterCount > 0 ? (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            </View>

            <View style={styles.searchShell}>
              <SearchIcon />
              <TextInput
                ref={searchRef}
                value={search}
                onChangeText={setSearch}
                placeholder={t(language, 'sheet.searchPlaceholder')}
                placeholderTextColor={theme.faint}
                style={styles.searchInput}
              />
              {search.length ? (
                <Text onPress={() => setSearch('')} style={styles.searchClear}>
                  ×
                </Text>
              ) : null}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.categoryRail}
            >
              {bodyPartOptions.map((option) => {
                const selected = bodyPartFilter === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    // 34 drawn, 44 to the thumb (accessibility audit,
                    // 2026-09-21); the rail's padding holds the slop.
                    hitSlop={{ top: 5, bottom: 5 }}
                    onPress={() => setBodyPartFilter(toggleFilter(bodyPartFilter, option))}
                    style={[styles.categoryChip, selected && styles.categoryChipActive]}
                  >
                    <CategoryIcon option={option} color={selected ? '#FFFFFF' : theme.muted} />
                    <Text style={[styles.categoryChipText, selected && styles.categoryChipTextActive]}>
                      {formatCompactBodyPartLabel(option, language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {filtersOpen ? (
              <View style={styles.filtersShell}>
                <Text style={styles.filtersTitle}>{t(language, 'library.filtersTitle')}</Text>
                <Text style={styles.filtersSubtitle}>{t(language, 'library.filtersSubtitle')}</Text>

                <Text style={styles.filterSectionLabel}>{t(language, 'library.filterType')}</Text>
                <View style={styles.filterGrid}>
                  {categoryOptions.map((option) => {
                    const selected = categoryFilter === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setCategoryFilter(toggleFilter(categoryFilter, option))}
                        style={[styles.filterChip, selected && styles.filterChipSelected]}
                      >
                        <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                          {exercisePickerChipLabel(option, language)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.filterSectionLabel, styles.filterSectionLabelSpaced]}>
                  {t(language, 'library.filterEquipment')}
                </Text>
                <View style={styles.filterGrid}>
                  {equipmentOptions.map((option) => {
                    const selected = equipmentFilter === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setEquipmentFilter(toggleFilter(equipmentFilter, option))}
                        style={[styles.filterChip, selected && styles.filterChipSelected]}
                      >
                        <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                          {exercisePickerChipLabel(option, language)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {showDashboardSections ? (
              <>
                {/* The card is the ONLY door into Learn, so it renders in all
                    three states. Nested inside an in-progress check it was
                    invisible on a fresh install — nothing learned, nothing
                    rendered, and no other route to LearnIndexScreen anywhere
                    in the app — and it closed again behind anyone who
                    finished the course. Only the heading changes. */}
                {learnCollection && onOpenCollection ? (
                  <View style={styles.dashboardSection}>
                    <SectionHead
                      label={t(
                        language,
                        learnCollection.state === 'inProgress' ? 'library.pickUp' : 'learn.eyebrow',
                      )}
                      action={onOpenLearnIndex ? t(language, 'library.learnAll') : undefined}
                      onAction={onOpenLearnIndex}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenCollection(learnCollection.id)}
                      style={({ pressed }) => [styles.pickUpCard, pressed && styles.pickUpCardPressed]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={styles.pickUpTitle}>
                          {learnCollection.title}
                        </Text>
                        <View style={styles.pickUpProgressRow}>
                          <View style={styles.pickUpTrack}>
                            <View
                              style={[
                                styles.pickUpFill,
                                { width: `${learnCollection.percent}%` },
                              ]}
                            />
                          </View>
                          <Text style={styles.pickUpCount}>
                            {t(language, 'learn.progress', {
                              done: learnCollection.done,
                              total: learnCollection.total,
                            })}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.dashboardSection}>
                  <SectionHead label={t(language, 'library.popular')} action={t(language, 'programs.viewAll')} />
                  {renderRail(popularItems)}
                </View>

                {/* The favourites rail went with the star (2026-09-01). It
                    could only ever be empty until the reader found a control
                    whose one effect was on a different tab entirely. */}

                <View style={styles.dashboardSection}>
                  <SectionHead label={t(language, 'library.suggested')} action={t(language, 'programs.viewAll')} />
                  {renderRail(suggestedItems)}
                </View>
              </>
            ) : null}

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{resultsLabel}</Text>
              <Text style={styles.summaryCount}>
                {t(language, orderedItems.length === 1 ? 'library.exerciseCountOne' : 'library.exerciseCountMany', {
                  count: orderedItems.length,
                })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t(language, 'sheet.noMatches')}</Text>
            <Text style={styles.emptyText}>{t(language, 'library.noMatchesBody')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ExRow language={language}
            item={item}
            onOpen={onOpenItem ? () => handleOpen(item) : undefined}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
      />

      {toast ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  listContent: {
    paddingBottom: layout.bottomTabBarReserve,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  headerBlock: {
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    // The white-label violet (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  searchShell: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '600',
    paddingVertical: 0,
  },
  searchClear: {
    color: theme.faint,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 2,
  },
  // 5 below, not 2, so the chips' 5 of hitSlop is inside the rail — Android
  // clips a slop to its parent (accessibility audit, 2026-09-21).
  categoryRail: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 5,
    paddingRight: 8,
  },
  categoryChip: {
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  categoryChipActive: {
    borderColor: theme.purpleFill,
    backgroundColor: theme.purpleFill,
  },
  categoryChipText: {
    color: theme.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  filtersShell: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 16,
  },
  filtersTitle: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  filtersSubtitle: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  filterSectionLabel: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 14,
  },
  filterSectionLabelSpaced: {
    marginTop: 16,
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  filterChip: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  filterChipSelected: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  filterChipText: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: theme.purpleDark,
  },
  dashboardSection: {
    marginTop: 22,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 11,
  },
  sectionHeadLabel: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionHeadAction: {
    color: theme.highlight,
    fontSize: 12.5,
    fontWeight: '800',
  },
  rail: {
    gap: 12,
    paddingRight: 20,
    paddingVertical: 2,
  },
  card: {
    width: 180,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  cardImageWrap: {
    position: 'relative',
  },
  cardStar: {
    position: 'absolute',
    top: 8,
    left: 8,
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 13,
  },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: theme.ink,
    lineHeight: 17,
    height: 34,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  cardMeta: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  rowSeparator: {
    height: 9,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
  },
  rowMeta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 3,
  },
  thumbSkeleton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  pickUpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    borderLeftWidth: 3,
    borderLeftColor: theme.purpleDark,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  pickUpCardPressed: {
    opacity: 0.85,
  },
  pickUpTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  pickUpProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 7,
  },
  pickUpTrack: {
    width: 96,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  pickUpFill: {
    height: '100%',
    backgroundColor: theme.purpleDark,
    borderRadius: 999,
  },
  pickUpCount: {
    color: theme.purpleBright,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  lookButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    // Orange: the app's own "you can press this". A green circle in a
    // purple-and-orange app was the loudest wrong note on the page
    // ("+ikoni sotkee värit aivan pieleen", #bugs 2026-08-26).
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 26,
    marginBottom: 12,
  },
  summaryLabel: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  summaryCount: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 38,
    paddingHorizontal: 10,
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  toastText: {
    backgroundColor: 'rgba(20,12,38,0.94)',
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
