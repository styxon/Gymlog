import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ExerciseSheetHistory, SHEET_HISTORY_SESSIONS } from '../lib/exerciseSheetHistory';
import { getExerciseImageSource } from '../assets/exerciseImages';
import { removeTrailingZeros } from '../lib/format';
import { t } from '../lib/i18n';
import { Theme, useThemedStyles, useTheme } from '../theming';
import { AppLanguage } from '../types/models';

// A bundled picture carries its own pixel size, and React Native uses it
// as the Image's default width and height, which absoluteFill's edges do not
// override: the picture drew at full size from the corner and was cropped to
// its top-left (#bugs 2026-10-09). A remote uri had no size, so this never
// showed before the pictures were bundled.
const FILL_SIZE = { width: '100%', height: '100%' } as const;

/**
 * Everything the set screen knows about the lift in front of you, in one sheet.
 *
 * It used to be three panels swiped sideways at the top of the set screen —
 * which put the answer to "how much did I lift last time" behind a gesture,
 * above a screen whose whole job is a number you are about to type. The sheet
 * takes the same three things and gives them room: the photo and the setup,
 * the written steps with the cautions that apply to YOU, and the history the
 * panel could only show one session of.
 *
 * Three tabs rather than a scroll, because they answer three different
 * questions and a reader mid-set has exactly one of them.
 */
export type ExerciseSheetTab = 'learn' | 'howTo' | 'history';

export interface ExerciseSheetLearn {
  /** Three short cues — the ones worth remembering under the bar. */
  cues: string[];
  /**
   * Four statements about the set just done. Not a quiz with a right answer:
   * the ones the reader cannot tick honestly are the ones worth filming.
   */
  check: string[];
  /** Which of them are ticked, by index. */
  checked: number[];
  /** The reader pressed the button that says they know this lift. */
  learned: boolean;
  onToggleStatement: (index: number) => void;
  onToggleLearned: () => void;
}

export interface ExerciseSheetWatchFor {
  text: string;
  /** A caution the reader's own setup flags asked for — drawn amber. */
  flagged: boolean;
}

interface ExerciseSheetProps {
  visible: boolean;
  language: AppLanguage;
  /** Already localized. */
  exerciseName: string;
  imageKey: string | null;
  /** Two letters, when there is no photo. */
  initials: string;
  /** Already localized; empty means the tab says so rather than showing nothing. */
  instructions: string[];
  /**
   * The teaching this lift has, or null.
   *
   * Null for most of the library, and that is the designed state: the sheet
   * offers two tabs instead of three rather than a third with nothing in it.
   * The photo lives on How to either way — it used to have a tab of its own
   * whose other half was the same instructions the How-to tab already showed
   * (user 2026-09-04, "loop ja how to on käytännössä samat kohdat").
   */
  learn: ExerciseSheetLearn | null;
  watchFor: ExerciseSheetWatchFor[];
  history: ExerciseSheetHistory;
  initialTab?: ExerciseSheetTab;
  /**
   * The screen's bottom safe-area inset. This sheet read its own, and inside
   * a Modal that is always 0 — so the padding it added was 20, on every
   * phone. The screen reads the real one and passes it (#bugs 2026-09-20).
   */
  bottomInset?: number;
  onClose: () => void;
}

const ALL_TABS: ExerciseSheetTab[] = ['learn', 'howTo', 'history'];

