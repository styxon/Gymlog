import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './AppText';
import Svg, { Path, Circle } from 'react-native-svg';

import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * The sheet kit (design: "GAINER · Sheets & Pickers").
 *
 * Every picker in the app is built from these parts, in this order: grip,
 * title plus what it acts on, search when the pool is longer than the
 * shortlist, a grouped list of rows — and nothing else. The commit bar only
 * exists after a pick. Before this kit each sheet restated its own values,
 * which is how the today-picker, the swap sheet and the dose sheet drifted
 * into three different dialects of the same conversation ("yritän nyt kaikki
 * valikot saada samanlaisiksi", 2026-08-30).
 *
 * The rules the kit enforces by shape rather than by review:
 *
 * - One tap target per row. The pen (rename) is the single allowed second
 *   target, and it says nothing else.
 * - The scope question — this time or for ever — is asked once, in the bar,
 *   after there is something to answer it about. Never per row.
 * - The bar reserves its own space: the list shrinks, nothing is covered.
 * - A picked row can be unpicked, and the bar goes back down with it.
 * - Colour: the accent is "this time only, and anything pressable"; danger is
 *   "permanent or destructive"; violet is state and structure, never an
 *   action. A TODAY tag is violet because it is a fact, not a choice.
 */

/** Space the sheet reserves under the list while the commit bar is up. */
export const KIT_BAR_SPACE = 174;

const MONO = 'JetBrainsMono';

interface KitSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The action, e.g. "Swap this lift". Optional: a sheet whose title only
   * repeats the row that opened it is a line the reader has already read
   * (#bugs 2026-09-05). Without one the head row keeps its close button.
   */
  title?: string;
  /** What it acts on — mono, uppercase: "Back Squat · 4 × 5". */
  context?: string | null;
  /** A sentence of instruction, when the list needs one. Excludes `context`. */
  description?: string | null;
  /** Safe-area (or keyboard) inset, read on the screen — 0 inside a Modal. */
  bottomInset: number;
  /**
   * What the ✕ says to a screen reader — t(language, 'common.close') at every
   * call site. Required, because a close button with no name is announced as
   * just "button" (accessibility audit, 2026-09-21).
   */
  closeLabel: string;
  /** True while the commit bar is up, so the list shrinks to make room. */
  barUp?: boolean;
  reduceMotion?: boolean | null;
  children: React.ReactNode;
  /** The commit bar, rendered over the sheet's reserved space. */
  bar?: React.ReactNode;
  /** The Modal's onDismiss, for useModalHandoff (iOS only; see TrackChangeDialog). */
  onDismissed?: () => void;
}

export function KitSheet({
  visible,
  onClose,
  title,
  context = null,
  description = null,
  bottomInset,
  closeLabel,
  barUp = false,
  reduceMotion = false,
  children,
  bar = null,
  onDismissed,
}: KitSheetProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <View style={styles.overlay}>
        {/* Out of the accessibility tree: the ✕ below is the same action with
            a name, and this was a second, nameless "button" covering the
            screen (accessibility audit, 2026-09-21). */}
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: (barUp ? KIT_BAR_SPACE : 26) + bottomInset },
          ]}
        >
          <View style={styles.grip} />
          <View style={styles.head}>
            <View style={styles.headText}>
              {title ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {context ? <Text style={styles.context}>{context.toUpperCase()}</Text> : null}
              {!context && description ? <Text style={styles.desc}>{description}</Text> : null}
            </View>
            <SheetCloseButton label={closeLabel} onPress={onClose} />
          </View>
          {children}
        </View>
        {bar}
      </View>
    </Modal>
  );
}

/**
 * The one way out of every sheet: a round 40 px ✕, top right (owner-approved
 * menu redesign, 2026-10-24). Before it the new-programme sheet had a round ✕,
 * the exercise pickers a "Sulje" text button and the exercise sheet none.
 */
export function SheetCloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      testID="sheet-close"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.x, pressed && styles.pressed]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path d="M6 6l12 12M18 6L6 18" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    </Pressable>
  );
}

interface SheetHeadProps {
  title: string;
  /** What the sheet acts on, or one line of instruction: muted, 13. */
  subtitle?: string | null;
  closeLabel: string;
  onClose: () => void;
  /** Before the title: a back button, for a sheet with a second view. */
  leading?: React.ReactNode;
}

