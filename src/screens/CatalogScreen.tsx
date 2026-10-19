import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BackButton } from '../components/BackButton';

import { ProgramLadderRow, ProgramRowItem } from '../components/ProgramLadderRow';
import { I18nKey, t } from '../lib/i18n';
import {
  EMPTY_CATALOG_QUERY,
  filterProgramCatalog,
  isCatalogQueryEmpty,
  ProgramCatalogQuery,
} from '../lib/programCatalogFilter';
import { PROGRAM_CATEGORIES, ProgramCategoryKey } from '../lib/programCategories';
import { layout } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { WorkoutLevel } from '../features/workout/workoutTypes';
import { AppLanguage } from '../types/models';

/**
 * Every ready programme, narrowed three ways.
 *
 * The goal discs on the Programs tab are a taxonomy: nine doors, each opening
 * one fixed slice. They cannot answer "a four-day muscle programme I can start
 * as a beginner", because that question crosses two of them — and until this
 * screen the 57 ready programmes had no door on the new-programme sheet at
 * all. Level, goal and free text all narrow the same list here.
 */

export interface CatalogScreenItem extends ProgramRowItem {
  /** Every category the programme belongs to — several is normal. */
  categories: readonly ProgramCategoryKey[];
}

const LEVEL_CHIPS: Array<{ level: WorkoutLevel | null; key: I18nKey }> = [
  { level: null, key: 'programs.level.all' },
  { level: 'beginner', key: 'programs.level.beginner' },
  { level: 'intermediate', key: 'programs.level.intermediate' },
  { level: 'advanced', key: 'programs.level.advanced' },
];

function ChevronLeftIcon({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11 4a7 7 0 100 14 7 7 0 000-14zm5 12l4 4"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    // The white-label violet under a picked chip's white text, and a slop
    // that takes the 34-tall chip to 44 inside a row padded for it
    // (accessibility audit, 2026-09-21).
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={onPress}
      style={[styles.chip, on && { backgroundColor: theme.purpleFill, borderColor: theme.purpleFill }]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

interface CatalogScreenProps {
  items: CatalogScreenItem[];
  language?: AppLanguage;
  onBack: () => void;
  onOpenProgram: (programId: string) => void;
}

export function CatalogScreen({
  items,
  language = 'en',
  onBack,
  onOpenProgram,
}: CatalogScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState<ProgramCatalogQuery>(EMPTY_CATALOG_QUERY);

  const shown = useMemo(() => filterProgramCatalog(items, query), [items, query]);
  const narrowed = !isCatalogQueryEmpty(query);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <BackButton onPress={onBack} accessibilityLabel={t(language, 'common.back')} />
        <Text style={styles.title}>{t(language, 'programCatalog.title')}</Text>
      </View>

      <View style={styles.searchField}>
        <SearchIcon color={theme.faint} />
        <TextInput
          value={query.search}
          onChangeText={(search) => setQuery((current) => ({ ...current, search }))}
          placeholder={t(language, 'programCatalog.searchPlaceholder', { count: items.length })}
          placeholderTextColor={theme.faint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t(language, 'programCatalog.searchPlaceholder', { count: items.length })}
        />
        {query.search.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'programCatalog.clearSearch')}
            onPress={() => setQuery((current) => ({ ...current, search: '' }))}
            hitSlop={10}
          >
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M6 6l12 12M18 6L6 18" stroke={theme.faint} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {LEVEL_CHIPS.map((entry) => (
          <Chip
            key={entry.key}
            label={t(language, entry.key)}
            on={query.level === entry.level}
            onPress={() => setQuery((current) => ({ ...current, level: entry.level }))}
          />
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          label={t(language, 'programCatalog.anyGoal')}
          on={query.goal === null}
          onPress={() => setQuery((current) => ({ ...current, goal: null }))}
        />
        {PROGRAM_CATEGORIES.map((category) => (
          <Chip
            key={category.key}
            label={t(language, category.labelKey)}
            on={query.goal === category.key}
            onPress={() => setQuery((current) => ({ ...current, goal: category.key }))}
          />
        ))}
      </ScrollView>

      <Text style={styles.count}>
        {narrowed
          ? t(language, 'programCatalog.countNarrowed', { shown: shown.length, total: items.length })
          : t(language, 'programCatalog.countAll', { total: items.length })}
      </Text>

      {/* Windowed, not all at once: every row draws an Svg with a gradient
          and a bar per training day, and a plain ScrollView would mount all 57
          and re-render them on each keystroke. keyboardShouldPersistTaps is
          what makes "type a search, tap the result" work — without it the
          first tap is spent closing the keyboard. */}
      <FlatList
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={shown}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item }) => (
          <ProgramLadderRow
            item={item}
            language={language}
            levelFilter={query.level}
            accessibilityLabel={t(language, 'programCatalog.openProgram', { name: item.name })}
            onPress={() => onOpenProgram(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t(language, 'programCatalog.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t(language, 'programCatalog.emptyBody')}</Text>
            {/* Clears the chips and leaves the search alone: the button
                names the filters, and a reader who typed "5x5" should not have
                to type it again to widen the level.
                
                Which is exactly why it must not draw when no chip is set. With
                both already null and the search alone emptying the list, the
                tap wrote the values they already held and nothing moved — a
                control that answers the empty state by doing nothing. The
                search has its own × elsewhere on the screen. */}
            {query.level !== null || query.goal !== null ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setQuery((current) => ({ ...current, level: null, goal: null }))}
                style={({ pressed }) => [styles.emptyButton, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.emptyButtonText}>{t(language, 'programCatalog.clearFilters')}</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    backButton: {
      width: 34,
      height: 34,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: theme.ink,
      fontSize: 20,
      lineHeight: 25,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      marginHorizontal: 20,
      marginTop: 14,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: theme.ink,
      fontSize: 14,
      fontWeight: '600',
      // Android's TextInput carries its own vertical padding, which makes the
      // field taller than the 44 it is styled to be.
      paddingVertical: 0,
    },
    // 5 of the 10 moved inside the row, and 5 given back below: the chips
    // sit where they did, and the row is tall enough that Android does not
    // clip their hitSlop to 34 (accessibility audit, 2026-09-21).
    chipScroll: {
      flexGrow: 0,
      marginTop: 5,
      marginBottom: -5,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 5,
    },
    chip: {
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: {
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: '800',
    },
    chipTextOn: {
      color: '#FFFFFF',
    },
    count: {
      color: theme.faint,
      fontSize: 11.5,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 1.1,
      paddingHorizontal: 20,
      marginTop: 16,
      marginBottom: 11,
    },
    scroll: {
      flex: 1,
    },
    rowGap: {
      height: 9,
    },
    content: {
      paddingHorizontal: 20,
      // This screen sits under the floating tab bar like the others.
      paddingBottom: layout.bottomTabBarReserve,
    },
    empty: {
      alignItems: 'flex-start',
      gap: 8,
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    emptyTitle: {
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    emptyBody: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    emptyButton: {
      marginTop: 4,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 12,
      backgroundColor: theme.highlight,
    },
    emptyButtonText: {
      color: theme.onHighlight,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
    },
  });
