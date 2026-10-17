import React, { useEffect, useState } from 'react';
import { Pressable, StyleProp, Text, TextInput, TextStyle } from 'react-native';

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

  if (editing) {
    return (
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
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shown}`}
      accessibilityHint={t(language, 'ruler.typeValue.hint')}
      hitSlop={8}
      onPress={() => {
        setDraft(value === null ? '' : removeTrailingZeros(Number(value.toFixed(decimals))));
        setEditing(true);
      }}
    >
      <Text style={textStyle}>{shown}</Text>
    </Pressable>
  );
}
