import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Keyboard, StyleSheet, View } from 'react-native';

/**
 * A modal's look without a Modal: a full-screen layer drawn in the app's own
 * window, fading in and out.
 *
 * For iOS, where React Native presents every Modal from the root view
 * controller and UIKit refuses a second presentation while another modal is
 * up or still leaving. The refused Modal is recorded as shown and never tried
 * again, and its host stays in the window as an invisible full-screen layer
 * that takes every touch (iOS hunt 2026-10-17). A view in the window is never
 * refused: opened in the same tick as a sheet closes, it is simply there under
 * the sheet until the sheet has gone.
 *
 * The cost is the other side of the same fact: it is drawn under any Modal
 * that stays open. Use it for a wall the reader meets on the way out of a
 * sheet, and put it in AppShell's `topLayer` so it covers the tab bar and the
 * status bar like a Modal would. A Modal also hides the screen under it from
 * VoiceOver; here that is the host's job (AppShell's `topLayerActive`), since
 * the layer cannot reach outside its own parent.
 */
export function InTreeLayer({
  visible,
  children,
  fadeMs = 200,
}: {
  visible: boolean;
  children: React.ReactNode;
  fadeMs?: number;
}) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const layerRef = useRef<View>(null);
  // Kept drawn while it fades out, so the content does not vanish mid-fade.
  const [drawn, setDrawn] = useState(visible);
  // What the last run of the effect saw; null before the first.
  const lastVisible = useRef<boolean | null>(null);

  useEffect(() => {
    const mounting = lastVisible.current === null;
    if (lastVisible.current === visible) {
      return undefined;
    }
    lastVisible.current = visible;
    if (visible) {
      setDrawn(true);
      // The keyboard is a window of its own, over this one: it would cover
      // the lower half of the card. A Modal took the focus from the field.
      Keyboard.dismiss();
      if (layerRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(layerRef.current, 'focus');
      }
    }
    if (mounting) {
      // Mounted at its resting opacity: nothing to fade.
      return undefined;
    }
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: fadeMs,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) {
        setDrawn(false);
      }
    });
    return () => animation.stop();
  }, [visible, opacity, fadeMs]);

  if (!visible && !drawn) {
    return null;
  }
  return (
    <Animated.View
      ref={layerRef}
      style={[StyleSheet.absoluteFill, { opacity }]}
      // Leaving, it no longer takes the touches meant for what is under it.
      pointerEvents={visible ? 'auto' : 'none'}
      // Hides its siblings in the top layer from VoiceOver; the app under it
      // is hidden by the host (see above).
      accessibilityViewIsModal
    >
      {children}
    </Animated.View>
  );
}
