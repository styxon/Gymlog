import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { parseNumberInput, removeTrailingZeros } from '../lib/format';
import { t } from '../lib/i18n';
import { isValidTarget } from '../lib/strengthGoals';
import {
  estimateWeeksToTarget,
  ObservedRate,
  orderTargetLifts,
  TARGET_DELTAS_KG,
} from '../lib/strengthGoalPlan';
import { layout } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * Setting a target, in three steps: which lift, how much, and the week.
 *
 * This replaces a page of ready-made numbers — five lifts at three round
 * figures each. The round figures were the problem the brief names: 100 kg
 * means one thing to someone benching 95 and another to someone benching 60,
 * so a target here is the reader's own best plus something they can add, and
 * the time it would take is arithmetic on their own log.
 *
 * Nothing is created until the last step is accepted. The proposal is a real
 * programme from the catalog — the one that trains this lift and fits the
 * reader's week — copied into their own programmes so it can be edited
 * afterwards. It is not generated: a composer that invents a week has already
 * invented exercise names in this app once.
 */

export interface GoalFlowLift {
  /** The stored English library name — what a goal is keyed by. */
  exerciseName: string;
  /**
   * The target already set for this lift, if there is one.
   *
   * Setting a second one replaces the first — upsertStrengthGoal is keyed by
   * lift — so the row has to say so. The page this flow replaced showed the
   * target already set; a flow that overwrites in silence is worse than the
   * page it improved on.
   */
  targetKg: number | null;
  bestKg: number | null;
  rate: ObservedRate | null;
  lastLoggedAt: number | null;
  /** Days since the last logged session, for the row's "4 wks ago". */
  daysSinceLogged: number | null;
}

export interface GoalFlowProposalDay {
  sessionId: string;
  name: string;
  /** The first few lifts, already joined — the screen does not compose. */
  lead: string;
  trainsTarget: boolean;
}

export interface GoalFlowProposal {
  templateId: string;
  programmeName: string;
  daysPerWeek: number;
  minutes: number;
  blockWeeks: number;
  days: GoalFlowProposalDay[];
  /** How many of the week's days touch the target lift. */
  targetDays: number;
}

interface StrengthGoalFlowScreenProps {
  language?: AppLanguage;
  lifts: GoalFlowLift[];
  unitLabel: string;
  /** The programme that would be built, for the lift picked in step 1. */
  getProposal: (exerciseName: string) => GoalFlowProposal | null;
  onBack: () => void;
  /**
   * Accepting the proposal. The programme cap is the caller's business: full
   * on the free tier routes to the paywall from inside the adoption, and a
   * disabled button here would be this screen guessing at an answer it does
   * not have.
   */
  onCreate: (input: { exerciseName: string; targetKg: number; templateId: string | null }) => void;
}

