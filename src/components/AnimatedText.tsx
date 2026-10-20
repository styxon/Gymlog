import { Animated } from 'react-native';

import { Text } from './AppText';

/** The animated Text with the app's text scale cap (see AppText.tsx); its own module so only the screens that animate text build it. */
export const AnimatedText = Animated.createAnimatedComponent(Text);
