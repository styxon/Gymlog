import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Defs, G, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { fitnessPhotos, FitnessPhotoKey } from '../assets/fitnessPhotos';
import { getProgrammePhoto } from '../assets/programmePhotos';
import { marqueeDurationMs, WelcomeMarqueeTile } from '../lib/welcomeMarquee';

// Half again, not double. Doubled outright (236 x 296) fitted two tiles on a
// phone and the wall stopped reading as a catalog — it read as two slabs
// (measured on device 2026-08-27).
const TILE_WIDTH = 172;
const TILE_HEIGHT = 200;
const GAP = 12;

/**
 * The band rises to the right.
 *
 * Rotating about the centre leaves an empty wedge at each end — the band has
 * to be wider than the screen it crosses, or the corners show through. The
 * caller clips it; see WelcomeScreen.marquee.
 */
const ANGLE_DEG = 0;
const OVERHANG = 140;

/** The rows alone, with no tilt allowance: the band runs level (ANGLE_DEG is 0). */
export function marqueeRowsHeight(rowCount: number): number {
  const rows = Math.max(1, rowCount);
  return rows * TILE_HEIGHT + (rows - 1) * GAP;
}

interface ProgramMarqueeProps {
  rows: WelcomeMarqueeTile[][];
  /** Set once the reader's reduce-motion preference is known. */
  reduceMotion: boolean;
  fontFamily?: string;
}

/**
 * Rows of programme covers drifting past each other, one left, one right.
 *
 * Three things about the motion, each learned the hard way:
 *
 * - One Animated.Value PER ROW. Sharing one node between views crashed the
 *   app on most launches once already, and this is the first screen — there
 *   is no worse place to find that out again.
 * - translateX with useNativeDriver, nothing else. This runs while the app is
 *   still starting, and the onboarding "Done" delay is already an open
 *   complaint; a layout animation here would be paid for on every launch.
 * - Reduce motion parks it. The row still draws — the tiles are the content,
 *   not the movement — it simply stops sliding.
 */
export function ProgramMarquee({ rows, reduceMotion, fontFamily }: ProgramMarqueeProps) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.wrap}>
        {rows.map((tiles, index) => (
          <MarqueeRow
            key={`row_${index}`}
            tiles={tiles}
            reverse={index % 2 === 1}
            // Half a tile per row, so the seams never line up into columns.
            offsetX={(index * (TILE_WIDTH + GAP)) / 2}
            reduceMotion={reduceMotion}
            fontFamily={fontFamily}
          />
        ))}
      </View>
    </View>
  );
}

function MarqueeRow({
  tiles,
  reverse,
  offsetX,
  reduceMotion,
  fontFamily,
}: {
  tiles: WelcomeMarqueeTile[];
  reverse: boolean;
  /** A standing head start, so this row's tiles sit between the row above's. */
  offsetX: number;
  reduceMotion: boolean;
  fontFamily?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const span = tiles.length * (TILE_WIDTH + GAP);

  useEffect(() => {
    if (reduceMotion || tiles.length === 0) {
      progress.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: marqueeDurationMs(tiles.length, TILE_WIDTH, GAP),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    // Leaving the screen stops the drift. An infinite animation nobody is
    // looking at is battery spent on nothing.
    return () => loop.stop();
  }, [progress, reduceMotion, tiles.length]);

  if (tiles.length === 0) {
    return null;
  }

  // The list is drawn twice end to end and slid by exactly one copy's width,
  // so the seam lands where the first copy started and the loop is invisible.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [-span, 0] : [0, -span],
  });

  return (
    <View style={styles.row}>
      {/* The offset is a margin, not part of the animation: the loop still
          travels exactly one copy's width, so a constant shift cannot make the
          seam visible. */}
      <Animated.View style={[styles.rowInner, { marginLeft: -offsetX }, { transform: [{ translateX }] }]}>
        {[...tiles, ...tiles].map((tile, index) => (
          <ProgramTile key={`${tile.id}_${index}`} tile={tile} fontFamily={fontFamily} />
        ))}
      </Animated.View>
    </View>
  );
}

function ProgramTile({ tile, fontFamily }: { tile: WelcomeMarqueeTile; fontFamily?: string }) {
  const gradientId = `marquee_${tile.id}`;
  // The programme's own photo when it has one, and the generic four as the
  // floor. A programme added to the picks tomorrow gets a sensible picture
  // today rather than an empty tile.
  const photo =
    getProgrammePhoto(tile.id) ??
    (tile.photoKey ? fitnessPhotos[tile.photoKey as FitnessPhotoKey] : undefined);
  return (
    <View style={[styles.tile, !photo && tile.border ? { borderWidth: 2, borderColor: tile.border } : null]}>
      {photo ? (
        <Image
          source={photo}
          // Explicit size, not absoluteFill: a positioned-only Image on Android
          // gets rasterised from the layout pass rather than the source, and
          // inside a rotated, clipped layer that came out as a blown-up blur.
          style={{ width: TILE_WIDTH, height: TILE_HEIGHT, position: 'absolute', top: 0, left: 0 }}
          resizeMode="cover"
          fadeDuration={0}
        />
      ) : null}
      <Svg width={TILE_WIDTH} height={TILE_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={tile.from} />
            <Stop offset="1" stopColor={tile.to} />
          </SvgLinearGradient>
          {/* Black, not the brand colour. The tint that used to sit here was
              carrying two jobs — brand and legibility — and the brand half was
              what made the photos look painted (user 2026-08-27). This half is
              not decoration: white text on an unknown photo needs something,
              and the neutral version is invisible as a colour while doing it. */}
          <SvgLinearGradient id={`${gradientId}_scrim`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity={0} />
            <Stop offset="0.45" stopColor="#000000" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.68} />
          </SvgLinearGradient>
        </Defs>
        {/* No photo, no picture to protect: the tile is its swatch, whole. */}
        {photo ? null : (
          <Rect x="0" y="0" width={TILE_WIDTH} height={TILE_HEIGHT} rx={26} fill={`url(#${gradientId})`} />
        )}
        {photo ? (
          <Rect x="0" y="0" width={TILE_WIDTH} height={TILE_HEIGHT} rx={26} fill={`url(#${gradientId}_scrim)`} />
        ) : null}
      </Svg>
      {/* Headline first, then one light line. The line is the programme's own
          tags — "Pakarat · Massa · 5 pv" — so the tile explains itself without
          a second description to keep true. */}
      <Text style={[styles.tileTitle, { color: photo ? '#FFFFFF' : tile.ink, fontFamily }]} numberOfLines={2}>
        {tile.title}
      </Text>
      {tile.meta ? (
        <Text style={[styles.tileMeta, { color: photo ? '#FFFFFF' : tile.ink, fontFamily }]} numberOfLines={1}>
          {tile.meta}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Centred in whatever box the caller gives it, so the tiles are the thing
    // that ends up in the middle rather than the clip rectangle.
    flex: 1,
    justifyContent: 'center',
    gap: GAP,
    transform: [{ rotate: `${ANGLE_DEG}deg` }],
    marginHorizontal: -OVERHANG,
  },
  row: {
    height: TILE_HEIGHT,
    overflow: 'hidden',
  },
  rowInner: {
    flexDirection: 'row',
    gap: GAP,
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 26,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 14,
  },
  tileTitle: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  tileMeta: {
    marginTop: 4,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.3,
    opacity: 0.78,
  },
});
