import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { dialHoldIntervalMs } from '../lib/guidedPlayer';
import { useTheme, useThemedStyles } from '../theming';
import { makeStyles } from './GuidedPlayerStyles';

/* ── set-screen dial ── */

/**
 * A −/+ button that steps once on tap and runs while held, speeding up.
 *
 * Pressable's onLongPress fires instead of onPress when the finger stays
 * down, so a tap is exactly one step and a hold is one step plus a run that
 * ends on release. The run schedules itself with setTimeout rather than
 * setInterval so the interval can shorten mid-hold (dialHoldIntervalMs).
 */
export function DialButton({
  glyph,
  accessibilityLabel,
  onStep,
}: {
  glyph: '−' | '+';
  accessibilityLabel: string;
  onStep: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticksRef = useRef(0);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const stopRun = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    ticksRef.current = 0;
  }, []);

  const runTick = useCallback(() => {
    onStepRef.current();
    ticksRef.current += 1;
    timerRef.current = setTimeout(runTick, dialHoldIntervalMs(ticksRef.current));
  }, []);

  // A hold that outlives the button (step change, unmount) must not keep
  // stepping a number nobody can see.
  useEffect(() => stopRun, [stopRun]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => onStepRef.current()}
      onLongPress={runTick}
      delayLongPress={350}
      onPressOut={stopRun}
      style={({ pressed }) => [styles.setDialBtn, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.setDialBtnText}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * One dial: a label, the number, −/+ under it. Tapping the number opens it
 * as a text field; the buttons are always live. The reader's own sketch
 * (2026-09-09): "16,25" had shared its row with two buttons and lost the
 * ",25", and reps were squeezed the same way. Buttons under the number give
 * the number the card's width. No "tap to type" line under them: it was in
 * the sketch and struck out on the phone the same day.
 */
export function DialCard({
  label,
  value,
  unit,
  open,
  onToggle,
  onStep,
  downLabel,
  upLabel,
  editHint,
  wide,
  faint,
  onCommit,
  invalid = false,
  onDraftCleared,
  doneLabel,
}: {
  label: string;
  value: string;
  unit: string | null;
  /** Typing: the number is a text field until the card is closed. */
  open: boolean;
  onToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  downLabel: string;
  upLabel: string;
  /** Screen-reader hint on the number. */
  editHint: string;
  wide: boolean;
  faint: boolean;
  /** Commit a typed value; the lib rule decides what the text becomes. */
  onCommit: (text: string) => void;
  /** What is typed is not a number this card can log; drawn in the danger ink. */
  invalid?: boolean;
  /**
   * The field stopped showing typed text and shows the card's number again:
   * the keyboard went away, or a step moved the number. Whatever made the
   * typed text unloggable is no longer on screen (CI review of #174: the log
   * button stayed locked, red, over a field that read a good weight).
   */
  onDraftCleared?: () => void;
  /**
   * The bar iOS draws over its number pads, which have no return key; it is
   * the one way to close the card from the keyboard, and says "Done" in
   * English unless told otherwise.
   */
  doneLabel: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = useState<string | null>(null);

  // One step, from either a button or a screen reader's swipe. A step moves
  // the card's number, so the field shows that number rather than text typed
  // before it.
  const step = (direction: -1 | 1) => {
    setDraft(null);
    onDraftCleared?.();
    onStep(direction);
  };

  // Every keystroke commits. The field shows what is being typed (`draft`)
  // while the parent's number follows it through the lib rule, so nothing is
  // pending when the card closes — by the keyboard's done key, by a tap
  // elsewhere (which unmounts the field without a blur on Android), or by the
  // log button, which reads `kg` in the very tick it closes the card.
  useEffect(() => {
    if (!open) {
      setDraft(null);
    }
  }, [open]);

  return (
    <View style={[styles.setDialCard, wide && styles.setDialCardWide, open && styles.setDialCardOpen]}>
      <Text style={[styles.setDialLabel, open && { color: theme.highlight }]}>{label}</Text>
      {/* An adjustable, the way a screen reader expects a number you nudge:
          swipe up or down steps it by the dial's own step and the new value
          is read back, where a button role left the reader hunting for two
          small buttons and hearing nothing after them (accessibility audit,
          2026-09-21). A double tap still opens it for typing. Open, it steps
          aside so the field inside is reached on its own. */}
      <Pressable
        accessible={!open}
        accessibilityRole={open ? undefined : 'adjustable'}
        accessibilityLabel={label}
        accessibilityValue={{ text: `${value}${unit ? ` ${unit}` : ''}` }}
        accessibilityHint={editHint}
        accessibilityActions={[
          { name: 'increment', label: upLabel },
          { name: 'decrement', label: downLabel },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            step(1);
          } else if (event.nativeEvent.actionName === 'decrement') {
            step(-1);
          }
        }}
        onPress={open ? undefined : onToggle}
        style={({ pressed }) => [styles.setDialValue, pressed && !open && { opacity: 0.7 }]}
      >
        {open ? (
          <TextInput
            value={draft ?? value}
            onChangeText={(text) => {
              setDraft(text);
              onCommit(text);
            }}
            onFocus={() => setDraft(value)}
            onBlur={() => {
              setDraft(null);
              onDraftCleared?.();
            }}
            onSubmitEditing={onToggle}
            autoFocus
            keyboardType={unit ? 'decimal-pad' : 'number-pad'}
            returnKeyType="done"
            inputAccessoryViewButtonLabel={doneLabel}
            selectTextOnFocus
            accessibilityLabel={label}
            style={[styles.setDialNumber, faint && { color: theme.faint }, invalid && { color: theme.danger }]}
          />
        ) : (
          <Text
            style={[styles.setDialNumber, faint && { color: theme.faint }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {value}
          </Text>
        )}
        {unit ? <Text style={styles.setDialUnit}>{unit}</Text> : null}
      </Pressable>
      <View style={styles.setDialControls}>
        <DialButton glyph="−" accessibilityLabel={downLabel} onStep={() => step(-1)} />
        <DialButton glyph="+" accessibilityLabel={upLabel} onStep={() => step(1)} />
      </View>
    </View>
  );
}
