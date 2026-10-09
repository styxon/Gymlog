import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KitSheet } from '../components/sheetKit';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CutSurface } from '../components/CutSurface';
import { ProgramPhotoSlot } from '../components/ProgramPhotoSlot';
import { ToggleSwitch } from '../components/SettingsUi';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { formatPercent } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { cycleSchedule, resolveCycleAnchor, sessionSlotOn } from '../lib/trainingSchedule';
import { sessionForSlot } from '../lib/homeCalendar';
import { ProgramDetailViewModel } from '../lib/programDetails';
import { progressionRuleLabel } from '../lib/progressionRuleLabel';
import { EQUIPMENT_CHIP_KEYS, missingEquipment } from '../lib/programEquipment';
import { EmphasisSheet } from '../components/EmphasisSheet';
import { EMPHASIS_AREA_KEYS, emphasisAreaForExercise, resolveProgramEmphasis } from '../lib/programEmphasis';
import { WEEKDAY_INDEX, WEEKDAY_KEYS, sessionsOnTrainingDays } from '../lib/programTrainingDays';
import { DEFAULT_RHYTHM_BY_DAYS, isSetupDaysPerWeek } from '../lib/firstRunSetup';
import { estimateSessionMinutes } from '../lib/sessionDuration';
import { useDragHold } from '../hooks/useDragHold';
import {
  buildTrainingWeekLoad,
  formatTrainingDays,
  formatTrainingMinutes,
} from '../lib/trainingWeekLoad';
import { EMPHASIS_RAMP } from '../lib/programVisualIdentity';
import { Theme, useTheme, useThemedStyles } from '../theming';
import {
  formatPlanSessionTitle,
  isReaderNamedSession,
  localizeSessionName,
  localizeWorkoutFocus,
} from '../lib/sessionNameLabel';
import { layout, radii, spacing } from '../theme';
import type { AppLanguage } from '../types/models';

/** The space between day rows — the list's gap, and part of every slot. */
const DAY_ROW_GAP = spacing.sm;
/** How far a slot's outline sits outside the card that rests in it. */
const DAY_SLOT_OUTSET = 4;

const DAY_KEYS: I18nKey[] = [
  'setup.day.mon',
  'setup.day.tue',
  'setup.day.wed',
  'setup.day.thu',
  'setup.day.fri',
  'setup.day.sat',
  'setup.day.sun',
];

/**
 * "Ylävartalo · raskas" becomes "YLÄ" on a 44px weekday chip.
 *
 * The first word up to the separator, capped — the chip has to say WHICH day
 * it is, and "Treeni" seven times says nothing.
 */
function shortSessionLabel(name: string, language: AppLanguage) {
  const localized = localizeSessionName(name, language);
  const afterDay = localized.replace(/^[^:]*:\s*/, '');
  const firstWord = afterDay.split(/[\s·|&]+/).filter(Boolean)[0] ?? afterDay;
  return firstWord.slice(0, 3).toUpperCase();
}

const ROLE_LEVEL_KEYS: Record<string, I18nKey> = {
  beginner: 'detail.level.beginner',
  intermediate: 'detail.level.intermediate',
  advanced: 'detail.level.advanced',
};

/*
 * This screen used to carry its own palette — nine PLAN_* constants and about
 * thirty inline hexes, all light. Under the dark theme it kept every one of
 * them: white cards, near-black body copy on a near-black page. Every colour
 * here now comes from the theme; the last fixed ones went with the painted
 * hero they sat on (2026-08-27).
 */


interface ProgramDetailScreenProps {
  program: ProgramDetailViewModel;
  onBack: () => void;
  onPrimaryAction: () => void;
  /**
   * Is this THE active programme — the one Home leads with and the list tags?
   *
   * One programme is active and the reader may hold several (user
   * 2026-09-21). The switch used to say whether a programme was running at
   * all, so every programme the reader held read as on while only one wore
   * the ACTIVE tag: four switches on, one tag.
   */
  active?: boolean;
  /**
   * Is this programme the reader's at all, active or not?
   *
   * A programme that is not the active one is still held, and its page keeps
   * the switch — off — rather than offering to adopt it again. The switch
   * used to appear only while running, so switching it off replaced it with
   * "Ota ohjelma käyttöön" and the programme read as deleted (device,
   * 2026-09-16).
   */
  held?: boolean;
  /** Absent leaves the switch out entirely — a catalog preview has none. */
  onSetActive?: (next: boolean) => void;
  /**
   * The programme that is active now, when it is another one, by the name
   * the list gives it.
   *
   * Making this programme active moves the reader off that one, and the page
   * asks first, naming it: the advice is to finish one programme before
   * starting the next (user 2026-09-21). Null when there is nothing to move
   * off — this one is active already, or none is.
   */
  switchingFrom?: string | null;
  /**
   * The programme that becomes active if this one is switched off, by the
   * name the list gives it, or null when none would.
   *
   * Home always leads with a programme while the reader holds one running, so
   * switching the active one off hands the lead on. Said under the switch,
   * before it is pressed, rather than as a toast after: it is the one thing
   * the press changes that this page does not show.
   */
  stoppingHandsTo?: string | null;
  /**
   * Switching the active programme off asks first (user 2026-09-22). With
   * another programme to take over (`stoppingHandsTo`), the question is
   * whether to make that one active, and this does the switch. Without one,
   * the question is whether to look for a new programme, and
   * `onBrowseProgrammes` switches this one off and opens the catalogue. Either
   * way nothing changes until the reader says yes; absent, the switch stops
   * the programme straight away as before.
   */
  onSwitchOff?: () => void;
  onBrowseProgrammes?: () => void;
  /**
   * Does the adopt button make this programme the active one?
   *
   * Its other answers — starting the next session, opening the reader's own
   * version, opening the editor — change nothing about which programme is
   * active, and are not asked about.
   */
  primaryActionActivates?: boolean;
  onStartSession: (sessionId: string) => void;
  /**
   * Rename the programme. Absent for a ready one, whose name is catalog data.
   *
   * This is not the editing door that was taken off this page on 2026-08-31
   * (project-one-programme-editor): that one opened the template editor, a
   * second place to change sets, reps and order, which the day view already
   * owns. A name is the one thing about a programme the day view cannot
   * touch, and until now nothing could: `renameWorkoutTemplate` has been
   * implemented in the provider all along with nothing calling it.
   *
   * The reader asked for it because a copy carries "(kopio)" for ever — the
   * name is stored at creation, never re-derived, so no later change to the
   * naming rules ever cleans one up (user 2026-09-08).
   */
  onRenameProgram?: (name: string) => void;
  /** Days the reader named with the pen — see isReaderNamedSession. */
  readerSessionNames?: Record<string, string>;
  /** The day row's destination — the day view (design screen 2). */
  onOpenSession?: (sessionId: string) => void;
  /**
   * Drop a day where the finger let go — the whole journey as ONE write.
   *
   * Undefined leaves the list fixed, which is what a catalog programme gets:
   * reordering one would mean copying it, and nobody asks for a copy by
   * dragging.
   */
  onReorderSession?: (sessionId: string, toIndex: number) => void;
  /**
   * A new day at the end, under the name the reader gives it (#bugs
   * 2026-09-24; named first since 2026-09-26). Saved empty; its own page opens
   * next to fill it. Undefined for a catalog programme, like the reorder above.
   */
  onAddSession?: (name: string) => void;
  /** Monday-first indexes the plan currently trains on, when it names days. */
  trainingDayIndexes?: number[] | null;
  /**
   * The session each of `trainingDayIndexes` holds, in the same order — the
   * plan's own answer to which session is which day.
   */
  trainingDaySessionIds?: Array<string | null> | null;
  /**
   * Warm-up and cool-down seconds for a day's lifts, from the blocks the
   * player runs. Home adds them to its minutes; without them this page quoted
   * a shorter session than Home and the player did for the same day.
   */
  routineSeconds?: (exerciseNames: string[]) => { warmupSeconds: number; cooldownSeconds: number };
  /** Commits a finished rhythm change. Absent = the strip is read-only. */
  onSaveRhythm?: (dayIndexes: number[]) => void;
  /**
   * The app's one training cycle, when one is running. A cycle and a weekday
   * mask cannot be merged — one repeats every seven days and the other need
   * not — so while a cycle is on, the week chips become a PREVIEW of the
   * current calendar week and the presets are the way to change rhythm.
   */
  trainingCycle?: { pattern: boolean[]; anchorDayStart: number } | null;
  /** Null hands the week back to the weekday chips. */
  onChangeTrainingCycle?: (cycle: { pattern: boolean[]; anchorDayStart: number } | null) => void;
  /**
   * Writes new set counts (design screen 3). Present only for programmes whose
   * sets are the reader's to change — a catalog template is immutable at
   * runtime, so a ready programme gets no stepper rather than a stepper that
   * silently does nothing.
   */
  onSaveEmphasis?: (updates: Array<{ sessionId: string; exerciseId: string; sets: number }>) => void;
  destructiveActionLabel?: string;
  destructiveActionTitle?: string;
  destructiveActionMessage?: string;
  onDestructiveAction?: () => void;
  /**
   * The template's own progression rules, when it has them. Custom programs
   * do not — they are the reader's own sessions with no rule attached, and
   * inventing one for them would be inventing the whole section.
   */
  progressionRules?: {
    primary: string;
    secondary: string;
    accessory: string;
    failureHandling: string;
  } | null;
  /** Who the program is for, already in the reader's language. */
  audience?: string | null;
  /**
   * Why the week is shaped the way it is, already in the reader's language.
   *
   * The page shows what the programme does — the days, the gear, where the
   * volume goes, how the weight moves — and this is the one thing it cannot
   * show: why those choices were made together. It was written for all 55
   * programmes and rendered by nothing.
   */
  whyItWorks?: string | null;
  /** Gear the program needs, derived from its exercises. */
  equipment?: string[];
  /** Gear the reader has; null when the setup never said. */
  availableEquipment?: string[] | null;
  /**
   * Why this program, relative to the one being run.
   *
   * The reason was computed for the browse row and stopped there — the screen
   * with room to explain it never received it.
   */
  fitReason?: string | null;
  activePlanSummary?: {
    weekLabel: string;
    progressPercent: number;
    sessionsPerWeek: string;
    weeklyMinutes: string;
  } | null;
  language?: AppLanguage;
}

