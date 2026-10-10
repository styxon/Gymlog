import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { measureNode, TourTargetRegistry } from '../features/tour/tourTargets';
import { cutCornerPath } from '../lib/cutCorner';
import {
  calloutCoversTarget,
  CALLOUT_ENTER_MS,
  CALLOUT_LEAVE_MS,
  CALLOUT_SIDE_INSET,
  dimCutoutPath,
  insetRect,
  notchOffset,
  placeCallout,
  rectChanged,
  RING_CUT,
  RING_ENTER_MS,
  RING_PULSE_MS,
  RING_PULSE_SCALE,
  ringBox,
  sectionRingShape,
  TOUR_BAR_STOP_COPY_KEY,
  TOUR_REMEASURE_MS,
  TOUR_RESCROLL_QUIET_MS,
  TourBarStop,
  TourFinishReason,
  TourRect,
  TourRingShape,
  TourSectionBeat,
  TourSurface,
  TourTargetId,
  TourBeat,
  tourStartDelayMs,
} from '../lib/firstRunTour';
import { I18nKey, t } from '../lib/i18n';
import { useTheme, useThemeName } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';
import { CutButton } from './CutButton';
import { CutSurface } from './CutSurface';
import { EASE_RISE } from './vinhaMotion';

/**
 * The first-run tour's guidance layer: a ring around one thing, everything
 * else dimmed and sealed behind it, and a callout beside it, once per surface.
 *
 * It is guided, and that is a reversal. Round 1 shipped a layer that pointed
 * without ever blocking, and the reader's walk on the phone showed what that
 * costs: the page moves under a beat for reasons the layer cannot see — a
 * month panel opening into the week card, a workout list folding taller than
 * the whole band — and the ring spends the tour chasing it. The list case has
 * no good answer at all, because a block taller than the band leaves the
 * callout nowhere to stand. So the dim doubles as a shield: it takes every
 * touch that is not the callout's own two buttons, the page cannot change
 * under a beat, and the ring is always where it belongs (user 2026-09-08).
 *
 * The way out stays one tap, on every beat. Nothing here traps a reader who
 * wants to start training instead.
 *
 * The beat still re-measures on a tick (TOUR_REMEASURE_MS). Not for the
 * reader now — for the tour's own doing: the scroll it runs itself, and the
 * fold Home closes when it is told which beat is up.
 *
 * Tap-to-advance, always: the callout's own button steps the tour. The bar
 * is a single beat whose highlight sweeps the five items on a timer, because
 * the brief asked for one sweep rather than five stops — but the button
 * still steps it by hand, and under reduced motion the sweep is a list.
 */

/** Brand mark on the bar, not copy: the button itself says "AI". */
const AI_MARK = 'AI';

const STOP_TITLE_KEY: Record<Exclude<TourBarStop, 'ai'>, I18nKey> = {
  home: 'tabs.home',
  programs: 'tabs.programs',
  progress: 'tabs.progress',
  profile: 'tabs.profile',
};

interface FirstRunTourProps {
  surface: TourSurface;
  /** Memoised by the parent: effects here key on the index, not the array. */
  beats: TourBeat[];
  registry: TourTargetRegistry;
  language: AppLanguage;
  /** The bar's highlight follows the sweep; null hands it back to the route. */
  onSweep: (stop: TourBarStop | null) => void;
  /**
   * Which section the tour is on, so a screen can put itself in the state the
   * beat describes — Home shuts its folds before the hero beat, so the ring
   * lands on a chevron that is where it will stay. Null when the tour is done.
   */
  onBeatChange?: (target: TourTargetId | null) => void;
  /**
   * Done, skipped, or left mid-way: the surface is marked seen either way.
   * Leaving early is not failure, and the app gets out of the way. The reason
   * is 'skipped' only for the reader's own "Skip the tour" - the one answer
   * that can carry on to a surface after this one (the workout's rest tour).
   */
  onFinish: (surface: TourSurface, reason: TourFinishReason) => void;
}

interface Origin {
  x: number;
  y: number;
}

/** Where a beat is, in the overlay's own coordinates. */
interface TourSpot {
  /** What the ring goes around. */
  ring: TourRect;
  /** What the callout is placed against — the whole section, often. */
  anchor: TourRect;
  shape: TourRingShape;
}

const toLocal = (window: TourRect, origin: Origin): TourRect => ({
  x: window.x - origin.x,
  y: window.y - origin.y,
  width: window.width,
  height: window.height,
});

