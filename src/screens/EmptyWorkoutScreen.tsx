import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { PlatePop } from '../components/PlatePop';
import { REST_BAR_BOTTOM, RestBar } from '../components/RestBar';
import {
  buildSupersetRuns,
  isSupersetLinked,
  normalizeSupersetGroups,
  setSupersetLink,
  supersetGroupIndexes,
  supersetPositions,
} from '../lib/supersetGrouping';
import { SupersetBorder } from '../components/SupersetBorder';
import { formatLiftDisplayLabel } from '../lib/displayLabel';
import { setFieldAccessibilityLabel } from '../lib/accessibilityLabels';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { BODY_PART_FILTERS, BodyPartFilter } from '../lib/exerciseBrowseFilter';
import { compareByShownName, exercisePickerChipLabel, exercisePickerLabel, exercisePickerRowMeta, listPickerExercises } from '../lib/exercisePicker';
import { orderExercisesBySelection } from '../lib/exerciseSelectionOrder';
import { parseNumberInput, removeTrailingZeros } from '../lib/format';
import {
  FreestyleExerciseDraft,
  FreestyleFinishSummary,
  buildFreestyleFinish,
  canFinishFreestyleSession,
  carryForwardFreestyleSet,
  exerciseInitials,
  freestyleUnsavedWork,
  isLoggableFreestyleSet,
  freestyleNextSetTarget,
  freestyleRestSecondsForTick,
  freestyleVolumeKg,
  FreestyleDraftSnapshot,
  FreestyleExerciseSnapshot,
  resolveFreestyleDraftStart,
  resolveFreestyleFinish,
  resolveFreestyleLastEdit,
  resolveFreestyleSessionId,
} from '../lib/emptyWorkoutSession';
import { getExerciseTemplateDefaults, getPopularExerciseLibraryItems, getPopularExerciseLibraryOrder } from '../lib/exerciseSuggestions';
import { t } from '../lib/i18n';
import { createId } from '../lib/ids';
import { ExercisePrLookup } from '../lib/workoutCompletionSummary';
import { Theme, useTheme, useThemedStyles, aw3ForTheme, useAW3 } from '../theming';
import { AppLanguage, ExerciseLibraryItem, WorkoutTemplateDraft } from '../types/models';
import { trackEvent } from '../features/analytics/analyticsClient';
import { subscribeRestActions, useRestEndAlert } from '../hooks/useRestEndAlert';
import { useRestAlertPermissionMoment } from '../hooks/useRestAlertPermissionMoment';
import { RestAlertAskOutcome } from '../lib/restAlertAnswer';
import { RestAlertsSheet } from '../components/RestAlertsSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { describeRest, extendRest } from '../lib/restSchedule';
import { useKeyboardReveal } from '../hooks/useKeyboardReveal';
import { haptics } from '../utils/haptics';
import { useKeepScreenAwake } from '../utils/keepAwake';
import { sound } from '../utils/sound';

/**
 * Freestyle logging in the Vinha (HG) language — replaces the old generic
 * Empty Workout presentation. Empty state → Add-exercise sheet → set table
 * with plate readout and the shared floating rest bar. Design source:
 * empty-workout.jsx + aw3-shared.jsx in the design archive.
 */

// The lift as the screen holds it — the same shape the provider persists.
type FreestyleExerciseState = FreestyleExerciseSnapshot;

interface EmptyWorkoutScreenProps {
  exerciseLibrary: ExerciseLibraryItem[];
  recentExerciseLibraryItems: ExerciseLibraryItem[];
  defaultRestSeconds: number;
  keepScreenAwake?: boolean;
  /**
   * The records this board's Finish compares against, for the id it finishes under: without that
   * workout's own earlier save, when the board is one carried on after it (else the same set it saved
   * the first time is its own previous best, and the record card it earned is gone).
   */
  exercisePrLookupBefore: (sessionId: string | null | undefined) => ExercisePrLookup;
  language?: AppLanguage;
  onBack: () => void;
  /**
   * `adoptSessionId` is how the save tells the board it filed these sets under another id than the
   * board's own (the board's was taken by another workout): the board keeps the new one, so a
   * failure or a kill cannot leave these sets under an id that says they are saved.
   */
  onSave: (
    draft: WorkoutTemplateDraft,
    summary: FreestyleFinishSummary,
    adoptSessionId?: (sessionId: string) => void,
  ) => Promise<void> | void;
  /**
   * The session in flight, from the workout provider: read once, on mount,
   * so a process the OS reclaimed mid-session reopens on the same board.
   * Mirrored back through the two callbacks — the provider persists it.
   */
  freestyleDraft?: FreestyleDraftSnapshot | null;
  onSaveDraft?: (snapshot: FreestyleDraftSnapshot) => void;
  onClearDraft?: () => void;
  /** Rest & alerts settings (design: Background Timer). */
  restAlerts?: { alerts: boolean; warning: boolean; ongoing: boolean; asked: boolean };
  /**
   * The in-app permission sheet was answered. Recorded so it is never shown
   * twice — and on "granted" the phone's notifications go on for the workout
   * (see restAlertsAnswered).
   */
  onRestAlertsAnswered?: (outcome: RestAlertAskOutcome) => void;
  /** The denied banner's "Turn on" — opens system settings. */
  onOpenSystemSettings?: () => void;
}

/**
 * The line under a lift's name, in the sheet and on the workout's card: the
 * library's words (exercisePickerRowMeta), as in every other picker. This
 * screen said "Hauikset" where the others said "Hauis", and "Kehonpaino" in
 * the type's place (#bugs 2026-10-06).
 */
function buildMetaLabel(item: ExerciseLibraryItem, language: AppLanguage) {
  return exercisePickerRowMeta(item, language);
}

function createSet(carry: { kg: string; reps: string } = { kg: '', reps: '' }) {
  return { localKey: createId('set'), kg: carry.kg, reps: carry.reps, done: false };
}

function buildExerciseState(
  item: ExerciseLibraryItem,
  defaultRestSeconds: number,
  language: AppLanguage,
): FreestyleExerciseState {
  const defaults = getExerciseTemplateDefaults(item, defaultRestSeconds);
  const displayName = exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'));

  return {
    localKey: createId('draft'),
    name: item.name,
    libraryItemId: item.id,
    imageUrl: item.imageUrls?.[0] ?? null,
    repMin: defaults.repMin,
    repMax: defaults.repMax,
    restSeconds: defaults.restSeconds,
    trackedDefault: defaults.trackedDefault,
    sets: [createSet()],
    displayName,
    initials: exerciseInitials(displayName),
    metaLabel: buildMetaLabel(item, language),
    isBarbell: item.equipment === 'barbell',
  };
}

/** Session clock in the design's m:ss form (minutes unbounded). */
function formatSessionClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  return `${Math.floor(safe / 60)}:${`${safe % 60}`.padStart(2, '0')}`;
}

function formatVolumeLabel(volumeKg: number) {
  return removeTrailingZeros(volumeKg);
}

// ── small shared pieces ──────────────────────────────────────────────────

