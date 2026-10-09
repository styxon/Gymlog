import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

import { isStoreBillingConfigured } from '../features/billing/storeBilling';
import { paymentsAreLive } from '../lib/billingCopy';
import { isDemoBuild } from '../lib/demoMode';
import { CutSurface } from './CutSurface';
import { CUT_BY_SIZE, cutCornerPath } from '../lib/cutCorner';

import { ProMomentContent } from '../lib/proInsights';
import { formatWeight } from '../lib/format';
import { t } from '../lib/i18n';
import { PW } from '../lightTheme';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The contextual paywall sheet (pw-shared.jsx): one benefit, the same topic as
 * the trigger, built on the user's own numbers. Deliberately NO comparison
 * table — that belongs to the full Pro page this sheet's CTA opens.
 *
 * The CTA is honest: it says what Pro does and routes to the Pro page instead
 * of promising a trial that does not exist. The fine print under it says
 * billing is not live only while that is true (lib/billingCopy).
 *
 * A3: the sheet keeps its gradient but takes the cut — the gradient is drawn
 * inside the cut path rather than a rounded rect, so the corner is the same
 * gesture as every card on Home. The chart panel and the CTA are cut surfaces.
 */
interface ProMomentSheetProps {
  visible: boolean;
  content: ProMomentContent | null;
  language: AppLanguage;
  /**
   * Safe-area inset, read on the screen that mounts this sheet — inside this
   * Modal, `useSafeAreaInsets` itself always answers 0 (#bugs 2026-08-28).
   */
  bottomInset: number;
  onClose: () => void;
  onSeePro: () => void;
}

