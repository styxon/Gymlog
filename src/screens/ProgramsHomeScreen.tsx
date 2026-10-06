import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CutSurface } from '../components/CutSurface';
import { LAYERS_MOTIF, ProgramCoverStyle, programCoverStyle } from '../lib/programVisualIdentity';
import { NewProgramSheet } from '../components/NewProgramSheet';
import { ProgramLadderRow } from '../components/ProgramLadderRow';
import { CsvLibraryEntry } from '../lib/csvProgramImport';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import {
  availableLadderSorts,
  partitionByReaderWeek,
  ProgramLadderSort,
  sortProgramLadder,
} from '../lib/programLadder';
import { I18nKey, t } from '../lib/i18n';
import type { ProgramImageImportResult } from '../utils/programImagePicker';
import { PROGRAM_CATEGORIES, ProgramCategoryKey } from '../lib/programCategories';
import { GoalProgrammeSuggestionView } from '../lib/goalProgramme';
import { StrengthGoalProgress } from '../lib/strengthGoals';
import type { ProgramSeason } from '../lib/programSeasons';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { WorkoutLevel } from '../features/workout/workoutTypes';
import type { AppLanguage, ExerciseLibraryItem, WorkoutTemplateDraft, ExerciseNameBookEntry } from '../types/models';
import { removeTrailingZeros } from '../lib/format';

// Designed program covers (README "Program Covers"): a per-program hue rendered
// as a gradient, with a single-stroke signature motif. oklch from the mock is
// pre-converted to sRGB here (RN has no oklch). Each Explore card cycles a style
// so the catalog stays visually distinct without photography.
/**
 * How far up the cover's left edge the seam cuts (design: 82%).
 *
 * Shallow on purpose: steeper and the card starts to read as broken rather
 * than cut, and the shape has to survive at 104px tall as well as 176.
 */
const SEAM_RATIO = 0.82;

// The palette itself moved to lib/programVisualIdentity: the detail and day
// heroes wear the same colour as the cover, so the values need one home. The
// choice of which style a programme gets moved out too — it is the family's
// now, resolved in App.tsx and carried on the item.
const SAVED_TILE: [string, string] = ['#00BAD1', '#0088A8'];


// Tall enough for a two-line title, two lines of body AND the pill under
// them. At 186 the CTA was clipped by the card's own bottom edge.
const CAMPAIGN_H = 216;

// Two cards, one gap, inside the page's 20px gutters.
const SEASON_ROW_W = Dimensions.get('window').width - 40;
const SEASON_CARD_W = Math.floor((SEASON_ROW_W - 12) / 2);
const SEASON_CARD_H = 216;

const COVER_W = 274;
const COVER_H = 176;

/**
 * One short course on the Learn rail, with the reader's progress in it.
 *
 * Computed by the caller rather than here: progress needs the learned-exercise
 * set, and this screen has no business reading it.
 */
export interface ProgramsLearnRow {
  id: string;
  title: string;
  blurb: string;
  done: number;
  total: number;
  /** 0–100, already clamped — an empty course must not produce NaN%. */
  percent: number;
  cover: readonly [string, string];
}

export interface ProgramsExploreItem {
  id: string;
  name: string;
  goal: string;
  blurb: string;
  days: number;
  minutes: number;
  /**
   * The programme's resolved colour and motif. Was an index into the palette,
   * picked by hashing the id — so the same family wore five different colours
   * across the rail. The style is chosen where the programme is built now
   * (App.tsx), from its family, and travels with the item.
   */
  cover: ProgramCoverStyle;
  /** The program's week as bar heights — see lib/programFingerprint. */
  fingerprint: number[];
  /**
   * Level and block length, which the browse cards never carried.
   *
   * The level is the single fact that decides whether a program is for this
   * reader at all, and the catalog screen did not show it anywhere. The sheet
   * filters on it.
   */
  level: WorkoutLevel;
  weeks: number;
}

export interface ProgramsCustomItem {
  id: string;
  name: string;
  subtitle: string;
  /**
   * The plan you are actually training. A ready programme adopted from the
   * catalog is not an authored template, so it appeared nowhere on this tab —
   * the one programme the reader came here to find was the one missing.
   */
  active?: boolean;
  /** Ready programmes open the catalog page, authored ones the editor's. */
  programType?: 'ready' | 'custom';
}


interface ProgramsHomeScreenProps {
  /**
   * The week the reader said they have, from setup.
   *
   * The only thing on the category sheet that knows anything about them, and
   * the whole basis of the recommended row. Null when setup never said, which
   * means no row is recommended rather than a guess wearing a badge.
   */
  readerDaysPerWeek?: number | null;
  /**
   * The reader's level in the CATALOG's words, not setup's.
   *
   * Setup says beginner/advanced/pro and the catalog says
   * beginner/intermediate/advanced, so the caller maps it through
   * `catalogLevelForSetup`. It orders the fitting rows rather than filtering
   * them: a beginner sees the beginner four-day plan first and the advanced
   * one still on the list.
   */
  readerLevel?: string | null;
  /**
   * The whole catalog as cards, not a curated eight.
   *
   * A category tile that says "Voima 8" has to be able to open eight, and the
   * old Explore row was a hand-picked list that no filter could reach past.
   */
  catalogItems: ProgramsExploreItem[];
  categoryCounts: Record<ProgramCategoryKey, number>;
  categoryMembers: Record<ProgramCategoryKey, string[]>;
  /**
   * The one or two programs the engine picked, each carrying its reason.
   *
   * Empty when the setup answers are missing — a recommendation with nothing
   * behind it is worse than no row. Never labelled AI: the model is never
   * used to pick a programme, and it is not.
   */
  /**
   * Strength targets with their progress. Empty until the reader sets one —
   * the app stores a goal CATEGORY from onboarding, never a number, so a bar
   * had nothing behind it before this.
   */
  goals: StrengthGoalProgress[];
  /**
   * The programme each goal goes towards, keyed by exerciseName. A goal
   * always has one (feedback round 2, #1): the row says which, or says that
   * the current programme does not train the lift.
   */
  goalProgrammes: Record<string, GoalProgrammeSuggestionView>;
  /** Lifts with logged work: you cannot set a target on something never done. */
  /** Opens the ready-made targets page — see StrengthGoalPickerScreen. */
  onOpenGoalPicker: () => void;
  onRemoveGoal: (exerciseName: string) => void;
  recommendations: Array<
    ProgramsExploreItem & {
      /** Short, and carrying the number: "Sopii 3 päivään". */
      why: string;
    }
  >;
  customPrograms: ProgramsCustomItem[];
  /**
   * "2/3 omaa ohjelmaa · yksi paikka jäljellä", or null. Only near and at the
   * free limit, so the limit sheet never arrives as news.
   */
  ownProgramsLine?: string | null;
  exerciseLibraryCount: number;
  onOpenExploreProgram: (programId: string) => void;
  onOpenCustomProgram: (programId: string, programType: 'ready' | 'custom') => void;
  onCreateProgram: () => void;
  onAiAssisted: () => void;
  /**
   * The short courses. Learn was three taps deep inside the library, which is
   * not where a course belongs. Empty means the section does not draw at all,
   * rather than a heading over nothing.
   *
   * Required, unlike the sheet's optional catalog door: that one is a door a
   * caller may genuinely have nowhere to open, this is part of the tab's
   * shape. Optional, a caller that forgot it would render a tab with no Learn
   * section and nothing would say so.
   */
  learnRows: ProgramsLearnRow[];
  onOpenCollection?: (collectionId: string) => void;
  onOpenLearnIndex?: () => void;
  /** The fourth door on the new-programme sheet: all the ready programmes. */
  onBrowseCatalog?: () => void;
  /** How many ready programmes that door is promising. */
  catalogCount?: number;
  /** Whether AI-assisted composition is unlocked, or wears the padlock. */
  proUnlocked?: boolean;
  /** Where the padlock leads. */
  onOpenPaywall?: () => void;
  onImportProgram: (draft: WorkoutTemplateDraft) => Promise<boolean | void> | boolean | void;
  exerciseLibraryEntries: ExerciseLibraryItem[];
  /** The reader's own lift names, for the CSV importer's matcher. */
  nameBook?: readonly ExerciseNameBookEntry[];
  onTeachName?: (wrote: string, exercise: CsvLibraryEntry) => Promise<void> | void;
  onPickImage?: () => Promise<ProgramImageImportResult>;
  language?: AppLanguage;
  onOpenLibrary: () => void;
}