function PlusIcon({ size, color, strokeWidth = 2.8 }: { size: number; color: string; strokeWidth?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

function CheckIcon({ size, color, strokeWidth = 3 }: { size: number; color: string; strokeWidth?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path d="M5 12l5 5L19 7" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Letter tile — the purpleLight / purpleDark idiom shared with the guided player. */
function Tile({ initials, size = 46, radius = 12, fontSize }: { initials: string; size?: number; radius?: number; fontSize?: number }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.tileText, { fontSize: fontSize ?? Math.round(size * 0.36) }]}>{initials}</Text>
    </View>
  );
}

/** Mount fade+rise, mirroring the mock's aw3Fade keyframe. */
function FadeInView({ style, children }: { style?: object; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  // Interpolated once — a per-render interpolate leaks native animated nodes
  // (disconnectAnimatedNodes crash), and this screen re-renders on the timer.
  const translateY = useRef(progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [progress]);

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

/** Check button with the aw3Pop squash when a set flips to done. */
function SetCheckButton({ done, label, onPress }: { done: boolean; label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const AW3 = useAW3();

  const scale = useRef(new Animated.Value(1)).current;
  const wasDone = useRef(done);

  useEffect(() => {
    if (done && !wasDone.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.9, duration: 140, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
    wasDone.current = done;
  }, [done, scale]);

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Animated.View style={[styles.setCheck, done && styles.setCheckDone, { transform: [{ scale }] }]}>
        <CheckIcon size={18} color={done ? '#FFFFFF' : AW3.ghost} />
      </Animated.View>
    </Pressable>
  );
}

// ── Add-exercise sheet ───────────────────────────────────────────────────

interface AddSheetProps {
  visible: boolean;
  /**
   * Height of the phone's system-button bar, read by the SCREEN.
   *
   * This sheet is a Modal, and a Modal is its own native window: inside one
   * this app gets zero for the bottom inset from the root provider, from a
   * provider added inside the modal, and from `initialWindowMetrics` alike —
   * all three tried on the emulator with three-button navigation while the
   * confirm button sat half under the bar ("alla olevat napit ei näy kunnolla
   * jää puhelimen nappien taakse", #bugs 2026-08-28). Outside the modal the
   * same hook is right, which is why the tab bar has never had this problem.
   */
  bottomInset?: number;
  items: ExerciseLibraryItem[];
  language: AppLanguage;
  onClose: () => void;
  onAdd: (items: ExerciseLibraryItem[]) => void;
}

function SelectTogglePill({ selected }: { selected: boolean }) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.selectPill, selected && styles.selectPillOn]}>
      {selected ? <CheckIcon size={16} color="#FFFFFF" strokeWidth={2.8} /> : <PlusIcon size={16} color={theme.purple} />}
    </View>
  );
}

