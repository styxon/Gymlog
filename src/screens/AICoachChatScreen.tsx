import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { CoachReadoutTicker } from '../components/CoachReadoutTicker';
import { CoachReportSheet } from '../components/CoachReportSheet';
import { ProgrammeProposalCard } from '../components/ProgrammeProposalCard';
import { ProLockedCard } from '../components/ProLockedCard';
import { reportAiCoachAnswer, requestAiCoachAdvice } from '../lib/aiCoachClient';
import { COACH_COPIES_KEPT } from '../lib/aiCoachLogId';
import { CoachReportReason } from '../lib/coachAnswerReport';
import { trackEvent } from '../features/analytics/analyticsClient';
import { buildAiCoachPreviewAnswer } from '../lib/aiCoachPreview';
import { classifyCoachScope } from '../lib/aiCoachScope';
import { PRO_COACH_QUESTIONS_PER_MONTH, coachQuotaReset } from '../lib/aiCoachQuota';
import { AI_COACH_MAX_PROMPT_CHARS } from '../lib/aiCoachBudget';
import { fitAiCoachContextToCap } from '../lib/aiTrainingContext';
import { formatShortDate } from '../lib/format';
import { CoachChatIntroInput, CoachContextChip, buildCoachContextChips, buildCoachContextReadout, buildCoachNoticed, buildCoachOpeningLine, buildCoachOpeningOffer, buildCoachOpeningRows } from '../lib/coachChat';
import { coachSmallTalkReplyKey, parseCoachSmallTalk } from '../lib/coachSmallTalk';
import { appendCoachTurn } from '../lib/coachConversation';
import { CoachChatMemory, resumeCoachChat } from '../lib/coachChatMemory';
import { CoachSuggestionKind } from '../lib/coachSuggestions';
import { MEASUREMENT_LABEL_KEYS } from '../lib/homeStatCards';
import { I18nKey, t } from '../lib/i18n';
import { MeasurementIntent, isMeasurementIntentKind, parseMeasurementIntent } from '../lib/measurementIntent';
import { GoalIntent, parseGoalIntent } from '../lib/goalIntent';
// Deterministic: asking the coach to name a programme gets programmes that do
// not exist; a scorer over the real catalog cannot.
import { matchProgrammeToBrief, shouldOfferCatalogInstead } from '../lib/briefProgrammeMatch';
import {
  ProgrammeProposal,
  hasProgrammeBriefOutline,
  outlineProgrammeBrief,
  parseProgrammeBrief,
} from '../lib/programmeBrief';
import {
  PROGRAM_INTAKE_EXTRA_MAX_CHARS,
  PROGRAM_INTAKE_QUESTION_KEYS,
  ProgramIntakeAnswers,
  ProgramIntakePreferences,
  ProgramIntakeState,
  answerProgramIntake,
  buildProgramIntakeBrief,
  buildProgramIntakeFrame,
  currentProgramIntakeStep,
  editProgramIntake,
  programIntakeAnswerText,
  programIntakeOptions,
  programIntakePresetValue,
  startProgramIntake,
} from '../lib/programIntake';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { getFocusAreaLabel } from '../lib/focusAreaPresentation';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { PW } from '../lightTheme';
import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { layout, radii, spacing } from '../theme';
import { AICoachAdvice, AICoachConversationTurn, AICoachTrainingContext } from '../types/aiCoach';
import { AppLanguage } from '../types/models';

/**
 * The AI tab (design: Vinha AI Tab).
 *
 * The middle button used to open a paywall-shaped sheet: the app's most
 * valuable placement spent on an advert, which teaches a user to stop pressing
 * it. The design's rule is the opposite and this screen implements it — THE
 * DOOR IS ALWAYS OPEN. Free users get the same chat, the same data and full
 * answers; the quota runs out, not the quality. Pro adds initiative: the coach
 * speaks first with what it noticed.
 *
 * The opening state (context strip, first line, the noticed card) is entirely
 * deterministic — see coachChat.ts. It costs nothing and it proves the coach
 * read the log before the user typed anything.
 */
interface AICoachChatScreenProps {
  language?: AppLanguage;
  proUnlocked: boolean;
  /**
   * Online mode: questions leave the device. The privacy policy promises the
   * reader is told in the app before that happens, so while this is true
   * and the notice is unacknowledged, the chat shows the disclosure and
   * sends nothing.
   */
  liveConfigured: boolean;
  onlineNoticeAcknowledged: boolean;
  onAcknowledgeOnlineNotice: () => void;
  /**
   * What the reader has allowed the server to KEEP, and the setter for it.
   *
   * Separate from the notice above it: the notice is what the online coach
   * unavoidably does, these are three optional yeses that change nothing about
   * the answer the reader gets. All start false and each is its own decision.
   */
  logConsent: { chat: boolean; composer: boolean; photo: boolean };
  onChangeLogConsent: (next: Partial<{ chat: boolean; composer: boolean; photo: boolean }>) => void;
  /** The label the kept copies are filed under, or null before the first yes. */
  logId: string | null;
  /** Questions left in this month. Meaningful only while proUnlocked. */
  questionsRemaining: number;
  onQuestionUsed: () => void;
  /**
   * A question the app is asking on the reader’s behalf, arriving from a
   * coach demo moment. It is sent once, for real, and bypasses the quota:
   * that is the whole point of the three moments a free reader gets.
   */
  demoQuestion?: string | null;
  /** Which of the three it is. Held here because the route is cleared on send. */
  demoMomentKey?: string | null;
  /** Dispatched. Clears the hand-off; it does NOT mean an answer arrived. */
  onDemoQuestionSent?: () => void;
  /**
   * An answer came back from the real model. THIS is what spends the moment.
   *
   * There are three per install and nothing ever returns one, so the thing
   * that consumes one has to be the thing the reader was promised. A send
   * that leaves is not it: the phone can be offline — this app is built to
   * work that way — and the endpoint can fall back to its canned preview
   * reply, which is the same deterministic text a free reader already gets
   * for nothing.
   */
  onDemoQuestionAnswered?: (key: string) => void;
  /**
   * Why the chat was opened, when it was opened for something. 'new_program'
   * comes from the new-programme sheet: the coach asks the frame of the week
   * before anything else. Carried on the route like the demo question, and
   * cleared the same way once taken (onIntentConsumed).
   */
  intent?: 'new_program' | null;
  onIntentConsumed?: () => void;
  /** What the app already knows, preselected in the frame questions. */
  intakePreferences: ProgramIntakePreferences;
  trainingContext: AICoachTrainingContext;
  intro: CoachChatIntroInput;
  /** Total logged sessions, for the header line and the evidence footer. */
  sessionCount: number;
  quickAskKeys: I18nKey[];
  /**
   * The most recent session, for the written-analysis entry. That entry used
   * to live only in the coach sheet this screen replaces, and the Pro page's
   * table promises it — so it moves here rather than disappearing.
   */
  lastSession: { id: string; name: string } | null;
  onOpenAnalysis: (sessionId: string) => void;
  onOpenPremium: () => void;
  /**
   * "Rinnanympärys on 90 cm" typed into the chat is a reading to log, not a
   * question (user, 2026-08-23). The chat offers to log it — one tap — and,
   * if that measurement has no card on Home yet, offers the card once.
   * Nothing is written without the tap.
   */
  pinnedStatCardKeys: string[];
  onLogMeasurement: (intent: MeasurementIntent) => Promise<void>;
  onPinStatCard: (key: string) => void;
  /** "Yritän kasvattaa rinnanympärystä" stated in chat becomes a saved goal — offered, never assumed. */
  onSetGoal: (intent: GoalIntent) => Promise<void>;
  /**
   * How a coach-proposed offer ended. A refusal buys a month of silence and a
   * second one ends that kind of offer for good, so it has to be recorded
   * whichever way the reader answered.
   */
  onCoachSuggestionResolved: (kind: CoachSuggestionKind, accepted: boolean) => void;
  /** Whether the morning weigh-in nudge is already on, so it is never offered twice. */
  weighInReminderEnabled: boolean;
  /**
   * Turns the nudge on, permission first. Resolves 'on' once the write has
   * landed, 'blocked' when the phone refuses notifications (nothing stored),
   * and rejects when the write fails.
   */
  onEnableWeighInReminder: () => Promise<'on' | 'blocked'>;
  /** Opens the measures page on one measurement, so a question can be answered with a tap. */
  onOpenMeasure: (kind: string) => void;
  /**
   * Compose a week from the brief and hand it back, so it can be read here.
   *
   * It used to navigate to the composer screen. The week is drawn in the
   * conversation now — see ChatMessage.proposal for why that is the point
   * rather than a shortcut.
   */
  onComposeProgramme: (brief: string, signal?: AbortSignal) => Promise<ProgrammeProposal | null>;
  /** Saves a proposal as a programme of the reader's own. */
  onSaveProgramme: (proposal: ProgrammeProposal) => Promise<void>;
  /**
   * Opens a catalog programme's own page, where it can be read and taken on.
   *
   * Browsing and running the catalog is free, so this path has no Pro gate —
   * which means a free reader who asks for five days gets a real answer rather
   * than a paywall.
   */
  onOpenProgramme: (programId: string) => void;
  /**
   * The thread as it stood when this screen was last open, or null to start a
   * new one.
   *
   * The conversation lives above this screen because this screen unmounts:
   * the coach's best answers end in "katso tämä treeni", and following that
   * used to throw away the brief that earned it. See lib/coachChatMemory.
   */
  memory: CoachChatMemory<ChatMessage> | null;
  onMemoryChange: (memory: CoachChatMemory<ChatMessage>) => void;
  /**
   * One answer's takeaway, for the memory that outlives this thread — see
   * lib/coachAdviceMemory. Called only for answers that reached the model:
   * remembering the offline preview text would teach the coach it had already
   * said something it never said.
   */
  onAdviceGiven?: (takeaway: string) => void;
}

