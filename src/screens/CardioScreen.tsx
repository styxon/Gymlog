/**
 * Cardio v1 (Home → Cardio list → player → finish).
 *
 * One route, three internal modes driven by the live cardio session in
 * WorkoutProvider: no session → activity list; session → full-screen player
 * (elapsed timer counting UP, pause/resume); "Finish" → dark summary with
 * optional manual distance, derived pace, weekly minutes and feel pills.
 * Offline-first and timer-based — no GPS anywhere in v1.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardioIcon } from '../components/CardioIcon';
import {
  ActiveCardioSession,
  CARDIO_ACTIVITIES,
  CARDIO_FEEL_OPTIONS,
  CardioIconKind,
  formatCardioDuration,
  formatCardioPace,
  getCardioActivity,
  getCardioAvgPaceSecPerKm,
  getCardioElapsedMs,
  getWeekCardioMinutesWithRun,
  isCardioDistanceTextSavable,
  parseCardioDistanceKm,
  resolveCardioFinish,
} from '../lib/cardio';
import { I18nKey, t } from '../lib/i18n';
import { haptics } from '../utils/haptics';
import { sound } from '../utils/sound';
import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { AppLanguage, CardioActivityType, CardioFeel, CardioSession } from '../types/models';
import { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { useKeepScreenAwake } from '../utils/keepAwake';
import { queryReduceMotion } from '../utils/reduceMotion';

function cardioActivityName(language: AppLanguage, activityType: CardioActivityType) {
  return t(language, `cardio.activity.${activityType}` as I18nKey);
}

function cardioEquipmentLabel(language: AppLanguage, equipmentLabel: string) {
  return t(language, `cardio.equipment.${equipmentLabel}` as I18nKey);
}

interface CardioScreenProps {
  /** Keep the display on while the cardio player runs. */
  keepScreenAwake?: boolean;
  language?: AppLanguage;
  cardioSessions: CardioSession[];
  hasActiveStrengthSession: boolean;
  isSaving: boolean;
  onResumeStrengthSession: () => void;
  onDiscardStrengthSession: () => Promise<void> | void;
  onSaveCardioSession: (input: {
    activityType: CardioActivityType;
    startedAt: string;
    /** When the clock stopped — the saved row's date. */
    endedAt: string;
    durationSec: number;
    distanceKm: number | null;
    feel: CardioFeel | null;
  }) => Promise<void>;
  onLeave: () => void;
}

