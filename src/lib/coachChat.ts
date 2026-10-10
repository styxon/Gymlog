import { FatigueResult } from './fatigueModel';
import { exerciseNameLabel } from './exerciseNameLabel';
import { formatShortDate } from './format';
import { t } from './i18n';
import { WeeklyReadRow } from './proInsights';
import { localizeSessionName } from './sessionNameLabel';
import { AICoachTrainingContext } from '../types/aiCoach';
import { AppLanguage } from '../types/models';
import { removeTrailingZeros } from './format';

/**
 * The AI tab's opening state (design: Vinha AI Tab).
 *
 * The design's rule for the middle button is "the door is always open — the
 * quota runs out, not the quality", and the chat has to prove it read the log
 * before the user types anything. Everything here is deterministic: the
 * context strip, the opening line and the Pro "what I noticed" card are
 * computed from logged sets, never from a model call. That keeps the most
 * expensive-looking part of the app free to render.
 */

export type ChipTone = 'plan' | 'warn' | 'alert';

export interface CoachContextChip {
  key: string;
  label: string;
  tone: ChipTone;
}

export interface CoachNoticedItem {
  key: string;
  tone: ChipTone;
  title: string;
  body: string;
  /** The question this item asks on the user's behalf when tapped. */
  question: string;
}

export interface CoachChatIntroInput {
  /** Today's planned session title, already localized. Null on a rest day. */
  todaySessionTitle: string | null;
  /** The next session in the rotation, whatever day it lands on. */
  nextSessionTitle?: string | null;
  /**
   * Whether a programme is running at all.
   *
   * A reader with no programme used to get no opening offer: every branch
   * below is about a session or a lift, and they have neither. That is exactly
   * the reader for whom the chat's newest capability — building a week from a
   * sentence — is the useful first thing to say, so the empty case stops being
   * empty rather than the offer being bolted onto readers who are mid-block.
   */
  hasProgramme?: boolean;
  sessionsThisWeek: number;
  weeklyRead: WeeklyReadRow[];
  fatigue: FatigueResult | null;
}

export interface CoachContextRow {
  key: 'lastSession' | 'lift' | 'rhythm';
  label: string;
  value: string;
}

/**
 * One slide of the opening ticker. A slide with a `question` is an offer —
 * tapping it asks the coach on the reader's behalf; a slide without one is
 * a fact from the log, read out and left alone.
 */
export interface CoachTickerRow {
  key: string;
  label: string;
  value: string;
  question?: string;
  /** The button text for this slide's question; the ticker's default otherwise. */
  askLabel?: string;
  tone?: ChipTone;
}

/**
 * What the coach can already see, before you type anything.
 *
 * The tab opened onto most of a screen of nothing: the greeting sat at the
 * bottom and the middle was empty. Filling it with an illustration would be
 * noise in the one place there could be proof, so it is filled with the
 * reader's own numbers instead â which is also the claim Pro is sold on.
 *
 * Every row is read from the log. A row whose data does not exist is left out
 * rather than shown empty, so a fresh account gets a short readout or none,
 * and never a made-up one.
 */
