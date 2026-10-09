import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getPopularExerciseLibraryItems,
  getPopularExerciseLibraryOrder,
  getSuggestedExerciseLibraryItems,
} from '../lib/exerciseSuggestions';
import { getExerciseImageSource } from '../assets/exerciseImages';
import { exerciseCardLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import {
  BODY_PART_FILTERS,
  BodyPartFilter,
  EQUIPMENT_FILTERS,
  EXERCISE_TYPE_FILTERS,
  EquipmentFilter,
  ExerciseTypeFilter,
} from '../lib/exerciseBrowseFilter';
import {
  ExercisePickerFilters,
  NO_PICKER_FILTERS,
  exercisePickerChipLabel,
  exercisePickerRowLabels,
  listPickerExercises,
} from '../lib/exercisePicker';
import { orderExercisesBySelection } from '../lib/exerciseSelectionOrder';
import { t } from '../lib/i18n';
import { ExerciseSheetMode, exerciseSheetCopy } from '../lib/exerciseSheetMode';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';
import { KitBar } from './sheetKit';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { radii, spacing } from '../theme';

/**
 * One array, shared by every caller that has nothing selected.
 *
 * `= []` in the parameter list looks like the same thing and is not: it builds
 * a new array on every render, and this sheet's reset effect both depends on
 * that array and writes it into state. New array, effect runs, state changes,
 * render, new array — a loop with no exit that ran the whole time the sheet
 * was MOUNTED, open or not. Three screens sat on it (#bugs 2026-08-27).
 */
const NOTHING_SELECTED: string[] = [];

interface AddExerciseSheetProps {
  visible: boolean;
  /**
   * Height of the phone's system-button bar, read OUTSIDE this modal.
   * See the footer for why it cannot be read inside one.
   */
  bottomInset?: number;
  language?: AppLanguage;
  items: ExerciseLibraryItem[];
  recentItems: ExerciseLibraryItem[];
  currentItemIds?: string[];
  selectedIds?: string[];
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  confirmActionLabel?: string;
  autoFocusSearch?: boolean;
  multiSelect?: boolean;
  onClose: () => void;
  onSelectItem: (item: ExerciseLibraryItem) => void;
  onConfirmSelection?: (items: ExerciseLibraryItem[]) => void;
}

function sortName(item: ExerciseLibraryItem, language: AppLanguage) {
  return exerciseNameLabel(language, item.name);
}

// The chip lists and what they select live in lib/exerciseBrowseFilter, with
// the kettlebell chip's reasoning and the specialty chip's (#bugs 2026-10-06).
const categoryOptions = EXERCISE_TYPE_FILTERS;
export type SheetEquipmentOption = EquipmentFilter;
const equipmentOptions: SheetEquipmentOption[] = EQUIPMENT_FILTERS;

// Chips and rows say a value in one word, the library's (exercisePickerLabel):
// the sheet kept its own dictionary, and a lift the library screen called
// "Moninivel · Käsipainot" read "Perusliike · Käsipaino" here (#bugs 2026-10-06).

/** 38 drawn, 44 to the thumb. */
const PILL_SLOP = { top: 3, bottom: 3 } as const;

interface FilterPillGroupProps<T extends string> {
  title: string;
  options: T[];
  selected: T;
  language: AppLanguage;
  onSelect: (value: T) => void;
}

function FilterPillGroup<T extends string>({
  title,
  options,
  selected,
  language,
  onSelect,
}: FilterPillGroupProps<T>) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterTitle}>{title}</Text>
      <View style={styles.filterRow}>
        {options.map((option) => {
          const active = option === selected;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={PILL_SLOP}
              onPress={() => onSelect(option)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                {exercisePickerChipLabel(option, language)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** One card of the sheet: a library row, or a programme name the library does not hold. */
export interface ExercisePickerEntry {
  key: string;
  /** The stored name; the card prints its list label. */
  name: string;
  /** Null for a programme alternative with no library row: name only, no picture. */
  item: ExerciseLibraryItem | null;
}

// The three groups' rule lives in lib/exercisePicker, with every picker's list.
export type { ExercisePickerFilters };
export const NO_SHEET_FILTERS: ExercisePickerFilters = NO_PICKER_FILTERS;

interface ExercisePickerSection {
  title: string;
  subtitle?: string | null;
  entries: ExercisePickerEntry[];
}

interface ExerciseCardProps {
  entry: ExercisePickerEntry;
  featured?: boolean;
  selected: boolean;
  multiSelect: boolean;
  actionLabel: string;
  /** What a selected card's pill says: "Lisätty" once added, "Valittu" while a pick waits for its question. */
  selectedLabel: string;
  language: AppLanguage;
  onPress: () => void;
}

function ExerciseCard({ entry, featured = false, selected, multiSelect, actionLabel, selectedLabel, language, onPress }: ExerciseCardProps) {
  const styles = useThemedStyles(makeStyles);
  const { item, name } = entry;
  const previewImage = getExerciseImageSource(item?.imageKey);
  // The library screen's line, split over the card's two: body part, then equipment · type.
  const rowLabels = item ? exercisePickerRowLabels(item, language) : [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel} · ${exerciseNameLabel(language, name)}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.gridCard, featured && styles.featuredCard, selected && styles.gridCardSelected]}
    >
      <View style={styles.gridCardMedia}>
        {previewImage ? (
          <Image source={previewImage} style={styles.gridCardImage} resizeMode="cover" />
        ) : (
          <View style={styles.gridCardImageFallback}>
            <Text style={styles.gridCardImageFallbackText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        {multiSelect ? (
          <View style={[styles.gridCheckBadge, selected && styles.gridCheckBadgeActive]}>
            <Text style={[styles.gridCheckBadgeText, selected && styles.gridCheckBadgeTextActive]}>
              {selected ? '✓' : '+'}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.gridCardCopy}>
        {/* On its syllables when it has to break (lib/exerciseNameLabel exerciseCardLabel). */}
        <Text
          numberOfLines={3}
          style={styles.gridCardTitle}
          accessibilityLabel={exerciseNameLabel(language, name)}
          android_hyphenationFrequency="normal"
        >
          {exerciseCardLabel(language, name)}
        </Text>
        {item ? (
          <>
            <Text numberOfLines={1} style={styles.gridCardBodyPart}>
              {rowLabels[0]}
            </Text>
            <Text numberOfLines={2} style={styles.gridCardMeta}>
              {rowLabels.slice(1).join(' · ')}
            </Text>
          </>
        ) : null}
        {!multiSelect ? (
          <View style={[styles.gridActionPill, selected && styles.gridActionPillSelected]}>
            <Text style={[styles.gridActionText, selected && styles.gridActionTextSelected]}>
              {selected ? selectedLabel : actionLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface ExercisePickerSheetProps {
  visible: boolean;
  /** Read OUTSIDE the modal by the screen that opens it — see the footer below. */
  bottomInset: number;
  language: AppLanguage;
  /** What a tap does. The copy that differs between the modes comes from lib/exerciseSheetMode. */
  mode: ExerciseSheetMode;
  /** Swap mode: the lift being replaced, for the title. */
  swappedName?: string | null;
  /** Overrides for callers outside the guided player (the day editor, the template builder). */
  title?: string;
  /** Null says nothing under the title, where the mode's note does not apply (Home's swap: no set is logged yet). */
  subtitle?: string | null;
  actionLabel?: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef?: React.Ref<TextInput>;
  filters: ExercisePickerFilters;
  onFiltersChange: (next: ExercisePickerFilters) => void;
  /** The multi-select picker's single horizontal body-part row instead of the three groups. */
  quickBodyPartOnly?: boolean;
  /** Cards above the main list: "popular" when adding, the programme's own alternatives when swapping. */
  featured?: ExercisePickerSection | null;
  main: ExercisePickerSection;
  /** A line under the list, e.g. the swap's "already in this workout". Replaces the empty card when set. */
  listNote?: string | null;
  emptyTitle?: string;
  emptyBody?: string | null;
  selectedIds?: string[];
  multiSelect?: boolean;
  /**
   * A pick that waits for a question before it is applied (Home's swap: just
   * this time, or for ever). Its card is selected by name — a programme
   * alternative may have no library row — and says "Valittu".
   */
  pickedName?: string | null;
  onSelect: (entry: ExercisePickerEntry) => void;
  /** Under the list, after its note: actions that are not a pick (Home's drop, keep and remove). */
  listFooter?: React.ReactNode;
  /** The commit bar, for the multi-select picker and Home's scope question. */
  footer?: React.ReactNode;
  onClose: () => void;
}

/**
 * The exercise sheet itself — search, filters, a two-column card grid.
 *
 * Shared by adding and swapping (#bugs 2026-10-06, "Vaihda liike ja Lisää
 * liike pitäisi olla identtiset"): the guided player's swap sheet was a list
 * of picture rows with its own search field and chips, and now draws this.
 * It holds no list logic of its own — each caller derives what it lists
 * (the add flow below, the swap's candidates in the guided player) and hands
 * the sheet its search and filters to drive.
 */
export function ExercisePickerSheet({
  visible,
  bottomInset,
  language,
  mode,
  swappedName = null,
  title,
  subtitle,
  actionLabel,
  search,
  onSearchChange,
  searchRef,
  filters,
  onFiltersChange,
  quickBodyPartOnly = false,
  featured = null,
  main,
  listNote = null,
  emptyTitle,
  emptyBody,
  selectedIds = NOTHING_SELECTED,
  multiSelect = false,
  pickedName = null,
  onSelect,
  listFooter = null,
  footer = null,
  onClose,
}: ExercisePickerSheetProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const copy = exerciseSheetCopy(mode, language, swappedName);
  const sheetTitle = title ?? copy.title;
  const sheetSubtitle = subtitle === undefined ? copy.note : subtitle;
  const cardAction = actionLabel ?? copy.actionLabel;
  const isSelected = (entry: ExercisePickerEntry) =>
    pickedName !== null ? entry.name === pickedName : entry.item ? selectedIds.includes(entry.item.id) : false;
  const selectedLabel = t(language, pickedName !== null ? 'sheet.picked' : 'sheet.added');

  const listHeader = (
    <>
      <View style={styles.searchCard}>
        <Text style={styles.searchLabel}>{t(language, 'sheet.search')}</Text>
        <View style={styles.searchRow}>
          <TextInput
            ref={searchRef}
            value={search}
            onChangeText={onSearchChange}
            placeholder={copy.searchPlaceholder}
            placeholderTextColor={theme.faint}
            style={styles.searchInput}
            selectionColor={theme.purple}
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => onSearchChange('')} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>{t(language, 'sheet.clear')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {quickBodyPartOnly ? (
        <View style={styles.quickBodyPartGroup}>
          <Text style={styles.filterTitle}>{t(language, 'sheet.bodyPart')}</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickBodyPartRow}>
            {BODY_PART_FILTERS.map((option) => {
              const active = option === filters.bodyPart;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onFiltersChange({ ...filters, bodyPart: option })}
                  style={[styles.quickBodyPartChip, active && styles.quickBodyPartChipActive]}
                >
                  <Text style={[styles.quickBodyPartChipText, active && styles.quickBodyPartChipTextActive]}>
                    {exercisePickerChipLabel(option, language)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <>
          <FilterPillGroup
            title={t(language, 'sheet.category')}
            options={categoryOptions}
            selected={filters.category}
            language={language}
            onSelect={(category) => onFiltersChange({ ...filters, category })}
          />
          <FilterPillGroup
            title={t(language, 'sheet.bodyPart')}
            options={BODY_PART_FILTERS}
            selected={filters.bodyPart}
            language={language}
            onSelect={(bodyPart) => onFiltersChange({ ...filters, bodyPart })}
          />
          <FilterPillGroup
            title={t(language, 'sheet.equipment')}
            options={equipmentOptions}
            selected={filters.equipment}
            language={language}
            onSelect={(equipment) => onFiltersChange({ ...filters, equipment })}
          />
        </>
      )}

      {featured && featured.entries.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{featured.title}</Text>
            {featured.subtitle ? <Text style={styles.sectionSubtitle}>{featured.subtitle}</Text> : null}
          </View>
          <View style={styles.featuredGrid}>
            {featured.entries.map((entry) => (
              <ExerciseCard
                key={entry.key}
                entry={entry}
                featured
                selected={isSelected(entry)}
                multiSelect={multiSelect}
                actionLabel={cardAction}
                selectedLabel={selectedLabel}
                language={language}
                onPress={() => onSelect(entry)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{main.title}</Text>
          {main.subtitle ? <Text style={styles.sectionSubtitle}>{main.subtitle}</Text> : null}
        </View>
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>{sheetTitle}</Text>
              {sheetSubtitle ? <Text style={styles.headerSubtitle}>{sheetSubtitle}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>{t(language, 'common.close')}</Text>
            </Pressable>
          </View>

          {/* `flex: 1, minHeight: 0` is what keeps the footer on screen.
              Without it the list is laid out at its content height — hundreds
              of exercises — inside a sheet capped at 92% with overflow hidden,
              so "Lisää N liikettä" was pushed past the sheet's own bottom edge
              and clipped away. It looked like a button hidden behind the phone's
              system bar, and padding it up did nothing, because it was never on
              screen to begin with (user 2026-08-26, second report). */}
          <FlatList
            style={styles.grid}
            data={main.entries}
            keyExtractor={(entry) => entry.key}
            numColumns={2}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={8}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={styles.gridRow}
            // Without a footer bar the list runs to the sheet's bottom edge, so
            // it carries the button-bar inset itself: the last cards sat under
            // the phone's buttons in single-select mode.
            contentContainerStyle={[styles.content, footer ? null : { paddingBottom: spacing.xxl + bottomInset }]}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              listNote ? null : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>{emptyTitle ?? t(language, 'sheet.noMatches')}</Text>
                  {emptyBody !== null ? (
                    <Text style={styles.emptyText}>{emptyBody ?? t(language, 'sheet.noMatchesBody')}</Text>
                  ) : null}
                </View>
              )
            }
            ListFooterComponent={
              listNote || listFooter ? (
                <>
                  {listNote ? <Text style={styles.listNote}>{listNote}</Text> : null}
                  {listFooter}
                </>
              ) : null
            }
            renderItem={({ item: entry }) => (
              <ExerciseCard
                entry={entry}
                selected={isSelected(entry)}
                multiSelect={multiSelect}
                actionLabel={cardAction}
                selectedLabel={selectedLabel}
                language={language}
                onPress={() => onSelect(entry)}
              />
            )}
          />

          {footer}
        </View>
      </View>
    </Modal>
  );
}

export function AddExerciseSheet({
  bottomInset = 0,
  visible,
  language = 'en',
  items,
  recentItems,
  currentItemIds = NOTHING_SELECTED,
  selectedIds = NOTHING_SELECTED,
  title,
  subtitle,
  actionLabel,
  confirmActionLabel,
  autoFocusSearch = false,
  multiSelect = false,
  onClose,
  onSelectItem,
  onConfirmSelection,
}: AddExerciseSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetTitle = title ?? t(language, 'editor.addExercise');
  const addLabel = actionLabel ?? t(language, 'editor.add');
  const searchRef = useRef<TextInput | null>(null);
  const wasVisibleRef = useRef(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ExerciseTypeFilter>('all');
  const [bodyPart, setBodyPart] = useState<BodyPartFilter>('all');
  const [equipment, setEquipment] = useState<SheetEquipmentOption>('all');
  const [pendingSelectedIds, setPendingSelectedIds] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (!visible) {
      // Reset when the sheet CLOSES, not on every render it spends closed.
      // The guard is the second half of the loop fix above: a caller that
      // hands in a fresh array each render (an inline `selectedIds={[]}`, say)
      // must not be able to turn a closed sheet into a render loop either.
      if (wasVisibleRef.current) {
        wasVisibleRef.current = false;
        setSearch('');
        setCategory('all');
        setBodyPart('all');
        setEquipment('all');
        setPendingSelectedIds(selectedIds);
      }
      return;
    }

    if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      setPendingSelectedIds(selectedIds);
    }

    if (autoFocusSearch) {
      const timeout = setTimeout(() => {
        searchRef.current?.focus();
      }, 40);

      return () => clearTimeout(timeout);
    }

    return undefined;
  }, [autoFocusSearch, selectedIds, visible]);

  const effectiveSelectedIds = multiSelect ? pendingSelectedIds : selectedIds;

  function handleSelectItem(item: ExerciseLibraryItem) {
    if (!multiSelect) {
      if (selectedIds.includes(item.id)) {
        return;
      }
      onSelectItem(item);
      return;
    }

    setPendingSelectedIds((current) =>
      current.includes(item.id) ? current.filter((value) => value !== item.id) : [...current, item.id],
    );
  }

  function handleConfirmSelection() {
    if (!multiSelect || !onConfirmSelection) {
      return;
    }

    // In tap order, not library order — see orderExercisesBySelection.
    const selectedItems = orderExercisesBySelection(items, pendingSelectedIds);
    onConfirmSelection(selectedItems);
  }

  const commonStarterOrder = useMemo(() => getPopularExerciseLibraryOrder(items), [items]);

  const filteredItems = useMemo(() => {
    // A closed sheet lists nothing and ranks nothing. Callers keep it mounted
    // for its slide, and one of them handed in a fresh `recentItems` array on
    // every render: the library was filtered and re-sorted with localeCompare
    // behind a closed sheet, 230 ms each time, four times a second on the
    // guided player (#bugs 2026-09-30). Everything below derives from this.
    if (!visible) {
      return [];
    }
    // Every picker's one list (lib/exercisePicker): no stretch, drill or
    // strongman implement until a query or the specialty chip asks, the three
    // chip groups, and best answer first under a query. The popularity
    // accessor breaks ties: without it "penkki" answers with Penkkidippi
    // before Penkkipunnerrus, the very complaint the ranking was added for.
    return listPickerExercises(items, {
      query: search,
      filters: { category, bodyPart, equipment },
      language,
      popularity: (item) => commonStarterOrder.get(item.id),
    });
  }, [bodyPart, category, commonStarterOrder, equipment, items, language, search, visible]);

  const suggestedItems = useMemo(
    () =>
      visible
        ? getSuggestedExerciseLibraryItems({
            exerciseLibrary: items,
            currentItemIds,
            recentItems,
          })
        : [],
    [currentItemIds, items, recentItems, visible],
  );

  const commonStarterItems = useMemo(() => getPopularExerciseLibraryItems(items).slice(0, 8), [items]);

  const hasCustomFilters = category !== 'all' || bodyPart !== 'all' || equipment !== 'all';
  const hasQuery = search.trim().length > 0;
  const showSuggestedOrdering = !hasQuery && !hasCustomFilters;

  const orderedItems = useMemo(() => {
    const base = [...filteredItems];

    if (!showSuggestedOrdering) {
      // A typed query arrives already ranked by relevance, and re-sorting it
      // alphabetically here threw that away — the ranking never reached the
      // list in the app's main picker. Only a filtered-but-unsearched list
      // gets the alphabet.
      if (hasQuery) {
        return base;
      }
      return base.sort((left, right) => sortName(left, language).localeCompare(sortName(right, language)));
    }

    const recentOrder = new Map(
      recentItems.slice(0, 8).map((item, index) => [item.id, index]),
    );
    const suggestedOrder = new Map(
      (currentItemIds.length === 0 ? commonStarterItems : suggestedItems)
        .slice(0, 12)
        .map((item, index) => [item.id, index]),
    );

    return base.sort((left, right) => {
      const leftRecent = recentOrder.get(left.id);
      const rightRecent = recentOrder.get(right.id);
      if (leftRecent !== undefined && rightRecent !== undefined) {
        return leftRecent - rightRecent;
      }
      if (leftRecent !== undefined) {
        return -1;
      }
      if (rightRecent !== undefined) {
        return 1;
      }

      const leftSuggested = suggestedOrder.get(left.id);
      const rightSuggested = suggestedOrder.get(right.id);
      if (leftSuggested !== undefined && rightSuggested !== undefined) {
        return leftSuggested - rightSuggested;
      }
      if (leftSuggested !== undefined) {
        return -1;
      }
      if (rightSuggested !== undefined) {
        return 1;
      }

      const leftCommon = commonStarterOrder.get(left.id);
      const rightCommon = commonStarterOrder.get(right.id);
      if (leftCommon !== undefined && rightCommon !== undefined) {
        return leftCommon - rightCommon;
      }
      if (leftCommon !== undefined) {
        return -1;
      }
      if (rightCommon !== undefined) {
        return 1;
      }

      return sortName(left, language).localeCompare(sortName(right, language));
    });
  }, [
    language,
    commonStarterItems,
    commonStarterOrder,
    currentItemIds.length,
    filteredItems,
    hasQuery,
    recentItems,
    showSuggestedOrdering,
    suggestedItems,
  ]);

  const listTitle = showSuggestedOrdering
    ? t(language, currentItemIds.length === 0 ? 'sheet.popular' : 'sheet.suggested')
    : t(language, 'sheet.allExercises');
  const listSubtitle = showSuggestedOrdering
    ? t(language, currentItemIds.length === 0 ? 'sheet.popularSub' : 'sheet.suggestedSub')
    : t(language, 'sheet.available', { count: orderedItems.length });

  const popularItems = useMemo(() => {
    if (!showSuggestedOrdering) {
      return [];
    }
    return orderedItems.filter((item) => commonStarterOrder.has(item.id)).slice(0, 4);
  }, [commonStarterOrder, orderedItems, showSuggestedOrdering]);

  const popularItemIds = useMemo(() => new Set(popularItems.map((item) => item.id)), [popularItems]);

  const mainItems = useMemo(() => {
    if (!showSuggestedOrdering) {
      return orderedItems;
    }
    return orderedItems.filter((item) => !popularItemIds.has(item.id));
  }, [orderedItems, popularItemIds, showSuggestedOrdering]);

  const featuredEntries = useMemo(() => popularItems.map(toEntry), [popularItems]);
  const mainEntries = useMemo(() => mainItems.map(toEntry), [mainItems]);

  return (
    <ExercisePickerSheet
      visible={visible}
      bottomInset={bottomInset}
      language={language}
      mode="add"
      title={sheetTitle}
      subtitle={subtitle}
      actionLabel={addLabel}
      search={search}
      onSearchChange={setSearch}
      searchRef={searchRef}
      filters={{ category, bodyPart, equipment }}
      onFiltersChange={(next) => {
        setCategory(next.category);
        setBodyPart(next.bodyPart);
        setEquipment(next.equipment);
      }}
      quickBodyPartOnly={multiSelect}
      featured={
        featuredEntries.length > 0
          ? { title: t(language, 'sheet.popular'), subtitle: t(language, 'sheet.popularSub'), entries: featuredEntries }
          : null
      }
      main={{
        title: showSuggestedOrdering ? t(language, 'sheet.allExercises') : listTitle,
        subtitle: showSuggestedOrdering ? t(language, 'sheet.available', { count: mainItems.length }) : listSubtitle,
        entries: mainEntries,
      }}
      selectedIds={effectiveSelectedIds}
      multiSelect={multiSelect}
      onSelect={(entry) => {
        if (entry.item) {
          handleSelectItem(entry.item);
        }
      }}
      onClose={onClose}
      footer={
        multiSelect ? (
          /* The sheet is anchored to the bottom edge and its footer padding
             was a fixed number, so on a phone with system buttons the confirm
             button sat behind them — and "Lisää N liikettä" is the only way
             anything gets added at all ("nappi häviää alas... mitään
             liikkeitä ei voi lisätä", #bugs 2026-08-26). The bar's height is
             only known at runtime. */
          /**
           * The system-button bar's height comes in as a prop, measured by
           * the screen that opens this.
           *
           * A Modal is its own native window, and inside one this app gets
           * zero for the bottom inset three different ways: from the root
           * provider, from a provider added inside the modal, and from
           * `initialWindowMetrics`. All three were tried on the emulator
           * with three-button navigation and the confirm button stayed half
           * under the bar (#bugs 2026-08-28; the same button, "fixed" on
           * 26.8 with `insets.bottom + spacing.lg`, which was the first of
           * the three). Outside the modal the same hook returns the right
           * number — the tab bar has always sat above the buttons — so the
           * caller reads it there and hands it over.
           */
          <View style={[styles.footer, { paddingBottom: bottomInset + spacing.lg }]}>
            {/* The kit's commit bar, in flow (design frame 07): it exists
                only once something is picked, prints the whole edit on one
                line — the day on the left, the pick on the right — and one
                orange button writes. The "valitse liikkeitä" placeholder
                row went with it: a bar that is not there says the same
                thing without saying anything. */}
            <KitBar
              floating={false}
              visible={pendingSelectedIds.length > 0}
              from={subtitle ?? sheetTitle}
              to={
                pendingSelectedIds.length === 1
                  ? exerciseNameLabel(
                      language,
                      items.find((item) => item.id === pendingSelectedIds[0])?.name ?? '',
                    )
                  : t(language, 'sheet.selectedCount', { count: pendingSelectedIds.length })
              }
              buttons={[
                {
                  label:
                    confirmActionLabel ??
                    t(
                      language,
                      pendingSelectedIds.length === 1 ? 'sheet.addOne' : 'sheet.addCount',
                      { count: pendingSelectedIds.length },
                    ),
                  kind: 'p',
                  onPress: handleConfirmSelection,
                },
              ]}
              clearLabel={t(language, 'sheet.clear')}
              onClear={() => setPendingSelectedIds([])}
              bottomInset={0}
            />
          </View>
        ) : null
      }
    />
  );
}

function toEntry(item: ExerciseLibraryItem): ExercisePickerEntry {
  return { key: item.id, name: item.name, item };
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6, 4, 16, 0.45)',
  },
  /**
   * The sheet stands on `bg`, not on `surface`.
   *
   * Both the sheet and the cards inside it were `surface`, which in dark is a
   * lighter indigo than the app behind them — so the sheet read as a pale
   * rectangle pasted over a near-black screen, and the cards had no edge
   * against it ("tausta värikin näyttää oudolta", #bugs 2026-08-26). Ground on
   * `bg` and the sheet belongs to the app; the cards keep `surface` and lift
   * off it.
   */
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: theme.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  headerTitle: {
    color: theme.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    minHeight: 36,
    justifyContent: 'center',
  },
  closeButtonText: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  // The list takes the space left over, rather than the space it wants.
  grid: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  searchCard: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  searchLabel: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: spacing.md,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  clearButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  clearButtonText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  filterGroup: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterTitle: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Padded by the pills' slop and pulled back by the same, so a 38 dp pill
  // reaches 44 to the thumb and Android does not clip the slop to the row
  // (accessibility audit, 2026-09-21 pattern). The gap between wrapped
  // rows (10) is wider than two slops, so they never overlap.
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: PILL_SLOP.top,
    marginVertical: -PILL_SLOP.top,
  },
  filterPill: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  filterPillActive: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  filterPillText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  filterPillTextActive: {
    color: theme.purpleDark,
  },
  quickBodyPartGroup: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickBodyPartRow: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  quickBodyPartChip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  // purpleFill, not purple, wherever white is written on the violet: in dark
  // `purple` is a text violet and white on it is 3.5:1 (accessibility audit,
  // 2026-09-21).
  quickBodyPartChipActive: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  quickBodyPartChipText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  quickBodyPartChipTextActive: {
    color: '#FFFFFF',
  },
  section: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  featuredGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  /**
   * Two per row, by giving the card a width to wrap on.
   *
   * It inherited `flex: 1` from gridCard, and `flex: 1` means `flexBasis: 0` —
   * a child with no base width never makes the line overflow, so `flexWrap`
   * had nothing to trigger on and all four popular exercises shared one row at
   * about 80dp each. The names broke every three letters (user 2026-08-26).
   *
   * The basis is 47 rather than 48 because the gap counts too: two 48% cards
   * plus a 16dp gap is wider than the row, which would wrap them to one per
   * line instead. Grow fills whatever is left over, capped at 48%.
   */
  featuredCard: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: '47%',
    maxWidth: '48%',
    marginBottom: 0,
  },
  gridRow: {
    gap: spacing.md,
  },
  gridCard: {
    flex: 1,
    maxWidth: '48%',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  gridCardSelected: {
    borderColor: theme.purple,
    backgroundColor: theme.purpleLight,
  },
  gridCardMedia: {
    position: 'relative',
    aspectRatio: 0.84,
    backgroundColor: theme.surfaceSoft,
  },
  gridCardImage: {
    width: '100%',
    height: '100%',
  },
  gridCardImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  gridCardImageFallbackText: {
    color: theme.ink,
    fontSize: 28,
    fontWeight: '900',
  },
  gridCheckBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCheckBadgeActive: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  gridCheckBadgeText: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  gridCheckBadgeTextActive: {
    color: '#FFFFFF',
  },
  gridCardCopy: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 4,
  },
  /**
   * Sized for Finnish compounds, not for English.
   *
   * "Istuen ojentajapunnerrus" broke as "Istuen ojentajap / unnerrus" and the
   * card next to it truncated mid-word at two lines (#bugs 2026-08-26). The
   * card is about 141dp of text at a 411dp screen, and the longest single word
   * in the library is 25 characters, so no size makes every name fit on one
   * line — the aim is that the common name fits and the long one is at least
   * shown whole. 14dp holds roughly eighteen characters, and the third line
   * takes what is left rather than cutting it off.
   */
  gridCardTitle: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  gridCardBodyPart: {
    color: theme.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  gridCardMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    minHeight: 32,
  },
  gridActionPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.purpleFill,
  },
  gridActionPillSelected: {
    backgroundColor: theme.purpleLight,
  },
  gridActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  gridActionTextSelected: {
    color: theme.purpleDark,
  },
  emptyCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  listNote: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
  },
  footer: {
    // The kit bar inside brings its own border, surface and horizontal
    // padding; this only keeps the sheet's guarded safe-area padding.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
