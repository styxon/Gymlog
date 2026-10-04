import { applyDecimalSeparator, formatDate } from './format';
import { I18nKey, t } from './i18n';
import { LifetimeTrainingSummary } from './lifetimeSummary';
import { MilestoneLedger, ReachedMilestone } from './milestoneFacts';
import {
  MilestoneFamily,
  MilestoneTier,
  MilestoneTotals,
  ProfileMilestone,
  MAX_PROFILE_MILESTONES,
  volumeInUnit,
} from './profileMilestones';
import { AppLanguage, UnitPreference } from '../types/models';

/**
 * A NEXT MILESTONE row as the screen prints it: title, the remainder in the
 * corner, the bar's fill, and the meta line with the raw numbers.
 *
 * Copy is a distance, not a promise: "6 kg to go" is what is left, "994 kg
 * of 1 000 kg" is what was done. Nothing here says what the reader will
 * gain.
 */
export interface ProfileMilestoneRow {
  key: string;
  title: string;
  /** Empty for the first-session row, which has nothing to count down. */
  remainder: string;
  /** 4–100: an empty bar is still a bar, at four percent; zero data is zero. */
  fillPercent: number;
  meta: string;
}

/** "1 000 kg", "2 500 lb" — whole numbers, thousands grouped with a space. */
export function formatMilestoneVolume(value: number, unitPreference: UnitPreference): string {
  return `${groupThousands(Math.round(Math.max(0, value)))} ${unitPreference === 'lb' ? 'lb' : 'kg'}`;
}

/**
 * The same, rounded DOWN — for the figure the reader has.
 * Rounding it up printed "1 000 kg of 1 000 kg" beside "1 kg to go".
 */
export function formatMilestoneVolumeReached(value: number, unitPreference: UnitPreference): string {
  return `${groupThousands(Math.floor(Math.max(0, value)))} ${unitPreference === 'lb' ? 'lb' : 'kg'}`;
}

/** "12 500" — a whole count, thousands grouped with a space. */
export function formatMilestoneCount(value: number): string {
  return groupThousands(Math.round(Math.max(0, value)));
}

/** "3.5" / "3,5" — hours and kilometres, to a tenth, in the app's decimal mark. */
export function formatMilestoneDecimal(value: number): string {
  const tenths = Math.round(Math.max(0, value) * 10) / 10;
  return applyDecimalSeparator(Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1));
}

/** Thousands grouped with a thin space, as the card has always printed them. */
function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * 4–100. A rung that is not reached never draws a full bar: 999.6 of 1 000 kg
 * rounds to 100 %, and the row then claimed the target was both reached and
 * one kilo away. Only progress of exactly 1 fills it, and that never happens
 * here — a reached rung has already advanced to the next one.
 */
function fillPercent(progress: number): number {
  const percent = Math.round(progress * 100);
  return Math.max(4, Math.min(progress >= 1 ? 100 : 99, percent));
}

/**
 * The Profile card's rows: the ledger's front row, nearest first, capped.
 *
 * The card used to build its own rows from its own input model — lifetime +
 * recordCount + totals — while the page built them from the facts. They read
 * the same log through two paths and agreed by coincidence; a change to
 * either could have shown "4 of 5" on one and "3 of 5" on the other for the
 * same rung. Now there is one path and the card is its head.
 */
export function milestoneCardRows(input: {
  ledger: MilestoneLedger;
  lifetime: LifetimeTrainingSummary;
  unitPreference: UnitPreference;
  language: AppLanguage;
}): ProfileMilestoneRow[] {
  return buildMilestoneLedgerRows(input).upcoming.slice(0, MAX_PROFILE_MILESTONES);
}

function allReachedRow(language: AppLanguage): ProfileMilestoneRow[] {
  return [
    {
      key: 'all',
      title: t(language, 'profile.milestone.all.title'),
      remainder: '',
      fillPercent: 100,
      meta: t(language, 'profile.milestone.all.meta'),
    },
  ];
}

