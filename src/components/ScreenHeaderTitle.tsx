import React from 'react';
import { StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import { Text } from './AppText';

import { Theme, useThemedStyles } from '../theming';

/**
 * The centred title in a pushed screen's header.
 *
 * It exists because the obvious version is a trap. Ten screens wrote the title
 * as an absolutely positioned `<Text>` spanning `left: 0, right: 0` with
 * `pointerEvents: 'none'` in the stylesheet — and on Android that property does
 * nothing on a Text. The title is the later sibling, so it paints over the back
 * button and swallowed every press that landed inside its band. Measured on
 * device: the back button responded only in the ~24px slivers above and below
 * the title, and the visible chevron sits dead centre, so a real tap never
 * worked. Back was unreachable on all ten screens.
 *
 * `pointerEvents` does work on a View, so the title is wrapped in one. Use this
 * component rather than re-adding a bare absolute Text — tests/screens/
 * headerBackReachable.test.cjs fails if a screen goes back to the old shape.
 */
export function ScreenHeaderTitle({ title, style }: { title: string; style?: StyleProp<TextStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text numberOfLines={1} style={[styles.text, style]}>
        {title}
      </Text>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  text: {
    textAlign: 'center',
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
});
