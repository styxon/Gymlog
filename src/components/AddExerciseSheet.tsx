import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './AppText';

import {
  getPopularExerciseLibraryItems,
  getPopularExerciseLibraryOrder,
  getSuggestedExerciseLibraryItems,
} from '../lib/exerciseSuggestions';
import { getExerciseImageSource } from '../assets/exerciseImages';
import { exerciseCardLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { exerciseInitials } from '../lib/exerciseInitials';
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
import Svg, { Circle, Path } from 'react-native-svg';
import { SectionLabel } from './SettingsUi';
import { KitBar, SHEET_CHIP_SLOP, SheetChip, SheetHead } from './sheetKit';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { radii, spacing } from '../theme';
import { TEXT_SCALE_CAP } from '../textScale';

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

type FilterGroupKey = keyof ExercisePickerFilters;

const FILTER_GROUPS: { key: FilterGroupKey; titleKey: 'sheet.category' | 'sheet.bodyPart' | 'sheet.equipment' }[] = [
  { key: 'bodyPart', titleKey: 'sheet.bodyPart' },
  { key: 'equipment', titleKey: 'sheet.equipment' },
  { key: 'category', titleKey: 'sheet.category' },
];

function filterOptions(key: FilterGroupKey): string[] {
  if (key === 'bodyPart') return BODY_PART_FILTERS;
  if (key === 'equipment') return equipmentOptions;
  return categoryOptions;
}

interface PickerFiltersProps {
  filters: ExercisePickerFilters;
  language: AppLanguage;
  onChange: (next: ExercisePickerFilters) => void;
}

/**
 * The three groups as one row of chips, each opening its own options under it
 * (menu redesign, 2026-10-24). Three rows of chips took a third of the sheet
 * before the first lift. A chip says its group until a value is picked, then
 * the value — so a group chosen before the sheet opened (Swap preselects the
 * lift's body part) reads as that value straight away.
 */
function PickerFilters({ filters, language, onChange }: PickerFiltersProps) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<FilterGroupKey | null>(null);
  const rowRef = useRef<ScrollView>(null);
  const revealed = useRef(false);
  // The picked value can sit past the right edge; bring it into view once.
  const revealActive = (x: number) => {
    if (revealed.current) return;
    revealed.current = true;
    if (x > 0) rowRef.current?.scrollTo({ x: Math.max(0, x - spacing.md), animated: false });
  };

  return (
    <View style={styles.filters}>
      <View style={styles.filterRow}>
        {FILTER_GROUPS.map((group) => {
          const value = filters[group.key];
          const picked = value !== 'all';
          const title = t(language, group.titleKey);
          const label = picked ? exercisePickerChipLabel(value, language) : title;
          return (
            <SheetChip
              key={group.key}
              label={label}
              accessibilityLabel={picked ? `${title}: ${label}` : title}
              selected={picked}
              caret
              expanded={open === group.key}
              onPress={() => {
                revealed.current = false;
                setOpen(open === group.key ? null : group.key);
              }}
            />
          );
        })}
      </View>
      {open ? (
        <ScrollView
          // A new group starts at its first option, not at the last group's offset.
          key={open}
          ref={rowRef}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipScrollRow}
        >
          {filterOptions(open).map((option) => {
            const active = option === filters[open];
            return (
              <SheetChip
                key={option}
                label={exercisePickerChipLabel(option as ExercisePickerFilters[typeof open], language)}
                selected={active}
                onLayout={active ? revealActive : undefined}
                onPress={() => {
                  onChange({ ...filters, [open]: option });
                  setOpen(null);
                }}
              />
            );
          })}
        </ScrollView>
      ) : null}
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

interface ExerciseRowProps {
  entry: ExercisePickerEntry;
  selected: boolean;
  multiSelect: boolean;
  actionLabel: string;
  language: AppLanguage;
  /** Where the row sits in its card: the first and last carry the card's corners, the rest a hairline above. */
  position: 'only' | 'first' | 'middle' | 'last';
  /**
   * The tap applies the pick at once — no bar asks after it (the guided
   * player's swap). The row then names the action instead of drawing a tick
   * that promises a choice still to be confirmed.
   */
  commitsOnTap: boolean;
  onPress: () => void;
}

/**
 * One lift: a 48 picture, the name, the library's line under it and one mark
 * at the end (menu redesign, 2026-10-24). The two-column picture cards fitted
 * two lifts to a screen and broke the long Finnish names mid-word
 * ("Kilpapenkkipunner-rus"); a row fits five and reads the name whole.
 *
 * The whole row is the one tap target. The mark only says what a tap does:
 * an orange + while adding several, otherwise a tick that fills when picked.
 */
function ExerciseRow({ entry, selected, multiSelect, actionLabel, language, position, commitsOnTap, onPress }: ExerciseRowProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { item, name } = entry;
  const previewImage = getExerciseImageSource(item?.imageKey);
  const shownName = exerciseNameLabel(language, name);
  const meta = item ? exercisePickerRowLabels(item, language).join(' · ') : null;
  const first = position === 'first' || position === 'only';
  const last = position === 'last' || position === 'only';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel} · ${shownName}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first && styles.rowFirst,
        last && styles.rowLast,
        !first && styles.rowDivided,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
    >
      {previewImage ? (
        <Image source={previewImage} style={styles.rowImage} resizeMode="cover" />
      ) : (
        <View style={[styles.rowImage, styles.rowImageFallback]}>
          <Text style={styles.rowImageFallbackText}>{exerciseInitials(exerciseNameLabel(language, name))}</Text>
        </View>
      )}
      <View style={styles.rowCopy}>
        {/* The list's short form ("KP"), read in full; on its syllables when it breaks. */}
        <Text
          style={styles.rowTitle}
          numberOfLines={2}
          accessibilityLabel={exerciseNameLabel(language, name)}
          android_hyphenationFrequency="normal"
        >
          {exerciseCardLabel(language, name)}
        </Text>
        {meta ? (
          <Text style={[styles.rowMeta, selected && styles.rowMetaSelected]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {multiSelect ? (
        <View style={[styles.rowAdd, selected && styles.rowAddOn]}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d={selected ? 'M5 13l4 4L19 7' : 'M12 5v14M5 12h14'}
              stroke={theme.onHighlight}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      ) : commitsOnTap ? (
        <View style={styles.rowAction}>
          <Text style={styles.rowActionText}>{actionLabel}</Text>
        </View>
      ) : (
        <View style={[styles.rowTick, selected && styles.rowTickOn]}>
          {selected ? (
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <Path d="M5 13l4 4L19 7" stroke={theme.onHighlight} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function rowPosition(index: number, count: number): ExerciseRowProps['position'] {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

function SectionHead({ section }: { section: ExercisePickerSection }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <SectionLabel label={section.title} style={styles.sectionLabel} />
      {section.subtitle ? <Text style={styles.sectionSubtitle}>{section.subtitle}</Text> : null}
    </View>
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
  /**
   * A tap applies the pick at once, with no bar asking after it (the guided
   * player's swap, a single add). Its rows name the action instead of drawing
   * a tick that promises a choice still to be confirmed. Said by the caller:
   * a sheet that asks after the pick has no pick yet when it opens, so
   * nothing the sheet holds tells the two apart.
   */
  commitsOnTap?: boolean;
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
  commitsOnTap = false,
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

  const featuredEntries = featured?.entries ?? [];

  const listHeader = (
    <>
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Circle cx={11} cy={11} r={6.5} stroke={theme.faint} strokeWidth={2.2} />
            <Path d="M16 16l4.5 4.5" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" />
          </Svg>
          <TextInput
            ref={searchRef}
            value={search}
            onChangeText={onSearchChange}
            placeholder={copy.searchPlaceholder}
            placeholderTextColor={theme.faint}
            accessibilityLabel={copy.searchPlaceholder}
            style={styles.searchInput}
            maxFontSizeMultiplier={TEXT_SCALE_CAP}
            selectionColor={theme.purple}
            autoCorrect={false}
            multiline={false}
            returnKeyType="search"
          />
        </View>
        {search.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => onSearchChange('')} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>{t(language, 'sheet.clear')}</Text>
          </Pressable>
        ) : null}
      </View>

      {quickBodyPartOnly ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipScrollRow}
        >
          {BODY_PART_FILTERS.map((option) => (
            <SheetChip
              key={option}
              label={exercisePickerChipLabel(option, language)}
              accessibilityLabel={`${t(language, 'sheet.bodyPart')}: ${exercisePickerChipLabel(option, language)}`}
              selected={option === filters.bodyPart}
              onPress={() => onFiltersChange({ ...filters, bodyPart: option })}
            />
          ))}
        </ScrollView>
      ) : (
        <PickerFilters filters={filters} language={language} onChange={onFiltersChange} />
      )}

      {featured && featuredEntries.length > 0 ? (
        <View style={styles.section}>
          <SectionHead section={featured} />
          <View>
            {featuredEntries.map((entry, index) => (
              <ExerciseRow
                key={entry.key}
                entry={entry}
                position={rowPosition(index, featuredEntries.length)}
                selected={isSelected(entry)}
                multiSelect={multiSelect}
                commitsOnTap={commitsOnTap}
                actionLabel={cardAction}
                language={language}
                onPress={() => onSelect(entry)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.section, styles.sectionMain]}>
        <SectionHead section={main} />
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* iOS does not lift a Modal's content for the keyboard: the search's
          keyboard covered the lower half of the list and the "Add N" bar
          (iOS hunt 2026-10-17, P1-4). The sheet's 92% is taken of what is left
          above the keys. A tap above the sheet with the keyboard up puts the
          keyboard away; closing would have dropped the picks. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (Keyboard.isVisible() ? Keyboard.dismiss() : onClose())}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <SheetHead
              title={sheetTitle}
              subtitle={sheetSubtitle}
              closeLabel={t(language, 'common.close')}
              onClose={onClose}
            />
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
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={8}
            keyboardShouldPersistTaps="handled"
            // A scroll through the cards is done searching: the keys go, and
            // the rest of the list and the bar come back.
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
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
            renderItem={({ item: entry, index }) => (
              <ExerciseRow
                entry={entry}
                position={rowPosition(index, main.entries.length)}
                selected={isSelected(entry)}
                multiSelect={multiSelect}
                commitsOnTap={commitsOnTap}
                actionLabel={cardAction}
                language={language}
                onPress={() => onSelect(entry)}
              />
            )}
          />

          {footer}
        </View>
      </KeyboardAvoidingView>
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
      commitsOnTap={!multiSelect}
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
          ? { title: t(language, 'sheet.popular'), entries: featuredEntries }
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
   * The sheet stands on `surface`, its lists on `surfaceSoft`.
   *
   * It stood on `bg` once, because sheet and cards were both `surface` and
   * the cards had no edge ("tausta värikin näyttää oudolta", #bugs
   * 2026-08-26). Every sheet now shares the kit's ground (menu redesign,
   * 2026-10-24), and the list card lifts off it one shade lighter.
   */
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: theme.border,
    marginTop: 10,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    paddingBottom: 14,
  },
  // The list takes the space left over, rather than the space it wants.
  grid: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 14,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    // minHeight, not height: a fixed height clipped the text at iOS
    // accessibility font sizes. With no vertical padding and the text centred
    // the placeholder still sits mid-box (#bugs 2026-10-19). textAlignVertical
    // is Android's centring, the zero padding is iOS's.
    minHeight: 44,
    paddingVertical: 0,
    textAlignVertical: 'center',
    minWidth: 0,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  clearButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  filters: {
    marginBottom: 6,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Pulled back by the chips' slop so a 32 dp chip reaches 44 to the thumb
  // without the slop being clipped. On the scroll view, not its content
  // container: iOS counts a content container's own offset twice, so every
  // chip's top was cut (owner's #12, iOS hunt 2026-10-17).
  chipScroll: {
    marginTop: spacing.sm - SHEET_CHIP_SLOP.top,
    marginBottom: -SHEET_CHIP_SLOP.bottom,
    marginHorizontal: -spacing.lg,
  },
  chipScrollRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: SHEET_CHIP_SLOP.top,
  },
  section: {
    marginTop: 18,
    gap: spacing.sm,
  },
  sectionMain: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    gap: 2,
    paddingLeft: 4,
  },
  // The section's own gap spaces it from the rows; the label's padding would double it.
  sectionLabel: {
    paddingBottom: 0,
  },
  sectionSubtitle: {
    color: theme.faint,
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    backgroundColor: theme.surfaceSoft,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: theme.border,
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  // The hairline between rows is the row's own top edge, in the border colour.
  rowDivided: {
    borderTopWidth: 1,
  },
  rowSelected: {
    backgroundColor: theme.highlightSoft,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  rowImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.purpleLight,
  },
  rowImageFallbackText: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    color: theme.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  rowMeta: {
    color: theme.faint,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  rowMetaSelected: {
    color: theme.muted,
  },
  rowAdd: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Added: the same accent as the row's wash, the + turned to a tick (the
  // kit's rule: picked is accent, violet is state).
  rowAddOn: {
    backgroundColor: theme.highlight,
  },
  rowAction: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActionText: {
    color: theme.highlight,
    fontSize: 13,
    fontWeight: '800',
  },
  rowTick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    // A theme ink, not dark-only white: on the light row it was 1.03:1 and
    // the pick ring vanished.
    borderColor: theme.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTickOn: {
    backgroundColor: theme.highlight,
    borderColor: theme.highlight,
  },
  emptyCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
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
