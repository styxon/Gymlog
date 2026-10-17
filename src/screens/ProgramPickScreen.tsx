import React from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Polygon, Stop } from 'react-native-svg';

import { HG } from '../lightTheme';
import { HG_DARK } from '../darkTheme';
import { darkTheme, Theme, useTheme, useThemeName } from '../theming';
import { PROGRAM_FOCUS_COLORS, ProgramFocusSegment,
  getProgramFocusQualityLabel,
} from '../lib/programFocusSplit';
import { formatPercent } from '../lib/format';
import { resolvePickSeam } from '../lib/programPickSeam';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/models';

/**
 * "Pick your program", from design 08b variant D (`coverfixed`).
 *
 * Two programs own the whole screen, divided by one diagonal seam. The chosen
 * half swells (64/58 → 44/36 of the height) so the choice is felt rather than
 * just checked, and the other collapses to its name and key numbers. The CTA is
 * pinned at the bottom on every selection — the design's own argument is that
 * it must never move, because it does not move anywhere else in onboarding.
 *
 * React Native has no `clip-path`, so the seam is drawn: each half's background
 * is an SVG polygon in a 0–100 viewBox with `preserveAspectRatio="none"`, which
 * scales the shape to whatever the phone gives us. The content then sits inside
 * the rectangle that is safely clear of the slant, which is the same thing the
 * design's `safe` height was doing.
 */

const SEAM_PCT = 1.2;
/*
 * Where the seam sits lives in src/lib/programPickSeam: fixed fractions are
 * only its starting point now, and the measured cards decide where it can go.
 */
/**
 * Room the pinned CTA needs at the foot of the screen: the 52pt pill, its
 * bottom padding and a gap, so the last line of the chosen card never runs
 * under it.
 */
// 116 put "KATSO VIIKKO" right against the pill when the lower programme was
// the selected one — its block bottom-aligns into this gap (user, 2026-08-19).
const CTA_ROOM = 140;

export interface ProgramPickOption {
  id: string;
  title: string;
  days: number;
  mins: number;
  weeks: number;
  totalWorkouts: number;
  recommended: boolean;
  focus: ProgramFocusSegment[];
}

/**
 * One cell of the week strip: a weekday and whether it trains.
 *
 * Replaced a row per training day (user, 2026-09-09). The list grew with the
 * programme, so a five- or six-day week pushed its own first rows out of the
 * card and the reader watched the text vanish upward. Seven cells are seven
 * cells whatever the programme does, and the question the card is answering
 * here is which days, not which exercises — those are one tap away on Home.
 */
export interface ProgramPickWeekDay {
  id: string;
  /** Already localised and already short: "Ma", "Mon". */
  weekday: string;
  training: boolean;
}

export interface ProgramPickScreenProps {
  language?: AppLanguage;
  title: string;
  meta: string;
  options: ProgramPickOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  ctaLabel: string;
  onContinue: () => void;
  /**
   * The composed week, listed INSIDE the selected card.
   *
   * It used to be a text link to a full screen of its own. The card is a
   * top-anchored box in a fixed half, so everything under the focus bar was
   * empty purple — the reader was looking at a void and a link to somewhere
   * else, when the void was exactly the size of the thing the link pointed at
   * (user 2026-09-07). One screen fewer, and the week is on the screen that
   * asks you to commit to it.
   */
  week?: ProgramPickWeekDay[];
  /** Section label above the week, e.g. "YOUR WEEK". */
  weekLabel?: string;
  /**
   * A line under the strip. Carries the one thing a rolling rhythm has to say
   * and a weekday plan does not: that it repeats on its own length and is not
   * tied to weekdays.
   */
  weekNote?: string;
  /**
   * The status-bar ICON style the shell should use here: 'light' icons for a
   * dark title band, 'dark' icons for a pale one. null hands the shell its own
   * default back when the screen goes away.
   */
  onTopToneChange?: (iconStyle: 'light' | 'dark' | null) => void;
  busy?: boolean;
}

