/**
 * Maps a text style's fontWeight onto the static Manrope files (pure).
 *
 * React Native on Android does not drive a variable font's weight axis, so
 * each weight is its own bundled family (App.tsx Font.loadAsync). AppText.tsx
 * appends the result to every Text and TextInput; before this the same
 * mapping lived in a patch of `Text.render`, which React Native 0.83 silently
 * ignores (Text is a plain function component), and the app rendered in the
 * system font from PR #303 on.
 */
const WEIGHT_TO_FAMILY: Record<string, string> = {
  '100': 'Manrope-Regular',
  '200': 'Manrope-Regular',
  '300': 'Manrope-Regular',
  '400': 'Manrope-Regular',
  '500': 'Manrope-Medium',
  '600': 'Manrope-SemiBold',
  '700': 'Manrope-Bold',
  '800': 'Manrope-ExtraBold',
  '900': 'Manrope-ExtraBold',
  normal: 'Manrope-Regular',
  bold: 'Manrope-Bold',
};

export function familyForWeight(weight?: string | number | null): string {
  if (weight === undefined || weight === null) {
    return 'Manrope-Regular';
  }
  return WEIGHT_TO_FAMILY[String(weight)] ?? 'Manrope-Regular';
}

type ManropeStyleOverride = { fontFamily: string; fontWeight: 'normal' };

/**
 * The style to append after a flattened style, or null to leave it alone.
 * An explicit family other than the generic 'Manrope' (JetBrainsMono, Inter, a
 * static Manrope-*) stays. The static file carries the weight, so fontWeight
 * goes to normal: Android would otherwise synthesize a second bold.
 *
 * `nested` is a Text inside another Text. One that names neither a family nor
 * a weight is left alone, so it inherits the parent's resolved family: a
 * coloured word inside a bold heading stays bold instead of dropping to Regular.
 */
export function manropeOverride(
  flat: { fontFamily?: unknown; fontWeight?: unknown } | null | undefined,
  nested = false,
): ManropeStyleOverride | null {
  const family = flat?.fontFamily;
  if (nested && family === undefined && flat?.fontWeight === undefined) {
    return null;
  }
  if (typeof family === 'string' && family !== 'Manrope') {
    return null;
  }
  const weight = flat?.fontWeight;
  const name = familyForWeight(typeof weight === 'string' || typeof weight === 'number' ? weight : null);
  // One shared object per family: no allocation per render, and a stable style.
  let override = OVERRIDES.get(name);
  if (!override) {
    override = Object.freeze({ fontFamily: name, fontWeight: 'normal' as const });
    OVERRIDES.set(name, override);
  }
  return override;
}

const OVERRIDES = new Map<string, ManropeStyleOverride>();