export function CardioScreen({
  keepScreenAwake = false,
  language = 'en',
  cardioSessions,
  hasActiveStrengthSession,
  isSaving,
  onResumeStrengthSession,
  onDiscardStrengthSession,
  onSaveCardioSession,
  onLeave,
}: CardioScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const themeName = useThemeName();
  // Read here, on the screen: inside CardioSheet's Modal it is always 0.
  const insets = useSafeAreaInsets();
  const workout = useWorkoutContext();
  const activeCardio = workout.activeCardio;
  // Only hold the screen while a cardio session is actually running.
  useKeepScreenAwake(keepScreenAwake && activeCardio !== null, 'cardio-player');

  const [finishing, setFinishing] = useState(false);
  const [conflictFor, setConflictFor] = useState<CardioActivityType | null>(null);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  /**
   * One save per run. `isSaving` comes from App, which sets it inside the save
   * — a render after the tap — so two quick taps on "Complete" both read false
   * and saved the run twice, each under a fresh id that nothing downstream
   * folds together. A ref answers the second tap at once; the strength finish
   * has the same guard (finishInFlightRef).
   */
  const completeInFlightRef = useRef(false);

  const mode: 'list' | 'player' | 'finish' = activeCardio ? (finishing ? 'finish' : 'player') : 'list';

  // Reset transient state whenever the live session goes away.
  useEffect(() => {
    if (!activeCardio) {
      setFinishing(false);
      setEndSheetOpen(false);
      completeInFlightRef.current = false;
    }
  }, [activeCardio]);

  const startActivity = (activityType: CardioActivityType) => {
    if (hasActiveStrengthSession) {
      setConflictFor(activityType);
      return;
    }
    void haptics.impactMedium();
    sound.go();
    workout.startCardio(activityType);
  };

  /* ── hardware back: player → end sheet, finish → back to player, list → leave ── */
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'finish') {
        setFinishing(false);
        return true;
      }
      if (mode === 'player') {
        setEndSheetOpen(true);
        return true;
      }
      onLeave();
      return true;
    });
    return () => handler.remove();
  }, [mode, onLeave]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Same trap as the guided player's: a fixed 'dark' is right only for
          the light theme, and paints the phone's clock out on the other one. */}
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} backgroundColor={theme.bg} />

      {mode === 'list' && <CardioListView language={language} onLeave={onLeave} onStart={startActivity} />}

      {mode === 'player' && activeCardio && (
        <CardioPlayerView
          language={language}
          session={activeCardio}
          onPause={() => {
            void haptics.select();
            workout.pauseCardio();
          }}
          onResume={() => {
            void haptics.select();
            workout.resumeCardio();
          }}
          onExit={() => setEndSheetOpen(true)}
        />
      )}

      {mode === 'finish' && activeCardio && (
        <CardioFinishView
          language={language}
          session={activeCardio}
          cardioSessions={cardioSessions}
          isSaving={isSaving}
          onComplete={async (distanceKm, feel, minutesText) => {
            if (completeInFlightRef.current) {
              return;
            }
            const nowMs = Date.now();
            const finish = resolveCardioFinish(activeCardio, nowMs, minutesText);
            // A clock that ran for days is saved as the minutes the reader
            // typed or not at all; the button is held, this is the second door.
            if (finish.durationSec === null) {
              return;
            }
            completeInFlightRef.current = true;
            try {
              await onSaveCardioSession({
                activityType: activeCardio.activityType,
                startedAt: activeCardio.startedAt,
                endedAt: finish.endedAt,
                durationSec: finish.durationSec,
                distanceKm,
                feel,
              });
            } catch {
              // Save failed (App shows the toast) — keep the session so the
              // user can retry; never claim success before the save resolves.
              // The guard opens again only here: after a save that landed the
              // run is on its way out, and a tap in between must not save it
              // a second time.
              completeInFlightRef.current = false;
              return;
            }
            void haptics.success();
            sound.finish();
            workout.clearCardio();
            onLeave();
          }}
        />
      )}

      {endSheetOpen && activeCardio && (
        <CardioSheet onClose={() => setEndSheetOpen(false)} bottomInset={insets.bottom}>
          <Text style={styles.sheetTitle}>{t(language, 'cardio.endTitle')}</Text>
          {/* Cancel above discard, not below it. Both were neutral ghosts in a
              column, so the safe way out sat under the destructive one at the
              very bottom edge — the two easiest places to hit by accident were
              "throw the session away" and "the thing behind the phone's
              buttons" (user 2026-08-26). */}
          <View style={{ gap: 10 }}>
            <SheetPrimaryBtn
              // Orange, the app's own "you can press this". Green belonged to
              // no part of this app's language.
              label={t(language, 'cardio.finish')}
              color={theme.highlight}
              textColor={theme.onHighlight}
              onPress={() => {
                setEndSheetOpen(false);
                workout.pauseCardio();
                setFinishing(true);
              }}
            />
            <SheetGhostBtn label={t(language, 'common.cancel')} onPress={() => setEndSheetOpen(false)} />
            <SheetGhostBtn
              label={t(language, 'cardio.discard')}
              tone="danger"
              onPress={() => {
                setEndSheetOpen(false);
                workout.clearCardio();
              }}
            />
          </View>
        </CardioSheet>
      )}

      {conflictFor !== null && (
        <CardioSheet onClose={() => setConflictFor(null)} bottomInset={insets.bottom}>
          <Text style={styles.sheetTitle}>{t(language, 'cardio.conflictTitle')}</Text>
          <View style={{ gap: 10 }}>
            <SheetPrimaryBtn
              label={t(language, 'cardio.resumeIt')}
              color={theme.purple}
              onPress={() => {
                setConflictFor(null);
                onResumeStrengthSession();
              }}
            />
            <SheetGhostBtn
              label={t(language, 'cardio.discardAndStart')}
              onPress={() => {
                const activityType = conflictFor;
                setConflictFor(null);
                void (async () => {
                  await onDiscardStrengthSession();
                  void haptics.impactMedium();
                  workout.startCardio(activityType);
                })();
              }}
            />
            <SheetGhostBtn label={t(language, 'common.cancel')} onPress={() => setConflictFor(null)} />
          </View>
        </CardioSheet>
      )}
    </View>
  );
}