function FocusBar({ focus, light, language }: { focus: ProgramFocusSegment[]; light: boolean; language: AppLanguage }) {
  const styles = stylesFor(useTheme());
  if (focus.length === 0) {
    return null;
  }
  return (
    <View>
      <Text style={[styles.splitLabel, light && styles.splitLabelLight]}>
        {t(language, 'onb.pick.whereWeekGoes')}
      </Text>
      <View style={styles.splitTrack}>
        {focus.map((segment) => (
          <View
            key={segment.quality}
            style={{ flex: segment.pct, backgroundColor: PROGRAM_FOCUS_COLORS[segment.quality], borderRadius: 2 }}
          />
        ))}
      </View>
      <View style={styles.splitLegend}>
        {focus.map((segment) => (
          <View key={segment.quality} style={styles.splitLegendItem}>
            <View style={[styles.splitDot, { backgroundColor: PROGRAM_FOCUS_COLORS[segment.quality] }]} />
            <Text style={[styles.splitLegendText, light && styles.splitLegendTextLight]}>
              {/* getProgramFocusQualityLabel exists and had no caller: the
                  quality is an English identifier, and printing it put
                  "Strength 97% · Conditioning 3%" on the plan-ready screen. */}
              {getProgramFocusQualityLabel(segment.quality, language)}{' '}
              <Text style={[styles.splitPct, light && styles.splitPctLight]}>{formatPercent(segment.pct, language)}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Check({ selected }: { selected: boolean }) {
  const theme = useTheme();
  const styles = stylesFor(theme);
  return (
    <View style={[styles.check, selected ? styles.checkOn : styles.checkOff]}>
      {selected ? (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={paletteFor(theme).purple} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M5 12l5 5L19 7" />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * The diagonal cover: a flat ground and a scrim over it, both inside the
 * polygon, so the seam is one shape rather than a stack of clipped rectangles.
 *
 * It was striped until 2026-10-17. A 4-unit pattern in a viewBox stretched
 * with preserveAspectRatio="none" came out as a jagged chevron weave on the
 * iPhone, and it was the loudest thing on the page (user, #bugs).
 */
function HalfCover({ points, light, id }: { points: string; light: boolean; id: string }) {
  // `light` means "this is the chosen, purple half" — not the theme. The
  // purple is the same in both themes; it is the OTHER half that has to
  // follow the theme, and painting it white on a dark run is what put a
  // white slab under the purple one (user 2026-08-24).
  const C = paletteFor(useTheme());
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={`scrim-${id}`} x1="0" y1="0" x2="0.45" y2="1">
          <Stop offset="0" stopColor={light ? '#5B21B6' : C.quietScrim} stopOpacity={light ? 0.55 : 0.6} />
          <Stop offset="1" stopColor={light ? '#5B21B6' : C.quietScrim} stopOpacity={light ? 0.92 : 0.93} />
        </SvgLinearGradient>
      </Defs>
      <Polygon points={points} fill={light ? '#6D28D9' : C.quietStripe} />
      <Polygon points={points} fill={`url(#scrim-${id})`} />
    </Svg>
  );
}

export function ProgramPickScreen({
  language = 'en',
  title,
  meta,
  options,
  selectedId,
  onSelect,
  ctaLabel,
  onContinue,
  week,
  weekLabel,
  weekNote,
  onTopToneChange,
  busy = false,
}: ProgramPickScreenProps) {
  const theme = useTheme();
  const styles = stylesFor(theme);
  // Full-bleed: the diagonal runs to the top edge, so the shell hands the
  // status-bar strip back and the screen insets its own copy instead.
  const insets = useSafeAreaInsets();
  const [height, setHeight] = React.useState(0);
  const top = options[0] ?? null;
  const bottom = options[1] ?? null;
  const topSelected = top !== null && selectedId === top.id;

  /**
   * Each card's natural height, measured, so the seam can make room for it.
   * Keyed by programme and by state: a card is a different height chosen
   * than collapsed, and both are needed to place one seam.
   */
  const [contentHeights, setContentHeights] = React.useState<Record<string, number>>({});
  const measureContent = (key: string) => (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setContentHeights((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };
  const chosen = topSelected ? top : bottom;
  const collapsed = topSelected ? bottom : top;
  const [l, r] = resolvePickSeam({
    height,
    topSelected,
    selectedContentHeight: chosen ? contentHeights[`${chosen.id}:selected`] ?? 0 : 0,
    collapsedContentHeight: collapsed ? contentHeights[`${collapsed.id}:collapsed`] ?? 0 : 0,
    ctaRoom: CTA_ROOM,
  });
  const topPoints = `0,0 100,0 100,${r * 100} 0,${l * 100}`;
  const bottomPoints = `0,${l * 100 + SEAM_PCT} 100,${r * 100 + SEAM_PCT} 100,100 0,100`;
  // Rectangles that stay clear of the slant, so no line of type lands in the
  // slanted corner. Same intent as the design's `safe`.
  const topSafePct = Math.min(l, r) * 100 - 3;
  const bottomSafePct = 100 - Math.max(l, r) * 100 - 4;
  // Every pixel belongs to one half or the other; the split is the seam's
  // midpoint, so a tap can never be ambiguous.
  const seamMidPct = ((l + r) / 2) * 100;

  // The tone of what sits UNDER the status bar. That used to be whichever
  // half was selected; it is the title band now, so it follows the theme and
  // stops flipping every time the reader taps the other programme.
  const themeName = useThemeName();
  // Icons are the OPPOSITE of the band: this reported the band's own tone, so
  // the dark theme got dark icons on a dark header and the clock vanished
  // (user, 2026-10-12). Cleared on the way out so the previous style returns.
  React.useEffect(() => {
    onTopToneChange?.(themeName === 'dark' ? 'light' : 'dark');
    return () => onTopToneChange?.(null);
  }, [onTopToneChange, themeName]);

  const onLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);

  const renderHalf = (option: ProgramPickOption | null, isTop: boolean) => {
    if (!option) {
      return null;
    }
    const selected = selectedId === option.id;
    const light = selected;
    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.halfContent,
          isTop
            ? {
                top: 0,
                height: `${topSafePct}%`,
                justifyContent: selected ? 'flex-start' : 'center',
                // Was `insets.top + 78`, reserving room for the title that used
                // to float over this half. The title has its own band now, and
                // the split starts below it, so the inset is already spent.
                paddingTop: 18,
              }
            : {
                // Anchored to its TOP edge, not sized from the bottom. As
                // `bottom: CTA_ROOM` + `height: N%`, the box was lifted by the
                // CTA's 116pt on top of the safe fraction — so its top sat
                // 116pt above the seam and the second programme's title landed
                // under the recommended card's slant, hard to read (reported
                // 2026-08-18). Top-anchoring keeps the safe rectangle safe and
                // lets CTA_ROOM only trim the bottom.
                top: `${100 - bottomSafePct}%`,
                bottom: CTA_ROOM,
                justifyContent: selected ? 'flex-end' : 'center',
              },
        ]}
      >
        {/* Everything except the week link ignores touches outright, so the
            WHOLE half is the tap target. The old pass-through relied on plain
            Views not being targets, and it was not true of all of them —
            selection only registered from certain spots (user 2026-08-23).
            The week link renders after this block, interactive. */}
        <View pointerEvents="none" onLayout={measureContent(`${option.id}:${selected ? 'selected' : 'collapsed'}`)}>
          <View style={styles.halfHead}>
            <View style={styles.halfHeadCopy}>
              {option.recommended ? (
                <View style={[styles.badge, light ? styles.badgeLight : styles.badgeDark]}>
                  <Text style={[styles.badgeText, light ? styles.badgeTextLight : styles.badgeTextDark]}>
                    {t(language, 'onb.pick.recommended')}
                  </Text>
                </View>
              ) : null}
              {/* No description sentence under the name any more (user
                  2026-08-23, "tyhmää geneeristä ai tekstiä"): the name, the
                  numbers and the focus bar are the card. */}
              <Text style={[styles.name, selected && styles.nameSelected, light && styles.textLight]} numberOfLines={2}>
                {option.title}
              </Text>
            </View>
            <Check selected={selected} />
          </View>

          {selected ? (
            <>
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{t(language, 'onb.pick.daysValue', { count: option.days })}</Text>
                  <Text style={styles.statLabel}>{t(language, 'onb.pick.perWeek')}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{t(language, 'onb.pick.minsValue', { count: option.mins })}</Text>
                  <Text style={styles.statLabel}>{t(language, 'onb.pick.perSession')}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{t(language, 'onb.pick.weeksValue', { count: option.weeks })}</Text>
                  <Text style={styles.statLabel}>
                    {t(language, 'onb.pick.workoutsValue', { count: option.totalWorkouts })}
                  </Text>
                </View>
              </View>
              <View style={styles.splitWrap}>
                <FocusBar focus={option.focus} light language={language} />
              </View>
              {week && week.length ? (
                <View style={styles.week}>
                  {weekLabel ? <Text style={styles.weekLabel}>{weekLabel}</Text> : null}
                  <View style={styles.weekStrip}>
                    {week.map((day) => (
                      <View
                        key={day.id}
                        style={[styles.weekCell, day.training && styles.weekCellOn]}
                        accessible
                        accessibilityLabel={day.weekday}
                      >
                        <Text style={[styles.weekCellDay, day.training && styles.weekCellDayOn]}>
                          {day.weekday}
                        </Text>
                        <View style={[styles.weekDot, day.training && styles.weekDotOn]} />
                      </View>
                    ))}
                  </View>
                  {weekNote ? <Text style={styles.weekNote}>{weekNote}</Text> : null}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.compactStats}>
              {[
                t(language, 'onb.pick.daysValue', { count: option.days }),
                t(language, 'onb.pick.minsValue', { count: option.mins }),
                t(language, 'onb.pick.weeksValue', { count: option.weeks }),
                t(language, 'onb.pick.workoutsValue', { count: option.totalWorkouts }),
              ].join('  ·  ')}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      {/* The title is its own band, above the split (user 2026-08-24: "voisiko
          ohjelmasi on valmis otsikko jäädä omana osanaan").

          It used to lie ON the top half and flip white when that half was
          selected, which is three of the reports at once: it vanished on the
          light card, it could not follow the theme, and the screen read as
          "too white". A band with its own surface cannot disappear behind
          either choice, because it is not on either of them. */}
      <View style={[styles.titleBand, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      <View style={styles.split} onLayout={onLayout}>
      {top ? <HalfCover points={topPoints} light={topSelected} id="top" /> : null}
      {bottom ? <HalfCover points={bottomPoints} light={!topSelected} id="bottom" /> : null}

      {/* Touch targets first, content on top of them. */}
      {top ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: topSelected }}
          accessibilityLabel={top.title}
          onPress={() => onSelect(top.id)}
          style={[styles.hit, { top: 0, height: height > 0 ? (height * seamMidPct) / 100 : '58%' }]}
        />
      ) : null}
      {bottom ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !topSelected }}
          accessibilityLabel={bottom.title}
          onPress={() => onSelect(bottom.id)}
          style={[styles.hit, { top: height > 0 ? (height * seamMidPct) / 100 : '58%', bottom: 0 }]}
        />
      ) : null}

      {renderHalf(top, true)}
      {renderHalf(bottom, false)}

      {/* Pinned, always. It takes the selected card's contrast so it reads as
          the same surface the choice was made on. */}
      <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          disabled={busy}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.cta,
            topSelected ? styles.ctaOnPurple : styles.ctaOnWhite,
            pressed && styles.pressed,
            busy && styles.ctaBusy,
          ]}
        >
          <Text style={[styles.ctaText, topSelected ? styles.ctaTextOnPurple : styles.ctaTextOnWhite]}>
            {ctaLabel}
          </Text>
          <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={topSelected ? paletteFor(theme).onCta : HG.purpleDark}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M5 12h13M12 5l7 7-7 7" />
          </Svg>
        </Pressable>
      </View>
      </View>
    </View>
  );
}

const PAD = 22;

/**
 * The last screen of onboarding, in two palettes.
 *
 * The selected half is purple in both themes — that is the whole diagonal
 * device and it does not need a dark version. What did need one is the
 * *unselected* half, which was painted white: on a dark run the screen came
 * out purple over a white slab, reported from the phone 2026-08-24.
 *
 * Light values are the originals, same rule as the other onboarding screens.
 */
interface PickPalette {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  border: string;
  purple: string;
  purpleDark: string;
  purpleLight: string;
  /** The quiet half's diagonal fill: a flat ground and the scrim over it. */
  quietStripe: string;
  quietScrim: string;
  /** The CTA on the chosen half: the theme's orange and the ink made for it. */
  cta: string;
  onCta: string;
}

const PICK_LIGHT: PickPalette = {
  bg: HG.bg,
  ink: HG.ink,
  muted: HG.muted,
  faint: HG.faint,
  border: HG.border,
  purple: HG.purple,
  purpleDark: HG.purpleDark,
  purpleLight: HG.purpleLight,
  quietStripe: '#E9E1F8',
  quietScrim: '#FFFFFF',
  cta: HG.orange,
  onCta: HG.onHighlight,
};

const PICK_DARK: PickPalette = {
  bg: HG_DARK.bg,
  ink: HG_DARK.ink,
  muted: HG_DARK.muted,
  faint: HG_DARK.faint,
  border: HG_DARK.border,
  purple: HG_DARK.purple,
  purpleDark: HG_DARK.purpleBright,
  purpleLight: HG_DARK.purpleLight,
  quietStripe: HG_DARK.surfaceSoft,
  quietScrim: HG_DARK.bg,
  cta: HG_DARK.orange,
  onCta: HG_DARK.onHighlight,
};

const paletteFor = (theme: Theme): PickPalette => (theme === darkTheme ? PICK_DARK : PICK_LIGHT);
/** Forward reference: the two sheets are built at the foot of the file. */
const stylesFor = (theme: Theme) => (theme === darkTheme ? PICK_STYLES.dark : PICK_STYLES.light);

const makePickStyles = (C: PickPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  hit: { position: 'absolute', left: 0, right: 0 },
  halfContent: { position: 'absolute', left: 0, right: 0, paddingHorizontal: PAD },

  /**
   * The band's own surface, not the screen's: it has to stay legible whichever
   * half is selected, which is the whole reason it stopped being an overlay.
   */
  titleBand: { backgroundColor: C.bg, paddingHorizontal: PAD, paddingBottom: 14 },
  split: { flex: 1, overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.65, color: C.ink },
  meta: { fontSize: 12.5, fontWeight: '600', marginTop: 4, color: C.muted },
  textLight: { color: '#FFFFFF' },

  halfHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  halfHeadCopy: { flex: 1, minWidth: 0 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginBottom: 8 },
  badgeLight: { backgroundColor: 'rgba(255,255,255,0.2)' },
  badgeDark: { backgroundColor: C.purpleLight },
  badgeText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3 },
  badgeTextLight: { color: '#FFFFFF' },
  badgeTextDark: { color: C.purpleDark },
  // Bigger since 2026-08-23 ("vain isolla ohjelman nimi") — the description
  // sentence under it is gone, so the name carries the card.
  name: { fontSize: 26, fontWeight: '800', letterSpacing: -0.65, lineHeight: 28, color: C.ink },
  nameSelected: { fontSize: 34, lineHeight: 36, letterSpacing: -0.85 },

  statRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.24)',
  },
  stat: { flex: 1 },
  statValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.44, lineHeight: 24 },
  statLabel: { fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.72)', marginTop: 2 },

  splitWrap: { marginTop: 14 },
  splitLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.15, color: C.faint, marginBottom: 7 },
  splitLabelLight: { color: 'rgba(255,255,255,0.7)' },
  splitTrack: { flexDirection: 'row', height: 7, gap: 2, borderRadius: 999, overflow: 'hidden' },
  splitLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 13, marginTop: 8 },
  splitLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  splitDot: { width: 8, height: 8, borderRadius: 2 },
  splitLegendText: { fontSize: 11, fontWeight: '700', color: C.muted },
  splitLegendTextLight: { color: 'rgba(255,255,255,0.85)' },
  splitPct: { fontWeight: '800', color: C.ink },
  splitPctLight: { color: '#FFFFFF' },

  // The week fills the card's own empty half. Rows are deliberately compact:
  // a six-day programme has to fit the same box a three-day one leaves mostly
  // empty, so the row height is what six of them can afford.
  week: { marginTop: 16, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.24)' },
  weekLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.15, color: 'rgba(255,255,255,0.7)', marginBottom: 8 },
  weekStrip: { flexDirection: 'row', gap: 6 },
  // Every cell the same width, so the strip is the same height and shape for a
  // two-day programme and a six-day one.
  weekCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  weekCellOn: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.40)' },
  weekCellDay: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: 'rgba(255,255,255,0.60)' },
  weekCellDayOn: { color: '#FFFFFF' },
  // Filled for training, hollow for rest: the difference a reader can see at
  // arm's length, where a colour difference alone would not carry.
  weekDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  weekDotOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  weekNote: {
    marginTop: 10,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.66)',
  },

  compactStats: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginTop: 12 },

  check: { width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#FFFFFF' },
  checkOff: { borderWidth: 2, borderColor: C.border },

  ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: PAD },
  cta: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // Orange on the chosen violet half: orange is what can be pressed (user
  // 2026-10-17). The same pair as the onboarding Continue.
  ctaOnPurple: {
    backgroundColor: C.cta,
    shadowColor: C.cta,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.34,
    shadowRadius: 28,
    elevation: 8,
  },
  ctaOnWhite: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#230A50',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
    elevation: 8,
  },
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: 16.5, fontWeight: '800' },
  ctaTextOnPurple: { color: C.onCta },
  // Fixed with the white CTA it sits on: C.purpleDark turns light violet in
  // dark, 2.7:1 on white (#bugs 2026-10-01 audit).
  ctaTextOnWhite: { color: HG.purpleDark },
  pressed: { opacity: 0.9 },
});

const PICK_STYLES = {
  light: makePickStyles(PICK_LIGHT),
  dark: makePickStyles(PICK_DARK),
} as const;