function AddExerciseSheetHG({ visible, items, language, onClose, onAdd, bottomInset = 0 }: AddSheetProps) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);
  const AW3 = useAW3();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The pickers' body-part chips, "Etureidet" and the arms among them: this
  // sheet had six of its own, and no way to the leg extension but "Jalat".
  const [filter, setFilter] = useState<BodyPartFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) {
      setSelectedIds([]);
      setFilter('all');
      setQuery('');
    }
  }, [visible]);

  const toggle = (id: string) =>
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const normalizedQuery = query.trim().toLowerCase();
  const popularOrder = useMemo(() => getPopularExerciseLibraryOrder(items), [items]);
  // Best answer first: the plain lat pulldown before the twelve variants
  // that also contain "ylätalja". See rankExerciseMatches.
  const matches = useMemo(
    () =>
      // Every picker's one list (lib/exercisePicker): no stretches, drills or
      // strongman implements until the reader types (#bugs 2026-10-06).
      listPickerExercises(items, {
        query: normalizedQuery,
        filters: { bodyPart: filter },
        language,
        popularity: (item) => popularOrder.get(item.id),
      }),
    [filter, items, language, normalizedQuery, popularOrder],
  );

  const popularItems = useMemo(() => {
    const matchIds = new Set(matches.map((item) => item.id));
    return getPopularExerciseLibraryItems(items, 8)
      .filter((item) => matchIds.has(item.id))
      .slice(0, 4);
  }, [items, matches]);

  const popularIds = useMemo(() => new Set(popularItems.map((item) => item.id)), [popularItems]);
  const listItems = useMemo(() => {
    const rest = matches.filter((item) => !popularIds.has(item.id));
    // Alphabet is for browsing; a query already put the best answer first.
    // By the name on screen, as the add sheet sorts — not the stored English.
    return normalizedQuery ? rest : rest.sort(compareByShownName(language));
  }, [matches, normalizedQuery, popularIds]);

  const confirm = () => {
    if (!selectedIds.length) {
      return;
    }
    // In tap order, not library order — see orderExercisesBySelection.
    onAdd(orderExercisesBySelection(items, selectedIds));
  };

  const listHeader = (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetChipRow}>
        {BODY_PART_FILTERS.map((option) => {
          const active = option === filter;
          return (
            <Pressable key={option} onPress={() => setFilter(option)} style={[styles.sheetChip, active && styles.sheetChipActive]}>
              <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>
                {exercisePickerChipLabel(option, language)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {popularItems.length > 0 ? (
        <>
          <View style={styles.sheetSectionHeader}>
            <Text style={styles.sheetSectionTitle}>{t(language, 'emptyWorkout.sheet.popularTitle')}</Text>
            <Text style={styles.sheetSectionSubtitle}>{t(language, 'emptyWorkout.sheet.popularSub')}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
            {popularItems.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggle(item.id)}
                  style={[styles.popularCard, selected && styles.popularCardSelected]}
                >
                  <View>
                    <View style={styles.popularTile}>
                      <Text style={styles.popularTileText}>{exerciseInitials(exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise')))}</Text>
                    </View>
                    <View style={styles.popularToggle}>
                      <SelectTogglePill selected={selected} />
                    </View>
                  </View>
                  <Text
                    numberOfLines={2}
                    style={styles.popularName}
                    accessibilityLabel={exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                  >
                    {exerciseListLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                  </Text>
                  <Text numberOfLines={1} style={styles.popularMeta}>
                    {buildMetaLabel(item, language)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      <View style={styles.sheetSectionHeaderAll}>
        <Text style={styles.sheetSectionTitle}>{t(language, 'emptyWorkout.sheet.allTitle')}</Text>
        <Text style={styles.sheetSectionSubtitle}>{t(language, 'emptyWorkout.sheet.available', { count: listItems.length })}</Text>
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetGripRow}>
            <View style={styles.sheetGrip} />
          </View>
          <View style={styles.sheetHead}>
            <View style={styles.sheetHeadRow}>
              <View style={styles.sheetHeadCopy}>
                <Text style={styles.sheetTitle}>{t(language, 'emptyWorkout.addExercise')}</Text>
                <Text style={styles.sheetSubtitle}>{t(language, 'emptyWorkout.sheet.subtitle')}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'emptyWorkout.sheet.close')} onPress={onClose} hitSlop={8}>
                <Text style={styles.sheetClose}>{t(language, 'emptyWorkout.sheet.close')}</Text>
              </Pressable>
            </View>
            <View style={styles.searchField}>
              <Svg viewBox="0 0 24 24" width={18} height={18}>
                <Circle cx={11} cy={11} r={7} stroke={theme.faint} strokeWidth={2} fill="none" />
                <Path d="M20 20l-3.5-3.5" stroke={theme.faint} strokeWidth={2} fill="none" strokeLinecap="round" />
              </Svg>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t(language, 'emptyWorkout.sheet.search')}
                placeholderTextColor={AW3.ghost}
                selectionColor={theme.purple}
                style={styles.searchInput}
              />
            </View>
          </View>

          <FlatList
            data={listItems}
            keyExtractor={(item) => item.id}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={8}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetListContent}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              popularItems.length === 0 ? (
                <Text style={styles.sheetEmptyText}>{t(language, 'emptyWorkout.sheet.noMatch', { query })}</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const selected = selectedIds.includes(item.id);
              return (
                <Pressable onPress={() => toggle(item.id)} style={[styles.sheetRow, selected && styles.sheetRowSelected]}>
                  <Tile initials={exerciseInitials(exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise')))} size={46} />
                  <View style={styles.sheetRowCopy}>
                    <Text
                      numberOfLines={2}
                      style={styles.sheetRowName}
                      accessibilityLabel={exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                    >
                      {exerciseListLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                    </Text>
                    <Text numberOfLines={1} style={styles.sheetRowMeta}>
                      {buildMetaLabel(item, language)}
                    </Text>
                  </View>
                  <SelectTogglePill selected={selected} />
                </Pressable>
              );
            }}
          />

          <View style={[styles.sheetFooter, { paddingBottom: bottomInset + 16 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'emptyWorkout.a11y.addSelected')}
              onPress={confirm}
              disabled={selectedIds.length === 0}
              style={[styles.sheetConfirm, selectedIds.length === 0 && styles.sheetConfirmDisabled]}
            >
              <Text style={[styles.sheetConfirmText, selectedIds.length === 0 && styles.sheetConfirmTextDisabled]}>
                {selectedIds.length === 0
                  ? t(language, 'emptyWorkout.sheet.selectPrompt')
                  : selectedIds.length === 1
                    ? t(language, 'emptyWorkout.sheet.addOne')
                    : t(language, 'emptyWorkout.sheet.addMany', { count: selectedIds.length })}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── screen ───────────────────────────────────────────────────────────────

export function EmptyWorkoutScreen({
  exerciseLibrary,
  recentExerciseLibraryItems,
  defaultRestSeconds,
  keepScreenAwake = false,
  exercisePrLookupBefore,
  language = 'en',
  onBack,
  onSave,
  freestyleDraft = null,
  onSaveDraft,
  onClearDraft,
  restAlerts = { alerts: true, warning: true, ongoing: true, asked: false },
  onRestAlertsAnswered,
  onOpenSystemSettings,
}: EmptyWorkoutScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const AW3 = useAW3();
  /*
   * The session outlives the process. Everything here lived in React state
   * alone — forty minutes in, Android reclaiming the app for a camera or a
   * call meant reopening to the empty board with nothing to recover, while
   * the guided player had persisted every set (audit round 4, 2026-09-20).
   * The draft is the workout provider's state, persisted with the bundle:
   * read once here, on mount, and written back below, debounced — a
   * keystroke in a weight field is not a reason to rewrite the bundle. A
   * rest that ended while the app was gone does not come back.
   */
  const [exercises, setExercises] = useState<FreestyleExerciseState[]>(() => freestyleDraft?.exercises ?? []);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(() =>
    resolveFreestyleDraftStart(freestyleDraft, Date.now()),
  );
  /**
   * Whether this session's `workout_started` has gone. The free workout sent
   * `workout_completed` and never its start, so every one of them read as a
   * workout finished that nobody began (analytics audit, 2026-09-21). It
   * starts where the clock does, at the first lift on the board; a board
   * brought back from a draft was started when that draft was, and is not
   * started again.
   */
  /**
   * Made when the board starts, kept with the draft: Finish saves under it. Made anew whenever the board
   * is emptied, so an id never outlives the workout it named.
   */
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current = resolveFreestyleSessionId(freestyleDraft);
  }
  const startCountedRef = useRef(freestyleDraft != null);
  /**
   * The last time the board was touched: free sets carry no times, so this is
   * what a Finish tapped hours later is pinned to (resolveFreestyleFinish).
   * Seeded from the draft, not from opening the screen, and moved by an edit
   * to the lifts or the rest, not by the write that saves them.
   */
  const lastEditMsRef = useRef<number | null>(null);
  if (lastEditMsRef.current === null) {
    lastEditMsRef.current = resolveFreestyleLastEdit(freestyleDraft, startedAtMs, Date.now());
  }
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rest, setRest] = useState<{ totalSeconds: number; endsAtMs: number; startedAtMs: number } | null>(() =>
    freestyleDraft?.rest && freestyleDraft.rest.endsAtMs > Date.now() ? freestyleDraft.rest : null,
  );
  const editedBoardRef = useRef<{ exercises: typeof exercises; rest: typeof rest } | null>(null);
  useEffect(() => {
    const seen = editedBoardRef.current;
    if (seen && (seen.exercises !== exercises || seen.rest !== rest)) {
      lastEditMsRef.current = Date.now();
    }
    editedBoardRef.current = { exercises, rest };
  }, [exercises, rest]);
  const draftSinkRef = useRef({ onSaveDraft, onClearDraft });
  draftSinkRef.current = { onSaveDraft, onClearDraft };
  /** The write that has not happened yet, so a discard can take it with it. */
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What that write would save, so leaving can write it now instead. */
  const pendingDraftRef = useRef<{ exercises: typeof exercises; startedAtMs: typeof startedAtMs; rest: typeof rest; sessionId: string } | null>(null);
  /*
   * Leaving without a discard writes the pending edit rather than dropping it.
   *
   * A notification or a widget tile routes straight off this screen, and an
   * edit made less than 400 ms before it was cancelled with the timer: back
   * on the board, the last weight typed was gone (break round, 2026-09-28).
   * Declared before the debounce below so its cleanup runs first, while the
   * timer is still pending. Not while Finish is saving: the sets are on their
   * way to disk, and a draft written now would bring the board back after it.
   */
  useEffect(
    () => () => {
      const pending = pendingDraftRef.current;
      if (draftTimerRef.current === null || pending === null || finishingRef.current) {
        return;
      }
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
      draftSinkRef.current.onSaveDraft?.({ ...pending, savedAtMs: Date.now() });
    },
    [],
  );
  useEffect(() => {
    const sink = draftSinkRef.current;
    if (exercises.length === 0) {
      sessionIdRef.current = resolveFreestyleSessionId(null);
      sink.onClearDraft?.();
      return undefined;
    }
    const sessionId = sessionIdRef.current as string;
    pendingDraftRef.current = { exercises, startedAtMs, rest, sessionId };
    const timer = setTimeout(() => {
      draftTimerRef.current = null;
      sink.onSaveDraft?.({ exercises, startedAtMs, rest, sessionId, savedAtMs: Date.now() });
    }, 400);
    draftTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (draftTimerRef.current === timer) {
        draftTimerRef.current = null;
      }
    };
  }, [exercises, startedAtMs, rest]);
  /**
   * Throw the board away, pending write and all.
   *
   * Every discard used to call onClearDraft and leave, trusting the effect's
   * cleanup to cancel the debounce on unmount. It does not get there in time:
   * the clear is an urgent dispatch and the route change behind it is a
   * transition, so the screen is still mounted in the gap between them — and
   * an edit made less than 400 ms before leaving fired its timer in that gap
   * and wrote the discarded board straight back (CI review of #162). The
   * timer goes first, then the clear.
   */
  /**
   * The save filed the board's sets under another id (see onSave): the board keeps it, and hands it to
   * the provider at once, with the pending write taken first so the old id is not written over it.
   */
  const adoptSessionId = (id: string) => {
    sessionIdRef.current = id;
    if (draftTimerRef.current !== null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const pending = pendingDraftRef.current;
    if (pending) {
      pendingDraftRef.current = { ...pending, sessionId: id };
      draftSinkRef.current.onSaveDraft?.({ ...pending, sessionId: id, savedAtMs: Date.now() });
    }
  };
  const discardDraft = () => {
    if (draftTimerRef.current !== null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    draftSinkRef.current.onClearDraft?.();
  };
  /**
   * How much room the floating bar needs at the bottom of the list, measured
   * rather than assumed. This was a flat 118, which holds at the default font
   * size and stops holding at the accessibility sizes — the bar's three lines
   * scale, the constant did not, and it went back to covering "Lopeta treeni".
   */
  const [restBarHeight, setRestBarHeight] = useState(0);

  // Which rows run into the next one, index for index with the list below.
  const supersetRows = useMemo(() => supersetPositions(exercises), [exercises]);
  /** The list as runs, so a pair is drawn inside one box. */
  const supersetRuns = useMemo(
    () => buildSupersetRuns(normalizeSupersetGroups(exercises)),
    [exercises],
  );
  const [sheetVisible, setSheetVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const finishingRef = useRef(false);

  const hasExercises = exercises.length > 0;
  // Finish needs one ticked set (user decision, 2026-09-26): a board with rows
  // typed in and nothing ticked is not a workout, and saving it produced a
  // template with a session nobody performed.
  const hasLoggedSet = canFinishFreestyleSession(exercises);
  const canFinish = hasExercises && !isSaving && hasLoggedSet;

  /**
   * Leaving with logged sets asks first.
   *
   * The sets live only in this screen until Finish saves them, and both the
   * header chevron and hardware back went straight out: fifteen logged sets
   * gone on one tap, with nothing asked and nothing to undo. Same question,
   * same dialog as ending a guided session with sets in it.
   *
   * Numbers typed into sets not ticked yet count too — they are lost the same
   * way (2026-09-16).
   */
  const unsavedWork = freestyleUnsavedWork(exercises);
  const doneSetCount = unsavedWork.doneSets;
  const hasUnsavedWork = unsavedWork.doneSets > 0 || unsavedWork.enteredSets > 0;
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  /**
   * The exercise a ✕ press is about to remove, once it has something to lose.
   *
   * The ✕ removed the lift on one tap with no undo — fifteen logged sets
   * gone the same way leaving the whole screen used to go (user decision,
   * 2026-09-26). An exercise nobody has touched yet — no set ticked, nothing
   * typed — is not asked about, the same distinction the leave guard draws.
   */
  const [pendingRemoval, setPendingRemoval] = useState<{ key: string; name: string } | null>(null);
  const leaveGuardRef = useRef({ isSaving, onBack, hasUnsavedWork, discardDraft });
  leaveGuardRef.current = { isSaving, onBack, hasUnsavedWork, discardDraft };
  const requestLeave = () => {
    // While Finish is saving the sets are on their way to disk and the summary
    // follows; leaving now would race it. Hardware back does the same.
    if (isSaving) {
      return;
    }
    if (hasUnsavedWork) {
      setConfirmingLeave(true);
      return;
    }
    // Leaving on purpose is a discard; the draft would otherwise come back
    // on the next visit, lifts and all.
    discardDraft();
    onBack();
  };

  /*
   * Hardware back leaves the way the chevron leaves.
   *
   * This was registered only once there was something to lose, so a board
   * with lifts added and nothing typed yet had no listener at all: back fell
   * through to the app's route handling, which knows nothing about the draft,
   * and the untouched board came back on the next visit — while the chevron
   * in that exact state discarded it (CI review of #162). One listener for
   * both gestures, and `requestLeave` is the one rule they share.
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const guard = leaveGuardRef.current;
      // While Finish is saving, back does nothing: the sets are on their way
      // to disk, and the summary follows.
      if (guard.isSaving) {
        return true;
      }
      if (guard.hasUnsavedWork) {
        setConfirmingLeave(true);
        return true;
      }
      // Leaving on purpose is a discard, from either gesture.
      guard.discardDraft();
      guard.onBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  useKeepScreenAwake(keepScreenAwake, 'empty-workout');

  useEffect(() => {
    if (!hasExercises) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasExercises]);

  const elapsedSeconds = startedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  // Rule 01: derived from the clock, never accumulated. A rest that ended while
  // the phone was in a pocket comes back as DONE with its overrun — not as a
  // frozen countdown, and not silently gone.
  const restStatus = rest ? describeRest(rest.endsAtMs, nowMs) : null;
  // The add-exercise sheet is a Modal and cannot read this itself.
  const sheetInsets = useSafeAreaInsets();
  /** The rest deadline the "back to work" cue has already fired for. */
  const restDoneCuedRef = useRef<number | null>(null);
  /** Keeps the field being typed into above the keyboard — see the hook. */
  const keyboard = useKeyboardReveal();

  useEffect(() => {
    // The countdown ran out — cue "back to work" once, but KEEP the bar: it
    // flips to the done state and counts how long ago, until the set is
    // logged or the bar is dismissed (design: "coming back").
    //
    // Cued per DEADLINE, not per bar. A boolean reset only when the bar closed
    // meant the cue fired for the first rest of a run and never again: ticking
    // the next set replaces the rest without `rest` ever being null in
    // between, which — now that every tick starts one — is the ordinary loop.
    // Keying on endsAtMs also re-arms the cue when +15s revives a done rest.
    if (restStatus?.phase === 'done' && rest && restDoneCuedRef.current !== rest.endsAtMs) {
      restDoneCuedRef.current = rest.endsAtMs;
      void haptics.impactMedium();
      sound.rest();
    }
    if (!rest) {
      restDoneCuedRef.current = null;
    }
  }, [rest, restStatus?.phase]);

  const volumeKg = freestyleVolumeKg(exercises);
  const totalSetCount = exercises.reduce((sum, entry) => sum + entry.sets.length, 0);

  // The done bar names the set you came back to log, not a slogan.
  const nextSetLabel = useMemo(() => {
    const target = freestyleNextSetTarget(exercises);
    if (!target) {
      return null;
    }
    return target.kg && target.reps
      ? t(language, 'rest.bar.doneSet', { n: target.setNumber, kg: target.kg, reps: target.reps })
      : t(language, 'rest.bar.doneSetPlain', { n: target.setNumber });
  }, [exercises, language]);

  // What the lock-screen card says between rests: the session and where it is.
  const sessionCard = useMemo(() => {
    if (!hasExercises || startedAtMs === null) {
      return null;
    }
    const started = new Date(startedAtMs);
    const time = `${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`;
    const current = exercises.find((entry) => entry.sets.some((item) => !item.done)) ?? exercises[exercises.length - 1];
    return {
      title: t(language, 'rest.notify.sessionTitle', {
        session: t(language, 'emptyWorkout.title'),
        exercise: current?.name ?? '',
      }),
      body: t(language, totalSetCount === 1 ? 'rest.notify.sessionBodyOne' : 'rest.notify.sessionBody', {
        done: doneSetCount,
        total: totalSetCount,
        time,
      }),
    };
  }, [doneSetCount, exercises, hasExercises, language, startedAtMs, totalSetCount]);

  // The in-app cue cannot play while Android has our JS suspended, so the
  // deadline also goes to the OS as the alert ladder, and the ongoing card
  // says what is happening. Clearing the bar — skip, log, leaving — retires it.
  const syncRestAlert = useRestEndAlert(language, {
    warning: restAlerts.warning,
    ongoing: restAlerts.ongoing,
    session: sessionCard,
  });
  // Only a RUNNING rest is mirrored; once done, the alert has fired and the
  // card should say the session again.
  const restEndsAtMs = rest && restStatus?.phase === 'running' && restAlerts.alerts ? rest.endsAtMs : null;
  useEffect(() => {
    void syncRestAlert(restEndsAtMs);
  }, [restEndsAtMs, syncRestAlert]);

  // The permission moment (rule 05): at the first rest, in context, once.
  // Shared with the guided player — see the hook.
  const restAsk = useRestAlertPermissionMoment({
    restRunning: Boolean(rest) && restStatus?.phase === 'running',
    // The start, not the deadline: ±15 s does not make a new rest.
    restKey: rest?.startedAtMs ?? null,
    asked: restAlerts.asked,
    alertsWanted: restAlerts.alerts,
    onAnswered: onRestAlertsAnswered,
    onGranted: () => {
      // The rest that prompted this is still running: hand it to the OS now.
      if (rest && describeRest(rest.endsAtMs, Date.now()).phase === 'running') {
        void syncRestAlert(rest.endsAtMs);
      }
    },
  });

  // Lock-screen actions land in App and come here over the bus.
  useEffect(
    () =>
      subscribeRestActions((action) => {
        if (action.kind === 'extend') {
          adjustRest(action.seconds);
        } else if (action.kind === 'skip') {
          setRest(null);
        }
        // 'logSet' and 'finish' just open the app to this screen; the next
        // tap is the reader's.
      }),
    // adjustRest is recreated each render but closes over nothing stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const quickItems = useMemo(() => {
    const source = recentExerciseLibraryItems.length > 0 ? recentExerciseLibraryItems : getPopularExerciseLibraryItems(exerciseLibrary, 8);
    return source.slice(0, 4);
  }, [exerciseLibrary, recentExerciseLibraryItems]);
  const quickListTitle = t(language, recentExerciseLibraryItems.length > 0 ? 'emptyWorkout.recent' : 'emptyWorkout.popular');

  const addExercises = (items: ExerciseLibraryItem[]) => {
    // Closing comes first. A confirmed selection can resolve to nothing — an
    // id whose item is gone is dropped rather than added as a hole — and
    // returning early before this left the sheet standing open on a button
    // the reader had just pressed.
    setSheetVisible(false);
    // The board is locked while Finish is saving: what is typed or ticked after the press is not in
    // the save, and the board is cleared the moment it lands.
    if (finishingRef.current) {
      return;
    }
    if (!items.length) {
      return;
    }
    setExercises((current) => [...current, ...items.map((item) => buildExerciseState(item, defaultRestSeconds, language))]);
    setStartedAtMs((current) => current ?? Date.now());
    setNowMs(Date.now());
    if (!startCountedRef.current) {
      startCountedRef.current = true;
      trackEvent('workout_started');
    }
  };

  const removeExercise = (exerciseKey: string) => {
    if (finishingRef.current) {
      return;
    }
    setExercises((current) => current.filter((exercise) => exercise.localKey !== exerciseKey));
    // The rest belonged to a lift; over an empty board it froze — the tick is
    // gated on having lifts — and covered the quick list, with Skip the only
    // way out (audit round 4, 2026-09-20).
    if (exercises.length <= 1) {
      setRest(null);
    }
  };

  /**
   * The ✕: asks first once there is a set to lose, same as leaving the screen
   * does (freestyleUnsavedWork). A lift just added and never touched — no
   * number typed, nothing ticked — has nothing the reader would miss, so it
   * goes without a dialog in the way of a pick that was a mistake.
   */
  const requestRemoveExercise = (exerciseKey: string, name: string) => {
    const exercise = exercises.find((entry) => entry.localKey === exerciseKey);
    if (!exercise) {
      return;
    }
    const work = freestyleUnsavedWork([exercise]);
    if (work.doneSets === 0 && work.enteredSets === 0) {
      removeExercise(exerciseKey);
      return;
    }
    setPendingRemoval({ key: exerciseKey, name });
  };

  const patchSet = (exerciseKey: string, setKey: string, patch: Partial<{ kg: string; reps: string }>) => {
    if (finishingRef.current) {
      return;
    }
    setExercises((current) =>
      current.map((exercise) =>
        exercise.localKey === exerciseKey
          ? {
              ...exercise,
              sets: exercise.sets.map((set) => {
                if (set.localKey !== setKey) {
                  return set;
                }
                const next = { ...set, ...patch };
                // The fields stay editable after the tick, so the ceiling has
                // to hold here as well as on the tick itself: typing 825 into
                // a set already logged at 82,5 kept it logged, and the volume
                // strip, the one-rep-max card and the saved workout all took
                // the 825 (PR #121 review). A logged set that stops being
                // loggable stops being logged — the tick comes back off, and
                // toggleSetDone refuses to put it back until the number is
                // one somebody could have lifted.
                // Blank reps mid-edit keep the tick: clearing "8" to type
                // "10" is not a set undone. The finish does not count a
                // ticked set with no reps (isDoneFreestyleSet, 2026-09-26).
                const checked = next.reps.trim() ? next : { ...next, reps: '1' };
                return next.done && !isLoggableFreestyleSet(checked) ? { ...next, done: false } : next;
              }),
            }
          : exercise,
      ),
    );
  };

  /**
   * One more set — of every lift in the block, when the lift is in one.
   *
   * A superset's set count is one number: the block is counted in rounds, so
   * a button that added a set to one half of it would put the pair straight
   * back into the state linking exists to prevent (user 2026-09-11, "yksi
   * sarjan lisäys tarkoittaa että molemmat nousee yhden").
   */
  const addSet = (exerciseKey: string) => {
    if (finishingRef.current) {
      return;
    }
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.localKey === exerciseKey);
      if (index === -1) {
        return current;
      }
      const block = new Set(supersetGroupIndexes(current, index));
      return current.map((exercise, position) =>
        block.has(position)
          ? { ...exercise, sets: [...exercise.sets, createSet(carryForwardFreestyleSet(exercise.sets))] }
          : exercise,
      );
    });
  };

  const toggleSetDone = (exerciseKey: string, setKey: string) => {
    if (finishingRef.current) {
      return;
    }
    const exercise = exercises.find((entry) => entry.localKey === exerciseKey);
    const set = exercise?.sets.find((entry) => entry.localKey === setKey);
    if (!exercise || !set) {
      return;
    }

    // A set nobody could have lifted is not ticked (isLoggableFreestyleSet):
    // the buzz and the untouched box say the numbers need a look.
    if (!set.done && !isLoggableFreestyleSet(set)) {
      void haptics.error();
      return;
    }

    if (!set.done) {
      void haptics.success();
      sound.done();
    }

    // Every tick starts a rest. The rule used to be "only if another set is
    // already waiting", which in a logger where you add the next set AFTER
    // ticking this one meant almost never — see freestyleRestSecondsForTick,
    // which also owns the un-tick case and refuses a duration it cannot count.
    const duration = freestyleRestSecondsForTick(exercise, set, defaultRestSeconds, exercises);
    if (duration !== null) {
      const now = Date.now();
      setNowMs(now);
      // startedAtMs is the rest's identity: ±15s moves its end, not the fact
      // that it is the same rest. Things that must happen once per rest key
      // on this; things that must re-arm when the end moves key on endsAtMs.
      setRest({ totalSeconds: duration, endsAtMs: now + duration * 1000, startedAtMs: now });
    }

    setExercises((current) =>
      current.map((entry) =>
        entry.localKey === exerciseKey
          ? {
              ...entry,
              sets: entry.sets.map((item) => (item.localKey === setKey ? { ...item, done: !item.done } : item)),
            }
          : entry,
      ),
    );
  };

  /**
   * Run this lift straight into the one below it, or stop doing so.
   *
   * The same gap-shaped toggle the programme day offers, over the same pure
   * rule — a free workout that had its own idea of what a superset is would be
   * the second idea this feature exists to avoid.
   */
  const toggleSupersetLink = (exerciseKey: string) => {
    if (finishingRef.current) {
      return;
    }
    setExercises((current) => {
      const index = current.findIndex((entry) => entry.localKey === exerciseKey);
      if (index === -1 || index >= current.length - 1) {
        return current;
      }
      return setSupersetLink(current, index, !isSupersetLinked(current, index));
    });
  };

  // Both numbers of the rest move together, and the rule is in the lib with
  // the rest of the schedule maths: see extendRest.
  const adjustRest = (deltaSeconds: number) =>
    setRest((current) => (current ? extendRest(current, deltaSeconds, Date.now()) : current));

  const handleFinish = async () => {
    // The ref as well as the state: `canFinish` is read from the render the
    // press came from, and a second press can arrive before the one that
    // disables the button. Each duplicate here is a template AND a session —
    // the same guard the cardio and guided finishes carry (#138, #120).
    if (!canFinish || finishingRef.current) {
      return;
    }

    finishingRef.current = true;
    setIsSaving(true);
    try {
      // Tapped long after the last edit, the workout ended at that edit.
      const finish = resolveFreestyleFinish({
        startedAtMs,
        lastEditMs: lastEditMsRef.current ?? Date.now(),
        nowMs: Date.now(),
      });
      const { draft, summary } = buildFreestyleFinish({
        exercises,
        workoutName: t(language, 'emptyWorkout.title'),
        startedAtIso: new Date(startedAtMs ?? Date.now()).toISOString(),
        performedAtIso: new Date(finish.performedAtMs).toISOString(),
        elapsedSeconds: finish.elapsedSeconds,
        exercisePrLookup: exercisePrLookupBefore(sessionIdRef.current),
        sessionId: sessionIdRef.current ?? undefined,
      });
      await onSave(draft, summary, adoptSessionId);
      // On disk: nothing left to resume, and no pending write to put it back.
      discardDraft();
    } catch {
      // Save failed — the logged sets stay on screen so nothing is lost;
      // App.tsx surfaces the error toast. Never show success early.
      finishingRef.current = false;
      setIsSaving(false);
    }
  };

  /**
   * One lift's block, drawn the same whether it stands alone or sits inside
   * a superset — the box around a pair is the only thing that says they go
   * together, so the block itself does not change.
   */
  const renderExerciseBlock = (exercise: FreestyleExerciseState, exerciseIndex: number) => {
            const activeIndex = exercise.sets.findIndex((set) => !set.done);
            const superset = supersetRows[exerciseIndex] ?? null;
            const linkedToNext = superset?.hasNextInGroup === true;
            const inBlock = superset?.groupId != null;
            // The block's controls belong to the block, so they are drawn once
            // — on the row that opens it, beside the chain that made it.
            const opensBlock =
              inBlock && supersetRows[exerciseIndex - 1]?.groupId !== superset?.groupId;
            return (
              <View key={exercise.localKey} style={[styles.exerciseBlock, exerciseIndex > 0 && styles.exerciseBlockDivided]}>
                <View style={styles.exerciseHead}>
                  <Tile initials={exercise.initials} size={40} radius={11} />
                  <View style={styles.exerciseHeadCopy}>
                    <Text
                      numberOfLines={2}
                      style={styles.exerciseName}
                      accessibilityLabel={exerciseNameLabel(language, exercise.displayName)}
                    >
                      {exerciseListLabel(language, exercise.displayName)}
                    </Text>
                    <Text numberOfLines={1} style={styles.exerciseMeta}>
                      {/* The superset note goes first, so it is the half that
                          survives when a long line is cut — the body part and
                          the equipment are true of this lift every day, and
                          running into the next one is true only now. */}
                      {linkedToNext
                        ? `${t(language, 'detail.day.supersetNext')} · ${exercise.metaLabel}`
                        : exercise.metaLabel}
                    </Text>
                  </View>
                  {/* One round for the whole block, where the block begins.
                      The per-lift buttons inside a superset are gone: a set
                      count that is one number should not be offered twice
                      (user 2026-09-11). Green, because this one adds. */}
                  {opensBlock ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(language, 'emptyWorkout.a11y.addSetToBlock')}
                      hitSlop={8}
                      onPress={() => addSet(exercise.localKey)}
                      style={styles.blockAddSet}
                    >
                      <PlusIcon size={17} color={theme.onHighlight} strokeWidth={3} />
                    </Pressable>
                  ) : null}
                  {/* The last lift in the list has nothing below it to run
                      into, so it gets no chain rather than a dead one. */}
                  {exerciseIndex < exercises.length - 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: linkedToNext }}
                      accessibilityLabel={t(
                        language,
                        linkedToNext ? 'detail.day.a11y.supersetUnlink' : 'detail.day.a11y.supersetLink',
                        { name: exercise.displayName },
                      )}
                      hitSlop={8}
                      onPress={() => toggleSupersetLink(exercise.localKey)}
                      style={styles.exerciseRemove}
                    >
                      <Svg viewBox="0 0 24 24" width={18} height={18} fill="none">
                        <Path
                          d="M9.5 14.5l5-5"
                          stroke={linkedToNext ? theme.highlight : theme.faint}
                          strokeWidth={2.1}
                          strokeLinecap="round"
                        />
                        <Path
                          d="M13.5 6.5l1.5-1.5a3.5 3.5 0 014.95 4.95L18.5 11.5M10.5 17.5L9 19a3.5 3.5 0 01-4.95-4.95L5.5 12.5"
                          stroke={linkedToNext ? theme.highlight : theme.faint}
                          strokeWidth={2.1}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {linkedToNext ? null : (
                          <Path d="M4 20L20 4" stroke={theme.faint} strokeWidth={1.8} strokeLinecap="round" />
                        )}
                      </Svg>
                    </Pressable>
                  ) : null}
                  {/* 30 drawn, 44 to the thumb: the slop reaches it inside
                      a head row made 44 tall for it, and stops short of the
                      chain beside it on the left so a tap between the two
                      never lands on the one that deletes (accessibility
                      audit, 2026-09-21). Removal asks first once there is a
                      set logged to lose — see requestRemoveExercise
                      (2026-09-26). */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'emptyWorkout.a11y.remove', { name: exercise.displayName })}
                    hitSlop={{ top: 7, bottom: 7, left: 3, right: 7 }}
                    onPress={() => requestRemoveExercise(exercise.localKey, exercise.displayName)}
                    style={styles.exerciseRemove}
                  >
                    <Svg viewBox="0 0 24 24" width={18} height={18}>
                      <Path d="M6 6l12 12M18 6L6 18" stroke={theme.faint} strokeWidth={2.2} fill="none" strokeLinecap="round" />
                    </Svg>
                  </Pressable>
                </View>

                <View style={styles.setGridHeader}>
                  <Text style={[styles.setGridHeaderText, styles.setColIndex]}>#</Text>
                  <Text style={[styles.setGridHeaderText, styles.setColField, styles.setGridHeaderCenter]}>KG</Text>
                  <Text style={[styles.setGridHeaderText, styles.setColField, styles.setGridHeaderCenter]}>
                    {t(language, 'emptyWorkout.col.reps')}
                  </Text>
                  <View style={styles.setColCheck} />
                </View>

                <View style={styles.setList}>
                  {exercise.sets.map((set, setIndex) => (
                    <View key={set.localKey}>
                      <View style={[styles.setRow, set.done && styles.setRowDone]}>
                        <Text style={[styles.setIndex, styles.setColIndex, setIndex === activeIndex && styles.setIndexActive]}>
                          {setIndex + 1}
                        </Text>
                        {/* Named for a screen reader: lift, set, field, unit.
                            The column headers are Text above the list, so a
                            field on its own announced only its number
                            (accessibility audit, 2026-09-21). */}
                        <TextInput
                          {...keyboard.field(`${set.localKey}:kg`)}
                          value={set.kg}
                          onChangeText={(value) => patchSet(exercise.localKey, set.localKey, { kg: value })}
                          accessibilityLabel={setFieldAccessibilityLabel(
                            language,
                            'kg',
                            setIndex + 1,
                            exerciseNameLabel(language, exercise.displayName),
                          )}
                          placeholder="0"
                          placeholderTextColor={AW3.ghost}
                          selectionColor={theme.purple}
                          keyboardType="decimal-pad"
                          style={[styles.setInput, styles.setColField]}
                        />
                        <TextInput
                          {...keyboard.field(`${set.localKey}:reps`)}
                          value={set.reps}
                          onChangeText={(value) => patchSet(exercise.localKey, set.localKey, { reps: value })}
                          accessibilityLabel={setFieldAccessibilityLabel(
                            language,
                            'reps',
                            setIndex + 1,
                            exerciseNameLabel(language, exercise.displayName),
                          )}
                          placeholder="0"
                          placeholderTextColor={AW3.ghost}
                          selectionColor={theme.purple}
                          keyboardType="number-pad"
                          style={[styles.setInput, styles.setColField]}
                        />
                        <View style={[styles.setColCheck, styles.setCheckCell]}>
                          <SetCheckButton
                            done={set.done}
                            label={t(language, set.done ? 'emptyWorkout.a11y.setNotDone' : 'emptyWorkout.a11y.setDone')}
                            onPress={() => toggleSetDone(exercise.localKey, set.localKey)}
                          />
                        </View>
                      </View>
                      {/* The strip only exists once there is a weight to break
                          into plates — an empty panel taught nobody anything. */}
                      {exercise.isBarbell && setIndex === activeIndex && parseNumberInput(set.kg) ? (
                        <FadeInView style={styles.plateStrip}>
                          <PlatePop kg={set.kg} language={language} />
                        </FadeInView>
                      ) : null}
                    </View>
                  ))}
                </View>

                {inBlock ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'emptyWorkout.a11y.addSetTo', { name: exercise.displayName })}
                    onPress={() => addSet(exercise.localKey)}
                    style={styles.addSetButton}
                  >
                    <PlusIcon size={15} color={theme.purpleDark} strokeWidth={2.6} />
                    <Text style={styles.addSetText}>{t(language, 'emptyWorkout.addSet')}</Text>
                  </Pressable>
                )}
              </View>
            );
  };

  return (
    <View style={styles.screen}>
      {/* header */}
      {/* The title and clock centre on the SCREEN, not on what the two
          buttons leave over. A 24px chevron on the left and "Lopeta" on the
          right left the middle slot ~35px off-centre, and a clock that is
          almost centred reads as a clock that slipped ("kello vähän sivussa
          ylhäällä", #bugs 2026-08-28). Both sides get the same flexible
          width; the buttons keep their own size inside them, so the tap
          targets do not grow into the empty space.

          The header's padding lives on the three slots, not on the row.
          Android clips a Pressable's hitSlop to its parent's bounds, and
          with the padding on the row the side slots were exactly their
          button's size — the chevron's 44dp target shrank to 24dp (PR
          review). Padded slots stretched to the row's height give the slop
          the same room the row used to. */}
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'emptyWorkout.a11y.back')} onPress={requestLeave} hitSlop={10} style={styles.headerBack}>
            <Svg viewBox="0 0 24 24" width={24} height={24}>
              <Path d="M15 6l-6 6 6 6" stroke={theme.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t(language, 'emptyWorkout.title')}</Text>
          <Text style={styles.headerClock}>{formatSessionClock(elapsedSeconds)}</Text>
        </View>
        <View style={[styles.headerSide, styles.headerSideEnd]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'emptyWorkout.finishWorkout')}
            accessibilityHint={!hasLoggedSet ? t(language, 'emptyWorkout.finishNeedsSet') : undefined}
            onPress={handleFinish}
            disabled={!canFinish}
            hitSlop={10}
            style={styles.headerFinish}
          >
            <Text style={[styles.headerFinishText, !canFinish && styles.headerFinishTextDisabled]}>
              {t(language, 'emptyWorkout.finish')}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* stat strip */}
      <View style={styles.statStrip}>
        <Text style={[styles.statText, !hasExercises && styles.statTextFaint]}>
          {t(language, doneSetCount === 1 ? 'emptyWorkout.stat.setsOne' : 'emptyWorkout.stat.setsMany', { count: doneSetCount })}
        </Text>
        <View style={styles.statDot} />
        <Text style={[styles.statText, !hasExercises && styles.statTextFaint]}>
          {t(language, 'emptyWorkout.stat.volume', { volume: formatVolumeLabel(volumeKg) })}
        </Text>
        <Text style={styles.statTag}>{t(language, 'emptyWorkout.stat.tag')}</Text>
      </View>

      {!hasExercises ? (
        /* ── empty state ── */
        <ScrollView style={styles.body} contentContainerStyle={styles.emptyContent} showsVerticalScrollIndicator={false}>
          <View style={styles.emptyHero}>
            <View style={styles.emptyIconTile}>
              <Svg viewBox="0 0 24 24" width={42} height={42}>
                <Path
                  d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"
                  stroke={theme.purple}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
            <Text style={styles.emptyTitle}>{t(language, 'emptyWorkout.empty.title')}</Text>
            <Text style={styles.emptySubtitle}>{t(language, 'emptyWorkout.empty.sub')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'emptyWorkout.addExercise')}
              onPress={() => setSheetVisible(true)}
              style={styles.emptyCta}
            >
              <PlusIcon size={20} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>{t(language, 'emptyWorkout.addExercise')}</Text>
            </Pressable>
          </View>

          {quickItems.length > 0 ? (
            <View style={styles.quickSection}>
              <View style={styles.quickHeader}>
                <Text style={styles.quickTitle}>{quickListTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'emptyWorkout.seeAll')} onPress={() => setSheetVisible(true)} hitSlop={8}>
                  <Text style={styles.quickSeeAll}>{t(language, 'emptyWorkout.seeAll')}</Text>
                </Pressable>
              </View>
              <View style={styles.quickList}>
                {quickItems.map((item) => (
                  <Pressable key={item.id} onPress={() => addExercises([item])} style={styles.quickRow}>
                    <Tile initials={exerciseInitials(exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise')))} size={44} />
                    <View style={styles.quickRowCopy}>
                      <Text
                        numberOfLines={2}
                        style={styles.quickRowName}
                        accessibilityLabel={exerciseNameLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                      >
                        {exerciseListLabel(language, formatLiftDisplayLabel(item.name, 'Exercise'))}
                      </Text>
                      <Text numberOfLines={1} style={styles.quickRowMeta}>
                        {exercisePickerLabel(item.bodyPart, language)}
                      </Text>
                    </View>
                    <View style={styles.quickRowPlus}>
                      <PlusIcon size={16} color={theme.purpleDark} />
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        /* ── freestyle logging ── */
        <ScrollView
          ref={keyboard.scrollRef}
          onScroll={keyboard.onScroll}
          scrollEventThrottle={16}
          style={styles.body}
          // The keyboard is drawn OVER this list, not beside it, so the last
          // rows have nowhere to scroll to without room made for them.
          contentContainerStyle={[
            styles.loggingContent,
            // REST_BAR_BOTTOM is where the bar floats; restBarHeight is what
            // it measured itself as at this font scale. 24 is the ordinary
            // gap, kept as the floor for the frame before the bar has laid out.
            {
              paddingBottom:
                (rest ? Math.max(24, REST_BAR_BOTTOM + restBarHeight + 12) : 24) + keyboard.keyboardInset,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Denied: say plainly what breaks, at the moment it matters — the
              start of a rest — with a route to fix it. Once per session. */}
          {restAsk.deniedBannerShown ? (
            <View style={styles.deniedBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deniedTitle}>{t(language, 'rest.denied.title')}</Text>
                <Text style={styles.deniedBody}>{t(language, 'rest.denied.body')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  restAsk.dismissDeniedBanner();
                  onOpenSystemSettings?.();
                }}
                hitSlop={8}
              >
                <Text style={styles.deniedAction}>{t(language, 'rest.denied.action')}</Text>
              </Pressable>
            </View>
          ) : null}
          {supersetRuns.map((run) => {
            const rows = run.indexes.map((index) => renderExerciseBlock(exercises[index], index));
            if (run.groupId === null || run.indexes.length < 2) {
              return rows;
            }
            // Two lifts done back to back are one box with one label on it,
            // the same boundary the session and the programme draw.
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

          <View style={styles.loggingFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'emptyWorkout.addExercise')}
              onPress={() => setSheetVisible(true)}
              style={styles.addExerciseDashed}
            >
              <PlusIcon size={17} color={theme.purpleDark} strokeWidth={2.6} />
              <Text style={styles.addExerciseDashedText}>{t(language, 'emptyWorkout.addExercise')}</Text>
            </Pressable>
            {/* Why Finish is greyed out, not just that it is: a board with
                rows typed in and nothing ticked looked saveable, and saving it
                produced a session nobody performed (user decision, 2026-09-26). */}
            {!hasLoggedSet && !isSaving ? (
              <Text style={styles.finishHint}>{t(language, 'emptyWorkout.finishNeedsSet')}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'emptyWorkout.finishWorkout')}
              accessibilityHint={!hasLoggedSet ? t(language, 'emptyWorkout.finishNeedsSet') : undefined}
              onPress={handleFinish}
              disabled={!canFinish}
              style={[
                styles.finishButton,
                isSaving && styles.finishButtonSaving,
                !hasLoggedSet && !isSaving && styles.finishButtonDisabled,
              ]}
            >
              <CheckIcon size={19} color={!hasLoggedSet && !isSaving ? theme.faint : '#FFFFFF'} />
              <Text style={[styles.finishButtonText, !hasLoggedSet && !isSaving && styles.finishButtonTextDisabled]}>
                {isSaving ? t(language, 'emptyWorkout.saving') : t(language, 'emptyWorkout.finishWorkout')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* `rest` alone is the guard — the status derives from it, so a second
          null-check on the countdown could never fail. The sheet is a Modal
          and the bar must not float over it. */}
      {rest && !sheetVisible ? (
        <RestBar
          totalSeconds={rest.totalSeconds}
          remainingSeconds={restStatus?.remainingSeconds ?? 0}
          endsAtMs={rest.endsAtMs}
          overrunSeconds={restStatus?.phase === 'done' ? restStatus.overrunSeconds : null}
          onAdjust={adjustRest}
          onSkip={() => setRest(null)}
          onLogSet={() => setRest(null)}
          doneLabel={nextSetLabel}
          language={language}
          onMeasure={setRestBarHeight}
        />
      ) : null}


      <RestAlertsSheet
        visible={restAsk.sheetOpen}
        language={language}
        bottomInset={sheetInsets.bottom}
        onAllow={() => void restAsk.allow()}
        onLater={restAsk.later}
      />

      <AddExerciseSheetHG
        bottomInset={sheetInsets.bottom}
        visible={sheetVisible}
        items={exerciseLibrary}
        language={language}
        onClose={() => setSheetVisible(false)}
        onAdd={addExercises}
      />

      <ConfirmDialog
        language={language}
        visible={confirmingLeave}
        destructive
        title={t(language, 'guided.endConfirm.title')}
        message={
          unsavedWork.doneSets === 0
            ? t(language, 'emptyWorkout.leaveConfirm.bodyEntered')
            : t(
                language,
                unsavedWork.doneSets === 1 ? 'guided.endConfirm.bodyOne' : 'guided.endConfirm.bodyMany',
                { count: unsavedWork.doneSets },
              )
        }
        confirmLabel={t(language, 'guided.exit.end')}
        cancelLabel={t(language, 'guided.exit.keep')}
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={() => {
          setConfirmingLeave(false);
          discardDraft();
          leaveGuardRef.current.onBack();
        }}
      />

      <ConfirmDialog
        language={language}
        visible={pendingRemoval != null}
        destructive
        title={t(language, 'emptyWorkout.removeConfirm.title')}
        message={t(language, 'emptyWorkout.removeConfirm.body', { name: pendingRemoval?.name ?? '' })}
        confirmLabel={t(language, 'emptyWorkout.removeConfirm.confirm')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) {
            removeExercise(pendingRemoval.key);
          }
          setPendingRemoval(null);
        }}
      />
    </View>
  );
}

// ── styles ───────────────────────────────────────────────────────────────

const makeStyles = (theme: Theme) => {
  const AW3 = aw3ForTheme(theme);
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Equal flexible sides that stretch to the row's height and carry the
  // row's padding, so a button's hitSlop has room inside its slot. The
  // centre wraps a long title rather than pushing the sides below the
  // width a button needs. See the header comment.
  headerSide: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 64,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingBottom: 10,
    paddingLeft: 16,
  },
  headerSideEnd: {
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 16,
  },
  headerBack: {
    flexShrink: 0,
  },
  headerCenter: {
    flexShrink: 1,
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.15,
  },
  headerClock: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  headerFinish: {
    flexShrink: 0,
  },
  headerFinishText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.purple,
  },
  headerFinishTextDisabled: {
    color: '#C9C2DA',
  },
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: AW3.hair,
  },
  statText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: theme.ink,
  },
  statTextFaint: {
    color: theme.faint,
  },
  statDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: AW3.ghost,
  },
  statTag: {
    marginLeft: 'auto',
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
  },
  body: {
    flex: 1,
  },

  // empty state
  emptyContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  emptyHero: {
    marginTop: 34,
    alignItems: 'center',
  },
  emptyIconTile: {
    width: 92,
    height: 92,
    borderRadius: 26,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.2,
    marginTop: 18,
  },
  emptySubtitle: {
    fontSize: 13.5,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 7,
    lineHeight: 20,
    maxWidth: 260,
    textAlign: 'center',
  },
  // purpleFill wherever white is written on violet — this CTA, Finish, the
  // picked chips and the sheet's Add: in dark `purple` is a text violet and
  // white on it is 3.49:1 (accessibility audit, 2026-09-21).
  emptyCta: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.purpleFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
    shadowColor: theme.purple,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    elevation: 10,
  },
  emptyCtaText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  quickSection: {
    marginTop: 34,
  },
  quickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
  },
  quickSeeAll: {
    fontSize: 12.5,
    fontWeight: '800',
    color: theme.highlight,
  },
  quickList: {
    gap: 9,
    marginTop: 12,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 11,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  quickRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  quickRowName: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.ink,
  },
  quickRowMeta: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.faint,
    marginTop: 2,
  },
  quickRowPlus: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // logging state
  loggingContent: {},
  // Amber, not red: nothing is broken, one thing is off. Theme tokens: the
  // fixed hexes put #D97706 words on a pale box at 2.9:1, and the same pale
  // box in dark; the guided player's banner reads the same tokens (2026-09-26).
  deniedBanner: {
    marginTop: 14,
    marginHorizontal: 14,
    padding: 13,
    borderRadius: 16,
    backgroundColor: theme.amberSoft,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deniedTitle: { fontSize: 13.5, fontWeight: '800', color: theme.amberInk },
  deniedBody: { fontSize: 12.5, fontWeight: '700', color: theme.ink, marginTop: 3, lineHeight: 17 },
  deniedAction: { fontSize: 13, fontWeight: '800', color: theme.amberInk },
  exerciseBlock: {
    paddingTop: 15,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  exerciseBlockDivided: {
    borderTopWidth: 1,
    borderTopColor: AW3.hair,
  },
  // 44 tall and 7 wider on the right than it looks, so the remove button's
  // hitSlop is inside its parent: Android clips a slop to the parent's bounds
  // (accessibility audit, 2026-09-21). The block's 20 of side padding is
  // what the 7 borrows.
  exerciseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 44,
    marginRight: -7,
    paddingRight: 7,
  },
  exerciseHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  exerciseName: {
    fontSize: 16.5,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.16,
  },
  // The box two paired lifts share, and the label straddling its top line.
  supersetGroup: {
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginVertical: 8,
  },
  supersetGroupPill: {
    position: 'absolute',
    top: -7,
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
  exerciseMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.faint,
    marginTop: 1,
  },
  exerciseRemove: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setGridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 13,
  },
  setGridHeaderText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: theme.faint,
  },
  setGridHeaderCenter: {
    textAlign: 'center',
  },
  setColIndex: {
    width: 22,
  },
  setColField: {
    flex: 1,
  },
  setColCheck: {
    width: 44,
  },
  setList: {
    gap: 6,
    marginTop: 6,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: 10,
  },
  setRowDone: {
    backgroundColor: AW3.field,
  },
  setIndex: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.ink,
  },
  setIndexActive: {
    color: theme.purple,
  },
  // minHeight, not height: a fixed 40 clipped the number at the large font
  // sizes (accessibility audit, 2026-09-21).
  setInput: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
    backgroundColor: AW3.field,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: theme.ink,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  setCheckCell: {
    alignItems: 'center',
  },
  setCheck: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFEBF9',
  },
  setCheckDone: {
    backgroundColor: theme.green,
  },
  plateStrip: {
    marginTop: 7,
    marginBottom: 2,
    marginHorizontal: -8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.purpleLight,
  },
  // Round and filled, so it reads as the one thing in the head row that ADDS
  // rather than one more outline among the icons.
  blockAddSet: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.green,
  },
  addSetButton: {
    height: 36,
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 11,
  },
  addSetText: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.purpleDark,
  },
  loggingFooter: {
    marginTop: 6,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: AW3.hair,
    gap: 12,
  },
  addExerciseDashed: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addExerciseDashedText: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.purpleDark,
  },
  finishButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.purpleFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    shadowColor: theme.purple,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 26,
    elevation: 10,
  },
  finishButtonSaving: {
    opacity: 0.7,
  },
  // The hint above says Finish is grey; it was only disabled, still drawn in
  // full purple, so a tap that did nothing read as a broken button.
  finishButtonDisabled: {
    backgroundColor: '#E7E1F2',
    shadowOpacity: 0,
    elevation: 0,
  },
  finishButtonTextDisabled: {
    color: theme.faint,
  },
  finishButtonText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Says why Finish is grey rather than leaving the reader to guess.
  finishHint: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.muted,
    textAlign: 'center',
  },

  // shared tile
  tile: {
    flexShrink: 0,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    fontWeight: '800',
    color: theme.purpleDark,
    letterSpacing: 0.3,
  },

  // add-exercise sheet
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16,12,40,0.42)',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.bg,
    overflow: 'hidden',
  },
  sheetGripRow: {
    alignItems: 'center',
    paddingTop: 9,
    paddingBottom: 4,
  },
  sheetGrip: {
    width: 38,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: '#D8CFEC',
  },
  sheetHead: {
    paddingTop: 6,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  sheetHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sheetHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.22,
  },
  sheetSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 3,
  },
  sheetClose: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.purple,
    paddingTop: 4,
  },
  searchField: {
    marginTop: 14,
    height: 46,
    borderRadius: 13,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: theme.ink,
    paddingVertical: 0,
  },
  sheetChipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  sheetChip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
  },
  sheetChipActive: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  sheetChipText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: theme.ink,
  },
  sheetChipTextActive: {
    color: '#FFFFFF',
  },
  sheetSectionHeader: {
    paddingHorizontal: 20,
  },
  sheetSectionHeaderAll: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  sheetSectionTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: theme.ink,
  },
  sheetSectionSubtitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 2,
  },
  popularRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 13,
    paddingBottom: 4,
  },
  popularCard: {
    width: 148,
    flexShrink: 0,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
    padding: 12,
    shadowColor: '#28185A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  popularCardSelected: {
    borderColor: theme.purple,
    shadowColor: theme.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 5,
  },
  popularTile: {
    height: 78,
    borderRadius: 12,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularTileText: {
    fontSize: 30,
    fontWeight: '800',
    color: theme.purpleDark,
  },
  popularToggle: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  popularName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
    marginTop: 10,
    lineHeight: 17,
  },
  popularMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.faint,
    marginTop: 4,
  },
  selectPill: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
    shadowColor: '#28185A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
    flexShrink: 0,
  },
  selectPillOn: {
    backgroundColor: theme.green,
    borderColor: theme.green,
  },
  sheetListContent: {
    paddingBottom: 12,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 11,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: AW3.fieldBorder,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  sheetRowSelected: {
    borderColor: theme.purple,
  },
  sheetRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowName: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.ink,
  },
  sheetRowMeta: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.faint,
    marginTop: 2,
  },
  sheetEmptyText: {
    textAlign: 'center',
    paddingVertical: 30,
    fontSize: 14,
    fontWeight: '700',
    color: theme.faint,
  },
  sheetFooter: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: AW3.hair,
    backgroundColor: theme.bg,
  },
  sheetConfirm: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.purpleFill,
    shadowColor: theme.purple,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    elevation: 10,
  },
  sheetConfirmDisabled: {
    backgroundColor: '#E7E1F2',
    shadowOpacity: 0,
    elevation: 0,
  },
  sheetConfirmText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sheetConfirmTextDisabled: {
    color: theme.faint,
  },
  });
};