/* ── 1 · activity list ── */
function CardioListView({
  language,
  onLeave,
  onStart,
}: {
  language: AppLanguage;
  onLeave: () => void;
  onStart: (activityType: CardioActivityType) => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Icon-only, so it carries its own name (accessibility audit,
          2026-09-21). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(language, 'common.back')}
        onPress={onLeave}
        style={styles.backBtn}
        hitSlop={8}
      >
        <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={theme.purpleDark} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M15 6l-6 6 6 6" />
        </Svg>
      </Pressable>
      <Text style={styles.listTitle}>{t(language, 'cardio.list.title')}</Text>
      <Text style={styles.listSub}>{t(language, 'cardio.list.sub')}</Text>
      <View style={{ gap: 12, marginTop: 20 }}>
        {CARDIO_ACTIVITIES.map((activity) => (
          <Pressable
            key={activity.id}
            accessibilityRole="button"
            style={({ pressed }) => [styles.activityCard, pressed && { opacity: 0.85 }]}
            onPress={() => onStart(activity.id)}
          >
            <View style={styles.activityIconTile}>
              <CardioIcon kind={activity.icon} size={24} color={theme.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityName}>{cardioActivityName(language, activity.id)}</Text>
              <View style={styles.equipmentChip}>
                <Text style={styles.equipmentChipText}>{cardioEquipmentLabel(language, activity.equipmentLabel).toUpperCase()}</Text>
              </View>
            </View>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M9 6l6 6-6 6" />
            </Svg>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/* ── 2 · in-session player ── */
function CardioPlayerView({
  language,
  session,
  onPause,
  onResume,
  onExit,
}: {
  language: AppLanguage;
  session: ActiveCardioSession;
  onPause: () => void;
  onResume: () => void;
  onExit: () => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const activity = getCardioActivity(session.activityType);
  const running = session.resumedAt !== null;
  const [elapsedMs, setElapsedMs] = useState(() => getCardioElapsedMs(session, Date.now()));

  useEffect(() => {
    setElapsedMs(getCardioElapsedMs(session, Date.now()));
    if (!running) {
      return;
    }
    const interval = setInterval(() => {
      setElapsedMs(getCardioElapsedMs(session, Date.now()));
    }, 250);
    return () => clearInterval(interval);
  }, [session, running]);

  // Pulsing icon tile while the clock runs — unless the phone asks for less
  // motion. It is a loop with no end for as long as the run lasts, the kind
  // of movement that setting exists to stop (accessibility audit,
  // 2026-09-21). Until the OS answers it pulses, the helper's safe default.
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void queryReduceMotion().then((reduced) => {
      if (mounted) {
        setReduceMotion(reduced);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!running || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, running, reduceMotion]);

  return (
    <View style={{ flex: 1 }}>
      {/* The ✕, pause and end were icons with no name; the words under pause
          and end are sibling Text, which a screen reader does not read as
          the button's (accessibility audit, 2026-09-21). The ✕ opens the same
          end sheet as End, so it says the same. */}
      <View style={styles.playerTopBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'cardio.end')}
          onPress={onExit}
          style={styles.playerTopBtn}
          hitSlop={8}
        >
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 6l12 12M18 6L6 18" />
          </Svg>
        </Pressable>
        <Text style={styles.playerTopLabel}>{t(language, 'cardio.eyebrow')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 }}>
        <Animated.View style={[styles.playerIconTile, { transform: [{ scale: pulse }] }]}>
          <CardioIcon kind={activity.icon} size={34} color={theme.purple} />
        </Animated.View>
        {/* One line, shrinking rather than clipping: the activity's own word is
            the last one in Finnish word order, so a cut takes exactly the part
            that says what you are doing. */}
        <Text style={styles.playerActivityName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {cardioActivityName(language, session.activityType)}
        </Text>
        <Text style={[styles.playerTimer, { color: running ? theme.ink : theme.faint }]}>
          {formatCardioDuration(elapsedMs / 1000)}
        </Text>
        {!running ? <Text style={styles.pausedLabel}>{t(language, 'cardio.paused')}</Text> : <View style={{ height: 20 }} />}
      </View>

      {/* Ending was the X in the top corner, which is where you close a screen
          rather than where you finish a workout — so the one control that saves
          the session was the one that looked like discarding it. It sits beside
          pause now (user 2026-08-26). */}
      <View style={styles.playerControls}>
        <View style={{ alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, running ? 'cardio.pause' : 'cardio.resume')}
            onPress={running ? onPause : onResume}
            style={styles.pauseBtn}
          >
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              {running ? <Path d="M9 5v14M15 5v14" /> : <Path d="M8 5l11 7-11 7z" />}
            </Svg>
          </Pressable>
          <Text style={styles.playerControlLabel}>
            {t(language, running ? 'cardio.pause' : 'cardio.resume')}
          </Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'cardio.end')}
            onPress={onExit}
            style={styles.endBtn}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={theme.onHighlight} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 6h12v12H6z" />
            </Svg>
          </Pressable>
          <Text style={styles.playerControlLabel}>{t(language, 'cardio.end')}</Text>
        </View>
      </View>
    </View>
  );
}

/* ── 3 · finish (dark summary) ── */
function CardioFinishView({
  language,
  session,
  cardioSessions,
  isSaving,
  onComplete,
}: {
  language: AppLanguage;
  session: ActiveCardioSession;
  cardioSessions: CardioSession[];
  isSaving: boolean;
  onComplete: (distanceKm: number | null, feel: CardioFeel | null, minutesText: string) => Promise<void>;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const [minutesText, setMinutesText] = useState('');
  const finish = resolveCardioFinish(session, Date.now(), minutesText);
  // Null only while a clock left running is waiting for the reader's minutes.
  const durationSec = finish.durationSec ?? 0;
  const [distanceText, setDistanceText] = useState('');
  const [feel, setFeel] = useState<CardioFeel | null>(null);

  const distanceKm = parseCardioDistanceKm(distanceText);
  // Text that is not a distance holds the save rather than dropping the distance.
  const distanceInvalid = !isCardioDistanceTextSavable(distanceText);
  const pace = getCardioAvgPaceSecPerKm(durationSec, distanceKm);
  // The stored rows are the ones there were when Finish opened this view. Read
  // live they counted the run twice while the save was pending: the new row is
  // in `cardioSessions` before the disk write finishes, and this run was added
  // on top of it. The week is the run's own — the one its row will be dated in.
  const [storedAtOpen] = useState(cardioSessions);
  // The run joins the stored rows as one more row and the total is rounded
  // once over the seconds, as Progress reads it after the save. Rounding the
  // week and the run apart read a minute less (40 where the saved week says 41).
  // A run whose earlier save is already stored (a lost clear) stands in for
  // its row; it read 60 minutes for a 30 minute run.
  const weekMinutes = getWeekCardioMinutesWithRun(storedAtOpen, {
    activityType: session.activityType,
    startedAt: session.startedAt,
    performedAt: finish.endedAt,
    durationSec,
  });

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, gap: 11 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.finishTitle}>
          {t(language, 'cardio.done', { activity: cardioActivityName(language, session.activityType) })}
        </Text>

        <View style={[styles.finishCard, { alignItems: 'center' }]}>
          <Text style={styles.finishHeroStat}>
            {finish.durationSec === null ? '–' : formatCardioDuration(finish.durationSec)}
          </Text>
          <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, color: theme.muted, marginTop: 4 }}>
            {t(language, 'cardio.stat.duration')}
          </Text>
        </View>

        {finish.needsMinutes ? (
          <View style={styles.finishCard}>
            <Text style={{ fontSize: 13, fontWeight: '700', lineHeight: 18, color: theme.ink }}>
              {t(language, 'cardio.clockLong', {
                time: formatCardioDuration(Math.round(getCardioElapsedMs(session, Date.now()) / 1000)),
              })}
            </Text>
            <TextInput
              value={minutesText}
              onChangeText={setMinutesText}
              placeholder={t(language, 'cardio.addMinutes')}
              placeholderTextColor={theme.faint}
              keyboardType="number-pad"
              maxLength={4}
              style={styles.distanceInput}
            />
          </View>
        ) : null}

        <View style={styles.finishCard}>
          <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: theme.purple }}>
            {t(language, 'cardio.stat.distance')}
          </Text>
          <TextInput
            value={distanceText}
            onChangeText={setDistanceText}
            placeholder={t(language, 'cardio.addDistance')}
            placeholderTextColor={theme.faint}
            keyboardType="decimal-pad"
            style={[styles.distanceInput, distanceInvalid && { color: theme.danger }]}
          />
          {pace !== null ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: theme.muted }}>{t(language, 'cardio.avgPace')}</Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] }}>
                {formatCardioPace(pace)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.finishCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: theme.green }}>{t(language, 'cardio.thisWeek')}</Text>
            <Text style={{ fontSize: 15, fontWeight: '800', color: theme.ink }}>
              {t(language, 'cardio.weekMinutes', { min: weekMinutes })}{' '}
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.muted }}>{t(language, 'cardio.weekCardio')}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.finishCard}>
          <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: theme.purple }}>
            {t(language, 'cardio.howFeel')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
            {CARDIO_FEEL_OPTIONS.map((option) => {
              const selected = feel === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFeel(selected ? null : option.key)}
                  style={[styles.feelPill, selected && styles.feelPillSelected]}
                >
                  <Text style={[styles.feelPillText, selected && { color: '#fff' }]}>
                    {t(language, `cardio.feel.${option.key}` as I18nKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.finishFooter}>
        <Pressable
          accessibilityRole="button"
          style={[styles.completeBtn, { opacity: isSaving || distanceInvalid || finish.durationSec === null ? 0.6 : 1 }]}
          accessibilityState={{ disabled: isSaving || distanceInvalid || finish.durationSec === null }}
          onPress={
            isSaving || distanceInvalid || finish.durationSec === null
              ? undefined
              : () => void onComplete(distanceKm, feel, minutesText)
          }
        >
          <Text style={{ fontSize: 15.5, fontWeight: '800', color: '#fff' }}>
            {t(language, isSaving ? 'cardio.saving' : 'cardio.complete')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── sheets ── */
function CardioSheet({
  onClose,
  bottomInset,
  children,
}: {
  onClose: () => void;
  /**
   * Safe-area inset, read on the screen — inside this Modal
   * `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose}>
        {/* Bottom-anchored, so its padding has to know how tall the phone's
            system bar is. A fixed number put the last button behind it. */}
        <Pressable style={[styles.sheet, { paddingBottom: bottomInset + 30 }]} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetPrimaryBtn({
  label,
  color,
  textColor = '#fff',
  onPress,
}: {
  label: string;
  color: string;
  /** The ink `color` was paired with. White is right on purple, not on orange. */
  textColor?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable onPress={onPress} style={[styles.sheetPrimaryBtn, { backgroundColor: color, shadowColor: color }]}>
      {/* The ink the fill was paired with. `highlight` is purple on the light
          theme and orange on the dark one, and white reads on only one of
          them — which is exactly what onHighlight exists to answer. */}
      <Text style={{ fontSize: 16, fontWeight: '800', color: textColor }}>{label}</Text>
    </Pressable>
  );
}

function SheetGhostBtn({
  label,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  onPress: () => void;
  /** 'danger' for the answer that throws the session away. */
  tone?: 'neutral' | 'danger';
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable onPress={onPress} style={styles.sheetGhostBtn}>
      <Text
        style={{
          fontSize: 14.5,
          fontWeight: '800',
          color: tone === 'danger' ? theme.danger : theme.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  /* list */
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  listTitle: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  listSub: { fontSize: 14, fontWeight: '600', color: theme.muted, marginTop: 4 },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingTop: 16,
    paddingHorizontal: 15,
    paddingBottom: 14,
    shadowColor: 'rgba(120,80,200,1)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
  },
  activityIconTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityName: { fontSize: 16.5, fontWeight: '800', color: theme.ink },
  equipmentChip: {
    alignSelf: 'flex-start',
    backgroundColor: theme.purpleLight,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 7,
  },
  equipmentChipText: {
    fontFamily: 'JetBrainsMono',
    fontSize: 10,
    letterSpacing: 0.6,
    color: theme.purpleDark,
  },

  /* player */
  playerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  playerTopBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  playerTopLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.6, color: theme.muted },
  playerIconTile: {
    width: 74,
    height: 74,
    borderRadius: 22,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  playerActivityName: { fontSize: 20, fontWeight: '800', color: theme.ink, textAlign: 'center' },
  playerTimer: {
    fontSize: 72,
    fontWeight: '800',
    letterSpacing: -2.5,
    lineHeight: 80,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  pausedLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1.8, color: theme.muted, marginTop: 2 },
  playerControls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 34,
    paddingBottom: 36,
  },
  playerControlLabel: { fontSize: 13, fontWeight: '700', color: theme.muted, marginTop: 10 },
  // Smaller than pause and orange rather than purple: pause is what you press
  // ten times in a session, ending it once.
  endBtn: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  pauseBtn: {
    width: 68,
    height: 68,
    borderRadius: 999,
    backgroundColor: theme.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 6,
  },

  /* finish (light — same theme as every other screen) */
  finishTitle: { marginTop: 6, marginHorizontal: 2, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  finishCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 17,
  },
  finishHeroStat: {
    fontSize: 54,
    fontWeight: '800',
    letterSpacing: -1.8,
    color: theme.ink,
    lineHeight: 60,
    fontVariant: ['tabular-nums'],
  },
  distanceInput: {
    marginTop: 10,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: theme.ink,
  },
  feelPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  // The white-label violet (accessibility audit, 2026-09-21).
  feelPillSelected: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  feelPillText: { fontSize: 13.5, fontWeight: '800', color: theme.muted },
  finishFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  completeBtn: {
    height: 56,
    borderRadius: 17,
    backgroundColor: theme.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.green,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 26,
    elevation: 6,
  },

  /* sheets */
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(14,8,30,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 30,
  },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: theme.ink, marginBottom: 16 },
  sheetPrimaryBtn: {
    height: 56,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 5,
  },
  sheetGhostBtn: {
    height: 48,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