/** The rung's name — the same words on the card, the page and the reached list. */
export function milestoneTitle(
  family: MilestoneFamily,
  target: number,
  unitPreference: UnitPreference,
  language: AppLanguage,
): string {
  switch (family) {
    case 'volume':
      return t(language, 'profile.milestone.volume.title', { target: formatMilestoneVolume(target, unitPreference) });
    case 'sessions':
      return t(language, target === 1 ? 'profile.milestone.sessions.titleOne' : 'profile.milestone.sessions.title', { target });
    case 'streak':
      return t(language, 'profile.milestone.streak.title', { target });
    case 'records':
      return t(language, target === 1 ? 'profile.milestone.records.titleOne' : 'profile.milestone.records.title', { target });
    case 'weeks':
      return t(language, 'profile.milestone.weeks.title', { target });
    case 'reps':
      return t(language, 'profile.milestone.reps.title', { target: formatMilestoneCount(target) });
    case 'sets':
      return t(language, 'profile.milestone.sets.title', { target: formatMilestoneCount(target) });
    case 'exercises':
      return t(language, 'profile.milestone.exercises.title', { target });
    case 'hours':
      return t(language, target === 1 ? 'profile.milestone.hours.titleOne' : 'profile.milestone.hours.title', { target });
    case 'bodyweight':
      return t(language, target === 1 ? 'profile.milestone.bodyweight.titleOne' : 'profile.milestone.bodyweight.title', {
        target,
      });
    case 'cardio':
      return t(language, target === 1 ? 'profile.milestone.cardio.titleOne' : 'profile.milestone.cardio.title', { target });
    case 'distance':
      return t(language, 'profile.milestone.distance.title', { target });
  }
}

const TIER_KEY: Record<MilestoneTier, I18nKey> = {
  easy: 'milestones.tier.easy',
  medium: 'milestones.tier.medium',
  hard: 'milestones.tier.hard',
};

export function milestoneTierLabel(tier: MilestoneTier, language: AppLanguage): string {
  return t(language, TIER_KEY[tier]);
}

function describe(
  item: ProfileMilestone,
  input: { lifetime: Pick<LifetimeTrainingSummary, 'totalVolumeKg' | 'weeksSinceStart' | 'bestWeekStreak'>; unitPreference: UnitPreference; language: AppLanguage },
): ProfileMilestoneRow {
  const { language, unitPreference, lifetime } = input;
  const key = `${item.family}-${item.target}`;
  const title = milestoneTitle(item.family, item.target, unitPreference, language);
  const fill = fillPercent(item.progress);
  const countdown = t(language, 'profile.milestone.toGo', { count: item.remaining });
  const decimal = formatMilestoneDecimal;

  switch (item.family) {
    case 'volume': {
      const current = volumeInUnit(lifetime.totalVolumeKg, unitPreference);
      return {
        key,
        title,
        remainder: t(language, 'profile.milestone.volume.toGo', {
          amount: formatMilestoneVolume(item.remaining, unitPreference),
        }),
        fillPercent: fill,
        meta: t(language, 'profile.milestone.volume.meta', {
          current: formatMilestoneVolumeReached(current, unitPreference),
          target: formatMilestoneVolume(item.target, unitPreference),
        }),
      };
    }
    case 'sessions': {
      // "started N weeks ago": the weeks before this one. weeksSinceStart is
      // strength-only and reads 0 for a reader whose log is a weigh-in or a
      // run — saying "you started this week" to someone who has never done a
      // strength session is a claim about a week that did not happen.
      const weeksAgo = lifetime.weeksSinceStart - 1;
      const meta =
        // weeksSinceStart now starts at the first run too, so "no strength
        // session yet" is item.current, not the week count (bug hunt, 2026-10-04).
        lifetime.weeksSinceStart <= 0 || item.current <= 0
          ? t(language, 'profile.milestone.sessions.metaPlain', { current: item.current, target: item.target })
          : weeksAgo <= 0
            ? t(language, 'profile.milestone.sessions.metaOneWeek', { current: item.current, target: item.target })
            : weeksAgo === 1
              ? t(language, 'profile.milestone.sessions.metaLastWeek', { current: item.current, target: item.target })
              : t(language, 'profile.milestone.sessions.meta', { current: item.current, target: item.target, weeks: weeksAgo });
      return { key, title, remainder: countdown, fillPercent: fill, meta };
    }
    case 'streak':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta:
          lifetime.bestWeekStreak <= 0
            ? t(language, 'profile.milestone.streak.metaNone')
            : t(
                language,
                lifetime.bestWeekStreak === 1 ? 'profile.milestone.streak.metaOne' : 'profile.milestone.streak.meta',
                { best: lifetime.bestWeekStreak },
              ),
      };
    case 'records':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta: t(language, 'profile.milestone.records.meta', { current: item.current, target: item.target }),
      };
    case 'weeks':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta: t(language, 'profile.milestone.weeks.meta', { current: item.current, target: item.target }),
      };
    case 'reps':
      return {
        key,
        title,
        remainder: t(language, 'profile.milestone.toGo', { count: formatMilestoneCount(item.remaining) }),
        fillPercent: fill,
        meta: t(language, 'profile.milestone.reps.meta', {
          current: formatMilestoneCount(item.current),
          target: formatMilestoneCount(item.target),
        }),
      };
    case 'sets':
      return {
        key,
        title,
        remainder: t(language, 'profile.milestone.toGo', { count: formatMilestoneCount(item.remaining) }),
        fillPercent: fill,
        meta: t(language, 'profile.milestone.sets.meta', {
          current: formatMilestoneCount(item.current),
          target: formatMilestoneCount(item.target),
        }),
      };
    case 'exercises':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta: t(language, 'profile.milestone.exercises.meta', { current: item.current, target: item.target }),
      };
    case 'hours':
      return {
        key,
        title,
        remainder: t(language, 'profile.milestone.hours.toGo', { amount: decimal(item.remaining) }),
        fillPercent: fill,
        meta: t(language, 'profile.milestone.hours.meta', { current: decimal(item.current), target: item.target }),
      };
    case 'bodyweight':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta: t(language, 'profile.milestone.bodyweight.meta', { current: item.current, target: item.target }),
      };
    case 'cardio':
      return {
        key,
        title,
        remainder: countdown,
        fillPercent: fill,
        meta: t(language, 'profile.milestone.cardio.meta', { current: item.current, target: item.target }),
      };
    case 'distance':
      return {
        key,
        title,
        remainder: t(language, 'profile.milestone.distance.toGo', { amount: decimal(item.remaining) }),
        fillPercent: fill,
        meta: t(language, 'profile.milestone.distance.meta', { current: decimal(item.current), target: item.target }),
      };
  }
}

