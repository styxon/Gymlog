import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { classifySessionFocus } from './homeSessionHero';
import { I18nKey } from './i18n';
import { buildProgramFocusSplit, liftingFocusPct } from './programFocusSplit';

/**
 * The catalog's FOCUS AREA filter (design: GAINER Ready Catalog v2).
 *
 * The design ships a hand-written map of template id → focus tags. That map
 * covers 29 programs; the catalog has 37, so eight of them would silently
 * vanish from every focus except "Any" — and every program added later would
 * join them. So the tags are DERIVED from what the sessions actually contain,
 * using the two classifiers the app already trusts:
 *
 * - `classifySessionFocus` reads each session's exercise names and answers
 *   push / pull / lower / upper / general. Push and pull are both upper body
 *   here: the reader is picking a program, not a day.
 * - `buildProgramFocusSplit` weighs every exercise by set count into Strength /
 *   Conditioning / Mobility, which is what separates RESET from a lifting
 *   program even though both are "general" sessions to the first classifier.
 *
 * Neither reads titles, so this survives translation and a user's own naming —
 * the same reason `classifySessionFocus` stopped reading session titles.
 */

export type CatalogFocusKey = 'all' | 'full' | 'upper' | 'lower' | 'cardio' | 'mobility';

export const CATALOG_FOCUS_OPTIONS: Array<{ key: CatalogFocusKey; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'catalog.focus.any' },
  { key: 'full', labelKey: 'catalog.focus.full' },
  { key: 'upper', labelKey: 'catalog.focus.upper' },
  { key: 'lower', labelKey: 'catalog.focus.lower' },
  { key: 'cardio', labelKey: 'catalog.focus.cardio' },
  { key: 'mobility', labelKey: 'catalog.focus.mobility' },
];

/**
 * Enough conditioning that someone filtering for Cardio would recognise the
 * program as one. Measured against the catalog: this line falls in the gap
 * between FIT Elite (27%, a lifting program with real conditioning) and the
 * beginner home program (22%, a lifting program with a finisher).
 */
const CARDIO_TAG_MIN_PCT = 25;
/**
 * Higher than cardio on purpose: nearly every well-built program ends with some
 * stretching, and tagging all of them "Mobility" would make the chip select
 * everything, which is the same as not having it. The catalog has a clean gap
 * here — the four genuinely mobility-led programs sit at 38% and above, and the
 * next one down is at zero.
 */
const MOBILITY_TAG_MIN_PCT = 35;

/** Focus tags for one template, in the order the filter chips are shown. */
export function getProgramFocusTags(template: WorkoutTemplateV1): CatalogFocusKey[] {
  const split = buildProgramFocusSplit(template.sessions);
  const pct = (quality: 'Conditioning' | 'Mobility') =>
    split.find((segment) => segment.quality === quality)?.pct ?? 0;

  const tags: CatalogFocusKey[] = [];

  // A lifting tag needs strength to be the program's LARGEST quality, not
  // merely present. A fixed percentage floor does not work here: the pattern
  // classifier abstains on stretches and poses, so a yoga week reads as a
  // third "strength" and would answer the Full body filter. Relative wins on
  // the real catalog too — RUN is 31% strength against 38% mobility, and the
  // design's own hand-written map does not call it a strength program either.
  const strengthLeads = liftingFocusPct(split) >= Math.max(pct('Conditioning'), pct('Mobility'));

  if (strengthLeads) {
    const kinds = new Set(
      template.sessions.map((session) =>
        classifySessionFocus(session.exercises.map((exercise) => exercise.exerciseName)),
      ),
    );
    // Ordered by the chip row, not by how many sessions voted: the filter is a
    // set membership question, and a stable order keeps the tags comparable.
    if (kinds.has('general')) {
      tags.push('full');
    }
    if (kinds.has('upper') || kinds.has('push') || kinds.has('pull')) {
      tags.push('upper');
    }
    if (kinds.has('lower')) {
      tags.push('lower');
    }
  }

  if (pct('Conditioning') >= CARDIO_TAG_MIN_PCT) {
    tags.push('cardio');
  }
  if (pct('Mobility') >= MOBILITY_TAG_MIN_PCT) {
    tags.push('mobility');
  }

  return tags;
}

export function matchesCatalogFocus(template: WorkoutTemplateV1, focus: CatalogFocusKey): boolean {
  if (focus === 'all') {
    return true;
  }
  return getProgramFocusTags(template).includes(focus);
}
