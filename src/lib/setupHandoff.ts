/**
 * What the app offers once the questions are over, before it lets go.
 *
 * Onboarding used to end by dropping the reader on Home. Two things they would
 * otherwise have to find on their own belong right there instead: the widget,
 * and a card that tracks the body part they just said they cared about.
 *
 * The second one is the point of doing this here rather than later. The reader
 * has just answered "glutes"; a generic "track something" offer a week later
 * has forgotten that, and this has not.
 */
import type { MeasurementKind, SetupFocusArea } from '../types/models';

/**
 * The tape measurement that tracks a focus area.
 *
 * Twelve focus areas, seven tape measurements, so this is not a rename — it is a
 * mapping, and it has to be written down rather than guessed at a call site:
 * glutes are measured at the hips, hamstrings and quads at the thigh, core at
 * the waist. Areas with no tape at all (back, mobility) resolve to null and the
 * offer falls back to bodyweight, which is the one number every reader has.
 */
const FOCUS_MEASUREMENT: Partial<Record<SetupFocusArea, MeasurementKind>> = {
  glutes: 'hips',
  legs: 'thighs',
  quads: 'thighs',
  hamstrings: 'thighs',
  calves: 'calves',
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  arms: 'arms',
  core: 'waist',
};

export interface SetupTrackingOffer {
  /** A key from the Home stat-card catalog — a measurement kind, or bodyweight. */
  cardKey: MeasurementKind | 'bodyweight';
  /**
   * The focus area this came from, or null when it is the bodyweight fallback.
   * The screen uses it to name what the reader said, rather than what is being
   * measured: "glutes" is what they chose, "hips" is only how it is measured.
   */
  focus: SetupFocusArea | null;
}

/**
 * Which tracking card to offer, given what the reader said they were training.
 *
 * Every measured site the reader's own focus answers point at, in the order
 * they picked them and without repeats.
 *
 * The hand-off used to offer one of these — the first match — and the reader
 * never saw the others. The dialog offers the whole set they asked for, which
 * is a shorter and better list than all nine sites: somebody who said "chest
 * and arms" is not looking for calves (user, 2026-09-10).
 *
 * Empty when the reader named no focus area that maps to a tape measure. The
 * caller decides what to show then; this says nothing rather than guessing.
 */
export function resolveFocusMeasurementSites(focusAreas: SetupFocusArea[]): MeasurementKind[] {
  const sites: MeasurementKind[] = [];
  for (const focus of focusAreas) {
    const kind = FOCUS_MEASUREMENT[focus];
    if (kind && !sites.includes(kind)) {
      sites.push(kind);
    }
  }
  return sites;
}

/**
 * The one card the hand-off used to pin, and the focus label it still shows.
 *
 * The first focus area with a tape measurement wins. It no longer decides what
 * the reader is offered — the dialog above does that, from the whole set — but
 * it is still what names the focus on the page.
 */
export function resolveSetupTrackingOffer(focusAreas: SetupFocusArea[]): SetupTrackingOffer {
  for (const focus of focusAreas) {
    const cardKey = FOCUS_MEASUREMENT[focus];
    if (cardKey) {
      return { cardKey, focus };
    }
  }

  return { cardKey: 'bodyweight', focus: null };
}

export interface SetupHandoffInput {
  /** False when the launcher cannot pin widgets, or one is already placed. */
  canOfferWidget: boolean;
  /** Card keys already on Home. Bodyweight is there by default. */
  pinnedCardKeys: string[];
  focusAreas: SetupFocusArea[];
  /**
   * False when this build has no sign-in configured, or the reader is already
   * signed in. The offer is a card here — after onboarding, optional, skipped
   * by the same "Not now" as everything else — by explicit decision
   * (2026-08-22): sign-in never blocks the door, it stands beside it.
   */
  canOfferAccountBackup: boolean;
  /**
   * False when the reader already has Pro. Offering the page to somebody who
   * bought it is the sign that explains a sign.
   *
   * The offer is a row like the others, not a paywall: it opens the Pro page
   * after the rest of the hand-off lands, and declining costs nothing.
   */
  canOfferPro: boolean;
}

