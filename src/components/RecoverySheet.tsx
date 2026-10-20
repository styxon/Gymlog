import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import type { RecoveryAction, RecoveryActionKind, RecoverySheetModel, RecoveryTone } from '../lib/recoverySheet';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { ProLockedCard } from './ProLockedCard';
import { KitSheet } from './sheetKit';

const MONO = 'JetBrainsMono';

interface RecoverySheetProps {
  visible: boolean;
  model: RecoverySheetModel;
  language: AppLanguage;
  /** Read on the screen: inside the kit's Modal the inset measures zero. */
  bottomInset: number;
  onClose: () => void;
  /** Lighten / rest. The sheet closes; the caller confirms once it is saved. */
  onAction: (kind: RecoveryActionKind) => void;
  onUndo: (kind: 'lighten' | 'restTomorrow') => void;
  onOpenPremium: () => void;
}

/** The three tones in theme tokens, so the sheet follows the dark theme too. */
function toneColours(theme: Theme, tone: RecoveryTone) {
  if (tone === 'red') {
    return { dot: theme.danger, soft: theme.dangerSoft, ink: theme.danger };
  }
  if (tone === 'amber') {
    return { dot: theme.amber, soft: theme.amberSoft, ink: theme.amberInk };
  }
  return { dot: theme.green, soft: theme.greenSoft, ink: theme.greenInk };
}

/** Kevyt 0.5–0.8 · Tasapainossa 0.8–1.3 · Koholla 1.3–1.5 · Ylikuorma 1.5–2.0. */
const ZONE_FLEX = [3, 5, 2, 5] as const;
const ZONE_KEYS = ['recovery.zone.light', 'recovery.zone.balanced', 'recovery.zone.elevated', 'recovery.zone.over'] as const;

/**
 * Behind the recovery row on Progress (design: GAINER Palautuminen Sheet,
 * 2026-09-26): what the load is, against what, and what to do.
 *
 * On the sheet kit, like every other sheet in the app — its ✕, its scrim, its
 * back key. The design's black primary button is this app's action colour:
 * filled `highlight` is "do the thing", and violet or ink as a fill would be
 * brand or text (user, 2026-09-26: "jotkut buttonin värit oli vääriä").
 */
