import React, { useMemo } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { statusCapInterpolation } from '../lib/statusCap';

/**
 * The band over the status bar on a page that runs under it, faded in by the
 * page's scroll (lib/statusCap). Drawn after the scroll view, so it is above
 * it; takes no touches.
 *
 * The interpolation belongs to this view alone and is built once per inset:
 * an animated node shared between two views took the app down once.
 */
export function StatusCap({ scrollY, topInset, color }: { scrollY: Animated.Value; topInset: number; color: string }) {
  const opacity = useMemo(() => scrollY.interpolate(statusCapInterpolation(topInset)), [scrollY, topInset]);
  return <Animated.View pointerEvents="none" style={[styles.cap, { height: topInset, backgroundColor: color, opacity }]} />;
}

const styles = StyleSheet.create({
  cap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
