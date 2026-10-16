import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { MEASUREMENT_LABEL_KEYS } from '../lib/homeStatCards';
import { t } from '../lib/i18n';
import { buildTrackChangeExampleCard } from '../lib/trackChangeExample';
import { StatCardPreview } from './HomeStatCardsSection';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage, MeasurementKind } from '../types/models';

/**
 * Three sites and a way to decline, which is four tiles in a two-by-two grid.
 *
 * Not a cap the reader has to be told about (user, 2026-09-10): the grid holds
 * four, so it offers four, and the sentence explaining a limit went with the
 * limit. Home shows these as cards in a row, and a fifth turns a glance into
 * a scroll.
 */
const SITE_TILES = 3;

/** The fallback, for a reader whose focus answers named nothing measurable. */
const ALL_SITES: MeasurementKind[] = [
  'shoulders',
  'chest',
  'back',
  'arms',
  'waist',
  'hips',
  'thighs',
  'calves',
  'bodyfat',
];

interface TrackChangeDialogProps {
  visible: boolean;
  language: AppLanguage;
  /** The sites already chosen. Empty means "No thanks" is the answer. */
  selected: MeasurementKind[];
  /** What the reader's own focus answers point at. Empty falls back to all of them. */
  offered: MeasurementKind[];
  onChange: (next: MeasurementKind[]) => void;
  onDone: () => void;
  /** Safe-area insets, read on the SCREEN — a Modal measures them as zero. */
  topInset?: number;
  bottomInset?: number;
  /** Window height, so the dialog scrolls on a short phone. */
  maxHeight?: number;
}

/**
 * "Track your measurements?"
 *
 * Four tiles in the shape ThemeChoiceDialog taught the reader on the way in:
 * a miniature, a label, a radio, one Done button and a line under it. The
 * difference is what the tiles are. The theme question had two answers and
 * exactly one could be true; this one has a decline and three sites, and any
 * number of the sites can be true at once.
 *
 * The sites are the reader's own: whatever their focus answers pointed at,
 * which is a shorter and better list than all nine — somebody who said "chest
 * and arms" is not looking for calves.
 */
export function TrackChangeDialog({
  visible,
  language,
  selected,
  offered,
  onChange,
  onDone,
  topInset = 0,
  bottomInset = 0,
  maxHeight,
}: TrackChangeDialogProps) {
  const styles = useThemedStyles(makeStyles);
  const sites = (offered.length > 0 ? offered : ALL_SITES).slice(0, SITE_TILES);

  // Built on first show, never stored.
  const example = useMemo(() => (visible ? buildTrackChangeExampleCard(language) : null), [visible, language]);

  const toggle = (kind: MeasurementKind) => {
    onChange(selected.includes(kind) ? selected.filter((entry) => entry !== kind) : [...selected, kind]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={[styles.overlay, { paddingTop: topInset + 16, paddingBottom: bottomInset + 16 }]}>
        <ScrollView
          style={[styles.dialogScroll, maxHeight ? { maxHeight: maxHeight - topInset - bottomInset - 32 } : null]}
          contentContainerStyle={styles.dialog}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t(language, 'trackChange.title')}</Text>

          {/* The real Home card with example numbers: one caption says so,
              one line says where it lands and what it does. */}
          {example ? (
            <View style={styles.example}>
              <Text style={styles.exampleCaption}>{t(language, 'trackChange.example')}</Text>
              <StatCardPreview card={example} language={language} />
              <Text style={styles.exampleNote}>{t(language, 'trackChange.exampleNote')}</Text>
            </View>
          ) : null}

          <View style={styles.grid}>
            {/* Declining is a tile like the others, not a link under them: it
                is one of the four answers, and the emptiest miniature says
                what it means without a sentence. */}
            <Tile
              label={t(language, 'trackChange.no')}
              cards={0}
              selected={selected.length === 0}
              onPress={() => onChange([])}
            />
            {sites.map((kind) => (
              <Tile
                key={kind}
                label={t(language, MEASUREMENT_LABEL_KEYS[kind])}
                cards={1}
                selected={selected.includes(kind)}
                onPress={() => toggle(kind)}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ctaText}>{t(language, 'themeChoice.done')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One tile: a miniature of Home with or without a card on it. */
function Tile({
  label,
  cards,
  selected,
  onPress,
}: {
  label: string;
  cards: number;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.tile, selected && styles.tileSelected]}
    >
      <View style={styles.preview}>
        <View style={styles.previewBar} />
        {Array.from({ length: cards }, (_, index) => (
          <View key={index} style={styles.previewCard}>
            <View style={styles.previewLine} />
          </View>
        ))}
      </View>
      <View style={styles.tileFoot}>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
        {selected ? (
          <View style={styles.check}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 13l4 4L19 7"
                stroke="#FFFFFF"
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        ) : (
          <View style={styles.checkEmpty} />
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: 'rgba(6,4,14,0.62)',
    },
    dialogScroll: {
      flexGrow: 0,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 24,
    },
    example: {
      marginTop: 14,
      gap: 8,
    },
    exampleCaption: {
      color: theme.faint,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    exampleNote: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    dialog: {
      paddingVertical: 22,
      paddingHorizontal: 20,
    },
    title: {
      color: theme.ink,
      fontSize: 21,
      fontWeight: '800',
      letterSpacing: -0.6,
      lineHeight: 26,
    },
    /**
     * Two by two, by wrapping rather than by a column count: four tiles at
     * 48% each leave one gap between them and none at the edges, and the row
     * breaks itself.
     */
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 11,
      marginTop: 18,
    },
    tile: {
      width: '48%',
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      padding: 9,
    },
    tileSelected: {
      borderColor: theme.purple,
      backgroundColor: theme.purpleSoft,
    },
    preview: {
      height: 64,
      borderRadius: 10,
      padding: 8,
      gap: 6,
      overflow: 'hidden',
      backgroundColor: theme.bg,
    },
    previewBar: {
      height: 8,
      width: '46%',
      borderRadius: 999,
      backgroundColor: theme.purple,
    },
    previewCard: {
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingVertical: 7,
      paddingHorizontal: 7,
    },
    previewLine: {
      height: 4,
      width: '72%',
      borderRadius: 999,
      backgroundColor: theme.faint,
    },
    tileFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      paddingTop: 10,
      paddingHorizontal: 2,
    },
    tileLabel: {
      flex: 1,
      minWidth: 0,
      color: theme.ink,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.purple,
    },
    checkEmpty: {
      width: 22,
      height: 22,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    cta: {
      marginTop: 18,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      // The white-label violet (accessibility audit, 2026-09-21).
      backgroundColor: theme.purpleFill,
    },
    ctaText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '800',
    },
  });