export function buildCoachContextReadout(
  context: AICoachTrainingContext,
  language: AppLanguage,
): CoachContextRow[] {
  const rows: CoachContextRow[] = [];

  const session = context.recentCompletedSessions[0];
  if (session) {
    const detail = [
      formatShortDate(session.performedAt, language),
      session.setsCompleted !== null
        ? session.setsCompleted === 1
          ? t(language, 'coachChat.readout.setsOne')
          : t(language, 'coachChat.readout.sets', { count: session.setsCompleted })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    rows.push({
      key: 'lastSession',
      label: t(language, 'coachChat.readout.lastSession'),
      // The session's stored name is the catalog's English ("Day 2: Deadlift &
      // Press"); the lift row below already translated its lift, and this row
      // read English beside it. Same treatment History gives the same name.
      value: [localizeSessionName(session.title, language), detail].filter(Boolean).join(' · '),
    });
  }

  const topSet = context.latestTopSets[0];
  if (topSet) {
    // latestReps is every set's reps as a list ("5,5,5,5"). The top set is one
    // set, so the row takes the first rather than printing the whole session.
    const reps = `${topSet.reps}`.split(',')[0]?.trim();
    const name = exerciseNameLabel(language, topSet.exerciseName);
    rows.push({
      key: 'lift',
      label: t(language, 'coachChat.readout.lift'),
      value:
        topSet.weight !== null
          ? `${name} · ${removeTrailingZeros(topSet.weight)} ${context.unitPreference} × ${reps}`
          : `${name} · ${reps}`,
    });
  }

  if (context.sessionsLast30Days > 0) {
    rows.push({
      key: 'rhythm',
      label: t(language, 'coachChat.readout.rhythm'),
      value: t(language, 'coachChat.readout.rhythmValue', {
        week: context.sessionsThisWeek,
        month: context.sessionsLast30Days,
      }),
    });
  }

  return rows;
}

/**
 * The strip above the thread. At most three chips, and each one is a fact:
 * what is planned today, which lift is stuck, whether recovery is running low.
 * An empty strip is correct for a user with no history — better than inventing
 * a status to fill the row.
 */
export function buildCoachContextChips(
  input: CoachChatIntroInput,
  language: AppLanguage,
): CoachContextChip[] {
  const chips: CoachContextChip[] = [];

  if (input.todaySessionTitle) {
    chips.push({
      key: 'today',
      tone: 'plan',
      label: t(language, 'coachChat.chip.today', { session: input.todaySessionTitle }),
    });
  }

  const stalled = input.weeklyRead.find((row) => row.tone === 'amber' && row.key !== 'recovery');
  if (stalled) {
    chips.push({ key: stalled.key, tone: 'warn', label: `${stalled.name} · ${stalled.status}` });
  }

  // Recovery only speaks when the fatigue model is confident — the same rule
  // the weekly read follows, so the two cannot disagree.
  const recovery = input.weeklyRead.find((row) => row.key === 'recovery');
  if (recovery && recovery.tone !== 'green') {
    chips.push({ key: 'recovery', tone: 'alert', label: `${recovery.name} · ${recovery.status}` });
  }

  return chips.slice(0, 3);
}

/**
 * A lift's name for a line, in both the shapes a template may need: lower
 * case where it sits inside the sentence ("What should I do about my leg
 * press?"), capitalised where it opens one. Finnish cannot take a name after
 * "asialle" without inflecting it, and a name the app does not own cannot be
 * inflected safely, so the Finnish lines put the name first instead —
 * "Mitä minun pitäisi tehdä asialle jalkaprässi?" came back from the chip
 * (#bugs, 2026-09-30), and "jalkaprässi ei ole liikkunut" opened a sentence
 * in lower case.
 */
export function nameVars(key: string, name: string): Record<string, string> {
  const trimmed = name.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return { [key]: trimmed.toLowerCase(), [key.charAt(0).toUpperCase() + key.slice(1)]: capitalised };
}

/**
 * Whether the coach may say the next session "is on the plan today".
 *
 * Only a session still to be done today: the rhythm puts one on today and it
 * is not yet trained, or the reader picked one for today (a pick stands only
 * until it is trained). After today's workout the next session is the next
 * one, not today's, and the coach says so with the rest-day line (bug hunt 11,
 * home).
 */
export function sessionIsOnPlanToday(input: {
  hasNextSession: boolean;
  pickStands: boolean;
  trainedToday: boolean;
  scheduledToday: boolean;
}): boolean {
  if (!input.hasNextSession) {
    return false;
  }
  return input.pickStands || (input.scheduledToday && !input.trainedToday);
}

/**
 * The line the coach opens with. It names what it can see and offers the two
 * obvious next moves; it never claims a trend it has not got the data for.
 */
export function buildCoachOpeningLine(input: CoachChatIntroInput, language: AppLanguage): string {
  const stalled = input.weeklyRead.find((row) => row.tone === 'amber' && row.key !== 'recovery');

  if (stalled && input.todaySessionTitle) {
    return t(language, 'coachChat.open.stalledAndPlan', {
      count: input.sessionsThisWeek,
      lift: stalled.name.toLowerCase(),
      session: input.todaySessionTitle,
    });
  }
  if (stalled) {
    return t(language, 'coachChat.open.stalled', nameVars('lift', stalled.name));
  }
  if (input.todaySessionTitle) {
    return t(language, 'coachChat.open.plan', { session: input.todaySessionTitle });
  }
  if (input.nextSessionTitle) {
    // A rest day with a programme running: say so, and name what is next
    // rather than pretending the next session is today's.
    return t(language, 'coachChat.open.rest', { session: input.nextSessionTitle });
  }
  if (input.sessionsThisWeek > 0) {
    return t(language, 'coachChat.open.logged', { count: input.sessionsThisWeek });
  }
  return t(language, 'coachChat.open.fresh');
}

/**
 * The Pro difference in the design is not "unlimited" — it is initiative: the
 * coach speaks first. These are the findings it opens with, taken straight
 * from the weekly read so the card can never claim something the Progress tab
 * does not also show.
 *
 * The design's card ends in "Apply both to next week". That button is NOT
 * built here: nothing in the app can rewrite a programme (every coach action
 * is a navigation link), so a button claiming it would be the exact dead
 * promise this codebase keeps having to remove. Each item instead asks the
 * coach about itself, which is real.
 */
export function buildCoachNoticed(
  weeklyRead: WeeklyReadRow[],
  language: AppLanguage,
): CoachNoticedItem[] {
  const items: CoachNoticedItem[] = [];

  for (const row of weeklyRead) {
    if (items.length >= 2) {
      break;
    }
    if (row.tone === 'amber' || row.tone === 'red') {
      items.push({
        key: row.key,
        tone: row.tone === 'red' ? 'alert' : 'warn',
        title: `${row.name} · ${row.status}`,
        body: row.locked ? row.locked.body : row.meta,
        question: t(language, 'coachChat.ask.about', nameVars('subject', row.name)),
      });
    }
  }

  // A green row is worth opening with too — progress the user has earned is a
  // finding, not filler. Only used when there is room left.
  for (const row of weeklyRead) {
    if (items.length >= 2) {
      break;
    }
    if (row.tone === 'green' && row.key !== 'recovery') {
      items.push({
        key: row.key,
        tone: 'plan',
        title: `${row.name} · ${row.status}`,
        body: row.meta,
        question: t(language, 'coachChat.ask.about', nameVars('subject', row.name)),
      });
    }
  }

  return items;
}

/**
 * Everything the coach has to say before the first question, as one rotating
 * sequence — today's line first, then what it noticed, then the readout.
 *
 * These were three stacked surfaces (ticker, "things I noticed" card, opening
 * bubble) and together they pushed the conversation off the screen (user,
 * 2026-08-23). Folded into one stage: the noticed items keep their question,
 * so the tap that used to live on the card lives on the slide.
 */
export function buildCoachOpeningRows(input: {
  openingLine: string;
  /** The one-tap answer to the opening line's offer, when it makes one. */
  offer?: { question: string; askLabel: string } | null;
  noticed: CoachNoticedItem[];
  readout: CoachContextRow[];
  language: AppLanguage;
}): CoachTickerRow[] {
  const rows: CoachTickerRow[] = [];
  if (input.openingLine.trim()) {
    rows.push({
      key: 'today',
      label: t(input.language, 'coachChat.readout.today'),
      value: input.openingLine,
      question: input.offer?.question,
      askLabel: input.offer?.askLabel,
    });
  }
  for (const item of input.noticed) {
    rows.push({
      key: `noticed-${item.key}`,
      label: t(input.language, 'coachChat.readout.noticed'),
      value: `${item.title} — ${item.body}`,
      question: item.question,
      tone: item.tone,
    });
  }
  for (const row of input.readout) {
    rows.push({ key: row.key, label: row.label, value: row.value });
  }
  return rows;
}

/**
 * The action behind the opening line. Every variant that ends in an offer
 * ("want me to walk through it?") has to be answerable in one tap, or the
 * slide is a promise with no button — which is exactly what shipped first
 * (user, 2026-08-23: "there is no option to walk through it"). The variants
 * that say "ask me anything" have the input box as their answer.
 */
export function buildCoachOpeningOffer(
  input: CoachChatIntroInput,
  language: AppLanguage,
): { question: string; askLabel: string } | null {
  const stalled = input.weeklyRead.find((row) => row.tone === 'amber' && row.key !== 'recovery');
  if (input.todaySessionTitle) {
    // Plan today wins even beside a stalled lift: the line names both, and
    // the one tap that does something today is the session.
    return {
      question: t(language, 'coachChat.ask.walkThrough', { session: input.todaySessionTitle }),
      askLabel: t(language, 'coachChat.offer.walkThrough'),
    };
  }
  if (input.nextSessionTitle && !stalled) {
    // Rest day: the offer is the NEXT session, and both the question and the
    // button say so. "Walk me through it" on a rest day read as an invitation
    // to train today — the line said rest and the button said go, and the
    // button is what a reader believes (user, 2026-08-25).
    return {
      question: t(language, 'coachChat.ask.walkThroughNext', { session: input.nextSessionTitle }),
      askLabel: t(language, 'coachChat.offer.previewNext'),
    };
  }
  if (stalled) {
    return {
      question: t(language, 'coachChat.ask.about', nameVars('subject', stalled.name)),
      askLabel: t(language, 'coachChat.offer.lookAtIt'),
    };
  }
  // Nothing to train and nothing to read: the one branch that used to return
  // null. Asking for a programme is the thing this reader can actually do, and
  // the chat can now build one — so the offer says so once, here, instead of
  // sitting on every screen as a permanent advert.
  if (input.hasProgramme === false) {
    return {
      question: t(language, 'coachChat.ask.buildProgramme'),
      askLabel: t(language, 'coachChat.offer.buildProgramme'),
    };
  }
  return null;
}
