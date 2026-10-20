import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { CoachTickerRow } from '../lib/coachChat';
import { Theme, useThemedStyles } from '../theming';
import { queryReduceMotion } from '../utils/reduceMotion';

/**
 * Everything the coach says before the first question, one slide at a time
 * (design: "AI Chat hienosäätö", A — then widened 2026-08-23).
 *
 * It used to be a bordered card holding three readout rows, and later a
 * stack: this ticker, a "things I noticed" card, and the opening bubble —
 * three surfaces that together pushed the conversation off the screen. Now
 * one stage carries all of it: today's line, what the coach noticed, and the
 * readout, in that order. A slide with a question is tappable and says so;
 * a slide that is a fact from the log is just read out.
 *
 * Browsing and asking are separate gestures (user, 2026-08-23: one tap sent
 * the question and the slides were gone for good). A tap or a horizontal
 * swipe on the slide moves through the sequence and hands control to the
 * reader — the auto-rotation stops the moment they touch it. Only the
 * explicit "Ask about this" button sends anything.
 *
 * The rotation also stops the moment the first message is sent, because the
 * screen that owns it stops rendering this. Motion is a short fade every few
 * seconds rather than a continuous loop — an idle screen should not be
 * painting frames — and it holds still entirely under reduced motion.
 */
const HOLD_MS = 3400;
const MOVE_MS = 320;
const RISE = 9;

interface CoachReadoutTickerProps {
  rows: CoachTickerRow[];
  /** "Ask about this →" — shown under a slide that carries a question. */
  askLabel: string;
  onAsk: (question: string) => void;
}

export function CoachReadoutTicker({ rows, askLabel, onAsk }: CoachReadoutTickerProps) {
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(false);
  // Once the reader touches the slides, they drive; the clock stops.
  const [manual, setManual] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const rowCount = rows.length;

  const step = useCallback(
    (delta: number) => {
      if (rowCount < 2) {
        return;
      }
      const direction = delta >= 0 ? 1 : -1;
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: MOVE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(lift, { toValue: -RISE * direction, duration: MOVE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished) {
          return;
        }
        setIndex((current) => (current + delta + rowCount) % rowCount);
        lift.setValue(RISE * direction);
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: MOVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(lift, { toValue: 0, duration: MOVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      });
    },
    [fade, lift, rowCount],
  );

  // The responder is created once; it reaches the latest step() through a ref.
  const stepRef = useRef(step);
  stepRef.current = step;

  // Tap = next, swipe = the direction you swiped. A pan responder rather
  // than a Pressable so a horizontal drag is not read as a tap.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 6,
      onPanResponderRelease: (_event, gesture) => {
        setManual(true);
        if (gesture.dx <= -30) {
          stepRef.current(1);
        } else if (gesture.dx >= 30) {
          stepRef.current(-1);
        } else if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10) {
          stepRef.current(1);
        }
      },
    }),
  ).current;

  useEffect(() => {
    let cancelled = false;
    void queryReduceMotion().then((reduced) => {
      if (!cancelled && reduced) {
        setStill(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (still || manual || rowCount < 2) {
      return;
    }
    const timer = setInterval(() => step(1), HOLD_MS);
    return () => clearInterval(timer);
  }, [manual, rowCount, step, still]);

  if (rows.length === 0) {
    return null;
  }

  const renderSlide = (row: CoachTickerRow, lines: number | undefined) => (
    <View>
      <Text style={styles.label}>{row.label}</Text>
      <Text style={styles.value} numberOfLines={lines}>
        {row.value}
      </Text>
    </View>
  );

  const renderAsk = (row: CoachTickerRow) =>
    row.question ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.askLabel ?? askLabel}
        hitSlop={10}
        onPress={() => onAsk(row.question as string)}
        style={({ pressed }) => [styles.askButton, pressed && styles.pressed]}
      >
        <Text style={styles.ask}>{row.askLabel ?? askLabel}</Text>
      </Pressable>
    ) : null;

  // Reduced motion gets the whole list, plainly — the point is the content,
  // and without movement a single rotating line would hide most of it.
  if (still) {
    return (
      <View style={styles.wrap}>
        {rows.map((row) => (
          <View key={row.key} style={styles.stillRow}>
            {renderSlide(row, undefined)}
            {renderAsk(row)}
          </View>
        ))}
      </View>
    );
  }

  const row = rows[Math.min(index, rows.length - 1)];

  return (
    <View style={styles.wrap}>
      <View style={styles.stage} {...pan.panHandlers}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: lift }] }}>
          {renderSlide(row, 3)}
        </Animated.View>
      </View>
      {/* Outside the pan area so the button is never mistaken for a tap
          that only meant "next". */}
      <View style={styles.askRow}>{renderAsk(row)}</View>
      {rows.length > 1 ? (
        <View style={styles.dots}>
          {rows.map((entry, dotIndex) => (
            <View key={entry.key} style={[styles.dot, dotIndex === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      paddingVertical: 2,
    },
    // Fixed height: the slides differ in length, and a stage that resized on
    // every rotation would shove the conversation up and down. Tall enough
    // for a three-line opening sentence plus its ask line.
    stage: {
      height: 104,
      justifyContent: 'center',
    },
    askRow: {
      height: 28,
      justifyContent: 'center',
    },
    askButton: {
      alignSelf: 'flex-start',
    },
    stillRow: {
      paddingVertical: 8,
    },
    label: {
      color: theme.faint,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 1.25,
      textTransform: 'uppercase',
    },
    value: {
      color: theme.ink,
      fontSize: 18,
      lineHeight: 25,
      fontWeight: '700',
      marginTop: 4,
    },
    ask: {
      color: theme.highlight,
      fontSize: 13.5,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.7,
    },
    dots: {
      flexDirection: 'row',
      gap: 5,
      marginTop: 6,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.faint,
      opacity: 0.3,
    },
    dotOn: {
      opacity: 1,
    },
  });
