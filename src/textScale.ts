/**
 * Upper limit for how far the system text size may scale any Text or
 * TextInput in the app. Owner decision 2026-10-20: at the iOS accessibility
 * sizes titles and exercise names broke mid-word and charts overlapped, so the
 * whole app stops at 1.5x. Applied by src/components/AppText.tsx; a call site
 * may set a smaller maxFontSizeMultiplier (1.2, 1.3), never a larger one.
 * Native widgets (home widget) are outside this cap.
 */
export const TEXT_SCALE_CAP = 1.5;

/**
 * The maxFontSizeMultiplier AppText passes down. A top-level Text gets the
 * call site's value or the cap; a nested Text gets only the call site's value
 * (undefined otherwise), because on native a nested span's own value overrides
 * its parent's and a default here would lift a tighter parent cap (1.3) back
 * to 1.5x.
 */
export function resolveFontSizeMultiplier(requested: number | null | undefined, nested: boolean): number | undefined {
  if (requested) {
    return requested;
  }
  return nested ? undefined : TEXT_SCALE_CAP;
}