function ChevronLeftIcon({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function CheckIcon({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12.5l5 5L20 6.5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * How long ago, at the scale the reader thinks in.
 *
 * A raw day count is accurate and unreadable: "240 days ago" makes someone
 * scanning ten rows do the conversion themselves. Days inside a fortnight,
 * weeks inside a quarter, months after that — the same ladder the question is
 * asked on.
 */
function describeRecency(language: AppLanguage, days: number | null): string {
  if (days === null || !Number.isFinite(days) || days < 0) {
    return '';
  }
  if (days <= 14) {
    return ` ${t(language, 'goalFlow.agoDays', { days })}`;
  }
  if (days <= 90) {
    return ` ${t(language, 'goalFlow.agoWeeks', { weeks: Math.round(days / 7) })}`;
  }
  return ` ${t(language, 'goalFlow.agoMonths', { months: Math.round(days / 30) })}`;
}

function FlowHead({
  step,
  title,
  sub,
  onBack,
  language,
}: {
  step: 1 | 2 | 3;
  title: string;
  /** Null draws no subtitle at all — see step 3. */
  sub: string | null;
  onBack: () => void;
  language: AppLanguage;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    <View style={styles.head}>
      <View style={styles.headRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.back')}
          onPress={onBack}
          hitSlop={8}
          style={styles.backButton}
        >
          <ChevronLeftIcon color={theme.ink} />
        </Pressable>
        <View style={styles.stepBars}>
          {[1, 2, 3].map((index) => (
            <View key={index} style={[styles.stepBar, index <= step && styles.stepBarOn]} />
          ))}
        </View>
        <Text style={styles.stepCount}>{t(language, 'goalFlow.step', { step, total: 3 })}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function StrengthGoalFlowScreen({
  language = 'en',
  lifts,
  unitLabel,
  getProposal,
  onBack,
  onCreate,
}: StrengthGoalFlowScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [delta, setDelta] = useState<number>(TARGET_DELTAS_KG[1]);
  /**
   * The typed weight, for a lift with no best to add to.
   *
   * The deltas are deltas: +10 on a 92.5 kg bench is a target, and +10 on
   * nothing is 10 kg, which is under the bar. A lift the reader has never
   * logged has no number to add to, so they say the number — the flow does not
   * invent a starting point to add to instead.
   */
  const [typedKg, setTypedKg] = useState('');

  /**
   * Picking a different lift starts its number over.
   *
   * The delta and the typed weight belong to the lift they were chosen for.
   * Kept, a reader who typed 140 for a front squat, went back, and picked the
   * upright row met a card whose subtitle was about the row and whose number
   * was about the squat.
   */
  function pickLift(exerciseName: string) {
    setPickedName(exerciseName);
    setDelta(TARGET_DELTAS_KG[1]);
    setTypedKg('');
  }

  /**
   * The footer sits above the keyboard, measured rather than inferred.
   *
   * Step 2's number field is the reason, and its whole point is to end in the
   * button underneath — which the keyboard covered outright: the window is
   * adjustResize, but RN 0.83's edge-to-edge Android does not resize for it,
   * and KeyboardAvoidingView's padding under-lifts there. The chat screen hit
   * exactly this on 2026-08-25 and solved it the same way; the event reports
   * the keyboard's real height, so the padding cannot be wrong by
   * construction.
   *
   * (It was first found on step 1, which had a search over the whole library
   * before the list became the ten lifts people actually put a number on. The
   * field is gone; the keyboard is not.)
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates?.height ?? 0),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  /*
   * A short list, so no search: a field over a list you can see all of is one
   * more thing to dismiss. The ones with a log still come first — that is what
   * the subtitle promises, and it is the order the question gets asked in.
   */
  const shown = useMemo(() => orderTargetLifts(lifts), [lifts]);

  const picked = pickedName ? (lifts.find((lift) => lift.exerciseName === pickedName) ?? null) : null;

  /**
   * Nothing logged means no best to add to. The flow still works — someone may
   * be aiming at a lift they are about to start — but the number is then the
   * delta itself, and the estimate says there is no rate rather than inventing
   * a starting point.
   */
  const bestKg = picked?.bestKg ?? null;
  // The shared parser, like every other number field: parseFloat read
  // '100,5,5' as 100.5 and '80-' as 80. And the sum is rounded to what a
  // weight is written to: a best imported in pounds (61.23) plus 10 showed
  // and stored 71.22999999999999 (decimal audit, 2026-09-21).
  const typedTargetKg = parseNumberInput(typedKg) ?? Number.NaN;
  const targetKg = bestKg === null ? typedTargetKg : Number((bestKg + delta).toFixed(2));
  /*
   * The same ceiling on both branches. It guarded only the typed number, and
   * a delta on a logged best can pass it too: a mistyped 999 kg in the log
   * plus 30 is 1029, which the flow accepted, adopted a programme for, and
   * stored — and which normalizeStrengthGoals then dropped on the next
   * launch. A target that vanishes overnight is worse than one refused now.
   */
  const targetUsable = isValidTarget(targetKg);
  const estimate = estimateWeeksToTarget(bestKg ?? 0, targetUsable ? targetKg : 0, picked?.rate ?? null);
  /*
   * Only where it is shown. Called unconditionally it ran rankProgrammesForLift
   * over all 57 templates on every render of steps 1 and 2 — once per character
   * typed into the number field — for a card only step 3 draws.
   */
  const proposal = step === 3 && picked ? getProposal(picked.exerciseName) : null;

  function goBack() {
    if (step === 1) {
      onBack();
      return;
    }
    setStep(step === 3 ? 2 : 1);
  }

  // Steps 2 and 3 are about a lift, so they are only entered with one. This
  // used to be a `setStep(1)` in the render body relying on React's
  // render-phase update to converge, which is an infinite loop the day it
  // stops converging.
  if (step === 1 || !picked) {
    return (
      <View style={styles.screen}>
        <FlowHead
          step={1}
          language={language}
          onBack={goBack}
          title={t(language, 'goalFlow.step1.title')}
          sub={t(language, 'goalFlow.step1.sub')}
        />
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={shown}
          keyExtractor={(lift) => lift.exerciseName}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          renderItem={({ item }) => {
            const on = item.exerciseName === pickedName;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => pickLift(item.exerciseName)}
                style={({ pressed }) => [styles.liftRow, on && styles.liftRowOn, pressed && styles.pressed]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.liftName} numberOfLines={1}>
                    {exerciseNameLabel(language, item.exerciseName)}
                  </Text>
                  <Text style={[styles.liftMeta, item.bestKg === null && styles.liftMetaFaint]}>
                    {item.bestKg === null
                      ? t(language, 'goalFlow.neverLogged')
                      : t(language, 'goalFlow.yourBest', {
                          kg: removeTrailingZeros(item.bestKg),
                          unit: unitLabel,
                          ago: describeRecency(language, item.daysSinceLogged),
                        })}
                  </Text>
                  {item.targetKg !== null ? (
                    <Text style={styles.liftTarget}>
                      {t(language, 'goalFlow.alreadyAiming', {
                        kg: removeTrailingZeros(item.targetKg),
                        unit: unitLabel,
                      })}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <CheckIcon color="#FFFFFF" /> : null}
                </View>
              </Pressable>
            );
          }}
        />
        <View style={styles.footer}>
          {picked ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setStep(2)}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              {/* Just "Jatka". The lift is ticked one row up, so naming it
                  again made a button that changes width with the selection and
                  wraps on the long names (#bugs 2026-09-05). */}
              <Text style={styles.ctaText}>{t(language, 'goalFlow.continue')}</Text>
            </Pressable>
          ) : (
            <View style={styles.ctaIdle}>
              <Text style={styles.ctaIdleText}>{t(language, 'goalFlow.pickOne')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (step === 2) {
    return (
      <View style={styles.screen}>
        <FlowHead
          step={2}
          language={language}
          onBack={goBack}
          title={t(language, 'goalFlow.step2.title')}
          sub={
            bestKg === null
              ? t(language, 'goalFlow.step2.subUnlogged', {
                  name: exerciseNameLabel(language, picked.exerciseName),
                })
              : t(language, 'goalFlow.step2.sub', {
                  name: exerciseNameLabel(language, picked.exerciseName),
                  kg: removeTrailingZeros(bestKg),
                  unit: unitLabel,
                })
          }
        />
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.numberCard}>
            {bestKg === null ? (
              <>
                {/* Typed, not stepped. There is no best to add a delta to, and
                    +10 on nothing is 10 kg — under the bar on most lifts. */}
                <View style={styles.numberLine}>
                  <TextInput
                    value={typedKg}
                    onChangeText={setTypedKg}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.faint}
                    style={styles.numberInput}
                    accessibilityLabel={t(language, 'goalFlow.typeTarget')}
                  />
                  <Text style={styles.numberUnit}>{unitLabel}</Text>
                </View>
                <Text style={styles.numberDelta}>{t(language, 'goalFlow.typeTarget')}</Text>
              </>
            ) : (
              <>
                <View style={styles.numberLine}>
                  <Text style={styles.number}>{removeTrailingZeros(targetKg)}</Text>
                  <Text style={styles.numberUnit}>{unitLabel}</Text>
                </View>
                <Text style={styles.numberDelta}>
                  {t(language, 'goalFlow.deltaOnBest', { kg: removeTrailingZeros(delta), unit: unitLabel })}
                </Text>
                <View style={styles.deltaRow}>
                  {TARGET_DELTAS_KG.map((option) => {
                    const on = option === delta;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => setDelta(option)}
                        style={[styles.deltaChip, on && styles.deltaChipOn]}
                      >
                        <Text style={[styles.deltaChipText, on && styles.deltaChipTextOn]}>+{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </View>

          {/* The estimate, or the reason there is not one. Every branch is a
              sentence rather than a blank, because "no rate yet" and "no gain"
              are different things to tell someone.

              Not until there is a target to estimate against, though: with the
              field still empty the target is zero, and zero reads back as
              "you are already there" over a weight nobody has named. */}
          {targetUsable ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>
              {estimate.kind === 'weeks'
                ? estimate.weeks === 1
                  ? t(language, 'goalFlow.weeksAtRateOne')
                  : t(language, 'goalFlow.weeksAtRate', { weeks: estimate.weeks })
                : t(language, `goalFlow.estimate.${estimate.kind}` as 'goalFlow.estimate.noRate')}
            </Text>
            <Text style={styles.noteBody}>
              {estimate.kind === 'weeks' || estimate.kind === 'noGain' || estimate.kind === 'beyondHorizon'
                ? t(language, Math.round(estimate.rate.spanWeeks) === 1 ? 'goalFlow.rateBodyOne' : 'goalFlow.rateBody', {
                    kg: removeTrailingZeros(Math.round(estimate.rate.gainKg * 10) / 10),
                    weeks: Math.round(estimate.rate.spanWeeks),
                    sessions: estimate.rate.sessions,
                    unit: unitLabel,
                  })
                : t(language, 'goalFlow.rateBodyNone')}
            </Text>
          </View>
          ) : null}

        </ScrollView>
        <View
          style={[styles.footer, keyboardHeight > 0 && { paddingBottom: keyboardHeight + 12 }]}
        >
          <Pressable
            accessibilityRole="button"
            disabled={!targetUsable}
            onPress={() => setStep(3)}
            style={({ pressed }) => [
              styles.cta,
              !targetUsable && styles.ctaDisabled,
              pressed && targetUsable && styles.pressed,
            ]}
          >
            <Text style={[styles.ctaText, !targetUsable && styles.ctaTextDisabled]}>
              {targetUsable ? t(language, 'goalFlow.buildWeeks') : t(language, 'goalFlow.typeTarget')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlowHead
        step={3}
        language={language}
        onBack={goBack}
        title={t(language, 'goalFlow.step3.title')}
        /* No subtitle when there IS a proposal: it restated the card directly
           underneath — weeks, days a week, how many touch the lift — and the
           card says all three in bigger type. The empty case keeps its line,
           because there is nothing below it to read instead. */
        sub={
          proposal
            ? null
            : t(language, 'goalFlow.step3.subNone', {
                name: exerciseNameLabel(language, picked.exerciseName),
              })
        }
      />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {proposal ? (
          <>
            <View style={styles.proposalCard}>
              <Text style={styles.proposalEyebrow}>{t(language, 'goalFlow.proposed')}</Text>
              <Text style={styles.proposalName}>{proposal.programmeName}</Text>
              <Text style={styles.proposalTowards}>
                {/* The lift's name is the page's subject and was in the line
                    above; repeating it inside the target read as a sentence
                    with the noun stuck in the middle (#bugs 2026-09-05). */}
                {t(language, 'goalFlow.towards', {
                  kg: removeTrailingZeros(targetKg),
                  unit: unitLabel,
                })}
              </Text>
              <View style={styles.statRow}>
                {[
                  [t(language, 'programs.weeksShort', { count: proposal.blockWeeks }), t(language, 'goalFlow.stat.length')],
                  [t(language, 'goalFlow.perWeek', { days: proposal.daysPerWeek }), t(language, 'goalFlow.stat.days')],
                  [`~${proposal.minutes} min`, t(language, 'goalFlow.stat.session')],
                ].map(([value, label]) => (
                  <View key={label}>
                    <Text style={styles.statValue}>{value}</Text>
                    <Text style={styles.statLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Text style={styles.weekEyebrow}>{t(language, 'goalFlow.weekOne')}</Text>
            <View style={{ gap: 9 }}>
              {proposal.days.map((day) => (
                <View key={day.sessionId} style={styles.dayRow}>
                  <View style={styles.dayHead}>
                    <Text style={styles.dayName} numberOfLines={1}>
                      {day.name}
                    </Text>
                    {day.trainsTarget ? (
                      <View style={styles.targetTag}>
                        <Text style={styles.targetTagText}>{t(language, 'goalFlow.targetLift')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.dayLead} numberOfLines={2}>
                    {day.lead}
                  </Text>
                </View>
              ))}
            </View>

          </>
        ) : (
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>{t(language, 'goalFlow.noProgramme')}</Text>
            <Text style={styles.noteBody}>{t(language, 'goalFlow.noProgrammeBody')}</Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        {/* Two ways out, because a target and a programme are two decisions.
            The flow used to make them one: the only button changed the whole
            week, and a reader who wanted a number to aim at had to accept a
            new programme to get it — "en aina halua etta se vaikuttaa koko
            ohjelmaan, voisi olla myos vain normaali tavoite" (2026-09-07).

            It also could not be finished at all when the catalog had no
            programme for the lift: the note said so and the only button was
            disabled, so the answer to "nothing trains this" was that you may
            not set the target either. */}
        {proposal ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onCreate({
                exerciseName: picked.exerciseName,
                targetKg,
                templateId: proposal.templateId,
              })
            }
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <Text style={styles.ctaText}>{t(language, 'goalFlow.create')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onCreate({ exerciseName: picked.exerciseName, targetKg, templateId: null })
          }
          style={({ pressed }) => [
            proposal ? styles.ctaQuiet : styles.cta,
            pressed && styles.pressed,
          ]}
        >
          <Text style={proposal ? styles.ctaQuietText : styles.ctaText}>
            {t(language, 'goalFlow.goalOnly')}
          </Text>
        </Pressable>
        <Text style={styles.ctaHint}>{t(language, 'goalFlow.goalOnlyHint')}</Text>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    head: {
      paddingHorizontal: 20,
      paddingTop: 52,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    backButton: {
      width: 34,
      height: 34,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBars: {
      flex: 1,
      flexDirection: 'row',
      gap: 5,
    },
    stepBar: {
      flex: 1,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.border,
    },
    stepBarOn: {
      backgroundColor: theme.purple,
    },
    stepCount: {
      color: theme.faint,
      fontSize: 11.5,
      fontWeight: '800',
    },
    title: {
      color: theme.ink,
      fontSize: 25,
      lineHeight: 29,
      fontWeight: '800',
      letterSpacing: -0.6,
      marginTop: 18,
    },
    sub: {
      color: theme.muted,
      fontSize: 13.5,
      lineHeight: 20,
      fontWeight: '600',
      marginTop: 8,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 20,
    },
    rowGap: {
      height: 9,
    },
    liftRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 15,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    liftRowOn: {
      borderColor: theme.purple,
      backgroundColor: theme.surfaceSoft,
    },
    pressed: {
      opacity: 0.7,
    },
    liftName: {
      color: theme.ink,
      fontSize: 15.5,
      lineHeight: 20,
      fontWeight: '800',
    },
    liftTarget: {
      color: theme.purple,
      fontSize: 11.5,
      lineHeight: 15,
      fontWeight: '800',
      marginTop: 3,
    },
    liftMeta: {
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 17,
      fontWeight: '700',
      marginTop: 3,
    },
    liftMetaFaint: {
      color: theme.faint,
    },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 999,
      borderWidth: 1.6,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: {
      borderWidth: 0,
      backgroundColor: theme.purple,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      /*
       * The BAR's height, not the scroll reserve. `bottomTabBarReserve` is 88
       * plus a section of air, and its own comment says why: "scrolling
       * content clears the bar with a section's air; a fixed foot does not."
       * This foot is fixed, so the extra 32 was a gap under the button on all
       * three steps — "laske alla olevaa nappia vähän" (#bugs 2026-09-05).
       */
      paddingBottom: layout.bottomTabBarHeight,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.bg,
    },
    cta: {
      height: 54,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.highlight,
    },
    ctaDisabled: {
      backgroundColor: theme.surface,
    },
    // The second way out. Quiet, because setting only the target is the
    // smaller of the two decisions, not the lesser one.
    ctaQuiet: {
      height: 54,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    ctaQuietText: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '800',
    },
    ctaHint: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    ctaText: {
      color: theme.onHighlight,
      fontSize: 15,
      fontWeight: '800',
    },
    ctaTextDisabled: {
      color: theme.faint,
    },
    ctaIdle: {
      height: 54,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    ctaIdleText: {
      color: theme.faint,
      fontSize: 15,
      fontWeight: '800',
    },
    numberCard: {
      alignItems: 'center',
      padding: 22,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
    },
    numberLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
    },
    numberInput: {
      minWidth: 120,
      textAlign: 'center',
      color: theme.ink,
      fontSize: 58,
      lineHeight: 66,
      fontWeight: '800',
      letterSpacing: -2,
      paddingVertical: 0,
    },
    number: {
      color: theme.ink,
      fontSize: 58,
      lineHeight: 62,
      fontWeight: '800',
      letterSpacing: -2,
    },
    numberUnit: {
      color: theme.muted,
      fontSize: 20,
      fontWeight: '800',
    },
    numberDelta: {
      color: theme.purple,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 8,
    },
    deltaRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 20,
      alignSelf: 'stretch',
    },
    deltaChip: {
      flex: 1,
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deltaChipOn: {
      borderColor: theme.highlight,
      backgroundColor: theme.highlight,
    },
    deltaChipText: {
      color: theme.muted,
      fontSize: 14.5,
      fontWeight: '800',
    },
    deltaChipTextOn: {
      color: theme.onHighlight,
    },
    noteCard: {
      marginTop: 16,
      padding: 16,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    noteTitle: {
      color: theme.ink,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '800',
    },
    noteBody: {
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 19,
      fontWeight: '600',
      marginTop: 3,
    },
    proposalCard: {
      padding: 18,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
    },
    proposalEyebrow: {
      color: theme.purple,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    proposalName: {
      color: theme.ink,
      fontSize: 19.5,
      lineHeight: 24,
      fontWeight: '800',
      letterSpacing: -0.3,
      marginTop: 5,
    },
    proposalTowards: {
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 17,
      fontWeight: '700',
      marginTop: 3,
    },
    statRow: {
      flexDirection: 'row',
      gap: 20,
      marginTop: 14,
    },
    statValue: {
      color: theme.ink,
      fontSize: 16.5,
      lineHeight: 21,
      fontWeight: '800',
    },
    statLabel: {
      color: theme.faint,
      fontSize: 10,
      lineHeight: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginTop: 2,
    },
    weekEyebrow: {
      color: theme.faint,
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 1.2,
      marginTop: 22,
      marginBottom: 11,
    },
    dayRow: {
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    dayHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    dayName: {
      flex: 1,
      minWidth: 0,
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    targetTag: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.surfaceSoft,
    },
    targetTagText: {
      color: theme.purple,
      fontSize: 9,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    dayLead: {
      color: theme.muted,
      fontSize: 12.5,
      lineHeight: 18,
      fontWeight: '600',
      marginTop: 5,
    },
  });