/**
 * Every sheet's head: the title left at 22/800, a muted line under it, the ✕
 * right. Not centred — a centred title over a left-aligned list was the
 * new-programme sheet's own dialect.
 */
export function SheetHead({ title, subtitle = null, closeLabel, onClose, leading = null }: SheetHeadProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sheetHead}>
      {leading}
      <View style={styles.headText}>
        <Text style={styles.sheetTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
      </View>
      <SheetCloseButton label={closeLabel} onPress={onClose} />
    </View>
  );
}

interface SheetChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** A chip that opens its group's options draws a caret. */
  caret?: boolean;
  /** For a chip that opens a group: whether it is open. */
  expanded?: boolean;
  accessibilityLabel?: string;
  onLayout?: (x: number) => void;
}

/**
 * The one chip: 32 drawn, 44 to the thumb. Picked is violet — a filter is
 * state, not an action — and the rest are a hairline. Before it the add sheet
 * filled its picked chip and the swap sheet outlined it.
 */
export function SheetChip({ label, selected, onPress, caret = false, expanded, accessibilityLabel, onLayout }: SheetChipProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={expanded === undefined ? { selected } : { selected, expanded }}
      hitSlop={SHEET_CHIP_SLOP}
      onPress={onPress}
      onLayout={onLayout ? (event) => onLayout(event.nativeEvent.layout.x) : undefined}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, caret && styles.chipCaret, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
      {caret ? (
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path
            d={expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
            stroke={selected ? theme.ink : theme.muted}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </Pressable>
  );
}

/** 32 drawn + 6 above and below = 44 to the thumb. A row that scrolls pads itself by this, so the slop is not clipped. */
export const SHEET_CHIP_SLOP = { top: 6, bottom: 6 } as const;

/** A group's heading inside a sheet: 11/800, spaced capitals, muted. */
export function SheetSectionLabel({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

interface KitSearchProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}

export function KitSearch({ value, onChangeText, placeholder }: KitSearchProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.search}>
      <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
        <Circle cx={11} cy={11} r={6.5} stroke={theme.faint} strokeWidth={2.2} />
        <Path d="M16 16l4.5 4.5" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={styles.searchInput}
      />
    </View>
  );
}

export function KitGroupLabel({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.glabel}>{children}</Text>;
}

interface KitRowProps {
  title: string;
  meta?: string | null;
  /** cur = already in force (violet, state); sel = picked (accent). */
  state?: 'idle' | 'cur' | 'sel';
  /** Violet capsule beside the name — a fact like TODAY, never a button. */
  tag?: string | null;
  onPress: () => void;
  /** The one allowed second target: rename. */
  onPen?: (() => void) | null;
  penLabel?: string;
  accessibilityLabel?: string;
  /**
   * Lines before the title ends in an ellipsis. Exercise rows pass 2: a long
   * Finnish name is read whole (#bugs 2026-09-27); other rows keep one.
   */
  titleLines?: number;
  /**
   * The meta line's face. 'mono' is the kit's own (JetBrains Mono, a spec
   * line like "4 × 5 · barbell"); 'app' is the app's text face, for a meta
   * line that is a sentence-like count ("5 liikettä · 16 sarjaa") and sits
   * among rows elsewhere in the app that are not mono.
   */
  metaFont?: 'mono' | 'app';
}

export function KitRow({
  title,
  meta = null,
  metaFont = 'mono',
  state = 'idle',
  tag = null,
  onPress,
  onPen = null,
  penLabel,
  accessibilityLabel,
  titleLines = 1,
}: KitRowProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const sel = state === 'sel';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: sel }}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        state === 'cur' && styles.rowCur,
        sel && styles.rowSel,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowBody}>
        {/* The tag sits on the name's line, not beside the whole body: as a
            sibling of the body it took its width from the meta line below the
            name, and "5 liikettä · 16 sarjaa" wrapped to two lines under a
            TÄNÄÄN chip. */}
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowName, styles.rowNameFill]} numberOfLines={titleLines}>
            {title}
          </Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        {meta ? (
          <Text style={metaFont === 'app' ? styles.rowMetaApp : styles.rowMeta}>{meta}</Text>
        ) : null}
      </View>
      {onPen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={penLabel}
          hitSlop={8}
          onPress={onPen}
          style={({ pressed }) => [styles.pen, pressed && styles.pressed]}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
              stroke={theme.purpleBright}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      ) : null}
      <View style={[styles.tick, sel && styles.tickOn]}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 13l4 4L19 7"
            stroke={sel ? theme.onHighlight : 'transparent'}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
}

