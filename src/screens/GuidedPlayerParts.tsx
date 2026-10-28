import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, {
  Circle,
  Defs,
  FeColorMatrix,
  Filter,
  Image as SvgImage,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { getExerciseImageSource } from '../assets/exerciseImages';
import { findGuidedLibraryIndex } from '../lib/guidedPlayer';
import { getDrillLibraryName } from '../lib/drillMedia';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { exerciseInitials } from '../lib/exerciseInitials';
import { DUOTONE_RAMPS, duotoneMatrix } from '../lib/duotone';
import { CtaShimmer } from '../components/CtaShimmer';
import { t } from '../lib/i18n';
import { readableOn, useTheme, useThemeName, useThemedStyles } from '../theming';
import { GPD, makeStyles } from './GuidedPlayerStyles';
import { GPIcon } from './GuidedPlayerMotion';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

/* ── media zone: photo when the library has one, brand-panel initials otherwise ── */
export function MediaZone({
  name,
  library,
  height,
  mode = 'drill',
  showActions = true,
  fit = 'contain',
  language = 'en',
}: {
  name: string;
  library: ExerciseLibraryItem[];
  height: number;
  mode?: 'drill' | 'position' | 'set';
  /** Set screen v4 moves the how-it's-done button into the top bar. */
  showActions?: boolean;
  /** v4 fills the set card edge to edge; other steps keep the whole frame. */
  fit?: 'contain' | 'cover';
  language?: AppLanguage;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const match = useMemo(() => {
    // Warmup/cooldown drills are generated copy with no library entry of their
    // own — they borrow a photo from the exercise that shows the same position.
    const lookupName = getDrillLibraryName(name) ?? name;
    const index = findGuidedLibraryIndex(lookupName, library.map((item) => item.name));
    return index === null ? null : library[index];
  }, [name, library]);
  const themeName = useThemeName();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [name]);

  const imageSource = getExerciseImageSource(match?.imageKey);

  // The media zone always shows the flat photo (or initials). A 3D rig with
  // an on-demand sheet lived here until 2026-08-26 ("poistetaan kaikki 3d
  // videot mitä tehtiin, palaan tähän joskus myöhemmin") — the HowToSheet
  // with written instructions is the how-to path now. The muscle chip was
  // dropped in the v4 pass (user: the label added nothing on any exercise).
  const overlays = null;

  const initials = exerciseInitials(exerciseNameLabel(language, name));
  // The panel is the FLOOR, not the fallback. It used to render only after
  // onError, so a photo that was merely slow left a blank white card filling
  // half the screen with nothing in it — and onError never fires while a
  // request is still in flight. Drawing the panel underneath means the media
  // zone is never empty: the photo arrives on top of it, or it does not.
  const panel = (
    <>
      <View style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <SvgLinearGradient id="gpPanel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F1E9FF" />
              <Stop offset="0.6" stopColor="#E4D5FB" />
              <Stop offset="1" stopColor="#DCCBF8" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gpPanel)" />
        </Svg>
      </View>
      <Text style={styles.mediaInitials}>{initials}</Text>
    </>
  );

  if (imageSource && !imageFailed) {
    const ramp = DUOTONE_RAMPS[themeName];
    return (
      <View style={[styles.mediaZone, { height, backgroundColor: '#E9DCFA', borderColor: '#E6DAF8' }]}>
        {panel}
        {/* The library photos are stock gym shots — red walls, yellow floors —
            and during a set the photo is the biggest thing on the screen, so
            the app looked like two products. Desaturate, then map luminance
            onto a two-colour brand ramp: same picture, same information, our
            colour world. Done at render time rather than baked, which is the
            only way the treatment can follow the theme. */}
        <View style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <Filter id="vinhaDuotone" x="0" y="0" width="100%" height="100%">
                {/* iOS filters in linear light (lib/duotone; owner's #11). */}
                <FeColorMatrix
                  type="matrix"
                  values={duotoneMatrix(ramp.shadow, ramp.light, Platform.OS === 'ios' ? 'linear' : 'srgb')}
                />
              </Filter>
            </Defs>
            <SvgImage
              href={imageSource}
              width="100%"
              height="100%"
              preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
              filter="url(#vinhaDuotone)"
            />
          </Svg>
        </View>
        {overlays}
      </View>
    );
  }

  return (
    <View style={[styles.mediaZone, { height, backgroundColor: '#E9DCFA', borderColor: '#E6DAF8' }]}>
      {panel}
      {overlays}
    </View>
  );
}