function GradientTile({ stops, size, radius }: { stops: [string, string]; size: number; radius: number }) {
  const gid = `tile-${stops[0]}-${size}`.replace(/[^a-zA-Z0-9]/g, '');
  const glyph = size * 0.42;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="1" stopColor={stops[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} rx={radius} ry={radius} fill={`url(#${gid})`} />
      <Svg x={(size - glyph) / 2} y={(size - glyph) / 2} width={glyph} height={glyph} viewBox="0 0 24 24">
        <Path
          d={LAYERS_MOTIF}
          stroke="#FFFFFF"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.95}
        />
      </Svg>
    </Svg>
  );
}

function ProgramCover({
  style,
  goal,
  days,
  name,
  fingerprint,
  language,
  width = COVER_W,
  height = COVER_H,
  compact = false,
}: {
  style: ProgramCoverStyle;
  goal: string;
  days: number;
  name: string;
  language: AppLanguage;
  /**
   * Covers come in three sizes now, and that is the point.
   *
   * Every row on this page used one 274×176 card, so five sections of real
   * variety read as five copies of the same screen — the reader's own
   * criticism, and a fair one. A browse page tells you what matters by how big
   * it draws it, and a page where everything is the same size has said nothing.
   */
  width?: number;
  height?: number;
  /** Drops the goal tag and photo marker — there is no room at 104px tall. */
  compact?: boolean;
  /**
   * One bar per session, height proportional to that session's working sets.
   *
   * The design this came from called these a fingerprint and then drew a sine
   * wave, so two programs could look identical while claiming to show their
   * shape. These are the real thing: bar count is the days per week and the
   * heights are where the work sits, both readable before a word of the name.
   */
  fingerprint: number[];
}) {
  const styles = useThemedStyles(makeStyles);

  const gid = `cover-${style.cover[0]}-${width}x${height}`.replace(/[^a-zA-Z0-9]/g, '');
  const shadeHeight = Math.min(78, height * 0.55);
  const barCeiling = Math.max(18, height * 0.42);
  /**
   * The seam (design: GAINER Boost-tyyli).
   *
   * The cover's bottom edge slopes rather than sitting square, so the card has
   * an angle in it before any content does. It is the same diagonal the A3 cut
   * and the speed line already use, at card scale — not a second language.
   *
   * Clipped in the SVG rather than by the parent: `overflow: hidden` clips to
   * the rectangle, and the gradient, the bars and the shade would all have
   * carried on past the slope.
   */
  const seam = `M0 0 H${width} V${height} L0 ${height * SEAM_RATIO} Z`;
  return (
    <View style={[styles.cover, { width, height }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <ClipPath id={`${gid}-seam`}>
            <Path d={seam} />
          </ClipPath>
          <SvgLinearGradient id={gid} x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={style.cover[0]} />
            <Stop offset="1" stopColor={style.cover[1]} />
          </SvgLinearGradient>
          <RadialGradient id={`${gid}-hl`} cx="12%" cy="0%" rx="120%" ry="90%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <SvgLinearGradient id={`${gid}-shade`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#0C081A" stopOpacity={0.42} />
            <Stop offset="1" stopColor="#0C081A" stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
        <G clipPath={`url(#${gid}-seam)`}>
        <Rect x="0" y="0" width={width} height={height} fill={`url(#${gid})`} />
        <Rect x="0" y="0" width={width} height={height} fill={`url(#${gid}-hl)`} />
        {/* fine diagonal texture */}
        {Array.from({ length: Math.ceil(width / 30) }, (_, i) => (
          <Path key={i} d={`M${-40 + i * 42} ${height} L${40 + i * 42} 0`} stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1} />
        ))}
        {/* The week, as bars. Drawn under the shade gradient so the name stays
            readable over them, and inset from the tag row above. */}
        {fingerprint.length > 0
          ? fingerprint.map((barRatio, index) => {
              const slot = (width - 32) / fingerprint.length;
              const barWidth = Math.max(3, Math.min(18, slot - 5));
              const barHeight = Math.max(4, barRatio * barCeiling);
              return (
                <Rect
                  key={index}
                  x={16 + index * slot + (slot - barWidth) / 2}
                  // Anchored to the bottom edge rather than floating mid-card.
                  // On device the floating version read as three pale smudges
                  // behind the title: a histogram needs a baseline to be one.
                  y={height - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill="#FFFFFF"
                  fillOpacity={0.45}
                />
              );
            })
          : null}
        {/* signature motif watermark, bottom-right */}
        <Svg x={width - height * 0.75} y={height - height * 0.73} width={height * 0.85} height={height * 0.85} viewBox="0 0 24 24">
          <Path d={style.motif} stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
        <Rect x="0" y={height - shadeHeight} width={width} height={shadeHeight} fill={`url(#${gid}-shade)`} />
        </G>
      </Svg>
      {compact ? null : (
        <View style={styles.coverTag}>
          <Text style={styles.coverTagText}>{goal}</Text>
        </View>
      )}
      {/* The days badge said what the first bullet says two lines lower, and
          the seam crosses the bottom edge the name used to sit on. The cover
          is the picture now; the words are all in the body. */}
      {compact ? null : (
        <View style={styles.coverBadge}>
          <Text style={styles.coverBadgeText}>{t(language, 'programs.card.daysShort', { count: days })}</Text>
        </View>
      )}
      {/* Marks the slot where a real gym photo will land (shot later at 3:2, cropped 4:5). */}
      {compact ? null : (
        <View style={styles.coverPhotoMark}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 8a2 2 0 0 1 2-2h1.5l1.4-1.6a1 1 0 0 1 .75-.4h4.7a1 1 0 0 1 .75.4L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"
              stroke="#FFFFFF"
              strokeOpacity={0.85}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Circle cx={12} cy={12.5} r={3.2} stroke="#FFFFFF" strokeOpacity={0.85} strokeWidth={2} />
          </Svg>
        </View>
      )}
      {compact ? null : (
        <Text style={styles.coverName} numberOfLines={2}>
          {name}
        </Text>
      )}
    </View>
  );
}

/**
 * The category row: a rail that becomes a grid.
 *
 * Nine tiles do not fit on a phone, and the answer had been a "Näytä kaikki"
 * link to the old plans list — a different screen showing a different thing.
 * Expanding in place keeps the menu where the reader is looking.
 */
function ScrollableOrGrid({
  expanded,
  style,
  children,
}: {
  expanded: boolean;
  style: object;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  if (expanded) {
    return <View style={styles.tileGrid}>{children}</View>;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={style}
      style={styles.exploreScroll}
    >
      {children}
    </ScrollView>
  );
}

/**
 * The same three labels the filter row uses, keyed for a single card.
 *
 * The badge colours these used to sit beside moved into ProgramLadderRow when
 * the catalog became a second door onto the same programmes.
 */
const LEVEL_LABEL_KEYS: Record<WorkoutLevel, I18nKey> = {
  beginner: 'programs.level.beginner',
  intermediate: 'programs.level.intermediate',
  advanced: 'programs.level.advanced',
};

/**
 * A course cover: the collection's own ramp, with the same diagonal hatch the
 * programme covers wear so the two rails read as one family.
 */
function LearnCardCover({ cover }: { cover: readonly [string, string] }) {
  const gid = `learn-${cover[0]}`.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width="100%" height={76}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0.15" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={cover[0]} />
          <Stop offset="1" stopColor={cover[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={76} fill={`url(#${gid})`} />
    </Svg>
  );
}

/** Sort first on a family this size: "which order" beats "which level". */
const LADDER_SORTS: Array<{ sort: ProgramLadderSort; key: I18nKey }> = [
  { sort: 'recommended', key: 'programs.sort.recommended' },
  { sort: 'days', key: 'programs.sort.days' },
  { sort: 'length', key: 'programs.sort.length' },
];

const LEVEL_FILTERS: Array<{ level: WorkoutLevel | null; key: I18nKey }> = [
  { level: null, key: 'programs.level.all' },
  { level: 'beginner', key: 'programs.level.beginner' },
  { level: 'intermediate', key: 'programs.level.intermediate' },
  { level: 'advanced', key: 'programs.level.advanced' },
];

/**
 * What a category tile opens.
 *
 * The first build put a horizontal rail under the tiles, which gave all nine
 * categories the same eight-card shape and no way to narrow further. A sheet
 * carries what a rail cannot: what the category is FOR, the level of every
 * program in it, a filter on that level, and a sentence per program saying
 * what the training actually is. Browsing stays behind it, and closing is one
 * gesture.
 *
 * Seasons use the same sheet. Two mechanisms for "show me this subset" is one
 * too many, and the season rail's "Poista suodatin" link — which emptied the
 * section instead of narrowing it — was the price of having a second one.
 */
function ProgramSheet({
  visible,
  onClose,
  language,
  title,
  focus,
  tint,
  icon,
  items,
  onPick,
  readerDaysPerWeek,
  readerLevel,
  bottomInset,
}: {
  visible: boolean;
  onClose: () => void;
  language: AppLanguage;
  title: string;
  focus: string;
  tint: { bg: string; border: string; ink: string };
  icon: string;
  items: ProgramsExploreItem[];
  onPick: (item: ProgramsExploreItem) => void;
  readerDaysPerWeek: number | null;
  readerLevel: string | null;
  /**
   * Safe-area inset, read on the screen — inside this Modal
   * `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [level, setLevel] = useState<WorkoutLevel | null>(null);
  const [sort, setSort] = useState<ProgramLadderSort>('recommended');

  // A filter left over from the last category would silently hide programs in
  // the next one, and the reader would have no idea why "Voima 8" opened three
  // rows.
  useEffect(() => {
    if (!visible) {
      setLevel(null);
      setSort('recommended');
    }
  }, [visible]);

  const filtered = level === null ? items : items.filter((item) => item.level === level);
  /*
   * Twenty-one rows one step apart are not a list you scan — they are a
   * ladder, and "which order" beats "which level" on a family that size. The
   * recommendation is computed from what is SHOWN, so filtering to a level
   * the reader's week has no programme in simply leaves no recommendation
   * rather than pointing at a hidden row.
   */
  /*
   * Only the sorts that move rows here. Block length is 8 or 12 weeks and
   * nothing else, so a "Length" chip is inert in half the sheet's views — and
   * a level filter can strand the reader on a sort that has just gone flat,
   * which is why the active one falls back rather than sticking.
   */
  const sorts = availableLadderSorts(filtered);
  const activeSort = sorts.includes(sort) ? sort : 'recommended';
  // A sort the current filter cannot honour is dropped rather than remembered:
  // otherwise clearing the filter reorders the list with nothing tapped.
  useEffect(() => {
    if (!sorts.includes(sort)) {
      setSort('recommended');
    }
  }, [sort, sorts]);

  const { fits, rest } = partitionByReaderWeek(filtered, readerDaysPerWeek, readerLevel);
  /*
   * One header over the rows that fit, not a badge on each of them.
   *
   * Up to twelve rows in a category match the reader's week, so a chip per row
   * marks the normal rather than the exception. The group is only lifted out
   * when it is a part of the list: if every row fits, "fits your week" is not
   * telling the reader which ones.
   */
  const grouped =
    readerDaysPerWeek != null && activeSort === 'recommended' && fits.length > 0 && rest.length > 0;
  const shown: Array<{
    key: string;
    header?: string;
    rule?: true;
    item?: ProgramsExploreItem;
  }> = grouped
    ? [
        { key: 'fits-header', header: t(language, 'programs.sheet.fitsYourWeek', { days: readerDaysPerWeek }) },
        ...fits.map((item) => ({ key: item.id, item })),
        // Where the group ends, or the reader cannot tell which rows the
        // header was talking about.
        { key: 'fits-rule', rule: true as const },
        ...rest.map((item) => ({ key: item.id, item })),
      ]
    : sortProgramLadder(filtered, activeSort).map((item) => ({ key: item.id, item }));

  /**
   * A definite height, not a cap.
   *
   * `maxHeight` does not bound a ScrollView's flex sizing here — the list laid
   * out against its own content and pushed the CTA off the bottom of the
   * screen. A computed row-count height did not fix it either: the sheet is
   * anchored to the bottom edge, so whatever it cannot fit is lost at the
   * bottom rather than the top, and the button is the last thing in it.
   *
   * One fixed height — and the CTA is taken out of the flex flow entirely
   * (see catSheetCta). `flex: 1` on the list still handed it more than the
   * leftover space on device, and a button that three separate layout fixes
   * could not keep on screen does not belong in the flow at all.
   */
  const sheetHeight = Math.round(windowHeight * 0.84);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetScrim} onPress={onClose} />
        {/* A percentage maxHeight inside a Modal does not bound this on
            Android — the list grew to its content and pushed the CTA off the
            bottom of the screen. Measured, so it cannot. */}
        <View style={[styles.catSheet, { height: sheetHeight }]}>
          <View style={styles.sheetGrip} />
          <View style={styles.catSheetHead}>
            <View style={[styles.catSheetIcon, { backgroundColor: tint.bg, borderColor: tint.border }]}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d={icon} stroke={tint.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <View style={styles.catSheetCopy}>
              <Text style={styles.catSheetTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.catSheetFocus} numberOfLines={2}>
                {t(language, 'programs.sheet.count', { count: items.length, focus })}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sectionLink}>{t(language, 'programs.sheet.close')}</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.levelRow}
            style={styles.levelScroll}
          >
            {/* Sort first: on a family this size "which order" is the question
                before "which level". */}
            {/* A lone "Recommended" chip, permanently on, is a label wearing a
                control's clothes — with nothing to switch to, show nothing. */}
            {(sorts.length > 1 ? LADDER_SORTS.filter((entry) => sorts.includes(entry.sort)) : []).map((entry) => {
              const on = activeSort === entry.sort;
              return (
                <Pressable
                  key={entry.sort}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSort(entry.sort)}
                  style={[styles.levelChip, on && { backgroundColor: tint.ink, borderColor: tint.ink }]}
                >
                  <Text style={[styles.levelChipText, on && styles.levelChipTextOn]}>
                    {t(language, entry.key)}
                  </Text>
                </Pressable>
              );
            })}
            {/* Only a divider when there is something on both sides of it: a
                single "Recommended" chip needs no separating from the levels. */}
            {sorts.length > 1 ? <View style={styles.chipDivider} /> : null}
            {LEVEL_FILTERS.map((entry) => {
              const on = level === entry.level;
              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setLevel(entry.level)}
                  style={[styles.levelChip, on && { backgroundColor: tint.ink, borderColor: tint.ink }]}
                >
                  <Text style={[styles.levelChipText, on && styles.levelChipTextOn]}>
                    {t(language, entry.key)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* The list clears the pinned CTA, which grows by the inset: with
              a fixed 108 the last rows sat under a CTA the navigation bar had
              made taller, and could not be scrolled to (review of #193). */}
          <ScrollView
            style={styles.catSheetList}
            contentContainerStyle={[styles.catSheetListInner, { paddingBottom: 108 + bottomInset }]}
          >
            {shown.length === 0 ? (
              <Text style={styles.catSheetEmpty}>{t(language, 'programs.sheet.empty')}</Text>
            ) : (
              shown.map((entry) => {
                if (entry.header) {
                  return (
                    <Text key={entry.key} accessibilityRole="header" style={styles.sheetGroupHeader}>
                      {entry.header}
                    </Text>
                  );
                }
                if (entry.rule) {
                  return <View key={entry.key} style={styles.sheetGroupRule} />;
                }
                const item = entry.item as ProgramsExploreItem;
                return (
                  <ProgramLadderRow
                    key={item.id}
                    item={item}
                    language={language}
                    levelFilter={level}
                    accessibilityLabel={t(language, 'programs.switchTo', { name: item.name })}
                    onPress={() => onPick(item)}
                  />
                );
              })
            )}
          </ScrollView>

          {/* This said "Näytä kaikki 8 ohjelmaa" and navigated to the old
              plans list — from a sheet that was already showing all eight. Its
              only real job is undoing the level filter, so it appears only
              when there is one to undo. */}
          {level !== null ? (
            <View style={[styles.catSheetCta, { paddingBottom: 34 + bottomInset }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLevel(null)}
                style={({ pressed }) => [styles.sheetConfirm, pressed && styles.pressed]}
              >
                <Text style={styles.sheetConfirmText}>
                  {t(language, 'programs.sheet.viewAll', { count: items.length })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function ProgramsHomeScreen({
  readerDaysPerWeek = null,
  readerLevel = null,
  catalogItems,
  categoryCounts,
  categoryMembers,
  recommendations,
  goals,
  goalProgrammes,
  onOpenGoalPicker,
  onRemoveGoal,
  customPrograms,
  ownProgramsLine = null,
  exerciseLibraryCount,
  onOpenExploreProgram,
  onOpenCustomProgram,
  onCreateProgram,
  onAiAssisted,
  learnRows,
  onOpenCollection,
  onOpenLearnIndex,
  onBrowseCatalog,
  catalogCount = 0,
  proUnlocked = true,
  onOpenPaywall,
  onImportProgram,
  exerciseLibraryEntries,
  nameBook,
  onTeachName,
  onPickImage,
  language = 'en',
  onOpenLibrary,
}: ProgramsHomeScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Read here, on the screen: inside ProgramSheet's own Modal
  // useSafeAreaInsets itself always answers 0.
  const insets = useSafeAreaInsets();
  /**
   * Which sheet is open, if any.
   *
   * Categories and seasons used to be two separate pieces of state driving two
   * inline rails that behaved differently — the season one even had a "Poista
   * suodatin" link that emptied the section rather than narrowing it. One
   * state, one sheet, one way to close it.
   */
  // One variant left. The 'all' sheet's only door was the trending section's
  // "Kaikki" link, and both went together: the catalog screen answers that
  // question better than a drawer can, with level, goal and a search over a
  // windowed list.
  const [sheet, setSheet] = useState<{ kind: 'category'; key: ProgramCategoryKey } | null>(null);
  // The goal sheet: which lift, and the number being typed.
  const [createOpen, setCreateOpen] = useState(false);
  // The tile row scrolls to four and a half categories; this shows all nine.
  const [allCategories, setAllCategories] = useState(false);
  // Where the season rows begin, measured rather than guessed — a hero CTA
  // that says "Open the season" has to actually arrive there.

  // The open sheet's contents, drawn from the same sources the tiles count.
  // Resolved once, with the fallback here rather than on four props. Every
  // ProgramCategoryKey has a row, so the ?? branch is unreachable today and
  // exists so a tenth key added without a row degrades to a real category
  // instead of an untinted sheet with no icon.
  const sheetCategory = sheet
    ? PROGRAM_CATEGORIES.find((entry) => entry.key === sheet.key) ?? PROGRAM_CATEGORIES[0]
    : null;
  const sheetItems = sheet
    ? catalogItems.filter((item) => categoryMembers[sheet.key]?.includes(item.id))
    : [];

  return (
    <View style={styles.screenBackground}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* The active program used to lead this screen: a 320px photo hero,
            the whole week as rows, and a View-full-plan button. It lives on
            Home now, where the reader already is when they wonder what today
            is. Keeping a copy here would have given the same week two owners,
            and this tab is for finding a program, not for running one. */}

        {/* The tab says what it is. The screen opened on a rotating advert
            and the reader had to infer where they were from a row of discs. */}
        <Text style={styles.screenTitle}>{t(language, 'tabs.programs')}</Text>

        {/* "Jatka siitä mihin jäit" was here. It listed programmes with
            logged work as covers you could tap — which is what "Omat
            ohjelmasi" further down already is, and what the active programme
            on Home already is. Three answers to one question. */}

        <Text style={styles.sectionEyebrowStandalone}>{t(language, 'programs.yourPrograms')}</Text>
        {ownProgramsLine ? <Text style={styles.ownProgramsLine}>{ownProgramsLine}</Text> : null}
        {customPrograms.map((program) => (
          <Pressable
            key={program.id}
            accessibilityRole="button"
            accessibilityLabel={t(language, 'programs.open', { name: program.name })}
            onPress={() => onOpenCustomProgram(program.id, program.programType ?? 'custom')}
            style={({ pressed }) => [styles.customRowWrap, pressed && styles.rowPressed]}
          >
            <CutSurface
              size="lg"
              fill={theme.surface}
              stroke={theme.border}
              strokeWidth={1}
              speedLine={{ color: theme.purpleBright }}
              style={styles.customRow}
            >
            <GradientTile stops={SAVED_TILE} size={44} radius={12} />
            <View style={styles.customCopy}>
              <View style={styles.customTitleRow}>
                <Text style={styles.customTitle} numberOfLines={1}>
                  {program.name}
                </Text>
                {program.active ? (
                  <Text style={styles.customActiveTag}>{t(language, 'programs.activeTag')}</Text>
                ) : null}
              </View>
              <Text style={styles.customSubtitle} numberOfLines={1}>
                {program.subtitle}
              </Text>
            </View>
            {/* A chevron, not the word "Open" (user 2026-09-01). Every row
                on this list opens; the word was on all three saying the same
                thing, and the arrow says it without taking a column. */}
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M9 5l7 7-7 7"
                stroke={theme.faint}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            </CutSurface>
          </Pressable>
        ))}
        {/* The only "new program" entry on the page now. It opens the sheet
            rather than the editor, so removing the duplicate button at the top
            did not remove the AI and CSV routes with it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'programs.create')}
          onPress={() => setCreateOpen(true)}
          style={({ pressed }) => [pressed && styles.pressedRow]}
        >
          {/* Filled and in the accent, not a dashed outline (user
              2026-09-01). theme.highlight rather than a literal orange: it is
              orange on the dark theme and violet on the light one, which is
              what "the colour you press" means in each. */}
          <CutSurface
            size="lg"
            fill={theme.surface}
            stroke={theme.border}
            strokeWidth={1}
            style={styles.createRow}
          >
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
            <Path d="M12 5v14M5 12h14" stroke={theme.highlight} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.createText}>{t(language, 'programs.create')}</Text>
          </CutSurface>
        </Pressable>

        {/* The rail that used to live here is a sheet now. Nine categories
            sharing one horizontal rail gave every one of them the same
            eight-card shape, no way to narrow further, and nowhere to say what
            the category is FOR or what level its programs are. */}

        {/* Categories as tiles. The first build made these text chips, which
            was a silent substitution rather than a decision: on a row you scan
            instead of read, colour and shape land before a word does, and nine
            identical grey pills are read one at a time. */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionEyebrow}>{t(language, 'programs.browse')}</Text>
          <Pressable onPress={() => setAllCategories((value) => !value)} hitSlop={8}>
            <Text style={styles.sectionLink}>
              {t(language, allCategories ? 'programs.showLess' : 'programs.viewAll')}
            </Text>
          </Pressable>
        </View>
        {/* Expanded in place rather than on another screen. "Näytä kaikki"
            used to open the old plans list, which is a different thing
            entirely — the tiles are the menu, so showing all nine of them is
            the answer. */}
        <ScrollableOrGrid expanded={allCategories} style={styles.tileRow}>
          {PROGRAM_CATEGORIES.map((entry) => {
            return (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityLabel={`${t(language, entry.labelKey)}, ${categoryCounts[entry.key]}`}
                onPress={() => setSheet({ kind: 'category', key: entry.key })}
                style={({ pressed }) => [
                  styles.catTileWrap,
                  allCategories && styles.catTileWrapGrid,
                  pressed && styles.pressed,
                ]}
              >
                {/* One container decision, and this is it: a solid disc in the
                    category's own ink with the mark knocked out in white.
                    Nine pastel tiles behind a near-black outline needed the
                    outline to hold them apart at all — the colour was doing no
                    work. Filled, the hue is the tile, and the badge can sit on
                    the edge because a circle has no cut corner to slice a
                    digit in half. */}
                <View style={[styles.catTile, { backgroundColor: entry.tint.ink }]}>
                  <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                    <Path
                      d={entry.icon}
                      stroke="#FFFFFF"
                      // A hair heavier than the 1.9 hairline the pale tiles
                      // used: knocked out of a colour, a stroke reads thinner
                      // than the same stroke drawn on light.
                      strokeWidth={2.05}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                  <View
                    style={[
                      styles.catTileCount,
                      { backgroundColor: entry.tint.ink, borderColor: theme.surface },
                    ]}
                  >
                    <Text style={styles.catTileCountText}>{categoryCounts[entry.key]}</Text>
                  </View>
                </View>
                <Text style={styles.catTileLabel} numberOfLines={2}>
                  {t(language, entry.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollableOrGrid>

        {/* "For you" follows the browse tiles. It used to lead them, below the
            reader's targets and courses; the user put finding a programme
            straight under their own (#bugs 2026-09-26): own programmes, browse
            by goal, for you — everything else below. */}
        {recommendations.length > 0 ? (
          <View>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionEyebrow}>{t(language, 'programs.forYou')}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.exploreRow}
              style={styles.exploreScroll}
            >
              {recommendations.map((item) => {
                const style = item.cover;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'programs.switchTo', { name: item.name })}
                    // The card says "Katso lisätietoja", so it opens the
                    // program's own screen. It opened the switch-confirm sheet
                    // instead: a label promising detail that produced a
                    // decision.
                    onPress={() => onOpenExploreProgram(item.id)}
                    style={({ pressed }) => [styles.recCard, pressed && styles.pressed]}
                  >
                    <ProgramCover
                      style={style}
                      goal={item.goal}
                      days={item.days}
                      name={item.name}
                      fingerprint={item.fingerprint}
                      language={language}
                      width={186}
                      height={104}
                      compact
                    />
                    {/* Boost anatomy: what it is called, what it is, two
                        facts, and the one number worth comparing. The card
                        used to be a single meta line and a link — everything
                        at one weight, so nothing was the answer to "which of
                        these". */}
                    <View style={styles.recBody}>
                      <Text style={styles.recName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.recGoal} numberOfLines={1}>
                        {item.goal}
                      </Text>
                      <View style={styles.recBullets}>
                        <View style={styles.recBulletRow}>
                          <View style={styles.recDot} />
                          <Text style={styles.recBulletText} numberOfLines={1}>
                            {t(language, 'programs.card.days', { count: item.days })} · ~{item.minutes} min
                          </Text>
                        </View>
                        <View style={styles.recBulletRow}>
                          <View style={styles.recDot} />
                          <Text style={styles.recBulletText} numberOfLines={1}>
                            {t(language, LEVEL_LABEL_KEYS[item.level])}
                          </Text>
                        </View>
                      </View>
                      {item.weeks > 0 ? (
                        <View style={styles.recFoot}>
                          <Text style={styles.recFootLabel}>{t(language, 'programs.card.lengthLabel')}</Text>
                          <Text style={styles.recFootValue}>
                            {t(language, 'programs.weeksShort', { count: item.weeks })}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* The old "Vaihda ohjelmaa" rail lived here: the whole 55-program
            catalog, always open, in the same card size as four other rows. It
            is gone because the tiles above now are the way in, and a rail that
            is always there makes a menu above it look decorative. */}

        {/* Seasons are PARKED, not deleted (decision 2026-08-31).

            Still here and still working: the 'season' route, SeasonScreen, and
            every library under it — the screen resolves its own window and its
            own programme, so it needs nothing from this tab. Gone with the
            section: the two cards, this screen's seasonRows/seasonCards props
            and the App memos behind them, because a prop nothing reads is a
            lie in the interface. Un-parking is one commit: put the section
            back and re-add those three.

            The target card below took the slot, because a dated commitment and
            a number to aim at answer the same question and only one of them
            was real. */}

        {/* Always here. It used to appear only once a lift had been logged,
            which hid the targets section from the one reader a target would
            actually help. The picker offers ready-made numbers, so there is
            always something to show. */}
        {true ? (
          <View>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionEyebrow}>{t(language, 'programs.goals')}</Text>
              {/* Only when there IS one. Empty, the card below carries the
                  same door as a button you cannot miss, and two of them beside
                  each other is the duplicate this tab keeps growing. */}
              {goals.length > 0 ? (
                <Pressable onPress={onOpenGoalPicker} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t(language, 'programs.goals.add')}</Text>
                </Pressable>
              ) : null}
            </View>
            {goals.length === 0 ? (
              /* Was one line of grey prose under the heading, which read as a
                 caption rather than as something to do. It is the same shape
                 as a target now — same surface, same speed line — so the
                 section looks like itself before there is anything in it. */
              <CutSurface
                size="lg"
                fill={theme.surface}
                stroke={theme.border}
                strokeWidth={1}
                speedLine={{ color: theme.purpleBright }}
                style={styles.goalEmpty}
              >
                <Text style={styles.goalEmptyTitle}>{t(language, 'programs.goals.emptyTitle')}</Text>
                <Text style={styles.goalEmptyBody}>{t(language, 'programs.goals.empty')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onOpenGoalPicker}
                  style={({ pressed }) => [styles.goalEmptyCta, pressed && styles.pressed]}
                >
                  <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M12 5v14M5 12h14"
                      stroke={theme.onHighlight}
                      strokeWidth={2.6}
                      strokeLinecap="round"
                    />
                  </Svg>
                  <Text style={styles.goalEmptyCtaText}>{t(language, 'programs.goals.add')}</Text>
                </Pressable>
              </CutSurface>
            ) : (
              <View style={styles.goalList}>
                {goals.map((entry) => {
                  // The same identity colour the lift's programmes wear, so a
                  // target reads as part of the app rather than as a widget
                  // bolted onto the bottom of the tab.
                  const tint = programCoverStyle(entry.goal.exerciseName).tile;
                  return (
                    <Pressable
                      key={entry.goal.exerciseName}
                      accessibilityRole="button"
                      // The card OPENS; the x removes. Its label used to say
                      // "Remove the target", which is what a screen reader read
                      // out for a tap that edits — and removing was a long
                      // press, which nobody finds (user 2026-09-01).
                      accessibilityLabel={t(language, 'programs.open', {
                        name: exerciseNameLabel(language, entry.goal.exerciseName),
                      })}
                      onPress={onOpenGoalPicker}
                      onLongPress={() => onRemoveGoal(entry.goal.exerciseName)}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <CutSurface
                        size="lg"
                        fill={theme.surface}
                        stroke={theme.border}
                        strokeWidth={1}
                        speedLine={{ color: theme.purpleBright }}
                        style={styles.goalRow}
                      >
                        <View style={[styles.goalTile, { backgroundColor: tint[0] }]}>
                          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M12 3v18M4 9v6M20 9v6M7 7v10M17 7v10"
                              stroke="#FFFFFF"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          </Svg>
                        </View>
                        <View style={styles.goalCopy}>
                          <Text style={styles.goalTitle} numberOfLines={1}>
                            {exerciseNameLabel(language, entry.goal.exerciseName)}
                          </Text>
                          <Text style={styles.goalMeta} numberOfLines={1}>
                            {entry.currentKg === null
                              ? t(language, 'programs.goals.notStarted', { target: removeTrailingZeros(entry.goal.targetKg) })
                              : t(language, 'programs.goals.meta', {
                                  current: removeTrailingZeros(entry.currentKg),
                                  target: removeTrailingZeros(entry.goal.targetKg),
                                })}
                          </Text>
                          <View style={styles.goalTrack}>
                            <View
                              style={[
                                styles.goalFill,
                                { width: `${Math.round((entry.ratio ?? 0) * 100)}%` },
                                entry.reached && styles.goalFillReached,
                              ]}
                            />
                          </View>
                          {(() => {
                            // The programme line. Which programme trains this
                            // lift, or the fact that the current one does not —
                            // never a projection of when the number arrives.
                            const suggestion = goalProgrammes[entry.goal.exerciseName];
                            if (!suggestion) {
                              return null;
                            }
                            const label =
                              suggestion.status === 'covered' && suggestion.programme
                                ? t(language, 'goals.programme.covered', { programme: suggestion.programme.title })
                                : suggestion.status === 'suggest' && suggestion.programme
                                  ? t(language, 'goals.programme.suggest', { programme: suggestion.programme.title })
                                  : t(language, 'goals.programme.none');
                            return (
                              <Text
                                style={[styles.goalProgramme, suggestion.status !== 'covered' && styles.goalProgrammeOpen]}
                                numberOfLines={1}
                              >
                                {label}
                              </Text>
                            );
                          })()}
                        </View>
                        {/* Red, and its own target rather than a corner of the
                            card: this is the only destructive control in the
                            section, and the one thing the reader could not do
                            before. hitSlop because 22px is under the 44px
                            minimum and the card behind it opens the picker. */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(language, 'programs.goals.remove', {
                            name: exerciseNameLabel(language, entry.goal.exerciseName),
                          })}
                          onPress={() => onRemoveGoal(entry.goal.exerciseName)}
                          hitSlop={12}
                          style={({ pressed }) => [styles.goalRemove, pressed && styles.pressed]}
                        >
                          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M6 6l12 12M18 6L6 18"
                              stroke={theme.danger}
                              strokeWidth={2.4}
                              strokeLinecap="round"
                            />
                          </Svg>
                        </Pressable>
                      </CutSurface>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {/* Learn was three taps deep inside the library, which is not where a
            course belongs: the library is 876 rows, a course is an order. Up
            here it sits with the other thing on this page that is about the
            reader rather than about the catalog. */}
        {learnRows.length > 0 ? (
          <View>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionEyebrow}>{t(language, 'programs.learn')}</Text>
              {onOpenLearnIndex ? (
                <Pressable onPress={onOpenLearnIndex} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t(language, 'programs.learn.all')}</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.learnRailScroll}
              contentContainerStyle={styles.learnRail}
            >
              {learnRows.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'learn.openCourse', {
                    name: row.title,
                    done: row.done,
                    total: row.total,
                  })}
                  onPress={() => onOpenCollection?.(row.id)}
                  style={({ pressed }) => [styles.learnCard, pressed && styles.pressed]}
                >
                  <LearnCardCover cover={row.cover} />
                  <View style={styles.learnCardBody}>
                    <Text style={styles.learnCardTitle} numberOfLines={1}>
                      {row.title}
                    </Text>
                    <Text style={styles.learnCardBlurb} numberOfLines={2}>
                      {row.blurb}
                    </Text>
                    <View style={styles.learnProgressRow}>
                      <View style={styles.learnTrack}>
                        <View style={[styles.learnFill, { width: `${row.percent}%` }]} />
                      </View>
                      <Text style={[styles.learnCount, row.done > 0 && styles.learnCountOn]}>
                        {row.done} / {row.total}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Text style={styles.sectionEyebrowStandalone}>{t(language, 'programs.library')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'programs.openLibrary')}
          onPress={onOpenLibrary}
          style={({ pressed }) => [pressed && styles.rowPressed]}
        >
          <CutSurface
            size="lg"
            fill={theme.surface}
            stroke={theme.border}
            strokeWidth={1}
            speedLine={{ color: theme.purpleBright }}
            style={styles.libraryRow}
          >
          <View style={styles.libraryIcon}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" stroke={theme.purple} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <View style={styles.libraryCopy}>
            <Text style={styles.libraryTitle}>{t(language, 'programs.exerciseLibrary')}</Text>
            <Text style={styles.librarySubtitle} numberOfLines={1}>
              {t(language, 'programs.library.sub', { count: exerciseLibraryCount })}
            </Text>
          </View>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="m9 6 6 6-6 6" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          </CutSurface>
        </Pressable>

        <View style={styles.bottomSafeFade} />
      </ScrollView>

      <ProgramSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        language={language}
        title={sheetCategory ? t(language, sheetCategory.labelKey) : ''}
        focus={sheetCategory ? t(language, sheetCategory.focusKey) : ''}
        tint={sheetCategory ? sheetCategory.tint : PROGRAM_CATEGORIES[0].tint}
        icon={sheetCategory ? sheetCategory.icon : PROGRAM_CATEGORIES[0].icon}
        bottomInset={insets.bottom}
        items={sheetItems}
        readerDaysPerWeek={readerDaysPerWeek}
        readerLevel={readerLevel}
        onPick={(item) => {
          // The row carries a chevron, which means "open". It opened the
          // switch-confirm sheet instead — the same mismatch the Sinulle
          // cards had, where a control promising detail produced a decision.
          setSheet(null);
          onOpenExploreProgram(item.id);
        }}
      />

      <NewProgramSheet
        language={language}
        visible={createOpen}
        exerciseLibrary={exerciseLibraryEntries}
        nameBook={nameBook}
        onTeachName={onTeachName}
        onPickImage={onPickImage}
        onClose={() => setCreateOpen(false)}
        onAiAssisted={onAiAssisted}
        onBrowseCatalog={onBrowseCatalog}
        catalogCount={catalogCount}
        proUnlocked={proUnlocked}
        onOpenPaywall={onOpenPaywall}
        onBuildYourself={onCreateProgram}
        onImportProgram={onImportProgram}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 132,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
  },
  pressedRow: {
    opacity: 0.7,
  },
  screenTitle: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.75,
    paddingTop: 6,
    marginBottom: 4,
  },
  learnRailScroll: {
    flexGrow: 0,
    marginHorizontal: -20,
  },
  learnRail: {
    flexDirection: 'row',
    gap: 11,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  learnCard: {
    width: 214,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  learnCardBody: {
    padding: 13,
    paddingLeft: 15,
  },
  learnCardTitle: {
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  learnCardBlurb: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15.5,
    fontWeight: '600',
    marginTop: 3,
    height: 31,
  },
  learnProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
  },
  learnTrack: {
    flex: 1,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.border,
    overflow: 'hidden',
  },
  learnFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.purple,
  },
  learnCount: {
    color: theme.faint,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
  },
  learnCountOn: {
    color: theme.purple,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 11,
    paddingHorizontal: 2,
  },
  sectionEyebrow: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  categoryRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  categoryChipOn: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.ink,
  },
  categoryChipTextOn: {
    color: theme.purple,
    fontWeight: '800',
  },
  goalInput: {
    marginTop: 14,
    height: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '800',
    color: theme.ink,
  },
  goalCard: {
    marginHorizontal: 20,
    marginBottom: 6,
    borderRadius: 18,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  goalList: {
    gap: 10,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingLeft: 24,
    paddingRight: 14,
  },
  goalEmpty: {
    paddingVertical: 16,
    paddingLeft: 24,
    paddingRight: 16,
    gap: 8,
  },
  goalEmptyTitle: {
    color: theme.ink,
    fontSize: 16.5,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  goalEmptyBody: {
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 17.5,
    fontWeight: '600',
  },
  goalEmptyCta: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    backgroundColor: theme.highlight,
  },
  goalEmptyCtaText: {
    color: theme.onHighlight,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  goalRemove: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalTile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalCopy: {
    flex: 1,
    gap: 4,
  },
  goalTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
  },
  goalMeta: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.muted,
  },
  goalTrack: {
    marginTop: 4,
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.purple,
  },
  goalFillReached: {
    backgroundColor: theme.green,
  },
  goalProgramme: {
    marginTop: 6,
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  goalProgrammeOpen: {
    color: theme.purple,
  },
  forYouWhy: {
    fontSize: 11.5,
    fontWeight: '800',
    lineHeight: 15,
    color: theme.purple,
  },
  // ── Rotating campaign hero ───────────────────────────────────────────
  campaignBlock: {
    marginTop: 22,
  },
  campaignScroll: {
    flexGrow: 0,
  },
  campaignSlide: {
    height: CAMPAIGN_H,
    paddingHorizontal: 22,
    // Centred, not top-aligned. Titles run one line or two depending on the
    // slide, and a fixed top padding left a one-line slide with a third of the
    // card empty under its own button.
    justifyContent: 'center',
  },
  campaignKicker: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  campaignTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 8,
    paddingRight: 90,
  },
  campaignBody: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    paddingRight: 84,
  },
  campaignCta: {
    alignSelf: 'flex-start',
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  campaignCtaText: {
    color: '#191036',
    fontSize: 12.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  campaignFooter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginTop: 10,
    minHeight: 26,
  },
  campaignDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  campaignDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.border,
  },
  campaignDotOn: {
    width: 18,
    backgroundColor: theme.purple,
  },
  campaignPause: {
    position: 'absolute',
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  // ── Category tiles ───────────────────────────────────────────────────
  // Expanded, the nine tiles fill the width three to a row (#bugs
  // 2026-10-03): fixed 78-wide cells wrapped three to a row left a third of
  // the screen empty, and the narrow cell broke "Rasvanpoltto" mid-word.
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
    paddingVertical: 4,
  },
  catTileWrapGrid: {
    width: '33.333%',
  },
  tileRow: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  catTileWrap: {
    width: 78,
    alignItems: 'center',
  },
  catTile: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catTileCount: {
    // On the disc's edge rather than inside it, with a ring in the surface
    // colour so the pill reads as a badge and not as a bite out of the circle.
    position: 'absolute',
    bottom: -1,
    right: -1,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catTileCountText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
  catTileLabel: {
    marginTop: 7,
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  // ── Continue cards (252 × 92 cover) ──────────────────────────────────
  // ── Recommendation cards (158 × 104 cover) ───────────────────────────
  recCard: {
    width: 186,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  recBody: {
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
  },
  recName: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  recGoal: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  recBullets: {
    gap: 6,
    marginTop: 11,
    marginBottom: 12,
  },
  recBulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.purpleBright,
  },
  recBulletText: {
    flex: 1,
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  // The one number worth comparing, under a hairline so it reads as the
  // card's answer rather than a third bullet.
  recFoot: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 9,
  },
  recFootLabel: {
    color: theme.faint,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  recFootValue: {
    color: theme.ink,
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  // ── Season tiles (168 × 150) ─────────────────────────────────────────
  seasonGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  seasonCard: {
    height: SEASON_CARD_H,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  seasonCardBody: {
    padding: 15,
  },
  seasonCardTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 3,
  },
  seasonPill: {
    position: 'absolute',
    top: 13,
    left: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  seasonPillMuted: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  seasonPillText: {
    color: '#191036',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  seasonPillTextMuted: {
    color: '#FFFFFF',
  },
  seasonTileMonths: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  seasonTileCount: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 2,
  },
  seasonTileLead: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  seasonTrack: {
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.24)',
    marginTop: 10,
    overflow: 'hidden',
  },
  seasonTrackFill: {
    height: 6,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  seasonDays: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginTop: 11,
  },
  ownProgramsLine: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: -4,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionEyebrowStandalone: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginTop: 26,
    marginBottom: 11,
    paddingHorizontal: 2,
  },
  sectionLink: {
    color: theme.highlight,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  exploreScroll: {
    marginHorizontal: -20,
  },
  exploreRow: {
    paddingHorizontal: 20,
    paddingVertical: 2,
    gap: 12,
  },
  // Size comes from props now — three card sizes on the page instead of one.
  cover: {
    overflow: 'hidden',
  },
  coverTag: {
    position: 'absolute',
    top: 13,
    left: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.20)',
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  coverTagText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  coverBadge: {
    position: 'absolute',
    top: 13,
    right: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  coverBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  coverPhotoMark: {
    position: 'absolute',
    right: 13,
    bottom: 13,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(12,8,26,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverName: {
    position: 'absolute',
    left: 15,
    right: 15,
    bottom: 13,
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  // A 21px title on a 104px cover eats the card; the small covers get their
  // own scale rather than the same one shrunk by luck.
  exploreMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 11,
  },
  exploreMeta: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: theme.faint,
  },
  customRowWrap: {
    marginBottom: 10,
  },
  rowPressed: {
    transform: [{ translateX: 3 }],
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingRight: 14,
    // Room for the speed line before the tile starts.
    paddingLeft: 26,
    paddingVertical: 13,
  },
  customCopy: {
    flex: 1,
    minWidth: 0,
  },
  customTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customTitle: {
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    flexShrink: 1,
  },
  customActiveTag: {
    color: theme.highlight,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    backgroundColor: theme.highlightSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  customSubtitle: {
    marginTop: 2,
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  customAction: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
  },
  createText: {
    color: theme.highlight,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingRight: 15,
    paddingLeft: 26,
    paddingVertical: 14,
  },
  libraryIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryCopy: {
    flex: 1,
    minWidth: 0,
  },
  libraryTitle: {
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  librarySubtitle: {
    marginTop: 2,
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  bottomSafeFade: {
    height: 16,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16,10,32,0.44)',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  // ── Category / season sheet ──────────────────────────────────────────
  catSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: theme.surface,
    paddingTop: 10,
  },
  catSheetHead: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  catSheetIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catSheetCopy: {
    flex: 1,
    minWidth: 0,
  },
  catSheetTitle: {
    color: theme.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  catSheetFocus: {
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 1,
  },
  levelScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  levelRow: {
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  levelChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  levelChipText: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
  levelChipTextOn: {
    color: '#FFFFFF',
  },
  catSheetList: {
    flex: 1,
    minHeight: 0,
  },
  catSheetListInner: {
    paddingHorizontal: 18,
    // The bottom clearance is set where the list is drawn: it has to grow
    // with the CTA below it, which carries the navigation-bar inset.
    gap: 10,
  },
  catSheetEmpty: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 24,
    textAlign: 'center',
  },
  sheetGroupHeader: {
    color: theme.highlight,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginBottom: 2,
  },
  sheetGroupRule: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: 6,
  },
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 6,
    marginHorizontal: 4,
    backgroundColor: theme.border,
  },
  catSheetCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surface,
    paddingHorizontal: 18,
    paddingTop: 12,
    // Clears the gesture bar: the sheet's bottom IS the screen's bottom, so
    // the button's own padding is the only thing keeping it reachable.
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: theme.surface,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 26,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.border,
    marginBottom: 16,
  },
  sheetConfirm: {
    flex: 1.4,
    height: 50,
    borderRadius: 14,
    backgroundColor: theme.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.purpleBright,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 4,
  },
  sheetConfirmText: {
    color: theme.surface,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
});
