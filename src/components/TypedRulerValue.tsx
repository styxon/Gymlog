import React, { useEffect, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextInput, TextStyle, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { parseTypedRulerValue, RulerBounds } from '../lib/rulerValue';
import { removeTrailingZeros } from '../lib/format';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/models';

interface TypedRulerValueProps {
  language: AppLanguage;
  /** The number shown; null draws a dash (nothing answered yet). */
  value: number | null;
  bounds: RulerBounds;
  decimals: number;
  /** Called with a value already clamped to the scale and to its marks. */
  onCommit: (value: number) => void;
  /**
   * Told when typing starts and ends. The number is committed only when the
   * field blurs, so a sheet that saves must not save in between.
   */
  onEditingChange?: (editing: boolean) => void;
  textStyle: StyleProp<TextStyle>;
  /** Names the field for a screen reader, e.g. "Paino". */
  label: string;
  /** The unit, drawn after the number while it is shown and while it is typed. */
  suffix?: React.ReactNode;
  /**
   * A pen after the unit, the same as tapping the number.
   *
   * The tappable number alone was a secret: "Painon rullaus on vaikeeta laita
   * vaikka kynäikoni viereen mistä voi kirjoittaa" (#bugs 2026-10-18, iOS
   * build 5). Nothing on a big orange number says it takes a keyboard.
   */
  penColor?: string;
}

/**
 * The big number above a ruler, tappable to type instead of dragging.
 *
 * On a 0.1 kg ruler 70 to 120 kg is five hundred ticks of thumb; typing is the
 * faster instrument when the number is known. A bad entry leaves the old value
 * alone rather than guessing.
 */
export function TypedRulerValue({
  language,
  value,
  bounds,
  decimals,
  onCommit,
  onEditingChange,
  textStyle,
  label,
  suffix = null,
  penColor,
}: TypedRulerValueProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!editing) {
      return undefined;
    }
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const shown = value === null ? '—' : removeTrailingZeros(Number(value.toFixed(decimals)));

  function commit() {
    const parsed = parseTypedRulerValue(draft, bounds);
    if (parsed !== null) {
      onCommit(parsed);
    }
    setEditing(false);
  }

  function startEditing() {
    setDraft(value === null ? '' : removeTrailingZeros(Number(value.toFixed(decimals))));
    setEditing(true);
  }

  if (editing) {
    return (
      <View style={[styles.row, penColor ? styles.rowWithPen : null]}>
        <TextInput
          autoFocus
          selectTextOnFocus
          keyboardType="decimal-pad"
          value={draft}
          onChangeText={setDraft}
          // Done blurs a single-line input, so the blur is the one commit: a
          // second on submit wrote the same value twice.
          onBlur={commit}
          returnKeyType="done"
          // The decimal pad has no return key; iOS draws a Done bar for it, in
          // English unless it is told otherwise.
          inputAccessoryViewButtonLabel={t(language, 'common.done')}
          maxLength={6}
          accessibilityLabel={label}
          style={[textStyle, { minWidth: 90, textAlign: 'center', padding: 0 }]}
        />
        {suffix}
      </View>
    );
  }

  return (
    <View style={[styles.row, penColor ? styles.rowWithPen : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={t(language, 'ruler.typeValue.hint')}
        hitSlop={8}
        onPress={startEditing}
      >
        <Text style={textStyle}>{shown}</Text>
      </Pressable>
      {suffix}
      {penColor ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'ruler.typeValue.pen')}
          hitSlop={10}
          onPress={startEditing}
          style={({ pressed }) => [styles.pen, { borderColor: penColor }, pressed && styles.pressed]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
              stroke={penColor}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  // Room for the pen on both sides, so the number stays centred and the pen
  // stays inside the row (Android does not hit-test outside a parent).
  rowWithPen: {
    paddingHorizontal: 48,
  },
  // Beside the unit, on its baseline; 36 pt drawn, 56 pt with the slop.
  // Out of the flow, so the number stays centred over the ruler's mark and
  // does not move when typing hides the pen.
  pen: {
    position: 'absolute',
    right: 0,
    bottom: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