/**
 * Rest countdown drawn as a draining ring. `plannedSeconds` sets the full
 * circle; ±15s can push the remaining time past it, so the ring grows to the
 * largest value it has seen for this rest instead of overflowing.
 */
export function RestRing({
  stepKey,
  leftSeconds,
  plannedSeconds,
  size = 244,
  /** The arc's colour. An interval's work bout draws it in the highlight. */
  stroke,
  children,
}: {
  stepKey: number;
  leftSeconds: number;
  plannedSeconds: number;
  size?: number;
  stroke?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  const [total, setTotal] = useState(Math.max(1, plannedSeconds));

  useEffect(() => {
    setTotal(Math.max(1, plannedSeconds));
  }, [stepKey, plannedSeconds]);

  useEffect(() => {
    setTotal((current) => (leftSeconds > current ? leftSeconds : current));
  }, [leftSeconds]);

  const strokeWidth = 10;
  const radius = (size - strokeWidth * 1.6) / 2;
  const circumference = 2 * Math.PI * radius;
  /*
   * A drained ring is a full ring, not an empty one.
   *
   * The arc shrinks as the wait runs down, so at zero it had no length at all
   * and the only thing left on screen was the track — which meant the rest
   * screen's "the wait is over" state was drawn in the track's colour instead
   * of the accent it asks for (device 2026-09-04). Now the arc closes back up
   * at zero and takes the over-colour with it.
   */
  const over = leftSeconds <= 0;
  const fraction = over ? 1 : Math.max(0, Math.min(1, leftSeconds / total));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* The track was a light-theme hex on both themes: a bright lilac ring
            on a near-black page, brighter than the arc it was backing. */}
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.purpleLight} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke ?? theme.purple}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          // Start the arc at 12 o'clock and drain clockwise.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

