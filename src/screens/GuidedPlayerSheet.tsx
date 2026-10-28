import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../components/AppText';
import { t } from '../lib/i18n';
import { sheetScrollMaxHeight } from '../lib/sheetScrollBound';
import { useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { GPIcon } from './GuidedPlayerMotion';
import { makeStyles } from './GuidedPlayerStyles';

/* ── bottom sheet ── */
/** How far down a released drag has to have gone to close the sheet. */
const SHEET_DISMISS_DRAG = 90;
/** …or how fast it was still moving down when let go. */
const SHEET_DISMISS_VELOCITY = 0.9;
/** The sheet's height cap (`sheetFrame`), as a share of the scrim. */
const SHEET_CAP_FRACTION = 0.78;

export function GPSheet({
  title,
  language,
  onClose,
  bottomInset,
  scrollable = false,
  visible = true,
  onDismissed,
  children,
}: {
  /**
   * For a sheet that hands off to another modal (hooks/useModalHandoff): kept
   * mounted and switched off here, because iOS reports a Modal's dismissal
   * only when `visible` turns false, never when it unmounts.
   */
  visible?: boolean;
  /** iOS only: the sheet has finished leaving the screen. */
  onDismissed?: () => void;
  /** Drawn in the grab zone beside the close button, so the title is a handle too. */
  title: string;
  /** For the close button's name. */
  language: AppLanguage;
  onClose: () => void;
  /**
   * Safe-area inset, read on the screen — see `screenInsets` below for why:
   * inside this Modal, `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
  /**
   * The children are a list that may be longer than the sheet: GPSheet
   * scrolls them itself, bounded by MEASURED space — the scrim it stands in,
   * its own head, its bottom padding with the inset (lib/sheetScrollBound).
   * The contents sheet's own bound was a guess from the window and lost its
   * last rows below the sheet on a nine-lift day (#bugs 2026-10-06).
   */
  scrollable?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { height: windowHeight } = useWindowDimensions();
  // Measured on layout; the window and the head's usual height stand in for
  // the first frame only.
  const [areaHeight, setAreaHeight] = useState<number | null>(null);
  const [headHeight, setHeadHeight] = useState<number | null>(null);
  const bottomPadding = bottomInset + 30;
  const listMaxHeight = sheetScrollMaxHeight({
    areaHeight: areaHeight ?? windowHeight,
    capFraction: SHEET_CAP_FRACTION,
    headHeight: headHeight ?? 81,
    bottomPadding,
  });
  // The sheet's own 30 was a guess at the phone's navigation bar, and on a
  // three-button handset the last row and the footnote sat behind it. Measured
  // rather than guessed — reported twice, on two different sheets.

  /*
   * Three ways out, as asked (#bugs 2026-09-30, "vaikea sulkea tätä valikkoa
   * joko klikkaamalla muualta sulkee alasvedettäessä tai ruksi"): a tap on
   * the dimmed page, the ✕ beside the title, and a pull down on the top of the
   * sheet — the grip, the title row, anywhere across that strip. The grip was
   * drawn and did nothing.
   *
   * The drag moves a transform, not a height, so nothing inside the sheet is
   * laid out again while the finger moves. The list below the title keeps its
   * own vertical scroll; only the top strip pulls.
   */
  const dragY = useRef(new Animated.Value(0)).current;
  // Through a ref: callers pass onClose inline, and the player re-renders
  // every second for its clock — a gesture rebuilt on each render loses the
  // drag it granted.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useMemo(() => {
    const settle = () =>
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > SHEET_DISMISS_DRAG || gesture.vy > SHEET_DISMISS_VELOCITY) {
          onCloseRef.current();
          return;
        }
        settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [dragY]);
  // A kept-mounted sheet closed by a pull would open again still pulled down.
  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
    }
  }, [visible, dragY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <View
        style={styles.sheetScrim}
        onLayout={(event) => setAreaHeight(Math.round(event.nativeEvent.layout.height))}
      >
        {/* The tap on the dimmed page, BESIDE the sheet rather than around it.
            The sheet sat inside this Pressable and was a Pressable itself, to
            swallow its own taps — and on Android the contents list inside two
            pressables did not scroll at all, whatever height it was given
            (#bugs 2026-10-08, "ei pysty vieläkään skrollaamaan", after two
            fixes to its height). The kit's sheets (components/sheetKit) are
            built this way, and their lists scroll. Out of the accessibility
            tree: the ✕ is the same action with a name. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        {/* The 78% cap lives on this wrapper, whose parent is the full-screen
            scrim: on the sheet inside it the percentage would resolve against
            a content-sized parent and quietly stop capping anything. */}
        <Animated.View
          style={[styles.sheetFrame, { transform: [{ translateY: dragY }] }]}
        >
          <View style={[styles.sheet, { paddingBottom: bottomPadding }]}>
            {/* Measured: the sheet's paddingTop and the grab's -12 margin
                cancel, so the grab's own height is the whole head. */}
            <View
              {...pan.panHandlers}
              style={styles.sheetGrab}
              onLayout={(event) => setHeadHeight(Math.round(event.nativeEvent.layout.height))}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitleText}>{title}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'common.close')}
                  hitSlop={10}
                  onPress={onClose}
                  style={styles.sheetClose}
                >
                  <GPIcon name="x" size={17} color={theme.muted} />
                </Pressable>
              </View>
            </View>
            {scrollable ? (
              <ScrollView
                style={[styles.sheetScroll, { maxHeight: listMaxHeight }]}
                contentContainerStyle={styles.sheetScrollContent}
                // Android hides the bar until a scroll starts, and a list
                // that does not look scrollable was reported as cut off.
                persistentScrollbar
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
