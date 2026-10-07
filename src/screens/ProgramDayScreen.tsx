import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddExerciseSheet, ExercisePickerSheet } from '../components/AddExerciseSheet';
import { useSwapPickerLists } from '../hooks/useSwapPickerLists';
import { exerciseSheetCopy } from '../lib/exerciseSheetMode';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KitBar, KitRow, KitSheet } from '../components/sheetKit';
import { CutSurface } from '../components/CutSurface';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { hyphenateFinnish } from '../lib/finnishHyphenation';
import {
  classifySessionFocus,
  getDefaultCooldown,
  getDefaultWarmup,
  listRoutineDrillOptions,
  routineDrillSlotKey,
  RoutineBlockKind,
} from '../lib/homeSessionHero';
import { I18nKey, t } from '../lib/i18n';
import { useDragHold } from '../hooks/useDragHold';
import { exerciseAfterSessionSwap, ProgramDetailSessionItem } from '../lib/programDetails';
import { buildSupersetRuns, normalizeSupersetGroups, supersetPositions } from '../lib/supersetGrouping';
import { SupersetBorder } from '../components/SupersetBorder';
import {
  canStepProgramPrescription,
  ProgramPrescription,
  stepProgramPrescription,
} from '../lib/programSessionEdit';
import { buildSwapOptionsForSlot } from '../lib/tailoringFit';
import { buildSwapShortlist, sessionLiftsMatchingQuery } from '../lib/swapShortlist';
import { formatPlanSessionTitle, localizeSessionName } from '../lib/sessionNameLabel';
import { formatClock } from '../lib/restSchedule';
import { doseUnitSuffix } from '../lib/format';
import { layout, radii, spacing } from '../theme';
import { Theme, darkTheme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

/**
 * The day view (design: GAINER Hourglass Shape, screen 2) — the one separate
 * screen the programme page opens. A read-out of the session, not a logger:
 * sets, rep ranges and rests from the catalog's own numbers, roles explained
 * once at the top, warm-up and cool-down from the same generator Home uses so
 * the two screens cannot describe different sessions.
 */


const ROLE_TAG_KEYS: Record<string, I18nKey> = {
  primary: 'detail.role.primary',
  secondary: 'detail.role.secondary',
  accessory: 'detail.role.accessory',
};

const ROLE_LINE_KEYS: Record<string, I18nKey> = {
  primary: 'detail.role.anchorLine',
  secondary: 'detail.role.supportLine',
  accessory: 'detail.role.accessoryLine',
};

function PencilGlyph({ theme }: { theme: Theme }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24">
      <Path
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        fill={theme.purple}
      />
    </Svg>
  );
}

/** Swap this lift for another. Orange: this app's one word for "pressable". */
function SwapGlyph({ theme }: { theme: Theme }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"
        stroke={theme.highlight}
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Run this lift straight into the next one, or stop doing so.
 *
 * A chain, whole when the two are linked and broken when they are not — the
 * same glyph in both states, because the button is a toggle and a reader who
 * has to compare two different drawings to find out which one they are looking
 * at is reading, not tapping. Orange, like every other pressable here.
 */
function ChainGlyph({ theme, linked }: { theme: Theme; linked: boolean }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.5 14.5l5-5"
        stroke={linked ? theme.highlight : theme.faint}
        strokeWidth={2.1}
        strokeLinecap="round"
      />
      <Path
        d="M13.5 6.5l1.5-1.5a3.5 3.5 0 014.95 4.95L18.5 11.5M10.5 17.5L9 19a3.5 3.5 0 01-4.95-4.95L5.5 12.5"
        stroke={linked ? theme.highlight : theme.muted}
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {linked ? null : (
        <Path d="M4 20L20 4" stroke={theme.muted} strokeWidth={1.8} strokeLinecap="round" />
      )}
    </Svg>
  );
}