export function ProMomentSheet({ visible, content, language, bottomInset, onClose, onSeePro }: ProMomentSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== box.width || height !== box.height) {
      setBox({ width, height });
    }
  };
  const slide = useRef(new Animated.Value(0)).current;
  const slideTranslate = useRef(slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] })).current;

  useEffect(() => {
    if (!visible) {
      slide.setValue(0);
      return;
    }
    Animated.timing(slide, {
      toValue: 1,
      duration: 380,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [slide, visible]);

  if (!content) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Animated.View style={{ transform: [{ translateY: slideTranslate }] }}>
          <Pressable
            onPress={() => undefined}
            style={[styles.sheet, { paddingBottom: bottomInset + 22 }]}
            onLayout={onLayout}
          >
            {box.width > 0 && box.height > 0 ? (
              <Svg style={StyleSheet.absoluteFill} width={box.width} height={box.height} pointerEvents="none">
                <Defs>
                  <SvgLinearGradient id="pwSheetGradient" x1="0" y1="0" x2="0.4" y2="1">
                    <Stop offset="0" stopColor={PW.sheetTop} />
                    <Stop offset="0.62" stopColor={PW.sheetMid} />
                    <Stop offset="1" stopColor={PW.sheetBottom} />
                  </SvgLinearGradient>
                </Defs>
                {/* The sheet runs off the bottom of the screen, so only the
                    top edge is ever seen: the cut on the left, the matching
                    radius on the right. */}
                <Path d={cutCornerPath(box.width, box.height + 40, CUT_BY_SIZE.lg)} fill="url(#pwSheetGradient)" />
              </Svg>
            ) : null}

            <View style={styles.grip} />
            <View style={styles.eyebrowRow}>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" fill={PW.sheetLavender} />
              </Svg>
              <Text style={styles.eyebrow}>{content.eyebrow}</Text>
            </View>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={styles.lead}>{content.lead}</Text>

            <CutSurface
              size="md"
              fill="rgba(255,255,255,0.07)"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
              style={styles.chartCard}
            >
              <BarsBlock content={content} language={language} />
            </CutSurface>

            <View style={styles.bullets}>
              {content.bullets.map((bullet) => (
                <View key={bullet} style={styles.bulletRow}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 13l4 4L19 7" stroke={PW.sheetMint} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={styles.bulletText}>{bullet}</Text>
                </View>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onSeePro}
              style={({ pressed }) => [styles.ctaWrap, pressed && styles.pressed]}
            >
              {/* White on the gradient, so not the purple CutButton — the same
                  cut, the sheen the primary carries, this sheet's own colour. */}
              <CutSurface size="lg" fill="#FFFFFF" sheen={{ left: 15, width: 13, opacity: 0.35 }} style={styles.cta}>
                <Text style={styles.ctaText}>{t(language, 'pro.sheet.cta')}</Text>
              </CutSurface>
            </Pressable>
            <Text style={styles.fine}>
              {t(language, paymentsAreLive(isDemoBuild(), isStoreBillingConfigured()) ? 'pro.sheet.fineLive' : 'pro.sheet.fine')}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.notNowHit}>
              <Text style={styles.notNow}>{t(language, 'pro.sheet.notNow')}</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** Bars extracted so the language threading stays simple. */
function BarsBlock({ content, language }: { content: ProMomentContent; language: AppLanguage }) {
  const styles = useThemedStyles(makeStyles);

  const values = content.bars;
  // Every bar that is drawn has to be in the scale, projections included —
  // leaving one out lets it compute a height past the row and spill out.
  const all = [values, content.nextValue, content.horizonValue]
    .flat()
    .filter((value): value is number => typeof value === 'number');
  if (all.length === 0) {
    return null;
  }
  const max = Math.max(...all);
  const min = Math.min(...all) - 8;
  const height = (value: number) => Math.max(8, ((value - min) / Math.max(1, max - min)) * 74);

  return (
    <View>
      <Text style={styles.barLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {content.barLabel}
      </Text>
      <View style={styles.barRow}>
        {values.map((value, index) => (
          <View key={index} style={styles.barCol}>
            <View style={[styles.bar, { height: height(value) }]} />
          </View>
        ))}
        {content.nextValue !== null ? (
          <View style={styles.barCol}>
            <Text style={styles.nextValueText} numberOfLines={1}>
              {formatWeight(content.nextValue, 'kg').replace(/\s*kg$/, '')}
            </Text>
            <View style={[styles.bar, styles.barNext, { height: height(content.nextValue) }]} />
          </View>
        ) : null}
        {content.horizonValue !== null ? (
          <View style={styles.barCol}>
            <Text style={[styles.nextValueText, styles.horizonValueText]} numberOfLines={1}>
              {formatWeight(content.horizonValue, 'kg').replace(/\s*kg$/, '')}
            </Text>
            <View style={[styles.bar, styles.barNext, styles.barHorizon, { height: height(content.horizonValue) }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.barCaptionRow}>
        {values.map((value, index) => (
          <Text key={index} style={styles.barCaption}>
            {formatWeight(value, 'kg').replace(/\s*kg$/, '')}
          </Text>
        ))}
        {content.nextValue !== null ? (
          <Text style={[styles.barCaption, styles.barCaptionNext]}>{t(language, 'pro.sheet.nextBar')}</Text>
        ) : null}
        {content.horizonValue !== null ? (
          <Text style={[styles.barCaption, styles.barCaptionNext]}>{t(language, 'pro.sheet.horizonBar')}</Text>
        ) : null}
      </View>
      {/* The assumption, stated. Two of these bars have not happened yet. */}
      {content.horizonValue !== null ? (
        <Text style={styles.projectionNote}>{t(language, 'pro.sheet.projectionNote')}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(16,10,32,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  grip: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    color: PW.sheetLavender,
  },
  title: {
    fontSize: 25,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 30,
    marginTop: 10,
  },
  lead: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 21,
    marginTop: 9,
  },
  chartCard: {
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  barLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.5)',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    height: 100,
    marginTop: 12,
  },
  barCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  bar: {
    width: '100%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  barNext: {
    backgroundColor: 'rgba(201,182,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(201,182,255,0.9)',
    borderStyle: 'dashed',
  },
  nextValueText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: PW.sheetLavender,
  },
  // Still dashed — it has not happened either — but brighter: it is the point.
  barHorizon: {
    backgroundColor: 'rgba(201,182,255,0.26)',
    borderColor: '#FFFFFF',
  },
  horizonValueText: {
    color: '#FFFFFF',
  },
  projectionNote: {
    fontSize: 10.5,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 15,
    marginTop: 10,
  },
  notNowHit: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  barCaptionRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 7,
  },
  barCaption: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
  },
  barCaptionNext: {
    color: PW.sheetLavender,
    fontWeight: '800',
  },
  bullets: {
    marginTop: 16,
    gap: 9,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
  },
  ctaWrap: {
    marginTop: 18,
  },
  cta: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    transform: [{ translateY: 1 }, { scale: 0.985 }],
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2A1A4E',
  },
  fine: {
    fontSize: 11.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 17,
  },
  notNow: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 14,
  },
});