export interface ChatMessage {
  id: string;
  fromCoach: boolean;
  text: string;
  /** The coach's structured answer, rendered as sections rather than prose. */
  advice?: AICoachAdvice;
  /**
   * Written by the model, not the canned offline text — the answers Play's
   * AI-generated content policy says a reader must be able to report.
   */
  generated?: boolean;
  /**
   * Set once a report of this answer has arrived. On the message rather than
   * in the screen's state, so the mark survives the thread being resumed from
   * memory when the tab is opened again.
   */
  reported?: boolean;
  /** An offer with buttons: log the reading, put its card on Home, or save the stated goal. */
  offer?:
    | { type: 'log'; intent: MeasurementIntent }
    // Only the kind is ever read, and a coach-proposed card has no reading
    // behind it — asking for a value here would mean inventing one.
    | { type: 'pin'; intent: Pick<MeasurementIntent, 'kind'> }
    | { type: 'goal'; intent: GoalIntent }
    // Nothing to carry: the offer is the switch itself.
    | { type: 'weighIn' }
    // Opens the page that records this measurement. The coach cannot log one
    // itself — the reading is the thing it does not have.
    | { type: 'openMeasure'; intent: Pick<MeasurementIntent, 'kind'> }
    // The conversation, handed to the composer. Asked for a programme, the
    // coach used to gather the days, the focus and the cautions across five
    // turns and then answer "I cannot build one" — throwing away exactly the
    // brief the composer takes (log 2026-08-26).
    //
    // `frame` is set when the brief came from the frame questions: the
    // answers on one line, said instead of the outline, since the reader has
    // just given every one of them by tap.
    | { type: 'compose'; brief: string; frame?: string; answers?: ProgramIntakeAnswers };
  /**
   * A frame question still open, with the answers so far. In the thread
   * rather than in screen state so it is kept with it: leaving mid-way and
   * coming back finds the same question waiting. Local — it never reaches
   * the model and costs no question.
   */
  intake?: ProgramIntakeState;
  /**
   * Set when the coach proposed this rather than the typed message. Only those
   * count towards the cooldown: it exists to stop the coach nagging.
   */
  suggestionKind?: CoachSuggestionKind;
  evidence?: string;
  /** Set when the answer is withheld: the real conclusion, blurred. */
  lockedBody?: string;
  /**
   * A composed week, in the conversation that asked for it.
   *
   * The button used to hand the brief to the composer screen and navigate
   * away, which saved a step but ended the conversation. The point of drawing
   * it here is not the step: it is that the reader can answer it — "tee siitä
   * 5-päiväinen", "vaihda maastaveto pois" — and the coach can offer a revised
   * brief in the same thread. That is the thing the composer screen cannot do.
   */
  proposal?: ProgrammeProposal;
  /**
   * A catalog programme that answers the brief better than a composed week
   * would.
   *
   * The composer only has splits for one to four days, so "5 päivää" came back
   * as four with a note explaining the trim — while fourteen designed five- and
   * six-day programmes sat in the catalog (user 2026-08-26, "eikö aichat voi
   * vain ottaa lähimpää ohjelmaa mikä vastaa käyttäjän puheita?").
   */
  catalog?: { programId: string; title: string; daysPerWeek: number };
}

/** Width of the soft light behind the dark thread's header. */
const TOP_LIGHT = 460;

/**
 * A catalog programme's display name, or null when the id resolves to nothing.
 *
 * Null rather than the raw id: a chat message reading "tpl_5_day_ppl_v1" is
 * worse than the composed week it replaced.
 */
function catalogProgrammeTitle(programId: string): string | null {
  const name = getWorkoutTemplateById(programId)?.name;
  return name ? formatWorkoutDisplayLabel(name) : null;
}

/** The word on each offer's accept button, keyed by what the offer does. */
const OFFER_CTA_KEYS: Record<NonNullable<ChatMessage['offer']>['type'], I18nKey> = {
  openMeasure: 'coachChat.measure.open',
  weighIn: 'coachChat.weighIn.on',
  goal: 'coachChat.goal.set',
  log: 'coachChat.measure.log',
  pin: 'coachChat.measure.pin',
  compose: 'coachChat.compose.build',
};

function SparkGlyph({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" fill={color} />
    </Svg>
  );
}