/** Take it off the day. Red, because it is the row's one permanent action. */
function TrashGlyph({ theme }: { theme: Theme }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6"
        stroke={theme.danger}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Same wash logic the detail screen's role tags use. */
const roleTints = (theme: Theme): Record<string, { bg: string; ink: string }> =>
  theme === darkTheme
    ? {
        primary: { bg: 'rgba(167, 139, 250, 0.16)', ink: '#C4B0FF' },
        secondary: { bg: 'rgba(79, 168, 255, 0.14)', ink: '#8CC6FF' },
        accessory: { bg: 'rgba(255, 255, 255, 0.07)', ink: theme.faint },
      }
    : {
        primary: { bg: '#EDE4FF', ink: '#5B21B6' },
        secondary: { bg: '#E4EEFF', ink: '#2C4E9A' },
        accessory: { bg: '#F2F1F5', ink: '#7A7387' },
      };

/**
 * What one edge of a superset box adds above or below the rows inside it:
 * `supersetGroup`'s marginVertical plus its paddingVertical. The drag charges
 * it per boundary crossed, because no row's onLayout reports it.
 */
const SUPERSET_BOX_EDGE = 12;

interface ProgramDayScreenProps {
  programTitle: string;
  session: ProgramDetailSessionItem;
  dayNumber: number;
  dayCount: number;
  language?: AppLanguage;
  availableEquipment?: string[] | null;
  /** The reader's own warm-up / cool-down picks — see routineDrillSlotKey. */
  routineDrillOverrides?: Record<string, string>;
  /** Undefined leaves the drills read-only. */
  onSwapRoutineDrill?: (slotKey: string, drillKey: string) => void;
  /** Slot id -> chosen lift, shared with the session this screen starts. */
  sessionSwaps?: Record<string, string>;
  onSwapExercise?: (slotId: string, exerciseName: string) => void;
  /**
   * Lifts added to this day, by library name.
   *
   * "+ Lisää liike" used to navigate to the template editor on the Workout
   * tab — a different screen, on a different tab, with its own save button and
   * its own idea of what was being edited. The reader tapped it and asked what
   * tab they had landed on ("vie johonkin ihan outoon välilehteen", #bugs
   * 2026-08-26). The library opens here instead, over the day it is adding to,
   * and a ready programme is copied behind it exactly as removing a lift
   * already does.
   */
  onAddExercises?: (exerciseNames: string[]) => void;
  exerciseLibrary?: ExerciseLibraryItem[];
  recentExerciseLibraryItems?: ExerciseLibraryItem[];
  /**
   * Out of the programme for good, by the template's own exercise id.
   *
   * Replaces "tee tästä oma versio", which was the only way to make a fixed
   * day editable and which nobody found: the reader was looking for a way to
   * drop one lift, not for a lesson in how the catalog is stored. A ready
   * programme is copied behind this, silently.
   */
  onRemoveExercise?: (exerciseId: string) => void;
  /**
   * Keep today's swap in the programme. Offered only on a row that is already
   * swapped — before the choice there is nothing to make permanent.
   */
  onKeepSwap?: (exerciseId: string, exerciseName: string) => void;
  /**
   * How many sets, how many reps — "Sarja/toisto määrää mahdoton muuttaa"
   * (#bugs 2026-08-27). The numbers were a rendered string: this screen showed
   * the catalog's dose and offered no way to disagree with it, so a reader who
   * wanted four sets instead of six had to rebuild the programme by hand in
   * the editor on another tab.
   */
  onPrescribe?: (exerciseId: string, prescription: ProgramPrescription) => void;
  /**
   * Dropped where the drag let go. Ordering is the programme's other real
   * decision: what you do while fresh is what you get strongest at, so a
   * reader who wants to squat first has changed their training, not their
   * list. One call per drag, however far it travelled.
   */
  onReorderExercise?: (exerciseId: string, toIndex: number) => void;
  /**
   * Run this lift straight into the one below it, or stop doing so.
   *
   * The day view is where a superset has to be made, not the live session:
   * the programme is what the reader trains from, and a pairing that existed
   * only inside one session would be gone the next time the day came round.
   */
  onSupersetLink?: (exerciseId: string, linked: boolean) => void;
  tailoringPreferences?: Parameters<typeof buildSwapOptionsForSlot>[2];
  /**
   * Take this whole day out of the programme (#bugs 2026-09-24). Asked first;
   * the caller leaves the page once the write has landed. Undefined for a
   * catalog programme and for a programme's only day — removing that one is
   * deleting the programme, which has its own button.
   */
  onRemoveSession?: () => void;
  /**
   * The day's own name, typed over from the pen beside it (#bugs 2026-09-28:
   * "lisää tähän kynä ikoni josta voi nimeä muokata"). Undefined for a
   * catalog programme, whose day names are the catalog's.
   */
  onRenameSession?: (name: string) => void;
  /**
   * Whether ANCHOR / SUPPORT / EXTRA were decided by someone. A catalog day's
   * roles were; a day the reader built has them derived from the library
   * (every compound lift SUPPORT, nothing ever ANCHOR), so every row carried
   * the same tag and the reader asked why their own day was all support lifts
   * (#bugs 2026-09-28). A tag on every row says nothing, so it is not drawn.
   */
  showRoles?: boolean;
  /** The reader typed this day's name with the pen: shown exactly as typed. */
  readerNamed?: boolean;
  onBack: () => void;
}

export function ProgramDayScreen({
  programTitle,
  session,
  dayNumber,
  dayCount,
  language = 'en',
  availableEquipment = null,
  routineDrillOverrides = {},
  onSwapRoutineDrill,
  sessionSwaps = {},
  onSwapExercise,
  onAddExercises,
  exerciseLibrary,
  recentExerciseLibraryItems = [],
  onRemoveExercise,
  onKeepSwap,
  onPrescribe,
  onReorderExercise,
  onSupersetLink,
  tailoringPreferences,
  onRemoveSession,
  onRenameSession,
  showRoles = true,
  readerNamed = false,
  onBack,
}: ProgramDayScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const tints = roleTints(theme);
  const [confirmRemoveSession, setConfirmRemoveSession] = useState(false);
  // Null while the title reads; the draft while it is being typed over.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // A draft belongs to the day it was opened on, not to whichever day the
  // screen is drawing when Save is pressed.
  useEffect(() => {
    setNameDraft(null);
  }, [session.id]);

  // Warm-up and recovery closed by default: they are the same generated
  // blocks on every session of this focus, and the lifts are what the reader
  // came for.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    warmup: false,
    exercises: true,
    cooldown: false,
  });
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [swapSlotId, setSwapSlotId] = useState<string | null>(null);
  /**
   * The row being re-dosed, and the numbers as the reader has stepped them.
   *
   * The draft is seeded once, when the sheet opens, and every press writes the
   * whole prescription rather than a delta. Two quick taps on "+" therefore
   * land as 5 then 6, not as 5 twice: the second press does not have to wait
   * for the first one's save to come back around through props before it knows
   * what it is adding to.
   */
  /**
   * Reordering by drag (design frame 05): grab the handle, the row lifts,
   * the others make room, and letting go writes ONE edit with the
   * destination. This replaced a Reorder mode with per-row arrows, which
   * was itself the replacement for a trip through a sheet ("voisi vaihtaa
   * liikkeiden järjestästä helposti", 2026-08-27) — each step of that
   * ladder kept the list visible and cut the taps; this one cuts them to
   * zero.
   *
   * Raw responder handlers on the HANDLE only, not a gesture library: the
   * repo has none, and the handle is a small target with no competing
   * gesture of its own. The ScrollView is frozen for the drag's duration —
   * two vertical gestures cannot share one finger.
   */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  /** Measured per render; a drag needs real heights, not guesses. */
  const rowHeights = useRef<number[]>([]);
  /** The grip is held before it picks a lift up — see useDragHold. */
  const dragHold = useDragHold();

  const dragTargetFor = (from: number, dy: number) => {
    const heights = rowHeights.current;
    let target = from;
    let remaining = Math.abs(dy);
    const step = dy > 0 ? 1 : -1;
    for (
      let next = from + step;
      next >= 0 && next < session.exercises.length;
      next += step
    ) {
      const height = heights[next] ?? 0;
      if (height === 0 || remaining < height / 2) {
        break;
      }
      // A superset box costs vertical space that no row's onLayout reports,
      // so a walk that only summed row heights committed the reorder before
      // the card had reached the row it was aimed at, drifting further with
      // every block crossed (PR #93 review).
      remaining -= height + supersetBoundarySpacing(next - step, next);
      target = next;
    }
    return target;
  };

  const endDrag = (commit: boolean) => {
    // A grip that was touched but never held moves nothing.
    const wasHeld = dragHold.end();
    const from = dragIndex;
    const to = dragTarget;
    setDragIndex(null);
    setDragTarget(null);
    dragY.setValue(0);
    if (!wasHeld) {
      return;
    }
    if (commit && from !== null && to !== null && to !== from) {
      const exercise = session.exercises[from];
      if (exercise) {
        onReorderExercise?.(exercise.id, to);
      }
    }
  };
  const [tuneExerciseId, setTuneExerciseId] = useState<string | null>(null);
  const [tuneDraft, setTuneDraft] = useState<ProgramPrescription | null>(null);
  /** The numbers as they were when the sheet opened — the bar's left half. */
  const [tuneStart, setTuneStart] = useState<ProgramPrescription | null>(null);
  const openTuneSheet = (exercise: ProgramDetailSessionItem['exercises'][number]) => {
    const seed = {
      targetSets: exercise.sets,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      restSeconds: exercise.restSeconds ?? null,
    };
    setTuneExerciseId(exercise.id);
    setTuneDraft(seed);
    setTuneStart(seed);
  };
  const closeTuneSheet = () => {
    setTuneExerciseId(null);
    setTuneDraft(null);
    setTuneStart(null);
  };
  /** Narrows the pool. Cleared with the sheet, so it never opens pre-filtered. */
  const [swapQuery, setSwapQuery] = useState('');
  /** The replacement picked but not committed — the scope question comes after. */
  const [swapPickName, setSwapPickName] = useState<string | null>(null);
  const closeSwapSheet = () => {
    setSwapSlotId(null);
    setSwapQuery('');
    setSwapPickName(null);
  };

  /**
   * Hardware back, while a sheet is open, closes the sheet — and nothing else.
   *
   * The app's own back listener knows only about routes: it popped this screen
   * out from under whichever sheet was open, and the sheet is a native dialog
   * window that outlives the React screen it belonged to. What the reader got
   * was an app that still drew but answered no touches anywhere, with a
   * restart the only way out (#bugs 2026-08-27). Registering only while a
   * sheet is open puts this listener after the app's, and BackHandler calls
   * the newest first, so returning true here is what keeps the screen mounted.
   */
  useEffect(() => {
    if (!addSheetOpen && swapSlotId === null && tuneExerciseId === null) {
      return undefined;
    }
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      setAddSheetOpen(false);
      setSwapSlotId(null);
      setSwapQuery('');
      setSwapPickName(null);
      setTuneExerciseId(null);
      setTuneDraft(null);
      setTuneStart(null);
      return true;
    });
    return () => handler.remove();
  }, [addSheetOpen, swapSlotId, tuneExerciseId]);

  const swapRow = useMemo(() => {
    const exercise = session.exercises.find((item) => item.slotId && item.slotId === swapSlotId);
    if (!exercise?.slotId) {
      return null;
    }
    const currentName = sessionSwaps[exercise.slotId] ?? exercise.name;
    return {
      slotId: exercise.slotId,
      currentName,
      // The stored programme's own id, which removal is written against.
      exerciseId: exercise.id ?? null,
      // Split rather than listed — see swapShortlist: nine valid lifts ranked
      // together buried the machine version and pushed the actions off the
      // bottom of the sheet.
      shortlist: buildSwapShortlist(
        currentName,
        buildSwapOptionsForSlot(exercise.substitutionGroup ?? '', currentName, tailoringPreferences).map(
          (option) => ({ ...option, searchLabel: exerciseNameLabel(language, option.exerciseName) }),
        ),
        {
          // Offering a lift the day already holds is a change that changes
          // nothing (#bugs 2026-08-26).
          alreadyInSession: session.exercises.map(
            (item) => (item.slotId ? sessionSwaps[item.slotId] : undefined) ?? item.name,
          ),
          query: swapQuery,
          language,
        },
      ),
    };
  }, [session.exercises, swapSlotId, sessionSwaps, tailoringPreferences, swapQuery, language]);

  /**
   * The swap sheet is the guided player's (#bugs 2026-10-06; owner, 2026-10-07:
   * that sheet everywhere). The slot's shortlist is the first cards, the
   * library nearest the lift under them, through the same chips as the
   * player and Home (useSwapPickerLists).
   */
  const swapAlternatives = useMemo(
    () =>
      swapRow
        ? [...swapRow.shortlist.variations, ...swapRow.shortlist.related].map((option) => option.exerciseName)
        : [],
    [swapRow],
  );
  const swapSessionLifts = useMemo(
    () => session.exercises.map((item) => (item.slotId ? sessionSwaps[item.slotId] : undefined) ?? item.name),
    [session.exercises, sessionSwaps],
  );
  const swapPicker = useSwapPickerLists({
    exerciseLibrary,
    currentName: swapRow?.currentName ?? null,
    alternatives: swapAlternatives,
    sessionLifts: swapSessionLifts,
    query: swapQuery,
    language,
  });
  // Left out of both lists on purpose, and named so the reader knows why the
  // lift they typed is not there (#bugs 2026-09-27).
  const swapSessionHits = useMemo(
    () =>
      swapRow
        ? sessionLiftsMatchingQuery(
            session.exercises.map((item) => (item.slotId ? sessionSwaps[item.slotId] : undefined) ?? item.name),
            swapRow.currentName,
            swapQuery,
            language,
          )
        : [],
    [language, session.exercises, sessionSwaps, swapQuery, swapRow],
  );

  const focusKind = useMemo(
    () => classifySessionFocus(session.exercises.map((exercise) => exercise.name)),
    [session.exercises],
  );
  const warmup = getDefaultWarmup(focusKind, language, availableEquipment, routineDrillOverrides);
  const cooldown = getDefaultCooldown(focusKind, language, availableEquipment, routineDrillOverrides);

  /**
   * The drill swap, same shape as Home's (user 2026-08-31: the three sections
   * are one anatomy, so a drill is swapped the same way on both screens).
   */
  const [drillSwap, setDrillSwap] = useState<{ kind: RoutineBlockKind; index: number } | null>(null);
  const [drillPick, setDrillPick] = useState<string | null>(null);
  const drillOptions = useMemo(() => {
    if (!drillSwap) {
      return [];
    }
    // Not the drills standing in the block's OTHER slots: picking one of those
    // would put the same drill in the warm-up twice, count it twice in the
    // block's minutes, and walk the reader through it twice in the player.
    const taken = new Set(
      (drillSwap.kind === 'warmup' ? warmup : cooldown).drills
        .filter((_, index) => index !== drillSwap.index)
        .map((drill) => drill.key as string),
    );
    return listRoutineDrillOptions(drillSwap.kind, language, availableEquipment).filter(
      (option) => !taken.has(option.key as string),
    );
  }, [availableEquipment, cooldown, drillSwap, language, warmup]);
  const drillCurrent = drillSwap
    ? (drillSwap.kind === 'warmup' ? warmup : cooldown).drills[drillSwap.index] ?? null
    : null;
  const closeDrillSwap = () => {
    setDrillSwap(null);
    setDrillPick(null);
  };

  const canAddExercises = Boolean(onAddExercises && exerciseLibrary && exerciseLibrary.length > 0);

  // What the day already holds, so the picker can rank around it rather than
  // offering back what is on the screen behind it.
  const currentLibraryItemIds = useMemo(() => {
    if (!exerciseLibrary) {
      return [];
    }
    const present = new Set(
      session.exercises.map((item) => (item.slotId ? sessionSwaps[item.slotId] : undefined) ?? item.name),
    );
    return exerciseLibrary.filter((item) => present.has(item.name)).map((item) => item.id);
  }, [exerciseLibrary, session.exercises, sessionSwaps]);

  // Only the roles this day actually contains — a legend for a role that
  // never appears below it is furniture.
  const presentRoles = useMemo(() => {
    if (!showRoles) {
      return [];
    }
    const seen = new Set(session.exercises.map((exercise) => exercise.role as string));
    return ['primary', 'secondary', 'accessory'].filter((role) => seen.has(role));
  }, [session.exercises, showRoles]);

  const dayTitle = formatPlanSessionTitle(session, dayNumber - 1, programTitle, language, readerNamed);
  const commitRename = () => {
    if (nameDraft === null) {
      return;
    }
    const trimmed = nameDraft.trim();
    // Blank is a cancel, and so is Save on the untouched field.
    if (trimmed && trimmed !== session.name.trim()) {
      onRenameSession?.(trimmed);
    }
    setNameDraft(null);
  };

  const canTune = Boolean(onPrescribe);

  // A badge per row, aligned index for index with the day's exercises: 'A1',
  // 'A2' on the lifts that run together, null on the ones that do not.
  const supersets = useMemo(() => supersetPositions(session.exercises), [session.exercises]);
  /**
   * The space a superset box puts between two rows on top of their own
   * heights: its margin above and below, and its padding inside. Charged once
   * per boundary the drag crosses — leaving a block, entering one, or both at
   * once between two adjacent blocks.
   */
  const supersetBoundarySpacing = (fromIndex: number, toIndex: number) => {
    const before = supersets[fromIndex]?.groupId ?? null;
    const after = supersets[toIndex]?.groupId ?? null;
    if (before === after) {
      return 0;
    }
    return (before === null ? 0 : SUPERSET_BOX_EDGE) + (after === null ? 0 : SUPERSET_BOX_EDGE);
  };

  /** The day as runs, so two lifts done together are drawn inside one box. */
  const supersetRuns = useMemo(
    () => buildSupersetRuns(normalizeSupersetGroups(session.exercises)),
    [session.exercises],
  );
  /**
   * The rest each row should STATE, by index.
   *
   * A block rests as long as its most demanding lift asks for — that is the
   * rule every consumer uses, from the player's step list to the session
   * estimate. The last lift of a pair was stating its own rest instead, so a
   * curl paired under a squat read "tauko 45–75 s" while the round actually
   * rested two minutes (PR #93 review).
   */
  const blockRestLabels = useMemo(() => {
    const labels = new Map<number, string>();
    supersetRuns.forEach((run) => {
      if (run.groupId === null || run.indexes.length < 2) {
        return;
      }
      const longest = run.indexes.reduce((best, index) =>
        session.exercises[index].restSeconds > session.exercises[best].restSeconds ? index : best,
      );
      run.indexes.forEach((index) => labels.set(index, session.exercises[longest].restLabel));
    });
    return labels;
  }, [session.exercises, supersetRuns]);

  /**
   * Whether the row the sheet is open on runs straight into the one below it.
   * Read from the same badges the list draws, so the sheet and the row behind
   * it cannot disagree about whether a rest follows.
   */
  const tuneRowLinkedToNext = useMemo(() => {
    const index = session.exercises.findIndex((exercise) => exercise.id === tuneExerciseId);
    return index !== -1 && supersets[index]?.hasNextInGroup === true;
  }, [session.exercises, supersets, tuneExerciseId]);

  /** The row the sheet is open on, plus where in the day it currently sits. */
  const tuneRow = useMemo(() => {
    const index = session.exercises.findIndex((exercise) => exercise.id === tuneExerciseId);
    if (index === -1 || !tuneDraft) {
      return null;
    }
    const exercise = session.exercises[index];
    return {
      id: exercise.id,
      name: exerciseNameLabel(
        language,
        (exercise.slotId ? sessionSwaps[exercise.slotId] : undefined) ?? exercise.name,
      ),
      timed: exercise.timed,
      minutes: exercise.minutes,
      index,
      count: session.exercises.length,
    };
  }, [language, session.exercises, sessionSwaps, tuneDraft, tuneExerciseId]);

  /**
   * Steps write the DRAFT, and the bar's "Save to this day" writes the
   * programme. Every press used to save — the sheet-kit contract is the
   * opposite: the commit bar wakes when a number actually changes, shows the
   * whole edit on one line, and Undo puts the numbers back. A reader stepping
   * 5 sets to 3 no longer has a programme that says 4 while their thumb is
   * mid-thought.
   */
  const stepTune = (field: 'sets' | 'reps' | 'rest', direction: 1 | -1) => {
    if (!tuneDraft || !tuneRow || !onPrescribe) {
      return;
    }
    const next = stepProgramPrescription(tuneDraft, field, direction);
    if (next === tuneDraft) {
      return;
    }
    setTuneDraft(next);
  };

  // Whole minutes as minutes, the rest as a clock: 135 s read "2.3 min" — a
  // dot in Finnish, and not 2 min 15 s (decimal audit, 2026-09-21).
  const formatRest = (seconds: number) =>
    seconds < 120
      ? `${seconds} s`
      : Number.isInteger(seconds / 60)
        ? `${seconds / 60} min`
        : `${formatClock(seconds)} min`;
  const formatDose = (dose: ProgramPrescription | null, unit: { timed?: boolean; minutes?: boolean }) =>
    dose
      ? `${dose.targetSets} × ${
          dose.repMin === dose.repMax ? dose.repMin : `${dose.repMin}–${dose.repMax}`
        }${doseUnitSuffix(unit)}${dose.restSeconds !== null ? ` · ${formatRest(dose.restSeconds)}` : ''}`
      : '';
  const tuneChanged = Boolean(
    tuneDraft &&
      tuneStart &&
      (tuneDraft.targetSets !== tuneStart.targetSets ||
        tuneDraft.repMin !== tuneStart.repMin ||
        tuneDraft.repMax !== tuneStart.repMax ||
        tuneDraft.restSeconds !== tuneStart.restSeconds),
  );

  /**
   * One row of the day, drawn the same whether it stands alone or sits
   * inside a superset.
   *
   * Lifted out of the list so the list can group: two lifts done back to
   * back are drawn inside one boundary with one label instead of an A1 and
   * an A2 on every line (user 2026-09-11). The row still takes its own index,
   * so the drag still measures and moves the same rows — but the box around a
   * pair adds space no row reports, and `dragTargetFor` charges that per
   * boundary it crosses. See SUPERSET_BOX_EDGE.
   */
  const renderExerciseRow = (
    exercise: ProgramDetailSessionItem['exercises'][number],
    index: number,
    /** The superset frame is this row's edge: a rule of its own would double it. */
    hideTopRule = false,
  ) => {
            const dragging = dragIndex === index;
            // While a row travels, the rows between it and its target make
            // room by exactly its height — the drop is previewed, not
            // imagined.
            const shift =
              dragIndex !== null && dragTarget !== null && !dragging
                ? dragIndex < index && index <= dragTarget
                  ? -(rowHeights.current[dragIndex] ?? 0)
                  : dragTarget <= index && index < dragIndex
                    ? (rowHeights.current[dragIndex] ?? 0)
                    : 0
                : 0;
            const superset = supersets[index] ?? null;
            const linkedToNext = superset?.hasNextInGroup === true;
            // The dose today's swap will start on, as the name above it is
            // the swapped lift's.
            const shownDose = exerciseAfterSessionSwap(exercise, exercise.slotId ? sessionSwaps[exercise.slotId] : null);
            return (
            <Animated.View
              key={exercise.id}
              onLayout={(event) => {
                rowHeights.current[index] = event.nativeEvent.layout.height;
              }}
              style={[
                styles.exerciseCard,
                hideTopRule && styles.exerciseCardNoRule,
                index === 0 && styles.exerciseCardAnchor,
                shift !== 0 && { transform: [{ translateY: shift }] },
                dragging && [styles.exerciseCardLift, { transform: [{ translateY: dragY }] }],
              ]}
            >
              <View style={styles.exerciseTop}>
                {onReorderExercise && session.exercises.length > 1 ? (
                  <View
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'detail.day.dragHandle', {
                      name: exerciseNameLabel(language, exercise.name),
                    })}
                    onStartShouldSetResponder={() => true}
                    onResponderTerminationRequest={() => false}
                    onResponderGrant={(event) => {
                      dragY.setValue(0);
                      dragHold.begin(event.nativeEvent.pageY, () => {
                        setDragIndex(index);
                        setDragTarget(index);
                      });
                    }}
                    onResponderMove={(event) => {
                      const dy = dragHold.move(event.nativeEvent.pageY);
                      if (dy === null) {
                        return;
                      }
                      dragY.setValue(dy);
                      const target = dragTargetFor(index, dy);
                      setDragTarget((current) => (current === target ? current : target));
                    }}
                    onResponderRelease={() => endDrag(true)}
                    onResponderTerminate={() => endDrag(false)}
                    style={styles.dragHandle}
                  >
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M4 6h16M4 12h16M4 18h16"
                        stroke={theme.faint}
                        strokeWidth={2.2}
                        strokeLinecap="round"
                      />
                    </Svg>
                  </View>
                ) : null}
                {/* No numbered tile, and no line limit on the name (device,
                    2026-09-16). The tile took the width a Finnish compound
                    needs — "lantionnostopito" broke wherever the column ran
                    out, or ended in an ellipsis — and the order is already
                    the order of the rows. The whole name is shown, broken on
                    its syllables when it has to break. */}
                {(() => {
                  const stored = (exercise.slotId ? sessionSwaps[exercise.slotId] : undefined) ?? exercise.name;
                  const name = exerciseNameLabel(language, stored);
                  // Shown short (KP, KK, Smithissä), read out in full.
                  const shown = exerciseListLabel(language, stored);
                  return (
                    <Text
                      style={styles.exerciseName}
                      accessibilityLabel={name}
                      android_hyphenationFrequency="normal"
                    >
                      {language === 'fi' ? hyphenateFinnish(shown) : shown}
                    </Text>
                  );
                })()}
                {showRoles ? (
                  <View style={[styles.roleTag, { backgroundColor: tints[exercise.role]?.bg ?? theme.surfaceSoft }]}>
                    <Text style={[styles.roleTagText, { color: tints[exercise.role]?.ink ?? theme.muted }]}>
                      {t(language, ROLE_TAG_KEYS[exercise.role] ?? 'detail.role.accessory')}
                    </Text>
                  </View>
                ) : null}
                {/* Swap and remove sit on the name line as icons (design
                    2026-08-31): "Swap" was a word in a button on the line
                    below, which put a verb in the same row as the numbers and
                    left removal reachable only from inside the swap sheet. */}
                {exercise.slotId && onSwapExercise ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'detail.day.a11y.swap', {
                      name: exerciseNameLabel(language, exercise.name),
                    })}
                    hitSlop={8}
                    onPress={() => setSwapSlotId(exercise.slotId ?? null)}
                    style={({ pressed }) => [styles.rowAction, pressed && styles.swapOptionPressed]}
                  >
                    <SwapGlyph theme={theme} />
                  </Pressable>
                ) : null}
                {onRemoveExercise ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'detail.day.a11y.remove', {
                      name: exerciseNameLabel(language, exercise.name),
                    })}
                    hitSlop={8}
                    onPress={() => onRemoveExercise(exercise.id)}
                    style={({ pressed }) => [styles.rowAction, pressed && styles.swapOptionPressed]}
                  >
                    <TrashGlyph theme={theme} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.exerciseBottom}>
                {/* Two chips, one sheet (design frame 05): the dose and the
                    rest both open the same steppers, because the rest became
                    editable when the prescription grew a restSeconds. Both
                    wear the pencil — a chip that edits and a chip that only
                    states, side by side, taught the reader to distrust both. */}
                <View style={styles.exerciseDose}>
                  {canTune ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={() => openTuneSheet(exercise)}
                        style={({ pressed }) => [styles.doseChip, pressed && styles.swapOptionPressed]}
                      >
                        <Text style={styles.doseChipText}>{shownDose.prescription}</Text>
                        <PencilGlyph theme={theme} />
                      </Pressable>
                      {/* No rest follows a lift you run straight out of, so the
                          chip says what does. Showing the stored rest range here
                          would be the app stating a pause that never happens. */}
                      {linkedToNext ? (
                        <View style={styles.supersetNextChip}>
                          <Text style={styles.supersetNextChipText} numberOfLines={1}>
                            {t(language, 'detail.day.supersetNext')}
                          </Text>
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={6}
                          onPress={() => openTuneSheet(exercise)}
                          style={({ pressed }) => [styles.doseChip, pressed && styles.swapOptionPressed]}
                        >
                          <Text style={styles.doseChipText} numberOfLines={1}>
                            {t(language, 'detail.day.rest', {
                              range: blockRestLabels.get(index) ?? exercise.restLabel,
                            })}
                          </Text>
                          <PencilGlyph theme={theme} />
                        </Pressable>
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={styles.exerciseScheme}>{shownDose.prescription}</Text>
                      <Text style={styles.exerciseRest} numberOfLines={1}>
                        {linkedToNext
                          ? t(language, 'detail.day.supersetNext')
                          : t(language, 'detail.day.rest', {
                              range: blockRestLabels.get(index) ?? exercise.restLabel,
                            })}
                      </Text>
                    </>
                  )}
                </View>
                {/* The chain governs the gap to the row below, so it sits at
                    the end of the line closest to that gap. The bottom row of
                    the day has nothing below it to run into, and gets no chain
                    rather than one that does nothing. */}
                {onSupersetLink && index < session.exercises.length - 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: linkedToNext }}
                    accessibilityLabel={t(
                      language,
                      linkedToNext ? 'detail.day.a11y.supersetUnlink' : 'detail.day.a11y.supersetLink',
                      { name: exerciseNameLabel(language, exercise.name) },
                    )}
                    hitSlop={10}
                    onPress={() => onSupersetLink(exercise.id, !linkedToNext)}
                    style={({ pressed }) => [styles.rowAction, pressed && styles.swapOptionPressed]}
                  >
                    <ChainGlyph theme={theme} linked={linkedToNext} />
                  </Pressable>
                ) : null}
              </View>
            </Animated.View>
            );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        // The day's name is typed in here: Save must answer the first tap.
        keyboardShouldPersistTaps="handled"
        // Two vertical gestures cannot share one finger: the list holds
        // still while a row is being dragged.
        scrollEnabled={dragIndex === null}
      >
        {/*
          The same treatment the programme page got: title first, numbers
          under it, nothing painted (#bugs 2026-08-27). Only the gradient
          went — the day's name and its two numbers are what the block was
          carrying, and they stay, as does everything under it.
        */}
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'common.back')}
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          >
            <Svg viewBox="0 0 24 24" width={18} height={18}>
              <Path
                d="M15 6l-6 6 6 6"
                stroke={theme.ink}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        </View>
        {/*
          The day, named exactly as the row you tapped named it.

          This said the PROGRAMME's name in the big type with the session
          underneath, so the list said "Päivä 1. Rinta" and the page it opened
          said "Chest Day / Rinta" — the same day under two names, one of them
          new to the reader ("nyt tähän pelkästään se mitä on klikannut",
          2026-08-27). The programme's name is on the page you came from and
          is not repeated here.
        */}
        {nameDraft === null ? (
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle} numberOfLines={2}>
              {dayTitle}
            </Text>
            {onRenameSession ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'home.today.rename')}
                hitSlop={12}
                // The STORED name, as Home's pen does (audit round 4), not
                // the title as shown: that is a translation ("Pull Day" reads
                // "Vetopäivä") or a placeholder ("Treeni 2"), and saving it
                // made the translation the name — in English too, for good
                // (break round 2026-09-28).
                onPress={() => setNameDraft(session.name)}
                style={({ pressed }) => [styles.titlePen, pressed && { opacity: 0.6 }]}
              >
                <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"
                    stroke={theme.faint}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.titleEdit}>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
              selectTextOnFocus
              maxLength={60}
              placeholderTextColor={theme.faint}
              style={styles.titleInput}
              onSubmitEditing={commitRename}
            />
            <View style={styles.titleActions}>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setNameDraft(null)}
                style={({ pressed }) => [styles.titleAction, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.titleActionCancel}>{t(language, 'common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={commitRename}
                style={({ pressed }) => [styles.titleAction, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.titleActionSave}>{t(language, 'common.save')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Three accordions in Home's shape: the warm-up used to be a plain
            paragraph card next to a list of exercise cards, which made the
            same session look like two different screens. */}
        <Section
          styles={styles}
          theme={theme}
          title={t(language, 'detail.day.warmup')}
          count={t(language, 'detail.day.warmupMeta')}
          open={openSections.warmup}
          onToggle={() => setOpenSections((current) => ({ ...current, warmup: !current.warmup }))}
        >
          {warmup.drills.map((drill, index) => (
            <View key={drill.name} style={styles.drillRow}>
              <View style={styles.drillChip}>
                <Text style={styles.drillChipText}>{index + 1}</Text>
              </View>
              <Text style={styles.drillName} numberOfLines={2}>
                {drill.name}
              </Text>
              <Text style={styles.drillScheme}>{drill.schemeLabel}</Text>
              {onSwapRoutineDrill ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'home.a11y.swapDrill', { name: drill.name })}
                  hitSlop={8}
                  onPress={() => {
                    setDrillPick(null);
                    setDrillSwap({ kind: 'warmup', index });
                  }}
                  style={({ pressed }) => [styles.rowAction, pressed && styles.swapOptionPressed]}
                >
                  <SwapGlyph theme={theme} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </Section>

        <Section
          styles={styles}
          theme={theme}
          title={t(language, 'detail.day.exercises')}
          // Counted as the rows print them: a lift swapped in across units
          // brings its own set count.
          count={`${session.exercises.reduce(
            (sum, exercise) =>
              sum + exerciseAfterSessionSwap(exercise, exercise.slotId ? sessionSwaps[exercise.slotId] : null).sets,
            0,
          )} ${t(language, 'detail.day.sets').toLowerCase()}`}
          open={openSections.exercises}
          onToggle={() => setOpenSections((current) => ({ ...current, exercises: !current.exercises }))}
        >
        <View style={styles.exerciseList}>
          {/* Rows in runs rather than one flat list: a superset is one box
              with one label on it. */}
          {supersetRuns.map((run, runIndex) => {
            const isSuperset = run.groupId !== null && run.indexes.length >= 2;
            const previous = supersetRuns[runIndex - 1];
            const afterSuperset = Boolean(previous && previous.groupId !== null && previous.indexes.length >= 2);
            // The frame's own line is the edge at both ends of a superset. The
            // first row inside it and the first row after it each drew a rule
            // right against that line — two lines where one belongs, at the
            // top and at the bottom ("liikaa poikkiviivoja … menee
            // päällekkäin", #bugs 2026-09-26).
            const rows = run.indexes.map((index, position) =>
              renderExerciseRow(session.exercises[index], index, position === 0 && (isSuperset || afterSuperset)),
            );
            if (!isSuperset) {
              return rows;
            }
            return (
              <View key={run.groupId} style={styles.supersetGroup}>
                <SupersetBorder radius={16} />
                <View style={styles.supersetGroupPill}>
                  <Text style={styles.supersetGroupPillText}>
                    {t(language, 'guided.superset.pill')}
                  </Text>
                </View>
                {rows}
              </View>
            );
          })}
          {/* The end of the list is where "and one more" is felt. The library
              opens over this screen — see onAddExercises. */}
          {canAddExercises ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAddSheetOpen(true)}
              style={({ pressed }) => [styles.addRow, pressed && styles.swapOptionPressed]}
            >
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 5v14M5 12h14"
                  stroke={theme.purple}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={styles.addRowText}>{t(language, 'editor.addExercise')}</Text>
            </Pressable>
          ) : null}
        </View>

        </Section>

        <Section
          styles={styles}
          theme={theme}
          title={t(language, 'detail.day.cooldown')}
          count={t(language, 'detail.day.cooldownMeta')}
          open={openSections.cooldown}
          onToggle={() => setOpenSections((current) => ({ ...current, cooldown: !current.cooldown }))}
        >
          {cooldown.drills.map((drill, index) => (
            <View key={drill.name} style={styles.drillRow}>
              <View style={styles.drillChip}>
                <Text style={styles.drillChipText}>{index + 1}</Text>
              </View>
              <Text style={styles.drillName} numberOfLines={2}>
                {drill.name}
              </Text>
              <Text style={styles.drillScheme}>{drill.schemeLabel}</Text>
              {onSwapRoutineDrill ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'home.a11y.swapDrill', { name: drill.name })}
                  hitSlop={8}
                  onPress={() => {
                    setDrillPick(null);
                    setDrillSwap({ kind: 'cooldown', index });
                  }}
                  style={({ pressed }) => [styles.rowAction, pressed && styles.swapOptionPressed]}
                >
                  <SwapGlyph theme={theme} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </Section>
        {/* The legend is last on the screen, not first (design frame 05):
            the reader meets ANCHOR on a row before being lectured about it,
            and the card answers the question at the moment it is asked. */}
        {presentRoles.length > 0 ? (
          <View style={styles.roleCard}>
            {presentRoles.map((role, index) => (
              <View key={role} style={[styles.roleRow, index > 0 && styles.roleRowDivider]}>
                <View style={[styles.roleTag, { backgroundColor: tints[role].bg }]}>
                  <Text style={[styles.roleTagText, { color: tints[role].ink }]}>
                    {t(language, ROLE_TAG_KEYS[role])}
                  </Text>
                </View>
                <Text style={styles.roleLine}>{t(language, ROLE_LINE_KEYS[role])}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Last on the page, under everything the day holds, and quiet: the
            one edit here that cannot be undone by making another. */}
        {onRemoveSession ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmRemoveSession(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.removeSessionButton, pressed && styles.swapOptionPressed]}
          >
            <Text style={styles.removeSessionText}>{t(language, 'day.removeWorkout')}</Text>
          </Pressable>
        ) : null}

      </ScrollView>

      {onRemoveSession ? (
        <ConfirmDialog
          language={language}
          visible={confirmRemoveSession}
          title={t(language, 'day.removeWorkout.title')}
          message={t(language, 'day.removeWorkout.message', {
            name: dayTitle,
          })}
          confirmLabel={t(language, 'day.removeWorkout.confirm')}
          destructive
          onCancel={() => setConfirmRemoveSession(false)}
          onConfirm={() => {
            setConfirmRemoveSession(false);
            onRemoveSession();
          }}
        />
      ) : null}

      {/* The swap writes into the same map the session start reads, so what
          you choose here is what you lift.

          On the sheet kit: one tap target per row, and the scope question —
          just this time, or for ever — is asked once, in the bar, after there
          is a pick to ask it about. */}
      {/* One sheet for both blocks - the pool differs, the question does not. */}
      <KitSheet
        visible={drillSwap !== null}
        onClose={closeDrillSwap}
        title={t(language, 'drill.sheet.title')}
        context={
          drillSwap
            ? t(language, drillSwap.kind === 'warmup' ? 'drill.sheet.warmup' : 'drill.sheet.cooldown')
            : undefined
        }
        description={drillCurrent?.name}
        bottomInset={insets.bottom}
        closeLabel={t(language, 'common.close')}
        barUp={drillPick !== null}
        bar={
          <KitBar
            visible={drillPick !== null}
            from={drillCurrent?.name ?? ''}
            to={drillOptions.find((option) => option.key === drillPick)?.name ?? ''}
            buttons={[
              {
                label: t(language, 'drill.sheet.save'),
                kind: 'p',
                onPress: () => {
                  if (drillSwap && drillPick) {
                    onSwapRoutineDrill?.(
                      routineDrillSlotKey(drillSwap.kind, focusKind, drillSwap.index),
                      drillPick,
                    );
                  }
                  closeDrillSwap();
                },
              },
            ]}
            clearLabel={t(language, 'drill.sheet.pickAnother')}
            onClear={() => setDrillPick(null)}
            bottomInset={insets.bottom}
          />
        }
      >
        <ScrollView
          contentContainerStyle={styles.kitListPad}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {drillOptions.map((option) => (
            <KitRow
              key={option.key}
              title={option.name}
              meta={option.schemeLabel}
              state={option.key === drillPick ? 'sel' : option.key === drillCurrent?.key ? 'cur' : 'idle'}
              onPress={() => setDrillPick(option.key === drillCurrent?.key ? null : option.key)}
            />
          ))}
        </ScrollView>
      </KitSheet>

      {/* The guided player's sheet in swap mode — the same search, chips and
          cards (#bugs 2026-10-06; owner, 2026-10-07: everywhere). A tap picks,
          and the bar asks once — just this time, or for ever — after there is
          something to answer it about. Nothing is logged on a planned day, so
          the player's note on logged sets is left off. */}
      <ExercisePickerSheet
        visible={swapRow !== null}
        bottomInset={insets.bottom}
        language={language}
        mode="swap"
        swappedName={swapRow?.currentName ?? null}
        subtitle={null}
        search={swapQuery}
        onSearchChange={setSwapQuery}
        filters={swapPicker.filters}
        onFiltersChange={swapPicker.onFiltersChange}
        featured={
          swapPicker.featuredEntries.length > 0
            ? { title: exerciseSheetCopy('swap', language).featuredTitle, entries: swapPicker.featuredEntries }
            : null
        }
        main={{ title: swapPicker.libraryTitle, entries: swapPicker.libraryEntries }}
        emptyTitle={t(language, 'guided.swap.noMatch')}
        emptyBody={null}
        listNote={
          swapSessionHits.length > 0 ? t(language, 'swap.alreadyInSession', { names: swapSessionHits.join(', ') }) : null
        }
        pickedName={swapPickName}
        onSelect={(entry) => setSwapPickName((current) => (current === entry.name ? null : entry.name))}
        listFooter={
          <View style={styles.swapActions}>
            {/* A swap answers today. This makes it the programme's answer —
                offered only once there is a swap to keep. */}
            {swapRow?.exerciseId && sessionSwaps[swapRow.slotId] && onKeepSwap ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onKeepSwap(swapRow.exerciseId as string, sessionSwaps[swapRow.slotId]);
                  closeSwapSheet();
                }}
                style={({ pressed }) => [styles.swapRemove, pressed && styles.swapOptionPressed]}
              >
                <Text style={[styles.swapRemoveText, { color: theme.highlight }]}>
                  {t(language, 'home.swapSheet.keep')}
                </Text>
                <Text style={styles.swapRemoveNote}>
                  {t(language, 'home.swapSheet.keepNote', {
                    name: exerciseNameLabel(language, sessionSwaps[swapRow.slotId]),
                  })}
                </Text>
              </Pressable>
            ) : null}
            {/* The other thing a reader wants from a lift they cannot do. It
                was reachable only through "tee tästä oma versio", which nobody
                found and which asked them to understand the catalog first. */}
            {swapRow?.exerciseId && onRemoveExercise ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onRemoveExercise(swapRow.exerciseId as string);
                  closeSwapSheet();
                }}
                style={({ pressed }) => [styles.swapRemove, pressed && styles.swapOptionPressed]}
              >
                <Text style={[styles.swapRemoveText, { color: theme.danger }]}>
                  {t(language, 'home.swapSheet.remove')}
                </Text>
                <Text style={styles.swapRemoveNote}>{t(language, 'home.swapSheet.removeNote')}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        footer={
          swapRow && swapPickName !== null ? (
            <KitBar
              visible
              floating={false}
              from={exerciseListLabel(language, swapRow.currentName)}
              to={exerciseListLabel(language, swapPickName)}
              fromLabel={exerciseNameLabel(language, swapRow.currentName)}
              toLabel={exerciseNameLabel(language, swapPickName)}
              buttons={[
                {
                  label: t(language, 'kit.justThisTime'),
                  kind: 'p',
                  onPress: () => {
                    onSwapExercise?.(swapRow.slotId, swapPickName);
                    closeSwapSheet();
                  },
                },
                ...(swapRow.exerciseId && onKeepSwap
                  ? [
                      {
                        label: t(language, 'kit.forEver'),
                        kind: 'd' as const,
                        onPress: () => {
                          if (swapRow.exerciseId) {
                            onKeepSwap(swapRow.exerciseId, swapPickName);
                          }
                          closeSwapSheet();
                        },
                      },
                    ]
                  : []),
              ]}
              clearLabel={t(language, 'kit.pickAnother')}
              onClear={() => setSwapPickName(null)}
              bottomInset={insets.bottom}
            />
          ) : null
        }
        onClose={closeSwapSheet}
      />

      {/*
        Sets and reps — the numbers the catalog decided and the reader could
        not answer back. On the sheet kit: steppers write a draft, the commit
        bar wakes when a number actually changes and shows the whole edit on
        one line, and "Save to this day" is the only press that writes the
        programme. (Order moved out of this sheet to the arrows on the rows —
        one number per surface.)
      */}
      <KitSheet
        visible={tuneRow !== null}
        onClose={closeTuneSheet}
        title={tuneRow?.name ?? ''}
        context={t(language, 'detail.day.tuneEyebrow')}
        bottomInset={insets.bottom}
        closeLabel={t(language, 'common.close')}
        barUp={tuneChanged}
        bar={
          <KitBar
            visible={tuneChanged}
            from={formatDose(tuneStart, tuneRow ?? {})}
            to={formatDose(tuneDraft, tuneRow ?? {})}
            buttons={[
              {
                label: t(language, 'kit.saveToDay'),
                kind: 'p',
                onPress: () => {
                  if (tuneRow && tuneDraft && onPrescribe) {
                    onPrescribe(tuneRow.id, tuneDraft);
                  }
                  closeTuneSheet();
                },
              },
            ]}
            clearLabel={t(language, 'kit.undoChanges')}
            onClear={() => setTuneDraft(tuneStart)}
            bottomInset={insets.bottom}
          />
        }
      >
        <View style={styles.kitListPad}>
          {tuneRow && tuneDraft && onPrescribe ? (
            <>
              <View style={styles.tuneRow}>
                <Text style={styles.tuneLabel}>{t(language, 'detail.day.setsLabel')}</Text>
                <View style={styles.tuneControls}>
                  <RoundButton
                    glyph="minus"
                    styles={styles}
                    theme={theme}
                    disabled={!canStepProgramPrescription(tuneDraft, 'sets', -1)}
                    onPress={() => stepTune('sets', -1)}
                  />
                  <Text style={styles.tuneValue}>{tuneDraft.targetSets}</Text>
                  <RoundButton
                    glyph="plus"
                    styles={styles}
                    theme={theme}
                    disabled={!canStepProgramPrescription(tuneDraft, 'sets', 1)}
                    onPress={() => stepTune('sets', 1)}
                  />
                </View>
              </View>

              <View style={styles.tuneRow}>
                <Text style={styles.tuneLabel}>{t(language, 'editor.reps')}</Text>
                <View style={styles.tuneControls}>
                  <RoundButton
                    glyph="minus"
                    styles={styles}
                    theme={theme}
                    disabled={!canStepProgramPrescription(tuneDraft, 'reps', -1)}
                    onPress={() => stepTune('reps', -1)}
                  />
                  {/* A range stays a range: "6–8" steps to "7–9" rather than
                      collapsing to a single number the programme never wrote. */}
                  <Text style={styles.tuneValue}>
                    {tuneDraft.repMin === tuneDraft.repMax
                      ? `${tuneDraft.repMin}`
                      : `${tuneDraft.repMin}–${tuneDraft.repMax}`}
                    {doseUnitSuffix(tuneRow)}
                  </Text>
                  <RoundButton
                    glyph="plus"
                    styles={styles}
                    theme={theme}
                    disabled={!canStepProgramPrescription(tuneDraft, 'reps', 1)}
                    onPress={() => stepTune('reps', 1)}
                  />
                </View>
              </View>

              {/* Rest joins the sheet (design frame 06) — the third number the
                  catalog decided. Only when the stored draft has one: a
                  stepper over a missing number would have to invent it.
                  And not on a lift that runs straight into the next: a
                  stepper over a pause that never happens is the same lie the
                  row's own chip stopped telling. Unlink and it comes back. */}
              {tuneDraft.restSeconds !== null && !tuneRowLinkedToNext ? (
                <View style={[styles.tuneRow, styles.tuneRowLast]}>
                  <Text style={styles.tuneLabel}>{t(language, 'detail.day.restLabel')}</Text>
                  <View style={styles.tuneControls}>
                    <RoundButton
                      glyph="minus"
                      styles={styles}
                      theme={theme}
                      disabled={!canStepProgramPrescription(tuneDraft, 'rest', -1)}
                      onPress={() => stepTune('rest', -1)}
                    />
                    <Text style={styles.tuneValue}>{formatRest(tuneDraft.restSeconds)}</Text>
                    <RoundButton
                      glyph="plus"
                      styles={styles}
                      theme={theme}
                      disabled={!canStepProgramPrescription(tuneDraft, 'rest', 1)}
                      onPress={() => stepTune('rest', 1)}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </KitSheet>

      {/* The library, over the day it is adding to. Same component the editor
          uses, so search, body-part chips and the photos are the ones the
          reader already knows. */}
      {canAddExercises ? (
        <AddExerciseSheet
        bottomInset={insets.bottom}
          visible={addSheetOpen}
          language={language}
          items={exerciseLibrary ?? []}
          recentItems={recentExerciseLibraryItems}
          currentItemIds={currentLibraryItemIds}
          title={t(language, 'editor.addExercise')}
          subtitle={localizeSessionName(session.name, language)}
          multiSelect
          onClose={() => setAddSheetOpen(false)}
          onSelectItem={() => undefined}
          onConfirmSelection={(items) => {
            setAddSheetOpen(false);
            if (items.length > 0) {
              onAddExercises?.(items.map((item) => item.name));
            }
          }}
        />
      ) : null}


      {/* The "Start this workout" dock was removed on request. */}
    </View>
  );
}

/** One place up or down, on the row itself. */

const ROUND_GLYPHS = {
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
} as const;

/**
 * One press of one number.
 *
 * Disabled is drawn, not hidden: a "+" that vanishes at twelve sets reads as
 * the app losing the button, while a greyed one says the programme has a
 * ceiling and you have reached it.
 */
function RoundButton({
  glyph,
  disabled,
  onPress,
  label,
  styles,
  theme,
}: {
  glyph: keyof typeof ROUND_GLYPHS;
  disabled?: boolean;
  onPress: () => void;
  label?: string;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundButton,
        disabled && styles.roundButtonOff,
        pressed && !disabled && styles.swapOptionPressed,
      ]}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d={ROUND_GLYPHS[glyph]}
          stroke={disabled ? theme.faint : theme.purple}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

/**
 * Home's section card, rebuilt here rather than imported: Home's version is
 * wired to its own animation values and rise stagger, and lifting that out
 * would drag half a screen with it. The shape — cut card, title, count,
 * chevron, body — is the part that has to match.
 */
function Section({
  styles,
  theme,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  title: string;
  count: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <CutSurface
      size="lg"
      fill={theme.surface}
      stroke={theme.border}
      strokeWidth={1}
      style={styles.secCard}
    >
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.secHead}>
        <Text style={styles.secTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.secCount}>{count}</Text>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Path
            d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}
            stroke={theme.faint}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      {open ? <View style={styles.secBody}>{children}</View> : null}
    </CutSurface>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  // The kit's lists carry their own horizontal padding: the sheet shell pads
  // only its header, so a full-bleed list can scroll under it.
  kitListPad: { paddingHorizontal: 18, paddingBottom: 6 },
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    // The start dock this once cleared is gone (removed on request), but its
    // 120dp of room stayed — a blank stretch between the last block and the
    // tab bar on every day page. Just the tab bar's reserve now.
    paddingBottom: layout.bottomTabBarReserve,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: 6,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -0.9,
    // Takes the row's leftover width so a long name wraps instead of
    // shoving the pen off the edge.
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: spacing.lg,
  },
  // Nudged onto the first line's baseline rather than the block's top.
  titlePen: {
    paddingTop: 9,
  },
  titleEdit: {
    marginTop: 14,
    paddingHorizontal: spacing.lg,
  },
  // The field wears the title's own type, so renaming looks like editing the
  // title and not like filling in a form.
  titleInput: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -0.9,
    paddingVertical: 2,
    borderBottomWidth: 2,
    borderBottomColor: theme.highlight,
  },
  titleActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 18,
    marginTop: 8,
  },
  titleAction: {
    paddingVertical: 6,
  },
  titleActionCancel: {
    color: theme.faint,
    fontSize: 14,
    fontWeight: '700',
  },
  titleActionSave: {
    color: theme.highlight,
    fontSize: 14,
    fontWeight: '800',
  },
  pageStats: {
    flexDirection: 'row',
    gap: 22,
    marginTop: 16,
    paddingHorizontal: spacing.lg,
  },
  pageStatValue: {
    color: theme.ink,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  pageStatLabel: {
    color: theme.faint,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 1,
  },
  // Was pulled up by -58 so it overlapped the painted hero and made the
  // colour read as a header rather than a band that stops. With no hero to
  // overlap, it sits in the flow like every other card.
  roleCard: {
    marginTop: 18,
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 13,
    paddingVertical: 4,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingVertical: 9,
  },
  roleRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  roleTag: {
    minWidth: 64,
    // The pill sits beside a `flex: 1` sibling (the exercise name, the role
    // line), so a long name shrank it back to `minWidth` and "ANCHOR" wrapped
    // to "ANCHO / R" — while the LONGER "SUPPORT" survived on rows whose name
    // left slack (user 2026-09-07). `minWidth` is the floor the three pills
    // line up on; this is what stops it also being the ceiling.
    flexShrink: 0,
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  roleTagText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  // The box two paired lifts share. Its own padding keeps the outline off the
  // text, and the rows inside it are unchanged — the boundary is the only
  // thing saying they go together.
  //
  // The vertical numbers here are SUPERSET_BOX_EDGE, which the drag reads:
  // change one and change the other, or the drop lands where the box used to
  // put it.
  supersetGroup: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginVertical: 8,
  },
  // Straddles the top line and carries the card's own ground, so the line
  // stops at one edge of the word and starts at the other.
  supersetGroupPill: {
    position: 'absolute',
    // Four points higher than the line's own centre (device, 2026-09-16):
    // centred exactly, the word sat low and read as part of the first row.
    top: -11,
    left: 18,
    backgroundColor: theme.surface,
    paddingHorizontal: 6,
  },
  supersetGroupPillText: {
    color: theme.purple,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  // Where the rest chip would be, and deliberately not shaped like it: there
  // is nothing to edit here, and a chip that looks editable and is not is the
  // thing the two dose chips were changed to stop doing.
  supersetNextChip: {
    flexShrink: 1,
    justifyContent: 'center',
    paddingVertical: 5,
  },
  supersetNextChipText: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
  },
  roleLine: {
    flex: 1,
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    paddingBottom: 9,
  },
  sectionTitle: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  sectionMeta: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  noteCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  noteLine: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  secCard: {
    marginHorizontal: spacing.lg,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
  },
  secTitle: {
    flex: 1,
    color: theme.ink,
    textTransform: 'capitalize',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  secCount: {
    color: theme.faint,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
  },
  secBody: {
    paddingBottom: 12,
  },
  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  drillChip: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drillChipText: {
    color: theme.purpleDark,
    fontSize: 11,
    fontWeight: '800',
  },
  drillName: {
    flex: 1,
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  drillScheme: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  exerciseBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  // Numbers and rest on one line, with whatever is left going to the rest so
  // "tauko 2 min" never pushes the swap button off the row.
  exerciseDose: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  doseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  doseChipText: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  tuneEyebrow: {
    color: theme.faint,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  tuneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  tuneRowLast: {
    borderBottomWidth: 0,
  },
  tuneLabel: {
    flex: 1,
    color: theme.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  tuneControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Fixed width, so stepping 9 to 10 does not shuffle the buttons sideways
  // under the thumb that is still pressing them.
  tuneValue: {
    minWidth: 62,
    textAlign: 'center',
    color: theme.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonOff: {
    opacity: 0.45,
  },
  tuneDone: {
    marginTop: 18,
    borderRadius: radii.md,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tuneDoneText: {
    color: theme.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  // Right-aligned above the rows: an action ON the list, not a row in it.
  moveButtonOff: {
    opacity: 0.4,
  },
  swapButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  swapButtonText: {
    color: theme.purple,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  // Below the replacements and behind a rule: a different kind of answer, and
  // not one that should sit where a mis-tap in the list lands.
  /** The swap sheet's keep and remove, under the cards rather than among them. */
  swapActions: { marginTop: 4 },
  swapRemove: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 2,
  },
  // Red, like Home's: this is the answer that does not come back.
  swapRemoveText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  swapSearch: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surfaceSoft,
    color: theme.ink,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 10,
  },
  swapOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swapOptionGrow: { flex: 1 },
  swapOptionKeep: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  swapOptionKeepText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  swapGroup: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
  },
  swapRemoveNote: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  swapOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  swapScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 18, 70, 0.42)',
  },
  /**
   * 88%, not 70%.
   *
   * The sheet now carries a search box, up to three groups of rows and two
   * actions under them, and at 70% the rows were a peephole with the whole
   * screen dark and unused above it ("vähän sumpussa koko pakka voi antaa
   * reilusti tilaa", #bugs 2026-08-26). The cap still exists so the row being
   * swapped stays visible behind the sheet.
   */
  swapSheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  swapGrip: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    marginTop: 10,
    marginBottom: 14,
  },
  swapTitle: {
    color: theme.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 10,
  },
  swapOption: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  swapOptionPressed: {
    opacity: 0.7,
  },
  swapOptionName: {
    color: theme.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  // No gap: the rows are separated by the hairline each one carries, the way
  // a list is, rather than by air between cards (user 2026-08-31).
  exerciseList: {
    gap: 0,
  },
  // Same dashed affordance the empty workout already uses for "add a lift", so
  // the one gesture looks the same wherever a list can grow.
  // The label in the middle with its plus beside it (user 2026-08-31): left
  // -aligned under a list of left-aligned names, it read as a sixth exercise.
  removeSessionButton: {
    alignSelf: 'center',
    marginTop: 26,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  removeSessionText: {
    color: theme.danger,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 62,
    marginTop: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: theme.border,
  },
  addGlyph: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  addRowText: {
    color: theme.purpleDark,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  addFixedBlock: {
    gap: 10,
  },
  addFixedNote: {
    color: theme.faint,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  dragHandle: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  exerciseCardLift: {
    backgroundColor: theme.purpleSoft,
    borderRadius: 14,
    shadowColor: theme.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 5,
  },
  /**
   * A row, not a card (user 2026-08-31: "älä ympyröi treenejä vaan tee
   * tuollaiset katkoviivat vain väliin").
   *
   * Five boxed cards made five objects out of one list, and the box's own
   * padding was the room the swap and remove icons needed. The hairline does
   * the separating and the space goes to the content.
   */
  exerciseCard: {
    paddingHorizontal: 2,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  // The anchor is marked by its number chip, which is filled while the rest
  // are washed — a second marker on the row's edge said the same thing twice.
  exerciseCardAnchor: {},
  exerciseCardNoRule: {
    borderTopWidth: 0,
  },
  // One tap target for the two row icons, sized for a thumb rather than for
  // the glyph inside it.
  rowAction: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exerciseName: {
    flex: 1,
    color: theme.ink,
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  exerciseScheme: {
    flex: 1,
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  exerciseRest: {
    color: theme.faint,
    fontWeight: '700',
  },
});