const sameSpot = (a: TourSpot | null, b: TourSpot): boolean =>
  a !== null && a.shape === b.shape && !rectChanged(a.ring, b.ring) && !rectChanged(a.anchor, b.anchor);

export function FirstRunTour({
  surface,
  beats,
  registry,
  language,
  onSweep,
  onBeatChange,
  onFinish,
}: FirstRunTourProps) {
  const theme = useTheme();
  const themeName = useThemeName();

  const rootRef = useRef<View>(null);
  const originRef = useRef<Origin>({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'beat' | 'done'>('waiting');
  const [index, setIndex] = useState(0);
  const [stopIndex, setStopIndex] = useState(0);
  const [spot, setSpot] = useState<TourSpot | null>(null);
  const [barTop, setBarTop] = useState<number | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(0);
  /**
   * Beats passed over because their target was not on screen. The counter
   * counts the beats the reader sees: "2/4" after a skipped beat would be a
   * number with a hole in it.
   */
  const [passedOver, setPassedOver] = useState(0);
  const finishedRef = useRef(false);
  /** A callout has been on screen at least once. */
  const shownRef = useRef(false);
  /** Set when a beat's rect lands; the enter animation starts once it is drawn. */
  const pendingShowRef = useRef<boolean | null>(null);
  /** When the page last moved under the reader's own finger. */
  const lastScrollAtRef = useRef(0);
  /** The anchor height a corrective scroll was already spent on — once each. */
  const rescrolledForRef = useRef<number | null>(null);
  /**
   * Whether this beat has its first reading yet. The follow tick must not run
   * during the beat's own opening scroll: SCROLL_SETTLE_MS exists because a
   * ring measured mid-scroll lands across two sections, and a tick that
   * ignored it would put that reading on screen before the real one arrived.
   */
  const beatReadyRef = useRef(false);

  // One node per animated view, interpolated once (ref-animated-node-one-view).
  const calloutAnim = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const calloutStyle = useRef({
    opacity: calloutAnim,
    transform: [
      { translateY: calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
      { scale: calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
    ],
  }).current;
  const ringStyle = useRef({
    opacity: ringAnim,
    transform: [
      { scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1] }) },
      // Resting at 0 = scale 1, so this rides along on every beat and only
      // the loop below decides whether it moves. A transform that appears and
      // disappears with the beat would be a node changing views mid-flight.
      { scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, RING_PULSE_SCALE] }) },
    ],
  }).current;
  // Its own style object, so the dim and the ring are two views with two
  // props-nodes reading one value — never one node handed to two views.
  const dimStyle = useRef({ opacity: ringAnim }).current;

  const measureOrigin = useCallback(async (): Promise<Origin> => {
    const measured = await measureNode(rootRef.current);
    if (measured) {
      originRef.current = { x: measured.x, y: measured.y };
    }
    return originRef.current;
  }, []);

  /**
   * A section beat's geometry, right now.
   *
   * `fallback` is what a beat opening with a missing fine target does: it
   * rings the section instead, because the sentence is about the section
   * either way. On the follow tick it is off, and a partial reading is thrown
   * away instead — a screen re-attaches its inline ref callbacks on every
   * render, so a node that is very much on screen can answer nothing for one
   * frame, and letting that through would make the ring flit between the
   * chevron and the whole block four times a second.
   */
  const readSpot = useCallback(
    async (beat: TourSectionBeat, options: { fallback: boolean }): Promise<TourSpot | null> => {
      const wantsAnchor = beat.anchor !== undefined && beat.anchor !== beat.target;
      const [measuredTarget, anchorRect, origin] = await Promise.all([
        registry.measure(beat.target),
        wantsAnchor ? registry.measure(beat.anchor as TourTargetId) : Promise.resolve(null),
        measureOrigin(),
      ]);
      // A row that measures edge to edge because its page margin is padding
      // is rung inside the margin (beat.inset), not across the screen.
      const targetRect = measuredTarget ? insetRect(measuredTarget, beat.inset) : null;
      if (!options.fallback && (!targetRect || (wantsAnchor && !anchorRect))) {
        return null;
      }
      const ringWindow = targetRect ?? anchorRect;
      if (!ringWindow) {
        return null;
      }
      return {
        ring: toLocal(ringWindow, origin),
        anchor: toLocal(anchorRect ?? ringWindow, origin),
        shape: sectionRingShape(beat, targetRect !== null),
      };
    },
    [measureOrigin, registry],
  );

  const finish = useCallback(
    (reason: TourFinishReason = 'done') => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;
      onSweep(null);
      onBeatChange?.(null);
      setPhase('done');
      // Nothing was on screen - every target failed to measure - so there is
      // nothing to mark seen: the tour comes back when the screen next mounts.
      if (shownRef.current) {
        onFinish(surface, reason);
      }
    },
    [onBeatChange, onFinish, onSweep, surface],
  );
  /** "Skip the tour": the reader's no, which is not the same as reaching the end. */
  const skip = useCallback(() => finish('skipped'), [finish]);

  // Leaving mid-tour — a tab press, a workout started — still counts as seen,
  // but only once a callout has actually been on screen. Leaving during the
  // start delay or the first scroll (PR #83 review) showed nothing, and a
  // reader who flicks through the tabs on their first open would otherwise
  // burn all three tours without seeing one. Through refs, so a re-created
  // callback can never fire this early.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(
    () => () => {
      if (shownRef.current) {
        finishRef.current();
      }
    },
    [],
  );

  // Reduced motion decides the start delay; the query always answers.
  useEffect(() => {
    let mounted = true;
    void queryReduceMotion().then((enabled) => {
      if (mounted) {
        setReduceMotion(Boolean(enabled));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null || phase !== 'waiting') {
      return;
    }
    const timer = setTimeout(() => setPhase('beat'), tourStartDelayMs(reduceMotion, surface));
    return () => clearTimeout(timer);
  }, [phase, reduceMotion, surface]);

  const stepTo = useCallback(
    (next: number) => {
      rescrolledForRef.current = null;
      beatReadyRef.current = false;
      if (next >= beats.length) {
        finish();
        return;
      }
      setSpot(null);
      setStopIndex(0);
      setIndex(next);
    },
    [beats.length, finish],
  );

  // Declared before the effect that measures, so the screen has already been
  // told to fold its lists shut by the time the first measurement is taken.
  const beatChangeRef = useRef(onBeatChange);
  beatChangeRef.current = onBeatChange;
  useEffect(() => {
    if (phase !== 'beat') {
      return;
    }
    const beat = beats[index];
    beatChangeRef.current?.(beat && beat.kind === 'section' ? beat.anchor ?? beat.target : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);
  useEffect(() => () => beatChangeRef.current?.(null), []);

  // A section beat: bring the target into the band, measure it once the
  // scroll has settled, then show. A beat whose section is not on this
  // install at all is skipped rather than pointed at.
  useEffect(() => {
    if (phase !== 'beat' || reduceMotion === null) {
      return;
    }
    const beat = beats[index];
    if (!beat) {
      finish();
      return;
    }
    if (beat.kind !== 'section') {
      return;
    }
    let cancelled = false;
    void (async () => {
      // The scroll serves the callout, and the callout is placed against the
      // anchor — so it is the anchor that has to end up with room, not the
      // glyph inside it.
      await registry.scrollIntoView(
        surface,
        beat.anchor ?? beat.target,
        beat.place,
        !reduceMotion,
        beat.scroll ?? 'target',
      );
      const next = await readSpot(beat, { fallback: true });
      if (cancelled) {
        return;
      }
      if (!next) {
        setPassedOver((count) => count + 1);
        stepTo(index + 1);
        return;
      }
      const pill = await registry.measure('bar.pill');
      if (cancelled) {
        return;
      }
      setBarTop(pill ? pill.y - originRef.current.y : null);
      pendingShowRef.current = !reduceMotion;
      beatReadyRef.current = true;
      setSpot(next);
    })();
    return () => {
      cancelled = true;
    };
    // `beats` is memoised by the parent; the effect keys on the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, reduceMotion]);

  // The bar beat: one sweep, hand-cranked. Each stop lights the bar's own
  // highlight and moves the ring; "Seuraava" moves to the next. It used to
  // walk itself on a timer, and no timer was slow enough — a reader who
  // needed longer had no way to ask for it (user 2026-09-09).
  useEffect(() => {
    if (phase !== 'beat' || reduceMotion === null) {
      return;
    }
    const beat = beats[index];
    if (!beat || beat.kind !== 'bar') {
      return;
    }
    const stop = beat.stops[stopIndex];
    if (!stop) {
      return;
    }
    let cancelled = false;
    onSweep(stop);
    void (async () => {
      const [targetRect, origin, pill] = await Promise.all([
        registry.measure(`bar.${stop}`),
        measureOrigin(),
        registry.measure('bar.pill'),
      ]);
      if (cancelled) {
        return;
      }
      if (!targetRect) {
        stepTo(index + 1);
        return;
      }
      setBarTop(pill ? pill.y - origin.y : null);
      if (stopIndex === 0) {
        pendingShowRef.current = !reduceMotion;
      }
      const local = toLocal(targetRect, origin);
      setSpot({ ring: local, anchor: local, shape: stop === 'ai' ? 'bar-ai' : 'bar' });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, stopIndex, reduceMotion]);

  // The enter animation starts after the callout is on screen, never before:
  // a native-driver timing started on a value no view is attached to yet is
  // the kind of thing that works on one renderer and not the other.
  useEffect(() => {
    if (!spot || pendingShowRef.current === null) {
      return;
    }
    const animated = pendingShowRef.current;
    pendingShowRef.current = null;
    shownRef.current = true;
    if (!animated) {
      calloutAnim.setValue(1);
      ringAnim.setValue(1);
      return;
    }
    calloutAnim.setValue(0);
    ringAnim.setValue(0);
    Animated.parallel([
      Animated.timing(calloutAnim, { toValue: 1, duration: CALLOUT_ENTER_MS, easing: EASE_RISE, useNativeDriver: true }),
      Animated.timing(ringAnim, { toValue: 1, duration: RING_ENTER_MS, easing: EASE_RISE, useNativeDriver: true }),
    ]).start();
  }, [calloutAnim, spot, ringAnim]);

  /**
   * A section beat follows its target for as long as it lasts.
   *
   * The shield means the reader can no longer move it, but the tour still
   * can: it scrolls the page itself, and Home folds its day block shut when
   * it is told the hero beat is up. Neither arrives as a scroll event the
   * layer can wait on, so the beat re-measures on a tick and writes state
   * only when the answer actually moved.
   */
  useEffect(() => {
    if (phase !== 'beat') {
      return;
    }
    const beat = beats[index];
    if (!beat || beat.kind !== 'section') {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const sync = () => {
      if (cancelled || inFlight || !beatReadyRef.current) {
        return;
      }
      inFlight = true;
      void (async () => {
        const next = await readSpot(beat, { fallback: false });
        inFlight = false;
        if (cancelled || !next) {
          return;
        }
        setSpot((current) => (sameSpot(current, next) ? current : next));
      })();
    };
    // One clock, deliberately. Measuring on the scroll event itself meant a
    // full-screen path and the whole callout re-rendering thirty times a
    // second on a mid-range phone; the tick catches a drag within 300 ms and
    // costs nothing at all while a beat sits still, because an unchanged
    // rectangle never reaches state. The scroll only notes when the reader
    // last touched the page, so the corrective scroll below can keep off it.
    const timer = setInterval(sync, TOUR_REMEASURE_MS);
    const unsubscribe = registry.subscribeScroll(() => {
      lastScrollAtRef.current = Date.now();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, readSpot, registry]);

  /**
   * A target that grew taller than the band leaves over pushes its own callout
   * back across itself. One corrective scroll fixes that; a loop of them would
   * fight the reader, so it is spent once per anchor height, and only after
   * the page has been still — every movement re-arms the wait.
   */
  useEffect(() => {
    if (phase !== 'beat' || !spot || calloutHeight === 0 || size.width === 0) {
      return;
    }
    const beat = beats[index];
    if (!beat || beat.kind !== 'section') {
      return;
    }
    const placement = placeCallout({
      target: spot.anchor,
      calloutHeight,
      screenHeight: size.height,
      barTop,
      prefer: beat.place,
    });
    if (!calloutCoversTarget(placement, spot.anchor, calloutHeight)) {
      return;
    }
    if (rescrolledForRef.current === spot.anchor.height) {
      return;
    }
    const timer = setTimeout(() => {
      if (Date.now() - lastScrollAtRef.current < TOUR_RESCROLL_QUIET_MS) {
        return;
      }
      rescrolledForRef.current = spot.anchor.height;
      void registry.scrollIntoView(
        surface,
        beat.anchor ?? beat.target,
        beat.place,
        true,
        beat.scroll ?? 'target',
      );
    }, TOUR_RESCROLL_QUIET_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, spot, calloutHeight, barTop, size.height, size.width, registry, surface]);

  /**
   * A ring drawn on one control breathes, so the glyph under it reads as
   * something to press. Keyed on the shape rather than on the spot, so a
   * re-measure four times a second does not restart the loop.
   */
  const ringShape = spot?.shape ?? null;
  useEffect(() => {
    if (phase !== 'beat' || reduceMotion !== false || ringShape !== 'chevron') {
      pulseAnim.setValue(0);
      return;
    }
    const half = RING_PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulseAnim.setValue(0);
    };
  }, [phase, pulseAnim, reduceMotion, ringShape]);

  const advance = useCallback(() => {
    if (phase !== 'beat') {
      return;
    }
    const beat = beats[index];
    if (!beat) {
      return;
    }
    if (beat.kind === 'bar' && reduceMotion === false && stopIndex < beat.stops.length - 1) {
      setStopIndex(stopIndex + 1);
      return;
    }
    const next = index + 1;
    if (reduceMotion) {
      stepTo(next);
      return;
    }
    Animated.parallel([
      Animated.timing(calloutAnim, { toValue: 0, duration: CALLOUT_LEAVE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(ringAnim, { toValue: 0, duration: CALLOUT_LEAVE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        stepTo(next);
      }
    });
  }, [beats, calloutAnim, index, phase, reduceMotion, ringAnim, stepTo, stopIndex]);

  /**
   * Android's back key with a callout up is the way out, the same as Skip: the
   * page is shielded, so "back" to the reader means "not now", and it used to
   * reach the screen under the tour (the player opened its End-workout sheet).
   *
   * No dependency list, on purpose. BackHandler calls the newest listener
   * first, and the player re-subscribes its own whenever the shell re-renders
   * (its onLeave is a new function each time); this layer re-renders with the
   * shell, and its effects run after the page's, so re-subscribing here keeps
   * it newest.
   */
  useEffect(() => {
    if (phase !== 'beat' || !spot) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      skip();
      return true;
    });
    return () => subscription.remove();
  });

  const onRootLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
    void measureOrigin();
  };

  const beat = beats[index] ?? null;
  if (phase !== 'beat' || !beat || !spot || size.width === 0) {
    return <View ref={rootRef} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onRootLayout} />;
  }

  const isBar = beat.kind === 'bar';
  const stop = isBar ? beat.stops[stopIndex] ?? null : null;
  const ring = ringBox(spot.ring, spot.shape);
  const calloutTarget = isBar ? ring : spot.anchor;
  const calloutWidth = size.width - CALLOUT_SIDE_INSET * 2;
  const placement = placeCallout({
    target: calloutTarget,
    calloutHeight: calloutHeight || 120,
    screenHeight: size.height,
    barTop,
    prefer: isBar ? 'above' : beat.place,
  });
  const notchX = notchOffset(calloutTarget, CALLOUT_SIDE_INSET, calloutWidth);
  const listAllStops = isBar && reduceMotion === true;
  const isLast = index + 1 >= beats.length && (!isBar || listAllStops || stopIndex >= beat.stops.length - 1);
  const outlined = spot.shape === 'section' || spot.shape === 'chevron';
  // One beat is not a tour to count through or to skip: a Done button is all.
  const single = beats.length === 1;
  const shownTotal = beats.length - passedOver;

  // In light, the callout is the app's own dark-violet layer — the Pro sheets'
  // and the coach's — with the ink those sheets use on it. In dark it lifts.
  const co = themeName === 'dark'
    ? { surface: theme.purpleLight, ink: theme.ink, muted: theme.muted }
    : { surface: theme.proSheetTop, ink: '#FFFFFF', muted: 'rgba(255,255,255,0.72)' };
  const accent = theme.highlight;
  // Lighter than the sheet scrim (0.72): the page has to stay readable behind
  // it and the accent still has to read as the accent.
  const dimFill = themeName === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(6,4,16,0.35)';
  const title = stop ? (stop === 'ai' ? AI_MARK : t(language, STOP_TITLE_KEY[stop])) : null;
  const body = isBar ? (stop ? t(language, TOUR_BAR_STOP_COPY_KEY[stop]) : '') : t(language, beat.copyKey);

  return (
    <View ref={rootRef} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onRootLayout}>
      {/* The rest of the page goes quiet, and stays still. A dim, not a blur:
          expo-blur cannot be given a hole on Android, and dimming is what the
          ask needs. It is also the shield — `onStartShouldSetResponder` makes
          it the responder for any touch that reaches it, so nothing under it
          moves while a beat is up. Not a Pressable: this is not a control and
          should not be announced as one. It sits below the callout in the
          tree, so the callout's own buttons are still the reader's. */}
      <Animated.View
        pointerEvents="auto"
        onStartShouldSetResponder={() => true}
        style={[StyleSheet.absoluteFill, dimStyle]}
      >
        <Svg width={size.width} height={size.height}>
          <G transform={`translate(${ring.x} ${ring.y})`}>
            <Path d={dimCutoutPath(size, ring, spot.shape)} fill={dimFill} fillRule="evenodd" />
          </G>
        </Svg>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          { left: ring.x - 8, top: ring.y - 8, width: ring.width + 16, height: ring.height + 16 },
          ringStyle,
        ]}
      >
        <Svg width={ring.width + 16} height={ring.height + 16}>
          <G transform="translate(8 8)">
            {spot.shape === 'section' ? (
              <>
                <Path d={cutCornerPath(ring.width, ring.height, RING_CUT)} fill="none" stroke={theme.highlightSoft} strokeWidth={7} />
                <Path d={cutCornerPath(ring.width, ring.height, RING_CUT)} fill="none" stroke={accent} strokeWidth={2} />
              </>
            ) : (
              <>
                {/* On the bar, the bar's own highlight is already under the
                    item and a halo would be a second one. On a chevron there
                    is nothing underneath, so the ring carries its own. */}
                {outlined ? (
                  <Circle
                    cx={ring.width / 2}
                    cy={ring.height / 2}
                    r={ring.width / 2 - 3.5}
                    fill="none"
                    stroke={theme.highlightSoft}
                    strokeWidth={7}
                  />
                ) : null}
                <Circle cx={ring.width / 2} cy={ring.height / 2} r={ring.width / 2 - 1} fill="none" stroke={accent} strokeWidth={2} />
              </>
            )}
          </G>
        </Svg>
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height !== calloutHeight) {
            setCalloutHeight(height);
          }
        }}
        style={[
          styles.calloutWrap,
          { left: CALLOUT_SIDE_INSET, width: calloutWidth, top: placement.top, opacity: calloutHeight ? 1 : 0 },
          calloutHeight ? calloutStyle : null,
        ]}
      >
        <CutSurface size="lg" fill={co.surface} speedLine={{ color: accent }} style={styles.callout}>
          {single && !(title && !listAllStops) ? null : (
            <View style={styles.headRow}>
              {single ? null : (
                <Text style={[styles.counter, { color: co.muted }]}>{`${index + 1 - passedOver}/${shownTotal}`}</Text>
              )}
              {title && !listAllStops ? <Text style={[styles.title, { color: co.ink }]}>{title}</Text> : null}
            </View>
          )}
          {listAllStops ? (
            <View style={styles.stopList}>
              {beat.stops.map((item) => (
                <Text key={item} style={[styles.body, { color: co.ink }]}>
                  <Text style={styles.title}>{item === 'ai' ? AI_MARK : t(language, STOP_TITLE_KEY[item])}</Text>
                  {'  '}
                  {t(language, TOUR_BAR_STOP_COPY_KEY[item])}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={[styles.body, { color: co.ink }]}>{body}</Text>
          )}
          <View style={[styles.footer, single && styles.footerEnd]}>
            {single ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={skip}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
              >
                <Text style={[styles.skipText, { color: co.muted }]}>{t(language, 'tour.skip')}</Text>
              </Pressable>
            )}
            <CutButton size="md" variant="accent" label={t(language, isLast ? 'tour.done' : 'tour.next')} onPress={advance} />
          </View>
        </CutSurface>
        <View
          pointerEvents="none"
          style={[
            styles.notch,
            { left: notchX - 7, backgroundColor: co.surface },
            placement.above ? styles.notchDown : styles.notchUp,
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
  },
  calloutWrap: {
    position: 'absolute',
    shadowColor: '#0B0714',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.34,
    shadowRadius: 26,
    elevation: 12,
  },
  callout: {
    paddingTop: 13,
    paddingRight: 15,
    paddingBottom: 12,
    paddingLeft: 26,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
  },
  counter: {
    fontFamily: 'JetBrainsMono',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 6,
  },
  stopList: {
    gap: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  footerEnd: {
    justifyContent: 'flex-end',
  },
  // A text link, but a 44 dp target: the padding and hitSlop together clear
  // the minimum even though the underline stays small.
  skip: {
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 12.5,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.8,
  },
  // The little triangle that points at the target. Rotated square, so it
  // takes the callout's fill without a second SVG.
  notch: {
    position: 'absolute',
    width: 14,
    height: 14,
    transform: [{ rotate: '45deg' }],
  },
  notchUp: {
    top: -5,
  },
  notchDown: {
    bottom: -5,
  },
});
