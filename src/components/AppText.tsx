import React from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

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
 */
type RNTextProps = React.ComponentProps<typeof RNText> & { ref?: React.Ref<RNText> };
type RNTextInputProps = React.ComponentProps<typeof RNTextInput> & { ref?: React.Ref<RNTextInput> };

export function Text(props: RNTextProps) {
  return <RNText {...props} maxFontSizeMultiplier={props.maxFontSizeMultiplier || TEXT_SCALE_CAP} />;
}
// `useRef<Text>` and `ComponentProps<typeof Text>` keep working at the call sites.
export type Text = RNText;

export function TextInput(props: RNTextInputProps) {
  return <RNTextInput {...props} maxFontSizeMultiplier={props.maxFontSizeMultiplier || TEXT_SCALE_CAP} />;
}
export type TextInput = RNTextInput;

