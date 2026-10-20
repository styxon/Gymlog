import React, { createContext, useContext } from 'react';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';

import { manropeOverride } from '../lib/manropeFamily';
import { TEXT_SCALE_CAP } from '../textScale';

/**
 * The app's Text and TextInput (the animated one is AnimatedText.tsx). Every screen imports these
 * instead of the react-native ones (tests/lib/textScaleCap.test.cjs fails when
 * a file does not), so the owner's 1.5x cap on the system text size
 * (src/textScale.ts) is applied in one place.
 *
 * Why wrappers and not `Text.defaultProps`: React 19 ignores defaultProps on
 * function components, and in React Native 0.83 Text and TextInput are plain
 * function components. An explicit maxFontSizeMultiplier at a call site (1.2,
 * 1.3) wins; `undefined` and 0 (no limit in React Native) fall back to the cap.
 *
 * They also carry the app typeface: fontWeight is mapped onto the static
 * Manrope files (src/lib/manropeFamily.ts), because React Native has no font
 * cascade and Android does not drive a variable font's weight axis. This used
 * to be a patch of `Text.render` that RN 0.83 ignores. Native only: on web the
 * weights sit in react-native-web's class names and the browser drives them.
 */
type RNTextProps = React.ComponentProps<typeof RNText> & { ref?: React.Ref<RNText> };
type RNTextInputProps = React.ComponentProps<typeof RNTextInput> & { ref?: React.Ref<RNTextInput> };

/** True below an app Text, where React Native lets a nested Text inherit the parent's font. */
const InsideText = createContext(false);

/** The style with the Manrope family for its weight appended; the style itself when it names another family, or on web. */
function withAppFont(style: unknown, nested = false): any {
  if (Platform.OS === 'web') {
    return style;
  }
  const override = manropeOverride(StyleSheet.flatten(style as never) as { fontFamily?: unknown; fontWeight?: unknown } | undefined, nested);
  return override ? [style, override] : style;
}

export function Text(props: RNTextProps) {
  const nested = useContext(InsideText);
  const text = <RNText {...props} style={withAppFont(props.style, nested)} maxFontSizeMultiplier={props.maxFontSizeMultiplier || TEXT_SCALE_CAP} />;
  if (nested) {
    return text;
  }
  return <InsideText.Provider value>{text}</InsideText.Provider>;
}
// `useRef<Text>` and `ComponentProps<typeof Text>` keep working at the call sites.
export type Text = RNText;

export function TextInput(props: RNTextInputProps) {
  return <RNTextInput {...props} style={withAppFont(props.style)} maxFontSizeMultiplier={props.maxFontSizeMultiplier || TEXT_SCALE_CAP} />;
}
export type TextInput = RNTextInput;