export function AICoachChatScreen({
  language = 'en',
  proUnlocked,
  liveConfigured,
  onlineNoticeAcknowledged,
  onAcknowledgeOnlineNotice,
  logConsent,
  onChangeLogConsent,
  logId,
  questionsRemaining,
  onQuestionUsed,
  demoQuestion = null,
  demoMomentKey = null,
  onDemoQuestionSent,
  onDemoQuestionAnswered,
  intent = null,
  onIntentConsumed,
  intakePreferences,
  trainingContext,
  intro,
  sessionCount,
  quickAskKeys,
  lastSession,
  onOpenAnalysis,
  onOpenPremium,
  pinnedStatCardKeys,
  onLogMeasurement,
  onPinStatCard,
  onSetGoal,
  onCoachSuggestionResolved,
  weighInReminderEnabled,
  onEnableWeighInReminder,
  onOpenMeasure,
  onComposeProgramme,
  onSaveProgramme,
  onOpenProgramme,
  memory,
  onMemoryChange,
  onAdviceGiven,
}: AICoachChatScreenProps) {
  const theme = useTheme();
  const themeName = useThemeName();
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = useState('');
  /**
   * Reopened rather than restarted. The check runs once, on mount: a thread
   * that was live when the reader tapped through to a workout is still live
   * when they come back, and one from this morning is not.
   */
  const resumed = useRef(resumeCoachChat(memory, new Date().toISOString())).current;
  const [messages, setMessages] = useState<ChatMessage[]>(resumed?.messages ?? []);
  const [asking, setAsking] = useState(false);
  // The answer whose report sheet is open.
  const [reportingId, setReportingId] = useState<string | null>(null);
  const sheetInsets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const askToken = useRef(0);
  /**
   * The open conversation, in a ref rather than state: `send` must read the
   * exchanges as they are at the moment of sending, and a state value captured
   * in its dependency list would be one turn behind.
   */
  const conversation = useRef<AICoachConversationTurn[]>(resumed?.turns ?? []);
  /**
   * The coach's long memory as it stood when this thread opened, pinned.
   *
   * The endpoint puts a cache breakpoint on the training context (see the
   * `system` array in api/ai-coach.ts), and a same-conversation follow-up is
   * only cheap because it reads that entry back. Letting the answer just given
   * into the context would change those bytes on every turn, so every
   * follow-up would rewrite the whole prefix instead of reading it — the
   * expensive half of the request, paid again for one added line.
   *
   * Nothing is lost by pinning: what the coach said a moment ago is already in
   * `conversation` below, which is what an open conversation is for. This
   * memory exists for the questions that come days later.
   */
  const pinnedCoachMemory = useRef(trainingContext.coachMemory ?? []).current;
  /**
   * The context as it is sent: everything the app knows now, with the memory
   * held still. Rebuilt only when the rest of the context changes.
   */
  const sentTrainingContext = useMemo(
    // Fitted again: the pinned memory goes back into a context that may have
    // been fitted without it, and the endpoint refuses one over its cap.
    () => fitAiCoachContextToCap({ ...trainingContext, coachMemory: pinnedCoachMemory }),
    [trainingContext, pinnedCoachMemory],
  );

  /**
   * Publish the thread upward whenever it changes.
   *
   * The messages are the trigger and the model history rides along: every
   * write to conversation.current happens in the same turn as a setMessages,
   * so watching one carries both. Skipped while the thread is empty, so
   * opening the screen and leaving it does not stamp a new session over the
   * one that just expired.
   */
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    onMemoryChange({
      lastActiveAt: new Date().toISOString(),
      messages,
      turns: conversation.current,
    });
  }, [messages, onMemoryChange]);

  /**
   * Leaving while an answer is on its way.
   *
   * The request ran on after the screen unmounted: the answer still charged
   * the question (Pro quota, or one of the free reader's three demo answers)
   * and reported the advice, but it had no screen to land on — the reader
   * came back to their question with nothing under it. The request is
   * cancelled now, nothing is charged for it, and the question comes out of
   * the kept thread so it can simply be asked again.
   */
  const pendingAskRef = useRef<{ token: number; controller: AbortController } | null>(null);
  /**
   * Which offers are being built, held outside the thread.
   *
   * A compose used to swap the offer message for a "Rakennan viikkoa…" one.
   * The thread is published upward on every change, so that placeholder went
   * into the kept conversation — and leaving mid-build left it there forever,
   * with the offer it replaced gone and nothing that could resolve it.
   *
   * So the offer stays in `messages` for the whole build and the building
   * line is drawn from this instead. Nothing has to be put back on the way
   * out: what was published was never wrong. It is a list rather than one
   * value because a thread can hold two compose offers, the same reason
   * `savingProposalId` is kept per message (audit 3, 2026-09-19).
   */
  const [composingIds, setComposingIds] = useState<readonly string[]>([]);
  /**
   * The builds themselves, so leaving cancels them.
   *
   * A composition is a live call and it is billed whether or not anything
   * reads the answer. The ask beside it has held an AbortController since it
   * was written — "nothing is charged for it" — and this one walked away
   * leaving the request to finish into nothing, then offered the reader the
   * same build again on their return (audit 3, 2026-09-19).
   */
  const composeControllersRef = useRef(new Map<string, AbortController>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onMemoryChangeRef = useRef(onMemoryChange);
  onMemoryChangeRef.current = onMemoryChange;
  useEffect(
    () => () => {
      for (const controller of composeControllersRef.current.values()) {
        controller.abort();
      }
      composeControllersRef.current.clear();
      const pending = pendingAskRef.current;
      if (!pending) {
        return;
      }
      pendingAskRef.current = null;
      // The answer that still arrives now matches no token: it charges nothing.
      askToken.current += 1;
      pending.controller.abort();
      onMemoryChangeRef.current({
        lastActiveAt: new Date().toISOString(),
        messages: messagesRef.current.filter(
          (message) => message.id !== `me:${pending.token}` && message.id !== `offer:${pending.token}`,
        ),
        turns: conversation.current,
      });
    },
    [],
  );
  /**
   * Whether the last answer actually came from the coach.
   *
   * A build with no endpoint is offline by design; a build with one can still
   * be offline for a minute — rate limited, upstream down. The badge states
   * which, so a canned answer is never mistaken for a coached one.
   */
  const [answeredOffline, setAnsweredOffline] = useState(false);
  /**
   * Whether the keyboard is up.
   *
   * The composer reserves room for the floating tab bar underneath it. With
   * the keyboard open that bar is gone, and the reserve became a band of dead
   * screen between the field and the keys (user, 2026-08-25) — on a phone,
   * the most expensive space there is.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    // Measured, not inferred. KeyboardAvoidingView's padding under-lifts on
    // RN 0.83's edge-to-edge Android — the tab-bar reserve was silently
    // covering the shortfall, and removing that reserve put the composer
    // under the keys (user, 2026-08-25, with a photo). The event reports the
    // keyboard's real height, so the padding cannot be wrong by construction.
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates?.height ?? 0),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const online = liveConfigured && !answeredOffline;

  const chips = useMemo(() => buildCoachContextChips(intro, language), [intro, language]);
  // Shown until the first question. It is the reader's own log, which is both
  // the honest way to fill the screen and the claim Pro is sold on.
  const readout = useMemo(
    () => buildCoachContextReadout(trainingContext, language),
    [language, trainingContext],
  );
  const noticed = useMemo(
    () => (proUnlocked ? buildCoachNoticed(intro.weeklyRead, language) : []),
    [intro.weeklyRead, language, proUnlocked],
  );
  const openingLine = useMemo(() => buildCoachOpeningLine(intro, language), [intro, language]);
  // Today's line, what the coach noticed, and the readout — one rotating
  // stage instead of three stacked surfaces (user, 2026-08-23).
  const openingRows = useMemo(
    () =>
      buildCoachOpeningRows({
        openingLine,
        offer: buildCoachOpeningOffer(intro, language),
        noticed,
        readout,
        language,
      }),
    [intro, language, noticed, openingLine, readout],
  );
  // A frame question waiting. The opening rows and the quick asks stand down
  // meanwhile: three other things to tap under a question are three ways to
  // walk off it.
  const openIntake = useMemo(() => messages.find((message) => message.intake)?.intake ?? null, [messages]);
  const intakeOpen = openIntake !== null;
  // Opened from "New programme → AI-assisted": the analysis link, the opening
  // rows and the quick asks stay down from the first question until the week
  // is built, not only while a question is open (user, 2026-10-07). Read from
  // the thread, so a Back onto this chat keeps them down too; the route's
  // intent covers the first render, before the effect below starts the
  // questions, so none of them flashes in first.
  const frameOfferOpen = useMemo(
    () => messages.some((message) => message.offer?.type === 'compose' && Boolean(message.offer.frame)),
    [messages],
  );
  const programmeOnly = intent === 'new_program' || intakeOpen || frameOfferOpen;
  const showReadout = messages.length === 0 && openingRows.length > 0 && !programmeOnly;

  /**
   * What the coach has read, and what today is — one line.
   *
   * These used to be three surfaces: a subtitle, a strip of context chips, and
   * an evidence footnote under every answer. They are the same fact told three
   * times, and stacking them is what made the screen feel like a form.
   */
  const contextLine = useMemo(() => {
    const read =
      sessionCount > 0
        ? t(language, 'coachChat.subtitle', { count: sessionCount })
        : t(language, 'coachChat.subtitleFresh');
    const today = chips[0]?.label;
    return today ? `${read} · ${today}` : read;
  }, [chips, language, sessionCount]);

  // A free reader never types their way to the model. What they get instead
  // is the blurred local answer below — the real deterministic one, which
  // costs nothing — plus three demo moments. The door stays open at a price
  // the free tier can carry.
  const canAsk = proUnlocked && questionsRemaining > 0;
  /**
   * Only the first locked answer keeps its full body — that is the one that
   * sells. Every one after it collapses to a single line, so the thread reads
   * like a conversation the reader is behind on rather than a wall of
   * paywalls (design: GAINER Pro screens, 04).
   */
  const firstLockedId = useMemo(() => messages.find((message) => message.lockedBody)?.id ?? null, [messages]);
  // Recomputed on every render rather than memoized: it is a date read from
  // the clock, and a chat left open across midnight would otherwise keep
  // counting from yesterday.
  const quotaReset = coachQuotaReset();

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToEnd();
    }
  }, [messages.length, scrollToEnd]);

  const mustAcknowledgeOnline = liveConfigured && !onlineNoticeAcknowledged;

  const measurementLabel = useCallback(
    (intent: Pick<MeasurementIntent, 'kind'>) =>
      intent.kind === 'bodyweight' ? t(language, 'cards.bodyweight') : t(language, MEASUREMENT_LABEL_KEYS[intent.kind]),
    [language],
  );
  const formatReading = useCallback(
    (intent: MeasurementIntent | { kind: MeasurementIntent['kind']; value: number; unit: string }) =>
      `${measurementLabel(intent)} ${String(intent.value).replace('.', language === 'fi' ? ',' : '.')} ${intent.unit}`,
    [language, measurementLabel],
  );

  /**
   * The sentence above an offer's buttons. A chain of ternaries got a branch
   * wrong every time one was added, and a sixth would have been unreadable.
   */
  /**
   * Which proposal is being written, so its card can say so.
   *
   * Kept per-message rather than as one flag: two proposals can sit in a
   * thread, and a single "saving" would grey out both.
   */
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null);
  const handleSaveProposal = useCallback(
    async (messageId: string, proposal: ProgrammeProposal) => {
      setSavingProposalId(messageId);
      try {
        await onSaveProgramme(proposal);
      } finally {
        setSavingProposalId(null);
      }
    },
    [onSaveProgramme],
  );

  const offerBody = useCallback(
    (offer: NonNullable<ChatMessage['offer']>) => {
      switch (offer.type) {
        case 'openMeasure':
          return t(language, 'coachChat.measure.firstOffer', { label: measurementLabel(offer.intent) });
        case 'weighIn':
          return t(language, 'coachChat.weighIn.offer');
        case 'goal':
          return t(language, 'coachChat.goal.offer', { text: offer.intent.text });
        case 'log':
          return t(language, 'coachChat.measure.offer', { reading: formatReading(offer.intent) });
        case 'compose':
          // The question only. What was read out of the brief is laid out
          // under it (ComposeOutline) rather than quoted back as one sentence
          // — on a five-day request that sentence ran six lines and the
          // reader could not see what they were agreeing to (#bugs
          // 2026-08-27).
          //
          // From the frame questions, the answers themselves are the line:
          // every one was just tapped, so there is nothing to read back.
          return offer.frame ?? t(language, 'coachChat.compose.outlineAsk');
        default:
          return t(language, 'coachChat.measure.pinOffer', { label: measurementLabel(offer.intent) });
      }
    },
    [formatReading, language, measurementLabel],
  );

  const resolveOffer = useCallback(
    async (
      messageId: string,
      offer: NonNullable<ChatMessage['offer']>,
      accepted: boolean,
      suggestionKind?: CoachSuggestionKind,
    ) => {
      // Both answers are answers. Recording only the acceptances would leave
      // the refusal invisible and the same offer would come back next week.
      if (suggestionKind) {
        onCoachSuggestionResolved(suggestionKind, accepted);
      }
      if (!accepted) {
        setMessages((current) => current.filter((message) => message.id !== messageId));
        return;
      }
      if (offer.type === 'openMeasure') {
        onOpenMeasure(offer.intent.kind);
        setMessages((current) => current.filter((message) => message.id !== messageId));
        return;
      }
      if (offer.type === 'compose') {
        // When the brief asks for more days than the composer can lay out, the
        // catalog is the better answer than a trimmed week — it already holds
        // designed five- and six-day programmes. Checked before the Pro gate on
        // purpose: browsing and running the catalog is free, so a free reader
        // who asks for five days gets a real answer instead of a paywall.
        const signals = parseProgrammeBrief(offer.brief);
        if (shouldOfferCatalogInstead(signals)) {
          const match = matchProgrammeToBrief(signals);
          const title = match ? catalogProgrammeTitle(match.programId) : null;
          if (match && title) {
            // Straight to the programme: a coach line explaining the composer's
            // limit, and a card with a button to look, were two steps between
            // "Build the week" and the week (user, 2026-10-07). The card stays
            // in the thread, so Back shows where the build led.
            const next = messagesRef.current.map((message) =>
              message.id === messageId
                ? {
                    id: `${messageId}:catalog`,
                    fromCoach: true,
                    text: t(language, 'coachChat.compose.catalogLead', {
                      asked: signals.requestedDaysPerWeek ?? match.daysPerWeek,
                    }),
                    catalog: { programId: match.programId, title, daysPerWeek: match.daysPerWeek },
                  }
                : message,
            );
            setMessages(next);
            // Published here rather than by the effect that watches the
            // thread: opening the programme unmounts this screen in the same
            // commit, so that effect never sees the card, and Back restored
            // the build offer it replaced (CI review, 2026-10-07).
            onMemoryChange({ lastActiveAt: new Date().toISOString(), messages: next, turns: conversation.current });
            onOpenProgramme(match.programId);
            return;
          }
        }
        // Building a programme is the Pro feature, and it used to be gated by
        // the composer screen's own route guard. That screen is gone, so the
        // gate moves onto the act — otherwise moving the entrance into the free
        // chat would have quietly given the feature away. The line under the
        // offer says so before the tap, so the paywall is not a surprise.
        if (!proUnlocked) {
          onOpenPremium();
          return;
        }
        // The offer stays where it is while the week is built, and the
        // building line is drawn over it from `composingIds` — so the thread
        // that gets published upward still holds the offer, and walking away
        // mid-build leaves a conversation that is one tap from asking again
        // rather than a "Rakennan viikkoa…" nothing can ever resolve.
        //
        // The build can take the whole request timeout, so this is not a rare
        // window (audit 3, 2026-09-19).
        setComposingIds((current) => (current.includes(messageId) ? current : [...current, messageId]));
        const controller = new AbortController();
        composeControllersRef.current.set(messageId, controller);
        let proposal: ProgrammeProposal | null = null;
        try {
          proposal = await onComposeProgramme(offer.brief, controller.signal);
        } finally {
          // In a finally, so a rejected compose clears the building line too
          // rather than leaving the offer under a spinner with no way out.
          setComposingIds((current) => current.filter((id) => id !== messageId));
          composeControllersRef.current.delete(messageId);
        }
        // The offer becomes the week it was offering. Replaced rather than
        // appended: leaving "shall I build this?" above the thing it built
        // would invite a second tap that composes the same brief again.
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? proposal
                ? { id: `${messageId}:proposal`, fromCoach: true, text: '', proposal }
                : // A failed compose says so rather than leaving the thread on
                  // "building…" forever.
                  { id: `${messageId}:failed`, fromCoach: true, text: t(language, 'coachChat.compose.failed') }
              : message,
          ),
        );
        return;
      }
      if (offer.type === 'weighIn') {
        // The confirmation follows the write, never the tap: "Morning weigh-in
        // is on" used to be said before anything had been saved, over a
        // switch the planner then ignored.
        let outcome: 'on' | 'blocked' | 'failed';
        try {
          outcome = await onEnableWeighInReminder();
        } catch {
          outcome = 'failed';
        }
        const reply =
          outcome === 'on'
            ? t(language, 'coachChat.weighIn.done')
            : outcome === 'blocked'
              ? t(language, 'coachChat.weighIn.blocked')
              : t(language, 'coachChat.weighIn.failed');
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId ? { id: `${messageId}:${outcome}`, fromCoach: true, text: reply } : message,
          ),
        );
        return;
      }
      if (offer.type === 'goal') {
        await onSetGoal(offer.intent);
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { id: `${messageId}:done`, fromCoach: true, text: t(language, 'coachChat.goal.done') }
              : message,
          ),
        );
        return;
      }
      if (offer.type === 'log') {
        await onLogMeasurement(offer.intent);
        const pinned = pinnedStatCardKeys.includes(offer.intent.kind);
        setMessages((current) =>
          current.flatMap((message) =>
            message.id === messageId
              ? [
                  { id: `${messageId}:done`, fromCoach: true, text: t(language, 'coachChat.measure.logged', { reading: formatReading(offer.intent) }) },
                  // The card offer follows only when Home does not have it — a
                  // pinned card offered again would be the sign explaining a sign.
                  ...(pinned ? [] : [{ id: `${messageId}:pin`, fromCoach: true, text: '', offer: { type: 'pin' as const, intent: offer.intent } }]),
                ]
              : [message],
          ),
        );
        return;
      }
      onPinStatCard(offer.intent.kind);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { id: `${messageId}:done`, fromCoach: true, text: t(language, 'coachChat.measure.pinned', { label: measurementLabel(offer.intent) }) }
            : message,
        ),
      );
    },
    [
      formatReading,
      language,
      measurementLabel,
      onCoachSuggestionResolved,
      onComposeProgramme,
      onEnableWeighInReminder,
      onLogMeasurement,
      onMemoryChange,
      onOpenMeasure,
      onOpenProgramme,
      onPinStatCard,
      onSetGoal,
      onOpenPremium,
      proUnlocked,
      pinnedStatCardKeys,
    ],
  );

  /**
   * One answer per offer, however fast it is tapped.
   *
   * The offer stays on screen until its write resolves, and nothing marked it
   * as answered in the meantime: two taps on "log it" wrote the weigh-in twice
   * — two rows in the weight list and the chart — under one "logged" line
   * (double-tap audit, 2026-09-21). A ref, not state: the second tap arrives
   * before a re-render could disable anything.
   */
  const resolvingOfferIdsRef = useRef(new Set<string>());
  const resolveOfferOnce = useCallback(
    async (...args: Parameters<typeof resolveOffer>) => {
      const [messageId] = args;
      if (resolvingOfferIdsRef.current.has(messageId)) {
        return;
      }
      resolvingOfferIdsRef.current.add(messageId);
      try {
        await resolveOffer(...args);
      } finally {
        resolvingOfferIdsRef.current.delete(messageId);
      }
    },
    [resolveOffer],
  );

  /**
   * The demo moment's key, held past the hand-off that carried it.
   *
   * It arrives on the route and the route is cleared the instant the question
   * is dispatched — otherwise a remount would fire it again. The answer comes
   * back seconds later, by which time the prop is null, so the key that
   * decides which of the three was spent has to survive here. Cleared once
   * spent, so a second answer in the same session cannot spend it twice.
   */
  const demoMomentKeyRef = useRef<string | null>(null);

  const send = useCallback(
    /**
     * `force` sends for real regardless of quota. Only a coach demo moment
     * passes it: those three are the free tier’s whole allowance, already
     * budgeted, and blurring one would make the offer a bluff.
     */
    async (prompt: string, force = false) => {
      const trimmed = prompt.trim();
      if (!trimmed || asking || mustAcknowledgeOnline) {
        // Nothing leaves the device until the online disclosure is answered.
        return;
      }

      const token = (askToken.current += 1);
      setDraft('');

      /**
       * A reader in trouble is answered first, and here.
       *
       * Before the quota gate: out of questions, the answer below is rendered
       * blurred behind an "unlock this" button, and the crisis line is not
       * something to sell. Before the network: it must not depend on a
       * connection, on the spend cap, or on the model doing as it is told.
       * And it is not appended to `conversation.current` the way every other
       * turn is, so the message does not travel with the next question — a
       * client-side check that still posts the text is not the promise it
       * looks like (PR #124 review).
       */
      if (classifyCoachScope(trimmed) === 'crisis') {
        const answer = buildAiCoachPreviewAnswer(trimmed, trainingContext, language);
        setMessages((current) => [
          ...current,
          { id: `me:${token}`, fromCoach: false, text: trimmed },
          { id: `coach:${token}`, fromCoach: true, text: answer.takeaway, advice: answer },
        ]);
        return;
      }

      // "Kiitos" is answered here. It never reaches the network, so it costs
      // nothing and cannot come back as an analysis with a four-week plan
      // attached (transcript review, 2026-08-23). Checked before the quota
      // gate on purpose: being out of questions must not stop the coach from
      // saying you are welcome.
      const smallTalk = parseCoachSmallTalk(trimmed);
      if (smallTalk) {
        setMessages((current) => [
          ...current,
          { id: `me:${token}`, fromCoach: false, text: trimmed },
          {
            id: `coach:${token}`,
            fromCoach: true,
            text: t(language, coachSmallTalkReplyKey(smallTalk, current.length)),
          },
        ]);
        return;
      }

      const measurement = parseMeasurementIntent(trimmed, language);
      const goal = measurement ? null : parseGoalIntent(trimmed, language);
      setMessages((current) => [
        ...current,
        { id: `me:${token}`, fromCoach: false, text: trimmed },
        ...(measurement
          ? [{ id: `offer:${token}`, fromCoach: true, text: '', offer: { type: 'log' as const, intent: measurement } }]
          : []),
        ...(goal
          ? [{ id: `offer:${token}`, fromCoach: true, text: '', offer: { type: 'goal' as const, intent: goal } }]
          : []),
      ]);

      // Out of quota: the question still lands, and the answer that exists is
      // shown blurred rather than refused. The door stays open (design rule);
      // what is withheld is the conclusion, not the conversation.
      //
      // The blurred text is the REAL answer — the offline coach is
      // deterministic and costs nothing, so withholding it is a choice about
      // access, not about having something to say. Blurring a placeholder
      // instead would make the lock a bluff.
      if (!canAsk && !force) {
        const withheld = buildAiCoachPreviewAnswer(trimmed, trainingContext, language);
        setMessages((current) => [
          ...current,
          {
            id: `locked:${token}`,
            fromCoach: true,
            text: '',
            // Two real sentences, joined into one paragraph — unlike the pro
            // insights, these were never a single sentence cut in half.
            lockedBody: [withheld.takeaway, withheld.nextSteps[0] ?? withheld.why[0] ?? '']
              .filter(Boolean)
              .join(' '),
          },
        ]);
        return;
      }

      setAsking(true);
      // The fact of a question, never its text: whether the coach is used at
      // all is the number the AI bill is justified against.
      trackEvent('coach_question_asked');
      const controller = new AbortController();
      pendingAskRef.current = { token, controller };
      try {
        const result = await requestAiCoachAdvice({
          prompt: trimmed,
          context: sentTrainingContext,
          language,
          // What was already said in this thread, so a follow-up resolves.
          history: conversation.current,
          // Sent every time, from the switch as it stands right now. A reader
          // who turns it off between two questions has turned it off for the
          // second one.
          keepConsent: logConsent.chat,
          // No label, nothing kept: the server refuses the write without one,
          // which closes the window between the first yes and the id landing.
          ...(logConsent.chat && logId ? { logId } : {}),
        }, controller.signal);
        if (token !== askToken.current) {
          return;
        }
        if (result.limited) {
          // Turned away for rate, not unreachable: the badge stays as it
          // was, nothing is charged, and the question goes back into the
          // field to send again. The canned answer and OFFLINE made a wait
          // look like an outage (#bugs, 2026-09-30).
          setMessages((current) => [
            ...current,
            { id: `coach:${token}`, fromCoach: true, text: t(language, 'coachChat.rateLimited') },
          ]);
          setDraft((current) => (current.trim() ? current : trimmed));
          return;
        }
        const answer = result.answer;
        // The endpoint answers with a canned offline reply when it cannot
        // reach the model — rate limited, upstream down, key missing. Until
        // now the chat showed that as if the coach had said it, which is how
        // "the AI chat does not work" looks from the reader's side: a real
        // answer, just a useless one. Say which it was.
        const fellBackToPreview = liveConfigured && result.source === 'preview';
        // Recovers on its own: the next answer that reaches the model clears
        // the badge, so it reports the present rather than a past outage.
        setAnsweredOffline(result.source === 'preview');
        // Charged for an answer, not for a send, and only to the tier that
        // has a counter. An answer that could only ask for a clearer question
        // is free: 25 a month is too few to spend one on a chip the app
        // itself offered and could not handle. A preview-sourced reply is
        // free on the same rule as the demo charge below — it is the canned
        // text, not the product the counter meters (PR #33 review).
        if (proUnlocked && !answer.unanswered && result.source !== 'preview') {
          onQuestionUsed();
        }
        // And the demo moment, on a different rule, because it meters a
        // different thing. The counter above meters VALUE, so a reply that
        // could only ask for a clearer question is forgiven. The moment
        // meters COST: aiCoachQuota promises three real model calls per
        // install, ever, and a clarifying reply is a real model call. Left
        // unspent it re-offered on every completed session after it, each
        // acceptance billing again past a cap whose word is "ever"
        // (PR #33 review).
        //
        // A preview-sourced reply still does not count: nothing reached the
        // model, and spending one of three on the deterministic text a free
        // reader already has would make the offer a bluff at the one moment
        // it is being tested.
        if (force && result.source !== 'preview' && demoMomentKeyRef.current) {
          onDemoQuestionAnswered?.(demoMomentKeyRef.current);
          demoMomentKeyRef.current = null;
        }
        // Kept even when the answer was a follow-up question: without it the
        // reader's reply to that question would arrive with no antecedent,
        // which is the exact failure this exists to fix.
        conversation.current = appendCoachTurn(conversation.current, {
          question: trimmed,
          takeaway: answer.takeaway,
        });
        // And the long memory, on a narrower rule than the thread above. The
        // thread keeps a clarifying question so the reader's reply has an
        // antecedent; the memory keeps only advice, so an answer that asked
        // for a clearer question is not stored as something the coach said.
        // Preview text never counts: it is the canned offline answer, and
        // recording it would have the coach believe it had advised something
        // it never reached the model to say.
        if (result.source !== 'preview' && !answer.unanswered) {
          onAdviceGiven?.(answer.takeaway);
        }
        // The whole answer, as sections: a takeaway, then the reasons, the
        // steps and the plan each on their own lines. One run-on paragraph
        // buried the dates and numbers (#bugs, 2026-08-23).
        const reply = answer.takeaway;
        // The coach's own offer, turned into a button — but only one it can
        // actually carry out. A pin needs a measurement the app knows; a goal
        // is read with the same parser the typed path uses, and an offer that
        // will not parse is dropped rather than shown as a dead button.
        const suggestion = answer.suggestion ?? null;
        const suggestedOffer: ChatMessage | null = (() => {
          if (!suggestion) {
            return null;
          }
          if (suggestion.kind === 'compose_programme') {
            // The brief is the whole offer: without it there is nothing to
            // hand over, and the composer would open on an empty field — the
            // "type it again" the merge exists to remove.
            const brief = suggestion.brief?.trim() ?? '';
            if (!brief) {
              return null;
            }
            return {
              id: `suggest:${token}`,
              fromCoach: true,
              text: '',
              offer: { type: 'compose' as const, brief },
              // Deliberately no suggestionKind. The cooldown exists to stop the
              // coach nagging about things nobody asked for, and it ends an
              // offer for good once taken up — right for a card or a reminder,
              // which are switches. This one only appears because the reader
              // asked for a programme, and asking twice is normal; silencing it
              // would restore the refusal this whole change removes.
            };
          }
          if (suggestion.kind === 'log_measurement') {
            const kind = suggestion.statKey ?? '';
            if (!isMeasurementIntentKind(kind)) {
              return null;
            }
            // With the value the reader stated, the button writes the entry in
            // one tap — the coach was answering "I cannot log it for you" to a
            // request its own reply could have carried the button for
            // (user, 2026-08-25). The unit must fit the measurement: kilograms
            // belong to bodyweight, centimetres and percentages to the tape.
            const unitFits =
              kind === 'bodyweight' ? suggestion.unit === 'kg' : suggestion.unit === 'cm' || suggestion.unit === '%';
            if (typeof suggestion.value === 'number' && Number.isFinite(suggestion.value) && suggestion.value > 0 && unitFits) {
              return {
                id: `suggest:${token}`,
                fromCoach: true,
                text: '',
                offer: {
                  type: 'log' as const,
                  intent: { kind, value: suggestion.value, unit: suggestion.unit as 'cm' | 'kg' | '%' },
                },
                suggestionKind: 'log_measurement' as const,
              };
            }
            // No value: the offer opens the recording page — but never for
            // something already measured, since the point is the reading the
            // record does not have.
            const measured = (trainingContext.body?.measurements ?? []).some((entry) => entry.kind === kind);
            if (measured) {
              return null;
            }
            return {
              id: `suggest:${token}`,
              fromCoach: true,
              text: '',
              offer: { type: 'openMeasure' as const, intent: { kind } },
              suggestionKind: 'log_measurement' as const,
            };
          }
          if (suggestion.kind === 'weigh_in_reminder') {
            return weighInReminderEnabled
              ? null
              : {
                  id: `suggest:${token}`,
                  fromCoach: true,
                  text: '',
                  offer: { type: 'weighIn' as const },
                  suggestionKind: 'weigh_in_reminder' as const,
                };
          }
          if (suggestion.kind === 'pin_stat_card') {
            const kind = suggestion.statKey ?? '';
            if (!isMeasurementIntentKind(kind) || pinnedStatCardKeys.includes(kind)) {
              return null;
            }
            return {
              id: `suggest:${token}`,
              fromCoach: true,
              text: '',
              offer: { type: 'pin' as const, intent: { kind } },
              suggestionKind: 'pin_stat_card' as const,
            };
          }
          // Declared: the coach chose set_goal, so only the body part and the
          // number still need reading. Holding it to the sniffer's rules threw
          // away offers whose text the coach had merely paraphrased.
          const intent = suggestion.goalText
            ? parseGoalIntent(suggestion.goalText, language, { declared: true })
            : null;
          if (!intent) {
            return null;
          }
          return {
            id: `suggest:${token}`,
            fromCoach: true,
            text: '',
            offer: { type: 'goal' as const, intent },
            suggestionKind: 'set_goal' as const,
          };
        })();
        setMessages((current) => [
          ...current,
          {
            id: `coach:${token}`,
            fromCoach: true,
            text: reply || answer.takeaway,
            advice: answer,
            generated: result.source !== 'preview',
            ...(fellBackToPreview ? { evidence: t(language, 'coachChat.offlineAnswer') } : {}),
          },
          ...(suggestedOffer ? [suggestedOffer] : []),
        ]);
      } catch {
        if (token !== askToken.current) {
          return;
        }
        // The request never landed, which is the plainest offline there is.
        setAnsweredOffline(true);
        // An upstream failure still knocked: the call was made and it costs.
        if (proUnlocked) {
          onQuestionUsed();
        }
        setMessages((current) => [
          ...current,
          { id: `coach:${token}`, fromCoach: true, text: t(language, 'coach.error') },
        ]);
        // And the question comes back into the field it was typed in. The
        // draft is cleared the moment the ask starts, so a failure left the
        // reader with an apology, no retry control and nothing to retry with
        // but their own memory of what they had written (audit 3,
        // 2026-09-19).
        //
        // The question stays in the thread above, unlike the unmount path,
        // which lifts it out: there nobody saw it fail, here the apology is
        // addressed to something and would read as an answer to nothing
        // without it. Sending again therefore logs the question twice, which
        // is what asking twice looks like.
        setDraft((current) => (current.trim() ? current : trimmed));
      } finally {
        if (pendingAskRef.current?.token === token) {
          pendingAskRef.current = null;
        }
        if (token === askToken.current) {
          setAsking(false);
        }
      }
    },
    [
      asking,
      canAsk,
      language,
      mustAcknowledgeOnline,
      onDemoQuestionAnswered,
      onQuestionUsed,
      pinnedStatCardKeys,
      proUnlocked,
      sessionCount,
      trainingContext,
      sentTrainingContext,
      onAdviceGiven,
      weighInReminderEnabled,
    ],
  );

  /**
   * The demo moment, sent once.
   *
   * The ref rather than a dependency on the prop: the parent clears the
   * pending question as soon as this fires, and a re-render arriving before
   * that clear must not send it a second time. One of three, spent twice,
   * would be the most expensive off-by-one in the app.
   */
  const demoSent = useRef(false);
  useEffect(() => {
    // `asking` is checked here and not only inside send: send's own first
    // guard returns on it, and returning after the hand-off had been cleared
    // would leave the question dispatched by nobody. Waiting is right — the
    // effect runs again when the request in flight finishes.
    if (!demoQuestion || demoSent.current || mustAcknowledgeOnline || asking) {
      return;
    }
    demoSent.current = true;
    demoMomentKeyRef.current = demoMomentKey ?? null;
    onDemoQuestionSent?.();
    void send(demoQuestion, true);
  }, [asking, demoMomentKey, demoQuestion, mustAcknowledgeOnline, onDemoQuestionSent, send]);

  /**
   * The frame questions, started once per hand-off.
   *
   * The same shape as the demo question above: the ref stops a re-render
   * starting them twice, and the route is cleared at once so a remount or a
   * Back onto this chat cannot start them again over the answers already
   * given. A half-answered set left in the kept thread is replaced, not
   * stacked: two open questions would leave one of them unanswerable.
   */
  const intentTaken = useRef(false);
  useEffect(() => {
    if (intent !== 'new_program' || intentTaken.current) {
      return;
    }
    intentTaken.current = true;
    onIntentConsumed?.();
    const intake = startProgramIntake(intakePreferences);
    const id = `intake:${Date.now()}`;
    setMessages((current) => [
      ...current.filter((message) => !message.intake),
      { id, fromCoach: true, text: t(language, 'programIntake.intro'), intake },
    ]);
  }, [intakePreferences, intent, language, onIntentConsumed]);

  const [intakeDraft, setIntakeDraft] = useState('');
  // The last question's field sits at the foot of the thread, and the
  // keyboard shrinks the thread from below: follow it up so the field the
  // reader is typing in stays in view.
  useEffect(() => {
    if (keyboardHeight > 0 && intakeOpen) {
      scrollToEnd();
    }
  }, [intakeOpen, keyboardHeight, scrollToEnd]);
  /**
   * One answer, by tap. The open question becomes a question asked and an
   * answer given — ordinary bubbles, so the thread reads back as the
   * conversation it was — and the next question, or the build offer once
   * there is none, takes its place. Nothing here calls the model or counts
   * against the quota: only the build at the end is billed, through the same
   * compose offer the coach makes in conversation.
   *
   * Inside the updater, so a second tap that lands before the re-render
   * finds the question already answered and does nothing.
   */
  const answerIntake = useCallback(
    (messageId: string, value: string) => {
      setMessages((current) =>
        current.flatMap((message): ChatMessage[] => {
          if (message.id !== messageId || !message.intake) {
            return [message];
          }
          const step = currentProgramIntakeStep(message.intake);
          const next = answerProgramIntake(message.intake, value);
          if (step === null || next === message.intake) {
            return [message];
          }
          const nextStep = currentProgramIntakeStep(next);
          // The last answer is free text, and it never passes through send(),
          // so send()'s first rule is kept here: a reader in trouble is
          // answered first, offline, and nothing is built from those words or
          // sent anywhere with them.
          const crisis = step === 'extra' && classifyCoachScope(value) === 'crisis';
          const crisisAnswer = crisis ? buildAiCoachPreviewAnswer(value.trim(), trainingContext, language) : null;
          return [
            ...(message.text ? [{ id: `${message.id}:i`, fromCoach: true, text: message.text }] : []),
            { id: `${message.id}:q`, fromCoach: true, text: t(language, PROGRAM_INTAKE_QUESTION_KEYS[step]) },
            { id: `${message.id}:a`, fromCoach: false, text: programIntakeAnswerText(step, value, language) },
            crisisAnswer
              ? { id: `${message.id}:crisis`, fromCoach: true, text: crisisAnswer.takeaway, advice: crisisAnswer }
              : nextStep
              ? { id: `${message.id}:n`, fromCoach: true, text: '', intake: next }
              : {
                  id: `${message.id}:build`,
                  fromCoach: true,
                  text: '',
                  offer: {
                    type: 'compose' as const,
                    brief: buildProgramIntakeBrief(next.answers, language),
                    frame: buildProgramIntakeFrame(next.answers, language),
                    // Kept for "Edit", which asks the same questions again
                    // with these as the choices to confirm.
                    answers: next.answers,
                  },
                },
          ];
        }),
      );
      setIntakeDraft('');
    },
    [language, trainingContext],
  );

  /**
   * "Edit" on the build offer: the questions again, each earlier answer the
   * choice to confirm. The offer gives way to the first question, and the
   * answers already in the thread stay as the record of the first pass.
   *
   * Not while that offer is being built: the build would come back to an
   * offer that is gone, and the week it composed would be dropped. Any other
   * open question goes, as when the questions start from the route: two open
   * at once would leave one unanswerable.
   */
  const editIntake = useCallback(
    (messageId: string) => {
      if (resolvingOfferIdsRef.current.has(messageId)) {
        return;
      }
      setMessages((current) => {
        const offer = current.find((message) => message.id === messageId)?.offer;
        if (offer?.type !== 'compose') {
          return current;
        }
        const intake = offer.answers ? editProgramIntake(offer.answers) : startProgramIntake(intakePreferences);
        return current
          .filter((message) => !message.intake)
          .map((message) =>
            message.id === messageId ? { id: `intake:${Date.now()}`, fromCoach: true, text: '', intake } : message,
          );
      });
      setIntakeDraft('');
    },
    [intakePreferences],
  );

  // The free-text question, reached on an edit, starts from what was written
  // the first time. Set once the step opens, after the answer before it has
  // cleared the field, and not again while the reader types.
  const openIntakeStep = openIntake ? currentProgramIntakeStep(openIntake) : null;
  const extraPreset = openIntake?.preset.extra ?? '';
  useEffect(() => {
    if (openIntakeStep === 'extra' && extraPreset) {
      setIntakeDraft(extraPreset);
    }
  }, [extraPreset, openIntakeStep]);

  return (
    <View style={styles.screen}>
      {/* A soft light at the top so the dark field is not flat. Light already
          has its own depth from the surfaces, so it does not need one. */}
      {themeName === 'dark' ? (
        <Svg pointerEvents="none" style={styles.topLight} width={TOP_LIGHT} height={TOP_LIGHT * 0.72}>
          <Defs>
            <RadialGradient id="coachTopLight" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#8B5CF6" stopOpacity={0.34} />
              <Stop offset="1" stopColor="#8B5CF6" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={TOP_LIGHT} height={TOP_LIGHT * 0.72} fill="url(#coachTopLight)" />
        </Svg>
      ) : null}
      <View style={styles.header}>
        <View style={styles.headerTile}>
          <SparkGlyph color={theme.purple} />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>{t(language, 'coachChat.title')}</Text>
            {/* The coach is still being tuned, and says so where the reader
                meets it (user, 2026-09-30). A state like the mode pill beside
                it, in the brand's violet: nothing here is pressable. */}
            <View style={styles.betaBadge} accessibilityRole="text" accessibilityLabel={t(language, 'coachChat.betaA11y')}>
              <Text style={styles.betaText}>{t(language, 'coachChat.beta')}</Text>
            </View>
            <View
              style={[styles.modeBadge, online ? styles.modeBadgeOnline : styles.modeBadgeOffline]}
              accessibilityRole="text"
              accessibilityLabel={t(language, online ? 'coachChat.mode.onlineA11y' : 'coachChat.mode.offlineA11y')}
            >
              <View style={[styles.modeDot, online ? styles.modeDotOnline : styles.modeDotOffline]} />
              <Text style={[styles.modeText, online ? styles.modeTextOnline : styles.modeTextOffline]}>
                {t(language, online ? 'coachChat.mode.online' : 'coachChat.mode.offline')}
              </Text>
            </View>
          </View>
          {/* One line, not a subtitle plus a strip of chips plus a footnote.
              What the coach has read and what today is are the same fact. */}
          <Text style={styles.headerSub} numberOfLines={2}>
            {contextLine}
          </Text>
          {/* Always, not only in the last five: the owner looked for the
              count, found none, and asked questions until one ran out to see
              what happened (#bugs, 2026-09-30). In the header, where it does
              not scroll away with the thread. */}
          {proUnlocked ? (
            <Text style={styles.headerQuota}>
              {t(language, 'coachChat.quotaOf', { count: Math.max(0, questionsRemaining), max: PRO_COACH_QUESTIONS_PER_MONTH })}
            </Text>
          ) : null}
        </View>
      </View>

      {/* 'padding' on Android too. The manifest's adjustResize used to lift the
          composer above the keyboard; with RN 0.83's mandatory edge-to-edge it
          no longer does, and the keyboard covered the thread and the field
          (#bugs, 2026-08-23: 'hard to see what you are typing'). */}
      <View style={styles.body}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
        >
          {mustAcknowledgeOnline ? (
            <View style={styles.onlineCard}>
              <Text style={styles.onlineTitle}>{t(language, 'coachChat.online.title')}</Text>
              <Text style={styles.onlineBody}>{t(language, 'coachChat.online.body')}</Text>
              <Text style={styles.onlineBody}>{t(language, 'coachChat.online.body2')}</Text>

              {/* The three optional yeses, under the notice and clearly not part
                  of it. The notice says what the coach does; these say what the
                  server may write down afterwards, and the coach answers the
                  same either way. Off until tapped, one at a time — a single
                  switch for three different things would be one answer put in
                  the reader's mouth three times. */}
              {COACH_COPIES_KEPT ? (
              <View style={styles.keepBlock}>
                <Text style={styles.keepTitle}>{t(language, 'coachChat.keep.title')}</Text>
                <Text style={styles.keepBody}>{t(language, 'coachChat.keep.body')}</Text>
                {([
                  ['chat', 'coachChat.keep.chat'],
                  ['composer', 'coachChat.keep.composer'],
                  ['photo', 'coachChat.keep.photo'],
                ] as const).map(([key, labelKey]) => {
                  const on = logConsent[key];
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={t(language, labelKey)}
                      onPress={() => onChangeLogConsent({ [key]: !on })}
                      style={({ pressed }) => [styles.keepRow, pressed && styles.pressed]}
                    >
                      <View style={[styles.keepBox, on && styles.keepBoxOn]}>
                        {on ? <Text style={styles.keepTick}>✓</Text> : null}
                      </View>
                      <Text style={styles.keepLabel}>{t(language, labelKey)}</Text>
                    </Pressable>
                  );
                })}
                <Text style={styles.keepNote}>{t(language, 'coachChat.keep.note')}</Text>
              </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={onAcknowledgeOnlineNotice}
                style={({ pressed }) => [styles.onlineButton, pressed && styles.pressed]}
              >
                <Text style={styles.onlineButtonText}>{t(language, 'coachChat.online.ok')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Nothing else while the notice is up (user, 2026-09-10). The chips,
              the readout and the "log a workout" line all sat under it, and a
              screen that offers three other things while asking one question
              is asking the reader to skip the question. */}
          {mustAcknowledgeOnline ? null : (
          <>
          {showReadout ? (
            <CoachReadoutTicker
              rows={openingRows}
              askLabel={t(language, 'coachChat.noticedAsk')}
              onAsk={(question) => void send(question)}
            />
          ) : null}

          {/* The written analysis is Pro (the Pro page's table says so), so a
              free user gets the link and the reason, not a dead end. It is a
              link rather than a card: one sentence does not need a surface. */}
          {lastSession && !programmeOnly ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => (proUnlocked ? onOpenAnalysis(lastSession.id) : onOpenPremium())}
              style={({ pressed }) => [styles.analysisLink, pressed && styles.pressed]}
            >
              <Text style={styles.analysisCta}>
                {t(language, proUnlocked ? 'coach.seeFullAnalysis' : 'coach.analysisLocked')}
              </Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12h13M12 6l6 6-6 6"
                  stroke={theme.highlight}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ) : null}

          {messages.map((message) =>
            // Drawn over the offer rather than in place of it: the offer is
            // still in the thread underneath, so leaving now keeps it.
            composingIds.includes(message.id) ? (
              <View key={message.id} style={styles.bubbleRow}>
                <View style={[styles.coachBubble, styles.thinkingBubble]}>
                  <ActivityIndicator size="small" color={theme.purple} />
                  <Text style={styles.thinkingText}>{t(language, 'coachChat.compose.building')}</Text>
                </View>
              </View>
            ) : message.catalog ? (
              <View key={message.id} style={styles.bubbleRow}>
                <View style={[styles.coachBubble, styles.offerBubble]}>
                  <Text style={styles.coachText}>{message.text}</Text>
                  <Text style={styles.catalogName}>{message.catalog.title}</Text>
                  <Text style={styles.catalogMeta}>
                    {t(language, 'coachChat.compose.catalogMeta', { count: message.catalog.daysPerWeek })}
                  </Text>
                  <View style={styles.offerActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenProgramme((message.catalog as { programId: string }).programId)}
                      style={({ pressed }) => [styles.offerCta, pressed && styles.pressed]}
                    >
                      <Text style={styles.offerCtaText}>{t(language, 'coachChat.compose.catalogOpen')}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : message.proposal ? (
              /* The week, in the thread that asked for it. Full width rather
                 than in a bubble: a four-day programme squeezed into a chat
                 bubble is the shape that made this live on its own screen. */
              <View key={message.id} style={styles.proposalWrap}>
                <ProgrammeProposalCard
                  proposal={message.proposal}
                  language={language}
                  busy={savingProposalId === message.id ? 'saving' : 'idle'}
                  onSave={() => void handleSaveProposal(message.id, message.proposal as ProgrammeProposal)}
                />
              </View>
            ) : message.intake ? (
              <IntakeQuestion
                key={message.id}
                intro={message.text}
                state={message.intake}
                language={language}
                styles={styles}
                placeholderColor={theme.faint}
                selectionColor={theme.highlight}
                draft={intakeDraft}
                onChangeDraft={setIntakeDraft}
                onAnswer={(value) => answerIntake(message.id, value)}
              />
            ) : message.offer ? (
              <View key={message.id} style={styles.bubbleRow}>
                <View style={[styles.coachBubble, styles.offerBubble]}>
                  <Text style={styles.coachText}>{offerBody(message.offer)}</Text>
                  {message.offer.type === 'compose' && !message.offer.frame ? (
                    <ComposeOutline brief={message.offer.brief} language={language} styles={styles} />
                  ) : null}
                  {/* Said before the tap, not at the paywall. Only to readers
                      it applies to: a Pro badge shown to someone who already
                      pays is a sign explaining nothing. */}
                  {message.offer.type === 'compose' && !proUnlocked ? (
                    <Text style={styles.offerNote}>{t(language, 'coachChat.compose.pro')}</Text>
                  ) : null}
                  <View style={styles.offerActions}>
                    {/* After the frame questions the choice is to change an
                        answer or build, not to walk away: "No" left the reader
                        with nothing on screen (user, 2026-10-07). */}
                    {message.offer.type === 'compose' && message.offer.frame ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => editIntake(message.id)}
                        style={({ pressed }) => [styles.offerGhost, pressed && styles.pressed]}
                      >
                        <Text style={styles.offerGhostText}>{t(language, 'programIntake.edit')}</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          void resolveOfferOnce(
                            message.id,
                            message.offer as NonNullable<ChatMessage['offer']>,
                            false,
                            message.suggestionKind,
                          )
                        }
                        style={({ pressed }) => [styles.offerGhost, pressed && styles.pressed]}
                      >
                        <Text style={styles.offerGhostText}>{t(language, 'coachChat.measure.skip')}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        void resolveOfferOnce(
                          message.id,
                          message.offer as NonNullable<ChatMessage['offer']>,
                          true,
                          message.suggestionKind,
                        )
                      }
                      style={({ pressed }) => [styles.offerCta, pressed && styles.pressed]}
                    >
                      <Text style={styles.offerCtaText}>
                        {t(
                          language,
                          message.offer.type === 'compose' && message.offer.frame
                            ? 'programIntake.build'
                            : OFFER_CTA_KEYS[message.offer.type],
                        )}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : message.lockedBody ? (
              message.id === firstLockedId ? (
                <View key={message.id} style={styles.lockWrap}>
                  <ProLockedCard
                    language={language}
                    teaser={t(language, 'coachChat.locked.teaser')}
                    body={message.lockedBody}
                    cta={t(language, 'coachChat.locked.cta')}
                    onPress={onOpenPremium}
                  />
                </View>
              ) : (
                <Pressable
                  key={message.id}
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'coachChat.locked.collapsed')}
                  onPress={onOpenPremium}
                  style={({ pressed }) => [styles.lockWrap, styles.lockedCollapsed, pressed && styles.pressed]}
                >
                  <Text style={styles.lockedCollapsedText}>{t(language, 'coachChat.locked.collapsed')}</Text>
                </Pressable>
              )
            ) : (
              <View
                key={message.id}
                style={[styles.bubbleRow, !message.fromCoach && styles.bubbleRowMe]}
              >
                <View style={message.fromCoach ? styles.coachBubble : styles.meBubble}>
                  {/* The last-workout answer reads as the user laid it out
                      (2026-09-27): the observation, what I would do next, a
                      heads-up only when there is one, and an example. */}
                  {message.advice?.topic === 'last_session' && !message.advice.unanswered ? (
                    <Text style={styles.answerSectionLabel}>{t(language, 'coachChat.section.observation')}</Text>
                  ) : null}
                  <Text style={message.fromCoach ? styles.coachText : styles.meText}>{message.text}</Text>
                  {message.advice
                    ? (
                        [
                          { key: 'why', label: 'coachChat.section.why' as const, lines: message.advice.why, mark: (_i: number) => '\u2022' },
                          {
                            key: 'next',
                            label:
                              message.advice.topic === 'last_session'
                                ? ('coachChat.section.nextMine' as const)
                                : ('coachChat.section.next' as const),
                            lines: message.advice.nextSteps,
                            mark: (i: number) => `${i + 1}.`,
                          },
                          {
                            key: 'attention',
                            label: 'coachChat.section.attention' as const,
                            lines: message.advice.attention ? [message.advice.attention] : [],
                            mark: (_i: number) => '!',
                          },
                          {
                            key: 'example',
                            label: 'coachChat.section.example' as const,
                            lines: message.advice.example ? [message.advice.example] : [],
                            mark: (_i: number) => '\u2192',
                          },
                          { key: 'plan', label: 'coachChat.section.plan' as const, lines: message.advice.plan, mark: (_i: number) => '\u2192' },
                        ] as const
                      )
                        .filter((sectionDef) => sectionDef.lines.length > 0)
                        .map((sectionDef) => (
                          <View key={sectionDef.key} style={styles.answerSection}>
                            <Text style={styles.answerSectionLabel}>{t(language, sectionDef.label)}</Text>
                            {sectionDef.lines.map((lineText, index) => (
                              <View key={`${sectionDef.key}-${index}`} style={styles.answerLine}>
                                <Text style={styles.answerMark}>{sectionDef.mark(index)}</Text>
                                <Text style={styles.answerLineText}>{lineText}</Text>
                              </View>
                            ))}
                          </View>
                        ))
                    : null}
                  {message.evidence ? <Text style={styles.evidence}>{message.evidence}</Text> : null}
                  {message.fromCoach && message.advice && message.generated ? (
                    message.reported ? (
                      <Text style={[styles.reportTap, styles.reportLink]}>{t(language, 'coachChat.report.done')}</Text>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t(language, 'coachChat.report.title')}
                        hitSlop={10}
                        onPress={() => setReportingId(message.id)}
                        style={({ pressed }) => [styles.reportTap, pressed && styles.pressed]}
                      >
                        <Text style={styles.reportLink}>{t(language, 'coachChat.report.link')}</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              </View>
            ),
          )}

          {asking ? (
            <View style={styles.bubbleRow}>
              <View style={[styles.coachBubble, styles.thinkingBubble]}>
                <ActivityIndicator size="small" color={theme.purple} />
                <Text style={styles.thinkingText}>{t(language, 'coachChat.thinking')}</Text>
              </View>
            </View>
          ) : null}

          </>
          )}
        </ScrollView>

        {/* The suggestion rail lives outside the thread's scroll view, so it
            needs its own gate: it sat under the notice as three more things to
            tap instead of reading. */}
        {mustAcknowledgeOnline || programmeOnly ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.quickAsksRail}
          contentContainerStyle={styles.quickAsks}
        >
          {quickAskKeys.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => void send(t(language, key))}
              style={({ pressed }) => [styles.quickAsk, pressed && styles.pressed]}
            >
              <Text style={styles.quickAskText}>{t(language, key)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        )}

        {proUnlocked && !canAsk ? (
          <Text style={styles.resetNote}>
            {quotaReset.inDays === 1
              ? t(language, 'coachChat.quotaResetTomorrow')
              : t(language, 'coachChat.quotaResetIn', {
                  date: formatShortDate(quotaReset.at.toISOString(), language),
                  count: quotaReset.inDays,
                })}
          </Text>
        ) : null}

        <View
          style={[
            styles.composerWrap,
            // The keyboard replaces the floating tab bar as the thing under
            // the composer, so its measured height replaces the reserve.
            keyboardHeight > 0 && { paddingBottom: keyboardHeight + spacing.sm },
          ]}
        >
          {/* Free: "The coach answers on Pro" plus a lock glyph was two ways
              of saying the same thing. The sentence stays, the glyph goes, and
              the whole row is the tap that opens the paywall (design: GAINER
              Pro screens, 04). */}
          {!proUnlocked ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'coachChat.placeholderFree')}
              onPress={onOpenPremium}
              style={({ pressed }) => [styles.composer, styles.composerSpent, styles.composerLocked, pressed && styles.pressed]}
            >
              <Text style={styles.composerLockedText}>{t(language, 'coachChat.placeholderFree')}</Text>
            </Pressable>
          ) : (
          <View style={[styles.composer, !canAsk && styles.composerSpent]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              // Three states, not two. "0 left this week" was written for a
              // free tier that had a weekly allowance; a free reader now has
              // no counter at all, so telling them a count of zero describes a
              // limit they were never inside.
              placeholder={t(
                language,
                canAsk
                  ? 'coachChat.placeholder'
                  : proUnlocked
                    ? 'coachChat.placeholderSpent'
                    : 'coachChat.placeholderFree',
              )}
              placeholderTextColor={theme.faint}
              selectionColor={theme.highlight}
              style={styles.input}
              // Wraps and grows, like every messaging app the reader already
              // uses. A single line meant a long question scrolled sideways
              // out of sight while it was being written. The cap keeps a
              // pasted paragraph from eating the thread; past it, it scrolls.
              multiline
              textAlignVertical="top"
              // The endpoint's own limit. Past it a question was refused as
              // oversized and answered offline, with nothing to say why
              // (server audit, 2026-09-21).
              maxLength={AI_COACH_MAX_PROMPT_CHARS}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'coach.send')}
              onPress={() => void send(draft)}
              style={({ pressed }) => [styles.sendButton, !canAsk && styles.sendButtonSpent, pressed && styles.pressed]}
            >
              {canAsk ? (
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12h14M13 6l6 6-6 6" stroke={theme.onHighlight} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ) : (
                // Pro with the month's questions spent: the arrow stays, dimmed
                // — the lock glyph belonged to the free row, which is now a
                // sentence and a tap.
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12h14M13 6l6 6-6 6" stroke={theme.onHighlight} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
            </Pressable>
          </View>
          )}
        </View>
      </View>
      <CoachReportSheet
        visible={reportingId !== null}
        language={language}
        bottomInset={sheetInsets.bottom}
        onClose={() => setReportingId(null)}
        onSend={async (reason: CoachReportReason) => {
          const reported = messages.find((message) => message.id === reportingId);
          if (!reported?.advice) {
            return false;
          }
          const arrived = await reportAiCoachAnswer(reason, reported.advice);
          if (arrived) {
            // Marked only once the server said the report arrived.
            setMessages((current) =>
              current.map((message) => (message.id === reported.id ? { ...message, reported: true } : message)),
            );
            setReportingId(null);
          }
          return arrived;
        }}
      />
    </View>
  );
}

