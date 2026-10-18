import { CutSurface } from './CutSurface';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { TourTargetRegistry } from '../features/tour/tourTargets';
import { TourBarStop } from '../lib/firstRunTour';
import { RootTabKey } from '../navigation/routes';
import { I18nKey, t } from '../lib/i18n';
import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';

// EXPERIMENT (2026-07-13): dark, detached "floating pill" tab bar. Absolutely
// positioned so it floats low over the (light) app content — no light backdrop
// strip. The active tab gets a circular purple highlight that slides between
// tabs. Kept isolated in this file + its own commit so it reverts cleanly.
// Two bars, one per theme (user 2026-09-02: the dark pill "ei oikein sovi
// tähän vaaleaan teemaan"). The dark pill was the designed surface and stays
// in dark; light gets a white pill with a hairline, the same card language as
// the rest of the light screens. The accent and its wash come from the theme.
const BAR = {
  pill: '#1E1B2C',
  pillBorder: 'rgba(255,255,255,0.09)',
  inactive: '#8B84A6',
};

// Diameter of the sliding circular highlight behind the active tab's icon.
const HIGHLIGHT = 44;
// Center "AI" button (design_handoff_ai_button): spec is 48px; sized down a touch.
const AI_SIZE = 46;
const AI_HALO = 58;
/** The fade under the pill: the shell's own 8 below it, and 28 of the pill. */
const EDGE_FADE = 36;

interface BottomTabBarProps {
  activeTab: RootTabKey | null;
  aiActive?: boolean;
  onTabPress: (tab: RootTabKey) => void;
  onAiPress: () => void;
  language?: AppLanguage;
  /**
   * The first-run tour's sweep: while set, the highlight sits on this item
   * instead of the route's tab, and the AI orb glows for its turn. Null
   * hands the bar back to the route.
   */
  sweep?: TourBarStop | null;
  /** Where the tour rings each item; registered per tab and for the pill. */
  tourTargets?: TourTargetRegistry;
}

// `stop` is the item's name in the first-run tour's sweep and its target id
// (`bar.<stop>`); the tab key and the stop differ only for Programs.
const sideTabs: { key: RootTabKey; labelKey: I18nKey; stop: TourBarStop }[] = [
  { key: 'home', labelKey: 'tabs.home', stop: 'home' },
  // Internal key stays 'workout' (routes/analytics unchanged); only the
  // user-facing label and icon move to Programs.
  { key: 'workout', labelKey: 'tabs.programs', stop: 'programs' },
  { key: 'progress', labelKey: 'tabs.progress', stop: 'progress' },
  { key: 'profile', labelKey: 'tabs.profile', stop: 'profile' },
];

