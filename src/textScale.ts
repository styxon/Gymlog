/**
 * Upper limit for how far the system text size may scale any Text or
 * TextInput in the app. Owner decision 2026-10-20: at the iOS accessibility
 * sizes titles and exercise names broke mid-word and charts overlapped, so the
 * whole app stops at 1.5x. Applied by src/components/AppText.tsx; a call site
 * may set a smaller maxFontSizeMultiplier (1.2, 1.3), never a larger one.
 * Native widgets (home widget) are outside this cap.
 */
export const TEXT_SCALE_CAP = 1.5;
