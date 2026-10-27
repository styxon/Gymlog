import React, { useId, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Defs, FeGaussianBlur, Filter, G, Rect, Text as SvgText } from 'react-native-svg';

import { layoutBlurredLines } from '../lib/blurredPreviewText';
import { Theme, useThemedStyles, useTheme } from '../theming';

/**
 * A real gaussian blur, with no new native dependency.
 *
 * React Native has no CSS `filter: blur()`, and `expo-blur` would mean adding a
 * native module and rebuilding. But `react-native-svg` — already a dependency,
 * already linked — ships SVG filter primitives, and `<FeGaussianBlur>` is a
 * true gaussian blur on both platforms. So anything we can draw inside an
 * `<Svg>` (text, bars, shapes) can be genuinely blurred. That covers every
 * locked preview in the app, because every one of them is text or a chart.
 *
 * Why this matters over the older trick (transparent ink + a text shadow): a
 * skeleton says "there is something here", a blur says "there is THIS here, and
 * you cannot read it". The second one is the thing that converts, because the
 * shape of the reader's own answer is visible in it.
 *
 * SAFETY NET: `scrim` stays on top. If a device ever ignores the filter, the
 * result must be an unreadable block, not the Pro conclusion in clear text. The
 * scrim alone is enough for that, so a filter that silently no-ops degrades to
 * the old behaviour instead of leaking.
 */

/**
 * Sigma. Measured on device (SM-A546B): 7 was enough on the violet locked card
 * but NOT on a white surface, where the higher contrast left "Pidä 72,5 kg ja
 * pudota" readable. 10 loses the words on both grounds while the paragraph
 * shape — how long the answer is, how many lines it runs — still reads.
 */
const DEFAULT_BLUR = 10;

type BlurredContent =
  | {
      kind: 'text';
      /** The REAL conclusion. Never a generic feature list — that is a lie you can un-blur. */
      text: string;
      fontSize?: number;
      lineHeight?: number;
    }
  | {
      kind: 'bars';
      /** The reader's own numbers. Relative height is all that survives the blur. */
      values: number[];
    };

interface BlurredPreviewProps {
  content: BlurredContent;
  height: number;
  blur?: number;
  /** Ink for the blurred marks. Defaults to the Pro violet. */
  color?: string;
  /** Wash laid over the blur. See SAFETY NET above. */
  scrim?: string;
}

export function BlurredPreview({ content, height, blur = DEFAULT_BLUR, color, scrim }: BlurredPreviewProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  // One filter id per mounted instance. Two previews on the same screen sharing
  // an id would have the second one resolve the first one's filter region.
  const rawId = useId();
  const filterId = useMemo(() => `vinhaBlur${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 1 ? current : next));
  };

  const ink = color ?? theme.proInk;
  const wash = scrim ?? theme.purpleLight;

  return (
    <View style={[styles.block, { height }]} onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            {/* A generous region: the default clips the blur at the edges, which
                reads as a hard crop rather than as something out of focus. */}
            <Filter id={filterId} x="-25%" y="-25%" width="150%" height="150%">
              <FeGaussianBlur in="SourceGraphic" stdDeviation={blur} />
            </Filter>
          </Defs>
          <G filter={`url(#${filterId})`}>
            {content.kind === 'text' ? (
              <BlurredTextMarks content={content} width={width} height={height} ink={ink} />
            ) : (
              <BlurredBarMarks values={content.values} width={width} height={height} ink={ink} />
            )}
          </G>
        </Svg>
      ) : null}
      <View style={[styles.scrim, { backgroundColor: wash }]} pointerEvents="none" />
    </View>
  );
}

function BlurredTextMarks({
  content,
  width,
  height,
  ink,
}: {
  content: Extract<BlurredContent, { kind: 'text' }>;
  width: number;
  height: number;
  ink: string;
}) {
  const fontSize = content.fontSize ?? 14;
  const lineHeight = content.lineHeight ?? Math.round(fontSize * 1.45);
  const lines = layoutBlurredLines({ text: content.text, widthPx: width, fontSize, lineHeight, heightPx: height });

  return (
    <>
      {lines.map((line, index) => (
        <SvgText
          key={`${index}-${line}`}
          x={0}
          // +0.8em puts the baseline inside the line box rather than on its top
          // edge, which would clip the first line against the card padding.
          y={index * lineHeight + fontSize * 0.85}
          fontSize={fontSize}
          fontWeight="600"
          fill={ink}
        >
          {line}
        </SvgText>
      ))}
    </>
  );
}

function BlurredBarMarks({
  values,
  width,
  height,
  ink,
}: {
  values: number[];
  width: number;
  height: number;
  ink: string;
}) {
  if (values.length === 0) {
    return null;
  }
  const gap = 8;
  const barWidth = Math.max(4, (width - gap * (values.length - 1)) / values.length);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series must not collapse to zero-height bars: the reader should see
  // a shape even when their own numbers barely moved.
  const span = max - min <= 0 ? 1 : max - min;

  return (
    <>
      {values.map((value, index) => {
        const barHeight = Math.max(height * 0.2, ((value - min) / span) * height * 0.85 + height * 0.15);
        return (
          <Rect
            key={index}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={5}
            fill={ink}
          />
        );
      })}
    </>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  block: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // Low, because the gaussian blur is doing the real work here. It only has
    // to be enough to cover a device that ignores SVG filters.
    opacity: 0.35,
  },
});