/* ── shared small components ── */
export function TopBar({
  dark,
  language,
  label,
  clock,
  muted,
  onMute,
  onExit,
  video,
}: {
  dark: boolean;
  /** For the two icon buttons' names — they had none. */
  language: AppLanguage;
  /**
   * What the screen is, beside the clock — only where nothing under the bar
   * says it: the do-it-yourself block. The player's own screens pass none.
   */
  label?: string;
  /**
   * Session elapsed, m:ss. The one clock in the session, and it belongs here:
   * it is the only number that is true on every screen, so anywhere else it
   * has to be drawn again — and it was, on the set screen, in a row that runs
   * out of width the moment a lift has a long name.
   */
  clock: string | null;
  muted: boolean;
  onMute: () => void;
  onExit: () => void;
  /**
   * Set screen v4: the right slot shows the how-it's-done camera instead of
   * mute, and mute moves down beside pause.
   */
  /** `active` lights the button while the panel it opens is showing. */
  video?: { label: string; onPress: () => void; active?: boolean } | null;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const iconColor = dark ? GPD.ink : theme.ink;
  const buttonStyle = [styles.topBtn, dark ? styles.topBtnDark : null];
  return (
    <View style={styles.topBar}>
      {/* Both corners were bare icons, announced as "button" and nothing
          else (accessibility audit, 2026-09-21). The sound toggle is a
          switch: on means the cues play. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(language, 'guided.a11y.exit')}
        onPress={onExit}
        style={buttonStyle}
        hitSlop={8}
      >
        <GPIcon name="x" size={19} color={iconColor} />
      </Pressable>
      {/* No label is the clock alone, centred (#bugs 2026-09-30). */}
      <Text style={[styles.topLabel, { color: dark ? GPD.muted : theme.muted }]} numberOfLines={1}>
        {[label, clock].filter(Boolean).join(' · ')}
      </Text>
      {video ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: video.active }}
          accessibilityLabel={video.label}
          onPress={video.onPress}
          style={[buttonStyle, video.active ? styles.topBtnActive : null]}
          hitSlop={8}
        >
          <GPIcon name="video" size={20} color={video.active ? theme.purple : iconColor} sw={2.1} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={t(language, 'guided.a11y.soundCues')}
          accessibilityState={{ checked: !muted }}
          onPress={onMute}
          style={buttonStyle}
          hitSlop={8}
        >
          <GPIcon name={muted ? 'mute' : 'sound'} size={19} color={muted ? (dark ? GPD.faint : theme.faint) : iconColor} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The rail is also the way in to the run sheet.
 *
 * It was already the only thing on screen that stood for the whole session
 * rather than for this moment of it — it just could not be read, being dots.
 * Making it the handle keeps the player at one control per screen: nothing new
 * appears, the thing that was already there answers a question it was already
 * being asked ("Treenin aikana ei ole mitään keinoa nähdä seuraavaa liikettä",
 * #bugs 2026-08-27).
 */
export function ProgressRail({
  groups,
  current,
  dotIndex,
  dotsDone,
  onPress,
  openLabel,
}: {
  /**
   * One phase's groups, not the session's — three drills, five exercises, two
   * stretches. Sliced by `getGuidedPhaseRail`; the top bar counts the same
   * groups ("2/6").
   */
  groups: Array<{ phase: string; setCount?: number }>;
  current: number;
  dotIndex: number;
  dotsDone: number;
  onPress?: () => void;
  openLabel?: string;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const Rail = onPress ? Pressable : View;

  return (
    <Rail
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? openLabel : undefined}
      onPress={onPress}
      // The dots are small and the bar is thin; the target is the strip.
      hitSlop={onPress ? 10 : undefined}
      style={styles.rail}
    >
      {groups.map((group, index) => {
        const isCurrent = index === current;
        const done = index < current;
        // No phase gap any more: the rail holds one phase, so every segment
        // in it is the same kind of thing and they space evenly.
        if (isCurrent && (group.setCount ?? 0) > 1) {
          return (
            <View
              key={index}
              style={[
                styles.railSetPill,
                {
                  marginLeft: 5,
                  backgroundColor: theme.highlightSoft,
                  // The rim marks the current exercise; done and still-to-come
                  // are flat bars. Amber held this job from 2026-09-01, when
                  // the problem was that current and done were the same violet
                  // told apart by two pixels of height. `highlight` solves that
                  // as well as amber did and gives amber back to caution, which
                  // the session now uses for a flagged body part.
                  borderColor: theme.highlight,
                },
              ]}
            >
              {Array.from({ length: group.setCount ?? 0 }).map((_, dot) => (
                <View
                  key={dot}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor:
                      dot < dotsDone
                        ? theme.green
                        : dot === dotIndex
                          ? theme.highlight
                          : theme.faint,
                    opacity: dot === dotIndex && dot >= dotsDone ? 0.9 : dot < dotsDone ? 1 : 0.45,
                  }}
                />
              ))}
            </View>
          );
        }
        return (
          <View
            key={index}
            style={{
              flex: isCurrent ? 2 : 1,
              marginLeft: index === 0 ? 0 : 5,
              height: isCurrent ? 7 : 5,
              borderRadius: 999,
              // Three states, three meanings, and the same two colours the
              // rest of the session uses: green is done, `highlight` is where
              // you are, and what is still coming is neither.
              //
              // Current was amber from 2026-09-01, which fixed the real
              // problem — current and done were both violet, told apart by two
              // pixels of height at arm's length — with the one colour the
              // flow now needs for a flagged body part. `highlight` separates
              // them just as far and means the same thing here it means on
              // every button.
              backgroundColor: isCurrent ? theme.highlight : done ? theme.green : theme.faint,
              opacity: isCurrent ? 1 : done ? 0.85 : 0.35,
            }}
          />
        );
      })}
    </Rail>
  );
}

export function NextLine({ text, dark, language }: { text: string | null; dark: boolean; language: AppLanguage }) {
  const theme = useTheme();

  if (!text) {
    return <View style={{ height: 20 }} />;
  }
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 26 }}>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: dark ? GPD.muted : theme.muted }} numberOfLines={1}>
        <Text style={{ color: dark ? GPD.faint : theme.faint }}>{t(language, 'guided.next.prefix')}</Text>
        {text}
      </Text>
    </View>
  );
}