/** A reached rung as the page lists it: the name, the day, and its tier. */
export interface ReachedMilestoneRow {
  key: string;
  title: string;
  /** "Easy · 12 Aug 2026" */
  meta: string;
  tier: MilestoneTier;
}

export interface MilestoneLedgerRows {
  /** "12 of 150 reached" */
  summary: string;
  reached: ReachedMilestoneRow[];
  /** Every family's next rung, nearest first, as card rows. */
  upcoming: ProfileMilestoneRow[];
}

export function buildMilestoneLedgerRows(input: {
  ledger: MilestoneLedger;
  lifetime: LifetimeTrainingSummary;
  unitPreference: UnitPreference;
  language: AppLanguage;
}): MilestoneLedgerRows {
  const { ledger, lifetime, unitPreference, language } = input;
  return {
    summary: t(language, 'milestones.summary', { reached: ledger.reachedCount, total: ledger.totalCount }),
    reached: ledger.reached.map((item) => describeReached(item, unitPreference, language)),
    // Before the reader has done anything the front row is the same single
    // sentence the card shows: twelve zero rows, one of them claiming they
    // "started this week", would be a page of things that have not begun.
    upcoming: hasReaderProgress(ledger)
      ? ledger.upcoming.length > 0
        ? ledger.upcoming.map((item) => describe(item, { lifetime, unitPreference, language }))
        : allReachedRow(language)
      : firstSessionRow(language),
  };
}

/**
 * Has the reader done anything themselves?
 *
 * Not "is any figure above zero": onboarding writes the first weigh-in FOR
 * them — the setup screen's weight dial defaults to 75 kg and cannot be
 * skipped, and App seeds an entry from it — so "one weigh-in and nothing
 * else" is the state of every fresh install rather than an achievement. It
 * reaches the first bodyweight rung, which would hide this empty state from
 * essentially everyone. The second weigh-in is theirs, and so is anything in
 * any other family.
 *
 * The reached list still names that first weigh-in: it did happen, and the
 * page is a record. Only the question "has training begun" ignores it.
 */
function hasReaderProgress(ledger: MilestoneLedger): boolean {
  const seededWeighIn = (family: MilestoneFamily, figure: number) => family === 'bodyweight' && figure <= 1;
  return (
    ledger.upcoming.some((item) => item.current > 0 && !seededWeighIn(item.family, item.current)) ||
    ledger.reached.some((item) => !seededWeighIn(item.family, item.target))
  );
}

function firstSessionRow(language: AppLanguage): ProfileMilestoneRow[] {
  return [
    {
      key: 'first',
      title: t(language, 'profile.milestone.first.title'),
      remainder: '',
      fillPercent: 0,
      meta: t(language, 'profile.milestone.first.meta'),
    },
  ];
}

function describeReached(item: ReachedMilestone, unitPreference: UnitPreference, language: AppLanguage): ReachedMilestoneRow {
  return {
    key: `${item.family}-${item.target}`,
    title: milestoneTitle(item.family, item.target, unitPreference, language),
    meta: `${milestoneTierLabel(item.tier, language)} · ${formatDate(item.reachedAt, language)}`,
    tier: item.tier,
  };
}

/** The card's footer: how many have fallen, and the way to the page. */
export function milestoneCardFooter(reachedCount: number, language: AppLanguage): string {
  if (reachedCount <= 0) {
    return t(language, 'profile.milestone.footerNone');
  }
  return t(language, reachedCount === 1 ? 'profile.milestone.footerOne' : 'profile.milestone.footer', { count: reachedCount });
}
