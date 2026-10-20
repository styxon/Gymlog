import React, { useMemo } from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { Text } from './AppText';

import { splitOnHighlights } from '../lib/coachHighlight';

interface CoachHighlightedTextProps {
  text: string;
  /** Exact substrings to render in the accent colour. */
  highlights: string[];
  style?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/** Renders a coach sentence with its figures picked out in gold. */
export function CoachHighlightedText({
  text,
  highlights,
  style,
  highlightStyle,
  numberOfLines,
}: CoachHighlightedTextProps) {
  const parts = useMemo(() => splitOnHighlights(text, highlights), [highlights, text]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) =>
        part.highlighted ? (
          <Text key={`${part.value}:${index}`} style={highlightStyle}>
            {part.value}
          </Text>
        ) : (
          part.value
        ),
      )}
    </Text>
  );
}