export function NameBlock({
  name,
  hasHowTo,
  language,
  onHow,
}: {
  name: string;
  hasHowTo: boolean;
  language: AppLanguage;
  onHow: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={{ paddingHorizontal: 26, alignItems: 'center' }}>
      <Text
        style={styles.exerciseName}
        numberOfLines={2}
        accessibilityLabel={exerciseNameLabel(language, name)}
      >
        {exerciseListLabel(language, name)}
      </Text>
      {hasHowTo ? (
        <Pressable onPress={onHow} style={styles.cueRow}>
          <Text style={styles.howToLink}>{t(language, 'guided.howTo')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CtrlBtn({
  icon,
  label,
  onPress,
  big,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  big?: boolean;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const size = big ? 62 : 52;
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 6, width: 66 }}>
      <View style={[styles.ctrlCircle, { width: size, height: size }]}>
        <GPIcon name={icon} size={big ? 24 : 21} color={theme.ink} />
      </View>
      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.muted }}>{label}</Text>
    </Pressable>
  );
}

export function BigBtn({
  label,
  onPress,
  color: colorProp,
  icon = 'check',
  disabled,
  shimmer,
  tall,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  /** A green tick on a button that stops something reads as confirm. */
  icon?: string;
  disabled?: boolean;
  /**
   * A band of light across the button as the screen arrives — the same mark
   * the Home CTA wears (design 2026-08-26). Opt-in: it belongs on the one
   * button a screen exists to get pressed, not on every button.
   */
  shimmer?: boolean;
  /** For a screen whose whole job is this one decision. */
  tall?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Orange, not green. The dark theme collapses the two accent families —
  // anything pressable is orange, violet carries brand — and green is the
  // colour of "done", not of "press me". A green "Valmis — aloita treeni" put
  // the finished colour on the button that starts the thing (#bugs 2026-08-26).
  const color = colorProp ?? theme.accent;
  // Derived from the fill, not fixed: callers paint this button `theme.ink` to
  // mean "the quiet one", and ink is near-white under the dark theme — so a
  // hard-coded white label made the button read as blank.
  const foreground = readableOn(color);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.bigBtn,
        tall && styles.bigBtnTall,
        { backgroundColor: color, opacity: disabled ? 0.6 : 1, shadowColor: color },
      ]}
    >
      {shimmer && !disabled ? <CtaShimmer tint={`${foreground}55`} /> : null}
      <GPIcon name={icon} size={tall ? 23 : 20} color={foreground} sw={2.6} />
      <Text style={[styles.bigBtnText, tall && styles.bigBtnTextTall, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A row of the swap list: the name reads from the left and may wrap to two
 * lines. The list used GhostBtn — a fixed 48 dp, centred, unpadded button —
 * and a long Finnish name touched its border or wrapped out of it
 * (#bugs 2026-09-27).
 */
export function GhostBtn({
  label,
  onPress,
  icon,
  dark,
  danger,
  tint: tintProp,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  dark?: boolean;
  /** Throws work away. Named for what it does, not for the colour it takes. */
  danger?: boolean;
  /** Outline and text in one colour, for a label that means a direction. */
  tint?: string;
  /** When the visible label is a symbol ("+15s") rather than words. */
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? (danger ? theme.danger : dark ? GPD.ink : theme.ink);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[
        styles.ghostBtn,
        dark ? { borderColor: GPD.line, backgroundColor: 'rgba(255,255,255,0.06)' } : null,
        danger || tintProp ? { borderColor: tint } : null,
      ]}
    >
      {icon ? <GPIcon name={icon} size={17} color={tint} /> : null}
      <Text style={[styles.ghostBtnText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}
