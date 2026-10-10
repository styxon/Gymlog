import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { ExerciseSetLog, formatSetLogSet, SET_LOG_SESSIONS } from '../lib/exerciseSetLog';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { FREE_RECORD_MONTHS } from '../lib/historyWindow';
import { I18nKey, t } from '../lib/i18n';
import { BlurredPreview } from './BlurredPreview';
import { CutSurface } from './CutSurface';
import { libraryLabel } from '../lib/libraryLabel';
import { PersonalRecord } from '../lib/personalRecords';
import { Theme, darkTheme, useTheme, useThemedStyles } from '../theming';
import type { AppLanguage } from '../types/models';
import { formatDateNumeric, removeTrailingZeros } from '../lib/format';

/**
 * One lift's set log, on a sheet over the exercise it belongs to.
 *
 * A sheet rather than a screen because the curve underneath is the context:
 * you open this to find out what the line is made of, and closing it should
 * put you back where you were looking.
 *
 * Locked, it BLURS the reader's own sets. Fading the real rows was the first
 * attempt and they stayed readable, which makes a lock decorative; drawing
 * grey blocks in their shape was the second, and it read as a screen nobody
 * had finished rather than one you cannot see into. Inventing sets would have
 * been worse than either, because what is behind this lock is the reader's own
 * training.
 */

type BestTone = 'weight' | 'reps' | 'volume';

/** One blurred line per session, and the box is sized from it. */
const BLURRED_LINE_HEIGHT = 30;

interface SetLogSheetProps {
  visible: boolean;
  log: ExerciseSetLog | null;
  language: AppLanguage;
  locked: boolean;
  onClose: () => void;
  onOpenPro: () => void;
  /** The empty state's way out: there is nothing to read until you log one. */
  onStartWorkout?: () => void;
  /**
   * The screen's bottom safe-area inset. A Modal's own reads 0, so the last
   * session sat under the gesture bar ("vähän pelivaraa alapalkin ja
   * näppäinten väliin", #bugs 2026-09-20); the screen reads it and passes it.
   */
  bottomInset?: number;
}

function decimal(value: number, language: AppLanguage) {
  // The separator is format.ts's business now — it reads the app language
  // once instead of every caller deciding again.
  // Hundredths, not tenths: the dial steps 1.25 kg and 61.25 is not "61,3".
  return removeTrailingZeros(Math.round(value * 100) / 100);
}

function thousands(value: number, language: AppLanguage) {
  return Math.round(value).toLocaleString(language === 'fi' ? 'fi-FI' : 'en-GB');
}

function formatDay(iso: string, language: AppLanguage) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateNumeric(date, language);
}

const WEEKDAY_KEYS: I18nKey[] = [
  'cal.dow.sun',
  'cal.dow.mon',
  'cal.dow.tue',
  'cal.dow.wed',
  'cal.dow.thu',
  'cal.dow.fri',
  'cal.dow.sat',
];

function weekday(iso: string, language: AppLanguage) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return t(language, WEEKDAY_KEYS[date.getDay()]);
}