function parseMinutesFromBadges(badges: string[]) {
  const durationBadge = badges.find((badge) => badge.toLowerCase().includes('min'));
  return durationBadge ? Number.parseInt(durationBadge.replace(/\D/g, ''), 10) || 0 : 0;
}

/**
 * A default spread for a programme nobody has adopted: the same weekday
 * rhythm adoption will write (`planLabelsForProgramme` falls back to it), so
 * the strip does not move under the reader when they tap Adopt. This screen
 * used to keep a table of its own that disagreed at five days (Wed on, Thu
 * off here; the reverse once adopted).
 */
function getTrainingDayIndexes(dayCount: number) {
  if (dayCount <= 1) {
    return new Set([0]);
  }
  if (isSetupDaysPerWeek(dayCount)) {
    return new Set(DEFAULT_RHYTHM_BY_DAYS[dayCount].map((day) => WEEKDAY_INDEX[day]));
  }
  return new Set([0, 1, 2, 3, 4, 5, 6].slice(0, Math.min(dayCount, 7)));
}

export function ProgramDetailScreen({
  program,
  onBack,
  onStartSession,
  onRenameProgram,
  readerSessionNames,
  onPrimaryAction,
  active = false,
  held = false,
  onSetActive,
  switchingFrom = null,
  stoppingHandsTo = null,
  onSwitchOff,
  onBrowseProgrammes,
  primaryActionActivates = false,
  onOpenSession,
  onReorderSession,
  onAddSession,
  trainingDayIndexes = null,
  trainingDaySessionIds = null,
  routineSeconds,
  onSaveRhythm,
  trainingCycle = null,
  onChangeTrainingCycle,
  onSaveEmphasis,
  progressionRules = null,
  audience = null,
  whyItWorks = null,
  equipment = [],
  availableEquipment = null,
  fitReason = null,
  destructiveActionLabel,
  destructiveActionTitle,
  destructiveActionMessage,
  onDestructiveAction,
  activePlanSummary = null,
  language = 'en',
}: ProgramDetailScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  // The programme's own colour, the same one its browse cover wears.
  const [emphasisSheetVisible, setEmphasisSheetVisible] = useState(false);
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [newDayName, setNewDayName] = useState('');
  // The keyboard covers the bottom of the name sheet; the sheet rides on it.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (!addSessionOpen) {
      return undefined;
    }
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardInset(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => {
      shown.remove();
      hidden.remove();
      setKeyboardInset(0);
    };
  }, [addSessionOpen]);
  const canAddSession = Boolean(onAddSession);
  const submitNewDay = () => {
    setAddSessionOpen(false);
    onAddSession?.(newDayName);
  };

  /**
   * Dragging a day, identical to dragging a lift (user 2026-08-31: "tee
   * identtinen systeemi kun siellä missä treenejä voi vaihtaa").
   *
   * Raw responder handlers on the grip rather than a gesture library, heights
   * measured with onLayout rather than guessed, and the ScrollView frozen for
   * the drag's duration — two vertical gestures cannot share one finger.
   */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const rowHeights = useRef<number[]>([]);
  /** Where each day row rests, so the slots can be drawn while one is held. */
  const rowTops = useRef<number[]>([]);

  /** The grip is held before it picks a day up — see useDragHold. */
  const dragHold = useDragHold();

  const dragTargetFor = (from: number, dy: number) => {
    const heights = rowHeights.current;
    let target = from;
    let remaining = Math.abs(dy);
    const step = dy > 0 ? 1 : -1;
    for (let next = from + step; next >= 0 && next < program.sessions.length; next += step) {
      const height = heights[next] ?? 0;
      // A row and the gap after it: the list is spaced, so a slot is taller
      // than the card in it.
      if (height === 0 || remaining < (height + DAY_ROW_GAP) / 2) {
        break;
      }
      remaining -= height + DAY_ROW_GAP;
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
      const session = program.sessions[from];
      if (session) {
        onReorderSession?.(session.id, to);
      }
    }
  };
  // Flat, in a fixed order: the sheet returns set counts by index, so this
  // list is the contract between the two.
  const emphasisRows = useMemo(
    () =>
      program.sessions.flatMap((session) =>
        session.exercises.map((exercise) => ({
          sessionId: session.id,
          exerciseId: exercise.id,
          area: emphasisAreaForExercise(exercise.name),
          role: exercise.role as string,
          sets: exercise.sets,
        })),
      ),
    [program.sessions],
  );
  const emphasis = useMemo(
    () =>
      resolveProgramEmphasis(
        program.sessions.map((session) => ({
          exercises: session.exercises.map((exercise) => ({ name: exercise.name, sets: exercise.sets })),
        })),
      ),
    [program.sessions],
  );
  const [confirmVisible, setConfirmVisible] = useState(false);
  /**
   * Which control is waiting on "are you sure": the switch or the adopt
   * button. Both make this programme the active one; until the reader answers,
   * neither has done anything, and the switch still reads off.
   */
  const [pendingSwitch, setPendingSwitch] = useState<'switch' | 'adopt' | null>(null);
  const activate = (via: 'switch' | 'adopt') => {
    if (via === 'switch') {
      onSetActive?.(true);
      return;
    }
    onPrimaryAction();
  };
  const askBeforeActivating = (via: 'switch' | 'adopt') => {
    if (switchingFrom) {
      setPendingSwitch(via);
      return;
    }
    activate(via);
  };
  /**
   * The switch turned off on the active programme: which question comes
   * first. Another programme to take over asks whether to make it active;
   * none asks whether to look for a new one (user 2026-09-22). Until the
   * answer, the switch still reads on.
   */
  const [pendingOff, setPendingOff] = useState<'switch' | 'browse' | null>(null);
  const askBeforeSwitchingOff = () => {
    if (stoppingHandsTo && onSwitchOff) {
      setPendingOff('switch');
      return;
    }
    if (!stoppingHandsTo && onBrowseProgrammes) {
      setPendingOff('browse');
      return;
    }
    onSetActive?.(false);
  };
  /**
   * The one thing that makes a good program the wrong pick: a week without
   * room for it. Only shown when the setup actually says how many days the
   * reader has — guessing would turn a real warning into noise.
   */
  const missingGear = useMemo(
    () => missingEquipment(equipment as never, availableEquipment),
    [availableEquipment, equipment],
  );
  const displayTitle = formatWorkoutDisplayLabel(program.title, 'Workout plan');
  // A day's row name: the shared rule, or the reader's own words if they typed them.
  const dayTitleOf = (session: { id: string; name: string }, index: number) =>
    formatPlanSessionTitle(session, index, displayTitle, language, isReaderNamedSession(readerSessionNames, session));
  // The name being typed, or null when the title is just a title. Seeded from
  // what is on screen rather than the raw stored string, so a reader editing
  // an unnamed programme starts from the words they can see.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const commitRename = () => {
    if (nameDraft === null) {
      return;
    }
    const trimmed = nameDraft.trim();
    // Blank is a cancel, not an erasure: a programme with no name at all is a
    // row the reader cannot tell from any other. The provider refuses it too.
    //
    // Compared against `displayTitle`, NOT the stored `program.title`, because
    // that is what the field was seeded with — and the two differ more often
    // than they look. `formatWorkoutDisplayLabel` collapses whitespace, rewrites
    // a copy suffix, and swaps in the English fallback for anything under two
    // characters. Comparing against the stored name made opening the pen and
    // pressing Save without typing a write: a programme called "A" would have
    // been renamed to "Workout plan", permanently — the exact kind of name this
    // whole change exists to let the reader escape (review, PR #85).
    if (trimmed && trimmed !== displayTitle) {
      onRenameProgram?.(trimmed);
    }
    setNameDraft(null);
  };
  /** Goal and level, both translated — badges[0..1] are English. */
  const levelLabel = useMemo(() => {
    const levelKey = ROLE_LEVEL_KEYS[(program.badges[1] ?? '').toLowerCase()];
    return levelKey ? t(language, levelKey) : null;
  }, [language, program.badges]);
  /**
   * Minutes of one session.
   *
   * A ready programme states it in a badge and its browse card repeats that
   * number, so the badge wins where there is one. A programme the reader built
   * has no badge — but it does have its sessions, and the same estimator the
   * player runs on them. Without this the header answered "how long is this?"
   * with an em dash on every programme the reader made (user 2026-08-31).
   */
  const durationMinutes = useMemo(() => {
    const stated = parseMinutesFromBadges(program.badges);
    if (stated > 0) {
      return stated;
    }
    const estimates = program.sessions
      .map((session) =>
        estimateSessionMinutes({
          exercises: session.exercises.map((exercise) => ({
            name: exercise.name,
            sets: exercise.sets,
            // The top of the range is what the session is planned for.
            reps: exercise.repMax,
            timed: exercise.timed,
            minutes: exercise.minutes,
            restSeconds: exercise.restSeconds,
            supersetGroup: exercise.supersetGroup ?? null,
          })),
          // The same warm-up and cool-down Home and the player count, so the
          // three screens quote one number for one day.
          ...(session.exercises.length > 0 && routineSeconds
            ? routineSeconds(session.exercises.map((exercise) => exercise.name))
            : {}),
        }),
      )
      .filter((minutes) => minutes > 0);
    if (estimates.length === 0) {
      return 0;
    }
    return Math.round(estimates.reduce((sum, minutes) => sum + minutes, 0) / estimates.length);
  }, [program.badges, program.sessions, routineSeconds]);
  // Eight weeks is the catalog's default block; the strip states the same
  // number the total is derived from rather than two numbers that disagree.
  const progressPercent = activePlanSummary?.progressPercent ?? 1;
  const weekLabel = activePlanSummary?.weekLabel ?? t(language, 'detail.weekFallback');
  const sessionsPerWeek = activePlanSummary?.sessionsPerWeek ?? `${program.daysPerWeek}`;
  const weeklyMinutes =
    activePlanSummary?.weeklyMinutes ??
    (durationMinutes > 0
      ? `~${durationMinutes * Math.max(1, program.daysPerWeek)} min`
      : t(language, 'detail.workoutCount', { count: program.sessions.length }));
  /**
   * The rhythm the strip shows: the plan's own days when it names them, the
   * derived spread otherwise.
   *
   * Two views of one week, and the difference is the whole bug below.
   * `orderedDays` keeps the plan's order, which is where the session-to-day
   * answer lives — `planWeekdayIndexes` returns [thu, mon] for a Mon/Thu
   * programme adopted on a Wednesday. `committedDays` is the sorted view, for
   * membership, counting and the toggle, none of which care which session
   * owns which day.
   */
  const orderedDays = useMemo(() => {
    if (trainingDayIndexes && trainingDayIndexes.length > 0) {
      return [...trainingDayIndexes];
    }
    return [...getTrainingDayIndexes(program.daysPerWeek)];
  }, [program.daysPerWeek, trainingDayIndexes]);
  const committedDays = useMemo(
    () => [...orderedDays].sort((left, right) => left - right),
    [orderedDays],
  );

  /**
   * A half-finished move is never written.
   *
   * Moving a day is two taps: one off, one on. Between them the week is short
   * a session, and a plan that trains three days must not be persisted as
   * training two because a thumb left the screen. The draft lives here, is
   * committed only when the count is whole again, and is dropped when the
   * screen goes away — the reader gets Monday back rather than a week they
   * never chose.
   */
  const [draftDays, setDraftDays] = useState<number[] | null>(null);
  useEffect(() => () => setDraftDays(null), []);
  const shownDays = draftDays ?? committedDays;
  const rhythmIncomplete = draftDays !== null && draftDays.length !== committedDays.length;

  /**
   * What the header promises, recomputed from the rhythm actually on screen.
   *
   * It read `program.sessions.length` — how many different sessions exist,
   * which only equals "days per week" when the rhythm runs one of each every
   * seven days. A five-session programme on "4 on · 1 off" trains six days
   * some weeks and the header kept saying five (user 2026-08-31).
   *
   * `shownDays`, not the committed array, so the number moves under the
   * reader's thumb while they are still toggling.
   */
  const weekLoad = useMemo(
    () =>
      buildTrainingWeekLoad({
        cyclePattern: trainingCycle?.pattern ?? null,
        weekdayCount: shownDays.length,
        programDaysPerWeek: program.daysPerWeek,
        minutesPerSession: durationMinutes,
      }),
    [durationMinutes, program.daysPerWeek, shownDays, trainingCycle],
  );

  /**
   * The week's chips write the plan on a tap, and a tap is what a thumb does
   * while scrolling: "päivien vaihto liian helppo" (user 2026-09-02). They
   * take taps only behind an Edit control now; reading the week costs
   * nothing, changing it costs one deliberate tap first.
   */
  const [rhythmEditing, setRhythmEditing] = useState(false);
  const toggleRhythmDay = (index: number) => {
    if (!onSaveRhythm) {
      return;
    }
    const base = draftDays ?? committedDays;
    const next = base.includes(index)
      ? base.filter((day) => day !== index)
      : [...base, index].sort((left, right) => left - right);

    if (next.length === committedDays.length) {
      setDraftDays(null);
      onSaveRhythm(next);
      return;
    }
    setDraftDays(next);
  };

  /**
   * The rhythm presets (design frame 08, engine per the approved proposal
   * 2026-08-30): one chip row, two engines. A preset whose period is seven
   * fills the weekday mask; one whose period is NOT seven routes to the real
   * cycle engine — a 7-day mask sold as "2 on · 1 off" would drift a day per
   * week and lie by Thursday, which is the exact report the cycle engine was
   * built from (2026-08-21).
   *
   * A cycle anchors to the day it was chosen — the same "starts today" rule
   * adoption follows.
   */
  /**
   * One family, not a catalogue (user 2026-08-30: "tee vain 1workout 1 rest,
   * 2workout 1rest, 3workout 1rest — ei ruveta jokaista tekemään erikseen").
   * Every preset is N on · 1 off, and every one is a REAL cycle: a 7-day
   * mask sold as "2 on · 1 off" would drift a day per week and lie by
   * Thursday. The weekday chips above stay the hand editor for anyone whose
   * week does not fit the family.
   */
  const RHYTHM_PRESETS = [1, 2, 3, 4].map((on) => ({
    key: `${on}-1`,
    on,
    off: 1,
    pattern: [...Array.from({ length: on }, () => true), false],
  }));
  const activePresetKey = useMemo(() => {
    if (!trainingCycle) {
      return null;
    }
    const match = RHYTHM_PRESETS.find(
      (preset) =>
        preset.pattern.length === trainingCycle.pattern.length &&
        preset.pattern.every((value, index) => value === trainingCycle.pattern[index]),
    );
    return match?.key ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingCycle]);

  const applyPreset = (preset: (typeof RHYTHM_PRESETS)[number]) => {
    // A new rhythm is anchored to the day it was chosen — the same "starts
    // today" rule adoption follows. The one already stored keeps its anchor:
    // tapping the highlighted chip must not move the rest day.
    setDraftDays(null);
    onChangeTrainingCycle?.(resolveCycleAnchor(preset.pattern, trainingCycle, new Date()));
  };

  /**
   * The current calendar week as the cycle walks it — a PREVIEW, not an
   * editor. Codes come from the same sessionSlotOn every calendar asks.
   */
  const cycleWeek = useMemo(() => {
    if (!trainingCycle) {
      return null;
    }
    const schedule = cycleSchedule(trainingCycle.pattern, trainingCycle.anchorDayStart);
    const now = new Date();
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - ((now.getDay() + 6) % 7) + offset,
      );
      // Home's rule (sessionForSlot): an empty day hands its slot to the next
      // day with lifts, so this week and Home's say the same thing about a
      // date (audit 9, 2026-09-26).
      const session = sessionForSlot(program.sessions, sessionSlotOn(schedule, date));
      return {
        isTraining: session !== null,
        session: session?.name ?? null,
      };
    });
  }, [trainingCycle, program.sessions]);

  /**
   * Which session lands on which day — read from the plan's own order, never
   * from the sorted view beside it. Sorting first printed session 1 under MON
   * for a Wednesday-adopted Mon/Thu programme while Home and the calendar ran
   * it on THU: the same "a sort discards which session owns which day"
   * failure this app fixed once already, relocated to this screen
   * (PR #33 review).
   *
   * A draft in flight has no committed answer yet — handleSaveRhythm
   * re-derives one from the rotation on save — so it previews in the order
   * the chips read.
   *
   * Paired by the plan's session ids, not by position in the programme: a day
   * with no exercises is in the programme but never in the plan, and pairing
   * by position named it on a training day once it was dragged up
   * (sessionsOnTrainingDays).
   */
  const trainingDaySessions = useMemo(() => {
    const map = new Map<number, string>();
    sessionsOnTrainingDays(
      draftDays ?? orderedDays,
      draftDays ? null : trainingDaySessionIds,
      program.sessions,
    ).forEach((session, dayIndex) => map.set(dayIndex, session.name));
    return map;
  }, [draftDays, orderedDays, program.sessions, trainingDaySessionIds]);

  const scheduleSlots = useMemo(
    () =>
      DAY_KEYS.map((dayKey, index) => ({
        dayKey,
        day: t(language, dayKey).toUpperCase(),
        isTraining: shownDays.includes(index),
      })),
    [language, shownDays],
  );
  /**
   * Who it is for and why the week works, as one piece of prose.
   *
   * They were drafted as two fields and shown as two headed cards, which read
   * as two answers to nearly the same question. Together they are one short
   * paragraph: who should run this, and what makes it work for them.
   */
  const aboutCopy = [audience, whyItWorks].filter((part) => Boolean(part && part.trim())).join(' ');
  const hasDestructiveAction = Boolean(
    destructiveActionLabel && destructiveActionTitle && destructiveActionMessage && onDestructiveAction,
  );

  function handleConfirmDelete() {
    setConfirmVisible(false);
    onDestructiveAction?.();
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={dragIndex === null}
        showsVerticalScrollIndicator={false}
        // The rename field autofocuses, so the keyboard is always up when its
        // Save and Cancel are on screen. At React Native's default of "never"
        // the first tap on either only dismisses the keyboard, and the reader
        // has to tap twice — every time (review, PR #85). Every other
        // scrollable in this app that holds a TextInput already says this.
        keyboardShouldPersistTaps="handled"
      >
        {/*
          Title first, numbers under it, nothing painted.

          This opened on a 262 px gradient carrying a back button, a level
          chip and the title — a third of the screen, most of it empty colour,
          before a single fact about the programme ("ylä heron viel ihan
          liikaa tilaa … otsikko ylös data siihen ja ei mitään värikästä
          heroa", #bugs 2026-08-27). The programme's own colours are gone with
          it, and so is the week-as-bars fingerprint the browse cards draw: on
          this screen the sessions are listed below in full, so the drawing
          was decoration of something the reader was about to read.
        */}
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'common.back')}
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M15 6l-6 6 6 6"
                stroke={theme.ink}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
          {levelLabel ? (
            <View style={styles.levelPill}>
              <Text style={styles.levelPillText}>{levelLabel}</Text>
            </View>
          ) : null}
        </View>
        {nameDraft === null ? (
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle} numberOfLines={3}>
              {displayTitle}
            </Text>
            {/* A programme's own name, on the page that shows the programme.
                Only its own — a ready programme has no rename prop, because
                that name is the catalog's. */}
            {onRenameProgram ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'plan.rename')}
                hitSlop={12}
                onPress={() => setNameDraft(displayTitle)}
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
          <View>
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

        {fitReason ? (
          <View style={styles.reasonCard}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.4 7.2 17.9l.9-5.4L4.2 8.7l5.4-.8z"
                stroke={theme.purple}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.reasonText}>{fitReason}</Text>
          </View>
        ) : null}

        {program.description ? (
          <Text style={styles.leadCopy}>{program.description}</Text>
        ) : null}

        {/* Three numbers that answer one question — how much of a week is
            this? — in the order a reader asks it (user 2026-08-31). It used
            to run days, session, sessions, where the first and last were the
            same number wearing two labels. */}
        <View style={styles.statStrip}>
          {[
            {
              value: formatTrainingDays(weekLoad.daysPerWeek),
              label: 'detail.stat.daysPerWeek' as I18nKey,
            },
            {
              value: formatTrainingMinutes(weekLoad.minutesPerSession),
              label: 'detail.stat.minPerSession' as I18nKey,
            },
            {
              value: formatTrainingMinutes(weekLoad.minutesPerWeek),
              label: 'detail.stat.minPerWeek' as I18nKey,
            },
          ].map((stat, index) => (
            <React.Fragment key={stat.label}>
              {index > 0 ? <View style={styles.statStripDivider} /> : null}
              <View style={styles.statStripItem}>
                <Text style={styles.statStripValue}>{stat.value}</Text>
                <Text style={styles.statStripLabel}>{t(language, stat.label)}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Who it is for, first.

            It sat fourth, under the day list and the progression rules — so
            the reader worked through how a programme runs before finding out
            whether it was meant for them, which is the question they opened
            it with (user 2026-08-26, "nostetaan kenelle osio ylös").

            It still carries the one thing that can make it the wrong pick: a
            week that does not have room for it. */}
        {aboutCopy ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t(language, 'detail.forWhom')}</Text>
            </View>
            {/* A warning triangle stood here: "Vaatii 4 päivää viikossa. Sinun
                viikossasi on 1." It compared the programme's day count against
                the reader's stated AVAILABILITY, which is a different thing
                from their plan's rhythm — so it fired on people whose week was
                simply recorded loosely, and the reader could not tell what it
                was even about (user 2026-08-26, "en ihan tajua mikä tämä on").
                A warning nobody can act on is furniture with an alarm on it.
                The day count is stated plainly in the Rytmi section below. */}
            <View style={styles.ruleCard}>
              {/* Said once, on the one card whose text is written rather than
                  derived. Every other card on this page states something the
                  app computed from the programme — the week, the gear, the
                  volume, the progression rule — and needs no such mark. */}
              <View style={styles.aiTagRow}>
                <View style={styles.aiTag}>
                  <Text style={styles.aiTagText}>{t(language, 'detail.aiGenerated')}</Text>
                </View>
              </View>
              <Text style={styles.audienceText}>{aboutCopy}</Text>
            </View>
          </>
        ) : null}

        {/* The week as seven chips: which days train, and what they are. A
            dot-and-word list said "Treeni / Palautuminen" seven times and
            never named a single session. */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t(language, 'detail.rhythm')}</Text>
          <View style={styles.sectionHeaderEnd}>
            <Text style={styles.sectionMeta}>
              {trainingCycle
                ? // The honest number for a rhythm that ignores weekdays: the
                  // cycle's own shape, not the mask's day count.
                  t(language, 'detail.week.pattern', {
                    on: trainingCycle.pattern.filter(Boolean).length,
                    off: trainingCycle.pattern.filter((day) => !day).length,
                  })
                : t(language, 'detail.trainingDays', { count: program.daysPerWeek })}
            </Text>
            {onSaveRhythm ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: rhythmEditing }}
                onPress={() =>
                  setRhythmEditing((open) => {
                    // Closing discards an uncommitted draft. Without this the
                    // chips went inert while the "pick another day" hint kept
                    // showing — advice about controls that no longer take a
                    // tap — and the week on screen stayed the unsaved one.
                    if (open) {
                      setDraftDays(null);
                    }
                    return !open;
                  })
                }
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.65 }}
              >
                <Text style={styles.sectionAction}>
                  {t(language, rhythmEditing ? 'detail.rhythm.done' : 'detail.rhythm.edit')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.rhythmRow}>
          {scheduleSlots.map((slot, index) => {
            // While a cycle runs, the chips PREVIEW the current calendar week
            // as the cycle walks it - a weekday mask cannot express a period
            // that is not seven, and drawing one would put the old week back.
            const preview = cycleWeek?.[index] ?? null;
            const isTraining = preview ? preview.isTraining : slot.isTraining;
            const session = preview
              ? preview.session
              : slot.isTraining
                ? trainingDaySessions.get(index)
                : null;
            const chip = (
              <>
                <Text style={[styles.rhythmDayName, isTraining && styles.rhythmDayNameOn]}>
                  {slot.day}
                </Text>
                <Text
                  style={[styles.rhythmDayLabel, isTraining && styles.rhythmDayLabelOn]}
                  numberOfLines={1}
                >
                  {session ? shortSessionLabel(session, language) : t(language, 'detail.rest')}
                </Text>
              </>
            );
            if (!onSaveRhythm || !rhythmEditing) {
              return (
                <View key={slot.dayKey} style={[styles.rhythmDay, isTraining && styles.rhythmDayOn]}>
                  {chip}
                </View>
              );
            }
            return (
              <Pressable
                key={slot.dayKey}
                accessibilityRole="button"
                onPress={() => {
                  // Tapping a day means Custom (design frame 08): the cycle
                  // hands the week back to the mask, which then takes taps.
                  if (cycleWeek) {
                    onChangeTrainingCycle?.(null);
                    return;
                  }
                  toggleRhythmDay(index);
                }}
                style={({ pressed }) => [
                  styles.rhythmDay,
                  isTraining && styles.rhythmDayOn,
                  pressed && styles.rhythmDayPressed,
                ]}
              >
                {chip}
              </Pressable>
            );
          })}
        </View>
        {onSaveRhythm && rhythmEditing ? (
          <View style={styles.patRow}>
            {RHYTHM_PRESETS.map((preset) => ({
              key: preset.key,
              label: t(language, 'detail.week.pattern', { on: preset.on, off: preset.off }),
              onPress: () => applyPreset(preset),
            })).map((entry) => (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityState={{ selected: activePresetKey === entry.key }}
                onPress={entry.onPress}
                style={({ pressed }) => [
                  styles.patChip,
                  activePresetKey === entry.key && styles.patChipOn,
                  pressed && styles.rhythmDayPressed,
                ]}
              >
                <Text
                  style={[styles.patChipText, activePresetKey === entry.key && styles.patChipTextOn]}
                >
                  {entry.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {/* The cycle's own sentence used to sit here, restating a period the
            chips above already draw and a rate the header already prints
            (user 2026-08-31). */}
        {rhythmIncomplete ? (
          /* Both directions. The copy assumed a day had been removed, so
             adding one first read "Valitse viela -1 paiva". */
          <Text style={styles.rhythmHint}>
            {t(
              language,
              (draftDays?.length ?? 0) < committedDays.length
                ? 'detail.rhythm.pickAnother'
                : 'detail.rhythm.dropOne',
              { count: Math.abs(committedDays.length - (draftDays?.length ?? 0)) },
            )}
          </Text>
        ) : null}

        {/* The one thing a reader comes to an UNADOPTED programme page to do.
            It used to live in a footer pinned to the bottom of the screen,
            where the floating tab bar covered it completely: the button was
            rendered, and all you could see of it was a violet sliver above the
            nav pill. Here it sits in the flow, right after the week it
            describes, and nothing can be painted on top of it.

            On the programme already running it said "Start next workout", and
            that does not belong here (user 2026-08-31): this page is what the
            programme IS, Home is where today's session is started, and the day
            rows below open the exact session a reader wants instead. */}
        {(active || held) && onSetActive ? (
          <View style={styles.activeRow}>
            <View style={styles.activeCopy}>
              <Text style={styles.activeLabel}>{t(language, 'detail.active')}</Text>
              {/* What the switch does from where it is. Off, it said "turn it
                  off to stop the programme" — about a switch already off. */}
              <Text style={styles.activeHint}>
                {!active
                  ? t(language, 'detail.activeHintOff')
                  : stoppingHandsTo
                    ? t(language, 'detail.activeHintNext', { name: stoppingHandsTo })
                    : t(language, 'detail.activeHint')}
              </Text>
            </View>
            <ToggleSwitch
              value={active}
              onChange={(next) => (next ? askBeforeActivating('switch') : askBeforeSwitchingOff())}
              label={t(language, 'detail.active')}
            />
          </View>
        ) : activePlanSummary ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={program.primaryActionLabel}
            onPress={() => (primaryActionActivates ? askBeforeActivating('adopt') : onPrimaryAction())}
            style={({ pressed }) => [styles.adoptButton, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.adoptButtonText}>{program.primaryActionLabel}</Text>
          </Pressable>
        )}

        {emphasis ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.emphasisTitle}>{t(language, 'detail.emphasis.title')}</Text>
              {onSaveEmphasis ? (
                <Pressable hitSlop={8} onPress={() => setEmphasisSheetVisible(true)}>
                  <Text style={styles.emphasisEdit}>{t(language, 'detail.emphasis.edit')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.emphasisCard}>
              <View style={styles.emphasisBar}>
                {emphasis.slices.map((slice) => (
                  <View
                    key={slice.area}
                    style={[
                      styles.emphasisSegment,
                      { flex: slice.sets, backgroundColor: EMPHASIS_RAMP[slice.area] },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.emphasisLegend}>
                {emphasis.slices.map((slice) => (
                  <View key={slice.area} style={styles.emphasisLegendItem}>
                    <View style={[styles.emphasisDot, { backgroundColor: EMPHASIS_RAMP[slice.area] }]} />
                    <Text style={styles.emphasisLegendText}>
                      {t(language, EMPHASIS_AREA_KEYS[slice.area])}{' '}
                      <Text style={styles.emphasisLegendPercent}>{formatPercent(slice.percent, language)}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {/*
          No "Edit" beside this heading any more (user 2026-08-31).

          It opened the template editor, which is a second way to change a
          programme the reader can already change by opening the day: sets,
          reps, order, swaps and removals all live in the day view now. Two
          editors for one programme is two places to look for the same control
          and two ways for them to disagree — and the one this heading offered
          was the one that knows less about the day it is editing.
        */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t(language, 'detail.workouts')}</Text>
        </View>
        {/* Compact rows now (design: "päivärivi vie tänne") — the full
            content moved to the day view, where roles, rests and the warm-up
            have the room the inline list never gave them. The row still keeps
            its quick Aloita, because starting today's session is the most
            common thing done here. */}
        <View style={styles.workoutList}>
          {/* The slots, while a day is held (#bugs 2026-09-26: "kun painaa
              pohjaa tulee ääriviivat jokaisen laatikon kohdalle … jokainen
              treenipäivä napsahtaa omalle paikalleen"). One outline where each
              day rests, drawn under the rows, and the one the held day will
              drop into in the action colour. Absolute, so it takes no room and
              the rows keep the positions the drag measures. */}
          {dragIndex !== null ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {program.sessions.map((session, index) => {
                const top = rowTops.current[index];
                const height = rowHeights.current[index];
                if (top === undefined || !height) {
                  return null;
                }
                return (
                  <View
                    key={session.id}
                    style={[
                      styles.daySlot,
                      { top: top - DAY_SLOT_OUTSET, height: height + DAY_SLOT_OUTSET * 2 },
                      dragTarget === index && styles.daySlotTarget,
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
          {program.sessions.map((session, index) => {
            const dragging = dragIndex === index;
            // While a row travels, the rows between it and its target make
            // room by exactly its slot — its height and the gap after it — so
            // each one settles into the outline drawn for it. By height alone
            // they stopped a gap short of the outline they were moving to.
            const slot = (rowHeights.current[dragIndex ?? 0] ?? 0) + DAY_ROW_GAP;
            const shift =
              dragIndex !== null && dragTarget !== null && !dragging
                ? dragIndex < index && index <= dragTarget
                  ? -slot
                  : dragTarget <= index && index < dragIndex
                    ? slot
                    : 0
                : 0;
            return (
            <Animated.View
              key={session.id}
              onLayout={(event) => {
                rowHeights.current[index] = event.nativeEvent.layout.height;
                rowTops.current[index] = event.nativeEvent.layout.y;
              }}
              style={[
                shift !== 0 && { transform: [{ translateY: shift }] },
                dragging && [styles.workoutCardLift, { transform: [{ translateY: dragY }] }],
              ]}
            >
            <Pressable
              onPress={() => (onOpenSession ?? onStartSession)(session.id)}
              style={({ pressed }) => [styles.workoutCard, pressed && styles.workoutCardPressed]}
            >
              <View style={styles.workoutTopRow}>
                {onReorderSession && program.sessions.length > 1 ? (
                  <View
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'detail.day.dragHandle', {
                      name: dayTitleOf(session, index),
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
                    style={styles.workoutDragHandle}
                  >
                    {/* Three lines, the grip every list app draws (#bugs
                        2026-09-26); two read as an equals sign. */}
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
                {/* No index tile: the row's own title already says "Päivä 1",
                    so the big numeral was the same fact twice, at the size of
                    the more important one. */}
                <View style={styles.workoutCopy}>
                  {/* One line, ellipsised — NOT adjustsFontSizeToFit, which
                      re-measures on every re-layout and made the titles jump
                      size while a day was being dragged past them (#bugs
                      2026-09-05). A name too long for the row is truncated
                      here exactly as it is in Historia and on Progress. */}
                  <Text style={styles.workoutName} numberOfLines={1}>
                    {dayTitleOf(session, index)}
                  </Text>
                  <Text style={styles.workoutMeta}>
                    {t(
                      language,
                      session.exerciseCount === 1 ? 'tpl.exerciseOne' : 'tpl.exerciseMany',
                      { count: session.exerciseCount },
                    )}
                    {session.totalSets > 0 ? ` · ${session.totalSets} ${t(language, 'detail.day.sets').toLowerCase()}` : ''}
                    {durationMinutes > 0 ? ` · ~${durationMinutes} min` : ''}
                  </Text>
                </View>
                {/* An eye, not a chevron and not a start button: the row is a
                    look at the day, and the day view has the real start. Two
                    starts a thumb-width apart is how you begin the wrong
                    session. */}
                <Svg viewBox="0 0 24 24" width={19} height={19}>
                  <Path
                    d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"
                    stroke={theme.highlight}
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <Circle cx={12} cy={12} r={2.6} stroke={theme.highlight} strokeWidth={1.9} fill="none" />
                </Svg>
              </View>
            </Pressable>
            </Animated.View>
            );
          })}
          {/* A day is added where the list ends: named first, then filled on
              its own page (user, 2026-09-26). */}
          {canAddSession ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNewDayName('');
                setAddSessionOpen(true);
              }}
              style={({ pressed }) => [styles.addSessionRow, pressed && styles.workoutCardPressed]}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M12 5v14M5 12h14" stroke={theme.highlight} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
              <Text style={styles.addSessionText}>{t(language, 'detail.addWorkout')}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* "Tee tästä oma versio" stood here. It asked the reader to
            understand that catalog programmes are fixed and theirs are not,
            before they could change one lift — and the reader looking for a
            way to drop an exercise never found it (user 2026-08-26). The copy
            still happens; it happens underneath the change that needed it. */}

        {/* How the weight goes up.
            The catalog carries these four rules per template and the app had
            never shown one: they were written in English, and the screen's
            answer to English text had been not to render it. 55 templates
            share 69 distinct sentences between them, so they are translated
            the same way exercise names are. */}
        {progressionRules ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t(language, 'detail.progression')}</Text>
            </View>
            <View style={styles.ruleCard}>
              {(
                [
                  ['detail.rule.primary', progressionRules.primary],
                  ['detail.rule.secondary', progressionRules.secondary],
                  ['detail.rule.failure', progressionRules.failureHandling],
                ] as Array<[I18nKey, string]>
              ).map(([labelKey, rule], index) => (
                <View key={labelKey} style={[styles.ruleRow, index > 0 && styles.ruleRowDivider]}>
                  <Text style={styles.ruleIndex}>{index + 1}</Text>
                  <Text style={styles.ruleText}>
                    <Text style={styles.ruleLead}>{t(language, labelKey)} </Text>
                    {progressionRuleLabel(language, rule)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}


        {equipment.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t(language, 'detail.equipment')}</Text>
            </View>
            {/* Derived from the program's own exercises, not from a sentence
                someone wrote. The chips are the names the setup already
                stores, so the two lists compare directly. */}
            <View style={styles.chipWrap}>
              {equipment.map((chip) => (
                <CutSurface key={chip} size="chip" fill={theme.surface} style={styles.equipChip}>
                  <Text style={styles.equipChipText}>
                    {t(language, EQUIPMENT_CHIP_KEYS[chip] ?? 'detail.equipment')}
                  </Text>
                </CutSurface>
              ))}
            </View>
            {/* Only the gap is worth a line. A gym that has everything is the
                normal case, and a green "all there" note under every
                programme said nothing the reader did not already assume. */}
            {availableEquipment !== null && missingGear.length > 0 ? (
              <View style={styles.gymNote}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M12 4l9 16H3z M12 10v4M12 17v.01"
                    stroke={theme.amber}
                    strokeWidth={2.3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
                <Text style={styles.gymNoteText}>
                  {t(language, 'detail.equipmentMissing', {
                    items: missingGear
                      .map((chip) => t(language, EQUIPMENT_CHIP_KEYS[chip] ?? 'detail.equipment'))
                      .join(', '),
                  })}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {/* "Make my own version" used to sit here. Removed on request: it was
            the only action a reader could actually see on this screen, so a
            programme page read as an invitation to fork rather than to train.
            Home's Adapt sheet still offers the copy for a programme you are
            already running. */}
        {hasDestructiveAction ? (
          <Pressable onPress={() => setConfirmVisible(true)} style={styles.destructiveButton}>
            <Text style={styles.destructiveButtonText}>{destructiveActionLabel}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {canAddSession ? (
        <KitSheet
          visible={addSessionOpen}
          onClose={() => setAddSessionOpen(false)}
          title={t(language, 'detail.addWorkout')}
          // The keyboard's height already reaches the screen's edge, as Home's
          // rename sheet reads it: one or the other, never both.
          bottomInset={keyboardInset > 0 ? keyboardInset : insets.bottom}
          closeLabel={t(language, 'common.close')}
        >
          <View style={styles.newDayBody}>
            <TextInput
              value={newDayName}
              onChangeText={setNewDayName}
              autoFocus
              // What a blank name becomes, so leaving it empty is a choice the
              // reader can see rather than a surprise on the list.
              placeholder={t(language, 'detail.workoutPlaceholder', { index: program.sessions.length + 1 })}
              placeholderTextColor={theme.faint}
              accessibilityLabel={t(language, 'detail.addDay.nameLabel')}
              returnKeyType="done"
              onSubmitEditing={submitNewDay}
              style={styles.newDayInput}
            />
            <Pressable
              accessibilityRole="button"
              onPress={submitNewDay}
              style={({ pressed }) => [styles.newDayCta, pressed && styles.workoutCardPressed]}
            >
              <Text style={styles.newDayCtaText}>{t(language, 'detail.addWorkout')}</Text>
            </Pressable>
          </View>
        </KitSheet>
      ) : null}

      {onSaveEmphasis ? (
        <EmphasisSheet
          visible={emphasisSheetVisible}
          language={language}
          bottomInset={insets.bottom}
          exercises={emphasisRows}
          onClose={() => setEmphasisSheetVisible(false)}
          onSave={(sets) => {
            setEmphasisSheetVisible(false);
            onSaveEmphasis(
              emphasisRows
                .map((row, index) => ({ ...row, sets: sets[index] ?? row.sets }))
                // Only what actually changed: a save that rewrites every
                // exercise touches rows the reader never moved.
                .filter((row, index) => row.sets !== emphasisRows[index].sets)
                .map((row) => ({ sessionId: row.sessionId, exerciseId: row.exerciseId, sets: row.sets })),
            );
          }}
        />
      ) : null}

      {hasDestructiveAction ? (
        <ConfirmDialog
          language={language}
          visible={confirmVisible}
          title={destructiveActionTitle!}
          message={destructiveActionMessage!}
          confirmLabel={destructiveActionLabel!}
          destructive
          onCancel={() => setConfirmVisible(false)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      <ConfirmDialog
        language={language}
        visible={pendingSwitch !== null && switchingFrom !== null}
        title={t(language, 'detail.switchActive.title')}
        message={t(language, 'detail.switchActive.message', { name: switchingFrom ?? '' })}
        confirmLabel={t(language, 'detail.switchActive.confirm')}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const via = pendingSwitch;
          setPendingSwitch(null);
          if (via) {
            activate(via);
          }
        }}
      />

      <ConfirmDialog
        language={language}
        visible={pendingOff !== null}
        title={t(language, pendingOff === 'browse' ? 'detail.browseOff.title' : 'detail.switchOff.title')}
        message={
          pendingOff === 'browse'
            ? t(language, 'detail.browseOff.message')
            : t(language, 'detail.switchOff.message', { name: stoppingHandsTo ?? '' })
        }
        confirmLabel={t(language, pendingOff === 'browse' ? 'detail.browseOff.confirm' : 'detail.switchOff.confirm')}
        onCancel={() => setPendingOff(null)}
        onConfirm={() => {
          const kind = pendingOff;
          setPendingOff(null);
          if (kind === 'switch') {
            onSwitchOff?.();
          } else if (kind === 'browse') {
            onBrowseProgrammes?.();
          }
        }}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
  // The level, in the theme's own wash rather than a white chip that only
  // worked because it sat on a painted background.
  levelPill: {
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  levelPillText: {
    color: theme.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  pageTitle: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
    marginTop: 2,
    // Takes the row's leftover width so a long name wraps to its three lines
    // instead of shoving the pen off the edge.
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  // Nudged onto the first line's baseline rather than the block's top.
  titlePen: {
    paddingTop: 9,
  },
  // The field wears the title's own type, so renaming looks like editing the
  // title and not like filling in a form.
  titleInput: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
    marginTop: 2,
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
  leadCopy: {
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: 14,
  },
  statStrip: {
    flexDirection: 'row',
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: 13,
  },
  statStripItem: {
    flex: 1,
    alignItems: 'center',
  },
  statStripDivider: {
    width: 1,
    backgroundColor: theme.border,
    marginVertical: 3,
  },
  statStripValue: {
    color: theme.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statStripLabel: {
    color: theme.faint,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 3,
  },
  rhythmRow: {
    flexDirection: 'row',
    gap: 5,
  },
  patRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  patChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  patChipOn: {
    borderColor: theme.highlight,
    backgroundColor: theme.highlightSoft,
  },
  patChipText: {
    fontFamily: 'JetBrainsMono',
    fontSize: 11,
    fontWeight: '700',
    color: theme.muted,
  },
  patChipTextOn: { color: theme.highlight },
  rhythmDay: {
    flex: 1,
    borderRadius: 13,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 9,
    alignItems: 'center',
  },
  rhythmDayOn: {
    backgroundColor: theme.highlight,
    borderColor: theme.highlight,
  },
  rhythmDayPressed: {
    opacity: 0.7,
  },
  rhythmHint: {
    color: theme.highlight,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 8,
  },
  rhythmDayName: {
    color: theme.faint,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  rhythmDayNameOn: {
    color: theme.onHighlight,
    opacity: 0.7,
  },
  rhythmDayLabel: {
    color: theme.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    marginTop: 6,
  },
  rhythmDayLabelOn: {
    color: theme.onHighlight,
  },
  reasonCard: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  reasonText: {
    flex: 1,
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  equipChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  equipChipText: {
    color: theme.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  gymNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    backgroundColor: theme.amberSoft,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  gymNoteText: {
    flex: 1,
    color: theme.amberInk,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  ruleCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
  },
  ruleRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  ruleIndex: {
    width: 14,
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  ruleText: {
    flex: 1,
    color: theme.ink,
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '600',
  },
  ruleLead: {
    color: theme.ink,
    fontWeight: '800',
  },
  audienceText: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  /**
   * The mark sits on its own row above the copy rather than floating over it.
   * Absolutely positioned in the corner, it would have the first line of text
   * running underneath it at any width that wraps.
   */
  aiTagRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  aiTag: {
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  aiTagText: {
    color: theme.muted,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  roleTag: {
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
  content: {
    paddingHorizontal: spacing.lg,
    // The +82 was clearance for the pinned footer that used to sit here.
    paddingBottom: layout.bottomTabBarReserve,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: theme.ink,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  sectionHeaderEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionAction: {
    color: theme.highlight,
    fontSize: 13,
    fontWeight: '800',
  },
  workoutList: {
    gap: DAY_ROW_GAP,
  },
  // Outside the card by a few points, so the outline shows around a row that
  // settles into it rather than hiding under it.
  daySlot: {
    position: 'absolute',
    left: -DAY_SLOT_OUTSET,
    right: -DAY_SLOT_OUTSET,
    borderRadius: radii.lg + DAY_SLOT_OUTSET,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.border,
  },
  daySlotTarget: {
    borderColor: theme.highlight,
    backgroundColor: theme.highlightSoft,
  },
  addSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: theme.border,
  },
  newDayBody: {
    paddingHorizontal: 18,
    gap: 12,
  },
  newDayInput: {
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 14,
    color: theme.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  newDayCta: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.highlight,
  },
  newDayCtaText: {
    color: theme.onHighlight,
    fontSize: 16,
    fontWeight: '900',
  },
  // Pressable, so the action accent — violet on this page is brand only.
  addSessionText: {
    color: theme.highlight,
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '800',
  },
  workoutCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // Wide enough for a thumb, and the row's only place a drag may start —
  // anywhere else on the card is the tap that opens the day.
  workoutDragHandle: {
    width: 34,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
    marginRight: 2,
  },
  // The travelling row rides above the ones making room for it.
  workoutCardLift: {
    zIndex: 5,
    elevation: 5,
  },
  workoutCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  emphasisEdit: {
    color: theme.highlight,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  emphasisTitle: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  emphasisCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 14,
  },
  emphasisBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  emphasisSegment: {
    height: '100%',
  },
  emphasisLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 8,
    marginTop: 11,
  },
  emphasisLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  emphasisDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  emphasisLegendText: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  emphasisLegendPercent: {
    color: theme.ink,
    fontWeight: '800',
  },
  workoutTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  workoutCopy: {
    flex: 1,
    gap: 3,
  },
  workoutName: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  workoutMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  workoutAction: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    justifyContent: 'center',
    // Actions wear the action accent; green here stays for recovery days only.
    backgroundColor: theme.highlightSoft,
  },
  workoutActionText: {
    color: theme.highlight,
    fontSize: 13,
    fontWeight: '900',
  },
  /**
   * Red, not a hint of red.
   *
   * This was `dangerSoft` behind `danger` text — in the dark theme a
   * near-black maroon under soft coral, which reads as a disabled button
   * rather than as the one action on the page that does not come back
   * ("poista ohjelma voisi olla punainen oikeasti nyt on vähän haalea",
   * 2026-08-27). Filled, with white on it, in both themes. The confirmation
   * dialog is what stands between the press and the deletion; the button's
   * job is to be unmistakable.
   */
  destructiveButton: {
    minHeight: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Outlined, not a filled slab (design frame 08): destructive keeps its
    // colour, but a solid red block at the foot of every programme page made
    // deletion look like a primary action.
    borderWidth: 1.5,
    borderColor: theme.danger,
    backgroundColor: 'transparent',
  },
  destructiveButtonText: {
    color: theme.danger,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  // The Active switch stands where the adopt button does, because it answers
  // the same question at the other end of the programme's life.
  activeRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  activeCopy: { flex: 1, minWidth: 0 },
  activeLabel: { color: theme.ink, fontSize: 16, fontWeight: '800' },
  activeHint: { color: theme.muted, fontSize: 12.5, lineHeight: 17, fontWeight: '600', marginTop: 2 },
  adoptButton: {
    marginTop: 22,
    minHeight: 62,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: theme.highlight,
    shadowColor: theme.highlight,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  adoptButtonText: {
    color: theme.onHighlight,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
});
