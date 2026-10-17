/**
 * The padding under a screen's fixed foot while the keyboard is up.
 *
 * Android and iOS lift a screen for the keyboard in different places. On
 * Android's edge-to-edge window nothing shrinks, the keyboard is drawn over
 * the screen, and the foot has to stand on the keyboard's measured height. On
 * iOS the AppShell's KeyboardAvoidingView has already ended the screen at the
 * keyboard's top edge, so the same height added again is a second keyboard of
 * dead space under the foot — which squeezed the coach chat's thread and the
 * strength goal's number field to nothing (iOS hunt 2026-10-17, P0-4, S5a-2).
 * Only the gap is left to add there.
 */
export function keyboardOpenBottomPadding(os: string, keyboardHeight: number, gap: number): number {
  return os === 'android' ? Math.max(0, keyboardHeight) + gap : gap;
}
