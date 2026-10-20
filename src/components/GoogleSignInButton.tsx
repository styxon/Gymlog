import React from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { Text } from './AppText';
import Svg, { Path } from 'react-native-svg';

/** The four-colour Google G. */
export function GoogleGlyph({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/**
 * "Continue with Google", drawn to stand beside Apple's own button: the same
 * white pill, the mark at the left of the label, black type (user, #bugs
 * 2026-10-17). It was a settings row with a green shield and green type, under
 * a system button that looked like a different app.
 *
 * Fixed colours rather than theme ones, like the Apple button it matches:
 * white in both themes, which is also what Google's own branding asks for.
 */
export function GoogleSignInButton({
  label,
  onPress,
  disabled = false,
  cornerRadius = 16,
  height = 52,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  cornerRadius?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { height, borderRadius: cornerRadius },
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <GoogleGlyph size={Math.round(height * 0.36)} />
      <Text style={[styles.label, { fontSize: Math.round(height * 0.39) }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#000000',
  },
  label: {
    color: '#000000',
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
});