/**
 * The open frame question, answered by tapping.
 *
 * A known answer is the marked chip, with one line saying where it came from
 * — the exception is the one worth labelling. It is still a tap: confirming
 * it is the reader's answer, not the app's. The last question is free text,
 * with a field of its own rather than the composer below, which on the free
 * tier and out of quota is a paywall row instead of a field.
 */
function IntakeQuestion({
  intro,
  state,
  language,
  styles,
  placeholderColor,
  selectionColor,
  draft,
  onChangeDraft,
  onAnswer,
}: {
  intro: string;
  state: ProgramIntakeState;
  language: AppLanguage;
  styles: ReturnType<typeof makeStyles>;
  placeholderColor: string;
  selectionColor: string;
  draft: string;
  onChangeDraft: (text: string) => void;
  onAnswer: (value: string) => void;
}) {
  const step = currentProgramIntakeStep(state);
  if (step === null) {
    return null;
  }
  const preset = programIntakePresetValue(state, step);
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.coachBubble, styles.offerBubble]}>
        {intro ? <Text style={styles.coachText}>{intro}</Text> : null}
        <Text style={styles.coachText}>{t(language, PROGRAM_INTAKE_QUESTION_KEYS[step])}</Text>
        {step === 'extra' ? (
          <>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={t(language, 'programIntake.extraPlaceholder')}
              placeholderTextColor={placeholderColor}
              selectionColor={selectionColor}
              style={styles.intakeInput}
              multiline
              textAlignVertical="top"
              maxLength={PROGRAM_INTAKE_EXTRA_MAX_CHARS}
            />
            <View style={styles.offerActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onAnswer('')}
                style={({ pressed }) => [styles.offerGhost, pressed && styles.pressed]}
              >
                <Text style={styles.offerGhostText}>{t(language, 'programIntake.skip')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !draft.trim() }}
                disabled={!draft.trim()}
                onPress={() => onAnswer(draft)}
                style={({ pressed }) => [styles.offerCta, !draft.trim() && styles.intakeDisabled, pressed && styles.pressed]}
              >
                <Text style={styles.offerCtaText}>{t(language, 'programIntake.done')}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {preset ? (
              <Text style={styles.offerNote}>
                {t(language, state.editing ? 'programIntake.presetEdit' : 'programIntake.preset')}
              </Text>
            ) : null}
            <View style={styles.intakeChips}>
              {programIntakeOptions(step).map((option) => {
                const known = option.value === preset;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityLabel={programIntakeAnswerText(step, option.value, language)}
                    accessibilityState={{ selected: known }}
                    onPress={() => onAnswer(option.value)}
                    style={({ pressed }) => [
                      styles.quickAsk,
                      styles.intakeChip,
                      known && styles.intakeChipKnown,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.quickAskText, known && styles.intakeChipKnownText]}>
                      {known ? '✓ ' : ''}
                      {t(language, option.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * What the app read out of the brief, before it builds anything.
 *
 * Deliberately the REQUEST and not the week. The week is composed after this
 * offer is accepted, and on the live path it comes back from the model — so
 * drawing a week here would be drawing one the build might not produce. The
 * brief stays underneath in full: a summary that hides the sentence it was
 * derived from cannot be checked against it, and the parser does not read
 * everything a person writes.
 */
function ComposeOutline({
  brief,
  language,
  styles,
}: {
  brief: string;
  language: AppLanguage;
  styles: ReturnType<typeof makeStyles>;
}) {
  const outline = useMemo(() => outlineProgrammeBrief(parseProgrammeBrief(brief)), [brief]);

  const lines: string[] = [];
  if (outline.requestedDays !== null && outline.plannedDays !== null) {
    // The ceiling, said out loud. Quoting the request back as if it were met
    // is the app putting a number in the reader's mouth.
    lines.push(
      t(language, 'coachChat.compose.outlineDaysTrimmed', {
        requested: outline.requestedDays,
        planned: outline.plannedDays,
      }),
    );
  } else if (outline.plannedDays !== null) {
    lines.push(t(language, 'coachChat.compose.outlineDays', { count: outline.plannedDays }));
  }
  if (outline.sessionMinutes !== null) {
    lines.push(t(language, 'coachChat.compose.outlineMinutes', { count: outline.sessionMinutes }));
  }
  if (outline.lifts.length > 0) {
    lines.push(
      t(language, 'coachChat.compose.outlineLifts', {
        names: outline.lifts.map((lift) => exerciseNameLabel(language, lift)).join(', '),
      }),
    );
  }
  if (outline.focusAreas.length > 0) {
    lines.push(
      t(language, 'coachChat.compose.outlineFocus', {
        areas: outline.focusAreas.map((area) => getFocusAreaLabel(area, language)).join(', '),
      }),
    );
  }

  const briefLine = (
    <Text style={styles.outlineBrief}>{t(language, 'coachChat.compose.outlineBrief', { brief })}</Text>
  );

  // Nothing was read: a heading over an empty box says the app understood
  // nothing, which is worse than the sentence on its own.
  if (!hasProgrammeBriefOutline(outline)) {
    return briefLine;
  }

  return (
    <View style={styles.outlineCard}>
      <Text style={styles.outlineTitle}>{t(language, 'coachChat.compose.outlineTitle')}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.outlineLine}>
          {line}
        </Text>
      ))}
      {briefLine}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 14,
  },
  headerTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: theme.ink,
  },
  headerSub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 1,
  },
  // A count, and nothing to press — see the header. It once carried "More
  // with Pro →" to readers who already had the only tier there is.
  headerQuota: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
    marginTop: 2,
  },
  // A gradient, not a disc: a flat circle with a radius is a shape, and it
  // reads as one. Sized in pixels because a %-sized Svg does not stretch on
  // Android (the trap the unlock screen paid for).
  topLight: {
    position: 'absolute',
    top: -TOP_LIGHT * 0.34,
    left: -TOP_LIGHT * 0.18,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  // Bottom-anchored: a half-empty thread starting at the top leaves a dead
  // middle, and the first thing you read should sit where the next one will.
  thread: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 20,
  },
  onlineCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  /**
   * A block inside the card, separated by a rule rather than by a second card.
   * The notice and the three yeses belong to one moment; two boxes would say
   * they are two decisions when only the second one is a decision at all.
   */
  keepBlock: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 8,
  },
  keepTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  keepBody: {
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  keepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  keepBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepBoxOn: {
    backgroundColor: theme.highlight,
    borderColor: theme.highlight,
  },
  keepTick: {
    color: theme.onHighlight,
    fontSize: 13,
    fontWeight: '900',
  },
  keepLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  keepNote: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
  },
  onlineTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  onlineBody: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  onlineButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.highlight,
  },
  onlineButtonText: {
    color: theme.onHighlight,
    fontSize: 13.5,
    fontWeight: '800',
  },
  offerBubble: {
    gap: 10,
  },
  catalogName: { color: theme.ink, fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 2 },
  catalogMeta: { color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  // Full width, unlike every other coach message: a four-day week narrowed to
  // bubble width is the shape that put this on its own screen to begin with.
  proposalWrap: {
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  offerActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  offerGhost: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  // A quiet line under the offer, not a badge: it qualifies the button below
  // rather than competing with it.
  outlineCard: {
    marginTop: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 4,
  },
  outlineTitle: {
    color: theme.faint,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  outlineLine: {
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
  },
  // The sentence it was read from, kept but quieter.
  outlineBrief: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 6,
  },
  offerNote: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  intakeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Wide enough that a one-digit day count is still a comfortable target.
  intakeChip: {
    minWidth: 48,
    alignItems: 'center',
  },
  intakeChipKnown: {
    borderColor: theme.highlight,
    borderWidth: 1.5,
  },
  intakeChipKnownText: {
    fontWeight: '800',
  },
  intakeInput: {
    minHeight: 64,
    maxHeight: 132,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.ink,
  },
  intakeDisabled: {
    opacity: 0.45,
  },
  offerGhostText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  offerCta: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.highlight,
  },
  offerCtaText: {
    color: theme.onHighlight,
    fontSize: 13,
    fontWeight: '800',
  },
  answerSection: {
    marginTop: 10,
    gap: 4,
  },
  answerSectionLabel: {
    // Muted, not faint: the headings read as washed out on the emulator
    // (user, 2026-09-28: "fonttia tummemmaksi, on aika haalea").
    color: theme.muted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  answerLine: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  answerMark: {
    color: theme.highlight,
    fontSize: 15,
    lineHeight: 21.5,
    fontWeight: '800',
    minWidth: 16,
  },
  answerLineText: {
    flex: 1,
    color: theme.ink,
    // The takeaway's weight: at the default 400 the lines under it read as
    // grey beside it, though both are ink (user, 2026-09-28).
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 21.5,
  },
  headerTitleRow: {
    flexDirection: 'row',
    // Wraps: "Vinha-valmentaja" and two pills do not fit a 360 dp phone
    // on one line, and a clipped name is worse than a second line.
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  // Small and quiet. It is a state, not a warning — the only time it should
  // catch the eye is when it disagrees with what the reader expects.
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  betaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.purple,
  },
  betaText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.purple,
  },
  modeBadgeOnline: {
    borderColor: theme.border,
    backgroundColor: 'transparent',
  },
  modeBadgeOffline: {
    borderColor: theme.highlight,
    backgroundColor: 'transparent',
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modeDotOnline: {
    // Green, not the accent. Orange means pressable in this app, and a state
    // badge is not a button — it promised a tap that does not exist.
    backgroundColor: theme.green,
  },
  modeDotOffline: {
    // Hollow rather than a second colour: a red light would read as broken,
    // and an offline answer is a degraded answer, not a failure.
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: theme.faint,
  },
  modeText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  modeTextOnline: {
    color: theme.faint,
  },
  modeTextOffline: {
    color: theme.faint,
  },
  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bubbleRowMe: {
    justifyContent: 'flex-end',
  },
  // The coach gets no bubble at all: it is the voice of the screen, not a
  // participant in it. Only the user's own words are enclosed.
  //
  // `flex: 1` and not just a maxWidth. Without it the block is only as wide as
  // its widest line, and an answer whose takeaway is one short sentence
  // squeezed every reason and step under it into that same narrow column —
  // the same text, three times as tall, and a screen of scrolling to read it
  // (user, 2026-08-25, on the offline answers where the takeaway is shortest).
  coachBubble: {
    flex: 1,
    maxWidth: '96%',
  },
  meBubble: {
    maxWidth: '82%',
    // The white-label violet: the reader's own words are white, and white on
    // the dark theme's `purple` was 3.49:1 (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    borderRadius: 20,
    borderBottomRightRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  coachText: {
    fontSize: 16.5,
    fontWeight: '500',
    letterSpacing: -0.15,
    color: theme.ink,
    lineHeight: 25.5,
  },
  meText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 22.5,
  },
  // A 44 pt target around small text: the link is quiet, not hard to hit.
  reportTap: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginTop: 2,
    marginRight: -8,
    marginBottom: -12,
  },
  reportLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.muted,
  },
  evidence: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  thinkingText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
  },
  lockWrap: {
    marginTop: 2,
  },
  // Every locked answer after the first: one line, the same violet as the
  // card's CTA, no card around it.
  lockedCollapsed: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  lockedCollapsedText: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.purple,
  },
  composerLocked: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerLockedText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
    paddingVertical: 15,
  },
  // A link, not a card: the row title only repeated the session name that the
  // context line already carries.
  analysisLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -8,
  },
  analysisCta: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.highlight,
    marginTop: 4,
  },
  quickAsksRail: {
    flexGrow: 0,
    flexShrink: 0,
  },
  quickAsks: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  // A surface, not a tint: purpleLight sits within a few points of the light
  // background, which left the chips reading as floating text.
  quickAsk: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  quickAskText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.highlight,
  },
  resetNote: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  composerWrap: {
    paddingHorizontal: 20,
    // The floating bar is 88 tall; the reserve added another 32 on top, which
    // is why the field sat well above it with dead space underneath.
    paddingBottom: layout.bottomTabBarHeight + spacing.sm,
  },
  composer: {
    minHeight: 50,
    maxHeight: 132,
    flexDirection: 'row',
    // Bottom, not centre: as the field grows the send button stays on the
    // last line rather than drifting to the middle of a paragraph.
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 15,
    paddingLeft: 15,
    paddingRight: 6,
  },
  composerSpent: {
    backgroundColor: theme.surfaceSoft,
  },
  input: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: theme.ink,
    padding: 0,
    // Android centres a one-line multiline field oddly without this, and the
    // vertical padding is what keeps a grown field off its own border.
    paddingVertical: 14,
    maxHeight: 116,
  },
  sendButton: {
    width: 38,
    height: 38,
    // The composer aligns its children to the bottom so the button rides the
    // last line of a grown field — but at one line that parked the arrow low
    // (user, 2026-08-25). Half the 50-38 slack underneath re-centres it, and
    // a grown field still keeps the button on its bottom edge.
    marginBottom: 6,
    borderRadius: 12,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonSpent: {
    backgroundColor: theme.faint,
  },
  pressed: {
    opacity: 0.85,
  },
});