export function ExerciseSheet({
  visible,
  language,
  exerciseName,
  imageKey,
  initials,
  instructions,
  learn,
  watchFor,
  history,
  initialTab,
  bottomInset = 0,
  onClose,
}: ExerciseSheetProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const photoSource = useMemo(() => getExerciseImageSource(imageKey), [imageKey]);
  // A lift with no teaching has no Learn tab, so it cannot open on one.
  const tabs = learn ? ALL_TABS : ALL_TABS.filter((key) => key !== 'learn');
  const [tab, setTab] = useState<ExerciseSheetTab>(initialTab ?? tabs[0]);

  /*
   * Two heights: 55% so the set screen stays in view (user decision
   * 2026-09-26), and 90% by dragging the top of the sheet up, for reading
   * the steps properly — "lähes koko sivun mittaiseksi voisi aukaista"
   * (#bugs 2026-09-27; "55 % ja vetämällä 90 %, käy"). A tap on the grip
   * toggles; dragging it well below 55% closes the sheet.
   *
   * The sheet is always 90% tall and SLIDES: collapsed is the same sheet moved
   * down by the difference. It used to animate its height, which laid out the
   * whole sheet — photo, steps, history — again on every frame of the drag,
   * on the JS thread the player's clock also runs on; it followed the finger
   * late (#bugs 2026-09-30, "vähän laginen tuo vedettävä valikko"). A
   * transform moves pixels and nothing else.
   */
  const { height: windowHeight } = useWindowDimensions();
  const collapsedHeight = Math.round(windowHeight * 0.55);
  const expandedHeight = Math.round(windowHeight * 0.9);
  /** How far the 90% sheet sits below its open position when collapsed. */
  const collapsedOffset = expandedHeight - collapsedHeight;
  const sheetOffset = useRef(new Animated.Value(collapsedOffset)).current;
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const dragStart = useRef(collapsedOffset);
  // Read through a ref: callers pass onClose inline, and the player
  // re-renders every second for its clock — a gesture rebuilt on each render
  // loses the drag it granted.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const snapTo = (toExpanded: boolean) => {
    expandedRef.current = toExpanded;
    setExpanded(toExpanded);
    Animated.spring(sheetOffset, {
      toValue: toExpanded ? 0 : collapsedOffset,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  };

  // Every opening starts at 55%, and a rotated or resized window re-measures.
  useEffect(() => {
    expandedRef.current = false;
    setExpanded(false);
    sheetOffset.setValue(collapsedOffset);
  }, [visible, collapsedOffset, sheetOffset]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Also from a tab: the tabs take a tap, a vertical pull is the sheet's.
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          dragStart.current = expandedRef.current ? 0 : collapsedOffset;
        },
        onPanResponderMove: (_, gesture) => {
          const next = Math.max(0, Math.min(collapsedOffset + collapsedHeight * 0.5, dragStart.current + gesture.dy));
          sheetOffset.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          const released = dragStart.current + gesture.dy;
          if (Math.abs(gesture.dy) < 6) {
            snapTo(!expandedRef.current);
          } else if (released > collapsedOffset + 90) {
            onCloseRef.current();
          } else {
            snapTo(released < collapsedOffset / 2);
          }
        },
        onPanResponderTerminate: () => snapTo(expandedRef.current),
      }),
    // snapTo and onClose go through refs and the animated value; the heights
    // are the only thing the gesture is rebuilt for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapsedHeight, collapsedOffset],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.veil}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.close')}
        />
        <Animated.View
          style={[
            styles.sheet,
            { height: expandedHeight, paddingBottom: bottomInset + 20, transform: [{ translateY: sheetOffset }] },
          ]}
        >
          {/* The pull zone is the whole top of the sheet — grip, name and tab
              row — not the grip alone, which had to be caught at its exact
              edge (#bugs 2026-09-30, "pitää tarkalleen yläreunasta ottaa
              kiinni"). */}
          <View {...pan.panHandlers} style={styles.dragArea}>
            <View
              accessible
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={t(language, expanded ? 'exerciseSheet.collapse' : 'exerciseSheet.expand')}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => snapTo(!expandedRef.current)}
            >
              <View style={styles.grip} />
              <Text style={styles.title} numberOfLines={2}>
                {exerciseName}
              </Text>
            </View>

            <View style={styles.tabs}>
              {tabs.map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === key }}
                  onPress={() => setTab(key)}
                  style={[styles.tab, tab === key && styles.tabActive]}
                >
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                    {t(language, `guided.sheet.tab.${key}` as 'guided.sheet.tab.learn')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Collapsed, the bottom of this 90% sheet is below the screen; the
              padding lets its last lines scroll up into view all the same. */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: expanded ? 0 : collapsedOffset }}
            showsVerticalScrollIndicator={false}
          >
            {tab === 'learn' && learn ? (
              <View style={{ gap: 16 }}>
                {learn.cues.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t(language, 'guided.sheet.cues')}</Text>
                    {learn.cues.map((cue, index) => (
                      <View key={index} style={styles.stepRow}>
                        <Text style={styles.stepIndex}>{index + 1}</Text>
                        <Text style={styles.stepText}>{cue}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* The self-audit from the Learn section, where it is useful
                    at the moment it is about: standing over the bar with the
                    set just done (user 2026-09-04). Not a score — the counter
                    names what is left and stops talking once nothing is. */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>{t(language, 'exDetail.check')}</Text>
                  <View style={styles.checkCard}>
                    {learn.check.map((statement, index) => {
                      const ticked = learn.checked.includes(index);
                      return (
                        <Pressable
                          key={index}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: ticked }}
                          accessibilityLabel={statement}
                          onPress={() => learn.onToggleStatement(index)}
                          style={styles.checkRow}
                        >
                          <View style={[styles.checkBox, ticked && styles.checkBoxOn]}>
                            {ticked ? (
                              <Text style={styles.checkTick}>✓</Text>
                            ) : null}
                          </View>
                          <Text style={[styles.checkText, ticked && styles.checkTextOn]}>{statement}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {learn.check.length - learn.checked.length > 0 ? (
                    <Text style={styles.empty}>
                      {t(language, 'exDetail.checkRemaining', {
                        count: learn.check.length - learn.checked.length,
                      })}
                    </Text>
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: learn.learned }}
                  onPress={learn.onToggleLearned}
                  style={[styles.learnedBtn, learn.learned && styles.learnedBtnOn]}
                >
                  <Text style={[styles.learnedText, learn.learned && styles.learnedTextOn]}>
                    {t(language, learn.learned ? 'exDetail.learned' : 'exDetail.markLearned')}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {tab === 'howTo' ? (
              <View style={{ gap: 14 }}>
                {/* The photo lives here now. It had a tab of its own whose
                    other half was these same instructions, three of them. */}
                <View style={styles.photo}>
                  {photoSource ? (
                    <Image source={photoSource} style={[StyleSheet.absoluteFill, FILL_SIZE]} resizeMode="cover" />
                  ) : (
                    <Text style={styles.photoInitials}>{initials}</Text>
                  )}
                </View>
                {instructions.length > 0 ? (
                  instructions.map((instruction, index) => (
                    <View key={index} style={styles.stepRow}>
                      <Text style={styles.stepIndex}>{index + 1}</Text>
                      <Text style={styles.stepText}>{instruction}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.empty}>{t(language, 'guided.sheet.noInstructions')}</Text>
                )}
                {watchFor.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>{t(language, 'guided.sheet.watchFor')}</Text>
                    <View style={styles.chips}>
                      {watchFor.map((item, index) => (
                        <View
                          key={index}
                          style={[
                            styles.chip,
                            item.flagged && { backgroundColor: theme.amberSoft, borderColor: theme.amberBorder },
                          ]}
                        >
                          <Text style={[styles.chipText, item.flagged && { color: theme.amberInk }]}>
                            {item.text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {tab === 'history' ? (
              <View style={{ gap: 16 }}>
                <View style={styles.statRow}>
                  <View style={styles.stat}>
                    <Text style={styles.sectionLabel}>{t(language, 'guided.sheet.bestSet')}</Text>
                    <Text style={styles.statValue}>{history.bestSetLabel ?? '—'}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.sectionLabel}>{t(language, 'guided.sheet.oneRepMax')}</Text>
                    <Text style={styles.statValue}>
                      {history.estimatedOneRepMaxKg
                        ? `${removeTrailingZeros(Math.round(history.estimatedOneRepMaxKg))} kg`
                        : '—'}
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.sectionLabel}>{t(language, 'guided.sheet.sessions')}</Text>
                    <Text style={styles.statValue}>{history.sessionCount}</Text>
                  </View>
                </View>

                {history.bars.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionLabel}>
                      {t(language, 'guided.sheet.topSets', { count: SHEET_HISTORY_SESSIONS })}
                    </Text>
                    <View style={styles.chart}>
                      {history.bars.map((bar, index) => (
                        <View key={index} style={styles.chartCol}>
                          <View
                            style={[
                              styles.chartBar,
                              {
                                height: `${Math.round(bar.ratio * 100)}%`,
                                backgroundColor: bar.isToday ? theme.highlight : theme.purpleLight,
                              },
                            ]}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {history.rows.length > 0 ? (
                  <View style={{ gap: 2 }}>
                    {history.rows.map((row) => (
                      <View key={row.key} style={styles.historyRow}>
                        <Text style={[styles.historyDate, row.isToday && { color: theme.highlight }]}>
                          {row.dateLabel}
                        </Text>
                        <Text style={styles.historyLoad}>{row.loadLabel ?? '—'}</Text>
                        <View style={styles.historyPills}>
                          {row.pills.map((pill, index) => (
                            <View key={index} style={styles.historyPill}>
                              <Text style={styles.historyPillText}>{pill}</Text>
                            </View>
                          ))}
                        </View>
                        {row.isPr ? (
                          <View style={styles.prPill}>
                            <Text style={styles.prPillText}>{t(language, 'guided.sheet.pr')}</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.empty}>{t(language, 'guided.sheet.noHistory')}</Text>
                )}
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  veil: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    /*
     * One height, not "as tall as this tab happens to be".
     *
     * The sheet used to size itself to its content, so switching from the
     * written steps to the history shrank it by two thirds and moved the tab
     * row down under the reader's finger — and the steps themselves ran off
     * the bottom rather than scrolling (user 2026-09-04). Fixed height, and
     * the body scrolls inside it.
     *
     * Lowered from 78% to 55% (user decision, 2026-09-26): 78% covered most
     * of the set screen behind it. Still a fixed fraction of the window, not
     * of the content, so the tab row still cannot jump — and the body still
     * scrolls inside it, so nothing at 55% is newly clipped, only reached
     * with one more scroll on a short tab like Learn.
     */
    // 90% of the window, set above, and slid down to show 55%.
  },
  dragArea: { paddingTop: 10, marginTop: -10, marginHorizontal: -20, paddingHorizontal: 20 },
  grip: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.border,
    marginBottom: 14,
  },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    backgroundColor: theme.surfaceSoft,
    borderRadius: 14,
    padding: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  tabActive: { backgroundColor: theme.surface },
  tabText: { fontSize: 13.5, fontWeight: '700', color: theme.muted },
  tabTextActive: { color: theme.ink, fontWeight: '800' },
  body: { flex: 1, marginTop: 16 },
  checkCard: {
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.purpleLight,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.6,
    borderColor: theme.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: theme.green, borderColor: theme.green },
  checkTick: { fontSize: 13, fontWeight: '800', color: theme.surface, lineHeight: 16 },
  checkText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: theme.ink, lineHeight: 20 },
  checkTextOn: { color: theme.muted },
  learnedBtn: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnedBtnOn: { backgroundColor: theme.green, borderColor: theme.green },
  learnedText: { fontSize: 15.5, fontWeight: '800', color: theme.ink },
  learnedTextOn: { color: theme.surface },
  photo: {
    // Bigger: the shape was right, the box was not (user 2026-09-04).
    height: 250,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: theme.purpleLight,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitials: { fontSize: 46, fontWeight: '800', color: theme.faint },
  sectionLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, color: theme.faint },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepIndex: {
    width: 20,
    fontSize: 13,
    fontWeight: '800',
    color: theme.faint,
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  stepText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: theme.ink, lineHeight: 21 },
  empty: { fontSize: 14, fontWeight: '600', color: theme.muted, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1.5,
    borderColor: theme.purpleLight,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12.5, fontWeight: '700', color: theme.ink },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.purpleLight,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  statValue: { fontSize: 15, fontWeight: '800', color: theme.ink, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 84 },
  /*
   * A fixed width, not `flex: 1`.
   *
   * Flexed, a single session's bar took the whole row and the whole height —
   * a solid block with no chart around it, which is what the history tab
   * showed to anyone who had trained a lift once (user 2026-09-04). Eight of
   * these still fit the sheet's width.
   */
  chartCol: { width: 30, height: '100%', justifyContent: 'flex-end' },
  chartBar: { borderRadius: 6, minHeight: 4 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.purpleLight,
  },
  historyDate: { width: 62, fontSize: 12.5, fontWeight: '700', color: theme.muted },
  historyLoad: {
    width: 66,
    fontSize: 14,
    fontWeight: '800',
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  historyPills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  historyPill: {
    minWidth: 24,
    alignItems: 'center',
    backgroundColor: theme.surfaceSoft,
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  historyPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  prPill: {
    backgroundColor: theme.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  prPillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: theme.greenInk },
});