export function RecoverySheet({
  visible,
  model,
  language,
  bottomInset,
  onClose,
  onAction,
  onUndo,
  onOpenPremium,
}: RecoverySheetProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tone = toneColours(theme, model.tone);
  const zoneFills = [theme.surfaceSoft, theme.greenSoft, theme.amberSoft, theme.dangerSoft];

  const press = (action: RecoveryAction) => {
    onClose();
    if (action.kind !== 'close') {
      onAction(action.kind);
    }
  };

  return (
    <KitSheet
      visible={visible}
      onClose={onClose}
      title={t(language, 'pro.read.recovery')}
      bottomInset={bottomInset}
      closeLabel={t(language, 'common.close')}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <Text style={[styles.status, { color: tone.ink }]}>{model.status}</Text>
          {model.score !== null ? (
            <View style={[styles.scorePill, { backgroundColor: tone.soft }]}>
              <Text style={[styles.scoreText, { color: tone.ink }]}>{model.score}/100</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.lead}>{model.lead}</Text>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.eyebrow}>{t(language, 'recovery.card.title')}</Text>
            {model.acwrLabel !== null ? (
              <Text style={styles.acwr}>{t(language, 'recovery.card.acwr', { value: model.acwrLabel })}</Text>
            ) : null}
          </View>

          <View style={styles.zoneWrap}>
            {model.markerPercent !== null ? (
              <View style={[styles.marker, { left: `${model.markerPercent}%` }]} pointerEvents="none">
                <View style={[styles.markerPill, { backgroundColor: tone.dot }]}>
                  <Text style={styles.markerText}>{t(language, 'recovery.you')}</Text>
                </View>
                <View style={[styles.markerStem, { backgroundColor: tone.dot }]} />
              </View>
            ) : null}
            <View style={styles.zoneBar}>
              {ZONE_FLEX.map((flex, index) => (
                <View key={index} style={[styles.zone, { flex, backgroundColor: zoneFills[index] }]} />
              ))}
            </View>
          </View>
          <View style={styles.zoneLabels}>
            {ZONE_FLEX.map((flex, index) => (
              <Text
                key={index}
                style={[styles.zoneLabel, { flex }, index === ZONE_FLEX.length - 1 && styles.zoneLabelEnd]}
                numberOfLines={1}
              >
                {t(language, ZONE_KEYS[index])}
              </Text>
            ))}
          </View>

          <View style={styles.figures}>
            <View style={styles.figure}>
              <Text style={styles.figureLabel}>{t(language, 'recovery.thisWeek')}</Text>
              <Text style={styles.figureValue}>{model.acuteLabel}</Text>
            </View>
            <View style={styles.figure}>
              <Text style={styles.figureLabel}>{t(language, 'recovery.usualWeek')}</Text>
              <Text style={styles.figureValue}>{model.chronicLabel}</Text>
            </View>
          </View>

          <View style={styles.week}>
            {model.week.map((day) => (
              <View
                key={day.dayStart}
                style={styles.weekDay}
                accessible
                accessibilityLabel={
                  day.trained ? `${day.label}, ${t(language, 'recovery.a11y.trained')}` : day.label
                }
              >
                <View
                  style={[
                    styles.weekTile,
                    day.trained && { backgroundColor: tone.dot },
                    day.today && styles.weekTileToday,
                  ]}
                />
                <Text style={[styles.weekLabel, day.today && styles.weekLabelToday]}>{day.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {model.locked ? (
          // The finding is free; what to do about it is Pro's — the same line
          // the row itself has always drawn.
          <View style={styles.lock}>
            <ProLockedCard
              language={language}
              compact
              teaser={t(language, 'pro.read.lockedTeaser')}
              body={model.todos.join(' · ')}
              cta={t(language, 'pro.read.lockedCta')}
              onPress={() => {
                onClose();
                onOpenPremium();
              }}
            />
          </View>
        ) : (
          <>
            <View style={styles.todo}>
              <Text style={styles.eyebrow}>{t(language, 'recovery.todoTitle')}</Text>
              {model.todos.map((line, index) => (
                <View key={line} style={styles.todoRow}>
                  <View style={[styles.todoBadge, { backgroundColor: tone.soft }]}>
                    <Text style={[styles.todoBadgeText, { color: tone.ink }]}>{index + 1}</Text>
                  </View>
                  <Text style={styles.todoText}>{line}</Text>
                </View>
              ))}
            </View>

            {/* What has already been done, and the way back from it. */}
            {model.lightenQueued ? (
              <DoneLine
                styles={styles}
                text={t(language, 'recovery.done.lighten')}
                undo={t(language, 'recovery.undo')}
                onUndo={() => onUndo('lighten')}
              />
            ) : null}
            {model.restTomorrowMarked ? (
              <DoneLine
                styles={styles}
                text={t(language, 'recovery.done.rest')}
                undo={t(language, 'recovery.undo')}
                onUndo={() => onUndo('restTomorrow')}
              />
            ) : null}

            <View style={styles.ctas}>
              <Pressable
                accessibilityRole="button"
                onPress={() => press(model.primary)}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{model.primary.label}</Text>
              </Pressable>
              {model.secondary ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => press(model.secondary as RecoveryAction)}
                  style={({ pressed }) => [
                    // An action is outlined in the action colour; a way out
                    // ("keep the plan") is plain text, as a dismiss is.
                    model.secondary?.kind === 'close' ? styles.ghost : styles.secondary,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={model.secondary.kind === 'close' ? styles.ghostText : styles.secondaryText}>
                    {model.secondary.label}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </KitSheet>
  );
}

function DoneLine({
  styles,
  text,
  undo,
  onUndo,
}: {
  styles: ReturnType<typeof makeStyles>;
  text: string;
  undo: string;
  onUndo: () => void;
}) {
  return (
    <View style={styles.done}>
      <Text style={styles.doneText}>{text}</Text>
      <Pressable accessibilityRole="button" onPress={onUndo} hitSlop={10}>
        <Text style={styles.undoText}>{undo}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    // Shrinks to the kit sheet's 86 % cap and scrolls inside it. Without the
    // shrink it took its content's height and the buttons fell off the
    // bottom of a short phone.
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { paddingHorizontal: 18, paddingBottom: 6 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    status: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
    scorePill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 },
    scoreText: { fontFamily: MONO, fontSize: 13, fontWeight: '700' },
    lead: { color: theme.muted, fontSize: 14.5, lineHeight: 21, fontWeight: '600', marginTop: 6 },
    card: {
      marginTop: 16,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    eyebrow: {
      fontFamily: MONO,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: theme.faint,
    },
    acwr: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: theme.muted },
    // Room above the bar for the marker, which is drawn over it.
    zoneWrap: { marginTop: 10, paddingTop: 30 },
    zoneBar: { flexDirection: 'row', gap: 3, height: 10 },
    zone: { borderRadius: 3 },
    marker: {
      position: 'absolute',
      top: 0,
      width: 56,
      // Centred on its point: half its own width back.
      marginLeft: -28,
      alignItems: 'center',
      zIndex: 2,
    },
    markerPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    // The surface colour, not white: white on the light theme's tones, and
    // the dark surface on the dark theme's bright ones, where white is ~2:1.
    markerText: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: theme.surface },
    markerStem: { width: 2, height: 16, borderRadius: 2, marginTop: 1 },
    zoneLabels: { flexDirection: 'row', gap: 3, marginTop: 6 },
    zoneLabel: { fontSize: 10.5, fontWeight: '700', color: theme.faint },
    zoneLabelEnd: { textAlign: 'right' },
    figures: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    figure: { flex: 1 },
    figureLabel: { fontSize: 11.5, fontWeight: '700', color: theme.faint },
    figureValue: { fontSize: 17, fontWeight: '800', color: theme.ink, letterSpacing: -0.2, marginTop: 2 },
    week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
    weekDay: { alignItems: 'center', gap: 5 },
    weekTile: { width: 30, height: 30, borderRadius: 10, backgroundColor: theme.surfaceSoft },
    weekTileToday: { borderWidth: 2, borderColor: theme.ink },
    weekLabel: { fontSize: 11, fontWeight: '700', color: theme.faint },
    weekLabelToday: { color: theme.ink },
    lock: { marginTop: 16 },
    todo: { marginTop: 16, gap: 9 },
    todoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    todoBadge: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    todoBadgeText: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },
    todoText: { flex: 1, color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    done: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: theme.surfaceSoft,
    },
    doneText: { flex: 1, color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    undoText: { color: theme.highlight, fontSize: 13, fontWeight: '800' },
    ctas: { marginTop: 18, gap: 8 },
    primary: {
      minHeight: 52,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.highlight,
    },
    primaryText: { color: theme.onHighlight, fontSize: 15.5, fontWeight: '800' },
    secondary: {
      minHeight: 48,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: theme.highlight,
    },
    secondaryText: { color: theme.highlight, fontSize: 15, fontWeight: '800' },
    ghost: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: theme.muted, fontSize: 15, fontWeight: '800' },
    pressed: { opacity: 0.85 },
  });