/** One screen of the hand-off. Pro is not one: it opens after the last. */
export type SetupHandoffPage = 'signin' | 'tracking' | 'offers';

export interface SetupHandoffPlan {
  /** False when there is nothing left to offer and the step must not appear. */
  shouldShow: boolean;
  /**
   * The pages to show, in order: sign-in, the widget, the tracking dialog.
   *
   * The widget before the tracking dialog (user 2026-10-16): its Done opens
   * the system's pin dialog, and the tracking sheet waits for that to close,
   * so the two never share the screen.
   *
   * Each only when it has something on it. The tracking dialog was on every
   * hand-off whether or not `offerTrackedSites` said it had anything to ask,
   * so a reader whose sites were all on Home already was asked to pick them
   * again — unselected, and a pick changed nothing (backfill review of #92,
   * 2026-09-16). Empty when the only offer is Pro: the hand-off then goes
   * straight to the Pro page.
   */
  pages: SetupHandoffPage[];
  offerWidget: boolean;
  /** Null when the card this reader would be offered is already on Home. */
  tracking: SetupTrackingOffer | null;
  /**
   * Whether the tracking dialog has anything left to ask.
   *
   * This was `offerBodyweight` until 2026-09-10, when the bodyweight row and
   * every other row but the widget became a page of their own. Nothing
   * rendered the old flag any more while it still decided whether the step
   * appeared, so a reader could be shown the hand-off on account of an offer
   * that was not in it. The question the page really asks is this one.
   */
  offerTrackedSites: boolean;
  /** Sign in with Google and keep the data past this phone. Free and Pro alike. */
  offerAccountBackup: boolean;
  /** Open the Pro page once the hand-off is done. Never for a reader who has it. */
  offerPro: boolean;
  /**
   * The measured sites to offer on the tracking page, from the reader's own
   * focus answers. Empty when they named nothing measurable, and the dialog
   * falls back to every site.
   */
  trackedSiteOptions: MeasurementKind[];
}

/**
 * Whether the hand-off has anything to say, and what.
 *
 * A step that offers nothing is worse than no step: it is one more tap between
 * the questions and the app. So this returns `shouldShow: false` when the widget
 * cannot be pinned and the card is already there — which is exactly what happens
 * to a reader who runs onboarding a second time.
 */
export function planSetupHandoff(input: SetupHandoffInput): SetupHandoffPlan {
  const offer = resolveSetupTrackingOffer(input.focusAreas);
  const tracking = input.pinnedCardKeys.includes(offer.cardKey) ? null : offer;

  // Something left to ask: a site the reader's own answers point at that is
  // not already on Home. No named sites falls back to all nine in the dialog,
  // so there is always something to offer then.
  const trackedSiteOptions = resolveFocusMeasurementSites(input.focusAreas);
  const offerTrackedSites =
    trackedSiteOptions.length === 0
    || trackedSiteOptions.some((site) => !input.pinnedCardKeys.includes(site));

  // `=== true` rather than truthiness: stored plans and older callers may not
  // carry the field at all, and `undefined` leaking into shouldShow turned a
  // boolean contract into a three-valued one.
  const offerAccountBackup = input.canOfferAccountBackup === true;
  const offerPro = input.canOfferPro === true;

  const pages: SetupHandoffPage[] = [
    ...(offerAccountBackup ? (['signin'] as const) : []),
    ...(input.canOfferWidget ? (['offers'] as const) : []),
    ...(offerTrackedSites ? (['tracking'] as const) : []),
  ];

  return {
    shouldShow:
      input.canOfferWidget || tracking !== null || offerTrackedSites || offerAccountBackup || offerPro,
    pages,
    offerWidget: input.canOfferWidget,
    tracking,
    offerTrackedSites,
    offerAccountBackup,
    offerPro,
    trackedSiteOptions,
  };
}

/*
 * `countSetupHandoffOffers` lived here until 2026-09-10.
 *
 * It counted the rows a one-page list showed, and the heading read the count.
 * Once sign-in, Pro and the sites each became their own page, the list held
 * exactly one row — the widget — while the count still said four, so the
 * heading claimed things the page did not have. A number that cannot be right
 * is not worth keeping accurate.
 */
