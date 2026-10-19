import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { CutSurface } from './CutSurface';
import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';

/**
 * The one segmented control.
 *
 * It lived inside ProgressScreen and its own comment claimed "every selector
 * in the app goes through this one component" — which was true of three of
 * them. RecordsScreen had a fourth, hand-built, with a different fill and a
 * different inner surface, so the Progress tab shipped two widgets that do the
 * same job and do not look alike. The brief calls that out by name: "Weight /
 * Reps / Volume is the same segmented control as the trend switch, so the tab
 * has one widget instead of three."
 *
 * Moved here rather than imported across screens, so the claim in the comment
 * is something a file can keep.
 *
 * Two things joined on 2026-09-09. Options may carry a glyph (an SVG path in
 * a 24-box) instead of a word, which is how the Progress tab's section tabs
 * came through here — they had a hand-built shell with a second cut surface
 * inside the selected tab, and on the phone its outline showed under the row
 * ("leikkaus on jotenkin outo"). And the dark theme's pill: dark inherited
 * light's tokens and made the selected option the dimmest thing in the row,
 * a fix the tabs had and the metric bar did not. Both have it now.
 */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  grow,
  showLabels,
  lockedKeys,
  onLockedPress,
}: {
  /** `icon` is an SVG path drawn in a 24-box; given, the label is its spoken name. */
  options: Array<{ key: T; label: string; icon?: string }>;
  value: T;
  onChange: (next: T) => void;
  grow?: boolean;
  /** Options with a glyph also print their label beside it. */
  showLabels?: boolean;
  /**
   * Options that exist but are not this reader's to pick.
   *
   * Shown with a lock rather than removed: hiding them would make the free
   * tier look like the whole product, and a reader who never learns the long
   * view exists cannot want it. Pressing one opens the Pro page instead of
   * selecting — it is not a broken control, it is a door.
   */
  lockedKeys?: readonly T[];
  onLockedPress?: () => void;
}) {
  const styles = useThemedStyles(makeSegStyles);
  const theme = useTheme();
  const dark = useThemeName() === 'dark';
  const activeInk = dark ? theme.purpleBright : theme.purpleDark;
  // Idle glyphs in ink on light: in muted the bar read as a pale band with
  // icons the reader could not make out (user 2026-09-02, device build; the
  // bot caught the regression when the tabs moved here, PR #89). Text options
  // stay muted — a bold word carries where a 2px stroke does not.
  const idleInk = dark ? theme.muted : theme.ink;

  return (
    // A3: the SHELL takes the cut, the selected option does not. The design's
    // nesting rule is "allowed when the inner element is clear of the corner",
    // and the selected pill is not clear of it: at 3px of padding the first
    // option's cut sat 3px inside the shell's own, drawing two parallel
    // diagonals, and once the selection moved the shell's diagonal was left
    // standing beside a square pill ("ääriviivat outoja", user 2026-09-07).
    // The shell is the selector; the pill is a highlight travelling inside it.
    // Every selector on the Progress tab goes through this one component, so
    // the shape lands on the metric switch, the trend range, the measure range
    // and the records kind at once.
    <CutSurface size="sm" fill={theme.surfaceSoft} style={[styles.seg, grow && styles.segGrow]}>
      {options.map((option) => {
        const locked = lockedKeys?.includes(option.key) ?? false;
        const active = !locked && option.key === value;
        const inner = (
          <>
            {locked ? (
              <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                <Rect x={5} y={11} width={14} height={9} rx={2.5} stroke={theme.faint} strokeWidth={2.4} />
                <Path
                  d="M8.5 11V8a3.5 3.5 0 017 0v3"
                  stroke={theme.faint}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </Svg>
            ) : null}
            {option.icon ? (
              <Svg width={showLabels ? 16 : 20} height={showLabels ? 16 : 20} viewBox="0 0 24 24" fill="none">
                <Path
                  d={option.icon}
                  stroke={locked ? theme.faint : active ? activeInk : idleInk}
                  strokeWidth={2.1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
            {!option.icon || showLabels ? (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit={Boolean(showLabels)}
                minimumFontScale={showLabels ? 0.7 : undefined}
                maxFontSizeMultiplier={showLabels ? 1.2 : undefined}
                style={[
                  styles.segText,
                  showLabels && styles.segTextLabelled,
                  active && styles.segTextActive,
                  active && dark && styles.segTextActiveDark,
                  locked && styles.segTextLocked,
                ]}
              >
                {option.label}
              </Text>
            ) : null}
          </>
        );

        return (
          <Pressable
            key={option.key}
            testID={`seg-${option.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: false }}
            accessibilityLabel={option.label}
            onPress={() => (locked ? onLockedPress?.() : onChange(option.key))}
            style={(grow || showLabels) && styles.segItemGrow}
          >
            <View style={[styles.segItem, showLabels && styles.segItemLabelled, active && styles.segItemActive, active && dark && styles.segItemActiveDark]}>
              {inner}
            </View>
          </Pressable>
        );
      })}
    </CutSurface>
  );
}

const makeSegStyles = (theme: Theme) => StyleSheet.create({
  seg: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
  },
  segGrow: {
    alignSelf: 'stretch',
  },
  segItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  // Labelled tabs stack the glyph above the word: side by side they needed
  // more than the ~48dp a tab gets at 360dp. minWidth 0 / flexShrink let the
  // word shrink to the tab instead of overflowing it.
  segItemLabelled: {
    flexDirection: 'column',
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 3,
    maxWidth: '100%',
    flexShrink: 1,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  segTextLabelled: {
    fontSize: 11,
    flexShrink: 1,
    minWidth: 0,
  },
  segItemGrow: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  segItemActive: {
    backgroundColor: theme.surface,
    // The chip cut's own radius (`CUT_BY_SIZE.chip`), so the highlight is the
    // same size of corner the shape family uses — just without the cut.
    borderRadius: 7,
    shadowColor: '#5028A0',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 2,
  },
  // Dark: `surface` sits a shade off the shell's own `surfaceSoft`, so the
  // selected option read as the dimmest thing in the row. The violet wash
  // and the bright ink are what the section tabs had already tuned on a device.
  segItemActiveDark: {
    backgroundColor: theme.purpleLight,
  },
  segTextLocked: {
    color: theme.faint,
  },
  segText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  segTextActive: {
    color: theme.purpleDark,
  },
  segTextActiveDark: {
    color: theme.purpleBright,
  },
});