function TabIcon({ tab, active }: { tab: RootTabKey; active: boolean }) {
  const theme = useTheme();
  const themeName = useThemeName();
  // Inactive icons: the bar's own grey on the dark pill, the theme's faint
  // ink on the white one — the grey was tuned for a dark ground.
  const stroke = active ? theme.highlight : themeName === 'dark' ? BAR.inactive : theme.faint;
  const fill = active ? theme.highlight : 'none';
  const size = 26;

  if (tab === 'home') {
    return (
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <Path
          d="M3.5 8.2L10 3.5L16.5 8.2V15.6C16.5 16.1 16.1 16.5 15.6 16.5H11.9V12.4H8.1V16.5H4.4C3.9 16.5 3.5 16.1 3.5 15.6V8.2Z"
          stroke={stroke}
          strokeWidth={1.8}
          strokeLinejoin="round"
          fill={fill}
        />
      </Svg>
    );
  }

  if (tab === 'workout') {
    // Programs = a stacked-layers glyph (matches the active-program card icon).
    return (
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <Path
          d="M10 2.6L17.5 6.4L10 10.2L2.5 6.4Z"
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinejoin="round"
          fill={fill}
        />
        <Path d="M2.9 10L10 13.6L17.1 10" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M2.9 13.4L10 17L17.1 13.4" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  if (tab === 'progress') {
    return (
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <Path
          d="M3 13.8L7.1 9.7L10 12.1L15.8 6.3"
          stroke={stroke}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="15.8" cy="6.3" r="1.1" fill={stroke} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Circle cx="10" cy="6.8" r="2.9" stroke={stroke} strokeWidth={1.8} />
      <Path
        d="M4.5 16.2C4.9 13.4 7 11.9 10 11.9C13 11.9 15.1 13.4 15.5 16.2"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function SideTab({
  tab,
  active,
  label,
  onPress,
  onMeasure,
  onRef,
}: {
  tab: { key: RootTabKey; labelKey: I18nKey; stop: TourBarStop };
  active: boolean;
  label: string;
  onPress: () => void;
  onMeasure: (key: RootTabKey, event: LayoutChangeEvent) => void;
  onRef?: (node: View | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      ref={onRef}
      onPress={onPress}
      onLayout={(event) => onMeasure(tab.key, event)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={styles.sideTab}
    >
      <TabIcon tab={tab.key} active={active} />
    </Pressable>
  );
}

export function BottomTabBar({ activeTab, aiActive = false, onTabPress, onAiPress, language = 'en', sweep = null, tourTargets }: BottomTabBarProps) {
  const theme = useTheme();
  const themeName = useThemeName();
  const styles = useThemedStyles(makeStyles);

  // Dark: the pill lifts off the background as a soft surface (#1E1B2C over
  // #141021 was a smudge). Light: a white card with a hairline, like every
  // other card on the light screens.
  // theme.surface IS the light theme's white; a second hex for the same
  // colour was one more thing to keep in step.
  const pillBackground = themeName === 'dark' ? theme.surfaceSoft : theme.surface;
  const pillStroke = themeName === 'dark' ? undefined : theme.border;

  // The AI button. Light: a deep violet orb with a white label (user
  // 2026-09-03: the near-white orb with violet text was inverted — on the white
  // pill it read as one more pale card). Dark: a dark orb with an orange label
  // (user decision 2026-08-01). The violet halo stays in both, so the button
  // keeps its brand glow without shouting.
  const aiDark = themeName === 'dark';
  const aiFillStops = aiDark
    ? ['#2E2545', '#241C38', '#1B1530']
    : [theme.purpleBright, theme.purple, theme.purpleDark];
  const aiCircleBackground = aiDark ? '#1B1530' : theme.purpleDark;
  const aiLabelColor = aiDark ? theme.highlight : theme.onHighlight;

  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  // Entrance: the bar rises in at .24s and the FAB pops (scale .3 -> 1 with
  // overshoot) at .5s. Reduced motion skips straight to the final state.
  const barRise = useRef(new Animated.Value(0)).current;
  const fabPop = useRef(new Animated.Value(0.3)).current;
  // Interpolated once — the bar is always mounted and re-renders on every
  // workout tick, so an inline .interpolate() here rebuilds native animated
  // nodes each second and eventually dies in disconnectAnimatedNodes (Fabric).
  const barRiseTranslate = useRef(
    barRise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
  ).current;

  // Sliding circular highlight: we measure each side tab's centre and animate a
  // single circle's translateX to the active tab (spring => it "slides" in).
  const routeKey = !aiActive && activeTab !== null && sideTabs.some((tab) => tab.key === activeTab) ? activeTab : null;
  // During the tour's sweep the highlight belongs to the sweep, not the route;
  // on the AI stop it steps aside and the orb's own glow takes the turn.
  const activeKey = sweep ? sideTabs.find((tab) => tab.stop === sweep)?.key ?? null : routeKey;
  const aiLit = aiActive || sweep === 'ai';
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const centers = useRef<Partial<Record<RootTabKey, number>>>({});
  const positioned = useRef(false);

  useEffect(() => {
    let mounted = true;
    queryReduceMotion()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(Boolean(enabled));
        }
      })
      .catch(() => {
        if (mounted) {
          setReduceMotion(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) {
      return;
    }
    if (reduceMotion) {
      barRise.setValue(1);
      fabPop.setValue(1);
      return;
    }
    Animated.timing(barRise, {
      toValue: 1,
      duration: 500,
      delay: 240,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
    Animated.timing(fabPop, {
      toValue: 1,
      duration: 420,
      delay: 500,
      easing: Easing.bezier(0.3, 1.3, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [barRise, fabPop, reduceMotion]);

  function positionIndicator(animate: boolean) {
    if (activeKey === null) {
      Animated.timing(indicatorOpacity, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      return;
    }
    const center = centers.current[activeKey];
    if (center === undefined) {
      return;
    }
    const target = center - HIGHLIGHT / 2;
    if (animate && positioned.current && reduceMotion !== true) {
      Animated.parallel([
        Animated.spring(indicatorX, { toValue: target, useNativeDriver: true, speed: 13, bounciness: 7 }),
        Animated.timing(indicatorOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      indicatorX.setValue(target);
      indicatorOpacity.setValue(1);
      positioned.current = true;
    }
  }

  useEffect(() => {
    positionIndicator(true);
    // positionIndicator reads the latest refs/props on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, reduceMotion]);

  function handleMeasure(key: RootTabKey, event: LayoutChangeEvent) {
    const { x, width } = event.nativeEvent.layout;
    centers.current[key] = x + width / 2;
    if (key === activeKey && !positioned.current) {
      positionIndicator(false);
    }
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.shell,
        /**
         * The bar's own breathing room, and nothing below the safe area.
         *
         * This used to add `marginBottom: -10` on top — a negative margin that
         * put the floating pill two points *under* the boundary the system
         * reserves for its own bar. It was asked for from the phone (473534f)
         * during the double-counted-inset era, and it is the last plaster from
         * it: 895c196 pulled the matching one off the Pro footer and left this
         * one on, because they were on different screens.
         *
         * Reported from the phone again, the other way: the pill sat too close
         * to the system buttons. Rendering below the safe area is what it means
         * to sit too close to them, on any device — so the drop is gone rather
         * than tuned, and the bar takes a flat 8.
         */
        { paddingBottom: 8 },
        {
          opacity: barRise,
          transform: [{ translateY: barRiseTranslate }],
        },
      ]}
    >
      {/* Every screen above ends at the safe area's edge, 8 pt under the
          pill, and what scrolled there was cut off along a hard line, with
          the bare home-indicator band of the page below it (owner's #1, iOS
          hunt 2026-10-17; plainest on an iPhone). The page fades into its
          own background before that line instead: the shell paints the band
          in theme.bg, and so does the fade's end. Under the pill, so the pill
          covers its middle; touches go through to the page. */}
      <View pointerEvents="none" style={styles.edgeFade}>
        <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="vinhaTabEdgeFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={theme.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="1" height="1" fill="url(#vinhaTabEdgeFade)" />
        </Svg>
      </View>
      {/* A3: the bar wears the cut corner the rest of the app wears. Icons and
          colours are untouched — only the silhouette changes, from a plain
          30px pill to the same shape the CTAs and day rows use. The fill stays
          on CutSurface so the dark-theme override still lands. */}
      <CutSurface size="lg" fill={pillBackground} stroke={pillStroke} strokeWidth={1} style={styles.pill}>
        <View ref={(node) => tourTargets?.register('bar.pill', node)} style={styles.row}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              { opacity: indicatorOpacity, transform: [{ translateX: indicatorX }] },
            ]}
          />

          {sideTabs.slice(0, 2).map((tab) => (
            <SideTab
              key={tab.key}
              tab={tab}
              label={t(language, tab.labelKey)}
              active={activeKey === tab.key}
              onPress={() => onTabPress(tab.key)}
              onMeasure={handleMeasure}
              onRef={(node) => tourTargets?.register(`bar.${tab.stop}`, node)}
            />
          ))}

          <Pressable
            ref={(node) => tourTargets?.register('bar.ai', node)}
            onPress={onAiPress}
            accessibilityRole="button"
            accessibilityLabel={t(language, 'tabs.aiCoach')}
            style={({ pressed }) => [styles.centerTab, pressed && styles.pressed]}
          >
            <Animated.View style={[styles.centerGlow, aiLit && styles.centerGlowActive, { transform: [{ scale: fabPop }] }]}>
              <View style={[styles.aiCircle, { backgroundColor: aiCircleBackground }]}>
                <Svg style={StyleSheet.absoluteFill} width={AI_SIZE} height={AI_SIZE}>
                  <Defs>
                    <RadialGradient id="aiFill" cx="50%" cy="38%" r="65%">
                      <Stop offset="0" stopColor={aiFillStops[0]} />
                      <Stop offset="0.62" stopColor={aiFillStops[1]} />
                      <Stop offset="1" stopColor={aiFillStops[2]} />
                    </RadialGradient>
                  </Defs>
                  <Rect width={AI_SIZE} height={AI_SIZE} fill="url(#aiFill)" />
                </Svg>
                <Text style={[styles.aiText, { color: aiLabelColor }]}>AI</Text>
              </View>
            </Animated.View>
          </Pressable>

          {sideTabs.slice(2).map((tab) => (
            <SideTab
              key={tab.key}
              tab={tab}
              label={t(language, tab.labelKey)}
              active={activeKey === tab.key}
              onPress={() => onTabPress(tab.key)}
              onMeasure={handleMeasure}
              onRef={(node) => tourTargets?.register(`bar.${tab.stop}`, node)}
            />
          ))}
        </View>
      </CutSurface>
    </Animated.View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  // Absolutely positioned so it floats low over the content (no backdrop strip).
  shell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 18,
  },
  // Absolute in the shell's padding box: the full width, from the bottom up.
  edgeFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: EDGE_FADE,
  },
  pill: {
    // Fill and stroke are set in the component per theme.
    paddingHorizontal: 6,
    shadowColor: '#0B0714',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  // The single sliding highlight. left:0 + translateX centres it on a tab; top is
  // set so the circle sits centred on the icon (icon-only tabs, height 64).
  indicator: {
    position: 'absolute',
    top: 10,
    left: 0,
    width: HIGHLIGHT,
    height: HIGHLIGHT,
    borderRadius: HIGHLIGHT / 2,
    backgroundColor: theme.highlightSoft,
  },
  pressed: {
    transform: [{ scale: 0.95 }],
  },
  sideTab: {
    minWidth: 58,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The AI button now sits INSIDE the pill, centred like the other tabs (no lift).
  centerTab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft purple halo ring + downward/ambient glow around the AI button.
  centerGlow: {
    width: AI_HALO,
    height: AI_HALO,
    borderRadius: AI_HALO / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.16)',
    shadowColor: theme.purpleBright,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.62,
    shadowRadius: 22,
    elevation: 14,
  },
  centerGlowActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.26)',
    shadowOpacity: 0.82,
    shadowRadius: 26,
  },
  aiCircle: {
    width: AI_SIZE,
    height: AI_SIZE,
    borderRadius: AI_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    // Fill and label colour are set in the component per theme.
  },
  aiText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