function LockGlyph({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={10} width={16} height={11} rx={3} stroke={color} strokeWidth={2.2} />
      <Path d="M8 10V7a4 4 0 018 0v3" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12.5l5 5L20 6.5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** One session: the day, its volume, and the sets as chips. */
function SessionRow({
  session,
  timed,
  language,
  last,
}: {
  session: ExerciseSetLog['sessions'][number];
  timed: boolean;
  language: AppLanguage;
  last?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.session, !last && styles.sessionDivider]}>
      <View style={styles.sessionHead}>
        <View style={styles.sessionDateLine}>
          <Text style={styles.sessionDate}>
            {formatDay(session.performedAt, language)}
          </Text>
          <Text style={styles.sessionDow}>
            {weekday(session.performedAt, language)}
          </Text>
        </View>
        {/* Kilos of volume only where there were kilos: "0 kg" under a
            plank or a set of pull-ups is a number about nothing. */}
        {session.volumeKg > 0 ? (
          <Text style={styles.sessionVolume}>
            {thousands(session.volumeKg, language)} kg
          </Text>
        ) : null}
      </View>
      <View style={styles.chipRow}>
        {session.sets.map((set, index) => (
          <View
            key={index}
            style={[styles.chip, set.isRecord && styles.chipRecord]}
          >
            <Text style={[styles.chipText, set.isRecord && styles.chipTextRecord]}>
              {formatSetLogSet(set, timed, language)}
            </Text>
            {set.isRecord ? (
              <Text style={styles.chipBadge}>{t(language, 'setlog.pr')}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function SetLogSheet({
  visible,
  log,
  language,
  locked,
  onClose,
  onOpenPro,
  onStartWorkout,
  bottomInset = 0,
}: SetLogSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  /**
   * Pulled down from the top to close, like the exercise sheet: the backdrop
   * above it was the only way out, and a short sheet left little of it
   * (#bugs 2026-10-01, "vedettävä nappi ylhäältä alas"). A transform, so the
   * drag moves pixels, not layout.
   */
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    dragY.setValue(0);
  }, [visible, dragY]);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 0.8) {
            onCloseRef.current();
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start(),
      }),
    [dragY],
  );

  if (!log) {
    return null;
  }

  const title = exerciseNameLabel(language, log.name);
  const part = log.bodyPart ? libraryLabel(log.bodyPart, language) : null;
  const empty = log.sessions.length === 0;
  /**
   * The lines the locked preview blurs — the reader's real sets, in the same
   * words the unlocked list uses. Nothing invented: a made-up figure is a lie
   * the blur would only be hiding.
   */
  const blurredSets = log.sessions
    .slice(0, 3)
    .map((session) => session.sets.map((set) => formatSetLogSet(set, log.timed, language)).join('   '))
    .join('\n');
  // "5 most recent" is a lie when there are three. Say what is shown.
  const shownLabel = empty
    ? null
    : log.totalSessions > SET_LOG_SESSIONS
      ? t(language, 'setlog.recentCapped', {
          shown: log.sessions.length,
          total: log.totalSessions,
        })
      : log.sessions.length === 1
        ? t(language, 'setlog.recentOne')
        : t(language, 'setlog.recent', { count: log.sessions.length });

  const bests: Array<{ labelKey: I18nKey; value: string; meta: string; tone: BestTone } | null> = [
    best(log.bestWeight, 'setlog.best.weight', 'weight', (record) => ({
      value: `${decimal(record.value, language)} kg`,
      meta: `× ${record.companion ?? 0} · ${formatDay(record.performedAt, language)}`,
    })),
    best(log.bestReps, 'setlog.best.reps', 'reps', (record) => ({
      value:
        record.companion === null
          ? `${record.value}`
          : `${record.value} × ${decimal(record.companion, language)}`,
      meta: formatDay(record.performedAt, language),
    })),
    best(log.bestVolume, 'setlog.best.volume', 'volume', (record) => ({
      value: `${thousands(record.value, language)} kg`,
      meta: formatDay(record.performedAt, language),
    })),
  ];

  function best(
    record: PersonalRecord | null,
    labelKey: I18nKey,
    tone: BestTone,
    format: (record: PersonalRecord) => { value: string; meta: string },
  ) {
    if (!record) {
      return null;
    }
    return { labelKey, tone, ...format(record) };
  }

  const shownBests = bests.filter(Boolean) as Array<{
    labelKey: I18nKey;
    value: string;
    meta: string;
    tone: BestTone;
  }>;
  // One colour per kind of best, so the three read apart at a glance
  // (#bugs 2026-10-01, "isompi ja värikoodattu"): weight violet, reps green,
  // the session's volume amber — each a wash with its own ink on top.
  const bestColors: Record<BestTone, { fill: string; border: string; ink: string }> = {
    weight: { fill: theme.purpleLight, border: theme.purple, ink: theme.proInk },
    reps: { fill: theme.greenSoft, border: theme.green, ink: theme.greenInk },
    volume: { fill: theme.amberSoft, border: theme.amberBorder, ink: theme.amberInk },
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[styles.sheet, { paddingBottom: 26 + bottomInset, transform: [{ translateY: dragY }] }]}
      >
        {/* The pull zone is the grip and the title together, not the grip's
            four pixels alone. */}
        <View {...pan.panHandlers} style={styles.dragArea}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.headCopy}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {[part, shownLabel].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {/* The same tag locked or not: the whole sheet is Pro, so a pill
                naming a free window of months read as set-level data Free gets. */}
            <View style={styles.proTag}>
              <Text style={styles.proTagText}>PRO</Text>
            </View>
          </View>
        </View>

        {/* No line here. It drew the top set's weight only, so 6/6/6 then
            6/6/7 at 60 kg came out flat — progress drawn as none (#bugs
            2026-10-01, "kertooko tuo jana kehitystä? poistetaanko"). The bests
            and the sets below say what happened. */}
        {empty ? (
          <View style={styles.emptyBlock}>
            <View style={styles.emptyIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M4 7h16M4 12h16M4 17h10"
                  stroke={theme.purple}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
            <Text style={styles.emptyTitle}>{t(language, 'setlog.empty.title')}</Text>
            <Text style={styles.emptyBody}>{t(language, 'setlog.empty.body')}</Text>
            {onStartWorkout ? (
              <Pressable
                accessibilityRole="button"
                onPress={onStartWorkout}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <CutSurface size="lg" fill={theme.purple} style={styles.cta}>
                  <Text style={styles.ctaText}>{t(language, 'setlog.empty.cta')}</Text>
                </CutSurface>
              </Pressable>
            ) : null}
          </View>
        ) : locked ? (
          <View style={styles.lockedBlock}>
            {/* The reader's OWN sets, blurred — not a skeleton of them.

                A skeleton was the second attempt (the first, dimming the real
                rows, left them readable). It claimed nothing false, but it
                claimed nothing at all: grey blocks in the shape of a list read
                as a screen somebody had not finished building, which is what
                the reader called it — "tama on vahan keskeneräinen ruutu ja
                lukossa" (2026-09-07).

                `BlurredPreview` was written for exactly this and its own
                comment says why: "a skeleton says there is something here, a
                blur says there is THIS here, and you cannot read it." It is a
                real gaussian blur through react-native-svg, with a scrim over
                it so a device that ignores the filter degrades to an
                unreadable block rather than leaking the figures. */}
            <View style={styles.lockedRows} pointerEvents="none">
              {/* Height from the LINES, not from a number chosen to look like
                  the skeleton it replaces: one row per session, at the line
                  height below, plus the room the lock badge is pulled up into
                  by `lockedCopy`'s negative margin. */}
              <BlurredPreview
                content={{ kind: 'text', text: blurredSets, fontSize: 15, lineHeight: BLURRED_LINE_HEIGHT }}
                height={Math.min(3, Math.max(1, log.sessions.length)) * BLURRED_LINE_HEIGHT + 48}
              />
            </View>

            <View style={styles.lockedCopy}>
              <View style={styles.lockBadge}>
                <LockGlyph color="#FFFFFF" />
              </View>
              <View style={styles.lockTitleRow}>
                <Text style={styles.lockTitle}>{t(language, 'setlog.lock.title')}</Text>
                <View style={styles.proTagSolid}>
                  <Text style={styles.proTagSolidText}>PRO</Text>
                </View>
              </View>
              <View style={styles.lockBenefits}>
                {(
                  [
                    ['setlog.lock.b1.t', 'setlog.lock.b1.b'],
                    ['setlog.lock.b2.t', 'setlog.lock.b2.b'],
                    ['setlog.lock.b3.t', 'setlog.lock.b3.b'],
                  ] as Array<[I18nKey, I18nKey]>
                ).map(([titleKey, bodyKey]) => (
                  <View key={titleKey} style={styles.lockBenefit}>
                    <CheckGlyph color={theme.purple} />
                    <View style={styles.lockBenefitCopy}>
                      <Text style={styles.lockBenefitTitle}>{t(language, titleKey)}</Text>
                      <Text style={styles.lockBenefitBody}>
                        {t(language, bodyKey, { months: FREE_RECORD_MONTHS })}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onOpenPro}
                style={({ pressed }) => [styles.ctaWide, pressed && styles.pressed]}
              >
                <CutSurface size="lg" fill={theme.purple} style={styles.cta}>
                  <Text style={styles.ctaText}>{t(language, 'setlog.lock.cta')}</Text>
                </CutSurface>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {shownBests.length > 0 ? (
              <View style={styles.bestRow}>
                {shownBests.map((entry) => {
                  const colors = bestColors[entry.tone];
                  return (
                    <View
                      key={entry.labelKey}
                      style={[styles.bestCard, { backgroundColor: colors.fill, borderColor: colors.border }]}
                    >
                      <Text style={[styles.bestLabel, { color: colors.ink }]}>{t(language, entry.labelKey)}</Text>
                      {/* Three abreast on a 360 dp phone leave a tile ~77 dp of
                          text; "1 140 kg" at full size needs more, so it scales
                          down rather than clip. */}
                      <Text style={styles.bestValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {entry.value}
                      </Text>
                      <Text style={styles.bestMeta}>{entry.meta}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.setsHead}>
              <Text style={styles.setsLabel}>{t(language, 'setlog.sets')}</Text>
              <Text style={styles.setsHint}>{t(language, 'setlog.setsHint')}</Text>
            </View>

            {log.sessions.map((session, index) => (
              <SessionRow
                key={session.performedAt}
                session={session}
                timed={log.timed}
                language={language}
                last={index === log.sessions.length - 1}
              />
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 10, 40, 0.42)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: theme.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
  },
  dragArea: { paddingTop: 10, marginTop: -10 },
  // White on the dark sheet, where the border tone all but vanished (#bugs
  // 2026-10-01); light keeps a grey that shows on white.
  grabber: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme === darkTheme ? theme.ink : theme.border,
    opacity: theme === darkTheme ? 0.85 : 1,
    marginBottom: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  headCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.ink,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  proTag: {
    borderRadius: 6,
    backgroundColor: '#EFE7FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  proTagText: {
    color: theme.purpleDark,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  proTagSolid: {
    borderRadius: 6,
    // The white-label violet (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  proTagSolidText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  body: {
    paddingBottom: 12,
  },
  bestRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  // Fill, border and label colour come per tile (bestColors).
  bestCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  bestLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  bestValue: {
    color: theme.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 5,
  },
  bestMeta: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 3,
  },
  setsHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  setsLabel: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  setsHint: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  session: {
    paddingBottom: 15,
  },
  sessionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginBottom: 15,
  },
  sessionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sessionDateLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  sessionDate: {
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  sessionDow: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  sessionVolume: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  chipRecord: {
    backgroundColor: theme.purpleFill,
    borderColor: theme.purpleFill,
  },
  chipText: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  chipTextRecord: {
    color: '#FFFFFF',
  },
  chipBadge: {
    color: '#FFFFFF',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  lockedBlock: {
    position: 'relative',
  },
  lockedRows: {
    gap: 15,
  },
  lockedCopy: {
    marginTop: -34,
    alignItems: 'center',
  },
  lockBadge: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: theme.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  lockTitle: {
    color: theme.ink,
    fontSize: 18.5,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  lockBenefits: {
    alignSelf: 'stretch',
    gap: 9,
    marginTop: 16,
  },
  lockBenefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  lockBenefitCopy: {
    flex: 1,
    minWidth: 0,
  },
  lockBenefitTitle: {
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  lockBenefitBody: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  cta: {
    marginTop: 16,
    height: 50,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWide: {
    alignSelf: 'stretch',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  emptyBlock: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 19,
    backgroundColor: '#EFE7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    marginTop: 15,
  },
  emptyBody: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 250,
  },
});