export interface KitBarButton {
  label: string;
  /** p = accent (this time / plain confirm), d = danger (for ever), g = ghost. */
  kind: 'p' | 'd' | 'g';
  onPress: () => void;
}

interface KitBarProps {
  visible: boolean;
  /** The whole edit on one line: from → to. Mono, uppercase. */
  from: string;
  to: string;
  /**
   * What a screen reader says for from/to when the line shows a short form
   * (KP, KK) — the full name, not the letters (review, 2026-09-27).
   */
  fromLabel?: string;
  toLabel?: string;
  buttons: KitBarButton[];
  /**
   * The bar's secondary way out. Optional as a pair: a bar whose "cancel" says
   * only what closing the sheet already does is a line of noise — "Pidä
   * Pakaralopetus" under a picker whose whole purpose is to pick something
   * else (#bugs 2026-09-05). Omit both to render no clear at all.
   */
  clearLabel?: string;
  onClear?: () => void;
  bottomInset: number;
  reduceMotion?: boolean | null;
  /**
   * False renders the bar in flow instead of over the sheet — for sheets that
   * manage their own column (a FlatList that must keep its footer on screen)
   * and only need the bar's language, not its overlay.
   */
  floating?: boolean;
}

export function KitBar({
  visible,
  from,
  to,
  fromLabel,
  toLabel,
  buttons,
  clearLabel,
  onClear,
  bottomInset,
  reduceMotion = false,
  floating = true,
}: KitBarProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      rise.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(rise, {
      toValue: visible ? 1 : 0,
      duration: 320,
      easing: Easing.bezier(0.3, 1.02, 0.4, 1),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, rise, visible]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [KIT_BAR_SPACE + bottomInset + 40, 0] });

  // In flow the bar has no reserved space to slide out of: it appears when
  // there is something to commit and takes its room, exactly like the sheet's
  // own picked-state padding would have.
  if (!floating && !visible) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.bar,
        floating
          ? { paddingBottom: 30 + bottomInset, transform: [{ translateY }] }
          : [styles.barInFlow, { paddingBottom: 16 + bottomInset }],
      ]}
    >
      <View style={styles.swapline}>
        <Text style={styles.swapFrom} numberOfLines={1} accessibilityLabel={fromLabel ?? from}>
          {from.toUpperCase()}
        </Text>
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12h13M13 7l5 5-5 5"
            stroke={theme.faint}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text style={styles.swapTo} numberOfLines={1} accessibilityLabel={toLabel ?? to}>
          {to.toUpperCase()}
        </Text>
      </View>
      <View style={styles.btns}>
        {buttons.map((button) => (
          <Pressable
            key={button.label}
            accessibilityRole="button"
            onPress={button.onPress}
            style={({ pressed }) => [
              styles.btn,
              button.kind === 'p' && styles.btnP,
              button.kind === 'd' && styles.btnD,
              button.kind === 'g' && styles.btnG,
              pressed && styles.btnPressed,
            ]}
          >
            <Text
              style={[
                styles.btnText,
                button.kind === 'p' && styles.btnTextP,
                button.kind === 'd' && styles.btnTextD,
                button.kind === 'g' && styles.btnTextG,
              ]}
            >
              {button.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {clearLabel && onClear ? (
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8}>
          <Text style={styles.barClear}>{clearLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 4, 16, 0.72)' },
    pressed: { opacity: 0.85 },
    sheet: {
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderColor: theme.border,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingTop: 9,
      // Sheets never take the whole screen: what they act on stays visible.
      maxHeight: '86%',
    },
    grip: {
      width: 38,
      height: 4,
      borderRadius: 99,
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignSelf: 'center',
      marginBottom: 12,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 18,
      marginBottom: 14,
    },
    headText: { flex: 1, minWidth: 0 },
    title: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: -0.4,
      color: theme.ink,
      lineHeight: 27,
    },
    context: {
      fontFamily: MONO,
      fontSize: 11.5,
      fontWeight: '700',
      color: theme.faint,
      letterSpacing: 0.7,
      marginTop: 5,
    },
    desc: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.muted,
      lineHeight: 19,
      marginTop: 8,
      maxWidth: 280,
    },
    x: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    sheetTitle: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: -0.4,
      lineHeight: 27,
      color: theme.ink,
    },
    sheetSubtitle: {
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
      color: theme.muted,
      marginTop: 4,
    },
    chip: {
      height: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chipOn: {
      backgroundColor: theme.purpleLight,
      borderColor: theme.purpleBright,
    },
    chipCaret: { paddingRight: 10 },
    chipText: { fontSize: 13, fontWeight: '700', color: theme.muted },
    chipTextOn: { color: theme.ink },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: theme.muted,
    },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 13,
      paddingHorizontal: 13,
      height: 44,
      marginHorizontal: 18,
      // The first row sat flush against the field whenever the list had no
      // group label to push it down (#bugs 2026-09-24, "turhan lähekkäin").
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      fontSize: 14.5,
      fontWeight: '600',
      color: theme.ink,
      paddingVertical: 0,
      minWidth: 0,
    },
    glabel: {
      fontFamily: MONO,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: theme.faint,
      marginTop: 16,
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: 'rgba(255,255,255,0.035)',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
    },
    rowCur: {
      backgroundColor: 'rgba(155,109,255,0.09)',
      borderColor: 'rgba(155,109,255,0.42)',
    },
    rowSel: {
      backgroundColor: theme.highlightSoft,
      borderColor: theme.highlight,
    },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { fontSize: 15, fontWeight: '700', color: theme.ink, letterSpacing: -0.15 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowNameFill: { flexShrink: 1 },
    rowMeta: {
      fontFamily: MONO,
      fontSize: 11.5,
      fontWeight: '500',
      color: theme.muted,
      marginTop: 4,
    },
    // No fontFamily: the app's default face (AppText), like the meta lines
    // on the programme rows.
    rowMetaApp: {
      fontSize: 12.5,
      fontWeight: '600',
      color: theme.muted,
      marginTop: 4,
    },
    tag: {
      borderWidth: 1,
      borderColor: 'rgba(155,109,255,0.4)',
      borderRadius: 99,
      paddingVertical: 5,
      paddingHorizontal: 9,
    },
    tagText: {
      fontFamily: MONO,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: theme.purpleBright,
    },
    pen: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tick: {
      width: 22,
      height: 22,
      borderRadius: 99,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tickOn: { backgroundColor: theme.highlight, borderColor: theme.highlight },
    barInFlow: {
      position: 'relative',
      marginHorizontal: -18,
      marginBottom: -0,
    },
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.surfaceSoft,
      borderTopWidth: 1,
      borderColor: theme.highlightSoft,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 15,
      paddingHorizontal: 18,
      shadowColor: theme.shadow,
      shadowOpacity: 0.5,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -8 },
      elevation: 16,
    },
    swapline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
      marginBottom: 15,
    },
    swapFrom: {
      flex: 1,
      fontFamily: MONO,
      fontSize: 13.5,
      fontWeight: '700',
      letterSpacing: 0.3,
      color: theme.faint,
    },
    swapTo: {
      flex: 1,
      fontFamily: MONO,
      fontSize: 13.5,
      fontWeight: '700',
      letterSpacing: 0.3,
      color: theme.highlight,
      textAlign: 'right',
    },
    btns: { flexDirection: 'row', gap: 9 },
    btn: {
      flex: 1,
      borderRadius: 15,
      paddingVertical: 15,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      alignItems: 'center',
    },
    btnPressed: { transform: [{ scale: 0.97 }] },
    btnP: { backgroundColor: theme.highlight },
    btnD: { backgroundColor: 'rgba(255,107,107,0.13)', borderColor: 'rgba(255,107,107,0.46)' },
    btnG: { backgroundColor: 'rgba(155,109,255,0.14)', borderColor: 'rgba(155,109,255,0.42)' },
    btnText: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.15 },
    btnTextP: { color: theme.onHighlight },
    btnTextD: { color: theme.danger },
    btnTextG: { color: theme.purpleBright },
    barClear: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.faint,
      textAlign: 'center',
      paddingTop: 12,
    },
  });
